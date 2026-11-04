# Studio 应用图标与 Android 0.7.2

2026-11-04，Refs #55。用户要求沿用已确认的新工作台UI风格更新应用icon。

采用浅灰白 #F2F4EF 背景、青柠绿 #77BC32 主卡片与两块白色细边卡片，保留原三面板工作台识别形状。无文字或医疗专属符号。使用现有SVG原生几何更新，避免把大图缩成不可维护的位图标志。

单一设计源为public/app-icon.svg；scripts/build-icons.py（构建时需Pillow）从其圆角矩形生成192/512 PNG、全不透明512 maskable图以及Android前景/单色矢量。背景与前景分离，主体位于Android核心安全区。网站favicon和顶部品牌标志同步，manifest区分普通和maskable用途。

Android versionName 0.7.2 / versionCode 702，包名dev.awesome.myworkbench，使用已有release签名。只更新图标及版本标识，不改变登录权限或业务数据；桌面图标需要用户覆盖安装新版APK。没有代替用户在实体手机执行安装；系统launcher缓存和不同手机实际显示仍须在设备验证。

/root 设计与实现，/root/ui_acceptance 独立验收，报告见STUDIO_ICON_ACCEPTANCE.md。构建与lint、公开证书/包名版本、安全区与小尺寸检查以报告为准。签名材料只通过本机已有安全文件注入构建环境，未复制进仓库、归档或服务器。
