# 资产分区与到期/续费

在现有资产工作台内分为金融资产、固定资产、到期与续费。保持finance工作台ID、既有记录ID/原文、来源与原件不变，不拆新工作台。

## 领域与兼容合同

- 复用asset_holding，新增可选字段：assetGroup(financial/fixed/other)、expiresOn(YYYY-MM-DD或空)、renewalOn(YYYY-MM-DD或空)、renewalAmount(>=0<=1e15，可缺失)、renewalCurrency(uppercase3，可缺失)、provider(<=250)、identifier(<=250)、renewalMode(unknown/manual/automatic，可缺失)。category新增server/domain，既有cash/fund/stock/property/vehicle/equipment/subscription/other保留。
- 分组兼容：显式assetGroup优先；旧github:holding:<asset_id>且JSON包装「资产原始信息」的asset_id精确匹配时归financial（包括尚未细分的可转债/待核实金融项），不改变金额/状态；其他情况下cash/fund/stock→financial；property/vehicle/equipment/server/domain/subscription→fixed；other→other。不能因分组将金额重复加总。
- expiresOn为到期日；renewalOn为续费安排日，语义不同，不相互冒充。日期可为未来，不属于当前估值date/valuationDate的未来限制。有效真实日历日期；清空日期应保留明确空值标记以阻止旧来源回退。
- renewalAmount仅续费参考费用，不能写入value/unitPrice/cost/quantity或净资产。未知费用、自动续费状态保持未知；renewalMode=automatic仅记录平台已有设置，不调用付款或续费服务。
- 到期状态按Asia/Shanghai的today与UTC日期差计算，不使用宿主机时区。已关闭holding不出现在临期/逾期提醒；记录过期不自动结束、不自动改估值。若有两个日期保留各自标签，提醒以最近一个日期为主；来源记录已过日期只称记录日期已过，不断言服务已停。
- 只对server/domain/subscription或显式填过任一生命周期日期的holding显示无日期提醒；普通房产/设备/基金不无端催填到期日。

## 原导入资料的只读适配（不写用户记录）

现有个人档案已由MCP确认导入，3条固定资料的note保留完整JSON包装「原始固定资产」，externalId为github:fixed:<原id>。可在读取时解析已保存的JSON，校验原id与externalId相等，并仅从白名单字段提取：原SRV前缀记录→category=server、原DOM→domain；provider或registrar、域名name作为identifier、expires_on→expiresOn、renewal_on→renewalOn、有效renewal_price/currency→renewalAmount/renewalCurrency、布尔auto_renew→automatic/manual，null→unknown。不要导出原凭据/连接字段。

解析器兼容真正JSON及导入时转义的格式换行：只在JSON字符串外将字面\\n/\\r/\\t转为空白，字符串内保留标准JSON转义。格式坏、ID不匹配、字段类型/日期/金额无效时不猜，仍返回原note及可编辑未知字段。明确已有字段（包括空字符串）优先于原始JSON；不覆盖用户编辑。不依赖硬编码个人域名/日期/服务器信息，不修改SQLite行、不自动回写MCP、不改GitHub/Drive源数据。

前后端共用public/asset-lifecycle.js的纯函数（server可直接import无DOM依赖），root实现此文件。导出：
- assetGroup(item) → financial/fixed/other（兼容已有category）
- enrichAssetHolding(item) → 对asset_holding的浅克隆，补可用legacy字段，原对象不变；非holding原样返回。只读填补、显式值优先，坏原文不抛异常。
- assetDeadline(item,today) → {date,kind:'expiry'|'renewal',days,status:'overdue'|'soon'|'later'|'unknown'|'closed',eligible:boolean}，soon为0..30日；无期限返回date:null，不能将缺失当1970年。用于提醒排序；备注列表仍展示两日期。

后台agent拥有lib/assets.mjs/server.mjs/lib/mcp.mjs/新backend tests；在asset_holding允许/验证新字段，public读取及MCP返回均应用只读enrich，但持久化使用显式请求字段，不偷偷回写衍生值。注意getAll用于校验/导出时只读生成亦不改SQL；put返回可补派生metadata但raw行保持明确写入字段。legacycategory的只读推断应按记录现有字段優先：现有server/domain不回退；旧equipment/subscription可按确切source包装细分。

## UI合同

前端agent拥有public/assets.js/assets.css/shell.js/app.js/新UI tests。页面financial(含账户/金融持仓入口)、fixed(服务器/域名/房产/车辆/设备/服务筛选)、renewals(全部/已过日期/30天内/未填日期)，原holdings保持全部资产兼容；原accounts/transactions/liabilities/history/documents/notes/tasks/mine保留可达。桌面导航明确金融/固定/到期，手机保持简约导航和分区入口。

卡片与详情列provider/identifier/有效日期及续费费用（非估值）；表单能选分组/分类、填写或清空上述字段；默认未知不预填0或自动续费关闭。financial/fixed新增记录默认分类与分组相符，日期清空后刷新不能再从旧note冒出。临期卡片有编辑入口，缺日期显示待补；不创建系统推送/定时自动化。共用资料查询与缩略图入口保留。

注意资产砖红主题与自定义主题应覆盖主按钮，不让generic-main旧蓝色规则胜出；通过选择器修正，不修改已有theme颜色与对比度算法。

验收：1分区与旧记录不丢；2服务器/域名未来期限与未知费用编辑重载；3逾期/今天/30日界限、closed排除、跨月年与Asia/Shanghai；4既有legacyJSON只读展示、无硬编码、无SQL回写、坏源忽略、明确清空优先；5MCP新字段与web一致、其他workbench拒绝资产kind；6金融估值/负债/原件/健康/旅行/CGM回归；7390/1280真UI核心流程无横溢；8备份部署，原用户记录hash不变，不向生产写虚构资产。
