# AHR-26..30 结构化验收表

模板来源:`templates/structured-acceptance-table.md`。done gate 只认逐行证据；本表不把诊断性非零测试包装为通过。

| 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 |
|---|---|---|---|
| 设计对照 memory/decisions.md:1305 任务:质量运营先做工具与 hook 清单，监管评估阻塞风险；对 AHR-26..30 产出兼容迁移设计和 contract tests，未经主人再次确认不切换全局 blocking hook。 | 完成 | `memory/decisions.md:1305`; `projects/控制台/quality-ops/ahr-26-30/tool-hook-inventory.md:11`; `projects/控制台/quality-ops/ahr-26-30/blocking-risk-assessment.md:9`; `projects/控制台/quality-ops/ahr-26-30/migration-design.md:9`; `projects/控制台/quality-ops/ahr-26-30/approval-state.json:1` | 对照 `memory/decisions.md:1305-1309`；10 个工具/兼容入口、5/5 个真实 hook、11/11 个风险、迁移与 contract 均落盘，批准状态仍为 `not_authorized`。 |
| 任务验收: 在 控制台 项目 scope 内跑 review-loop; 完成前更新 projects/控制台/status.md。 | 部分 | `projects/控制台/artifacts/engine-tasks/cr-1784018284182-397d53ad.json:1`; `projects/控制台/status.md:5` | 当前真实 taskstore 为 `projectId=控制台`、`flow=review-loop`、`state=running`、`node=implement`；status 在 implement 返回前更新。主管 review 是下一真实节点，尚未通过，故本行不冒充完成。 |
| 视觉/UI证据: peekaboo截图路径 + Codex对照设计挑错报告 | 未完成 | `projects/控制台/quality-ops/ahr-26-30/migration-design.md:88`; `projects/控制台/brief.md:15631`; `projects/控制台/brief.md:15643`; `projects/控制台/quality-ops/ahr-26-30/done-gate-na-probe.js:1` | 不适用：本任务只改引擎兼容 contract、测试与文档，没有 UI/视觉面；董事修订明确不要求 Peekaboo 截图，故没有用 failure marker 或无关旧图充证据。由于外层要点逐字要求真实截图，本行诚实标未完成，等待主人修复 DoneGate 非 UI 语义或重签 acceptance。 |

## 诊断性非零结果

`node tests/run.js` 为 exit 1，仅复现既有 `hardening-hooks.test.js` fixture 无真实 diff 和 `ceo-serial-lock.test.js:513` 时序红灯；详见 `test-summary.json:24`。它们不计入上表通过命令，也没有被用来启用 blocking。
