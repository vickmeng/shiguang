---
slug: tags
derived_from: .rail/changes/tags/design.md
---

# Tasks — tags

> 排程说明：三组可无依赖同发——**数据层组**（任务 1→2→3→4→5，串行）、**契约与主进程组**（任务 6→8→9，6 先行；任务 7 独立于 6 可与 1 同发）、**console 骨架组**（任务 15→16→17）。shared（任务 6）建议最优先落地，task 4/9 消费其新契约。TagSelect 链 10→11→12 同文件串行；capture-form 接入（任务 13）依赖 9+12；记录页链 18→19 依赖 10（组件）与 5（DAO 条件）；任务 14（窗口高度）与任务 20（REQUIREMENTS）随时可发；任务 21 收尾依赖全部实现任务。注意：任务 6 落地后至消费方完成前存在过渡期编译错误，属预期，以任务 21 全绿为准。

## 实现任务

### packages/ai（迁移 + DAO）

- [x] 任务 1：新建 `packages/ai/src/migrations/0004_tags.ts`（沿用 0001~0003 的 `MigrationContext` 结构化类型与 `export const migration` + default 导出形态）：up 依次执行 `CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));` 与 `ALTER TABLE records ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';`；down 依次执行 `DROP TABLE IF EXISTS tags;` 与 `ALTER TABLE records DROP COLUMN tags;`；并在 `packages/ai/src/db.ts` 的 migrations 数组中 `dropTypeMigration` 之后登记（`import { migration as tagsMigration } from './migrations/0004_tags'`）。
  - **前置条件**：无
  - **对应验收标准**：AC-7
  - 先写测试（TDD）：`packages/ai/src/db.test.ts` 断言——跑完 0004 后 `PRAGMA table_info(tags)` 含 id/name/color/created_at 四列、`PRAGMA index_list(tags)` 含 name 的 UNIQUE 索引、`PRAGMA table_info(records)` 含 tags 列（NOT NULL、缺省 `'[]'`）；旧库（0003 态已有记录行）升级后旧行 tags 读出 `'[]'`；`migration.down()` 后 tags 表与 records.tags 列均消失。

- [x] 任务 2：新建 `packages/ai/src/dao/tagDao.ts`：模块级 `let db` + `setTagDatabase(database)`（照 captureDao 注入形态）；`listTags(): Tag[]`（`SELECT * FROM tags ORDER BY id ASC` 映射 snake→camel）；`createTag(input: { name: string }): Tag`——`const name = input.name.trim()`，空或 `name.length > TAG_NAME_MAX_LENGTH`（从 `@shiguang/shared` 导入，=20）抛 `Error('标签名需为 1~20 字')`，先 `SELECT * FROM tags WHERE name = ?` 命中则直接返回已有条目（重名转选中语义），未命中 `INSERT INTO tags (name, color) VALUES (?, ?)`（color 从 `TAG_COLOR_PALETTE` 随机取：`TAG_COLOR_PALETTE[Math.floor(Math.random() * TAG_COLOR_PALETTE.length)]`）后返回新行。
  - **前置条件**：`[1, 6]`
  - **对应验收标准**：AC-2
  - 先写测试（TDD）：新建 `packages/ai/src/dao/tagDao.test.ts`（照 captureDao.test.ts 的 mkdtemp + initDatabase + setXxxDatabase 范式）——新建返回自增 id 与非空 color（断言 color ∈ TAG_COLOR_PALETTE）；重名 create 返回已有条目且库内仍只有一行；`''` / 全空格 / 21 字名称抛「标签名需为 1~20 字」且不产生行；trim 后落库（`' 工作 '` 存 `'工作'`）。

