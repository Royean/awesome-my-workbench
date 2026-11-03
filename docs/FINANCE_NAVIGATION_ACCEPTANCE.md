# 资产导航精简独立验收

日期：2026-11-02（Asia/Shanghai）。执行者：测试验收工程师 Agent `/root/finance_nav_qa`，独立于实现作者 `/root`。依据私人角色库 `agents/roles/test-acceptance-engineer/ROLE.md`（693ce9a）及软件开发协作规范；这是独立测试验收记录，不代替正式代码评审或用户满意度确认。

## 范围与环境

用户确认金融资产、固定资产分别维护；桌面侧栏精简为总览、金融资产、固定资产、流水、事项、资料，底部保留我的。账户与负债归金融；历史记录与全部资产明细归总览；待办与到期/续费归事项；原件与备忘归资料。保留原有路由。

在本地工作区 `main` 基准 `7c674d93457d869f0d0da24b0a4dc0b59ee3653a` 的未提交改动上执行。使用隔离临时目录、随机端口启动真实 Node.js 24.20.0 后端；Chrome headless，桌面 1440×1000、手机视口 360×800，时区 Asia/Shanghai。所有测试记录均为虚构；未连接生产、未读写真实用户资料。浏览器结束后关闭进程并删除隔离数据库。手机为浏览器视口验收，不是 Android 真机验收。

## 验收结果

| 编号 | 检查 | 结果 |
| --- | --- | --- |
| AC-01 | 桌面六个业务入口，底部我的，所有入口一屏可见 | 通过 |
| AC-02 | 金融与固定持仓分别显示，新增表单分别默认 financial/fixed | 通过 |
| AC-03 | accounts、liabilities、holdings、history、tasks、notes 旧路由可达，并选中正确一级父菜单 | 通过 |
| AC-04 | 事项同页展示待办、还款安排、到期与续费；完成任务持久化，数量从3降至2；在全部待办重开可持久化 | 通过 |
| AC-05 | 事项数量只统计未完成待办、已过或30天内期限资产及负债；第30天计入、第31天排除、closed排除 | 通过（专用自动测试） |
| AC-06 | 还款安排排除已结清负债，仍展示较远未来已记录还款日期 | 通过（专用自动测试） |
| AC-07 | 资料内原件、备忘切换可用，上传入口可见 | 通过 |
| AC-08 | 手机金融、固定独立入口可见；金融、固定、事项、资料、流水页面无 document/body/main 横向溢出 | 通过 |
| AC-09 | 虚构个人空间测试记录未进入示例空间；浏览器无未捕获异常 | 通过 |

专用渲染测试：`node --test tests/finance-navigation.test.mjs`，5/5 通过。

真实后端与 Chrome 验收脚本：`/tmp/finance-nav-browser-qa.mjs`，9组检查通过。首次运行测试脚本误用上传按钮名称「上传原件」，实际页面名称为「上传资料」；校正测试选择器后完整重跑通过，此为测试脚本问题，无功能缺陷。

## 证据与版本

初轮浏览器证据：`/var/folders/wb/j54mykvj0k71fcm7rs8my5r80000gn/T/finance-nav-qa-evidence-2n2Hl5`，含桌面金融、桌面事项、5张手机全页截图和 `result.json` 源码 SHA-256。

初轮构建：JS `app.e7325cb85320f522f9bb278aa065534cae217de8440dee6d4d2e3d5c9081e443.js`；CSS `app.14d9bb0d3dcc9deeef15f0eba61b3bec1391c48c6a337f72f86351d2fc004d7e.css`。

视觉检查发现金融页「持仓/账户/负债」页内导航下方重复出现「管理账户/管理负债」，作者已移除。最终构建上完整重跑9组真实浏览器检查通过，并重新查看桌面金融截图确认重复链接消失、账户与负债仍通过页内导航可达。

最终构建：JS `app.e26fdf79851fd060cb0946e6272ae4987756167742ec27df00579cfa39a21897.js`，CSS同上。最终截图与结果：`/var/folders/wb/j54mykvj0k71fcm7rs8my5r80000gn/T/finance-nav-qa-evidence-Qp6reA`。最终源码 SHA-256：

- `public/shell.js`：`8e93975780d5e62900abfafe5c05e748bfd5547b89e0c3885ac05c07ea81734d`
- `public/assets.js`：`c1ef77ee14ee83eb2594d692789514724811106f6574576b33aa326e56e1557a`
- `public/assets.css`：`de382ee1351ed1a198afc801cf9b5013b09bfb64f410fc02c67920915974259b`
- `public/index.html`：`5af72130ff56daafe18cb8051b20dfc99e2dc25575f6b48c9dc36df0fecbaf95`

