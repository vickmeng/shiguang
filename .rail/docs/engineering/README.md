# 工程基线（desktop）

## 设计决策

- **electron-vite 多入口 + cjs preload**：renderer 三入口（pet.html / input.html / console.html，M2 起 console 为后台管理入口）+ preload 独立构建入口输出 cjs，preload 用 `sandbox: false`——cjs 产物在无沙箱下最稳，避免沙箱 polyfill 与打包产物兼容问题；精灵图等资源经 vite import 进 bundle，`files: out/**` + `asar: false` 已覆盖打包，无需 electron-builder 额外配置。
- **Tailwind + shadcn primitives 自写版**：primitives 入 `renderer/components/ui/`，基于 `cn()`（clsx + tailwind-merge）+ class-variance-authority，无 `@` 别名、以相对路径引入。
- **IPC 契约集中 packages/shared**：通道常量 + payload 类型只放契约不放实现，preload 经 contextBridge 暴露类型化 `window.api`。
- **Electron 44.9.1 + electron-vite 6 + better-sqlite3 12.11.1 基线**（M4 换库迭代一并完成升级）：动因是 electron-snapora peer electron>=42，必须升级才能换掉硬编码 kiosk 的 electron-screenshots；better-sqlite3 11 依赖的 API 在 Electron 44 V8 已移除，故同步升 12。升级后 desktop 125/125、ai 37/37 全绿。
- **原生模块统一 external + postinstall ABI rebuild 模式**（M4 换库后仅余 better-sqlite3 一个原生模块）：主进程 rollup `external` 不打包、运行时 require，postinstall 用 @electron/rebuild 对齐 Electron ABI；node-screenshots 随 electron-screenshots 一并移除，不再需 rebuild 覆盖；现行 `asar: false` 下原生模块天然 unpacked，不增 asarUnpack 配置。
- **Electron 二进制走 npmmirror 镜像**（`.npmrc` 加 `electron_mirror=https://npmmirror.com/mirrors/electron/`）：升级 Electron 版本后 postinstall 下载官方二进制超时失败（"Electron uninstall"），换 npmmirror 镜像修复；属工程基线环境决策，后续升版本无需再处理下载源。
- **dev 环境屏幕录制权限排查配方**（macOS 26.5.2 实测）：dev 态裸 Electron 二进制的屏幕录制授权归到"启动它的终端/编辑器"名下（进程链 Electron → zsh → login → Zed.app），双击 Electron.app 不触发拾光（权限系统认 inode 不认路径）；多副本 Electron 会在 TCC 累积脏授权记录，表现为"授权了但不生效"，修复用 `tccutil reset ScreenCapture <bundle-id>`（如 com.github.Electron、dev.zed.Zed）定点清或全局重置，清后下次抓帧重新弹授权框；判断探针用临时 electron 脚本跑 `systemPreferences.getMediaAccessStatus('screen')` + 真实 `desktopCapturer.getSources` 各一次，区分"状态记录问题"与"真实抓帧被拦"；招行联软 UniAccessLite 安全 agent 已实测不拦截屏幕录制，排除企业管控嫌疑；macOS 26（Tahoe）屏幕录制授权每周重新确认属正常机制非故障。
- **测试策略三层**：纯函数（windowGeometry/blurSuppress）/ 状态机（stateMachine）/ 组件（vitest + jsdom + @testing-library/react + user-event，mock `window.api`）均可自动化；窗口系统行为（显隐/拖动/焦点）以手动验收为主，靠 AC 走查。CSP 等 html 级安全策略与自定义 protocol（如 `shiguang-image:`）的联调不在 jsdom 组件测试覆盖内（jsdom 不加载 html 元数据），属真机走查必查项：每新增自定义 protocol，需同步所有渲染该资源的 html 入口 CSP。

## 技术债务

- [ ] 托盘图标为内嵌占位 PNG，需替换正式应用图标
- [ ] shadcn primitives 为自写版，未接 radix slot（组件语义化/可访问性后续按需要升级）
- [ ] 删除图片记录文件清理失败产生孤儿文件，无重试/扫描，随 M9 存储治理设计
- [x] ~~electron-snapora 单人维护、0 star 0 fork、npm 包龄约 2 个月，生态成熟度低~~ 已随截图功能整体删除（REQ-CAP-03 废弃）连带清偿：卸载依赖、移除全部装配代码，拾光零屏幕录制权限依赖
- [x] ~~snapora macOS 签名打包验证未做~~ 已无效：截图功能删除，不再有签名验证依赖
