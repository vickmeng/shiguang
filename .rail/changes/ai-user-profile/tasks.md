---
slug: ai-user-profile
derived_from: .rail/changes/ai-user-profile/design.md
---

# Tasks — ai-user-profile

> 排程说明：任务 1（shared 契约）最先落地，任务 3/5/6/7/10/11 消费其类型。`packages/ai` 内任务 2→3→4 同包串行（profileDao 依赖 0007 表结构），任务 5（captureDao 读侧）独立可并行。主进程任务 8→9→10→11 串行（runner → handlers → preload），任务 18（main/index.ts 接线）依赖 3/8，任务 19（capture 钩子）依赖 8。renderer 内任务 12（SideNav）→ 13（ProfilePage）→ 14（App 重构，PAGES 引用 ProfilePage 故排其后）→ 15→16→17（徽标链，record-detail-dialog 导出先行）。任务 20/21 收尾依赖全部实现任务。任务 1 落地后至消费方完成前 aiProfiledAt 字段不渲染属预期（可选字段不报错），以全量验证为准。

## 实现任务

### packages/shared（契约）

- [x] 任务 1：在 `packages/shared/src/index.ts` 新增画像契约五件套——①`export interface ProfileDocument { identity: string[]; recent: string[]; interests: string[]; values: string[]; goals: string[]; misc: string[] }`（JSDoc「AI 用户画像：固定 5+1 槽位；key 英文，中文展示文案由前端映射：身份概况/最近关注/兴趣爱好/在意的事/长期方向/其他」）；②`CaptureRecord` 接口 `aiGrade` 之后增 `aiProfiledAt?: string | null;`（JSDoc「曾纳入画像汇总的时间戳（analyses.profiled_at）；NULL/undefined = 未纳入」）；③IPC 常量对象增 `profileGet: 'profile:get'` 与 `profileSummarize: 'profile:summarize'`；④`export interface ProfileStatusPayload { document: ProfileDocument | null; updatedAt: string | null; pendingCount: number; running: boolean }`（JSDoc「profile:get 响应」）；⑤`export interface ProfileSummarizeResult { ok: boolean; error?: string }`（JSDoc「profile:summarize 响应」）。
  - **前置条件**：无
  - **对应验收标准**：AC-7

### packages/ai（迁移 + DAO + profiler）

- [x] 任务 2：新建 `packages/ai/src/migrations/0007_profile.ts`（沿用 0006 模板的 `MigrationContext` 结构化类型与 `export const migration` + default 导出形态）：`const UP_SQL` 为两段——`` `ALTER TABLE analyses ADD COLUMN profiled_at TEXT;` `` 与 `` `CREATE TABLE profiles (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL, updated_at TEXT NOT NULL);` ``；`const DOWN_SQL` 为两段——`` `DROP TABLE profiles;` `` 与 `` `ALTER TABLE analyses DROP COLUMN profiled_at;` ``（better-sqlite3 ^12.11.1 内置 SQLite ≥3.35 支持 DROP COLUMN，不重建表）；`up`/`down` 均 `db.exec(...)`；并在 `packages/ai/src/db.ts` 的 migrations 数组中 0006 之后登记（`import { migration as profileMigration } from './migrations/0007_profile'`）。
  - **前置条件**：无
  - **对应验收标准**：AC-5
  - 先写测试（TDD）：`packages/ai/src/db.test.ts` 增补——跑完迁移后 `PRAGMA table_info(analyses)` 含 profiled_at 列且 `notnull === 0`（可空、无默认值）；`SELECT sql FROM sqlite_master WHERE name = 'profiles'` 含 `CHECK (id = 1)`；0006 态旧库升级后现有 analyses 行不受影响；`migration.down()` 后 analyses 不再含 profiled_at 列、profiles 表消失。

