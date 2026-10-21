# Design: M4 图文输入框（m4-graphic-capture）

## 1. 概述

M1 输入框目前只支持纯文字（5000 字、空内容禁用提交），M4 选区截图（m4-region-screenshot）落地后图片存储管道已就绪。本次变更把输入框升级为 **Lexical 图文混排编辑器**（微信式图文同段混编），图文整包作为一条记录落库；同时**整体删除应用内截图功能**，截图场景改由「系统截图 + Cmd+V 粘贴」承接；并清理数据模型中的冗余派生列。

**背景**：REQ-CAP-02（2026-10-20 二轮修订：Lexical 真混排，统一卡片方案被产品否决）、REQ-CAP-03（2026-10-20 **废弃**：截图功能删除，系统截图+粘贴承接）、REQ-UI-02（「图片」筛选 = 含图记录，`records.type` 列随迁移 0003 删除）。

**与 M4 变更（m4-region-screenshot）的关系**：**叠加修订，非回滚**——其存储/协议/记录页部分（attachments 表、迁移 0002、`shiguang-image://` protocol、`isSubPath` 校验、删除级联、RecordRow 骨架）全部延续；**作废的只有遮罩采集部分**：electron-snapora 依赖与装配（setupElectronSnapora/validateSender/unregisterSnapora）、`screenshot:save` / `screenshot:fail` / `screenshot:done` 三通道、capture-form 📷 按钮、宠物窗 onDone 订阅。

**范围内：**

- Lexical 接入（`lexical` + `@lexical/react`，MIT 免费）：核心 TextNode/ParagraphNode + 自写 ImageNode（照官方 playground 示例，DecoratorNode，约 50 行，JSON 仅含 blob URL）；**零格式化能力**（无工具栏无加粗无列表）
- 数据提取：文字 = `editorState.read(() => $getRoot().getTextContent())`（段落 \n 分隔）；图片字节存渲染层 `Map<nodeKey, Uint8Array>` ref；提交时 `editorState.read(() => $nodesOfType(ImageNode))` 按文档顺序收字节；**EditorState JSON 不持久化**（理由见决策 3）
- 5000 字硬拦截：`registerUpdateListener` 监听 textContent，超限即 `editor.setEditorState(prevEditorState)` 回退（contentEditable 无原生 maxlength）
- 空内容判定：textContent 长度 0 且图片节点数 0 时禁用提交；全空格视为有内容（M1 口径延续）
- 粘贴：Lexical 原生接受剪贴板图片（用户实测微信截图可粘）+ `registerCommand(PASTE_COMMAND)` 自定义 handler——图片文件在光标处插节点、混合文字走默认、非图片文件提示「暂不支持」
- TanStack Form 从输入框退役（改用 editorState 直接驱动）；提交状态机（idle/submitting/success/error 闪现）保留；RecordsPage 筛选表单不动
- blur 铁律延续：contentEditable 不得主动 blur 收起，收起走主进程窗口级 blur；Lexical blur 与 textarea 差异列真机走查
- 用户教育：输入框 placeholder / hint 提示「截图后 Cmd+V 粘贴」
- 截图功能移除：卸载 electron-snapora；`screenshotHandlers.ts` 整文件删除（`capture:copy-image` 挪入 captureHandlers.ts）；preload `exposeScreenshotApi` 与 `window.electronSnapora` 全局类型删除；📷 按钮删除；宠物窗 onDone 订阅删除
- 图文整包入库：`capture:create` 扩展为 {text, images: Uint8Array[]}（structured clone 单 invoke）；主进程 `writeImageFiles` 先写盘 N 张（`userData/images/<uuid>.png`），第 k 张失败删已写文件并报错（库里零脏记录），全部成功才走 `createCaptureWithAttachments` 单事务
- 数据模型：迁移 0003 `ALTER TABLE records DROP COLUMN type`（down 按 EXISTS(attachments) 回填）；`queryCaptures` / `listCaptures` 类型参数改 `hasImages?: boolean`（EXISTS 派生），JS 侧按 record_id 聚合 `imagePaths: string[]`；`CaptureRecord` 改 `{id, text, sourceApp, createdAt, imagePaths}`
- 记录页适配：RecordRow 删 `type` 分支改 `imagePaths.length > 0` 派生；首图缩略 + 「共N张」角标 + 展开纵向全列；复制分流改有图记录复制首图；RecordsPage 筛选映射 hasImages 三态

**范围外（不做）：**

- 任何格式化能力（无工具栏、无加粗/列表/标题）
- 统一卡片方案（产品已否决，不回退、不留代码）
- TipTap（用户对厂商商业模式有顾虑）与手写 contentEditable（中文 IME composition 风险）
- 草稿持久化（未提交丢弃即永久丢失）
- 图片理解 / AI 看图（M6 能力，attachments 一对多结构已天然就绪）
- 非图片文件粘贴（仍「暂不支持」）
- 单张图片体积上限 / 图片张数上限（均不设，极端量治理归未来）
- EditorState JSON 持久化（不入库不落盘）
- 存储膨胀 / 孤儿文件治理（M9 统一设计，记技术债务）

