# UI 自动优化案例

> 自动优化循环会把每次运行的关键报告追加到这里。人工也可补充高价值案例。

## 固定模板

```text
## <日期时间> · <短标题>
- 来源: <report / screenshot / eventlog path>
- 事件日志: <projects/控制台/artifacts/engine-events.jsonl type=learning_case.appended 或手工补录理由>
- 场景:
- 现象:
- 根因/判断:
- 改法:
- 验证:
- 可复用原则:
```

## 初始原则 · 2026-07-01
- 来源:老板要求“后面的自动优化也要把对应案例内容固化下来,让董事会、秘书、CEO 都能不断提升认知”。
- 场景:UI/办公室/任务板等自动优化不能只产生一次性改动。
- 现象:如果报告只留在 `artifacts/ui-optimize/reports/`,后续秘书、CEO、董事会不会主动吸收,同类设计问题会反复出现。
- 根因/判断:缺少“案例库”这个中间层,导致经验停留在单轮 artifacts,没有进入决策上下文。
- 改法:每次自动优化收尾都追加案例摘要,并让秘书/CEO/董事会读取 `board/learning-cases/`。
- 验证:新增 `tests/learning-cases-policy.test.js` 固化读取和写入规则。
- 可复用原则:凡是自动优化发现的反复问题,必须从“改这个页面”上升到“以后怎么设计/评审同类页面”。

## 2026-07-01 03:35 · 任务板空态与舞台提示可读性
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260701033530.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 的办公室视图和右侧任务板在空闲巡检时同时出现。
- 现象:右侧任务板空态只说某一个分支为空,没有说明排队/暂停/候选整体都为空;左侧舞台提示是重要方向说明,但原样式接近普通灰字,扫读权重不足。
- 根因/判断:空态文案由多个分支 fallback 拼接,当等待列表为空时丢掉了“排队/暂停”语义;舞台提示只继承 12px dim 文本,没有导航提示该有的轻量边界。
- 改法:为队列全空增加合并空态文案,放宽空态占位尺寸;给舞台提示补轻量胶囊背景/边框/字号,并移除任务板标题负 margin。
- 验证:`node` 解析 `workspace.html` 内联脚本通过;Peekaboo 生成 before/after 工作区截图。
- 可复用原则:任务板空态要表达“哪个集合为空”,不能只暴露某个内部 fallback;视图导航提示应比普通辅助字更易扫读,但不要抢主操作。

## 2026-07-01 04:36 · 主操作区必须就地显示反馈
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260701043608.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 底部派单栏和右侧任务板/模型用量面板可同时操作。
- 现象:派单、附件、队列操作反馈如果只写入右侧任务板标题,当用户当前停在模型用量面板或视线集中在派单栏时,会感觉点击后没有即时反馈;任务进展秒表的 hover/屏阅文本也可能落后于可见秒表。
- 根因/判断:状态反馈绑定在“某个展示面板”而不是“触发操作的主区域”;动态文本只更新可见节点,没有同步辅助属性。
- 改法:在派单栏增加 `composeFeedback` live region,让 `setTaskBoardFeedback()` 同步写入主操作区;进展计时器每秒同步 `title` 与 `aria-label`;派单按钮提交期间补 `aria-busy`。
- 验证:`node` 解析 `workspace.html` 内联脚本通过;Peekaboo 因无显示环境失败,本轮以源码证据和静态语法自查为准。
- 可复用原则:高频操作的反馈应靠近触发点,不能只出现在可被切走的侧栏;动态计时/状态文本要同步 visible text、tooltip 和 a11y 属性。

## 2026-07-01 05:51 · 事件状态要先能扫读再谈动画
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260701055109.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 办公室视图的实时状态胶囊,以及右侧任务板的刷新/取消排队工具按钮。
- 现象:办公室状态胶囊仍停留在 10px 小字和较窄基础宽度,实时状态虽然有颜色和动画,扫读成本仍偏高;任务板右上工具按钮比同页任务动作按钮和链路图开关更紧,触点不一致。
- 根因/判断:状态可视化迭代容易先加颜色/动效,却漏掉最基本的字号、层级和触点面积;高频工具按钮如果单独覆盖成 11px/小 padding,会和同页控件标准漂移。
- 改法:用后置 CSS 覆盖 `.office-status` 的字号、行高、最小高度、padding 和字重,并让 `.office-status-text` 明确在 shimmer 上层;同步放大 `.qtools button` 的最小高度、padding 和字重。
- 验证:`node` 静态检查 `workspace.html` marker 与闭合 HTML 通过;Peekaboo 因无显示环境失败,本轮以源码行号和 diff 自查为准。
- 可复用原则:事件流推导出来的状态,第一优先级是可扫读和可追踪;动画/色彩只是辅助,不能替代字号、层级、触点和完整反馈。

## 2026-07-01 06:51 · 中文输入和读屏名称不能靠 title 兜底
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260701065111.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 底部派单栏、任务补充引导输入框、办公室/服务器卡片。
- 现象:派单栏和补充引导都用 Enter 触发提交,若中文输入法正在组合文字,确认候选词可能误派单或误提交;办公室/服务器状态只靠可见碎片和 `title`,读屏器不能稳定一次读出名称、状态和任务。
- 根因/判断:高频输入控件只考虑英文键盘流,漏了 `KeyboardEvent.isComposing`;信息卡片把 hover tooltip 当作辅助语义,不符合 name/role/value 自查要求。
- 改法:两个 Enter handler 都加 `!e.isComposing`;办公室 agent 与服务器卡片生成聚合 `aria-label`,把 name/status/task 或 server/status/ip 直接暴露给辅助技术。
- 验证:`node` 解析 `workspace.html` 内联脚本通过;Peekaboo before/after 截图均生成;报告列出源码行号与洞察采纳证据。
- 可复用原则:中文产品的 Enter 快捷提交必须先排除 IME 组合态;可视卡片的完整状态不能只放在 `title`,应给读屏器一个稳定的聚合名称。