- [x] 任务 3：新建 `packages/ai/src/dao/profileDao.ts` 实现数据库注入与画像读写——`import type { ProfileDocument } from '@shiguang/shared'`，`let db: Database | null = null` 模块级状态，`export function setProfileDatabase(database: Database): void`（注入）；未初始化抛错文案风格同 captureDao（如「profileDao: database not initialized」）；`export function getProfile(): { document: ProfileDocument; updatedAt: string } | null`——`SELECT document, updated_at FROM profiles WHERE id = 1`，无行返回 null，`JSON.parse(row.document)` 失败按 null 处理（坏数据降级不抛）；`export function saveProfileWithStamp(input: { document: ProfileDocument; stampedIds: number[] }): void`——单事务（`db.transaction`）：`` `INSERT INTO profiles (id, document, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET document = excluded.document, updated_at = excluded.updated_at` ``（document 为 `JSON.stringify(input.document)`，updated_at 为当前 ISO 字符串）+ 对 `input.stampedIds` 非空时批量 `` `UPDATE analyses SET profiled_at = ? WHERE record_id IN (${placeholders})` ``（参数 = [now, ...stampedIds]，now 与画像同一时刻）。
  - **前置条件**：`[1, 2]`
  - **对应验收标准**：AC-5、AC-6
  - 先写测试（TDD）：新建 `packages/ai/src/dao/profileDao.test.ts`（内存/临时目录真实 SQLite，跑完 0007 迁移后 `setProfileDatabase` 注入）——`getProfile` 在空表返回 null；`saveProfileWithStamp` 后 `getProfile` 读回 document 深相等与 updated_at；重复 save 为 UPSERT（只一行，document 被覆盖）；stampedIds 命中的 analyses 行 profiled_at 被置为画像同一时刻、未命中行保持 NULL；document 字段写入坏 JSON（手工 INSERT）时 `getProfile` 返回 null 不抛。

- [x] 任务 4：在 `packages/ai/src/dao/profileDao.ts` 实现待汇总队列——先 `export interface PendingSummary { recordId: number; summary: string; grade: string | null; tags: string[]; createdAt: string }`（JSDoc「本批喂入汇总的待汇总摘要，profileDao 导出共享，profiler 消费」）；文件内自写私有 `parseTags(raw: unknown): string[]`（JSON.parse 数组兜底空数组，不 import captureDao，DAO 间不互相依赖）；`export function pendingSummaries(): PendingSummary[]`——`` `SELECT analyses.record_id, analyses.summary, analyses.grade, records.tags, records.created_at FROM analyses JOIN records ON records.id = analyses.record_id WHERE analyses.profiled_at IS NULL ORDER BY records.created_at ASC, analyses.record_id ASC` ``（FIFO 双键），映射 tags 经私有 parseTags；`export function pendingCount(): number`——`` `SELECT COUNT(*) AS n FROM analyses WHERE profiled_at IS NULL` `` 返回 number。
  - **前置条件**：`[3]`
  - **对应验收标准**：AC-1、AC-8
  - 先写测试（TDD）：`profileDao.test.ts` 增补——造 3 条 analyses（2 条 profiled_at NULL、1 条已打戳）+ 对应 records（含 tags JSON 快照列），`pendingSummaries` 仅返回未打戳 2 条且按 created_at 升序（同刻时 record_id 升序），tags 解析为字符串数组、grade 原样透出；records.tags 为坏 JSON 时该条 tags 为 `[]` 不抛；`pendingCount` 为 2，全部打戳后为 0。

- [x] 任务 5：在 `packages/ai/src/dao/captureDao.ts` 实现读取侧 aiProfiledAt 透出：`RecordRow` 接口 `ai_grade` 之后增 `ai_profiled_at: string | null`（注释「LEFT JOIN analyses 得到的纳入画像汇总时间戳，NULL = 未纳入」）；`SELECT_RECORDS_JOIN` 的 SELECT 列表追加 `analyses.profiled_at AS ai_profiled_at`；`toRecord` 返回对象增 `aiProfiledAt: row.ai_profiled_at`；`createCapture` 的 RETURNING 追加 `NULL AS ai_profiled_at`，`createCaptureWithAttachments` 内 `toRecord({ ...row, image_path: null, ai_summary: null, ai_grade: null })` 调用点同步补 `ai_profiled_at: null`；文件头注释 JOIN 说明补 aiProfiledAt。
  - **前置条件**：`[1, 2]`
  - **对应验收标准**：AC-7、AC-9
  - 先写测试（TDD）：`captureDao.test.ts` 增补——手工将某 analyses 行 profiled_at 置非空后 `listCaptures`/`queryCaptures`/`getById` 读回 `aiProfiledAt` 为该值；profiled_at 为 NULL 的行读回 `null`；`createCapture` 纯文字直写返回 `aiProfiledAt === null`。

