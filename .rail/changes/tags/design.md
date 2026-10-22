# Design: 标签系统（tags）

## 1. 概述

拾光一条记录目前只有纯文本（+ 可选图片），没有任何维度化组织手段。本次变更为记录引入轻量标签维度：**输入框 chips 打标 + 即席新建 + 标签组合记忆 + console 标签维护页 + 记录页 chips 展示与 OR 筛选**。数据模型采用文本快照语义：`tags` 表（name UNIQUE、预置色板随机取色）+ `records` 新增 `tags` JSON 快照列，**不做关联表**；数据层仅需一个迁移（0004_tags）。标签同时为 M5 AI 分析流水线备好结构化维度（本期不做任何预留代码）。

**范围内：**

- 迁移 0004_tags：`tags` 表 + `records.tags TEXT NOT NULL DEFAULT '[]'`；up/down 均为同步 DDL exec，登记进 db.ts migrations 数组
- `tagDao`（新建即收敛四接口：list / create / rename / delete；create 内置重名检查——重名返回已有条目而非报错，供「重名自动转选中」语义；标签名规则 trim / 非空 / ≤20 字在 DAO 单点校验）
- captureDao 扩展：RecordRow / toRecord / toRecords 带 tags（JSON.parse，损坏降级 `[]`）；createCapture / createCaptureWithAttachments 写入 tags 快照；queryCaptures 新增 `tagNames?: string[]` 条件（任一命中 OR，参数化 LIKE，total 与 items 共用条件组）
- shared 契约：`Tag` 类型、`CaptureRecord.tags: string[]`、`CreateCapturePayload.tags?: string[]`、`QueryCapturesPayload.tagNames?: string[]`、tags 域 6 个 IPC 常量、色板与命名长度常量
- 主进程：`tagMemoryStore.ts`（getLastTags/setLastTags，userData JSON 读写，缺失/损坏降级空数组）、`tagsHandlers.ts`（经 registerIpc() 注册 6 通道）
- preload：ShiguangApi 新增 tags 分组（list/create/rename/delete/lastGet/lastSet），env.d.ts 自动跟随
- 自写 `TagSelect` 单组件（`components/ui/tag-select.tsx`），交互对标 antd `Select mode="tags"`：chips 多选、输入即过滤、Enter 选中唯一候选/即席新建（重名自动转选中）、Backspace 移除末 chip、下拉每项直删（删选中项同步移除）、blur 时序铁律、Esc stopPropagation；两个复用场景：capture-form（预选回填 + 提交后不清空 chips + lastSet 记忆）与 RecordsPage 筛选（受控即查，`allowCreate=false`）
- console：SideNav 三处同步加「标签」页；新 `TagsPage`（列表 + 新建 + 行内重命名 + 删除 dialog 二次确认）；RecordsPage 筛选表单加第四条件 TagSelect（OR）；RecordRow 展示 chips（库内用库色、已删灰色）
- 输入窗口高度 440 → 480（resizable 保持 false），chips 区挂编辑器与底部操作条之间
- docs/REQUIREMENTS.md 新增 REQ-TAG-01~05 + 变更记录

**范围外（不做）：**

- 标签颜色自定义（颜色仅创建时随机，不提供修改）
- 标签使用统计 / 频次排序（chips 按库序，记入技术债务）
- AND 语义筛选（仅 OR）
- 重命名 / 删除回溯记录（快照语义下记录保留旧文本，明确不回溯）
- 关联表 / 多对多中间表（文本快照已覆盖展示与筛选）
- 标签的 AI 分析消费（M5 的事情，不做预留代码）
- captureDao 既有债务（缺 getById、listCaptures 与 queryCaptures 并存）——零重构，纯增量

**边缘场景（已对齐）：**

| 场景 | 处理方式 |
| --- | --- |
| 即席新建与库中标签重名 | 不重复建条目，DAO 重名返回已有，自动转为选中已有标签（name UNIQUE 兜底） |
| 重命名标签 | 不回溯：已入库记录保留旧文本快照 |
| 删除被记录引用的标签 | 仅删标签库条目；记录文本保留，RecordRow 灰色 chip |
| 标签组合记忆 JSON 缺失/损坏 | 降级为空预选，不阻塞输入框 |
| 标签名规则 | trim 后非空、长度上限 20 字（DAO 抛错拒建/拒改名，渲染层输入侧同步拦截） |
| 提交时标签区为空 | 记录 tags 快照为 `'[]'`，与从不打标记录一致 |
| 即席新建后提交失败 | 标签库条目保留（标签本身有效，不随提交回滚） |
| 下拉删除正被选中的标签 | 删库同时从当前选中集合移除 chip；已入库记录文本快照不受影响 |
| 老记录（迁移前）读 tags 列 | `DEFAULT '[]'` 自动回填，读出 `'[]'` 不报错 |
| records.tags 快照 JSON 损坏 | 读取侧 `JSON.parse` 包裹 try/catch，降级 `[]`，不炸列表 |

