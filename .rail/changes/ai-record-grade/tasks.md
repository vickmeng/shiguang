---
slug: ai-record-grade
derived_from: .rail/changes/ai-record-grade/design.md
---

# Tasks — ai-record-grade

> 排程说明：四条无依赖同发起跑——**数据层组**（任务 1）、**shared 契约**（任务 2，最优先落地，任务 3/4/5/7/8 消费其 Grade 类型）、**summarizer schema/prompt**（任务 6）、**RecordRow 表格化**（任务 8）。captureDao.ts 被任务 3/4/5 同文件串行（依赖链 1→3→4→5，任务 5 另依赖 2）；任务 7（analyzeCapture 返回类型 + handler 透传）依赖 5+6（DAO 入参须先接受 grade，handler 才能透传）；弹窗组件（任务 9）依赖 2；RecordsPage 接线（任务 10）依赖 7/8/9；任务 11 收尾依赖全部实现任务。任务 2 落地后至消费方完成前 aiGrade 字段不渲染属预期（可选字段不报错），以任务 11 全绿为准。

## 实现任务

### packages/ai（迁移 + DAO）

- [x] 任务 1：新建 `packages/ai/src/migrations/0006_analyses_grade.ts`（沿用 0005_analyses 的 `MigrationContext` 结构化类型与 `export const migration` + default 导出形态）：`const UP_SQL` 为 `` `ALTER TABLE analyses ADD COLUMN grade TEXT;` ``；`const DOWN_SQL` 为 `` `ALTER TABLE analyses DROP COLUMN grade;` ``（better-sqlite3 ^12.11.1 内置 SQLite ≥3.35 支持 DROP COLUMN，不重建表）；`up`/`down` 均 `db.exec(...)`；并在 `packages/ai/src/db.ts` 的 migrations 数组中 `analysesMigration` 之后登记（`import { migration as analysesGradeMigration } from './migrations/0006_analyses_grade'`）。
  - **前置条件**：无
  - **对应验收标准**：AC-4
  - 先写测试（TDD）：`packages/ai/src/db.test.ts` 增补——跑完迁移后 `PRAGMA table_info(analyses)` 含 grade 列且 `notnull === 0`（可空、无默认值）；0005 态旧库（已有 analyses 行，grade 缺省）升级后现有行不受影响；`migration.down()` 后 `PRAGMA table_info(analyses)` 不再含 grade 列。

- [x] 任务 2：在 `packages/shared/src/index.ts` 新增 `export type Grade = 'high' | 'mid' | 'low';`（放在文件类型区，`CaptureRecord` 之前，JSDoc「AI 摘要分级（analyses.grade 三档枚举）：画像权重『AI 判重点』数据来源」）；`CaptureRecord` 接口 `aiSummary` 之后增可选字段 `aiGrade?: Grade | null;`（JSDoc「AI 摘要分级（analyses.grade）；无分级（grade 为 NULL）的记录为 null/undefined」）；`QueryCapturesPayload` 接口 `tagNames` 之后增 `grade?: Grade;`（JSDoc「级别单值过滤（analyses.grade），缺省 = 全部；仅匹配非 NULL 记录」）。
  - **前置条件**：无
  - **对应验收标准**：AC-5

- [x] 任务 3：在 `packages/ai/src/dao/captureDao.ts` 实现读取侧 grade 透出：`RecordRow` 接口 `ai_summary` 之后增 `ai_grade: string | null`（注释「LEFT JOIN analyses 得到的 AI 分级，grade 为 NULL 时为 null」）；`SELECT_RECORDS_JOIN` 的 SELECT 列表追加 `analyses.grade AS ai_grade`（改后整行为 `` `SELECT records.*, attachments.file_path AS image_path, analyses.summary AS ai_summary, analyses.grade AS ai_grade` ``）；`toRecord` 返回对象增 `aiGrade: (row.ai_grade as Grade | null) ?? null`（`import type { CaptureRecord, Grade, ... }` 增 `Grade`）；文件头注释 JOIN 说明补 aiGrade。
  - **前置条件**：`[1, 2]`
  - **对应验收标准**：AC-6
  - 先写测试（TDD）：`captureDao.test.ts` 增补——向 analyses 手工 INSERT 含 grade 的行后 `listCaptures`/`queryCaptures`/`getById` 读回 `aiGrade` 为对应枚举值；grade 为 NULL 的行读回 `aiGrade` 为 `null`；`createCapture` 纯文字直写返回的记录 `aiGrade` 为 `null`（RETURNING 补 NULL 后断言）。
  - 注意：本任务暂不改 `createCapture` 的 RETURNING（任务 4 改）；上述 createCapture 断言在任务 4 落地前会暴露失败，可先写待任务 4 一并转绿，或与任务 4 合并提交。

