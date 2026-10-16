# Design: M2 查询页面（m2-records-console）

## 1. 概述

M2 交付拾光的首个正式界面窗口——后台（console）：输入框窗口新增「打开后台」按钮，点击后主进程打开/聚焦一个普通系统窗口（第三个 BrowserWindow），左侧导航 + 右侧内容区，本次落地「记录」页（时间倒序分页列表、展开全文、复制、单删/批量删除、组合筛选），「设置」页为空占位 + TODO 标记。

运行形态变化：主进程新增第三个可聚焦的真实界面窗口；宠物窗（frameless + transparent + alwaysOnTop）与输入框窗交互完全不变（左键 toggle 输入框，不加右键菜单，托盘仅退出）。

**范围内：**

- 后台入口：输入框窗「打开后台」按钮 → `console:open` 信号通道 → 主进程打开/聚焦后台窗口（幂等创建，关闭后可重开）
- 第三个窗口模块 `main/windows/consoleWindow.ts`：普通系统窗口（frame 保留、resizable、约 960×640、非 alwaysOnTop、非 transparent、可最小化/关闭）
- 后台 UI：React + Tailwind + shadcn 自写 primitives，左右布局（导航「记录」/「设置」+ 内容区）
- 记录页：每页 20 条时间倒序分页（created_at DESC, id DESC）；每条常驻复选框 + 截断预览 + 存入时间（本地时区格式化）；点击行展开/折叠全文；一键复制（写剪贴板 + 轻提示）；单条删除与勾选批量删除（均二次确认，批量显示条数；勾选 ≥1 时顶部浮现操作栏）；删光当前页自动回退
- 筛选：关键词搜索（LIKE '%kw%' 包含匹配，参数化）+ 时间快捷预设（全部/今天/最近7天/最近30天，本地时区起算），两者可组合；空库、搜索/筛选无结果分别有引导文案
- DAO 扩展：`queryCaptures`（分页 + 关键词 + 时间，入参对象化）与 `deleteCaptures`（单删=单元素数组）
- 技术债（REQ-UI-03）：`pet:clicked` / `input:blur` / `input:close` 从窗口模块内收敛到 `registerIpc` 汇总点（窗口模块导出注册函数，创建不再注册 IPC，行为不变）
- 技术债（pet 文档）：开发者工具入口收敛——后台窗口右键 contextmenu toggleDevTools
- 性能：DAO 层分页（LIMIT/OFFSET），渲染端不拉全量；每页仅 20 条

**范围外（M2 不做）：** 内容类型筛选（M4）；M6 分析结果不预留任何结构/展示位置；设置页不实现实际设置项；不改宠物窗交互、不加右键菜单、不改托盘职责；搜索不引入 FTS5（真出现卡顿再升级，对 DAO 接口透明）；records 表结构不变（迁移不动）。

## 2. 验收标准

- AC-1：输入框窗口点击「打开后台」，后台窗口打开并聚焦；关闭后台窗口后再次点击可重新打开；宠物左键唤出输入框行为不变，全程无新增右键菜单。
- AC-2：后台窗口为普通系统窗口：有标题栏（frame 保留）、可调整大小、可最小化/关闭，非置顶、非透明，初始约 960×640。
- AC-3：记录页按时间倒序分页展示（每页条数可配：10/20/50/100，默认 20），每条显示截断预览与存入时间（本地时区格式化显示）。
- AC-4：点击记录行展开全文，再次点击折叠。
- AC-5：点击复制按钮将记录全文写入剪贴板，并给出轻提示反馈。
- AC-6：单条删除弹二次确认弹窗，确认后该记录消失；勾选多条后顶部浮现操作栏（已选 N 条 / 批量删除 / 取消），批量删除弹窗显示条数，确认后批量消失。
- AC-7：删光当前页后自动回退：当前页 >1 回前一页，否则停留第一页。
- AC-8：关键词搜索与时间预设（全部/今天/最近7天/最近30天）可组合筛选且结果正确；时间预设支持切到「自定义」区间（起止 datetime-local 精确到秒，换算 ISO 传 since/until）；组合无结果显示空状态；空库显示引导性空状态文案。
- AC-9：设置页显示空占位内容与 TODO 标记。
- AC-10：新增通道 `capture:list` / `capture:delete` / `console:open` 的常量与 payload/返回类型全部位于 `packages/shared`；`pet:clicked` / `input:blur` / `input:close` 的注册已收敛进 `registerIpc()` 汇总点，窗口创建函数不再注册 IPC，显隐/blur 抑制行为不变。
- AC-11：后台窗口内右键呼出 contextmenu 时 toggleDevTools（开/关开发者工具）。
- AC-12：自动化测试通过：DAO 查询/删除单测（筛选组合、分页边界、批量删除）、IPC 注册与窗口逻辑单测、记录页组件测试（列表渲染、展开折叠、勾选批删、确认弹窗、空状态、筛选交互）。

