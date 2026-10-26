# Design: AI 逐条理解（ai-record-summary）

## 1. 概述

拾光输入框点「拾光」提交后，本条内容（文字 + 全部图片）当前直接入库，事后浏览缺少「这条是什么」的速览信息。本次变更在 `capture:create` 入库链路上游**同步插入一步 AI 分析**：Mastra Agent（Kimi 多模态，OpenAI 兼容端点）对本条内容产出一句话中文摘要并做内容门卫判定；**记录 + 附件 + 摘要三表单事务入库**，摘要随 `capture:list` 返回并在记录行（预览之后、时间戳之前）展示。AI 判定无意义或调用失败（断网 / 限流 / 未配置 Key / 超时 60s / 空摘要或乱码）→ 已写盘图片清理、整条提交失败不入库，输入框按钮闪现失败态 + toast，可重试；不降级入库、无后台重试、无异步中间态——**摘要永远与记录同时存在**。

**范围内：**

- 迁移 0005_analyses：`analyses` 表（record_id INTEGER PK + FK ON DELETE CASCADE、summary NOT NULL、model NOT NULL、created_at 默认 UTC ISO），同步 DDL exec，登记进 db.ts migrations 数组
- `packages/ai/src/analysis/summarizer.ts`（新建）：`@mastra/core` Agent + structured output（zod `{ meaningful, summary? }`），`@ai-sdk/openai` 的 `createOpenAI` 自定义端点接 Kimi（baseURL `https://api.moonshot.cn/v1`，默认模型 `kimi-k2.6`，`KIMI_API_KEY` / `KIMI_MODEL` 走 `.env`）；单步 LLM 调用，**不建 workflow、不配 Mastra storage/memory**
- captureDao：`createCaptureWithAttachments` input 增可选 `analysis?: { summary; model }`，records + attachments + analyses 三表单事务入库（不新建 analysisDao）；`queryCaptures` / `listCaptures` SELECT 增 `LEFT JOIN analyses` 带出 `ai_summary`；新增 `getById`（顺手偿还 copy-image 全量拉取债务）
- shared 契约：`CaptureRecord` 增可选字段 `aiSummary?: string | null`；固定文案常量 `AI_NOT_MEANINGFUL_MESSAGE`；**不新增 IPC 通道**（摘要随 capture:list 返回）
- 主进程 `capture:create` 新编排：writeImageFiles → analyzeCapture（AbortSignal.timeout(60_000)）→ 有意义 → createCaptureWithAttachments 三表事务入库 return；无意义/失败 → 删除已写盘图片（沿用 writeImageFiles 失败清理模式）→ 抛错；`capture:copy-image` 改走 `getById`
- 输入框：busy 生命周期终点由「入库完成」变为「入库 + 分析完成」（loading 全程覆盖、禁再点，文案保持「拾光中…」）；失败时 toast——无意义固定文案「内容未拾光：AI 判定无有效信息」（不用 AI 返回的具体原因），其他失败「提交失败，请重试」；输入窗口补挂 `<Toaster />`
- 记录页：RecordRow 在 RichCapturePreview 之后、时间戳 `<p>` 之前新增摘要行（仅 `aiSummary` 非空渲染，灰色小字 + 「AI 摘要：」前缀）
- 根 `.md`（README）风险说明更新：内容（含图片）经 Moonshot 云端分析，计入既有「数据明文 + 云端处理」风险段；`docs/REQUIREMENTS.md` MEM-01 验收口径修订

**范围外（不做）：**

- Mastra workflow / snapshots / storage / memory 配置（单步 Agent 即可，无编排需求）
- 存量回填、摘要重跑机制、prompt_version 预埋、输入截断兜底、图片张数上限
- 无意义 toast 展示 AI 返回的具体原因（固定文案，产品已对齐）
- 新增 IPC 通道 / 新增 analysisDao（避免第三份并存 DAO 接口）
- 图片内文字提取级（OCR 级）理解深化

**边缘场景（已对齐）：**

