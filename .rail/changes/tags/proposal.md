# Proposal: 标签系统（tags）

## 1. 背景与动机

拾光（ShiGuang）目前一条记录只有纯文本（+ 可选图片），没有任何维度化组织手段。用户提出：一条记录应能打上**多标签**，标签既能帮助事后在记录页按维度筛选，也能成为 M5 AI 分析流水线的现成结构化输入。

经三节点对齐，本次标签变更确立以下核心结论：

- 一条记录可打**多标签**；输入框以 chips 多选呈现，支持输入即席新建（回车新建无匹配标签，创建时从预置色板随机取色入库）。
- 提交成功后**记住本次标签组合**：主进程持久化到 userData JSON（无先例，需新建 main 侧小模块），下次打开输入框**预选上次组合**。
- 后台 console 新增独立**「标签」维护页**：新建 / 重命名 / 删除；删除**不回溯**记录上的标签文本。
- 数据模型采用**文本快照**语义：**tags 表**（id / name UNIQUE / color / created_at）+ **records 新增 tags 列**（JSON 文本数组快照，默认 `'[]'`），**不做关联表**。该语义与「记录只存文本」模型自洽，且对按标签筛选友好（JSON 文本列参数化查询，零迁移）。
- **按标签筛选记录纳入本期**：记录页筛选表单新增标签多选，语义为**任一命中（OR）**。

本次变更的本质：为记录引入轻量标签维度——输入框 chips 打标 + 标签组合记忆 + console 标签维护页 + 记录页 chips 展示与 OR 筛选，数据层仅需一个迁移（tags 表 + records.tags 快照列）。

## 2. 需求与范围

### 功能描述

1. **输入框打标（chips 多选 + 即席新建 + 选项直删）**：标签区挂在 CaptureForm 编辑器与底部操作条之间，交互对标 antd `Select mode="tags"`——点选展开下拉列出标签库全部标签，可多选为 chips；输入即过滤，无匹配文本回车**即席新建**（随机色入库）并选中，重名新建自动转为选中已有标签（UNIQUE 兜底）；**下拉每项自带删除按钮，点击直接删库**（快照语义：已入库记录上的标签文本不受影响；若该项正被本框选中则一并移除选中）。标签名规则：**trim、非空、长度上限 20 字**。
2. **标签组合记忆**：`capture:create` 成功后把本次提交的标签名数组持久化到 userData JSON；下次打开输入框时渲染端 invoke 拉取并**预选上次组合**。文件缺失 / JSON 损坏时降级为空预选，不阻塞输入框。
3. **console 标签维护页**：SideNav 新增「标签」页（ConsolePage 类型 + NAV_ITEMS + App.tsx 渲染分支三处同步）；支持新建、重命名、删除（二次确认弹窗，dialog.tsx 惯例）。**删除不回溯**：已入库记录保留旧标签文本，展示时灰显。
4. **数据模型（迁移 0004_tags）**：
   - `tags` 表：`id TEXT PRIMARY KEY`、`name TEXT NOT NULL UNIQUE`、`color TEXT NOT NULL`（创建时从预置色板随机）、`created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`。
   - `records` 表新增 `tags TEXT NOT NULL DEFAULT '[]'`：JSON 文本数组**快照**（提交时把标签名快照进记录）。
   - 不做关联表；迁移体为同步 DDL exec（up/down 均为 `async ({ context: db }) => db.exec(SQL)`），在 migrations 目录新建并登记到 `db.ts` 的 migrations 数组。
5. **记录页展示**：RecordRow 展示标签 chips——标签库中仍存在的用库中颜色；已删除的标签以灰色 chip 展示（文本保留）。
6. **按标签筛选**：RecordsPage 筛选表单在关键词 LIKE + 时间范围 + hasImages 之外新增**标签多选**（第四条件），语义为**任一命中（OR）**；与现有条件组合（条件间 AND、标签内部 OR）；走参数化查询，零迁移。

### 范围边界

**本次做：**

- 迁移 0004_tags：`tags` 表 + `records.tags` JSON 快照列（默认 `'[]'`）。
- 新增 `tagDao`（新建伊始即收敛接口：**list / create / rename / delete**，不加多余查询，规避 captureDao 的 getById / listCaptures 与 queryCaptures 并存债务）；多步写用 `database.transaction()`。
- 主进程新建 userData JSON 持久化小模块（标签组合记忆），参照 `screenshotService` 的 `path.join(app.getPath('userData'), ...)` 惯例；容错：文件缺失 / 损坏 JSON 降级为空预选。
- IPC：`tags` 独立域 handler 文件，经 `registerIpc()` 汇总注册；通道常量与 payload 类型集中 `packages/shared`；preload 新增 `tags` 分组（contextBridge → `ShiguangApi` → `env.d.ts` 引用）。
- 输入框：标签 chips 区（多选下拉 + 即席新建 + 预选回填）；标签输入失焦逻辑遵守 blur 时序教训（onBlur 不得同步收起窗口，mousedown 抢跑 click）。
- console：标签维护页（CRUD + 二次确认删除）。
- 记录页：RecordRow 标签 chips 展示（库内用库色、已删灰色）；筛选表单标签多选（OR 语义）。

