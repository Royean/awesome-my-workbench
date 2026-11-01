# Android 0.7.1：工作台新图标

2026-11-01，实际执行者 `/root` 兼任设计、开发与工程自验。本次是图标及发版资源调整，沿用现有 Java WebView 容器，不是原生页面重写。

图标采用深绿 #123D35 背景、白色双栏工作面板和薄荷绿 #A8E8B4 模块。无文字、无医疗专属符号，适用于健康、金融等工作台。SVG 为设计源；192/512 PNG、favicon 与 Android 前景使用相同几何。Android 使用系统自适应蒙版，Android 13 以上提供单色主题图标。

包名 dev.awesome.myworkbench，versionName 0.7.1，versionCode 701。保留此前持久 release 密钥，支持从 0.7.0 覆盖升级。图标调整不改变登录、存储或权限；应用联网使用 vivid-dream.online 的最新工作台界面。

## 验证与限制

- 构建：assembleRelease、lintRelease；产物校验：apksigner、aapt，包括签名指纹、包名、版本及自适应/单色图标资源。
- 网页自动回归测试和 public 构建；PNG 实际渲染检查。
- 本次为作者工程自验，不冒充独立评审或独立测试。未重新执行真机安装，系统桌面不同蒙版、升级保留登录与手机内实际操作仍待用户设备验收。此前设备拒绝安装，本机磁盘也不足以新增模拟器；不绕过系统限制。

下载： https://vivid-dream.online/download/awesome-my-workbench-0.7.1.apk 。准确源提交、SHA-256 与签名指纹见下载目录 release.json 和 .sha256.txt。
