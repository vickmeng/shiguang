---
slug: m2-records-console
derived_from: .rail/changes/m2-records-console/design.md
---

# Tasks — m2-records-console

## 实现任务

### packages/shared

- [x] 任务 1：在 `packages/shared/src/index.ts` 的 `IPC` 常量中新增 `captureList: 'capture:list'`、`captureDelete: 'capture:delete'`、`consoleOpen: 'console:open'` 三个通道，并新增导出 `QueryCapturesPayload`、`QueryCapturesResult`（复用既有 `CaptureRecord`）、`DeleteCapturesPayload` 三个类型。
  - **前置条件**：无
  - **对应验收标准**：AC-10
  - **关键契约**：
    ```ts
    export interface QueryCapturesPayload { keyword?: string; since?: string; page: number; pageSize: number }
    export interface QueryCapturesResult { items: CaptureRecord[]; total: number }
    export interface DeleteCapturesPayload { ids: number[] }
    ```

### packages/ai

- [x] 任务 2：在 `packages/ai/src/dao/captureDao.ts` 实现 `queryCaptures(input)`：按 `created_at DESC, id DESC` 排序，`keyword` 走参数化 `LIKE '%?%'` 包含匹配，`since` 走 `created_at >= ?`，`page`/`pageSize` 换算 `LIMIT ? OFFSET ?`；`total` 用同条件 `COUNT(*)` 查询；返回 `{ items, total }`。
  - **前置条件**：`[1]`
  - **对应验收标准**：AC-3、AC-8
  - **关键契约**：`export function queryCaptures(input: QueryCapturesPayload): QueryCapturesResult`
  - 先写测试（TDD）：`captureDao.test.ts` 用内存库覆盖——关键词筛选、时间筛选、关键词+时间组合、分页边界（末页不满、越界页返回空 items）、total 正确。

- [x] 任务 3：在 `captureDao.ts` 实现 `deleteCaptures(ids)`：单事务 `DELETE FROM records WHERE id IN (...)`（占位符按 ids 长度展开），ids 为空数组时不执行删除、不抛错。
  - **前置条件**：`[2]`
  - **对应验收标准**：AC-6
  - **关键契约**：`export function deleteCaptures(ids: number[]): void`
  - 先写测试（TDD）：覆盖批量删除只删指定 id、空数组不抛错。

- [x] 任务 4：移除 `captureDao.ts` 的旧导出 `deleteCapture(id)`，同步更新 `packages/ai/src/index.ts` 的再导出清单，并把 `captureDao.test.ts` 中既有 `deleteCapture` 引用全部改为 `deleteCaptures([id])`；`listCaptures` 保留不动。
  - **前置条件**：`[3]`
  - **对应验收标准**：AC-10
  - 改前用全仓搜索确认 `deleteCapture` 无生产调用方（M1 验证过仅测试引用）；`pnpm --filter @shiguang/ai test` 全绿。

### apps/desktop 主进程（IPC / preload）

- [x] 任务 5：在 `apps/desktop/src/main/ipc/captureHandlers.ts` 的 `registerCaptureHandlers()` 中新增两个 handle 通道：`ipcMain.handle(IPC.captureList, (_e, payload: QueryCapturesPayload) => queryCaptures(payload))` 与 `ipcMain.handle(IPC.captureDelete, (_e, payload: DeleteCapturesPayload) => deleteCaptures(payload.ids))`。
  - **前置条件**：`[2, 3]`
  - **对应验收标准**：AC-10
  - 通道常量与 payload 类型一律从 `@shiguang/shared` 导入，禁止字面量字符串。

- [x] 任务 6：新建 `apps/desktop/src/main/windows/consoleWindow.ts`，导出 `openConsoleWindow(): BrowserWindow`：已存在且未销毁则 `focus()`+`restore()` 并返回；否则创建普通系统窗口（frame 保留、resizable、width 960、height 640、非 alwaysOnTop、非 transparent、不 skipTaskbar、不 focusable:false、不隐藏 Dock），`show:false` 创建后 `show()` 并聚焦，`closed` 事件清模块引用；加载路径沿用双路径约定（dev 走 `ELECTRON_RENDERER_URL` 的 `/console/console.html`，打包态 `loadFile(out/renderer/console/console.html)`）。
  - **前置条件**：`[1]`
  - **对应验收标准**：AC-1、AC-2
  - 幂等语义与 `closed` 清引用约定对齐 `petWindow.ts`/`inputWindow.ts` 现有写法；窗口行为以手动走查为主。

- [x] 任务 7：新建 `apps/desktop/src/main/ipc/consoleHandlers.ts`，导出 `registerConsoleHandlers(): void`，内部 `ipcMain.removeAllListeners(IPC.consoleOpen)` + `ipcMain.on(IPC.consoleOpen, () => { openConsoleWindow(); })`。
  - **前置条件**：`[6]`
  - **对应验收标准**：AC-1

