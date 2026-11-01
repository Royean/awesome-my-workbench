# 知衡 MCP 服务

知衡在 `server.mjs` 内置一个远程 MCP 服务端点：`https://vivid-dream.online/mcp`（本地开发为 `http://localhost:3100/mcp`，需 `AUTH_REQUIRED=1`）。

- 传输：MCP Streamable HTTP，JSON-RPC 2.0 over `POST`，只返回 `application/json`（不提供 SSE；`GET /mcp` → 405）。无状态，不使用 `Mcp-Session-Id`。
- 协议版本：`2025-06-18`（默认），兼容 `2025-03-26`。请求头 `MCP-Protocol-Version` 若存在必须为其一。
- 方法：`initialize`、`notifications/initialized`、`ping`、`tools/list`、`tools/call`。不支持批量请求。
- 零运行时依赖，手写实现（`lib/mcp.mjs`）。

## 认证与令牌

只接受 `Authorization: Bearer <token>`：

1. 登录网页 → 右上角账号 →「账号与安全」→「访问令牌」，填写名称（如 `Claude MCP`）生成。令牌形如 `zh_pat_…`，**只显示一次**，请存入密码管理器或环境变量（如 `ZHIHENG_TOKEN`），不要提交到代码库或贴进聊天。
2. 不用时在同一页面撤销；改密码、禁用账号会撤销全部令牌。
3. App 登录（`/api/auth/app-login`）得到的会话令牌也可用，但推荐为每个 AI 客户端单独生成 PAT，便于单独撤销。

缺少/无效/已撤销令牌 → `401` + `WWW-Authenticate: Bearer`。**带 Cookie 的请求一律 401**（即使同时带了 Bearer），浏览器无法被跨站驱动。Host 校验照常生效。限流：每令牌每分钟 120 次（`MCP_RATE_PER_MINUTE` 可调），请求体上限 1MB。

## 工具

| 工具 | 作用 |
|---|---|
| `list_workbenches` | 列出工作台（health / finance / 自建）、数据空间（personal / demo）及每个工作台允许写入的类型 |
| `get_today` | 今天（Asia/Shanghai）的记录与汇总：饮水合计/目标（默认 2000ml）、运动分钟、餐食数、未完成待办 |
| `list_records` | 按 `kind`（meal/exercise/metric/water/note/task/all）、`from`/`to`（YYYY-MM-DD，含）、`limit`（默认 50，最大 200）查询，最新在前 |
| `create_record` | 新建 meal/exercise/metric/water/note/task |
| `update_record` | 按 `id` 修改上述类型记录，只传要改的字段 |

所有工具都接受可选的 `workbench`（默认 `health`）与 `space`（默认 `personal`）。健康类（meal/exercise/metric/water）只能写入 `health` 类型工作台；note/task 可写入任何工作台。写入经由与网页相同的 `validate()/put()`，规则与网页一致。

**v1 不提供**：删除、附件/照片/语音、就医/报告/用药/服药记录的读写。

错误约定：参数或业务校验失败 → 正常的 `tools/call` 结果，`isError: true`，`content[0].text` 为中文原因；协议错误（JSON 解析失败、未知方法、未知工具等）→ JSON-RPC `error`。

## curl 示例

```bash
export ZHIHENG_TOKEN=...   # 从网页生成；不要 echo
URL=https://vivid-dream.online/mcp
H=(-H "Authorization: Bearer $ZHIHENG_TOKEN" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -H 'MCP-Protocol-Version: 2025-06-18')

curl -s "${H[@]}" $URL -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
curl -s "${H[@]}" $URL -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
curl -s "${H[@]}" $URL -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_today","arguments":{}}}'
curl -s "${H[@]}" $URL -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"create_record","arguments":{"kind":"water","volume":300,"time":"10:30"}}}'
```

## 客户端配置示例

支持远程 HTTP MCP 的客户端（如 Claude Code）：

```bash
claude mcp add --transport http zhiheng https://vivid-dream.online/mcp --header "Authorization: Bearer $ZHIHENG_TOKEN"
```

## 测试

`node --test tests/mcp.test.mjs`（真实服务进程、临时数据库、虚构本地账号）。
