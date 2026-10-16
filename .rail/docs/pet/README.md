# 桌面宠物（pet）

## 设计决策

- **动画状态机三层黑盒（sprite 渲染 / animations 数据注册表 / stateMachine 规则）**：选 ~60 行手写纯 TS 不引 Pixi 的状态机，不选 xstate——M1 仅 idle 一个状态，xstate 过重且手写版天然可 vitest 单测。对外唯一口子 `play(state, opts?)`，宠物不关心业务、使用层决定何时播什么。
- **扩展示例路径（M8 表情）**：新动效 = ANIMATIONS 注册表加一行 + 状态机优先级规则加一条 + 主进程发 `pet:set-state`，三处增量零重构；`pet:set-state` 已留 IPC 口子（M1 渲染端监听、主端不发送）。
- **渲染缩放 0.5**：精灵帧 192×208 按 SCALE 0.5 渲染为 96×104，在 128×104 内容宽度中水平居中（左右各留 16px），桌面常驻视觉尺寸约为原素材一半。
- **规则层不 import Pixi**：stateMachine 与 animations 为纯 TS，可脱离渲染环境单测，渲染层只通过 `onChange` 回调驱动精灵切换。

## 技术债务

- [ ] `-webkit-app-region: drag` 区域单击可能被系统偶发吞掉，导致单击唤出失效（预案：双击唤出或留 no-drag 可点热区，已备但不预防性实现，问题复现再启用）
- [ ] 精灵图 9 行动效仅注册第 1 行 idle（row 0, 5 帧, fps 8, loop），其余 8 行动效素材已入仓未注册，M8 按需启用
- [ ] 宠物拖动位置不持久化（M3 开机自启场景重新评估坐标持久化）
- [x] 开发者工具入口收敛到下个迭代的真实界面窗口：主窗菜单加「开发者工具」项，覆盖主窗（attach）、输入框（detach，`Option+Cmd+I` 手动可用）、宠物（detach，`focusable:false` 只能代码 `openDevTools()` 开）。已确诊：`-webkit-app-region: drag` 区域 macOS 真实输入下零 DOM 事件，唤出入口放右键 contextmenu；左键拖动保留 OS 原生手感——M2 已落地后台窗右键 contextmenu toggle DevTools，输入框/宠物窗维持现状