- [x] 任务 4：在 `packages/ai/src/dao/captureDao.ts` 改 `createCapture` 的 RETURNING：`` `RETURNING *, NULL AS image_path, NULL AS ai_summary` `` 追加为 `` `RETURNING *, NULL AS image_path, NULL AS ai_summary, NULL AS ai_grade` ``；`createCaptureWithAttachments` 内 `toRecord({ ...row, image_path: null, ai_summary: null })` 调用点同步补 `ai_grade: null`。
  - **前置条件**：`[3]`
  - **对应验收标准**：AC-6
  - 先写测试（TDD）：复用任务 3 已写的 createCapture `aiGrade === null` 断言转绿；`createCaptureWithAttachments` 不带 analysis 时返回记录 `aiGrade === null`。

- [x] 任务 5：在 `packages/ai/src/dao/captureDao.ts` 改 `createCaptureWithAttachments` 写入 grade：input 类型 `analysis?: { summary: string; model: string }` 扩展为 `analysis?: { summary: string; model: string; grade?: Grade | null }`（JSDoc 补「grade 缺省/null 存 NULL，不阻塞入库」）；INSERT 语句改为 `` `INSERT INTO analyses (record_id, summary, model, grade) VALUES (?, ?, ?, ?)` ``，参数为 `row.id, input.analysis.summary, input.analysis.model, input.analysis.grade ?? null`。
  - **前置条件**：`[4]`
  - **对应验收标准**：AC-1、AC-2
  - 先写测试（TDD）：`captureDao.test.ts` 增补——传 `analysis: { summary: '一句话', model: 'kimi-k2.6', grade: 'high' }` 后查询读回 `aiGrade === 'high'`；`grade` 缺省与显式 `grade: null` 两种入参均存 NULL（读出 `aiGrade === null` 且 `SELECT grade FROM analyses` 为 null）；三表事务回滚语义不回退（附件插入异常时 analyses 不残留）。

- [x] 任务 6：在 `packages/ai/src/dao/captureDao.ts` 的 `queryCaptures` 增 grade 单值过滤（子查询形态，加在 tagNames 分支之后）：`if (input.grade !== undefined) { conditions.push('records.id IN (SELECT record_id FROM analyses WHERE grade = ?)'); params.push(input.grade); }`；JSDoc 补 grade 过滤说明（total COUNT 与 items JOIN 共用同一 conditions/params，仅匹配非 NULL）。
  - **前置条件**：`[1, 2]`
  - **对应验收标准**：AC-6、AC-2
  - 先写测试（TDD）：`captureDao.test.ts` 增补——造 high/mid/NULL 三条记录，`queryCaptures({ ..., grade: 'high' })` items 仅含 high 记录且 total 为 1；grade 过滤与 keyword/tagNames 组合时 conditions 正确叠加；grade 为 NULL 的记录在任何 grade 过滤下均不命中；不带 grade 时全部返回（缺省 = 全部）。

### packages/shared

（任务 2 即 shared 契约，见上。）

### packages/ai（分析模块）

