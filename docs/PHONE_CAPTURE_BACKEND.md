# 手机采集后端

实现者：`/root/capture_backend`。接口约定见 [PHONE_CAPTURE.md](PHONE_CAPTURE.md)。仅本地隔离测试使用虚构账号、通知和步数；不访问真实银行、账单或健康数据。

所有接口必须启用账号功能并登录，Cookie、原生会话 Bearer 和现有个人访问令牌均沿用数据 API 权限。请求头 `X-Workbench-Owner` 必须等于当前账号 ID，GET 也检查；所有成功响应附 `owner`。POST 沿用 Host、Origin、JSON 和会话校验，并在读完请求体后再次检查会话与账号。仅 `space=personal` 和内置 `finance` / `health` 工作台可用；错误空间/工作台返回 403。未登录/失效会话为 401，旧账号绑定为 409 `workbench_owner_changed`。

## 交易通知

- `GET /api/capture?workbench=finance&space=personal&limit=100&offset=0&status=pending`。`status` 可省略或为 `pending`、`confirmed`、`ignored`；`limit` 1–200，`offset` 0–100000。返回 `{owner,events,stats:{pending,confirmed,ignored},limit,offset,total,status?,supportedApps}`。`total` 为筛选后的数量，`stats` 始终为当前账号全部通知的状态数量。
- `POST /api/capture/notifications?workbench=finance&space=personal`：`{deviceId,eventId,packageName,title,text,postedAt}`。新通知返回 201 `{owner,event,duplicate:false}`，重试返回 200 `{owner,event,duplicate:true}`。`postedAt` 必须为真实且带时区的 ISO 时间。设备标识最多 100 字符、事件标识 250、标题 250、正文 4000；整个请求最多 64 KiB。
- `event` 包含 `{id,status,deviceId,eventId,packageName,title,text,postedAt,receivedAt,parsed,possibleDuplicateIds,transactionId?,transactionDeleted?}`。`parsed` 包含北京时间 `date`、建议 `title`、可选 `amount/currency/type`；多个不同金额时金额留空，收入与支出描述冲突时类型留空。转账和还款优先识别，支出/还款候选金额为负。解析值只是候选。
- `POST /api/capture/events/:id/confirm?workbench=finance&space=personal`：必须显式给出 `title,date,amount,currency,transactionType`，金额必须为 JSON 有限数字。`transactionType` 支持现有流水的 `income/expense/transfer/buy/sell/dividend/fee/repayment/other`。可附现有流水字段，如 `accountId,assetId,note,time`；`status` 省略或为 `confirmed`。通过现有 `put` 验证日期、币种、金额与同账号同空间的资产关联；未来流水拒绝。返回 `{owner,event,transaction,duplicate}`。
- 确认在一个 SQLite `BEGIN IMMEDIATE` 事务中创建一条 `asset_transaction` 并写入回执；来源固定为 `手机交易通知`，外部编号为 `phone-notification:<event.id>`。不修改账户余额或持仓。重复确认返回原流水；若流水已删除，返回 `transaction:null` 和 `event.transactionDeleted:true`，不会重建；用户从最近删除恢复后仍关联原 ID。
- `POST /api/capture/events/:id/ignore?workbench=finance&space=personal`，空对象即可，返回 `{owner,event}`。重复忽略幂等；已忽略不可确认，已确认不可忽略（409）。

应用白名单由响应 `supportedApps:[{packageName,name}]` 返回，固定为支付宝、微信支付、云闪付、招商银行、工商银行、中国银行、建设银行、农业银行。服务端必须同时满足交易关键词和明确币种金额格式；验证码、私聊特征、营销文本和控制字符直接 400 `notification_filtered`，不会存储。微信只接收固定支付服务标题；支付宝也限制为支付/到账/还款等服务标题，防止好友聊天同样包含金额。

同账号、设备和事件标识有数据库唯一约束。较新或同时间的通知更新可补全 pending 内容；confirmed/ignored 的原文和关联流水保持不变。相同事件标识不能改为另一应用。`possibleDuplicateIds` 比较同日原币种相同绝对金额，最多提示 50 个其他通知或现有流水 ID；不会合并、自动忽略或阻止用户确认。该提示可能有误报，仍需人工核对。

## Health Connect 步数

- `GET /api/capture?workbench=health&space=personal` 返回 `{owner,steps,latestStep,supportedApps}`。最多返回最近 200 条步数，包含手工与 Health Connect 记录；`steps` 条目形状为 `{id,date,value,unit:"步",source,observedAt?,deviceId?}`，手工来源显示为 `manual`。日期倒序，同日优先 Health Connect，再按观测时间倒序；`latestStep` 采用相同规则，无记录时为 null。
- `POST /api/capture/steps?workbench=health&space=personal`：`{deviceId,source:"health-connect",records:[{date,steps,observedAt}]}`；每批 1–100 条。返回 `{owner,updated,results:[{date,id,status}],steps,latestStep}`；`results.status` 为 `created/updated/unchanged/deleted/modified`。
- `date` 必须为真实 `YYYY-MM-DD` 且不晚于北京时间今天。`steps` 为 JSON 整数 0–200000，0 是真实值；空批次不等于 0。`observedAt` 必须为带时区 ISO 时间，不晚于服务端现在，且不早于该北京时间日期的零点。所有输入先验证，再在一个 SQLite 事务中更新整批。
- 保存为健康 `metric/type=steps/unit=步`，保留 `source/deviceId/observedAt`。独立收据表以 `(账号空间,日期,health-connect)` 为键，因此同日跨设备是替换而非相加；相同或更旧观测时间不覆盖新值。手工记录不改写、不相加。
- 步数删除后收据仍保留，任何重试不会复活已删除记录；可通过现有最近删除恢复同一 ID，随后更新仍沿用该 ID。收据所指记录若已被手工改成其他种类/日期/来源，采集会返回 `modified`，避免覆盖。通知确认收据同样不会因流水删除或回收站过期而遗失。

