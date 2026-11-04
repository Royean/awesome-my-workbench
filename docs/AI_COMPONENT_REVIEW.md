# AI 组件库独立代码与设计评审

2026-11-04，执行 `/root/component_review`，兼任 UI/UX 设计检查与独立开发评审；实现作者 `/root`、`/root/component_backend`、`/root/component_renderer`。已读取私人角色库对应角色定义及软件开发协作规范。本报告不是 GitHub 正式审批，也不替代独立验收工程师的多场景验收。

## 范围与版本

工作树 `/tmp/aw-ai-components`，基线 `6b30f54`。审阅共享组件合同、模板、受控数据绑定、组件存储与迁移007、Web API/MCP、卡片呈现、草稿编辑/预览/放置、账号与缓存、旧布局预览和异步守卫。

最终候选 JS `60673d23764dea8501abc7173717b035633297671df90a42617b4de92ebfda88`、CSS `8f96f4fc8bdf95d3334d46812e79a70ab713c9c6416999ed0fe866e0fa852f8a`。完整源码 SHA256 见 `docs/ai-component-review-evidence.json`。最后后端增量为极小正数聚合精度修正（`lib/components.mjs` SHA256 `999f4b9f9dfc9608e23bb674b4e2986578f5bd10923a951e79342a8bda4c5b51`），保留极小正数且消除浮点噪声，增加对应测试；没有改JS/CSS或再扩测浏览器。主要控制器复测在稳定界面候选 `16d38f6b`完成，后续只有数值缺失说明改变，使用最终候选增量验证显示与值、只读/XSS等；没有把分阶段检查冒称为最终候选全量重跑。

## 发现及修复复核

| 编号 | 初始问题 | 独立复测 |
| --- | --- | --- |
| R1 / P2 | 在本页放置取消勾选实例但未保存，点击当前高亮“本页放置”标签，直接重读后勾选恢复，无放弃确认，草稿丢失。 | 当前标签改为no-op。真实取消勾选后再点标签，状态保持false；checkbox和大小选择器重绘后焦点保留；离开时正常提示未保存修改。已关闭。 |
| R2 / P2 | 模板新建→保存→发布→放置时，放置页仍使用旧library缓存，显示“请先创建并发布组件”和无名“组件”，已发布条目不在列表。 | 发布后更新库元数据，放置前刷新库。相同流程中选择列表与实例标签均显示实际新组件名称。已关闭。 |

预览锁定的额外可用性边界同步收敛：只读预览请求等待期间，×仍可用，hidden JSON guard字段不被disabled。未改模板的预览可以直接取消，不产生错误的dirty确认；已改草稿的关闭仍提示保留/放弃。

## 独立执行

我使用自己的 Chrome/Playwright 进程和临时SQLite数据目录启动独立loopback服务，仅写明确的虚构组件、运动与待办。图形路径没有使用线上账号、私人资料或生产凭据；未把loopback图形测试冒称为真实双账号浏览器验收。认证、MCP双账号及重启等路径由我独立执行的Node测试覆盖，完整图形矩阵由独立验收工程师另报。

共29项浏览器/实际后端定向检查通过：

- 8项放置焦点/R1及草稿预览检查：预览显示未保存定义，保存revision与已发布定义不变，健康记录逐条不变；继续编辑恢复未保存标题；取消后的晚预览响应不覆盖新数值记录草稿。
- 7项异步/关闭守卫：预览×可取消、干净草稿无假确认；预览A取消后开始保存B，A晚响应及finally不能解除B锁；保存中的Esc和CtrlK不能替换表单；B完成后没有旧预览残留；未保存草稿快捷键提示并保留输入。
- 8项只读/XSS/几何检查：组件名称、区块标签和真实记录名称中的img/svg事件字符串均为文字，未创建注入节点或触发dialog；360px半宽组件无文档溢出；旧布局预览拒绝组件放置编辑，组件预览拒绝工作台导航，二者CtrlK均不创建写入表单；这些交互没有改变放置revision。
- 2项发布元数据复测：新发布组件在放置下拉列表与已添加实例上正确识别。
- 4项最终数值完整性增量：两条虚构运动记录的距离分别2与未填，sum及dailySum仍为2；stat/chart/progress均明确显示“1条记录未填写运动距离，仅统计已填写记录”。没有把未填值当零或隐去不完整性。

另独立运行：

`node --test tests/component-card.test.mjs tests/component-draft.test.mjs tests/components.test.mjs`

**初轮21项通过，0失败；最后tiny数值增量后，重新独立运行上述三个文件，22项通过，0失败。** 覆盖渲染转义、图表零/空/负值、进度、最小冲突补丁、真实SQLite生命周期/事务失败、API/MCP授权、跨台及空间隔离、私有预览/幂等保存、并发、历史保留和重启。

早期脚本遇到重复定位器（页面卡片与库按钮具有相同action）及loopback相对预览URL未拼base，属于测试脚本问题，均调整后执行最终通过检查，没有更改产品行为或降低断言。

## 源码审查结论

- 定义只接受固定区块、字段、计算、窗口及外观token，无任意HTML/CSS/JS、SQL、URL、表达式或外部数据源。数值仅受控字段，金融类只计数/列表，不混币加总。
- sourceWorkbench必须在当前账号工作台中，服务端按owner/source/base space解出实际数据空间。前端不传内部data scope或自选owner；列表/聚合模型不含病历正文、文件内容/路径或凭据。
- 当前草稿与published_definition分开，编辑与历史恢复不更新已发布实例；发布显式执行。归档保留可恢复占位，复制不携带发布状态或实例。
- 组件、版本、预览保存及放置写入使用SQLite事务与expectedRevision。新预览保存具有saved_id幂等路径；历史恢复为新草稿；放置只改所传设备，保留另一端。
- 原form、operation、context和busyOwner绑定晚响应；当前操作的finally才可清理自身锁。切账号/工作台/空间清理状态，读取也带owner校验。旧布局预览与组件预览统一阻断写操作和快捷键。
- 元数据只使库和放置刷新，不把草稿混入页面模型；源记录只读。迁移007仅增加组件相关5表、索引和版本记录，旧布局表及业务记录写入路径保持独立。
- 卡片和SVG文字转义，坐标只使用有限数值；颜色是hex或受控主题值；管理action只含合法组件UUID。缺值、0值、负值、超目标进度均保留实际文字与受控图形表达。

## 交付与限制

R1、R2及附带预览可用性边界均已独立复核关闭，限定差异内没有未解决的阻断缺陷，可继续最终CI、集成和发布验证。这里没有验证生产部署、生产AI连接端工具缓存刷新、Android真机/输入法/刘海安全区或iOS Safari。

本地证据 `/tmp/component-independent-review/`；持久脱敏结果 `docs/ai-component-review-evidence.json`，不含邮箱、密码、令牌、cookie、私人健康记录或可访问的预览链接。可复现临时脚本为 `/tmp/component-independent-review.mjs`、`/tmp/component-async-review.mjs`、`/tmp/component-preview-security-review.mjs`、`/tmp/component-publication-metadata-review.mjs`、`/tmp/component-partial-values-review.mjs`。异步测试仅延迟真实HTTP响应后原样交还浏览器，没有伪造业务结果。
