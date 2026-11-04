# Studio Bento 应用图标独立验收

日期：2026-11-04。实现：`/root`；独立执行：`/root/ui_acceptance`（测试验收工程师）。工作树 `/tmp/aw-studio-app-icon`，基于 `main` 提交 `3b4a69578ddbedea00f1daad72caf3ab5d48bd82`。

**结论：本轮图标产物验收通过。** 最终灰白底、青柠主卡片、两白卡细边的三块 bento 形状在32/48px清楚；16px仍以青柠竖卡为主要识别点，白卡细边加深后可区分。圆形/圆角方形裁切保持前景，maskable全不透明，Web与Android采用相同几何与配色。最终APK 0.7.2/702签名有效，证书与原发布版一致。没有未解决的本轮阻断问题。

## 最终预览

以下直接指向交付原图，未经过预览拼版或二次压缩：

- [512px 原图](../public/app-icon-512.png)
- [192px 原图](../public/app-icon-192.png)
- [小尺寸、裁切及Android矢量预览板](../output/icon-preview/icon-size-crop-preview.png)

## 图形与生成一致性

颜色为底色 `#F2F4EF`、主卡片 `#77BC32`、白卡 `#FFFFFF`，最终细边 `#C4CFBB`。对现有SVG和Android矢量进行Chrome 156.0.8078.80渲染；没有调用imagegen或扩展另一套logo。

| 检查 | 实际结果 |
| --- | --- |
| 16/32/48px | 在浅/深背景以实际CSS像素查看；32/48三块形状和间隙清楚，16px保持主色与三块布局。16px边界偏淡的建议已由作者将细边从DCE3D6加深为C4CFBB并复查 |
| PWA尺寸 | 实际PNG为192×192、512×512；普通图标保留圆角外部透明，未把透明角误算成maskable |
| maskable | 独立512×512文件，262144个像素的alpha均255；中心图案与普通512图标对应区域逐像素一致 |
| 安全圆 | 按SVG圆角外缘独立计算，前景最大半径32.4558/108单位；在Android核心安全圆33内，余量0.5442；在PWA 80%安全圆43.2内，余量10.7442 |
| 圆形/圆角方形裁切 | 浏览器模拟Web全画布裁切及Android108视口中心72范围裁切；三块前景均完整，不会被圆形边界截断 |
| 单色版本 | Android monochrome实际为三块实体轮廓，保留主卡片与上下两卡间隙 |
| Web/Android同源 | favicon.svg与app-icon.svg字节一致。颜色版Android path与SVG形状渲染一致，中心比较区域平均通道差0.0386/255，仅边缘抗锯齿差异；Adaptive由平台裁切，因此视觉占比与Web外框不要求逐像素相同 |
| 生成可复现 | 将SVG和生成器复制到全新临时目录运行，6份输出（3PNG、前景、单色、背景色）与交付文件逐字节相同，未重写业务源 |
| APK资源 | 用aapt读取APK内实际资源，确认背景色F2F4EF、adaptive背景/前景/monochrome链接存在；编译后的前景/单色pathData与源码一致 |

数值检查13项、APK检查13项均通过。原有网页相关测试由实现者执行，本Agent未将作者测试冒充独立执行。

## 最终APK验证

产物：`android/app/build/outputs/apk/release/app-release.apk`。

- APK SHA-256：`3fc4e64b489960124eb4c55b5526d0990da5a0a3322ad1fe069ca9347b87859f`
- 包名 `dev.awesome.myworkbench`，versionName `0.7.2`、versionCode `702`，minSdk26、targetSdk36。
- `apksigner verify --verbose --print-certs`：Verifies，APK v2=true，1个签名者，RSA3072。
- 证书SHA-256：`3a104d13ab13574bca062faa83dad297202409a5551b183420406547f0a6d5a6`，与 [旧发布记录](ANDROID_RELEASE.md) 的公开指纹完全一致。
- `aapt dump badging/xmltree/resources`：应用名“我的工作台”，图标资源已链接；未开启debuggable，禁止明文HTTP，allowBackup=false；权限仍为INTERNET、RECORD_AUDIO。
- 最终构建日志显示 `assembleRelease/lintRelease` BUILD SUCCESSFUL。独立读取最终lint XML：0错误、3警告（Gradle版本建议、WebView启用JavaScript、旧Android备份属性建议），与既有类别一致；本轮引入的unused legacy icon已移除，不再有UnusedResources警告。

仅使用公开证书信息与已构建APK进行校验；没有读取、打印或导出私钥、密钥库或口令。

## 版本指纹与证据

| 文件 | SHA-256 |
| --- | --- |
| public/app-icon.svg / favicon.svg | `89e8ea67b92ea6482c4d17f110569631bb5fe68b4048c518aabf1886342ce930` |
| public/app-icon-192.png | `71445b82ce3078333b5c27647dab02ea7ac3d502cd6fdf037a45dd112e1fcdc3` |
| public/app-icon-512.png | `182a01b2eabfb4d7122bdedb330eb36725c78302db9dc674d0d72ad9d1f287f0` |
| public/app-icon-maskable-512.png | `0df9526d838254b1e78de32b405dcdad4e33e669fc2156e16147e7f295e73b6f` |
| scripts/build-icons.py | `25d047cb1411e1113626c94c82c6a7d239e9619fbc98f17f08237c2ff223455e` |

证据目录：[output/icon-preview](../output/icon-preview/)。

- [静态尺寸、alpha、安全区、复现及lint结果](../output/icon-preview/static-result.json)
- [APK包信息、证书比较及实际资源结果](../output/icon-preview/apk-result.json)
- [公开签名验证输出](../output/icon-preview/apksigner.txt)、[aapt包信息](../output/icon-preview/aapt-badging.txt)、[最终清单](../output/icon-preview/aapt-manifest.txt)
- [Web/Android渲染比较](../output/icon-preview/visual-comparison.json)、[Android矢量渲染](../output/icon-preview/android-vector-render-512.png)

实际工具：SDK Build Tools36的aapt/apksigner，JDK17，Pillow运行时Python，Node24+本地Playwright。验收脚本为 `/tmp/icon-static-acceptance.py`、`/tmp/icon-apk-acceptance.py`、`/tmp/icon-visual-acceptance.mjs`。

没有真机安装或启动本次APK，裁切与单色预览是对交付矢量的模拟渲染，不冒充OEM启动器、真机主题图标、PWA安装或升级安装已通过。浏览器已关闭；本Agent未改业务源、提交或部署。
