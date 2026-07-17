# AHR-17..25 engine/runner 覆盖矩阵

- 审计任务:`cr-1784025338751-0e9019b7`;根任务:`cr-1784019175750-d512c3ff`。
- 证据标准:“已实现”必须同时有源码、可达运行链、自动测试和本机基线；只有建议文档或单个字段不算完整实现。
- 冻结基线:`HEAD=9e346f2dbbc4b6de1dc0a22ff399af3c70466bfe`，初始工作树 diff SHA-256=`84ff00bd5381805101d77c27f54ec5319e8a62dd435dc5c68be928796d2484b2`，porcelain SHA-256=`deb733898312579da3062e0c1fcb8bc38c8b96ad05bafd77d859f2e009b44fe5`；逐文件 HEAD/工作树哈希见 `production-baseline.json`。
- 热点冻结:`shared/engine/cli-runner.js`、`taskstore.js`、`queue.js`、`projects/控制台/engine-runner.js`、`ceo-worker.js` 接手前均已有未提交改动，本轮未修改。
- 初始本机基线全部 exit 0:`done-gate`、`protocol-gate`、`crash-recovery-idempotency`、`loop-engineering`、`queue`、`cli-runner`、`quota-degrade`；当前工作树 `interaction-trace` 也 exit 0。命令与结果见 `test-evidence.json`。

