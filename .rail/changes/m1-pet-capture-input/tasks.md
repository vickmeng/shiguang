---
slug: m1-pet-capture-input
derived_from: .rail/changes/m1-pet-capture-input/design.md
---

# Tasks — m1-pet-capture-input

## 实现任务

### apps/desktop 依赖与脚手架

- [x] 任务 1：调整 `apps/desktop/package.json` 依赖——dependencies 新增 `@tanstack/react-form`、`pixi.js`、`clsx`、`tailwind-merge`、`class-variance-authority`、`lucide-react`，并将 `react`、`react-dom` 从 devDependencies 移入 dependencies；devDependencies 新增 `@testing-library/react`、`@testing-library/user-event`、`jsdom`、`@types/react`、`@types/react-dom`、`tailwindcss`、`postcss`、`autoprefixer`。
  - **前置条件**：无
  - **对应验收标准**：AC-11
  - 验证方式：`pnpm install` 成功，`pnpm typecheck` 通过。

- [x] 任务 2：创建 Tailwind 脚手架——新增 `apps/desktop/tailwind.config.ts`（content 覆盖 `src/renderer/**/*.html` 含 pet.html 与 input.html）与 `apps/desktop/postcss.config.js`，新建 `apps/desktop/src/renderer/index.css` 写入 `@tailwind base; @tailwind components; @tailwind utilities;` 及全局样式（html/body 无 margin、透明背景适配宠物窗口）。
  - **前置条件**：`[1]`
  - **对应验收标准**：AC-11
  - 验证方式：`pnpm dev` 构建不报错，产物 CSS 含 Tailwind 基础样式。

- [x] 任务 3：创建 shadcn 基础件——`apps/desktop/src/renderer/input/lib/utils.ts` 实现 `cn(...inputs)`（clsx + tailwind-merge 合并）；在 `apps/desktop/src/renderer/components/ui/` 生成 `button.tsx`、`textarea.tsx`、`label.tsx` 三个 shadcn 风格 primitive（基于 cn + class-variance-authority，lucide-react 仅作可选图标依赖不强制使用）。
  - **前置条件**：`[2]`
  - **对应验收标准**：AC-5
  - 验证方式：`pnpm typecheck` 通过；capture-form 任务中实际 import 编译通过。

### packages/shared

- [x] 任务 4：扩展 `packages/shared/src/index.ts`——新增 `IPC` 通道常量对象（`captureCreate: 'capture:create'`、`petSetState: 'pet:set-state'`、`inputBlur: 'input:blur'`、`inputClose: 'input:close'`、`petClicked: 'pet:clicked'`）与 `CreateCapturePayload` 接口（`{ text: string }`），保留现有 `CaptureRecord` 不变。
  - **前置条件**：无
  - **对应验收标准**：AC-9
  - **关键契约**：
    ```ts
    export const IPC = { captureCreate: 'capture:create', petSetState: 'pet:set-state', inputBlur: 'input:blur', inputClose: 'input:close', petClicked: 'pet:clicked' } as const;
    export interface CreateCapturePayload { text: string }
    ```

### 纯逻辑与状态机（TDD，先写测试）

- [x] 任务 5：创建 `apps/desktop/src/main/lib/windowGeometry.ts` 并实现两个纯函数——`computePetPosition(workArea, margin)` 返回主屏工作区右下角坐标（`x = workArea.x + workArea.width - 128 - margin`，`y = workArea.y + workArea.height - 104 - margin`，即宠物窗口 128×104 留边距不贴 Dock）；`computeInputPosition(petBounds, inputSize, workArea, gap)` 返回输入框定位（默认宠物左侧弹出 `flipped: false`，左侧空间不足时翻到右侧 `flipped: true`），并对结果做越界修正夹紧到 workArea 内。
  - **前置条件**：无
  - **对应验收标准**：AC-1、AC-3
  - **关键契约**：
    ```ts
    export interface Rect { x: number; y: number; width: number; height: number }
    export function computePetPosition(workArea: Rect, margin: number): { x: number; y: number }
    export function computeInputPosition(petBounds: Rect, inputSize: { width: number; height: number }, workArea: Rect, gap: number): { x: number; y: number; flipped: boolean }
    ```
  - TDD：先写 `windowGeometry.test.ts`（默认右下角、左翻右、越界夹紧至少 5 例），再实现。

