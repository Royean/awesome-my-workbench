# 腾讯云发布记录 v0.7

发布日期：2026-10-31（Asia/Shanghai）。部署执行与产品范围确认：`/root`。关联任务：[#1](https://github.com/Royean/awesome-my-workbench/issues/1)。

## 已发布

- 访问地址：[https://vivid-dream.online/](https://vivid-dream.online/)。腾讯云轻量单机，独立 systemd 服务及 Nginx 虚拟主机。
- 实际运行源码：`67d8e6959b186b86096845bcfdd0df2d9e72a208`；正式发布目录 `releases/67d8e69`。
- 部署源码包 SHA-256：`842967b7ce09f06ebafb2b2deb9f029fb9221ecf396f06296335844ab06f50a3`；服务器解包前已核对。
- 独立 Node `24.22.2`，官方发行归档已按官方 SHASUMS256 校验；没有替换系统 Node18。
- 首位管理员使用用户确认的邮箱建立，密码尚待本人通过一次性、24小时有效的邀请自行设置；无默认密码。原邀请码未写入 Git、Issue、业务日志或本文。

手机端从顶部工作台名称切换健康、金融和自定义工作台；“我的 → 账号与安全”管理登录、密码与受邀成员。金融目前为备忘与待办，未连接账户交易或行情。

## 验证事实

| 检查 | 结果 |
| --- | --- |
| 独立代码评审 | [ACCOUNT_REVIEW.md](ACCOUNT_REVIEW.md)，4项发现修复复核，无剩余阻断代码问题 |
| 独立自动测试 | 47/47通过，含重启持久化、旧资料不自动继承、跨用户记录/附件及在途会话撤销 |
| 独立真实浏览器交互 | [ACCOUNT_ACCEPTANCE.md](ACCOUNT_ACCEPTANCE.md)，本机真实Node/SQLite API与Chrome手机视口11组通过 |
| 公网 HTTPS | 200，证书正常验证；HTTP返回301 |
| 公网健康检查 | `/healthz` 返回 `{"status":"ok"}` |
| 公网匿名权限 | `/api/auth/me` 返回 enabled=true/user=null；`/api/state` 返回401 |
| 公网浏览器 | Chrome390×844显示真实登录页、无横向溢出、无未捕获JavaScript错误；见 [截图](tencent-login-mobile.png) |
| 重启恢复 | 实际重启systemd后健康检查成功；管理员及未使用邀请仍各1条 |
| 数据库 | `quick_check=ok`，`foreign_key_check`零错误 |
| 持久化权限 | data目录0700、SQLite0600归aw-workbench；环境配置0640 |
| 网络与进程 | 业务仅回环3180；Nginx、既有Inflow及其他原监听端口保持运行 |
| 备份 | 备份service实际运行Result=success；数据库与附件快照已生成并做完整性检查；每日timer已启用，上海时间03:20后随机10分钟内执行 |
| 证书续期 | 既有certbot-renew.timer已启用；沿用现有证书webroot与Nginx reload hook；实际执行Certbot staging dry-run，模拟续期成功 |

产品范围确认：ACC-01～08由独立本机测试及评审覆盖；ACC-09腾讯云服务、HTTPS、重启和备份由协调人实际验证。生产管理员的首次密码设置由本人执行，未代替本人消费真实邀请，也未在生产建立虚构病历做破坏性测试。iOS/Android实体手机和实际软键盘仍待验证；浏览器仿真不等同真机。

## 数据与运维边界

原Sites版本保持在原地址运行，D1/R2和本机现有健康资料未自动迁入新账号。当前腾讯云个人与示例空间默认均为空，空间切换继续隔离；需显式导入才能看到旧资料。

备份目前为同机、最近7份；尚无异地灾备。发布后服务器根盘约90%使用、可用5.4GB，来自台账已有其他服务及历史文件；本次未擅自删除其他服务或备份。后续大量上传前需清理确认可删除的历史文件或扩容。

回滚及完整数据库/附件恢复步骤见 [ACCOUNTS_AND_TENCENT.md](ACCOUNTS_AND_TENCENT.md)。认证、数据和生产运行均在`main`分支；`cloud`为原Sites平台版本，不代表本次腾讯云产物。