- [x] 任务 6：新建 `packages/ai/src/profile/profiler.ts` 的 Agent 构造、zod strict schema 与系统提示词——`import { Agent } from '@mastra/core/agent'`（沿用 summarizer 的 import 路径）、`import { z } from 'zod'`、`import type { ProfileDocument } from '@shiguang/shared'`、`import { resolveKimiModel } from '../analysis/summarizer'`；`const profileOutputSchema = z.object({ identity: z.array(z.string()), recent: z.array(z.string()), interests: z.array(z.string()), values: z.array(z.string()), goals: z.array(z.string()), misc: z.array(z.string()) }).strict()`（注释「strict：多余槽位即解析失败；6 槽位全必需，缺槽=失败」）；`export const PROFILER_SYSTEM_PROMPT`（模板字符串）逐条定义 5+1 槽位语义（identity=用户是谁：职业/角色/生活状态等稳定身份事实；recent=近期反复提及、正在关心的话题；interests=稳定的兴趣领域；values=价值观、看重/抵触的东西；goals=长期目标与方向；misc=不属于以上槽位但值得记住的事实）+ 全量重写指令（输出一份全新画像，旧画像与新摘要都只是参考输入；久未提及的、用户习惯已变化的内容要淘汰或改写）+ 条目约束（一句话以内、纯事实短句、不编造）+ 槽位约束（集合固定不允许发明新槽位，某槽位无内容输出空数组）+ 输出严格 JSON；`const profilerAgent = new Agent({ id: 'user-profiler', instructions: PROFILER_SYSTEM_PROMPT, model: () => ({ id: \`custom/${resolveKimiModel()}\`, url: 'https://api.kimi.com/coding/v1', apiKey: process.env.KIMI_API_KEY }) })`；文件头注释说明组件定位（画像汇总 Agent、复用 summarizer 模型接入模式）。
  - **前置条件**：`[1]`
  - **对应验收标准**：AC-3、AC-4
  - 先写测试（TDD）：新建 `packages/ai/src/profile/profiler.test.ts`（mock 方式参照 summarizer.test.ts）——断言 `PROFILER_SYSTEM_PROMPT` 含「全新画像」「淘汰或改写」「不允许发明新槽位」「空数组」「严格 JSON」及 6 个槽位名；schema 层断言 `profileOutputSchema.parse` 对缺 `misc` 槽位对象与多 `extra` 槽位对象均抛错、对 6 槽位全空数组对象通过。

- [x] 任务 7：在 `packages/ai/src/profile/profiler.ts` 实现 `export async function runProfileSummarization(input: { previous: ProfileDocument | null; batch: PendingSummary[] }): Promise<ProfileDocument>`——未配置 `process.env.KIMI_API_KEY` 时抛配置指引错误（文案风格同 summarizer，含「请设置 KIMI_API_KEY 环境变量」语义）；user content 拼装为两段：旧画像 `JSON.stringify(input.previous)`（null 时注明「尚无画像」）+ 本批摘要编号列表，每条格式为 `` `#${s.recordId} [${s.createdAt}] (grade: ${s.grade ?? 'none'}) 标签：${s.tags.join('、')}\n${s.summary}` ``；调用 `profilerAgent.generate(userContent, { structuredOutput: { schema: profileOutputSchema }, abortSignal: AbortSignal.timeout(60_000) })`（参数形态以 summarizer 既有调用为准）；返回解析结果直接作为 `ProfileDocument`（schema 校验失败自然抛错，不 catch）。
  - **前置条件**：`[6]`
  - **对应验收标准**：AC-1、AC-3、AC-4
  - 先写测试（TDD）：`profiler.test.ts` 增补（vi.mock Agent 的 generate，参照 summarizer.test.ts mock 方式）——mock generate 返回 6 槽位全空数组对象时 resolve 为 `ProfileDocument`；mock generate 返回缺槽对象时 reject（schema 校验失败）；断言 generate 入参 user 含旧画像 JSON 与 `#1 [` 编号格式，previous 为 null 时含「尚无画像」；`KIMI_API_KEY` 未配置时 reject 且 error 含配置指引文案；断言传入 abortSignal 超时为 60_000（或断言调用了 AbortSignal.timeout）。

### apps/desktop 主进程