## 2. 验收标准

测试策略：三层测试——① DAO/迁移（临时目录真实 SQLite：0004 前后结构、tagDao 四接口含重名返回已有、标签名规则拒建、captureDao tags 读写、tagNames OR 筛选、total/items 条件一致、tags JSON 损坏降级）；② shared 契约（三包 `pnpm typecheck`）；③ renderer 组件测试（TagSelect 状态机全分支、capture-form 预选/提交/记忆、TagsPage CRUD、RecordsPage 筛选映射、RecordRow chips 配色）+ 主进程测试（tagMemoryStore 降级路径、tagsHandlers 六通道编排，照 captureHandlers.test.ts 的 `vi.mock('electron')` 样板）。真机走查补验 blur 时序与窗口高度。

- AC-1：打标入库——输入框选择/即席新建多个标签后提交，记录 tags 快照为对应标签名 JSON 数组；一条记录可挂多标签；重开记录页 chips 正确展示。
- AC-2：即席新建与重名兜底——输入无匹配文本回车 → 新标签入库（预置色板随机色）并被选中；输入与库中重名回车 → 不新建，自动选中已有标签（UNIQUE 不报错）。
- AC-3：标签组合记忆——提交成功后关窗再开，输入框预选上次提交的标签组合；删除/写坏 userData 记忆 JSON → 打开为空预选，输入框可用。
- AC-4：标签维护页 CRUD——console「标签」页可新建（trim、非空、≤20 字校验）、行内重命名、删除（dialog 二次确认）；重命名/删除后已入库记录的标签文本不变。
- AC-5：记录页展示——记录行按快照渲染标签 chips，库中存在用库色，已删标签灰显。
- AC-6：按标签筛选——筛选表单标签多选，多标签任一命中即出（OR）；可与关键词/时间范围/类型组合（条件间 AND）；不选标签时条件不生效。
- AC-7：迁移正确——迁移 0004 后存在 tags 表（name UNIQUE）与 records.tags 列（默认 `'[]'`）；旧记录读出 `'[]'` 不报错；down 迁移可回滚。
- AC-8：自动化测试全绿——`pnpm --filter @shiguang/ai test`、`pnpm --filter @shiguang/desktop test`、根 `pnpm typecheck` 三包通过（现状基线不回退）。

## 3. 实现方案

### 3.1 接口与函数签名

**packages/shared/src/index.ts（只放契约不放实现）**

```ts
/** 标签库条目（color 为创建时从 TAG_COLOR_PALETTE 随机取值的 hex，如 '#f59e0b'） */
export interface Tag {
  id: number;
  name: string;
  color: string;
}

/** 标签名规则：trim 后 1~20 字（DAO 单点校验，渲染层输入侧同步拦截） */
export const TAG_NAME_MAX_LENGTH = 20;

/** 预置标签色板（创建时随机取一；不做自由取色，避免脏色） */
export const TAG_COLOR_PALETTE: readonly string[] = [
  '#f59e0b', '#ef4444', '#10b981', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
];

export const IPC = {
  // ...既有通道不变，新增 tags 独立域：
  tagsList: 'tags:list',        // invoke：列全部标签（库序 = id ASC）
  tagsCreate: 'tags:create',    // invoke：新建（重名返回已有；名称规则抛错）
  tagsRename: 'tags:rename',    // invoke：重命名（名称规则抛错；不回溯记录）
  tagsDelete: 'tags:delete',    // invoke：删除（不回溯记录）
  tagsLastGet: 'tags:lastGet',  // invoke：读上次提交的标签名数组（缺失/损坏 → []）
  tagsLastSet: 'tags:lastSet',  // invoke：记忆本次提交的标签名数组
} as const;

export interface CaptureRecord {
  // ...既有字段不变，新增：
  /** 标签名快照数组（records.tags JSON 文本列解析结果；损坏降级 []） */
  tags: string[];
}

export interface CreateCapturePayload {
  // ...既有字段不变，新增：
  /** 标签名快照（缺省 = 不打标，入库 '[]'） */
  tags?: string[];
}

export interface QueryCapturesPayload {
  // ...既有字段不变，新增：
  /** 标签筛选：任一命中（OR）；缺省/空数组 = 不过滤 */
  tagNames?: string[];
}

export interface CreateTagPayload { name: string }
export interface RenameTagPayload { id: number; name: string }
export interface DeleteTagPayload { id: number }
/** 记忆本次提交的标签组合（仅标签名字符串数组，与库条目解耦） */
export interface SetLastTagsPayload { names: string[] }
```