**边缘场景（已对齐）：**

| 场景 | 处理方式 |
| --- | --- |
| 提交时 N 张写盘第 k 张失败 | 全部写盘成功才入库：删已写文件 + 报错，库里零脏记录，用户可重试 |
| 单张图片体积过大 | 不设上限（内存内传递，未来出问题再加） |
| 粘贴后未提交关窗 | 丢弃：不落库、不落盘、无孤儿文件（blob URL 随窗销毁） |
| 图片数量很大 | 不限张数；节点自然排列，极端量未来再治理 |
| 混合剪贴板（文字+图片） | 文字走默认粘贴进文字流，图片在光标处插节点，互不覆盖 |
| 超过 5000 字 | registerUpdateListener 超限即回退上一 EditorState |
| 全空格/纯换行 | 视为有内容（M1 口径），可提交 |
| 提交时连点 | busy 态防连点（沿用状态机） |
| 历史 `type='image'` 记录（迁移 0003 后） | 无数据搬迁：attachments 行仍在，EXISTS 派生与渲染分支天然正确 |

## 2. 验收标准

测试策略：三层测试——① DAO/迁移（临时目录真实 SQLite，迁移 0003 前后结构、`createCaptureWithAttachments` 事务性与部分附件失败回滚、hasImages 筛选、imagePaths 聚合）；② shared 契约（三包 `pnpm typecheck` 作为类型验收）；③ renderer 组件测试（capture-form Lexical：粘贴图片插节点/混合剪贴板/删节点/图文混排提交/空文字有图可提交/5000 回退/文件仍提示；RecordRow/RecordsPage 派生语义）+ 主进程 handler/service 测试（writeImageFiles 写盘失败路径、capture:create 编排、copy-image 首图）。真机走查补验中文 IME、blur 收起、系统截图粘贴。

- AC-1：图文混排入库——文字（可空）+ 不限张数图（图可在文字中间），点「拾光」产生**一条** record 挂 N 行 attachments（单事务），attachments 顺序 = 编辑器文档顺序；提交后按钮闪现「✓ 已拾光」并清空编辑器。
- AC-2：系统截图（Shift+Cmd+Ctrl+4）或微信截图后，编辑器内 Cmd+V，图片出现在**光标处**；连续粘贴多张顺序正确。
- AC-3：粘贴分流——混合剪贴板文字进文字流、图片插节点；非图片文件提示「暂不支持」；不再有任何「图片暂不支持」提示。
- AC-4：5000 字硬拦截——超限输入被回退（EditorState 回滚，内容不超限），字数统计显示 `当前字数/5000`。
- AC-5：空内容禁用——textContent 长度 0 且图片节点数 0 时提交禁用；全空格视为有内容可提交。
- AC-6：写盘失败整体失败——mock 第 k 张写盘失败 → 已写文件被清理、库零记录、按钮闪现「提交失败」内容与节点保留可重试。
- AC-7：迁移 0003 后 records 无 type 列；筛选「图片」= 全部含图记录、「文字」= 无图记录、「全部」两者皆显，可与关键词/时间区间组合；记录行由 `imagePaths.length > 0` 正确派生（首图缩略图与「共N张」角标）。
- AC-8：截图功能零残留——全仓无 `electron-snapora` / `window.electronSnapora` / `screenshot:save|fail|done` 引用；输入框无 📷 按钮；宠物窗无截图订阅；拾光无屏幕录制权限依赖。
- AC-9：复制分流——有图记录复制首图（`capture:copy-image` 挪入 captureHandlers.ts，取 `imagePaths[0]`）；纯文字记录复制文字（`navigator.clipboard.writeText`），均弹「已复制到剪贴板」轻提示。
- AC-10：busy 防连点——提交进行中按钮 busy，重复点击不产生重复记录。
- AC-11：中文输入法正常——IME composition 期间输入不被 5000 回退误伤、不被回车误提交（真机走查）。
- AC-12：自动化测试全绿——`pnpm --filter @shiguang/ai test`、desktop 组件/逻辑测试、`pnpm typecheck` 三包通过。

## 3. 实现方案

### 3.1 接口与函数签名

**packages/shared/src/index.ts（只放契约不放实现）**

```ts
export const IPC = {
  // ...既有通道不变；以下三个常量与其类型删除：
  //   screenshotSave / screenshotFail / screenshotDone
  //   ScreenshotSavePayload / ScreenshotFailPayload / ScreenshotDonePayload
  captureCreate: 'capture:create',        // invoke：图文整包提交
  captureCopyImage: 'capture:copy-image', // invoke：复制有图记录的首图
} as const;

export interface CaptureRecord {
  id: number;
  text: string;
  sourceApp: string | null;
  createdAt: string;
  /** attachments 相对路径数组（相对 userData 根），JS 侧按 record_id 聚合；无图记录恒为 [] */
  imagePaths: string[];
}

/** 创建捕获记录的载荷（图文整包：文字可选 + 图片不限张数，字节 structured clone） */
export interface CreateCapturePayload {
  text: string;
  images: Uint8Array[];
}

export interface QueryCapturesPayload {
  keyword?: string;
  since?: string;
  until?: string;
  /** 含图筛选：true=仅含图记录，false=仅无图记录，缺省=全部（EXISTS attachments 派生） */
  hasImages?: boolean;
  page: number;
  pageSize: number;
}
```