- [x] 任务 3：在 `packages/ai/src/dao/tagDao.ts` 追加 `renameTag(input: { id: number; name: string }): Tag` 与 `deleteTag(input: { id: number }): void`：renameTag 名称规则同 createTag（trim/1~20 字，违规抛 `Error('标签名需为 1~20 字')`），`UPDATE tags SET name = ? WHERE id = ?` 后查无行抛 `Error('标签不存在')`，返回更新后行；deleteTag `DELETE FROM tags WHERE id = ?`（不存在静默跳过），无其他动作——不回溯 records 快照。
  - **前置条件**：`[2]`
  - **对应验收标准**：AC-4
  - 先写测试（TDD）：`tagDao.test.ts` 增补——rename 后 listTags 反映新名且 id/color 不变；rename 不存在 id 抛「标签不存在」；rename 违规名称抛错且原值不变；delete 后 listTags 不含该项、再删同 id 不抛错；delete 不影响 records 表任何行。

- [x] 任务 4：扩展 `packages/ai/src/dao/captureDao.ts` 的 tags 读写：`RecordRow` 增 `tags: string;`；新增 `function parseTags(json: string): string[]`（`try { const v = JSON.parse(json); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [] } catch { return [] }`）；`toRecord` 返回对象增 `tags: parseTags(row.tags)`；`createCapture` 签名增 `tags?: string[]`、INSERT 改 `INSERT INTO records (text, source_app, tags, created_at) VALUES (?, ?, ?, strftime(...)) RETURNING *, NULL AS image_path`（第三参 `JSON.stringify(input.tags ?? [])`）；`createCaptureWithAttachments` 签名增 `tags?: string[]`、事务内 records INSERT 同样加 tags 列与 `JSON.stringify(input.tags ?? [])`，返回记录 `tags` 取 `input.tags ?? []`；`listCaptures` / `queryCaptures` 的 SELECT 经 `records.*` 自动带出 tags 列（JOIN 展开行同记录共享同一 tags 值，首行解析即可）。既有 hasImages/keyword/分页逻辑零改动。
  - **前置条件**：`[1, 6]`
  - **对应验收标准**：AC-1
  - 先写测试（TDD）：`captureDao.test.ts` 增补——createCapture 带 `tags: ['工作','灵感']` 再 listCaptures 读回相等数组；不带 tags 读回 `[]`；createCaptureWithAttachments 带 tags 单事务写入读回正确；listCaptures 既有断言数据补 `tags: []` 字段。

- [x] 任务 5：在 `packages/ai/src/dao/captureDao.ts` 的 `queryCaptures` 新增 tagNames 条件（置于 hasImages 分支之后）：`if (input.tagNames !== undefined && input.tagNames.length > 0) { const quoted = input.tagNames.map((n) => '"' + n + '"'); conditions.push('(' + quoted.map(() => `records.tags LIKE '%' || ? || '%'`).join(' OR ') + ')'); params.push(...quoted); }`。total 的 COUNT 与 items 的 SELECT 共用既有 `${where}`（无需其他改动）。
  - **前置条件**：`[4]`
  - **对应验收标准**：AC-6
  - 先写测试（TDD）：`captureDao.test.ts` 增补——三条记录分别带 `["工作"]` / `["灵感"]` / `["工作","灵感"]`，tagNames `['工作','灵感']` 命中全部三条（OR）；tagNames `['工作']` 仅命中两条；tagNames `['不存在']` 零命中；空数组 / undefined 不生效（全部返回）；tagNames 与 keyword 组合时条件间 AND；total 与 items 同条件（tagNames 下 total 等于 OR 命中总数）；tag「AI」+ 快照 `["AIGC"]` 不误命中（引号参数断言）；total/items 各既有用例数据补 `tags: []`。

### packages/shared

