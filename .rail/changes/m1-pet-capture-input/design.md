# Design: M1 桌面宠物手动输入入库（m1-pet-capture-input）

## 1. 概述

M1 交付拾光首个用户可感知闭环：桌面宠物（Hooper，idle 动效）常驻屏幕右下角，单击唤出旁边的输入框浮窗，用户输入纯文字（上限 5000 字）确认后经 IPC 写入本地 SQLite records 表，反馈「✓ 已拾光」后自动收起。数据层（`packages/ai` records 表 + captureDao，7 测试全绿）已就绪，本次在 `apps/desktop` 内补齐宠物窗口、输入框窗口、托盘、IPC/preload 全链路并接入数据层。

**范围内：**

- 宠物窗口：frameless + transparent + alwaysOnTop + skipTaskbar，透明无边框承载 Hooper idle 动效（webp 精灵图第 1 行，6 帧循环），默认主屏右下角（留边距不贴 Dock），可拖动换位但不持久化，单击唤出/收起输入框。
- 输入框窗口：frameless 小浮窗（宽约 360px），宠物旁弹出、靠边自动翻转防越界；5000 字输入时拦截（textarea 原生 maxlength）+ 实时字数统计；零长度禁提交（全空格/换行视为有内容可入库）；粘贴图片/文件提示「暂不支持」；提交 loading 防连点；成功后「✓ 已拾光」1~2 秒自动收起；Esc / 失焦收起。
- 入库链路：renderer → IPC `capture:create` → 主进程 handler → `captureDao.createCapture({ text, sourceApp: null })` → records 表。
- 系统托盘：图标 + 退出菜单；`app.dock.hide()` 维持托盘应用形态。
- 宠物动画状态机黑盒：渲染层（PixiJS 帧切分）/ 数据层（状态→动画配置注册表）/ 规则层（纯 TS 状态机）三层分离，对外唯一口子 `play(state, opts?)`；预留 `pet:set-state` IPC 口子（M1 渲染端监听、主端不发送）。
- 技术债清理：`electron.vite.config.ts` 移除 external uiohook-napi 并补 preload 入口；renderer 多入口（pet.html + input.html）；`vitest.config.ts`「osascript」残留注释。
- README：M1 使用说明 + db 位置 + DB Browser / TablePlus 指路（REQ-TOOL-01）；`pnpm dev` 一键起（REQ-DX-02）。

**范围外（明确不做）：** AI 分析 / LLM 调用（M5）；历史查看 UI（M2）；全局热键、剪贴板监听（旧方案已废弃）；图片/文件入库（仅提示「暂不支持」）；多显示器适配（M3 评估）；宠物位置记忆持久化（M3 评估）；开机自启、关窗常驻（M3 REQ-APP-01）。

## 2. 验收标准

- AC-1（REQ-CAP-05）：`pnpm dev` 启动后宠物默认出现在主屏右下角（留边距不贴 Dock），idle 动效（精灵图第 1 行 6 帧）持续循环播放；宠物窗口透明无边框、置顶、不出现在 Dock 与任务栏。
- AC-2（REQ-CAP-05）：按住宠物可拖动换位置；重启应用后宠物回到默认右下角（位置不持久化）。
- AC-3（REQ-CAP-05）：单击宠物唤出输入框；输入框已打开时再单击宠物 = 收起（toggle）；输入框失焦或点击空白处收起；失焦收起后 300ms 内宠物的单击被忽略（blur 抑制，防收起瞬间误触又打开）。
- AC-4（REQ-CAP-05）：系统托盘图标存在，菜单含「退出」，点击后应用完全退出。
- AC-5（REQ-CAP-02）：输入框文字上限 5000 字、输入时拦截（textarea 原生 maxlength），实时字数统计显示（如 `4232/5000`）；零长度（`value.length === 0`，不 trim）时确认按钮禁用，全空格/换行内容允许入库。
- AC-6（REQ-CAP-02）：向输入框粘贴图片或文件时提示「暂不支持」，内容不写入输入框、不入库。
- AC-7（REQ-CAP-02）：确认提交后确认按钮与输入框立即进入 loading 禁用态（防连点）；入库成功后输入框内显示「✓ 已拾光」1~2 秒后自动收起。
- AC-8（REQ-CAP-02）：输入框聚焦时按 Esc 收起输入框。
- AC-9（REQ-STORE-01）：确认入库后 records 表新增一条记录（text + source_app 为 null + created_at 自动时间戳）；重启应用后数据仍在。
- AC-10（REQ-TOOL-01）：README 含 M1 使用说明（拖动 / 单击唤出 / 托盘退出）、db 文件位置、DB Browser for SQLite / TablePlus 查看指路。
- AC-11（REQ-DX-02 + 回归基线）：`pnpm dev` 一键起；`pnpm typecheck` 全仓通过；`pnpm --filter @shiguang/ai test` 7 个测试保持全绿；desktop 新增单测（stateMachine / windowGeometry / blurSuppress / capture-form 组件测试）全绿。

