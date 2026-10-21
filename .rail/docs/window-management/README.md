# 窗口管理

## 设计决策

- **双浮窗 + 独立后台窗的三窗架构**：宠物窗 frameless + transparent + alwaysOnTop + skipTaskbar + `focusable: false`，输入框为可聚焦的 frameless 浮窗；后台（console）窗为普通系统窗口（frame 保留、resizable、非置顶非透明），独立第三 BrowserWindow + 第三 renderer 入口，不随 app ready 创建、由 `console:open` 惰性唤起。不选单窗口内嵌——宠物的透明/点击穿透/拖动语义与输入框可编辑语义冲突；也不选输入框内嵌后台面板——浮窗与常驻工作窗口形态、职责冲突，独立窗口边界更清晰。
- **显隐状态机集中主进程**：输入框可见性与收起逻辑全部在 `inputWindow.ts` 模块内，renderer 只发信号（`pet:clicked` / `input:blur` / `input:close`），宠物窗 `focusable: false` 不接受焦点、输入框是唯一可聚焦浮窗。
- **console 入口为信号通道而非状态通道**：renderer 只发 `console:open`，主进程全权决定打开/聚焦/恢复（`openConsoleWindow()` 幂等）；不选 renderer 查询窗口状态再决定——renderer 拿不到可信窗口状态，徒增往返。
- **宠物右键维持「直接 toggle 输入框」（pet:clicked 信号，M4 未变）**：M4 曾实作「右键弹原生 Menu 菜单（pet:menu 通道，含区域截图/打开输入框两项）」，编码后被产品纠正撤销——右键 toggle 是既有肌肉记忆，菜单打断交互流；`pet:menu`/Menu.popup/preload pet.menu 已整体移除。教训：宠物窗交互入口变更需产品先确认，右键语义不轻易动。
- **blur 抑制 300ms 窗口用纯函数**：`blurSuppress.ts` 的 `shouldSuppressPetClick(suppressUntil, now)` 解决「点空白收起 → 同一次点击穿透到宠物又打开」的时序竞争闪振，纯函数可单测锁定行为。
- **窗口几何纯函数化**：`computePetPosition`（主屏右下角留边距）与 `computeInputPosition`（宠物旁弹出、靠边自动翻转、越界夹紧到 workArea）均为纯 TS，可单测；多显示器与位置持久化本次不做，M3 一并评估（M3 已暂缓，重启该需求时一并评估）。

## 技术债务

- [x] IPC 注册分散：`pet:clicked` 在 petWindow.ts、`input:blur`/`input:close` 在 inputWindow.ts 内注册，未汇入 `registerIpc` 汇总点（结构偏差；未来新增 handler 时顺手治理）——M2 已收敛：`registerPetWindowIpc`/`registerInputWindowIpc` 汇入 `registerIpc`，capture/console handler 同点注册
- [ ] `input:close` 不记 blur 抑制，与 design 字面有偏差（行为合理留档：反馈完成后主动收起无需防点击穿透；`input:blur` 才走抑制路径）
