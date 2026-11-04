# 个人设置共享：独立代码评审

日期：2026-11-04。执行者：独立开发工程师 Agent `/root/settings_review`；实现者为 `/root`。

评审基准：HEAD `7c674d93457d869f0d0da24b0a4dc0b59ee3653a` 上的未提交工作区。本次仅评审 `lib/personal-settings.mjs` 及 server、MCP、app、shell、account 中的共享个人设置改动，未评审工作区其他功能变更。已读取私人角色库 developer/ROLE.md 与 software-development/README.md；未执行 GitHub 写入、合并或发布。

## 结论

发现的两项问题均已由实现者修复并复核，当前评审范围没有遗留阻断项。此记录属于独立代码评审，不替代浏览器独立验收。

## 发现与修复复核

1. **MCP 今日饮水目标读取旧表（已修复）**：原 `get_today` 直接读取旧 `settings`，而新写入口写入 `personal_settings`。独立调用实际 `createMcp.handle`：`update_settings(waterGoalMl=3100)` 和 `get_settings` 返回 3100，`get_today.summary.water.goalMl` 原返回 2000。修复后统一使用 `readSettings(space)`，同一复现现在返回 3100；已实际断言通过。
2. **个人设置改昵称后账号面板仍持有旧值（已修复）**：原 `applyState` 只刷新 `settings`，账号面板读取独立闭包 `user.name`。修复增加 `account.syncName(settings.name)`；静态核对保存后的 load/applyState 到账号面板数据路径已打通。尚未由本评审 Agent 执行实际浏览器点击，该部分交独立验收。

## 实际检查

- 使用隔离的内存 SQLite、虚构 A/B 账号及实际账户迁移/工作台初始化函数检查：A 在阅读示例空间首先读取时，昵称采用 `users.name`，关注目标/饮水目标继承健康个人空间旧值；与实现者确认的迁移策略一致。
- A 在旅行示例空间修改后，健康个人空间读取同一昵称/目标；B 账号保持自身默认设置。旧 scope JSON 原文在新设置读写后仍完整保留。
- 实际执行 `node --test tests/personal-settings.test.mjs`：2 个测试通过，覆盖本地迁移、账号权威昵称、跨工作台/空间共享、账号隔离和无效饮水目标不保存昵称。
- 阅读 API bootstrap/state/settings/export 与 MCP get_settings/update_settings/get_today 调用链：均连接同一存储；settings 写入检查预期账号；未知 account scope 拒绝回退到本地设置。
- 阅读客户端缓存与请求时序：写操作前后清缓存并递增 epoch；旧请求不能重新填充被清理的缓存；响应账号检查与 loadSequence 防止旧账号/旧切台结果覆盖当前页面。切台不再把已知昵称重置为 Captain。

未覆盖：真实浏览器操作、多标签页即时通知、服务器重启与多进程并发、部署环境。没有声称这些场景已验收。

修复复核时关键文件 SHA-256：

- personal-settings.mjs: `cd5bbe2c832e57f4b39f48f16b68d888bf4dea00f7f1969ebf83a20076391f7c`
- mcp.mjs: `2c1fa08c5eba11e4d4b3395c9c76159956a77b47f33fa8f749aa66510dbc995f`
- app.js: `ec008686b852193067b211a666fcdd7697190a6e35c5712d111d40899bdb8a15`
- account.js: `7633c0bca5e674419cd547859cdf0fdbd817a91beedc329ccec1e68e7ba37d81`


## 最终集成工作树复核

最终实现移至 `/tmp/awesome-workbench-shared-settings`，基准 HEAD 与 `origin/main` 均为 `3a597ac30f41496a152d4c57ceb5fb6acfca1515`。前文 `7c674d9` 是初次评审工作区基准，不是最终集成基准；以下结论覆盖最终干净工作树。

- `lib/personal-settings.mjs` 与初次评审版本逐字一致；app/account 的昵称同步与缓存修复、server 的 bootstrap/state/settings/export、MCP 共享读写与今日目标修复均保留。
- 集成初版误将远端自建工作台首页 `otherOverview` 回退为旧欢迎页。已向作者报告并由作者恢复；独立用脚本断言整个 `otherOverview` 函数与 `origin/main` 逐字一致、`renderOther` 仍调用它。最终 shell diff 只保留个人设置文案及表单分支，不再回退近期备忘/待办、进度环、原件和日历。
- `lib/reading.mjs`、`public/reading.js`、`public/reading.css`、`public/originals.js`、`public/studio.css`、构建脚本与 `origin/main` 没有差异；server diff 仅设置接入。未发现远端阅读/首页功能回退。
- MCP 工具说明和文档现明确账号级共用；`mcp-crud` 增加预期 owner 请求头；workbench/acceptance 将设置预期改为共享，同时保留记录隔离检查，符合需求。
- 实际执行 `git diff --check` 通过。按协调者要求未重复运行全量测试，最终集成全量测试与浏览器验收结果由各实际执行者另行记录。

最终复核无遗留阻断项；没有 GitHub 写入、合并或发布。最终源文件 SHA-256：

| 文件 | SHA-256 |
|---|---|
| lib/personal-settings.mjs | `cd5bbe2c832e57f4b39f48f16b68d888bf4dea00f7f1969ebf83a20076391f7c` |
| lib/mcp.mjs | `a69d53c66e5005fb3a54a10a4a8629fa382c00ffd0704d4a338f991c0869f0db` |
| public/app.js | `41706e59bbc1eceee7eabef4663dadbd36d2edb9d47742c5edb433f3ca35d343` |
| public/account.js | `7633c0bca5e674419cd547859cdf0fdbd817a91beedc329ccec1e68e7ba37d81` |
| public/shell.js | `9aa5f9e0b1662da05c75b9eb430e7ab0fb72893b851da46a59d7d7668ea4d114` |
| server.mjs | `bddc9ed971add38274be28625805b0a2fbc0bfabbb74e5147e5078a44858fad9` |
