# Proposal: M4 图文输入框（m4-graphic-capture）

> 本文档为 2026-10-20 第二轮产品对齐后的**整体重写版**，取代此前「统一卡片 + 截图改道」方案。核心变化：① 输入框选型从「统一卡片（textarea + 图片块）」推翻，改为 **Lexical 真混排**（微信式图文同段混编）；② **截图功能整体删除**（REQ-CAP-03 废弃），改由「系统截图 + Cmd+V 粘贴进输入框」承接；③ 数据层（迁移 0003、图文整包入库、记录页派生）沿用上版已定结论，不变。

## 1. 背景与动机

拾光（ShiGuang）M1 手动输入框目前只支持纯文字：5000 字上限、空内容禁用提交、确认后「✓ 已拾光」轻提示并自动收起。M2 查询页面与 M4 选区截图（m4-region-screenshot）已交付，图片存储管道（records + attachments 一对多、迁移 0002、`shiguang-image://` protocol、记录页图片支持、删除级联）已落地。

2026-10-20 第二轮对齐后，需求条目发生两处根本修订（见 `docs/REQUIREMENTS.md` 变更记录）：

- **REQ-CAP-02 再次扩展**：输入框必须支持**微信式图文同段混编**——图片可以插在文字中间，而非「文字区 + 图片块区」分离。产品明确否决了统一卡片方案：「做不到图文混编，不满足」。选型终定为 **Lexical**（Meta，MIT 免费，轻量）；不选 TipTap（用户对厂商商业模式有顾虑，尽管其 MIT 核心免费）；不手写 contentEditable（中文 IME composition 风险不值得省 bundle）。
- **REQ-CAP-03 废弃**：应用内截图功能整体删除。截图场景由「系统截图（Shift+Cmd+Ctrl+4）/ 微信截图 + Cmd+V 粘贴进输入框」承接。移除 electron-snapora 及其全部装配代码，收益：
  - 拾光**零屏幕录制权限依赖**（用户首次使用不再被系统权限弹窗打断）；
  - 消除 snapora 全部技术债务：单人维护、0 star、包龄短、macOS 签名验证依赖；
  - **M4 核心资产全部保留**：图片存储管道（records + attachments、迁移 0002、`shiguang-image://` protocol、记录页图片支持、删除级联）、写盘逻辑（`getImagesDir` / `writeImageFiles` 挪入 `capture:create` 提交编排）。

沿用上版已定结论（不变）：图文整包一条记录入库（{text, images: Uint8Array[]} 单 invoke `capture:create`，N 张写盘第 k 张失败整体不入库）；`records.type` 列移除（迁移 0003 DROP COLUMN，「图片」筛选 = EXISTS(attachments) 派生）；记录行派生化（首图缩略 + 共N张角标 + 展开纵向全列）；复制有图记录复制首图；`source_app` 图文记录一律 null。

本次变更的本质：输入框升级为 **Lexical 图文混排编辑器**（最小化用法：核心节点 + 自写 ImageNode，零格式化能力），图文整包作为一条记录落库；同时**删除应用内截图功能**，把捕获入口收敛为「系统截图 + 粘贴」；并清理数据模型中的冗余派生列。

## 2. 需求与范围

### 功能描述