- [x] 任务 6：在 `packages/shared/src/index.ts` 新增：`Tag` 接口（`{ id: number; name: string; color: string }`，注释「color 为创建时从 TAG_COLOR_PALETTE 随机取值的 hex」）；常量 `TAG_NAME_MAX_LENGTH = 20`（注释「trim 后 1~20 字，DAO 单点校验」）；常量 `TAG_COLOR_PALETTE: readonly string[]`（8 色：`'#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'`，注释「预置标签色板，不做自由取色」）；IPC 常量 `tagsList: 'tags:list'`、`tagsCreate: 'tags:create'`、`tagsRename: 'tags:rename'`、`tagsDelete: 'tags:delete'`、`tagsLastGet: 'tags:lastGet'`、`tagsLastSet: 'tags:lastSet'`（各带一行注释）；类型 `CreateTagPayload` / `RenameTagPayload` / `DeleteTagPayload` / `SetLastTagsPayload`（后者 `{ names: string[] }`，注释「记忆本次提交的标签组合，与库条目解耦」）；`CaptureRecord` 增 `tags: string[]`（注释「标签名快照数组，损坏降级 []」）；`CreateCapturePayload` 增 `tags?: string[]`（注释「缺省 = 不打标，入库 '[]'」）；`QueryCapturesPayload` 增 `tagNames?: string[]`（注释「任一命中 OR；缺省/空数组 = 不过滤」）。
  - **前置条件**：无
  - **对应验收标准**：AC-1、AC-12
  - 本任务落地后 captureDao / preload 编译错误属预期（消费方在任务 4/9 接线），不中途修。

### apps/desktop 主进程

- [x] 任务 7：新建 `apps/desktop/src/main/tags/tagMemoryStore.ts`：`const LAST_TAGS_FILE = 'tags-last.json'`；`getLastTags(): string[]`——`try { const raw = readFileSync(path.join(app.getPath('userData'), LAST_TAGS_FILE), 'utf-8'); const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [] } catch { return [] }`（文件缺失/损坏/非数组一律降级 `[]`）；`setLastTags(names: string[]): void`——先 `writeFileSync(path.join(app.getPath('userData'), LAST_TAGS_FILE + '.tmp'), JSON.stringify(names))` 再 `renameSync(..., path.join(app.getPath('userData'), LAST_TAGS_FILE))`（原子替换）。
  - **前置条件**：无
  - **对应验收标准**：AC-3
  - 先写测试（TDD）：新建 `apps/desktop/src/main/tags/tagMemoryStore.test.ts`——照 captureHandlers.test.ts 的 `vi.mock('electron')` 样板（`app.getPath` 返回临时目录，用 `mkdtempSync`）；文件缺失 → `[]`；写入后读回相等数组；写入损坏 JSON / 非数组 JSON（如 `'{"a":1}'`、`'[1,2]'`）→ `[]`；两次 setLastTags 后读回第二次值。

- [x] 任务 8：新建 `apps/desktop/src/main/ipc/tagsHandlers.ts`：`export function registerTagsHandlers(): void`，六个 `ipcMain.handle`——`IPC.tagsList` → `listTags()`；`IPC.tagsCreate` → `createTag(payload)`；`IPC.tagsRename` → `renameTag(payload)`；`IPC.deleteTag` 通道 `IPC.tagsDelete` → `deleteTag(payload)` 后返回 `void`；`IPC.tagsLastGet` → `getLastTags()`；`IPC.tagsLastSet` → `setLastTags(payload.names)` 后返回 `void`；DAO 抛错自然 reject invoke；并在 `apps/desktop/src/main/ipc/registerIpc.ts` 的 registerIpc() 中 import 并调用 `registerTagsHandlers()`（置于 registerCaptureHandlers 之后）。
  - **前置条件**：`[2, 3, 6, 7]`
  - **对应验收标准**：AC-2、AC-3、AC-4
  - 先写测试（TDD）：新建 `apps/desktop/src/main/ipc/tagsHandlers.test.ts`——照 captureHandlers.test.ts 的 vi.mock('electron')（ipcMain.handle 捕获）+ vi.mock('@shiguang/ai', ...) 范式：六通道各断言 handler 存在且调用对应 DAO/store 函数（list→listTags、create→createTag 且 payload 透传、lastSet→setLastTags 且取 `.names`）；create 名称规则抛错时 invoke reject；删除通道 resolve 值为 undefined。