**packages/ai/src/dao/tagDao.ts（新建；DAO 不碰磁盘铁律不变，连接经 setTagDatabase 注入）**

```ts
export function setTagDatabase(database: Database.Database): void;

/** 列全部标签（ORDER BY id ASC = 库序，chips/下拉按此展示） */
export function listTags(): Tag[];

/**
 * 新建标签：名称经 trim；空或 >TAG_NAME_MAX_LENGTH 抛 Error('标签名需为 1~20 字')；
 * color 从 TAG_COLOR_PALETTE 随机取（Math.random 模块级可测注入或直接取）；
 * 重名（UNIQUE 冲突）不报错，返回已有条目——供「重名自动转选中」语义。
 */
export function createTag(input: { name: string }): Tag;

/** 重命名：名称规则同 createTag；id 不存在抛 Error('标签不存在')；不回溯记录快照 */
export function renameTag(input: { id: number; name: string }): Tag;

/** 删除：id 不存在静默跳过；仅删库条目，不回溯记录快照 */
export function deleteTag(input: { id: number }): void;
```

**packages/ai/src/dao/captureDao.ts（扩展，既有行为零改动）**

```ts
interface RecordRow {
  // ...既有字段不变，新增：
  /** records.tags JSON 文本列 */
  tags: string;
}

function toRecord(row: RecordRow): CaptureRecord;
// tags: try { JSON.parse(row.tags) } catch { [] }（快照损坏降级，列表不炸）

function toRecords(rows: RecordRow[]): CaptureRecord[];
// 聚合语义不变；tags 在每记录首行解析（JOIN 展开行同记录共享同一 tags 值）

export function createCapture(
  input: { text: string; sourceApp?: string | null; tags?: string[] },
): CaptureRecord;
// INSERT 增加 tags 列，值 JSON.stringify(input.tags ?? [])

export function createCaptureWithAttachments(input: {
  text: string;
  document?: string | null;
  sourceApp?: string | null;
  attachments: Array<{ filePath: string; sizeBytes?: number }>;
  tags?: string[];
}): CaptureRecord;
// 单事务内 tags 快照同 records 行一起写入；imagePaths 组装逻辑不变

export function queryCaptures(input: QueryCapturesPayload): QueryCapturesResult;
// 新增 tagNames 条件（非空时）：
//   const quoted = input.tagNames.map((n) => `"${n}"`);
//   conditions.push(`(${quoted.map(() => `records.tags LIKE '%' || ? || '%'`).join(' OR ')})`);
//   params.push(...quoted);
// total 的 COUNT 与 items 共用同一 where（同现有 keyword/hasImages 风格）；
// LIKE 参数带 JSON 引号（"name"）——避免 tag「AI」误命中快照里的「AIGC」子串
```

**apps/desktop 主进程**

```ts
// main/tags/tagMemoryStore.ts（新建）
const LAST_TAGS_FILE = 'tags-last.json';   // userData 根下

/** 同步读上次提交的标签名数组；文件缺失 / JSON 损坏 / 非数组 → []（降级不阻塞） */
export function getLastTags(): string[];

/** 同步原子写（writeFileSync 临时文件 + renameSync），names 恒为字符串数组 */
export function setLastTags(names: string[]): void;
// 路径口径：path.join(app.getPath('userData'), LAST_TAGS_FILE)（照 screenshotService 惯例）

// main/ipc/tagsHandlers.ts（新建）
export function registerTagsHandlers(): void;
// tags:list → listTags()
// tags:create → createTag(payload)（重名返回已有；名称规则抛错 reject）
// tags:rename → renameTag(payload)
// tags:delete → deleteTag(payload)
// tags:lastGet → getLastTags()
// tags:lastSet → setLastTags(payload.names)

// main/ipc/registerIpc.ts：新增 registerTagsHandlers() 装配
// main/index.ts：启动时补 setTagDatabase(initDatabase(dbPath) 的既有连接)（与 setCaptureDatabase 同点注入）
```

**apps/desktop preload（env.d.ts 经 `import type { ShiguangApi }` 自动跟随）**

```ts
export interface ShiguangApi {
  // ...既有分组不变，新增：
  tags: {
    list(): Promise<Tag[]>;
    create(payload: CreateTagPayload): Promise<Tag>;
    rename(payload: RenameTagPayload): Promise<Tag>;
    delete(payload: DeleteTagPayload): Promise<void>;
    lastGet(): Promise<string[]>;
    lastSet(payload: SetLastTagsPayload): Promise<void>;
  };
}
```

