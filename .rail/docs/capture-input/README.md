# 输入框 / 表单（手动捕获入库）

## 设计决策

- **表单引擎选 TanStack Form、明确不引 zod**：TanStack Form 自带函数式校验 + textarea 原生 `maxlength=5000` 双层约束；字数统计口径随原生 maxlength（emoji 不单独计数）；零长度判 `value.length === 0` 不 trim，全空格/换行允许入库（用户明确决策「仅拦截零长度」）。
- **键盘零自定义拦截**：不监听 keydown 做提交快捷键，textarea 原生 Enter 换行、提交走按钮；Esc 收起是窗口级行为，由容器监听发 `input:close`。
- **`source_app` 语义从「来源应用」扩展为「来源通道」**（M4）：手动输入恒 `null`，截图入库恒 `'screenshot'`——字段不做严格枚举，语义由写入方约定；M6+ 新来源沿用同一模式。
- **blur 时序教训（本次评审 blocker）**：textarea `onBlur` 抢跑 click——点击「拾光」按钮时 mousedown 先触发 blur，若 blur 同步收起窗口则 click 永远落不到按钮，鼠标提交路径不可达。收起信号必须由主进程窗口级原生 blur 事件承担（焦点离开整个输入框窗口才触发），renderer 的 textarea 不得再调 `input.blur()`。

## 技术债务

- [ ] preload `input.blur()` API 已成为预留死代码（组件不再调用，仅主进程窗口级 blur 承担收起）
- [ ] 全空格/换行内容可入库（用户决策，已知可接受项；若 M2 查询页出现噪声再评估）
- [ ] 图片/文件粘贴仍仅提示「暂不支持」——M4 截图与粘贴是独立入口，粘贴通道未动；若未来启用粘贴，复用 records + attachments 两表与 `source_app` 通道模式即可
