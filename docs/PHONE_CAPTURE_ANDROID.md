# 安卓手机采集实现与验证

开发工程师：`/root/android_capture`；独立验收由 `/root/capture_acceptance` 承接。接口与AC见 [PHONE_CAPTURE.md](PHONE_CAPTURE.md)。

## 安装与使用

测试包版本 `0.7.3 (703)`、包名 `dev.awesome.myworkbench.debug`，Android 8+ 可安装。Debug 包独立安装，需要在该App内重新登录，不共享正式包 Cookie。未提供生产签名升级包，不读取或导出签名凭据。

1. 打开App登录 vivid-dream.online。菜单 → 手机采集设置，或网页可信路径 `/app/collectors`。
2. 点击“绑定当前登录账号”。核对原生页面账号，再打开所需数据源；默认暂停、通知/步数/睡眠/体重/静息心率/运动/距离/后台/所有应用均关闭。
3. 通知：打开系统“通知使用权”，打开“采集新交易通知”，逐项选择应用。仅处理此后新通知；不会扫描通知历史。部分系统对侧载App先要求在App信息允许“受限设置”。
4. 健康：每项单独打开开关，再点其授权按钮，只申请对应读取权限。步数、睡眠、体重、静息心率、运动均可选；运动距离额外单独授权。数据来源应用须已向 Health Connect 写入相应记录。
5. 手动同步后查看队列数量、最后成功、失败原因和步数状态。原生按钮打开资产待核对或健康步数结果；网页功能需配套服务端版本。
6. 暂停停止后续采集和上传；恢复需重新绑定当前登录账号。系统权限可随时撤销。清理本机队列需确认，不影响服务器记录。

## 支持范围与边界

| 系统/能力 | 实现行为 |
| --- | --- |
| Android 8 / API 26–27 | 通知可用；Health Connect 明确显示不可用 |
| Android 9–13 / API 28–33 | Jetpack Health Connect 1.1.0 对接独立 Health Connect App；未安装或需更新时提示。无后台健康读取能力时仅打开App/手动读取 |
| Android 14+ / API 34+ | 对接系统 Health Connect；后台读取仅在能力检测可用且用户另行开启、授权后执行 |
| 后台通知/队列 | NotificationListenerService + 持久化 SQLite + JobScheduler；联网时单次重试，按系统调度周期性重试。系统省电/厂商限制可延迟任务，无实时保证 |
| 工作资料/不支持的设备 | Health Connect 可用性检查失败时提示，不伪造步数 |

Health Connect 最近7天按 `Asia/Shanghai` 的起止时间逐日 `aggregate(StepsRecord.COUNT_TOTAL)`，接受系统来源优先级去重，不读原始记录相加。`null` 无数据跳过，明确返回 `0` 则同步0。同日排队快照替换旧快照，不累加。只申请用户选择类型的只读权限与可选后台健康读取，不申请健康写入、历史读取、路线或传感器权限。

可选健康数据通过 `/api/capture/health?workbench=health&space=personal` 独立上传，`kind` 为 `weight|resting_heart_rate|sleep|exercise`：

- 体重：`WeightRecord`，按北京时间每日选最新测量，单位kg，保留metadata.id；同时间以原始修改时间为后序。
- 静息心率：只认 `RestingHeartRateRecord`，按日最新，整数次/分；不使用普通 `HeartRateRecord` 冒充。
- 睡眠：读近期session，先全局合并重叠区间（包括不同来源结束于午夜两侧），按合并区间结束日归组，再对每个不重叠区间请求系统 `SLEEP_DURATION_TOTAL` 聚合，同日相加。AOSP聚合排除已标记的awake、out-of-bed和awake-in-bed；无阶段数据时依赖来源session时间，不推断清醒。上传小时、稳定daily sourceId=`sleep:日期`；无数据跳过，不造0。系统来源优先级仍控制聚合。
- 运动：仅同步选定单一来源；首次发现只有1个来源自动选择，多来源要求在原生设置单选后才入队。来源显示App名/包名，换账号清空当前来源与授权开关，但按owner私有保留最后来源与切换截止历史，回访旧账号选择新来源仍应用截止线，旧队列上传也核对当前来源。首次选源可回补最近7天；更换来源持久记录切换时刻，仅同步之后新开始的运动，不回补新来源历史。旧来源或切换前开始的队列停止上传，已同步历史保留。清应用数据、重装或新设备没有本机来源历史时可能再次回补最近7天，需在健康工作台核对已有运动记录；本轮不做跨设备来源历史迁移。每条 `ExerciseSessionRecord` 独立，metadata.id作sourceId，上传真实类型与起止时间；分钟数采用同来源、会话区间的系统 `EXERCISE_DURATION_TOTAL` 聚合，不用起止时间差代替。聚合缺值或非正值时跳过并显示无有效时长，不凭空推断暂停。常见类型转中文，其他保留类型代码；不读取路线。可选距离只聚合该session来源在同一时间区间的DistanceRecord，缺值不填0，这属于来源区间距离，不能保证只包含该次运动。

每日指标按来源+类型+日期更新，运动按session幂等，不覆盖手工记录。服务端对极端/非法值拒绝；客户端也限制值和分页大小，类型读取失败有独立状态。

通知应用白名单：支付宝、微信、云闪付、招商银行、工商银行、中国银行、建设银行、农业银行。每个应用默认不选。必须同时匹配交易词和金额；拒绝消息类别、MessagingStyle、验证码/密码、聊天/营销词，支付宝/微信还要求固定通知标题模板。过滤失败内容不入队、不打日志。此保守规则可能漏收通知；不会据通知自动生成正式流水。

