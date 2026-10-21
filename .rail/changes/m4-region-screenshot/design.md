# Design: M4 选区截图入库（m4-region-screenshot）

## 1. 概述

M4 为拾光补齐「图片」收集通道（REQ-CAP-03）：**输入框底部工具栏常驻「区域截图」图标按钮**（类微信输入框截图入口），全屏遮罩覆盖全部屏幕，拖拽选区 → 确认裁剪 → PNG 落盘 `userData/images/<uuid>.png` → records + attachments 两表入库 → 后台记录页可见缩略图。本次**只入库、不理解**（图片理解是 M6 能力，不做任何预留）；不复活 M1 已废弃的全局热键；输入框粘贴图片维持现状不动。

> **入口修订（2026-10-19，编码后产品纠正）**：触发入口由「宠物右键原生菜单」改为「输入框工具栏截图图标」。`pet:menu` 通道与原生 Menu.popup 方案整体撤销，宠物右键恢复「直接 toggle 输入框」现行行为；`screenshot:start` 改由输入框渲染层发送（契约不变，仅发送方变更）。修订理由：入口应与捕获动作同处一个交互面（输入框即捕获中枢），右键菜单打断肌肉记忆。下文凡涉及「右键菜单入口」的描述以此修订为准。

> **换库修订（2026-10-19，M4 交付后）**：截图库由 electron-screenshots@^0.6.2 更换为 electron-snapora@^1.0.25。动机：electron-screenshots 硬编码 kiosk:true，macOS 打开截图会隐藏其他应用，产品不可接受。调研结论：snapora 无 kiosk/无 fullscreen/禁用 type:'panel'（Space-safe 窗口策略且有单测断言）、零原生模块零运行时依赖、官方 preload 集成（`exposeScreenshotApi` → `window.electronSnapora`）、`tools:[]` 官方精简标注工具、权限处理完善（denied 自动打开系统设置并返回 PERMISSION_DENIED）、Uint8Array structured clone 传输无 base64；风险为单人维护、0 star 0 fork、包龄约 2 个月，macOS 签名打包验证待真机走查。前置：snapora peer electron>=42，故本次先行完成 Electron 33→44.9.1 升级（electron-vite 3→6、better-sqlite3 11→12.11.1，11 依赖的 API 在 Electron 44 V8 已移除）。契约变化：`screenshot:start` 通道随旧库移除，新增 `screenshot:save`（buffer 回传）/ `screenshot:fail` 通道；`screenshot:done` 主→宠物窗反馈不变。下文 3.5 决策 1、3.6 风险、3.7 债务、3.8 文件清单已按换库后现状改写。

方案对齐阶段对 proposal 预设做了一处技术修正：截图遮罩窗由 `electron-snapora` 库自建并自管理，**不进入拾光三窗架构、不新增第 4 个 renderer html 入口**（proposal 第 35/57 行的「第 4 窗口模块 + 第 4 入口」预设作废，理由见 3.5 决策 1）。因此 M4 不涉及 electron.vite.config.ts 的 renderer 入口改动；换库后 electron-screenshots/node-screenshots（含原生模块）整体移除，主进程 `external` 无需为截图库增列（仅余 better-sqlite3 一个原生模块，既有 external 配置不变）。

**范围内：**

