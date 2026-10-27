# Proposal: ai-user-profile

## 1. 背景与动机

拾光项目（Electron + pnpm monorepo：apps/desktop、packages/ai、packages/shared）进入 AI 段迭代二·用户画像，对应 REQUIREMENTS.md 的 MEM-02（画像生成）与 MEM-03（画像页 + 记录页联动）。依赖规划：迭代二 ← 迭代一（已完成）→ 迭代三（知识库问答）、迭代四（主动洞察）。

迭代一「AI 逐条理解」已交付：Mastra Agent 单步 structured output 对每条记录产出摘要 + grade 三档。本迭代基于逐条摘要向上汇出**用户画像**——一份可展示、可联动、可为后续迭代（知识库问答常驻注入 LLM、主动洞察）提供结构基础的派生文档。

项目 Rail 工作流规范见 .opencode/skills/rail-proposal/SKILL.md 与 .rail/docs/ 各域 README；AI 段实现遵循 Mastra 官方最佳实践（docs.mastra.ai），智能产物全存 sqlite 单文件，零新增第三方依赖。

## 2. 需求与范围

### 功能描述

**MEM-02 画像生成（主进程后台汇总）**

- **汇总执行**：**全量重写**——每轮汇总把「上一版画像文档 + 本批待汇总摘要（summary + grade + tags + createdAt）」作为 AI 参考输入，输出一份全新画像；旧表述可被改写、移动槽位、淘汰；用户习惯变化、久未关注的内容要更新掉；无漂移累积。旧的画像与新记录都只是 AI 的参考输入。编排形态与模型接入方式在 design 阶段定（沿用项目已锁定 AI 选型：Mastra + Kimi）。
- **模板**：固定 **5+1 槽位**：身份概况 / 最近关注 / 兴趣爱好 / 在意的事 / 长期方向 / 其他。槽位集合在需求层锁定，AI 只填内容、不允许发明新槽位；条目为一句话以内纯文本。模板的具体结构定义（schema / prompt）在 design 阶段产出。
- **触发规则**：待汇总队列 ≥5 条新摘要，或距上次汇总 ≥24h 且有积压 → 主进程后台自动汇总（不阻塞记录入库与界面）；画像页「立即汇总」按钮手动随时触发；首次启用（从未成功汇总过）只要有积压即触发，存量摘要自然入队完成首跑。**不设单次条数上限**。
- **待汇总队列语义**：analyses 中 `profiled_at IS NULL` 的摘要；FIFO，汇总成功后批量打时间戳。
- **存储（迁移 0007）**：
  1. `ALTER TABLE analyses ADD COLUMN profiled_at TEXT NULL`——「曾参与过汇总」时间戳（语义 = 曾作为输入参与过某次汇总）；
  2. 新建 `profiles` 表单行（id=1 CHECK 单例）：document JSON + updated_at。
  画像写入与打戳同一事务。
- **失败语义**：画像是派生层——汇总失败**绝不阻塞记录入库**；队列保留、画像页可见失败态、手动可重试。
- **模型**：沿用项目已锁定 AI 选型（Mastra + Kimi），零新增配置项；具体模型与接入方式在 design 阶段定。

**MEM-03 画像页 + 记录页联动（renderer console）**

- console SideNav 扩展「画像」独立页（在现有 记录/标签/设置 基础上扩 ConsolePage 联合类型）。
- **画像页**：6 槽位分区展示，纯只读无编辑入口；空槽位隐藏（有内容才出分区）；状态栏 = 上次汇总时间 + 待汇总条数 + 汇总中/失败态 + 「立即汇总」按钮；空态（从未汇总）= 引导文案 + 「立即汇总」（存量首跑入口）。
- **纳入标记（替代溯源）**：记录页表格行摘要旁「已入像」徽标（analyses.profiled_at 非空）；详情弹窗元信息行复用同一徽标（仿 GradeBadge 单点导出先例）。**MEM-02 闭环标准「可溯源到记录」作废**，改为「记录页可见每条记录是否已被纳入画像分析」。
- **新 IPC**：`profile:get`（画像文档 + 上次汇总时间 + 待汇总数 + 进行中/失败态）、`profile:summarize`（手动触发，单飞）。shared 新增 ProfileDocument 类型（6 槽位）与 `CaptureRecord.aiProfiledAt?: string | null`。
- **数据通路**：列表 SELECT LEFT JOIN analyses 已带全量字段，profiled_at 随 JOIN 带出，零新增查询。

### 范围边界

