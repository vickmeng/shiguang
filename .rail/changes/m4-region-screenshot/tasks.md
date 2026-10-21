---
slug: m4-region-screenshot
derived_from: .rail/changes/m4-region-screenshot/design.md
---

# Tasks — m4-region-screenshot

## 实现任务

### packages/shared

- [x] 任务 1：在 `packages/shared/src/index.ts` 的 `IPC` 常量中新增 `screenshotStart: 'screenshot:start'`、`screenshotDone: 'screenshot:done'`、`petMenu: 'pet:menu'`、`captureCopyImage: 'capture:copy-image'` 四个通道；`CaptureRecord` 接口新增 `type: 'text' | 'image'` 与 `imagePath: string | null` 两个字段；`QueryCapturesPayload` 新增 `type?: 'text' | 'image'`（注释「缺省=全部」）；新增导出 `ScreenshotDonePayload`（`{ ok: true } | { ok: false; error: string }`）与 `CopyImagePayload`（`{ id: number }`）。
  - **前置条件**：无
  - **对应验收标准**：AC-10
  - **关键契约**：
    ```ts
    export type ScreenshotDonePayload = { ok: true } | { ok: false; error: string };
    export interface CopyImagePayload { id: number }
    ```

### packages/ai（迁移与 DAO）

- [x] 任务 2：新建 `packages/ai/src/migrations/0002_attachment.ts`：`up` 执行 `ALTER TABLE records ADD COLUMN type TEXT NOT NULL DEFAULT 'text'` 并追加列级 CHECK 约束（`CHECK(type IN ('text','image'))`，SQLite 支持 ADD COLUMN 携带列级 CHECK），随后 `CREATE TABLE attachments`（id INTEGER PK AUTOINCREMENT / record_id INTEGER NOT NULL REFERENCES records(id) / file_path TEXT NOT NULL / mime_type TEXT NOT NULL DEFAULT 'image/png' / size_bytes INTEGER / created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))）；`down` 执行 `DROP TABLE IF EXISTS attachments` 并重建无 type 列的 records 表拷贝回原数据；在 `packages/ai/src/db.ts` 的 `migrations` 数组中按序登记该迁移（import 后追加）。
  - **前置条件**：无（纯数据层 DDL，不依赖 shared；DAO 任务须等本任务与任务 1 均完成）
  - **对应验收标准**：AC-3
  - 先写测试（TDD）：`captureDao.test.ts` 照「临时目录真实 SQLite」样板（mkdtempSync + initDatabase + setCaptureDatabase），断言迁移后 `PRAGMA table_info(records)` 含 type 列且默认 'text'、attachments 表存在、旧库（仅 0001 结构）升级后旧文字记录 type 均为 'text'。

- [x] 任务 3：在 `packages/ai/src/dao/captureDao.ts` 适配读取路径：`RecordRow` 增 `type`，新增 `AttachmentRow`（record_id/file_path 等）；`toRecord` 增 `type` 与 `imagePath`（由 JOIN 出的 file_path 映射，无附件行时为 null）；`createCapture` 的 INSERT 显式写入 `type='text'`；`listCaptures` 的 SELECT 改为 `SELECT records.*, attachments.file_path AS image_path FROM records LEFT JOIN attachments ON attachments.record_id = records.id ...`（排序/LIMIT 不变）。
  - **前置条件**：`[1, 2]`
  - **对应验收标准**：AC-3
  - 先写测试（TDD）：迁移后 `listCaptures` 返回的记录含 `type: 'text'`、`imagePath: null`；既有 createCapture 测试全部保持绿（type 断言补 'text'）。

