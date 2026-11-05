# 医院 Logo 映射上线独立只读验收

结论：本次发布文件、静态标识和匿名访问边界检查通过，无阻断问题。执行者为独立测试验收工程师 Agent `/root/todo_acceptance`，部署执行者为 `/root`。没有登录真实账号、访问健康记录或写入生产数据。

## 发布标识

- 站点：[vivid-dream.online](https://vivid-dream.online/)。
- PR #68，merge commit `eba883a34592f87cf8eed488634ce6c047bc0adf`。
- 部署者交接 release：`eba883a-hospital-logos`，previous：`3516912-finance-overview`。
- 独立检查时间：2026-11-05 22:16–22:18（Asia/Shanghai）。
- 发布包含已独立本机复测的合入主分支后构建，provider/临时 SQLite 7 项及隔离真实后端 Chrome 8 组均通过，见 `HOSPITAL_LOGO_MAPPING_ACCEPTANCE.md`。本节只验证匿名生产边界，不冒称已登录健康 UI 的线上检查。

部署者另报告备份 `2026-11-05T14-13-42.664Z-c0be4411` 已校验，部署包 SHA-256 为 `18c9f99640103b07512ab74eb1dd337cc3fd87fe8dbd2d82bb74b5e790c1482a`、service active、数据库 quick_check=ok 且外键错误 0。服务器内部、备份和数据库检查归属部署者；本 Agent 未通过 SSH 复核。

## 独立只读 HTTP 检查

| 请求或产物 | 实际结果 |
| --- | --- |
| HTTPS 首页 | 200 |
| `/healthz` | 200，status=ok |
| `/api/auth/me` | 200，enabled=true、user=null |
| 匿名 `/api/state?space=personal&workbench=health` | 401，code=token_missing，不返回健康记录 |
| 首页 JS | 200，路径及下载 SHA-256 均为 `71deef1892cb911ef7ce1bc92d7b1d9b0aed53e6ab0370b4a03aad7227856f3c`，510,416 字节，与本地发布产物逐字节相同 |
| 首页 CSS | 200，路径及下载 SHA-256 均为 `2788af2beb75ebfb2771f5d3ee5486bb7ad24f4433e452ac8b927f3cec79a977`，267,120 字节，与本地产物逐字节相同 |
| 新桥口腔图片 | `/provider-logos/hospital-66699bb57972917de9ea4c5b7884d394c4291d26235f832a81e23b6f94872216.jpg` 返回 200、image/jpeg、4,911 字节；实际 SHA-256 与文件名一致，内容与本地已验收图片逐字节相同，已实际查看下载图片 |
| 公开映射模块 | `/hospital-logo-map.js` 返回 200、9 条；xinqiao-dental 为 brand，城市成都/西宁/德阳/自贡，图片链接正确，保留第三方 logoSourceUrl |
| 健康导航源码 | 公开 `app.js` 返回 200，两个 `nav('file','资料原件'...)` 与 `nav('day','每日回顾'...)` 渲染调用已移除；总览使用 institutionMark 调用 |
| 财务概览同时保留 | `/asset-overview.js` 返回 200；下载的新 JS bundle 同时包含 finance-overview-heading、asset-overview-currency、asset-overview-dimension 三项特征 |

没有请求真实患者数据或重新请求官方/第三方图片来源网站；图片仅从本生产站点的公开静态路径下载。Logo 来源与用户审批的边界沿用本机验收报告，不因上线而扩大为全部候选审核。

## 独立 Chrome 登录页检查

Chrome 156.0.8078.80，桌面 1440×900 与手机宽度 360×900 分别使用全新匿名上下文。

- 两视口均出现登录按钮及密码输入框，未提交表单。
- document/body 宽度分别为 1440/1440 和 360/360，没有横向溢出。
- 两视口无未捕获页面异常，`.health-overview` 数量均为 0，匿名未渲染健康总览。已实际查看 360px 截图，字段和按钮完整可读。
- 两视口均记录非阻断 CSP 信息：Cloudflare Insights beacon 被既有 `script-src 'self' 'wasm-unsafe-eval'` 拦截，对应请求失败原因 csp。没有为遥测脚本修改策略，不将结果表述为「控制台零错误」。

首次以 networkidle 判定就绪时 30 秒超时，随后改为 DOMContentLoaded 加真实登录按钮/密码框可见检查，两视口均通过；没有据此猜测网络未空闲的根因。静态文件及匿名 API 则有上表独立 HTTP 检查结果。

## 证据与范围限制

目录：`/var/folders/wb/j54mykvj0k71fcm7rs8my5r80000gn/T/logo-map-production-vaoC7A/`。

- `http-result.json`：端点状态、三份下载文件的实际 SHA-256、映射及源码检查、财务 bundle 特征。
- `browser-result.json`：视口宽度、页面异常、CSP/请求失败信息、匿名健康总览数量。
- `login-1440.png`、`login-360.png`：匿名登录页。
- `dental-logo.jpg`：只读下载的线上口腔图片，用于与本地发布图片比较及视觉核对。

未执行账号登录、生产健康/财务 UI 交互、数据写入、手机真机或其他浏览器测试；线上导航是否实际隐藏和医院映射是否在真实账号内展示，不能从匿名检查直接推断，相关功能行为由已通过的隔离环境验收支撑。本报告为只读发布核验，不更改远端。