## 3. 实现方案

### 3.1 接口与函数签名

**packages/shared/src/index.ts（只放契约，不放实现）**

```ts
export const IPC = {
  captureCreate: 'capture:create',   // { text } → CaptureRecord
  petSetState: 'pet:set-state',      // M1 预留，主端不发送
  inputBlur: 'input:blur',
  inputClose: 'input:close',
  petClicked: 'pet:clicked',
} as const;

export interface CreateCapturePayload { text: string }
```

**apps/desktop/src/main/lib/windowGeometry.ts（纯函数）**

```ts
export interface Rect { x: number; y: number; width: number; height: number }
// 宠物默认位：主屏工作区右下角，留边距不贴 Dock
export function computePetPosition(workArea: Rect, margin: number): { x: number; y: number }
// 输入框定位：宠物旁弹出，靠边自动翻转（flip），越界修正
export function computeInputPosition(
  petBounds: Rect, inputSize: { width: number; height: number },
  workArea: Rect, gap: number
): { x: number; y: number; flipped: boolean }
```

**apps/desktop/src/main/lib/blurSuppress.ts（纯函数）**

```ts
export function nextSuppressUntil(now: number, delayMs?: number): number  // now + 300
export function shouldSuppressPetClick(suppressUntil: number, now: number): boolean  // now < suppressUntil
```

**apps/desktop/src/renderer/pet/core/animations.ts（数据层）**

```ts
export interface AnimationDef { row: number; frames: number; fps: number; loop: boolean }
export const ANIMATIONS: Record<string, AnimationDef>
// M1 只注册 idle：{ row: 0, frames: 6, fps: 8, loop: true }
// 未来扩展示例：notify 一行配置 + stateMachine 规则表一条 + 主进程发 pet:set-state
```

**apps/desktop/src/renderer/pet/core/stateMachine.ts（规则层，~60 行纯 TS，不 import Pixi，可 vitest 单测）**

```ts
export function createStateMachine(
  defs: Record<string, AnimationDef>,
  opts: { fallback: string; priority?: Record<string, number> }
): {
  play(state: string, opts?: { force?: boolean }): boolean;  // 非法状态返回 false 拒绝
  onChange(listener: (state: string, def: AnimationDef) => void): () => void;
  readonly current: string;
  notifyFinished(): void;  // 一次性动画播完调用，自动回落 fallback 状态
}
```

**apps/desktop/src/renderer/pet/core/sprite.ts（渲染层，只懂渲染）**

```ts
// 精灵图整图 1536×1872，8 列 × 9 行均匀网格，单帧 192×208；vite import 进 bundle
// 注意：行内帧数不固定（idle 行仅前 5 格有内容），由 ANIMATIONS 的 frames 字段决定
export function sliceFrames(baseTexture: Texture, frameW: number, frameH: number, cols: number, rows: number): Texture[]
export function createAnimatedSprite(def: AnimationDef, frames: Texture[]): AnimatedSprite  // 池化复用
```

**apps/desktop/src/preload/index.ts**

```ts
contextBridge.exposeInMainWorld('api', {
  capture: { create: (payload: CreateCapturePayload) => ipcRenderer.invoke(IPC.captureCreate, payload) },
  input:  { blur: () => ipcRenderer.send(IPC.inputBlur), close: () => ipcRenderer.send(IPC.inputClose) },
  pet:    { clicked: () => ipcRenderer.send(IPC.petClicked),
            onSetState: (cb) => ipcRenderer.on(IPC.petSetState, (_e, s: string) => cb(s)) },  // M1 预留监听
})
```

**主进程窗口/托盘/IPC（`main/windows/petWindow.ts`、`inputWindow.ts`、`tray.ts`、`ipc/captureHandlers.ts`）**

