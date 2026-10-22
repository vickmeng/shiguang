---
slug: m4-graphic-capture
derived_from: .rail/changes/m4-graphic-capture/design.md
---

# Tasks — m4-graphic-capture

> 排程说明：两组可无依赖同发——**截图移除组**（任务 1~5，内部序 1→2/3→4/5）与**数据层组**（任务 6~9，内部串行 6→7→8→9）；**shared 组**（任务 10→11，无依赖，建议最优先落地，因截图移除组任务 2/3 与主进程组任务 13/15 消费 shared 新契约）。截图移除组**先于并独立于**输入框 Lexical 接入（任务 14~18）：截图移除完成后 capture-form 不再引用 `window.electronSnapora`，Lexical 重写才在同文件干净展开（任务 4 与任务 15 同文件，须 4 先于 15）。Lexical 链 14→15→16→17→18（15 起同文件串行）。记录页任务 19/20 依赖 11，可与主进程组并行。任务 21 收尾依赖全部实现任务；任务 22 手动走查依赖 21。注意：任务 1/10/11 落地后至消费方清理完成前存在过渡期编译错误，属预期，最终以任务 21 全绿为准。

## 实现任务

### 截图功能移除（与数据层组可并行；先于输入框 Lexical 接入）

- [x] 任务 1：卸载 `apps/desktop/package.json` 的 `electron-snapora` 依赖行（`"electron-snapora": "^1.0.25"`），运行 `pnpm install` 更新 lockfile 并确认 `node_modules/electron-snapora` 已移除。
  - **前置条件**：无
  - **对应验收标准**：AC-8
  - 本任务落地后主进程 `screenshotHandlers.ts` 的 `import ... from 'electron-snapora/main'` 即悬空，编译错误属预期，任务 2 清理。

- [x] 任务 2：删除 `apps/desktop/src/main/ipc/screenshotHandlers.ts` 整文件；在 `apps/desktop/src/main/ipc/captureHandlers.ts` 迁入 `capture:copy-image` handle（原逻辑搬入：经 `queryCaptures` 查记录，`rec.imagePaths.length === 0` 抛 `Error('该记录不是图片')`，读 `path.join(app.getPath('userData'), rec.imagePaths[0])` → `nativeImage.createFromPath` → `isEmpty()` 抛 `Error('图片文件缺失或损坏')` → W3C `clipboard.write([new ClipboardItem({ 'image/png': Blob })])`），补 `path` / `clipboard` / `ClipboardItem` / `nativeImage` / `queryCaptures` / `CopyImagePayload` 导入；`apps/desktop/src/main/ipc/registerIpc.ts` 删 `registerScreenshotHandlers` 的 import 与调用；`apps/desktop/src/main/index.ts` 删 `unregisterSnapora` 的 import 与 before-quit 调用（`registerImageProtocol` 保留）。
  - **前置条件**：`[1, 11]`
  - **对应验收标准**：AC-8、AC-9
  - 先改测试（TDD）：新建/改造 `captureHandlers.test.ts`（照 `screenshotHandlers.test.ts` 的 electron stub 样板迁移 copy-image 用例）——多图记录复制 `imagePaths[0]` 对应文件、`imagePaths: []` 抛「该记录不是图片」、文件缺失抛「图片文件缺失或损坏」；`screenshotHandlers.test.ts` 整文件删除。
  - `registerIpc.ts` / `main/index.ts` 为删引用改动，无需新测试。

- [x] 任务 3：清理 `apps/desktop/src/preload/index.ts` 与 `apps/desktop/src/renderer/env.d.ts`——preload 删 `ShiguangApi` 的 `screenshot` 分组（`save` / `fail` / `onDone` 的类型声明与 `api` 实现）、删 `import { exposeScreenshotApi } from 'electron-snapora/preload'` 与文件底部 `exposeScreenshotApi({ contextBridge, ipcRenderer })` 调用及其注释、删 `ScreenshotDonePayload` / `ScreenshotFailPayload` / `ScreenshotSavePayload` 类型导入；env.d.ts 删 `import type { ScreenshotRendererApi } from 'electron-snapora/types'` 与 `Window.electronSnapora` 声明及注释。
  - **前置条件**：`[11]`
  - **对应验收标准**：AC-8