- [x] 任务 8：治理 `apps/desktop/src/main/windows/petWindow.ts`：将 create 函数内的 `ipcMain.removeAllListeners(IPC.petClicked)` + `ipcMain.on(...)` 块原样搬入新导出的 `registerPetWindowIpc(): void`，create 函数不再出现 `ipcMain`（转发逻辑——遍历 `petClickedListeners` 回调——保持不变）。
  - **前置条件**：无
  - **对应验收标准**：AC-10

- [x] 任务 9：治理 `apps/desktop/src/main/windows/inputWindow.ts`：将 create 函数内的 `input:blur`（`hideWithSuppress`）与 `input:close`（`hide`）两个 listener 注册块原样搬入新导出的 `registerInputWindowIpc(): void`，create 函数不再出现 `ipcMain`；blur 抑制语义（300ms）与 `input:close` 不抑制的行为一字不变。
  - **前置条件**：无
  - **对应验收标准**：AC-10

- [x] 任务 10：在 `apps/desktop/src/main/ipc/registerIpc.ts` 的 `registerIpc()` 中依次调用 `registerCaptureHandlers()`、`registerConsoleHandlers()`、`registerPetWindowIpc()`、`registerInputWindowIpc()` 四个注册函数；`apps/desktop/src/main/index.ts` 的 app ready 装配（createPetWindow → createTray → registerIpc → createInputWindow）保持不变，不随启动创建 console 窗口。
  - **前置条件**：`[5, 7, 8, 9]`
  - **对应验收标准**：AC-10

- [x] 任务 11：在 `apps/desktop/src/preload/index.ts` 扩展 `ShiguangApi`：`capture` 分组新增 `list(payload: QueryCapturesPayload): Promise<QueryCapturesResult>` 与 `delete(payload: DeleteCapturesPayload): Promise<void>`，新增 `console` 分组 `open(): void`；实现分别走 `ipcRenderer.invoke(IPC.captureList, payload)`、`ipcRenderer.invoke(IPC.captureDelete, payload)`、`ipcRenderer.send(IPC.consoleOpen)`；确认 `src/renderer/env.d.ts` 经 `ShiguangApi` 导入自动获得新类型、无需改动。
  - **前置条件**：`[1]`
  - **对应验收标准**：AC-1、AC-10

### apps/desktop 后台窗口骨架

- [x] 任务 12：在 `apps/desktop/electron.vite.config.ts` 的 renderer `rollupOptions.input` 增加第三个入口 `console: resolve(__dirname, 'src/renderer/console/console.html')`。
  - **前置条件**：无
  - **对应验收标准**：AC-1

- [x] 任务 13：新建后台入口三件套 `apps/desktop/src/renderer/console/console.html`、`main.tsx`、`App.tsx`：HTML 挂载 `#root`；main.tsx 按输入框入口同款方式挂载 React；App.tsx 实现左右布局（左侧固定宽导航栏 + 右侧内容区，Tailwind，整窗 h-screen），当前选中页状态用 `useState<'records'|'settings'>('records')` 管理。
  - **前置条件**：`[12]`
  - **对应验收标准**：AC-2

- [x] 任务 14：新建 `apps/desktop/src/renderer/console/components/SideNav.tsx`：渲染「记录」「设置」两个导航项，点击切换 `App.tsx` 下发的 `onSelect`；选中项高亮样式（沿用 Tailwind + cn()）；导航与路由结构一次成型，后续迭代只加项不改编排。
  - **前置条件**：`[13]`
  - **对应验收标准**：AC-9

- [x] 任务 15：新建 `apps/desktop/src/renderer/console/pages/SettingsPage.tsx`：空占位内容（标题「设置」+ 空态说明文案 + 行内 TODO 注释标记「M3 开机自启 / M9 导出等设置项在此填充」），不实现任何实际设置项。
  - **前置条件**：无
  - **对应验收标准**：AC-9

- [x] 任务 16：在 `apps/desktop/src/renderer/input/App.tsx` 新增「打开后台」按钮（`Button` ghost 变体 + 面板/窗口语义图标），点击调用 `window.api.console.open()`；按钮置于关闭按钮旁且不遮挡 textarea（装配层布局微调）。
  - **前置条件**：`[11]`
  - **对应验收标准**：AC-1
  - 宠物窗渲染端零改动；不加右键菜单。

### apps/desktop 记录页

