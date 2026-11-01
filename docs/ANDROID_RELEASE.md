# Android v0.7.0 安装包交付

时间：2026-10-31（Asia/Shanghai）。协调及构建发布执行者：`/root`。关联 [Issue #2](https://github.com/Royean/awesome-my-workbench/issues/2)。

- 下载：[awesome-my-workbench-0.7.0.apk](https://vivid-dream.online/download/awesome-my-workbench-0.7.0.apk)
- [SHA-256校验文件](https://vivid-dream.online/download/awesome-my-workbench-0.7.0.sha256.txt)、[发布元数据](https://vivid-dream.online/download/release.json)。
- 应用名：我的工作台；包名 `dev.awesome.myworkbench`；versionName `0.7.0`、versionCode `700`；minSdk26（Android8）、targetSdk36。
- Android源代码提交：`b5d28dfa7bbdc8230c7063fe3626e4d9fe641308`；后续提交仅补部署模板及交付/验收记录。
- APK SHA-256：`0eabaef163e9bbd682cbf17b51b6ff14acd6e2ada5155c6f546a241ef138f873`。
- release签名：RSA3072，APK v2签名校验通过。证书SHA-256：`3a104d13ab13574bca062faa83dad297202409a5551b183420406547f0a6d5a6`。持久签名密钥及密码只在仓库外私有目录，未上传Git或服务器。

## 已实际执行

1. JDK17、AGP9.1、Gradle9.3.1、SDK/Build Tools36构建 `assembleRelease` 成功。
2. `lintRelease`通过，零错误、三条警告：更新工具版本建议、应用运行必需的JavaScript启用、旧Android的fullBackupContent建议。未降低lint级别或添加baseline。实际allowBackup=false，Android12及以上另配置cloud/device-transfer排除规则。
3. `apksigner verify --verbose --print-certs`通过，清单确认未标记debuggable、禁止明文HTTP、仅Internet及按需录音权限。
4. 独立开发Agent静态代码评审通过并复核修复，见[ANDROID_REVIEW.md](ANDROID_REVIEW.md)。
5. 独立测试Agent核验实际APK签名、哈希、版本、权限及清单通过，见[ANDROID_ACCEPTANCE.md](ANDROID_ACCEPTANCE.md)。
6. APK已上传腾讯云静态下载目录；Nginx配置测试并reload通过。通过公网HTTPS重新下载，得到与原产物一致的SHA-256。
7. `/.well-known/assetlinks.json` 公网返回当前包名与真实签名指纹JSON。系统端App Link验证尚待实际安装后确认，未据JSON可访问就声称已验证。
8. 临时测试账号未被使用、没有创建虚构病历，已清理；真实管理员及私人数据保持原状。APK不包含用户记录或访问凭据。

## 尚未通过运行验收

连接的Android16实体手机首次USB安装返回 `INSTALL_FAILED_ABORTED: User rejected permissions`；未重试绕过保护或修改手机设置。独立新模拟器所需系统镜像下载/解压因本机磁盘空间不足失败，未创建AVD，未删除用户文件腾空间。

因此当前交付的是已签名、可下载的安装包，**尚未取得实体手机或模拟器的运行通过结论**。登录、附件上传/保存、录音权限、返回手势、键盘Insets、WebView会话及App Link需在用户手动安装后验收；不得把此前网页Chrome测试当作Android APK运行测试。项目Issue保留待安装验收状态。

## 安装与数据

使用安卓浏览器打开APK下载链接，按系统提示确认本次下载来源的安装权限，再打开「我的工作台」。使用已有账号登录；如尚未激活账号，先使用此前私下交付的一次性邀请设置密码，原邀请不写入此文。

APK与网页版共用腾讯云账号及数据，需联网，WebView登录会话与外部浏览器分开。原Sites与本机旧记录未自动迁移。首次使用Android8设备应确保Android System WebView已更新，以支持当前网页功能。
