# Proposal: 记录摘要分级（ai-record-grade）

## 1. 背景与动机

拾光（ShiGuang）Electron 桌面应用（macOS，pnpm monorepo：apps/desktop + packages/ai + packages/shared）。AI 段迭代一（ai-record-summary）已交付：capture:create 链路先经 Mastra Agent（Kimi OpenAI 兼容端点）单步产出 `{meaningful, summary}`，存 `analyses` 表（record_id PK、summary、model、created_at，与 records 1:1 同事务入库，FK ON DELETE CASCADE），记录页 RecordRow 展示 AI 摘要行。

宏观设计（`docs/REQUIREMENTS.md`）内容层：记录 → 摘要 → 摘要向量；MEM-02 画像权重 = 最近 + 高频 + **AI 判重点**。「摘要分级」即「AI 判重点」，是迭代二（用户画像）的前置数据。

本次为「记录摘要分级」立项：AI 在现有 summarizer 同一次调用中额外产出 grade（三档枚举），随摘要入库；记录页表格化改造并支持级别筛选。用户原话：「作为高中低三个档次好一点，不做过多判断」。

经三节点对齐，本次核心结论：

- **分级形态**：三档枚举 high/mid/low（高/中/低）。不做布尔、不做连续分、不做多维（不做 tag 式领域/情感判断）。用途是迭代二用户画像聚合权重（AI 判重点），本期不做消费端。
- **产出方式**：扩展现有 summarizer schema，一次调用同出 `{meaningful, summary?, grade?}`；不建独立分级链路。prompt 增加第三项任务：判「对未来了解用户的价值」——观点/决定/计划/强情感/长期参考 → 高；一般事实/日常 → 中；琐碎/一次性 → 低。仅 meaningful=true 时产出 grade。
- **失败语义（两点，须区分）**：grade **缺失**（AI 未返回）→ 不阻塞入库，存 NULL；grade **值非法**（如输出「高」而非 high）→ 严格失败：zod enum 校验失败 → 整链失败（等同摘要失败既有口径：不入库、可重试）。摘要空/纯空白维持迭代一既有口径：失败不入库。
- **UI**：记录页**表格化列表**，列 = 选择 | 时间 | 摘要 | 级别 | 标签 | 操作。**不要「内容预览」列**——摘要即主要信息载体，**点击摘要弹窗**看具体记录内容（弹窗复用 RichCapturePreview 展开态渲染图文全文，含时间/级别/标签展示）。原行内 expand 展开机制移除。筛选区加级别下拉（全部/高/中/低），与关键词/时间/标签同在 TanStack Form 筛选表单内组合。级别列轻量徽标展示（配色 design 阶段定）。
- **存量处理**：交付时走现有 capture.delete 批量接口级联清空（记录 + analyses + attachments + 磁盘图片文件），不新写清理逻辑；清空后无 NULL grade 存量问题，不做回填/重跑。
- **人工改级**：本期不做人工修正入口，先靠轻量展示观察 AI 分级质量。

本次变更的本质：在既有 summarizer 一次调用内同步产出三档分级并入库，analyses 表加 grade 列；记录页从行卡片改为表格并支持级别筛选——为迭代二画像权重提供「AI 判重点」数据。

## 2. 需求与范围

### 功能描述

1. **分级产出（核心链路）**：`packages/ai/src/analysis/summarizer.ts` 的 Mastra Agent 单步 structured output 扩展现有 zod schema，同一次调用产出 `{meaningful, summary?, grade?}`，其中 `grade: z.enum(['high', 'mid', 'low']).optional()`；不建独立分级链路。`SUMMARIZER_SYSTEM_PROMPT` 增加第三项任务：判「对未来了解用户的价值」——观点/决定/计划/强情感/长期参考 → 高；一般事实/日常 → 中；琐碎/一次性 → 低。仅 meaningful=true 时产出 grade（摘要随之产出）。
2. **失败语义**：
   - grade 缺失（AI 未返回该字段）→ 不阻塞入库，存 NULL；记录页不显示级别、级别筛选不匹配该条。
   - grade 值非法（如输出「高」而非 high）→ zod enum 校验失败 → 整链失败，等同摘要失败既有口径：不入库、提交按钮失败态可重试。
   - 摘要空/纯空白 → 维持迭代一既有口径：失败不入库。