**本期明确要做**：上述 MEM-02 / MEM-03 全部内容；迁移 0007；profile:get / profile:summarize 两条 IPC 全链路（shared 常量 + 主进程 handler + registerIpc + preload 四触点）；记录页与详情弹窗「已入像」徽标；画像页（含状态栏、空态、立即汇总）。

**本期明确不做**：

- sqlite-vec 向量索引（迭代三）
- 主动洞察推送（迭代四）
- 画像编辑/反馈入口
- 画像历史版本保留
- `profiles.schema_version` 字段（届时模板变更直接重跑汇总）
- 自动重试冷却策略（记技术债务）
- 记录编辑联动约定（编辑功能单独立项）

**边缘问题处理（节点 2 对齐结论）**：

- **并发触发：单飞串行**——汇总进行中自动触发跳过、手动按钮禁用并显示「汇总中」，绝不并行两次 LLM 调用。
- **AI 持续失败**：不新增冷却/重试策略，维持规则触发原样，记技术债务条目。
- **AI 输出 schema 校验失败**（缺槽位/多槽位/格式坏）：视同汇总失败——旧画像原样保留、本批队列不动、画像页失败态可重试；绝不把坏 JSON 落库。
- **记录删除与画像延迟一致**：接受——被删记录不再入新输入，旧画像表述靠后续全量重写自然稀释淘汰；不做联动删除。

**口径修订（显式记录）**：

1. 固定 5+1 槽位模板**取代** REQUIREMENTS 宏观设计中「主题不预存，画像汇总时由 AI 现抽」——槽位即固定主题。
2. MEM-02 闭环标准由「可溯源到记录」改为「记录页可见已纳入画像标记」。
3. 原「只加不改」口径被全量重写模式取代（旧表述可淘汰）。

### 验收标准

1. 录一条 → 摘要入库 → 队列满 5 条自动汇总 → 画像页出现新内容
2. 记录页表格行可见该记录「已入像」与否
3. 汇总失败：记录正常入库，画像页显示失败且可手动重试
4. 久不关注的话题从「最近关注」槽位中消失（全量重写生效）

## 3. 未来场景与扩展预判

- **迭代三知识库问答常驻注入画像**：届时画像结构演进**不留 schema_version**，模板变更直接重跑汇总生成新画像即可。建议应对方向：本期即锁定「全量重写 + 无版本字段」的简化模型，避免提前为不存在的迁移需求付设计成本。
- **未来「记录编辑」功能会重跑摘要**：现在不做联动约定，编辑功能单独立项时再设计。建议应对方向：本期保持摘要层（analyses）与画像层（profiles）职责单一，编辑联动作为独立变更重新对齐。

## 4. 相关引用

需求对齐阶段参考的项目文档与源码位置：

- `.opencode/skills/rail-proposal/SKILL.md`、`.rail/docs/` 各域 README——Rail 工作流规范与项目知识
- `REQUIREMENTS.md`——AI 段迭代规划（MEM-02/03 及迭代依赖）
- `packages/ai/src/analysis/summarizer.ts`——迭代一 summarizer 现状（Agent 接入、超时、schema/prompt 组织方式），design 阶段的主要参考
- `packages/ai/src/dao/captureDao.ts`——DAO/事务现状（模块级连接注入、三表事务、SELECT_RECORDS_JOIN 加 profiled_at 处）与既有债务教训（勿造第三份并存接口），design 阶段参考
- `packages/ai/src/migrations/`——迁移机制（单文件 {name, up, down}，db.ts migrations 数组手工登记；0005/0006 为模板）；`apps/desktop/src/main/index.ts`（initDatabase 一次调用 + setXxxDatabase 注入）
- `apps/desktop/src/main/ipc/captureHandlers.ts`——失败合流先例（handler 层合流、shared 常量匹配 toast）；profile 失败不阻塞入库与其相反，需新路径
- `apps/desktop/src/renderer/console/App.tsx`（page 三元链需扩）、`components/SideNav.tsx`（ConsolePage + NAV_ITEMS）——UI 落点
- `apps/desktop/src/renderer/console/pages/RecordRow.tsx`（六列 tr）、`record-detail-dialog.tsx`（GradeBadge 单点导出复用先例）——徽标落点
- IPC 四触点：shared IPC 常量 + 主进程 handler + `registerIpc.ts` + preload（ShiguangApi 接口 + contextBridge + env.d.ts）
- 测试模式：vitest + jsdom + @testing-library + mock window.api
