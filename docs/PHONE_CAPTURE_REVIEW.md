# 手机采集独立代码评审

实际评审者：另一位开发工程师 Agent `/root/capture_review`，未参与功能实现，仅新增本报告。作者为协调/网页 `/root`、Android `/root/android_capture`、后端 `/root/capture_backend`。独立测试验收由 `/root/capture_acceptance` 另记于 [PHONE_CAPTURE_ACCEPTANCE.md](PHONE_CAPTURE_ACCEPTANCE.md)。本报告不代表 GitHub 正式批准，不代替系统权限、真实数据源或私人真机验收。

评审依据：2026-11-05 读取的私人团队[开发工程师角色](https://github.com/Royean/personal-context-index/blob/main/agents/roles/developer/ROLE.md)、[代码项目开发协作规范](https://github.com/Royean/personal-context-index/blob/main/agents/workflows/software-development/README.md)、通用工作约定与跨角色协作，以及本项目 [PHONE_CAPTURE.md](PHONE_CAPTURE.md)、[PHONE_CAPTURE_BACKEND.md](PHONE_CAPTURE_BACKEND.md)、[PHONE_CAPTURE_ANDROID.md](PHONE_CAPTURE_ANDROID.md)。

## 版本与结论

- 基线：`eba883a34592f87cf8eed488634ce6c047bc0adf`。
- 对象：`/tmp/aw-finance-capture` 的实际未提交差异及新增文件，包含后端、网页、Android、测试、构建与新增 Android CI；不是仅阅读作者说明或测试结果。
- 最终结论：已复核下列五项问题的修复，包括404队列恢复和A→B→A账号回访的运动来源历史。当前代码评审范围内无仍待处理的可复现阻断缺陷，可进入协调者的提交/PR及独立验收交接。真实系统数据源、真实通知模板、后台限制等仍须按验收报告保留待验证。
- 源输入指纹：对相对基线的修改文件和未跟踪新增文件，排除 `docs/` 与生成目录 `public/assets/`，按路径排序后逐文件计算 SHA-256，组成 `hash␠␠path\n` 清单，共 37 文件；清单 SHA-256 为 `9ceb636b54ff7bde334736640c44590f273e514a64df7edf21d8481a2da5969c`。临时原始清单为 `/tmp/phone-capture-review-source-sha256.txt`。此指纹明确不覆盖后续验收报告修改；源码若变化应重新核对受影响结论。最终源提交由协调者提交后补入交接记录。
- 已独立核对最终交接 APK 字节 SHA-256：主APK `1f4148b63827cf67e67881f528fe79cb2477233c841ba02f19c4bd711c0ddc6e`，测试APK `1dc9d21afff60e614236c77ae67f5271fea3e15acf95c49fa31d01f4a78f3753`。本评审没有重新构建或操作设备，不据此宣称真机验证完成。

关键源文件 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `lib/capture.mjs` | `1424cd9c29d0849ba493c1c9e3170f02c7a77e127bcdde3c4dc5ec9034cf27ce` |
| `public/capture.js` | `10f88f6904b4f8f5e7ff776c9ab13e44ac695b47ee4db1cffccdf9b2e384219e` |
| `public/app.js` | `0cce658ec11a449545f8bc25ae7848ca9a9abf91a3b5a318ebb4987b86a107aa` |
| `CaptureHealthReader.kt` | `566575a57b07021f7bd9726e002c3b1ca5f87772f6b538d21d2c7f1bb8f75bf3` |
| `CaptureStore.kt` | `8adbb160dd076383188ad7d1d06c7f844bd9b6146281d03c4e754570dd31bfe7` |
| `CaptureUploadPolicy.kt` | `85a374799cf82547ddcaaf402487d5dc9b9d94dc7f1ff826627037bf995455a4` |
| `CaptureResponsePolicy.kt` | `0ff837232eaac2e11c5a1cd220f9d638554b64a82dd789b0c074774c1a2c769d` |
| `CaptureCoordinator.kt` | `1fdc2dfa2cb006bab48d40b40cccd077e371c8b9e910638fa41c9e1c3faeda3b` |

Android 文件均位于 `android/app/src/main/java/dev/awesome/myworkbench/`。

## 问题、影响与修复复核

| 编号 / 程度 | 最小复现与影响 | 修复与独立复核 |
| --- | --- | --- |
| CAP-CR-01 / P2 | 健康普通监测表单选择步数，填写 0 或其他整数并保存。旧 `saveRecord` 将 FormData 字符串原样发送，新严格步数验证要求 JSON number，导致新增及编辑均返回 400。 | `/root` 在 `public/app.js:163` 对步数值转 Number；`public/app.js:149` 继续保留 required、整数、0–200000 的输入限制。已阅读修复并核对后端严格类型/0边界；真实浏览器新增/编辑复测由独立验收负责。 |
| CAP-CR-02 / P2 | Health Connect 一条起止 30 分钟、其中暂停 10 分钟的会话。旧客户端直接上传端点差 30，后端又强制 duration 约等 elapsed，健康运动统计会把暂停算入；有效 20 分钟反而无法通过旧服务端校验。 | `CaptureHealthReader.kt:123–128` 改用同来源、会话区间的 `EXERCISE_DURATION_TOTAL`，缺失或非正/异常值跳过，无 elapsed 回退；`lib/capture.mjs:155–157` 接受小于经过区间的正有效时长。后端新增暂停用例已由本评审独立执行通过；真实 HC 聚合仍待有源设备验证。 |
| CAP-CR-03 / P2 | 先关闭运动距离同步会话，随后开启并授权距离。旧 observedAt 仅取 session end/lastModified，同一会话时间不变，服务器判 unchanged，距离永远无法后补；距离记录后补写也有相同问题。 | `CaptureHealthReader.kt:128` 改以本次读取时刻作为运动聚合观测时间，起止时间仍原样保留。另由 `/root` 修复“新快照缺少距离会抹掉已知距离”：`lib/capture.mjs:176–178` 在省略时保留之前距离，显式新距离仍更新。已用独立 SQLite 探针复现旧时间相同会跳过、推进时间可补全；最终后端“后补→撤权省略→再更新”回归已独立执行通过。 |
| CAP-CR-04 / P2 | 两款 tracker 把同一次运动写入 HC。逐条读取全部来源会创建两条标准 exercise，被既有首页同时求和；只限制每批单源后，A→B再回补过去7天仍会重复历史。账号A已用X来源，切B再回A后若忘掉A来源历史，首次选择Y也会重复历史。 | 协调者决定单一运动来源。`CaptureHealthReader.kt:111–121` 首次单源自动选择，多源未明确选定时暂停；`CaptureStore.kt:67–83` 保留上次来源，异源切换设截止线，覆盖“自动A→发现多源清空→手选B”；`CaptureUploadPolicy.kt:15–24` 再校验当前来源与会话开始时间。`CaptureSettingsActivity.kt:156–167` 明示切换只同步之后新开始的运动、历史保留。`CaptureStore.kt:119–128` 跨owner先保存各自lastSource/cutover，清除授权与当前来源，再载入目标owner历史；回访不会恢复授权，但能识别异源切换。已逐路径复核首次回补、再次异源切换、账号往返的隔离与截止线。作者新增的对应 instrumentation 由独立验收在最终 APK 上执行，不能把代码阅读称为设备通过。 |
| CAP-CR-05 / P2 | 在配套服务端尚未部署时先安装APK并采集，固定上传路径返回404。旧实现将其标记永久failed，部署完成后也不会从failed队列重试；用户只能清理并丢掉原通知。此项由协调者发现，评审者独立核对确认。 | `CaptureResponsePolicy.kt:5–16` 把404归为RETRY，不改SQLite状态，明确payload拒绝仍终态；`CaptureCoordinator.kt:107–123` 在实际上传调用该策略，并提示服务端尚未支持、队列已保留。已核对401/409仍暂停且保留队列，404进入重试，200才出队；新增404→200真实SQLite instrumentation由独立验收在最终APK复测。 |

运动聚合接口依据：[AndroidX ExerciseSessionRecord](https://developer.android.com/reference/androidx/health/connect/client/records/ExerciseSessionRecord)。API 提供总运动时长聚合；本评审不从端点差推断有效时长，也不以模拟聚合结果替代设备证据。

## 检查范围

- **鉴权和范围**：新接口沿用 Host、Origin、JSON、会话/PAT 验证；GET/POST 均要求 owner，读取请求体后重查会话。账号解析出的独立 scope 进入持久表，拒绝 demo/错误工作台；原生固定 HTTPS origin、Cookie 快照和 owner，每条上传前复查身份变化，不新增万能采集密钥或 JS bridge。
- **通知隐私及账本**：原生先按应用 opt-in、消息类别/模板/敏感词/金额过滤，服务端再次过滤且不落被拒内容；通知只创建 pending。人工确认显式验证字段，经同账号同空间引用校验，在 SQLite 事务中创建一条流水和回执；不改余额或持仓。ignore、确认重试、流水删除与恢复均保留稳定关系。不同通知的相似交易仅提示疑似重复，不推断已核实。
- **离线队列**：私有 SQLite、禁备份、owner 分区、唯一事件、日快照替换、有界容量；暂停/源关闭/应用取消选择/权限撤销在上传前再过滤，拒绝项停重试，网络类失败保留，401/409持久暂停。独立 QA 发现的 SQLite 文本布尔比较缺陷已复核为文本比较；本评审没有冒认发现者或模拟器执行者。
- **健康日期和单位**：北京时间窗口及服务端真实日期/带时区时间校验；步数系统 aggregate 且 null 跳过、明确0保留；体重/RHR按日最新原始测量，普通心率不冒充RHR；睡眠合并重叠区间后按结束日聚合；运动采用有效时长及同来源可选距离。每日指标/会话回执不覆盖手工记录，旧观测不覆盖新值，删除与垃圾箱过期后不复活；人工改类型/日期等语义时返回 modified。
- **网页状态与注入**：capture 请求绑定 owner，异步结果同时检查 scope、sequence、drawer/form 身份；换空间/工作台/账号清理状态；核对表单有未保存防丢，提交只启用一次，后端确认仍幂等。通知、来源和错误文本转义；用独立异步探针检查了关闭后迟到响应、账号切换、请求乱序、cleanup失效和恶意HTML转义。新样式已独立命名为 `phone-capture-*`，避免与既有 quick capture 冲突；自定义首页保留步数入口。最终观测时间文案已改为“数据更新于”，不把本次读取时间冒充原始测量时间。
- **构建/CI及生成文件**：阅读新增依赖、Manifest权限/组件导出边界、构建脚本与 `.github/workflows/android.yml`。CI只需读取仓库权限，构建 debug APK/androidTest/JUnit/lint，附源提交和校验和，不使用 release 凭据；未实际执行远端 Actions。当前 index 引用的 CSS/JS 内容哈希与文件名均独立核对匹配；生成文件由既有构建器及缓存回归覆盖。

## 本评审实际执行的验证

环境：Node `v24.20.0`，路径 `/opt/homebrew/opt/node@24/bin/node`。仅临时 SQLite、虚构账号/通知/健康数值与本机测试端口；未访问生产服务、用户数据库或物理设备。

```sh
/opt/homebrew/opt/node@24/bin/node --test --test-concurrency=1 tests/capture-backend.test.mjs tests/capture-ui.test.mjs
# 最终 16/16：后端15项 + 最新步数UI纯函数1项

/opt/homebrew/opt/node@24/bin/node --test --test-concurrency=1 tests/latest-health.test.mjs tests/upcoming-tasks.test.mjs tests/assets-cache.test.mjs
# 15/15：健康历史/首页6项 + 待办5项 + 静态构建/缓存4项
```

首次本机监听被 sandbox 的 EPERM 阻止；按允许的隔离本机测试权限重跑后通过。未把环境拒绝记作产品缺陷。另执行前述独立内存 SQLite 距离后补探针和网页异步/转义探针，均得到预期结果。

## 仍需独立验收明确的边界

本报告没有执行 Android 构建、模拟器或真机操作。最终APK安装及instrumentation、真实通知到上传、失效登录/换账号的设备链路、HC有源0/无数据、多来源聚合、睡眠清醒阶段、运动暂停时长与距离后补、厂商后台省电/重启/联网重试，均应按独立验收报告区分已执行与待验证；不能由本报告或作者构建成功推定通过。生产部署、主分支合并与发布状态由协调者另行记录。

来源切换防重复历史保存在当前安装的本机私有配置；重装、清应用数据或新设备没有该历史时，首次来源可能回补已有运动，需要用户核对。此限制已写入安卓交接文档；本轮未实现服务端跨设备来源注册或历史迁移，不把本机策略描述为全设备去重保证。