- [x] 任务 4：在 `apps/desktop/src/renderer/input/features/capture/capture-form.tsx` 移除截图入口——删 `handleScreenshot` 函数、`Camera` 图标按钮（`aria-label`/`title`「区域截图」）及其 onClick，更新文件头行为契约注释（删「底部工具栏常驻区域截图按钮」段与 save/fail 结果分支描述，注明截图功能已移除、改由系统截图 + Cmd+V 粘贴）。
  - **前置条件**：`[3]`
  - **对应验收标准**：AC-8
  - 先改测试（TDD）：`capture-form.test.tsx` 删除 mock `window.electronSnapora.capture` 与截图按钮相关用例，断言渲染结果中无 `aria-label="区域截图"` 按钮。

- [x] 任务 5：在 `apps/desktop/src/renderer/pet/main.ts` 删除 `window.api.screenshot.onDone(...)` 订阅块及其上方「M4 截图反馈」注释；保留 `toast` / `toastHost` / `TOAST_DURATION` 基础设施（在 `toast` 函数上方加一行注释「基础设施保留：后续里程碑 toast 复用」以避免未使用告警）。
  - **前置条件**：`[3]`
  - **对应验收标准**：AC-8

### packages/ai（迁移 0003 + DAO）

- [x] 任务 6：新建 `packages/ai/src/migrations/0003_drop_type.ts`，导出 `migration = { name: '0003_drop_type', up, down }`（沿用 0002 的 `MigrationContext` 结构化类型与默认导出形态）：up 依次执行 `ALTER TABLE records DROP COLUMN type;` 与 `ALTER TABLE records ADD COLUMN document TEXT;`（Lexical EditorState JSON，可空，2026-10-20 修订新增——为记录编辑功能预埋，本期读侧不消费）；down 执行 `ALTER TABLE records DROP COLUMN document;` 后 `ALTER TABLE records ADD COLUMN type TEXT NOT NULL DEFAULT 'text';` 再按 `UPDATE records SET type='image' WHERE EXISTS (SELECT 1 FROM attachments a WHERE a.record_id = records.id);` 与 `UPDATE records SET type='text' WHERE NOT EXISTS (SELECT 1 FROM attachments a WHERE a.record_id = records.id);` 回填；并在 `packages/ai/src/db.ts` 的 `migrations` 数组中 `attachmentMigration` 之后登记 `dropTypeMigration`（`import { migration as dropTypeMigration } from './migrations/0003_drop_type'`）。
  - **前置条件**：无
  - **对应验收标准**：AC-7
  - 先写测试（TDD）：`packages/ai/src/db.test.ts` 断言——跑完 0003 后 `PRAGMA table_info(records)` 无 type 列、有 document 列（可空）、attachments 表结构与数据不受影响；`migration.down()` 后 type 列恢复（回填正确）且 document 列消失。

- [x] 任务 7：改造 `packages/ai/src/dao/captureDao.ts` 的查询与读取路径：`RecordRow` 删 `type` 字段（`records.*` 已无该列）；`toRecord` 返回 `imagePaths: string[]`（由行集合聚合）；`listCaptures` 与 `queryCaptures` 的 items SELECT 保留 `LEFT JOIN attachments`（一记录多行附件），查询结果在 JS 侧按 `record_id` reduce 聚合为 `CaptureRecord[]`；`queryCaptures` 删 `input.type` 条件、改 `hasImages`——true 追加 `AND EXISTS (SELECT 1 FROM attachments a WHERE a.record_id = records.id)`、false 追加 `AND NOT EXISTS (...)`，total 的 COUNT 与 items 共用同一 WHERE 组；`createCapture` 的 INSERT 语句去掉 `type` 列与 `'text'` 值。
  - **前置条件**：`[6]`
  - **对应验收标准**：AC-7
  - 先写测试（TDD）：`captureDao.test.ts` 覆盖——hasImages=true 仅返回含图记录、hasImages=false 仅无图、缺省全部；一记录多附件聚合为有序 imagePaths 数组；total 与 hasImages 条件一致；createCapture 写入后 imagePaths 为 `[]`。
  - 聚合口径：JOIN 行按 `ORDER BY created_at DESC, id DESC`（记录序）+ attachments 行自身 id 升序组装数组。

