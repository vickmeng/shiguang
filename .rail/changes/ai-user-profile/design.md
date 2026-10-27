# Design: AI 用户画像（ai-user-profile）

## 1. 概述

拾光 AI 段迭代二：基于迭代一「AI 逐条理解」产出的 per-record 摘要（`analyses` 表），在主进程后台**全量重写**式汇总出一份**用户画像**（`ProfileDocument`，固定 5+1 槽位），并在 console 新增只读「画像」页 + 记录页「已入像」徽标联动。对应 `docs/REQUIREMENTS.md` 的 MEM-02（画像生成）与 MEM-03（画像页 + 记录页联动）。

**关键行为：**

- **汇总执行**：每轮把「上一版画像 + 本批待汇总摘要（summary + grade + tags + createdAt）」作为 AI 参考输入，输出一份全新画像；旧表述可改写/移动槽位/淘汰；全量重写无漂移累积。沿用项目锁定选型：Mastra Agent 单步 structured output + Kimi（同一端点与模型解析，复用 summarizer 的 `resolveKimiModel`），零新增第三方依赖。
- **触发规则**：待汇总队列 ≥5 条，或距上次汇总尝试 ≥24h 且有积压（≥1 条），或首次启用且从未成功汇总过（profiles 无行）——主进程后台自动汇总，不阻塞记录入库与界面；画像页「立即汇总」手动随时触发；不设单次条数上限。
- **单飞**：竞争态收敛在通用 `SingleFlightRunner`（main/lib，future jobs 复用同一原语）——running 置位先于任何 await，调用方不经手标志；自动入口快速短路跳过、手动入口 onBusy 幂等返回 `{ ok: true }`。
- **待汇总队列语义**：`analyses.profiled_at IS NULL`，FIFO（`created_at ASC, record_id ASC`）；汇总成功在同一事务内写画像 + 批量打时间戳。
- **失败语义**：画像是派生层——汇总失败绝不阻塞记录入库；队列不动、旧画像保留、画像页失败态可手动重试。AI 输出 schema 校验失败（缺/多槽位）视同汇总失败，绝不落坏 JSON。
- **存储（迁移 0007）**：`analyses` 加可空 `profiled_at TEXT` 列（语义 = 曾作为输入参与过某次汇总的时间戳，无 CHECK，风格同 0006）；新建 `profiles` 表单行表（`id INTEGER PRIMARY KEY CHECK (id = 1)`，document JSON + updated_at）。
- **记录删除**：不做联动，画像不引用 record id，天然无悬挂；被删记录不再入新输入，旧表述靠下轮全量重写自然淘汰。

**范围内：**

- shared 契约：`ProfileDocument`（6 槽位固定结构）、`CaptureRecord.aiProfiledAt`、`IPC.profileGet/profileSummarize` 常量、`ProfileStatusPayload`、`ProfileSummarizeResult`
- packages/ai：迁移 0007 + `profileDao`（注入/get/save 打戳/待汇总队列）+ `profiler`（Agent + zod strict schema + 全量重写 prompt）+ `captureDao` 读取侧透出 `ai_profiled_at`
- 主进程：`profileRunner`（触发判定/单飞/手动/定时器）+ `profileHandlers` IPC + `main/index.ts` 接线（注入 + 启动钩子 + 定时器）+ capture 钩子（fire-and-forget）
- renderer console：`App.tsx` 三元链重构（还腐化小债）、SideNav 加「画像」、`ProfilePage`（状态栏/空态/6 槽位/立即汇总）、记录页「已入像」徽标（RecordRow + 详情弹窗元信息行）

**范围外（不做）：**

- sqlite-vec 向量索引（迭代三）、主动洞察推送（迭代四）
- 画像编辑/反馈入口、画像历史版本保留
- `profiles.schema_version` 字段（模板变更直接重跑汇总）
- 自动重试冷却策略（记技术债务）
- 记录编辑联动（编辑功能单独立项）
- MEM-02 原闭环标准「可溯源到记录」已作废，改为「记录页可见每条记录是否已纳入画像」（proposal 口径修订 2）

**边缘场景（已对齐）：**