- [x] 任务 4：在 `captureDao.ts` 新增 `createImageCapture(input: { imagePath: string; sizeBytes?: number }): CaptureRecord`：单事务内 `INSERT INTO records (text, source_app, type, created_at) VALUES ('', 'screenshot', 'image', strftime(...)) RETURNING id`，再 `INSERT INTO attachments (record_id, file_path, size_bytes, created_at) VALUES (?, ?, ?, strftime(...))`；返回经 toRecord 组装的记录（type='image'、text=''、sourceApp='screenshot'、imagePath=input.imagePath）；在 `packages/ai/src/index.ts` 再导出。
  - **前置条件**：`[3]`
  - **对应验收标准**：AC-3
  - **关键契约**：`export function createImageCapture(input: { imagePath: string; sizeBytes?: number }): CaptureRecord`
  - 先写测试（TDD）：写入后 records 行（text=''/source_app='screenshot'/type='image'）与 attachments 行（file_path/size_bytes）同时存在且 record_id 关联；事务性——attachments 插入失败时 records 行也不残留（可用触发器或显式校验断言两表一致）。

- [x] 任务 5：在 `captureDao.ts` 扩展 `queryCaptures`：`input.type !== undefined` 时追加条件 `type = ?`（参数化）；SELECT 改为与任务 3 相同的 LEFT JOIN 形态（返回 type/imagePath）；`total` 的 COUNT 查询同步加 type 条件（items 与 total 同条件）。
  - **前置条件**：`[3]`
  - **对应验收标准**：AC-4
  - 先写测试（TDD）：混合 text/image 记录后，`type: 'text'` 仅返回文字记录、`type: 'image'` 仅返回图片记录（含 imagePath 为相对路径）、不传 type 返回全部；type 与 keyword/since/until 组合仍正确。

- [x] 任务 6：在 `captureDao.ts` 改造 `deleteCaptures(ids)` 返回 `string[]`：单事务内先 `SELECT file_path FROM attachments WHERE record_id IN (...)` 收集路径列表，再 `DELETE FROM attachments WHERE record_id IN (...)`，最后 `DELETE FROM records WHERE id IN (...)`；空数组直接返回 `[]` 不执行删除；返回收集到的 file_path 数组。函数注释更新为「级联删 attachments，返回待清理的相对文件路径列表，磁盘清理由调用方负责」。
  - **前置条件**：`[4]`
  - **对应验收标准**：AC-7、AC-12
  - **关键契约**：`export function deleteCaptures(ids: number[]): string[]`
  - 先写测试（TDD）：删图片记录返回 `['images/xxx.png']` 且两表行均消失；删文字记录返回 `[]`；混合批量删除返回全部图片路径；空数组返回 `[]` 不抛错；删除后外键无悬挂（attachments 中无对应 record_id）。

### apps/desktop 依赖与打包

- [x] 任务 7：在 `apps/desktop/package.json` 添加依赖 `electron-screenshots: ^0.6.2`（dependencies），并配置 node-screenshots 原生模块的 Electron ABI rebuild postinstall（照 `packages/ai/package.json` 中 better-sqlite3 的 `@electron/rebuild` postinstall 模式，确保 rebuild 覆盖 node-screenshots）；在 `apps/desktop/electron.vite.config.ts` 主进程 `rollupOptions.external` 数组中增列 `'electron-screenshots'`（注释「原生依赖不打包，运行时 require」）；`electron-builder.yml` 不改动（asar:false 已使原生模块 unpacked）。
  - **前置条件**：无（可与其他组并行）
  - **对应验收标准**：AC-3（链路可运行之前置）
  - 验证：`pnpm install` 后 `pnpm --filter @shiguang/desktop typecheck` 通过；dev 态 `require('electron-screenshots')` 不报 ABI 错（随任务 10 联调）。

### apps/desktop 主进程截图链路

- [x] 任务 8：新建 `apps/desktop/src/main/lib/pathGuard.ts`，导出纯函数 `isSubPath(root: string, target: string): boolean`：将两路径均经 `path.resolve` 规范化后，判断 target 是否等于 root 或以 `root + path.sep` 开头（返回 boolean，不抛错）。
  - **前置条件**：无（可与其他组并行）
  - **对应验收标准**：AC-11
  - 先写测试（TDD）：`src/main/lib/pathGuard.test.ts` 照 windowGeometry.test.ts 样板——images 根内文件 true、`../` 穿越 false、同级前缀混淆（如 `/root/images-evil/x.png` 对 root=/root/images）为 false、不存在的路径按字符串判定。

