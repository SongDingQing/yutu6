# 结构化验收表

验收表协议: `structured-acceptance@2`

| 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 |
|---|---|---|---|
| 任务验收: 可泛化维修经验进入 memory/experience.md; 项目技术映射进入 memory/entities.md; 一次性信息不流水账; 无密钥泄露。 | 完成 | `memory/experience.md:358`; `memory/entities.md:40`; `git diff -- memory/experience.md memory/entities.md`; `memory/acceptance-evidence/visual-trigger-provenance-20260716/codex-visual-review.md:10` | 同族经验合并而非新增流水；映射给出实现、测试路径与用途；敏感词扫描只检查命中位置，不回显值。 |
| 视觉/UI证据: peekaboo截图路径 + Codex对照设计挑错报告 | 完成 | `memory/acceptance-evidence/visual-trigger-provenance-20260716/peekaboo-memory-review.png`; `memory/acceptance-evidence/visual-trigger-provenance-20260716/codex-visual-review.md:1` | 真实 Peekaboo 图片；报告明文标注复核者为 Codex，并逐项对照本任务要求。 |