- [x] 任务 8：在 `packages/ai/src/dao/captureDao.ts` 新增 `createCaptureWithAttachments(input: { text: string; document?: string | null; sourceApp?: string | null; attachments: Array<{ filePath: string; sizeBytes?: number }> }): CaptureRecord`：`database.transaction` 内先 `INSERT INTO records (text, document, source_app, created_at) VALUES (?, ?, ?, strftime(...)) RETURNING *`（document/sourceApp 缺省 null），再对 attachments 按数组顺序循环 `INSERT INTO attachments (record_id, file_path, size_bytes, created_at) VALUES (?, ?, ?, strftime(...))`（sizeBytes 缺省 null），返回 `toRecord`（imagePaths 由 input.attachments 的 filePath 顺序组装）。
  - **前置条件**：`[7]`
  - **对应验收标准**：AC-1
  - 先写测试（TDD）：覆盖——单事务写入一条 record + N 行 attachments 且 imagePaths 顺序正确；模拟第二条 attachment 插入抛错时 records 行一并回滚（库零记录）；text 为 `''` 且 N 图（纯图记录）可写入。

- [x] 任务 9：删除 `packages/ai/src/dao/captureDao.ts` 的 `createImageCapture` 函数与其 JSDoc，并同步 `packages/ai/src/index.ts` 再导出清单（删 `createImageCapture`）；`captureDao.test.ts` 中既有 `createImageCapture` 引用全部改写为 `createCaptureWithAttachments`（等价语义：text `''`、sourceApp `null`），`pnpm --filter @shiguang/ai test` 全绿。
  - **前置条件**：`[8]`
  - **对应验收标准**：AC-1、AC-12
  - 改前用全仓搜索确认 `createImageCapture` 生产调用方仅 `screenshotService.ts`（任务 12 处理）。

### packages/shared

- [x] 任务 10：在 `packages/shared/src/index.ts` 删除 IPC 常量 `screenshotSave` / `screenshotFail` / `screenshotDone` 与类型 `ScreenshotSavePayload` / `ScreenshotFailPayload` / `ScreenshotDonePayload`（含其上方注释块），并删除文件头注释中对已删通道的语义描述（如有）。
  - **前置条件**：无
  - **对应验收标准**：AC-8、AC-12
  - 本任务落地后 desktop 包编译错误属预期（消费方在任务 2/3/5 清理），不中途修。

- [x] 任务 11：在 `packages/shared/src/index.ts` 改造三个契约类型：`CreateCapturePayload` 由 `{ text: string }` 改 `{ text: string; document?: string | null; images: { data: Uint8Array; sizeBytes: number }[] }`（注释改为「图文整包：文字可选 + 图片不限张数，字节 structured clone；document 为 Lexical EditorState JSON，完整版式入库存档、为编辑功能预埋」）；`CaptureRecord` 删 `type` 与 `imagePath` 两字段、增 `imagePaths: string[]`（注释「attachments 相对路径数组，JS 侧按 record_id 聚合；无图记录恒为 []」）；`QueryCapturesPayload` 删 `type?: 'text' | 'image'`、增 `hasImages?: boolean`（注释「true=仅含图，false=仅无图，缺省=全部」）。
  - **前置条件**：`[10]`
  - **对应验收标准**：AC-1、AC-7、AC-12

### apps/desktop 主进程（写盘与入库编排）