## 其他授权健康记录

`POST /api/capture/health?workbench=health&space=personal` 接收 `{deviceId,source:"health-connect",records:[{sourceId,kind,date,observedAt,...}]}`；1–100 条/批，64 KiB 上限，返回 `{owner,updated,results,steps,latestStep,healthRecords}`。`results` 每项为 `{sourceId,kind,date,id,status}`，状态与步数同步相同。旧 `/steps` 接口保持独立。

| kind | 必填数值和单位 | 保存的现有记录 |
| --- | --- | --- |
| `weight` | `value`，kg，>0 且 ≤1000 | `metric/type=weight/unit=kg` |
| `resting_heart_rate` | `value`，次/分，20–300 整数 | `metric/type=heart/unit=次/分`，名称「静息心率」 |
| `sleep` | `value`，小时，>0 且 ≤24 | `metric/type=sleep/unit=小时` |
| `exercise` | `startAt/endAt` 带时区 ISO、`durationMinutes` >0 且 ≤1440、`exerciseType` 非空中文/人类名称，`distanceKm` 可选 >0 且 ≤1000 | `exercise`，分钟和公里，保留起止时间 |

数值必须为有限 JSON 数字，不接受数字字符串。如果额外发送指标 `unit`，必须与表中规定的单位一致；运动单位由字段名明确。运动时长为 Health Connect 汇总的有效运动分钟，可小于起止经过时长（暂停不计）；不能超过起止区间（容差 1 分钟），结束不能晚于 `observedAt`，日期必须等于开始时间的北京时间日期。指标日期与观测时间仍受过去/今天、不未来、不早于记录日期零点的约束。体重/静息心率由客户端以测量的北京时间日期归组、每日最新测量上传；睡眠由客户端按结束日聚合，以小时上传，不附运动用起止时间。

体重和静息心率可带 `time`，为原始测量的北京时间，使用 24 小时制 `HH:mm`（`00:00` 至 `23:59`），保存到标准记录的 `time`。按观测时间胜出的记录缺少 `time` 时，保存为时间未知，同一 `sourceId` 也适用。旧客户端可省略该字段，服务端只用 `observedAt` 决定同步顺序。

每日指标以 `(空间,kind,日期)` 为持久幂等键，`sourceId` 可随当日最新测量变化；运动以 `(空间,sourceId)` 为键。保存并返回 `source/sourceId/deviceId/observedAt`；不相加，不覆盖手工记录，旧观测不覆盖新值，删除不复活。`GET /api/capture` 健康响应新增 `healthRecords`，为最近最多 200 条非步数 Health Connect 标准 `metric/exercise` 记录；普通 `/api/state` 也能读取这些记录。

普通 PUT 编辑会按既有记录的完整字段校验并保留采集元数据，允许按现有编辑流程修改记录。采集回执仍绑定原来的日期、类型与 ID；如果用户把日期、类型或来源改为另一含义，后续较新的采集返回 `modified` 并保留该手工调整。未改日期/类型/来源时，更新的真实源数据仍按观测时间替换原采集值。这是有意避免用户调整被后台重新归类的行为。

## 验证和边界

`tests/capture-backend.test.mjs` 的 13 组集成测试覆盖登录/Origin/owner/空间隔离、敏感通知排除、并发重试、通知更新、确认字段与引用验证、幂等确认/忽略、删除恢复、跨渠道提示、跨设备步数和每日体重/静息心率/睡眠/运动、手工记录保留、日期/单位/数值/0/未来时间边界、整批原子性、服务重启、读请求体期间撤销会话。与原有 access-tokens/assets-backend/date-validation/daily-features 回归共 39 项通过（Node 24.20.0，2026-11-05）。独立验收另由独立代理执行。

白名单与通知服务标题过滤有意保守，未知模板可能不采集；通知金额和类型不代表已核实交易。服务端接收的是用户授权客户端提交的数据，不能从 HTTP 内容证明系统通知或 Health Connect 原始记录的真实性。手机权限、真实应用通知模板和 Health Connect 数据可用性仍须设备验证。

后续运动暂停语义修正：`/root` 根据独立评审将时长校验改为有效运动分钟不超过起止区间，新增暂停回归；安卓使用 `EXERCISE_DURATION_TOTAL`，不以经过时长补缺。

运动可附 `sourcePackage`（Android 应用包名）用于来源追溯；仅接受合法包名。距离后续授权/补写时由较新观测补全；新快照省略距离不会清空已采集的距离，显式新距离会更新。
