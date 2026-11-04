# AI 组件库独立验收（Issue #65）

结论：本次覆盖范围通过。独立执行 4 个阶段，共 118 次断言，最终结果均通过，浏览器未捕获未处理异常；未发现需要阻断本次交付的产品问题。该数字是分阶段断言次数，**不是最终构建的 118 项全量重跑**，也不代替 CI 或部署验收。

## 执行身份与候选锁定

- 验收人：独立子代理 `/root/component_acceptance`，未参与产品实现，按私人角色库 `test-acceptance-engineer/ROLE.md` 和 `software-development` 工作流执行。
- 基线：`6b30f54`；分支：`feat/ai-component-library`。验收对象是集成中的工作区，最终提交号由集成人补充，不能以基线号表示新功能代码。
- 最终实际浏览器资源：JavaScript `60673d23764dea8501abc7173717b035633297671df90a42617b4de92ebfda88`，CSS `8f96f4fc8bdf95d3334d46812e79a70ab713c9c6416999ed0fe866e0fa852f8a`。
- 最终数值增量服务端 `lib/components.mjs` SHA-256：`999f4b9f9dfc9608e23bb674b4e2986578f5bd10923a951e79342a8bda4c5b51`。完整文件锁见 [candidate-manifest.json](component-evidence/candidate-manifest.json)；以该文件记录的完整哈希为准。
- 环境：本机 Node 24、Playwright 驱动的真实 Chrome；独立 AUTH_REQUIRED=1 服务、独立 SQLite 临时库、虚构 A/B 账号。使用实际 HTTP、实际 MCP JSON-RPC、实际页面。没有访问生产凭据、真实健康资料或生产数据库。
- 固定业务日期：2026-11-04，Asia/Shanghai；记录包含日期窗口内外运动、未来待办、体重、自定义工作台和自造阅读文件。

## 验收结果与证据

| 阶段 | 断言 | 结果 | 代码范围与证据 |
| --- | ---: | --- | --- |
| 主路径 | 39 | 通过 | 当时的候选；[01-main-flow.json](component-evidence/01-main-flow.json) 记录当时源码哈希，未采集浏览器 bundle 名 |
| 会话、冲突、异步边界 | 29 | 通过 | 实际 bundle `16d38f6b…`；[02-session-conflict.json](component-evidence/02-session-conflict.json) |
| 最终候选回归 | 45 | 通过 | 实际 bundle `60673d23…`；[03-final-regression.json](component-evidence/03-final-regression.json) |
| 最终数值口径增量 | 5 | 通过 | 重启 AUTH 服务后执行；实际 bundle `60673d23…`，最终数值说明实现；[04-final-numeric-delta.json](component-evidence/04-final-numeric-delta.json) |

早期阶段与最终阶段哈希不同，覆盖内容与版本对应保留在各 JSON 中。最后一次修改增加了缺失数值说明；针对该变化补测了真实服务聚合和实际 DOM，而非宣称所有先前路径都重新执行。

