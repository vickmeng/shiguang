# 输入框 / 表单（手动捕获入库）

## 设计决策

- **输入框编辑器终选 Lexical 真混排**（微信式图文同段混编，图片可插在文字中间）：二轮对齐推翻了「统一卡片（textarea + 图片块）」方案——产品否决「做不到图文混编，不满足」；不选 TipTap（用户对厂商商业模式有顾虑，非技术理由）、不手写 contentEditable（中文 IME composition 风险不值得省 bundle）。TanStack Form 随之从输入框退役：编辑器状态由 editorState 直驱（5000 拦截、空内容判定、提交提取全走 `editorState.read`），提交状态机（idle/submitting/success/error 闪现）保留为组件内 useState；RecordsPage 筛选表单不动，TanStack Form 依赖保留。
- **Lexical 最小化用法**：只注册 TextNode/ParagraphNode + 自写 ImageNode（照官方 playground，DecoratorNode，约 50 行，JSON 仅含 blob URL），零格式化能力——无工具栏无加粗无列表（产品明确「不要复杂排版」）；接受 bundle +~100KB，输入框为独立渲染入口（electron-vite 多入口）不污染主窗/宠物窗 chunk。
- **数据提取 = textContent + 渲染层字节 Map，EditorState JSON 不作事实源**：文字 = `$getRoot().getTextContent()`（段落 \n 分隔）；图片字节存渲染层 `Map<nodeKey, Uint8Array>` ref，提交按文档序 `$nodesOfType(ImageNode)` 收字节。不以其持久化重建内容的理由：blob URL 跨会话失效、JSON 结构随 Lexical 版本演进；`records.document` 列虽存 `toJSON()` 完整版式，但仅为「记录编辑」功能预埋的版式存档，本期读侧不消费、老行 NULL，事实源仍是 text + attachments。
- **5000 字硬拦截走 `registerUpdateListener` 回退上一 EditorState**：Lexical 无 handleTextInput 等价物、contentEditable 无原生 maxlength；不选 keydown/onChange 字符串截断——破坏 IME composition 与撤销栈。空内容判定 = textContent 长度 0 且图片节点数 0（不 trim，全空格视为有内容，M1 口径延续）。
- **粘贴走 `registerCommand(PASTE_COMMAND, handler, COMMAND_PRIORITY_HIGH)` 分流**：剪贴板含图片文件时在光标处插 ImageNode（字节入 ref、src=createObjectURL）、混合文字交 Lexical 默认粘贴进文字流互不覆盖、仅非图片文件时消费命令提示「暂不支持」。截图场景整体改由「系统截图（Shift+Cmd+Ctrl+4）/ 微信截图 + Cmd+V 粘贴」承接，应用内截图功能已随 REQ-CAP-03 废弃整体删除（零屏幕录制权限依赖）。
- **blur 时序教训与铁律（扩展至 contentEditable）**：textarea/contentEditable 的 `onBlur` 抢跑 click——点「拾光」时 mousedown 先触发 blur，若 blur 同步收起窗口则 click 永远落不到按钮，收起信号必须由主进程窗口级原生 blur 承担，renderer 不得主动 `element.blur()`。Lexical blur/focus 行为与 textarea 有差异（contentEditable 内部选区变化不触发元素 blur），真机走查已确认窗口级收起不受影响。
- **图文整包单 invoke 入库：`capture:create` 携 {text, images} 全量字节，主进程先 `writeImageFiles` 全部写盘成功才走 `createCaptureWithAttachments` 单事务**：第 k 张写盘失败删已写文件 + reject，库里零脏记录、用户可重试；不选「边写盘边插 attachments」（脏记录/脏文件）、不选 DAO 内写盘（违反 DAO 不碰磁盘铁律）、不选渲染层写盘（fs 只在主进程）、不选「先逐张落盘通道再 create 关联」（两次往返 + 孤儿治理）。
- **`source_app` 图文记录一律 NULL**（修订原「截图入库恒 'screenshot'」约定）：字段为单值 TEXT，混合来源（系统截图/微信/粘贴）不可表达，语义留档；历史 'screenshot' 行保留不迁移，未来来源若成为一等需求再走结构演进。
- **键盘零自定义拦截**：不监听 keydown 做提交快捷键，Enter 换行、提交走按钮；Esc 收起是窗口级行为，由容器监听发 `input:close`（Lexical 形态延续）。
- **blur 时序铁律扩展到下拉类组件（TagSelect）**：候选项与删除按钮一律 `onMouseDown + e.preventDefault()`（mousedown 抢跑 click，preventDefault 阻止 input 失焦），input `onBlur` 只关下拉、绝不同步调 `input.blur()` 或收窗口；容器级 Esc 会收输入窗口（capture-form），故下拉内 Esc 必须 `stopPropagation` 只关下拉——同一教训在含自写下拉的组件上全部适用。
- **标签栏置顶为独立元数据栏，移出编辑器边框容器**（capture-form.tsx `CaptureFormInner` 返回结构，元数据栏角色）：标签栏是 `rounded-md border + bg-neutral-50` 的独立容器，位于编辑器卡片上方；编辑器卡片随之收缩为「编辑区 + 底部固定操作条」——滚动只发生在输入区，提示与「拾光」提交条固定在边框容器内不随内容滚动。理由：标签是记录的元数据而非正文，置顶后录入流程自上而下（内容 → 标签 → 底部提交）各归其位；布局调整零交互改动，blur 时序铁律、Esc stopPropagation、直删同步语义均由 TagSelect 组件契约承担。

## 技术债务

- [ ] ImageNode 自定义节点维护：Lexical 无官方图片节点（照 playground 自写约 50 行），随版本升级核对官方示例；若升级成本显著，评估社区图片节点插件替换
- [ ] Lexical 版本钉住：`lexical` / `@lexical/react` 须同版本升级（同版本发布），升级整对升 + 跑全量测试；EditorState JSON 不作事实源使存量数据免遭版本演进波及
- [ ] 图片张数与单张体积均不设上限（本地 IPC structured clone），极端量内存峰值治理（张数/体积阈值、IPC 边界大小校验 + 压缩落盘）留待真实反馈
- [ ] 草稿持久化缺失：未提交关窗即永久丢弃（已对齐）；未来若做草稿，方向是仅存文字 + 图片字节整包序列化到本地草稿（editor JSON 仅作可选加速项，不作事实源），与 M9 存储治理一并设计
- [ ] preload `input.blur()` API 已成为预留死代码（组件不再调用，仅主进程窗口级 blur 承担收起）
- [ ] 全空格/换行内容可入库（用户决策，已知可接受项；若查询页出现噪声再评估）
- [x] ~~图片/文件粘贴仍仅提示「暂不支持」~~ 已解决：图片经 PASTE_COMMAND 插节点（字节入 ref）；非图片文件仍提示「暂不支持」（产品口径，非图片类型不承接）