| 场景 | 处理方式 |
| --- | --- |
| 并发触发（自动 + 手动同刻） | `running` 内存标志单飞；自动入口 true 即 return；手动入口 running 时幂等返回 `{ ok: true }`（前端按钮禁用双保险） |
| AI 持续失败 | 不新增冷却/重试策略，维持规则触发原样，记技术债务（`.rail/docs/ai/README.md` 债务节） |
| AI 输出缺槽位/多槽位/格式坏 | zod `.strict()` 解析抛错 → `summarizeNow` catch → 旧画像保留、队列不动、返回 `{ ok: false, error }`，画像页失败态可重试 |
| 汇总进行中又来新记录 | capture 钩子 fire-and-forget `maybeSummarize()`，running=true 直接跳过，该条自然留待下轮 |
| 首次启用（profiles 无行） | pending ≥ 1 即触发，存量摘要自然入队完成首跑 |
| 从未汇总过（画像页空态） | document 为 null → 引导文案 + 「立即汇总」主按钮 |
| 坏画像 JSON（document 文本损坏） | `getProfile` 读侧 JSON.parse 失败按 null 处理，降级不抛 |
| 记录删除 | 不做联动；下轮全量重写自然淘汰，画像不引用 record id 无悬挂 |

## 2. 验收标准

测试策略：三层 TDD——① packages/ai（迁移 0007 up/down、profileDao 全接口含事务打戳/坏 JSON 降级/FIFO 序、profiler mock Agent 参照 summarizer.test.ts）；② 主进程（profileRunner mock profileDao + profiler：5 条触发/24h 触发/单飞/失败 ok:false 且 running 复位；profileHandlers mock runner/dao）；③ renderer（ProfilePage 空态/汇总中禁用/槽位渲染/空槽隐藏/失败 toast；RecordRow 徽标；App/SideNav 导航）。真机走查补验：录 5+ 条 → 自动汇总 → 画像页可见；久不关注话题下轮消失。

- AC-1：自动触发——录一条 → 摘要入库 → 待汇总队列满 5 条自动后台汇总 → 画像页出现新内容；不阻塞记录入库。
- AC-2：手动触发——画像页「立即汇总」调 `profile:summarize`；汇总进行中按钮禁用、再触发幂等 no-op 返回 `{ ok: true }`；返回后刷新状态。
- AC-3：全量重写——新画像为全新文档，旧画像与新摘要仅作参考输入；久不关注的话题从「最近关注」等槽位消失；单飞——绝不并行两次 LLM 调用。
- AC-4：槽位约束——固定 5+1 槽位；AI 输出缺槽位/多槽位视同汇总失败（zod strict），旧画像保留、队列不动、绝不落坏 JSON。
- AC-5：迁移 0007——`analyses.profiled_at` 可空 TEXT 列（无 CHECK）；`profiles` 单例表（id=1 CHECK、document、updated_at）；up/down 可回滚；画像写入与批量打戳同一事务。
- AC-6：失败语义——汇总失败记录正常入库；画像页显示失败（toast 展示 error）且可手动重试；`getProfile` 遇坏 JSON 降级返回 null 不抛。
- AC-7：契约——`ProfileDocument` 6 槽位导出；`CaptureRecord.aiProfiledAt?: string | null` 不破坏旧 fixture；`IPC.profileGet/profileSummarize` 四触点全链路（shared 常量 + handler + registerIpc + preload + env.d.ts）。
- AC-8：画像页——状态栏 = 上次汇总时间（本地格式化，无则「从未汇总」）+ 待汇总条数 + 「汇总中…」（running 时按钮禁用）+ 「立即汇总」；6 槽位分区渲染、空槽位隐藏；document 为 null 时空态引导；纯只读无编辑入口。
- AC-9：「已入像」徽标——记录页表格行摘要旁（aiSummary 非空且 aiProfiledAt 非空）渲染；详情弹窗元信息行同条件复用同一 `ProfiledBadge`；无摘要占位「—」不渲染。
- AC-10：自动化测试全绿——`pnpm --filter @shiguang/ai test`、`pnpm --filter @shiguang/desktop test`、根 `pnpm typecheck` 三包通过，不回退现有基线。
- AC-11：文档同步——`.rail/docs/ai/README.md` 债务节新增「汇总失败无冷却/重试策略」条目；`docs/REQUIREMENTS.md` AI 段迭代二状态更新（验收后勾选）。

## 3. 实现方案

总体架构（四层）：shared 契约 → packages/ai（迁移 0007 + profileDao + profiler）→ 主进程编排（profileRunner + profileHandlers IPC）→ renderer console（画像页 + 记录页徽标）。

### 3.1 接口与函数签名

**packages/shared/src/index.ts（只放契约不放实现）**

