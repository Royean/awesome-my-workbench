# Android 0.7.0 独立代码评审

执行者：开发工程师 Agent `/root/android_review`，独立于实现作者。日期：2026-10-31。

基准：`9e6cfa2`。本次评审范围是新增 `android/`，并对照现有 `public/app.js`、`public/quick.js`、`public/account.js` 与服务器下载/会话行为；未读取用户真实资料、邀请码或签名密钥。

## 结论

已完成静态代码评审；首轮发现的问题经作者修复后已复核，目前未发现阻断交付的代码缺陷。此结论不替代独立安装验收，也不表示已在真机验证权限、录音、文件选择、保存与后台行为。

复核时源码 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `android/app/src/main/java/dev/awesome/myworkbench/MainActivity.java` | `fbd2486349fdc0fdbde6dc0494ca1bf4a5e9f9071ecf88e3998704e6e14c2658` |
| `android/app/src/main/AndroidManifest.xml` | `71156aaf667df8e60923533db152995beb48041d994172881a626cc67c99ea46` |
| `android/app/build.gradle` | `27d6f919c145478751121641c44fdf3144ada969dca9f84c69bcf16a180dde49` |

## 发现与复核

1. **外域 HTTPS POST 导航可绕过单独的 shouldOverrideUrlLoading（P2，已修复）。** 原拦截器只阻止 HTTP、本地 file/content，Android 不为 POST 调用导航覆盖回调。现已在资源请求回调阻断不可信 HTTPS，并在页面开始时增加固定 origin 校验。固定 origin 同时校验 scheme、host、port 与 userinfo。
2. **退后台录音没有主动停止（P2，已修复）。** `WebView.onPause()` 本身不暂停 JavaScript。现通过可信页面固定脚本在页面隐藏和 Activity 暂停时触发既有停止录音按钮，沿用既有 `MediaRecorder.onstop`、释放音轨及保存录音草稿的流程。待处理麦克风权限在 `onStop` 取消，避免仅因系统权限弹窗造成误取消。
3. **进程重建可能重放旧邀请 deep link（P2，已修复）。** 原代码优先使用 Activity 初始 Intent。现优先恢复 WebView 状态，避免登录后重建再次进入已使用的邀请链接。
4. **提前拦截附件下载丢失响应 MIME 和文件名（P2，已修复）。** 附件改由 DownloadListener 读取真实响应头再调用系统保存文件界面；导出仍单独映射到同源 GET `/api/export`，无需 JavaScript 原生桥。
5. **文件选择器异常与回调（已加固）。** `createIntent`、启动选择器放入同一异常处理；不可用或无权限时回调 `null`，用户取消同样返回 `null`；只接受 `content://` 结果。

## 已检查的边界

- `dev.awesome.myworkbench`，版本 `0.7.0`，min SDK 26 / target SDK 36；仅申请网络与麦克风，无广泛存储、定位或相机权限。
- TLS 错误取消；关闭明文流量、混合内容、本地 file/content 访问、WebView 调试和第三方 Cookie；没有 `addJavascriptInterface`。
- 麦克风请求校验请求 origin 和当前页面，只授权明确的音频采集资源；拒绝相机等其他资源。
- Cookie 在页面结束与暂停时写盘；原生下载只允许固定同源导出/附件路径，不跟随重定向，Cookie 不进入系统下载管理器。
- 保存采用系统文档选择器；非 200、写入失败、超限等失败分支删除不完整文档；文件选择与保存支持取消。
- Android 13+ 使用 `OnBackInvokedDispatcher`；返回键先关闭既有抽屉；原生工具栏、网络错误重试、渲染进程失效恢复存在实现。
- 最终 Lint 修订已复核：移除旧 `onBackPressed` 覆盖，只在 API 33 以下的 `onKeyUp` 处理旧返回键；主题移除 API 27 的导航栏 XML 属性，API 26 可用的 Java 系统栏标志保留。
- 系统栏、屏幕缺口和键盘 Insets 有显式处理；旋转由 Activity 配置处理，进程重建尝试恢复 WebView 状态。
- Gradle 从环境变量读取签名配置；构建输出、local.properties 与 keystore 被 Android 目录的 Git 忽略规则排除。
- `allowBackup=false`，并为 Android 12+ 的 cloud backup/device transfer 排除 root、file、database、sharedpref、external，避免迁移 WebView Cookie 等本地资料。
- “打开网页版”使用系统浏览器选择器并排除自身 Activity；App Links 仅匹配 `/`，保留首页及其 fragment 邀请链接，避免 APK 下载路径被应用自己接管。

## 待设备验收与非阻断限制

- 真实麦克风授权/拒绝、录音退后台及锁屏、OEM 系统文件选择器、多文件上传、保存取消、会话重启保留、键盘与手势导航，由独立 QA/用户设备验收，不能用静态评审代替。
- 文件名对 RFC 5987 `filename*` 的处理依赖系统 `URLUtil`，较旧 Android 的中文原始文件名需在设备上核对。
- App Links 的域名资产关联与生产签名指纹一致性属于部署/安装验证，未在本评审中验证。

## 依据

- [Android 16 行为变化：边到边布局、预测返回](https://developer.android.com/about/versions/16/behavior-changes-16)。
- [WebViewClient：POST 导航覆盖限制](https://developer.android.com/reference/android/webkit/WebViewClient)。
- [WebView：onPause 生命周期行为](https://developer.android.com/reference/android/webkit/WebView#onPause())。
- [WebChromeClient.FileChooserParams：文件选择结果与取消](https://developer.android.com/reference/android/webkit/WebChromeClient.FileChooserParams)。
- [PermissionRequest：明确授权资源](https://developer.android.com/reference/android/webkit/PermissionRequest)。
