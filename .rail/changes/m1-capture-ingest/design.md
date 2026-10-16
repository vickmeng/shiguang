> **已废弃（superseded，2026-10-16）**：交互方向变更，「全局热键 + 模拟复制」捕获方案作废，相关代码已整体移除；新方向为「桌面宠物 + 手动输入框」，见 docs/REQUIREMENTS.md 变更记录。本文档仅留档。
>
# Design: M1 捕获与入库（m1-capture-ingest）

## 1. 概述

M1 交付拾光的最小闭环：用户在任何应用中选中文字或图片 → 按全局热键（默认 Cmd+Shift+C）→ 内容落入本地 SQLite → 系统通知反馈结果。

运行形态：**无窗口后台运行**，主进程不创建任何 BrowserWindow，dock 图标隐藏，系统通知是唯一用户触点；仅在拾光运行期间热键可用。

**范围内：**

- 全局热键捕获（M1 写死 Cmd+Shift+C，不可配置）
- 文字捕获（富文本只取纯文本版，格式不保留）
- 图片捕获（存文件系统，库存路径；图文并存合并为一条 rich 记录）
- SQLite 持久化：records 主表 + attachments 附件表，经迁移机制建表
- 捕获结果系统通知（成功与失败均提示，绝不静默）
- macOS Accessibility 权限检测与首次引导
- `.env` 模板 + `pnpm dev` 一键启动（REQ-DX-02）
- README 补充 db 文件位置与查看工具推荐

**范围外（M1 不做）：** 查询界面（M2）、圈屏/选区截图（M4）、AI 分析/LLM 调用（M5，`.env` 仅占位）、托盘常驻/关窗热键/开机自启（M3）、敏感内容防护/脱敏（M1 明文入库，README 需如实说明）、热键可配置、React UI。

## 2. 验收标准

- AC-1：在任意应用中选中文字，按 Cmd+Shift+C，弹出成功通知（显示文字前若干字），重启应用后该记录仍在。
- AC-2：选中图文并存内容（如网页富文本），按热键后 DB Browser 中可见一条记录（文字为主）+ N 条附件行，图片文件存在于数据目录。
- AC-3：仅选中图片（无文字），按热键后入库一条纯图记录（text 为空），附件行与图片文件均在。
- AC-4：剪贴板为文件（Finder 复制的文件）时，弹通知提示"暂不支持该类型"，不入库。
- AC-5：未选中任何内容（模拟 Cmd+C 后剪贴板无文本无图片）时，弹通知提示未捕获到内容。
- AC-6：Accessibility 权限未授予时：启动即弹通知说明原因，点击通知打开系统设置授权页；运行中按热键再次兜底检测，弹同样引导。
- AC-7：所有失败场景（AC-4/AC-5/AC-6/保存失败）均有明确通知，无静默失败。
- AC-8：`pnpm dev` 一键启动拾光（无窗口后台运行，控制台输出运行日志），主进程代码改动自动重启。
- AC-9：数据库文件位于 `app.getPath('userData')` 下（单一 SQLite 文件）；README 写明 db 路径及 DB Browser for SQLite / TablePlus 查看方法；`cp .env.example .env` 后 dotenv 正常加载（KIMI_API_KEY 仅占位）。
- AC-10：`pnpm typecheck` 在三个包均通过（tsconfig noEmit 与 base composite/declaration 冲突已消除）。

## 3. 实现方案

### 3.1 接口与函数签名

**packages/shared/src/index.ts**

```ts
// 记录类型枚举——必须预留 M4 截图等扩展
export const RECORD_TYPES = ['text', 'rich'] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export interface Attachment {
  id: number;
  recordId: number;
  filePath: string;
  createdAt: string;
}

export interface CaptureRecord {
  id: number;
  type: RecordType;
  text: string | null;
  sourceApp: string | null;
  createdAt: string;
  attachments: Attachment[];
}
```

**packages/ai/src/（数据层，主进程仅经此读写）**

```ts
// db.ts —— 数据库初始化与迁移入口
export function initDatabase(dbPath: string): Database.Database;

// dao/captureDao.ts —— 捕获记录读写
export function createCapture(
  input: { type: RecordType; text: string | null; sourceApp?: string | null },
  attachmentPaths: string[]
): CaptureRecord;              // 单事务写入 record + attachments
export function listCaptures(limit?: number): CaptureRecord[];
export function deleteCapture(id: number): void;  // 级联删除附件行 + 调用方负责磁盘文件
```

**apps/desktop/src/main/（捕获引擎）**