- [x] 任务 12：重写 `apps/desktop/src/main/screenshot/screenshotService.ts`：删除 `saveScreenshot`、`sendDone`、`toErrorMessage`、`isPermissionError` 及 `getPetWindow` 导入与 `createImageCapture` 调用；新增 `writeImageFiles(images: Uint8Array[]): Promise<Array<{ filePath: string; sizeBytes: number }>>`——`mkdir(imagesDir, {recursive:true})` 幂等后逐张 `randomUUID()` 命名 `writeFile`，收集 `images/<uuid>.png` 相对路径与 `sizeBytes = data.length`；任一张失败时对全部已写文件逐个 `unlink`（unlink 失败仅吞掉）后抛原始错误；`getImagesDir` / `isSubPath` 原样保留；更新文件头注释（职责收窄为图片写盘服务）。
  - **前置条件**：无
  - **对应验收标准**：AC-6
  - 先写测试（TDD）：`screenshotService.test.ts` 重写——N 张全部成功返回 N 条相对路径；mock 第 k 张 `writeFile` 失败 → 前 k-1 张被 unlink、抛出原错误、返回不存在。

- [x] 任务 13：改造 `apps/desktop/src/main/ipc/captureHandlers.ts` 的 `capture:create` handle：由 `createCapture({ text })` 改为 `const written = await writeImageFiles(payload.images); createCaptureWithAttachments({ text: payload.text, sourceApp: null, attachments: written })`；新增 `import { writeImageFiles } from '../screenshot/screenshotService'` 与 `createCaptureWithAttachments` 导入；`capture:list` / `capture:delete` 原样不动（任务 2 已迁入 copy-image）。
  - **前置条件**：`[8, 11, 12]`
  - **对应验收标准**：AC-1、AC-6
  - 先写测试（TDD）：`captureHandlers.test.ts` 增补（mock `@shiguang/ai` 与 `../screenshot/screenshotService`，照 electron stub 样板）——payload 携 2 图时 writeImageFiles 先调用、返回路径原样进 createCaptureWithAttachments 的 attachments、sourceApp 恒 null；writeImageFiles 抛错时 createCaptureWithAttachments 零调用且 invoke reject。

### apps/desktop 输入框（Lexical 接入；须在截图移除组完成后展开）

- [x] 任务 14：安装 Lexical 并新建图片节点——`apps/desktop/package.json` 增 `lexical` 与 `@lexical/react`（**两包同版本**，MIT）；新建 `apps/desktop/src/renderer/input/features/capture/image-node.ts`：导出 `ImageNode`（`extends DecoratorNode<JSX.Element>`，照 Lexical 官方 playground ImageNode 精简，约 50 行——`static getType() = 'image'`、`static clone`、`createDOM` 返回行内容器、`updateDOM` 返回 `false`、`decorate` 渲染 `<img src={this.__src}>`、`static importJSON` / `exportJSON` 仅读写 `{ src }`）与 `isImageNode` / `$createImageNode({ src })` / `$isImageNode`；`import type { SerializedImageNode } from 'lexical'` 校验 JSON 形状。
  - **前置条件**：无
  - **对应验收标准**：AC-1
  - 验证：`pnpm typecheck` 中 desktop 包通过；节点可被 `LexicalComposer` 的 `nodes` 数组注册（任务 15 消费）。

- [x] 任务 15：重写 `apps/desktop/src/renderer/input/features/capture/capture-form.tsx` 为 Lexical 形态：以 `LexicalComposer` 为根（`initialConfig = { namespace: 'shiguang-capture', nodes: [ParagraphNode, TextNode, ImageNode], onError: (e) => { throw e }, theme: {} }`），`RichTextPlugin` 的 `contentEditable` 替换原 `Textarea`（`autoFocus`、`min-h-[120px]`、`placeholder` 文案「记下此刻…，截图后可直接 Cmd+V 粘贴」经 `placeholder` prop 渲染）；删除 `useForm`/`form.Field`/`form.Subscribe`（TanStack Form 从输入框退役），编辑器实例经 `useLexicalComposerContext` 获取；新增 `imageBytesRef = useRef<Map<string, Uint8Array>>(new Map())`；提交按钮 busy 状态机（idle/submitting/success/error 闪现、`STATUS_RESET_DELAY_MS = 600`）与容器级 Esc 逻辑保留；更新文件头行为契约注释。
  - **前置条件**：`[4, 14]`
  - **对应验收标准**：AC-1、AC-10
  - 先写测试（TDD）：`capture-form.test.tsx` 重写——Lexical 编辑器挂载可输入文字（`fireEvent.input` 或编辑器实例直接 `update`）；placeholder 提示文案存在；无 `useForm` 残留。