| 场景 | 处理方式 |
| --- | --- |
| AI 调用失败（断网 / 限流 / 未配置 KIMI_API_KEY / 超时 / 空摘要 / 乱码） | 整条提交失败、不入库；已写盘图片逐个尽力删除；按钮闪现失败态可重试；不降级、无后台静默重试；超时阈值 60s（AbortSignal.timeout(60_000)） |
| AI 判定无意义（手误 / 乱敲 / 纯垃圾） | 本条提交直接失败、不入库，已写盘图片清理，toast 固定文案「内容未拾光：AI 判定无有效信息」 |
| 未配置 KIMI_API_KEY | analyzeCapture 抛带配置指引的错误（「未配置 KIMI_API_KEY：请在仓库根 .env 中配置后重启应用（参考 .env.example）」），走通用失败路径 |
| 纯图记录（无文字） | 送全部图片出摘要，正常入库（text 传空串，图片为 content 主体） |
| 图片张数很多 | 不设上限，全部送分析；按 token 计费（成本估算见 3.6） |
| 记录超长（5000 字上限内） | 不做 prompt 截断 / 长度兜底，现有输入约束已够 |
| 删除记录 | analyses 行随 FK `ON DELETE CASCADE` 级联删除（无需应用层逻辑） |
| 存量旧记录（无摘要） | 不做回填，用户自行清空库；`aiSummary` 读出 null，记录行不渲染摘要行 |
| createCapture（纯文字直写，无 attachments） | 不带 analysis 参数，不写 analyses 行——capture:create 图文整包链路恒走 createCaptureWithAttachments |

## 2. 验收标准

测试策略：三层测试——① DAO/迁移（临时目录真实 SQLite：0005 up/down、三表事务、analysis 缺省不写 analyses 行、JOIN 聚合 aiSummary、getById、FK 级联删除）；② summarizer 单测（vi.mock Mastra agent / 模型层：schema 解析、meaningful=false 分支、AbortSignal.timeout(60_000) 断言传入、图片读盘转 base64、缺 Key 抛错、空摘要判失败）；③ 主进程 handler 测试（vi.hoisted stubs + vi.mock('electron') + mock @shiguang/ai：新编排顺序、失败/无意义路径的图片清理 + invoke reject）与 renderer 组件测试（capture-form busy 生命周期 + 失败 toast、RecordRow 摘要行渲染分支）+ 根 `pnpm typecheck` 三包。真机走查补验 loading 覆盖时长与 toast 观感。

- AC-1：先分析后入库——提交后 AI 产出一句话中文摘要，记录 + 附件 + 摘要三表单事务入库；库中不存在「无摘要的新建记录」。
- AC-2：门卫生效——无意义输入（乱敲 / 纯垃圾）提交直接失败、不入库，toast 提示固定文案，已写盘图片被清理。
- AC-3：失败即失败可重试——断网 / 未配置 KIMI_API_KEY / 超时 60s / 空摘要或乱码时整条提交失败、不入库，按钮失败态可重试，重试成功后正常入库。
- AC-4：纯图记录——无文字记录送图产出摘要并入库。
- AC-5：记录页展示——记录行在 RichCapturePreview 之后、时间戳之前展示该条 AI 摘要；`CaptureRecord.aiSummary` 可选字段不破坏旧 fixture。
- AC-6：级联删除——删除记录后对应 analyses 行随 FK 级联删除，无孤儿数据。
- AC-7：迁移正确——迁移 0005 后存在 analyses 表（record_id PK + FK CASCADE、summary NOT NULL、model NOT NULL）；down 迁移可回滚；旧库升级后现有记录不受影响（无摘要）。
- AC-8：隐私说明——根 README（`.md`）风险说明已更新（内容含图片经 Moonshot 云端分析，口径同文字）。
- AC-9：自动化测试全绿——`pnpm --filter @shiguang/ai test`、`pnpm --filter @shiguang/desktop test`、根 `pnpm typecheck` 三包通过，不回退现有基线；全仓零 LangChain/LangGraph 残留引用。

## 3. 实现方案

### 3.1 接口与函数签名

**packages/shared/src/index.ts（只放契约不放实现）**

```ts
export interface CaptureRecord {
  // ...既有字段不变，新增：
  /** AI 一句话摘要（analyses.summary；无摘要的存量记录为 null/undefined，读取侧 LEFT JOIN 得到） */
  aiSummary?: string | null;
}

/** capture:create 无意义判定时主进程抛出的固定错误文案；渲染层据此区分 toast 文案 */
export const AI_NOT_MEANINGFUL_MESSAGE = '内容未拾光：AI 判定无有效信息';
```

