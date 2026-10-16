# Proposal: M1 桌面宠物手动输入入库（m1-pet-capture-input）

## 1. 背景与动机

拾光（ShiGuang）是一个本地优先的个人 AI 第二大脑项目（Electron + React + pnpm workspaces monorepo）。M0 骨架与数据层已完成；M1 是首个实质迭代，本次为 M1 的「手动输入入库」方向。

此前 M1 曾规划「全局热键 + 模拟复制」捕获方案（change 包 `m1-capture-ingest`），因交互方向变更已整体作废并标记 superseded（旧代码已移除，含 uiohook-napi 依赖）。新方向经三节点对齐确定为：**桌面宠物（Hooper，idle 动效）+ 输入框窗口 + SQLite 入库**的完整闭环，纯文字、零 AI。

用户明确的产品原则：**先健全信息收集能力，AI 全部后置**（M5 才开始分析流水线）。

当前状态：数据层已就绪（`packages/ai` 的 records 表、umzug 迁移、captureDao，7 个测试全绿）；但 `apps/desktop` 仍是无窗口无头形态（仅 dotenv → initDatabase → app.dock.hide()），无窗口/托盘/IPC/preload，renderer 为空占位（React 18 在 devDependencies 但未接入口）。本次需在 desktop 包内补齐桌面宠物窗口、输入框窗口、托盘、IPC/preload 全链路，并接入已就绪的数据层。

范围对应 `docs/REQUIREMENTS.md`：REQ-CAP-02（手动输入）、REQ-CAP-05（桌面宠物交互）、REQ-STORE-01（本地持久化）、REQ-TOOL-01（通用工具查库指路）、REQ-DX-02（pnpm dev 一键起）。素材方面：webp 精灵图整图已入仓 `apps/desktop/src/renderer/assets/pet/pet-sprites.webp`，源文件来自用户提供的 Downloads/0832-hooper（内含 pet.json，displayName "Hooper"），精灵图共 9 行动效，M1 运行时只使用第 1 行 idle 帧。

## 2. 需求与范围

### 功能描述

构建拾光 M1「手动输入入库」闭环：

1. **桌面宠物**：idle 动效角色（Hooper）默认停靠屏幕右下角，idle 帧循环播放；可按住拖动换位置，但不记忆（每次启动回默认位）；单击唤出输入框；系统托盘图标提供退出入口。
2. **输入框**：在宠物旁边弹出；确认入库后输入框内显示"✓ 已拾光"轻提示 1~2 秒后自动收起；Esc、失焦/点击空白处均可收起；输入框打开时再单击宠物 = toggle 收起。
3. **内容规则**：仅文字；上限 5000 字，输入时拦截（到上限无法继续输入），实时字数统计（如 4232/5000）；字数统计口径不做特殊处理（随 textarea 原生 maxlength 行为，emoji 不单独计数）；零长度内容确认按钮禁用（全空格/换行视为有内容，可入库，用户明确选择"仅拦截零长度"）；粘贴图片/文件时提示"暂不支持"。
4. **入库**：确认后经 IPC 调主进程，主进程复用 `packages/ai` 的 captureDao.createCapture 写入 records 表（text + sourceApp(null) + created_at 自动时间戳）。
5. **点击与拖动的分工**：按住拖动 = 移动宠物；未拖动释放的单击 = 唤出/收起输入框。

### 范围边界

**本次做：**

- 桌面宠物窗口：透明无边框窗口承载 Hooper idle 动效（webp 精灵图第 1 行），默认右下角，可拖动换位（不持久化），单击唤出/收起输入框（toggle）。
- 输入框窗口：宠物旁弹出；5000 字上限输入时拦截（textarea 原生 maxlength）+ 实时字数统计；零长度禁提交；粘贴图片/文件提示"暂不支持"；确认后"✓ 已拾光"轻提示 1~2 秒自动收起；Esc/失焦/点击空白处收起。
- 入库链路：renderer 经 IPC → 主进程 → `packages/ai` captureDao.createCapture 写 records 表。
- 系统托盘：提供退出应用入口。
- 技术债顺手清理：`electron.vite.config.ts` external 残留 uiohook-napi（旧热键方案死配置）；`vitest.config.ts` 注释残留"osascript 副作用"表述。
- README 指路：db 位置 + DB Browser for SQLite / TablePlus 推荐（REQ-TOOL-01）。
- `pnpm dev` 一键起（REQ-DX-02）。

**本次不做（明确排除）：**