- [x] 任务 16：在 `capture-form.tsx` 实现 5000 字硬拦截、字数统计与空内容禁用：`editor.registerUpdateListener(({ editorState, prevEditorState }) => { const len = editorState.read(() => $getRoot().getTextContent().length); if (len > 5000) editor.setEditorState(prevEditorState); })`（卸载时 `editor.unregisterListener`）；字数统计改经 listener 订阅 editorState 渲染「当前字数/5000」；提交按钮 disabled 规则改 `(textContent.length === 0 && imageNodeCount === 0) || busy`，两值均由 listener 写入的本地 state 提供（textContent 不 trim，全空格视为有内容）。
  - **前置条件**：`[15]`
  - **对应验收标准**：AC-4、AC-5
  - 先写测试（TDD）：编辑器直接 `update` 插入 5001 字符 → 回退到 5000 以内且字数统计显示 `5000/5000`；空编辑器按钮禁用；仅空格可提交；含 ImageNode 无文字时按钮可点。

- [x] 任务 17：在 `capture-form.tsx` 实现粘贴分流：`editor.registerCommand(PASTE_COMMAND, (event: CommandEvent) => { ... }, COMMAND_PRIORITY_HIGH)`——`event.clipboardData.files` 含图片文件时：逐张读为 `Uint8Array`，以 `$createImageNode({ src: URL.createObjectURL(new Blob([bytes], { type: 'image/png' })) })` 在当前 selection 处插节点（`$insertNodes`），字节存入 `imageBytesRef`（key = 节点 `getKey()`），混合剪贴板的文字部分交 Lexical 默认粘贴处理；仅含非图片文件时：提示 `setPasteHint('暂不支持')` 并消费命令；卸载时注销命令。
  - **前置条件**：`[16]`
  - **对应验收标准**：AC-2、AC-3
  - 先写测试（TDD）：构造含 PNG File 的 ClipboardEvent dispatch 到 contentEditable → 文档出现 ImageNode 且 `imageBytesRef` 有对应字节、无「暂不支持」提示；纯非图片 File → 提示出现且无节点；混合（text/plain + 图 File）→ 文字进文字流且节点存在。

- [x] 任务 18：在 `capture-form.tsx` 实现提交编排：onSubmit 内 `editor.getEditorState().read(() => { const text = $getRoot().getTextContent(); const imgs = $nodesOfType(ImageNode); const bytes = imgs.map((n) => imageBytesRef.current.get(n.getKey())!) })`（bytes 顺序 = imgs 文档顺序），`document` 取 `JSON.stringify(editor.getEditorState().toJSON())`（2026-10-20 修订：完整版式入 document 列，为编辑功能预埋），调 `window.api.capture.create({ text, document, images: bytes })`；成功后按钮闪现「✓ 已拾光」并经 `editor.update(() => $getRoot().clear())` 清空编辑器 + revoke 全部 objectURL + `imageBytesRef.current.clear()`；失败后按钮闪现「提交失败」，编辑器内容保留供重试；组件卸载 effect revoke 全部 objectURL。
  - **前置条件**：`[17]`
  - **对应验收标准**：AC-1、AC-6、AC-10
  - 先写测试（TDD）：编辑器构造「文字 + 图片节点（字节入 ref）+ 文字」混排 → 提交 invoke payload 的 `text` 段落 \n 分隔正确、`images` 字节顺序与文档序一致；成功后编辑器清空；mock invoke reject → 内容保留、按钮闪现失败态。

### apps/desktop 记录页