```ts
export function createPetWindow(): BrowserWindow        // frameless/transparent/alwaysOnTop/skipTaskbar/focusable:false/128×104
export function createInputWindow(): BrowserWindow      // frameless 小浮窗 ~360px 宽
// inputWindow.ts 内部导出显隐状态机：toggle(suppressUntilRef)、showNear(petBounds)、hide()，
//   blur 时收起并记 suppressUntil = nextSuppressUntil(Date.now())，期间 pet:clicked 忽略
export function createTray(): Tray                      // 图标 + 退出菜单
// captureHandlers.ts：ipcMain.handle(IPC.captureCreate, (_e, { text }) => captureDao.createCapture({ text, sourceApp: null }))
```

### 3.2 关键数据结构

**精灵图网格常量**（`pet/core/sprite.ts` 顶部）

| 常量 | 值 | 说明 |
|---|---|---|
| FRAME_WIDTH / FRAME_HEIGHT | 192 / 208 | 单帧尺寸（整图 1536×1872，8 列 × 9 行均匀网格） |
| SCALE | 0.5 | 渲染缩放，帧显示尺寸 96×104，在 128×104 内容宽度中水平居中 |
| IDLE_DEF | `{ row: 0, frames: 5, fps: 8, loop: true }` | M1 唯一注册动画（idle 行实测仅 5 格有内容） |

**宠物窗口 options**：`frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, focusable: false, width: 128, height: 104, hasShadow: false`。

**输入框窗口 options**：`frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, width: 360`。

**IPC payload 表**

| 通道 | 方向 | payload | 返回 |
|---|---|---|---|
| `capture:create` | renderer → main（invoke） | `{ text: string }` | `CaptureRecord` |
| `input:blur` | renderer → main（send） | 无 | — |
| `input:close` | renderer → main（send，Esc） | 无 | — |
| `pet:clicked` | renderer → main（send） | 无 | — |
| `pet:set-state` | main → renderer（预留） | `string` 状态名 | — |

**records 表写入**：仅 `text` + `source_app = null`；`created_at` 自动时间戳（数据层已实现，本次不改）。

### 3.3 关键骨架（必须按此实现）

1. 主进程集中管理输入框显隐；宠物窗口 `focusable: false` 不接受焦点；输入框失焦 → 收起 → 记 `suppressUntil = now + 300ms`，期间忽略 `pet:clicked`。
2. 宠物状态机为纯 TS（不 import Pixi），三层分离：sprite.ts 只渲染、animations.ts 只存配置、stateMachine.ts 只管流转；对外唯一口子 `play(state, opts?)`。
3. 状态机优先级：高打断低（未来 notify > 反馈 > idle）；`loop: false` 的动画播完由渲染层调 `notifyFinished()` 自动回落 fallback（M1 fallback = idle）。
4. 零长度判定 `value.length === 0`，不 trim；全空格/换行允许入库。
5. 拖动用 CSS `-webkit-app-region: drag` 实现，零 JS；未拖动释放的单击由渲染层发 `pet:clicked`。
6. 输入框键盘不自定义 keydown 拦截：textarea 原生 Enter 换行，Esc 由容器监听发 `input:close`。
7. 精灵图整图经 vite import 打包（`files: out/**` 已覆盖，electron-builder 无需额外配置）。
8. 拖动后位置不持久化，每次启动回默认右下角。

### 3.4 数据流 / 状态变更

```
启动：main/index.ts（dotenv → initDatabase → app.dock.hide() → ready
      → createPetWindow（默认右下角）→ createTray → registerIpc → createInputWindow（隐藏））

单击宠物（未拖动）：pet/main.ts 发 pet:clicked
  → 主进程：now < suppressUntil？是 → 忽略
            否 → 输入框可见？是 → 收起（toggle）
                       否 → computeInputPosition（靠边翻转防越界）→ 显示输入框并 focus

输入框 blur → 发 input:blur → 主进程收起 + 记 suppressUntil(+300ms)
Esc → 发 input:close → 主进程收起（同 blur 路径）

提交：capture-form（TanStack Form，value.length>0 才可用）
  → loading（禁用按钮+输入框，防连点）
  → window.api.capture.create({ text }) → ipcMain.handle
  → captureDao.createCapture({ text, sourceApp: null }) → records 表
  → 渲染层显示「✓ 已拾光」1~2 秒 → 发 input:close → 收起
```

### 3.5 技术决策