```ts
/** AI 用户画像：固定 5+1 槽位；key 英文，中文展示文案由前端映射（身份概况/最近关注/兴趣爱好/在意的事/长期方向/其他） */
export interface ProfileDocument {
  identity: string[];   // 身份概况
  recent: string[];     // 最近关注
  interests: string[];  // 兴趣爱好
  values: string[];     // 在意的事
  goals: string[];      // 长期方向
  misc: string[];       // 其他
}

export interface CaptureRecord {
  // ...既有字段不变，新增：
  /** 曾纳入画像汇总的时间戳（analyses.profiled_at）；NULL/undefined = 未纳入 */
  aiProfiledAt?: string | null;
}

/** IPC 通道常量新增：profileGet: 'profile:get'、profileSummarize: 'profile:summarize' */

/** profile:get 响应：画像文档 + 上次汇总时间 + 待汇总数 + 进行中态 */
export interface ProfileStatusPayload {
  document: ProfileDocument | null;
  updatedAt: string | null;
  pendingCount: number;
  running: boolean;
}

/** profile:summarize 响应：手动触发结果 */
export interface ProfileSummarizeResult {
  ok: boolean;
  error?: string;
}
```

**packages/ai/src/migrations/0007_profile.ts（新建，仿 0006 模板）**

```ts
// UP：ALTER TABLE analyses ADD COLUMN profiled_at TEXT;
//     CREATE TABLE profiles (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL, updated_at TEXT NOT NULL);
// DOWN：DROP TABLE profiles; ALTER TABLE analyses DROP COLUMN profiled_at;
// db.ts migrations 数组登记（0006 之后）
```

**packages/ai/src/dao/profileDao.ts（新建）**

```ts
import type { ProfileDocument } from '@shiguang/shared';

/** 本批喂入汇总的待汇总摘要（profileDao 导出共享，profiler 消费） */
export interface PendingSummary {
  recordId: number;
  summary: string;
  grade: string | null;
  tags: string[];
  createdAt: string;
}

export function setProfileDatabase(db: Database): void;   // 模块级注入，风格同 captureDao
export function getProfile(): { document: ProfileDocument; updatedAt: string } | null;
// profiles 表单行读取；document 为 JSON 文本，JSON.parse 失败按 null 处理（坏数据降级不抛）
export function saveProfileWithStamp(input: {
  document: ProfileDocument;
  stampedIds: number[];   // 本次喂入的 analyses.record_id 列表
}): void;
// 单事务：profiles 行 UPSERT（id=1, document=JSON.stringify, updated_at=now）
//   + 批量 UPDATE analyses SET profiled_at = now WHERE record_id IN (...)
export function pendingSummaries(): PendingSummary[];   // profiled_at IS NULL，ORDER BY created_at ASC, record_id ASC（FIFO）
export function pendingCount(): number;
// tags 取 records 表 tags JSON 快照列；parseTags 在 profileDao 内自写私有实现（不依赖 captureDao，DAO 间不互相依赖）
```

**packages/ai/src/profile/profiler.ts（新建）**

```ts
// 复用 summarizer 已验证模式：
// new Agent({ id: 'user-profiler', instructions: PROFILER_SYSTEM_PROMPT,
//   model: () => ({ id: `custom/${resolveKimiModel()}`, url: 'https://api.kimi.com/coding/v1',
//     apiKey: process.env.KIMI_API_KEY }) })
// resolveKimiModel 从 summarizer import 复用；同一端点与模型解析。

// zod schema（.strict()：多余槽位即解析失败；6 槽位全必需，缺槽=失败）：
// z.object({ identity: z.array(z.string()), recent: ..., interests: ..., values: ..., goals: ..., misc: ... }).strict()
// 元素为字符串；条目一句话以内由 prompt 约束，不做长度硬校验。

export function runProfileSummarization(input: {
  previous: ProfileDocument | null;
  batch: PendingSummary[];
}): Promise<ProfileDocument>;
// user content = 旧画像 JSON 字符串（无则注明"尚无画像"）+ 本批摘要编号列表：
//   `#{recordId} [createdAt] (grade: high) 标签：A、B\n摘要文本`
// structuredOutput: { schema } + AbortSignal.timeout(60_000)
// 未配置 KIMI_API_KEY 抛配置指引错误（文案同 summarizer 风格）
// schema 校验失败自然抛错（缺/多槽位视同失败）
```

**packages/ai/src/dao/captureDao.ts（读取侧原地改）**

```ts
interface RecordRow {
  // ...既有字段不变，新增：
  ai_profiled_at: string | null;   // LEFT JOIN analyses 得到
}
// SELECT_RECORDS_JOIN SELECT 列表追加：analyses.profiled_at AS ai_profiled_at
// toRecord 映射：aiProfiledAt: row.ai_profiled_at
// createCapture 的 RETURNING 补 NULL AS ai_profiled_at
// 三读接口（list/query/getById）共享模板零改动获益
```

**apps/desktop/src/main/lib/singleFlight.ts（新建，通用单飞执行器）**

```ts
// 与业务无关的后台异步任务单飞原语（future jobs 复用：new SingleFlightRunner() 即得
// 同样的竞争态 + 尝试时间语义）。竞争态处理收敛在 run() 内部：
// running 置位先于任何 await（JS 单线程同步段保证"检查→置位"原子），
// 调用方永远不经手 running 标志。
export class SingleFlightRunner {
  isRunning(): boolean;
  getLastAttemptAt(): number | null;   // 上次尝试开始的 epoch ms（含失败）；进程重启即失
  run<R>(fn: () => Promise<R>, opts: {
    onBusy: () => R;                  // 已在执行时的兜底返回（业务自定语义，如幂等 no-op）
    onError: (e: Error) => R;         // fn 抛错时映射为业务结果（不吞错策略由调用方定）
  }): Promise<R>;
}
// run 语义：running 时直接返回 onBusy()；否则同步置 running=true、lastAttemptAt=now
// （失败同样推进基准），try fn → catch opts.onError → finally running=false。
```

**apps/desktop/src/main/profile/profileRunner.ts（新建）**

```ts
// 业务语义层：竞争态委托模块级 SingleFlightRunner 实例 summarizeJob，本文件不留 running 标志。
const summarizeJob = new SingleFlightRunner();

