# Proposal: M4 选区截图入库（m4-region-screenshot）

## 1. 背景与动机

拾光（ShiGuang）M1「捕获与入库」与 M2「查询页面」已交付：用户可通过输入框把文字存入 SQLite，并通过后台窗口浏览、搜索、删除。但信息收集目前只有文字一条通道——看到一张值得保存的图，用户没有任何方式把它收进拾光。

M4「选区截图」（REQ-CAP-03）补齐这条通道：类微信的全屏遮罩选区截图，截图图片直接入库。**本次只入库、不理解**——图片理解（AI 看图）是 M6 能力，M4 不做任何预留。M4 完成后，「信息收集能力健全」，是 M5 AI 段的前置。

本次同时兑现 M3 顺延过来的多显示器评估：全屏遮罩覆盖全部屏幕，用户可在任意一屏完成选区。

关于历史方案：M1 曾设计过全局热键触发截图，随范围裁剪整体废弃，本次**不复活热键方案**；M1 还设计过 records + attachments 两表 + type 枚举 + userData/images/ UUID 文件名，同样被裁剪，但历史 design 可作参考。已对齐附件模式方向：「图片存文件系统、库存路径，复用 records 表 source_app 模式」。

## 2. 需求与范围

### 功能描述

构建类微信交互的全屏选区截图能力：用户在输入框底部工具栏点击「区域截图」图标 → 全屏进入遮罩 → 拖拽选区 → 确认裁剪 → 图片落盘入库 → 后台记录页可见。

1. **触发入口**：输入框底部工具栏常驻「区域截图」图标按钮（类微信输入框截图入口）；宠物右键维持「直接 toggle 输入框」现行行为不动；不复活 M1 已废弃的全局热键方案。
2. **截图交互**：electron-snapora 库自建遮罩选区（无 kiosk、官方 preload 集成、`tools:[]` 精简标注工具），类微信交互（遮罩 → 选区 → 裁剪）；全屏遮罩覆盖全部屏幕，可在任意一屏选区（兑现 M3 顺延的多显示器评估）。（换库背景：原定 desktopCapturer + 透明置顶选区窗为 proposal 预设，design 阶段改选 electron-screenshots，M4 交付后因其实作硬编码 kiosk:true 会在 macOS 打开截图时隐藏其他应用，最终更换为 electron-snapora@^1.0.25，并以 Electron 33→44 升级为前置。）
3. **图片入库**：图片写入磁盘，records 表记录路径（已对齐附件模式：图片存文件系统、库存路径，复用 records 表 source_app 模式）。**只入库，不理解**（图片理解是 M6 AI 能力）。
4. **记录页适配**：图片记录以缩略图展示；删除图片记录时级联清理磁盘文件。
5. **内容类型筛选启用**：记录页筛选追加「全部 / 文字 / 图片」三选（启用 M2 预留的 REQ-UI-02 扩展位）。

### 范围边界

**M4 做：**

- 输入框底部工具栏新增「区域截图」图标入口（宠物右键行为不变）。
- 全屏遮罩选区截图窗口：electron-snapora 库自建遮罩选区，类微信交互（遮罩 → 选区 → 裁剪）；遮罩覆盖全部屏幕，任意一屏可完成选区。
- 图片落盘 + records 表入库（图片存文件系统、库存路径；具体数据模型设计留给 rail-design 技术设计阶段定夺）。
- 捕获逻辑放 `apps/desktop` 主进程内，不独立成包（M4 选型 README 既定决策）。
- 记录页适配：图片记录缩略图展示、图片记录删除级联清理磁盘文件。
- 记录页内容类型筛选启用：「全部 / 文字 / 图片」三选。
- IPC 链路扩展：`screenshot:save` / `screenshot:fail` 通道（snapora preload 回传，换库前为 `screenshot:start` 输入框信号）/ `screenshot:done` 回推 / `capture:copy-image`，payload 类型进 `packages/shared`；preload `window.api` 增加 screenshot 相关 API（反馈订阅），并合入 snapora 官方 `exposeScreenshotApi` 供输入框发起截图。
- 数据层改造：`packages/ai` 新增迁移扩展 records 表（迁移文件注释明确「M4 以新迁移扩展」）；DAO 扩展（`createCapture` 的 sourceApp 语义在截图场景需定义；`queryCaptures` 对象化入参的扩展位启用内容类型维度；`deleteCaptures` 单事务批量删改为级联清理磁盘文件）。

**M4 不做（明确排除）：**

- 图片理解 / AI 看图：M6 能力，本次不做任何预留。
- 输入框粘贴图片：维持现状（「暂不支持」提示保留）。粘贴与截图是两个独立入口，本次不动输入框。
- 全局热键触发：M1 已废弃方案，不复活。
- 存储膨胀 / 孤儿文件治理：归 M9 导出/迁移统一设计，本次仅记录技术债务。
- 图片路径契约演进（目录调整 / 格式转换）：本次不实现，记入技术债务（见第 3 节）。

### 边缘场景处理（已对齐）

| 场景 | 处理方式 |
| --- | --- |
| 极小选区 / 手滑误触发 | 照常入库（产品决策，不设阈值拦截） |
| 磁盘写盘失败（磁盘满 / 权限） | 整体失败，不产生记录；用户看到失败提示后自行重试 |
| 删除图片记录时磁盘文件清理失败 | 简单方案：记录照删、文件尽力清理（用户对领域不熟，采用最简方案并记录技术债务） |
| 磁盘图片文件被手动删除但记录还在 | 记录页显示「图片丢失」占位（灰色图标 + 文字），记录仍可删除 |