**apps/desktop renderer**

```ts
// components/ui/tag-select.tsx（新建，自写单组件，不引 antd/radix）
export interface TagSelectProps {
  /** 已选标签名（有序、去重，由父级持有） */
  value: string[];
  onChange(next: string[]): void;
  /** 标签库（色点 + 下拉源）；onDeleteTag 后由父级刷新本数组 */
  tags: Tag[];
  /** 下拉每项删除按钮回调（父级调 tags:delete 并刷新；若正被选中由本组件同步从 value 移除） */
  onDeleteTag(tag: Tag): void | Promise<void>;
  /** 即席新建开关：true 时 Enter 无候选走 onCreateTag；false（筛选场景）只可选已有 */
  allowCreate?: boolean;          // 缺省 true
  onCreateTag?(name: string): Promise<Tag>;  // allowCreate=true 时必填（父级调 tags:create）
  placeholder?: string;           // 缺省 '标签'
  'aria-label'?: string;          // 缺省 '标签'
}

// capture-form.tsx：挂载 <TagSelect> 于编辑器边框容器与底部操作条之间；
// 状态：const [selectedTags, setSelectedTags] = useState<string[]>([]);
//       const [tagLib, setTagLib] = useState<Tag[]>([]);
// 挂载 effect（一次性并行）：tags.list() → setTagLib；tags.lastGet() → setSelectedTags（记忆名称中已
//   不在库内的照常入 chips，灰显）；
// 提交 payload 增加 tags: selectedTags；成功回调内（闪现定时器中）调 tags.lastSet({ names: selectedTags })，
//   编辑器清空但 selectedTags 保留（下次开窗预选的就是本次组合，chips 不随编辑器清空）；
// 失败路径不动标签状态（标签库即席新建条目保留，不随提交回滚）。

// console/pages/TagsPage.tsx（新建）
// 列表（色点 + 名称 + 重命名/删除按钮）+ 顶部新建输入行；
// 重命名 = 行内编辑（点击名称进入 input，Enter/失焦提交 tags:rename，Esc 取消）；
// 删除 = ConfirmDialog 二次确认（文案注明不回溯记录上的标签文本）。

// console/pages/RecordsPage.tsx：筛选区第四条件 <TagSelect allowCreate={false} value={filters.tags}
//   onChange={... 写表单 + setPage(1)} />；payload.tagNames = filters.tags（非空时）；
//   挂载时 tags.list() 拉一次标签库 → tagColorMap: Record<string,string>（useMemo）下发 RecordRow；
//   RecordsPage.test.tsx / RecordRow.test.tsx 同步扩。

// console/pages/RecordRow.tsx：新增可选 prop tagColors?: Record<string, string>；
//   时间戳上方渲染 chips 行：record.tags.map(name => <span>色点 + name</span>)，
//   色点颜色 = tagColors?.[name] ?? '#d4d4d4'（已删标签灰色），record.tags 为空不渲染该行。

// main/windows/inputWindow.ts：INPUT_HEIGHT 440 → 480（resizable:false 不变，注释同步更新）。
```

### 3.2 关键数据结构

**tags 表（迁移 0004 新建）**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY AUTOINCREMENT | 自增主键（库序 = id ASC，chips/下拉展示序） |
| name | TEXT NOT NULL UNIQUE | 标签名（trim 后存储；重名 UNIQUE 兜底，DAO 先查后插转「返回已有」） |
| color | TEXT NOT NULL | 创建时从 TAG_COLOR_PALETTE 随机取值的 hex |
| created_at | TEXT NOT NULL DEFAULT (UTC ISO) | 与 records 同口径 |

**records 表（迁移 0004 加列后）**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id / text / document / source_app / created_at | — | 不变 |
| tags | TEXT NOT NULL DEFAULT '[]' | **新增**：标签名 JSON 文本数组**快照**（提交时固化，重命名/删除不回溯）；读取侧 try/catch 降级 `[]` |

**records.tags 快照示例**：`'["工作","灵感"]'`。筛选匹配参数为带 JSON 引号的 `'"工作"'`，LIKE 包含匹配。

**迁移 0004（`packages/ai/src/migrations/0004_tags.ts`）**

- up：`CREATE TABLE tags (...)` + `ALTER TABLE records ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';`（旧行自动回填 `'[]'`）
- down：`DROP TABLE IF EXISTS tags;` + `ALTER TABLE records DROP COLUMN tags;`（better-sqlite3@12 捆绑 SQLite ≥3.35 支持 DROP COLUMN，0003 已有先例）
- db.ts migrations 数组登记 0004（init → 0002 → 0003 → 0004 顺次）