**IPC 契约表（变更后全量相关通道）**

| 通道 | 方向 | Payload | 说明 |
| --- | --- | --- | --- |
| `capture:create` | renderer → main（invoke） | `CreateCapturePayload` | 图文整包：主进程先写盘 N 张 → `createCaptureWithAttachments` 单事务；写盘失败删已写并 reject |
| `capture:list` | renderer → main（invoke） | `QueryCapturesPayload` | `type` 参数被 `hasImages` 取代（三态），其余不变 |
| `capture:delete` | renderer → main（invoke） | `DeleteCapturesPayload` | 不变（级联返路径 + 尽力清理磁盘） |
| `capture:copy-image` | renderer → main（invoke） | `CopyImagePayload` | 挪入 captureHandlers.ts：有图记录复制**首图**（`imagePaths[0]`），无图记录/文件缺失仍抛错 |
| ~~`screenshot:save`~~ | — | — | **删除**（snapora 管线随截图功能移除） |
| ~~`screenshot:fail`~~ | — | — | **删除** |
| ~~`screenshot:done`~~ | — | — | **删除**（宠物窗订阅同步移除） |

**packages/ai/src/dao/captureDao.ts（数据层，DAO 不碰磁盘铁律不变）**

```ts
export function createCapture(
  input: { text: string; sourceApp?: string | null },
): CaptureRecord;
// INSERT 去掉 type 列（迁移 0003 后列已不存在），sourceApp 缺省 null。

export function createCaptureWithAttachments(input: {
  text: string;
  sourceApp?: string | null;               // 图文记录一律 null（见决策 11）
  attachments: Array<{ filePath: string; sizeBytes?: number }>;
}): CaptureRecord;
// 单事务：INSERT records 一行 + INSERT attachments N 行（record_id 关联，
// file_path 相对 userData 根）；任一步失败整体回滚。createImageCapture 被本函数取代并删除。

export function queryCaptures(input: QueryCapturesPayload): QueryCapturesResult;
// hasImages=true → AND EXISTS (SELECT 1 FROM attachments a WHERE a.record_id = records.id)；
// hasImages=false → AND NOT EXISTS (...)；items 的 SELECT records LEFT JOIN attachments
// 保留（一记录多行附件），JS 侧 reduce 按 record_id 聚合 imagePaths: string[]；
// total 的 COUNT 同步 EXISTS 条件（同 WHERE 组）。

export function listCaptures(limit?: number): CaptureRecord[];
// 同 queryCaptures 的 JOIN + 聚合改造；与 queryCaptures 冗余不收敛（既有技术债务）。

export function deleteCaptures(ids: number[]): string[];
// 不变：单事务先查附件路径 → 删 attachments → 删 records，返回相对路径列表。
```

**apps/desktop 主进程**

```ts
// main/screenshot/screenshotService.ts（重写；文件保留，职责收窄为写盘服务）
export function getImagesDir(): string;                          // userData/images（不变）
export function isSubPath(root: string, p: string): boolean;     // protocol 校验（不变）
export async function writeImageFiles(
  images: Uint8Array[],
): Promise<Array<{ filePath: string; sizeBytes: number }>>;
// N 张写盘管线：mkdir 幂等 → 逐张 randomUUID 命名 writeFile（images/<uuid>.png）；
// 任一张失败 → 删全部已写文件（unlink 失败仅吞掉）→ 抛错；全部成功才 resolve。
// saveScreenshot / sendDone 单图直存管线随截图功能删除一并删除。

// main/ipc/captureHandlers.ts（吸纳 copy-image）
export function registerCaptureHandlers(): void;
// capture:create → writeImageFiles(payload.images) → createCaptureWithAttachments({
//   text, sourceApp: null, attachments: 写盘结果 });写盘失败时 writeImageFiles 已自清，
// handler 不再触碰 DAO，抛错 reject invoke（渲染侧按钮闪现「提交失败」）。
// capture:copy-image（由 screenshotHandlers.ts 挪入）：查记录后改判
// rec.imagePaths.length === 0 抛 Error('该记录不是图片')，读 imagePaths[0] 落盘文件
// 写剪贴板（W3C 异步 clipboard.write 不变）。
// capture:list / capture:delete 不变。

// main/ipc/screenshotHandlers.ts —— 整文件删除（snapora 装配与 save/fail handler 全移除）

// main/ipc/registerIpc.ts：删 registerScreenshotHandlers 装配，仅保留 registerCaptureHandlers。
// main/index.ts：删 unregisterSnapora 导入与 before-quit 调用；registerImageProtocol 保留。
// windows/petWindow.ts —— 不变。
```

**apps/desktop preload / env**