- [x] 任务 8：新建 `apps/desktop/src/main/lib/singleFlight.ts` 通用单飞执行器，并以其为竞争态唯一防线落地 profileRunner 的触发判定——singleFlight.ts：`export class SingleFlightRunner`——私有 `running: boolean` 与 `lastAttemptAt: number | null`（注释「上次尝试开始的 epoch ms（含失败）；进程重启即失」）；`isRunning()`、`getLastAttemptAt()`；`async run<R>(fn: () => Promise<R>, opts: { onBusy: () => R; onError: (e: Error) => R }): Promise<R>`（注释「竞争态处理收敛在本方法：running 置位先于任何 await（JS 单线程同步段保证检查→置位原子），调用方永远不经手 running 标志」；running 时返回 `opts.onBusy()`，否则同步置 `running = true`、`lastAttemptAt = Date.now()`，`try { return await fn() } catch (e) { return opts.onError(e as Error) } finally { this.running = false }`）。`apps/desktop/src/main/profile/profileRunner.ts`：模块级 `const summarizeJob = new SingleFlightRunner()`（本文件不留 running 标志与 lastAttemptAt 变量）；`export function isRunning(): boolean` → `summarizeJob.isRunning()`；`export function maybeSummarize(): void`——整体 try/catch（catch console.error 防 unhandled rejection）；内层：`if (summarizeJob.isRunning()) return`（快速短路，真正防线在 summarizeJob.run 内）；读 `pendingCount()`；「距上次」基准 = `summarizeJob.getLastAttemptAt() ?? (getProfile()?.updatedAt 转 epoch) ?? null`；触发条件：`pending >= 5`，或（基准非 null 且 `now - 基准 >= 24 * 60 * 60 * 1000` 且 `pending >= 1`），或（基准为 null 且 `pending >= 1`，即从未汇总过）；满足则 fire-and-forget `void summarizeNow().catch(console.error)`，不满足 return。
  - **前置条件**：`[3, 4]`
  - **对应验收标准**：AC-1、AC-3
  - 先写测试（TDD）：新建 `apps/desktop/src/main/lib/singleFlight.test.ts`——`run` 执行期第二次 `run` 走 onBusy 且 fn 未再执行（用可控 promise 使 fn 悬挂以模拟执行期）；fn resolve 返回其结果；fn reject 走 onError 且其结果被返回；finally 复位（reject 后第三次 run 可再进 fn）；`lastAttemptAt` 在调用时推进（失败也推进）。新建 `apps/desktop/src/main/profile/profileRunner.test.ts`（vi.mock profileDao 与 profiler 模块）——pending=5 时触发一次 generate+save；pending=1 且距上次（mock updatedAt）≥24h 时触发；pending=1 且距上次 <24h 时不触发；profiles 无行（mock getProfile 返 null）且 pending=1 时触发；running 中（通过先悬挂的 summarizeNow 制造）再调 maybeSummarize 不触发第二次（单飞）；触发失败时 console.error 留痕且不抛。
  - 说明：本任务的 doSummarize 指向任务 9 的 `summarizeNow`，测试可先写并在任务 9 落地后转绿，或与任务 9 合并提交。

- [x] 任务 9：在 `apps/desktop/src/main/profile/profileRunner.ts` 实现 `export async function summarizeNow(): Promise<ProfileSummarizeResult>` 与 `export function startProfileTimer(): void`——`summarizeNow` 完全委托竞争态：`return summarizeJob.run(doSummarize, { onBusy: () => ({ ok: true }), onError: (e) => { console.error('[profile] 汇总失败：', e); return { ok: false, error: (e as Error).message }; } })`（onBusy 为幂等 no-op，注释「前端按钮已禁用双保险」）；`doSummarize` 为模块内私有 async：`` const batch = pendingSummaries() ``，`const previous = getProfile()?.document ?? null`，`const document = await runProfileSummarization({ previous, batch })`，`saveProfileWithStamp({ document, stampedIds: batch.map((s) => s.recordId) })`，`return { ok: true }`；`startProfileTimer`：`setInterval(() => { try { maybeSummarize() } catch (e) { console.error(e) } }, 10 * 60 * 1000)`（注释「不手动 clearInterval，跟随主进程生命周期」）。
  - **前置条件**：`[7, 8]`
  - **对应验收标准**：AC-2、AC-6
  - 先写测试（TDD）：`profileRunner.test.ts` 增补——正常路径 mock profiler resolve 后断言 saveProfileWithStamp 入参 document 与全批 stampedIds、返回 `{ ok: true }`；mock profiler reject 时返回 `{ ok: false, error: 消息 }` 且 saveProfileWithStamp 未被调、running 复位（后续 maybeSummarize 可再触发）；running 期间（先悬挂一个 summarizeNow）调 `summarizeNow` 直接返回 `{ ok: true }` 且 profiler 未被调；成功后 lastAttemptAt 推进（pending=1 且 <24h 不再触发）；断言 `setInterval` 以 600_000ms 注册。
  - 说明：任务 8 的触发用例在本任务落地后转绿。