| ID | 目标 | HEAD 证据与可达链 | 当前工作树增量 | 分类 | 真实缺口 / PoC 处理 | 测试证据 |
|---|---|---|---|---|---|---|
| AHR-17 | reason/action/observation/decision 显式状态机 | `shared/engine/engine.js:91-160,344-535` 有 task/node/edge 状态与事件，`taskstore.js:51-124` 持久化节点 step；但 phase 仅 node 粒度 | `shared/engine/interaction-trace.js:124-269` 与 `cli-runner.js:1273-1332,1421-1466` 在当前工作树补 prompt/result 可观察记录，仍无工具步四相位 | HEAD=部分覆盖；当前工作树已实现 node 交互 trace；工具步 phase 原先仅文档方案且为真实缺口 | 隔离 PoC 用固定转移 `reason -> action -> observation -> decision`，每相位原子 checkpoint；不接生产事件协议 | `interaction-trace.test.js`、`ahr-17-25-poc.test.js` exit 0 |
| AHR-18 | 环境证据决定最终状态 | `engine.js:229-341` 在 task.done 前执行 done/protocol/hook gate；`done-gate.js:1171-1195,1225-1254,1367-1414` 校验逻辑链、独立复核、文件/测试；`protocol-gate.js:177-213` 校验 receipt | `done-gate.js` 有接手前改动，但冻结版本专项仍通过；本轮不替换、不删除任何 gate | **HEAD 已实现**，从 PoC 待办剔除（不是删除实现/字段） | 无新 PoC；只做生产文件哈希不漂移合同 | `done-gate.test.js`、`protocol-gate.test.js` exit 0 |
| AHR-19 | typed terminal outcome | `taskstore.js:12-13,51-103` 与 `engine.js:147-201,339-361,501-535` 有显式字符串 state/reason；UI/队列仍依赖旧字符串 | 未发现统一 typed outcome；生产协议不变 | 部分覆盖；typed outcome 原先仅文档方案且为真实缺口 | PoC 只追加 `typed_outcome@1`，保留 `state/status` 原值；覆盖 success/fail/blocked/cancelled/waiting 的旧消费者合同 | `ahr-17-25-poc.test.js` 的 `ahr19_typed_outcome_is_additive_for_old_consumers` |
| AHR-20 | 每任务 step/time/cost 三硬预算 | `engine.js:69-81,166-201` 有 max_loops 与墙钟；`cli-runner.js:769-777,809-943` 有节点 timeout | 未发现 task 级 cost 硬预算或统一超限 typed reason | 部分覆盖；cost hard budget=真实缺口 | PoC 加 step/time/cost 三预算，超限返回 `*_budget_exceeded` typed fail；不写生产配置 | `crash-recovery-idempotency.test.js`、`cli-runner.test.js`、PoC 三预算测试 exit 0 |
| AHR-21 | 超时结束整个进程组并清零子进程 | `ceo-worker.js:2126-2169` 以 `detached:true` 启动 engine 并 TERM/KILL；`engine-runtime.js:102-173` 优先负 PGID 终止 engine 组 | `cli-runner.js:887-907` 内层 command child 未独立建组，只 `child.kill`；没有“所有 runner 子进程清零”合同测试 | engine 层 HEAD 已实现；runner 统一策略仍部分覆盖/真实风险 | **不改变行为**；PoC 仅钉住默认关闭 + 精确 task/scope/rollback owner gate，等主人批准后才可另案验证 | `ahr-17-25-poc.test.js` 的 owner-gate 合同；无生产进程树注入（按门禁停止） |
| AHR-22 | 每个工具步原子 trajectory checkpoint/恢复 | `engine.js:365-393,493-515,520-533` + `taskstore.js:104-123` 已有 node step replay | 当前 `taskstore.js:29-49,91-97` 将任务文件升级为 fsync+rename 原子写；`crash-recovery-idempotency.test.js:249-272` 覆盖失败保留旧文件 | HEAD=部分覆盖；当前工作树已实现 task/node 原子性；tool-step checkpoint=真实缺口 | 隔离 PoC 对每个四相位原子写，rename 崩溃后旧 checkpoint 不损坏；不改变生产保留策略 | `crash-recovery-idempotency.test.js`、PoC atomic checkpoint exit 0 |
| AHR-23 | 连续格式错误预算 | `cli-runner.js:342-386` 对单次 JSON 做严格/配平解析；`resultFromRunnerResponse:1034-1065` 解析失败回空对象，未计连续错误 | 无连续计数、上限或统一终止 reason | **真实缺口**（之前仅 AHR 研究文档方案） | PoC 连续错误超过阈值返回 `format_error_budget_exceeded`;一次有效格式会重置 consecutive | `cli-runner.test.js:248-263` 仅特征化现状；PoC 正/反/重置测试 exit 0 |
| AHR-24 | 被截断的 streamed tool call 永不执行 | 现有 engine 不直接执行流式 tool-call；CLI/工具 harness 在完整 runner 响应后才进入下一层，但没有 engine 拥有的 completeness contract | 无 `streamComplete + complete + arguments JSON` 的显式执行前门 | 部分架构规避；显式 guard=真实缺口 | PoC 在调用 executor 前校验完整标记、id/name 和完整 JSON object；截断/坏参数时 executor 调用数保持 0 | PoC `ahr24_truncated_tool_call_never_executes` exit 0 |
| AHR-25 | steering 与 follow-up 分队列 | `queue.js:166-175,245-255` 有单一 `steer[]`;`ceo-worker.js:1794-1802,1826-1856` 仅在启动前统一并入 goal | 当前 queue 改动只补损坏/并发安全，不新增 follow-up 语义 | 部分覆盖；分队列原先仅文档 experiment，仍是真实缺口 | PoC 默认 flag 关闭时保持 legacy single steer；实验开启后只在 next-step 前 drain steering、turn 后 drain follow-up；生产启用仍需 owner gate | `queue.test.js:42-44,200-216`、PoC flag/order/rollback 合同 exit 0 |

## 从 PoC 待办剔除

- AHR-18:源码、可达完成链、自动测试和本机基线四类证据齐全，不再造 done gate。
- AHR-21 的 engine 进程组部分:已有 detached engine + TERM/KILL group；只剔除这段已实现能力，不能据此宣称所有 runner 已统一，也不能默认改内层 CLI 终止行为。

## 仍是生产缺口、但本轮不切换

- AHR-17/19/20/22/23/24/25 的缺失切片只在隔离 shadow harness 验证；未接 `engine.js`、`cli-runner.js`、`queue.js`、UI 或真实事件账本。
- AHR-21 runner 统一进程组会影响合法子进程，本轮只有 owner-gate 合同，没有进程终止 PoC。
- 所有研究建议必须以本矩阵的源码与测试证据为准；`board/insights/agent-harness-safe-actions-20260714.md:20-31` 只是审计基线，不单独构成“缺口已证实”。
