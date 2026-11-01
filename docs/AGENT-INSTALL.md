# 知衡 MCP 安装说明（给 AI agent 执行）

> 把这份文件交给你的 agent（Claude Code 或 Codex），说「按这份说明帮我装好知衡」即可。

你是用户的 AI 助手。请按下面步骤，把「知衡」个人健康工作台（https://vivid-dream.online）接到当前客户端，让用户之后能直接用自然语言查询和记录健康数据。

## 安全规则（全程遵守）

- 访问令牌形如 `zh_pat_…`，从环境变量 `ZHIHENG_TOKEN` 读取。**不要打印、回显、写进日志，也不要让用户把令牌贴到对话里。** 检查时只判断它有没有设置。
- 知衡里是用户**真实的健康数据**。安装和验证过程只做读取，不要新建、修改或删除任何记录。
- 改用户的配置文件前，先说明要改哪个文件、加哪几行。

## 第 1 步：确认令牌已设置

```bash
[ -n "$ZHIHENG_TOKEN" ] && echo "ZHIHENG_TOKEN 已设置" || echo "ZHIHENG_TOKEN 未设置"
```

如果未设置，请让用户自己完成（你不要经手令牌）：
1. 浏览器打开 https://vivid-dream.online 登录 → 右上角账号（手机上是「我的」）→「账号与安全」→「个人访问令牌」，填一个名字（如 `Claude Code`）点「生成令牌」。令牌只显示这一次。
2. 在终端执行（把 `粘贴令牌` 换成刚才的令牌）：
   - zsh（macOS 默认）：`echo 'export ZHIHENG_TOKEN=粘贴令牌' >> ~/.zshrc && source ~/.zshrc`
   - bash：把上面的 `~/.zshrc` 换成 `~/.bashrc`
3. 重新打开终端，再从第 1 步开始。

## 第 2 步：测试连接（只读）

```bash
curl -s -o /tmp/zhiheng-check.json -w "HTTP %{http_code}\n" https://vivid-dream.online/mcp \
  -H "Authorization: Bearer $ZHIHENG_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-06-18' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
grep -o '"name":"[a-z_]*"' /tmp/zhiheng-check.json | sort -u; rm -f /tmp/zhiheng-check.json
```

- `HTTP 200` 并列出工具名（`get_today`、`list_records`、`create_record` 等）就是通了。
- `HTTP 401`：令牌没设置好、复制不完整或已被吊销。请用户回网页重新生成，替换 `~/.zshrc` 里那一行。
- 连不上或超时：用户在国内网络时可能需要开代理再试。

## 第 3 步：接入客户端（按当前客户端选一个）

### Claude Code

```bash
claude mcp get zhiheng >/dev/null 2>&1 && claude mcp remove zhiheng -s user
claude mcp add --transport http --scope user zhiheng https://vivid-dream.online/mcp \
  --header "Authorization: Bearer ${ZHIHENG_TOKEN}"
mkdir -p ~/.claude/skills/zhiheng
```

然后把本文末尾「附：SKILL.md」里四个反引号之间的内容，原样写入 `~/.claude/skills/zhiheng/SKILL.md`。

注意：Claude Code 会把令牌存进它自己的配置。以后用户换了令牌，要重新执行这一步。

### Codex（CLI / IDE 扩展）

1. 如果 `~/.codex/config.toml` 里还没有 `[mcp_servers.zhiheng]`，在末尾追加：

```toml
[mcp_servers.zhiheng]
url = "https://vivid-dream.online/mcp"
bearer_token_env_var = "ZHIHENG_TOKEN"
```

   如果 Codex 版本较旧、连不上 HTTP 服务，在 `config.toml` **顶层**再加一行 `experimental_use_rmcp_client = true`。

2. `mkdir -p ~/.codex/skills/zhiheng`，然后把本文末尾「附：SKILL.md」的内容原样写入 `~/.codex/skills/zhiheng/SKILL.md`。

Codex 每次从环境变量读令牌，以后换令牌只要改 `~/.zshrc`。

### 其他 MCP 客户端（Cursor、Cline、Claude Desktop 等）