**本次不做（明确排除）：**

- **标签颜色自定义**：颜色仅创建时从预置色板随机，不提供修改。
- **标签使用统计 / 使用频次排序**：chips 当前按库序展示；频次排序记入技术债务。
- **AND 语义筛选**：仅做任一命中（OR）；AND 语义无需求信号，不做。
- **重命名 / 删除回溯记录**：快照语义下记录保留旧文本，明确不回溯、不灰改历史。
- **关联表 / 多对多中间表**：文本快照模型已覆盖展示与筛选，不引入关联表。
- **标签的 AI 分析消费**：M5 流水线自己的事情，本次仅保证标签是现成结构化维度，不做任何预留代码。

### 边缘场景处理（已对齐）

| 场景 | 处理方式 |
| --- | --- |
| 即席新建与库中标签重名 | 不重复建条目，自动转为选中已有标签（name UNIQUE 兜底） |
| 重命名标签 | **不回溯**：已入库记录保留旧文本快照（与「记录只存文本」模型自洽） |
| 删除被记录引用的标签 | 仅删标签库条目；记录文本保留，展示时灰色 chip |
| 标签组合记忆 JSON 损坏 / 缺失 | 降级为空预选，不阻塞输入框 |
| 标签名规则 | trim 后非空、长度上限 20 字（超出拒建 / 拒选） |
| 提交时标签区为空 | 记录 tags 快照为 `'[]'`，与从不打标记录一致 |
| 即席新建标签后提交失败 | 标签库条目保留（标签本身有效，不随提交回滚） |
| 下拉中删除正被选中的标签 | 从标签库删除的同时从当前选中集合移除该 chip；已入库记录上的文本快照不受影响 |
| 下拉中删除被历史记录引用的标签 | 直接删库，不回溯记录文本；记录页该文本灰显（与维护页删除同语义） |

### 约束

- IPC 契约收敛：通道常量与 payload 类型进 `packages/shared`；`tags` 独立域；preload `ShiguangApi` 新增 `tags` 分组；shared 只放契约不放实现；handler 经 `registerIpc()` 单点装配。
- 数据层边界：单 SQLite 文件 `userData/shiguang.db`；迁移沿用 umzug + 自定义 SqliteMigrationStorage（`_migrations` 表），迁移 0004 同步 DDL exec；DAO 不碰磁盘，fs 操作在 handler / service。
- 工程基线沿用：electron-vite 多入口、cjs preload、Tailwind + shadcn 自写 primitives、lucide-react 图标、三层测试策略（纯函数/DAO vitest、组件 vitest + jsdom + testing-library + mock window.api、窗口行为手动走查）。
- blur 时序铁律：标签输入框 onBlur 不得同步收起输入窗口（mousedown 抢跑 click 教训）。
- TDD：rail-code 硬性要求，测试先行。

### 验收标准

1. **打标入库**：输入框选择 / 即席新建多个标签后提交，记录 tags 快照为对应标签名 JSON 数组；一条记录可挂多标签。
2. **即席新建与重名兜底**：输入无匹配标签回车 → 新标签入库（随机色）并被选中；输入与库中重名回车 → 不新建，自动选中已有标签（UNIQUE 不报错）。
3. **标签组合记忆**：提交成功后关窗再开，输入框预选上次提交的标签组合；删除 userData 记忆 JSON 或写入损坏内容 → 打开为空预选，输入框可用。
4. **标签维护页 CRUD**：console「标签」页可新建（trim、非空、≤20 字校验）、重命名、删除（二次确认）；重命名 / 删除后已入库记录的标签文本不变。
5. **记录页展示**：记录行按快照渲染标签 chips，库中存在用库色，已删标签灰显。
6. **按标签筛选**：筛选表单标签多选，选中多个标签时**任一命中即出**（OR）；可与关键词 / 时间范围 / hasImages 组合；不选标签时条件不生效。
7. **迁移正确**：迁移 0004 后存在 tags 表（name UNIQUE）与 records.tags 列（默认 `'[]'`）；旧记录读出 `'[]'` 不报错；down 迁移可回滚。
8. **自动化测试全绿**：`pnpm --filter @shiguang/ai test`、`pnpm --filter @shiguang/desktop test`、根 `pnpm typecheck` 三包通过（现状基线 desktop 125/125、ai 37/37 不回退）。