- [x] 任务 10：新建 `apps/desktop/src/main/ipc/profileHandlers.ts`（仿 tagsHandlers 模式）并装配 registerIpc——profileHandlers.ts：`import { ipcMain } from 'electron'`、`import { IPC, type ProfileStatusPayload } from '@shiguang/shared'`、`import { getProfile, pendingCount } from '@shiguang/ai'`、`import { isRunning, summarizeNow } from '../profile/profileRunner'`；`export function registerProfileHandlers(): void`：`ipcMain.handle(IPC.profileGet, () => { const row = getProfile(); return { document: row?.document ?? null, updatedAt: row?.updatedAt ?? null, pendingCount: pendingCount(), running: isRunning() } satisfies ProfileStatusPayload })`；`ipcMain.handle(IPC.profileSummarize, () => summarizeNow())`；`apps/desktop/src/main/ipc/registerIpc.ts` 在既有注册列表中调 `registerProfileHandlers()`（import 补齐）。
  - **前置条件**：`[9]`
  - **对应验收标准**：AC-2、AC-7
  - 先写测试（TDD）：新建 `apps/desktop/src/main/ipc/profileHandlers.test.ts`（vi.mock electron ipcMain.handle 捕获回调、mock profileDao 与 profileRunner）——调 register 后 profileGet 回调返回的载荷四字段（document/updatedAt/pendingCount/running）与 mock 一致、无画像行时 document/updatedAt 为 null；profileSummarize 回调返回 summarizeNow 的 resolve 值。

- [x] 任务 11：补齐 preload 四触点——`apps/desktop/src/preload/index.ts`：`api` 对象增 `profile: { get: () => ipcRenderer.invoke(IPC.profileGet), summarize: () => ipcRenderer.invoke(IPC.profileSummarize) }`，并在 ShiguangApi 接口（同文件或类型声明处）增 `profile: { get(): Promise<ProfileStatusPayload>; summarize(): Promise<ProfileSummarizeResult> }`（`import type { ProfileStatusPayload, ProfileSummarizeResult } from '@shiguang/shared'`）；`contextBridge.exposeInMainWorld` 透传对象同步增 profile 键；`apps/desktop/src/preload/env.d.ts`（或既有 window.api 全局声明文件）的接口声明同步增 profile 两个方法。
  - **前置条件**：`[1, 10]`
  - **对应验收标准**：AC-7
  - 验证方式：`pnpm typecheck` 通过即四触点类型对齐（IPC 常量、handler、registerIpc、preload+env.d.ts）；preload 单测如存在则补 api.profile.get/summarize 的 invoke 通道断言（invoke 参数为 `IPC.profileGet`/`IPC.profileSummarize` 字符串值 `'profile:get'`/`'profile:summarize'`）。

### apps/desktop renderer

- [x] 任务 12：改 `apps/desktop/src/renderer/console/components/SideNav.tsx` 扩展画像导航——`export type ConsolePage = 'records' | 'tags' | 'settings'` 改为 `export type ConsolePage = 'records' | 'tags' | 'profile' | 'settings'`；`NAV_ITEMS` 数组在 tags 与 settings 之间插入 `{ key: 'profile', label: '画像' }`。
  - **前置条件**：`[1]`
  - **对应验收标准**：AC-8
  - 先写测试（TDD）：SideNav 测试（或新建）断言渲染「画像」项、点击触发 onNavigate('profile')；ConsolePage 类型含 'profile'（编译期）。