### 3.3 关键骨架（必须按此实现）

1. tagDao 仅暴露 listTags / createTag / renameTag / deleteTag 四个导出，不新增任何查询接口（规避 captureDao getById/listCaptures 并存债务）。
2. createTag 重名语义：**先 SELECT 后 INSERT**，重名返回已有条目，绝不把 UNIQUE 冲突抛给渲染层；名称规则（trim、1~20 字）校验先于重名检查。
3. queryCaptures 的 tagNames 条件参数必带 JSON 引号（`"name"`），并包一层括号 `(... OR ...)` 再 AND 进条件组；total 与 items 共用同一 where 字符串。
4. TagSelect 候选项的点击与删除按钮一律 `onMouseDown + e.preventDefault()`（blur 时序铁律）；input `onBlur` 只关下拉，**禁止**同步调 `window.api.input.blur()` 或收起输入窗口。
5. TagSelect 容器 onKeyDown 的 Esc 分支必须 `e.stopPropagation()`（capture-form 容器级 Esc 会收输入窗口），只关下拉。
6. 即席新建链路：Enter（无匹配候选）→ trim/非空/≤20 校验 → `onCreateTag` → resolve 后把返回 Tag 入 chips **并刷新父级 tags 数组**；reject（名称规则）静默丢弃（输入框场景不打断流）。
7. capture-form 提交成功后：编辑器清空 + objectURL 清理照旧，但 selectedTags **不清空**，并在闪现定时器内调 tags:lastSet；失败路径 tags 状态一律不动。
8. 读取侧（toRecord/toRecords）JSON.parse 必须 try/catch 降级 `[]`——快照列是文本，没有数据库级完整性保证。

### 3.4 数据流 / 状态变更

```
【TagSelect 状态机（closed / filtering / creating）】
closed：下拉关闭，chips 行 + 输入框。
  ├─ 输入框 click/focus → 拉开的下拉列表 = 标签库全量（filterText='' 不过滤）→ filtering
  └─ 输入即改 filterText → 下拉 = 库中 name 包含 filterText 的项（仍 filtering）
filtering 内 Enter：
  ├─ 有过滤候选 → 选中第一项（或高亮项），清空输入，保持 filtering
  ├─ 无候选且 allowCreate=false（筛选场景）→ 忽略
  └─ 无候选且 allowCreate=true → creating：trim/非空/≤20 → onCreateTag(name)
creating 内 onCreateTag resolve：
  ├─ 返回的是已有条目（重名转选中语义）→ 直接入 chips，不重复建
  └─ 新条目 → 入 chips + 父级刷新标签库数组 → 回到 filtering（输入清空）
Backspace（输入为空）→ 移除 value 最后一项。
Esc → 关下拉 + stopPropagation（不冒泡到 capture-form 容器级 Esc）。
input onBlur → 仅关下拉（不碰 input.blur() 窗口收起链路）。
下拉某项 × 删除按钮（onMouseDown+preventDefault）→ onDeleteTag(tag) → 父级删库刷新；
  若 tag.name ∈ value → 本组件同步 onChange(value 剔除该项)。

【输入框预选回填与记忆】
CaptureForm 挂载（一次性并行 invoke）：
  tags.list()  → tagLib（下拉源 + 色点）
  tags.lastGet() → selectedTags（上次提交组合；库内已删名称照常入 chips 灰显）
提交：payload.tags = selectedTags → capture:create（主进程 createCaptureWithAttachments
  单事务写 records.tags 快照）
成功（闪现定时器内）：tags.lastSet({ names: selectedTags })（记忆本次组合）；
  编辑器清空，selectedTags 保留（chips 即本次记忆的可视呈现）
失败：内容/标签状态全保留；即席新建的标签库条目不回滚（快照语义：标签本身有效）

【console 标签维护页】
TagsPage 挂载 tags:list → 列表（色点+名称+操作）；
新建行：input + 按钮 → tags:create（重名返回已有，列表刷新去重即可）
行内重命名：点击进入 input → Enter/失焦 tags:rename，Esc 取消；
删除：ConfirmDialog 二次确认 → tags:delete → 列表刷新（记录页快照文本不受影响）

【记录页展示与筛选】
RecordsPage 挂载 tags:list → tagColorMap（name→color）；
RecordRow：record.tags.map → chips（色点 = tagColorMap[name] ?? 灰 #d4d4d4）；
筛选：TagSelect(allowCreate=false) 受控 onChange → 表单值 + page=1 → effect 重查：
  payload.tagNames = filters.tags（非空）→ DAO OR-LIKE 条件 → 任一命中即出
```

### 3.5 技术决策

