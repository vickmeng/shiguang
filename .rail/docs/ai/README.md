# AI 分析（ai-record-summary 起步）

## 设计决策

- **先分析后入库：AI 分析同步插入 capture:create 入库事务之前，记录 + 摘要单事务落库**：Mastra Agent 对本条文字 + 全部图片产出一句话摘要并做门卫判定；无意义判定或调用失败（断网/限流/未配 Key/超时/空摘要）→ 整链失败不入库、尽力清理已写盘图片、按钮失败态可重试。不选降级入库（不存在「无摘要的记录」）、不选异步 pending/分析中状态（摘要永远与记录同时存在）。
- **分析编排用 Mastra Agent 单步 structured output（zod `{meaningful, summary?}`），不建 workflow、不用 Mastra memory/storage**：本期是「一次 LLM 调用出结构化判定+摘要」的单步语义，无步骤编排/断点续跑需求，workflow 会引入快照存储等无谓复杂度。
- **模型接入用 Mastra 原生 custom endpoint 函数配置（`model: () => MastraModelConfig`，`id/url/apiKey` 直连 Kimi OpenAI 兼容端点），不引 Moonshot 官方 SDK、主进程不加 HTTP client 依赖、不保留 AI SDK provider 直传**：Mastra 运行期 `resolveModelConfig` 在 generate 时才对函数求值，env 读取天然晚于主进程 dotenv 加载，故无需 getAgent 惰性初始化；函数体内 model id 保留 `${string}/${string}` 窄断言即满足 TS 联合类型，无需 unknown cast。默认模型 `kimi-k2.6`（官方多模态示例模型），`KIMI_MODEL` 环境变量在求值时覆盖，`analyses.model` 记 resolveKimiModel() 实际值便于追溯。
- **摘要存 `analyses` 独立表、与 records 严格 1:1（record_id 即 PK + FK ON DELETE CASCADE），不挂 records 列、不做关联表**：摘要来源（模型、时点）与记录本体生命周期不同（prompt 调优后新数据重出），独立表是最简 1:1 扩展；挂列无法记 model，关联表是多对多错配。迭代一不预埋 status/prompt_version/error——失败即不入库，无需状态字段。
- **analyses 写入收敛进 `createCaptureWithAttachments` 的三表事务，不新建 analysisDao**：摘要写入与记录入库是同一事务边界，拆开必然产生中间态或分布式事务；且 captureDao 已有 listCaptures/queryCaptures 并存债务，明确勿制造第三份并存 DAO 接口。`createCapture` 纯文字直写不加 analysis 参数——AI 链路唯一写入口是 createCaptureWithAttachments。
- **读取侧用 `LEFT JOIN analyses` 随 capture:list 带出摘要（1:1 无行膨胀），不做二次查询**：结果行数仍由 attachments 决定，toRecords 聚合与 total COUNT 均不变；二次查询要额外 round trip 且 list/query 两条路径都要接。
- **超时用 `AbortSignal.timeout(60_000)` 经 `agent.generate` 传入，不自写 setTimeout 竞态**：AbortSignal 是 AI SDK/Mastra 的官方取消契约，超时即中止在途 HTTP 请求，自写计时器做不到。
- **门卫无意义与其他 AI 失败在主进程合流为「抛错 + 已写盘图片清理」，渲染层按 shared 常量 `AI_NOT_MEANINGFUL_MESSAGE` 精确匹配 message 区分 toast**：两路径失败态/重试语义相同，仅 toast 文案不同；不新增 IPC 错误码通道，不展示 AI 返回的具体原因（文案稳定性与产品口径）。无意义判定在 handler 层（DAO 不做门卫）。
- **图片读盘转 base64 在 summarizer（packages/ai）内完成，baseDir 经 `setAnalysisImagesBaseDir` 注入**：analyzeCapture 签名只收相对 filePath，磁盘解析只能模块内完成；packages/ai 不依赖 electron，注入模式与 setCaptureDatabase 同，DAO 不碰磁盘铁律不破。
- **grade 经迁移 0006 以可空 TEXT 列入 analyses，不建关联表、不加 CHECK**：analyses 与 records 已 1:1，grade 是摘要同级属性，加列是最小扩展；合法性唯一防线是写入前 zod enum，读出仅透传，与既有「校验收敛应用层」迁移风格一致。
- **迁移 0006 的 down 直接用 `ALTER TABLE analyses DROP COLUMN grade`，不重建表**：better-sqlite3 ^12.11.1 内置 SQLite ≥3.35（2021-03 起）支持 DROP COLUMN，一行 DDL 即可；重建表需复制数据 + 重建 FK/索引，无谓复杂度与风险。
- **grade 缺失与非法用「zod `.optional()` + 天然失败」一语双关，不加应用层分支**：optional 精确表达「缺失通过（存 NULL 不阻塞入库）/ 非法拒绝（整链失败可重试）」，Mastra structured output 解析失败自然抛错，走迭代一既有失败路径（抛错 + 图片清理），代码零新增 catch。
- **分级收敛进既有 summarizer 同一次调用（`{meaningful, summary?, grade?}`），不建独立分级链路**：独立链路 doubles LLM 成本与延迟，且摘要与分级同上下文判定质量更稳；prompt 以第三任务（判「对未来了解用户的价值」）+ zod description 双写判定标准。
- **分级判定引入用户标签作为重点线索：标签语义优先（强调/重要类标签必为 high）、其余从严给 high（宁缺毋滥）、标签不单独构成升级理由**：`analyzeCapture` input 新增 `tags?: string[]`（`packages/ai/src/analysis/summarizer.ts:97`，缺省 `[]`），标签非空时 user content 在文字块后追加「用户为这条记录打的标签：A、B」文本块；判定条款写死在 `SUMMARIZER_SYSTEM_PROMPT`（summarizer.ts:45）第三分级任务 + `analysisOutputSchema.grade.describe` 双处，标签可见但只是线索而非升级依据。tags 由 captureHandlers 调用处透传（`apps/desktop/src/main/ipc/captureHandlers.ts:92`，`tags: payload.tags`），AI 链路与入库共用同一份 payload 标签快照，不单独查标签存储。
- **画像汇总采用全量重写（每轮输出全新 `ProfileDocument`，旧画像与新摘要仅作参考输入），不采用「只加不改」增量合并**：久未提及或习惯已变的内容靠下轮重写自然淘汰，无漂移累积；全量重写指令写死在 `PROFILER_SYSTEM_PROMPT`（`packages/ai/src/profile/profiler.ts`，独立常量）。REQUIREMENTS 宏观设计的「只加不改」与「主题不预存、汇总时 AI 现抽」两个口径同时被推翻。
- **画像槽位为固定 5+1 模板（shared `ProfileDocument` 六槽位），AI 只允许填空数组、不允许发明新槽位；不设 schema_version**：模板变更直接重跑汇总即可，不留版本迁移字段；schema 用 zod `.strict()` + 六槽全必需，缺/多槽位统一收敛为解析抛错、视同汇总失败，旧画像保留、绝不落坏 JSON（`packages/ai/src/profile/profiler.ts` 的 `profileOutputSchema`）。
- **`analyses.profiled_at` 为「曾作为输入参与汇总」的打戳出队语义，而非「出现在当前画像中」；画像写入与批量打戳同一事务**（`packages/ai/src/dao/profileDao.ts` 的 `saveProfileWithStamp`）：打戳即出队、不再入下轮批次；拆分事务会出现「画像已写打戳失败」（同批重复喂入浪费 LLM）或「打戳成功画像失败」（摘要永久出队、数据丢失）的中间态。记录删除不做联动——画像内容为自由文本不引用 record id，被删记录靠下轮重写自然稀释；MEM-02 闭环标准「可溯源到记录」作废，以记录页「已入像」徽标替代。
- **后台任务竞争态收敛为通用 `SingleFlightRunner` 原语（`apps/desktop/src/main/lib/singleFlight.ts`），调用方永远不经手 running 标志**：「检查→置位」原子性依赖置位先于首个 await 的 JS 单线程不变量，拷贝散落实现易写错；业务层（profileRunner）只留触发判定，future 后台任务复用同一原语（计时语义 `lastAttemptAt` 随原语白送）。
- **汇总编排放主进程 profileRunner（capture 钩子与 10min 定时器两类入口在此交汇），不放 renderer、不放 DAO**：renderer 无法感知后台任务生命周期，DAO 保持纯数据访问。触发规则 = 待汇总 ≥5 / 距上次尝试 ≥24h 且有积压 / 首跑（独立常量 `RETRY_INTERVAL_MS`/`TIMER_INTERVAL_MS`，`apps/desktop/src/main/profile/profileRunner.ts`）；「距上次」基准 = `lastAttemptAt ?? profiles.updated_at` 且失败同样推进——否则持续失败下定时器每 10 分钟重试一次 LLM。
- **画像汇总为派生层，失败路径与迭代一「先分析后入库」同步铁律相反：capture 成功后 fire-and-forget 触发判定，绝不阻塞入库**（`apps/desktop/src/main/ipc/captureHandlers.ts` 钩子挂在 return 之后、try/catch 之外，`.catch(console.error)` 收尾）：失败语义 = 队列不动、旧画像保留、画像页失败态可手动重试；AI 输出 schema 校验失败走同一失败路径，绝不落坏数据。

