# 旅行工作台（Trek 核心流程）

用户授权：在现有工作台加入精简旅行能力，root负责产品取舍与整合，不导入用户行踪或凭据，不进行预订/支付。参考本地 TREK 的概念与用户流程，独立实现；不复制其 AGPL 源码或资源。

保留：旅行清单、旅行详情（按日地点/预订/准备/资料）、地点地图与外部导航、预订信息和原件、行李与出发清单、独立主题。删减：协作分享、轨迹/户外路线、复杂分账换汇、自动预订、AI行程生成、照片书和游记编辑。第一版不要求任何地图API密钥，地图服务不可达时地点清单仍可用。

## 固定接口约定

- 内置工作台 `id=travel,type=travel,name=旅行,themeColor=#356A98`。已有/新用户都有；保留已有主题与名称，personal/demo分别隔离。
- 所有记录继承系统字段 `id,kind,title,date,time?,note`，支持现有web/MCP CRUD、软删除30天恢复和导出。字段不明不捏造。
- `travel_trip`: destination(string<=250), startDate/endDate(YYYY-MM-DD, end>=start, <=366日), status(planned/active/completed/cancelled)。`date`由startDate统一。自由备注用于同行人等补充。
- `travel_stop`: tripId(required), category(attraction/food/stay/transport/other), address(string<=500), lat/lng(optional paired finite WGS84,-90..90/-180..180), position(integer0..10000), done(boolean)。base date必须在所属旅行范围内，time是目的地当地墙上时间；无坐标也能记地点。
- `travel_booking`: tripId(required), bookingType(flight/train/hotel/ticket/car/other), status(planned/confirmed/cancelled), confirmationCode(string<=120), location(string<=250), endDate(optional >=date), price(optional finite>=0<=1e12),currency(uppercase3),referenceUrl(optional http/https only)。base date在旅行范围内，endDate<=旅行结束日+1日（住宿退房）；仅保存预订档案，不付款/出票。
- `travel_check`: tripId(required), category(packing/todo), done(boolean)。base date为有效事项日期，不限制在旅行起止内，以支持出发前签证/保险及回程报销；修改旅行日期不自动改清单日期。
- 原件沿用file，新增tripId(optional仅旅行文件且同scope有效父旅行)，PDF/PNG/JPG/JPEG/WEBP/TXT <=10MiB，现有缩略图/原件预览，文件不得关联健康visit。
- tripId关联必须同scope且travel_trip。删除旅行将相关stop/booking/check/file按现有父子软删除原子处理；恢复时保证父先可见。更新旅行日期若已有子项越界则拒绝并解释，不悄悄移动/隐藏数据。禁止带子项跨旅行改tripId（或校验日期和原关系）。
- Web所有旅行写入、上传、恢复要求现有X-Workbench-Owner匹配。MCP复用鉴权scope。travel类型仅note/task/file+TRAVEL_KINDS；健康和资产不接受旅行类型；other不接受file/travel。
- 按现有外部ID模式支持 externalId/source/sourceDate/referenceUrl 幂等和来源（若提供），引用与导出不能跨工作台。

## 前端/地图模块接口

- `createTravel(ctx)`导出 `titles,render(),bind(),handle(action,arg),cleanup()`；travel前缀actions交给模块；shell负责frame/sidebar/bottomnav/theme，app负责路由/清理。
- route pages: dashboard,trip,places,bookings,checklist,documents,mine。旅行页内用选择器选trip（保留内存selectedTrip），总览卡点选trip进入`trip`。按日分组地点和预订；地图显示选中旅行已给坐标的地点。
- root独占实现 `public/travel-map.js`，导出 `mountTravelMap(container,{points,onPick})`，返回cleanup函数；points:{id,title,lat,lng},onPick({lat,lng})可选。地图不主动取定位；只有用户点“加载地图”后取第三方瓦片，展示来源说明，失败保留列表。UI模块传containerDOM，不用静态HTML iframe。root提供Leaflet本地vendor/js/css及build接入。
- 地点录入：title/date/time/category/address及可选坐标；地图选点可写坐标，地点搜索/导航用外部高德搜索链接（仅地点名称/地址，坐标明确WGS84不冒作GCJ02），不实现服务器地理编码。名称和地址以URLSearchParams编码，link仅固定HTTPS地图域名。外部打开不自动定位。
- 保存/删除/文件操作包含来源scope/workbench/owner guards，不因切换/过期抽屉回写。手机390px无横向溢出，长列表和drawer可滚动，错误留表单，空态不捏造旅行。备忘/通用待办入口可留在我的，不挤占主导航。

## 可观察验收

AC1已登录用户能切换健康/资产/旅行，蓝色主题分别保存；AC2创建/编辑旅行并重载保留；AC3按天添加地点，地图点位与列表对应、缺坐标也可导航搜索；AC4预订及票据可以新增/编辑/查看；AC5行李/出发事项打勾保留；AC6整趟删除/恢复关联数据完整且跨scope失败；AC7日期/金额/URL/坐标无效不保存；AC8个人空态不造数据，demo虚构标识；AC9桌面与390px真实UI流程验收；AC10原健康/资产/CGM隔离与回归通过。发布沿用现有腾讯云服务器，备份后部署并读回检查，不往生产写虚构行程。

## 地图来源与边界

本地固定版本 Leaflet 1.9.4（BSD-2-Clause），从 npm 官方包下载并核验 SHA-512，许可与来源保存在 `public/vendor/leaflet-1.9.4/`。无 Trek 源码或图片复制。

显式点击加载后，浏览器使用 OpenStreetMap 标准瓦片，保留版权与缓存；图片单独使用 origin referrer，站点其余私有文件链接仍遵守原有无referrer策略。无定位权限请求、无后台预取、无路线/距离推算。地图网络不可达仍保留地点文字、手工坐标和固定高德地址搜索链接。地址搜索会将所选地点名称/地址传给高德，不带备注/账号资料。点位按已保存WGS84坐标显示，不将直线连线冒充实际道路。

接口依据：[Leaflet 1.9.4 reference](https://leafletjs.com/reference.html)；[OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/)。