## 2026-07-01 07:51 · 动态状态和危险动作要同步语义
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260701075112.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 办公室视图持续从事件流推导工位状态,右侧任务板提供取消排队/取消队列项等高风险操作。
- 现象:办公室卡片生成时有聚合 `aria-label`,但状态变化后若只更新可见文字和 `title`,读屏名称会落后于“待审批/工作中/失败”;取消类按钮静止态与普通按钮接近,只在 hover 时呈现危险色。
- 根因/判断:状态语义不能只在首次 render 时生成,动态更新路径也必须同步 name/role/value;危险操作的语义不能藏在 hover,否则扫读和触摸场景都不够明确。
- 改法:抽出 `officeActorLabel()` 并在 `renderOfficeAgent()` 每次更新时同步 `aria-label`;给取消类按钮的非禁用静止态增加红色边框/底色。
- 验证:`node` 解析 `workspace.html` 内联脚本通过;Peekaboo before/after 截图均生成;报告列出 4 条源码问题与 2 条落地改动。
- 可复用原则:事件流推导出的 UI 状态要同时更新可见文本、tooltip 和辅助语义;危险操作必须在静止态、hover 和 focus 三种状态都可辨认。

## 2026-07-01 08:51 · 视图记忆和高频 tab 控件要闭环
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260701085112.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 左侧舞台视图、底部派单栏、右侧任务板 tab 同时作为高频操作入口。
- 现象:舞台视图切换会写入 localStorage,但初始化没有读取保存值;任务板 tab chip 字号和触点仍偏紧;派单栏可见“派给”不是表单 label。
- 根因/判断:交互状态只做了写入没有做读取,形成半截持久化;视觉紧凑样式在高频 tab 上没有稳定触点覆盖;可见标签和程序化名称没有完全绑定。
- 改法:`currentView` 初始化读取合法 URL 或本地保存值;“派给”改为 `label for=role`;`.qchip` 补最小高度、内边距和字号。
- 验证:`node` 解析 `workspace.html` 内联脚本通过;Peekaboo before/after 截图均生成;报告列出源码行号、洞察采纳和结构化验收表。
- 可复用原则:凡是 UI 状态写入本地记忆,初始化必须有对应读取路径;高频 tab/chip 不应只靠紧凑文本,要有稳定触点和可读字号;可见表单标签应优先用真实 label,不要只靠 aria-label 兜底。

## 2026-07-01 10:57 · 监控面板关键状态不能只剩单行残片
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260701105713.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 右侧任务板和模型用量面板承担“派完任务一眼看进度”的监控职责。
- 现象:任务摘要、队列项摘要、操作反馈和模型用量提示仍有多处单行省略;错误、进展或长任务标题容易只露出半句。
- 根因/判断:历史小修优先保证卡片密度,但高频监控面板的首屏信息需要“最少两行核心语义”;同类摘要的 wrap 策略也不一致。
- 改法:用后置 CSS 覆盖 `.tb-brief,.tb-ceo-brief,.qbrief` 与 `.queue-title .empty[data-feedback],.llm-head .empty`,在不改数据结构和业务逻辑的前提下给核心状态两行可读空间。
- 验证:`node` 解析 `workspace.html` 内联脚本通过;`curl /workspace` 返回 200;Peekaboo 因无显示环境失败,本轮以源码证据和静态验证为准。
- 可复用原则:监控/任务板类 UI 宁可让核心状态占两行,也不要把“发生了什么”压成单行省略;密度优化不能覆盖状态可读性和错误反馈可发现性。

## 2026-07-01 11:57 · 可见截断文本也要有稳定程序化名称
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260701115713.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 的任务板问/解摘要、任务链路、过往记录和模型用量绑定工位标签都承担监控与 grounding 职责。
- 现象:这些区域为保持密度大量使用两行 clamp、胶囊截断和 `title`,视觉上能扫到片段,但读屏器、GUI grounding 或无 hover 场景无法稳定取得“任务摘要/当前进展/链路节点/绑定工位”的完整名称。
- 根因/判断:密度优化后只修了可见文本,没有同步补齐 name/role/value;`title` 是 hover 辅助,不能替代聚合 `aria-label` 或 list/listitem 语义。
- 改法:给任务板问/解块补聚合 `role=group` + `aria-label`,给任务链路和模型绑定工位补 `role=list/listitem`,给过往卡片补完整 `aria-label` 与 agent tooltip,并让 busy 按钮同步临时 `aria-label`。
- 验证:`node` 解析 `workspace.html` 内联脚本通过;Peekaboo before/after 均因无显示器失败,本轮以源码行号、diff 和截图失败说明为准。
- 可复用原则:凡是会被截断、折叠或只显示符号的监控文本,都要同步提供稳定程序化名称;可见密度、hover tooltip 和辅助语义必须一起闭环。

## 2026-07-01 12:57 · 主操作反馈和任务卡 summary 要同时闭环
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260701125713.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 底部派单栏与右侧任务板同时承担高频派单、监控和 GUI grounding 职责。
- 现象:空派单点击原本会静默返回;派单按钮进入“派单中”时只改可见文字,程序化名称仍是“派发任务”;任务卡 summary 视觉上由截断摘要、状态胶囊和 `title` 组成,但普通队列项、CEO 卡、运行中卡、排队卡没有稳定聚合 `aria-label`。
- 根因/判断:反馈逻辑和可访问名称各自只做了半截:可见层有状态文字,辅助语义没有同步;任务卡密度优化后依赖 `title`,但 `title` 不能作为无 hover 场景、读屏器和 GUI agent 的唯一完整名称。
- 改法:空派单时写入主操作区 live feedback 并聚焦输入框;派单中同步 `aria-busy` 与临时 `aria-label`,完成后恢复;为普通队列项、CEO 任务卡、运行中卡、排队卡 summary 补完整聚合 `aria-label`。
- 验证:`node` 解析 `workspace.html` 内联脚本通过;`curl http://127.0.0.1:41218/workspace` 返回 200;Peekaboo before/after 因无显示器失败,本轮以源码、diff 和截图失败说明为准。
- 可复用原则:高频主操作不能静默失败,忙碌状态要同步 visible text、`aria-busy` 和程序化名称;凡是用截断片段拼成的任务卡 summary,必须有一个完整聚合名称,不能只靠 `title`。