- 输入框底部工具栏常驻「区域截图」图标按钮（lucide Camera，类微信输入框截图入口），点击调 `window.electronSnapora.capture({locale:'zh-CN', tools:[], defaultTool:'select'})`；宠物右键维持「直接 toggle 输入框」现行行为不动
- 截图链路：`setupElectronSnapora({ipcMain, validateSender})` 接入（validateSender：file: 放行 + dev origin 放行）；`screenshot:save`（Uint8Array buffer 经 structured clone 回传）→ 库无关 `saveScreenshot(buffer)` 管线（写盘→createImageCapture→推 `screenshot:done`）；`screenshot:fail` → 失败回推；`unregisterSnapora()` 挂 before-quit；多显示器原生覆盖
- 数据模型：迁移 0002——records 加 `type` 列（text/image），新建 attachments 表；DAO 增 `createImageCapture` / `queryCaptures` 类型维度 / `deleteCaptures` 级联返路径
- 自定义 protocol `shiguang-image://`：记录页 `<img>` 只读加载 userData/images/ 内文件（防目录穿越）
- 记录页适配：提取 RecordRow 子组件；图片行缩略图（约 96px、object-contain）+ 点击展开大图 + 「图片丢失」占位；类型筛选「全部/文字/图片」启用（M2 预留扩展位）；删除确认对含图片记录提示级联；图片行复制按钮 = 复制图片到剪贴板
- IPC 扩展：`screenshot:save` / `screenshot:fail`（snapora preload 回传，handler 接 saveScreenshot 管线）/ `screenshot:done`（主→宠物窗反馈）/ `capture:copy-image`，全部经 `registerIpc()` 单点装配，契约进 `packages/shared`

**范围外（不做）：** 图片理解 / AI 看图（M6）；输入框粘贴图片；全局热键；存储膨胀 / 孤儿文件治理（M9 统一设计，记技术债务）；图片路径契约演进（走迁移，记技术债务）；删除文件清理失败重试（记技术债务）。

## 2. 验收标准

- AC-1：输入框底部工具栏常驻「区域截图」图标按钮，点击调 `window.electronSnapora.capture(...)` 进入全屏遮罩（覆盖全部屏幕，任意一屏可选区）；宠物右键行为不变（直接 toggle 输入框）；不复活全局热键。
- AC-2：遮罩标注工具经 `tools:[]` 全部隐藏（官方能力，不再依赖 CSS 注入）；动作按钮（撤销/重做/保存/固定/复制/取消）随库不可再精简；ESC 取消不产生任何记录（行为随库）。
- AC-3：选区确认后图片写入 `userData/images/<uuid>.png`，records 产生 `type='image'`、`text=''`、`source_app='screenshot'` 的记录，attachments 产生一行（相对路径 `images/<uuid>.png`）；记录页可见图片缩略图。
- AC-4：记录页筛选「图片」仅显示图片记录、切「文字」仅显示文字记录、切「全部」两者皆显；类型筛选可与关键词/时间区间组合。
- AC-5：点击图片行展开显示大图（object-contain），再点收起；缩略图约 96px 宽。
- AC-6：磁盘文件被手动删除的图片记录显示「图片丢失」灰色占位，记录仍可勾选、删除。
- AC-7：删除含图片记录后磁盘文件被级联清理；批量删除含图片记录同样清理；删除确认文案对含图片记录提示「将同时删除图片文件」。
- AC-8：磁盘写盘失败（如目录不可写）时不产生任何记录，宠物窗收到失败提示（文案含失败原因）；屏幕录制权限未授予时失败提示含「请在系统设置中开启屏幕录制权限」。
- AC-9：图片行复制按钮将图片写入剪贴板（主进程 W3C 异步 `clipboard.write([ClipboardItem])`——Electron 44 升级后同步 `clipboard.writeImage` 路径不再可用），成功有轻提示；文字行复制行为不变。
- AC-10：IPC 契约收敛：新增通道常量与 payload 类型全部位于 `packages/shared`；preload 只依赖 shared；handler 经 `registerIpc()` 单点装配；选区遮罩窗不进三窗架构（无第 4 窗口模块/renderer 入口）。
- AC-11：自动化测试通过：迁移 0002 与 DAO 新函数单测（临时目录真实 SQLite）、RecordsPage 组件测试（图片行渲染/展开/占位/类型筛选/删除文案）、截图 handler 测试（mock electron-snapora setup）、protocol 路径校验纯函数测试。
- AC-12：极小选区（如 1×1）照常入库；删除时文件清理失败记录照删（尽力清理，不阻塞删除）。

## 3. 实现方案

### 3.1 接口与函数签名

**packages/shared/src/index.ts（只放契约不放实现）**

