# 手机工作台与工作台隔离独立验收

2026-10-31。测试验收执行：`/root/quick_capture_qa`；UI实现：`/root`；服务端与云API：`/root/health_cloud`。依据已读取的私人角色库测试验收角色、软件开发规范及本轮交接合同。仅使用虚构资料和隔离实例，未操作3100用户数据。

当前结论：本地核心验收通过，无未解决阻断。云端三维隔离待补最终执行结果；真实手机安装/软键盘与硬件safe area未做真机测试。

## API与兼容

新增 `tests/workbench.test.mjs`，固定3106、新系统临时目录，5/5通过。旧基础9、就医7、快捷6、日常9分别用TEST_PORT/MEDICAL_TEST_PORT/QUICK_TEST_PORT/DAILY_TEST_PORT=3106依次运行，31/31通过；合计36/36，全部测试退出后清理自己的临时数据。

- 预先创建旧版SQLite健康meal（无workbench字段），新服务读出ID、kind、标题、原文逐字段一致；省略workbench参数等于health，finance初始无健康记录。
- health/finance/custom及personal/demo之间记录、设置、导出、编辑、删除与撤销墓碑隔离；越域ID编辑/删除/restore返回404，工作台不存在404。
- registry名称空白、空、25字及伪装health/finance类型拒绝；other合法名去首尾空白、服务分配新ID，body id=health不能覆盖内置项；重启后registry在两个space仍存在。
- 非健康仅允许note/task，health kinds、上传、餐食capture拒绝；health附件不能从其他工作台下载/更改/恢复，原域恢复后字节一致。

## 手机真实UI

Chromium真实页面，3106新临时个人空间；360/390/430×844，强制新URL完整加载静态资源。健康今天/档案/回顾/我的和金融今天/备忘/待办/我的，在3种宽度共24页检查文档宽均等于视口；健康记录sheet也无横溢。底栏位于视口844底部，主内容可滚动到尾；CSS主内容、底栏、drawer-foot均使用safe-area-inset-bottom，未用模拟结果冒充刘海屏真机。

- 健康底栏：今天/档案/记录/回顾/我的；档案目录6模块；记录sheet可进入记餐并保存虚构餐食。离开再切回健康后原记录仍在。
- 金融底栏：今天/备忘/记录/待办/我的。备忘新增→编辑内容、待办新增→完成、备忘删除确认→撤销，结果保留。金融明确账户/行情未连接。
- 顶部picker创建“虚构学习台”，bare `{id,name,type}`返回正确进入新台；写独立笔记、整页刷新后当前台及笔记仍在。来回切health/finance/custom，未见其他工作台记录混入。
- 我的包含工作台/空间/设置/主屏安装/导出。安装说明与页面文案明确读取保存需联网。浏览器触发了beforeinstallprompt路径，未代替用户执行系统安装；未声称原生手机已安装。

截图已查看：[健康手机](mobile-health-qa.png)、[金融手机](mobile-finance-qa.png)、[切换面板](mobile-picker-qa.png)。

## 异步缺陷与独立复测

使用Playwright route.fetch执行真实写入，仅延迟返回响应；保存发起后Escape关闭表单，再通过真实picker切换工作台，然后释放原响应。

- **MOB-01（旧静态版本，当前已通过）**：金融备忘保存响应前切健康，数据正确写finance但toast误报“已保存到健康工作台”。开发说明交接前已捕获targetName，本轮最初读到旧缓存；强制新URL后原实验toast为“已保存到金融工作台”，finance存在/health不存在该记录。
- **MOB-02（P2，已修复并独立复测）**：金融删除响应前切健康，响应后undo读取当前scope，点击发往health的restore而404。开发在请求前捕获space/workbench/名称，undo明确指向原scope。原实验复测toast为“已从金融工作台移除记录 / 撤销金融记录”；点击实际POST `workbench=finance`，原金融ID恢复、健康无该ID，toast说明恢复到金融。
- 切换时清undo/items并隐藏旧toast、loadSequence防旧state响应覆盖，已静态检查。通用/quick/medical/daily请求捕获scope，附件链接包含workbench，已审查。

一次安装入口未出现说明drawer是浏览器原生安装提示分支；一次重复data-action严格定位失败改为drawer内定位后通过，均不计产品缺陷。预期的修复前restore404产生一次请求控制台错误，未见未处理JS异常。

## PWA边界

manifest返回合法JSON，start_url/scope/display配置存在；192/512 PNG均200，真实浏览器SW注册成功。SW只预缓存offline.html与图标，fetch仅导航网络失败时返回提示，不缓存API或私人业务记录。未承诺离线录入、离线保存、原生安装或跨设备自动同步。

## 版本与交接

已验证SHA-256：server `e9bd2db224e4c1c4a068347a48180f58c43f1b74c0ed4e8b07bd6eacb44e344b`；app `56d0d4fc59fcffee10ffc0c0520b1bd3320a311e02f3c0d45f8031309b5fbe3e`；shell `e7ad6bc2a241fa6367ae663b97fbdc4d597715bfaa3e9c1f2d4ac5843a1a405b`；mobile.css `50ecc4efe913b3a20952458b6a0f9cb538f6fe96b2d198df14da31b0668bfebb`。

云端结果与最终部署版本由后续交接补入。本报告是独立Agent验收事实，不冒充真人GitHub批准。