**packages/ai/src/analysis/summarizer.ts（新建）**

```ts
import type { AnalysisResult } from './types'; // 或直接内联，见下

/** 默认模型：Moonshot 官方文档多模态（image_url）示例所用视觉模型 */
export const DEFAULT_KIMI_MODEL = 'kimi-k2.6';

/** 实际生效模型 ID（KIMI_MODEL 环境变量优先，缺省 DEFAULT_KIMI_MODEL）；analyses.model 与 Agent 共用 */
export function resolveKimiModel(): string;

/**
 * 注入图片 base 目录（filePath 为相对 userData 的 'images/<uuid>.png'）。
 * 主进程启动时 setAnalysisImagesBaseDir(path.join(app.getPath('userData')))。
 * 未注入时 analyzeCapture 抛配置错误。
 */
export function setAnalysisImagesBaseDir(dir: string): void;

/**
 * 分析单条捕获内容：text + 全部图片 → { meaningful, summary? }。
 * - 逐张 fs.readFile(filePath) → base64 → data URL 'data:image/png;base64,...'；
 * - 未配置 KIMI_API_KEY → 抛 Error（含 .env 配置指引）；
 * - Agent.generate 传 abortSignal: AbortSignal.timeout(60_000)；
 * - meaningful=true 但 summary 空/纯空白 → 抛 Error（视为失败）；
 * - schema 解析失败由 Mastra/zod 自然抛错（视为失败）。
 */
export function analyzeCapture(input: {
  text: string;
  images: Array<{ filePath: string }>;
}): Promise<{ meaningful: boolean; summary?: string }>;
```

内部结构（签名约束，实现按 Mastra 最佳实践）：

```ts
const kimi = createOpenAI({
  baseURL: 'https://api.moonshot.cn/v1',
  apiKey: process.env.KIMI_API_KEY,   // 缺省时 analyzeCapture 先抛配置指引错误
});
const agent = new Agent({
  name: 'capture-summarizer',
  instructions: SUMMARIZER_SYSTEM_PROMPT,   // 见 3.2 草案
  model: kimi(resolveKimiModel()),
  outputSchema: z.object({
    meaningful: z.boolean(),
    summary: z.string().optional(),   // meaningful=false 时缺省
  }),
});
// agent.generate(messages, { abortSignal: AbortSignal.timeout(60_000) })
// → result.object 经 zod 校验；后续空摘要/空白校验后返回。
```

**packages/ai/src/dao/captureDao.ts（扩展，既有行为零改动）**

```ts
export function createCaptureWithAttachments(input: {
  text: string;
  document?: string | null;
  sourceApp?: string | null;
  tags?: string[];
  attachments: Array<{ filePath: string; sizeBytes?: number }>;
  /** AI 摘要（缺省 = 不写 analyses 行；capture:create 恒传） */
  analysis?: { summary: string; model: string };
}): CaptureRecord;
// database.transaction 内：records → attachments（既有）→ if (input.analysis)
//   INSERT INTO analyses (record_id, summary, model) VALUES (?, ?, ?)

interface RecordRow {
  // ...既有字段不变，新增：
  /** LEFT JOIN analyses 得到的摘要，无摘要行时为 null */
  ai_summary: string | null;
}

/** 按 id 取单条记录（含附件聚合与 ai_summary）；不存在返回 null */
export function getById(id: number): CaptureRecord | null;
// 与 queryCaptures 共用 SELECT/JOIN 模板，WHERE records.id = ?，toRecords(rows)[0] ?? null

// listCaptures / queryCaptures 的 SELECT 统一改为：
//   SELECT records.*, attachments.file_path AS image_path, analyses.summary AS ai_summary
//   FROM records
//   LEFT JOIN attachments ON attachments.record_id = records.id
//   LEFT JOIN analyses  ON analyses.record_id  = records.id
// analyses 为 1:1（record_id PK）JOIN 不引入行膨胀，toRecords 聚合逻辑与 total COUNT 均不变。
```

**apps/desktop 主进程（captureHandlers.ts）**

