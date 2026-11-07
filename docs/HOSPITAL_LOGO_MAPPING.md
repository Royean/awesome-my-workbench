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

首轮将原目录中 8 个已有核验资产以唯一全名关联回医院表；没有唯一对应的原目录条目继续保留原有映射。另补充 1 条新桥口腔品牌记录，共导出 9 条审核映射。采集得到的其他候选不自动升级为已核验。

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

主分支 PR #69 资产总览合入后，基于3516912解决唯一index构建入口冲突并重建，功能提交f2b50fa；当前JS71deef1892cb911ef7ce1bc92d7b1d9b0aed53e6ab0370b4a03aad7227856f3c，作者全套323/323通过，独立7项+8组复测通过。

## 2026-11-06 缓存增量与院区匹配

- 医院详情、Logo 候选、来源和审核结论都通过 `hospitals.hospital_id` 关联。现有 25,984 条记录包含 25,972 条 A+ 历史医院候选、1 条品牌和 11 条新桥口腔院区记录。补齐了原先缺失的 3 条历史详情，并从详情原文回填了 25,954 条医院类型。现行执业登记仍待核。
- 对 65 条首次发现的外部网址进行了采集，14 家得到 22 张候选。另复查 5 家有旧网址的医院。经核对后，本轮新增 21 家医院的院徽与 11 条院区映射。表内共 41 条审核映射，对应 30 张独立审核图片。另有 373 条记录的候选图待审核，22,926 条记录还缺可用于采集的网址线索。
- 保留已有目录 ID `pku-first`、`pku-third`、`fudan-huashan` 及其常用别名。山东大学齐鲁第二医院沿用历史医院表 ID，目录展示校方现用名称，同时支持旧名“山东大学第二医院”。[北大三院院徽](https://www.puh3.net.cn/info/2641/100461.htm) · [华西口腔院徽说明](https://www.hxkq.org/Html/News/Articles/3766.html)
- 新桥口腔的品牌条目与成都 8 个院区、西宁、德阳、自贡各 1 个院区共用用户已确认的蓝底标识。人南总院和衣冠庙院区分开建档。德阳的门牌号有冲突，地址栏留空并在详情保留两种来源。[集团品牌页](https://www.meiweigroup.com/catalog/8) · [人南院区开业资料](https://health.baidu.com/m/detail/ar_10067343745011966639) · [四川卫健委历史机构名录](https://wsjkw.sc.gov.cn/scwsjkw/wszy/2017/1/9/6abf3ec8fde641499c1d14cde078fd8e/files/c81cc40e07594b98b02c90a91a1379ec.pdf) · [平安医疗服务网络](https://iobs.pingan.com.cn/download/pah-ows-dmz-prd/3960dc1609914b6983201fa2a87cecfe)
- 以机构名称和城市自动匹配时，优先匹配已核对的确切院区名和别名。已知院区与填写城市冲突时用通用医院图标，使用已保存的品牌或院区 ID 时也检查这类冲突。旧品牌 ID 仍可读取，品牌范围内只有名称带括号分院后缀时才尝试品牌回退。重庆新桥医院保留自己的院徽。

## 2026-11-07 定时采集增量

本轮从既有候选中核实上海同济、上海新华、成都爱尔、自贡四院、北京博爱、北京中医药大学三附院、北京友谊和沧州人民的院徽，并从新官网补采成都中医药大学附属医院的彩色标识。审核保留当前官网原文、原图、来源和哈希。四川省肿瘤医院与四川生殖专科医院的白色横向组合字标继续留待显示适配，龙华和西苑的访问限制及整形外科医院的城市核对也保留在待办中。[成都中医药大学附属医院](https://www.sctcm120.cn/) · [北京友谊医院](https://www.bfh.com.cn/)

本机统一表有 25,984 条机构资料，416 条记录有图片候选，共 684 个关联、652 张按内容去重的候选图片。审核映射增加至 50 条，使用 39 张独立图片。366 条有图记录待审核，22,925 条尚缺可用采集线索。数据库完整性、旧映射及城市匹配按本轮产物核对。原网页、审核决策、变更前记录和本轮统计位于参考缓存的 `hospital-catalog/runs/2026-11-07T2317/`，持久断点为 `hospital-catalog/heartbeat-checkpoint.json`。
