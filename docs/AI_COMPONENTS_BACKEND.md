# AI 组件库：定义、数据与接口

基线6b30f54。实际后端实现 `/root/component_backend`；组件管理界面由`/root`整合，卡片呈现由另一工程师负责。实现自测不替代独立代码评审和交互验收。

## 模型与边界

`public/component-schema.js`是前端、服务和MCP共享的受控合同，导出COMPONENT_CATALOG、COMPONENT_TEMPLATES、createComponentDefinition、validateComponentDefinition和COMPONENT_DEFINITION_SCHEMA。

定义包括schemaVersion=1、title(1–40字)、description(0–240字)、明确sourceWorkbench、stack/grid排列、appearance及1–8个区块。appearance仅允许accent=null/六位hex、tone=neutral/tinted、density=compact/comfortable。区块为stat、chart、list、progress，顺序即显示顺序。不能携带HTML、JS、CSS、SQL、URL、表达式、下载地址或其他数据来源。

每个组件只有一个本人可访问的来源工作台。目标页面可以不同，但数据始终来自定义中明确指定的来源；模型含来源名称与personal/demo标记。源数据空间由服务器按当前账号+来源工作台+基空间解析，不接受任意owner或内部数据空间ID。

支持的binding包含kind、aggregation、days(7/14/30/90/null)、可选field/metric/limit/onlyPending/todayOnly。days=null包含全部时间及允许存在的未来安排；有限天数按Asia/Shanghai当前日及此前日历天筛选，图表必须有限天数。todayOnly进一步限定今天，用于当日饮水。onlyPending仅适用task/travel_check。列表数量1–8。

数值字段仅包括运动duration/distance、饮水volume、指标value/secondary及阅读minutes。secondary仅血压可选。健康指标必须明确weight/pressure/sleep/glucose/heart。金融类只允许count/list/dailyCount，不提供金额加总或隐式换汇；其他旅行/阅读对象也支持计数及列表。

stat使用count/sum/latest；chart使用dailySum/dailyCount/dailyAvg及bar/line；list使用list；progress限非临床的饮水/运动/待办/阅读/准备清单count或sum，目标为有效正数或已有waterGoalMl设置。readSettings只读取饮水目标，不修改设置。

未填的可选数值不当作零：有记录但该字段全缺时sum为null；无记录的sum为0；dailyAvg无样本为null；dailyCount无记录为0。模型只提供显示数值、图表日期/值和列表title/date/detail，不传病历原文、文件内容、路径或凭据。相同来源和相同已发布组件在一次页面解析内复用缓存。

## 草稿、发布与历史

创建和编辑只保存工作草稿。已放置页面继续解析published_definition。publish显式更新发布版本并影响所有引用；归档使实例停止显示数据，保留可恢复占位。恢复归档后显示此前发布版，未发布的草稿不会自动出现。

复制生成独立新草稿，不复制发布状态或放置。恢复历史只恢复definition为新的工作草稿，保留现有发布版本和归档状态；需要另行发布。每个库最多50项（含归档），保留最初版本及最近30个版本。每次写入需要expectedRevision，409时不能盲目覆盖。

预览有效一小时，最多每账号20份。预览不创建组件库条目、不发布、不改任何业务记录。保存预览才写入草稿；保存同一预览重复重试返回同一个条目，不重复创建。已有组件预览必须携带componentId及expectedRevision，保存还会检查预览基准与当前revision。预览链接需要所属账号登录，不具备跨账号授权能力。

## Web API

全部`/api/components*`读写沿用认证和X-Workbench-Owner核验，写入同时经过同源及请求体完成后的会话复核。以下请求均带既有workbench/space查询参数；page只支持dashboard（阅读界面books映射此页）。

| 方法/路径 | 参数与结果 |
| --- | --- |
| GET `/api/components/types` | catalog/templates/workbenches/owner |
| GET `/api/components` | 条目元数据、目录和模板；includeArchived=true/false，默认true |
| POST `/api/components` | `{definition}`创建草稿 |
| GET `/api/components/:id` | 草稿、发布定义、版本、使用位置与owner |
| PUT `/api/components/:id` | `{expectedRevision,definition}`保存新草稿 |
| POST `:id/duplicate` | `{expectedRevision,title?}`复制草稿 |
| POST `:id/archive` | `{expectedRevision,archived}`归档/恢复 |
| POST `:id/publish` | `{expectedRevision}`显式发布 |
| POST `:id/restore` | `{expectedRevision,revision}`历史定义恢复为新草稿 |
| POST `/api/components/preview` | `{definition,componentId?,expectedRevision?}`返回definition/model/previewId/previewUrl/expiresAt/space |
| GET `/api/components/previews/:id` | 本人未过期预览，按存储的基空间解析实时数据 |
| POST `/api/components/previews/:id/save` | 新组件`{}`，已有组件`{expectedRevision}`；保存为草稿，不发布 |
| GET `/api/components/placements` | 目标页revision、libraryRevision、desktop/mobile数组与history |
| PUT `/api/components/placements` | `{expectedRevision,desktop?,mobile?}`替换所传设备数组，未传设备不变 |
| POST `/api/components/placements/restore` | `{expectedRevision,revision}`恢复放置历史并新建版本 |

实例为`{instanceId,componentId,zone:'top'|'bottom',size:'small'|'medium'|'large',visible:boolean}`。每设备最多12实例，同一设备实例ID不重复，同一跨设备实例ID不能绑定不同组件。新放置必须本人已发布且未归档；既有归档实例允许移除或调整。放置历史保留最初0及最近30版本。

所有工作台bootstrap/state附componentView，提供当前目标页的两端实例及已发布模型，草稿不混入。libraryRevision为本人所有组件revision之和，单调递增；轮询放置时比较它与placement revision，可检测外部AI发布/归档，而不仅是实例位置变化。

## MCP

新增14工具：list_component_types、list_components、get_component、create_component、update_component、duplicate_component、archive_component、preview_component、save_component_preview、publish_component、restore_component、get_component_placements、update_component_placements、restore_component_placements。

AI先查目录并按自然语言生成受控definition，再创建草稿/预览/发布/放置；也可先preview再save。编辑和恢复不会自动发布。MCP和Web共用同一服务、校验和事务；用户明确要求的展示调整可直接执行并可撤销，原医疗记录写入/删除确认规范保持。serverInfo为1.2.0，连接端需刷新工具列表发现新增接口。没有新增应用内模型服务或伪造AI回复。

## 存储、升级与自测

007迁移只新增component_library、component_versions、component_previews、component_placements、component_placement_versions及索引/版本记录。未改既有layout表、用户、健康记录或附件。旧代码可忽略新表；现有SQLite整体备份包含新表。跨表写入使用同一个BEGIN IMMEDIATE事务。

`tests/components.test.mjs`验证schema/模板、草稿与发布隔离、跨台及个人/示例解析、归档/复制/历史、真实数值与空值、私有预览/过期/幂等保存、并发CAS、失败事务回滚、历史上限、API/MCP双账号和重启。既有MCP工具清单测试同步为严格完整列表。工程测试结果由主Agent整合，不能替代独立验收或生产发布核验。
