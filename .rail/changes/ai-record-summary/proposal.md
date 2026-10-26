# Proposal: AI 逐条理解（ai-record-summary）

## 1. 背景与动机

拾光（ShiGuang）Electron 桌面应用（macOS，pnpm monorepo：apps/desktop + packages/ai + packages/shared），已交付 M0 骨架 / M1 手动图文入库 / M2 查询页面+标签 / M4 图文输入。记录目前只有原文+图片，事后浏览只能逐条展开原文，缺少一句「这条是什么」的速览信息。

本次为 AI 段迭代一「AI 逐条理解」立项：输入框点「拾光」提交时，**先由 AI 逐条分析本条内容（文字 + 全部图片）产出一句话中文摘要，再与记录一起单事务入库**；记录行展示该条摘要。

技术选型已锁定：**Mastra**（workflow/agent，设计与实现须遵循 docs.mastra.ai 最佳实践）+ **Kimi**（Moonshot，OpenAI 兼容 API，`KIMI_API_KEY` 走 `.env`）+ sqlite 单文件（better-sqlite3 + umzug 迁移，当前迁移至 0004）。边界：**不用 Mastra memory/storage**。

经三节点对齐，本次核心结论：

- **先分析后入库（本次核心变更）**：输入框点「拾光」→ 提交按钮转 loading 并禁止再次点击 → AI 先读取本条内容（文字 + 全部图片）产出**一句话中文摘要** → 记录 + 摘要**单事务入库** → 输入框闪现「✓ 已拾光」并收起。loading 全程覆盖 AI 分析。无异步触发、无 pending/分析中状态，**摘要永远与记录同时存在**。
- **AI 内容门卫**：AI 判定内容为无意义输入（手误、乱敲、纯垃圾）时，本条提交直接失败、不入库，toast 简单提示（文案设计阶段定，如「内容为空泛，未拾光」类）。
- **失败即失败**：AI 调用失败（断网 / 限流 / 未配置 KIMI_API_KEY / 响应超时 60s / 返回空摘要或乱码）→ 整条提交失败、**不入库**，按钮闪现失败态可重试；不降级入库、无后台静默重试。超时阈值 **60s**。
- **图片不设张数上限、全部送分析**；纯图记录（无文字）送图出摘要；图片经 OpenAI 兼容多模态接口上云（Moonshot），隐私口径同文字（README 风险说明同步更新）；图片按 token 计费已接受（单次成本分钱以下，精确价格 design 核算）。
- **存量不做回填**——用户自行清空现有库，本期只对新建记录生效。
- **记录页展示**：记录行内（RichCapturePreview 之后、时间戳之前的挂载点）展示该条 AI 摘要；MEM-01 验收口径相应修订为「AI 失败则本条提交失败可重试（不入库）」。

本次变更的本质：在 capture:create 入库链路上游插入一步同步 AI 分析（Mastra workflow 编排 Kimi 多模态调用），新增 `analyses` 表存摘要，记录行增加摘要挂载点——「无摘要的记录」在本期之后不再出现。

## 2. 需求与范围

### 功能描述

1. **先分析后入库（核心链路）**：`capture:create` 在 writeImageFiles → rewriteImageSrcs → 单事务入库的既有编排中，**于入库事务之前插入 AI 分析步骤**——Mastra workflow 以本条文字 + 全部图片（本地上传至 Kimi 多模态接口）为输入，产出**一句话中文摘要**；**记录 + 摘要单事务入库**（新表 `analyses` 与 records 同事务写入）。全程同步阻塞提交，loading 覆盖 AI 分析。
2. **输入框提交状态机**：提交按钮转 loading 并禁止再次点击（沿用 M4 busy 防连点语义）；成功 → 闪现「✓ 已拾光」并清空收起；失败 → 按钮闪现失败态，可重试。
3. **AI 内容门卫**：AI 判定内容为无意义输入（手误、乱敲、纯垃圾）→ 本条提交直接失败、**不入库**，toast 简单提示（文案设计阶段定，如「内容为空泛，未拾光」类）。
4. **失败处理**：AI 调用失败（断网 / 限流 / 未配置 KIMI_API_KEY / 响应超时 60s / 返回空摘要或乱码）→ 整条提交失败、**不入库**，可重试；**不降级入库、无后台静默重试**。超时阈值 60s；空摘要或乱码一律视为失败。
5. **图片处理**：一条记录图片不设张数上限、全部送分析；纯图记录送图出摘要；图片经 OpenAI 兼容多模态接口上云（Moonshot），隐私口径同文字（README 风险说明同步更新）。
6. **数据层（迁移 0005_analyses）**——节点 3 确认最简结构：
   - `analyses` 表：`record_id TEXT PRIMARY KEY UNIQUE`、`summary TEXT NOT NULL`、`model TEXT`（留实际调用模型标识）、`created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`；`record_id` 为 FK 引用 records，`ON DELETE CASCADE`（沿用 attachments 既有模式）。
   - **迭代一不预埋前瞻字段**：无 `status` / `prompt_version` / `error`——失败即不入库，故无需 status。