```ts
ipcMain.handle(IPC.captureCreate, async (_event, payload: CreateCapturePayload) => {
  const written = await writeImageFiles(payload.images.map((img) => img.data));
  try {
    const analysis = await analyzeCapture({
      text: payload.text,
      images: written.map((w) => ({ filePath: w.filePath })),
    });
    if (!analysis.meaningful || !analysis.summary?.trim()) {
      throw new Error(AI_NOT_MEANINGFUL_MESSAGE);
    }
    return createCaptureWithAttachments({
      text: payload.text,
      document: payload.document != null ? rewriteImageSrcs(payload.document, written.map((w) => w.filePath)) : null,
      sourceApp: null,
      attachments: written,
      tags: payload.tags,
      analysis: { summary: analysis.summary, model: resolveKimiModel() },
    });
  } catch (err) {
    // 沿用 writeImageFiles 失败清理模式：逐个尽力删除已写盘图片，不掩盖原始错误
    for (const w of written) {
      await fs.rm(path.join(app.getPath('userData'), w.filePath), { force: true }).catch(() => {});
    }
    throw err;
  }
});

// capture:copy-image：queryCaptures 全量拉取 + find 改为 getById(payload.id)
// （偿还 .rail/docs/records-console/README.md 技术债务第 3 条）
```

**apps/desktop renderer**

```ts
// RecordRow.tsx：RichCapturePreview 之后、时间戳 <p> 之前新增摘要行
{record.aiSummary && (
  <p className="mt-1 text-xs text-neutral-400">AI 摘要：{record.aiSummary}</p>
)}

// capture-form.tsx：catch 分支闪现失败态基础上追加 toast——
//   import { toast } from '../../../components/ui/toast';
//   catch (err) {
//     setStatus('error'); ... 闪现定时器照旧 ...
//     toast(err instanceof Error && err.message === AI_NOT_MEANINGFUL_MESSAGE
//       ? AI_NOT_MEANINGFUL_MESSAGE : '提交失败，请重试');
//   }
// 按钮 submitting 文案保持「拾光中…」，busy 语义不变（loading 终点自然变为入库+分析完成）。

// input/App.tsx（或输入入口根部）：补挂 <Toaster />（console 页已有先例，输入窗当前未挂）。
```

### 3.2 关键数据结构

**analyses 表（迁移 0005 新建）**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| record_id | INTEGER PRIMARY KEY | 主键，FK 引用 records(id)，ON DELETE CASCADE（删记录摘要级联删，沿用 attachments 模式） |
| summary | TEXT NOT NULL | AI 一句话中文摘要（≤60 字，写入前经 trim 非空校验） |
| model | TEXT NOT NULL | 实际调用模型 ID（resolveKimiModel()，如 'kimi-k2.6'；KIMI_MODEL 覆盖时反映实际值） |
| created_at | TEXT NOT NULL DEFAULT (UTC ISO) | 与 records 同口径 |

**迁移 0005（`packages/ai/src/migrations/0005_analyses.ts`，沿用 0004 样板 {name, up, down}）**

- up：`CREATE TABLE analyses (record_id INTEGER PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE, summary TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));`
- down：`DROP TABLE IF EXISTS analyses;`
- db.ts migrations 数组登记（init → 0002 → 0003 → 0004 → 0005 顺次）
- 不预埋 status / prompt_version / error（失败即不入库，无需 status；proposal 已对齐）

**SUMMARIZER_SYSTEM_PROMPT 完整草案（实现时逐字采用，调优属后续迭代）**

> 设计取向：极简、无品牌语境——LLM 不需要知道「拾光」是什么，只需知道输入构成
> （文字可为空 + 图片可没有 = 一条完整记录）并做好摘要与门卫判定。

```
你将收到一段文字（可能为空）和若干张图片（可能没有），它们是一条完整记录的全部内容。

任务：
1. 判定这条记录是否值得长期保存：手误乱敲、纯符号/表情、空泛无信息量的内容
   不值得；有具体信息量的文字，或图片本身含可理解内容（截图、文档、照片等），值得。
2. 值得保存时，输出一句不超过 60 字的中文摘要：覆盖文字与图片的整体含义
   （图片是内容的一部分，不是附件）；不复述原文，不编造看不见的内容。

严格输出 JSON：{"meaningful": true/false, "summary": "..."}（不值得保存时省略 summary）
```