## 数据与账号保护

- 无 JavaScript 原生桥；只拦截固定 HTTPS origin 的 `/app/collectors` 主框架导航，外站路径不能启动原生采集配置。
- 原生请求只发往 `https://vivid-dream.online`，固定 `Origin`，沿用 CookieManager Cookie。启用先 GET `/api/auth/me` 绑定真实账号；读写均附 `X-Workbench-Owner`。
- 每次同步先重新核实账号；上传批次固定 Cookie 快照，并在每条请求前核对 Cookie 未变化。401/409 持久暂停；需要重新绑定。切换账号重置数据源与应用选择，不发送另一账号队列。
- SQLite 在App私有目录且禁止系统备份，按 owner 查询；队列上限2000，满时显示错误而不静默淘汰。可清理当前绑定账号队列，卸载清理全部本地数据。
- 通知 eventId 是设备、通知标识、时间及内容的 SHA-256，重试保持相同；服务端进一步幂等和过滤。400/403/413/422 拒绝项停止自动重试并显示计数，404表示服务端采集接口可能尚未部署，提示服务器未支持并保留待上传队列，部署后可正常重试；网络/限流/服务端故障同样保留重试。
- 已选择应用后再关闭该应用，不再收新通知；此前已入队数据保留但暂停上传，重新选择后才会发送，也可手动清理。关闭任一健康数据源或撤销对应读取权限停止其队列上传；关闭距离开关或撤销距离权限会在上传前移除已排队distanceKm字段。
- 数据源暂停/权限撤销不能撤回已经发出的请求，服务器已收到记录在工作台管理。

## 构建与可重复检查

依赖：Android SDK 36、JDK17+、Gradle 9.3.1 / AGP9.1.0。AGP9 内置 Kotlin；不额外安装 Kotlin 插件。使用官方 Maven AndroidX Health Connect 稳定版1.1.0。

```sh
JAVA_HOME=/path/to/jdk17/Contents/Home ANDROID_HOME=/path/to/Android/sdk ./scripts/build-android-debug.sh
```

输出：

- `android/app/build/outputs/apk/debug/app-debug.apk`
- `android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`
- `android/app/build/reports/tests/testDebugUnitTest/index.html`
- `android/app/build/reports/lint-results-debug.html`

独立隔离AVD上的instrumentation（**会清理该测试App的采集队列与配置，只用测试模拟器，不能在用户私人手机执行**）：

```sh
adb -s emulator-XXXX install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-XXXX install -r android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s emulator-XXXX shell am instrument -w dev.awesome.myworkbench.debug.test/androidx.test.runner.AndroidJUnitRunner
```

`CaptureFilterTest` 覆盖合法付款、微信/支付宝私聊、验证码、营销、不含金额与未知包。`CaptureIsolationTest`（10项）以虚构数据验证重开队列持久化、owner隔离、源关闭不取队列、幂等、拒绝不重试、日步数快照更新含明确0、默认开关关闭及换账号清除授权、取消应用选择/撤销权限时暂停旧队列、距离撤权移除待上传字段、跨午夜重叠睡眠区间合并、运动队列单来源限制及切换来源的回补截止线、未部署端点404保留队列并在200后出队、A→B→A账号回访保留来源历史而不恢复授权。模拟库测试不等同真实 Health Connect 聚合或真实银行系统通知验证。

待设备验证：Android9–13独立Health Connect授权、Android14+模块授权和多来源聚合、真实0步/无数据、可选后台授权、实际金融应用通知模板、厂商省电下重启与联网重试、真实失效登录和账号切换、已部署服务端端到端写入。不得用作者构建成功冒充这些真机验收。

## 工程自测与交接

2026-11-05，JDK17 / SDK36：Debug APK、androidTest APK、Filter JUnit（3/3）、lintDebug构建通过。最终工程检查为 lint 0 errors / 49 warnings，APK v2签名验证通过。

最终冻结包（0.7.3/703）的SHA-256：

- 主包 `1f4148b63827cf67e67881f528fe79cb2477233c841ba02f19c4bd711c0ddc6e`
- 测试包 `1dc9d21afff60e614236c77ae67f5271fea3e15acf95c49fa31d01f4a78f3753`

独立API34 AVD首轮发现SQLite绑定文本布尔值与整数比较导致队列无法读取；已修复为文本比较，必须在最终APK上复测，不沿用首轮结论。

当前源码为共享工作树的未提交变更，由root统一集成；源码版本/最终APK SHA-256及独立验收结果见协调方最终交接记录。没有在已连接的私人手机上安装或授予采集权限。

## 官方接口依据

- [Health Connect 接入、平台版本与权限](https://developer.android.com/health-and-fitness/health-connect/get-started)
- [Health Connect 聚合与无数据返回](https://developer.android.com/health-and-fitness/health-connect/aggregate-data)
- [Health Connect 稳定版版本记录](https://developer.android.com/jetpack/androidx/releases/health-connect)
- [NotificationListenerService](https://developer.android.com/reference/android/service/notification/NotificationListenerService)
- [AGP 内置 Kotlin](https://developer.android.com/build/migrate-to-built-in-kotlin)

- [AOSP睡眠时长排除清醒阶段定义](https://android.googlesource.com/platform/prebuilts/fullsdk/sources/+/refs/heads/androidx-media-release/android-34/android/health/connect/datatypes/SleepSessionRecord.java)