1. **双 BrowserWindow + 主进程集中管理输入框显隐**：宠物窗口不接收焦点（`focusable: false`），输入框是唯一可聚焦窗口；显隐状态机与 blur 抑制逻辑全部在主进程，renderer 只发信号（`pet:clicked` / `input:blur` / `input:close`）。
   - 备选：单窗口内嵌输入框。舍弃理由：宠物需透明且点击穿透/拖动语义与输入框可编辑语义冲突，独立窗口边界清晰。
2. **宠物窗口 0.5 倍缩放（128×104 内容尺寸）**：精灵帧 192×208 按 SCALE 0.5 渲染为 96×104，sprite 在内容宽度内水平居中，视觉尺寸约为原素材一半，适合桌面常驻。
3. **动画状态机三层黑盒**：sprite.ts（PixiJS 帧切分与 AnimatedSprite 池，只懂渲染）/ animations.ts（状态→`{ row, frames, fps, loop }` 注册表，只存数据）/ stateMachine.ts（~60 行手写纯 TS，只懂规则，不 import Pixi、可 vitest 单测）。宠物不关心业务，对外唯一口子 `play(state, opts?)`；使用层决定何时播什么（平时 `play('idle')`、未来上传中 `play('loading')`，届时注册表加配置即可，pet 代码零改动）。
   - 备选：引 xstate。舍弃理由：M1 只有 idle 一个状态，xstate 过重；~60 行纯 TS 足够且天然可单测。扩展路径（M8 示例）：animations.ts 加一行 notify 配置 + 状态机规则表加一条 + 主进程发 `pet:set-state`，三处增量零重构。
4. **表单引擎选 @tanstack/react-form（TanStack Form），明确不引 zod**：用 TanStack Form 自带函数式校验 + textarea 原生 `maxlength=5000` 双层约束；字数统计口径随原生 maxlength（emoji 不单独计数）；零长度判 `value.length === 0` 不 trim（全空格/换行可入库，用户明确选择「仅拦截零长度」）。
5. **键盘零自定义拦截**：不监听 keydown 做提交快捷键，textarea 原生 Enter 换行，提交走按钮；Esc 收起是窗口级行为，由容器监听发 `input:close`。
6. **blur 抑制用纯函数**：`shouldSuppressPetClick(suppressUntil, now)` 判断收起后 300ms 内的宠物单击，避免「点空白收起 → 同一次点击穿透到宠物又打开」的闪振；纯函数可单测。
7. **拖动用 CSS `-webkit-app-region: drag`**：零 JS 实现按住拖动，单击唤出保留（未拖动释放才发 `pet:clicked`）。
8. **输入框定位纯函数化**：`computeInputPosition` 负责宠物旁弹出 + 靠边自动翻转 + 越界修正，输入框高约内容自适应、宽约 360px。
9. **IPC 契约集中 packages/shared**：通道常量 + payload 类型只放契约不放实现；preload 用 contextBridge 暴露类型化 `window.api`。
10. **shadcn/ui primitives 入 `renderer/components/ui/`**（button、textarea、label 等）+ `lib/utils.ts` 的 `cn()`（clsx + tailwind-merge），Tailwind 走标准 `tailwindcss + postcss + autoprefixer`。
11. **React 18 从 devDependencies 移入 dependencies**：本次接入 renderer 运行入口后 React 是运行期依赖。
12. **精灵图资源打包**：webp 经 vite import 进 `out/renderer`；`electron-builder.yml` 现有 `files: out/**`、`asar: false` 已覆盖，无需额外资源配置。

### 3.6 风险 / 取舍

- [风险] `-webkit-app-region: drag` 区域上的单击事件可能被系统偶发吞掉，导致单击唤出失效 → 缓解预案（改双击唤出、或留独立 no-drag 可点热区）已备但不预防性实现，留到问题复现再启用。
- [风险] 输入框失焦与宠物单击的时序竞争（同一次点击既触发 blur 又触发 click）→ 已由 blurSuppress 300ms 窗口缓解，配单测锁定行为。
- [取舍] 多显示器不做，仅主屏右下角 → M3 开机自启场景一并评估。
- [取舍] 宠物拖动位置不持久化 → M3 重新评估是否引入坐标持久化。
- [取舍] 全空格/换行内容可入库（仅拦截零长度）→ 用户明确决策，已知可接受项。
- [取舍] 数据明文存储（继承 M0 决策）→ README 如实说明，M9 以脱敏配置解决。
- [取舍] 精灵图 9 行动效 M1 仅用第 1 行 idle → 素材已入仓，其余动效后续按需注册。