| 验收项 | 实际行为 |
| --- | --- |
| 人工组件创作 | 模板创建未保存定义，编辑标题、说明、区块顺序，预览不增加组件库；继续编辑保留内容；保存只成草稿，再显式发布、手机放置 |
| 结构与数据绑定 | 新增第四个指标区块，未来未完成待办计数为 1；布局、tone、density、自定义色进入真实渲染；修改来源后绑定规范化为该来源支持的数据类型 |
| 草稿、发布与复用 | 已发布组件保存新草稿时页面仍显示旧发布定义；显式发布后实例更新。实际 MCP 创建/预览/发布后在健康、资产、旅行、阅读、自定义五台复用，来源健康明确，手机和电脑独立配置 |
| 生命周期 | 复制生成独立未发布草稿；归档保留不可用占位；取消归档恢复最后发布版本；历史恢复生成新草稿而不自动发布 |
| 数据真实性 | 窗口内 40+20 分钟实际得到 60 分钟/2 次，排除旧日期样本；demo 与 personal 不混用；金融绑定拒绝货币数值求和，未混币求和 |
| 私有预览 | 未登录打开私有预览后登录仍回到原预览及原 space；B 账号看不到 A 预览/组件；过期预览有可退出错误；预览保存为草稿、不自动发布 |
| CAS 与未保存保护 | 组件 409 保留本地标题；显式读取最新并保留调整后，本地字段与外部说明合并保存。放置 409 保留手机显隐草稿，不产生部分写入；显式重读前要求确认；手机保存保留外部电脑修改；放置历史恢复生成新版本 |
| 异步与退出 | Esc/CtrlK/关闭尊重 dirty guard；真实请求延迟期间取消，后开的业务表单不被晚响应覆盖；旧请求 finally 不会解锁新保存；保存期间关闭受到保护 |
| 授权与输入 | B 无法读取 A 组件及预览；拒绝可执行额外字段、不可访问来源和非法金融数值绑定；标题中的 `<img ...>` 在真实 DOM 中保持文本，不生成图片；撤销的 MCP token 返回 401 |
| 预览无副作用 | 比较前后健康 items 完整 JSON；组件预览、编辑、发布、归档、放置均不修改原始健康记录；MCP preview-save 重试返回同一未发布草稿 |
| 响应式 | 360/390/430/820/1440 宽度检查 document/main 无横向溢出，含长待办标题；390/1440 四个目标工作台保留各自主题与来源标识 |
| 旧功能回归 | 健康旧布局编辑预览实际创建 390px 私有 iframe，并包括新组件；子窗口隐藏管理控制；预览中阻止切台；退出正常。沉浸古诗在 390×844 全屏无圆角，夜间、专注、工具恢复、下一首、返回书架可用 |
| 数值缺失口径 | 两条未填距离、另一条填 4km：stat sum=4、当日 dailyAvg=4、progress=4；三类区块实际 DOM 都显示“2条记录未填写运动距离，仅统计已填写记录”；预览前后库数量和源记录不变 |

## 执行材料

执行脚本由验收人编写在本机 `/tmp`，没有更改产品源码，也没有借用作者 smoke 结果替代验收：

- `/tmp/component-independent-qa.mjs`
- `/tmp/component-edge-qa.mjs`
- `/tmp/component-regression-qa.mjs`
- `/tmp/component-final-delta-qa.mjs`

截图保存在 `output/component-qa/`，全部为虚构账号和数据。可复核 `390-preview.png`、`390-login-private-preview.png`、`late-preview-new-record-preserved.png`、`390-structure-preview.png`、`390/1440-regression-{finance,travel,reading,other}.png`、`390-reader-night.png`、`390-distance-missing-detail.png`。证据 JSON 只包含断言、无敏感数据的数值/几何信息、资源名和哈希，未保留密码、cookie、PAT、预览令牌/链接、临时库路径或本地端口。

脚本调试期间修正过选择器歧义和测试初始化的工作台状态：关闭按钮命中两个元素、抽屉后面的同名放置按钮、初始化强制 health 导致 reload 回错工作台，以及等待旧表单而非最新异步结果。修正后相关脚本重新运行通过。这些属于测试脚本问题，不计为产品缺陷。

## 边界

- 这是 Chrome 下的浏览器移动视口验收，没有真机 Android APK 安装/WebView、iOS Safari、软键盘/输入法或读屏设备验收。
- 没有连接外部大模型自动生成内容；测试从真实 MCP 提交组合定义并走预览、保存、发布、跨台放置，不把“工具可调用”等同于模型生成质量。
- 没有对全部健康、金融、旅行业务重新全量验收；仅检查关联入口、主题、记录隔离、旧布局预览及沉浸阅读回归。
- 没有重跑所有导入格式或生产资料解析。阅读回归使用自造两首古诗 TXT。
- 报告不包含独立代码审查结论、最终 CI、提交号和上线结果；这些由对应角色/集成流程另行提供。
