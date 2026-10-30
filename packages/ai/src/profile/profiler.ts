/**
 * profiler.ts — 画像汇总 Agent：把「上一版画像 + 本批待汇总摘要」全量重写为
 * 一份全新用户画像（固定 6 槽位，对应 shared ProfileDocument 契约）。
 *
 * 复用 summarizer 已验证的模型接入模式（Mastra 原生 custom endpoint 配置接 Kimi
 * OpenAI 兼容端点，resolveKimiModel 复用 import，model 函数惰性求值）；
 * zod .strict() schema 把「AI 发明新槽位」收敛为解析抛错，槽位缺键/null 则
 * 原样透传（string | null，视同该槽位无内容，不视为失败）。
 * runProfileSummarization（输入拼装 + generate 调用）在本文件下半部分实现。
 */
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import type { ProfileDocument } from '@shiguang/shared';
import { resolveKimiModel } from '../analysis/summarizer';
import type { PendingSummary, RecentMention } from '../dao/profileDao';

/** 本批喂入汇总的待汇总摘要与近期记录概览，定义统一于 profileDao，此处透传复用。 */
export type { PendingSummary, RecentMention };

/**
 * PROFILER_SYSTEM_PROMPT —— 画像全量重写的系统提示（design 3.2 要点逐条落 prompt）。
 *
 * 设计取向：与 summarizer 同款极简、无品牌语境——LLM 不需要知道「拾光」是什么，
 * 只需知道输入构成（旧画像 + 本批摘要 + 近期概览均为参考输入）与输出契约（6 槽位严格 JSON）。
 */
export const PROFILER_SYSTEM_PROMPT = `
你需要通过用户平时的摘录历史总结用户画像，你将接受用户旧画像数据，部分近期被总结过的历史摘要，以及新增的用户摘录。相关数据结构如下：

输入为一个 JSON 对象：
interface Input {
  previous: ProfileDocument;    // 上一版画像；无旧画像时为空
  latest: SummaryItem[];        // 新摘要
  recent: SummaryItem[];        // 近期历史摘要（已经画像总结过的数据）
}

用户画像结构：
interface ProfileDocument {
  identity?: string | null;    // 稳定身份事实（职业、角色、生活状态）
  recent?: string | null;      // 近期反复提及、正在关心的话题（时效性强）
  interests?: string | null;   // 稳定的兴趣领域
  values?: string | null;      // 价值观
  goals?: string | null;       // 长期目标与方向
  misc?: string | null;        // 不属于以上槽位但值得记住的事实
}

// 单条摘要结构
interface SummaryItem {
  createdAt: string;      // 记录时间
  grade: string | null;   // 重要性分级，可为空
  tags: string[];         // 标签，可为空
  summary: string;        // 该条 AI 摘要
}

任务：全量重写为一份新的 ProfileDocument，严格按照规定格式输出。

原则：
  1.宁缺毋滥，用户画像部分槽位为空是正常结果。每槽位须充分证据才填。
  2.要根据原画像，记录重要性，标签，记录内容，记录时效性，以及同类内容的出现频率等综合因素分析用户画像。

输出：只输出一个 ProfileDocument 的严格 JSON`;

/**
 * structured output 校验 schema。
 * 入口放宽、出口透传：槽位接受 string / null / 缺键（undefined），原样透传
 * （视同无内容，不视为失败）；.strict() 保留——发明新槽位仍判解析失败。
 * 注解 z.ZodType<ProfileDocument>：编译期把 schema 输出契约锁到 shared 宽松
 * 画像契约（string | null，键可选；输入侧为 unknown）。
 */
const slotSchema = z.string().nullish();

export const profileOutputSchema: z.ZodType<ProfileDocument> = z
  .object({
    identity: slotSchema,
    recent: slotSchema,
    interests: slotSchema,
    values: slotSchema,
    goals: slotSchema,
    misc: slotSchema,
  })
  .strict();

/**
 * 画像汇总 Agent（复用 summarizer 的 custom endpoint 模式：{ id, url, apiKey }，
 * model 以函数形式传入——Mastra 在 generate 时才求值，process.env 读取晚于主进程
 * dotenv 加载，无需惰性初始化 workaround）。
 */
const profilerAgent = new Agent({
  id: 'user-profiler',
  // Mastra AgentConfig 要求 name（summarizer 同）；任务描述未列，类型约束补齐
  name: 'user-profiler',
  instructions: PROFILER_SYSTEM_PROMPT,
  model: () => ({
    // id 需含 provider 前缀（Mastra OpenAICompatibleConfig 约定 `${string}/${string}`）
    id: `custom/${resolveKimiModel()}` as `${string}/${string}`,
    url: 'https://api.kimi.com/coding/v1',
    apiKey: process.env.KIMI_API_KEY,
  }),
});

/**
 * 汇总一版全新用户画像：上一版画像 + 本批待汇总摘要 + 近期记录概览 → ProfileDocument。
 *
 * user content 为单个 JSON 字符串：{ previous, latest, recent } 三键。
 * previous 为旧画像对象（无旧画像时为 {}，不再注入「尚无画像」字样）；
 * latest 为待汇总摘要（FIFO）；recent 为近期概览（dao 已倒序）；两者序列化时
 * 均剔除 recordId / analyzed（仅 dao 层使用，不喂模型），其余字段原样保留。
 * structuredOutput 经 zod schema 校验：槽位缺键/null 原样透传（视同无内容），
 * 发明新槽位与超时一样自然抛错（不 catch，由调用方 summarizeNow 走失败路径：旧画像保留、队列不动）。
 *
 * @param input previous 为当前画像（无则 null）；latest 为待汇总摘要（FIFO）；
 *   recent 为近期记录概览（dao 已按时间倒序）
 * @returns 解析通过的全新画像文档
 * @throws 未配置 KIMI_API_KEY（配置指引）/ 超时 / schema 校验失败
 */
export async function runProfileSummarization(input: {
  previous: ProfileDocument | null;
  latest: PendingSummary[];
  recent: RecentMention[];
}): Promise<ProfileDocument> {
  if (!process.env.KIMI_API_KEY) {
    throw new Error(
      '未配置 KIMI_API_KEY：请设置 KIMI_API_KEY 环境变量（在仓库根 .env 中配置后重启应用，参考 .env.example)',
    );
  }

  // 剔除 recordId / analyzed：仅 dao 层使用，不喂模型
  const pickFields = ({ createdAt, grade, tags, summary }: PendingSummary) => ({
    createdAt,
    grade,
    tags,
    summary,
  });
  const userContent = JSON.stringify({
    previous: input.previous ?? {},
    latest: input.latest.map(pickFields),
    recent: input.recent.map(pickFields),
  });

  const result = await profilerAgent.generate(userContent, {
    structuredOutput: { schema: profileOutputSchema },
    abortSignal: AbortSignal.timeout(60_000),
  });

  return profileOutputSchema.parse(result.object);
}