### 3.3 关键骨架（必须按此实现）

1. `capture:create` 编排顺序恒为 writeImageFiles → analyzeCapture → createCaptureWithAttachments；分析无意义或抛错时先清理全部 written 图片再抛原始错误，清理失败仅吞掉（与 writeImageFiles 失败清理同模式）。
2. 无意义分支判定与抛错位置在主进程 handler（DAO 不做门卫）；抛错文案恒为 shared 常量 `AI_NOT_MEANINGFUL_MESSAGE`，渲染层据 message 精确匹配区分 toast，不使用 AI 返回的具体原因。
3. `AbortSignal.timeout(60_000)` 只在 summarizer 内构造并经 `agent.generate(..., { abortSignal })` 传入，单测断言该 signal 传入模型层。
4. analyses 写入必须复用 createCaptureWithAttachments 的 `database.transaction`，在 attachments 循环之后、`return` 之前同事务 INSERT；**不新建 analysisDao**。
5. `queryCaptures` 的 total COUNT 语句保持 `FROM records` 不加 JOIN（analyses 1:1 不影响计数）；items SELECT 才加 `LEFT JOIN analyses ... analyses.summary AS ai_summary`。
6. `createCapture`（纯文字直写）**不加** analysis 参数与 analyses 写入——AI 链路的唯一写入口是 createCaptureWithAttachments。
7. 图片读盘转 base64 在 summarizer 内完成（`fs.readFile(path.join(baseDir, filePath))` → `data:image/png;base64,...`），baseDir 经 `setAnalysisImagesBaseDir` 注入，DAO 仍不碰磁盘。
8. `analyzeCapture` 返回前校验：`meaningful === true` 且 `summary.trim()` 非空，否则抛错（空摘要视为失败）；`meaningful === false` 时 summary 必须缺省（zod optional 天然保证）。
9. RecordRow 摘要行仅 `record.aiSummary` 非空时渲染，挂载点在 RichCapturePreview 之后、时间戳 `<p>` 之前，样式弱于正文（`text-xs text-neutral-400` + 「AI 摘要：」前缀）。
10. capture-form 失败 toast 在 catch 分支同步调用（闪现定时器之外），成功路径不弹 toast；busy 防连点与 600ms 闪现惯例沿用 M4 既有实现零改动。
11. `getById` 与 listCaptures/queryCaptures 共用同一份 SELECT/JOIN 模板字符串，禁止复制漂移。

### 3.4 数据流 / 状态变更

```
【capture:create 新编排（主进程，全程同步阻塞 invoke）】
payload{ text, document, images, tags }
  → writeImageFiles(images.map(data))            // 既有：落盘 images/<uuid>.png，自身失败已清理
  → analyzeCapture({ text, images: written.filePath[] })
       ├─ summarizer 内：KIMI_API_KEY 校验 → 逐张读盘转 base64 data URL
       │   → Agent.generate(system prompt + multimodal user content,
       │                    { abortSignal: AbortSignal.timeout(60_000) })
       │   → zod structured output 解析 → 空摘要校验 → { meaningful, summary? }
       ├─ meaningful=false 或 summary 空 → handler 抛 Error(AI_NOT_MEANINGFUL_MESSAGE)
       │   （断网/限流/超时/未配 Key 时 summarizer 已抛各自错误）
  → 有意义：createCaptureWithAttachments({ ..., analysis: { summary, model: resolveKimiModel() } })
       单事务：INSERT records → INSERT attachments × N → INSERT analyses → return CaptureRecord
  → 任一路径抛错：for written → fs.rm(userData/filePath, {force:true}) 尽力清理 → throw
       → invoke reject → 渲染层按钮闪现 error + toast（区分固定文案/通用文案）

【输入框提交状态机（capture-form，状态集不变）】
idle「拾光」→ busy=true 禁再点（loading 全程覆盖写盘+AI 分析+入库，终点=入库+分析完成）
  → success「✓ 已拾光」600ms 闪现 → 清空编辑器/objectURL/字节 ref → idle
  → error「提交失败」600ms 闪现 + toast（无意义=固定文案；其他=「提交失败，请重试」）
    → 内容与标签状态全保留 → idle 可重试

【记录页展示（RecordsPage → capture:list → queryCaptures）】
queryCaptures/listCaptures SELECT 增 LEFT JOIN analyses（1:1，无行膨胀）
  → toRecords 聚合（aiSummary 首行取值，同记录各 JOIN 行共享）
  → RecordRow：RichCapturePreview → [AI 摘要行（aiSummary 非空才渲染）] → 时间戳 → 标签 chips

【删除记录】deleteCaptures 事务删 attachments + records → analyses 随 FK ON DELETE CASCADE
自动级联（PRAGMA foreign_keys = ON 已开），无应用层逻辑、无孤儿数据
```