```ts
// capture/engine.ts
export function registerCaptureHotkey(): void;        // globalShortcut 注册 + 热键触发入口
// capture/clipboard.ts
export interface ClipboardResult {
  kind: 'text' | 'image' | 'mixed' | 'empty' | 'unsupported';
  text: string | null;
  images: Electron.NativeImage[];
}
export function readClipboard(): ClipboardResult;     // 模拟 Cmd+C 后读取 availableFormats 判定
// capture/paths.ts
export function getImageDir(): string;                // userData/images/
// capture/notifier.ts
export function notifySuccess(record: CaptureRecord): void;  // 成功通知文案
export function notifyFailure(reason: string): void;   // 失败通知文案
// permissions.ts
export function checkAccessibilityOnStart(): void;    // 启动检测 + 通知引导
export function ensureAccessibility(): boolean;       // 热键触发时兜底检测
```

### 3.2 关键数据结构（DDL 级描述）

**records 表**

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | 自增主键 |
| type | TEXT | NOT NULL，取值 'text' / 'rich' | 记录类型，枚举值须留扩展口（M4 截图等新增取值） |
| text | TEXT | 可空 | 文字内容；纯图场景为 NULL |
| source_app | TEXT | 可空 | 来源应用，M1 仅保留字段不入值，M2+ 使用 |
| created_at | TEXT | NOT NULL，默认当前时间戳 | ISO 8601 |

**attachments 表**

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | 自增主键 |
| record_id | INTEGER | NOT NULL，FOREIGN KEY → records(id) ON DELETE CASCADE | 强制外键关联 |
| file_path | TEXT | NOT NULL | 图片文件路径（绝对路径） |
| created_at | TEXT | NOT NULL | ISO 8601 |

建表 DDL 存于迁移文件（`packages/ai/src/migrations/`），迁移框架用 umzug，storage 自定义为 SQLite 表记录已执行迁移（表名如 `_migrations`）。删除记录时必须级联清理附件行（外键 ON DELETE CASCADE）与磁盘文件（DAO 返回附件路径后由调用方删除）。

### 3.3 关键骨架（必须按此实现）

1. 主进程入口只做三件事：加载 dotenv → `checkAccessibilityOnStart()` → `registerCaptureHotkey()`；不创建 BrowserWindow，启动即 `app.dock?.hide()`。
2. 每次热键触发独立完整处理：模拟 Cmd+C → 读剪贴板 → 判型 → 入库 → 通知；不防抖、不排队（连按=多次完整捕获）。
3. 图片写入与 DB 写入在同一事务语义内：先写图片文件，再单事务写 record+attachments；DB 失败时删除已写图片文件。
4. `type` 判定：仅文本 → 'text'；有图（无论有无文本）→ 'rich'；皆无或仅文件 → 不入库走失败通知。
5. better-sqlite3 必须 `PRAGMA foreign_keys = ON`（级联删除依赖此开关）。

### 3.4 数据流 / 状态变更

```
热键 Cmd+Shift+C
  → ensureAccessibility() 兜底检测（未授权 → 引导通知，终止）
  → 模拟 Cmd+C（robot/键盘事件注入）
  → clipboard.readClipboard()：availableFormats 判定
      ├─ empty/unsupported → notifyFailure(具体原因)，不入库
      └─ text/image/mixed
          → 图片写 userData/images/<uuid>.<ext>
          → createCapture() 单事务写 records + attachments
          → notifySuccess(record)（文字→前若干字；图文→"已捕获 1 段文字 + N 张图片"）
```

### 3.5 技术决策

1. **构建工具链 electron-vite**：主进程与渲染进程统一由 electron-vite 构建，dev 下主进程改动自动重启；替换 apps/desktop 占位 dev 脚本，实现根 `pnpm dev` 一键起。
   - 备选：手写 esbuild + concurrently。舍弃理由：electron-vite 对 ESM 主进程、外部化 better-sqlite3 原生模块、monorepo workspace 依赖（@shiguang/shared 源码直引）均有现成配置，手写需重复造轮子。
2. **数据模型 records + attachments 两表一对多**：图文并存 = 一条 records + N 条 attachments；纯文字 = 一条 records。
   - 备选：单表 JSON 字段存附件数组。舍弃理由：附件无法外键约束、无法单独索引/删除，M4 截图等多附件类型演进困难。
3. **迁移框架选 umzug（不引 ORM）**：纯迁移框架，storage 可自定义为 SQLite 记录已执行迁移，满足"单一 SQLite 文件 + 迁移通道"诉求。
   - 备选：knex（自带 query builder，过重）；手写版本号表（无现成框架语义，重复劳动）。