- [x] 任务 9：新建 `apps/desktop/src/main/screenshot/imageProtocol.ts`，导出 `registerImageProtocol(): void`：内部 `protocol.handle('shiguang-image', (request) => ...)`——从 URL 取 pathname 的 basename，拼 `path.join(app.getPath('userData'), 'images', basename)`；经任务 8 的 `isSubPath(imagesDir, resolved)` 校验且后缀为 `.png`、文件存在时返回 `net.fetch(pathToFileURL(resolved).toString())` 的 Response；否则返回 `new Response(null, { status: 404 })`。
  - **前置条件**：`[8]`
  - **对应验收标准**：AC-6、AC-10
  - 说明：`protocol.handle` 必须在 app ready 后注册，装配在任务 13 完成。

- [x] 任务 10：新建 `apps/desktop/src/main/screenshot/screenshotService.ts`，导出 `getImagesDir(): string`（`path.join(app.getPath('userData'), 'images')`，调用方负责 mkdir）与模块级 Screenshots 单例封装：构造函数后挂 `windowCreated` 监听——`$win.webContents.on('did-finish-load', ...)` 注入 `insertCSS` 隐藏工具栏按钮（画笔/马赛克/箭头/文字/椭圆/矩形/保存等，只留「完成/取消」；CSS 选择子以库 0.6.2 实际 DOM 为准并在注释标注）；再挂 `ok` / `cancel` 监听，`ok` 回调第一行 `e.preventDefault()`，body 留空由任务 11 填充；导出 `startCapture(): void`（会话进行中标志位幂等，未在会话中时调 `screenshots.start()`）。
  - **前置条件**：`[7]`
  - **对应验收标准**：AC-2
  - 先写测试（TDD）：handler 测试文件（任务 12 建）中 mock `electron-screenshots`（vi.mock 工厂返回构造函数桩，捕获实例 on 的 ok/cancel/windowCreated 回调），断言 startCapture 调用了 `start()`、重复触发被幂等忽略。

- [x] 任务 11：在 `screenshotService.ts` 填充 `ok` 回调的落盘入库链路（async）：`fs.mkdir(imagesDir, { recursive: true })` → `crypto.randomUUID()` 生成文件名 → `await fs.promises.writeFile(absPath, buffer)` → 调 `createImageCapture({ imagePath: 'images/<uuid>.png', sizeBytes: buffer.length })` → `getPetWindow()?.webContents.send(IPC.screenshotDone, { ok: true })`；任一步异常（含权限/磁盘错误）→ 尽力 `fs.promises.unlink` 已写文件（存在才删）→ 组装错误文案（权限类错误文案含「请在系统设置中开启屏幕录制权限」）→ `send(IPC.screenshotDone, { ok: false, error })`。`cancel` 回调静默清空会话标志位。
  - **前置条件**：`[4, 10]`
  - **对应验收标准**：AC-3、AC-8、AC-12
  - 先写测试（TDD）：mock fs（vi.mock node:fs/promises）与 electron-screenshots——写盘成功路径断言 createImageCapture 被调且 send `{ok:true}`；写盘失败路径断言 createImageCapture 未被调、send `{ok:false, error}` 且 unlink 被尝试。