### 3.5 技术决策

1. **[新增] 分析编排用 Mastra Agent 单步调用 + structured output，不建 workflow**。理由：本期链路是「一次 LLM 调用出结构化判定+摘要」的单步语义，无步骤编排/条件分支/断点续跑需求；workflow 反而引入快照存储等无谓复杂度（且边界已锁不用 Mastra storage）。遵循 docs.mastra.ai 最佳实践：Agent 以 `outputSchema`（zod）声明 structured output，运行期经 Mastra 校验后从 `result.object` 取强类型结果。备选 workflow：无编排需求信号，明确排除（proposal 已对齐）。
2. **[新增] 模型接入用 `@ai-sdk/openai` 的 `createOpenAI` 自定义端点，不引 Moonshot 官方 SDK、主进程不加 HTTP client 依赖**。理由：Mastra 官方即以 AI SDK 模型提供方为模型层，createOpenAI({ baseURL, apiKey }) 一行切到 OpenAI 兼容端点，与 Mastra 集成路径最短；Moonshot SDK 体积与维护面更大且与 Mastra 无官方集成；裸 fetch 需自行处理 SSE/重试/类型。零额外 HTTP 依赖（@ai-sdk/openai 自带）。
3. **[新增] 默认模型 `kimi-k2.6`（Moonshot 官方文档多模态示例模型），`KIMI_MODEL` 环境变量可覆盖**。理由：官方 Chat Completions 文档视觉示例（image_url 输入）即以 kimi-k2.6 演示，多模态能力有据；模型名硬编码默认值 + 环境变量覆盖，延续「换模型只改环境变量」旧决策，analyses.model 记 resolveKimiModel() 实际值便于事后追溯。
4. **[新增] 摘要在 analyses 独立表（1:1 records），不挂 records 列、不做关联表**。理由：摘要来源（模型、时点）与记录本体生命周期不同（prompt 调优后新数据重出），独立表是最简 1:1 扩展；挂列会随 records SELECT * 全带出且无法记 model；关联表是多对多错配。record_id 直接作 PK 即 1:1 约束，无需 UNIQUE 重复声明。
5. **[新增] analyses 写入收敛进 createCaptureWithAttachments，不新建 analysisDao**。理由：摘要写入与记录入库是同一事务边界，拆开必然产生「记录已入库摘要未写」的中间态或分布式事务；proposal 明确勿制造第三份并存 DAO 接口（captureDao 已有 listCaptures/queryCaptures 并存债务）。
6. **[新增] 读取侧用 LEFT JOIN 带摘要，不做二次查询**。理由：analyses 为 record_id PK 的 1:1 JOIN，结果行数仍由 attachments 决定，零行膨胀，toRecords 聚合与 total COUNT 均无需改动；二次查询要额外 round trip + 内存映射，且 list/query 两条路径都要接。`aiSummary` 为可选字段，旧 fixture 不补也编译通过（AC-5）。
7. **[新增] 超时用 `AbortSignal.timeout(60_000)` 传 generate，不自写 setTimeout 竞态**。理由：AbortSignal 是 AI SDK/Mastra 的官方取消契约，超时即中止底层 HTTP 请求；自写计时器无法真正取消在途请求。60s 阈值 proposal 已对齐（图片上云 + 60 字输出的合理上限）。
8. **[新增] 无意义与其他失败在主进程合流为「抛错 + 图片清理」，渲染层按错误 message 区分 toast**。理由：两条失败路径的失败态/重试语义完全相同，仅 toast 文案不同；用 shared 常量做 message 精确匹配是最小契约，不新增 IPC 错误码通道。不采用 AI 返回的具体原因：文案稳定性与产品口径（caller 已对齐）。
9. **[新增] 图片读盘转 base64 放 summarizer（packages/ai），baseDir 经 setAnalysisImagesBaseDir 注入**。理由：analyzeCapture 签名（caller 锁定）只收 filePath，磁盘解析只能模块内完成；packages/ai 不依赖 electron，baseDir 注入与 setCaptureDatabase 同模式，测试用 mkdtemp 注入即可；DAO 不碰磁盘铁律不破（summarizer 是 service 非 DAO）。
10. **[偿还] captureDao 新增 getById，copy-image 由全量拉取切换**。理由：`.rail/docs/records-console/README.md` 债务第 3 条（复制图片每次扫全表），本迭代主进程按 id 取记录场景增加，顺手偿还；共用 SELECT/JOIN 模板防漂移（骨架 11）。
11. **[沿用] 输入框状态机零重构**：idle/submitting/success/error 四态、busy 防连点、600ms 闪现均为 M4 既有实现，本次仅改 catch 分支加 toast 与入口补挂 Toaster——loading 终点语义变化（入库+分析完成）由 invoke 时长自然承载，无需新增状态。
12. **[沿用] 不新增 IPC 通道**：摘要随 capture:list 的 CaptureRecord 返回，契约改动只有 shared 一个可选字段，preload/env.d.ts 零改动。

