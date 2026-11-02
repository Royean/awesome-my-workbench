# 各工作台共用的资料原件

目标：健康、资产、旅行和自建工作台都能上传、查询、查看缩略图与原件；保留各账号、工作台、personal/demo隔离。整合现有同源preview能力，不修改已上传字节，不向外部OCR发送文件。

用户路径：资料入口 → 按文件名/标题/备注搜索，按类型与日期筛选 → 点击缩略图或名称看原件 → 下载；可编辑元数据、软删除和恢复。图片显示图像缩略图，PDF显示首页，TXT/音频等用清楚的类型图标。失败仍保留打开/重试入口。PDF翻页/缩放、图片缩放、TXT原文及现有音频播放保留。

当前缺口：旅行资料仅列当前trip，未关联trip的MCP原件无法看到且无搜索；资产搜索未覆盖原始文件名/类型/日期；自建工作台没有文件入口且服务端拒绝文件；MCP list_attachments仅按limit返回且不支持搜索分页。

## 合同
- 共用前端原件组件：统一名称、缩略图、类型/日期/大小、搜索、PDF/图片/文本/音频类型筛选、起止日期筛选与重置、空态。搜索为安全元数据匹配（title/name/note，关联旅行/就诊名称可增加）；不承诺PDF/OCR全文索引。
- 各工作台有资料入口，自建工作台也支持file。健康保留原报告关联/整理入口，临床报告/药物图片逻辑不能降级；旅行可选当前旅行/全部旅行资料/未关联资料，能看到MCP上传但未填tripId的文件；上传可选关联旅行。
- 所有工作台一般上传支持PDF/PNG/JPG/JPEG/WEBP/TXT <=10MiB；保留健康HTTP接口原有音频格式及餐食音频附件的上传、查询和播放能力，其他工作台及MCP上传不扩张音频格式，不接受可执行格式。自建/资产/旅行不能关联visit，非旅行不能关联trip。非健康文件不得带跨模块关联字段。
- 共用上传/编辑/删除必须捕获owner+space+workbench，异步读文件前后与提交前校验，旧账号/空间抽屉不得写入新账号。缩略图与viewer切换时清理abort/task/objectURL，不保留旧空间画面。
- backend listAttachments(space, options)支持旧numeric limit兼容及新query/fileType/from/to/offset/limit/tripId筛选。query<=200，fileType=all/pdf/image/text/audio，date严格真实YYYY-MM-DD，to>=from，offset整数0..100000，limit1..200。tripId未传全部，字符串'unassigned'未关联，仅旅行可指定真实同scopetrip。按date+time+id稳定倒序，total为过滤后的条数，返回returned/offset/hasMore/nextOffset及safe files，保持原有SHA-256，不暴露storageName。
- 提供同等HTTP GET /api/attachments（沿用queryscope），MCP list_attachments传同名参数；upload_attachment/list_attachments允许所有已注册的工作台，其他医疗attach_*仍仅health。file不作为create_record kind，仍走专门上传。
- HTTP各工作台file上传/修改/删除/恢复均要求现有X-Workbench-Owner；MCP继续PAT/session复核及scope隔离。不能借customfiles写健康/资产/旅行专有kind。

验收：四种工作台含自建都能使用资料与预览；图片/PDF真实缩略图；查原文件名/备注+类型/日期组合并重置；旅行未关联资料可见；MCP>200分页无漏无重复；跨账号/工作台与demo隔离；手机390长列表和预览可滚动、无横溢；既有报告关联、健康/资产/旅行/CGM回归正常。仅隔离虚构测试，不写生产假资料，备份后部署。