- AI 分析 / LLM 调用（M5）。
- 历史查看 UI（M2）。
- 全局热键、剪贴板监听（旧方案已废弃）。
- 图片/文件入库（粘贴时仅提示"暂不支持"）。
- 多显示器适配（本次仅主屏右下角，M3 再评估）。
- 宠物表情状态机（点击反馈/提醒表情；不预留状态机结构，后续按需启用精灵图其余 8 行）。
- 宠物位置记忆持久化（M3 开机自启时重新评估）。
- 开机自启、关窗常驻（M3 REQ-APP-01）。

### 边缘场景处理（已对齐）

| 场景 | 处理方式 |
| --- | --- |
| 重复提交 | 确认后立即进入 loading 状态阻止进一步点击，直到"✓ 已拾光"反馈结束、窗口收起 |
| 输入框打开时拖动宠物 | 拖动即收起输入框（输入框不跟随） |
| 输入框打开时再点宠物 | toggle 收起输入框 |
| 空白内容（全空格/换行） | 仅拦截零长度字符串；trim 后空白内容允许入库（已知可接受项） |
| 超长内容 | 输入时拦截，不可粘贴超过 5000 字（textarea maxlength 原生行为） |
| 粘贴图片/文件 | 提示"暂不支持"，不入库 |

### 验收标准

- REQ-CAP-05：宠物默认右下角出现，idle 动效循环；可拖动；单击唤出输入框；托盘可退出应用。
- REQ-CAP-02：输入框内粘贴编辑文字，确认入库（5000 字输入拦截 + 字数统计；零长度禁提交；图片/文件提示"暂不支持"）；确认后"✓ 已拾光"轻提示 1~2 秒自动收起；Esc/失焦收起。
- REQ-STORE-01：重启应用后数据仍在（records 表）。
- REQ-TOOL-01：README 指路 DB Browser / TablePlus 可查。
- REQ-DX-02：`pnpm dev` 一键起。
- 回归基线：`pnpm typecheck`（递归 tsc --noEmit）与 `pnpm --filter @shiguang/ai test`（7 测试）保持全绿。

## 3. 未来场景与扩展预判

- **多显示器适配**：本次仅主屏右下角。建议应对方向：M3 评估开机自启时一并处理多屏停靠逻辑（如记住最后所在屏幕或按活动屏幕弹出输入框）。
- **宠物表情状态机（点击反馈/提醒表情）**：本次不预留状态机结构。建议应对方向：后续迭代按需启用精灵图其余 8 行动效（走路、哭、表情等），届时再引入轻量状态机；当前 pet.json 与整图入仓已为该扩展留好素材基础。
- **宠物位置记忆**：本次不持久化。建议应对方向：M3 开机自启场景下重新评估——若用户期望"宠物一直在老位置"，再引入位置持久化（存储坐标到设置文件或 SQLite）。
- **输入内容类型扩展（图片/文件/富文本）**：本次仅文字，粘贴图片/文件提示"暂不支持"。建议应对方向：复用 records 表已有的 `source_app` 等字段模式，M4 前后按需扩展类型字段与附件存储（图片存文件系统、库存路径，延续 README 既有架构决策）。

## 4. 相关引用

- `docs/REQUIREMENTS.md` —— 需求唯一事实来源；本次范围对应 REQ-CAP-02、REQ-CAP-05、REQ-STORE-01、REQ-TOOL-01、REQ-DX-02（含 M1 交互细节与变更记录，已同步更新）
- `apps/desktop/src/renderer/assets/pet/pet-sprites.webp` —— Hooper 精灵图整图（9 行动效，M1 仅用第 1 行 idle 帧）；源文件来自用户提供的 Downloads/0832-hooper（内含 pet.json，displayName "Hooper"）
- `packages/ai/` —— 数据层：records 表（id/text/source_app/created_at，索引 idx_records_created_at）、umzug 迁移、captureDao（setCaptureDatabase/createCapture/listCaptures/deleteCapture）；`pnpm --filter @shiguang/ai test` 7 测试全绿
- `apps/desktop/src/main/index.ts` —— 主进程现状：仅无头初始化（dotenv → initDatabase → app.dock.hide()），无窗口/托盘/IPC/preload
- `apps/desktop/src/renderer/index.html` —— renderer 空占位；React 18 在 devDependencies 但未接入口
- `apps/desktop/electron.vite.config.ts` —— 仅 main+renderer 双入口、无 preload 配置；external 残留 uiohook-napi（本次顺手清理）
- `apps/desktop/vitest.config.ts` —— 注释残留"osascript 副作用"表述（本次顺手清理）
- `apps/desktop/electron-builder.yml` —— 无资源拷贝配置（精灵图等资源配置需补齐）
- `packages/shared/` —— 仅有 CaptureRecord 类型，IPC 契约可在此扩展
- `.rail/changes/m1-capture-ingest/proposal.md` —— 已 superseded 的旧热键方案，仅历史参考