- [x] 任务 12：新建 `apps/desktop/src/main/ipc/screenshotHandlers.ts`，导出 `registerScreenshotHandlers(): void`：`ipcMain.removeAllListeners(IPC.screenshotStart)` + `ipcMain.on(IPC.screenshotStart, () => startCapture())`；`ipcMain.handle(IPC.captureCopyImage, async (_e, payload: CopyImagePayload) => { const rec = queryCaptures({...}); ... })`——按 id 查记录（直接 SQL 或经 queryCaptures 单条），`type !== 'image'` 或 `imagePath` 为空时抛 Error('该记录不是图片')；`nativeImage.createFromPath(path.join(userData, imagePath))`，`image.isEmpty()` 时抛 Error('图片文件缺失或损坏')；否则 `clipboard.writeImage(image)`。
  - **前置条件**：`[11]`
  - **对应验收标准**：AC-9
  - 先写测试（TDD）：mock electron 的 nativeImage/clipboard 与 DAO——图片记录写剪贴板成功；文字记录/缺失文件抛错被 invoke 拒绝。

- [x] 任务 13：在 `apps/desktop/src/main/ipc/captureHandlers.ts` 的 `capture:delete` handler 中接入磁盘尽力清理：`deleteCaptures(payload.ids)` 返回值赋给 `const imagePaths`，随后对每条路径 `fs.rm(path.join(app.getPath('userData'), p), { force: true })` 逐个 `try/catch`（catch 仅 `console.warn` 不抛出）；在 `apps/desktop/src/main/ipc/registerIpc.ts` 的 `registerIpc()` 中调用 `registerScreenshotHandlers()`；在 `apps/desktop/src/main/index.ts` 的 `app.whenReady()` 内、`createPetWindow()` 之前调用 `registerImageProtocol()`。
  - **前置条件**：`[6, 9, 12]`
  - **对应验收标准**：AC-7、AC-10、AC-12
  - 删除清理失败的孤儿文件不阻塞删除返回（console.warn 记日志，技术债务）。

### apps/desktop 宠物窗入口与 preload

- [x] 任务 14：在 `apps/desktop/src/preload/index.ts` 扩展 `ShiguangApi` 与实现：新增 `screenshot` 分组 `start(): void`（`ipcRenderer.send(IPC.screenshotStart)`）与 `onDone(cb)`（`ipcRenderer.on(IPC.screenshotDone, listener)` 转发 payload，返回 `removeListener` 取消函数，照 `pet.onSetState` 现有写法）；`capture` 分组新增 `copyImage(payload: CopyImagePayload): Promise<void>`（invoke）。~~`pet` 分组新增 `menu(): void`~~（随入口修订撤销，pet:menu 与 pet.menu 已移除）。
  - **前置条件**：`[1]`
  - **对应验收标准**：AC-10
  - 确认 `src/renderer/env.d.ts` 经 `ShiguangApi` 导入自动获得新类型、无需改动。

- [x] ~~任务 15~~【已废弃】~~在 `apps/desktop/src/main/windows/petWindow.ts` 的 `registerPetWindowIpc()` 中增列 `pet:menu` 监听~~：原生 Menu 右键菜单方案已被产品纠正撤销（2026-10-19 入口修订），pet:menu 通道、Menu.popup、preload pet.menu 均已移除，宠物右键恢复直接 toggle。由任务 27 取代。
- [x] ~~任务 16~~【已废弃】~~在 `apps/desktop/src/renderer/pet/main.ts` 将容器 `contextmenu` 监听回调由 `window.api.pet.clicked()` 改为 `window.api.pet.menu()`~~：随入口修订撤销，contextmenu 恢复调 `pet.clicked()`。由任务 27 取代。

- [x] 任务 17：在 `apps/desktop/src/renderer/pet/main.ts` 接线截图反馈：`window.api.screenshot.onDone((payload) => { payload.ok ? toast 成功文案（如「截图已存入拾光」） : toast 失败文案（payload.error） })`；toast 用自写轻提示（若 pet 入口无 toast 基础设施，则用 `document.title` 之外的轻量方案——创建固定定位 div、2s 自动消失，Tailwind 不可用则内联样式，注释标注「与 console toast 同语义的最小实现」）。
  - **前置条件**：`[16]`
  - **对应验收标准**：AC-8
  - 宠物窗无 React，toast 为 vanilla DOM 实现；onDone 订阅在 bootstrap 内、`onSetState` 订阅旁。