```ts
export const IPC = {
  // ...既有通道不变，新增（换库修订：screenshotStart 随 electron-screenshots 移除）：
  screenshotSave: 'screenshot:save',        // snapora preload → 主进程：截图 buffer（Uint8Array）
  screenshotFail: 'screenshot:fail',        // snapora preload → 主进程：截图失败（含 PERMISSION_DENIED）
  screenshotDone: 'screenshot:done',        // 主→宠物窗 webContents.send 反馈
  captureCopyImage: 'capture:copy-image',   // invoke：复制图片记录到剪贴板
} as const;

export interface CaptureRecord {
  id: number;
  text: string;
  sourceApp: string | null;
  createdAt: string;
  type: 'text' | 'image';        // 新增：内容类型
  imagePath: string | null;      // 新增：attachments 相对路径（相对 userData 根），文字记录为 null
}

export interface QueryCapturesPayload {
  // ...既有字段不变，新增：
  type?: 'text' | 'image';       // 缺省=全部
}

/** 截图结果反馈（主进程 → 宠物窗） */
export type ScreenshotDonePayload = { ok: true } | { ok: false; error: string };

/** 复制图片记录载荷 */
export interface CopyImagePayload {
  id: number;
}
```

**packages/ai/src/dao/captureDao.ts（数据层，主进程仅经此读写）**

```ts
export function createImageCapture(input: { imagePath: string; sizeBytes?: number }): CaptureRecord;
// 单事务：INSERT records(text='', type='image', source_app='screenshot') + INSERT attachments 一行。
// imagePath 为相对 userData 根的路径（如 images/<uuid>.png），DAO 不碰磁盘。

export function deleteCaptures(ids: number[]): string[];
// 单事务：先按 ids 查 attachments.file_path，再删 attachments、删 records；
// 返回被删记录的文件路径列表（相对路径），供 handler 尽力清理磁盘；空数组返回 []。

export function queryCaptures(input: QueryCapturesPayload): QueryCapturesResult;
// SELECT records LEFT JOIN attachments（每记录至多一行附件），返回行带 type 与 imagePath；
// input.type 走参数化 type = ? 条件。

export function createCapture(input: { text: string; sourceApp?: string | null }): CaptureRecord;
// 同步适配：写入显式 type='text'。

export function listCaptures(limit?: number): CaptureRecord[];
// 同步适配：LEFT JOIN attachments 返回 type 与 imagePath。与 queryCaptures 冗余不收敛（既有技术债务）。
```

**apps/desktop 主进程**

```ts
// main/screenshot/screenshotService.ts（新建）
export function saveScreenshot(buffer: Uint8Array): Promise<void>;
// 库无关落盘入库管线：fs.mkdir(userData/images) 幂等 → randomUUID 写盘
//   → createImageCapture() → send screenshot:done {ok:true}；任一步异常 → 尽力 unlink
//   → send {ok:false, error}。会话幂等靠模块级标志位（进行中忽略重复触发）。
export function getImagesDir(): string;          // userData/images（mkdir 幂等）
export function isSubPath(root: string, p: string): boolean;  // protocol 路径校验纯函数（可单测）

// main/screenshot/imageProtocol.ts（新建）
export function registerImageProtocol(): void;
// protocol.handle('shiguang-image', ...)：仅服务 images 根内 .png；越界/不存在返回 404 空 Response。

// main/ipc/screenshotHandlers.ts（新建）
export function registerScreenshotHandlers(): void;
// setupElectronSnapora({ipcMain, validateSender})（validateSender：file: 放行 + dev origin 放行）
//   + on(IPC.screenshotSave) → saveScreenshot(buffer)
//   + on(IPC.screenshotFail) → 组装失败文案（权限类含系统设置引导）→ send screenshot:done {ok:false}
//   + unregisterSnapora() 挂 index.ts before-quit；
// handle(IPC.captureCopyImage) → 按 id 查 imagePath → 读文件 → clipboard.write([ClipboardItem])
//   （W3C 异步，Electron 44 后同步 writeImage 不再可用；文件缺失/非图片记录抛错回 renderer）。

// windows/petWindow.ts —— registerPetWindowIpc() 不变（宠物右键维持 pet:clicked 直接 toggle）。
// 输入框 capture-form.tsx 底部工具栏「区域截图」图标按钮
//   → window.electronSnapora.capture({locale:'zh-CN', tools:[], defaultTool:'select'})。
```

