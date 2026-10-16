# 工程基线（desktop）

## 设计决策

- **electron-vite 多入口 + cjs preload**：renderer 双入口（pet.html / input.html）+ preload 独立构建入口输出 cjs，preload 用 `sandbox: false`——cjs 产物在无沙箱下最稳，避免沙箱 polyfill 与打包产物兼容问题；精灵图等资源经 vite import 进 bundle，`files: out/**` + `asar: false` 已覆盖打包，无需 electron-builder 额外配置。
- **Tailwind + shadcn primitives 自写版**：primitives 入 `renderer/components/ui/`，基于 `cn()`（clsx + tailwind-merge）+ class-variance-authority，无 `@` 别名、以相对路径引入。
- **IPC 契约集中 packages/shared**：通道常量 + payload 类型只放契约不放实现，preload 经 contextBridge 暴露类型化 `window.api`。
- **测试策略三层**：纯函数（windowGeometry/blurSuppress）/ 状态机（stateMachine）/ 组件（vitest + jsdom + @testing-library/react + user-event，mock `window.api`）均可自动化；窗口系统行为（显隐/拖动/焦点）以手动验收为主，靠 AC 走查。

## 技术债务

- [ ] 托盘图标为内嵌占位 PNG，需替换正式应用图标
- [ ] shadcn primitives 为自写版，未接 radix slot（组件语义化/可访问性后续按需要升级）