- [x] 任务 7：在 `packages/ai/src/analysis/summarizer.ts` 扩展 schema 与 prompt 并改 `analyzeCapture` 返回类型：`analysisOutputSchema` 增 `grade: z.enum(['high', 'mid', 'low']).optional().describe('观点/决定/计划/强情感/长期参考→high；一般事实/日常→mid；琐碎/一次性→low')`（注释「仅 meaningful=true 时输出；缺失通过存 NULL，非法拒绝走失败路径」）；`SUMMARIZER_SYSTEM_PROMPT` 任务清单追加第三项（逐字：「3. 判定这条记录对未来了解用户的价值，输出三档分级之一：- high：观点、决定、计划、强烈情感、有长期参考价值的内容；- mid：一般事实、日常事务记录；- low：琐碎、一次性、过后即无参考价值的内容。仅当 meaningful=true 时输出分级。」），末行 JSON 说明改写为「严格输出 JSON：{"meaningful": true/false, "summary": "...", "grade": "high"|"mid"|"low"}（不值得保存时省略 summary 与 grade）」，其余 prompt 内容逐字不动；`analyzeCapture` 返回类型改 `Promise<{ meaningful: true; summary: string; grade?: Grade } | { meaningful: false }>`（`import type { Grade } from '@shiguang/shared'`），`meaningful === true` 分支返回 `{ meaningful: true, summary: object.summary, ...(object.grade !== undefined ? { grade: object.grade } : {}) }`（grade 不做存在性强制），`meaningful === false` 分支返回 `{ meaningful: false }`；文件头注释补分级产出说明。
  - **前置条件**：`[2]`
  - **对应验收标准**：AC-1、AC-2、AC-3
  - 先写测试（TDD）：`summarizer.test.ts` 增补——mock agent 返回 `{ meaningful: true, summary: 'x', grade: 'high' }` 时 analyzeCapture 解析为 `{ meaningful: true, summary: 'x', grade: 'high' }`；`{ meaningful: true, summary: 'x' }`（无 grade）解析通过且返回无 grade 键；`{ meaningful: true, summary: 'x', grade: '高' }` 由 zod 拒绝（schema 层断言，不依赖 mock 链路）；断言 `SUMMARIZER_SYSTEM_PROMPT` 含「对未来了解用户的价值」「high：观点、决定、计划」「仅当 meaningful=true 时输出分级」与改写后 JSON 格式行；meaningful=false 分支返回无 grade。

### apps/desktop 主进程

- [x] 任务 8：改 `apps/desktop/src/main/ipc/captureHandlers.ts` 的 capture:create analysis 载荷透传 grade：`analysis: { summary: analysis.summary, model: resolveKimiModel() }` 改为 `analysis: { summary: analysis.summary, model: resolveKimiModel(), grade: analysis.grade ?? null }`；文件头注释 AI 分析编排段补「analysis 载荷携 grade（AI 未返回时存 NULL）」；编排结构（try/catch、图片清理、无意义抛错）零改动。
  - **前置条件**：`[5, 7]`
  - **对应验收标准**：AC-1、AC-2
  - 先写测试（TDD）：`captureHandlers.test.ts` 增补/修订——mock `analyzeCapture` 返回 `{ meaningful: true, summary: 's', grade: 'mid' }` 时断言 `createCaptureWithAttachments` 入参 `analysis` 含 `{ summary: 's', grade: 'mid' }`；mock 返回无 grade 时入参 `grade: null`；无意义/抛错路径既有断言全数不回退。

### apps/desktop renderer