7. **记录页展示**：RecordRow 内容区顺序调整为 RichCapturePreview → **AI 摘要** → 时间戳 → 标签 chips；摘要挂载点在预览之后、时间戳之前。`CaptureRecord` 契约（`packages/shared/src/index.ts`）新增可选字段 `aiSummary?: string | null`（可选保持旧 fixture 不破）。
8. **LLM 调用接口隔离**：Kimi 调用必须抽象为可 mock 的接口（Mastra agent/tool 层），主进程 HTTP 用 Node 18+ 内置 fetch 零依赖 vs 新增 SDK 由 design 决策；list 查询「JOIN 带摘要 vs 二次查询」为 design 决策点（注意 attachments × analyses JOIN 行膨胀问题）。

### 范围边界

**本次做：**

- 迁移 0005_analyses：`analyses` 表（record_id UNIQUE + FK ON DELETE CASCADE、summary NOT NULL、model、created_at），同步 DDL exec，登记进 migrations 数组。
- `packages/ai` 新增 analysis DAO / service：摘要写入随记录同事务；删除记录时摘要随 FK 级联删除（沿用 attachments 既有模式，**不新增应用层级联逻辑**）。
- Mastra workflow 编排「逐条理解」agent（文字 + 全部图片 → 一句话中文摘要；门卫判定 + 空摘要/乱码判失败由 prompt/输出校验实现），遵循 docs.mastra.ai 最佳实践；不用 Mastra memory/storage。
- Kimi OpenAI 兼容 API 封装（`KIMI_API_KEY` 走 `.env`，dotenv 已在 main 入口最前加载）；LLM 调用接口隔离可 mock。
- `capture:create` 编排改造：入库事务前插入 AI 分析步骤；分析失败 → 整链路失败不入库，提交可重试。
- 输入框：提交按钮 loading / 禁连点 / 失败态重试 / 成功闪现「✓ 已拾光」收起（沿用 M4 busy 语义与 600ms 闪现惯例）。
- 记录页：RecordRow 摘要挂载点（预览后、时间戳前）；CaptureRecord 契约加 `aiSummary?: string | null`；列表查询带摘要（JOIN vs 二次查询由 design 定）。
- README：隐私风险说明更新（图片上云口径同文字）。
- MEM-01 验收口径修订：「AI 失败则本条提交失败可重试（不入库）」。

**本次不做（明确排除）：**

- **存量回填**：不做回填，用户自行清空现有库，本期只对新建记录生效。
- **降级入库**：AI 失败绝不降级存「无摘要记录」，失败即失败可重试。
- **长度兜底 / prompt 截断**：不加。输入框 5000 字上限 + 现有约束已够。
- **图片张数上限**：不设限，全部送分析。
- **异步触发 / pending / 分析中状态**：链路全程同步，无异步、无中间态，摘要永远与记录同时存在。
- **摘要重跑机制 / prompt_version 预埋**：不做、不预留（未上线数据可弃，prompt 调优后用新数据验证）。
- **Mastra memory / storage**：明确不用。
- **多模态深化**：不做图片内文字提取级理解，本期只要「整图参与出摘要」。

### 边缘场景处理（已对齐）

| 场景 | 处理方式 |
| --- | --- |
| AI 调用失败（断网 / 限流 / 未配置 KIMI_API_KEY / 超时 / 空摘要 / 乱码） | 整条提交失败、不入库，按钮闪现失败态可重试；不降级、无后台静默重试；超时阈值 60s |
| AI 判定无意义输入（手误 / 乱敲 / 纯垃圾） | 本条提交直接失败、不入库，toast 简单提示（文案设计阶段定） |
| 纯图记录（无文字） | 送全部图片出摘要，正常入库 |
| 图片张数很多 | 不设上限，全部送分析；按 token 计费（成本 design 核算） |
| 记录超长（5000 字上限内） | 不做 prompt 截断 / 长度兜底，现有输入约束已够 |
| 删除记录 | 摘要随 FK `ON DELETE CASCADE` 级联删除（沿用 attachments 模式） |
| 存量旧记录（无摘要） | 不做回填；用户自行清空库，本期只对新建记录生效 |

### 约束

- 数据层边界：单 SQLite 文件；迁移沿用 umzug + 自定义 SqliteMigrationStorage，迁移 0005 同步 DDL exec；DAO 不碰磁盘，fs 操作在 handler / service。
- 工程基线沿用：electron-vite 多入口、cjs preload、Tailwind + shadcn 自写 primitives、三层测试策略（DAO vitest 真库真迁移、组件 jsdom + Testing Library + fixture、ipc handler vi.hoisted stubs + vi.mock('electron') + mock @shiguang/ai）；**LLM 调用必须接口隔离可 mock**。
- 技术债务顺手项：captureDao 缺 getById；listCaptures / queryCaptures 并存——**勿制造第三份并存接口**，analysis 数据访问收敛进新 DAO。
- 输入框 blur 时序铁律 / busy 防连点语义沿用 M4 既有实现。
- TDD：rail-code 硬性要求，测试先行。