- [x] 任务 6：创建 `apps/desktop/src/main/lib/blurSuppress.ts` 并实现两个纯函数——`nextSuppressUntil(now, delayMs = 300)` 返回 `now + delayMs`；`shouldSuppressPetClick(suppressUntil, now)` 返回 `now < suppressUntil`。
  - **前置条件**：无
  - **对应验收标准**：AC-3
  - **关键契约**：
    ```ts
    export function nextSuppressUntil(now: number, delayMs?: number): number
    export function shouldSuppressPetClick(suppressUntil: number, now: number): boolean
    ```
  - TDD：先写 `blurSuppress.test.ts`（300ms 内 true、边界外 false、默认参数为 300 三例），再实现。

- [x] 任务 7：创建 `apps/desktop/src/renderer/pet/core/animations.ts`——导出 `AnimationDef` 接口（`{ row: number; frames: number; fps: number; loop: boolean }`）与 `ANIMATIONS` 注册表，M1 只注册 `idle: { row: 0, frames: 6, fps: 8, loop: true }`。
  - **前置条件**：无
  - **对应验收标准**：AC-1
  - **关键契约**：
    ```ts
    export interface AnimationDef { row: number; frames: number; fps: number; loop: boolean }
    export const ANIMATIONS: Record<string, AnimationDef> = { idle: { row: 0, frames: 6, fps: 8, loop: true } }
    ```
  - TDD：先写 `animations.test.ts`（idle 配置值断言、注册表可新增条目两例），再实现。

- [x] 任务 8：创建 `apps/desktop/src/renderer/pet/core/stateMachine.ts`——实现 `createStateMachine(defs, opts)`（纯 TS，不 import Pixi）：返回 `{ play(state, opts?), onChange(listener), current, notifyFinished() }`；`play` 对未注册状态返回 `false` 拒绝；优先级表 `opts.priority` 中高优先级可打断低优先级，低优先级不可打断高优先级（`force` 可强制）；`loop: false` 的动画由渲染层在播完后调 `notifyFinished()` 自动回落 `opts.fallback` 状态；每次状态变化触发 `onChange` 回调并返回取消订阅函数。
  - **前置条件**：`[7]`
  - **对应验收标准**：AC-1
  - **关键契约**：
    ```ts
    export function createStateMachine(
      defs: Record<string, AnimationDef>,
      opts: { fallback: string; priority?: Record<string, number> }
    ): { play(state: string, opts?: { force?: boolean }): boolean; onChange(l: (s: string, d: AnimationDef) => void): () => void; readonly current: string; notifyFinished(): void }
    ```
  - TDD：先写 `stateMachine.test.ts` 覆盖切换、优先级打断、低优先级被拒、一次性回落 fallback、非法状态拒绝五类场景，再实现。

### 主进程窗口 / 托盘 / IPC

- [x] 任务 9：创建 `apps/desktop/src/main/windows/petWindow.ts`——`createPetWindow()` 创建 frameless 透明宠物窗口：`frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, focusable: false, hasShadow: false, width: 128, height: 104`，加载 `pet.html`；监听渲染进程发来的 `pet:clicked` 并转发给输入框显隐协调逻辑（导出 `onPetClicked(cb)` 供 inputWindow 模块注册）。
  - **前置条件**：`[5]`
  - **对应验收标准**：AC-1
  - 拖动由渲染端 CSS `-webkit-app-region: drag` 实现，本文件不含拖动逻辑。

- [x] 任务 10：创建 `apps/desktop/src/main/windows/inputWindow.ts`——`createInputWindow()` 创建 frameless 输入框窗口（`frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, width: 360`），初始隐藏；模块内维护显隐状态与 `suppressUntil` 变量，导出协调接口：输入框 blur 或 `input:close` 时收起并 `suppressUntil = nextSuppressUntil(Date.now())`；`pet:clicked` 到达时若 `shouldSuppressPetClick(suppressUntil, Date.now())` 为 true 则忽略，否则 toggle（可见则收起、隐藏则经 `computeInputPosition` 定位到宠物旁并显示、聚焦）。
  - **前置条件**：`[5, 6, 9]`
  - **对应验收标准**：AC-3、AC-8
  - 窗口状态机行为以手动验收为主（AC-3 走查）。