```ts
// src/preload/index.ts
export interface ShiguangApi {
  capture: {
    create(payload: CreateCapturePayload): Promise<CaptureRecord>;
    list(payload: QueryCapturesPayload): Promise<QueryCapturesResult>;
    delete(payload: DeleteCapturesPayload): Promise<void>;
    copyImage(payload: CopyImagePayload): Promise<void>;
  };
  console / input / pet —— 不变；
  // screenshot 分组整体删除；
  // exposeScreenshotApi({ contextBridge, ipcRenderer }) 调用与其 import 删除
}

// src/renderer/env.d.ts
// 删 ScreenshotRendererApi 导入与 Window.electronSnapora 声明
```

**apps/desktop renderer 输入框（Lexical）**

```ts
// input/features/capture/image-node.ts（新建，~50 行，照 Lexical playground ImageNode）
export class ImageNode extends DecoratorNode<JSX.Element> {
  static getType(): 'image';
  static clone(node: ImageNode): ImageNode;
  createDOM(): HTMLElement;                       // 行内容器
  updateDOM(): false;                             // 静态节点不更新
  decorate(): JSX.Element;                        // <img src={blobUrl}> 渲染
  static importJSON(json: SerializedImageNode): ImageNode;   // 仅存 { src: blobUrl }
  exportJSON(): SerializedImageNode;
  // 注意：JSON 里只有 blob URL（会话内有效），字节在渲染层 Map<nodeKey, Uint8Array>
}
// isImageNode / $createImageNode / $isImageNode 导出

// capture-form.tsx（重写要点）
const imageBytesRef = React.useRef<Map<string, Uint8Array>>(new Map());
// LexicalComposer initialConfig = { nodes: [ParagraphNode, TextNode, ImageNode],
//   onError, theme: {} }；RichTextPlugin contentEditable；
// editor.registerUpdateListener(({ editorState, prevEditorState }) => {
//   const len = editorState.read(() => $getRoot().getTextContent().length);
//   if (len > MAX_LENGTH) editor.setEditorState(prevEditorState);   // 5000 硬回退
// });
// editor.registerCommand(PASTE_COMMAND, handler, COMMAND_PRIORITY_HIGH);
// 提交：editorState.read(() => {
//   const text = $getRoot().getTextContent();
//   const imgs = $nodesOfType(ImageNode);   // 文档顺序
//   bytes = imgs.map((n) => imageBytesRef.current.get(n.getKey()));
// });
```

### 3.2 关键数据结构

**Lexical EditorState JSON（双写：完整版式入 document 列，拍平值做读模型）**

```json
{
  "root": {
    "children": [
      { "type": "paragraph", "children": [
        { "type": "text", "text": "前半段文字" },
        { "type": "image", "src": "blob:http://localhost/xxx", "version": 1 },
        { "type": "text", "text": "后半段文字" }
      ]}
    ]
  }
}
```

写入时双提取（提交链路）：
- **`editorState.toJSON()` → `records.document` 列**（完整版式，2026-10-20 修订新增——为「记录编辑」功能预埋，见决策 16）；老数据行该列为 NULL
- `getTextContent()`（段落 \n 分隔）→ `records.text`：搜索/筛选/列表预览的读模型
- 按文档顺序的 ImageNode 字节（渲染层 ref）→ 写盘 + attachments：图集读模型

读侧本期不变：记录页仍按 text + imagePaths 平铺渲染，`document` 列无人读；未来编辑功能用 `editor.parseEditorState(document)` 无损还原（blob URL 已失效，ImageNode 反序列化时需从 attachments 重新 createObjectURL，届时处理）。ImageNode 的 `src` 是 `URL.createObjectURL(new Blob([bytes]))` 生成的 blob URL，删除节点 / 提交成功 / 组件卸载时 revoke。

**records 表（迁移 0003 后字段表）**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PK AUTOINCREMENT | 不变 |
| text | TEXT NOT NULL | 语义修订：纯图记录可为 `''`；图文记录为文字内容 |
| document | TEXT（可空） | **新增（2026-10-20 修订）**：Lexical EditorState JSON，完整图文版式；M1/M4 老行 NULL；本期读侧不消费，为记录编辑功能预埋 |
| source_app | TEXT | 图文记录一律 NULL（见决策 11）；历史 `'screenshot'` 行保留不迁移 |
| created_at | TEXT NOT NULL DEFAULT (UTC ISO) | 不变 |
| ~~type~~ | — | **迁移 0003 删除**（DROP COLUMN）；筛选/渲染改 EXISTS(attachments) 派生 |

**attachments 表（不变，迁移 0002 既有）**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PK AUTOINCREMENT | |
| record_id | INTEGER NOT NULL REFERENCES records(id) | 外键；一记录挂 N 行 |
| file_path | TEXT NOT NULL | 相对 userData 根（`images/<uuid>.png`） |
| mime_type | TEXT NOT NULL DEFAULT 'image/png' | |
| size_bytes | INTEGER | 可空 |
| created_at | TEXT NOT NULL DEFAULT (UTC ISO) | |

**迁移 0003（`packages/ai/src/migrations/0003_drop_type.ts`）**

