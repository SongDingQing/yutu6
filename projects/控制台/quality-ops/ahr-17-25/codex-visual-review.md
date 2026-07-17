# AHR-17..25 验收证据页视觉复核

- 复核对象:`peekaboo-evidence.png`，由 Peekaboo 对 Chrome 窗口 `2527` 以 modern capture engine 截取。
- 文件校验:PNG `3840x1920`，SHA-256 `a58408e99505fdd70009e3d17454f16657bb60f323231b8f93283e7fdee0ed14`。
- 对照设计:`evidence.html`要求在一屏内同时表达“已实现/部分覆盖/隔离实验/owner gate”四类语义，且不把 PoC 写成生产实现。

## Codex 挑错结果

1. 通过:标题、task/HEAD 基线、AHR-17..25 分组、故障注入结果和生产不变量均在截图中可读，无遮挡、无文字溢出、无裁边。
2. 通过:绿/黄/蓝标签分别承载已实现、部分/实验、隔离/门禁语义，不依靠单一颜色，标签内仍有文字。
3. 通过:页首明示“未改生产 UI、事件协议、队列或 runner 终止行为”，避免截图被误读为生产功能上线证据。
4. 可接受的局限:截图是审计证据页，不是产品 UI 回归；它只证明矩阵信息已可视化并能被人工复核。源码、行号和 contract test 仍以 `coverage-matrix.md`、`poc-design.md` 和 `test-evidence.json` 为准。

## 结论

截图符合本任务的验收证据展示目标，无需改动生产 UI。
