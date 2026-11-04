# 健康总览最近记录上线记录

2026-11-04（Asia/Shanghai），用户明确要求“合并上线”。部署执行 `/root`，独立公网只读验收 `/root/todo_acceptance`。

- PR：[#59](https://github.com/Royean/awesome-my-workbench/pull/59)，已合并。
- 合并提交：`3a597ac30f41496a152d4c57ceb5fb6acfca1515`；合并树与已验收 PR head `10f5da7f8868216c8a594fa9cd789208189b31cd` 无差异。
- 线上地址：https://vivid-dream.online/ 。
- 新发布目录：`/opt/awesome-my-workbench/releases/3a597ac-health-latest-records`。
- 前一发布/代码回滚点：`/opt/awesome-my-workbench/releases/756bfc9-immersive-reader`，保留未删除。
- 源码包 SHA-256：`17fe886b8aa1c835c8fe1683b80c40ba34b5d6fbdf6680de3e5d5b2881d325a1`，上传后校验一致。
- 部署前备份：`2026-11-04T11-29-34.876Z-ed2676ce`，现有备份服务 Result=success / ExecMainStatus=0，在线 SQLite 与附件快照完整性检查成功。

仅发布 main 中受控源码，未上传本机医院缓存、健康数据或凭据。未修改 Nginx、环境配置、数据库内容或现有文件归属；使用项目独立 Node runtime 构建并验证资源后，原子切换 current，重启既有 systemd 服务。切换前两次确认旧 current 未被其他发布改变，并设置失败时自动回滚。

## 实际验证

- `awesome-my-workbench` 为 active，current 指向新发布目录；回环及公网 `/healthz` 均返回 ok。
- 公网 HTTPS 首页 200；索引指向新 JS `cd56422f2a5d199ba52a87d5e264c3cdd5af5ddeae69f028db817da24efe0352` 与 CSS `26542486f58ef2c1cba671e89f82b6e007a2ec9b4c0d60f6888d2d4745b59d57`，下载字节哈希与资源名称一致。
- 匿名 `/api/state?space=personal&workbench=health` 返回 401；`/api/auth/me` 维持 enabled=true / user=null。
- 生产 SQLite 只读 `quick_check=ok`，`foreign_key_check` 零错误。
- 独立 Chrome 1440/360 登录页正常，无横向溢出或未捕获异常；未登录生产账号或创建虚构病历。既有 Cloudflare beacon 被 CSP 拦截的非阻断控制台信息在独立报告中保留，未修改策略。
- 功能代码上线前本机 269 项单测、真实隔离后端/Chrome 8 组验收及独立设计复核均通过；PR 的 push 与 pull_request 两个 CI job 均通过。

生产账号内业务 UI 没有代用户登录实测。发布正确性由生产资源指纹与已验收产物一致、服务健康及匿名权限边界证明；详细只读报告见 `LATEST_HEALTH_DEPLOYMENT_ACCEPTANCE.md`。