## 交付边界

本报告只证明指定本地工作区和构建的上述行为。没有部署生产、合并或正式发布；没有 Android 真机、生产登录或所有平台验收结论。整体结论：本次导航范围的本地独立验收通过，无未解决阻断项。

## PR 集成独立复核（2026-11-03）

执行者：`/root/finance_nav_qa`。复核工作树 `/private/tmp/aw-finance-navigation-pr`，分支 `feat/finance-navigation`，基准 `origin/main` / `358b879023b3b695c9117a2ecff7d10186d633f2`（已含 #48、#49）。只检查本次金融导航差异及关联测试、文档、生成资源；未发现夹带阅读、健康或爬虫的未提交功能改动，未更改业务代码。

使用 `/opt/homebrew/opt/node@24/bin/node --test tests/finance-navigation.test.mjs` 实际运行，5/5 通过；`git diff --check` 通过。默认 `node` 指向缺少 simdjson 动态库的 Node 25，故按项目要求显式使用 Node 24 运行，本次通过结果来自真实 Node 24 执行。

`public/shell.js`、`public/assets.js`、`public/assets.css`、`public/index.html` SHA-256 均与前述最终浏览器验收完全一致；生成 JS/CSS 实际 SHA-256 与文件名 `e26fdf79851fd060cb0946e6272ae4987756167742ec27df00579cfa39a21897` / `14d9bb0d3dcc9deeef15f0eba61b3bec1391c48c6a337f72f86351d2fc004d7e` 一致。原桌面与手机浏览器证据可追溯，因此没有重复执行相同构建的全量 Chrome 检查。

结论：本次集成复核通过，未发现阻断合并的问题；可在作者完整回归及仓库必要检查通过后合并。本节不表示已合并或已部署生产。

作者集成回归补充：已只读核对 `/tmp/aw-finance-navigation-tests.log`，Node 24 完整回归结果 248/248 通过（实现作者执行）；此结果与独立验收5项分别记录。最终工作树保留旧 tracked bundles，避免本次构建清理历史缓存资源。

## PR #51 合并最新 main 后复核（2026-11-03）

独立执行者仍为 `/root/finance_nav_qa`。PR 创建期间 `main` 合入 #50，集成基准更新为 `75e5869a48e2a7bf88547ddd957abd13840ed31e`。已核对最终工作树相对 `origin/main`：业务源码差异仅为金融 `public/assets.js`、`public/assets.css` 和 `public/shell.js`；阅读 `public/originals.js`、`public/reading.js`、`public/reading.css` 与阅读测试均与该 main 完全一致。其余差异为金融文档、专用测试、入口构建引用以及保留的新旧构建资源。未发现混入工作区的阅读、健康或爬虫未提交功能。

三份金融源码 SHA-256 与上次最终验收仍相同。合并后的入口 SHA-256 更新为 `c6d21a9aa0c508a6b793b68c9284fe9994133e73a6a78b93aaa2e88065f0d646`。最新 JS `app.0d234b097abd8ef0d8c6541b643aa54d9bc6000e4e493d026ee6712b8d0684dc.js`、CSS `app.f67000478117c401de7113c20146559d30b5b556078b32d5853470fd2df70257.css` 的实际 SHA-256 与文件名一致。

使用 Node 24 再跑导航测试5/5通过，`git diff --check origin/main` 通过。由于构建含上游阅读更新，本次在独立 worktree 上启动隔离真实后端，完整重跑 Chrome 9组验收，全部通过：六主入口、金融固定分别维护、六个旧路由与父级选中、到期/还款/待办及完成重开持久化、原件备忘入口、360px五页面无横向溢出、表单分区默认值、示例空间隔离、无浏览器未捕获异常。再次目视桌面金融截图确认布局无回归。

本轮脚本 `/tmp/finance-nav-browser-integrated-qa.mjs`，证据 `/var/folders/wb/j54mykvj0k71fcm7rs8my5r80000gn/T/finance-nav-qa-evidence-34d4Cv`，含截图与源码 hash 结果。未读取或修改真实资料。

结论：最新 main 集成后的独立验收通过，无阻断合并的问题；作者当前完整回归与必要 CI 结果另行记录，最终合并仍以相应检查通过为条件。本记录不表示已经部署生产。
