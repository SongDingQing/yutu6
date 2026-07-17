# 结构化验收表模板

验收表协议: `structured-acceptance@2`

done gate 只认下表,不认完成声明。执行 agent 完成时必须逐行填写;主管复审必须逐行核实。留空、跳过、无证据、证据路径不存在、证据与要点对不上,均按未完成打回。

需要交接时,先用 `templates/handoff-doc.md` 记录当前现状、阻塞与下一步;验收表只引用该 handoff 文档的行号,不要把长上下文复制进表格。需要 commit 时,证据位置可写 scoped commit 或 `git diff -- <path>`;任务未要求 commit 时不得把未提交草稿声称为已提交。

| 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 |
|---|---|---|---|
| 设计对照 memory/decisions.md:<line> <对应设计条目原文> | 未完成 |  |  |
| 任务验收: <从任务 acceptance 拆出的验收项> | 未完成 |  |  |
| 视觉/UI证据: <hook 在 peekaboo截图路径 + Codex对照设计挑错报告 / not_applicable 中二选一> | <视觉=未完成;非视觉=not_applicable> | <非视觉填 task-envelope:visual_acceptance> | <分类 source/reason> |

填写规则:
- 要点逐条来自 `memory/decisions.md`/`board/decisions.md` 对应设计条目和任务 acceptance,一条一行。
- 普通行与真视觉行状态只能填 `完成`、`部分`、`未完成`;`structured-acceptance@2` 的非视觉判定行例外只允许单一 `not_applicable`。禁止 `完成` 与 `不适用/not_applicable` 混填。
- 分类优先级固定为:显式用户视觉要求 > human gate 强制 > 变更路径 > 任务类型。视觉任务标 `not_applicable` 必须打回;human gate 事后开启时必须重判并刷新为待补视觉行。
- 证据位置必须是真实可核指针,例如 `projects/控制台/status.md:12`、`git diff shared/engine/done-gate.js`、`projects/控制台/artifacts/.../peekaboo.png`、`node tests/run.js exit 0`。
- 证据必须对得上本行要点;不能所有行复用同一个泛化证据。`设计对照 ... decisions.md:<line>` 行必须在证据或备注里指回同一个 `decisions.md:<line>`。
- 真视觉/UI 类必须有可核 peekaboo 图片截图路径(.png/.jpg/.webp/.gif)和 Codex 对照设计挑错证据;`failure.json`、截图失败标记和`自验收已归档`都不算截图完成证据。分类只控制视觉行注入,不替代这些真实性硬门。
- handoff / commit 类要点必须写清 scope:交接文档要有现状、阻塞、下一步;commit 或 diff 只能覆盖本任务授权范围。无证据不得写 `完成`。
