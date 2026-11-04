# 健康首页 AI 布局：后端与 MCP

实现：`/root/layout_backend`（开发工程师）；整合负责人 `/root`。基线 `7680b5f`。第一版仅支持健康工作台 `health` 的首页 `dashboard`。

## 作用域与配置

布局按账号、工作台、页面保存，个人与示例空间共用一份外观偏好。本机未启用认证时使用独立的 `local` 布局。实时主题仍来自现有 `user_workbenches.themeColor`（本机为 `workbenches.themeColor`），不另存一份实时主题。

`public/layout-config.js` 是浏览器和服务端共用的纯配置合同，导出 `LAYOUT_WIDGETS`、`defaultLayoutConfig()`、`validateLayoutConfig()` 和 `applyLayoutChanges(config, currentTheme, changes)`。9个组件各自列出电脑、手机支持的尺寸；趋势限定已支持的监测类型与7/14/30天，待办显示1–8项。

配置包含 `schemaVersion:1` 及独立的 `desktop`、`mobile`，每个设备具有 `mode:default|custom` 和完整9组件的 `widgets` 数组，元素为 `{id, visible, size, options?}`。默认模式保留现有 Studio 排列；自定义模式由前端渲染。

修改使用补丁，例如：

```json
{"expectedRevision":0,"changes":{"mobile":{"order":["tasks","trend"],"widgets":[{"id":"trend","options":{"metric":"pressure","range":30}},{"id":"exercise","visible":false}]}}}
```

只改变手机，电脑保持原样。`order` 所列卡片依次前置，其余保持相对顺序；`widgets` 合并指定字段。未知字段和任意HTML/CSS/URL/查询表达式被拒绝。设备补丁 `{reset:true}` 恢复该设备默认布局，不能同时指定其顺序或卡片改动。

## Web API

接受 `workbench=health&page=dashboard`。已登录的读取和写入都要求当前 `X-Workbench-Owner`；写入继续使用现有同源验证和请求体结束后的会话复核。

| 方法及路径 | 参数与结果 |
| --- | --- |
| `GET /api/layout` | 快照：owner/workbench/page/revision/config/themeColor/updatedAt/history |
| `GET /api/layout/widgets` | 组件目录、设备、配置版本 |
| `POST /api/layout` | `{expectedRevision, changes}` 或 `{expectedRevision, previewId}` 二选一；返回新快照 |
| `POST /api/layout/preview` | `{expectedRevision, changes}`；候选快照及previewId/baseRevision/previewUrl/expiresAt/summary |
| `GET /api/layout/preview/:id` | 本账号的有效预览 |
| `POST /api/layout/restore` | `{expectedRevision, revision?}`；省略目标时恢复上一版本 |

健康state/bootstrap及登录引导响应附带 `layout`。默认revision为0，读取不创建布局行或修改主题。

预览有效期一小时，每账号最多20份；启用认证时只能本人读取。本机未启用认证时仅在既有loopback环境使用local作用域。创建草稿不改实时布局和主题。应用同时检查当前版本、预览基准版本、有效期与所有权，成功后消费草稿。链接格式 `/?layoutPreview=UUID#dashboard`，配置APP_ORIGIN时返回完整URL。预览返回 `affectedDevices`：只改手机或电脑时链接附带对应 `layoutDevice`，主题单独修改或同时改两端时不强制设备。

跨设备预览使用同源iframe。仅根路径GET、`layoutFrame=1`、有效本人预览、健康首页作用域全部满足时，响应允许 `frame-ancestors 'self'` 与 `X-Frame-Options:SAMEORIGIN`。普通HTML、HEAD、`/index.html`、其他静态资源以及匿名/跨账号/过期/无效预览均保持 `frame-ancestors 'none'` 与 `DENY`。此例外不修改原件已有的独立沙箱策略。

## 版本与兼容

幂等迁移 `006-dashboard-layouts.sql` 仅新增当前布局、历史、预览3表并记录schema版本6。布局、主题、历史通过同一个SQLite `BEGIN IMMEDIATE` 事务提交；冲突返回409 `layout_conflict`。现有健康主题选择器也写入这个版本序列，并在事务中保留最新布局。

保留初始版本0及最近30个保存版本。恢复历史创建新版本，包含当时主题；恢复单设备默认布局保留另一个设备及当前主题。历史只有版本、时间、来源和系统生成的摘要，不含健康记录。新增表由现有SQLite整体备份覆盖，旧版本可忽略它们。

## MCP 与验证

新增 `list_layout_widgets`、`get_layout`、`preview_layout`、`update_layout`、`restore_layout`。复用现有账号/令牌/工作台授权和同一布局服务，不接受数据空间参数。写入必须带expectedRevision，有冲突先重新读取。工具说明允许用户明确要求的可撤销展示调整直接执行；健康记录、用药确认、删除规则不变。客户端重新获取工具列表后可发现新增工具。

`tests/layouts.test.mjs` 覆盖严格配置、真实SQLite事务回滚、预览过期/隔离、API/MCP一致性、同版并发一成功一409、历史保留与恢复、旧主题入口、状态引导与重启持久化；还验证布局操作未更改个人业务记录。`tests/mcp.test.mjs` 严格工具清单同步。工程自测不替代其他Agent独立验收。