export function maybeSummarize(): void;
// 快速短路 summarizeJob.isRunning()（真正防线在 summarizeJob.run 内）；
// 触发条件：pendingCount >= 5  OR  （距上次尝试 >= 24h 且 pending >= 1）
// 「距上次」基准 = summarizeJob.getLastAttemptAt() ?? profiles.updatedAt（epoch）；
// 从未汇总过（profiles 无行）且 pending >= 1 即触发；条件不满足 return。

export function summarizeNow(): Promise<ProfileSummarizeResult>;
// 供手动触发；委托 summarizeJob.run(doSummarize, { onBusy: () => ({ ok: true }),  ← 幂等 no-op
//   onError: (e) => { console.error 留痕; return { ok: false, error: e.message }; } })：
// doSummarize = pendingSummaries() → runProfileSummarization({ previous, batch })
//   → saveProfileWithStamp（document + 全批 stampedIds）→ return { ok: true }。
// 失败不阻塞记录入库、队列不动、旧画像保留。

export function isRunning(): boolean;   // → summarizeJob.isRunning()
export function startProfileTimer(): void;
// setInterval 每 10 分钟调 maybeSummarize()（内部 try/catch 防 unhandled rejection）；
// 不手动 clearInterval，跟随主进程生命周期（进程退出自然清理）。
```

**apps/desktop/src/main/ipc/profileHandlers.ts（新建，仿 tagsHandlers 模式）**

```ts
ipcMain.handle(IPC.profileGet)    // → { document, updatedAt, pendingCount, running: isRunning() }
ipcMain.handle(IPC.profileSummarize)  // → summarizeNow()
// registerIpc.ts 装配
```

**apps/desktop/src/preload（index.ts + env.d.ts 四触点补齐）**

```ts
api.profile.get(): Promise<ProfileStatusPayload>
api.profile.summarize(): Promise<ProfileSummarizeResult>
```

**renderer console**

```ts
// App.tsx：三元链重构为
// const PAGES: Record<ConsolePage, React.ComponentType> = { records: RecordsPage, tags: TagsPage, profile: ProfilePage, settings: SettingsPage };
// const Page = PAGES[page];  // Record 强制键齐全，漏加编译期暴露

// SideNav.tsx：ConsolePage 联合类型加 'profile'；NAV_ITEMS 加 { key: 'profile', label: '画像' }

// record-detail-dialog.tsx：导出 ProfiledBadge（仿 GradeBadge 单点导出——纯展示 Tailwind 常量，描边灰小 chip「已入像」，不进 tagColorMap）

// ProfilePage.tsx（新建）：加载调 api.profile.get()；状态栏（updatedAt 本地格式化/「从未汇总」、待汇总 N 条、running「汇总中…」禁用按钮）；
//   「立即汇总」click → api.profile.summarize()，await 期间 loading，返回后刷新 get，失败 toast 展示 error（复用既有 toast）；
//   6 槽位顺序分区（槽位标题 + 条目列表），空槽位隐藏；document 为 null → 引导文案 + 「立即汇总」主按钮；只读无编辑入口。

