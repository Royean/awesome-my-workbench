# 独立代码评审：账号与腾讯云部署

评审执行者：开发工程师 `/root/account_review`，不同于实现作者 `/root`、`/root/account_backend`、`/root/account_ui`。已读取私人角色定义与 software-development 工作流。日期：2026-10-31。基准：`e554ce5f08cd60cb85d9bc3c029d8dd20f0f12e3`，评审对象为本次未提交集成工作区；最终交付提交由协调负责人补充关联。

结论：以下发现已由作者修复并经复核；本次范围未发现剩余阻断代码问题。此结论是独立代码评审，不替代界面独立验收或腾讯云真实部署验收。

## 范围与检查

- 阅读 `lib/accounts.mjs`、`migrations/001-accounts.sql`、`server.mjs`、`scripts/account-admin.mjs`、`scripts/backup.mjs`、账户 UI、`app.js`/`shell.js` 集成、部署模板及账号部署说明。
- 检查用户/工作台/示例与个人空间的服务端 scope 解析，以及 items、关联就诊/报告/用药/餐食附件、下载、导出、删除恢复、工作台注册表。客户端不能指定归属用户；跨 scope 对象查询均受当前用户范围限制。未发现直接 IDOR。
- 检查会话禁用、改密与撤销、邀请消费事务、并发哈希上限、规范化邮箱、管理员边界、原始密码及 token 的存储/返回路径。数据库只存密码哈希与随机 token 的 SHA-256，审计不含秘密。
- 检查 production 强制 HTTPS origin、精确 Host/Origin、JSON 写入、Secure/HttpOnly/SameSite Cookie、开发模式回环监听；反代客户端 IP 只信任回环连接且验证 IP 格式。检查独立 systemd 服务/运行时/目录、3180 回环反代和备份模板，无显见覆盖其他服务的代码路径。

## 发现与修复复核

| 编号 | 级别 | 原复现及影响 | 修复与复核 |
| --- | --- | --- | --- |
| R-01 | P1 | 登录成员开始 POST `/api/items`，仅发送 JSON 首字符，管理员禁用成员成功后补齐 body；原版本仍返回 201，失效会话可完成在途写入。账户 profile/管理写入存在相同等待窗口。 | `readBody` 收齐内容后重新验证请求认证快照，对比有效 session、用户与角色；独立原样复现现返回 401。作者新增真实分块请求用例，禁用和撤销均拒绝写入。 |
| R-02 | P1 | 当前管理员在成员管理点击自己的“重置邀请”：后端撤销自己的 session，UI 随后刷新成员列表收到 401 并 reload，刚生成的 token 未复制即丢失，唯一管理员需 CLI 恢复。 | UI 隐藏当前账号的重置操作；后端当前账号 reset 返回 409。独立接口复测 409，后续成员列表仍 200。 |
| R-03 | P2 | 未登录页的 hashchange 和 Ctrl/Cmd+K 仍可触发业务导航/抽屉，覆盖登录 gate。后端数据 API 仍有认证，未形成数据读取。 | `applicationReady` 统一保护 render、navigate、点击、键盘与 hashchange；401 立即撤销该标记。已复核代码，浏览器交互由独立验收承接。 |
| R-04 | P2 | 成员 API 无 activated/status，新邀请但未设密码的账户显示“已启用”。 | API 返回 `password_hash IS NOT NULL` 的布尔 activated，不返回 hash；测试核查已激活与待激活账户。 |

另外复核了作者补充的 128 字符密码上限、邀请创建及重置事务、首位管理员 activation invitation；未发现上述修复引入新的明显越权或秘密持久化。

## 实际执行证据

使用 `/opt/homebrew/opt/node@24/bin/node`；所有测试使用临时目录与独立端口，没有访问真实 data，没有停止 3100，没有访问服务器或向 GitHub 发评审评论。

1. `node --test tests/auth.test.mjs tests/auth-config.test.mjs`：最终 8/8 通过，覆盖来源、生产配置、Cookie、CLI、邀请、隔离、重启、会话/密码、慢 body 撤销、限流。
2. 评审者另写独立临时 HTTP 复现（3296）：修复前禁用后在途 POST 为 201、self reset 为 200 且 followup 为 401；修复后分别为 401、409 且 followup 为 200。临时进程与目录已清理。
3. 评审者独立临时备份验证：保持合成 SQLite WAL 数据库打开，连续备份三次，保留两份，核对数据库内容与附件一致，结果通过；临时目录已清理。

最终复核关键源码 SHA-256：

- `server.mjs`：`e2f5245ee74cd79a66085e46c6d41709ebef4672e60bfec7570750c597268814`
- `lib/accounts.mjs`：`61fc4077debff1147ed8494d73373355994a8a193b3fca38d3bad54287b9e320`
- `public/app.js`：`98f43501f7ad4e4cf670986eaae0e96b1dc77aec34607a050689b8487d47ba0e`
- `public/account.js`：`0fe12b8ea04924e7adc654b77a4775a9a4899457e4ece5c606bf8f82c7678d01`

## 验证边界

本评审没有操作腾讯云服务器，真实 Nginx 配置共存、证书、systemd 权限、备份 timer 和重启恢复需由部署执行者验证。移动端真实登录/邀请/账号管理与视觉适配由独立测试验收确认。备份是私有目录中的同机快照，不能抵御整机损毁；文档已明确异地备份尚未配置。旧本地空间与 Sites 数据不自动归属新账号，也已在需求文档明确。
