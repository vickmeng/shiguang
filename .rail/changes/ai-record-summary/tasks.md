---
slug: ai-record-summary
derived_from: .rail/changes/ai-record-summary/design.md
---

# Tasks — ai-record-summary

> 排程说明：三组可无依赖同发——**数据层组**（任务 1→2→3，串行）、**分析模块组**（任务 5→6，串行；任务 5 含依赖安装可与 1 同发）、**shared 契约**（任务 4 最优先落地，任务 2/7/10/11 消费其新契约）。主进程编排（任务 7）依赖 2+4+6；copy-image 切换（任务 8）依赖 3；任务 9（main 注入）依赖 5；输入框 UI（任务 10）依赖 4+7；记录页（任务 11）依赖 3+4；任务 12（README/REQUIREMENTS）随时可发；任务 13 收尾依赖全部实现任务。注意：任务 4 落地后至消费方完成前不渲染/不区分属预期（可选字段不报错），以任务 13 全绿为准。

## 实现任务

### packages/ai（迁移 + DAO）

- [x] 任务 1：新建 `packages/ai/src/migrations/0005_analyses.ts`（沿用 0004_tags 的 `MigrationContext` 结构化类型与 `export const migration` + default 导出形态）：`const UP_SQL` 为 `CREATE TABLE analyses (record_id INTEGER PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE, summary TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));`；`const DOWN_SQL` 为 `DROP TABLE IF EXISTS analyses;`；`up`/`down` 均 `db.exec(...)`；并在 `packages/ai/src/db.ts` 的 migrations 数组中 `tagsMigration` 之后登记（`import { migration as analysesMigration } from './migrations/0005_analyses'`）。
  - **前置条件**：无
  - **对应验收标准**：AC-7
  - 先写测试（TDD）：`packages/ai/src/db.test.ts` 断言——跑完 0005 后 `PRAGMA table_info(analyses)` 含 record_id/summary/model/created_at 四列（summary、model 为 NOT NULL）；`PRAGMA foreign_key_list(analyses)` 含指向 records(id) 的 CASCADE 外键；旧库（0004 态已有记录行）升级后现有记录不受影响；`migration.down()` 后 analyses 表消失。

- [x] 任务 2：扩展 `packages/ai/src/dao/captureDao.ts` 的 `createCaptureWithAttachments`：input 类型增可选 `analysis?: { summary: string; model: string }`（JSDoc「缺省 = 不写 analyses 行」）；`database.transaction` 内 attachments 循环之后、`return` 之前追加 `if (input.analysis) { database.prepare('INSERT INTO analyses (record_id, summary, model) VALUES (?, ?, ?)').run(row.id, input.analysis.summary, input.analysis.model); }`；`createCapture` 纯文字直写**不加** analysis 参数（骨架铁律 6）。
  - **前置条件**：`[1]`
  - **对应验收标准**：AC-1
  - 先写测试（TDD）：`captureDao.test.ts` 增补——传 `analysis: { summary: '一句话', model: 'kimi-k2.6' }` 后查询读回 `aiSummary === '一句话'`；analysis 缺省时不写 analyses 行（`SELECT COUNT(*) FROM analyses` 为 0）且记录正常返回；三表同事务（附件插入异常时 analyses 不残留，经异常路径断言回滚）；删记录后 analyses 行随 FK 级联消失（AC-6）。

- [x] 任务 3：在 `packages/ai/src/dao/captureDao.ts` 实现读取侧：`RecordRow` 增 `ai_summary: string | null`；抽取共享 SELECT 模板常量（`records.*, attachments.file_path AS image_path, analyses.summary AS ai_summary` + `LEFT JOIN attachments` + `LEFT JOIN analyses`），`listCaptures` 与 `queryCaptures` 的 items SELECT 统一改用（total COUNT 保持 `FROM records` 不加 JOIN）；`toRecord` 返回对象增 `aiSummary: row.ai_summary`；新增导出 `getById(id: number): CaptureRecord | null`——共享模板 + `WHERE records.id = ?` 取行，`toRecords(rows)[0] ?? null`；文件头注释更新。
  - **前置条件**：`[1]`
  - **对应验收标准**：AC-1、AC-5
  - 先写测试（TDD）：`captureDao.test.ts` 增补——带 analysis 记录 listCaptures/queryCaptures 读回 aiSummary；无摘要记录读回 `null`；多附件记录的 aiSummary 在多个 JOIN 行下聚合正确（恰一行值，1:1 无行膨胀断言）；`getById` 命中返回完整记录（含 imagePaths 有序）、未命中返回 `null`；queryCaptures total 既有断言不回退。