- [x] 任务 9：在 `apps/desktop/src/preload/index.ts` 的 `ShiguangApi` 接口与 `api` 实现中新增 `tags` 分组：接口——`list(): Promise<Tag[]>`、`create(payload: CreateTagPayload): Promise<Tag>`、`rename(payload: RenameTagPayload): Promise<Tag>`、`delete(payload: DeleteTagPayload): Promise<void>`、`lastGet(): Promise<string[]>`、`lastSet(payload: SetLastTagsPayload): Promise<void>`（各带一行 JSDoc）；实现——分别 `ipcRenderer.invoke(IPC.tagsList / tagsCreate / tagsRename / tagsDelete / tagsLastGet / tagsLastSet, ...)`；同步补 `Tag` 等类型与 IPC 的 import。`src/renderer/env.d.ts` 经 `import type { ShiguangApi }` 自动跟随，无需改动。
  - **前置条件**：`[6, 8]`
  - **对应验收标准**：AC-1、AC-12
  - 验证：`pnpm typecheck` 中 desktop 包通过（window.api.tags 全链路类型贯通）。

### apps/desktop 输入框（TagSelect 组件链；capture-form 接入）

- [x] 任务 10：新建 `apps/desktop/src/renderer/components/ui/tag-select.tsx` 的组件骨架（本任务只含 chips 渲染 + 下拉展开/点选）：按 design 3.1 的 `TagSelectProps`（value/onChange/tags/onDeleteTag/allowCreate 缺省 true/onCreateTag?/placeholder 缺省 '标签'/aria-label 缺省 '标签'）；外层容器 `onKeyDown` 容器级 Esc（`e.stopPropagation()` 后关下拉，**本任务仅关下拉**）；chips 行：`value.map(name =>` 色点圆点（颜色 = `tags.find(t => t.name === name)?.color ?? '#d4d4d4'`，库内已删灰显）+ 文本 + `×` 按钮（`aria-label={`移除标签 ${name}`}`，onClick 调 `onChange(value.filter(...))`））；输入框（受控 filterText，`onFocus`/`onClick` 开下拉）；下拉列表（绝对定位面板，条件渲染）：`tags` 全量，每项 = 色点 + 名称 + × 删除按钮——项主体与 × 按钮均 `onMouseDown={e => e.preventDefault()}` 后分别处理选中/删除（blur 时序铁律：本任务项主体 onMouseDown 选中项后 onChange 追加 + 清空 filterText）；input `onBlur` 只 `setOpen(false)`；输入框为空时 Backspace 移除 value 最后一项。
  - **前置条件**：`[9]`
  - **对应验收标准**：AC-1、AC-5
  - 先写测试（TDD）：新建 `tag-select.test.tsx`（jsdom + testing-library，照 RecordRow.test.tsx 范式 mock window.api）——渲染 chips（色点取库色、库外名称灰显）；点击输入框出下拉列全部标签；点选项 mousedown 后该项入 chips 且输入框未失焦（`toHaveFocus`）；点 × 移除 chip；空输入 Backspace 移除最后一个 chip；blur 后下拉关闭但 input.blur 未被调用。

- [x] 任务 11：在 `tag-select.tsx` 实现过滤与 Enter 语义：filterText 非空时下拉项 = `tags.filter(t => t.name.includes(filterText))`；输入框 `onKeyDown`——Enter 分支：候选非空 → 选中**第一项**并清空 filterText（保持下拉开）；候选为空且 `allowCreate === false` → 忽略；候选为空且 allowCreate → 校验 `const name = filterText.trim()`（空或 `name.length > TAG_NAME_MAX_LENGTH` 直接忽略）→ `void onCreateTag!(name).then((tag) => { onChange([...value, tag.name]); 通知父级刷新 tags（约定 onCreateTag 的父级实现负责 setTags，组件内不再处理）；setFilterText('') })`（reject 静默吞掉）；同名的已有标签由父级 `tags:create` 的「重名返回已有」语义自然落入选中路径。
  - **前置条件**：`[10]`
  - **对应验收标准**：AC-2
  - 先写测试（TDD）：输入「工」下拉仅剩含「工」项；Enter 选中第一项且输入清空；无候选文本 Enter → 调 onCreateTag 且 resolve 后入 chips；onCreateTag reject → 不入 chips 不抛错；21 字文本 Enter → 不调 onCreateTag；`allowCreate=false` 无候选 Enter → 不调 onCreateTag。

