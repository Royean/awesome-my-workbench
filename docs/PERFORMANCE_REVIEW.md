# 登录与操作性能独立代码评审

日期：2026-10-31。执行者：`/root/performance_review`，开发工程师角色；未参与功能实现。基准：`fb3d3b2`，评审实际工作区差异。遵循私人角色定义与 software-development 工作流。

## 范围与证据

阅读 `public/account.js`、`public/app.js`、`public/request.js`、`scripts/build-public.mjs`、`server.mjs`，以及构建、启动和部署入口；对照账号接口、业务写入调用点、Service Worker 和现有隔离约束。未访问生产、真实用户资料或实体 Android 手机。

- 登录、邀请激活返回账号后直接调用应用初始化；清空旧记录、撤销状态及缓存，重设个人健康工作台。不再依赖成功登录后的整页重载。
- 状态缓存仅在内存，按用户 ID、空间、工作台分键，最多 8 项，30 秒内切换可先呈现并后台请求；API 与附件保持 no-store。认证失败仍清界面、重载。
- 构建器递归转换当前应用使用的具名本地导入，隔离模块闭包，入口顶层 await 保留。当前模块没有动态导入、import.meta 或相对 CSS 资源路径；不声称支持任意 ESM 语法。
- 完整 SHA256 校验匹配的 public JS/CSS 才返回 immutable，HTML/API/附件不缓存；构建保留旧 hash，先写资源再原子替换 index。npm、双击启动和正式安装脚本已接入构建。
- 独立运行 Node24 `tests/assets-cache.test.mjs`：2/2 通过，使用隔离临时目录及虚构资料。
- 独立 mock POST 连接中断、无效 JSON、超时：3/3 提示结果未知、先刷新检查；连接中断只调用 fetch 一次，无自动重试。
- 将实际 load 函数放入隔离 VM，模拟当前状态 GET 在途时写入失败使 cacheEpoch 变化：仅重发一次 GET，最终渲染当前工作台，无写请求。
- 在独立临时目录重新构建最终 public，生成的 index 与当前文件逐字一致，入口为 `app.b8595893e957200e61c4b337e5a7e360912652eaab0e75163afa5db198e32fdc.js`。

## 发现与修复复核

| 编号 | 级别 | 问题与处理 | 状态 |
| --- | --- | --- | --- |
| R1 | P2 | 账号面板退出、撤销当前会话及账号 API 401 原先只清 DOM，未统一清应用内存及禁止交互；新增 onUnauthorized，在重载前清记录、缓存、撤销信息并推进请求序号。 | 源码复核通过 |
| R2 | P2 | 写入连接中断原先建议重试，服务可能已经提交；现在写超时、网络失败、无效响应均提示先刷新确认，写入开始及结束/失败使内存缓存失效。 | 源码及三种故障注入复核通过 |
| R3 | P2 | index 改指纹文件后，后续源修改可能未进入产物；增加 build/prestart、双击启动构建、部署安装构建。 | 源码复核通过 |
| R4 | P2 | 在途写入失败会推进缓存代次，可能使切换中的当前 state 成功响应被丢弃并停留加载界面；当前序号、用户及认证状态有效时重发 GET，不重试写入。工作台合法性验证也移至入缓存之前。 | 源码及隔离竞态复现复核通过 |

## 结论

以上四项已修复复核，未发现剩余阻断代码问题。浏览器验收另见 PERFORMANCE_ACCEPTANCE.md；本报告不替代独立测试验收，也不证明公网或实体 WebView 性能提升已经实测。

整合者后续补充（`/root` 自查，非独立复核）：构建器将可信favicon内联为data URI，消除hash切换时的图标HTTP请求，新增对应幂等/图标变更测试；切换数据空间时立即清除原DOM显示切换状态。最终50项回归、15组浏览器交互通过。独立评审源快照保留如下，后续两处小改动不冒充已由原评审者重新执行。最终app源SHA为`b1c0d4bcceb0e7820d35597e6ad4dacad999cf61dcffd647f5f582ca8aeca12a`，builder源SHA为`eb50cdd7f387ea757d181687ebe8ff7ffe665dd28291270d13b3ccb9a092396a`。

复核源码 SHA256：

| 文件 | SHA256 |
| --- | --- |
| public/app.js | c689790ab47535aeb78d217035385052c1a017bab297624dbacc1065e4a25ffa |
| public/account.js | b57ec15ab0e79a6843909a6b3b83365de05f396b369be365084fdfcfd50a35ce |
| public/request.js | 8f9199defaf8186d71b4ed0d03f2f4351e0eb238560412304855bbddc8c74e1e |
| scripts/build-public.mjs | ff3ea03d81422ac798fdfac2a603dc910abf57e47eabe1e453cb032c9d3cca56 |
| server.mjs | c15408bd65262aa67b72cd7a288051bd6d24d603c42495e1cd88dea77493d8d4 |
