# 记录查询后台（records-console）

## 设计决策

- **后台为第三个独立 BrowserWindow + 第三 renderer 入口（普通系统窗口形态）**：frame 保留、resizable、非置顶非透明，与宠物/输入框双浮窗形态完全不同；不选「输入框内嵌后台面板」——浮窗与常驻工作窗口形态、职责均冲突。沿用窗口管理既定基线（幂等创建、closed 清引用），但不随 app ready 创建，由 `console:open` 惰性唤起。
- **`console:open` 为信号通道而非状态通道**：renderer 只发信号，主进程全权决定 open/focus/restore；不选 renderer 先查询窗口状态再决定——renderer 拿不到可信窗口状态，徒增往返。
- **`queryCaptures` 入参对象化**（`{keyword?, since?, until?, hasImages?, page, pageSize}`）：为内容维度留扩展位，避免加维度时位置参数签名推倒重来。
- **搜索用参数化 LIKE 包含匹配，M2 不引 FTS5**：个人记录回看定位下数万条走 created_at DESC 索引扫已够用；出现真实卡顿再升 FTS5 虚拟表，对 DAO 接口透明。
- **单删/批删统一 `deleteCaptures(ids)`**：单删 = 单元素数组，删除路径唯一；旧 `deleteCapture` 无生产调用方，移除不保留两个导出。
- **删除级联 DAO 单事务「先查附件路径 → 删 attachments → 删 records」并返回路径列表，fs 清理在 handler 尽力而为**：不选 DAO 内碰磁盘（违反数据层边界），不选清理失败回滚删除（产品已对齐「记录照删、尽力清理」）。
- **时区语义集中 renderer，DAO 只认 ISO**：created_at 存 UTC ISO 8601；「今天/7天/30天」预设与自定义区间的本地时区边界均由 renderer 换算为 `since`/`until` 传入，DAO 侧 `until` 含边界秒（`created_at <= ?`）。
- **查询结果 LEFT JOIN + JS 侧按 record_id 聚合 `imagePaths: string[]`**（修订原「每记录至多一附件、imagePath 上提单字段」）：一记录挂 N 行 attachments，JOIN 行按记录序 + 附件 id 升序组装有序数组；不选 SQL `GROUP_CONCAT` 再 split（类型不安全、路径含分隔符即出错），不选每记录只返首图（共N张角标与复制首图仍需完整数组）；每页 ≤100 条，reduce 开销可忽略。
- **含图筛选走 `hasImages?: boolean` 的 `EXISTS(attachments)` 派生**（迁移 0003 已 `DROP COLUMN type`）：true=仅含图 / false=仅无图 / 缺省=全部，items 与 total 共用同一 WHERE 组；不选保留 type 列双写（图文混合记录无法用单值 type 表达，正是删列导火索），不选 has_images 布尔列（仍是冗余派生列）。历史 `type='image'` 行无数据搬迁，attachments 行仍在，EXISTS 派生天然正确。
- **document 列双写：完整版式入 `records.document`（Lexical EditorState JSON，可空），拍平值做读模型**：写入与 text/attachments 同事务；本期读侧不消费，为「记录编辑」功能预埋（`editor.parseEditorState(document)` 无损还原，ImageNode 反序列化时从 attachments 重建 objectURL）；M1/M4 老行 NULL；不选只存拍平值（版式丢失，编辑只能有损重建）。
- **复制语义按有无图片分流**：有图记录复制首图（`capture:copy-image` invoke 挪入 captureHandlers.ts，取 `imagePaths[0]`，handler 内 W3C 异步 `clipboard.write([ClipboardItem])`，Electron 44 起同步 `clipboard.writeImage` 路径不再可用）；纯文字记录走 renderer `navigator.clipboard.writeText`。
- **筛选区由 TanStack Form 驱动，快捷预设 = 「给 RangeTimePicker 赋值并触发查询」的快捷键**：时间值唯一来源为选择器（起/止 datetime-local 精确到秒，always 可见），不存在独立预设状态——「全部」=清空起止、「今天/7d/30d」=给选择器赋对应区间；不引第三方日期组件，保持零新增依赖。
- **记录行渲染由 `imagePaths.length > 0` 派生**（原 `record.type === 'image'` 分支随迁移 0003 删除）：首图缩略 + 多图「共N张」角标（>1 时）+ 展开态纵向全列单图。
- **记录页读图走自定义 protocol `shiguang-image://`**（自原 screenshot 领域迁入，protocol 随截图删除保留为图片读通道）：不选 base64 入 DB（SQLite 膨胀、分页负重）、data URL、file://（打包态受 asar/权限限制且暴露绝对路径）；文件名 basename 白名单化 + isSubPath 防目录穿越，越界/非 .png/不存在一律返 404 空 Response，渲染端 onError 兜底「图片丢失」占位，记录仍可删。
- **展示层序列化选型：官方 `@lexical/html` 取代手写 `parseDocument`**（修复图文同段落丢字 bug——手写解析器含"image 节点独占段落"假设，丢弃同段文字）：`documentToHtml`（`apps/desktop/src/renderer/components/rich-capture-preview.tsx:56`，核心序列化函数）用 `editor.parseEditorState()` + `$generateHtmlFromNodes(editor, null)` 导出 HTML，天然忠实版式且 format（加粗/斜体）免费获得；未来新增节点类型只需注册 Node 类，不再自行维护结构假设。
- **装饰节点必须显式 `exportDOM()`**：Lexical 官方明确 decorate() 的 JSX 不进导出 HTML，默认导出只用 createDOM() 元素（本项目 ImageNode 的 createDOM 是空 span，会导出空内容）；故 `ImageNode.exportDOM()`（`apps/desktop/src/renderer/input/features/capture/image-node.ts:58`，装饰节点的 DOM 导出方法）按官方 prescribed 做法显式返回 `<img>`。
- **headless 编辑器用 `createEditor({ disableEvents: true })`**：`documentToHtml`（rich-capture-preview.tsx:58）不走官方 `createHeadlessEditor`——0.52 核心包未导出该符号（它在 `@lexical/headless` 包），disableEvents:true 即其等价本质，避免多引一个依赖。
- **img 协议 URL 重写时机：官方序列化之后、入 React 之前**（`documentToHtml` 内 DOMParser 阶段，rich-capture-preview.tsx:86）：DOMParser 解析导出的 HTML，每个 img 的 src 只取 basename 重写为 `shiguang-image://<basename>`（协议只认 basename，与旧 RecordRow imageSrc 逻辑一致）；导出 HTML 无 class，版式由容器 Tailwind arbitrary variant（`[&_p]:…`/`[&_img]:…`，rich-capture-preview.tsx:49）施加。
- **document 三级兜底渲染 record.text**：document 为 null / JSON 损坏或 parseEditorState 抛错 / 导出 HTML 为空或纯空白 → 回退单个 `<p>`（rich-capture-preview.tsx:103）；收起 max-h-40+渐变遮罩、展开不限高行为保留，由父级 expanded 驱动。

