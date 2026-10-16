---
name: rail-ask
description: 查询项目知识--优先从 .rail/docs/ 文档中回答，不足时自动深入代码分析。
---

# rail-ask

Rail 工作流查询模式。

本 skill 是**只读**的，不修改任何文件，不创建变更记录。

## 输入

- 用户输入（command 注入的 `User input`）。自然语言问题。

## 流程

### 1. 获取上下文摘要

派发 `rail-context-reader` subagent（`Task`，`subagent_type: rail-context-reader`）。Prompt 嵌入 `query` = 用户问题全文（含关键词、文件路径等）。

### 2. 回答输出

基于上下文摘要回答用户问题。采用总分结构：先给结论，再展开详情。

## 硬性规则

- 不修改任何文件。
- 不创建 `.rail/changes/` 下的任何文件。
- 不分配 slug，不管理 status。
- 明确标注信息来源。
- 优先文档，代码兜底。