### 验收标准

1. **先分析后入库**：提交后 AI 产出一句话中文摘要，记录 + 摘要单事务入库；库中不存在「无摘要的新建记录」。
2. **门卫生效**：无意义输入（乱敲 / 纯垃圾）提交直接失败、不入库，toast 提示。
3. **失败即失败可重试**：断网 / 未配置 KIMI_API_KEY / 超时 60s / 空摘要或乱码时整条提交失败、不入库，按钮失败态可重试，重试成功后正常入库。
4. **纯图记录**：无文字记录送图产出摘要并入库。
5. **记录页展示**：记录行在 RichCapturePreview 之后、时间戳之前展示该条 AI 摘要；`CaptureRecord.aiSummary` 可选字段不破坏旧 fixture。
6. **级联删除**：删除记录后对应 analyses 行随 FK 级联删除，无孤儿数据。
7. **迁移正确**：迁移 0005 后存在 analyses 表（record_id UNIQUE、FK CASCADE、summary NOT NULL）；down 迁移可回滚；旧库升级后现有记录不受影响（无摘要）。
8. **隐私说明**：README 风险说明已更新（图片上云口径同文字）。
9. **自动化测试全绿**：`pnpm --filter @shiguang/ai test`、`pnpm --filter @shiguang/desktop test`、根 `pnpm typecheck` 三包通过，不回退现有基线。

## 3. 未来场景与扩展预判

- **摘要重跑机制 / prompt 调优迭代**：本期不做重跑、不预留 prompt_version（未上线数据可弃，prompt 调优后用新数据验证）。若未来 prompt 大幅升级后希望对旧摘要升级，建议方向：届时单独立项做重跑工具（批处理 + prompt_version 字段届时再加），数据模型当前最简结构不挡路。
- **记录编辑联动摘要重跑**：当前记录无编辑能力；若未来引入编辑，编辑后摘要必然失配。建议方向：**记入技术债务**（写入 `.rail/docs` 待 design / rail-docs 落盘），编辑功能立项时把「编辑触发重跑」作为其需求的一部分，不属本期。
- **图片多模态理解深化**：图片内文字提取级理解（OCR 级）属后续迭代范畴。建议方向：本期「整图参与出摘要」的 workflow/agent 结构已是多模态输入，深化时在 prompt 与工具层增强即可，数据模型无需演进。
- **AI 分析成本与隐私的规模化压力**：本期逐条实时上云，随记录量增长 token 成本累积、隐私暴露面扩大。建议方向：若未来出现批量导入或高频记录场景，评估本地小模型兜底或降频分析策略，届时单独立项。

## 4. 相关引用

- 根 `AGENTS.md` —— Mastra 设计与实现须遵循 docs.mastra.ai 最佳实践（随版本更新核对）
- `docs/REQUIREMENTS.md` —— MEM-01 验收口径修订为「AI 失败则本条提交失败可重试（不入库）」
- `apps/desktop/src/main/ipc/captureHandlers.ts` —— capture:create 入库链路编排（writeImageFiles → rewriteImageSrcs → createCaptureWithAttachments 单事务入库），本次在其前插入 AI 分析步骤
- `packages/ai/src/db.ts` —— better-sqlite3 + umzug 装配，migrations 数组登记点（新增 0005_analyses）
- `packages/ai/src/dao/captureDao.ts` —— DAO 现状；技术债务：缺 getById、listCaptures 与 queryCaptures 并存（勿制造第三份并存接口）
- `packages/shared/src/index.ts` —— CaptureRecord 契约（新增 `aiSummary?: string | null`）
- `apps/desktop/src/renderer/console/RecordsPage.tsx` / `RecordRow.tsx` —— 记录页查询链路（RecordsPage → window.api.capture.list → IPC capture:list → queryCaptures）；RecordRow 内容区顺序与摘要挂载点（RichCapturePreview 之后、时间戳之前）
- `apps/desktop/src/main/` main 入口 —— dotenv 最前加载（KIMI_API_KEY 仅占位无消费）；主进程无 HTTP client 依赖（Node 18+ 内置 fetch vs SDK 为 design 决策点）
- `apps/desktop/src/renderer/input/features/capture/capture-form.tsx` —— 输入框 busy/loading 防连点语义、600ms 闪现惯例（本次失败态/成功态沿用）
- 测试样板：ipc handler 测试（vi.hoisted stubs + vi.mock('electron') + mock @shiguang/ai）、DAO 测试（mkdtemp + initDatabase 真库真迁移）、组件测试（jsdom + Testing Library + makeTextRecord/makeImageRecord fixture）
- Kimi（Moonshot）OpenAI 兼容多模态 API + `.env` 的 KIMI_API_KEY —— AI 能力来源
- README —— 隐私风险说明更新点（图片上云口径同文字）