- up：`ALTER TABLE records DROP COLUMN type;`（better-sqlite3@12 捆绑 SQLite ≥3.35 支持 DROP COLUMN；0002 文件不动，0003 叠加）
- down：加回 `type TEXT NOT NULL DEFAULT 'text'` 列，并按 `EXISTS(attachments)` 回填 `'image'` / `'text'`（兼容 0002 down 的重建语义）
- db.ts migrations 数组登记 0003

**路径口径**：不变——DB 只存相对路径；磁盘操作全在主进程以 `path.join(app.getPath('userData'), relPath)` 还原；protocol 服务前经 `isSubPath` 校验。

### 3.3 关键骨架（必须按此实现）

1. 顺序铁律：`writeImageFiles` 全部 N 张写盘成功 → 才调 `createCaptureWithAttachments`；任一张失败 → 删全部已写文件 → reject，DAO 零调用、库里零记录。
2. `createCaptureWithAttachments` 单事务内完成 records 行 + N 行 attachments；任一步失败整体回滚。
3. 提交字节顺序 = 编辑器文档顺序：`editorState.read(() => $nodesOfType(ImageNode))` 的返回顺序即文档序，禁止按 Map 插入序等其他顺序组装 `images`。
4. 5000 字拦截只能在 `registerUpdateListener` 内回退 `prevEditorState`；禁止在 onChange/keydown 里截断字符串（破坏 IME composition 与历史栈）。
5. ImageNode JSON 只存 blob URL；字节唯一事实源是渲染层 `Map<nodeKey, Uint8Array>` ref，EditorState JSON 不入库不落盘。
6. 空内容判定：`$getRoot().getTextContent().length === 0 && $nodesOfType(ImageNode).length === 0` → 禁用提交；不做 trim。
7. contentEditable 不得调 `element.blur()`（blur 铁律）；输入框失焦收起仍由主进程窗口级 blur 承担。
8. 截图功能移除后全仓禁止残留 `electron-snapora` / `window.electronSnapora` / `screenshot:save` / `screenshot:fail` / `screenshot:done` 字符串引用。

### 3.4 数据流 / 状态变更

```
【图文混排提交流程（renderer → main → 磁盘 → DAO）】
Lexical 编辑器（文字段落 + 任意位置 0..N 个 ImageNode）
  → 点「拾光」（enabled = textContent>0 或有图节点，busy 防连点）
  → editorState.read：
      text = $getRoot().getTextContent()（段落 \n 分隔）
      images = $nodesOfType(ImageNode).map(n => imageBytesRef.get(n.getKey()))  // 文档序
  → window.api.capture.create({ text, images })（structured clone 传字节，无 base64）
  → 主进程 captureHandlers：
      writeImageFiles(images)：mkdir(userData/images) 幂等
        → 逐张 randomUUID 命名 writeFile（第 k 张失败 → 删已写 k-1 张 → throw）
      → createCaptureWithAttachments({ text, sourceApp: null, attachments: N 条相对路径 })
        （单事务：INSERT records + N × INSERT attachments）
  → resolve → 按钮闪现「✓ 已拾光」→ $getRoot().clear() 清空编辑器 + revoke 全部 objectURL → 自动收起
  → reject（写盘失败）→ 已写文件已自清 → 按钮闪现「提交失败」，编辑器内容保留供重试

【粘贴流程】
编辑器 PASTE_COMMAND handler（COMMAND_PRIORITY_HIGH）：
  clipboardData.files 含图片 → 光标处插入对应 ImageNode（字节入 imageBytesRef，src=createObjectURL）
    + 混合文字走 Lexical 默认粘贴进文字流（互不覆盖）
  仅非图片文件 → 消费命令 + pasteHint「暂不支持」
  系统截图（Shift+Cmd+Ctrl+4 / 微信截图）→ Cmd+V 即触发本流程（Lexical 原生接受剪贴板图片，
    用户教育提示常驻 placeholder/hint：「截图后 Cmd+V 粘贴」）

【5000 字拦截】
registerUpdateListener：textContent.length > 5000 → editor.setEditorState(prevEditorState)
  → 字数统计订阅 editorState 渲染「当前字数/5000」

【记录页读图 / 删除 / 复制】
<img src="shiguang-image://<basename>"> → protocol + isSubPath → 404 走「图片丢失」占位（不变）
删除：confirm → capture:delete → DAO 级联返路径 → handler 尽力 fs.rm（不变）
复制：imagePaths.length > 0 → capture.copyImage({ id }）（handler 取首图写剪贴板）；
      纯文字 → navigator.clipboard.writeText（不变）
筛选：segmented 全部/文字/图片 → payload.hasImages = undefined / false / true → DAO EXISTS 派生
```

### 3.5 技术决策

