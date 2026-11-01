# 独立账号与腾讯云部署

目标：现有手机版工作台在腾讯云单机独立运行，账号不再依赖 Sites 或 ChatGPT。当前范围为个人及少量受邀用户；金融仍为备忘与待办，不虚构已接入交易或行情。

## 分工及验收

协调、产品范围、整合与部署：`/root`（兼任）；账号后端：`/root/account_backend`；界面设计与实现：`/root/account_ui`；独立代码评审：`/root/account_review`。独立验收执行者与结果见验收文档，不把作者自测计为独立验收。

- ACC-01：匿名只能访问登录静态资源和最小健康检查，业务数据 API 返回 401；刷新及会话失效回到登录。
- ACC-02：无公开注册，无默认密码。首位管理员在服务器命令行初始化；受邀成员使用一次性、24 小时有效的链接自行设置密码。过期、已用和被作废链接拒绝激活。
- ACC-03：管理员可以邀请、禁用与恢复成员；禁用立即撤销会话和邀请。最后一位有效管理员不能被禁用。
- ACC-04：修改昵称与密码，列出及撤销本人会话；改密撤销其他设备会话。密码与完整令牌不进入审计、日志或 Git。
- ACC-05：相同用户不同工作台、不同用户相同工作台、示例/个人空间，均隔离列表、创建、编辑、删除、撤销、导出、关联对象及附件下载。未知工作台返回 404。
- ACC-06：重启后账号、工作台、记录及会话保留；旧本地资料保持原状，不自动归属首个管理员。
- ACC-07：生产强制 HTTPS 来源配置、HttpOnly/Secure/SameSite Cookie、精确同源写入和认证限流；无认证的开发模式只监听回环地址。
- ACC-08：原生 App 会话。`POST /api/auth/app-login`（请求体同 `/api/auth/login`，限流与 scrypt 校验完全相同）在响应体返回不透明随机令牌 `{token,tokenType:'Bearer',expiresAt,user,me,state}`，不设置 Cookie；服务端只存令牌 SHA-256，写入同一 `sessions` 表，与网页会话同样 30 天滑动续期、可在会话列表中查看与撤销、`/api/auth/logout` 即吊销。携带 `Authorization: Bearer <token>` 且**不带会话 Cookie**的请求只通过令牌认证，因此免除 Origin 校验；只要带了会话 Cookie，就按原有 Host+Origin 规则校验（Bearer 头不能绕过）。Host 校验对所有请求不变。app-login 若带 Origin 则必须为本站。
- ACC-10：个人访问令牌（PAT）。登录用户在「账号与安全 → 访问令牌」中按名称生成令牌（`zh_pat_` 前缀 + 32 字节随机值），令牌只在生成时显示一次，服务端只存 SHA-256（`access_tokens` 表，迁移 002）；列表显示名称、创建时间、最近使用时间，可随时撤销；每账号最多 20 个，不自动过期。生成/列出/撤销接口 `/api/auth/tokens` 只接受网页 Cookie 会话（非 GET 仍要求同源 Origin），Bearer（无论 PAT 还是 App 令牌）一律 403。PAT 通过 `Authorization: Bearer` 访问 `/api/*` 数据接口（以及后续的 `/mcp`），免除 Origin 校验但 Host 校验不变；PAT 不能访问账号与安全接口（会话、改密、资料、成员管理），只允许 `/api/auth/me` 与用自身 `logout` 吊销自己。改密、禁用账号、重置邀请会撤销该账号全部 PAT。
- ACC-08b：360/390px 登录、邀请激活、账号管理及工作台切换可操作，错误可恢复，无横向溢出。
- ACC-09：腾讯云独立系统账号及 systemd 服务、回环端口反代、HTTPS、重启恢复、每日数据库及附件备份；保留服务器既有服务。

## 参考 Trek 与取舍

参考本地 `TREK/server/src/nest/auth/auth.service.ts` 的邀请、改密撤销、禁用与会话模型，以及 `nest/common/cookie.ts` 的 Cookie 设置。采用相同的用户行为原则，不复制其完整 Nest/插件/OAuth 架构。

