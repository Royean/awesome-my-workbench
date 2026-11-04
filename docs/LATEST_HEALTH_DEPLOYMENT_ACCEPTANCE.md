# 健康最近记录上线独立只读验收

结论：本次发布文件与匿名访问边界检查通过，无阻断问题。执行者为独立测试验收工程师 Agent `/root/todo_acceptance`，部署执行者为 `/root`。没有代登录、查看账号内健康数据、创建记录或修改远端配置。

## 发布标识与范围

- 目标：[生产站点](https://vivid-dream.online/)。
- 合并：PR #59，merge commit `3a597ac30f41496a152d4c57ceb5fb6acfca1515`；发布目录由部署执行者交接为 `/opt/awesome-my-workbench/releases/3a597ac-health-latest-records`。
- 独立线上检查时间：2026-11-04 19:30–19:31（Asia/Shanghai）。
- 范围：HTTPS 静态入口、健康检查、匿名 API 边界、新 JS 文件与摘要、桌面/360px 登录页。账号内分类最近记录功能已在本机隔离环境独立验收 8 组通过，见 `LATEST_HEALTH_ACCEPTANCE.md`；本报告不冒称生产真实账号内 UI 已验。

部署执行者另交接：服务 active、部署前备份 `2026-11-04T11-29-34.876Z-ed2676ce` 校验成功，部署包 SHA-256 为 `17fe886b8aa1c835c8fe1683b80c40ba34b5d6fbdf6680de3e5d5b2881d325a1`。这些服务器内部与备份事实归属部署者，本 Agent 未通过 SSH 复核。

## 独立 HTTP 与发布文件检查

| 只读请求 | 实际结果 |
| --- | --- |
| `GET /` | HTTPS 返回 200，HTML 类型正确 |
| `GET /healthz` | 200，`{"status":"ok"}` |
| `GET /api/state?space=personal&workbench=health` | 401，`code=token_missing`，不返回健康记录 |
| `GET /api/auth/me` | 200，`enabled=true`、`user=null` |
| 首页 JS 路径 | `/assets/app.cd56422f2a5d199ba52a87d5e264c3cdd5af5ddeae69f028db817da24efe0352.js`，符合期望 |
| 下载 JS | 200；实际 SHA-256 为 `cd56422f2a5d199ba52a87d5e264c3cdd5af5ddeae69f028db817da24efe0352`，与路径及本机独立验收构建一致 |
| 新逻辑特征 | JS 含「今天还未记录」「最近报告与资料」、`health-trend-fallback`、`health-latest-exercise`，与本次 latest-health 构建一致 |

## 独立浏览器检查

使用已安装 Chrome 156.0.8078.80、Playwright 无头模式，为两个视口分别新建空白浏览器上下文，仅打开首页，不填表、不提交登录。

- 1440×900：显示登录页与密码输入框；document/body 滚动宽度均 1440，未横向溢出。
- 360×900：显示登录页与密码输入框；document/body 滚动宽度均 360，未横向溢出；已实际查看截图，表单和按钮完整可读。
- 两视口均无未捕获页面异常，`.health-overview` 数量为 0，未匿名渲染健康总览。
- **非阻断控制台信息**：两视口均记录 Cloudflare Insights beacon 被既有 `script-src 'self' 'wasm-unsafe-eval'` CSP 拦截。该遥测脚本未执行，登录页正常展示；本次没有修改 CSP，也不将结果写作「控制台零错误」。

## 本地证据

目录：`/var/folders/wb/j54mykvj0k71fcm7rs8my5r80000gn/T/latest-health-production-eO0xEn/`。

- `http-result.json`：端点状态、匿名响应、bundle 路径和实际 SHA-256。
- `browser-result.json`：两个视口的宽度、页面异常、控制台信息与健康总览数量。
- `login-1440.png`、`login-360.png`：独立匿名登录页截图。

以上均为只读线上观察。未验证真实账号登录、账号内记录展示、数据写入、手机真机、其他浏览器或长时间运行状态；这些不能从匿名发布检查推断为通过。