- [x] 任务 11：创建 `apps/desktop/src/main/tray.ts`——`createTray()` 用应用图标创建系统托盘（`new Tray(icon)`），菜单含「退出」一项，点击执行 `app.quit()`。
  - **前置条件**：无
  - **对应验收标准**：AC-4
  - 验证方式：手动验收——托盘图标出现、点击「退出」应用完全退出。

- [x] 任务 12：创建 `apps/desktop/src/main/ipc/captureHandlers.ts` 与 `registerIpc.ts`——`captureHandlers.ts` 注册 `ipcMain.handle(IPC.captureCreate, (_e, payload: CreateCapturePayload) => captureDao.createCapture({ text: payload.text, sourceApp: null }))`；`registerIpc.ts` 导出 `registerIpc()` 汇总调用各 handler 注册函数。
  - **前置条件**：`[4]`
  - **对应验收标准**：AC-9
  - 依赖 `@shiguang/ai` 的 `setCaptureDatabase` 已在 initDatabase 后调用（保持 M0 现状），本任务直接使用 `createCapture`。

- [x] 任务 13：改写 `apps/desktop/src/main/index.ts` 为完整装配——保留 dotenv → initDatabase → `app.dock.hide()`；`app.whenReady()` 后依次 `createPetWindow()`、`createTray()`、`registerIpc()`、`createInputWindow()`（隐藏态）。
  - **前置条件**：`[9, 10, 11, 12]`
  - **对应验收标准**：AC-1、AC-4
  - 验证方式：`pnpm dev` 启动后宠物出现、托盘在、无控制台报错。

### preload

- [x] 任务 14：创建 `apps/desktop/src/preload/index.ts`——contextBridge 暴露类型化 `window.api`：`capture.create(payload)` 走 `ipcRenderer.invoke(IPC.captureCreate, payload)`；`input.blur()` / `input.close()` 走 `ipcRenderer.send`；`pet.clicked()` 走 `ipcRenderer.send`；`pet.onSetState(cb)` 用 `ipcRenderer.on(IPC.petSetState, ...)` 订阅（M1 预留口子，仅渲染端监听、主端不发送）。配套在 `apps/desktop/src/renderer/env.d.ts`（或等价声明文件）声明 `window.api` 全局类型。
  - **前置条件**：`[4]`
  - **对应验收标准**：AC-9
  - **关键契约**：preload 只依赖 `packages/shared` 的类型与通道常量，不依赖主进程实现文件。

### pet 渲染（PixiJS + 状态机接线）

- [x] 任务 15：创建 `apps/desktop/src/renderer/pet/core/sprite.ts`——实现 `sliceFrames(baseTexture, frameW = 256, frameH = 208, cols = 6, rows = 9)`：按网格从整图（实测 1536×1872，9 行均匀网格）切出全部 Texture；实现 `createAnimatedSprite(def, frames)`：按 `def.row` 取对应行切片创建 `AnimatedSprite`，设置 `animationSpeed = def.fps / 60`、`loop = def.loop`，并对精灵做 0.5 缩放（SCALE 常量）使显示尺寸为 128×104；AnimatedSprite 池化复用（同 row 重复创建时复用切片缓存）。
  - **前置条件**：`[1, 7]`
  - **对应验收标准**：AC-1
  - 本层只懂渲染，不 import 状态机逻辑；PixiJS API 行为以手动验收为主。

- [x] 任务 16：创建 `apps/desktop/src/renderer/pet/pet.html` 与 `apps/desktop/src/renderer/pet/main.ts`——pet.html 为透明背景容器（根元素设 `-webkit-app-region: drag`、宽高 128×104，无白底）；main.ts 装配：vite import 精灵图 `assets/pet/pet-sprites.webp` → 创建 Pixi Application（透明背景、128×104）→ `createStateMachine(ANIMATIONS, { fallback: 'idle' })` → 初始 `play('idle')` → `onChange` 订阅驱动 `createAnimatedSprite` 切换并 `play()` → 用 `window.api.pet.onSetState((s) => sm.play(s))` 接预留口子；单击判定（未拖动释放）调用 `window.api.pet.clicked()`（app-region 拖动不产生 click 的场景下兜底用 mousedown/up 位移阈值判定，位移 < 5px 视为单击）。
  - **前置条件**：`[8, 14, 15]`
  - **对应验收标准**：AC-1、AC-2、AC-3
  - 验证方式：手动验收——idle 循环播放、可拖动、单击唤出输入框。

### input 渲染（TanStack Form 组件）