## 2026-07-01 13:57 · 忙碌状态和监控摘要必须同步程序化名称
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260701135713.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 任务板、公告板候选、模型用量窗口与派单反馈承担高频监控和操作反馈。
- 现象:单项动作按钮、公告板启用按钮和批量按钮进入忙碌态时,可见层有 `…` 或“启用中”,但程序化名称/tooltip 没同步;普通队列项和模型用量窗口的摘要由多个截断视觉片段拼成,辅助技术和 GUI grounding 难以一次拿到完整状态。
- 根因/判断:密度优化只保证了视觉片段能塞进卡片,没有把“状态、执行方、摘要、ID、耗时/额度”等监控语义同步成稳定 name/value;忙碌态也只改了按钮文字的一部分。
- 改法:队列 summary 聚合 `状态 · 执行方 · 摘要 · meta · #ID`;模型用量窗口补完整 `aria-label`;`queueHint`/派单反馈同步 `aria-label`;批量、启用、单项动作按钮在忙碌期间同步 `aria-busy`、`aria-label`、`title`,完成或失败后恢复。
- 验证:`node` 解析 `workspace.html` 内联脚本通过;`fetch http://127.0.0.1:41218/workspace` 返回 200;Peekaboo 因无显示器失败,本轮以源码和 HTTP 验证为准。
- 可复用原则:监控摘要和忙碌反馈不能只服务视觉扫读;凡是会被截断、折叠、只显示符号或处于请求中的控件,都要同步 visible text、`aria-busy`、`title` 与稳定程序化名称。

## 2026-07-01 14:58 · 截断监控卡要在卡片层提供完整名称
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260701145813.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 的工位视图和模型用量面板,二者都用紧凑卡片承载实时监控状态。
- 现象:工位卡可见层有角色、状态、任务、交接和模型,但卡片本体缺完整 name/role/value;模型用量卡大量字段被省略,卡片本体缺模型、用量、调用、状态、额度的聚合名称;错误 hint 只显示“不可用”,失败原因藏在 `title`。
- 根因/判断:上一轮已给任务卡 summary 和忙碌按钮补程序化名称,但同样承担监控职责的工位卡/模型卡还停留在“子元素有文字即可”的层面;`title` 不能替代 live region 或卡片聚合名称。
- 改法:工位卡初始渲染和动态刷新都同步 `role=group`、`title`、聚合 `aria-label`;模型用量卡和指标补 `title/aria-label`;错误态把完整失败原因同步进 `role=alert` 和 `llmHint` 的 `aria-label`。
- 验证:`node --check` 解析 `workspace.html` 内联脚本通过;`curl http://127.0.0.1:41218/workspace` 返回 200;Peekaboo 因无显示环境失败并已归档 failure 文件。
- 可复用原则:监控卡片只要会截断、折叠或由多个碎片拼出状态,卡片层就要有完整聚合名称;动态刷新路径也要同步更新,否则初始 a11y 修复会在下一次状态变化后失效。

## 2026-07-01 15:58 · 候选审批卡和空态反馈要有可见边界与稳定名称
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260701155813.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 右侧任务板的公告板候选卡、任务板摘要和模型用量空态/错误态。
- 现象:公告板候选卡承载“启用/批准”动作,但卡片本体只有普通卡片结构和局部 `title`,读屏或 GUI grounding 无法一次拿到来源、目标、项目、标题和摘要;任务板摘要刷新路径只同步可见文本/title,模型用量加载/无数据/错误态没有稳定状态名称。
- 根因/判断:把候选审批当普通列表项处理,漏掉了“inline approval card”应具备的卡片层聚合名称;监控空态/错误态只追求视觉占位,没有把 live region、`role=status/alert` 和 `aria-label` 一起闭环。
- 改法:公告板候选卡补左侧强调边、`role=group`、`title`、聚合 `aria-label`;`queueHint` 刷新时同步 `aria-label`;模型用量初始/动态加载、无数据和错误态补 `role=status/alert` 与完整 `aria-label`。
- 验证:`node` 解析 `workspace.html` 内联脚本通过;`curl http://127.0.0.1:41218/workspace` 返回 200;Peekaboo before/after 因无显示器失败,本轮以源码行号、HTTP 和静态解析为准。
- 可复用原则:凡是候选审批/启用卡,都应在卡片层提供“来源、目标、项目、摘要、动作”的稳定名称;监控空态和错误态也要和正常数据卡一样有可见反馈、live 语义和完整程序化名称。

## 2026-07-02 00:59 · 主操作忙碌态和监控空态要恢复完整名称
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260701165913.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 底部派单按钮、右侧任务板错误态、办公室服务器机房和模型用量读取提示。
- 现象:派单按钮进入忙碌态时需要 visible text、`aria-busy`、`aria-label`、`title` 同步并在完成后恢复;队列错误、服务器空态/错误和模型用量读取中提示不能只靠可见短文本。
- 根因/判断:高密度监控 UI 容易只修视觉反馈,漏掉 tooltip、程序化名称和动态刷新路径;一旦前一次状态是错误或已更新,下一次读取中若不重设 `title/aria-label`,辅助语义会滞留。
- 改法:派单按钮忙碌期间同步 `title='派单中,等待队列接收'`, finally 恢复原 title;队列错误态补 `role=alert/title/aria-label`;服务器机房空态/错误态补 `role=status/alert/title/aria-label`;模型用量 hint 初始与 loading 分支补完整名称。
- 验证:`node` 解析 `workspace.html` 内联脚本通过;`curl http://127.0.0.1:41218/workspace` 返回 200;静态 marker 检查通过;Peekaboo before/after 因无显示器失败并已归档 failure 文件。
- 可复用原则:主操作忙碌态和监控空态必须同时服务视觉扫读、tooltip、读屏和 GUI grounding;动态刷新分支要和初始 DOM 同步更新完整程序化名称,不能让旧状态残留。

## 2026-07-02 02:02 · 视觉空态和概览计数也要有 name/role/value
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260701175913.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 的右侧任务板空态、左侧工位概览和办公室工位概览。
- 现象:任务板空态视觉上有“暂无进行中/暂无排队中”等占位,但只是裸 `.tb-empty`;概览状态胶囊能看到“工作中/完成/失败/空闲”,但容器和 chip 没有 list/listitem 与完整程序化名称。
- 根因/判断:前几轮重点修了任务卡、按钮忙碌态和模型用量卡,但容易漏掉“看似只是静态辅助文本”的空态与计数 chip;这些区域同样承担监控摘要职责,不能只服务视觉扫读。
- 改法:抽出 `taskBoardEmpty(text)` 统一输出 `role=status` 和 `aria-label`;概览容器补 `role=list`,每个计数 chip 补 `role=listitem/title/aria-label`,动画点设为 `aria-hidden`。
- 验证:`node` 解析 `workspace.html` 内联脚本通过;`git diff --check -- projects/控制台/public/workspace.html` 通过;Peekaboo before/after 因无可用显示失败,本轮以源码证据和静态验证为准。
- 可复用原则:凡是监控 UI 的空态、概览计数、状态胶囊,即使视觉上只是小辅助信息,也要纳入 name/role/value 检查;“没有数据”也是状态,不是普通装饰文案。