**apps/desktop/src/preload/index.ts**

```ts
export interface ShiguangApi {
  // ...既有分组不变，新增/扩展：
  screenshot: {
    onDone(cb: (payload: ScreenshotDonePayload) => void): () => void;  // 订阅 screenshot:done（宠物窗 toast）
  };
  capture: {
    // ...既有 create/list/delete 不变，新增：
    copyImage(payload: CopyImagePayload): Promise<void>;  // invoke capture:copy-image
  };
  pet: {
    // ...既有 clicked/onSetState 不变（右键维持直接 toggle，M4 不增菜单口子）
  };
}
// 截图发起不经 window.api.screenshot.start：preload 合入 snapora 官方 exposeScreenshotApi
//   （window.electronSnapora.capture），输入框工具栏直接调；window.api.screenshot 只留 onDone 反馈订阅。
```

### 3.2 关键数据结构

**records 表（迁移 0002 扩展，不改 M1 字段语义）**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PK AUTOINCREMENT | 不变 |
| text | TEXT NOT NULL | 不变；图片记录恒为 `''` |
| source_app | TEXT | 不变；图片记录恒为 `'screenshot'` |
| created_at | TEXT NOT NULL DEFAULT (UTC ISO) | 不变 |
| type | TEXT NOT NULL DEFAULT 'text' | 新增；CHECK (type IN ('text','image')) |

**attachments 表（迁移 0002 新建）**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PK AUTOINCREMENT | |
| record_id | INTEGER NOT NULL REFERENCES records(id) | 外键（PRAGMA foreign_keys 已 ON）；行删除由 DAO 单事务显式完成，不依赖 ON DELETE CASCADE |
| file_path | TEXT NOT NULL | 相对 userData 根（如 `images/<uuid>.png`），路径契约集中 DAO/迁移层 |
| mime_type | TEXT NOT NULL DEFAULT 'image/png' | |
| size_bytes | INTEGER | 可空（写入时拿不到 size 则 NULL） |
| created_at | TEXT NOT NULL DEFAULT (UTC ISO) | 与 records 同口径 |

**路径口径**：DB 只存相对路径；磁盘操作（写盘/清理/读图）全部在主进程以 `path.join(app.getPath('userData'), relPath)` 还原，protocol 服务前经 `isSubPath` 校验防目录穿越。UUID 文件名 `crypto.randomUUID()`。

### 3.3 关键骨架（必须按此实现）

1. ~~`ok` 事件处理第一行必须 `e.preventDefault()`~~（换库修订：snapora 无 ok/preventDefault 模式，保存接管改为 `screenshot:save` handler 收 buffer 后直接走 saveScreenshot 管线，不经库自带保存）。
2. 顺序铁律：`fs.writeFile` 成功 → 才 `createImageCapture`；失败 → 清理残留文件 → `screenshot:done {ok:false}`，DB 不产生任何记录。
3. `deleteCaptures` 单事务内「先查附件路径 → 删 attachments → 删 records」，返回路径列表；DAO 内不碰磁盘，fs 清理在 handler。
4. `protocol.handle('shiguang-image', ...)` 注册在 `app.whenReady` 内、窗口创建之前。
5. 所有新通道先定义 shared 常量与类型，preload/handler 只从 shared 取——禁止散落字符串。
6. 截图会话幂等靠模块级标志位（进行中忽略重复触发），链路结束 finally 清空；snapora 侧取消（ESC/cancel）经库正常结束回主进程，无任何副作用。
7. 工具栏精简只用 snapora 官方 `tools:[]`（隐藏全部标注工具），不注入 CSS 不改库内交互；动作按钮（撤销/重做/保存/固定/复制/取消）随库不可隐藏（记技术债务）。

