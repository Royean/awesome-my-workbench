# 医院表到界面标识的映射

用户要求健康工作台通过已经整理的医院表建立医院→Logo映射，并确认使用展示的蓝底“新桥口腔”品牌图。同时要求移除健康模块顶部“资料原件”“每日回顾”两个 Tab。

开发工程师 `/root`；独立测试验收工程师 `/root/todo_acceptance`；品牌资产取证与图像比对 `/root/latest_health_design`。在独立工作树基于主分支实现，原工作区未提交改动保留。

## 数据流

`data/reference-cache/hospital-catalog/hospitals.sqlite` 的 `hospitals` 表 → `scripts/export-hospital-logo-map.mjs` → `public/hospital-logo-map.js` 与 `public/provider-logos/hospital-<sha256>.*` → `institutions.js` 合并原目录 → `resolveInstitution` / `institutionMark`。

导出器仅读取公共参考库，不访问个人健康记录；不把整份医院详情库放入浏览器。

```sh
node scripts/export-hospital-logo-map.mjs /absolute/path/hospitals.sqlite public
```

仅导出同时满足以下条件的行：`logo_verified=1`、`logo_review_status=approved`、表内展示路径对应一张 `approved` 候选、原图 SHA-256一致、来源URL有效、审核日期明确，且有明确审核城市；连锁品牌则必须声明 `scope=brand`、审核城市列表，并将预填城市留空。当前只支持审核后的 PNG/JPEG 图像。

医院表的 `details_json.logoMapping` 保存 `publicId`、目录规范名/别名、`city` 或品牌 `cities`、`scope`、`reviewedAt`、`website`。沿用原有目录 ID，避免已有就诊中的 `hospitalId` 失效。

本次将原目录中 8 个已有核验资产以唯一全名关联回医院表；没有唯一对应的原目录条目继续保留原有映射。另补充 1 条新桥口腔品牌记录，共导出 9 条审核映射。采集得到的其他候选不自动升级为已核验。

本机医院表与审核补丁位于同一 `hospital-catalog` 目录；`verified-logo-review-patches.json` 保存全部审核行及品牌补充行。重建基础合并缓存后，先按医院 ID 恢复这些公共审核补丁，再重新导出。发布的界面映射及图像已纳入版本控制，运行时不依赖本机缓存路径。

## 新桥口腔来源及边界

- 新增表内 ID：`supplement-xinqiao-dental`；公开目录 ID：`xinqiao-dental`。
- 品牌身份依据：[美维集团品牌页](https://www.meiweigroup.com/catalog/8)。
- 官方图像对照：[集团新闻](https://www.meiweigroup.com/article/73)与其院内照片；集团品牌页的建筑照片不能当独立 Logo。
- 干净图像的实际来源：[第三方公众号目录](https://m.wxnum.cn/cdxqkqyy.html)，[原图](https://m.wxnum.cn/cover-ico/xqyake.jpg)，90×90，SHA-256 `66699bb57972917de9ea4c5b7884d394c4291d26235f832a81e23b6f94872216`。
- 已向用户展示图像及第三方来源性质，2026-11-05用户明确回复“是，使用这张品牌 Logo”。审核依据为用户确认与集团图像比对，不声称原图由官方站提供或已证明是最新品牌版本。
- 该条 `record_scope=brand`、`current_registration_verified=false`，不冒充某家分院的执业登记。城市范围根据集团品牌资料记录为成都、西宁、德阳、自贡；具体分院及城市仍由就诊记录提供。

名字“新桥医院”不会因此映射为口腔品牌。品牌匹配仅支持确切名称/审核别名及其括号分院后缀，且校验城市范围；显式 ID 的品牌映射也受该城市范围约束。旧目录的非品牌显式 ID 和未知显式 ID 行为保留。存在歧义或无法匹配时仍用通用医院图标。

## 导航

从健康侧栏源导航移除 `file`、`day`，由此派生的桌面顶部模块 Tab 也不再展示这两项。资料仍可从就诊管理“报告与资料”访问，旧 `#file` 书签继续转到 `#visit/files`；每日回顾路由和手机底部回顾入口保留。没有删除任何记录或附件。

## 验证结果

构建成功；作者全套 Node 测试 310/310 通过；独立离线 SQLite/解析映射 7 项及真实隔离 Chrome 浏览器 8 组通过。新增导出字段不含完整医院详情或私人就诊数据。图像来源和批准依据见上文及独立报告。
