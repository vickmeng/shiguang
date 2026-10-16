# 输入框 / 表单（手动捕获入库）

## 设计决策

- **表单引擎选 TanStack Form、明确不引 zod**：TanStack Form 自带函数式校验 + textarea 原生 `maxlength=5000` 双层约束；字数统计口径随原生 maxlength（emoji 不单独计数）；零长度判 `value.length === 0` 不 trim，全空格/换行允许入库（用户明确决策「仅拦截零长度」）。
- **键盘零自定义拦截**：不监听 keydown 做提交快捷键，textarea 原生 Enter 换行、提交走按钮；Esc 收起是窗口级行为，由容器监听发 `input:close`。
- **blur 时序教训（本次评审 blocker）**：textarea `onBlur` 抢跑 click——点击「拾光」按钮时 mousedown 先触发 blur，若 blur 同步收起窗口则 click 永远落不到按钮，鼠标提交路径不可达。收起信号必须由主进程窗口级原生 blur 事件承担（焦点离开整个输入框窗口才触发），renderer 的 textarea 不得再调 `input.blur()`。

## 技术债务

- [ ] preload `input.blur()` API 已成为预留死代码（组件不再调用，仅主进程窗口级 blur 承担收起）
- [ ] 全空格/换行内容可入库（用户决策，已知可接受项；若 M2 查询页出现噪声再评估）
- [ ] 图片/文件粘贴仅提示「暂不支持」（M4 前后按需扩展类型字段与附件存储，复用 records 表 source_app 模式）