3. **数据层（迁移 0006_analyses_grade）**：新增迁移 `ALTER TABLE analyses ADD COLUMN grade TEXT`——可空，不加 CHECK 约束，校验收敛应用层（与既有迁移风格一致）；down = 重建表去列（SQLite ALTER 不支持 DROP COLUMN，design 定具体写法）。`createCaptureWithAttachments` 的 `analysis?: { summary; model }` 参数扩展 grade；INSERT analyses 加 grade 列。
4. **契约扩展（`packages/shared/src/index.ts`）**：`CaptureRecord` 加 `aiGrade?: 'high' | 'mid' | 'low' | null`；导出 `Grade` 联合类型（或枚举常量）；`QueryCapturesPayload` 加 `grade?: Grade`（缺省 = 全部）。IPC 通道不变。
5. **DAO 扩展（`captureDao.ts`）**：RecordRow 类型加 `ai_grade`；listCaptures / queryCaptures 的 LEFT JOIN analyses 带出 `aiGrade`；queryCaptures 加 grade 单值过滤（仅匹配非 NULL 记录）。
6. **记录页表格化改造**：列 = 选择 | 时间 | 摘要 | 级别 | 标签 | 操作。**无「内容预览」列**——摘要即主要信息载体。点击摘要弹出新弹窗看具体记录内容：复用 RichCapturePreview 展开态渲染图文全文，含时间/级别/标签展示（新组件；expanded 语义本次保留给弹窗场景）。原行内 expand 展开机制移除。RecordRow 改表格行组件或新 RecordTable 由 design 定。
7. **级别筛选**：筛选区加级别下拉（全部/高/中/低），与关键词/时间/标签同在 TanStack Form 筛选表单内组合过滤。级别列轻量徽标展示（配色 design 阶段定）。
8. **存量清空（交付时一次性动作）**：用现有 capture.delete 批量接口级联清空记录 + analyses + attachments + 磁盘图片文件；不新写清理逻辑，不是产品功能，不写进代码需求。清空后无 NULL grade 存量问题，不做回填/重跑。

### 范围边界

**本次做：**

- 迁移 0006_analyses_grade：analyses 表加 grade TEXT 可空列；down 重建表去列（写法 design 定）；登记进 migrations 数组。
- summarizer 扩展：prompt 加第三任务（判「对未来了解用户的价值」），schema 加 `grade` 可选枚举字段；analyzeCapture 返回带 grade；单测覆盖（mock agent）。
- captureDao 扩展：analysis 参数带 grade、INSERT 带 grade 列、RecordRow 加 ai_grade、LEFT JOIN 带 aiGrade、queryCaptures 加 grade 单值过滤（仅匹配非 NULL）。
- shared 契约：CaptureRecord 加 `aiGrade`、`Grade` 联合类型导出、QueryCapturesPayload 加 `grade` 过滤。
- 记录页表格化：表格列结构（选择/时间/摘要/级别/标签/操作）、级别徽标、级别筛选下拉、摘要点击弹窗（复用 RichCapturePreview expanded）、移除行内 expand 机制。
- 失败语义：grade 缺失存 NULL 不阻塞；grade 非法严格失败可重试。
- 三层测试沿用：DAO vitest 真库真迁移、summarizer schema 单测、组件 jsdom + Testing Library、ipc handler vi.hoisted stubs。TDD 由 rail-code 硬性执行。

**本次不做（明确排除）：**