1. **[新增] 数据模型：tags 表 + records.tags JSON 文本快照列，不做关联表**。理由：与「记录只存文本」模型自洽；筛选对 JSON 文本列参数化 LIKE 即可，零额外迁移；重命名/删除不回溯正是快照语义的自洽推论（已对齐）。备选关联表：多对多中间表引入 JOIN 复杂度与回溯策略争议（改名是否级联），本期无需求信号，明确排除。
2. **[新增] tags.id 用 INTEGER PRIMARY KEY AUTOINCREMENT**（proposal 文本曾写 TEXT PK，方案对齐终稿定为 INTEGER 自增）。理由：与 records/attachments 主键口径一致；库序 = id ASC 天然作为 chips/下拉展示序，无需额外排序字段；重命名/删除后序列稳定。
3. **[新增] tagDao 新建伊始收敛 list/create/rename/delete 四接口**。理由：规避 captureDao 既有债务（缺 getById、listCaptures 与 queryCaptures 并存）；标签场景除 CRUD 与筛选（筛选走 records.tags 列，不经 tagDao）外无查询需求。create 内置重名返回已有：把 UNIQUE 兜底从异常路径收敛为正常返回，渲染层「重名自动转选中」零特判。
4. **[新增] 标签名规则（trim / 非空 / ≤20 字）在 tagDao 单点校验**。理由：console 维护页与输入框即席新建两条写入路径共用同一 choke point，规则不可能分叉；渲染层输入侧同步拦截（超 20 字即拒绝 Enter）只为交互顺滑，不作最终裁决。常量 `TAG_NAME_MAX_LENGTH = 20` 放 shared，DAO 与渲染层同消费。
5. **[新增] 色板常量 TAG_COLOR_PALETTE 放 shared，创建时随机取值在 tagDao**。理由：色板是产品契约（8 色固定集合、不做自由取色），shared 集中可被维护页未来色板选择器（技术债务）与测试直接引用；DAO 取色与入库同事务同一调用点，不产生第二条写路径。备选放渲染层：会要求 create 通道回传 color 再写库，多一次往返且 DAO 职责割裂，不取。
6. **[新增] 标签组合记忆走独立小模块 tagMemoryStore（userData JSON），不经 DAO / 数据库**。理由：记忆是「会话体验」而非「用户数据」，与 records/tags 两表无关联，入库反而引入「记忆随库走」的错误生命周期；JSON 文件缺失/损坏降级空数组即可，无事务诉求。路径与读写惯例照 screenshotService 的 `path.join(app.getPath('userData'), ...)`；写用临时文件 + rename 原子替换。读同步（writeFileSync/readFileSync）——handler 保持与 captureHandlers 同步 DAO 调用同款的简单形态，文件 ~百字节，同步 IO 无感知。
7. **[新增] tags IPC 独立域 + registerIpc 单点装配**。理由：REQ-UI-03 契约收敛惯例延续；tags 六通道语义自成一体（库 CRUD + 记忆），塞进 captureHandlers 会混淆「记录」与「标签库」两个聚合边界。
8. **[新增] TagSelect 自写单组件，不引 antd**。理由：antd Select mode="tags" 交互完备但 bundle 重（antd + css-in-js 输入框入口不可接受）；仓库惯例是自写 primitives（button/dialog/toast/range-time-picker 均手写）；交互面（chips + 过滤 + Enter 即席 + 直删 + blur 时序）用受控 input + 绝对定位下拉即可完整覆盖。复用场景（capture-form 预选/记忆、RecordsPage 受控筛选）经 `allowCreate` / `value-onChange` / `onCreateTag` props 分叉，组件内部零场景特判。
9. **[新增] blur 时序铁律落到 TagSelect**：候选项与删除按钮一律 onMouseDown + preventDefault（mousedown 抢跑 click，preventDefault 阻止 input 失焦），input onBlur 只关下拉、绝不同步收起窗口或调 input.blur()——与 capture-form 注释里「点击拾光按钮的 mousedown 先触发 blur 同步收起」为同一教训。Esc 在 TagSelect 容器 stopPropagation：capture-form 容器级 Esc 会收输入窗口，下拉打开时 Esc 只该关下拉。
10. **[新增] 筛选场景 allowCreate=false（RecordsPage 不传 onCreateTag）**。理由：筛选是只读消费标签库，从筛选框意外创建标签会污染标签库且无产品意图；输入框场景才是创建入口。组件以可选 prop 表达，不做「场景嗅探」。
11. **[新增] 记录页配色映射采用「RecordsPage 拉一次 tags:list → tagColorMap 下发 RecordRow」**。理由：① N 条记录共享一次 invoke，若 RecordRow 自取则每行一次（或各自缓存互相不一致）；② 标签库变化（维护页改名/取色未来可编辑）只需 RecordsPage 一处刷新，chips 配色全列表一致；③ RecordRow 保持纯展示组件，测试只需传 map 断言配色/灰显。备选 RecordRow 自行 invoke：每行重复往返且与现有「父级拉数据、子级纯渲染」分层惯例相悖，不取。
12. **[新增] tagNames OR 条件用参数化 LIKE（带 JSON 引号），不用 json_each**。理由：与现有 conditions 数组拼装风格一致（keyword/since/until/hasImages 同款）；json_each 需要每张表函数可用性确认且查询计划更绕；带引号 `"name"` 参数已把子串误命中（「AI」命中「AIGC」）压到可接受——标签名含双引号的概率可忽略，且名称规则 20 字内人工可控。性能取舍见 3.6。
13. **[新增] capture-form 提交成功后 chips 不清空（与编辑器清空并存）**。理由：chips 即「上次组合」的可视呈现，与 tags:lastSet 语义自洽——关窗再开预选上次组合，若本次提交后清空则用户看到 chips 消失但重开又出现，交互不自洽；即席新建标签后提交失败也保留 chips（重试直接带着标签）。编辑器内容清空照旧（内容已入库）。
14. **[沿用] 零重构纯增量**：captureDao 既有函数签名只增可选参数（`tags?: string[]`、`tagNames?: string[]`），不改既有行为；既有债务（缺 getById、listCaptures 冗余）本次不碰，避免变更面扩散。

