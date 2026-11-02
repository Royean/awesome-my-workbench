# 健康首页近期待办独立验收

结论：本次交接范围通过，无阻断缺陷。独立执行者为测试验收工程师 Agent `/root/todo_acceptance`，不同于实现作者 `/root`。结论只适用于以下未提交工作区与构建，不代表生产部署或 GitHub 正式批准。

## 版本与环境

- 执行时间：2026-11-02 21:54（Asia/Shanghai）。
- 基准提交：`7c674d93457d869f0d0da24b0a4dc0b59ee3653a`；当前状态为本地未提交、未部署。
- 代码：`main` 的工作区修改；`public/app.js` SHA-256 为 `367c7f1b0fe7cfdefd0126ee7dab5cc3776c39fabc2e0de59e716460f1b67681`。
- 实际加载构建：`app.17f808b7dc87e56d968d51b42ca7c4e696878027458b47962a5cb46736b35504.js`。
- macOS arm64，Node v24.20.0，已安装 Google Chrome 156.0.8078.74，Playwright 驱动、无头模式。
- 真实本地 `server.mjs`，临时 `HEALTH_DATA_DIR` 和独立随机端口；使用虚构待办，不模拟 API，不触及用户数据目录。退出后清理临时数据。
- 实测视口：1440×1000、360×800；移动宽度为桌面 Chrome 的响应式视口，并非手机真机。

## 范围与结果

| 验收项 | 实际结果 | 判定 |
| --- | --- | --- |
| 首页展示未来安排 | 明天、后天待办出现在首页；通过实际添加表单创建未来任务后立即可见 | 通过 |
| 最近任务顺序 | 混序创建的数据按日期升序，同日 08:00 在 18:00 前 | 通过 |
| 已完成与逾期 | 已完成任务排除；过去未完成保留并显示日期和「已逾期」 | 通过 |
| 展示上限与计数 | 6 项未完成时只显示最近 5 项，显示总未完成数和「全部待办」提示 | 通过 |
| 完成后补位 | 点击完成后真实后端保存 `done=true`，第六项补位，计数变成 5，额外提示消失 | 通过 |
| 全部待办及既有操作 | 点击进入 `#dashboard/tasks`，显示全部 7 项（含已完成）；可取消完成；编辑标题并保存后端成功 | 通过 |
| 跨年 | 年末任务排在次年元旦前；首页显示含年份的完整日期 | 通过 |
| 空态 | 全部完成后显示 0 项未完成与「安排一件接下来要做的事。」，添加入口可见 | 通过 |
| 响应式与视觉 | 查看真实桌面与 360px 截图；卡片、动作可见；document/body/main 均为 360px，无横向溢出 | 通过 |
| 浏览器异常 | 上述交互无未捕获的页面异常 | 通过 |

## 可复现命令与证据

执行：`node tests/upcoming-tasks-acceptance.mjs`，退出码 0，8 组检查通过。脚本默认使用本机 Codex runtime 中的 Playwright，可通过 `PLAYWRIGHT_MODULE` 指定其他绝对模块路径。

本次本地截图和机器结果保存在以下目录（临时证据，未提交进仓库）：

`/var/folders/wb/j54mykvj0k71fcm7rs8my5r80000gn/T/upcoming-tasks-evidence-XkS2oT/`

- `desktop.png`：1440px 首页，6 项未完成/展示 5 项。
- `mobile-360.png`：360px 首页，同一组数据及全部待办入口。
- `empty-360.png`：所有任务完成后的首页空态。
- `result.json`：执行环境、代码指纹、检查项与宽度数据。

主 Agent 另报告 2026-11-02 工程自测 `npm test` 239/239 通过、构建通过，日志 `/tmp/awesome-upcoming-tasks-tests.log`；该全量测试由作者执行，不计为本 Agent 的独立执行结果。

## 限制

未验证 Safari、Firefox、iOS/Android 真机或生产部署。没有改变功能代码、用户已有阅读模块及构建改动；当前规则保留过期未完成且按日期排序，因此超过 5 项的长期积压可能占满首页，未来任务仍可通过全部待办查看。这是交接规则的行为，本次未将其改写为其他优先级。

## 后续小改：移除首页快速记录（2026-11-02 21:57）