### packages/shared

- [x] 任务 4：在 `packages/shared/src/index.ts` 的 `CaptureRecord` 接口 `tags: string[]` 之后增可选字段 `aiSummary?: string | null;`（JSDoc「AI 一句话摘要（analyses.summary）；无摘要的存量记录为 null/undefined」）；文件尾部新增 `export const AI_NOT_MEANINGFUL_MESSAGE = '内容未拾光：AI 判定无有效信息';`（JSDoc「capture:create 无意义判定时主进程抛出的固定错误文案；渲染层据此区分 toast 文案」）。
  - **前置条件**：无
  - **对应验收标准**：AC-5
  - 本任务落地后 RecordRow/capture-form 消费在其各自任务接线前不渲染/不区分，属预期；可选字段不破坏旧 fixture 编译（AC-5）。

### packages/ai（分析模块）

- [x] 任务 5：新建 `packages/ai/src/analysis/summarizer.ts` 的基础设施与 `analyzeCapture` 编排，并安装依赖：`packages/ai/package.json` dependencies 增 `@mastra/core`、`@ai-sdk/openai`、`zod`（pnpm install）；模块级 `let imagesBaseDir: string | null = null` + `export function setAnalysisImagesBaseDir(dir: string): void`（未注入时 analyzeCapture 抛 `Error('analysis images base dir not initialized: call setAnalysisImagesBaseDir first')`）；`export const DEFAULT_KIMI_MODEL = 'kimi-k2.6';` 与 `export function resolveKimiModel(): string { return process.env.KIMI_MODEL ?? DEFAULT_KIMI_MODEL; }`；`export async function analyzeCapture(input: { text: string; images: Array<{ filePath: string }> }): Promise<{ meaningful: boolean; summary?: string }>`——开头校验 `process.env.KIMI_API_KEY`，缺失抛 `Error('未配置 KIMI_API_KEY：请在仓库根 .env 中配置后重启应用（参考 .env.example）')`；逐张 `fs.readFile(path.join(imagesBaseDir!, f.filePath))` 转 `data:image/png;base64,...` data URL（读盘失败原样抛）；构造 Agent 并 `agent.generate([{ role: 'system', content: SUMMARIZER_SYSTEM_PROMPT }, { role: 'user', content: [text part（仅 text 非空时）+ ...image_url parts] }], { abortSignal: AbortSignal.timeout(60_000) })`；返回前校验 `result.object.meaningful === true` 时 `summary.trim()` 非空否则抛 `Error('AI 返回空摘要')`，`meaningful === false` 时返回 `{ meaningful: false }`。
  - **前置条件**：无
  - **对应验收标准**：AC-3、AC-4
  - 先写测试（TDD）：新建 `packages/ai/src/analysis/summarizer.test.ts`——`vi.mock('@ai-sdk/openai')` 与 `vi.mock('@mastra/core/agent')`（vi.hoisted stub agent.generate）：解析成功路径返回 `{ meaningful: true, summary }`；meaningful=false 返回无 summary；断言 generate 收到的 options 携带 `abortSignal: AbortSignal.timeout(60_000)` 形态的 signal（mock 捕获断言 timeout 60_000）；mkdtemp 写 png 文件注入 baseDir 后断言模型层收到的 image_url 为 `data:image/png;base64,` 前缀且与文件内容一致（text 为空串时不带 text part——纯图路径）；`process.env.KIMI_API_KEY` 缺失时抛配置指引文案；meaningful=true + summary `'  '` 抛「AI 返回空摘要」。

- [x] 任务 6：在 `packages/ai/src/analysis/summarizer.ts` 落定 Agent 构造与 prompt 常量：`SUMMARIZER_SYSTEM_PROMPT` 逐字采用 design 3.2 草案（角色=拾光内容理解助手；meaningful=false 三类标准：手误乱敲 / 纯符号占位 / 空泛无信息；meaningful=true 两类标准：含具体信息量文字 / 纯图含可理解内容；摘要要求 ≤60 字、覆盖文字与图片整体含义、图文互补合并表述、禁止整句复述与元描述、不编造；输出 JSON 格式说明）；模块级 `const kimi = createOpenAI({ baseURL: 'https://api.moonshot.cn/v1', apiKey: process.env.KIMI_API_KEY })` 与 `const agent = new Agent({ name: 'capture-summarizer', instructions: SUMMARIZER_SYSTEM_PROMPT, model: kimi(resolveKimiModel()), outputSchema: z.object({ meaningful: z.boolean(), summary: z.string().optional() }) })`；并在 `packages/ai/src/index.ts` 导出 `analyzeCapture` / `resolveKimiModel` / `setAnalysisImagesBaseDir` / `getById`，改写文件头注释（「LangGraph」表述改为「Mastra 分析模块」）。
  - **前置条件**：`[5]`
  - **对应验收标准**：AC-1、AC-2、AC-9
  - 先写测试（TDD）：`summarizer.test.ts` 增补——断言 Agent 构造入参 name/instructions（SUMMARIZER_SYSTEM_PROMPT 含「手误」「纯符号」「60 字」「图片不是附件而是内容的一部分」等关键条款）与 outputSchema 的 zod 解析行为（`{ meaningful: true }` 无 summary 通过、`summary: 123` 拒绝）；`KIMI_MODEL` 环境变量覆盖时 resolveKimiModel 返回覆盖值、缺省返回 `kimi-k2.6`；全仓 `grep -rn "LangChain\|LangGraph\|langchain\|langgraph" apps/desktop/src packages` 零代码残留引用。