- [x] 任务 17：新建 `apps/desktop/src/renderer/console/pages/RecordsPage.tsx` 骨架与列表渲染：挂载时调 `window.api.capture.list({ page: 1, pageSize: 20 })`；每条渲染常驻复选框（本任务先只渲染不接线勾选逻辑）、截断预览（多行截断，如 line-clamp-3）、存入时间（`createdAt` 用 `toLocaleString` 类本地时区格式化）；底部翻页控件按 `total` 计算页数；切换页码重新查询。
  - **前置条件**：`[11, 14]`
  - **对应验收标准**：AC-3
  - 先写组件测试（vitest+RTL，mock `window.api`）：首屏渲染 20 条以内、时间本地化显示、翻页触发对应 payload。

- [x] 任务 18：在 `RecordsPage.tsx` 实现行点击展开/折叠全文：维护 `expandedId` 状态，点击记录行切换——展开态显示完整 `text`（可换行全量展示），再次点击收起回截断预览。
  - **前置条件**：`[17]`
  - **对应验收标准**：AC-4
  - 组件测试：点击行展开显示全文、再点折叠。

- [x] 任务 19：在 `RecordsPage.tsx` 实现筛选区：关键词搜索框（受控输入，变更即重置 page=1 重新查询）+ 时间快捷预设四选（全部/今天/最近7天/最近30天，本地时区起算——today 取本日零点、7d/30d 取当前时刻往前推，换算 ISO 传 `since`，「全部」不传 since）；两个维度可组合。
  - **前置条件**：`[17]`
  - **对应验收标准**：AC-8
  - 组件测试：输入关键词与切换预设分别触发带正确 `keyword`/`since` 的 `capture.list` 调用。

- [x] 任务 20：在 `src/renderer/components/ui/` 新增自写 toast 轻提示 primitive（cn()+cva，相对路径引用，无 @ 别名），并在 `RecordsPage.tsx` 每条记录加复制按钮：点击将完整 `text` 写入剪贴板（`navigator.clipboard.writeText`）后弹出轻提示（自动消失，如 2s）。
  - **前置条件**：`[18]`
  - **对应验收标准**：AC-5
  - 组件测试：mock clipboard 断言写入内容、提示出现。

- [x] 任务 21：在 `src/renderer/components/ui/` 新增自写 dialog 确认弹窗 primitive（半透明遮罩 + 卡片 + 确认/取消按钮），并在 `RecordsPage.tsx` 实现单条删除：点删除按钮弹确认框，确认后调 `window.api.capture.delete({ ids: [id] })`；成功后处理页回退——当前页删空且 page>1 时 page-1 重新查询，否则当前页重新查询。
  - **前置条件**：`[20]`
  - **对应验收标准**：AC-6、AC-7
  - 组件测试：确认弹窗出现、确认触发 delete 调用、删空末页回退到前一页（mock total/items 边界）。

- [x] 任务 22：在 `RecordsPage.tsx` 实现勾选与批量删除：复选框维护 `selectedIds` 集合；勾选数 ≥1 时顶部浮现操作栏（已选 N 条 / 批量删除 / 取消，取消清空选择并隐藏）；点「批量删除」弹确认框、文案含条数「确认删除已选 N 条记录？」，确认后调 `window.api.capture.delete({ ids: [...selectedIds] })` 并走与任务 21 相同的成功回退与刷新逻辑。
  - **前置条件**：`[21]`
  - **对应验收标准**：AC-6
  - 组件测试：勾选多条浮现操作栏、批量确认弹窗显示条数、确认后清空选择并刷新。

- [x] 任务 23：在 `RecordsPage.tsx` 实现空状态三元渲染：空库（total===0 且无关键词/时间筛选）显示入库引导文案；有筛选条件但无结果显示调整筛选引导文案；列表区与文案样式用 Tailwind 自写，不引第三方空态组件。
  - **前置条件**：`[19]`
  - **对应验收标准**：AC-8
  - 组件测试：空库与筛选无结果两种文案分别断言。

### devtools 收敛与收尾

- [x] 任务 24：在 `apps/desktop/src/main/windows/consoleWindow.ts` 内为 console 窗口接线 `win.webContents.on('context-menu', () => { win.webContents.toggleDevTools(); })`，落实 pet 文档既定的「右键 contextmenu 唤出开发者工具」计划（仅后台窗口，输入框/宠物窗不动）。
  - **前置条件**：`[6]`
  - **对应验收标准**：AC-11
  - 手动验收：dev 态后台窗内右键开/关 DevTools。

- [x] 任务 25：同步技术债销项文档：`.rail/docs/window-management/README.md` 勾选「IPC 注册分散」一条（注明已收敛进 registerIpc）；`.rail/docs/pet/README.md` 更新「开发者工具入口收敛」一条（后台窗右键已落地，输入框/宠物窗维持现状）。
  - **前置条件**：`[10, 24]`
  - **对应验收标准**：AC-10、AC-11

