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

缺少/无效/已撤销令牌 → `401` + `WWW-Authenticate: Bearer`，JSON 正文 `{error, code}`（见下方错误码）。**带 Cookie 的请求一律 401**（即使同时带了 Bearer），浏览器无法被跨站驱动。Host 校验照常生效。限流：每令牌每分钟 120 次（`MCP_RATE_PER_MINUTE` 可调），超出返回 `429` + `Retry-After: <秒>`（到当前 60 秒窗口结束），等待后再试；请求体上限 1MB。

## 工具

| 工具 | 作用 |
|---|---|
| `list_workbenches` | 列出工作台（health / finance / 自建）、数据空间（personal / demo）及每个工作台允许写入的类型 |
| `get_today` | 今天（Asia/Shanghai）的记录与汇总：饮水合计/目标（`goalMl`：取服务端饮水目标设置，没有设置时为 2000ml；**目前没有这项设置，所以固定为 2000ml**）、运动分钟、餐食数、未完成待办 |
| `list_records` | 按 `kind`（meal/exercise/metric/water/note/task/all）、`from`/`to`（YYYY-MM-DD，含）、`limit`（默认 50，最大 200）查询，最新在前 |
| `create_record` | 新建 meal/exercise/metric/water/note/task |
| `update_record` | 按 `id` 修改上述类型记录，只传要改的字段 |

所有工具都接受可选的 `workbench`（默认 `health`）与 `space`（默认 `personal`）。健康类（meal/exercise/metric/water）只能写入 `health` 类型工作台；note/task 可写入任何工作台。写入经由与网页相同的 `validate()/put()`，规则与网页一致；meal/exercise/metric/water 不能记未来日期（以 Asia/Shanghai 的今天为准，网页同样拦截），note/task 可以是未来日期。

**v1 不提供**：删除、附件/照片/语音、就医/报告/用药/服药记录的读写。

## 错误约定与错误码

- 工具错误（参数/业务校验失败）→ 正常的 `tools/call` 结果：`isError: true`，`content[0].text` 为给用户看的中文原因，`structuredContent.error = {code, message, hint?}`。`hint` 仅给助手看（如工作台不存在时为「用 list_workbenches 获取可用工作台」），不要转述给用户；给用户的文案是「没有找到这个工作台，请从你的工作台里选一个」。
- HTTP 层错误（401/404/405/415）→ JSON 正文 `{error, code}`；JSON-RPC 层错误（400/413/429/500 等）→ `error.data.code`。
- `message`/`error` 文案为纯中文，不含字段名、内部 id、环境变量或表达式（例：「运动时长需在 1–1440 分钟之间」「「金融」工作台只能记备忘和待办，饮水请记到「健康」工作台」「不能记录未来的日期，今天是 11月1日」）。客户端请按 `code` 判断，不要解析文案。

| code | 位置 | 含义 | 建议处理 |
|---|---|---|---|
| `token_missing` | 401 | 没带访问令牌 | 不重试；让用户在网页生成令牌 |
| `token_invalid` | 401 | 令牌无效或已撤销（撤销、改密码、停用账号后都是这个；令牌只存哈希，无法区分“已撤销”） | 不重试；让用户重新生成 |
| `token_forbidden` | 401（MCP 带 Cookie）/ 403（令牌访问账号与安全接口） | 这种凭据不允许做这件事 | 不重试 |
| `rate_limited` | 429 | 请求过于频繁；带 `Retry-After` 秒数（`error.data.retryAfter` 相同） | 等待 `Retry-After` 秒后重试 1 次 |
| `validation_failed` | 工具 | 参数不合法（格式、范围、缺项、不支持的参数） | 修正后重试（写入需重新向用户确认） |
| `future_date` | 工具 / 网页 400 | meal/exercise/metric/water 的日期晚于今天 | 向用户确认日期 |
| `not_found` | 工具 | 工作台/数据空间/记录不存在（或不属于当前账号） | 重新 `list_workbenches` / `list_records` |
| `forbidden_kind` | 工具 | 该工作台不能写这类记录，或这类记录不能通过助手修改 | 换工作台，或请用户到网页操作 |
| `mcp_disabled` | 404 | 服务未开启助手连接 | 不重试 |
| `method_not_allowed` / `unsupported_media_type` / `unsupported_protocol_version` / `payload_too_large` / `unknown_tool` | 405 / 415 / 400 / 413 / JSON-RPC | 客户端调用问题 | 修正客户端 |
| `internal_error` | 500 | 服务端异常 | 写入类先用 `list_records` 查是否已写入，再决定是否重试 |

网页 API 的 401 正文同样带 `code`（`token_missing` / `token_invalid`）。

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