### apps/desktop 主进程

- [x] 任务 7：改造 `apps/desktop/src/main/ipc/captureHandlers.ts` 的 `capture:create` 编排：`ipcMain.handle` 回调体改为——`const written = await writeImageFiles(payload.images.map((img) => img.data));` 后包 `try { ... } catch (err) { for (const w of written) { await fs.rm(path.join(app.getPath('userData'), w.filePath), { force: true }).catch(() => {}); } throw err; }`；try 内依次 `const analysis = await analyzeCapture({ text: payload.text, images: written.map((w) => ({ filePath: w.filePath })) });`（import 自 `@shiguang/ai`）、`if (!analysis.meaningful || !analysis.summary?.trim()) throw new Error(AI_NOT_MEANINGFUL_MESSAGE);`（`AI_NOT_MEANINGFUL_MESSAGE` import 自 `@shiguang/shared`）、`return createCaptureWithAttachments({ text: payload.text, document: payload.document != null ? rewriteImageSrcs(payload.document, written.map((w) => w.filePath)) : null, sourceApp: null, attachments: written, tags: payload.tags, analysis: { summary: analysis.summary, model: resolveKimiModel() } });`（`resolveKimiModel` 一并 import）；文件头注释更新（新编排顺序与清理语义）。
  - **前置条件**：`[2, 4, 6]`
  - **对应验收标准**：AC-1、AC-2、AC-3
  - 先写测试（TDD）：`captureHandlers.test.ts` 增补（vi.mock electron + vi.mock('@shiguang/ai')）——断言编排顺序 writeImageFiles → analyzeCapture → createCaptureWithAttachments（mock 调用序）；DAO 入参携带 `analysis: { summary, model }`；meaningful=false 时 invoke reject 且错误 message 为 `AI_NOT_MEANINGFUL_MESSAGE`、written 图片被逐个 `fs.rm`；analyzeCapture 抛错（模拟断网/超时）时同样清理图片后 reject、`createCaptureWithAttachments` 未被调用；成功路径不触发清理。

- [x] 任务 8：在 `apps/desktop/src/main/ipc/captureHandlers.ts` 把 `capture:copy-image` 由「`queryCaptures({ page: 1, pageSize: Number.MAX_SAFE_INTEGER })` 后 `.find((r) => r.id === payload.id)`」改为 `const rec = getById(payload.id);`（import 增 `getById`；`queryCaptures` 若因此无其他引用则同步移除其 import 与解构）；`!rec || rec.imagePaths.length === 0` 抛 `Error('该记录不是图片')` 等既有后续逻辑零改动；文件头注释更新（copy-image 走 getById，偿还 `.rail/docs/records-console/README.md` 技术债务第 3 条）。
  - **前置条件**：`[3]`
  - **对应验收标准**：AC-9（回归）
  - 先写测试（TDD）：`captureHandlers.test.ts` 增补——mock `@shiguang/ai` 的 `getById` 返回含图记录时 handler 走 nativeImage/clipboard 路径；返回 `null` 时 reject「该记录不是图片」；断言 copy-image 未再调用 `queryCaptures`。

- [x] 任务 9：在 `apps/desktop/src/main/index.ts` 启动初始化处（`setCaptureDatabase(initDatabase(dbPath))` 同点附近）追加 `setAnalysisImagesBaseDir(path.join(app.getPath('userData')));`（import 增 `setAnalysisImagesBaseDir` 自 `@shiguang/ai` 与 `node:path`），注释说明 analyzeCapture 依赖相对 filePath 的 base 目录。
  - **前置条件**：`[5]`
  - **对应验收标准**：AC-1（走查）
  - 先写测试（TDD）：main 入口无单测，以 `pnpm typecheck` + 任务 13 真机走查（capture:create 全链路）兜底；`setAnalysisImagesBaseDir` 注入行为已由 summarizer 单测覆盖。

