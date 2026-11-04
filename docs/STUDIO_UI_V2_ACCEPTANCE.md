# Studio UI v2 独立验收

日期：2026-11-04。实现协调：`/root`；独立执行：`/root/ui_acceptance`，测试验收工程师。适用私人角色库的测试验收与代码项目协作规范；本记录不是 GitHub 正式审批。

**结论：本轮已约定的真实 bento 界面与交互检查通过。** 五台个人空态、示例数据态在1440桌面和390手机视口均使用新分区，健康不再是旧四项指标横排。主题独立保存、阅读诗篇分页/目录与 PDF 拖入确认可用。主流程75项检查无失败、0未捕获异常、0控制台错误；末轮阅读结构、图表、封面修复已在对应构建局部复测，无未解决的本轮必测失败。

## 产物与隔离

唯一验收源为 **`/tmp/aw-ui-studio-pr`**，基于 `origin/main` 的 `34292db-poem-reader` 集成新实现，关联本次 PR #54。没有使用此前 `/tmp/aw-ui-production-baseline` 或旧工作区的运行服务替代。

Node v24.20.0、实际安装的 Chrome 156.0.8078.80，通过本地 Playwright 驱动。桌面1440×1000，手机浏览器视口390×844。全新系统临时数据目录、`HEALTH_DATA_DIR` 显式隔离、`NODE_ENV=test AUTH_REQUIRED=0 HOST=127.0.0.1 APP_ORIGIN= PORT=0`，独立服务端口56777。没有访问生产数据库或3100服务。

先检查五台真实个人空态，再仅在隔离 demo 范围通过真实后端写入明确的虚构验收记录：金融账户与持仓、京都示例安排、虚构书目与阅读时长、备忘与待办。诗篇阅读使用隔离上传的两首公开古诗样本 TXT，说明其只是分页验收样本。截图保留“示例空间/虚构”标记；没有把概念稿中的数值硬编码进 UI，也没有用接口 mock 替代业务后端。

主流程实际加载 JS `6984a0e47f8288b20cfa034045e2f794ceeec5ce6630558911ba1dbde446c4c2`、CSS `fae2abf8d4cff7cb05076309d62700df59150d5d1ddd7e8018b2ae4979f872d9`。随后图表及领域文字修复只复测阅读/资产/旅行；最后阅读布局与封面局部复测加载最终：

- JS：`/assets/app.ac6fa881c9ed84057003a089cbdbd6c630d718bc0886fa01a9bba9d7cc98bebb.js`
- CSS：`/assets/app.2273d425fb1cea5b5fe6c095fc669d7dd5d373baad8a7ee01b85c7d02ff1617f.css`
- 最终 `public/index.html` SHA-256：`1a33446b50f1b199cc5ecc542713c56e053b2af6030ef726d1e729508b8810f5`
- 最终 `public/studio-library.css` SHA-256：`78826480daa953a4732852b02b75052f24a6987d15f02afe104719fe641541c9`

其他源文件指纹分别记录在结构化证据中，以各次浏览器实际加载的 bundle 为准，不把开发过程中的新旧构建混写成同一次全量执行。

## 实际检查

| 检查 | 结果 |
| --- | --- |
| 健康真 bento | `.health-bento` 存在，旧 `.metrics` 数量0；桌面为主趋势、纵向身体指标、右侧饮水/待办/就诊，下面运动与餐食；手机按单列重排 |
| 资产真 bento | 主区域总额/构成/金融记录与独立侧栏到期/待办/固定资产/账户资料；空态不编造估值，数据态来自隔离持仓与负债 |
| 旅行真 bento | 当前旅行、行程/地点区与倒计时/准备进度/预订/清单分区；空态与有示例行程均可显示 |
| 阅读真 bento | 继续阅读、本周阅读、笔记/计划及书架分区；最后修复后书架跟随左侧主卡，右栏跨行 |
| 自建真 bento | 待办、备忘、进度环、资料及日历五块；不是旧欢迎文案加两个统计数字 |
| 两种真实数据状态 | 五台个人空态、demo数据态，两端共20个首页状态均实际打开并截图 |
| 横向宽度 | 主流程各首页、诗篇阅读器、青柠主题及五台长标题手机压力状态均无横溢；桌面document1440、main1398，手机document/main390 |
| 独立主题 | 五台分别通过实际主题表单保存白色/#824536/#003355/#679F18/#72559A，刷新保留且registry互不覆盖；之后恢复默认色并仅额外捕获健康青柠#77BC32 |
| 原有 PDF 拖入 | 桌面/手机区域和拖入事件保留；真实 DataTransfer/File drop 后打开原件导入确认，文件名显示正确，取消关闭；没有保存这个PDF样本 |
| 诗歌阅读器 | 实际TXT上传及关联书目；1440/390均可从“静夜思”翻到“春晓”，按李白搜索目录仅返回对应篇目，保留逐篇边界；阅读进度由真实后端处理 |
| 长标题 | 五台手机使用明确标记的长验收标题，文档仍390宽；独立保留 `long-mobile-*` 证据，最终展示截图恢复简短标题 |
| 运行错误 | 主流程0 pageerror、0控制台错误；末轮局部复测同样0 pageerror |

