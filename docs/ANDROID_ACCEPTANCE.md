# Android APK 独立验收

执行者：测试验收工程师 `/root/android_qa`；实现者 `/root`。目标版本 0.7.0，包名 `dev.awesome.myworkbench`，固定入口 `https://vivid-dream.online`。本报告仅记录实际执行结果，不代替业务登录后验收或正式发布。

## 计划与边界

- 核对 APK SHA-256、版本、min/target SDK、签名有效性、调试标记、导出组件、权限及 HTTPS 策略。
- 安装前仅查询目标包。已有目标包及用户数据时不卸载、不清数据，先返回协调人。当前预查目标包不存在。
- 在已授权实体设备 Android 16（V2338A）安装交付 APK；验证首次启动是登录门，无未登录业务数据泄漏。
- 验证登录页可点、键盘可见、系统返回键、退出后重启、旋转及系统栏区域。只使用虚构文本，不提交真实凭据或消费管理员邀请。
- 网络错误与重试仅采用不干扰其他应用的可控方式；不能安全实际触发时标待验证，不以静态阅读冒充通过。
- 如需登录后检查，等待协调人提供隔离账号或独立测试后端。禁止读取设备已有 cookie、私有病历及其他应用数据。
- 截图仅限目标应用的无敏感界面；不采集设备整体现状或其他应用画面。

## 运行状态

2026-10-31：角色规范已读取；ADB 可访问目标设备，Android release=16。`adb shell pm path dev.awesome.myworkbench` exit 1 且无输出，目标包不存在。最终 APK 已接收；首次安装被手机系统拒绝，未安装成功。

## 待交付后填写

| 项目 | 类型 | 结果 |
| --- | --- | --- |
| 精确产物与签名 | APK 静态核验 | 通过 |
| 真机安装与冷启动 | 实体 Android 16 | 安装被设备拒绝，待用户允许安装 |
| HTTPS 登录门与未登录隔离 | 实体 Android 16 | 待验证 |
| 键盘、返回、旋转及系统栏 | 实体 Android 16 | 待验证 |
| 网络错误及重试 | 按可用隔离条件执行 | 待验证 |
| 登录后业务功能 | 隔离账号尚未提供 | 待验证 |

## 精确产物静态验证（实际执行）

- 产物：`android/app/build/outputs/apk/release/app-release.apk`。
- SHA-256：`0eabaef163e9bbd682cbf17b51b6ff14acd6e2ada5155c6f546a241ef138f873`，与实现者交接一致。
- `apksigner verify --verbose --print-certs` 通过：1 个签名者，v2=true，RSA 3072；证书 SHA-256 `3a104d13ab13574bca062faa83dad297202409a5551b183420406547f0a6d5a6`。
- `aapt dump badging/xmltree`：包名正确、版本 0.7.0/700、min SDK26、target SDK36；无 debuggable=true 标记；仅 INTERNET、RECORD_AUDIO；麦克风非必需硬件；allowBackup=false，usesCleartextTraffic=false。
- 清单唯一 Activity 为 MainActivity（启动与 HTTPS App Link 必需 exported）；App Link 限 `https://vivid-dream.online/` 根路径，无服务/接收器/Provider 导出。

## 真机安装阻塞（实际执行）

安装前再次 `adb -s 10CE2112QU000D6 shell pm path dev.awesome.myworkbench`，exit1，无输出，未发现既有同包。

执行 `adb -s 10CE2112QU000D6 install android/app/build/outputs/apk/release/app-release.apk` 返回 exit1：

```text
Performing Streamed Install
Failure [INSTALL_FAILED_ABORTED: User rejected permissions]
```

未清数据、未卸载、未绕过手机保护，也未操作设备其他应用。因 APK 未安装成功，登录门、键盘/返回/旋转、原生文件选择器与下载、录音权限拒绝均尚未真机执行。下一步由用户从下载链接手动安装后，测试验收工程师继续实测；不要求用户更改 USB 安装设置；该设备拒绝不能记作产品通过或功能缺陷。

当前整体结论：**静态产物核验通过，真机验收待验证**。尚无证据证明本 APK 在该实体手机可运行。

## 隔离模拟器尝试（实际执行）

协调人要求避免继续改手机设置，改用全新 `Awesome_Workbench_QA` AVD。首先检查 SDK：`sdkmanager --list_installed` 无任何 system image，system-images 目录为空。未读取或重用现有用户 AVD。

执行 `sdkmanager 'system-images;android-36;google_apis;arm64-v8a'` 下载系统镜像，下载曾持续增长至 683MB，最终返回 exit1：

```text
Warning: An error occurred while preparing SDK package Google APIs ARM 64 v8a System Image: No space left on device.
```

SDK 自动清理失败临时下载，system-images 仍为空；`df -h` 显示同卷仅剩 989MiB。没有创建/启动 AVD、没有删除用户文件、没有读取测试账号凭据。模拟器运行验收也仍待验证，不能用静态结论代替。