4. **权限引导用系统通知**：启动时 `systemPreferences.isTrustedAccessibilityClient` 检测，未授权弹系统通知说明原因，点击通知打开系统设置授权页；热键触发时再兜底一次。不出现"按了没反应"。
   - 备选：创建引导窗口。舍弃理由：M1 明确无窗口运行形态，通知是唯一触点。
5. **无窗口后台运行**：M1 主进程不创建任何 BrowserWindow，dock 图标隐藏。
6. **通知用 Electron 内置 Notification**：不引入 node-notifier，与 Electron 生命周期天然集成。
7. **剪贴板判定流程**：按热键 → 模拟 Cmd+C → 读 `availableFormats`：有纯文本以文本为主内容（富文本只取纯文本版）；有图片每图存附件；文本与图片皆无（如文件）→ 失败提示。超长文字/超大图片原样保存不截断。
8. **图片与数据目录**：图片存 `app.getPath('userData')/images/`，UUID 文件名；数据库文件同目录下单一 shiguang.db；attachments 存绝对路径。
9. **better-sqlite3 原生模块 electron ABI rebuild**：postinstall 挂 @electron/rebuild 或等价方案，保证 dev/打包下原生模块与 Electron ABI 匹配。
10. **REQ-DX-02**：`.env.example` 模板（`KIMI_API_KEY=` 占位 + 注释说明 M5 才用）、dotenv 加载、README 补充 db 位置与 DB Browser / TablePlus 推荐及"数据明文存储"风险说明。
11. **tsconfig 修正**：各包 noEmit:true 与 base composite/declaration 冲突的解决——源码直引（workspace 包以源码形式被 electron-vite 打包编译）路径下的最小改动方案，使 `pnpm typecheck` 三包通过。

### 3.6 风险 / 取舍

- [风险] 模拟 Cmd+C 在某些应用（终端、游戏）可能不生效或延迟 → 接受：M1 覆盖主流应用场景，失败时有"未捕获到内容"通知兜底，绝不静默。
- [风险] M1 明文入库，密码/密钥误捕获无防护 → 接受：README 如实说明，记入风险清单，M9 以脱敏配置解决（proposal 第 3 节已确认）。
- [取舍] 来源应用 source_app 只存字段不取值 → 采集 API（activeWindow 等）后续迭代引入，M2 不做按它筛选。
- [取舍] 重复捕获相同内容照常入库、高频连按不防抖 → 产品决策：每次捕获是独立时间线事件。

### 3.7 技术债务

- 无。迁移机制在 M1 一并建立，为后续向量共存（sqlite-vec）预留迁移通道。

### 3.8 影响文件清单

**packages/shared/**
- `src/index.ts`：RecordType 枚举、CaptureRecord / Attachment 类型

**packages/ai/**
- `src/db.ts`：数据库初始化（open + PRAGMA + umzug migrate）
- `src/migrations/0001_init.ts`：records / attachments 建表 DDL
- `src/dao/captureDao.ts`：createCapture / listCaptures / deleteCapture
- `src/db.test.ts`、`src/dao/captureDao.test.ts`：数据层测试（vitest）
- `package.json`：新增 umzug、vitest 依赖；postinstall better-sqlite3 ABI rebuild 配置
- `tsconfig.json`：noEmit/composite 冲突修正

**apps/desktop/**
- `package.json`：dev 脚本替换为 electron-vite dev，新增 electron-vite / dotenv / vitest 依赖
- `electron.vite.config.ts`：主进程/渲染进程构建配置（shared 与 ai 源码直引、better-sqlite3 external）
- `src/main/index.ts`：入口（dotenv 加载 + 权限检测 + 热键注册，无窗口）
- `src/main/capture/engine.ts`、`clipboard.ts`、`paths.ts`、`notifier.ts`、`permissions.ts`
- `tsconfig.json`：noEmit/composite 冲突修正
- `.env.example`（或仓库根，与 dotenv 加载路径一致）：KIMI_API_KEY 占位模板

**根目录**
- `tsconfig.base.json`：按需微调（composite/declaration 与 noEmit 的冲突解决基准）
- `README.md`：db 文件位置、查看工具推荐（DB Browser / TablePlus）、明文存储说明、quick start 更新

## 4. 回滚条件

- 热键注册导致全局系统冲突或模拟 Cmd+C 在常用应用（浏览器/编辑器）中引起异常行为，且无法在迭代内修复。
- better-sqlite3 原生模块 ABI rebuild 在目标开发环境（macOS + Electron 33）持续失败，阻塞主进程启动。
- Accessibility 权限引导方案在 macOS 实际行为与设计不符（如通知不可点击打开设置页），且不存在等价替代路径。