## 2026-07-02 02:59 · 动态链路图和操作反馈要保留完整程序化状态
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260701185913.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 的链路图、任务板摘要和底部派单反馈都承担实时监控与高频操作反馈职责。
- 现象:链路图提示只更新可见文本和 `title`,链路图容器没有聚合名称;任务/派单反馈为了密度把文本截到 120 字并把 `title/aria-label` 也设成截断文本,错误原因和队列状态容易丢失。
- 根因/判断:动态 UI 只处理了视觉扫读层,没有把同一状态同步到 live region、容器名称、tooltip 与程序化名称;密度优化也不应牺牲完整错误/状态文本。
- 改法:给 `mapHint` 补 `role=status/title/aria-label`,给 `flowmap` 补 `role=group/tabindex/title/aria-label` 和键盘焦点环;链路交接刷新时同步容器与提示的完整名称;反馈区域可换行显示紧凑文本,同时把完整文本保留到 `title/aria-label`。
- 验证:`node` 解析 `workspace.html` 内联脚本通过;`git diff --check -- projects/控制台/public/workspace.html` 通过;`curl http://127.0.0.1:41218/workspace` 返回 200;Peekaboo before/after 因无显示器失败并已归档 failure 文件。
- 可复用原则:实时监控图、live hint 和主操作反馈必须同步 visible text、`title`、`aria-label` 与容器聚合名称;可见文本可以压缩,但完整状态不能只存在于日志或被截断。

## 2026-07-02 04:03 · 动态进展和额度窗口也要有完整状态结构
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260701195914.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 的任务板进展行和模型用量额度窗口,都由多个紧凑视觉片段拼出实时监控状态。
- 现象:任务进展行可见层有“进展:”和运行条,但完整进展没有同步成行级程序化名称;运行条只有非语义 `aria-label`,内部动画条未标为装饰。模型用量额度窗口视觉上是多行重复明细,但没有 `role=list/listitem` 结构。
- 根因/判断:密度优化后容易只给卡片外层补聚合名称,漏掉卡片内部持续变化的子状态;这些子状态同样会被 GUI grounding、读屏和无 hover 场景读取。
- 改法:任务进展行补 `role=group`、完整 `aria-label` 和 `title`,运行条补 `role=status/title/aria-label` 且动画内层 `aria-hidden`;模型用量额度窗口增加 list 容器和 listitem 子项,每个窗口保留完整 `title/aria-label`。
- 验证:`node tests/workspace-taskboard.test.js`、`node tests/workspace-render-architecture.test.js`、`node tests/workspace-title.test.js` 均通过;Peekaboo before/after 因无显示设备失败并已归档 failure 文件。
- 可复用原则:监控卡外层有聚合名称还不够;凡是内部持续变化、重复列表化或带动画的状态片段,也要补完整 name/role/value,动画装饰要显式隐藏。

## 2026-07-02 05:14 · 动态短状态和空态反馈要一起同步
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260701211014.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 的任务时长胶囊、任务进展行、模型用量空态和底部附件输入反馈。
- 现象:视觉上能看到计时、进展、暂无模型用量或附件按钮,但动态时长的 `title/aria-label` 不会同步刷新;模型列表为空时 header 仍像正常更新;非图片附件会静默失败。
- 根因/判断:高密度监控 UI 容易只维护可见短文本,忽略 tooltip、程序化名称和空态反馈的同点更新;“数据为空”和“输入无效”都需要成为明确状态,不能靠用户猜。
- 改法:时长胶囊生成和定时刷新都同步 `title/aria-label`;进展行补行级 `title`;模型用量空列表时 header hint 改为“暂无数据”并保留完整名称;非图片附件输入写入就近反馈。
- 验证:`workspace.html` 内联脚本 parse 通过;静态断言覆盖 duration title aria、duration live sync、progress row title、llm empty hint、non-image feedback;`git diff --check -- projects/控制台/public/workspace.html` 通过;Peekaboo before/after 因无显示设备失败并已归档 failure marker。
- 可复用原则:动态短状态要同时更新 visible text、`title`、`aria-label`;空态和输入失败不是“无数据”背景噪音,而是监控/操作反馈的一等状态。

## 2026-07-02 06:15 · 附件列表和头部监控短状态也要有稳定名称
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260701221014.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 的底部图片附件托盘、头部事件更新时间和任务板进展行。
- 现象:附件托盘视觉上能看到缩略图和“n 张图片”,但没有 `role=list/listitem` 与每张图片的完整名称;头部更新时间/事件流失败只更新短文本和 `title`;进展行已经拼出完整 `progressTitle`,但 `aria-label` 仍只读短进展。
- 根因/判断:连续多轮已修任务卡、用量卡和空态,但高密度 UI 中的“角落短状态”和“辅助托盘”容易被当成装饰;只靠 hover title 会让无 hover、读屏和 GUI grounding 丢失完整状态。
- 改法:附件托盘补 `role=list`、空态/聚合 `aria-label`、缩略图 `role=listitem/title/aria-label`;头部 `#ts` 初始/成功/失败分支同步 `role=status/alert` 与完整 `aria-label`;进展行和内部文本的 `aria-label` 改用 `progressTitle || progressLabel`。
- 验证:`workspace.html` 内联脚本 parse 通过;静态断言覆盖附件列表、timestamp status/error、progress full aria;`node tests/workspace-taskboard.test.js && node tests/workspace-render-architecture.test.js && node tests/workspace-title.test.js` 通过;`curl /workspace` 返回 200;Peekaboo before/after 因无显示设备失败并已归档 failure marker。
- 可复用原则:监控 UI 不能只盯主卡片;附件托盘、页头更新时间、短进展这些“小状态”同样需要完整 name/role/value,并且动态刷新路径必须与初始 DOM 同点更新。