1. **[重写] 输入框编辑器选型：Lexical 真混排（终选）**。决策链：统一卡片（textarea + 图片块，上版方案）→ **产品否决**（「做不到图文混编，不满足」）；TipTap → 技术可行且同为 MIT，但**用户对厂商商业模式有顾虑，明确不选**（非技术理由，记录备查）；手写 contentEditable → 中文 IME composition 风险不值得省 bundle；Lexical（Meta，MIT 免费，轻量，微信式图文同段混编）→ 终选。
2. **[重写] Lexical 最小化用法：核心 TextNode/ParagraphNode + 自写 ImageNode（照官方 playground，DecoratorNode，约 50 行），零格式化能力**。不装任何格式化扩展——无工具栏无加粗无列表（产品明确「不要复杂排版」）；bundle 增量约 +100KB 已接受（决策 14）。
3. **[重写] 数据提取 = textContent + 渲染层字节 Map；EditorState JSON 不持久化**。提取口径：文字 = `editorState.read(() => $getRoot().getTextContent())`；图片字节存 `Map<nodeKey, Uint8Array>` ref，JSON 里只有 blob URL（会话内有效）；提交按文档序 `$nodesOfType(ImageNode)` 收字节。不持久化 editor JSON 的理由：① blob URL 跨会话不可复用，JSON 里的 src 无意义；② JSON 结构随 Lexical 版本演进，落库即背版本兼容包袱；③ 事实源 text + attachments 已完整覆盖需求（混排顺序由 attachments 行序保留）。
4. **[重写] 5000 字硬拦截走 `registerUpdateListener` 回退上一 EditorState**。Lexical 无 handleTextInput 等价物、contentEditable 无原生 maxlength；不选 keydown 截断——破坏 IME composition 与撤销栈。回退时机须在 listener 内同步完成，IME composition 期间不拦截（composition 中文本未 commit，走查确认，AC-11）。
5. **[沿用] 空内容判定：textContent 长度 0 且图片节点数 0 时禁用提交；全空格视为有内容**。M1 口径延续（不 trim）；判定走 editorState.read，不额外派生状态。
6. **[重写] 粘贴走 `registerCommand(PASTE_COMMAND, handler, COMMAND_PRIORITY_HIGH)`**。图片文件在光标处插 ImageNode；混合文字走 Lexical 默认粘贴（handler 不消费文字部分）；仅非图片文件时消费命令 + 提示「暂不支持」。Lexical 原生接受剪贴板图片（用户实测微信截图可粘），自定义 handler 只补「文件分类 + 字节入 ref」职责。
7. **[重写] 截图功能整体删除（本次最大范围变更）**。REQ-CAP-03 废弃：截图场景由「系统截图 Shift+Cmd+Ctrl+4 / 微信截图 + Cmd+V 粘贴进输入框」承接。移除：electron-snapora 依赖、`setupElectronSnapora` / `validateSender` / `unregisterSnapora`（`screenshotHandlers.ts` 整文件删除，copy-image 挪入 captureHandlers.ts）、preload `exposeScreenshotApi` 与 `window.electronSnapora` 全局类型、capture-form 📷 按钮、宠物窗 onDone 订阅。保留：M4 图片存储管道全部（records+attachments、迁移 0002、protocol、记录页、删除级联）、`getImagesDir` / 写盘逻辑（挪入 `capture:create` 提交编排）。收益：零屏幕录制权限依赖；消除 snapora 全部技术债务（单人维护/0 star/包龄短/macOS 签名验证）。
8. **[沿用] `capture:create` 单 invoke 携全量字节，主进程内完成「写盘 → 入库」两阶段**。不选「先逐张落盘通道、再 create 关联」——两次往返、需要临时文件契约与孤儿治理；不选「渲染层写盘」——违反 fs 只在主进程的数据层边界。structured clone 单往返，失败清理在主进程一处闭环。
9. **[沿用] N 张先全写盘、全部成功才单事务入库；第 k 张失败删已写**。`writeImageFiles`（fs）与 `createCaptureWithAttachments`（DAO）职责分离、顺序耦合；不选「边写盘边插 attachments」（脏记录/脏文件）；不选「DAO 内写盘」（违反 DAO 不碰磁盘铁律）。
10. **[沿用] `records.type` 列删除走迁移 0003 `DROP COLUMN`，筛选与渲染改 `EXISTS(attachments)` 派生**。不选保留双写（图文混合记录无法用单值 type 表达，正是删列导火索）；不选改 has_images 布尔列（仍是冗余列）。better-sqlite3@12 捆绑 SQLite ≥3.35 原生支持 DROP COLUMN，down 回填保持可回滚。
11. **[沿用] 图文记录 `source_app` 一律 NULL**。字段为单值 TEXT，混合来源（系统截图/微信/粘贴）不可表达；语义留档，历史 `'screenshot'` 行保留不迁移，未来若来源成为一等需求再走结构演进。
12. **[沿用] `CaptureRecord.imagePaths: string[]`，JS 侧按 record_id reduce 聚合**。不选 SQL `GROUP_CONCAT` 再 split（类型不安全、路径含分隔符即出错）；不选每记录只返首图（复制取首图与共N张角标仍需完整数组）。LEFT JOIN 保留 + JS 聚合（每页 ≤100 条，reduce 开销可忽略）。
13. **[沿用+扩展] blur 铁律延续到 contentEditable**：contentEditable 不得主动 blur（否则按钮 click 被 blur 收起打断，与 textarea 同理）；收起仍由主进程窗口级 blur 承担。新增：ProseMirror/Lexical 的 blur/focus 行为与 textarea 存在差异（contentEditable 内部选区变化不触发元素 blur 等），列为真机走查项。
14. **[新增] 接受 Lexical bundle +~100KB 与版本快速迭代的维护成本**。不选更轻的 textarea 方案——产品已否决（做不到混编）；不选 Slate/ProseMirror 直写——维护成本更高。Lexical 版本迭代快 → 钉住 `lexical` 与 `@lexical/react` 同版本，升级整对升级并跑全量测试。
15. **[重写] TanStack Form 从输入框退役**：编辑器状态由 Lexical editorState 直接驱动（5000 拦截、空内容判定、提交提取全走 editorState.read），不再需要表单 state 桥接；提交状态机（idle/submitting/success/error 闪现）保留为组件内 useState。RecordsPage 筛选表单**不动**，TanStack Form 依赖保留。
16. **[新增·2026-10-20 修订] document 列双写（文档存原文 + 拍平值做读模型）**：`records.document`（TEXT 可空）存 `editorState.toJSON()` 完整版式，与 text/attachments 双写同事务；本期读侧不消费，为「记录编辑」功能预埋（`editor.parseEditorState(document)` 无损还原）。不选只存拍平值（版式丢失，编辑功能只能有损重建——产品关注后修订）；不选本期就做只读渲染（范围膨胀，编辑功能落地时配套）。老行 NULL，ImageNode 反序列化时 blob URL 已失效需从 attachments 重建 objectURL（编辑功能落地时处理）。

