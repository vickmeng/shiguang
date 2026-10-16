---
name: rail-docs
description: 从已交付变更中提取设计决策和技术债务，记录到 .rail/docs/ 以指导后续迭代。
---

# rail-docs

Rail 工作流第五阶段。从已交付变更中提取设计决策和技术债务，指导后续迭代。

## 输入

- 参数 `Slug`（command 注入）。若为空，用 `question` 工具询问后停止。

## 流程

1. **验证。** 确认 `<slug>`；读取 `.rail/changes/<slug>/status`，确认内容为 `pending-docs`。若不是，报告状态并停止。
2. **计算路径：**
   - `change_dir` = `<root>/.rail/changes/<slug>/`
   - `docs_dir` = `<root>/.rail/docs/`
3. **派发 subagent**（`Task`，`subagent_type: rail-docs`）。Prompt 嵌入两个绝对路径，指令：读取 change_dir，判断 docs_dir 下哪些领域需要更新或新建，执行写入，返回结构化摘要。
4. **展示摘要。** subagent 返回后，原样展示其返回的摘要块。
5. **更新状态。** `Write` 将 `.rail/changes/<slug>/status` 改为 `done`。
6. **询问下一步。** 用 `question` 工具询问用户选择：
   - 进化（/rail-evolve）-> 按 /rail-evolve 命令流程执行
   - 结束 -> 流程完成

## 硬性规则

- 不要修改源码、测试或 `design.md`。仅限 `.rail/docs/` 下的迭代指南文档。
- 不要触碰 git。
- 若 subagent 判断无需更新（无新增决策或债务），这也是有效结果 -- 明确说明，不要凑数。