- [x] 任务 9：原地改造 `apps/desktop/src/renderer/console/pages/RecordRow.tsx` 为表格行组件：`RecordRowProps` 删 `expanded: boolean` 与 `onToggleExpand(): void`，增 `onOpenDetail(): void`（JSDoc「摘要 td 点击回调，父级打开详情弹窗」）；组件根元素 `<li className="flex cursor-pointer items-start gap-3 p-3" onClick={onToggleExpand}>` 改为 `<tr className="border-t border-neutral-200 first:border-t-0 align-top">`；内容重构为六个 `<td>`——①复选框 td（`className="p-3"`，复选框 input 保留 `aria-label={\`选择记录 ${record.id}\`}` 与 onChange，删 onClick stopPropagation）；②时间 td（`className="p-3 text-xs text-neutral-400 whitespace-nowrap"`，`new Date(record.createdAt).toLocaleString()` 沿用）；③摘要 td（`className="p-3 max-w-md"`，aiSummary 非空时渲染整格可点击元素：`<button type="button" onClick={onOpenDetail} className="block w-full text-left text-sm text-neutral-700 line-clamp-2">{record.aiSummary}</button>`；aiSummary 为 null/undefined 时渲染不可点击占位 `<span className="text-sm text-neutral-300">—</span>`）；④级别 td（`className="p-3"`，`record.aiGrade` 非空时渲染徽标 `<span className="rounded-full px-2 py-0.5 text-xs {配色}">{映射文案}</span>`：high→`bg-red-50 text-red-600`/「高」、mid→`bg-neutral-100 text-neutral-600`/「中」、low→`bg-transparent border border-neutral-200 text-neutral-400`/「低」，用常量映射对象实现；aiGrade 为 null/undefined 时 td 留空）；⑤标签 td（chips 渲染逻辑整块沿用——实心 chips、`tagColors?.[name] ?? '#d4d4d4'`、`tagTextColor(bg)`、已删标签白字语义，移入 td 并去掉外层 mt-1）；⑥操作 td（`className="p-3 whitespace-nowrap"`，复制/删除按钮与 aria-label/样式/复制分流逻辑沿用，删两处 stopPropagation）；RichCapturePreview 与「AI 摘要：」行从本组件移除（表格无内容预览列）；文件头注释整段重写为表格行结构说明。
  - **前置条件**：`[2]`
  - **对应验收标准**：AC-7
  - 先写测试（TDD）：`RecordRow.test.tsx` 重写——渲染根为 `tr` 且含六个 `td`；列序为 复选框/时间/摘要/级别/标签/操作（textContent 顺序断言）；aiSummary 非空时摘要 button 点击触发 onOpenDetail；aiSummary 为 null 时渲染「—」且无 button；aiGrade 为 'high'/'mid'/'low'/null 四分支徽标类名（`bg-red-50`/`bg-neutral-100`/`border-neutral-200`/留空）与文案（高/中/低）；复制分流（copyImage vs clipboard.writeText）与删除回调既有用例不回退（stopPropagation 相关断言删除）；`makeTextRecord`/`makeImageRecord` fixture 增可选 `aiGrade` 参数（缺省 `null`）。

- [x] 任务 10：新建 `apps/desktop/src/renderer/console/pages/record-detail-dialog.tsx`：导出 `RecordDetailDialog({ open, record, tagColors, onClose }: RecordDetailDialogProps)` 与 `RecordDetailDialogProps` 接口（`open: boolean; record: CaptureRecord | null; tagColors?: Record<string, string>; onClose(): void`）；`if (!open || !record) return null;`；结构沿用 ConfirmDialog 遮罩模式——外层 `<div className="fixed inset-0 z-50 flex items-center justify-center">`，半透明遮罩 `<div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={onClose} />`，内容卡片 `<div role="dialog" aria-modal="true" className="relative w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-lg bg-white p-5 shadow-xl">`；卡片内自上而下：关闭按钮 `<button type="button" aria-label="关闭" onClick={onClose} className="absolute right-3 top-3 rounded-md px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-100">×</button>`；元信息行（flex flex-wrap items-center gap-2）：时间 `new Date(record.createdAt).toLocaleString()`（`text-xs text-neutral-400`）、级别徽标（与 RecordRow 同款映射逻辑——为免双份漂移，徽标映射常量与渲染抽成本文件导出 helper `GradeBadge({ grade }: { grade: Grade })`，RecordRow 改为 import 复用）、标签 chips（与 RecordRow 同款实心 chips 逻辑，复用同一 chips helper 或就地复制同款实现）；全文区 `<RichCapturePreview document={record.document} text={record.text} expanded />`；只读——不渲染复制/删除按钮；文件头注释说明组件定位（console 域组件、弹窗消费 expanded 语义、数据来自列表行不新增 IPC）。
  - **前置条件**：`[2]`
  - **对应验收标准**：AC-7
  - 先写测试（TDD）：新建 `record-detail-dialog.test.tsx`（jsdom）——`open=false` 或 `record=null` 时渲染 null（container 空）；open 时 `getByRole('dialog')` 命中、`aria-modal="true"`；遮罩点击与 `aria-label="关闭"` 按钮点击均触发 onClose；正文渲染 `record.document` 导出内容（沿用 RichCapturePreview 断言方式，text 兜底分支断言）；元信息行含 toLocaleString 时间、级别徽标（high→「高」+ `bg-red-50`）、标签 chips 配色；无复制/删除按钮。