## 2026-07-02 07:13 · 弹窗状态和图谱装饰件也要同步语义
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260701231014.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 的版本历史弹窗和链路图节点,二者都有动态状态或视觉零件。
- 现象:版本历史加载中、暂无历史、加载失败三条动态分支只写可见 DOM,缺完整 `title/aria-label`;链路图节点已有聚合 `aria-label`,但端口 pin/pout 和状态点是纯视觉装饰,未标 `aria-hidden`。
- 根因/判断:上一轮补齐了页头、任务卡和短进展,但弹窗内部状态与图谱节点内部小零件容易被漏掉;有了容器聚合名称后,内部装饰件仍需显式隐藏,避免读屏/grounding 把视觉零件当内容。
- 改法:抽出 `versionStateHtml()` 统一输出 `role=status/alert`、`title`、`aria-label`,加载动画点设为 `aria-hidden`;链路图节点端口和状态点补 `aria-hidden="true"`。
- 验证:`workspace.html` 内联脚本 parse 通过;Peekaboo before/after 因无显示设备失败并归档 `projects/控制台/artifacts/ui-optimize/shots/auto-20260701231014-workspace-screenshot-failure.json`;本轮以源码行和静态解析为准。
- 可复用原则:动态弹窗状态、空态、失败态要和主监控卡一样有完整 name/role/value;任何只服务视觉定位或动效的内部零件都要 `aria-hidden`,让容器聚合名称成为唯一稳定语义。

## 2026-07-02 08:14 · 控制室监控行和版本分组要有完整程序化名称
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260702001014.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 版本历史弹窗分组,以及 `/control-room` 的系统智能体、Runner、声明式流程和引擎事件流概览。
- 现象:版本历史分组标题视觉上会被截断,按钮修前只同步展开状态;控制室动态卡片和事件行修前主要靠视觉行文本,缺少 live/busy、list/listitem 和完整聚合名称。
- 根因/判断:高密度监控页容易把“可展开分组”和“概览行”当成普通视觉文本,但这些区域承担导航、状态追踪和复盘定位职责;截断标题、事件行和错误态都需要稳定 name/role/value。
- 改法:`workspace.html` 为版本历史分组按钮补 `title/aria-label`;`control-room.html` 为主区补 `aria-live/aria-busy`,卡片补 region/list/listitem 聚合名称,错误态和时间戳补完整 `role/title/aria-label`,并扩展 `esc()` 以保护 attribute 文本。
- 验证:`workspace.html` 与 `control-room.html` 内联脚本 parse 通过;`curl /workspace` 与 `/control-room` 均返回 200;Peekaboo before/after 因无可用显示器失败并归档 `projects/控制台/artifacts/ui-optimize/shots/auto-20260702001014-workspace-screenshot-failure.json`。
- 可复用原则:任何被截断、折叠或按行重复展示的监控文本,都要在组件或行级提供完整程序化名称;动态监控主区还要同步 busy/live、错误态和空态,不能只依赖视觉行文本。

## 2026-07-02 09:11 · 策略提示和操作失败反馈要同步完整语义
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260702011114.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 的模型用量策略提示、模型用量进度条、任务板/派单反馈与读取中空态。
- 现象:策略提示可见但修前只靠普通 `div` 和 `title`;模型用量进度条和 loading 点有纯装饰子节点;派单/队列失败反馈虽然有红色胶囊,但 live region 语义仍按普通 status 处理。
- 根因/判断:监控 UI 的“提示、动效、失败反馈”经常被视为附属视觉层,但它们承担可观测和恢复引导职责;只改可见文本会让读屏、键盘流和 GUI grounding 丢失状态强度。
- 改法:模型策略提示补 `role=list/listitem` 与完整 `aria-label`;进度条填充和 loading 点标为 `aria-hidden`;错误语气反馈同步 `role=alert` 与 `aria-live=assertive`,普通反馈恢复 `status/polite`。
- 验证:`workspace.html` 内联脚本 parse 通过;静态断言确认没有未隐藏的 `loading-dot`;Peekaboo before/after 因无可用显示器失败并归档 `projects/控制台/artifacts/ui-optimize/shots/auto-20260702011114-workspace-screenshot-failure.json`。
- 可复用原则:监控提示、装饰动效和操作失败反馈要一起维护 name/role/value;错误态不仅要变红,还要在程序化语义里升级为 alert。

## 2026-07-02 10:11 · 模型用量内部状态也要有 group/list 和 alert hint
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260702021114.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 的模型用量 header hint、百分比焦点块和三项指标明细。
- 现象:header hint 能显示“读取中/不可用/暂无数据”,但修前没有统一同步 `role/aria-live` 和错误态可见胶囊;百分比焦点块和“当前用量/调用/来源”指标视觉上完整,但内部持续变化状态缺少 `role=group/list/listitem` 结构。
- 根因/判断:上一轮修了策略提示和失败反馈,但模型用量卡片内部仍有“看起来只是数字块”的动态状态;这些片段承担额度监控职责,不能只依赖外层卡片聚合名称。
- 改法:抽出 `setLlmHint()` 同步 visible text、`title`、`aria-label`、`role`、`aria-live` 与 `aria-atomic`;给 header hint 增加 `data-feedback` 胶囊样式;给百分比焦点块补 `role=group/title/aria-label`,给指标容器与指标项补 `role=list/listitem`。
- 验证:`workspace.html` 内联脚本 parse 通过;`git diff --check -- projects/控制台/public/workspace.html` 通过;静态断言覆盖 llm hint alert/live、focus group、metrics list/listitem 与 header feedback CSS;`curl /workspace` 返回 200;Peekaboo before/after 因无显示设备失败并归档 `projects/控制台/artifacts/ui-optimize/shots/auto-20260702021114-workspace-screenshot-failure.json`。
- 可复用原则:监控卡外层有完整名称仍不够;凡是内部持续变化的额度焦点、指标列表和 header 状态 hint,都要同点维护 visible text、完整程序化名称、错误态 alert 和列表/分组结构。

