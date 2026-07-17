# 结构化验收表

| 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 |
|---|---|---|---|
| 设计对照 memory/decisions.md:1305 任务:质量运营先做工具与 hook 清单，监管评估阻塞风险；对 AHR-26..30 产出兼容迁移设计和 contract tests，未经主人再次确认不切换全局 blocking hook。 | 完成 | `memory/decisions.md:1305`;`projects/控制台/quality-ops/ahr-17-25/poc-design.md:5,42-49`;`projects/控制台/tests/ahr-17-25-poc.test.js`;`node projects/控制台/tests/ahr-17-25-poc.test.js` exit 0 | 本任务把 AHR-26..30 先例作为设计门槛：追加式兼容合同、默认关闭、精确 owner gate 和可回滚；未重做 AHR-26..30，也未切换任何全局 hook/runner 行为。 |
| 任务验收: 在 控制台 项目 scope 内跑 review-loop; 完成前更新 projects/控制台/status.md。 | 完成 | `projects/控制台/artifacts/engine-events.jsonl:61031-61036`;`projects/控制台/status.md:5210-5220`;`projects/控制台/quality-ops/ahr-17-25/test-evidence.json` | 真实事件链显示 `projectId=控制台`,`flow=review-loop`,`node.start=implement`,`role=worker_code`；status 已在 implement 输出前更新。worker 未代签尚未运行的主管 review。 |
| 视觉/UI证据: peekaboo截图路径 + Codex对照设计挑错报告 | 完成 | `projects/控制台/quality-ops/ahr-17-25/peekaboo-evidence.png`;`projects/控制台/quality-ops/ahr-17-25/codex-visual-review.md:3-16`;`projects/控制台/quality-ops/ahr-17-25/evidence.html` | Peekaboo Chrome 原图 3840×1920，SHA-256 `a58408e99505fdd70009e3d17454f16657bb60f323231b8f93283e7fdee0ed14`；Codex 已检查可读性、分类语义、溢出/裁边和“PoC ≠ 生产上线”边界。 |
