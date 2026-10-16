> **已废弃（superseded，2026-10-16）**：交互方向变更，「全局热键 + 模拟复制」捕获方案作废，相关代码已整体移除；新方向为「桌面宠物 + 手动输入框」，见 docs/REQUIREMENTS.md 变更记录。本文档仅留档。
>
---
slug: m1-capture-ingest
derived_from: .rail/changes/m1-capture-ingest/design.md
---

# Tasks — m1-capture-ingest

## 实现任务

### packages/shared

- [x] 任务 1：在 `packages/shared/src/index.ts` 定义 `RECORD_TYPES`（`['text','rich']` as const）、`RecordType`、`Attachment`、`CaptureRecord` 类型并导出。
  - **前置条件**：无
  - **对应验收标准**：AC-2（类型层支撑图文合并记录）
  - **关键契约**：
    ```ts
    export const RECORD_TYPES = ['text', 'rich'] as const;
    export type RecordType = (typeof RECORD_TYPES)[number];
    export interface Attachment { id: number; recordId: number; filePath: string; createdAt: string }
    export interface CaptureRecord { id: number; type: RecordType; text: string | null; sourceApp: string | null; createdAt: string; attachments: Attachment[] }
    ```

### packages/ai

- [x] 任务 2：修正三个包 tsconfig 的 `noEmit:true` 与 base `composite/declaration` 冲突——在各包 tsconfig 中显式设置 `composite:false, declaration:false, declarationMap:false` 保持 `noEmit:true`，使 `pnpm typecheck` 全仓通过。
  - **前置条件**：无
  - **对应验收标准**：AC-10
  - 涉及 `packages/shared/tsconfig.json`、`packages/ai/tsconfig.json`、`apps/desktop/tsconfig.json`；不改 `tsconfig.base.json`。

- [x] 任务 3：在 `packages/ai/package.json` 添加 `umzug` 与 `vitest`（及 `@vitest/coverage-*` 不需要）依赖，并配置 better-sqlite3 的 Electron ABI rebuild postinstall（`@electron/rebuild` 或等价脚本）。
  - **前置条件**：无
  - **对应验收标准**：AC-8
  - 验收：`pnpm install` 后 `node_modules/better-sqlite3` 可被 Electron 主进程 require 不抛 ABI 错误。

- [x] 任务 4：创建 `packages/ai/src/migrations/0001_init.ts` 迁移文件，内含 records 与 attachments 两表建表 DDL（字段、外键 `record_id → records(id) ON DELETE CASCADE`、索引按 design 3.2 节）。
  - **前置条件**：`[1]`
  - **对应验收标准**：AC-2
  - **关键契约**（DDL 要点）：
    ```sql
    CREATE TABLE records (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, text TEXT, source_app TEXT, created_at TEXT NOT NULL);
    CREATE TABLE attachments (id INTEGER PRIMARY KEY AUTOINCREMENT, record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE, file_path TEXT NOT NULL, created_at TEXT NOT NULL);
    ```

- [x] 任务 5：实现 `packages/ai/src/db.ts` 的 `initDatabase(dbPath)`：打开 better-sqlite3、执行 `PRAGMA foreign_keys = ON`、用 umzug（SQLite storage 记录已执行迁移）跑 `migrations/` 下全部迁移。
  - **前置条件**：`[3, 4]`
  - **对应验收标准**：AC-9
  - **关键契约**：`export function initDatabase(dbPath: string): Database.Database`
  - 先写测试（TDD）：`packages/ai/src/db.test.ts` 验证迁移后两表存在、二次调用不重复执行迁移。

- [x] 任务 6：实现 `packages/ai/src/dao/captureDao.ts` 的 `createCapture(input, attachmentPaths)`：单事务写入一条 records + N 条 attachments，返回完整 `CaptureRecord`。
  - **前置条件**：`[5]`
  - **对应验收标准**：AC-1、AC-2
  - **关键契约**：`export function createCapture(input: { type: RecordType; text: string | null; sourceApp?: string | null }, attachmentPaths: string[]): CaptureRecord`
  - 先写测试（TDD）：`packages/ai/src/dao/captureDao.test.ts` 覆盖纯文本、图文并存、纯图（text 为 null）三种输入。

- [x] 任务 7：实现 `captureDao.ts` 的 `listCaptures(limit)` 与 `deleteCapture(id)`：`listCaptures` 按时间倒序返回记录含附件数组；`deleteCapture` 删除记录（外键级联删附件行）并先返回附件路径供调用方删磁盘文件。
  - **前置条件**：`[6]`
  - **对应验收标准**：AC-2
  - **关键契约**：`export function listCaptures(limit?: number): CaptureRecord[]`、`export function deleteCapture(id: number): { deletedImagePaths: string[] }`
  - 先写测试（TDD）：覆盖倒序查询与级联删除附件行。