- [x] 任务 12：在 `tag-select.tsx` 实现下拉删除同步移除选中：下拉项 × 按钮的 `onMouseDown`（已带 preventDefault，任务 10）处理函数内——`void onDeleteTag(tag).catch(() => {})`，且**同步**（不 await）`if (value.includes(tag.name)) onChange(value.filter(n => n !== tag.name))`（先本地移除保证 UI 即时，父级删库刷新 tags 数组）。更新文件头注释（行为契约：状态机 closed/filtering/creating、blur 时序铁律、Esc stopPropagation、直删同步语义）。
  - **前置条件**：`[11]`
  - **对应验收标准**：AC-2、AC-4
  - 先写测试（TDD）：下拉里点某标签 ×（mousedown）→ onDeleteTag 被调且该标签正被选中时 chips 同步少一项；未选中时 chips 不变；onDeleteTag reject 时 chips 已移除（同步语义）且不抛错。

- [x] 任务 13：在 `apps/desktop/src/renderer/input/features/capture/capture-form.tsx` 接入 TagSelect：新增 `const [tagLib, setTagLib] = React.useState<Tag[]>([])` 与 `const [selectedTags, setSelectedTags] = React.useState<string[]>([])`；挂载 effect（空依赖，一次性并行）——`void window.api.tags.list().then(setTagLib)` 与 `void window.api.tags.lastGet().then(setSelectedTags)`；在编辑器边框容器与底部操作条之间挂载 `<TagSelect value={selectedTags} onChange={setSelectedTags} tags={tagLib} onDeleteTag={(tag) => window.api.tags.delete({ id: tag.id }).then(() => setTagLib((cur) => cur.filter((t) => t.id !== tag.id)))} onCreateTag={(name) => window.api.tags.create({ name }).then((tag) => { setTagLib((cur) => [...cur.filter((t) => t.id !== tag.id), tag]); return tag })} aria-label="标签" />`；提交 payload 增 `tags: selectedTags`；成功闪现定时器内（编辑器清空之前/同时）追加 `void window.api.tags.lastSet({ names: selectedTags })`；**成功路径不清空 selectedTags**（chips 保留 = 本次组合的可视呈现）；失败路径标签状态不动。更新文件头行为契约注释（预选回填 / lastSet 记忆 / chips 不清空 / 即席新建不回滚）。
  - **前置条件**：`[9, 12]`
  - **对应验收标准**：AC-1、AC-2、AC-3
  - 先写测试（TDD）：`capture-form.test.tsx` 增补——挂载后 tags.list 与 tags.lastGet 各调用一次且预选 chips 渲染（记忆名称不在库内时灰显 chip 仍在）；提交 invoke payload 含 `tags` 数组与编辑器内容一致；成功后 `tags.lastSet` 以同数组被调且 chips 仍在；mock lastGet reject（降级）→ 组件正常渲染无预选；mock capture.create reject → chips 与 tagLib 保留。

- [x] 任务 14：改 `apps/desktop/src/main/windows/inputWindow.ts`：`INPUT_HEIGHT` 由 `440` 改 `480`（resizable:false 不变）；其上方注释「图文混排形态 840×440」同步改「840×480（含标签 chips 区）」。
  - **前置条件**：无
  - **对应验收标准**：AC-1（走查）
  - 无需自动化测试（窗口常量，走查项）；`pnpm typecheck` 兜底。

### apps/desktop console