## 2026-07-02 11:20 · 截断按钮和模型用量内部文本要区分视觉与程序化名称
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260702031714.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 头部版本徽章和模型用量卡片。二者视觉上都很紧凑,但承担“可打开历史”和“额度监控”职责。
- 现象:版本徽章是 `role=button`,但只靠可见版本号和 `title` 说明动作;模型用量百分比焦点块已有完整 group/progressbar 名称,内部可见百分比、token、额度文字仍会重复暴露;计费胶囊会被 CSS 截断,但没有完整 `title/aria-label`。
- 根因/判断:高密度监控 UI 容易把 `title` 当成完整名称,也容易让可见短文本和聚合名称同时被读屏/grounding 读取。截断信息需要完整程序化名称;已被聚合描述覆盖的视觉重复文本应标为装饰。
- 改法:版本徽章初始和动态刷新都同步 `aria-label`;模型用量焦点块保留 group/progressbar 完整名称,把重复视觉文本标 `aria-hidden`;计费胶囊补完整 `title/aria-label`。
- 验证:`node tests/workspace-taskboard.test.js` 和 `node tests/workspace-title.test.js` 通过;Peekaboo before/after 均成功,路径为 `projects/控制台/artifacts/ui-optimize/shots/auto-20260702031714-workspace-before.png` 与 `projects/控制台/artifacts/ui-optimize/shots/auto-20260702031714-workspace-after.png`。
- 可复用原则:紧凑按钮、胶囊和监控数字块必须区分“给人眼看的短文本”和“给程序读的完整名称”;被聚合名称覆盖的重复视觉文本要隐藏,被截断的可见文本要补完整 `title/aria-label`。

## 2026-07-02 12:38 · 视图提示和附件失败反馈也要同点进入状态语义
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260702043814.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 的舞台视图提示、底部附件粘贴入口和任务板/派单反馈胶囊。
- 现象:舞台提示视觉上会随办公室/工位/链路图切换更新,但稳定程序化名称修前不完整;粘贴非图片文件时入口先过滤图片,导致既有 `addImageFiles()` 非图片反馈分支收不到文件;“未识别/超限/跳过”这类输入失败文本修前容易被归入普通或成功语气。
- 根因/判断:高密度控制台常把视图提示和输入失败当作小辅助状态,只维护可见短文本;但它们会直接影响键盘/读屏/GUI grounding 对“当前在哪个视图、操作为何无效”的判断。
- 改法:`#stageHint` 初始 DOM 与 `setView()` 同点同步 `role=status`、`title`、`aria-label`;粘贴入口把全部 file item 交给 `addImageFiles()` 统一处理;`taskBoardFeedbackTone()` 把未识别、最多、超过、跳过、缺少、不能为空归为 warn。
- 验证:`workspace.html` 内联脚本 parse 通过;`git diff --check -- projects/控制台/public/workspace.html` 通过;`curl /workspace` 返回 200;`node tests/workspace-title.test.js`、`node tests/workspace-render-architecture.test.js`、`node tests/workspace-taskboard.test.js` 均通过;Peekaboo before/after 因无显示设备失败并归档 failure marker。
- 可复用原则:视图切换提示和输入失败反馈不是装饰文本;任何会解释当前上下文或失败原因的短状态,都要同步 visible text、`title`、`aria-label`、live/status 语义和正确 tone。

## 2026-07-02 13:38 · 监控卡容器名称和反馈语气要保持一致
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260702053814.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 的办公室工位卡、服务器机房卡和底部派单反馈。
- 现象:办公室/服务器卡视觉上是完整监控卡,但容器缺稳定 `role=group`,hover 名称与 `aria-label` 不一致;派单成功后的“已派单,等待队列接收”被 `等待` 关键字归为 warn。
- 根因/判断:高密度监控 UI 容易只补内部短状态,漏掉卡片容器本体的 name/role/value;反馈 tone 若只按关键词匹配,会把正常排队/接收状态误当警告。
- 改法:办公室工位初始渲染和动态刷新都同步 `role=group`、完整 `title`、完整 `aria-label`;服务器卡同样补容器语义;`taskBoardFeedbackTone()` 给成功型排队反馈优先返回 ok。
- 验证:`workspace.html` 内联脚本 parse 通过;Peekaboo before/after 因无显示设备失败并归档 `projects/控制台/artifacts/ui-optimize/shots/auto-20260702053814-workspace-screenshot-failure.json`;本轮以源码行和 diff 为准。
- 可复用原则:监控卡不只内部状态要完整,容器本体也要有稳定 role/name;反馈 tone 不能只靠“等待/待”这类粗关键词,正常等待队列接收应与输入失败、错误、超时区分。

## 2026-07-02 14:41 · 成功反馈和审批监控卡要同点维护语气与完整名称
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260702064115.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 的任务板反馈胶囊、任务板摘要 live region 和办公室审批/工具监控卡。
- 现象:`已启用: 正在执行 #id` 这类成功型队列反馈会被 `正在` 粗关键词误判为 warn;旧错误反馈过期后,任务板摘要可能残留 `role=alert/aria-live=assertive`;办公室卡片 hover `title` 有 human gate/tool 信息,但 `aria-label` 少这部分。
- 根因/判断:高密度监控 UI 不能只靠关键词和 hover 拼状态;成功等待、输入失败、真实错误是三种不同语气,动态 live region 和卡片容器名称必须在初始渲染与刷新路径同点恢复。
- 改法:成功型 `已启用/已入队/已加入/已提交` 前缀在 warn 关键词前优先归 ok;`updateTaskBoardHint()` 每轮同步 `role`、`aria-live`、`aria-atomic`;办公室工位初始和动态刷新都让 `aria-label` 复用完整 `title`。
- 验证:`git diff --check -- projects/控制台/public/workspace.html` 通过;源码对照确认 `workspace.html:1193/1304/2665/3388` 已更新;Peekaboo before/after 因无显示设备失败并归档 failure marker。
- 可复用原则:反馈 tone 先按业务结果分层,再看错误/输入失败关键词;任何卡片 title 与 aria-label 不一致都要视为监控语义债,特别是审批、工具调用和队列状态。

## 2026-07-02 15:41 · 任务板折叠分组和模型空态要有完整名称
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260702074115.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 的任务板折叠分组、agent 队列概览和模型用量 body 空态/错误态。
- 现象:任务板一级分组和按 agent 分组视觉上有标题/数量,但修前没有稳定 `title/aria-label`;agent 概览行和四个计数 pill 缺行级聚合名称;模型用量 body 的读取中/失败/暂无数据只给 `aria-label`,hover 审查拿不到同等完整名称。
- 根因/判断:高密度监控 UI 容易认为可见文本已经足够,但折叠、截断、计数胶囊和空态都是后续复盘与 GUI grounding 的入口;分组/行级/空态必须同点维护可见文本、hover 名称和程序化名称。
- 改法:`queueSection()` 和 `queueAgentBlock()` 的 summary 补 `title/aria-label`;`.qagent-row` 补 `role=group/title/aria-label`,计数 pill 补 `title/aria-label`;模型用量读取中、失败、暂无数据 body 分支补 `title`。
- 验证:`git diff --check -- projects/控制台/public/workspace.html`、`node tests/workspace-taskboard.test.js`、`node tests/workspace-title.test.js`、`node tests/workspace-render-architecture.test.js` 均通过;`/workspace` 返回 200;Peekaboo before/after 因无显示设备失败并归档 failure marker。
- 可复用原则:凡是会折叠、截断、按行重复或作为空态/错误态显示的监控文本,都要有组件级或行级完整名称;不能只靠视觉片段、tooltip 其中之一表达状态。