### 3.4 数据流 / 状态变更

```
【触发截图】
输入框底部「区域截图」图标按钮 → window.electronSnapora.capture({locale:'zh-CN', tools:[], defaultTool:'select'})
  → snapora 库自建全屏遮罩窗（覆盖全部屏幕，输入框走既有 blur 收起路径）

【截图会话】
setupElectronSnapora 注册 screenshot:save / screenshot:fail（validateSender：file: 放行 + dev origin 放行）
  → 用户选区：
      取消/ESC → 库正常结束，无任何副作用
      完成 → screenshot:save（Uint8Array buffer，structured clone 无 base64）
        → saveScreenshot(buffer) 管线：
            fs.mkdir(userData/images, {recursive:true}) 幂等
            → fs.writeFile(images/<uuid>.png, buffer)
            → createImageCapture({ imagePath: 'images/<uuid>.png', sizeBytes: buffer.length })
            → petWindow.webContents.send('screenshot:done', { ok: true })
      失败/权限拒绝 → screenshot:fail → send('screenshot:done', {ok:false, error})
        （PERMISSION_DENIED 类错误文案含「请在系统设置中开启屏幕录制权限」，库已自动打开系统设置）

【反馈】宠物窗 onDone 订阅：ok → toast 成功；!ok → toast 失败文案

【记录页读图】<img src="shiguang-image://<filename>"> → protocol.handle
  → isSubPath 校验 + fs 存在性 → 200（png）/ 404 → img onError → 「图片丢失」占位

【删除（单/批同构）】confirm → window.api.capture.delete({ids})
  → deleteCaptures(ids)：单事务删两表，返回文件路径列表
  → handler 逐路径尽力 fs.rm（失败仅 console.warn，不阻塞返回）

【复制图片】图片行复制按钮 → window.api.capture.copyImage({id})
  → handler 查 imagePath → 读文件 → clipboard.write([ClipboardItem])（W3C 异步，Electron 44 适配）
```

### 3.5 技术决策