## 3. 实现方案

### 3.1 接口与函数签名

**packages/shared/src/index.ts（只放契约不放实现）**

```ts
export const IPC = {
  // ...既有通道不变，新增：
  captureList: 'capture:list',        // invoke：分页查询记录
  captureDelete: 'capture:delete',    // invoke：删除记录（单删/批删统一）
  consoleOpen: 'console:open',        // send：请求打开/聚焦后台窗口
} as const;

/** 记录查询入参（对象化，为 M4 类型维度留扩展位） */
export interface QueryCapturesPayload {
  keyword?: string;   // 包含匹配（LIKE '%kw%'），缺省不过滤
  since?: string;     // ISO 8601 起始时间（含），缺省不过滤；本地时区起算由调用方换算
  until?: string;     // ISO 8601 结束时间（含该秒），缺省不过滤；2026-10-16 变更对齐新增
  page: number;       // 1 起
  pageSize: number;   // 每页条数；2026-10-16 变更对齐后由记录页分页条提供 10/20/50/100 选择，默认 20
}

export interface QueryCapturesResult {
  items: CaptureRecord[];  // 复用既有 CaptureRecord
  total: number;           // 同条件 COUNT(*)，供分页计算
}

/** 删除载荷：单删 = 单元素数组 */
export interface DeleteCapturesPayload {
  ids: number[];
}
```

**packages/ai/src/dao/captureDao.ts（数据层，主进程仅经此读写）**

```ts
export function queryCaptures(
  input: QueryCapturesPayload,
): QueryCapturesResult;
// ORDER BY created_at DESC, id DESC；keyword 走参数化 LIKE；total 用同条件 COUNT(*)。

export function deleteCaptures(ids: number[]): void;
// DELETE WHERE id IN (...)，单事务；单删 = deleteCaptures([id])。
// 旧 deleteCapture(id) 移除：当前唯一调用方是自身测试，统一为 deleteCaptures 并同步更新。
// listCaptures 保留不动（无筛选的整表场景与既有测试复用）。
```

**apps/desktop/src/main/（窗口与 IPC）**

```ts
// windows/consoleWindow.ts
export function openConsoleWindow(): BrowserWindow;
// 幂等：已存在则 focus + 恢复；被关闭后重建（closed 事件清引用）。

// windows/petWindow.ts —— 治理：导出注册函数，create 不再注册 IPC
export function registerPetWindowIpc(): void;   // 内部 removeAllListeners + on(petClicked) 转发
// windows/inputWindow.ts —— 治理：同理
export function registerInputWindowIpc(): void; // on(inputBlur) 抑制收起 + on(inputClose) 直接收起

// ipc/captureHandlers.ts
export function registerCaptureHandlers(): void;
// 新增 handle(IPC.captureList) → queryCaptures；handle(IPC.captureDelete) → deleteCaptures

// ipc/consoleHandlers.ts（新建）
export function registerConsoleHandlers(): void;  // on(IPC.consoleOpen) → openConsoleWindow()

// ipc/registerIpc.ts —— 唯一汇总点
export function registerIpc(): void;
// 依次调用 registerCaptureHandlers / registerConsoleHandlers /
// registerPetWindowIpc / registerInputWindowIpc
```

**apps/desktop/src/preload/index.ts**