独立定向验收通过，执行者仍为 `/root/todo_acceptance`。新实际构建为 `app.09e8f281caea497cf184406af7c7214d1c316e96298fc1e814d41da87b9d5bd4.js`，当前本地未提交、未部署。前文近期待办完整验收属于前一构建；本节仅记录此处实际重测的范围。

使用一次性脚本 `/tmp/accept-remove-launcher.mjs`、真实隔离后端与 Chrome 156，在 1440px 和 360px 首页确认：无 `.capture-launcher`、无 `qc-open:*` 或 `qc-water:*` 快捷按钮；4 张指标卡保留，真实后端虚构体重 `68.4` 和虚构待办均显示。360px 中央记录入口可打开餐食、运动、数值、报告、饮水选项；点击餐食后 `#capture-form #capture-text` 可见，点击饮水后 `#daily-water-form` 及饮水量字段可见。未保存表单，后端仍只有两条虚构夹具，浏览器无未捕获异常。未重新执行此前所有近期待办场景，也未新增永久测试。

首次脚本因使用不存在的餐食表单选择器超时；核对现有 DOM 并修正选择器后重跑退出码 0，六组定向检查全部通过，该超时属于验收脚本问题。

证据：`/var/folders/wb/j54mykvj0k71fcm7rs8my5r80000gn/T/launcher-accept-evidence-e63sMi/` 下 `homepage-1440.png`、`homepage-360.png`、`result.json`。主 Agent 另报告定向工程测试共 25 项通过、构建通过；该部分归属作者自测。

## 最终隔离交付版本复验（2026-11-02 22:30）

结论：通过，无阻断缺陷。独立执行者 `/root/todo_acceptance` 在 `/tmp/aw-health-home-pr` 分支 `fix/health-home-upcoming-tasks` 上复验；基于 `origin/main` 的 `7c674d93457d869f0d0da24b0a4dc0b59ee3653a` 隔离准备本任务，不携带共享工作区的其他阅读/资产改动。此节取代前文构建作为本次合并前的验收版本标识。

- 实际运行构建：`app.9060d374dd816a283ff8c6108313601a0b46e4b459c626101e172ed75dc1e4e9.js`。
- `public/app.js` SHA-256：`00ff610b8b6fb0f85b3161e4aab31b1487c43212600cff8307bc9e107a95321a`。
- `public/quick.js` SHA-256：`f081acf454fe1484bc28a46e9eea4182496d3f8edaa11605d0e6f810de0c6d34`。
- 执行环境：macOS arm64、`/opt/homebrew/opt/node@24/bin/node` v24.20.0、Chrome 156.0.8078.74；每次启动真实隔离临时后端，全部虚构数据。

重新执行既有 `tests/upcoming-tasks-acceptance.mjs`：8 组通过，包括桌面/360px、未来任务、日期时间顺序、逾期、完成排除、总数及 5 项上限、完成补位、全部待办/取消完成/编辑、跨年、实际表单新增未来任务、完成空态和浏览器异常检查；360px document/body/main 宽度均为 360，无横向溢出。

使用既有一次性脚本替换仓库路径后执行 `/tmp/accept-remove-launcher-final.mjs`：6 组定向检查通过。1440px/360px 首页无快速记录区和 `qc-open:*`/`qc-water:*` 按钮，真实体重 68.4、四张指标卡和待办显示保留；360px 中央记录入口展开所有选项，餐食与饮水表单可打开，未保存表单，无浏览器未捕获异常。实际查看本构建 360px 首页截图，布局正常。

已检查本次 `public/app.js` 与 `public/quick.js` 需求差异及构建入口，无阻断问题；未修改功能代码或新增测试。前文浏览器/真机限制仍适用。本节不代表生产部署验收，也不代替主 Agent 正在运行的全量工程测试或发布结果。

本次证据目录：

- 近期待办：`/var/folders/wb/j54mykvj0k71fcm7rs8my5r80000gn/T/upcoming-tasks-evidence-WM3ADy/`（截图及 `result.json`）。
- 快速区移除：`/var/folders/wb/j54mykvj0k71fcm7rs8my5r80000gn/T/launcher-accept-evidence-LfLAY8/`（桌面/360px 截图及 `result.json`）。