1. **截图库选 electron-snapora@^1.0.25，遮罩窗由库自建、不进三窗架构、不加第 4 renderer 入口**（换库修订，原为 electron-screenshots@^0.6.2）。换库动因：electron-screenshots 硬编码 kiosk:true，macOS 打开截图会隐藏其他应用，产品不可接受。不选自研 desktopCapturer + 透明选区窗（proposal 原预设）：选区交互（八向拖拽、工具栏、多屏坐标）自研成本高且与拾光窗口基线（幂等/显隐状态机）形态完全不同；2026-10 首次选型时 snapora peer electron>=42 不满足锁定的 33、包龄 2 个月未选，本次先升级 Electron 44（决策 12）再选它。选它：无 kiosk/无 fullscreen/禁用 type:'panel'（Space-safe 窗口策略且有单测断言）、零原生模块零运行时依赖、官方 preload 集成（`exposeScreenshotApi` → `window.electronSnapora`）、`tools:[]` 官方精简标注工具、权限处理完善（getMediaAccessStatus 检测，denied 自动打开系统设置并返回 PERMISSION_DENIED）、Uint8Array structured clone 传输无 base64。代价：动作按钮（undo/redo/save/pin/copy/cancel）无官方开关不可隐藏；单人维护、0 star 0 fork、包龄约 2 个月（记技术债务）；macOS 签名打包验证待真机走查。
2. **`ok` 事件 `preventDefault` 接管保存 + 先落盘再入库**。不选「库自带保存对话框」：交互割裂且路径不可控；不选「先入库再补写盘」：写盘失败会留脏记录。写盘失败整体失败、不产生记录（proposal 已对齐）。
3. **两表（records + attachments）+ type 列，不选单表加 image_path 列**：附件模式是 M1 历史 design 既定方向且与「图片存文件系统、库存路径」对齐；单表宽列无法承载未来多附件/元数据（mime/size）且 M9 导出打包需稳定契约。相对路径（相对 userData 根）入库，绝对路径不进 DB——路径契约演进走迁移不改业务代码。
4. **自定义 protocol `shiguang-image://` 读图，不选 base64 入 DB / data URL / file://**：base64 使 SQLite 膨胀且分页查询负重；file:// 在打包态受 asar/权限限制且暴露绝对路径；protocol 统一 dev/prod、自带路径白名单校验（isSubPath 防目录穿越）。
5. **删除级联：DAO 单事务删两表并返回路径列表，fs 清理在 handler 尽力而为**。不选 DAO 内碰磁盘（违反数据层边界）；不选「清理失败则删除回滚」：产品已对齐「记录照删、尽力清理」最简方案，失败记技术债务待 M9 治理。
6. **截图入口放输入框工具栏图标按钮（点击调 `window.electronSnapora.capture({locale:'zh-CN', tools:[], defaultTool:'select'})`），不选宠物右键原生菜单（已撤销）/ 托盘菜单 / 全局热键**：输入框是捕获中枢，截图入口与文字捕获同处一个交互面，类微信输入框截图按钮心智；右键菜单方案已实作又被产品纠正撤销（打断右键 toggle 肌肉记忆），宠物右键恢复「直接 toggle 输入框」现行行为。反馈 toast 仍在宠物窗（输入框于遮罩期间已收起）。
7. **截图反馈走 `screenshot:done` 主→宠物窗推送，不选 renderer 轮询 / invoke 长等待**：截图会话生命周期完全在主进程（库事件驱动），renderer 无状态可轮询；推送一次到位，宠物窗 toast 轻提示（复用自写 toast 模式）。
8. **类型筛选启用 M2 预留扩展位**：`QueryCapturesPayload.type` 缺省=全部，记录页 segmented 三选（全部/文字/图片）入 TanStack Form（defaultValues 增 `type: 'all'`），payload 只传 text/image。不引第三方 segmented 组件，Tailwind 按钮组（aria-pressed）。
9. **记录页提取 RecordRow 子组件**：422 行单文件按「行渲染」切出，props 传入 record + 展开/选中回调；图片行分支（缩略图/展开大图/占位/复制图片）收敛在子组件内，RecordsPage 只管查询/筛选/删除编排。图片行复制按钮走 `capture.copyImage`（主进程写剪贴板），文字行维持 `navigator.clipboard.writeText` 不变。
10. **打包：主进程 `external` 不增列截图库**（换库修订，原为主进程 `external: ['electron-screenshots']` + node-screenshots 原生 ABI rebuild）：snapora 零原生模块零运行时依赖，可正常进 bundle；node-screenshots 随旧库移除后 better-sqlite3 是唯一原生模块，沿用既有 external + postinstall ABI rebuild 模式。**不新增 asarUnpack**（与 agreed_design 打包细节的一处偏差）：electron-builder.yml 现行 `asar: false`，原生模块天然 unpacked，asarUnpack 是无操作配置；若未来开 asar 需补 `asarUnpack: ['**/better-sqlite3/**']`，已记技术债务。
11. **protocol 只服务 `.png` 且文件名白名单化**：`shiguang-image://<filename>` 只取 basename 拼回 images 根，杜绝 `../` 穿越；404 返回空 Response 而非抛错（渲染端 onError 兜底占位）。
12. **Electron 33→44.9.1 升级为换库前置**（换库修订新增）：electron-vite 3→6、better-sqlite3 11→12.11.1（11 依赖的 API 在 Electron 44 V8 已移除）一并升级；`capture:copy-image` 由同步 `clipboard.writeImage` 适配为 W3C 异步 `clipboard.write([ClipboardItem])`。升级后 desktop 125/125、ai 37/37 全绿。
13. **`validateSender` 收窄 snapora 回传面**（换库修订新增）：`setupElectronSnapora({ipcMain, validateSender})` 的 validateSender 只放行 `file:` 协议 + dev origin，不接受任意 origin 回传 `screenshot:save`/`screenshot:fail`；`unregisterSnapora()` 挂 `index.ts` before-quit 防退出期残留监听。
14. **保存链路拆出库无关 `saveScreenshot(buffer)` 管线**（换库修订新增）：写盘→createImageCapture→推 `screenshot:done` 与库完全解耦，换库只改 `screenshotHandlers.ts` 接线，不动数据链路与会话幂等逻辑。