### apps/desktop renderer

- [x] 任务 10：改 `apps/desktop/src/renderer/input/features/capture/capture-form.tsx` 失败分支与输入入口 Toaster：catch 分支在 `setStatus('error')` 后同步追加 `toast(err instanceof Error && err.message === AI_NOT_MEANINGFUL_MESSAGE ? AI_NOT_MEANINGFUL_MESSAGE : '提交失败，请重试');`（import `toast` 自 `../../../components/ui/toast`、`AI_NOT_MEANINGFUL_MESSAGE` 自 `@shiguang/shared`）；成功路径不加 toast；`apps/desktop/src/renderer/input/App.tsx` 根部补挂 `<Toaster />`（import 自 `../components/ui/toast`）；capture-form 文件头注释更新（loading 终点 = 入库 + 分析完成；失败 toast 两分支文案）。
  - **前置条件**：`[4, 7]`
  - **对应验收标准**：AC-2、AC-3
  - 先写测试（TDD）：`capture-form.test.tsx` 增补——mock `window.api.capture.create` 延迟 resolve：提交后按钮文案「拾光中…」且 disabled，resolve 后闪现「✓ 已拾光」；reject 且 `err.message === AI_NOT_MEANINGFUL_MESSAGE` 时按钮闪现「提交失败」且 toast 推送固定文案；reject 其他错误时 toast 为「提交失败，请重试」；成功路径无 toast。`App.test.tsx` 增补断言渲染含 Toaster 容器。

- [x] 任务 11：改 `apps/desktop/src/renderer/console/pages/RecordRow.tsx`：在 `<RichCapturePreview ... />` 之后、时间戳 `<p className="mt-1 text-xs text-neutral-400">` 之前插入 `{record.aiSummary && (<p className="mt-1 text-xs text-neutral-400">AI 摘要：{record.aiSummary}</p>)}`；文件头注释更新（摘要挂载点与渲染条件）。`RecordRow.test.tsx` 的 `makeTextRecord`/`makeImageRecord` fixture 工厂增可选 `aiSummary` 参数（缺省 `null`），既有 fixture 调用点补该字段。
  - **前置条件**：`[3, 4]`
  - **对应验收标准**：AC-5
  - 先写测试（TDD）：`RecordRow.test.tsx` 增补——`aiSummary` 非空时渲染「AI 摘要：xxx」且位于预览内容与时间戳之间（textContent 顺序断言）；`aiSummary` 为 `null`/undefined 时不渲染摘要行；fixture 不传 aiSummary 的旧用例全数不回退（可选字段不破坏旧 fixture）。

### 文档与收尾

- [x] 任务 12：更新根 `.md`（README）与 `docs/REQUIREMENTS.md`：`.md`「数据存储 → 风险说明」段在既有「明文存储」句后追加一句——「提交拾光时，内容（含图片）会经 OpenAI 兼容多模态接口上传至 Moonshot（Kimi）云端做一句话摘要分析，图片与文字同口径；请知悉后再决定是否录入敏感内容。」；`docs/REQUIREMENTS.md` MEM-01 行的验收口径修订为「AI 失败则本条提交失败可重试（不入库）」，并在文末变更记录表追加一行（日期 2026-10-22、变更：AI 逐条理解迭代一交付，MEM-01 口径修订，迁移 0005_analyses）。
  - **前置条件**：无
  - **对应验收标准**：AC-8
  - 纯文档任务；`.md` 为仓库根 README 文件名（注意不是 README.md）。

- [x] 任务 13：收尾全量验证——全仓 `grep -rn "LangChain\|LangGraph" apps/desktop/src packages` 确认零代码残留引用；跑根 `pnpm typecheck` 三包通过 + `pnpm --filter @shiguang/ai test` 全绿 + `pnpm --filter @shiguang/desktop test` 全绿（现状基线不回退，新增用例另计）。
  - **前置条件**：`[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]`
  - **对应验收标准**：AC-9
  - 人工走查待办（不由任务勾选覆盖，AC-1/AC-3/AC-4 走查项）：真机配置 KIMI_API_KEY 后提交一条文字记录——loading 覆盖至入库+分析完成、记录行出现 AI 摘要；断网提交一条——按钮失败态 + 「提交失败，请重试」toast、内容保留可重试；乱敲提交一条——「内容未拾光：AI 判定无有效信息」toast 且库中无该记录；纯图粘贴提交一条——出摘要入库。