知衡是远程 MCP 服务：Streamable HTTP，地址 `https://vivid-dream.online/mcp`，每个请求带 `Authorization: Bearer <令牌>`；只返回 JSON（不需要 SSE，`GET` 会得到 405），不用 OAuth。

1. 打开客户端的 MCP 配置文件（JSON，常见顶层键是 `mcpServers`；具体文件位置看该客户端文档），在 `mcpServers` 里加一项。支持在配置里引用环境变量的客户端，用变量引用，不要写入令牌原文：

```json
{
  "mcpServers": {
    "zhiheng": {
      "type": "http",
      "url": "https://vivid-dream.online/mcp",
      "headers": { "Authorization": "Bearer ${ZHIHENG_TOKEN}" }
    }
  }
}
```

   - 有的客户端把 `type` 写成 `"streamable-http"` 或 `"transport": "http"`，按它的文档改字段名，`url` 和 `headers` 不变。
   - 环境变量引用的写法因客户端而异（如 `${ZHIHENG_TOKEN}`、`${env:ZHIHENG_TOKEN}`）；客户端不支持引用时，**不要**替用户把令牌写进文件，请用户自己打开文件把占位处换成令牌，并提醒这个文件不能提交到代码库或分享。
   - 只支持本地 stdio 服务的客户端：用桥接工具 [mcp-remote](https://www.npmjs.com/package/mcp-remote)，`command` 为 `npx`，`args` 为 `["-y", "mcp-remote", "https://vivid-dream.online/mcp", "--header", "Authorization:${ZHIHENG_AUTH}"]`，`env` 里设 `ZHIHENG_AUTH` 为 `Bearer ` 加令牌（同样用变量引用或请用户自己填）。
2. 客户端支持 skills / 自定义说明时，把本文末尾「附：SKILL.md」放进去；不支持的，把它的内容加到该客户端的系统提示或项目规则里。

本说明的最新版随时可从 https://vivid-dream.online/install.md 获取（公开、不含任何令牌）。

## 第 4 步：重启并验证

1. 告诉用户：**新开一个会话**（或重启客户端），新的工具和说明才会生效。
2. 在新会话里调用 `list_workbenches`（只读），用一句话告诉用户有哪些工作台，例如「已连上知衡，你有『健康』『金融』两个工作台」。
3. 告诉用户可以这样用：
   - 「今天喝了多少水？」「看看我最近的就诊和报告」
   - 「刚喝了 300 毫升水」「早上量的血压 128/82」「今天早上的药吃了」
   - 「把刚才那条删了」「最近删了什么」
   每次记录、修改、删除之前，助手都会先念一遍让用户确认。删错的在网页「我的 → 最近删除」30 天内能恢复。

## 卸载

- Claude Code：`claude mcp remove zhiheng -s user`，删除 `~/.claude/skills/zhiheng/`。
- Codex：删掉 `config.toml` 里的 `[mcp_servers.zhiheng]` 一段，删除 `~/.codex/skills/zhiheng/`。
- 网页「账号与安全 → 个人访问令牌」里吊销对应令牌。

## 附：SKILL.md

````markdown
---
name: zhiheng
description: 通过 MCP 读写「知衡」个人健康工作台（餐食、运动、身体指标、饮水、就诊、报告、用药、服药、备忘、待办）。当用户想记录或查询自己的饮食、运动、体重/血压/血糖/睡眠/心率、喝水量、就诊/检查报告/用药/吃药，健康相关备忘或待办，或问「我今天喝了多少水」「这周运动了几次」时使用。写入前必须向用户确认。
---

# 知衡（Zhiheng）

知衡是用户的个人健康工作台（https://vivid-dream.online）。里面是**真实的个人健康数据**，请谨慎对待。

## 连接

- MCP 端点：`https://vivid-dream.online/mcp`（Streamable HTTP，JSON 响应）
- 认证：`Authorization: Bearer $ZHIHENG_TOKEN`。令牌由用户在网页「账号与安全 → 个人访问令牌」生成，从环境变量读取。
- **永远不要打印、回显、记录或要求用户把令牌贴到对话里。** 没有令牌时，告诉用户去网页生成并设置环境变量。

## 工具选择

| 用户意图 | 工具 |
|---|---|
| 有哪些工作台/空间、能写什么 | `list_workbenches` |
| 「今天怎么样」「今天喝了多少水」「今天吃了什么」 | `get_today` |
| 某段时间/某类记录（「上周的运动」「最近 10 次体重」） | `list_records`（`kind` + `from`/`to` + `limit`） |
| 记一条新的 | `create_record` |
| 改已有记录（「把早餐改成半碗」「那个待办完成了」） | 先 `list_records`/`get_today` 找到 `id`，再 `update_record` 只传要改的字段 |
| 删除（「把那条删了」） | 先找到 `id`，念出要删的内容并确认后 `delete_record`；30 天内可恢复 |
| 「刚才删错了」「最近删了什么」 | `list_deleted` → 确认后 `restore_record` |
| 收藏常用餐食/运动 | `create_record kind=favorite`（`targetKind` + `template`） |
| 新建/改名工作台 | `create_workbench` / `rename_workbench`（只能改自建的） |
| 饮水目标（「每天喝 2500 毫升」） | `get_settings` / `update_settings waterGoalMl` |

- 默认 `workbench: "health"`、`space: "personal"`（真实数据）。`demo` 是示例数据，只在用户明确要求时使用。
- 健康类（meal/exercise/metric/water/visit/report/medication/dose）只能写入 health 工作台；金融等其他工作台只能写 `note`（备忘）和 `task`（待办）。
- **附件只能看名字和类型**：报告的 `attachment`、餐食的 `attachments` 只有文件名和类型，读不到内容。不能上传、添加或更换附件（照片/语音/原件），请用户到网页操作。
- 不支持：附件内容、账号/密码/令牌。

## 日期与时间

- 一律使用 **Asia/Shanghai** 时区。`date` 为 `YYYY-MM-DD`，`time` 为 24 小时制 `HH:MM`。
- 「今天/昨天/上周」按上海时间换算（一周从周一开始）；不确定当前日期时，先调 `get_today` 或 `list_workbenches` 读取服务端的 `today`。
- 新建时不填 `date` 默认今天。`time` 可选：**用户没说时间就不填**，确认里只说「今天」；用户说「刚才/刚刚」可填当前时间，并在确认里写出来。不要编造时间。
- **不能记未来日期**（餐食/运动/指标/饮水/服药）；就诊、报告、用药的日期可以是未来（与网页一致）：用户说的日期在今天之后，先问「11月2日还没到，是不是想记今天？」。服务端也会拒绝（`future_date`）。待办可以是未来日期。
- `list_records` 的 `from`/`to` 都包含当天。

## 各类型字段与单位（与网页校验一致）

- **meal 餐食**：`title`（吃了什么，必填）、`mealType`（早餐/午餐/晚餐/加餐）、`portion`（份量，如「一碗」）、`rawText`（用户原话，可选）、`note`。
- **exercise 运动**：`title`（必填）、`type`（跑步/步行/力量训练…）、`duration` **分钟**（必填，0<x≤1440）、`distance` **公里**（可选，0<x≤1000）、`feeling`（轻松/适中/吃力/不适）、`exercises`（力量动作数组：`name`、`sets` 组 1–100、`reps` 次 1–500、`weight` 公斤 0–1000，最多 30 个）。
- **metric 身体指标**：`title`（必填）、`type` + `value`，单位由服务端按 type 自动填写：
  - `weight` 体重 kg
  - `pressure` 血压 mmHg：`value`=收缩压，`secondary`=舒张压（必填，且低于收缩压）
  - `glucose` 血糖 mmol/L
  - `sleep` 睡眠 小时
  - `heart` 心率 次/分
  - `value` 需 >0 且 ≤10000。用户给的单位不同（如斤、mg/dL）时，换算后在确认中说明，或请用户确认。
- **water 饮水**：`volume` **毫升**（必填，0<x≤5000），`title` 可省略（默认「饮水记录」）。「一杯」不明确时问用户大概多少毫升（常见 250ml）。
- **note = 界面上的「备忘」**：`title`（必填）、`note`、`category`。
- **task = 界面上的「待办」**：`title`（必填）、`date`、`time`、`category`、`done`（布尔）。

- **visit 就诊**：`title`（必填）、`hospital`、`department`、`status`（待就诊/已完成/待复查；不填时未来为待就诊、否则已完成）、`doctor`、`reason`、`assessment`（医生结论）、`instructions`（医嘱）。
- **report 报告**：`visitId`（必填）、`title`、`type`（就诊记录/检验报告/影像报告/处方/出院记录/其他）、`status`（待出报告/待补充/待核对/已归档）、`source`、`content`（原文和检查数值，可读可改，按原文录入，不解读）。
- **medication 用药**：`visitId`（必填）、`title`（药名）、`dosage`（单次用量）、`route`（途径）、`frequency`（频次）、`scheduleMode`（scheduled 按时/asNeeded 按需）、`times`（按时服用的时间列表）、`status`（进行中/已停用/已完成）、`date`（开始）、`endDate`、`prescriber`。
- **dose 服药**：`medicationId`（必填，先 `list_records kind=medication`）、`date`、`outcome`（已服用（默认）/跳过）、`time`（已服用时必填：实际服用时间）、`scheduledTime`（计划时段，可选）、`note`（跳过时必填：跳过原因）。改服药记录只能改结果、时间和备注。已服用必须有实际服用时间（用户没说就问「几点吃的？」），今天的服用时间不能晚于现在。

**先有就诊，再有报告和用药**：记报告或用药前先 `list_records kind=visit` 找到是哪次就诊（问用户确认）；没有就先建一条就诊记录（同样先确认），再记报告/用药。

**用药/服药必须念一遍**：写入 medication 或 dose（新建或修改）前，把**药名、剂量、时间**完整念一遍——例：「记一次服药：示例药 A，1 片，今天 08:05 已服用（健康），对吗？」——**用户回「对」才写**；「好/嗯」等含糊回答再问一次「药名、剂量、时间都对吗？」。

**记「跳过」**：先问「这次为什么没吃？」，拿到原因后念一遍**药名、计划服用时间、跳过原因**——例：「记一次跳过：示例药 A，今天 08:00 那次，原因：胃不舒服（健康），对吗？」——**用户回「对」才写**，原因写进 `note`。不要替用户编原因。

`title` 1–120 字，`note` 最多 5000 字。

## 说话方式（总原则）

1. **短**：确认 1 行，成功 ≤2 句，汇总 ≤5 行。**不输出 JSON、id、`space`/`workbench` 原始值、字段名或任何内部字符串。**
2. 工作台说人话：用 `list_workbenches` 返回的 `name`（「健康」「金融」）；personal 不提；**`space` 为 `demo` 时必须标注「示例数据」**，不要把示例数据当真实数据汇报。
3. 单位紧跟数字不加空格：300ml、45分钟、5.2公里、62.5kg、128/82mmHg、5.6mmol/L、7.5小时、72次/分。
4. 时间说法（以服务端 `today` 为准）：今天 →「今天 08:30」；昨天 →「昨天（10月31日）21:10」；其他 →「10月28日（周三）19:00」；跨年加年份。没有 time 只说日期。
5. 不做医疗判断，不给用药建议，不解读报告数值。用户问「今天吃药了吗」：`list_records kind=dose` 查今天的服药记录如实回答。

## 写入前确认（必须）

格式：`记一条{类型}：{日期时间}，{关键内容}（{工作台}），可以吗？`；用户回复「好/可以/对/嗯/是」才写，其他回复视为修改或取消。

- 记一条饮水：今天 10:30，300ml（健康），可以吗？
- 记一条运动：昨天（10月31日）19:00，跑步 30分钟 · 5公里 · 感受适中（健康），可以吗？
- 记一条血压：今天 07:30，128/82mmHg（健康），可以吗？
- 加一条待办：11月5日（周四）09:00「预约体检」（金融），可以吗？
- 单位换算写进确认：「你说 125 斤，我按 62.5kg 记，可以吗？」「血糖 101mg/dL ≈ 5.6mmol/L，按 5.6 记，可以吗？」
- 缺必填先问，不猜（运动时长、饮水量「一杯大概多少毫升？常见是 250ml」、血压只给了一个数）。
- 多条：列清单一次确认，再逐条写入。
- 修改：`把{日期时间}的{类型}从{原值}改为{新值}，可以吗？`；待办完成：「把待办『预约体检』标为已完成，可以吗？」

## 成功之后（≤2 句）

格式：`已记下：{内容}（{工作台}{·示例数据}）。{如何改}`
- 「已记下：今天 10:30 饮水 300ml（健康）。要改就告诉我，或在网页『今天』里点这条修改。」
- 「已修改：10月28日跑步 40分钟（原 30分钟）。」「已标为完成：预约体检。」
- 多条：「3 条都记好了（健康）。」部分失败：「记好 2 条，第 3 条没记上：{原因}。要改一下再试吗？」
- 不说「已写入数据库」「id 为…」。

## 查询结果怎么说

- `get_today`：「今天（11月1日）：饮水 1050ml / 2000ml（还差 950ml）；运动 30分钟；餐食 2 顿；未完成待办 1 项」。全为 0：「今天还没有记录。要记点什么吗？」目标用返回的 `goalMl`，不要写死。
- `list_records`：先结论后明细，明细最多 5 条，每条一行；`total > returned` 时说「只显示最近 {returned} 条，共 {total} 条」；空结果：「这段时间没有{类型}记录。」饮水汇总只念量，不念默认标题「饮水记录」。

## 来自 AI 助手的标记

通过你新建或修改的记录，网页上会显示小标签「来自 AI 助手」和最后一次 AI 修改时间。这是服务端自动加的，不需要也不能自己设置。

## 删除与恢复

- 删除前必须念一遍：「删除{日期时间}的{类型}：{名称和关键数值}（{工作台}），删除后 30 天内可以恢复。确定删除吗？」用户明确同意才调 `delete_record`。用药/服药同样念药名、剂量、时间，用户回「对」才删。
- 成功：「已删除：…。30 天内说『恢复』或在网页『我的 → 最近删除』里恢复。」
- 已有服药记录的用药方案不能删：转述原因，建议改成「已停用」（`update_record status=已停用`，先确认）。删除就诊不会删掉它的报告和用药。
- 恢复：`list_deleted` 找到 → 说明要恢复哪条并确认 → `restore_record`。`parent_deleted`：问「所属就诊（或用药方案）也已删除，一起恢复？」同意后 `restore_record` 带 `withParent: true`。`parent_missing`：「它所属的记录已经不在了，没法恢复。」
- 就诊被删后，报告/用药读到 `visit.deleted: true`：说「所属就诊已删除（可在最近删除恢复）」，不要当成错误。
- **绝不**用「改成 0」「标题改成已删除」等方式变相删除。

## 错误处理

按 `code` 判断（工具错误在 `structuredContent.error.code`，HTTP 401 在正文 `code`，JSON-RPC 错误在 `error.data.code`），不要解析文案；错误文案是给用户看的中文，可直接转述，但不要转述原始 JSON。

| code / 情况 | 对用户说 | 重试 |
|---|---|---|
| `token_missing`（401，没带令牌：没有 Authorization 头或不是 Bearer 方式） | 还没连上知衡：请在网页「账号与安全 → 个人访问令牌」生成一个，设为 ZHIHENG_TOKEN 后重启我。 | **不重试**，停止知衡操作 |
| `token_invalid`（401，带了 Bearer 但令牌不对：格式错误/为空/已撤销） | 知衡的访问令牌不对或已失效（可能复制不完整、被吊销或改过密码），请在网页重新生成并更新 ZHIHENG_TOKEN。 | **不重试** |
| `token_forbidden`（401，MCP 带 Cookie） | 连接方式不对，请用访问令牌连接。 | 不重试 |
| `token_forbidden`（403，令牌访问账号与安全等接口） | 这个操作要在网页上做。 | 不重试 |
| `rate_limited`（429） | 刚才操作太频繁，我等一会儿再试。 | 等 `Retry-After` 秒后**重试 1 次**；仍失败就告诉用户稍后再说 |
| `validation_failed` | 转述原因并问缺的/错的信息（例：「内容格式不对」「时间格式不对，例如 08:30」） | 修正后**重新向用户确认**再试 |
| `payload_too_large`（413） | 内容太长了，分几条记吧。 | 拆成几条、**逐条重新确认**后再写 |
| `future_date` | 「{日期}还没到，是不是想记今天？」 | 用户确认日期后再试 |
| `forbidden_kind` | 例：「金融工作台只能记备忘和待办。这条饮水记到健康工作台可以吗？」；不支持修改的类型 → 请到网页操作 | 修正后（再确认） |
| `not_found`（就诊/用药方案） | 「没找到要关联的那次就诊」→ 按 `hint` 先 `list_records kind=visit`（或 medication）让用户选，没有就先建就诊 | 选好后再确认 |
| `not_found` | 工作台：「没有找到这个工作台，请从你的工作台里选一个」，并按 `error.hint`（「用 list_workbenches 获取可用工作台」）调 `list_workbenches`，用 `name` 列出可选工作台；`hint` 只给助手看，**不要转述工具名**。记录：「没找到这条记录，可能已在网页删除。我重新查一下。」 | 先 `list_workbenches`/`list_records` |
| `internal_error`（500）/ 网络超时 | 「知衡那边出错了，这条**可能没记上**，我先查一下。」 | 写入类：**先用 `list_records` 查是否已写入**，确认没写入才重试 1 次；读取类可直接重试 1 次 |
| `mcp_disabled`（404） | 知衡还没开启助手连接，暂时用不了，请在网页上操作。 | **不重试** |
| `unknown_tool`（JSON-RPC） | 我这边调用出了问题，没有记上。 | **不重试**；只用 tools/list 返回的工具 |
| 其他协议错误：`method_not_allowed`（405）/ `unsupported_media_type`（415）/ `unsupported_protocol_version`（400） | 「知衡的连接配置有问题，这次没有记上，需要检查一下连接设置。」 | **不重试**（客户端配置问题，重试不会成功） |

## 示例

**1. 「我今天喝了多少水？」**
→ `get_today {}` → 「今天已喝 {已喝}ml，目标 {goalMl}ml，还差 {goalMl − 已喝}ml。」
（目标数字来自 `get_today` 返回的 `goalMl`，还差 = goalMl − 今天已喝，不要写死 2000ml；例如 goalMl=2000、已喝 750 时说「今天已喝 750ml，目标 2000ml，还差 1250ml。」已达标时说「今天已喝 {已喝}ml，目标 {goalMl}ml 已达成。」）

**2. 「刚喝了一杯水，大概 300 毫升」**（没说具体时间）
→ 确认：「记一条饮水：今天，300ml（健康），可以吗？」 → 用户同意 →
`create_record {"kind":"water","volume":300}`（不编造 time；如果想记「刚才」的时间，就在确认里写出当前时间）
→ 「已记下：今天饮水 300ml（健康）。要改就告诉我，或在网页『今天』里点这条修改。」

**3. 「早上量的血压 128/82，记一下」**
→ 时间不明确：先问「大概几点量的？不记时间也可以。」用户说 7 点半 →
确认：「记一条血压：今天 07:30，128/82mmHg（健康），可以吗？」 → 同意 →
`create_record {"kind":"metric","type":"pressure","title":"晨间血压","value":128,"secondary":82,"time":"07:30"}`

**4. 「上周跑了几次步？把周三那次改成 40 分钟」**（今天是 2026-11-01 周日）
→ 上周 = 10月19日（周一）–10月25日（周日）：`list_records {"kind":"exercise","from":"2026-10-19","to":"2026-10-25"}` →
「上周（10月19日–25日）跑步 3 次，共 95分钟。」→ 找到 10月21日（周三）那条 →
确认：「把10月21日（周三）的跑步时长从 30分钟改为 40分钟，可以吗？」 → 同意 →
`update_record {"id":"<从 list_records 取得>","duration":40}` → 「已修改：10月21日跑步 40分钟（原 30分钟）。」
（若用户说「这周」，则是 10月26日（周一）–11月1日（周日）。）
````