### apps/desktop 主进程骨架

- [x] 任务 8：在 `apps/desktop/package.json` 将占位 `dev` 脚本替换为 `electron-vite dev`（`build`/`start` 相应补齐），添加 `electron-vite`、`dotenv`、`@shiguang/ai`（workspace:*）依赖。
  - **前置条件**：`[2, 3]`
  - **对应验收标准**：AC-8

- [x] 任务 9：创建 `apps/desktop/electron.vite.config.ts`：主进程入口 `src/main/index.ts`、渲染进程入口 `src/renderer/index.html`（占位即可），`@shiguang/shared` 与 `@shiguang/ai` 源码直引打包，`better-sqlite3` 标记 external。
  - **前置条件**：`[8]`
  - **对应验收标准**：AC-8

- [x] 任务 10：创建 `apps/desktop/src/main/index.ts` 入口骨架：加载 dotenv → `app.dock?.hide()` → `checkAccessibilityOnStart()` → `registerCaptureHotkey()` → 控制台输出启动日志；不创建任何 BrowserWindow，根 `pnpm dev` 可一键启动且无报错。
  - **前置条件**：`[9]`
  - **对应验收标准**：AC-8
  - 本任务仅骨架（函数可先为最小桩），捕获逻辑在后续任务填充。

### 捕获引擎

- [x] 任务 11：实现 `apps/desktop/src/main/capture/clipboard.ts` 的 `readClipboard()`：模拟 Cmd+C 后读取 `clipboard.availableFormats()`，按纯文本/图片/混合/空（含仅文件等不支持类型）返回判型结果。
  - **前置条件**：`[10]`
  - **对应验收标准**：AC-1、AC-3、AC-4
  - **关键契约**：`export interface ClipboardResult { kind: 'text'|'image'|'mixed'|'empty'|'unsupported'; text: string|null; images: Electron.NativeImage[] }`
  - Electron API 依赖重，以手动验收为主：真实应用选中文字/图片/文件分别按热键观察判型。

- [x] 任务 12：实现 `apps/desktop/src/main/capture/paths.ts`：导出 `getImageDir()` 返回 `path.join(app.getPath('userData'), 'images')`（不存在则创建），及图片保存函数（UUID 文件名 + 正确扩展名）。
  - **前置条件**：`[10]`
  - **对应验收标准**：AC-2、AC-9
  - 验收：保存图片后文件存在于 `userData/images/` 下且可用预览打开。

- [x] 任务 13：实现 `apps/desktop/src/main/capture/engine.ts` 的 `registerCaptureHotkey()`：注册 Cmd+Shift+C 全局热键，触发链路为 `ensureAccessibility()` → 模拟 Cmd+C → `readClipboard()` → 图片写盘 + `createCapture()` 入库 → 成功通知；空/不支持类型 → 失败通知。连按不防抖，每次完整处理。
  - **前置条件**：`[11, 12]`、`[6]`
  - **对应验收标准**：AC-1、AC-2、AC-3、AC-5、AC-7
  - DB 写入失败时删除已写盘图片文件，并弹"保存失败"通知。

### 权限引导与通知

- [x] 任务 14：实现 `apps/desktop/src/main/permissions.ts`：启动时 `systemPreferences.isTrustedAccessibilityClient(false)` 检测，未授权弹系统通知说明原因，点击通知执行 `shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')` 打开授权页。
  - **前置条件**：`[10]`
  - **对应验收标准**：AC-6
  - 手动验收：撤销拾光辅助功能权限后重启应用，收到引导通知且点击可打开设置页。

- [x] 任务 15：在 `permissions.ts` 实现 `ensureAccessibility()`：热键触发时再次检测，未授权弹同样的引导通知并返回 false 阻断捕获链路（权限可能在运行中被撤销）。
  - **前置条件**：`[14]`
  - **对应验收标准**：AC-6、AC-7

- [x] 任务 16：实现 `apps/desktop/src/main/capture/notifier.ts`：成功通知——纯文本显示文字前若干字，图文显示"已捕获 1 段文字 + N 张图片"；失败通知按原因（未选中/剪贴板无内容/权限不足/不支持类型/保存失败）给出对应文案。
  - **前置条件**：`[10]`
  - **对应验收标准**：AC-1、AC-2、AC-4、AC-5、AC-7
  - 使用 Electron 内置 `Notification`，不引入 node-notifier。

