---
name: rail-quick
description: 快捷处理小需求 -- 零文档、无 slug，直接 TDD 实现并展示结果。
---

# rail-quick

Rail 工作流快捷模式。

快捷模式适用于**小需求**：bug 修复、简单调整、文案/样式改动、单文件优化等。它跳过 proposal/design/review 阶段，直接派生 rail-quick-code subagent 执行 TDD。

如果需求影响面超出小需求范畴，你必须**中断**并建议用户改用 `/rail-proposal`。

## 输入

- 用户输入（command 注入的 `User input`）。可能包含图片引用。

## 流程

### 1. 理解上下文（对话优先）

进入本链路前通常已与用户有过对话。基于已有对话先自行阅读理解需求。

- 若依然理解不足或信息缺失 -> 派发 `rail-context-reader` subagent（`Task`，`subagent_type: rail-context-reader`）。Prompt 嵌入 `query` = 用户需求全文（含关键词、文件路径等）。subagent 返回结构化摘要，基于摘要补全理解。
- 若描述模糊但可快速澄清 -> 用 1 次 `question` 工具（最多 1-2 个问题）快速确认。

理解到位后进入下一步。

### 2. 构建并公布计划（含影响面确认）

在内存中构建 quick_design（不落地文件）：description、acceptance_criteria（2-3 条）、affected_files。

判断影响面是否超出"小需求"范畴（波及不相关模块、涉及公共代码、配置/契约层、新增独立功能模块、跨技术层等）。若超出 -> 用 `question` 工具让用户选择继续 quick 或改用 propose。若影响面可控，直接继续。

向用户公布完整计划：改动文件列表 + AC + 影响面评估。公布后不等待确认，直接继续。

### 3. 派发 rail-quick-code subagent

`Task`，`subagent_type: rail-quick-code`。Prompt 嵌入 quick_design。

### 4. 运行验证

subagent 返回后：主动检查 diff 确认改动范围是否与 affected_files 预期吻合。运行相关测试确保通过无回归。运行类型检查（如有）。

### 5. 展示结果与归档提示

1. **展示结果。** 展示改动摘要、测试报告、实际 diff。
2. **提示归档。** 询问用户是否归档：`是否将本次变更的设计决策与技术债务归档到 .rail/docs/？` 用户肯定后 -> 派发 `rail-quick-docs` subagent（`Task`，`subagent_type: rail-quick-docs`）。Prompt 嵌入 `diff_summary`（用只读 `git diff` 获取变更内容，非状态修改操作）、`quick_design`（可选）、`docs_dir`。完成后展示归档摘要。用户跳过 -> 结束。

## 硬性规则

- 不创建 `.rail/changes/` 下的任何文件。
- 不分配 slug，不管理 status。
- 不触发 review。
- 影响面判断由本 skill 全权负责。
- 不要执行 commit、push、branch 或任何 git 状态修改操作（只读 `git diff` 除外）。
- 不要编辑项目源码（由 subagent 完成）。