## 2026-07-02 16:41 · 监控文本展示要先脱敏,读取失败要同步到 header live 状态
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260702084115.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 的队列任务详情、办公室/链路图任务摘要、事件流时间戳和任务板 header。
- 现象:任务/队列文本可能携带 `Bearer`、token、secret 等敏感片段,但修前只有脚本输出摘要做了局部脱敏,队列详情和工位卡仍会把原始文本放进可见文本或 `title`;队列读取失败时正文变成错误态,header 摘要仍可能保留旧的“进行中/队列/过往”;事件流失败把 `role` 改成 alert 但没有同步 live politeness。
- 根因/判断:监控 UI 的文本来源多且复用广,不能把脱敏当成某个输出分支的特例;读取失败也不是正文局部状态,必须同步到 header/live region,否则用户和 GUI grounding 会同时看到新旧冲突状态。
- 改法:增加 `redactUiText()` 并接入 `cleanTaskText()`、`queueTaskText()`、`taskBoardOutputText()`;`pollEvents()` 成功/失败同步 `aria-live`;`pollQueue()` 失败分支同步 `queueHint` 为 `role=alert` 的错误胶囊。
- 验证:`git diff --check -- projects/控制台/public/workspace.html` 通过;`node tests/workspace-title.test.js`、`node tests/workspace-taskboard.test.js`、`node tests/workspace-render-architecture.test.js` 通过;workspace 内联脚本 parse 通过;`/workspace` 返回 200;Peekaboo before/after 因无显示设备失败并归档 failure marker。
- 可复用原则:监控文本进入 UI 前要走统一展示脱敏;任何 fetch/poll 失败都要同步正文、header、`title/aria-label`、`role/aria-live`,避免“主体失败、摘要正常”的冲突状态。

## 2026-07-02 17:41 · 事件/任务监控文本要先脱敏再进入可见和程序化名称
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260702094115.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 的页头更新时间、办公室/工位任务摘要、交接短状态和事件 feed。
- 现象:JSON 风格密钥如 `"OPENAI_API_KEY":"..."` 不会被旧脱敏规则覆盖;`taskText()` 会把 `ev.goal` / `taskGoals` 直接送进工位、链路图和聚合名称;页头 `#ts` 初始为空白且 hover title 缺上下文;事件 feed 若渲染,行和空态没有 list/status 语义。
- 根因/判断:监控 UI 的文本来源分散,只在少数输出分支局部脱敏不够;短状态即便已有父容器聚合名称,也可能被局部查询、hover 审查或 GUI grounding 单独读取。
- 改法:扩展 `redactUiText()` 覆盖 JSON/带引号 key 与 token 类字段;`taskText()` 返回展示脱敏文本;页头更新时间初始和成功刷新同步 visible text/title/aria-label;任务/交接短状态和事件 feed 行补完整 `aria-label` / list 语义。
- 验证:`node tests/workspace-taskboard.test.js` 通过;VM 片段验证 `api_key`、JSON `OPENAI_API_KEY` 与 `Bearer` 均脱敏;`git diff --check -- projects/控制台/public/workspace.html` 通过;Peekaboo before/after 因无显示设备失败并归档 failure marker。
- 可复用原则:任何进入监控 UI 的任务目标、失败原因、事件摘要、hover 名称和程序化名称都必须先走展示层脱敏;被截断或可单独读取的短状态不能只靠父容器或 `title` 兜底。

## 2026-07-02 18:45 · 动态进展要先脱敏,截断短状态也要有自己的完整名称
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260702104115.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 的任务板动态进展、服务器卡片 IP 行和链路图节点任务短文本。
- 现象:任务板失败原因会通过短进展 helper 进入 visible text/title/aria-label,但 helper 只截断不脱敏;服务器 IP 短状态只靠 hover/父容器聚合名,空 IP 是空白;链路图 `.ftask` 会截断且只有 `title`。
- 根因/判断:上一轮已把任务/事件文本先脱敏作为原则,但动态进展短 helper 和局部短状态仍可能漏掉;高密度监控 UI 中,被截断、空白或可单独查询的短文本必须拥有自己的完整程序化名称。
- 改法:`taskBoardProgressShort()` 先 `redactUiText()` 再压缩截断;服务器卡片补 `ipText/ipLabel`,空 IP 显示 `IP 未配置`;链路图节点补 `nodeTaskLabel`,`.ftask` 同步 `title/aria-label`。
- 验证:`workspace.html` 内联脚本 parse 通过;源码对照确认 `workspace.html:1223/1231/1944/1949/2796` 已更新;Peekaboo before/after 因无显示设备失败并归档 `projects/控制台/artifacts/ui-optimize/shots/auto-20260702104115-workspace-screenshot-failure.json`。
- 可复用原则:动态进展、短状态和空白占位不是装饰;进入 UI 前要先展示脱敏,且任何会被截断、折叠、空白或单独读取的监控文本都要有稳定 `title/aria-label`。

