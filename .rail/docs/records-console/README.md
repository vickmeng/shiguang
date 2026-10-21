# 记录查询后台（records-console）

## 设计决策

- **后台为第三个独立 BrowserWindow + 第三 renderer 入口（普通系统窗口形态）**：frame 保留、resizable、非置顶非透明，与宠物/输入框双浮窗形态完全不同；不选「输入框内嵌后台面板」——浮窗与常驻工作窗口形态、职责均冲突。沿用窗口管理既定基线（幂等创建、closed 清引用），但不随 app ready 创建，由 `console:open` 惰性唤起。
- **`console:open` 为信号通道而非状态通道**：renderer 只发信号，主进程全权决定 open/focus/restore；不选 renderer 先查询窗口状态再决定——renderer 拿不到可信窗口状态，徒增往返。
- **`queryCaptures` 入参对象化**（`{keyword?, since?, until?, page, pageSize}`）：为 M4 内容类型维度留扩展位，避免加维度时位置参数签名推倒重来。
- **搜索用参数化 LIKE 包含匹配，M2 不引 FTS5**：个人记录回看定位下数万条走 created_at DESC 索引扫已够用；出现真实卡顿再升 FTS5 虚拟表，对 DAO 接口透明。
- **单删/批删统一 `deleteCaptures(ids)`**：单删 = 单元素数组，删除路径唯一；旧 `deleteCapture` 无生产调用方，移除不保留两个导出。
- **时区语义集中 renderer，DAO 只认 ISO**：created_at 存 UTC ISO 8601；「今天/7天/30天」预设与自定义区间的本地时区边界均由 renderer 换算为 `since`/`until` 传入，DAO 侧 `until` 含边界秒（`created_at <= ?`）。
- **查询结果扁平化 LEFT JOIN（records LEFT JOIN attachments，每记录至多一行附件）**：imagePath 上提为 CaptureRecord 字段而非返回嵌套附件结构——当前每记录至多一附件，嵌套徒增接口面；未来真出现多附件时需改返回结构（与 attachments 表设计同源）。
- **类型筛选启用 M2 预留扩展位**：`QueryCapturesPayload.type` 缺省=全部，记录页 segmented 三选自写 Tailwind 按钮组（aria-pressed），不引第三方组件；新增内容类型只加枚举不改查询结构。
- **复制语义按行类型分流**：图片行复制按钮=主进程 `clipboard.write([ClipboardItem])`（W3C 异步写，Electron 44 升级后同步 `clipboard.writeImage` 路径不再可用，handler 已适配；invoke，需访问磁盘文件必须经主进程）；文字行维持 renderer `navigator.clipboard.writeText` 不变。
- **筛选区由 TanStack Form 驱动，快捷预设 = 「给 RangeTimePicker 赋值并触发查询」的快捷键**：时间值唯一来源为选择器（起/止 datetime-local 精确到秒，always 可见），不存在独立预设状态——「全部」=清空起止、「今天/7d/30d」=给选择器赋对应区间；不引第三方日期组件，保持零新增依赖。

## 技术债务

- [ ] LIKE 包含匹配在超大库（数万条以上）下可能变慢（影响：高频使用数月后搜索卡顿；缓解：每页分页限制 + 索引扫，真出现卡顿再上 FTS5，对 DAO 接口透明）
- [ ] `listCaptures` 与 `queryCaptures` 并存（影响：DAO 接口面冗余；取舍：前者服务无筛选整表场景与 M1 既有测试，后续迭代可再收敛）
- [ ] `capture:copy-image` 按 id 取单条记录走 `queryCaptures` 全量拉取（pageSize=MAX_SAFE_INTEGER）后 find——DAO 缺 getById 接口，记录量大后每次复制扫全表；DAO 补单条查询时顺手收敛
- [ ] 删除无软删除/回收站，二次确认弹窗为唯一兜底（取舍：产品已对齐；M9 导出前如有需要再评估）