1. **输入框 Lexical 真混排**：微信式图文同段混编——图片节点可位于任意段落位置（文字中间、文字之后均可）；无工具栏、无加粗、无列表等任何格式化能力。
2. **内容模型**：文字（可选，5000 字上限与实时字数统计不变）+ 图片不限张数（节点可删）；点击「拾光」按**文档顺序**整包作为**一条记录**入库（一个 record_id 挂多行 attachments）。
3. **粘贴图片**：Lexical 原生接受剪贴板图片（用户实测微信截图可粘）；自定义 PASTE_COMMAND handler——图片文件在光标处插节点、混合文字走 Lexical 默认粘贴、非图片文件提示「暂不支持」（原「暂不支持」图片提示移除）。
4. **截图功能删除**：卸载 electron-snapora；移除主进程 `setupElectronSnapora` / `validateSender` / `unregisterSnapora`（`screenshotHandlers.ts` 整文件删除，`capture:copy-image` handler 挪入 `captureHandlers.ts`）；移除 preload `exposeScreenshotApi` 与 `window.electronSnapora` 全局类型；移除 capture-form 的 📷 按钮；移除宠物窗截图 onDone 订阅。用户教育：输入框提示「截图后 Cmd+V 粘贴」。
5. **数据提取**：文字 = `editorState.read(() => $getRoot().getTextContent())`（段落 \n 分隔）；图片字节存渲染层 `Map<nodeKey, Uint8Array>` ref，EditorState JSON 里只有 blob URL；提交时按文档顺序 `$nodesOfType(ImageNode)` 收集字节。**EditorState JSON 不持久化**（blob URL 不可复用、JSON 随 Lexical 版本演进、重建语义不如 text+attachments 稳定）。
6. **交互细节**：5000 字硬拦截（`registerUpdateListener` 超限回退上一 EditorState——Lexical 无 handleTextInput 等价物）；提交 enabled = textContent 长度 0 且图片节点数 0 时禁用（全空格视为有内容，M1 口径延续）；提交状态机（idle/submitting/success/error 闪现）保留；**TanStack Form 从输入框退役**（RecordsPage 筛选表单不动）；**blur 铁律延续**：contentEditable 不得主动 blur 收起，收起走主进程窗口级 blur。

### 范围边界

**本次做：**

- Lexical 接入（`lexical` + `@lexical/react`）：核心 TextNode/ParagraphNode + 自写 ImageNode（照官方 playground 示例，DecoratorNode/ElementNode 均可，约 50 行）。
- capture-form 重构：LexicalComposer 装配、5000 字回退拦截、空内容禁用、PASTE_COMMAND handler、提交编排（文本提取 + 图片字节收集）、用户教育提示、📷 按钮移除、TanStack Form 退役。
- 截图功能移除：卸载 electron-snapora；`screenshotHandlers.ts` 整文件删除（copy-image 挪入 captureHandlers.ts）；preload / env.d.ts / 宠物窗订阅清理。
- 图文整包入库：`capture:create` 扩展为 {text, images: Uint8Array[]}（structured clone 单 invoke）；主进程先写盘 N 张（`userData/images/<uuid>.png`），第 k 张失败删已写文件 + 报错（库里零脏记录），全部成功才走 DAO `createCaptureWithAttachments` 单事务。
- 数据模型：迁移 0003 移除 `records.type` 列（down 按 EXISTS(attachments) 回填）；`queryCaptures` 类型参数改 `hasImages` 派生；`CaptureRecord` 改 `{id, text, sourceApp, createdAt, imagePaths: string[]}`。
- 记录页适配：RecordRow 渲染分支由附件有无派生（首图缩略 + 共N张角标 + 展开纵向全列）；筛选「全部/文字/图片」走 hasImages 三态；复制有图记录复制首图。

**本次不做（明确排除）：**

- **任何格式化能力**：无工具栏、无加粗/列表/标题（产品明确「不要复杂排版」）。
- **统一卡片方案**：产品已否决（做不到图文混编），不保留任何回退代码。
- **TipTap**：用户对厂商商业模式有顾虑，明确不选（技术本身可行）。
- **手写 contentEditable**：中文 IME composition 风险不值得省 bundle。
- **草稿持久化**：未提交关窗即丢弃；未来若反馈丢失痛点再做。
- **图片理解 / AI 看图**：M6 能力，不做预留（attachments 一对多结构已天然就绪）。
- **非图片文件粘贴**：仍「暂不支持」。
- **单张图片体积上限 / 张数上限**：均不设（本地 IPC structured clone；极端量治理归未来）。
- **EditorState JSON 持久化**：不入库、不落盘（理由见设计文档）。