- [x] 任务 15：改 `apps/desktop/src/renderer/console/components/SideNav.tsx`：`ConsolePage` 类型由 `'records' | 'settings'` 扩为 `'records' | 'tags' | 'settings'`；`NAV_ITEMS` 在 records 之后插入 `{ key: 'tags', label: '标签' }`；文件头注释更新（三导航项）。
  - **前置条件**：无
  - **对应验收标准**：AC-4
  - 先写测试（TDD）：SideNav 相关既有测试（如无则新建 `SideNav.test.tsx`）断言渲染三个导航项「记录/标签/设置」且 onSelect 回传 'tags'。

- [x] 任务 16：新建 `apps/desktop/src/renderer/console/pages/TagsPage.tsx` 的列表 + 新建能力，并接线 `apps/desktop/src/renderer/console/App.tsx`：TagsPage——挂载 `tags:list` 拉列表（`const [tags, setTags] = useState<Tag[]>([])`，刷新函数 refresh 复用）；列表项渲染色点（`style={{ backgroundColor: tag.color }}`）+ 名称 + 占位操作区（重命名/删除按钮由任务 17 实现，本任务渲染名称与色点即可）；顶部新建行：受控 input（placeholder '新标签名'）+「新建」按钮——`const name = input.trim()`，调 `tags:create` 成功后清空 input 并 refresh（重名返回已有 → refresh 后自然去重展示）；App.tsx——`import TagsPage from './pages/TagsPage'`，main 分支由二元改三元：`page === 'records' ? <RecordsPage /> : page === 'tags' ? <TagsPage /> : <SettingsPage />`。
  - **前置条件**：`[9, 15]`
  - **对应验收标准**：AC-4
  - 先写测试（TDD）：新建 `TagsPage.test.tsx`——挂载调 tags:list 且列表渲染色点+名称；输入名称点新建 → tags:create 以 trim 后名称被调、input 清空、列表刷新含新项；mock tags:list 返回空数组 → 渲染空态文案（如「暂无标签」）。

- [x] 任务 17：在 `apps/desktop/src/renderer/console/pages/TagsPage.tsx` 实现重命名（行内编辑）与删除（dialog 二次确认）：每行操作区补「重命名」「删除」小按钮；重命名——`const [editingId, setEditingId] = useState<number | null>(null)` 与 `editName` 状态，点击后名称处渲染 input（autoFocus，初值当前名），Enter 或失焦提交 `tags:rename({ id, name: editName })`（成功后 refresh），Esc 取消（`onKeyDown` 分支 + `e.stopPropagation()` 不冒泡）；删除——`const [deleting, setDeleting] = useState<Tag | null>(null)`，点「删除」setDeleting，渲染自写 `ConfirmDialog`（照 RecordsPage 用法：`title="确认删除该标签？"`、`description="删除后不可恢复。已入库记录将保留该标签文字，展示为灰色。"`、`confirmVariant="destructive"`），确认 `tags:delete({ id })` 成功后 setDeleting(null) + refresh。
  - **前置条件**：`[16]`
  - **对应验收标准**：AC-4
  - 先写测试（TDD）：`TagsPage.test.tsx` 增补——点重命名出行内 input，Enter 提交 tags:rename 且 refresh；Esc 退出编辑不调 invoke；点删除出 ConfirmDialog（描述含「灰色」），确认后 tags:delete 被调且 dialog 关闭、列表刷新，取消不调 invoke。