## 2026-07-02 11:48 · 短状态、过往卡和批量操作反馈要形成完整状态闭环
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260702114815.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 的办公室状态胶囊、任务板过往任务卡和批量取消排队操作。
- 现象:办公室状态胶囊视觉上会被压缩成短文本,但自身缺少完整 `title/aria-label`;过往任务卡视觉只显示问/解和短 ID,hover 名称缺状态、执行方、ID、时间;批量取消成功后反馈停留在“正在取消”,用户无法确认动作是否进入队列。
- 根因/判断:高密度监控 UI 容易把父卡聚合名称当成全部语义,也容易只处理失败反馈而漏掉成功/空操作终态;但短状态、历史卡和批量操作都是复盘与 GUI grounding 的稳定锚点,必须有自己的完整状态闭环。
- 改法:办公室工位和服务器状态胶囊在初始渲染、动态刷新路径同步 `title/aria-label`;过往任务卡复用完整 `cardLabel` 作为 `title/aria-label` 并声明 `role=group`;批量取消增加空队列、用户取消、成功和部分失败的最终反馈,并把“已跳过: 工单已完成”归为成功语气。
- 验证:`node tests/workspace-taskboard.test.js` 通过;源码对照确认 `workspace.html:1191-1195/1227-1229/1314/3268/3412/3725-3735` 已更新;Peekaboo before/after 因无显示设备失败,以源码审查为准。
- 可复用原则:被截断或重复出现的短状态不能只靠父容器聚合名称;历史/折叠卡片的 hover 与程序化名称应同源;任何批量操作都要有空态、取消态、成功态和部分失败态的就近反馈。

## 2026-07-02 12:48 · 动态分区和装饰箭头要分清结构语义
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260702124815.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 的任务板动态分区、队列折叠摘要、版本历史分组按钮和任务板空态。
- 现象:任务板分区视觉上有“进行中/队列/过往/维修任务”标题,但容器本体缺少稳定 `role/title/aria-label`;队列和版本历史的展开箭头是纯装饰,却会进入程序化文本树;任务板空态有 `aria-label` 但没有同等 `title`,与服务器/模型用量空态不一致。
- 根因/判断:高密度监控 UI 往往先补卡片和短状态,但父级动态分区、折叠符号和空态 hover 名称同样是 GUI grounding 与读屏导航的锚点;结构语义和视觉装饰若不分离,会让“区域是什么”和“符号长什么样”混在一起。
- 改法:给任务板动态分区生成完整 label 并同步 `role=region/title/aria-label`;给 `.qcaret` 和版本历史 `.tw` 加 `aria-hidden=true`;`taskBoardEmpty()` 同步 `title/aria-label`。
- 验证:`git diff --check -- projects/控制台/public/workspace.html` 通过;`node tests/workspace-taskboard.test.js`、`node tests/workspace-title.test.js`、`node tests/workspace-render-architecture.test.js` 通过;workspace 内联脚本 `new Function` parse 通过;GET `/workspace` 返回 `200 305541`;Peekaboo before/after 因无显示设备失败并归档 `projects/控制台/artifacts/ui-optimize/shots/auto-20260702124815-workspace-screenshot-failure.json`。
- 可复用原则:折叠、分区、空态这类“结构层 UI”不能只靠视觉标题或父卡名称兜底;动态监控分区要有自己的稳定 region 名称,纯装饰箭头必须隐藏,空态的可见文本、hover 名称和程序化名称要同源。

## 2026-07-02 21:48 · 输入失败反馈和附件托盘名称要同点维护
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260702134815.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 底部派单栏、图片附件托盘、任务板/派单反馈胶囊。
- 现象:附件托盘初始空态和动态有附件态只同步 `aria-label`,hover 审查拿不到同等完整名称;空文件名图片的删除按钮 title 可能退化成“删除图片 ”;非图片、超过上限、空引导等 warn 反馈虽然有可见胶囊,但 live region 仍按 polite 处理,容易被高频刷新吞掉。
- 根因/判断:高频输入区的“失败/警告”也是监控状态,不能只靠视觉颜色或 tooltip;托盘、删除按钮、反馈胶囊要同点维护 visible text、`title`、`aria-label`、`aria-live`。
- 改法:`#attachTray` 初始和动态空态/有附件态同步 `title/aria-label`;附件删除按钮复用同一个 fallback 名称;`setInlineStatus()` 与 `setComposeFeedback()` 对 warn/err 均使用 assertive live,err 仍保留 `role=alert`。
- 验证:`node --check` 解析 workspace 内联脚本通过;`node tests/workspace-taskboard.test.js`、`node tests/workspace-title.test.js`、`node tests/workspace-render-architecture.test.js` 均通过;Peekaboo before/after 因无显示设备失败并归档 `projects/控制台/artifacts/ui-optimize/shots/auto-20260702134815-workspace-screenshot-failure.json`。
- 可复用原则:输入失败、附件失败和空态不是装饰提示;任何会被截断、动态替换或单独操作的输入状态都要有同源 `title/aria-label/live` 闭环,警告态要比普通状态更及时。

## 2026-07-02 22:52 · 队列 summary 和计数胶囊要同源表达完整监控状态
- 来源: `projects/控制台/artifacts/ui-optimize/reports/auto-20260702144815.md`
- 事件日志: `projects/控制台/artifacts/engine-events.jsonl` type=learning_case.appended
- 场景:控制台 `/workspace` 的队列项 summary hover/程序化名称和 agent 队列概览计数胶囊。
- 现象:队列项 summary 的 hover `title` 只表达任务/元信息,`aria-label` 另拼状态/执行方/短摘要/ID,同一监控行出现两套名称;agent 概览里的四个计数 pill 虽有 `title/aria-label`,但只是裸 `span`,缺少重复状态明细的 list/listitem 结构。
- 根因/判断:高密度监控 UI 的摘要行常被视觉短文本、hover 和程序化名称分别拼装,一旦不同源,读屏、GUI grounding 和人工 hover 审查会看到不同状态;重复计数 pill 不是装饰,应当具备稳定列表结构。
- 改法:`queueItemHtml()` 改为用完整 `taskSummary` 生成同一份 `summaryLabel`,并同步到 summary `title/aria-label`;`queueAgentOverview()` 给 `.qagent-counts` 增加 `role=list` 和聚合名称,四个计数 pill 增加 `role=listitem`。
- 验证:`workspace.html` 内联脚本 parse 通过;`git diff --check -- projects/控制台/public/workspace.html` 通过;`node tests/workspace-taskboard.test.js`、`node tests/workspace-title.test.js`、`node tests/workspace-render-architecture.test.js` 均通过;Peekaboo before/after 因无显示设备失败并归档 `projects/控制台/artifacts/ui-optimize/shots/auto-20260702144815-workspace-screenshot-failure.json`。
- 可复用原则:任何队列 summary、监控计数、折叠标题和重复状态胶囊都应让 visible text、`title`、`aria-label` 同源;重复明细使用 list/listitem,避免只靠视觉片段或 tooltip 兜底。