```ts
export interface ShiguangApi {
  capture: {
    create(payload: CreateCapturePayload): Promise<CaptureRecord>;
    list(payload: QueryCapturesPayload): Promise<QueryCapturesResult>;   // 新增
    delete(payload: DeleteCapturesPayload): Promise<void>;               // 新增
  };
  console: {
    open(): void;   // 新增：send console:open
  };
  // input / pet 分组不变
}
```

### 3.2 关键数据结构

- **records 表不变**：id / text / source_app / created_at，既有索引 `idx_records_created_at`（created_at DESC）支撑倒序查询，迁移零改动。
- **时间口径**：created_at 为 UTC ISO 8601（`strftime('%Y-%m-%dT%H:%M:%fZ','now')` 写入）；「今天/最近7天/最近30天」由 renderer 按本地时区计算当日零点等边界，换算为 ISO 字符串传给 `since`；列表展示的存入时间由 renderer 格式化为本地时区显示串。
- **分页口径**：`page` 从 1 起；DAO 内 `LIMIT pageSize OFFSET (page-1)*pageSize`；`total` 为同条件 `COUNT(*)`。
- **组件状态**（记录页）：`{ keyword, preset: 'all'|'today'|'7d'|'30d', page, expandedId, selectedIds, confirm: null|'single'|'batch', toast }`；筛选/关键词变化时 page 重置为 1。
- **空状态三元**：空库（total===0 且无筛选条件）→ 入库引导文案；筛选无结果（有条件但 items 空）→ 调整筛选引导文案；删除后当前页空 → 回退逻辑兜底。

### 3.3 关键骨架（必须按此实现）

1. 窗口创建幂等 + `closed` 清引用沿用现有窗口模块约定；console 入口只发信号（`console:open`），不做显隐状态判断（renderer 无窗口状态）。
2. consoleWindow 是普通系统窗口：不设 frame:false / transparent / alwaysOnTop / skipTaskbar；可最小化；不隐藏 Dock。
3. 所有新 IPC 通道先定义 shared 常量与 payload 类型，preload 只依赖 shared，handler 只从 shared 取常量——禁止散落字符串。
4. 单删与批删统一走 `deleteCaptures`，DAO 层不出现两条删除路径。
5. `registerIpc()` 是唯一汇总点：窗口模块导出 `registerXxxWindowIpc()`，`createXxxWindow()` 内不得出现 `ipcMain`。
6. 分页由 DAO 完成（LIMIT/OFFSET），renderer 永不拉全量。
7. 删除走查后的页回退在确认成功的响应里处理：若当前页 items 删空且 page>1 → page-1 重新查询。

### 3.4 数据流 / 状态变更

```
【打开后台】
输入框点「打开后台」 → window.api.console.open()
  → ipcRenderer.send('console:open')
  → 主进程 openConsoleWindow()：已存在 → focus/restore；不存在 → 创建 + 加载 console/console.html

【查询列表】
记录页挂载/翻页/改筛选 → window.api.capture.list({keyword?, since?, page, pageSize:20})
  → handle('capture:list') → queryCaptures() → { items, total }
  → 渲染列表；total 计算页数；items 空时按空状态三元渲染

【删除（单/批同构）】
点删除（单条或勾选批量）→ 二次确认弹窗（批量显示「已选 N 条」）
  → 确认 → window.api.capture.delete({ids})
  → handle('capture:delete') → deleteCaptures(ids)
  → 本地移除 selectedIds；若当前页删空且 page>1 → page-1 重新查询；操作栏隐藏

【IPC 治理后的注册装配】
app ready → registerIpc()
  ├─ registerCaptureHandlers()   // capture:create / capture:list / capture:delete
  ├─ registerConsoleHandlers()   // console:open
  ├─ registerPetWindowIpc()      // pet:clicked 转发协调回调（原 petWindow.ts 内注册）
  └─ registerInputWindowIpc()    // input:blur（抑制收起）/ input:close（直接收起）
```

### 3.5 技术决策

