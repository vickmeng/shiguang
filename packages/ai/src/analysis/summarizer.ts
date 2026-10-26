/**
 * summarizer.ts — Mastra 分析模块：capture:create 链路的单条内容理解（门卫 + 一句话摘要）。
 *
 * 编排：analyzeCapture 收 text + 全部图片（相对 filePath）→ 逐张读盘转
 * data URL → Mastra Agent（Mastra 原生 custom endpoint 配置接 Kimi OpenAI
 * 兼容端点，structured output zod 校验）→ { meaningful, summary? }。
 * - 未配置 KIMI_API_KEY / 未注入 images baseDir → 抛配置指引错误；
 * - 超时上限 60s（AbortSignal.timeout(60_000)，AI SDK 官方取消契约）；
 * - meaningful=true 但 summary 空/纯空白 → 抛错（视为失败）；
 * - meaningful=false → 返回 { meaningful: false }（不带 summary）；
 * - meaningful=true 时 AI 可附三档分级 grade（high/mid/low），缺失表示无分级。
 *
 * 图片 base 目录经 setAnalysisImagesBaseDir 注入（主进程启动时以 userData 注入；
 * packages/ai 不依赖 electron，DAO 不碰磁盘——读盘解析收敛在本模块）。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { MastraModelConfig } from '@mastra/core/llm';
import { Agent } from '@mastra/core/agent';
import type { Grade } from '@shiguang/shared';
import { z } from 'zod';

/** 默认模型：Moonshot 官方文档多模态（image_url）示例所用视觉模型 */
export const DEFAULT_KIMI_MODEL = 'kimi-k2.6';

/** 实际生效模型 ID（KIMI_MODEL 环境变量优先，缺省 DEFAULT_KIMI_MODEL）；analyses.model 与 Agent 共用 */
export function resolveKimiModel(): string {
  return process.env.KIMI_MODEL ?? DEFAULT_KIMI_MODEL;
}

/** 图片 base 目录（filePath 为相对该目录的路径，如 'images/<uuid>.png'）；未注入时 analyzeCapture 抛配置错误 */
let imagesBaseDir: string | null = null;

/** 注入图片 base 目录（主进程启动时调用一次；测试用 mkdtemp 注入） */
export function setAnalysisImagesBaseDir(dir: string): void {
  imagesBaseDir = dir;
}

/**
 * SUMMARIZER_SYSTEM_PROMPT —— 门卫 + 一句话摘要的系统提示（design 3.2 草案逐字采用）。
 *
 * 设计取向：极简、无品牌语境——LLM 不需要知道「拾光」是什么，只需知道输入构成
 * （文字可为空 + 图片可没有 = 一条完整记录）并做好摘要与门卫判定。
 */
export const SUMMARIZER_SYSTEM_PROMPT = `你将收到一段文字（可能为空）和若干张图片（可能没有），它们是一条完整记录的全部内容。

任务：
1. 判定这条记录是否值得长期保存：手误乱敲、纯符号/表情、空泛无信息量的内容
   不值得；有具体信息量的文字，或图片本身含可理解内容（截图、文档、照片等），值得。
2. 值得保存时，输出一句不超过 60 字的中文摘要：覆盖文字与图片的整体含义
   （图片是内容的一部分，不是附件）；不复述原文，不编造看不见的内容。
3. 判定这条记录对未来了解用户的价值，输出三档分级之一：- high：观点、决定、计划、强烈情感、有长期参考价值的内容；- mid：一般事实、日常事务记录；- low：琐碎、一次性、过后即无参考价值的内容。仅当 meaningful=true 时输出分级。

严格输出 JSON：{"meaningful": true/false, "summary": "...", "grade": "high"|"mid"|"low"}（不值得保存时省略 summary 与 grade）`;

/** structured output 校验 schema：zod 解析失败由 Mastra 自然抛错（走失败路径） */
const analysisOutputSchema = z.object({
  meaningful: z.boolean(),
  /** meaningful=false 时缺省 */
  summary: z.string().optional(),
  /** 仅 meaningful=true 时输出；缺失通过存 NULL，非法拒绝走失败路径 */
  grade: z
    .enum(['high', 'mid', 'low'])
    .optional()
    .describe('观点/决定/计划/强情感/长期参考→high；一般事实/日常→mid；琐碎/一次性→low'),
});

/**
 * Kimi OpenAI 兼容端点 + 单步 Agent。
 * 测试阶段临时写死 Kimi Code 编程订阅端点（用户决策 2026-10-23），
 * 上线前换回开放平台端点 https://api.moonshot.cn/v1（见 .rail/docs/ai 技术债务）。
 *
 * model 用 Mastra 原生 custom endpoint 配置（{ id, url, apiKey }），并以函数形式
 * 传入：Mastra 在 generate 时才求值（resolveModelConfig），故 process.env 读取
 * 晚于主进程 dotenv 加载，无需再为 ESM import 提升做惰性初始化 workaround。
 */
const agent = new Agent({
  id: 'capture-summarizer',
  name: 'capture-summarizer',
  instructions: SUMMARIZER_SYSTEM_PROMPT,
  model: (): MastraModelConfig => ({
    // id 需含 provider 前缀（Mastra OpenAICompatibleConfig 约定 `${string}/${string}`）
    id: `custom/${resolveKimiModel()}` as `${string}/${string}`,
    url: 'https://api.kimi.com/coding/v1',
    apiKey: process.env.KIMI_API_KEY,
  }),
});

/**
 * 分析单条捕获内容：text + 全部图片 → { meaningful, summary?, grade? }。
 *
 * @param input text 可为空串（纯图记录）；images 为相对 imagesBaseDir 的 filePath
 * @returns meaningful=true 时恒带非空 summary，grade 为 AI 产出的三档分级（可缺失）；
 *          false 时不带 summary/grade
 * @throws 未配置 KIMI_API_KEY / 未注入 baseDir / 读盘失败 / 超时 / 空摘要 / schema 解析失败
 */
export async function analyzeCapture(input: {
  text: string;
  images: Array<{ filePath: string }>;
}): Promise<{ meaningful: true; summary: string; grade?: Grade } | { meaningful: false }> {
  if (!process.env.KIMI_API_KEY) {
    throw new Error(
      '未配置 KIMI_API_KEY：请在仓库根 .env 中配置后重启应用（参考 .env.example)',
    );
  }
  if (!imagesBaseDir) {
    throw new Error(
      'analysis images base dir not initialized: call setAnalysisImagesBaseDir first',
    );
  }

  const content: Array<
    { type: 'text'; text: string } | { type: 'image'; image: string; mimeType: string }
  > = [];
  if (input.text) {
    content.push({ type: 'text', text: input.text });
  }
  for (const image of input.images) {
    const bytes = await readFile(path.join(imagesBaseDir, image.filePath));
    content.push({
      type: 'image',
      image: `data:image/png;base64,${bytes.toString('base64')}`,
      mimeType: 'image/png',
    });
  }

  const result = await agent.generate(
    [
      { role: 'system', content: SUMMARIZER_SYSTEM_PROMPT },
      { role: 'user', content },
    ],
    {
      structuredOutput: { schema: analysisOutputSchema },
      abortSignal: AbortSignal.timeout(60_000),
    },
  );

  const object = result.object;
  if (object.meaningful === true) {
    if (!object.summary || object.summary.trim() === '') {
      throw new Error('AI 返回空摘要');
    }
    return {
      meaningful: true,
      summary: object.summary,
      ...(object.grade !== undefined ? { grade: object.grade } : {}),
    };
  }
  return { meaningful: false };
}
