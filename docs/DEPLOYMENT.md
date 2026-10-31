# 私有部署

线上地址：[知衡健康工作台](https://zhiheng-health-workbench.epiccurry16.chatgpt.site)。

Sites 原生发布返回 `succeeded`，无失败信息。生产访问由 Sites 登录与私有访问策略保护。D1保存结构化记录，R2保存附件；API逐请求验证访客身份，并按用户与空间限定读取和写入。本地资料没有自动迁移，线上个人空间初始为空，示例为虚构数据。

- Project：`appgprj_6ae587d81f608191b324c664454dfd99`
- Deployment：`appgdep_6ae5977e03508191beff4bd033e9d57a`
- Version：`appgprj_6ae587d81f608191b324c664454dfd99~appgver_24a794dc75748191beb1a7b3ab014b35`
- 线上源码提交：`689971f1ef1b6ef938c2aa4bf5a9b43d631ec0f5`
- 成功时间：2026-10-31 15:24（Asia/Shanghai）。

源码在同级 `health-workbench-online`，使用Sites Vinext starter以及DB/BUCKET绑定。构建、D1迁移及R2仿真API/登录UI已经验证；本地API31项与收藏7项逻辑断言通过，详见 DAILY_ACCEPTANCE.md。真实生产登录由用户打开线上页面完成，未冒充已代登录。部署成功以Sites原生结果为据。

## 更新

更新本地业务代码后，在云目录运行 scripts/sync-domain.mjs 和 scripts/sync-public.mjs，然后按Sites技能构建、推送和发布。不要复制本地data、上传原件或凭据到源码中。不得只上传静态页面替代D1/R2后台。