### 3.6 风险 / 取舍

- [风险] **records.tags 文本快照无数据库级完整性**，外部工具改库可能写坏 JSON → 缓解：读取侧统一 try/catch 降级 `[]`（骨架 8）；快照语义下损坏仅影响该行标签展示，不炸列表。
- [取舍] **LIKE 筛选在大数据量下的性能**（records.tags 无法走索引，全表扫）→ 接受：本地单人场景记录量有限（数月高频使用估 10^4 级），LIKE 扫描毫秒级；与既有 keyword LIKE 同一量级。若未来成为瓶颈，方向是 tags 反向索引表或 FTS，属数据层演进，单独立项。
- [风险] **LIKE 子串误命中**（tag「AI」命中快照 `["AIGC"]`）→ 缓解：匹配参数恒带 JSON 引号（`"AI"` vs `"AIGC"` 不互配）；双引号入标签名的概率忽略（名称规则下人工可控）。
- [风险] **TagSelect blur 时序回归**（候选项 click 被 input blur 抢先，或 Esc 冒泡误收窗口）→ 缓解：onMouseDown+preventDefault 与 stopPropagation 写成骨架铁律（3.3-4/5）并组件测试锁死；真机走查补验。
- [风险] **记忆 JSON 与标签库漂移**（记忆的组合里标签已被删除）→ 接受：预选时按名称回填 chips，库内不存在则灰显——与记录页「已删标签灰显」同一语义，用户看到即知。
- [取舍] **输入窗口 480px 占用更多屏幕** → 接受：chips 区约 40px 高；小屏仍由 `inputWindowSize()` 按工作区收小兜底（现有逻辑不变）。
- [风险] **即席新建并发重名**（两个入口同时建同名）→ 已解：DAO 先查后插 + UNIQUE 兜底，重名返回已有，不可能产生重复行。
- [取舍] **删除标签不回溯**（记录保留旧文本）→ 接受：快照语义的产品决策（proposal 已对齐），记录页灰显承担可视反馈。

### 3.7 技术债务

- **标签 chips 按库序展示**（id ASC）：标签库膨胀后找标签变难。建议方向：按使用频次排序（计数来源可从记录快照统计或引入计数列，届时再定）。
- **AND 语义 / 多标签交叉筛选**：本期仅 OR；未来有强需求时筛选 UI 加「匹配模式」切换，SQL 层参数化拼装即可，数据模型无需演进。
- **标签颜色自定义 / 色板治理**：本期随机且不可改；色板常量已在 shared 就位（决策 5），未来维护页加色板选择器即可（预置集合，不做自由取色）。
- **标签合并 / 别名**：库膨胀后可能产生近义标签；合并是写入型治理（批量改写记录快照文本），届时单独立项。
- **records.tags 筛选性能**：LIKE 全表扫，当前量级可接受；量级上来后评估反向索引 / FTS（见 3.6）。
- **captureDao 既有债务**（缺 getById、listCaptures 与 queryCaptures 并存）：本次不收敛，零重构原则延续。

### 3.8 影响文件清单