### 3.6 风险 / 取舍

- [风险] **ImageNode 自定义维护**（照 playground 自写约 50 行，Lexical 无官方图片节点）→ 缓解：节点逻辑极简（静态 decorate，updateDOM 返 false）， playground 示例稳定多版本未变；升级时随官方示例核对。
- [风险] **editor JSON 不保序/不持久化**，图片顺序只在提交瞬间由 `$nodesOfType` 文档序保证 → 接受：落库后顺序固化在 attachments 行序，记录页展示与复制均从此读，无二次排序需求。
- [风险] **Lexical 版本迭代快**，API 可能 breaking → 缓解：两包同版本钉住、升级整对升级、全量测试兜底；不持久化 editor JSON（决策 3）使版本演进不波及存量数据。
- [取舍] **bundle +~100KB**（lexical + @lexical/react）→ 接受：输入框为独立渲染入口（electron-vite 多入口），不污染主窗/宠物窗 chunk；产品明确要求真混排。
- [风险] **中文 IME composition** 与 5000 回退/粘贴 handler 的交互 → 缓解：拦截只在 update listener 内回退 EditorState（不截断输入流），composition 期间 textContent 不 commit 不触发；真机走查（AC-11）。
- [风险] **真机 blur 差异**：Lexical contentEditable 的 blur/focus 行为与 textarea 不同，可能影响「失焦自动收起」的触发时机 → 缓解：窗口级 blur 由主进程承担、与编辑器内部焦点解耦，理论上不受影响；列走查项确认。
- [风险] 图片不限张数 + 不限单张体积，极端场景内存峰值高 → 接受：本地单进程 structured clone，输入框场景极端量概率低；治理阈值留待真实反馈。
- [风险] 迁移 0003 `DROP COLUMN` 依赖捆绑 SQLite ≥3.35 → 已解：better-sqlite3@12.11.1 捆绑满足；DAO 迁移测试覆盖 0003 前后结构断言兜底。
- [风险] `capture:create` 大 payload（N 张字节单 invoke）阻塞主进程写盘期间 UI 无反馈 → 接受：busy 态已有「拾光中…」；写盘为本地 IO，量级可控。
- [取舍] 未提交关窗即永久丢失（无草稿）→ 接受：proposal 已对齐，未来若反馈丢失痛点再做草稿持久化（候选方案见技术债务）。

### 3.7 技术债务

- **ImageNode 自定义节点维护**：随 Lexical 升级核对 playground 示例；若未来升级成本显著，评估社区图片节点插件替换。
- **Lexical 版本跟随**：`lexical` / `@lexical/react` 须同版本升级，升级需跑全量测试；不持久化 editor JSON 使数据层免遭版本演进波及（决策 3 的连带收益）。
- 图片极端量治理（张数/单张体积阈值、IPC 边界大小校验 + 压缩落盘）——未来出现内存/传输问题时再加。
- 草稿持久化（未提交图文丢失）——未来若反馈痛点，候选：仅存文字 + 图片字节整包序列化到本地草稿（editor JSON 仅作可选加速项，不作事实源），与 M9 存储治理一并设计。
- `source_app` 字段语义留档：图文记录一律 NULL，历史 `'screenshot'` 行保留；未来来源若成为一等需求需结构演进。
- `listCaptures` / `queryCaptures` 冗余延续 → 接受：既有技术债务，本次不收敛。
- 存储膨胀 / 孤儿文件整体治理归 M9（删除清理失败重试/启动扫描等）。
- 复制仅首图而非全图 → 接受：主诉求覆盖，多图复制留待真实需求。

### 3.8 影响文件清单