- **人工改级/级别编辑入口**：本期不做，先靠轻量展示观察 AI 分级质量。
- **独立分级链路**：不建，分级与摘要同一次调用同出。
- **多维分级 / tag 式判断**：不做领域/情感等过多判断，仅三档枚举。
- **画像消费端**：grade 本期不消费，聚合语义留给迭代二 design。
- **存量回填 / 重跑**：交付时一次性清空存量（现有批量删除能力执行）后即无 NULL grade 存量问题；不做回填、不重跑。
- **新建清理逻辑**：存量清空复用现有 capture.delete 批量接口，不新写代码。
- **prompt_version 预埋**：沿用既有技术债务口径，届时单独立项重跑工具再加。

### 边缘场景处理（已对齐）

| 场景 | 处理方式 |
| --- | --- |
| AI 返回摘要但 grade 值非法（如「高」而非 high） | 严格失败：zod enum 校验失败 → 整链失败，不入库，按钮失败态可重试 |
| grade 缺失（AI 未返回） | 存 NULL 不阻塞入库；记录页不显示级别、级别筛选不匹配该条 |
| 摘要空/纯空白 | 维持迭代一既有口径：失败不入库 |
| 弹窗打开状态下该记录被删除 | design 阶段处理：弹窗关闭并走既有页回退刷新逻辑（不单独问用户） |
| 级别筛选下删除导致当前页为空 | 复用既有页回退逻辑（page > 1 时回退前一页） |
| 筛选空结果（含 grade 维度） | 复用既有「没有找到匹配的记录」空状态，条件判断增 grade 维度 |
| 存量旧记录 | 交付时走现有批量删除级联清空（含磁盘图片文件），不做回填/重跑 |

### 约束

- 数据层边界：单 SQLite 文件；迁移沿用 umzug + 自定义 SqliteMigrationStorage；不加 CHECK 约束，分级校验收敛应用层（zod enum）。
- 工程基线沿用：electron-vite 多入口、cjs preload、Tailwind + shadcn 自写 primitives、三层测试策略；**LLM 调用保持接口隔离可 mock**。
- 技术债务约束：**勿制造第三份并存 DAO 接口**（listCaptures / queryCaptures 并存为既有债务），grade 数据访问收敛进既有 DAO。
- 迁移 down 写法：SQLite ALTER 不支持 DROP COLUMN，0006 的 down 需重建表去列，具体写法 design 定。
- IPC 通道不变：grade 随既有 capture:list / capture:create 载荷传递，不新增通道。
- TDD：rail-code 硬性要求，测试先行。

### 验收标准

1. **分级产出**：同一 summarizer 调用产出 `{meaningful, summary?, grade?}`；meaningful=true 时摘要与 grade 随记录同事务入库；prompt 含第三任务（判「对未来了解用户的价值」，高/中/低判定标准）。
2. **grade 缺失语义**：AI 未返回 grade 时记录正常入库（grade = NULL），不阻塞链路；记录页该条不显示级别、级别筛选不匹配。
3. **grade 非法语义**：grade 值非法时 zod 校验失败，整链失败不入库，提交失败态可重试（与摘要失败口径一致）。
4. **迁移正确**：迁移 0006 后 analyses 表存在可空 grade TEXT 列；down 迁移可回滚；grade 不加 CHECK 约束。
5. **契约**：`CaptureRecord.aiGrade` 可选可空，不破坏旧 fixture；`Grade` 类型导出；`QueryCapturesPayload.grade` 缺省 = 全部。
6. **查询过滤**：queryCaptures 支持 grade 单值过滤且仅匹配非 NULL 记录；list 查询 LEFT JOIN 带出 aiGrade。
7. **记录页表格化**：列 = 选择/时间/摘要/级别/标签/操作；无内容预览列；点击摘要弹窗复用 RichCapturePreview expanded 展示图文全文（含时间/级别/标签）；行内 expand 机制已移除。
8. **级别筛选**：级别下拉（全部/高/中/低）与关键词/时间/标签在 TanStack Form 内组合过滤；筛选空结果复用既有空状态文案。
9. **页回退**：级别筛选下删除致当前页为空时回退前一页（复用既有逻辑）。
10. **自动化测试全绿**：`pnpm --filter @shiguang/ai test`、`pnpm --filter @shiguang/desktop test`、根 `pnpm typecheck` 三包通过，不回退现有基线。
11. **需求文档**：`docs/REQUIREMENTS.md` 登记本次立项与交付（rail-docs 阶段或交付时更新）。