### 边缘场景处理（已对齐）

| 场景 | 处理方式 |
| --- | --- |
| 提交时 N 张图写盘第 k 张失败 | **全部写盘成功才入库**：失败删已写文件 + 报错，库里零脏记录，用户可重试 |
| 单张图片体积过大 | 不设上限（本地 IPC structured clone 传字节，未来出问题再加） |
| 粘贴/截图后未提交关窗 | 丢弃待提交图文：不落库、不落盘，无孤儿文件（blob URL 随窗销毁） |
| 图片数量很大 | 不限张数；节点自然排列，极端量未来再治理 |
| 混合剪贴板（文字+图片） | 文字走 Lexical 默认粘贴进文字流，图片在光标处插节点，互不覆盖 |
| 超过 5000 字 | registerUpdateListener 超限即回退上一 EditorState（硬拦截，与 M1 maxlength 同口径） |
| 全空格/纯换行提交 | 视为有内容（M1 口径延续），可提交 |
| 提交时连点 | busy 态防连点（沿用状态机） |

### 约束

- **blur 时序铁律**：contentEditable 不得主动 blur 收起（与 textarea 同理，否则按钮 click 落不到）；收起由主进程窗口级 blur 承担。ProseMirror/Lexical 的 blur 行为与 textarea 存在差异，列为真机走查项。
- **Lexical 版本钉住**：`lexical` / `@lexical/react` 版本保持一致（同版本发布），升级需整对升级并跑全量测试。
- IPC 契约收敛：通道常量与 payload 类型进 `packages/shared`；preload 的 `ShiguangApi` 分组收敛；shared 只放契约不放实现；全部 handler 经 `registerIpc()` 单点装配。
- 工程基线沿用：electron-vite 6 多入口、cjs preload（sandbox:false 既定决策）、Tailwind + shadcn 自写 primitives、三层测试策略。
- 数据层边界：单 SQLite 文件 `userData/shiguang.db`；迁移 0003 仅删冗余列；DAO 不碰磁盘，fs 操作在 handler / service。

### 验收标准

1. **图文混排入库**：输入框文字（可空）+ 不限张数图（图可在文字中间），点「拾光」产生**一条** record 挂 N 行 attachments（单事务），图片顺序 = 文档顺序；提交后「✓ 已拾光」闪现并清空编辑器。
2. **系统截图 + 粘贴**：系统截图（Shift+Cmd+Ctrl+4）或微信截图后，在编辑器内 Cmd+V，图片出现在**光标处**；连续粘贴多张顺序正确。
3. **粘贴分流**：混合剪贴板（文字+图）文字进文字流、图片进节点；非图片文件提示「暂不支持」；不再有任何「图片暂不支持」提示。
4. **5000 字硬拦截**：超限输入被回退（EditorState 回滚），字数统计显示 `当前字数/5000`。
5. **空内容禁用**：textContent 长度 0 且图片节点数 0 时提交禁用；全空格视为有内容可提交。
6. **写盘失败整体失败**：mock 第 k 张写盘失败 → 已写文件被清理、库零记录、按钮闪现「提交失败」可重试。
7. **type 移除后派生正确**：迁移 0003 后 records 无 type 列；筛选「图片」= 全部含图记录、「文字」= 无图记录、「全部」两者皆显，可与关键词/时间组合；记录行由 `imagePaths.length > 0` 正确派生（首图缩略 + 共N张角标）。
8. **截图功能零残留**：全仓无 `electron-snapora` / `window.electronSnapora` / `screenshot:save` / `screenshot:fail` / `screenshot:done` 引用；输入框无 📷 按钮；宠物窗无截图订阅；拾光无屏幕录制权限依赖（首次使用无系统权限弹窗）。
9. **复制分流**：有图记录复制首图到剪贴板（`capture:copy-image` 挪入 captureHandlers.ts，取 `imagePaths[0]`）；纯文字记录复制文字，均弹轻提示。
10. **中文输入法正常**：中文 IME composition 期间输入不被 5000 回退误伤、不被回车误提交（真机走查）。
11. **自动化测试全绿**：`pnpm --filter @shiguang/ai test`、desktop 组件/逻辑测试、`pnpm typecheck` 三包通过。

