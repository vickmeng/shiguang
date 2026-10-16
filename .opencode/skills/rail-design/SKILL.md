---
name: rail-design
description: 将已确认的 proposal 转化为 design.md 以及从零创建 tasks.md（具体代码修改任务）。
---

# rail-design

Rail 工作流第二阶段。

## 输入

- 参数 `Slug`（command 注入）。若为空，用 `question` 工具询问后停止。

## 流程

整个流程分为 **验证**、**方案对齐**、**文档生成与确认** 三个阶段。

### 验证

1. 检查 `.rail/changes/<slug>/proposal.md` 是否存在；若不存在，告知用户先运行 `/rail-proposal`。
2. 读取 `.rail/changes/<slug>/status`，确认内容为 `pending-design`。若不是，报告状态并停止。

### 方案对齐

由 caller 在派发 subagent 前完成方案选型。

进入本阶段时告知用户：**"当前进入方案对齐阶段。我将和你确认关键决策。"**

1. **读取上下文。** 读取 proposal.md 及相关引用文件。
2. **评审原有代码。** 结合项目规范，审视触及的代码时，主动发现代码坏味道、设计腐化、编码不合规等问题，记录问题与重构理由。
3. **设计方案。** 结合需求结论与原有代码评审结果，参照现有规范、技术栈、分层设计，权衡编程原则与实现成本，产出合理方案。方案决策项包含：是否需要重构、重构范围及理由。
4. **逐项确认。** 遍历每个决策点（含重构决策）：若仅有一个优选方案 -> 直接采纳；若有多个可选方案 -> 调用 `question` 工具，推荐方案放首位并标注 `(Recommended)`。
5. **直接推进到文档生成。**

### 文档生成与后续确认

方案对齐完成后直接进入以下流程。

1. **派发 subagent**（`Task`，`subagent_type: rail-design`）。Prompt 嵌入 slug、agreed_design、proposal 关键段落（对齐后的结论，设计稿，需求文档等重要引用的路径）、以及额外上下文。
2. **验证。** 确认 design.md 和 tasks.md 存在且格式正确。
3. **展示文件路径。** 告知用户 design.md 和 tasks.md 已生成，展示其完整文件路径（如 `.rail/changes/<slug>/design.md`、`.rail/changes/<slug>/tasks.md`）。
4. **写入状态。** 用 `Write` 写入 `.rail/changes/<slug>/status`，内容为 `pending-code`。
5. **提示下一步：** `下一步：/rail-code <slug>`。询问用户是否继续。用户肯定后，按 /rail-code 命令流程执行。
