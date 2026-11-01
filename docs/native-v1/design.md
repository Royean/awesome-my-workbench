# 知衡原生 App v1 界面设计（Flutter / Material 3）

原型：`prototype.html`（单文件，390×844，点击左侧目录或界面切换）。截图：`screens/*.png`。令牌：`tokens.md`、`zhiheng_theme.dart`。
后端 API 不变：`/api/auth/login`、`/api/auth/me`、`/api/bootstrap`、`/api/state?space=&workbench=`、`/api/items`、`/api/items/:id`、`/api/workbenches`。

## 1. v1 记录类型选择
服务端 kind：meal、exercise、metric、water、dose/medication、visit、report、file、task。
v1 选 **记一餐 meal、记运动 exercise、记指标 metric（体重/血压/血糖/睡眠/静息心率）、记饮水 water**：
- 网页快捷入口（quick.js / daily.js / shell.js）只直接提供这几类，属于每日高频；
- 字段简单、纯文本/数值，无需附件，适合离线创建；
- dose/medication 有排期与重复校验（v1 不做），visit/report/file 依赖附件（v1 不做），task 属于备忘待办（v1 不做）。

## 2. 信息架构
```mermaid
flowchart TD
  L[登录] --> T[今天]
  T -->|快捷按钮 / FAB| A[新建底部表单]
  A --> F1[记一餐] & F2[记运动] & F3[记指标] & F4[记饮水]
  T -->|点记录| E[编辑表单]
  T -->|app bar 切换片| W[工作台/空间底部表单]
  NB{{NavigationBar}} --> T & R[记录列表] & V[回顾] & M[我的]
  M --> O[退出登录确认] --> L
```
NavigationBar 4 项：今天、记录（按日倒序列表，复用记录行）、回顾（v1 可只做简版周汇总或占位）、我的（账号、缓存、网页版入口）。
金融工作台：v1 只切换并显示其「今天」概要与列表，新建入口按工作台类型隐藏健康类记录（见开放问题）。

## 3. 全局布局
- Edge-to-edge，状态栏透明，深色图标；底部手势区留 inset。
- 4/8dp 网格：页面左右 16，卡片内边距 16，卡片间距 12，区块 24。
- App bar 64dp：标题 22sp/600；右侧「工作台 · 空间 ▾」tonal chip（高 40，可点区域 48）。
- NavigationBar 80dp，选中态 = 实心图标 + 指示器胶囊 + 加粗标签（不只靠颜色）。
- FAB extended「＋ 记录」，距底栏 16。
- 系统返回：表单有改动→放弃确认；底部表单→关闭；今天页→退出应用。
- 转场：push 用 M3 shared-axis（X），表单用全屏 dialog 从下滑入（300ms emphasized），sheet 用标准 modal bottom sheet；全部可点元素有 ripple。

## 4. 各屏规格
### 登录（login*.png）
- Logo 64、标题 28sp、副标题「登录后自动保持 30 天」。
- 邮箱、密码 OutlinedTextField 56dp；密码可显隐（48dp 图标按钮）。
- 主按钮 48dp 全宽；登录中：禁用 + 18dp spinner +「登录中…」，按钮宽度固定不跳动。
- 状态行（固定 24dp 高，role=status）：3s 后「网络较慢，正在连接…」；15s 取消请求，显示「连接超时，请重试」（error 色），按钮恢复。
- 401：密码框 error 态，下方「邮箱或密码不正确」。
- 会话：cookie 存 secure storage，30 天自动续期；启动时有 cookie 直接进今天（先用缓存），后台 `/api/auth/me`，401 才回登录。
### 今天（today*.png）
- 顺序：离线/失败横幅 → 日期概要卡 → 4 个快捷按钮（72dp）→ 今日记录卡（行 56dp+，图标 40 圆）。
- 空状态：概要显示「今天还没有记录」，插画卡「从第一条记录开始」。
- 骨架屏：仅首次登录且本地无缓存时出现，shimmer 1.4s；有缓存永远先显示缓存。
### 新建底部表单（add-sheet.png）
四项 56dp 行；底部提示「用药、就诊、附件请在网页版记录」。
### 记录表单（form-*.png）
- 全屏 dialog：✕ 关闭、标题、右侧「保存」文本按钮。
- 一餐：餐次 segmented（早/午/晚/加餐，默认按时间）、日期时间、吃了什么、备注。
- 运动：类型下拉（默认上次/步行）、日期时间、时长（1–1440 分钟，supporting text 常显）。
- 指标：类型 segmented、日期、数值（血压为收缩/舒张两栏），supporting 显示上次值。
- 饮水：+200/+300/+500 快捷片、数值（≤5000 ml）。
- 校验在保存时并在失焦时：错误放字段下方，例「日期不能晚于今天」；服务端错误文案原样显示在对应字段或 SnackBar。
- 编辑：底部「删除记录」（error 色）→ SnackBar「记录已移除 撤销」。
- 有改动关闭/返回 →「放弃未保存的内容？」[继续编辑][放弃]。
### 工作台 / 空间（switcher.png）
单选列表（选中 = 勾 + 底色 + 加粗）；空间用 segmented「个人空间 / 示例空间」+ 说明「示例空间为演示数据，可随意修改」。切换后立即显示该组合的缓存，后台拉取。
### 我的 / 退出（account.png, logout.png）
显示账号、「本机缓存仅属于当前账号；切换或退出账号时清除」、待同步条数、网页版入口（备忘待办·用药·设置·邀请成员）。退出若有待同步，确认框明确提示会丢失。

## 5. 同步与离线（UI 规则）
| 状态 | 表现 |
|---|---|
| 同步中 | 标题旁 16dp spinner（hint 色，带无障碍标签「同步中」），不阻塞操作 |
| 离线 | 顶部横幅「离线中，记录会在联网后同步」（warn 底），可继续记录 |
| 待同步 | 记录行右侧 badge「⏱ 待同步」（图标+文字） |
| 失败 | error 横幅「N 条记录同步失败 [重试]」；行内 badge 变「同步失败」 |
- 本地 SQLite 按 `userId/workbench/space` 分库或分表；退出登录、切账号删除整库。
- 写入先落本地（客户端生成 UUID 作为 id，PUT 幂等），出队上传；冲突以服务端为准并 SnackBar 提示「该记录已在其他设备更新」。
- 回前台、联网、下拉刷新时同步；保存成功 SnackBar「记录已保存」。

## 6. 无障碍
触控 ≥48dp；正文 ≥14sp，最小 12sp；文字对比 ≥4.5:1（ink/白 11.2:1，green/白 5.6:1，hint/bg 5.1:1，error/白 6.0:1；旧 muted #82918a 不用于文字）；选中态均含形状/图标变化；支持系统字体放大到 1.3× 不截断。

## 7. 开发需要
1. 确认 `/api/items` 是否接受客户端生成 id（离线创建必需）。
2. Cookie 续期策略在原生 http client（cookie_jar + secure storage）。
3. 本地库 schema 与同步队列；4 个表单字段与服务端校验对齐（server.mjs `put()`）。