- [x] 任务 26：回归走查与全量验证：① 宠物单击 toggle 输入框、输入框 blur 300ms 抑制、✓ 已拾光后主动收起三条既有路径无回归（AC-1/AC-10）；② 记录页全链路走查——分页倒序、展开折叠、复制、单删/批删二次确认与删光回退、组合筛选与空状态（AC-3~AC-8）；③ `pnpm typecheck` 三包通过、`pnpm --filter @shiguang/ai test` 与 desktop 组件/逻辑测试全绿（AC-12）。
  - 人工走查待办（不由任务勾选覆盖）：① 三条既有路径人工回归——宠物单击 toggle 输入框、输入框 blur 300ms 抑制、✓ 已拾光后主动收起；② 记录页全链路人工走查——分页倒序、展开折叠、复制、单删/批删二次确认与删光回退、组合筛选与空状态（AC-1 ~ AC-8）。
  - **前置条件**：`[16, 22, 23, 25]`
  - **对应验收标准**：AC-1 ~ AC-12

### 记录页增强（2026-10-16 变更对齐）

- [x] 任务 27：shared `QueryCapturesPayload` 新增 `until?: string`（ISO 8601 结束时间，含该秒）；DAO `queryCaptures` 支持 `until` 条件（`created_at <= ?`），可与 `since`/`keyword` 任意组合；`captureDao.test.ts` 补测试——until 单独过滤、until+keyword+since 三条件组合、边界值（created_at 恰等于 until 的记录被包含）。
  - **前置条件**：无（M2 基线已交付）
  - **对应验收标准**：AC-8 扩展（时间区间精确到秒）
  - 关键契约：`until?: string` 缺省不过滤

- [x] 任务 28：记录页增强——① 分页条新增 pageSize 选择（选项 10 / 20 / 50 / 100，默认 20，切换即重置 page=1 重新查询）；② 时间筛选预设新增「自定义」项：选中后显示起止两个 `<input type="datetime-local" step={1}>`（精确到时分秒），变更即重置 page=1 重查，按本地时区换算 ISO 传 `since`/`until`；清空自定义则回落当前预设；四快捷预设与自定义互斥切换。
  - **前置条件**：`[27]`
  - **对应验收标准**：AC-3 扩展（pageSize 可配）、AC-8 扩展
  - 先写组件测试（TDD）：pageSize 切换触发带新 pageSize 的查询并回第 1 页、自定义起止换算正确 ISO（含秒）、清空自定义回落预设、预设与自定义互斥。

- [x] 任务 29：输入框「打开后台」按钮图标由 `AppWindow` 更换为 `LayoutDashboard`（lucide-react），aria-label 不变；同步更新 `input/App.test.tsx` 中按图标的断言/引用（如有）。
  - **前置条件**：无
  - **对应验收标准**：AC-1

- [x] 任务 30：时间筛选布局重做（2026-10-16 二次对齐：时间区间选择器直接平铺筛选区，不做「自定义」收纳开关）——自写 `RangeTimePicker` primitive（`src/renderer/components/ui/range-time-picker.tsx`：起/止两个 `datetime-local`（`step={1}`）+ 清空按钮，always 可见）；预设 chips（全部/今天/7天/30天）保留；互斥语义——填任一区间输入即取消预设高亮并以区间为准，点预设即清空区间；清空区间后回落预设语义；变更均重置 page=1 重查。
  - **前置条件**：无（基于任务 28 已交付基线改造）
  - **对应验收标准**：AC-8 扩展（布局形态）
  - 先改/补组件测试（TDD）：区间输入默认直接可见（无需先点「自定义」）、填区间取消预设高亮且 payload 走 since/until、点预设清空区间、清空按钮回落预设语义。

- [x] 任务 31：筛选区接入 TanStack Form（2026-10-16 三次对齐）——筛选表单（keyword + 时间区间）由 `@tanstack/react-form` 驱动（与输入框 capture-form 同一引擎）；`RangeTimePicker` 改造为受表单控制的字段组件（value/onChange 受控），时间值唯一来源为选择器；快捷预设（全部/今天/7天/30天）语义改为「给选择器赋值并触发查询」——今天=[今日 00:00, 当前时刻]、7d/30d=[对应起点, 当前时刻]、全部=清空起止；移除独立预设状态，payload 一律从表单值换算（localDateTimeToISO）；page/pageSize 仍为组件状态，筛选变更重置 page=1。
  - **前置条件**：无（基于任务 30 已交付基线重构）
  - **对应验收标准**：AC-8 扩展（表单引擎驱动）
  - 先改/补组件测试（TDD）：预设点击后选择器回显对应值并触发带 since/until 的查询、「全部」清空选择器且不传 since/until、手动改选择器值触发查询、关键词与区间组合仍为同一表单 payload。
