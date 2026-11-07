# 手机采集独立验收

## 责任与版本

- 需求依据：[PHONE_CAPTURE.md](PHONE_CAPTURE.md) AC-01–07 与接口约定。
- 实际执行者：测试验收工程师 `/root/capture_acceptance`；未参与 Android、后端或网页实现。本文记录独立测试验收，不代替独立代码评审或 GitHub 正式批准。
- 实现：协调/网页 `/root`；Android `/root/android_capture`；后端 `/root/capture_backend`。
- 准备时基线：`eba883a34592f87cf8eed488634ce6c047bc0adf`。待实现交接后记录实际源版本、工作区差异和 APK 校验值。
- 当前阶段：最终冻结内容的独立 API/网页13组及最终文案定点1组、API34模拟器10项仪器测试通过。真实通知与有源Health Connect端到端仍待验证，不能给整体无条件通过。
- 角色依据：[测试验收工程师](https://github.com/Royean/personal-context-index/blob/main/agents/roles/test-acceptance-engineer/ROLE.md)、该角色测试计划模板及代码项目开发协作规范，读取日期 2026-11-05。

## 环境与隔离

- 工作树 `/tmp/aw-finance-capture`，不切分支、不提交，不修改实现或作者现有测试。
- 本机普通 `node`（25.6.1）因缺少 `libsimdjson.29.dylib` 不能运行；可用 `/opt/homebrew/opt/node@24/bin/node`，版本 `v24.20.0`。
- 既有 fixture：`scripts/account-admin.mjs create-admin`、`tests/helpers.mjs`，服务使用新建临时 `HEALTH_DATA_DIR`、`NODE_ENV=test`、`AUTH_REQUIRED=1`、精确 localhost `APP_ORIGIN`。仅创建 `example.invalid` 虚构账号和虚构通知/健康记录；密码随机生成，不记入报告。
- 现有 Playwright MCP 可连接浏览器（已返回空白页）；项目未安装 Playwright npm 包，但已复用 `/Users/jiewei/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs`。可用 Chrome 与移动视口 360×844 / 390×844；移动视口仅证明浏览器界面，不代表 Android WebView/系统权限通过。
- adb `1.0.41 / 37.0.0` 已安装；沙箱内启动 daemon 被限制，获准的只读设备清单已获取。清单仅有一台物理设备的 USB/无线连接，不访问该物理设备、不读取资料、不授予其采集权限。
- 可用 AVD：`Octopus_API_34`、`Octopus_API_34_Lite`、`Workbench_API_34`。本次未使用这些已有AVD，而是另建全新隔离AVD，避免未知账号/资料。
- APK 构建成功、签名检查、模拟器安装启动、真实系统通知、Health Connect 有源数据、私人真机验证分别记录；任意一项不能替代其他项。
- 自动脚本结束后停止自建服务并删除自己创建的临时数据；截图/日志只保留虚构资料。不得连接生产域名或复用已有用户数据库。

## 进入条件与通过条件

实现作者交接可运行版本、变更范围、自测命令及结果、已知缺口；Android 交接 APK 路径、包名/版本/签名、源版本。取得这些输入后先执行关键路径，再执行边界和异常，不把基线接口未实现报告成缺陷。

所有必测 API 与网页用例实际通过且阻断缺陷复测关闭，才能给对应层通过结论。系统权限、离线队列和 Health Connect 聚合若缺少合适设备/源数据，保留待验证，说明对 AC 和交付的影响。作者自测与本 Agent 独立执行分别列出。

## 用例矩阵

| 用例 | AC | 优先级 | 前提、步骤及可观察预期 | 验证层 | 状态 |
| --- | --- | --- | --- | --- | --- |
| TC-01 | 01 | P0 | 全新安装，采集总开关、通知源和步数源均关闭；未授权时无后台读取/上传，权限失败给出说明；开启后可暂停 | 原生系统 + 网络 | 默认关闭通过；完整权限/联网暂停待验证 |
| TC-02 | 01/06 | P1 | 通过网页 `/app/collectors` 和原生菜单到设置；通知权限拒绝/撤销、Health Connect 不支持分别显示真实状态；任意其他网页路径不能触发原生采集接口 | 模拟器原生 + WebView | 原生菜单通过；WebView权限路径待验证 |
| TC-03 | 02 | P0 | 白名单中明确选择的支付应用发送虚构消费通知，产生候选；未选择的应用、聊天应用、同包私人聊天均不上传；服务端独立拒绝绕过客户端的非白名单包 | API + 系统通知 | API通过；真实通知待验证 |
| TC-04 | 02 | P0 | 白名单支付包的验证码/OTP/verification code（包括带金额）和普通营销、收款码提示不上传；接口直接提交也拒绝或不入收件箱/账本 | API + 系统通知 | API通过；系统通知待验证 |
| TC-05 | 03 | P0 | 同一 `deviceId+eventId` 重试/并发/服务重启后仅一个候选；不同通知但相似金额给出疑似重复提示，不自行记账 | API + 重启 | 通过 |
| TC-06 | 03 | P0 | 候选进入资产待核对且流水、账户余额、持仓未变；不完整金额/类型不作为已核实；缺失或非法确认字段拒绝 | API + 网页 | 通过 |
| TC-07 | 03 | P0 | 人工填写有效字段确认，只创建一条流水；顺序/并发重复确认返回同一流水；确认后 ignore 不得撤销或重写流水 | API + 网页 | 通过 |
| TC-08 | 03 | P0 | ignore 重复执行保持 ignored；ignored 再 confirm 被拒绝；重送原通知不能复活；已处理列表仍可查状态 | API + 网页 | 通过 |
| TC-09 | 04 | P0 | 暂停网络后接收虚构通知，队列持久化；杀进程/重启后仍存在，联网只上传一次；网络失败显示原因，手动/自动重试不重复 | 隔离模拟器 + 网络 | 队列重开仪器测试通过；真实重启联网待验证 |
| TC-10 | 04 | P0 | 队列绑定 A；登录过期停止发送；切换 B 后 A 的队列不发给 B，恢复 A 需明确恢复；暂停采集阻止新上传 | 隔离模拟器 + 双账号 | owner/开关仪器测试和API通过；原生会话E2E待验证 |
| TC-11 | 04 | P0 | 匿名、失效 Cookie、缺失/错误 owner、非本站 Origin 均拒绝；B 不能读/confirm/ignore A 的事件；demo、错误工作台不写入个人数据 | API | 通过 |
| TC-12 | 05 | P0 | Health Connect 按北京时间日界线 aggregate；跨源重叠记录不通过原始记录相加；保留来源、deviceId、观测/同步时间 | Health Connect 有源数据 | 待验证：无有源Health Connect样本 |
| TC-13 | 05 | P0 | 同日上传 1200→1500→重试1500，只保留当日最新1500，不累加；较旧观测即使值大也不能覆盖；服务重启后仍如此 | API + 重启 | 通过 |
| TC-14 | 05 | P0 | 有源数据且聚合明确为0时保留数值0；真正无源数据不上传、不把已有值改写为0；空批次不生成0 | API + Health Connect | API零/空批通过；真实无数据待验证 |
| TC-15 | 05 | P0 | 非法日期/负数/小数步数/无时区时间/未来日期按契约拒绝；手动步数独立保留，不与采集值相加；B及demo无A步数 | API | 通过 |
| TC-16 | 06 | P1 | 健康总览步数卡与 settings、资产流水顶部、mine/settings 可进入；非Android显示支持范围；无数据是空态，0步明确显示0 | 360/390浏览器 + WebView | 浏览器入口/零值通过；WebView待验证 |
| TC-17 | 06 | P0 | 待核对→打开确认表单→改金额/类型/日期→保存→已处理；ignore与筛选可用；刷新状态持久；余额/持仓不变 | 移动网页真实操作 | 通过 |
| TC-18 | 06 | P1 | 加载/网络失败可重试；360/390宽无横向溢出，drawer滚动和关闭可用，控件可点；账号/工作台切换清除旧收件箱，HTML通知文本正确转义，无未捕获JS错误 | 浏览器操作 + 截图 | 通过；视觉缺陷已修复复测 |
| TC-19 | 07 | P0 | APK 构建及 lint 通过；核对 package/version/minSDK、签名、SHA-256；说明 debug/release 差异与源版本；安装/升级和启动单独验证 | 构建 + 模拟器 | debug安装/升级/启动通过；构建见作者记录 |
| TC-20 | 07 | P1 | 形成逐AC结论、精确检查命令和产物证据；缺设备/缺数据源保留待验证，生产部署和主分支合并不在本验收操作内 | 交付记录 | 已形成逐层结论；不声称全链路通过 |
| TC-21 | 08 | P0 | 四个新源默认关闭、独立授权；静息心率只使用 RestingHeartRate，睡眠排 awake 且跨夜按结束日；无源数据不上传0 | 原生系统 + Health Connect | 默认关闭与策略仪器测试通过；真实聚合待验证 |
| TC-22 | 08 | P0 | POST health 四类型映射到 kg/整数bpm/小时/运动分钟与可选公里；同日指标替换、会话 sourceId 幂等；字段边界、未来/无时区拒绝；不存route | API | 通过 |
| TC-23 | 08 | P0 | 旧 observedAt 不覆盖；手工同日记录保持独立；删除再重试及服务重启后不复活；B无法读写A | API + 重启 | 通过 |
| TC-24 | 06/08 | P1 | 健康采集列表展示四类名称、数值单位、来源时间和可选距离；缺少距离不显示0 | 360/390浏览器 | 通过 |

回归选择：真实登录会话、owner/Origin、空间/工作台切换、资产流水/账户/持仓、健康普通指标、既有移动 drawer，因为这些边界直接承载新增采集数据。现有全套工程测试由协调者统一运行，本 Agent 的独立证据以公共接口和用户交互为主。

## 执行记录

### 基础 API 与网页

- 命令：`/opt/homebrew/opt/node@24/bin/node tests/phone-capture-acceptance.mjs`；基础独立 API 首轮10组通过，最终扩展共13组（12 API行为组 + 1浏览器组）通过。
- 浏览器命令：在同一命令设置 `PHONE_CAPTURE_UI=1`，`PLAYWRIGHT_MODULE=/Users/jiewei/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs`；最终同时设置 `PHONE_CAPTURE_HEALTH=1`，13组通过，运行前后API/Web源指纹一致。
- 实际 Chrome 移动视口 360×844 / 390×844：我的→手机采集→核对修正金额 -77.88→保存流水；忽略与状态筛选；finance 结果深链；网络失败后重新加载；健康首页0步；双账号隔离；HTML通知文本转义。账户与持仓未变，无横向溢出或未捕获 JS 错误。
- 12张截图在 `/private/var/folders/wb/j54mykvj0k71fcm7rs8my5r80000gn/T/phone-capture-independent-evidence/`，文件前缀为 `inbox`、`confirmation`、`ignored`、`zero-steps`、`health-results`、`health-records`（各360/390）；所有内容均为虚构数据，截图等待动画结束。
- 新增健康API设置 `PHONE_CAPTURE_HEALTH=1`：四类映射/单位/sourcePackage审计字段、字段边界、幂等、手工隔离、旧观测、删除不复活及重启通过；运动20分钟有效时长/30分钟经过时间可保存，先无距离→后补1.5→新批省略保留1.5→旧观测99不覆盖均通过。网页四类名称/值/来源时间/距离亲看截图通过。原快速体重69.9保存、generic手工0步新增→编辑12→编辑0回归通过。
- 正式交付资源集合的最终执行输出 `RESULT 13 independent public-API groups passed`；运行前后 `INPUT_FINGERPRINT` 均为 `4ceb647914f362324723bc7075ac8852e8a04e93aa9f492d38278db5d57ec516`。此前中间资源集合指纹 `22243aed...` 的测试也通过；最终重跑是为了匹配root恢复旧已发布bundle后的正式资源集合，不以旧指纹冒充最终输入。
- 在13组通过后，root仅把健康结果时间标签由“来源记录时间”改为“数据更新于”并生成对应新bundle。按影响范围执行 `PHONE_CAPTURE_COPY_ONLY=1` 定点验收1组，通过360/390文案与截图；最终运行前后指纹均为 `3f03ea45afb019e47d0e9ef2b7d158308ed955a55074004457dc70693df5f61c`。没有把中间13组的指纹冒充此最终文字版本。
- 指纹算法见独立脚本：排序 `git ls-files --cached --others --exclude-standard` 中 `server.mjs` 及 `lib/public` 的 `.mjs/.js/.css/.html`，逐条连接 `path + NUL + bytes + NUL` 后 SHA-256。另存实际文件逐项SHA清单 `/tmp/aw-phone-capture-acceptance-evidence/web-source-manifest.json`，便于提交后核对字节而无需重复用户路径。

### 缺陷与复测

| 编号 | 关联AC/用例 | 复现、预期与实际 | 责任/状态 |
| --- | --- | --- | --- |
| CAP-QA-01 | 05/TC-13、15 | 同日同步1500→手工200→同步1600；latestStep应稳定选择最新采集结果，实际随UUID排序返回手工200。首轮公共API脚本在此断言失败 | 后端作者已修为日期/同日Health Connect/observedAt顺序；本Agent已复测通过 |
| CAP-QA-02 | 04/TC-09、10 | 新装API34模拟器运行交接的instrumentation，`privateQueueSurvivesReopenButNeverCrossesOwners` 第28行 expected1 actual0，`dailyStepSnapshotUpdatesAndKeepsAnExplicitZero` 第41行同样失败；队列next应返回当前owner已启用源。作者定位SQLite绑定字符串与数字boolean比较导致队列始终为空 | 已在中间包6项、最终冻结包10项仪器测试实际复测通过；保留首轮2/3失败证据 |

| CAP-QA-03 | 06/TC-18 | 手机drawer的介绍继承旧quick-capture同名class，390px三窄列、首段逐字竖排。正常预期是可读分段 | root改为phone-capture独立class；最终360/390截图及旧quick记录均复测通过 |
| CAP-QA-04 | 08/TC-22 | 同一运动先无距→补1.5→更新省略distance时已知距离丢失，API断言undefined而非1.5 | root保留已有distance；最终独立用例和旧观测99不能覆盖均复测通过 |

浏览器脚本最初两次失败分别来自重复的隐藏桌面 selector 与不可见旧手机导航 selector，已改为实际可见的我的入口；新增健康列表标签差异也只调整脚本匹配。这些测试定位问题未计为产品缺陷。

### APK 与设备

- 独立创建全新 AVD `PhoneCaptureAcceptanceAPI34`，目录 `/tmp/aw-phone-capture-acceptance-avd`，显式设备 `emulator-5580`，Android14/API34/arm64-v8a；未访问已连接的物理设备。API36目录无法被 avdmanager 识别，因此未拿它冒充API36实测。
- 首轮APK `android/app/build/outputs/apk/debug/app-debug.apk`，SHA-256 `7a28f5cd593e2da6691a36bed647a5420d2cf304f2ac5cdd28618197396917b3`；测试APK SHA-256 `951c6073a55cff37a868f6faf7bbd7df5f7ba8a512ede2e7b2def1bce2e4b8ee`。
- 最终交付APK：SHA-256 `1f4148b63827cf67e67881f528fe79cb2477233c841ba02f19c4bd711c0ddc6e`；最终测试APK `1dc9d21afff60e614236c77ae67f5271fea3e15acf95c49fa31d01f4a78f3753`，同路径、0.7.3(703)。本Agent亲核校验值并覆盖安装，仪器测试实际输出 `OK (10 tests)`（0.356秒）。包括首次缺陷复测、源/权限暂停、0步快照、睡眠窗口、运动来源过滤/cutover、404待部署保留pending→200移除，以及 A(X)→B(Z)→A(Y)历史保留但不恢复授权。
- 最终Android源指纹 `3a4a9d88aa8b6b684de5e173973a158b5773aa119694068cd615541d678f1a2b`，对git列出的 `android/` 与 `scripts/build-android-debug.sh` 共30文件按 `path + NUL + bytes + NUL` SHA-256；逐项清单 `/tmp/aw-phone-capture-acceptance-evidence/android-source-manifest.json`。
- 原生设置已实际打开：无账号/全暂停/通知未授权、应用默认未勾选；步数/睡眠/体重/静息心率/运动/距离开关均关闭；后台能力不足说明清晰；不授予读取权限。
- 虚构多来源交互单独验证（9项测试轮次APK `af194892...`，后续10项轮次只改owner来源历史、其策略已复验）：离线debug偏好注入A/B，仅表示“自动单源后发现多源待选”的UI前置状态；实际点B出现更换提示，确认后读回 source=B、explicit=true、cutoff非空、paused=true。此项验证来源选择界面，不代表真实HC自动发现多tracker；真实发现路径仍待验证。
- 原生截图与XML仅含无账号状态/虚构来源，位置 `/tmp/aw-phone-capture-acceptance-evidence/`；`native-source-choices.png`、`native-source-switch-confirm.png` 为选择交互证据，最终默认截图为final-native-default-top.png与final-native-default-health.png（均对应1f4148最终APK）。来源选择后本机虚构数据将由最终仪器测试清理。
- 已亲自执行 `apksigner verify --print-certs` 与 `aapt dump badging`：`dev.awesome.myworkbench.debug`，0.7.3(703)，minSDK26，targetSDK36，Android Debug证书 SHA-256 `b8e75d9f02ad6e44342dd4394cbf0bd01e080c7162769c1bb9e7c281e773d00a`。两APK安装成功；不代表release签名或真机通过。
- 实际命令 `adb -s emulator-5580 shell am instrument -w dev.awesome.myworkbench.debug.test/androidx.test.runner.AndroidJUnitRunner`：首轮3测试，2失败，默认关闭/账号变化测试1项通过。该测试由Android作者提供、本Agent在独立模拟器执行，不是作者已经自验通过。
- Health Connect controller系统包存在；有源数据聚合、真实通知端到端、系统重启与离线上传当前仍待验证。所有源默认关闭和独立权限入口已在最终APK原生设置实看，不授予读取权限。

精确源提交及提交后内容核对见末尾；运行输入指纹、最终APK校验值、复测输出与逐AC结论已记录。不得记录密码、Cookie、令牌或真实用户通知。

| AC | 实际结果 | 证据 | 下一负责人 |
| --- | --- | --- | --- |
| AC-01 | 默认关闭/账号变化通过；真实授权链待验证 | 原生设置 + 10项仪器测试 | Android作者/设备验收 |
| AC-02 | 公共API白名单/OTP/聊天/营销过滤通过；真实系统通知待验证 | 独立API + 作者Filter测试另记 | Android作者/设备验收 |
| AC-03 | 通过：人工确认前无流水、并发/重试幂等、忽略、重复提示、分页 | 独立API + 360/390浏览器操作 | 无开放产品缺陷 |
| AC-04 | API账号/会话及本地队列owner/重开策略通过；系统重启联网E2E待验证 | 独立API + 模拟器仪器测试 | Android作者/设备验收 |
| AC-05 | API幂等/0/旧观测/手工隔离通过；真实HC跨源aggregate/无数据待验证 | 独立API + 浏览器0步 + 仪器快照 | Android作者/有源设备验收 |
| AC-06 | 通过已验浏览器范围：入口、状态、确认/忽略、失败重试、零步/四类健康、移动布局 | 13组最终执行、12张截图 | Android WebView仍单独验证 |
| AC-07 | 最终debug包安装/覆盖升级/启动、签名信息、10项仪器测试通过；非release/真机结论 | 最终APK校验值与专用API34模拟器 | 协调方补精确提交与构建链接 |
| AC-08 | API/网页/原生默认关闭与来源策略通过；真实HC睡眠/静息HR/运动聚合待验证 | 四类公共API、网页列表、10项仪器测试 | Android作者/有源设备验收 |

最终测试层结论：已验证的API、移动浏览器、debug包安装与模拟器策略测试通过，发现的4项产品缺陷均已修复并独立复测。真实通知读取→离线/重启→联网、真实Health Connect有源聚合与授权、真实账号切换端到端未完成；这些待验证项使整体采集链路不能标为无条件验收通过。当前可交付为注明范围的安装测试包，由协调负责人决定下一交付阶段；不据此冒充生产部署、release签名、真机通过或用户已满意。

## 提交交接

实现提交：`9b422d62473e886b6ffe8a12c1a13cfa094d50ec`。后续仅CI环境准备修复提交 `abc9f5f`，未变更上述已验收的网页/API/Android运行代码。正式提交后的逐项SHA核对由独立验收补充；本报告随后提交。

仓库内虚构截图： [通知核对](phone-capture-evidence/confirmation-360.png)、[健康结果](phone-capture-evidence/health-records-390.png)、[安卓默认设置](phone-capture-evidence/native-default.png)、[健康来源开关](phone-capture-evidence/native-health-sources.png)。

2026-11-05，独立验收 `/root/capture_acceptance` 对 `abc9f5f11bcf6a401bce773ef26ad197273a7c9f` 执行提交后逐项SHA-256核对：Web/API清单96个文件 **0差异**，内容指纹仍为 `3f03ea45afb019e47d0e9ef2b7d158308ed955a55074004457dc70693df5f61c`；Android清单30个文件 **0差异**，仍为 `3a4a9d88aa8b6b684de5e173973a158b5773aa119694068cd615541d678f1a2b`。因此正式提交内容与实际执行验收时的运行输入一致，无需重复已通过的用户路径。两提交之间仅 `.github/workflows/android.yml` 新增 `android-actions/setup-android@v4` 一行；CI环境准备变更单独处理，不把本地通过冒充远端CI已通过。

本次独立API脚本已自行停止服务并删除虚构账号数据库；专用模拟器已关闭，截图与源清单保留。没有操作已连接物理设备、真实用户资料、生产部署、主分支合并或release发布。报告仅确认上文已执行范围，真实系统通知和有源Health Connect端到端待验证项仍保留。
