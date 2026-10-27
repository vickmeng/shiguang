/**
 * profiler.ts — 画像汇总 Agent：把「上一版画像 + 本批待汇总摘要」全量重写为
 * 一份全新用户画像（固定 5+1 槽位，对应 shared ProfileDocument 契约）。
 *
 * 复用 summarizer 已验证的模型接入模式（Mastra 原生 custom endpoint 配置接 Kimi
 * OpenAI 兼容端点，resolveKimiModel 复用 import，model 函数惰性求值）；
 * zod .strict() schema 把「AI 发明新槽位」与「漏槽」统一收敛为解析抛错
 * （视同汇总失败，由调用方 summarizeNow 走失败路径：旧画像保留、队列不动）。
 * runProfileSummarization（输入拼装 + generate 调用）在本文件下半部分实现。
 */
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import type { ProfileDocument } from '@shiguang/shared';
import { resolveKimiModel } from '../analysis/summarizer';
import type { PendingSummary } from '../dao/profileDao';

/** 本批喂入汇总的待汇总摘要，定义统一于 profileDao，此处透传复用。 */
export type { PendingSummary };

/**
 * PROFILER_SYSTEM_PROMPT —— 画像全量重写的系统提示（design 3.2 要点逐条落 prompt）。
 *
 * 设计取向：与 summarizer 同款极简、无品牌语境——LLM 不需要知道「拾光」是什么，
 * 只需知道输入构成（旧画像 + 本批摘要均为参考输入）与输出契约（6 槽位严格 JSON）。
 */
export const PROFILER_SYSTEM_PROMPT = `你将收到两部分输入：
1. 上一版用户画像（JSON 对象，可能注明尚无画像）；
2. 一批新的记录摘要（每条含编号、记录时间、分级与标签）。

任务：输出一份全新画像，完整描述这位用户是谁、最近在关心什么、长期要什么。
旧画像与新摘要都只是参考输入，不是可以照抄的答案：
- 久未提及的、用户习惯已变化的内容要淘汰或改写，不要原样保留陈旧表述；
- 新摘要中反复出现的信息可以吸收进对应槽位；
- 同义或重叠的条目合并为一条最准确的表述。

槽位定义（固定 5+1 个，输出对象的 key 必须严格如下）：
- identity：用户是谁——职业、角色、生活状态等稳定的身份事实；
- recent：近期反复提及、正在关心的话题（时效性强，久不提及即应淘汰）；
- interests：稳定的兴趣领域；
- values：价值观——看重的东西、抵触的东西、做事偏好；
- goals：长期目标与方向；
- misc：不属于以上任何槽位、但值得记住的事实。

条目约束：
- 每条一句话以内，纯事实短句，不编造输入中没有的信息；
- 不写解释、不标注来源编号、不输出条目以外的任何文字。

槽位约束：
- 槽位集合固定，不允许发明新槽位，也不允许改槽位名；
- 某槽位确实无内容时输出空数组，不要省略该槽位。

严格 JSON 输出，恰好含且只含以下六个键；某槽位无内容时给 [] 而不是省略键。
以下为结构示例（内容仅为占位，严禁照抄，条目必须来自输入）：
{
  "identity": ["职业或角色", "家庭状态"],
  "recent": ["近期话题一", "近期话题二"],
  "interests": ["稳定兴趣"],
  "values": ["看重什么"],
  "goals": ["长期方向"],
  "misc": []
}`;

/**
 * structured output 校验 schema。
 * strict：多余槽位即解析失败；6 槽位全必需，缺槽=失败（design 3.3 骨架 2 / AC-4）。
 * 元素为字符串；条目一句话以内由 prompt 约束，不做长度硬校验。
 * 注解 z.ZodType<ProfileDocument>：编译期把 schema 输出契约锁到 shared 画像契约。
 */
export const profileOutputSchema: z.ZodType<ProfileDocument> = z
  .object({
    identity: z.array(z.string()),
    recent: z.array(z.string()),
    interests: z.array(z.string()),
    values: z.array(z.string()),
    goals: z.array(z.string()),
    misc: z.array(z.string()),
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
 * 汇总一版全新用户画像：上一版画像 + 本批待汇总摘要 → ProfileDocument。
 *
 * user content 两段拼装：旧画像 JSON（null 时注明「尚无画像」）+ 本批摘要
 * 编号列表（`#recordId [createdAt] (grade: x) 标签：…\n摘要`，grade 缺失为 none）。
 * structuredOutput 经 zod strict schema 校验，缺/多槽位与超时一样自然抛错
 * （不 catch，由调用方 summarizeNow 走失败路径：旧画像保留、队列不动）。
 *
 * @param input previous 为当前画像（无则 null）；batch 为待汇总摘要（FIFO）
 * @returns 解析通过的全新画像文档
 * @throws 未配置 KIMI_API_KEY（配置指引）/ 超时 / schema 校验失败
 */
export async function runProfileSummarization(input: {
  previous: ProfileDocument | null;
  batch: PendingSummary[];
}): Promise<ProfileDocument> {
  if (!process.env.KIMI_API_KEY) {
    throw new Error(
      '未配置 KIMI_API_KEY：请设置 KIMI_API_KEY 环境变量（在仓库根 .env 中配置后重启应用，参考 .env.example)',
    );
  }

  const previousSection = input.previous ? JSON.stringify(input.previous) : '尚无画像';
  const batchSection = input.batch
    .map(
      (s) =>
        `#${s.recordId} [${s.createdAt}] (grade: ${s.grade ?? 'none'}) 标签：${s.tags.join('、')}\n${s.summary}`,
    )
    .join('\n\n');
  const userContent = `上一版用户画像：\n${previousSection}\n\n本批新的记录摘要：\n${batchSection}`;

  const result = await profilerAgent.generate(userContent, {
    structuredOutput: { schema: profileOutputSchema },
    abortSignal: AbortSignal.timeout(60_000),
  });

  return profileOutputSchema.parse(result.object);
}