- [x] 任务 17：创建 `apps/desktop/src/renderer/input/features/capture/capture-form.tsx`——用 @tanstack/react-form 实现表单（不引 zod，函数式校验）：textarea 原生 `maxlength={5000}`；实时字数统计渲染 `当前字数/5000`（如 `4232/5000`），口径随原生 maxlength、emoji 不单独计数；`value.length === 0`（不 trim）时提交按钮禁用；提交回调进入 loading 态（禁用按钮与 textarea）防连点；成功后显示「✓ 已拾光」1~2 秒后调用 `window.api.input.close()`；`onPaste` 检测 `clipboardData` 含文件/图片时 `preventDefault()` 并提示「暂不支持」；容器级 Esc 监听调用 `window.api.input.close()`；textarea blur 调用 `window.api.input.blur()`。
  - **前置条件**：`[3, 4]`
  - **对应验收标准**：AC-5、AC-6、AC-7、AC-8
  - TDD：先写 `capture-form.test.tsx`（vitest + jsdom + @testing-library/react + user-event，mock `window.api`）覆盖字数统计渲染、maxlength 属性存在、零长度禁用、提交回调与 loading 防连点、粘贴图片提示「暂不支持」五例，再实现组件。

- [x] 任务 18：创建 `apps/desktop/src/renderer/input/input.html`、`main.tsx`、`App.tsx`——input.html 引入 `../index.css`；main.tsx 用 `createRoot` 挂载 `<App />`；App.tsx 只做装配：渲染 `<CaptureForm />` 于宽约 360px 的卡片容器（Tailwind 样式、圆角白底浮窗观感）。
  - **前置条件**：`[17]`
  - **对应验收标准**：AC-5
  - 验证方式：`pnpm dev` 下单击宠物后输入框正常渲染表单。

### 构建配置与技术债清理

- [x] 任务 19：改写 `apps/desktop/electron.vite.config.ts`——renderer 改多入口（`pet: src/renderer/pet/pet.html`、`input: src/renderer/input/input.html`，移除旧单入口 index.html 引用）；新增 preload 构建入口（`src/preload/index.ts`，输出 cjs）；external 列表移除残留的 `uiohook-napi`。
  - **前置条件**：`[13, 16, 18]`
  - **对应验收标准**：AC-11
  - 验证方式：`pnpm dev` 三个入口（main/preload/renderer 双页面）均构建成功，宠物与输入框窗口各自加载正确 html。

- [x] 任务 20：清理 `apps/desktop/vitest.config.ts`——删除「osascript 副作用」残留注释，移除 `--passWithNoTests` 参数（本变更后 desktop 已有真实测试）。
  - **前置条件**：`[19]`
  - **对应验收标准**：AC-11

### 文档与回归

- [x] 任务 21：更新根 `README.md`——新增 M1 使用说明：宠物默认右下角出现、idle 动效、按住拖动换位（不记忆）、单击唤出输入框、再点宠物/失焦/Esc 收起、托盘退出；db 文件位置（`app.getPath('userData')` 下单一 SQLite 文件）与 DB Browser for SQLite / TablePlus 查看指路；数据明文存储风险说明。
  - **前置条件**：无
  - **对应验收标准**：AC-10

- [x] 任务 22：回写 `docs/REQUIREMENTS.md`——将 REQ-CAP-02、REQ-CAP-05、REQ-STORE-01、REQ-TOOL-01、REQ-DX-02 的 M1 状态与交付说明更新为本次实现结果，并在变更记录表追加一行（2026-10-16，M1 桌面宠物 + 手动输入框闭环交付）。
  - **前置条件**：无
  - **对应验收标准**：AC-10

- [x] 任务 23：全量回归与手动走查——跑 `pnpm typecheck`、`pnpm --filter @shiguang/ai test`（7 测试）、desktop 全部单测，确认全绿；手动走查：宠物默认右下角与 idle 循环、拖动换位重启不记忆、单击唤出/再点 toggle、失焦与 Esc 收起、blur 后 300ms 抑制、字数统计与 5000 拦截、零长度禁用、全空格可入库、粘贴图片「暂不支持」、「✓ 已拾光」自动收起、托盘退出、重启后数据仍在。
  - **前置条件**：`[5, 6, 7, 8, 13, 16, 17, 19, 20, 21, 22]`
  - **对应验收标准**：AC-1 ~ AC-11