// RecordRow.tsx 摘要 td：aiSummary 非空且 aiProfiledAt 非空时，摘要文本旁渲染 <ProfiledBadge />；占位「—」不渲染。
// record-detail-dialog 元信息行（record-detail-header 内）同条件渲染 <ProfiledBadge />。
```

**主进程接线**

```ts
// main/index.ts：app ready 后调一次 maybeSummarize() + startProfileTimer()；
//   加一行 setProfileDatabase(db)（注入同一连接）。
// captureHandlers.ts captureCreate handler：成功 return 后 fire-and-forget maybeSummarize()
//   （.catch(console.error) 防 unhandled rejection；挂在 return createCaptureWithAttachments(...) 之后、不进 try/catch——汇总失败绝不影响 capture 响应）。
```

### 3.2 关键数据结构

**profiles 表（迁移 0007 新建，单例）**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY CHECK (id = 1) | 单例约束，永远只一行 |
| document | TEXT NOT NULL | `ProfileDocument` 的 JSON 文本；写入侧 JSON.stringify，读侧 parse 失败按 null 降级 |
| updated_at | TEXT NOT NULL | 上次成功汇总时间（ISO 字符串）；触发判定的「距上次」基准之一 |

**analyses 表 profiled_at 列（迁移 0007 新增）**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| profiled_at | TEXT（可空，无 CHECK、无默认值） | 语义 = 曾作为输入参与过某次汇总的时间戳；NULL = 未纳入待汇总队列 |

**ProfileDocument 槽位（shared 定义，前端中文映射）**

| key | 前端文案 | 语义（prompt 逐条定义） |
| --- | --- | --- |
| identity | 身份概况 | 用户是谁：职业/角色/生活状态等稳定身份事实 |
| recent | 最近关注 | 近期反复提及、正在关心的话题 |
| interests | 兴趣爱好 | 稳定的兴趣领域 |
| values | 在意的事 | 价值观、看重/抵触的东西 |
| goals | 长期方向 | 长期目标与方向 |
| misc | 其他 | 不属于以上槽位但值得记住的事实 |

**PROFILER_SYSTEM_PROMPT 要点**

- 5+1 槽位语义逐条定义（上表）；
- **全量重写**指令：输出一份全新画像，旧画像与新摘要都只是参考输入；久未提及的、用户习惯已变化的内容要淘汰或改写；
- 条目一句话以内、纯事实短句、不编造；
- 槽位集合固定，不允许发明新槽位；某槽位无内容输出空数组；
- 输出严格 JSON。

**profileRunner 触发规则**

| 条件 | 触发 |
| --- | --- |
| `running === true` | 永不触发（单飞） |
| `pending >= 5` | 触发 |
| 距上次尝试 ≥24h 且 `pending >= 1` | 触发 |
| 从未汇总过（profiles 无行）且 `pending >= 1` | 触发（首次首跑） |

「距上次」基准 = `lastAttemptAt ?? updatedAt(epoch)`；`lastAttemptAt` 为内存 epoch ms，进程重启后以 `profiles.updated_at` 续算。

### 3.3 关键骨架（必须按此实现）

1. 单飞的唯一防线是 profileRunner 模块内存 `running` 标志，`maybeSummarize`/`summarizeNow` 双入口共用；DAO 与 profiler 层不做并发感知。
2. zod schema 必须 `.strict()` 且 6 槽位全必需：缺槽=失败、多槽=失败；失败路径 = `summarizeNow` catch → `{ ok: false, error }`，旧画像与队列原样保留，绝不写 profiles 表。
3. `saveProfileWithStamp` 必须单事务：profiles UPSERT 与 `UPDATE analyses SET profiled_at` 同生共死，失败整体回滚。
4. `SELECT_RECORDS_JOIN` 追加 `analyses.profiled_at AS ai_profiled_at`、`createCapture` RETURNING 补 `NULL AS ai_profiled_at`、RecordRow/toRecord 同改——三处与 JOIN 模板禁止漂移；三读接口（list/query/getById）不改。
5. capture 钩子挂在 handler 成功 return 之后、try/catch 之外，fire-and-forget `maybeSummarize().catch(console.error)`——汇总失败绝不影响 capture 响应。
6. `summarizeNow` 的幂等语义：running 时经 `SingleFlightRunner.run` 的 `onBusy` 返回 `{ ok: true }`（不是错误）；失败经 `onError` 返回 `{ ok: false, error: message }`；running 复位由执行器 `finally` 无条件执行。
7. 定时器 `setInterval(10min)` 不手动 clear，跟随主进程生命周期；`maybeSummarize` 内部 try/catch 防 unhandled rejection。
8. 画像页空槽位隐藏（不渲染空分区）；徽标渲染条件 = `aiSummary` 非空 **且** `aiProfiledAt` 非空，两处（RecordRow/详情弹窗）复用同一 `ProfiledBadge` 导出。
9. App.tsx 用 `Record<ConsolePage, React.ComponentType>` 的 PAGES 映射替代三元链，键强制齐全，漏页编译期暴露。

### 3.4 数据流 / 状态变更

```
【自动触发】
capture:create 成功 → handler fire-and-forget maybeSummarize()
  → summarizeJob.isRunning()? 是→return（快速短路）/ 否→pendingCount + 触发规则判定
  → 满足：summarizeJob.run(doSummarize)（内部置 running=true + lastAttemptAt=now）
    → pendingSummaries()（FIFO，profiled_at IS NULL）
      → runProfileSummarization({ previous: getProfile()?.document ?? null, batch })
        → Mastra Agent structuredOutput（zod strict，60s 超时）
    → saveProfileWithStamp（单事务：profiles UPSERT + analyses 批量打戳）
  → 不满足/失败：队列不动、旧画像保留（失败经 onError console.error 留痕 + { ok:false, error }）

