# 区域截图（screenshot）

## 设计决策

- **截图库选 electron-snapora@^1.0.25，遮罩窗由库自建自管，不进三窗架构、不加第 4 个 renderer 入口**（换库修订，原为 electron-screenshots@0.6.2）：换库动因是 electron-screenshots 硬编码 kiosk:true，macOS 打开截图会隐藏其他应用；snapora 无 kiosk/无 fullscreen/禁用 type:'panel'（Space-safe 窗口策略且有单测断言）、零原生模块零运行时依赖、官方 preload 集成（`exposeScreenshotApi` → `window.electronSnapora`）、`tools:[]` 官方精简标注工具、权限处理完善（getMediaAccessStatus 检测，denied 自动打开系统设置并返回 PERMISSION_DENIED）；注意 getMediaAccessStatus 只反映 TCC 记录、可能滞后于真实抓帧结果，排查以真实 `desktopCapturer.getSources` 探针为准、Uint8Array structured clone 传输无 base64。Electron 44 升级为其前置（peer>=42）。遮罩窗生命周期仍全自管，拾光侧零窗口状态机负担。
- **保存链路拆出库无关 `saveScreenshot(buffer)` 管线**（写盘 → createImageCapture → 推 `screenshot:done`）：库只负责出 buffer，落盘/入库/反馈在独立管线函数，换库只改 handler 接线不动数据链路；**先落盘再入库**——写盘失败整体失败，尽力 unlink 残留文件、推 `{ok:false}`、DB 零记录；会话幂等靠模块级标志位。
- **snapora 接入经 `setupElectronSnapora({ipcMain, validateSender})`**：validateSender 只放行 `file:` 协议 + dev origin，收窄 preload 回传 IPC 的发送方面；`screenshot:save`（Uint8Array buffer）/ `screenshot:fail` 由 handler 接进 saveScreenshot 管线；`unregisterSnapora()` 挂 `before-quit` 防退出期残留监听。
- **Electron 44 连带适配：`capture:copy-image` 由同步 `clipboard.writeImage` 改 W3C 异步 `clipboard.write([ClipboardItem])`**：Electron 44 起同步剪贴板写图片 API 路径不再可用，handler 已适配异步写。
- **两表 records + attachments + records.type 列，不选单表 image_path 宽列**：附件模式承载 mime/size 并为未来多附件留路，M9 导出打包需稳定契约；DB 只存相对 userData 根路径，绝对路径不进库，路径契约集中 DAO/迁移层、演进走迁移不改业务代码。
- **记录页读图走自定义 protocol `shiguang-image://`**：不选 base64 入 DB（SQLite 膨胀、分页负重）、data URL、file://（打包态受 asar/权限限制且暴露绝对路径）；文件名 basename 白名单化 + isSubPath 防目录穿越，越界/非 .png/不存在一律返 404 空 Response，渲染端 onError 兜底「图片丢失」占位，记录仍可删。
- **删除级联 DAO 单事务「先查附件路径 → 删 attachments → 删 records」并返回路径列表，fs 清理在 handler 尽力而为**：不选 DAO 内碰磁盘（违反数据层边界），不选清理失败回滚删除（产品已对齐「记录照删、尽力清理」）。
- **截图反馈走 `screenshot:done` 主→宠物窗推送**（触发通道已换：`screenshot:start` 随 electron-screenshots 移除，改 snapora `capture({locale:'zh-CN', tools:[], defaultTool:'select'})` 直接发起、结果经 `screenshot:save`/`screenshot:fail` 回主进程）：截图会话生命周期完全在主进程（库事件驱动），renderer 无可轮询状态；不选 invoke 长等待或 renderer 轮询，推送一次到位，宠物窗 toast 轻提示。
- **入口在输入框工具栏图标按钮（点击调 `window.electronSnapora.capture({locale:'zh-CN', tools:[], defaultTool:'select'})`），不在宠物右键菜单**：输入框是捕获中枢，截图与文字捕获同处一个交互面，类微信输入框截图按钮心智。**反面教训**：M4 曾实作「宠物右键原生 Menu 弹菜单（pet:menu 通道）」方案，编码后被产品纠正撤销——右键是 toggle 输入框的既有肌肉记忆，叠加菜单打断交互流；`pet:menu`/Menu.popup/preload pet.menu 已整体移除，宠物右键恢复直接 toggle。反馈 toast 落宠物窗不变（输入框于遮罩期间已收起）。

## 技术债务

- [ ] snapora 动作按钮（undo/redo/save/pin/copy/cancel）无官方开关，无法随 `tools:[]` 一并隐藏（只藏标注工具）；save/pin 等动作与拾光自管落盘语义并存，待产品真机走查确认可接受
- [ ] snapora 会话结束后 `hostWindow.focus()` 可能重新唤起输入窗，待真机确认影响
- [ ] `shiguang-image://` 协议须同步各 html 入口 CSP（console.html 曾漏配 img-src 致记录页图片全部显示「图片丢失」占位）；新增自定义 protocol 时需逐一核对所有渲染该资源的 html 入口，组件测试（jsdom 不加载 html 元数据）覆盖不到
- [ ] ESC/取消键行为完全随 electron-snapora 库，不自定义（取消路径无副作用，风险面小；回滚条件中库兼容问题为整体回滚触发器之一）
- [x] ~~屏幕录制权限未授予时库返回空白图~~（snapora 已解：getMediaAccessStatus 检测 + denied 自动打开系统设置返回 PERMISSION_DENIED）
