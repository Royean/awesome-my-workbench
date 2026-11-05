# 医院 Logo 映射与健康导航独立验收

结论：当前约定范围通过，无剩余阻断问题。独立测试验收工程师 Agent `/root/todo_acceptance` 执行，实现作者为 `/root`。没有修改作者源码或用户既有工作区；真实个人健康记录未被读取或写入。

## 版本与范围

2026-11-05，隔离工作树 `/tmp/aw-hospital-logo-mapping`、分支 `feat/hospital-logo-mapping`，基于 `4152754cd48553a50ac97685efef7cfc81f2deaa`。验收时功能为本地未提交修改，使用下列精确构建与源码指纹：

- JS：`app.8afc7845542af6d28950afb8f7f9f4326e7e968997655ee968202c9c0edf016f.js`。
- `scripts/export-hospital-logo-map.mjs` SHA-256：`25c37660436acdc66eedb75e622073198cbb9373fabc23c46925da3e7d5bf70b`。
- `public/provider-ui.js` SHA-256：`338e247d090bb39334748112e2ba1a9551ef7d255a68764654e6499af828a0f5`。
- `public/app.js` SHA-256：`32bc711bb4f4520ef24f7bb5b5f33672f9d77be70771958c40911efaa75d9143`。
- `public/hospital-logo-map.js` SHA-256：`65f94405a7bde175f9c84f11ad68d50f00049b45069b7c28136a525d6f88d3d6`。

仅验证已审核目录导出、医院匹配、健康总览/就诊列表/详情 Logo、机构选择器，以及两个桌面导航标签隐藏后的路径兼容。不把品牌标识映射当作医院执业登记核验。

## 执行与隔离

```sh
/opt/homebrew/opt/node@24/bin/node --test tests/hospital-logo-map.test.mjs
/opt/homebrew/opt/node@24/bin/node tests/hospital-logo-map-acceptance.mjs
```

实际结果：**离线 SQLite/provider 7/7 通过，真实后端与 Chrome 8 组通过**。Node v24.20.0；macOS 已安装 Chrome 156.0.8078.80，Playwright 无头模式；桌面 1440×1100、360×800 响应式视口。

SQLite 夹具为临时目录中的虚构已审批、pending 和无效记录，不导出真实目录库。浏览器使用随机本地端口、临时 `HEALTH_DATA_DIR`、固定测试时钟 2026-11-05；虚构就诊和 TXT 原件通过真实 API 写入临时个人空间，结束后清理。不调用真实医院网站、不使用生产账号、不更改实际医院表及采集缓存。

## 离线检查

| 检查 | 实际结果 |
| --- | --- |
| 审批门槛 | 仅 logo_verified=1 且表行 approved、选中候选 approved 的记录导出；pending 行未进入生成模块 |
| 证据及只读 | 导出的本地文件与源图片字节一致，文件名含实际 SHA；保留网页来源和图片来源；源 SQLite 字节不变 |
| 审核信息完整 | 缺少已审批候选、明确 city 或 reviewedAt 时拒绝；整批校验前不改变已有 map，也不创建图片目录 |
| 品牌范围 | brand 保留空 city、已审核城市集合和别名，不自动填某一家分院城市 |
| 异常数据 | 哈希不符、重复 publicId 拒绝，旧 map 保留；全空白 city 不算明确审核城市 |
| 匹配边界 | 品牌/别名括号分院可在审核城市匹配，未审核城市无论名称匹配还是显式品牌 ID 均返回空；未认可的后缀不当作分院 |
| 兼容 | 未知显式 hospitalId 不回退名称匹配；无城市的歧义短名不匹配；四川省人民医院及重庆新桥原稳定 ID 保持 |

## 实际浏览器检查

1. 桌面 `.studio-modules` 和原 sidebar 均没有「资料原件」「每日回顾」对应导航；「就诊管理」仍可用。
2. 健康总览最近就诊卡显示新桥口腔品牌图；将同一虚构就诊改为显式品牌 ID、北京城市后显示通用标识，恢复成都后恢复品牌图。
3. 新桥口腔品牌和「新桥口腔（高新分院）」的就诊列表使用同一图且真实图像加载成功；重庆新桥医院使用另一张图。名称匹配的未审核城市、显式品牌 ID 的未审核城市以及未知目录 ID 都显示通用机构标识。
4. 新桥括号分院的就诊详情也使用同一品牌图。
5. 机构搜索选择新桥品牌后，city 留空；填写真实测试城市及括号分院后保存，后端稳定 ID 为 `xinqiao-dental`，列表图正确。
6. 旧 `#file` 书签仍规范化为 `#visit/files`，能打开临时上传的 TXT 原文；直接 `#day` 仍显示每日回顾数据面板。
7. 360px 列表没有横向溢出，document/body/main/clientWidth 均为 360；手机底部「回顾」可点击进入 `#day`。
8. 全流程没有未捕获页面异常。