### apps/desktop 记录页

- [x] 任务 18：新建 `apps/desktop/src/renderer/console/pages/RecordRow.tsx`，导出 `RecordRow` 子组件：props 为 `{ record: CaptureRecord; expanded: boolean; selected: boolean; onToggleExpand(): void; onToggleSelect(): void; onDelete(): void }`；行结构照 RecordsPage 现行 li 内容平移——常驻 checkbox（阻止冒泡）、内容区、复制按钮、删除按钮（均阻止冒泡）；内容区按 `record.type` 分支：text 行渲染截断/展开全文（line-clamp-3 语义不变）；image 行本任务先渲染 `<img src={shiguang-image://<basename>}>` 缩略图（宽约 96px、`object-contain`、圆角边框）替代文字预览，时间行不变；复制按钮对 image 行调 `window.api.capture.copyImage({ id })`（then 弹 toast「已复制到剪贴板」），对 text 行维持 `navigator.clipboard.writeText`。
  - **前置条件**：`[14]`
  - **对应验收标准**：AC-3、AC-9
  - 先写组件测试（TDD）：mock window.api——text 行渲染文字预览、image 行渲染 `shiguang-image://` 缩略图、image 行点复制触发 `copyImage({id})` 而非 clipboard.writeText、text 行点复制仍 writeText。

- [x] 任务 19：在 `RecordRow.tsx` 实现图片行的展开大图与丢失占位：image 行点击展开（expanded=true）时在缩略图下方渲染大图（最大宽约 480px、`object-contain`、点击行为与行展开/折叠一致）；`<img>` 挂 `onError` 状态——加载失败渲染「图片丢失」占位（灰色虚线框 + 「图片丢失」文字，替代缩略图/大图）。
  - **前置条件**：`[18]`
  - **对应验收标准**：AC-5、AC-6
  - 先写组件测试（TDD）：展开 image 行显示大图、折叠消失；img 触发 error 事件后渲染「图片丢失」占位文字；占位态下复制/删除按钮仍可用。

- [x] 任务 20：在 `apps/desktop/src/renderer/console/pages/RecordsPage.tsx` 提取接线：列表 `result.items.map` 内的 li 整体替换为 `<RecordRow record={item} expanded={expandedId===item.id} selected={selectedIds.has(item.id)} onToggleExpand={...} onToggleSelect={() => toggleSelected(item.id)} onDelete={() => setDeletingId(item.id)} />`；原 li 内联 JSX 删除；RecordsPage 其余查询/筛选/删除编排逻辑（含页回退、refreshTick）一字不动。
  - **前置条件**：`[18]`
  - **对应验收标准**：AC-3
  - 先改组件测试（TDD）：RecordsPage 既有测试（列表渲染/展开/勾选批删/筛选）全部改经 RecordRow 后保持绿，无需改动断言。

- [x] 任务 21：在 `RecordsPage.tsx` 筛选区新增类型 segmented 三选（全部/文字/图片）：TanStack Form 的 defaultValues 增 `type: 'all' as 'all'|'text'|'image'`；渲染三个 `aria-pressed` 按钮（样式照时间预设 chips），点击 `form.setFieldValue('type', v)` 并 `setPage(1)`；查询 effect 的 payload 组装处 `filters.type !== 'all'` 时 `payload.type = filters.type`；空状态「有筛选条件」判断同步纳入 `filters.type !== 'all'`。
  - **前置条件**：`[5, 20]`
  - **对应验收标准**：AC-4
  - 先写组件测试（TDD）：点「图片」触发带 `type:'image'` 的 capture.list 调用、点「文字」带 `type:'text'`、点「全部」不带 type 字段；切类型重置 page=1；类型+关键词组合 payload 同时含两者。

