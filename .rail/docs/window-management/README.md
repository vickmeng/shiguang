# 窗口管理

## 设计决策

- **双 BrowserWindow 架构**：宠物窗 frameless + transparent + alwaysOnTop + skipTaskbar + `focusable: false`，输入框为可聚焦的 frameless 浮窗；不选单窗口内嵌——宠物的透明/点击穿透/拖动语义与输入框可编辑语义冲突，独立窗口边界更清晰。
- **显隐状态机集中主进程**：输入框可见性与收起逻辑全部在 `inputWindow.ts` 模块内，renderer 只发信号（`pet:clicked` / `input:blur` / `input:close`），宠物窗 `focusable: false` 不接受焦点、输入框是唯一可聚焦窗口。
- **blur 抑制 300ms 窗口用纯函数**：`blurSuppress.ts` 的 `shouldSuppressPetClick(suppressUntil, now)` 解决「点空白收起 → 同一次点击穿透到宠物又打开」的时序竞争闪振，纯函数可单测锁定行为。
- **窗口几何纯函数化**：`computePetPosition`（主屏右下角留边距）与 `computeInputPosition`（宠物旁弹出、靠边自动翻转、越界夹紧到 workArea）均为纯 TS，可单测；多显示器与位置持久化本次不做，M3 一并评估。

## 技术债务

- [x] IPC 注册分散：`pet:clicked` 在 petWindow.ts、`input:blur`/`input:close` 在 inputWindow.ts 内注册，未汇入 `registerIpc` 汇总点（结构偏差；未来新增 handler 时顺手治理）——M2 已收敛：`registerPetWindowIpc`/`registerInputWindowIpc` 汇入 `registerIpc`，capture/console handler 同点注册
- [ ] `input:close` 不记 blur 抑制，与 design 字面有偏差（行为合理留档：反馈完成后主动收起无需防点击穿透；`input:blur` 才走抑制路径）