## 技术债务

- [ ] 记录编辑联动摘要/分级失配：当前记录无编辑能力，未来引入编辑后摘要与 grade 同样失配——编辑功能立项时须把「编辑触发摘要重跑」作为其需求一部分；本期不预埋 prompt_version
- [ ] AI 分析成本与隐私规模化压力：逐条实时上云（文字+全部图片按 token 计费）随记录量累积成本与暴露面；出现批量导入/高频记录场景时评估本地小模型兜底或降频策略，届时单独立项
- [ ] 内置 `kimi-code-plan-cn` router provider 可进一步简化模型接入（届时可删 custom endpoint 函数配置，直接传 provider 模型 id 字符串、依赖其内置 KIMI_API_KEY 认证）；当前不采用：官方 provider 模型列表不含 kimi-k2.6，且 `KIMI_MODEL` 任意模型覆盖语义须保留
- [ ] prompt 调优无重跑机制：SUMMARIZER_SYSTEM_PROMPT 调优后只能用新数据验证，旧摘要不升级；未来若需升级须单独立项重跑工具（届时再加 prompt_version）
- [ ] 汇总失败无冷却/重试策略：画像汇总维持规则触发原样（待汇总 ≥5 条 / 距上次尝试 ≥24h 且有积压 / 首次首跑），AI 持续失败下无冷却与退避，仅由 pending>=5 规则自然重试；「距上次」基准 lastAttemptAt ?? profiles.updated_at，失败同样推进（24h 规则不造成反复重试）；未来如需冷却/退避，应在 profileRunner 增设 lastErrorAt + 退避窗口并同步画像页失败态展示
- [ ] profiled_at 打戳后摘要不再入队：打戳语义为「曾作为输入参与汇总」，已打戳摘要不重进待汇总队列；画像 prompt 调优后旧画像下轮即重写，但存量已打戳摘要不会重新喂入（影响：prompt 大改后画像对历史记录的覆盖滞后；偿还：未来如需「全量重跑画像」须新增清除 profiled_at 的工具，单独立项）
