---
name: zhiheng
description: 通过 MCP 读写「知衡」个人健康工作台（餐食、运动、身体指标、饮水、备忘、待办）。当用户想记录或查询自己的饮食、运动、体重/血压/血糖/睡眠/心率、喝水量、健康相关备忘或待办，或问“我今天喝了多少水”“这周运动了几次”时使用。写入前必须向用户确认。
---

# 知衡（Zhiheng）

知衡是用户的个人健康工作台（https://vivid-dream.online）。里面是**真实的个人健康数据**，请谨慎对待。

## 连接

- MCP 端点：`https://vivid-dream.online/mcp`（Streamable HTTP，JSON 响应）
- 认证：`Authorization: Bearer $ZHIHENG_TOKEN`。令牌由用户在网页「账号与安全 → 访问令牌」生成，从环境变量读取。
- **永远不要打印、回显、记录或要求用户把令牌贴到对话里。** 没有令牌时，告诉用户去网页生成并设置环境变量。
- 收到 401：令牌缺失、无效或已被撤销 → 请用户重新生成，不要重试猜测。429：稍后再试。

## 工具选择

| 用户意图 | 工具 |
|---|---|
| 有哪些工作台/空间、能写什么 | `list_workbenches` |
| “今天怎么样”“今天喝了多少水”“今天吃了什么” | `get_today` |
| 某段时间/某类记录（“上周的运动”“最近 10 次体重”） | `list_records`（`kind` + `from`/`to` + `limit`） |
| 记一条新的 | `create_record` |
| 改已有记录（“把早餐改成半碗”“那个待办完成了”） | 先 `list_records`/`get_today` 找到 `id`，再 `update_record` 只传要改的字段 |
| 删除 | **没有删除工具。** 告诉用户到网页上删除 |

- 默认 `workbench: "health"`、`space: "personal"`（真实数据）。`demo` 是示例数据，只在用户明确要求时使用。
- 健康类（meal/exercise/metric/water）只能写入 health 工作台；金融等其他工作台只能写 `note`（备忘）和 `task`（待办）。
- 不支持：附件/照片/语音、就医、报告、用药、服药记录。用户提到这些时，说明需要在网页上操作。

## 日期与时间

- 一律使用 **Asia/Shanghai** 时区。`date` 为 `YYYY-MM-DD`，`time` 为 24 小时制 `HH:MM`。
- “今天/昨天/上周”按上海时间换算；不确定当前日期时，先调 `get_today` 或 `list_workbenches` 读取服务端的 `today`。
- 新建时不填 `date` 默认今天；`time` 可选，用户说了时间就填。
- `list_records` 的 `from`/`to` 都包含当天。

## 各类型字段与单位（与网页校验一致）

- **meal 餐食**：`title`（吃了什么，必填）、`mealType`（早餐/午餐/晚餐/加餐）、`portion`（份量，如“一碗”）、`rawText`（用户原话，可选）、`note`。
- **exercise 运动**：`title`（必填）、`type`（跑步/步行/力量训练…）、`duration` **分钟**（必填，0<x≤1440）、`distance` **公里**（可选，0<x≤1000）、`feeling`（轻松/适中/吃力/不适）、`exercises`（力量动作数组：`name`、`sets` 组 1–100、`reps` 次 1–500、`weight` 公斤 0–1000，最多 30 个）。
- **metric 身体指标**：`title`（必填）、`type` + `value`，单位由服务端按 type 自动填写：
  - `weight` 体重 kg
  - `pressure` 血压 mmHg：`value`=收缩压，`secondary`=舒张压（必填，且低于收缩压）
  - `glucose` 血糖 mmol/L
  - `sleep` 睡眠 小时
  - `heart` 心率 次/分
  - `value` 需 >0 且 ≤10000。用户给的单位不同（如斤、mg/dL）时，换算后在确认中说明，或请用户确认。
- **water 饮水**：`volume` **毫升**（必填，0<x≤5000），`title` 可省略（默认“饮水记录”）。“一杯”不明确时问用户大概多少毫升（常见 250ml）。
- **note 备忘**：`title`（必填）、`note`、`category`。
- **task 待办**：`title`（必填）、`date`、`time`、`category`、`done`（布尔）。

`title` 1–120 字，`note` 最多 5000 字。

## 写入规则（必须遵守）

1. **create_record / update_record 前一定先向用户确认。** 用一两句话复述将写入的内容：类型、日期时间、关键数值和单位、工作台；修改时说明“原来 → 改为”。用户明确同意后再调用。
2. 一次请求涉及多条记录时，列出清单一次确认，再逐条写入。
3. 不要猜测缺失的必填值（如运动时长、饮水量、血压的舒张压），先问。
4. 不对数据做医疗诊断或给出用药建议。

## 错误处理

- 工具结果 `isError: true`：`content[0].text` 是中文原因（如“运动时长需大于0且不超过1440分钟”“舒张压需大于0且低于收缩压”“此工作台…只能写入备忘与待办”）。向用户转述，修正参数后再确认、重试；不要静默改值。
- “记录不存在”：id 错误或不在该工作台/空间，重新 `list_records` 查找。
- JSON-RPC `error`：协议或参数结构问题，检查工具名与参数。

## 示例

**1. “我今天喝了多少水？”**
→ `get_today {}` → 回答 `summary.water.totalMl` / `goalMl`（如“已喝 750ml，目标 2000ml”）。

**2. “刚喝了一杯水，大概 300 毫升”**
→ 确认：“记一条饮水：今天 300ml（健康工作台），可以吗？” → 用户同意 →
`create_record {"kind":"water","volume":300,"time":"15:20"}`

**3. “早上量的血压 128/82，记一下”**
→ 确认：“记一条血压：今天 07:30，收缩压 128 / 舒张压 82 mmHg，可以吗？”（时间不明确就问或省略）→ 同意 →
`create_record {"kind":"metric","type":"pressure","title":"晨间血压","value":128,"secondary":82,"time":"07:30"}`

**4. “上周跑了几次步？把周三那次改成 40 分钟”**
→ `list_records {"kind":"exercise","from":"2026-10-26","to":"2026-11-01"}` → 汇总跑步次数 → 找到周三那条的 `id` →
确认：“把 10-28 慢跑的时长从 30 分钟改为 40 分钟，可以吗？” → 同意 →
`update_record {"id":"<id>","duration":40}`