### 约束

- 窗口管理既定基线沿用：窗口创建幂等、显隐状态机集中主进程、几何计算纯函数化可单测。选区窗口为第 4 个 renderer 入口 + 第 4 个窗口模块，形态参考 pet 浮窗（frameless + transparent + alwaysOnTop + skipTaskbar）。
- IPC 契约收敛：通道 payload / 返回类型进 `packages/shared`；preload 的 `ShiguangApi` 分组扩展；shared 只放契约不放实现。
- 工程基线沿用：electron-vite 多入口、cjs preload（sandbox:false 既定决策）、Tailwind + shadcn 自写 primitives、三层测试策略（纯函数 / 状态机 / 组件 vitest+RTL，窗口行为手动走查）。
- 数据层边界：单 SQLite 文件 `userData/shiguang.db`，M4 以新迁移扩展 records 表，不改动 M1 既有字段语义。

### 验收标准

输入框底部工具栏点击「区域截图」图标 → 全屏遮罩出现（覆盖全部屏幕）；拖拽选区 → 确认裁剪 → 图片落盘且 records 表产生记录；后台记录页可见图片记录缩略图；筛选切「图片」仅显示图片记录、切「文字」仅显示文字记录、切「全部」两者皆显；删除图片记录后磁盘文件被级联清理；磁盘文件被手动删除的图片记录显示「图片丢失」占位且仍可删除；磁盘写盘失败时不产生任何记录并提示失败；删除时文件清理失败记录照删。

## 3. 未来场景与扩展预判

- **存储膨胀 / 孤儿文件治理**：随着截图积累，孤儿文件（记录已删但清理失败、写盘中断残留）会膨胀。建议应对方向：**本次不做**，归 M9 导出/迁移统一设计；本次已在删除级联处记录技术债务。
- **图片路径契约演进**：M6 AI 读图、M9 导出打包都依赖路径稳定；未来可能出现目录调整、格式转换。建议应对方向：路径集中由 DAO / 迁移层管理，演进走迁移不改业务代码。用户对领域不熟，此为设计建议方向，记入技术债务待 design 定夺。
- **删除文件清理失败强化**：M4 采用「记录照删、文件尽力清理」最简方案，失败时产生孤儿文件。建议应对方向：后续迭代可引入清理失败重试 / 启动时孤儿文件扫描，与 M9 存储治理一并设计。
- **内容类型维度继续扩展**：M4 启用「全部 / 文字 / 图片」三选后，未来可能出现更多内容类型（如 M6 分析结果、M9 导入的外部内容）。建议应对方向：复用 M2 预留、M4 启用的类型筛选模式与 DAO 对象化入参，新增类型只加枚举不改查询结构。

## 4. 相关引用

- `docs/REQUIREMENTS.md` —— REQ-CAP-03（M4 选区截图，唯一需求条目）；REQ-UI-02（M2 预留的记录筛选扩展位）；M4 完成即「信息收集能力健全」，M5 AI 段前置
- `.rail/changes/m2-records-console/proposal.md` —— 上一迭代；内容类型筛选延后约定（M4 兑现）
- `.rail/changes/m1-capture-ingest/design.md` —— 历史 design：records + attachments 两表 + type 枚举 + userData/images/ UUID 文件名（范围裁剪已删除，非现行契约，仅供参考）；M1 已废弃的全局热键方案（不复活）
- `packages/ai/src/dao/captureDao.ts` —— 现有 `createCapture({text, sourceApp?})` / `queryCaptures` 对象化入参（M4 内容类型扩展位）/ `deleteCaptures` 单事务批量删（「M1 无附件无需级联」注释，M4 必改）
- `packages/ai` 迁移目录（`0001_init`）—— 迁移文件注释「M4 以新迁移扩展」；单文件 `userData/shiguang.db`
- `README.md` —— M4 选型既定决策（历史预设）：desktopCapturer + 透明置顶选区窗口；design 阶段实际改选 electron-screenshots，M4 交付后因 kiosk:true 隐藏其他应用问题更换为 electron-snapora@^1.0.25（详见 design.md 换库修订）。捕获逻辑放 `apps/desktop` 主进程内不独立成包（不变）
- `apps/desktop` 窗口模块 —— 三窗模式参考：pet 浮窗（frameless + transparent + alwaysOnTop + focusable:false）、input 浮窗（显隐状态机集中主进程最完整参考）、console 后台窗（`console:open` 信号通道 + 幂等惰性唤起）；窗口创建全部幂等；blur 抑制 300ms 纯函数；几何计算纯函数化可单测
- `apps/desktop/src/renderer/console/pages/RecordsPage.tsx` —— 当前按纯文字渲染（line-clamp 预览、复制按钮写 text），M4 适配图片渲染 / 删除级联
- `apps/desktop/src/preload/index.ts` —— preload `window.api`，需加 screenshot 相关 API
- `apps/desktop` IPC 链路 —— `capture:create` 通道 payload `{text: string}`（M4 需扩展或新增通道）；所有 handler 经 `registerIpc()` 单点装配
- `electron.vite.config.ts` —— renderer 入口需加第 4 个 html 入口