- [x] 任务 13：新建 `apps/desktop/src/renderer/console/pages/ProfilePage.tsx` 画像页——`export function ProfilePage(): JSX.Element`；state：`status: ProfileStatusPayload | null`、`busy: boolean`；挂载 `React.useEffect` 调 `window.api.profile.get()` 写 status；槽位中文映射常量（顺序固定）：`const SLOT_LABELS: Array<{ key: keyof ProfileDocument; label: string }> = [{ key: 'identity', label: '身份概况' }, { key: 'recent', label: '最近关注' }, { key: 'interests', label: '兴趣爱好' }, { key: 'values', label: '在意的事' }, { key: 'goals', label: '长期方向' }, { key: 'misc', label: '其他' }]`；状态栏：上次汇总时间（`status.updatedAt ? new Date(status.updatedAt).toLocaleString() : '从未汇总'`）+ 待汇总 `status.pendingCount` 条 + running 或 busy 时显示「汇总中…」并禁用按钮；「立即汇总」按钮 click：置 busy=true → `await window.api.profile.summarize()` → 返回后重新 `get()` 刷新 → busy=false；result.ok 为 false 时用既有 toast 展示 `result.error`；内容区：`status.document` 为 null → 空态（引导文案「汇总 5 条以上记录摘要后自动生成画像」语义 + 「立即汇总」主按钮）；非 null → 按 SLOT_LABELS 顺序渲染分区（分区标题 + 条目 `<ul>/<li>` 列表），**条目数组为空的分区不渲染**；整页只读，无任何编辑入口。
  - **前置条件**：`[11, 12]`
  - **对应验收标准**：AC-2、AC-8
  - 先写测试（TDD）：新建 `ProfilePage.test.tsx`（jsdom，mock window.api）——挂载即调 profile.get；updatedAt 为 null 显示「从未汇总」与空态引导；document 六槽位非空内容按 身份概况/最近关注/兴趣爱好/在意的事/长期方向/其他 顺序渲染；空槽位分区不渲染；点「立即汇总」后按钮禁用（busy）且调 profile.summarize，成功后重新 get 并渲染新内容；summarize 返回 `{ ok: false, error: 'x' }` 时 toast 展示 'x'；running=true 时按钮禁用并显示「汇总中…」。

- [x] 任务 14：重构 `apps/desktop/src/renderer/console/App.tsx` 页面分发——删 `page === 'records' ? ... : page === 'tags' ? ... : ...` 三元链，改为模块级 `const PAGES: Record<ConsolePage, React.ComponentType> = { records: RecordsPage, tags: TagsPage, profile: ProfilePage, settings: SettingsPage };` 与渲染处 `const Page = PAGES[page]; return <Page />`（`<Page />` 前保留既有布局包裹）；import 增 `ProfilePage`；文件头注释补 PAGES 映射说明。
  - **前置条件**：`[13]`
  - **对应验收标准**：AC-8
  - 先写测试（TDD）：App 导航测试增补/更新——onNavigate 切到 'profile' 后 ProfilePage 内容渲染；Record 强制键齐全为编译期保证（漏页 typecheck 失败）；records/tags/settings 导航既有用例不回退。

- [x] 任务 15：在 `apps/desktop/src/renderer/console/pages/record-detail-dialog.tsx` 导出 `ProfiledBadge`——`export function ProfiledBadge(): JSX.Element`（JSDoc「已入像徽标：analyses.profiled_at 非空即已纳入画像汇总；纯展示 Tailwind 常量，不进 tagColorMap」），渲染 `` <span className="rounded-full border border-neutral-200 px-2 py-0.5 text-xs text-neutral-400">已入像</span> ``（描边灰小 chip，仿 GradeBadge 单点导出先例）；文件头注释补徽标导出说明。
  - **前置条件**：`[1]`
  - **对应验收标准**：AC-9
  - 先写测试（TDD）：`record-detail-dialog.test.tsx` 增补——`ProfiledBadge` 渲染 textContent 为「已入像」、类名含 `border-neutral-200` 与 `text-neutral-400`。

- [x] 任务 16：改 `apps/desktop/src/renderer/console/pages/RecordRow.tsx` 摘要 td 渲染「已入像」徽标——`import { ProfiledBadge } from './record-detail-dialog'`；摘要 td 内 aiSummary 非空且 `record.aiProfiledAt` 非空时，在摘要文本元素后渲染 `<ProfiledBadge />`（与摘要同行，间距类如 `ml-2`）；aiSummary 为 null 的占位「—」分支不渲染徽标；其余列与交互零改动。
  - **前置条件**：`[15]`
  - **对应验收标准**：AC-9
  - 先写测试（TDD）：`RecordRow.test.tsx` 增补——fixture 增 `aiProfiledAt` 可选参数（缺省 null）；aiSummary 非空且 aiProfiledAt 非空时渲染「已入像」；aiProfiledAt 为 null 或 aiSummary 为 null 时均不渲染；既有用例全数不回退。