## 3. 未来场景与扩展预判

- **人工改级/级别编辑**：本期不做。建议方向：观察 AI 分级质量后再评估；若立项，编辑入口与画像权重联动需一并考虑（编辑后聚合结果如何刷新）。
- **prompt 调优后旧 grade 不升级**：沿用既有技术债务条目（`.rail/docs/ai/README.md`「prompt 调优无重跑机制」）。建议方向：届时单独立项做重跑工具，并补加 prompt_version 字段，本期不预埋。
- **画像消费（迭代二）**：grade 是 MEM-02 权重公式中「AI 判重点」的数据来源；主题不预存，画像汇总时由 AI 现抽。grade 的聚合语义（高/中/低如何加权）留给迭代二 design。建议方向：本期数据模型（可空枚举列）已满足前置数据要求，聚合设计不阻塞本期交付。

## 4. 相关引用

- 既有变更：`.rail/changes/ai-record-summary/proposal.md` —— 迭代一交付口径（summarizer 结构、analyses 表、失败即失败可重试、三层测试策略），本次在其上扩展
- `docs/REQUIREMENTS.md` —— 内容层设计（记录 → 摘要 → 摘要向量）；MEM-02 画像权重 = 最近 + 高频 + AI 判重点；本次立项与交付需登记
- `packages/ai/src/analysis/summarizer.ts` —— Mastra Agent 单步 structured output（zod `{meaningful, summary?}`）、SUMMARIZER_SYSTEM_PROMPT、Kimi custom endpoint（`https://api.kimi.com/coding/v1`，`KIMI_MODEL` 覆盖，默认 kimi-k2.6）、AbortSignal.timeout(60_000)；本次 prompt 加第三任务、schema 加 `grade`
- `packages/ai/src/migrations/0005_analyses.ts` —— analyses 表迁移样板；本次新增 0006_analyses_grade（ADD COLUMN grade TEXT 可空，down 重建表去列）
- `packages/ai/src/dao/captureDao.ts` —— `createCaptureWithAttachments` 的 analysis 参数、INSERT analyses、RecordRow 类型、listCaptures / queryCaptures LEFT JOIN 与过滤；技术债务约束：勿制造第三份并存 DAO 接口
- `packages/shared/src/index.ts` —— CaptureRecord 契约（加 `aiGrade`）、Grade 联合类型导出、QueryCapturesPayload（加 `grade` 过滤）；IPC 通道不变
- `apps/desktop/src/renderer/console/pages/RecordsPage.tsx` / `RecordRow.tsx` —— 记录页现状（TanStack Form 筛选：keyword + range + tags；RecordRow 行卡片；页回退刷新逻辑）；本次表格化改造、级别筛选下拉、级别徽标、摘要点击弹窗、移除 expand 机制
- `apps/desktop/src/renderer/components/rich-capture-preview.tsx` —— 图文混排渲染，expanded 语义本次保留给弹窗场景
- `.rail/docs/ai/README.md` —— 技术债务条目「prompt 调优无重跑机制」（本次沿用，届时单独立项重跑工具再加 prompt_version）
- 三层测试样板：DAO vitest 真库真迁移、summarizer schema 单测（mock agent）、组件 jsdom + Testing Library、ipc handler vi.hoisted stubs