- [x] 任务 22：在 `RecordsPage.tsx` 调整删除确认文案：单条删除确认框的 description 由固定「删除后不可恢复。」改为按目标记录动态拼接——待删记录 `type==='image'` 时显示「删除后不可恢复。将同时删除图片文件。」，text 记录维持原文案；批量删除确认框 description 在勾选集含图片记录时显示「删除后不可恢复。将同时删除已选记录的图片文件。」（纯文字勾选集维持原文案）。
  - **前置条件**：`[20]`
  - **对应验收标准**：AC-7
  - 先写组件测试（TDD）：对 image 行点删除，确认框含「将同时删除图片文件」；对 text 行不含；批量勾选混合集时含扩展文案。

### 测试补强、文档与收尾

- [x] 任务 23：补 RecordsPage 集成向组件测试（在既有 `RecordsPage.test.tsx` 增 describe）：mock `capture.list` 返回混合 type 记录——断言 image 行与 text 行同屏渲染、类型筛选切「图片」后列表仅图片行、「图片丢失」占位在 img error 后出现；确认既有测试套件（M2 全部用例）与新增用例同跑全绿。
  - **前置条件**：`[19, 21]`
  - **对应验收标准**：AC-4、AC-6、AC-11
  - 本任务只做测试增补，不改实现代码；若实现缺陷暴露则回改对应实现任务并同步勾选。

- [x] 任务 24：登记技术债务文档：`.rail/docs/engineering/README.md` 技术债务区新增三条——「删除图片记录文件清理失败产生孤儿文件，无重试/扫描，随 M9 存储治理设计」「electron-screenshots 单人维护 + node-screenshots 原生模块锁版本，Electron 升级迭代需重评估（electron-snapora peer>=42 为重评估入口，已调研未选）」「若未来 electron-builder 开启 asar 需补 asarUnpack: ['**/node-screenshots/**']（现行 asar:false 无需）」；既有「Electron 锁 ^33」一条补充「M4 已接入 electron-screenshots（peer>=20 兼容）」。
  - **前置条件**：无（可与开发组并行，收尾前完成即可）
  - **对应验收标准**：—（design 3.7 技术债务落账）

- [ ] 任务 25：手动验收走查（AC 全量）：① 输入框底部工具栏常驻「区域截图」图标按钮，点击进全屏遮罩；宠物右键仍直接 toggle 输入框（行为与 M2 一致）（AC-1）；② 全屏遮罩多屏覆盖、标注工具经 tools:[] 全部隐藏（动作按钮随库，不可再精简）、ESC 取消无记录（AC-2）；③ 选区落盘入库 + 记录页缩略图（AC-3）；④ 类型筛选三态与组合（AC-4）；⑤ 展开大图（AC-5）；⑥ 手动删磁盘文件后「图片丢失」占位且可删除（AC-6）；⑦ 删除级联清理磁盘文件、批量同、确认文案（AC-7）；⑧ 写盘失败无记录 + 失败提示、权限文案（AC-8）；⑨ 图片复制到剪贴板（AC-9）；⑩ 极小选区照常入库（AC-12）；⑪ `pnpm typecheck` 三包通过、`pnpm --filter @shiguang/ai test` 与 desktop vitest 全绿（AC-11）。
  - 人工走查待办（不由任务勾选覆盖）：上述 ①~⑩ 均需真机手动执行，自动化不覆盖截图链路真机行为。
  - **前置条件**：`[13, 17, 22, 23, 27]`
  - **对应验收标准**：AC-1 ~ AC-12

- [ ] 任务 26：rail-code 收尾惯例：`tasks.md` 的任务勾选必须与对应代码改动同一次提交；最终提交前确认全部任务勾选状态与代码实际状态一致，不允许「先提交后补勾」或「勾了未提交」。
  - **前置条件**：`[25]`
  - **对应验收标准**：—（rail-code 流程惯例）