- [x] 任务 17：改 `apps/desktop/src/renderer/console/pages/record-detail-dialog.tsx` 元信息行渲染「已入像」徽标——在详情弹窗元信息行（record-detail-header 内，时间/级别/标签 chips 同一行容器）尾部、`record.aiSummary` 非空且 `record.aiProfiledAt` 非空时渲染 `<ProfiledBadge />`；`ProfiledBadge` 为本文件内已导出的同组件，直接 JSX 使用。
  - **前置条件**：`[15]`
  - **对应验收标准**：AC-9
  - 先写测试（TDD）：`record-detail-dialog.test.tsx` 增补——record 带 aiSummary 与 aiProfiledAt 时元信息行含「已入像」；二者缺一不渲染；既有弹窗用例不回退。

### apps/desktop 主进程（接线）

- [x] 任务 18：改 `apps/desktop/src/main/index.ts` 完成 profile 接线——在既有 `setCaptureDatabase(db)`（及同类注入）旁加一行 `setProfileDatabase(db)`（`import { setProfileDatabase } from '@shiguang/ai'`，注入同一 db 连接）；app ready 既有逻辑内、数据库初始化之后调一次 `maybeSummarize()`（`import { maybeSummarize, startProfileTimer } from './profile/profileRunner'`）+ `startProfileTimer()`；文件头注释补画像汇总后台编排说明。
  - **前置条件**：`[3, 9]`
  - **对应验收标准**：AC-1
  - 先写测试（TDD）：main/index 测试如存在则补断言（app ready 后 maybeSummarize 被调一次、setProfileDatabase 被注入同一 db、startProfileTimer 注册 interval）；无既有测试则以 `pnpm typecheck` + 任务 8/9 单测覆盖为准，并在本任务说明中记录该取舍。

- [x] 任务 19：改 `apps/desktop/src/main/ipc/captureHandlers.ts` 的 capture:create handler 加画像触发钩子——在 `return createCaptureWithAttachments(...)` 成功 return 之后（不进 try/catch），fire-and-forget `void maybeSummarize()`（`import { maybeSummarize } from '../profile/profileRunner'`），并以 `.catch((e) => console.error(e))` 收尾防 unhandled rejection；文件头注释补「capture 成功后触发画像汇总判定（fire-and-forget，失败绝不影响 capture 响应）」。
  - **前置条件**：`[8]`
  - **对应验收标准**：AC-1、AC-6
  - 先写测试（TDD）：`captureHandlers.test.ts` 增补——createCaptureWithAttachments resolve 后 maybeSummarize 被调一次；maybeSummarize reject 时 capture 响应仍正常 resolve（汇总失败不影响 capture）；createCaptureWithAttachments reject 时 maybeSummarize 未被调（不越过既有失败路径）；既有编排用例全数不回退。

### 收尾

- [x] 任务 20：在 `.rail/docs/ai/README.md` 债务节新增条目「汇总失败无冷却/重试策略」——内容为：画像汇总维持规则触发原样（待汇总 ≥5 条 / 距上次尝试 ≥24h 且有积压 / 首次首跑），AI 持续失败下无冷却与退避，仅由 pending>=5 规则自然重试；「距上次」基准 lastAttemptAt ?? profiles.updated_at，失败同样推进（24h 规则不造成反复重试）；未来如需冷却/退避，应在 profileRunner 增设 lastErrorAt + 退避窗口并同步画像页失败态展示。
  - **前置条件**：`[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]`
  - **对应验收标准**：AC-11

- [x] 任务 21：更新 `docs/REQUIREMENTS.md` AI 段迭代二（MEM-02 画像生成 / MEM-03 画像页 + 记录页联动）行状态——登记本次立项与交付内容（迁移 0007、profile:get/profile:summarize 两条 IPC、画像页、已入像徽标、全量重写口径、失败语义），验收标准 AC-1～AC-9 真机走查通过后勾选对应完成态。
  - **前置条件**：`[20]`
  - **对应验收标准**：AC-11
  - 人工走查待办（不由任务勾选覆盖，走查后勾选）：真机配置 KIMI_API_KEY 录 5+ 条记录 → 自动汇总触发 → 画像页出现 6 槽位内容且状态栏显示上次汇总时间；记录页表格行与详情弹窗见「已入像」徽标；断网/错误 key 下汇总失败 → 记录正常入库、画像页失败 toast、再触发可重试；制造一个久不关注话题，多轮后从「最近关注」消失（全量重写生效）。