## 技术债务

- [ ] LIKE 包含匹配在超大库（数万条以上）下可能变慢——keyword 与标签筛选（records.tags 快照列，无法走索引）均为 LIKE 全表扫（影响：高频使用数月后搜索/筛选卡顿；缓解：每页分页限制 + 索引扫，真出现卡顿再上 FTS5，对 DAO 接口透明）
- [ ] `listCaptures` 与 `queryCaptures` 并存（影响：DAO 接口面冗余；取舍：前者服务无筛选整表场景与 M1 既有测试，m4-graphic-capture 确认本次不收敛）
- [ ] `capture:copy-image` 按 id 取单条记录走 `queryCaptures` 全量拉取（pageSize=MAX_SAFE_INTEGER）后 find——DAO 缺 getById 接口，记录量大后每次复制扫全表；DAO 补单条查询时顺手收敛
- [ ] 删除无软删除/回收站，二次确认弹窗为唯一兜底（取舍：产品已对齐；未来导出迭代前如有需要再评估）
- [ ] `documentToHtml` 内 root.type 兼容 shim 约 3 行（rich-capture-preview.tsx:70）：官方 parseEditorState 要求 root 带 `type:"root"`，缺该字段被静默吞成空文档；为不动 RecordRow/RecordsPage 既有测试的手写极简 fixture 而加。偿还：把这些 fixture 改为真实 EditorState 构造（参考 rich-capture-preview.test.tsx 写法）后可删 shim
- [ ] 录入端图片行内插入未改：capture-form `$insertNodes` 仍可能产生图文同段落 document。展示端已能忠实渲染该形态，无用户可见问题；但 records.text（getTextContent）不携带图文相对位置信息，若将来依赖纯文本重建混排需重估
- [ ] `dangerouslySetInnerHTML` 渲染导出 HTML（rich-capture-preview.tsx:104）：当前内容 100% 来自用户本机编辑器数据，XSS 风险可忽略；若未来 document 来源放开（导入/同步）需重新评估
