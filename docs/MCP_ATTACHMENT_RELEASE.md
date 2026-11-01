# MCP 报告原件发布

2026-11-01，关联 #21。新增上传、查询原件、关联报告三个 MCP 工具，共 15 个。原件 10MiB、上传 JSON 14MiB，普通 MCP 请求仍为 1MiB；读取后重新检查访问令牌。未增加数据库迁移。

实现 /root；独立代码评审 /root/mcp_attachment_review（见 MCP_ATTACHMENT_REVIEW.md）；独立验收 /root/mcp_attachment_qa（见 MCP_ATTACHMENT_ACCEPTANCE.md）。独立附件集成测试 12/12 通过；协调人完整自动回归 135/135 通过、0 skipped（Node 24.20.0）。不等同 Android 真机验证。

发布使用现有腾讯云服务和独立 Node24，先运行既有备份脚本，保留旧 release 供符号链接回滚。不修改 Nginx、账号、令牌或已有记录。生产部署与 MCP tools/list 检查由协调人继续执行，完成前不得声称已上线。

私人档案导入属于用户授权的后续数据操作，只通过 HTTPS MCP 调用；原件及导入清单存放本机私有临时目录，不提交到公开仓库、Issue 或日志。