### 3.7 技术债务

- `electron.vite.config.ts`：移除 external 残留的 `uiohook-napi`（旧热键方案死配置），补 preload 构建入口。
- `vitest.config.ts`：清理「osascript 副作用」残留注释；desktop 有新测试后移除 `--passWithNoTests`。
- `packages/desktop` 的 React 18 从 devDependencies 迁移到 dependencies（本次随依赖整理一并完成）。
- `pet:set-state` 渲染端预留监听、主端不发送（M8 主动提醒场景使用，本次只留口子）。

### 3.8 影响文件清单

**packages/shared/**
- `src/index.ts`：IPC 通道常量 + `CreateCapturePayload` 类型（契约层扩展，不改 CaptureRecord）

**apps/desktop — 主进程**
- `src/main/index.ts`：装配层（dotenv → initDatabase → app.dock.hide() → ready → 窗口/托盘/IPC 装配）
- `src/main/windows/petWindow.ts`：宠物窗口创建 + 单击信号接收
- `src/main/windows/inputWindow.ts`：输入框窗口创建 + 显隐状态机 + blur 抑制协调
- `src/main/ipc/captureHandlers.ts`、`src/main/ipc/registerIpc.ts`：`capture:create` → captureDao
- `src/main/lib/windowGeometry.ts`：宠物旁定位 + 靠边翻转 + 越界修正（纯函数）
- `src/main/lib/blurSuppress.ts`：`shouldSuppressPetClick` / `nextSuppressUntil`（纯函数）
- `src/main/tray.ts`：托盘图标 + 退出菜单

**apps/desktop — preload**
- `src/preload/index.ts`：contextBridge 暴露类型化 `window.api`

**apps/desktop — renderer/pet**
- `src/renderer/pet/pet.html`、`src/renderer/pet/main.ts`：装配（Pixi App + 状态机 + AnimatedSprite 接线、`pet:clicked` 发送、`pet:set-state` 监听预留、`-webkit-app-region: drag`）
- `src/renderer/pet/core/sprite.ts`：帧切分（256×208 网格）与 AnimatedSprite 池
- `src/renderer/pet/core/animations.ts`：idle 注册（row 0, 6 帧, loop）
- `src/renderer/pet/core/stateMachine.ts`：纯 TS 状态机（切换/优先级打断/一次性回落/非法状态拒绝）

**apps/desktop — renderer/input**
- `src/renderer/input/input.html`、`src/renderer/input/main.tsx`、`src/renderer/input/App.tsx`：装配
- `src/renderer/input/features/capture/capture-form.tsx`：表单本体（TanStack Form）
- `src/renderer/input/lib/utils.ts`：`cn()` 等
- `src/renderer/components/ui/`：shadcn primitives（button、textarea、label 等）
- `src/renderer/index.css`：Tailwind 入口

**apps/desktop — 配置**
- `package.json`：deps 新增 `@tanstack/react-form`、`pixi.js`、`clsx`、`tailwind-merge`、`class-variance-authority`、`lucide-react`；react/react-dom 移入 dependencies；devDeps 新增 `@testing-library/react`、`@testing-library/user-event`、`jsdom`、`@types/react`、`@types/react-dom`、`tailwindcss`、`postcss`、`autoprefixer`
- `electron.vite.config.ts`：pet.html + input.html 多入口 + preload 入口 + 清理 uiohook external
- `vitest.config.ts`：清理 osascript 残留注释、移除 `--passWithNoTests`
- `tailwind.config.ts`、`postcss.config.js`（新增）

**文档**
- `README.md`：M1 使用说明 + db 位置 + DB Browser / TablePlus 指路
- `docs/REQUIREMENTS.md`：M1 相关条目状态回写

## 4. 回滚条件

- `-webkit-app-region: drag` 单击被吞问题在 macOS 实际环境高频复现，且双击唤出 / 独立热区预案均不能修复交互。
- 双窗口 + alwaysOnTop 组合在 macOS 上引发不可接受的系统行为（如无法唤出其他应用、透明窗口渲染异常）且无法在迭代内修复。
- better-sqlite3 原生模块在 Electron 主进程链路（M0 已解决）回归失败，阻塞 `capture:create` 入库。
- TanStack Form 与当前 React 18 / electron-vite 构建链出现不可调和的兼容问题，且替换为原生受控组件会破坏已确认的选型对齐。