1. **后台走第三个独立 BrowserWindow + 第三个 renderer 入口**：与既有双窗（frameless + transparent + alwaysOnTop）形态完全不同，普通系统窗口按独立窗口模块处理，沿用窗口管理既定基线（幂等创建、closed 清引用、主进程集中状态）。备选：输入框内嵌后台面板——舍弃：形态冲突（浮窗 vs 常驻工作窗口），职责混杂。
2. **入口为信号通道而非状态通道**：renderer 只发 `console:open`，主进程全权决定打开/聚焦。备选：renderer 查询窗口状态再决定——舍弃：renderer 拿不到可信窗口状态，徒增往返。
3. **`queryCaptures` 入参对象化**：`{keyword?, since?, page, pageSize}` 为 M4 类型维度留扩展位，避免位置参数加维度时签名推倒重来（proposal 第 3 节建议）。
4. **搜索用 LIKE 参数化包含匹配，不引 FTS5**：产品定位（个人记录回看）下数万条记录 LIKE 走 created_at DESC 索引扫已够用；出现真实卡顿再升级 FTS5 虚拟表，对 DAO 接口透明。备选：M2 即建 FTS5——舍弃：过度设计 + 双写维护成本。
5. **单删/批删统一 `deleteCaptures`**：单删=单元素数组，删除路径唯一；旧 `deleteCapture` 无生产调用方（仅自身测试），移除并同步测试引用。备选：保留两个导出——舍弃：语义重复，接口面膨胀。
6. **IPC 治理用「窗口模块导出注册函数 + registerIpc 汇总」**：保持各窗口的 listener 上下文（blur 抑制、协调回调）在其模块内，`registerIpc` 只做装配，行为零变化。备选：listener 全部搬进 registerIpc——舍弃：破坏模块内聚，抑制状态等模块私有状态被外提。
7. **开发者工具走后台窗口右键 contextmenu toggleDevTools**：落实 pet 文档既定计划（唤出入口放右键 contextmenu），覆盖首个真实界面窗口；输入框/宠物窗维持现状不动。
8. **UI 复用既有基线**：Tailwind + shadcn 自写 primitives（`renderer/components/ui/`、cn()+cva、相对路径、无 @ 别名）；「设置」页仅空占位 + TODO，为 M3/M9 留位。
9. **复制反馈用轻提示（toast 类自写 primitive）**：复制成功瞬时反馈，不引第三方通知库。
10. **时间预设由 renderer 换算本地时区边界**：DAO 只认 ISO `since`，时区语义集中在展示层，与「存入时间本地时区格式化显示」同层处理。
11. **时间区间精确到秒，表单引擎驱动（2026-10-16 三次对齐定型）**：筛选区（keyword + 时间区间）由 TanStack Form 驱动，与输入框 capture-form 同一引擎；自写 `RangeTimePicker` 为受控字段组件（起/止 `datetime-local step={1}` + 清空，always 可见），**时间值唯一来源为选择器本身**；快捷预设是「给选择器赋值并触发查询」的快捷键——今天=[今日 00:00, 当前时刻]、7d/30d=[对应起点, 当前时刻]、全部=清空起止，不存在独立预设状态；起止按本地时区换算 ISO 传 `since`/`until`；DAO 侧 `until`（`created_at <= ?`，含边界秒）。不用第三方日期组件——保持零新增依赖，样式由 Tailwind 统一。
12. **pageSize 可配（2026-10-16 变更对齐）**：分页条提供 10/20/50/100 选择，默认 20，切换重置回第 1 页；查询载荷本就含 pageSize，DAO 零改动。
13. **后台入口图标用 LayoutDashboard（2026-10-16 变更对齐）**：仪表盘语义最贴近「管理后台」，替换 M2 初版的 AppWindow。

### 3.6 风险 / 取舍