当前采用 Node 24 LTS + SQLite WAL + 服务器私有附件目录，保持现有应用及数据兼容，避免在 2GB 单机额外引入数据库容器。认证使用异步 scrypt（N=131072、r=8、p=1），最多两个并发密码运算。后续多实例部署须先迁移到 PostgreSQL 与共享对象存储；不在多实例间共享 SQLite 文件。

## 数据模型

| 表 | 职责与隔离 |
| --- | --- |
| users | UUID、规范化唯一邮箱、昵称、admin/user、密码哈希、禁用状态 |
| sessions | 属于用户、仅存随机会话令牌的 SHA-256、创建/使用/到期时间 |
| invitations | 属于用户、仅存一次性令牌哈希、到期及消费时间 |
| user_workbenches | 用户与工作台键的联合主键；每人独立健康、金融及自定义注册表 |
| data_scopes | 联合外键关联用户工作台；personal/demo 各映射独立内部 scope |
| items | 现有 UUID、内部 scope、记录类型及验证后的 JSON 业务字段 |
| settings | 内部 scope 对应的称呼、目标等设置 |
| deleted_items | 内部 scope 的短期撤销快照 |
| audit_events | 操作者、动作、目标及时间；不含密码、令牌或病历正文 |
| auth_attempts | 持久化认证失败窗口与封禁时间 |
| schema_migrations | 追加式数据库迁移版本 |

`items/settings/deleted_items` 保留既有存储结构；访问前由服务器根据登录用户解析 `data_scopes`，拒绝从客户端指定归属用户。健康业务字段继续由现有逐类型校验器验证，关联就诊、报告、用药与附件必须属于同 scope。此版没有家庭共享权限；管理员管理账号，不能通过业务 API读取其他用户病历。

生产模式中旧本地 demo/personal 不自动迁给新用户。Sites 的 D1/R2 资料也不自动下载或迁移；本次上线账号从空个人空间开始。后续导入应显式选择归属用户、校验关联及附件，并保留源备份。

## 运维结构

代码发布目录：`/opt/awesome-my-workbench/releases/<commit>`，`current` 软链接指向当前版本。Node 24 安装在项目独立 runtime 中，不替换系统 Node。

- 服务账号：`aw-workbench`；服务：`awesome-my-workbench.service`。
- 程序：回环 `127.0.0.1:3180`，由现有 Nginx 独立虚拟主机反代。
- 数据：`/var/lib/awesome-my-workbench/health.sqlite` 与 `uploads/`，仅服务账号可读写。
- 环境：`/etc/awesome-my-workbench.env`，参照 `.env.example`；生产设置 `NODE_ENV=production`、`AUTH_REQUIRED=1`、`APP_ORIGIN=https://实际域名`、`TRUST_PROXY=1`。
- 备份：每日上海时间 03:20 后随机 10 分钟内执行，保留最近 7 份于 `/var/backups/awesome-my-workbench/`；在线 SQLite backup 后复制不可变附件并做完整性检查。是同机备份，不能抵御整机/磁盘丢失；异地备份尚未配置。
- 证书：使用现有域名证书；ACME 验证路径和续期 reload 应单独核实。

备份含密码哈希和私人记录，不能提交 Git 或暴露下载接口。生产业务日志不记录请求正文或 Cookie。

## 回滚和恢复

代码回滚：将 `current` 指向前一发布目录，重启服务，检查 `/healthz` 与登录。首次部署没有前版账号 schema，若需回退到原本地版，应恢复发布前数据库快照，不能将生产认证关闭。

恢复备份：停止服务，将当前完整 data 目录移到私有归档；从指定完整快照恢复 `health.sqlite` 与 `uploads/`，设置归属和权限，再启动并检查 SQLite `quick_check`、账号及附件。不得混用不同快照的数据库与附件，不把正在使用的 WAL 文件直接复制当作备份。

部署完成事实、提交、测试数、访问地址、证书检查、服务/备份检查与待验证项另记验收报告。尚未执行的动作不标为完成。