- [x] 任务 19：改造 `apps/desktop/src/renderer/console/pages/RecordRow.tsx`：`record.type === 'image'` 分支全部改 `record.imagePaths.length > 0`；缩略图 src 由 `imageSrc(record.imagePath ?? '')` 改 `imageSrc(record.imagePaths[0])`；缩略块右上角叠加多图角标「共N张」（`record.imagePaths.length > 1` 时）；展开大图由「缩略图下方再叠一张」改纵向全列单图（`max-w-[480px] w-full object-contain`）；复制分流由 `record.type === 'image'` 改 `record.imagePaths.length > 0`；更新文件头注释。
  - **前置条件**：`[11]`
  - **对应验收标准**：AC-7、AC-9
  - 先改测试（TDD）：`RecordRow.test.tsx` 数据改 `imagePaths` 形态——含图行渲染缩略图、多图行渲染「共N张」角标、展开态纵向大图存在、复制有图行走 `copyImage`、纯文字行走 `writeText`、`imagePaths: []` 渲染文字预览。

- [x] 任务 20：改造 `apps/desktop/src/renderer/console/pages/RecordsPage.tsx`：筛选表单字段 `type: 'all' | 'text' | 'image'` 语义保留（segmented 文案 全部/文字/图片 不变），payload 映射由 `payload.type = filters.type` 改 `filters.type === 'image' ? payload.hasImages = true : filters.type === 'text' ? payload.hasImages = false : undefined`；单删确认文案判断 `deletingRecord?.type === 'image'` 改 `deletingRecord && deletingRecord.imagePaths.length > 0`；批量文案 `item.type === 'image'` 改 `item.imagePaths.length > 0`；更新文件头注释。
  - **前置条件**：`[11]`
  - **对应验收标准**：AC-7
  - 先改测试（TDD）：`RecordsPage.test.tsx` 断言 payload——切「图片」发 `hasImages: true`、切「文字」发 `hasImages: false`、切「全部」不带 hasImages；含图记录单删/批删确认文案含「图片文件」、纯文字不含。

### 收尾与验证

- [x] 任务 21：全仓残留清理与静态验证——`grep -rn "electron-snapora\|electronSnapora\|exposeScreenshotApi\|screenshot:save\|screenshot:fail\|screenshot:done\|screenshotSave\|screenshotFail\|screenshotDone\|ScreenshotSavePayload\|ScreenshotFailPayload\|ScreenshotDonePayload\|createImageCapture\|registerScreenshotHandlers\|unregisterSnapora\|saveScreenshot\|imagePath\b" apps/desktop/src packages` 确认零残留（`imagePath` 命中仅限 `imagePaths`）；跑 `pnpm typecheck` 三包通过 + `pnpm --filter @shiguang/ai test` + desktop 全部测试全绿。
  - **前置条件**：`[2, 3, 4, 5, 9, 13, 18, 19, 20]`
  - **对应验收标准**：AC-8、AC-12

- [x] 任务 22：手动 AC 走查（真机，已无截图遮罩走查项）——① 系统截图（Shift+Cmd+Ctrl+4）后编辑器内 Cmd+V，图片出现在**光标处**，连续多张顺序正确（AC-2）；② 图文混排：图片插在文字中间提交，记录页该记录首图缩略 + 「共N张」角标正确（AC-1/AC-7）；③ 中文输入法整句输入正常、composition 期间不被 5000 回退误伤、回车不误提交（AC-11）；④ 粘贴超长文本超限 5000 字被回退、字数统计正确（AC-4）；⑤ 混合剪贴板（文字+图）与纯非图片文件提示（AC-3）；⑥ 空内容禁用 / 全空格可提交（AC-5）；⑦ 写盘失败路径（可临时改权限验证）按钮闪现「提交失败」可重试（AC-6）；⑧ busy 防连点（AC-10）；⑨ 有图记录复制首图（AC-9）；⑩ 失焦自动收起行为正常（contentEditable blur 与 textarea 差异走查项，AC-11）；⑪ 首次使用无屏幕录制权限弹窗（AC-8）。
  - **前置条件**：`[21]`
  - **对应验收标准**：AC-1 ~ AC-11
  - 人工走查待办（不由任务勾选覆盖）：AC-11 中文 IME 与 blur 收起两项真机行为；AC-6 磁盘/库双侧核验。