【手动触发】
画像页「立即汇总」→ profile:summarize → summarizeNow() → summarizeJob.run(doSummarize)
  → onBusy（running 中）→ { ok: true }（幂等 no-op）/ 成功 → { ok: true } / 失败 → { ok: false, error }

【画像页状态】
挂载 → profile:get → { document, updatedAt, pendingCount, running }
  → 状态栏（上次汇总时间/待汇总 N 条/汇总中…）+ 6 槽位分区（空槽隐藏）/ 空态引导

【徽标】
capture:list/query LEFT JOIN analyses（ai_profiled_at 随 JOIN 带出，零新增查询）
  → CaptureRecord.aiProfiledAt → RecordRow 摘要旁 / 详情弹窗元信息行 → ProfiledBadge
```

### 3.5 技术决策

1. **[新增] 汇总编排放主进程 profileRunner（触发规则 + setInterval），竞争态收敛在通用 SingleFlightRunner（main/lib/singleFlight.ts），不放 renderer、不放 DAO**。理由：触发需跨记录事件（capture 钩子）与定时两类来源，主进程是两者交汇点；renderer 无法感知后台汇总生命周期；DAO 保持纯数据访问不背编排。「检查→置位」原子性依赖"置位先于首个 await"的不变量，拷贝散落实现易写错，收敛为 class 原语由注释看护并供 future 后台任务复用（计时语义 lastAttemptAt 随原语白送）。定时器 10 分钟粒度足够（规则阈值为 5 条/24h），不引入 cron 依赖。
2. **[新增] 「距上次」基准 = lastAttemptAt ?? updatedAt，失败也推进基准**。理由：`summarizeNow` 开头即置 `lastAttemptAt = now`，失败同样推进——避免 AI 持续失败时每 10 分钟定时都重复打 LLM（失败一次后 24h 内自动重试仅由 pending>=5 规则驱动）；符合「失败无冷却」语义的字面（自动重试策略不新增，但上次尝试时间天然是判定基准）。备选「失败不推进基准」：会导致持续失败下定时器每 10 分钟重试一次 LLM，违背「无冷却/重试」的原意，排除。
3. **[新增] profiler 完全复用 summarizer 已验证模式（同一 Agent 构造、同一端点、`resolveKimiModel` 复用 import）**。理由：模型接入、超时（AbortSignal.timeout(60_000)）、structuredOutput 均已验证，重复发明引入漂移风险；新建独立文件 `profile/profiler.ts` 而非塞进 summarizer，保持「逐条摘要」与「画像汇总」两个 Agent 职责单一。
4. **[新增] schema 用 `.strict()` 全必需，失败视同汇总失败**。理由：proposal 边缘结论「缺/多槽位视同失败，旧画像保留」；strict 把「AI 发明新槽位」与「漏槽」统一收敛为解析抛错，失败路径零新增分支（catch 已有）。备选「宽松 schema + 应用层槽位比对」：多写比对代码且口径分裂，排除。
5. **[新增] 画像写入与打戳单事务（saveProfileWithStamp），不拆两步**。理由：proposal 明确要求「画像写入与打戳同一事务」；拆分会出现画像已更新但打戳失败 → 下轮重复喂入同批摘要（幂等但浪费 LLM 成本）或打戳成功画像失败 → 摘要永久出队但画像未更新（数据丢失）。事务内同事务是最小正确边界。
6. **[新增] profileDao 内自写私有 parseTags，不提取共享、不 import captureDao 私有实现**。理由：DAO 间不互相依赖的既有约束；tags 解析仅一行 JSON.parse + 兜底，小重复成本远低于跨 DAO 耦合成本。
7. **[新增] 待汇总队列 FIFO 按 `created_at ASC, record_id ASC` 双键排序**。理由：created_at 同为字符串 ISO 时按时间序；同刻（或时间戳精度冲突）时 record_id 递增兜底，保证批次顺序稳定可测。
8. **[新增] 记录删除不做联动**。理由：proposal 已对齐「接受延迟一致」；画像不引用 record id（内容为自由文本），天然无悬挂引用；联动删除需要画像文本级编辑能力，本期明确不做。
9. **[新增] 画像页状态栏 running 态来自 profile:get 的 `running: isRunning()`，不做推送**。理由：轮询模型（点击/挂载时拉取）与既有 console 数据获取模式一致；WebSocket/推送属过度设计。
10. **[新增] ProfiledBadge 单点导出（record-detail-dialog.tsx 内，仿 GradeBadge 先例）**。理由：徽标两处消费（表格行 + 弹窗元信息行），单点导出防双份漂移；「已入像」为固定语义灰 chip，不进 tagColorMap/动态色体系（与 GradeBadge 同决策）。
11. **[修复] App.tsx 三元链改 PAGES Record 映射（还腐化小债）**。理由：ConsolePage 每增一页三元链多一层嵌套，Record 强制键齐全使漏页编译期暴露；与画像页同 PR 顺手偿还，避免三元链再加一层。
12. **[沿用] IPC 四触点模式、preload ShiguangApi 接口 + contextBridge + env.d.ts 同步补齐**。理由：既有 IPC 扩展既定路径（shared 常量 + handler + registerIpc + preload）。
13. **[沿用] 零新增第三方依赖**：Mastra/Kimi/better-sqlite3 均为既有依赖；定时器用原生 setInterval。

### 3.6 风险 / 取舍

- [风险] **全量重写导致画像内容抖动（每轮表述不稳定）** → 缓解：prompt 明确「旧画像为参考输入、久未提及淘汰」；观察期接受短句级措辞变化，语义内容由 LLM 稳定性保证；若抖动不可接受属 prompt 调优（独立常量）。
- [风险] **AI 持续失败时 pending>=5 规则仍每来 5 条重试一次** → 接受：proposal 明确「不新增冷却/重试策略，记技术债务」；24h 规则已被 lastAttemptAt 推进保护（决策 2），最坏情况可控。
- [取舍] **汇总失败期间「已入像」徽标与画像内容短暂不一致**（已打戳但后续轮失败）→ 接受：打戳语义是「曾作为输入参与汇总」而非「出现在当前画像中」，proposal 语义一致。
- [风险] **单次喂入摘要无条数上限，积压多时 LLM 上下文膨胀** → 缓解：正常节奏下 24h/5 条触发使批次小；积压场景（如一周未开应用）可能一次喂入几十条，60s 超时兜底失败可重试；条数上限截断会违反 FIFO 语义，本期不做。
- [风险] **坏画像 JSON 落库后画像页空态误导** → 缓解：getProfile 读侧 parse 失败按 null 降级，页面表现为「从未汇总」+ 可手动重试，不抛错不白屏。
- [风险] **profileRunner 内存状态进程重启丢失** → 接受：running 丢失最坏情况为重启瞬间双跑（概率极低且幂等无害——同批打戳两次结果一致）；lastAttemptAt 丢失由 updatedAt 续算（决策 2）。
- [取舍] **定时器不手动 clearInterval** → 接受：跟随主进程生命周期，进程退出自然清理；Electron 主进程退出前无泄漏实质（单例 interval）。
- [风险] **renderer 组件测试对 profile:get 的 mock 面扩大** → 缓解：沿用既有 mock window.api 模式（@testing-library + jsdom）。

### 3.7 技术债务

- **汇总失败无冷却/重试策略**（新增条目，写入 `.rail/docs/ai/README.md` 债务节）：维持规则触发原样（pending>=5 / 24h / 首跑），AI 持续失败下由 pending>=5 自然重试；未来如需冷却/退避，应在 profileRunner 内增设 lastErrorAt + 退避窗口，并同步画像页失败态展示。
- **prompt 调优无重跑机制**（沿用 `.rail/docs/ai/README.md` 既有条目）：PROFILER_SYSTEM_PROMPT 修订后旧画像不自动升级；画像天然全量重写，下轮触发即生效（画像层无此债，但摘要层存量 profiled_at 已打戳的摘要不重进队列）。
- **profiled_at 打戳后摘要不再入队**（本期新引入的隐含约束）：若未来需要「画像重跑全量摘要」，需新增清除 profiled_at 的工具，单独立项。

### 3.8 影响文件清单

**packages/shared/**
- `src/index.ts`：`ProfileDocument`；`CaptureRecord.aiProfiledAt`；`IPC.profileGet/profileSummarize`；`ProfileStatusPayload`；`ProfileSummarizeResult`

**packages/ai/**
- `src/migrations/0007_profile.ts`（新建）：profiled_at 列 + profiles 单例表
- `src/db.ts`：migrations 数组登记 0007
- `src/dao/profileDao.ts`（新建）：setProfileDatabase / getProfile / saveProfileWithStamp / pendingSummaries / pendingCount
- `src/profile/profiler.ts`（新建）：PROFILER_SYSTEM_PROMPT、zod strict schema、`runProfileSummarization`
- `src/dao/captureDao.ts`：SELECT_RECORDS_JOIN / RecordRow / toRecord / createCapture RETURNING 带 ai_profiled_at
- 测试：`src/db.test.ts`（0007 up/down）、`src/dao/profileDao.test.ts`（新建）、`src/profile/profiler.test.ts`（新建）、`src/dao/captureDao.test.ts`（读侧断言）

**apps/desktop 主进程**
- `src/main/lib/singleFlight.ts`（新建）：通用单飞执行器 SingleFlightRunner
- `src/main/profile/profileRunner.ts`（新建）：触发判定/委托单飞/手动/定时器
- `src/main/ipc/profileHandlers.ts`（新建）+ `src/main/ipc/registerIpc.ts`：两通道装配
- `src/main/index.ts`：setProfileDatabase 注入 + app ready 启动钩子 + startProfileTimer
- `src/main/ipc/captureHandlers.ts`：captureCreate 成功后 fire-and-forget 钩子
- 测试：`src/main/lib/singleFlight.test.ts`（新建）、`src/main/profile/profileRunner.test.ts`（新建）、`src/main/ipc/profileHandlers.test.ts`（新建）

**apps/desktop renderer**
- `src/renderer/console/App.tsx`：PAGES Record 映射重构
- `src/renderer/console/components/SideNav.tsx`：ConsolePage + NAV_ITEMS 加「画像」
- `src/renderer/console/pages/ProfilePage.tsx`（新建）：画像页
- `src/renderer/console/pages/record-detail-dialog.tsx`：导出 `ProfiledBadge` + 元信息行渲染
- `src/renderer/console/pages/RecordRow.tsx`：摘要旁徽标
- `src/preload/index.ts` + `src/preload/env.d.ts`（或对应 env 声明文件）：`api.profile.get/summarize`
- 测试：`ProfilePage.test.tsx`（新建）、`RecordRow.test.tsx` / `record-detail-dialog.test.tsx` / `App`/`SideNav` 导航测试更新

**docs**
- `.rail/docs/ai/README.md`：债务节新增「汇总失败无冷却/重试策略」
- `docs/REQUIREMENTS.md`：AI 段迭代二状态更新（验收后勾选）

## 4. 回滚条件

- AI 画像质量不可接受（槽位内容空洞/编造/严重抖动且 prompt 调优无效）→ 产品重议画像口径；数据层（迁移 0007、profileDao）独立成立无害（新表新列，不动既有表结构语义），UI 回退为不渲染画像页入口/徽标即可，capture 链路与摘要层零影响。
- 自动触发规则在真实使用节奏下误触发频繁（如 24h 规则过松/过紧）→ 调 profileRunner 触发常量（5/24h/10min 均为独立常量），不动 DAO 与 profiler。
- 汇总失败率异常升高（schema strict 过严）→ 先调 prompt（独立常量）；产品若重议「缺槽容错」口径，仅需 schema 层调整，数据层不动。
- 画像页/徽标交互在真机走查出现不可接受问题 → 优先修 renderer 三组件（ProfilePage/RecordRow/record-detail-dialog），数据层与 AI 链路不回滚。
- 迁移 0007 down 失败（better-sqlite3 DROP COLUMN 依赖）→ DAO 迁移测试（AC-5）即时暴露；0006 已用同一 DDL 模式验证过，风险极低。
