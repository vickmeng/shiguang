---
name: rail-code
description: 按照 design.md 严格执行 TDD 实现变更；tasks.md 的勾选必须与代码改动同一次提交。
---

# rail-code

Rail 工作流第三阶段。

## 输入

- 参数 `Slug`（command 注入）。若为空，用 `question` 工具询问后停止。

## 流程

1. **验证。** 确认 `.rail/changes/<slug>/design.md` 和 `tasks.md` 存在。读取 `.rail/changes/<slug>/status`，确认内容为 `pending-code` 或 `in-progress`。若不是，报告状态并停止。
2. **读取 design.md** 的「实现方案」段落（用于仲裁 subagent 回报的契约矛盾；验收标准由评审阶段把关）。
3. **更新状态。** 若 `.rail/changes/<slug>/status` 内容为 `pending-code`，用 `Write` 改为 `in-progress`。
4. **派发任务。** 读取 tasks.md，解析每条任务的前置条件和目标文件（条目内全部反引号路径，仅用于并发控制）。构建依赖图决定排程（无依赖的并发派，有依赖的串行等待），并告知用户派发策略。每条任务由 `rail-code` subagent 执行（`Task`，`subagent_type: rail-code`），prompt 仅注入 `slug`、任务序号，不内联任务内容。约束：
   - 前置条件全满足才派。
   - 目标文件有交集的任务不同时派。
   完成后逐个验证，通过 -> tick `[x]`，失败 -> 标记并级联阻塞。全部通过后进入步骤 5。

5. **总结。** 列出改动文件、测试通过情况、tasks.md 最终状态。
6. **自动触发评审。** 派发 `rail-review` subagent（`Task`，`subagent_type: rail-review`）。Prompt 嵌入 slug、design_path、`git diff` 指令。
7. **评审结果处理：**
   - **Verdict: pass** -> 进入步骤 8
   - **Verdict: fail** -> 展示问题，自动修复一次：
     a. 派发 rail-code subagent 修复问题（嵌入 review 报告中的具体问题和 spec 上下文）
     b. 重新派发 rail-review
     c. pass -> 进入步骤 8；fail -> 展示问题，报告"评审未通过"，停止
8. **评审通过后收尾：**
   - `Write` 将 `.rail/changes/<slug>/status` 改为 `pending-docs`
   - 报告"评审通过，验收合格"
   - 打印 `下一步：/rail-docs <slug>`，询问用户是否继续
   - 用户肯定 -> 按 /rail-docs 命令流程执行

## 硬性规则

- 不执行 git 操作。
- 不编辑 subagent 白名单之外的文件。禁止修改 `.rail/` 下 spec/proposal、项目规范、git 文件。
- 规范与 spec 矛盾时暴露冲突，不默默选边。
- 所有实现代码必须由 `rail-code` subagent 产出，caller 绝不自己写代码。