## 设计对照与修复闭环

对照用户认可的五张概念稿，已核对共同顶部工作台导航、日期问候、浅灰圆角卡片、pill操作、领域主区/右侧辅助区，以及健康的趋势+纵向指标+运动/餐食组合。本轮结果证明实际运行页面已进入新的 bento 布局，不能再用“只换颜色、保留旧四指标横排”的页面充当交付。

页面仍按真实功能和记录展示：资产按币种与已记录估值统计，旅行使用示例安排与地点入口，不把概念稿照片、历史曲线或数字当作真实资料。此报告不作逐像素一致性认定，也不代表用户已最终认可视觉；设计师/协调人的视觉判断另行记录。

| 问题 | 修复与独立复测 |
| --- | --- |
| 阅读右栏撑高导致左侧大留白 | 原数据态截图笔记/计划使overview整行变高，书架落到首屏底部。改成阅读主区网格、侧栏跨行。最终主卡bottom686.19、书架top704.19，间隙18px；首本书卡top873.38，书架已进入1000px首屏，右栏不再控制其起点 |
| 阅读柱形高度截断及零值假柱 | 最终按87px实际内容轨道量测，10/15/20/25/30分钟分别29/43.5/58/72.5/87px，两端比例正确。个人空态七根柱全部0px |
| 书架封面宽度被旧规则覆盖 | 最终构建实测首封面宽242.20px、书卡可用内容宽242px，封面满宽；没有横向溢出 |
| 资产/旅行小字过浅 | 作者对日期和来源文字加深并调整最小字号；已在新构建重截两端资产/旅行，确认页面可读及宽度不回归 |

中途柱形校验曾把轨道1px边框计入高度，产生测试误差；已按 `clientHeight` 校正并重测，不计为产品缺陷。此事实与原始末轮结果均保留。

## 证据索引

全部在 [output/studio-ui-v2](../output/studio-ui-v2/)。

- [主流程 result.json](../output/studio-ui-v2/result.json)：75项检查、两种scope、各台网格几何、主题保存、0异常及源文件指纹。
- [图表/领域末轮 final-result.json](../output/studio-ui-v2/final-result.json)：阅读/资产/旅行两端截图及柱高比例，failures=[]。
- [最终阅读 reading-layout-final.json](../output/studio-ui-v2/reading-layout-final.json)：最终2273d425 CSS、书架与侧栏位置、封面满宽、0失败。
- [最终空态零柱 reading-zero-final.json](../output/studio-ui-v2/reading-zero-final.json)：七根0px柱，passed=true。

| 工作台 | 桌面默认色 | 手机默认色 |
| --- | --- | --- |
| 健康 | [desktop-health](../output/studio-ui-v2/desktop-health.png) | [mobile-health](../output/studio-ui-v2/mobile-health.png) |
| 资产 | [desktop-finance-final](../output/studio-ui-v2/desktop-finance-final.png) | [mobile-finance-final](../output/studio-ui-v2/mobile-finance-final.png) |
| 旅行 | [desktop-travel-final](../output/studio-ui-v2/desktop-travel-final.png) | [mobile-travel-final](../output/studio-ui-v2/mobile-travel-final.png) |
| 阅读 | [desktop-reading-final](../output/studio-ui-v2/desktop-reading-final.png) | [mobile-reading-final](../output/studio-ui-v2/mobile-reading-final.png) |
| 自建 | [desktop-other](../output/studio-ui-v2/desktop-other.png) | [mobile-other](../output/studio-ui-v2/mobile-other.png) |

额外：[健康青柠桌面](../output/studio-ui-v2/desktop-health-lime.png)、[健康青柠手机](../output/studio-ui-v2/mobile-health-lime.png)、[PDF拖入确认](../output/studio-ui-v2/mobile-pdf-drop-confirmation.png)、[诗篇桌面](../output/studio-ui-v2/desktop-poem-reader.png)、[诗篇手机](../output/studio-ui-v2/mobile-poem-reader.png)。个人空态为 `empty-desktop-*`、`empty-mobile-*`；长标题为 `long-mobile-*`。

实际执行：Node24运行 `/tmp/studio-v2-acceptance.mjs`，随后运行 `/tmp/studio-v2-final.mjs`、`/tmp/studio-v2-reading-layout.mjs` 与 `/tmp/studio-v2-zero-chart.mjs`。最后按协调人指令执行一次 `node24 scripts/build-public.mjs`，未修改业务源文件。未自行提交、合并或部署。

本轮未重做完整API业务/鉴权/计算/删除恢复或真机安装。PDF只验证拖入到确认，未以此声称PDF解析上传流程已重新验收；主题验证到保存与浏览器刷新，未在本轮额外重启服务验证。

收尾：测试浏览器已关闭，独立56777服务停止。运行期间未清理用户文件，未写生产数据。
