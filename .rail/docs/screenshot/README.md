# 区域截图（screenshot）— 已废弃归档

> **本领域功能已于 m4-graphic-capture 整体删除（REQ-CAP-03 废弃，2026-10-20 二轮对齐）**：应用内截图（electron-snapora 装配、`screenshot:save/fail/done` 三通道、📷 按钮、宠物窗 onDone 订阅）全部移除，截图场景改由「系统截图（Shift+Cmd+Ctrl+4）/ 微信截图 + Cmd+V 粘贴进输入框」承接。收益：拾光零屏幕录制权限依赖，消除 snapora 全部技术债务（单人维护/0 star/包龄短/macOS 签名验证）。
>
> 存活的架构决策已迁移，本文件不再维护：
> - 图片存储管道（attachments 表、迁移 0002、删除级联、`shiguang-image://` protocol）→ `records-console/README.md`
> - 图片写盘编排（`writeImageFiles` 先全写盘才入库）→ `capture-input/README.md`
> - 截图入口在输入框工具栏（📷 按钮）的取舍教训、宠物右键直接 toggle → `window-management/README.md`