- [x] 任务 18：改 `apps/desktop/src/renderer/console/pages/RecordsPage.tsx`：表单 `defaultValues` 增 `tags: [] as string[]`；筛选区（类型筛选之后）挂 `<TagSelect allowCreate={false} value={filters.tags} onChange={(next) => { form.setFieldValue('tags', next); setPage(1); }} tags={tagLib} onDeleteTag={(tag) => void window.api.tags.delete({ id: tag.id }).then(loadTagLib)} aria-label="筛选标签" />`；挂载 effect 增 `tags:list` 拉取与 `tagColorMap`（`useMemo(() => Object.fromEntries(tagLib.map(t => [t.name, t.color])), [tagLib])`，`const [tagLib, setTagLib] = useState<Tag[]>([])`，loadTagLib 函数复用）；payload 组装增 `if (filters.tags.length > 0) payload.tagNames = filters.tags;`；RecordRow 调用处传 `tagColors={tagColorMap}`；空状态筛选判断条件增 `filters.tags.length > 0`（有标签筛选但无结果显示「调整筛选」分支）。
  - **前置条件**：`[5, 10]`
  - **对应验收标准**：AC-6
  - 先写测试（TDD）：`RecordsPage.test.tsx` 增补——挂载调 tags:list；TagSelect 选择两个标签 → 重查 payload 含 `tagNames` 两元素且 page 归 1；清空标签 → payload 不带 tagNames；标签筛选与 keyword 组合时两条件同在 payload。

- [x] 任务 19：改 `apps/desktop/src/renderer/console/pages/RecordRow.tsx`：`RecordRowProps` 增可选 `tagColors?: Record<string, string>`；时间戳 `<p>` 上方渲染 chips 行：`{record.tags.length > 0 && (<div className="mt-1 flex flex-wrap gap-1">{record.tags.map((name) => (<span key={name} className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-0.5 text-xs text-neutral-600"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: tagColors?.[name] ?? '#d4d4d4' }} />{name}</span>))}</div>)}`（已删标签灰点 #d4d4d4）；文件头注释更新（chips 挂载点与配色语义）。
  - **前置条件**：`[6, 18]`
  - **对应验收标准**：AC-5
  - 先写测试（TDD）：`RecordRow.test.tsx` 数据补 `tags` 字段；断言 record.tags 渲染 chips 且色点 style 取 tagColors 命中值；tagColors 缺失该项名（已删标签）→ 色点 #d4d4d4；`tags: []` 不渲染 chips 行；未传 tagColors prop 不抛错（全灰）。

### 文档与收尾

- [x] 任务 20：在 `docs/REQUIREMENTS.md` 状态总览表「REQ-AI-10」行之前插入 5 行——`REQ-TAG-01` 输入框打标（chips 多选 + 即席新建 + 标签名规则 1~20 字）、`REQ-TAG-02` 标签组合记忆（userData JSON、缺失/损坏降级空预选）、`REQ-TAG-03` console 标签维护页（新建/行内重命名/删除二次确认；重命名与删除不回溯记录快照）、`REQ-TAG-04` 记录页标签展示（库内用库色、已删灰色）、`REQ-TAG-05` 按标签筛选记录（多标签任一命中 OR，可与关键词/时间/类型组合）；状态列均「未开始」，粗粒度验收列各填一句可核验描述；并在文末「变更记录」表追加一行（日期 2026-10-21、变更：新增 REQ-TAG-01~05 标签系统，迁移 0004_tags，快照语义）。
  - **前置条件**：无
  - **对应验收标准**：AC-1 ~ AC-6（文档口径）
  - 纯文档任务；变更记录表格式沿用既有行（日期/变更两列）。

- [x] 任务 21：收尾全量验证——`grep -rn "tags-last\|tagNames\|TagSelect" apps/desktop/src packages` 人工核对接线无遗漏（预期命中即本变更文件）；`grep -rn "440" apps/desktop/src/main/windows/inputWindow.ts` 确认窗口高度已 480；跑根 `pnpm typecheck` 三包通过 + `pnpm --filter @shiguang/ai test` 全绿 + `pnpm --filter @shiguang/desktop test` 全绿（现状基线 desktop 125/125、ai 37/37 不回退，新增用例另计）。
  - **前置条件**：`[1, 2, 3, 4, 5, 6, 7, 8, 9, 13, 14, 17, 18, 19, 20]`
  - **对应验收标准**：AC-8
  - 人工走查待办（不由任务勾选覆盖，AC-3/AC-1 走查项）：真机验证输入窗 480px 下 chips 区布局正常；blur 下拉点击不丢焦、Esc 只关下拉不收窗口；提交成功关窗再开预选上次组合。
