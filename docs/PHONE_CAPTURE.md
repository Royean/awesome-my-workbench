# 手机采集能力

协调/产品与界面：`/root`；Android 实现：`/root/android_capture`；后端实现：`/root/capture_backend`。后续独立评审与验收另记实际执行者。

## 目标与验收

- AC-01 在现有安卓工作台中开启采集，系统权限和每个数据源默认关闭；可暂停。
- AC-02 仅采集明确选择应用的交易通知；私人聊天、验证码等不发送。
- AC-03 通知进入资产工作台待核对，重试不重复；确认后才创建流水，不自动改账户余额或持仓。
- AC-04 离线队列持久化；重启后重试，失效登录和账号切换不把旧数据发给新账号。
- AC-05 经授权读取 Health Connect 汇总步数，以北京时间日期同步健康工作台；同日更新而非累加，支持 0 步，保留来源和同步时间。
- AC-06 网页有采集入口、待核对/已处理状态、步数结果；不支持的系统及权限失败有明确说明。
- AC-07 交付现有应用的可安装测试包、源代码、必要检查及明确的设备实测范围。
- AC-08 额外可选读取 Health Connect 睡眠、体重、静息心率与真实运动会话（时长/距离）；各项默认关闭、独立授权，保留来源，不把缺失写成 0，不将普通心率标为静息心率。

## 接口约定

所有接口沿用登录会话、账号数据范围、Origin 防护；读写均发送 `X-Workbench-Owner` 绑定采集启用时的用户 ID。安卓 HTTPS 请求发送固定本站 Origin，并沿用 CookieManager 中的登录 Cookie；不使用或新增万能采集密钥。所有采集仅写个人空间。

- `GET /api/capture?workbench=finance&space=personal` → `{events:[{id,status,packageName,title,text,postedAt,receivedAt,parsed:{amount,currency,type,date,title},possibleDuplicateIds:[],transactionId?}],stats:{pending,confirmed,ignored}}`。只返回当前账号的数据；有界分页/数量。
- `POST /api/capture/notifications?workbench=finance&space=personal`，JSON `{deviceId,eventId,packageName,title,text,postedAt}`；成功 `{event,duplicate}`。`postedAt` 为带时区 ISO 时间。服务端再次校验应用白名单、交易关键词及敏感信息过滤；不确定通知不进入账本。
- `POST /api/capture/events/:id/confirm?workbench=finance&space=personal`，用户核对后的合法 `asset_transaction` 字段 → `{event,transaction}`。幂等确认，已忽略项不确认，金额/类型不得凭不完整通知推断为已核实。
- `POST /api/capture/events/:id/ignore?workbench=finance&space=personal` → `{event}`；保留幂等去重。
- `GET /api/capture?workbench=health&space=personal` → `{steps:[{id,date,value,source,observedAt,deviceId}],latestStep}`。
- `POST /api/capture/steps?workbench=health&space=personal`，JSON `{deviceId,source:"health-connect",records:[{date,steps,observedAt}]}`；以健康指标 `metric/type=steps/unit=步` 同日更新，按来源和日期幂等，观测时间较旧不覆盖较新数据，不跨账号/演示空间。不与手工步数相加。

## 安卓集成

沿用 `dev.awesome.myworkbench` 应用；菜单和网页链接 `/app/collectors` 打开原生采集设置。该可信路径由原生导航拦截，不开放任意 Javascript 接口。网页可通过 UA `AwesomeMyWorkbench` 判断原生入口提示。开关、应用选择、登录绑定、权限、队列数量、最后成功和失败原因均在原生设置中可见。

Health Connect 用 aggregate 汇总而非原始记录相加；仅来源确实有数据时上传，不把“无数据”改写成 0。日期固定 Asia/Shanghai；支持范围、后台权限与系统限制如实显示。

用户追加授权后，健康采集扩为睡眠、体重、静息心率与运动会话。体重和静息心率按日保留最新原始测量；睡眠按结束日归组系统聚合；运动保持独立会话并可选读取同来源区间距离。`POST /api/capture/health?workbench=health&space=personal` 沿用 `{deviceId,source:"health-connect",records:[...]}`，每条带稳定 `sourceId`、`kind`、北京时间 `date`、带时区 `observedAt` 及指标或运动原始数值。同步幂等且不覆盖手工记录，旧观测不覆盖新观测，删除后不因重试复活。具体字段和类型见实现与后端文档。

## 本次边界

实现手机通知与步数采集链路；通知仅提供候选流水，不保证每个平台都发送完整交易通知。通知不能读取历史账单或证券持仓。不会擅自交易、自动改变账户余额，亦不在此次迁移私有财务主账。生产部署与主分支合并按当前授权另行执行。