**依赖**
- `apps/desktop/package.json`：删 `electron-snapora`；增 `lexical` 与 `@lexical/react`（同版本）；lockfile 随 install 更新

**packages/shared/**
- `src/index.ts`：删 `screenshotSave` / `screenshotFail` / `screenshotDone` 常量与 `ScreenshotSavePayload` / `ScreenshotFailPayload` / `ScreenshotDonePayload` 类型；`CreateCapturePayload` 改 `{ text: string; images: Uint8Array[] }`；`CaptureRecord` 删 `type`/`imagePath`、增 `imagePaths: string[]`；`QueryCapturesPayload.type` 改 `hasImages?: boolean`

**packages/ai/**
- `src/migrations/0003_drop_type.ts`（新建）：up = `ALTER TABLE records DROP COLUMN type`；down = 加回 type 列并按 EXISTS(attachments) 回填
- `src/db.ts`：migrations 数组登记 0003
- `src/dao/captureDao.ts`：新增 `createCaptureWithAttachments`；删除 `createImageCapture`；`createCapture` INSERT 去 type 列；`queryCaptures` / `listCaptures` 改 hasImages EXISTS 条件 + LEFT JOIN 多行 + JS 聚合 imagePaths
- `src/index.ts`：导出同步
- `src/dao/captureDao.test.ts` / `src/db.test.ts`：迁移 0003 前后结构、事务性含部分附件失败回滚、hasImages 筛选、imagePaths 聚合

**apps/desktop 主进程**
- `src/main/screenshot/screenshotService.ts`（重写）：删 `saveScreenshot` / `sendDone`；新增 `writeImageFiles`（N 张写盘、失败删已写）；`getImagesDir` / `isSubPath` 保留
- `src/main/ipc/captureHandlers.ts`：`capture:create` 改「writeImageFiles → createCaptureWithAttachments」编排；`capture:copy-image` 由 screenshotHandlers.ts 挪入（改取 `imagePaths[0]`）；list/delete 不变
- `src/main/ipc/screenshotHandlers.ts`：**整文件删除**
- `src/main/ipc/registerIpc.ts`：删 `registerScreenshotHandlers` 装配
- `src/main/index.ts`：删 `unregisterSnapora` 导入与 before-quit 调用；`registerImageProtocol` 保留

**apps/desktop preload / env**
- `src/preload/index.ts`：`screenshot` 分组整体删除；`exposeScreenshotApi` import 与调用删除；相关类型导入清理
- `src/renderer/env.d.ts`：删 `ScreenshotRendererApi` 导入与 `Window.electronSnapora` 声明

**apps/desktop renderer**
- `src/renderer/input/features/capture/image-node.ts`（新建）：ImageNode（DecoratorNode，~50 行，JSON 仅 blob URL）+ `$createImageNode` / `$isImageNode` / `isImageNode`
- `src/renderer/input/features/capture/capture-form.tsx`（重写）：LexicalComposer 装配（nodes/theme/onError）；RichTextPlugin；registerUpdateListener 5000 回退 + 字数统计；PASTE_COMMAND handler；提交编排（textContent + $nodesOfType 文档序收字节）；imageBytesRef 与 objectURL 生命周期管理；📷 按钮删除；TanStack Form 退役；placeholder/hint 用户教育「截图后 Cmd+V 粘贴」
- `src/renderer/pet/main.ts`：删 `screenshot.onDone` 订阅；toast 基础设施保留
- `src/renderer/console/pages/RecordRow.tsx`：`record.type` 分支改 `record.imagePaths.length > 0`；首图缩略图 + 「共N张」角标；展开大图改纵向全列；复制分流改 imagePaths
- `src/renderer/console/pages/RecordsPage.tsx`：筛选表单 `type` 改 `hasImages` 三态映射（segmented 文案不变）；删除确认文案判断改 imagePaths
- 测试：`capture-form.test.tsx`（Lexical：粘贴插节点、混合剪贴板、删节点、图文混排提交、空文字有图可提交、5000 回退、文件仍提示）、`RecordRow.test.tsx` / `RecordsPage.test.tsx`（派生语义）、`screenshotService.test.ts` 重写（writeImageFiles 失败路径）、`captureHandlers.test.ts`（capture:create 编排、copy-image 首图）

## 4. 回滚条件

- Lexical 图文混排在真机出现不可修复的交互缺陷（IME composition 与 5000 回退冲突、blur 收起时序不可接受等）→ revert 输入框渲染层至上一版纯文字 textarea 基线（M1 形态）；数据层（迁移 0003、DAO、shared 契约）独立成立——`capture:create` 图文 payload 对纯文字提交向后兼容（images 传空数组即可）。
- 迁移 0003 在用户环境出现 DROP COLUMN 兼容问题（理论低风险，better-sqlite3@12 捆绑保证）→ 执行 0003 down（加回列并回填）回滚数据层，业务代码回滚至 type 枚举版本。
- 发现历史数据在 EXISTS 派生下语义偏差（如存在 attachments 行但 type='text' 的历史脏数据）→ 先数据矫正再评估回滚；若矫正不可行则回滚迁移 0003。