- [x] 任务 27【入口修订，2026-10-19】：将截图触发入口由「宠物右键原生菜单」改为「输入框工具栏图标按钮」——`capture-form.tsx` 底部工具栏常驻 lucide Camera 图标按钮（aria-label/title「区域截图」），点击 `window.api.screenshot.start()`；撤销任务 15/16 的 pet:menu 方案：`shared` 移除 `petMenu` 通道、preload 移除 `pet.menu`、`petWindow.ts` 移除 Menu 监听与 startCapture 导入、`pet/main.ts` contextmenu 恢复 `pet.clicked()`；同步清理 5 处测试 mock 的 `menu` 字段；`screenshot:done` 反馈通道与宠物窗 toast 不变（输入框于遮罩期间收起，toast 落宠物窗）。
  - **前置条件**：`[14]`（screenshot.start 已存在于 preload）
  - **对应验收标准**：AC-1（修订后）
  - 先写组件测试（TDD）：capture-form 点击「区域截图」按钮触发 `screenshot.start` 且不提交文字表单。

## 换库修订任务（2026-10-19，electron-screenshots → electron-snapora，均已完成）

> 背景：electron-screenshots 硬编码 kiosk:true 导致 macOS 打开截图隐藏其他应用；更换为 electron-snapora@^1.0.25（无 kiosk、官方 preload 集成、tools:[] 精简标注工具、权限处理完善、零原生模块）。前置：Electron 33→44.9.1、electron-vite 3→6、better-sqlite3 11→12.11.1。desktop 125/125、ai 37/37 全绿。

- [x] 任务 R1【Phase 0，依赖升级】：electron ^33→^44.9.1、electron-vite ^3→^6、better-sqlite3 ^11→^12.11.1（11 依赖的 API 在 Electron 44 V8 已移除）；修复升级连带破坏（含 `capture:copy-image` 由同步 `clipboard.writeImage` 适配 W3C 异步 `clipboard.write([ClipboardItem])`）；三包 typecheck 与全量测试绿。
- [x] 任务 R2【Phase 1，链路重写】：shared 移除 `screenshotStart`、新增 `screenshotSave`/`screenshotFail` 通道与 payload 类型；`screenshotService.ts` 拆出库无关 `saveScreenshot(buffer)` 管线（写盘→createImageCapture→推 `screenshot:done`）；`screenshotHandlers.ts` 接入 `setupElectronSnapora({ipcMain, validateSender})`（validateSender：file: 放行 + dev origin 放行）+ `screenshot:save`/`screenshot:fail` handler + `unregisterSnapora()` 挂 `index.ts` before-quit；preload 合入 `exposeScreenshotApi`（`window.electronSnapora`）；capture-form 图标改调 `capture({locale:'zh-CN', tools:[], defaultTool:'select'})`；移除 electron-screenshots/node-screenshots/react-screenshots 依赖与 external/rebuild 配置。
- [x] 任务 R3【Phase 2，文档归档】：`docs/REQUIREMENTS.md` 变更记录追加换库条目；`.rail/docs/engineering|screenshot` 选型决策与债务改写（Electron 锁 33 / electron-screenshots 维护 / node-screenshots asarUnpack 三条债务解除，新增 snapora 单人维护/包龄/签名待验/动作按钮不可隐藏债务）；design.md/proposal.md/tasks.md 同步换库修订叙述。

## 并行组说明

- 可并行起步：任务 1（shared）∥ 任务 2（迁移，仅机械依赖登记）∥ 任务 7（依赖安装）∥ 任务 8（pathGuard 纯函数）。
- 关键路径：1+2 → 3 → 4 → 6 → 13；10 → 11 → 12 → 13；14 → 17；18 → 19/20 → 21/22 → 23 → 25 → 26；27（入口修订）插在 14 之后。
- 任务 24 全程可与开发任务并行，仅需在任务 25 前完成。
- 任务 15/16（宠物右键菜单）已废弃：编码后产品纠正入口为输入框图标（任务 27），关键路径中已剔除。
