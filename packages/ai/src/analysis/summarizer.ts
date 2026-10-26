/**
 * summarizer.ts — Mastra 分析模块：capture:create 链路的单条内容理解（门卫 + 一句话摘要）。
 *
 * 编排：analyzeCapture 收 text + 全部图片（相对 filePath）→ 逐张读盘转
 * data URL → Mastra Agent（@ai-sdk/openai createOpenAI 接 Moonshot OpenAI
 * 兼容端点，structured output zod 校验）→ { meaningful, summary? }。
 * - 未配置 KIMI_API_KEY / 未注入 images baseDir → 抛配置指引错误；
 * - 超时上限 60s（AbortSignal.timeout(60_000)，AI SDK 官方取消契约）；
 * - meaningful=true 但 summary 空/纯空白 → 抛错（视为失败）；
 * - meaningful=false → 返回 { meaningful: false }（不带 summary）。
 *
 * 图片 base 目录经 setAnalysisImagesBaseDir 注入（主进程启动时以 userData 注入；
 * packages/ai 不依赖 electron，DAO 不碰磁盘——读盘解析收敛在本模块）。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import type { MastraModelConfig } from '@mastra/core/llm';
import { Agent } from '@mastra/core/agent';
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

严格输出 JSON：{"meaningful": true/false, "summary": "..."}（不值得保存时省略 summary）`;

/** structured output 校验 schema：zod 解析失败由 Mastra 自然抛错（走失败路径） */
const analysisOutputSchema = z.object({
  meaningful: z.boolean(),
  /** meaningful=false 时缺省 */
  summary: z.string().optional(),
});

/**
 * Kimi OpenAI 兼容端点 + 单步 Agent。
 * 测试阶段临时写死 Kimi Code 编程订阅端点（用户决策 2026-10-23），
 * 上线前换回开放平台端点 https://api.moonshot.cn/v1（见 .rail/docs/ai 技术债务）。
 *
 * 惰性初始化（首次 analyzeCapture 时构造）：ESM import 提升使模块级构造早于
 * 主进程 dotenv 加载（loadEnv 在入口模块体执行，@shiguang/ai 的 import 已先求值），
 * 模块级 createOpenAI 会固化 undefined 的 apiKey / 缺省模型（KIMI_MODEL 尚未进 env），
 * 首次调用时 process.env 已由 dotenv 就绪。
 */
let agent: Agent | null = null;
function getAgent(): Agent {
  if (!agent) {
    const kimi = createOpenAI({
      baseURL: 'https://api.kimi.com/coding/v1',
      apiKey: process.env.KIMI_API_KEY,
    });
    agent = new Agent({
      id: 'capture-summarizer',
      name: 'capture-summarizer',
      instructions: SUMMARIZER_SYSTEM_PROMPT,
      // Mastra 1.79 运行期对裸 AI SDK v4 模型自动包一层 AISDKV7LanguageModel
      // （dist llm 模块 specificationVersion === 'v4' 分支），此处公共类型只声明
      // 包装后的 MastraLanguageModelV4，故窄化转换（design 3.1 锁定 createOpenAI 方案）。
      model: kimi(resolveKimiModel()) as unknown as MastraModelConfig,
    });
  }
  return agent;
}

/**
 * 分析单条捕获内容：text + 全部图片 → { meaningful, summary? }。
 *
 * @param input text 可为空串（纯图记录）；images 为相对 imagesBaseDir 的 filePath
 * @returns meaningful=true 时恒带非空 summary；false 时不带 summary
 * @throws 未配置 KIMI_API_KEY / 未注入 baseDir / 读盘失败 / 超时 / 空摘要 / schema 解析失败
 */
export async function analyzeCapture(input: {
  text: string;
  images: Array<{ filePath: string }>;
}): Promise<{ meaningful: boolean; summary?: string }> {
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

  const result = await getAgent().generate(
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
    return { meaningful: true, summary: object.summary };
  }
  return { meaningful: false };
}