### REQ 条目与里程碑归属建议

- **新开 `REQ-TAG-*` 域**（推荐，替代 REQ-CAP-06 + REQ-UI-05 拆分方案）：标签能力横跨捕获 / 存储 / UI 三层，强行挂 CAP/UI 会让验收口径分散；独立域条目清晰、变更记录好写。建议条目：
  - `REQ-TAG-01` 输入框打标（chips 多选 + 即席新建 + 标签名规则）
  - `REQ-TAG-02` 标签组合记忆（userData JSON、降级容错）
  - `REQ-TAG-03` console 标签维护页（CRUD、删除不回溯、重命名快照语义）
  - `REQ-TAG-04` 记录页标签展示（库色 / 已删灰色）
  - `REQ-TAG-05` 按标签筛选记录（OR 语义）
  - 每条 REQ 含「粗粒度验收」列，状态「未开始」，并同步追加「变更记录」表。
- **里程碑：不动编号、不新设里程碑**，作为记录查询范畴的独立小迭代落在 M2 之后；若后续有 M2.5 / 查询增强批次，再统一归编。

## 3. 未来场景与扩展预判

- **M5 AI 分析流水线消费标签**：标签已是现成结构化维度（JSON 文本列），M5 可直接参数化查询聚合，无需数据层动作。建议方向：M5 设计时将 tags 快照列作为一等分析字段，不要届时再补结构化。
- **标签库膨胀后的 chips 排序**：当前按库序展示，标签多时找标签变难。建议方向：按使用频次排序（需新增计数来源——可从记录快照统计或引入计数列，届时再定，记入技术债务）。
- **AND 语义 / 多标签交叉筛选**：本期只做 OR。若未来出现「同时命中多个标签」的强需求，建议方向：筛选 UI 增加「匹配模式」切换（OR/AND），SQL 层参数化拼装即可，数据模型无需演进。
- **标签颜色自定义 / 色板治理**：本期颜色随机且不可改。若未来用户反馈颜色不直观，建议方向：维护页加色板选择器（预置色板固定集合，不做自由取色，避免脏色）。
- **标签合并 / 别名**：标签库膨胀后可能产生近义标签。建议方向：维护页加「合并」操作（把一个标签的记录快照文本批量改写为另一个），属写入型治理，届时单独立项。

## 4. 相关引用

- `docs/REQUIREMENTS.md` —— 唯一事实来源：REQ 编号域前缀惯例（REQ-DX/CAP/STORE/UI/APP/AI），状态固定取值与「粗粒度验收」列，变更记录表；本次新增 REQ-TAG-01~05 并追加变更记录
- `packages/ai/src/db.ts` —— better-sqlite3 + umzug 装配，自定义 SqliteMigrationStorage（`_migrations` 表），migrations 数组登记点（新增 0004_tags）
- `packages/ai/src/dao/captureDao.ts` —— DAO 现状与既有债务（缺 getById、listCaptures 与 queryCaptures 并存）；tagDao 新建即收敛 list/create/rename/delete
- `packages/shared/src/index.ts` —— IPC 通道常量与 payload 类型集中地（新增 tags 域通道与类型）
- `apps/desktop/src/main/ipc/` —— handler 按域拆文件、registerIpc() 汇总注册；新增 tagsHandlers.ts
- `apps/desktop/src/main/screenshot/screenshotService.ts` —— userData 路径惯例参照（`path.join(app.getPath('userData'), ...)`）；本次新建标签记忆模块无 settings 类 JSON 先例
- `apps/desktop/src/preload/index.ts` —— contextBridge 分组暴露 window.api（capture/console/input/pet），新增 tags 分组；`apps/desktop/src/renderer/env.d.ts` 引用 ShiguangApi
- `apps/desktop/src/renderer/console/` —— App.tsx 装配层（useState<ConsolePage>）、SideNav（ConsolePage 类型 + NAV_ITEMS）、RecordsPage（筛选表单三条件扩展第四条件）、RecordRow（chips 展示挂载点）、components/ui/dialog.tsx（删除二次确认惯例）
- `apps/desktop/src/renderer/input/features/capture/capture-form.tsx` —— 输入框编辑器（Lexical）；chips 区挂编辑器与底部操作条之间；blur 时序铁律；提交按钮 600ms 闪现；成功后清空编辑器
- 输入窗口尺寸：`apps/desktop/src/main/` 输入窗装配（840×440 固定、frameless + transparent + alwaysOnTop、resizable:false）——新增标签区需评估纵向空间
- `apps/desktop/src/main/ipc/__tests__/captureHandlers.test.ts`（或同级测试）—— `vi.mock('electron')` mock `app.getPath` 现成范式（标签记忆模块测试复用）