### 3.6 风险 / 取舍

- [风险] electron-snapora 单人维护、0 star 0 fork、npm 包龄约 2 个月 → 缓解：锁版本 `^1.0.25` + 源码深读验证（窗口策略有单测断言、权限处理完善）；`.rail/docs/engineering` 已记回退路：自研遮罩 desktopCapturer + 自写选区窗。
- [风险] snapora macOS 签名打包验证未做（代码/单测齐，signed hardware validation pending）→ 缓解：随任务 25 真机走查补验；不通过则触发回滚条件评估。
- [风险] 动作按钮（undo/redo/save/pin/copy/cancel）无官方开关，`tools:[]` 只能藏标注工具 → 缓解：产品真机走查确认可接受；不可接受则评估回退自研遮罩。
- [风险] snapora 会话结束后 `hostWindow.focus()` 可能重新唤起输入窗 → 缓解：真机走查确认，必要时提 issue 或回退。
- [风险] macOS 屏幕录制权限未授予 → 已解：snapora 经 getMediaAccessStatus 检测，denied 自动打开系统设置并返回 PERMISSION_DENIED，失败文案含权限开启引导。
- [取舍] 删除文件清理失败 → 接受：记录照删、尽力清理，孤儿文件归 M9 统一治理（proposal 已对齐，记技术债务）。
- [取舍] ESC/取消行为完全随库 → 接受：不自定义键位；取消路径无任何副作用（无文件无记录），风险面小。
- [取舍] `listCaptures`/`queryCaptures` 冗余延续 → 接受：既有技术债务，本次不收敛。
- [风险] ~~宠物右键行为变更~~（已随入口修订消解：右键恢复直接 toggle，零行为变更）

### 3.7 技术债务

- 删除文件清理失败产生孤儿文件（无重试无扫描）——随 M9 存储治理一并设计（重试 / 启动扫描）。
- 存储膨胀 / 孤儿文件整体治理归 M9（proposal 既定）。
- 图片路径契约演进（目录调整 / 格式转换）走 DAO/迁移层，业务代码不感知；本次仅确立「DB 存相对路径」契约。
- ESC 与取消键行为随 electron-snapora 库，不自定义。
- snapora 动作按钮（undo/redo/save/pin/copy/cancel）无官方开关不可隐藏；会话结束 hostWindow.focus() 可能重新唤起输入窗——均待任务 25 真机走查确认。
- 若未来 electron-builder 开启 asar，需补 `asarUnpack: ['**/better-sqlite3/**']`（现行 asar:false 无需；node-screenshots 已随换库移除）。
- 同步登记 `.rail/docs/engineering/README.md`：electron-snapora 单人维护/包龄/签名验证风险一条；Electron 33 锁版本债务已随升级解除，改写为「Electron 44 + electron-vite 6 + better-sqlite3 12 基线」决策。

### 3.8 影响文件清单

