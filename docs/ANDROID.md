# Android APK v0.7.0

用户明确要求可直接安装的手机APK。采用独立原生Activity与受限WebView，连接既有腾讯云账号和数据库，不复制私人记录、Cookie或密码进安装包。不是离线数据库版本，也未提交应用商店。

## 验收范围

- APK-01：生成可验证签名的release APK，包名`dev.awesome.myworkbench`，版本`0.7.0`、versionCode700，Android8及以上（min26、target36），不依赖CPU原生库。
- APK-02：HTTPS登录与会话持久化；界面沿用健康、金融和自定义工作台，原账户及数据权限保持服务端控制。
- APK-03：仅允许工作台可信HTTPS origin在WebView中运行；拒绝不可信主导航、子请求、TLS错误、file/content及混合内容，不提供JavaScript原生桥，不开启release调试。
- APK-04：系统文件选择器仅交回content URI，不申请广泛存储权限；取消及异常完成回调；用户选择后才上传。
- APK-05：附件和JSON导出使用系统“保存到”选择器，Cookie仅随同源HTTPS请求发送、不跟随重定向；保留附件名和MIME，失败清理未完成文件。
- APK-06：仅在可信页面请求麦克风时申请运行时权限；拒绝不影响文字记录；退后台停止已有录音并保留草稿，禁止把其他资源权限一并授予。
- APK-07：支持安卓返回、关闭抽屉、Android16预测返回、安全区域与键盘Insets、网络失败重试及WebView进程恢复。
- APK-08：提供HTTPS直接下载APK和校验值，签名密钥不上传Git；来源及实测范围可追溯，实体手机未实测时明确记录。

分工：产品范围/实现/整合/签名发布`/root`兼任；独立代码评审`/root/android_review`；独立测试验收`/root/android_qa`。详见[代码评审](ANDROID_REVIEW.md)、[独立验收](ANDROID_ACCEPTANCE.md)。

## 构建

使用JDK17、Android SDK36、Build Tools36、AGP9.1.0及Gradle9.3.1。SDK位置通过`ANDROID_HOME`或本机忽略的`android/local.properties`配置。初次Gradle可能需要联网下载依赖。

```sh
cd android
./gradlew :app:assembleDebug
```

debug包使用`.debug`包名，与交付release分开。release通过仓库外持久签名密钥构建，环境变量为`WORKBENCH_KEYSTORE`、`WORKBENCH_STORE_PASSWORD`、`WORKBENCH_KEY_PASSWORD`，别把密码写进命令行或版本文件；alias为`awesome-my-workbench`。配置后运行`bash scripts/build-android.sh`，产物在`android/app/build/outputs/apk/release/app-release.apk`。

此应用的发布密钥已单独保存在本机私有签名目录，文件权限0600。后续升级必须继续用同一密钥与包名、递增versionCode；妥善备份密钥及其密码，不能用另一把密钥覆盖安装已有版本。

APK只包含本应用封装、公开域名与UI适配；不含私人记录或访问凭据。自签名release是本次直接安装版本，未经Google Play分发；手机可能要求确认下载来源的安装权限。

## 交互与边界

顶部原生菜单可重新加载、选择浏览器打开网页版及查看应用说明。已有网页的JSON导出在Android内转为同源下载；普通浏览器和服务器源码未作改动。PDF在系统WebView不能直接显示时可保存后通过文件应用打开。

照片与报告通过系统文件选择器选取；此版没有单独开发相机拍摄页面。录音权限按需申请；不声称已完成所有品牌手机的录音、系统选图和键盘实测。

支持HTTPS根路径App Link，配套数字资产关联文件见`android/assetlinks.json`，关联指纹为当前release签名证书。下载路径不匹配该根路径filter，避免后续APK升级链接被自身接管。

应用需要联网；离线时提供重连提示，业务数据不缓存在APK。系统云备份及设备迁移排除WebView等私有资料。WebView的登录会话与外部浏览器相互独立，但账号和服务端数据相同。
