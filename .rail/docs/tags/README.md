# 标签系统（tags）

## 设计决策

- **数据模型：tags 表（name UNIQUE、预置色板随机取色）+ records.tags JSON 文本快照列，不做关联表**：与「记录只存文本」模型自洽，按标签筛选对 JSON 文本列参数化 LIKE 即可、零额外迁移；重命名/删除不回溯是快照语义的自洽推论——记录保留旧文本快照，展示时灰显。备选关联表引入 JOIN 复杂度与改名是否级联的争议，本期无需求信号，明确排除。
- **tagDao 新建伊始收敛 list/create/rename/delete 四接口，create 重名返回已有条目**：规避 captureDao 既有债务（缺 getById、listCaptures 与 queryCaptures 并存），标签筛选走 records.tags 列不经 tagDao；重名从 UNIQUE 异常路径收敛为正常返回，渲染层「重名自动转选中」零特判。标签名规则（trim/非空/≤20 字）在 DAO 单点校验，console 维护页与输入框即席新建两条写入路径共用同一 choke point。
- **标签组合记忆走独立主进程小模块 tagMemoryStore（userData/tags-last.json），不经 DAO / 数据库**：记忆属「会话体验」而非用户数据，与 records/tags 两表无关联，入库会引入「记忆随库走」的错误生命周期；文件缺失/损坏降级空数组不阻塞输入框，写用临时文件 + rename 原子替换，读写同步（文件 ~百字节）。
- **TagSelect 自写单组件，交互对标 antd Select mode="tags" 但不引 antd**：antd 的 bundle 重（css-in-js 进输入框入口不可接受）且仓库惯例是自写 primitives；chips 多选/输入过滤/Enter 即席新建/下拉直删/blur 时序用受控 input + 绝对定位下拉完整覆盖；输入框预选记忆与记录页受控筛选两个复用场景经 `allowCreate` / value-onChange / onCreateTag props 分叉，组件内零场景特判，筛选场景 `allowCreate=false`——从筛选框意外建标签会污染标签库。
- **按标签筛选走参数化 LIKE、参数恒带 JSON 引号（`"name"`），不用 json_each**：与 keyword 等既有条件拼装风格一致（total 与 items 共用同一 where）；带引号参数把子串误命中（tag「AI」命中快照 `["AIGC"]`）压到可接受；多标签语义为任一命中（OR），与其他条件间 AND。
- **记录页配色映射由 RecordsPage 拉一次 tags:list 生成 tagColorMap 下发 RecordRow**：N 条记录共享一次 invoke（RecordRow 自取则每行一次且互相不一致），标签库变化一处刷新全列表 chips 配色一致；RecordRow 保持纯展示组件。已删标签色点灰显 `#d4d4d4`，与记忆预选灰显同一语义。
- **capture-form 提交成功后编辑器清空但 chips 不清空**：chips 即「上次组合」的可视呈现，与 tags:lastSet 记忆语义自洽——若提交后清空则用户看到 chips 消失但重开又出现；提交失败路径标签状态全保留（即席新建的标签库条目不回滚）。
- **chips 实心化 + 文字色走 YIQ 亮度工具单点裁决**（`lib/tagTextColor.ts:6 tagTextColor()`，三处渲染共用：tag-select.tsx:71/144、RecordRow.tsx:130、TagsPage.tsx:127）：chip 背景 = tag.color 实底（替代色点 + 灰底），文字色按 YIQ 感知亮度（BT.601 权重，阈值 128）自动切换——亮底 `#1f2937` 深字、暗底白字；非法输入（非 #rgb/#rrggbb）回退深字。灰显语义分叉固定白字不走 YIQ：已删/库外名称实底 `#d4d4d4` + 白字（与记忆预选灰显同一语义，避免「灰底深字」读作普通标签）。

## 技术债务

- [ ] 标签 chips 按库序（id ASC）展示，标签库膨胀后找标签变难；频次排序需新增计数来源（从记录快照统计或引入计数列），届时再定
- [ ] AND 语义/多标签交叉筛选未做（本期仅 OR）；未来有强需求时筛选 UI 加「匹配模式」切换、SQL 参数化拼装即可，数据模型无需演进
- [ ] 标签颜色创建时随机且不可改；色板常量 TAG_COLOR_PALETTE 已在 shared 就位，未来维护页加色板选择器即可（预置集合，不做自由取色）
- [ ] 标签合并/别名未做：库膨胀后可能产生近义标签，合并是写入型治理（批量改写记录快照文本），届时单独立项
- [ ] records.tags 快照列 LIKE 筛选无法走索引、全表扫（与 keyword LIKE 同量级，本地 10^4 级毫秒可接受）；量级上来后评估反向索引表或 FTS，属数据层演进单独立项
- [ ] YIQ 128 阈值是感知亮度的快速近似而非 WCAG 对比度校验：色板中 `#f59e0b`（琥珀）判为亮底配深字，处于深/白文字对比度均可接受的边界带；若未来做色板编辑器或无障碍审查，需按真实对比度（4.5:1）重校阈值或改用对比度算法，tagTextColor 是唯一改动点