首次浏览器脚本定位了旧 `.medical-resource-list`，原件页实际已使用统一 `[data-originals-browser]`，因此等待超时；改用当前原件组件及 `original-preview` 动作后，对最终 8afc 构建完整执行通过。该超时属于验收脚本，不作为功能缺陷。

## 审查发现与修复复测

- 初版显式 hospitalId 会直接返回品牌，绕过已审核城市保护。作者为 scope=brand 的显式 ID 加入城市检查；独立 synthetic provider 用例及真实总览/列表的北京城市夹具复测通过。
- 初版 institution 的全空白 city 可通过明确城市门槛。作者规范化 trim 并验证字段类型/格式；独立空白城市夹具通过。

以上修复由作者完成；本 Agent 未更改源码使测试通过。

## 图像来源及审批边界

当前生成模块实际有 9 条映射，新增品牌 ID 为 `xinqiao-dental`、catalogHospitalId 为 `supplement-xinqiao-dental`，城市范围成都/西宁/德阳/自贡。新桥口腔与重庆新桥医院的标识在真实页面中独立显示。

新增品牌的 `logoSourceUrl` 明确为第三方 `https://m.wxnum.cn/cover-ico/xqyake.jpg`；作者交接用户已明确批准使用该品牌图，并将官方集团身份/图像比对证据及审核补丁记录到参考资料中。本 Agent 验证导出保留该来源、图像正常加载与品牌区分；没有重新访问官方或第三方网站，不把这部分描述为独立版权或官网调查。

该操作不表示其他采集候选已审批，也不表示品牌记录是某一家已核验注册医疗机构。

## 截图与限制

本地证据目录：`/var/folders/wb/j54mykvj0k71fcm7rs8my5r80000gn/T/logo-map-evidence-l0M1et/`。

- `home-logo-desktop.png`：总览最近就诊品牌图。
- `visits-desktop.png`：桌面精简导航与新桥品牌/分院、重庆图及通用标识对照。
- `visits-360.png`：手机就诊列表与保留的底部回顾。
- `result.json`：实际构建、map 摘要、检查项及宽度数据。

已实际查看桌面与手机列表截图，品牌/重庆图清晰区分，标签未出现异常横向裁切。未验证手机真机、其他浏览器或生产部署；也未操作真实健康数据。没有把本验收当作所有医疗机构、Logo 内容和图片使用权的自动批准。

## 主分支合入后复测

2026-11-05 22:11（Asia/Shanghai），将主分支资产概览 PR #69 的 `3516912` 合入本分支后，对精确合并提交 `f2b50fa1f5545ed490bd46eb29d6709fc3b8be9b` 的重新构建产物复测。原首页构建引用冲突采用主分支 index 模板再构建，不将旧 8afc 构建的通过结果直接沿用于新产物。

实际加载新 JS：`app.71deef1892cb911ef7ce1bc92d7b1d9b0aed53e6ab0370b4a03aad7227856f3c.js`。健康 `app.js`、`provider-ui.js`、导出脚本和映射模块指纹与前文一致；映射仍为 9 条。

独立重新执行原两条命令，结果为 **provider/临时 SQLite 7/7 通过、真实隔离后端与 Chrome 8 组通过**。总览/列表/详情品牌图、重庆不同图、未审城市与未知 ID 的通用标识、品牌选择器保存、桌面两个标签隐藏、原件旧链接、直接回顾路径和手机回顾均保持通过；360px document/body/main/clientWidth 均为 360，无未捕获页面异常。

新证据目录：`/var/folders/wb/j54mykvj0k71fcm7rs8my5r80000gn/T/logo-map-evidence-bbYcXv/`，包含 `home-logo-desktop.png`、`visits-desktop.png`、`visits-360.png`、`result.json`。本次同样仅使用临时虚构数据，无真实账号、医院缓存或生产数据操作。

本节覆盖主分支合入后本任务的受影响行为，不代替作者对资产概览与完整应用的工程测试，也不代表生产部署验收。原 8afc 构建记录保留作历史证据。