**packages/shared/**
- `src/index.ts`：新增 `Tag` / `CreateTagPayload` / `RenameTagPayload` / `DeleteTagPayload` / `SetLastTagsPayload` 类型、`TAG_NAME_MAX_LENGTH` / `TAG_COLOR_PALETTE` 常量、IPC 六个 tags 通道常量；`CaptureRecord` 增 `tags: string[]`、`CreateCapturePayload` 增 `tags?: string[]`、`QueryCapturesPayload` 增 `tagNames?: string[]`

**packages/ai/**
- `src/migrations/0004_tags.ts`（新建）：tags 建表 + records.tags 加列；down 删表删列
- `src/db.ts`：migrations 数组登记 0004
- `src/dao/tagDao.ts`（新建）：setTagDatabase + listTags / createTag（重名返回已有、名称规则、随机色）/ renameTag / deleteTag
- `src/dao/captureDao.ts`：RecordRow 增 tags 列；toRecord tags 解析（try/catch 降级）；createCapture / createCaptureWithAttachments 写 tags 快照；queryCaptures tagNames OR-LIKE 条件
- `src/index.ts`：tagDao 导出同步
- 测试：`src/db.test.ts`（0004 结构断言 + down 回滚）、`src/dao/tagDao.test.ts`（新建）、`src/dao/captureDao.test.ts`（tags 读写 / tagNames OR 筛选 / total 一致 / JSON 损坏降级）

**apps/desktop 主进程**
- `src/main/tags/tagMemoryStore.ts`（新建）：getLastTags / setLastTags（userData/tags-last.json，缺失/损坏降级、原子写）
- `src/main/ipc/tagsHandlers.ts`（新建）：六通道注册
- `src/main/ipc/registerIpc.ts`：装配 registerTagsHandlers
- `src/main/index.ts`：启动处补 setTagDatabase（与 setCaptureDatabase 同点）
- `src/main/windows/inputWindow.ts`：INPUT_HEIGHT 440 → 480（resizable:false 不变）
- 测试：`src/main/tags/tagMemoryStore.test.ts`（新建，vi.mock electron）、`src/main/ipc/tagsHandlers.test.ts`（新建）

**apps/desktop preload / env**
- `src/preload/index.ts`：ShiguangApi 新增 tags 分组与 api 实现
- `src/renderer/env.d.ts`：无需改（经 `import type { ShiguangApi }` 自动跟随）

**apps/desktop renderer**
- `src/renderer/components/ui/tag-select.tsx`（新建）：TagSelect 全交互（chips / 过滤 / Enter / 即席 / Backspace / 直删同步 / blur 铁律 / Esc stopPropagation）
- `src/renderer/input/features/capture/capture-form.tsx`：chips 区挂载（编辑器与底部操作条之间）、预选回填、提交带 tags、成功 lastSet、chips 不清空
- `src/renderer/console/components/SideNav.tsx`：ConsolePage 类型 + NAV_ITEMS 增 'tags'
- `src/renderer/console/App.tsx`：'tags' 渲染分支 + TagsPage 导入
- `src/renderer/console/pages/TagsPage.tsx`（新建）：列表 + 新建 + 行内重命名 + 删除 dialog 二次确认
- `src/renderer/console/pages/RecordsPage.tsx`：筛选区第四条件 TagSelect（allowCreate=false）、tagColorMap 下发、payload.tagNames
- `src/renderer/console/pages/RecordRow.tsx`：tagColors 可选 prop + chips 行（库色/灰色）
- 测试：`tag-select.test.tsx`（新建）、`capture-form.test.tsx`、`TagsPage.test.tsx`（新建）、`RecordsPage.test.tsx`、`RecordRow.test.tsx`

**docs**
- `docs/REQUIREMENTS.md`：状态总览表新增 REQ-TAG-01~05（未开始，各含粗粒度验收）+ 变更记录追加

## 4. 回滚条件

- TagSelect 在真机出现不可修复的 blur/时序缺陷（下拉点击丢焦点、Esc 误收窗口）且组件内无法收敛 → revert 渲染层 TagSelect + capture-form 接入（任务 10~13），数据层与 IPC（迁移 0004、tagDao、tagsHandlers、preload）独立成立无害；chips 区整体摘除即可回到纯图文输入框基线。
- 迁移 0004 在用户环境出现兼容问题（低风险：DDL 均为标准语法，DROP COLUMN 有 0003 先例）→ 执行 0004 down（删 tags 表、删 records.tags 列）回滚数据层，业务代码回滚至无标签版本。
- 发现快照语义引发不可接受的查询/展示偏差（如 LIKE 误命中在真实数据下显著）→ 先评估参数化匹配修正；不可行则回滚筛选条件（tagNames 条件移除），展示与打标能力保留。