- [x] 任务 11：改 `apps/desktop/src/renderer/console/pages/RecordsPage.tsx` 完成表格化接线：①删 `expandedId`/`setExpandedId` 状态，新增 `const [detailId, setDetailId] = React.useState<number | null>(null)` 与 `const detailRecord = detailId === null ? null : result.items.find((item) => item.id === detailId) ?? null;`；②列表容器 `<ul className="flex flex-col divide-y ...">` 改 `<table className="w-full text-sm">`，内含 `<thead><tr>` 六列表头（「选择」`aria-label` 留空 th、时间、摘要、级别、标签、操作——表头为 `<th className="p-3 text-left text-xs font-medium text-neutral-400">`，时间列 th 加 `whitespace-nowrap`，操作列 th 加 `w-24` 固定宽），`<tbody>` 内 map `RecordRow`（props 删 `expanded`/`onToggleExpand`，增 `onOpenDetail={() => setDetailId(item.id)}`）；③筛选表单 `defaultValues` 增 `grade: '' as '' | Grade`（`import type { Grade }`）；筛选区 TagSelect 之后插入选级别下拉：`<select aria-label="筛选级别" value={filters.grade} onChange={(e) => { form.setFieldValue('grade', e.target.value); setPage(1); }} className="rounded-md border border-neutral-200 px-2 py-1.5 text-sm outline-none focus:border-neutral-400">`，四个 `<option value="">全部</option><option value="high">高</option><option value="mid">中</option><option value="low">低</option>`；④payload 换算在 tagNames 分支后增 `if (filters.grade) payload.grade = filters.grade;`；⑤空状态条件 `filters.keyword !== '' || rangeInUse || filters.tags.length > 0` 增 `|| filters.grade !== ''`；⑥单删成功回调 `if (expandedId === id) setExpandedId(null);` 改为 `if (detailId === id) setDetailId(null);`，批删成功回调 `if (expandedId !== null && selected.has(expandedId)) setExpandedId(null);` 改为 `if (detailId !== null && selected.has(detailId)) setDetailId(null);`；⑦页面尾部（ConfirmDialog 之后）渲染 `<RecordDetailDialog open={detailRecord !== null} record={detailRecord} tagColors={tagColorMap} onClose={() => setDetailId(null)} />`；⑧文件头注释更新（表格化、级别筛选、详情弹窗、expand 移除）；删除确认文案、批量操作栏、分页控件、页回退判断逻辑零改动。
  - **前置条件**：`[8, 9, 10]`
  - **对应验收标准**：AC-7、AC-8、AC-9
  - 先写测试（TDD）：`RecordsPage.test.tsx` 重写/增补——列表渲染为 `table` + 六个 `th` 表头（选择/时间/摘要/级别/标签/操作）；`makeRecords` fixture 增 `aiSummary`/`aiGrade` 字段（缺省 `null`）；点摘要 button 弹 `RecordDetailDialog`（role dialog 出现、渲染全文），点遮罩/关闭按钮关闭；级别下拉选「高」后 payload 含 `grade: 'high'` 且 page 归 1，选回「全部」payload 不含 grade；仅 grade 筛选无结果时显示「没有找到匹配的记录」空状态；expand 相关旧用例（行点击展开/折叠、互不影响）删除；删除/批删/页回退/批量栏/分页既有用例全数不回退；单删与批删命中 detailId 时弹窗关闭的用例各一。

### 收尾

- [x] 任务 12：收尾全量验证——根 `pnpm typecheck` 三包通过；`pnpm --filter @shiguang/ai test` 全绿（db/captureDao/summarizer 新增用例转绿）；`pnpm --filter @shiguang/desktop test` 全绿（captureHandlers/RecordRow/record-detail-dialog/RecordsPage 重写用例转绿，既有基线不回退）；`grep -rn "expandedId\|onToggleExpand" apps/desktop/src` 确认 expand 机制零残留。
  - **前置条件**：`[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]`
  - **对应验收标准**：AC-10
  - 人工走查待办（不由任务勾选覆盖，AC-1/AC-7/AC-8 走查项）：真机配置 KIMI_API_KEY 提交一条观点类记录——入库后级别列出「高」徽标；提交一条日常记录——「中」；断网重试语义不回退；打开摘要弹窗后删除该记录——弹窗关闭、页回退正常；级别筛选「低」与关键词组合过滤生效。
  - 交付时一次性动作（非代码任务）：用现有 capture.delete 批量接口全选 id 级联清空存量记录 + analyses + attachments + 磁盘图片文件；`docs/REQUIREMENTS.md` 登记本次立项与交付（AC-11，可在 rail-docs 阶段执行）。
