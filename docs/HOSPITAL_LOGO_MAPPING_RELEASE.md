# 医院 Logo 映射与导航上线记录

2026-11-05（Asia/Shanghai），用户明确要求“合并上线”。执行 `/root`，独立生产只读验收 `/root/todo_acceptance`。

- 已合并 PR：[#68](https://github.com/Royean/awesome-my-workbench/pull/68)。合并提交 `eba883a34592f87cf8eed488634ce6c047bc0adf`，树与已验收最终 head `cc4bf1cf51def9855fb56e9f7b990dcfef85397e` 完全相同。
- 合并前同步主分支 PR #69 资产总览（`3516912`），仅解决 index 构建入口冲突并重建资源，保留双方功能。重建后作者 323/323 单测、独立 7 项映射及 8 组浏览器复测均通过，push/PR 两个 CI job 均成功。
- 访问地址：https://vivid-dream.online/ 。
- 当前发布：`/opt/awesome-my-workbench/releases/eba883a-hospital-logos`。
- 前版与代码回滚点：`/opt/awesome-my-workbench/releases/3516912-finance-overview`，保留未删除。
- 部署包 SHA-256：`18c9f99640103b07512ab74eb1dd337cc3fd87fe8dbd2d82bb74b5e790c1482a`，服务器解包前校验一致。
- 部署前在线备份：`2026-11-05T14-13-42.664Z-c0be4411`，备份服务 Result=success、ExecMainStatus=0，快照完整性检查通过。

仅部署 Git 中受控源码、9条审核映射及本地标识图；未上传完整医院库或私人健康资料。未改 Nginx、环境配置或真实健康记录。发布使用独立部署锁；切换前两次确认 current 仍是预期版本；准备失败不切换，切换后健康检查失败自动回滚。

## 验证事实

- 项目独立 Node runtime 重建成功；current 指向新版本、systemd active，回环及公网 healthz=ok。
- 公网 HTTPS 首页 200；新 JS `71deef1892cb911ef7ce1bc92d7b1d9b0aed53e6ab0370b4a03aad7227856f3c` 与 CSS `2788af2beb75ebfb2771f5d3ee5486bb7ad24f4433e452ac8b927f3cec79a977` 下载 SHA-256 与资源名相符。
- 新桥口腔图 `/provider-logos/hospital-66699bb57972917de9ea4c5b7884d394c4291d26235f832a81e23b6f94872216.jpg` 公网可取，SHA-256 与用户确认原图相符。
- 线上 bundle 包含新品牌映射及资产总览模块；原两个健康顶部 Tab 的源渲染项已移除。
- 认证仍启用，匿名 user=null，健康 state 接口 401；未登录或创建任何生产测试记录。
- 生产数据库只读 quick_check=ok、外键错误为0。

品牌图来自第三方、用户明确批准及官方图像核对的依据见 `HOSPITAL_LOGO_MAPPING.md`，此发布不将品牌标识当成执业登记证明。独立公网报告见 `HOSPITAL_LOGO_MAPPING_RELEASE_ACCEPTANCE.md`；生产账号内的实际数据界面未代用户登录验证，以本机真实交互测试与线上产物指纹一致作为功能交付依据。