### DX 与文档收尾

- [x] 任务 17：创建 `.env.example`（仓库根，与 dotenv 加载路径一致）：`KIMI_API_KEY=` 占位 + 注释说明 M5 分析阶段才使用；确认 `apps/desktop/src/main/index.ts` 的 dotenv 加载生效。
  - **前置条件**：`[10]`
  - **对应验收标准**：AC-9

- [x] 任务 18：更新 `README.md`：补充 db 文件位置（`app.getPath('userData')/shiguang.db`）与查看工具推荐（DB Browser for SQLite / TablePlus）、"数据明文存储"风险说明、M1 quick start（含 `cp .env.example .env`）。
  - **前置条件**：无
  - **对应验收标准**：AC-9

- [ ] 任务 19：端到端手动验收走查：文字捕获、图片/文件类型"暂不支持"提示、未选中提示、权限撤销、重启持久化五个场景逐一过一遍。
  - **前置条件**：`[13, 15, 16, 17, 18]`
  - **对应验收标准**：AC-1 ~ AC-9

## 范围变更记录

### 2026-10-15 裁剪：纯文字捕获（产品决策）

M1 放弃剪贴板图片捕获，仅支持文字。图片机制（attachments 表、Attachment 类型、
saveImage/getImageDir、mixed/image 判型、图文合并）已整体删除，图片需求由 M4
选区截图承接。原任务 1/4/6/7/11/12/13/16 中涉及附件与图文的关键契约相应作废，
已按新契约重写实现与全部测试（ai 7/7、desktop 13/13 通过）。

**裁剪原因**：实测发现 Word 等应用分批写入剪贴板导致图文混合读取竞态（两次
手动验收分别丢失文字/图片），修复成本高、入口隐晦；截图是"留图"的正主场景。

**走查结论更新**（替代原七场景）：文字捕获 ✅（已验证）；图片/文件 →
"暂不支持"提示；空剪贴板 → "未捕获到内容"提示；持久化 ✅（已验证）；
通知送达 ✅（需在系统通知设置中将横幅样式改为"横幅"）。

### 2026-10-15 变更：触发方式改为双击 Cmd（产品决策）

捕获触发由 `Cmd+Shift+C`（Electron globalShortcut）改为**双击 Cmd**（新增
`capture/hotkey.ts`，uiohook-napi 监听"按下→松开→400ms 内再按下"，触发后 500ms
不应期）。旧组合键注册整体移除，`engine.ts` 的 `registerCaptureHotkey` 删除、
`handleCapture` 导出供 hotkey 回调。

**变更原因**：实测 macOS 按住按键的系统级重复事件被 globalShortcut 如实上报，
一次按键入库 2~3 条；双击判定要求中间有"松开"，天然免疫按住重复。原任务 10/13
中热键注册相关契约作废。已补 hotkey 状态机 9 例单测（双击/单击/按住/窗口超时/
不应期/左右 Meta 混用），desktop 22/22 全过。

### 2026-10-15 修复：剪贴板陈旧读取竞态（走查发现的 bug）

**现象**：入库的是上一次剪贴板内容而非本次选中内容。
**根因**：`readClipboard()` 的等待条件是"剪贴板非空"——旧内容常驻导致等待立即
通过，读取发生在目标应用完成本次复制之前。
**修复**：改为"快照 + 等待变化"——模拟 Cmd+C 前对剪贴板做快照，注入后轮询
直至内容变化（50ms 间隔，1.5s 超时），超时未变化判 'empty'（视为未选中）。
已知取舍：逐字节相同的重复复制会超时判 empty（Electron 未暴露 NSPasteboard
changeCount，无法在内容与上次相同时确认"确实复制了"）。
clipboard.test.ts 重写为 11 例（含异步落地回归与超时路径），desktop 25/25 全过。

### 2026-10-15 回退：撤销"快照+等待变化"，恢复最简读取（产品决策）

**决策**：双击 → 模拟 Cmd+C → 等剪贴板非空 → 直读判型，就是最终方案。
**回退原因**："快照+等待变化"为修陈旧读取而加，但有结构性盲区——内容在触发前
已存在于剪贴板时（手动复制过/重复复制相同内容），变化永不发生，永远误报未选中，
体验不可接受。clipboard.ts 由 118 行回退至 79 行；已知取舍：慢应用（Word 类）
极小概率入库上一条内容，接受不修，后续由 M4 截图承接图片/复杂场景。