- [风险] LIKE 包含匹配在数据量很大（数万条以上）时可能变慢 → 缓解：分页限制每页 20 条 + created_at DESC 索引扫；真出现卡顿再上 FTS5，对 DAO 接口透明（已对齐取舍）。
- [取舍] `listCaptures` 与 `queryCaptures` 并存（前者服务无筛选整表场景与既有测试）→ 接受：不动 M1 既有导出，避免波及无关引用方；后续迭代可再收敛。
- [风险] IPC 注册位置迁移（窗口模块 → registerIpc）可能漏接 listener → 缓解：显隐协调行为全部有手动 AC 走查（AC-1/AC-10），宠物单击 toggle、blur 抑制、✓ 后收起三条路径逐一回归。
- [取舍] 删除无软删除/回收站 → 接受：产品决策（proposal 已对齐二次确认兜底），M9 导出前如有需要再评估。

### 3.7 技术债务

- 治理后 window-management 文档中「IPC 注册分散」一条应销项（tasks 收尾时同步更新 `.rail/docs/window-management/README.md` 勾选）。
- pet 文档「开发者工具入口收敛」一条随本迭代落地部分销项（后台窗已覆盖；输入框/宠物窗 devtools 入口维持现状，如后续需要再补）。

### 3.8 影响文件清单

**packages/shared/**
- `src/index.ts`：IPC 新增 captureList / captureDelete / consoleOpen；QueryCapturesPayload / QueryCapturesResult / DeleteCapturesPayload 类型

**packages/ai/**
- `src/dao/captureDao.ts`：新增 queryCaptures / deleteCaptures；移除 deleteCapture（调用方仅测试）
- `src/index.ts`：导出同步（deleteCaptures / queryCaptures 增补，deleteCapture 移除）
- `src/dao/captureDao.test.ts`：删除测试改走 deleteCaptures；新增 queryCaptures 筛选组合/分页边界测试

**apps/desktop 主进程**
- `electron.vite.config.ts`：renderer input 增加 console 入口（`console/console.html`）
- `src/main/windows/consoleWindow.ts`（新建）：openConsoleWindow + contextmenu toggleDevTools
- `src/main/windows/petWindow.ts`：导出 registerPetWindowIpc，create 内移除 IPC 注册
- `src/main/windows/inputWindow.ts`：导出 registerInputWindowIpc，create 内移除 IPC 注册
- `src/main/ipc/captureHandlers.ts`：增 capture:list / capture:delete 两个 handle
- `src/main/ipc/consoleHandlers.ts`（新建）：console:open 注册
- `src/main/ipc/registerIpc.ts`：汇总调用四个注册函数
- `src/main/index.ts`：app ready 装配保持不变（registerIpc 已涵盖新增项，视 console 是否随启动创建而定——不随启动创建，由 console:open 惰性创建）

**apps/desktop preload**
- `src/preload/index.ts`：ShiguangApi 增 capture.list / capture.delete / console.open
- `src/renderer/env.d.ts`：无需改动（类型跟随 ShiguangApi 导入），确认即可

**apps/desktop renderer**
- `src/renderer/console/console.html`（新建）：第三入口 HTML
- `src/renderer/console/main.tsx`（新建）：React 挂载
- `src/renderer/console/App.tsx`（新建）：左右布局装配（导航 + 内容区）
- `src/renderer/console/components/SideNav.tsx`（新建）：「记录」/「设置」导航
- `src/renderer/console/pages/RecordsPage.tsx`（新建）：记录页主组件
- `src/renderer/console/pages/SettingsPage.tsx`（新建）：空占位 + TODO
- `src/renderer/components/ui/`：按需新增自写 primitives（checkbox、dialog、toast 轻提示等）
- `src/renderer/input/App.tsx`：新增「打开后台」按钮（调用 window.api.console.open()）

**.rail/docs/**
- `window-management/README.md`：IPC 注册分散债务销项
- `pet/README.md`：开发者工具入口债务部分销项更新

## 4. 回滚条件

- 后台窗口作为普通系统窗口与宠物/输入框浮窗共存出现不可调和的系统性问题（如焦点互相劫持、alwaysOnTop 串扰导致输入框无法唤出），且无法在迭代内修复。
- `deleteCapture` 移除后发现 M1 之外的隐藏依赖方（生产代码路径），统一迁移无法在迭代内完成。
- IPC 注册收敛后宠物单击 toggle / blur 抑制行为回归且根因无法快速定位（此时回退治理改动、保留新通道先行交付）。