## 3. 未来场景与扩展预判

- **草稿持久化**：本次丢弃未提交图文即永久丢失（已对齐）。若未来反馈「误关窗丢内容」痛点，建议方向：仅存文字 + 图片字节整包序列化到本地草稿存储（Lexical editor JSON 仅作可选加速项，不作为事实源），与 M9 存储治理一并设计。
- **M6 AI 读图**：attachments 一对多结构已就绪，M6 直接复用聚合查询，无需数据层改动。
- **格式化能力（加粗/列表等）**：产品当前明确不要。若未来需要，Lexical 节点体系天然支持（注册对应节点 + 工具栏），数据模型无需演进（textContent 口径不变）。
- **单张图片体积上限**：本次不设。若未来出现内存/传输问题，在 IPC 边界加大小校验 + 压缩落盘，届时再定阈值。
- **新内容类型**（如 M9 导入的外部内容、未来的语音/文件）：不走 type 枚举复活。建议方向：走 attachments 元数据扩展（mime_type 已有）或新结构表，筛选维度按「结构存在性」派生，复用本次 hasImages 派生模式。

## 4. 相关引用

- `docs/REQUIREMENTS.md` —— REQ-CAP-02（2026-10-20 二轮修订：Lexical 真混排）、REQ-CAP-03（2026-10-20 **废弃**：截图功能删除，系统截图+粘贴承接）、REQ-UI-02（「图片」= 含图记录语义，records.type 列随迁移 0003 删除）；变更记录 2026-10-20
- `.rail/changes/m4-region-screenshot/design.md` —— M4 交付现状：**叠加修订关系**——存储/协议/记录页部分（attachments 表、迁移 0002、`shiguang-image://` protocol、删除级联）延续；遮罩采集部分（electron-snapora 装配、screenshot:save/fail/done 三通道、📷 按钮、宠物窗 onDone 订阅）**全部作废**
- `.rail/changes/m4-graphic-capture/` 上一版 design.md / tasks.md（git 历史）——「统一卡片 + 截图改道」方案存档，统一卡片形态被产品否决
- `apps/desktop/src/renderer/input/features/capture/capture-form.tsx` —— TanStack Form 输入框（5000 字 maxlength、blur 时序铁律、📷 按钮与 capture() 调用——本次随截图功能删除移除）；粘贴「暂不支持」（本次改造为图片插节点）
- `apps/desktop/src/main/ipc/screenshotHandlers.ts` —— snapora 装配（setupElectronSnapora/validateSender/unregisterSnapora）+ copy-image handler（**整文件删除**，copy-image 挪入 captureHandlers.ts）
- `apps/desktop/src/main/screenshot/screenshotService.ts` —— `getImagesDir` / `isSubPath` 保留；`saveScreenshot` 直存管线删除；新增 `writeImageFiles`（N 张写盘、失败删已写）
- `apps/desktop/src/preload/index.ts` —— `exposeScreenshotApi` 与 `ShiguangApi.screenshot` 分组（删除）；`apps/desktop/src/renderer/env.d.ts` —— `window.electronSnapora` 全局类型（删除）
- `packages/shared/src/index.ts` —— IPC 契约集中地：`screenshot:save` / `screenshot:fail` / `screenshot:done` 常量与类型（删除）；`capture:create`（扩展为图文整包）；`CaptureRecord`（imagePath 单值改多值聚合）
- `packages/ai/src/dao/captureDao.ts` —— `createImageCapture` 单图直存（删除）；新增 `createCaptureWithAttachments`；`queryCaptures` 类型参数改 hasImages 派生；迁移目录新增 0003（删 type 列）