### 3.6 风险 / 取舍

- [风险] **AI 分析拉长提交耗时（最坏 60s）期间用户重复操作** → 缓解：busy 全程禁再点 + 按钮「拾光中…」明示；60s 为已对齐上限。
- [风险] **Moonshot 端点不可达/限流导致提交失败率上升** → 缓解：失败即可重试（内容全保留）；README 风险说明如实告知云端依赖；无后台静默重试（已对齐）。
- [风险] **空摘要/乱码判定依赖 LLM 输出质量** → 缓解：zod structured output 保证结构，trim 空摘要判失败兜底；乱码（schema 解析失败）由 Mastra 抛错走失败路径；门卫误杀（好内容被判无意义）概率由 prompt 明确的 true 标准压制，属可接受取舍。
- [风险] **API Key 泄漏** → 缓解：KIMI_API_KEY 仅走 `.env`（dotenv 最前加载、不进仓库），主进程内存消费，不写盘不传输第三方。
- [取舍] **图片按 token 计费且全部送分析** → 接受：单次调用输入 ≈ 文字（≤5000 字 ≈ 2~3k tokens）+ 图片（每张数百~2k tokens 视分辨率），输出 <100 tokens；按 Moonshot 现行 K2 系列刊例（详见 platform.moonshot.cn/docs/pricing/chat）单次成本处于「分钱以下」量级（proposal 已对齐），精确单价以平台 pricing 页实时为准。
- [取舍] **存量记录无摘要（不回填）** → 接受：产品已对齐，用户自行清空库；`aiSummary` 缺省不渲染摘要行，记录页无破窗。
- [风险] **analyses 表孤儿数据** → 已解：record_id 为 PK + FK ON DELETE CASCADE，PRAGMA foreign_keys = ON 在 initDatabase 已开启，DAO 测试断言级联（AC-6）。
- [取舍] **迁移 0005 依赖 FK 语法** → 低风险接受：标准 SQLite 语法，attachments 既有 FK 先例；down 为标准 DROP TABLE。
- [风险] **Mastra/AI SDK 版本演进** → 缓解：依赖锁版本入 packages/ai package.json；structured output 用法随 docs.mastra.ai 版本核对（AGENTS.md 约束）。

### 3.7 技术债务

- **记录编辑联动摘要重跑**：当前记录无编辑能力；未来引入编辑后摘要必然失配——编辑功能立项时须把「编辑触发重跑」作为其需求一部分（proposal 第 3 节已预判，本期不预留 prompt_version）。
- **LIKE 筛选与 JOIN 性能**：records.tags LIKE 全表扫 + analyses JOIN 随记录量增长的开销，沿用既有债务口径（`.rail/docs/records-console/README.md` 第 1 条），真出现卡顿再上 FTS5/索引。
- **`listCaptures` 与 `queryCaptures` 并存**：本次仍未收敛（新增 getById 是增量收敛），三接口并存记入债务，待存储治理迭代统一。
- **AI 分析成本与隐私规模化压力**：逐条实时上云随记录量累积 token 成本与暴露面；出现批量/高频场景时评估本地小模型兜底或降频策略，届时单独立项。

