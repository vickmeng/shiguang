# AI 分析（ai-record-summary 起步）

## 设计决策

- **先分析后入库：AI 分析同步插入 capture:create 入库事务之前，记录 + 摘要单事务落库**：Mastra Agent 对本条文字 + 全部图片产出一句话摘要并做门卫判定；无意义判定或调用失败（断网/限流/未配 Key/超时/空摘要）→ 整链失败不入库、尽力清理已写盘图片、按钮失败态可重试。不选降级入库（不存在「无摘要的记录」）、不选异步 pending/分析中状态（摘要永远与记录同时存在）。
- **分析编排用 Mastra Agent 单步 structured output（zod `{meaningful, summary?}`），不建 workflow、不用 Mastra memory/storage**：本期是「一次 LLM 调用出结构化判定+摘要」的单步语义，无步骤编排/断点续跑需求，workflow 会引入快照存储等无谓复杂度。
- **模型接入用 `@ai-sdk/openai` 的 `createOpenAI` 自定义端点接 Kimi（OpenAI 兼容），不引 Moonshot 官方 SDK、主进程不加 HTTP client 依赖**：Mastra 官方即以 AI SDK 模型提供方为模型层，集成路径最短且零额外 HTTP 依赖。默认模型 `kimi-k2.6`（官方多模态示例模型），`KIMI_MODEL` 环境变量可覆盖，`analyses.model` 记 resolveKimiModel() 实际值便于追溯。
- **摘要存 `analyses` 独立表、与 records 严格 1:1（record_id 即 PK + FK ON DELETE CASCADE），不挂 records 列、不做关联表**：摘要来源（模型、时点）与记录本体生命周期不同（prompt 调优后新数据重出），独立表是最简 1:1 扩展；挂列无法记 model，关联表是多对多错配。迭代一不预埋 status/prompt_version/error——失败即不入库，无需状态字段。
- **analyses 写入收敛进 `createCaptureWithAttachments` 的三表事务，不新建 analysisDao**：摘要写入与记录入库是同一事务边界，拆开必然产生中间态或分布式事务；且 captureDao 已有 listCaptures/queryCaptures 并存债务，明确勿制造第三份并存 DAO 接口。`createCapture` 纯文字直写不加 analysis 参数——AI 链路唯一写入口是 createCaptureWithAttachments。
- **读取侧用 `LEFT JOIN analyses` 随 capture:list 带出摘要（1:1 无行膨胀），不做二次查询**：结果行数仍由 attachments 决定，toRecords 聚合与 total COUNT 均不变；二次查询要额外 round trip 且 list/query 两条路径都要接。
- **超时用 `AbortSignal.timeout(60_000)` 经 `agent.generate` 传入，不自写 setTimeout 竞态**：AbortSignal 是 AI SDK/Mastra 的官方取消契约，超时即中止在途 HTTP 请求，自写计时器做不到。
- **门卫无意义与其他 AI 失败在主进程合流为「抛错 + 已写盘图片清理」，渲染层按 shared 常量 `AI_NOT_MEANINGFUL_MESSAGE` 精确匹配 message 区分 toast**：两路径失败态/重试语义相同，仅 toast 文案不同；不新增 IPC 错误码通道，不展示 AI 返回的具体原因（文案稳定性与产品口径）。无意义判定在 handler 层（DAO 不做门卫）。
- **图片读盘转 base64 在 summarizer（packages/ai）内完成，baseDir 经 `setAnalysisImagesBaseDir` 注入**：analyzeCapture 签名只收相对 filePath，磁盘解析只能模块内完成；packages/ai 不依赖 electron，注入模式与 setCaptureDatabase 同，DAO 不碰磁盘铁律不破。

## 技术债务

- [ ] 记录编辑联动摘要失配：当前记录无编辑能力，未来引入编辑后摘要必然失配——编辑功能立项时须把「编辑触发摘要重跑」作为其需求一部分；本期不预埋 prompt_version
- [ ] AI 分析成本与隐私规模化压力：逐条实时上云（文字+全部图片按 token 计费）随记录量累积成本与暴露面；出现批量导入/高频记录场景时评估本地小模型兜底或降频策略，届时单独立项
- [ ] prompt 调优无重跑机制：SUMMARIZER_SYSTEM_PROMPT 调优后只能用新数据验证，旧摘要不升级；未来若需升级须单独立项重跑工具（届时再加 prompt_version）