**packages/shared/**
- `src/index.ts`：IPC 增 screenshotSave / screenshotFail / screenshotDone / captureCopyImage（换库修订：screenshotStart 随 electron-screenshots 移除）；CaptureRecord 增 type / imagePath；QueryCapturesPayload 增 type；新增 ScreenshotDonePayload / CopyImagePayload（pet:menu 曾增后随入口修订撤销）

**packages/ai/**
- `src/migrations/0002_attachment.ts`（新建）：records 加列 type（含 CHECK）+ 建 attachments 表
- `src/db.ts`：migrations 数组登记 0002
- `src/dao/captureDao.ts`：createImageCapture；deleteCaptures 改级联返 string[]；queryCaptures 加 type + LEFT JOIN；createCapture / listCaptures 适配新列与 JOIN
- `src/dao/captureDao.test.ts`：迁移后建表/两表写入/级联删除/类型筛选测试（照临时目录真实 SQLite 样板）
- `src/index.ts`：导出同步（createImageCapture）

**apps/desktop 主进程**
- `package.json`（换库修订）：dependencies 换 electron-snapora@^1.0.25（移除 electron-screenshots/node-screenshots/react-screenshots，postinstall 不再需 rebuild 覆盖）；electron ^33→^44.9.1、electron-vite ^3→^6、better-sqlite3 ^11→^12.11.1
- `electron.vite.config.ts`（换库修订）：主进程 external 不增列截图库（snapora 零原生依赖可进 bundle），仅余 better-sqlite3 external 不变
- `electron-builder.yml`：不改动（asar:false 已覆盖，决策 10）
- `src/main/screenshot/screenshotService.ts`（新建）：库无关 `saveScreenshot(buffer)` 管线（写盘→createImageCapture→推 screenshot:done）、会话幂等标志位、isSubPath
- `src/main/screenshot/imageProtocol.ts`（新建）：protocol.handle 注册
- `src/main/ipc/screenshotHandlers.ts`（新建）：setupElectronSnapora（validateSender：file: + dev origin）+ screenshot:save / screenshot:fail 接线 + unregisterSnapora()（before-quit）+ capture:copy-image（W3C 异步 clipboard.write）
- `src/main/ipc/captureHandlers.ts`：capture:delete 适配 deleteCaptures 返回路径 + 尽力清理磁盘
- `src/main/ipc/registerIpc.ts`：汇总 registerScreenshotHandlers
- `src/main/windows/petWindow.ts`：不改动（入口修订后右键维持 pet:clicked）
- `src/main/index.ts`：whenReady 内增 registerImageProtocol()（窗口创建前）+ before-quit 挂 unregisterSnapora()

**apps/desktop preload**
- `src/preload/index.ts`：合入 snapora 官方 exposeScreenshotApi（window.electronSnapora）；ShiguangApi 的 screenshot 分组只留 onDone（start 随旧库移除）、capture.copyImage 不变

**apps/desktop renderer**
- `src/renderer/input/features/capture/capture-form.tsx`：底部工具栏常驻「区域截图」图标按钮（lucide Camera）→ window.electronSnapora.capture({locale:'zh-CN', tools:[], defaultTool:'select'})
- `src/renderer/pet/main.ts`：不改动（右键维持 pet.clicked 直接 toggle；onDone toast 订阅不变）
- `src/renderer/console/pages/RecordRow.tsx`（新建）：行子组件（checkbox/缩略图或文字预览/时间/复制/删除）
- `src/renderer/console/pages/RecordsPage.tsx`：提取 RecordRow；类型筛选 segmented + form.type 字段；删除确认含图片提示；图片行展开大图与占位接线

**`.rail/docs/`**
- `engineering/README.md`：Electron 44 基线决策 + snapora 债务登记（单人维护/包龄/签名待验），旧 electron-screenshots/锁 33/asarUnpack 三条债务解除
- `screenshot/README.md`：选型决策重写为 snapora（含 kiosk 教训），CSS 注入债务删除，补 validateSender 与 saveScreenshot 管线解耦决策

## 4. 回滚条件

- 遮罩截图链路在 Electron 44 上出现不可修复的兼容问题 → 回滚库接入，保留迁移 0002 与 DAO 扩展（纯数据层无风险），截图图标按钮隐藏待重选型。
- snapora 在 macOS 签名打包环境验证不通过（或动作按钮/hostWindow.focus() 真机走查不可接受）且无法修通 → 回退自研遮罩（desktopCapturer + 自写选区窗）重选型，saveScreenshot 管线与数据层零改动可直接复用。
- protocol 方案在打包态被系统策略拦截（企业环境禁用自定义 protocol）→ 回退读图为 file:// 白名单方案需重设计，此时整体回滚 M4 记录页图片渲染部分。