### 3.8 影响文件清单

**packages/shared/**
- `src/index.ts`：`CaptureRecord` 增 `aiSummary?: string | null`；新增常量 `AI_NOT_MEANINGFUL_MESSAGE`

**packages/ai/**
- `package.json`：新增依赖 `@mastra/core`、`@ai-sdk/openai`、`zod`
- `src/migrations/0005_analyses.ts`（新建）：analyses 建表（record_id PK + FK CASCADE）；down DROP TABLE
- `src/db.ts`：migrations 数组登记 0005
- `src/dao/captureDao.ts`：RecordRow 增 `ai_summary`；SELECT/JOIN 模板增 LEFT JOIN analyses；`createCaptureWithAttachments` 增 `analysis?` 三表事务；新增 `getById`
- `src/analysis/summarizer.ts`（新建）：DEFAULT_KIMI_MODEL / resolveKimiModel / setAnalysisImagesBaseDir / analyzeCapture + SUMMARIZER_SYSTEM_PROMPT
- `src/index.ts`：导出 analyzeCapture / resolveKimiModel / setAnalysisImagesBaseDir / getById；改写注释（LangGraph → Mastra 分析模块，消除残留引用）
- 测试：`src/db.test.ts`（0005 up/down 结构断言）、`src/dao/captureDao.test.ts`（三表事务 / 缺省不写 / JOIN 聚合 / getById / 级联删除）、`src/analysis/summarizer.test.ts`（新建，vi.mock Mastra/模型层）

**apps/desktop 主进程**
- `src/main/ipc/captureHandlers.ts`：capture:create 新编排（分析 → 三表事务 / 清理图片抛错）；capture:copy-image 切 `getById`
- `src/main/index.ts`：启动处补 `setAnalysisImagesBaseDir(path.join(app.getPath('userData')))`
- 测试：`src/main/ipc/captureHandlers.test.ts`（新编排顺序、失败/无意义清理 + reject、copy-image 走 getById）

**apps/desktop renderer**
- `src/renderer/input/features/capture/capture-form.tsx`：catch 分支 toast（区分固定/通用文案）
- `src/renderer/input/App.tsx`（或输入入口根部）：补挂 `<Toaster />`
- `src/renderer/console/pages/RecordRow.tsx`：AI 摘要行（RichCapturePreview 后、时间戳前）
- 测试：`capture-form.test.tsx`（busy 终点 + 失败 toast 两分支）、`RecordRow.test.tsx`（fixture 增 aiSummary + 渲染分支）

**docs**
- 根 `.md`（README）：「数据存储 → 风险说明」段增补「内容（含图片）经 Moonshot 云端分析」口径
- `docs/REQUIREMENTS.md`：MEM-01 验收口径修订为「AI 失败则本条提交失败可重试（不入库）」

## 4. 回滚条件

- Kimi 端点在大陆网络环境不可用或持续限流、提交失败率不可接受 → revert capture:create 编排（恢复 writeImageFiles → createCaptureWithAttachments 直入库），数据层（迁移 0005、DAO 扩展、analyses 表）独立成立无害；新记录暂时无摘要，记录行回退不渲染摘要行。
- Mastra/AI SDK 与 Electron 44 主进程出现不可修复的兼容问题（如 ESM/CJS 打包阻断）→ 评估改裸 fetch + zod 直调 OpenAI 兼容端点（prompt/schema 全量复用）；仍不可行则整体回滚分析段，数据层保留。
- 门卫误杀率（有意义内容被判无意义）在真实使用显著高于预期 → 先调 prompt（SUMMARIZER_SYSTEM_PROMPT 为独立常量，调优不动链路）；不可接受则产品重议门卫口径，链路代码不动。
- 迁移 0005 在用户环境出现兼容问题（低风险：标准 DDL，attachments FK 有先例）→ 执行 down（DROP TABLE analyses）回滚数据层，业务代码回滚至无摘要版本。
