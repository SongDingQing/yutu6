# AHR-17..25 隔离 PoC、故障注入与回滚设计

## 决策边界

- 对照 `memory/decisions.md:1305`:沿用 AHR-26..30 的“兼容迁移 + contract tests + owner 再确认”先例；本轮不切换全局行为。
- 对照 `memory/decisions.md:1311-1316`:执行 AHR-17..25 审计和 PoC，但“删去已实现项”只表示从 PoC 待办剔除，不删除代码、事件或兼容字段。
- 参考 `board/learning-cases/agent-harness-research-cases.md:10-15`:README/研究建议不是实现证据，结论回到源码、测试和本机基线。
- PoC 入口:`shadow-harness.js`;唯一测试入口:`node projects/控制台/tests/ahr-17-25-poc.test.js`。它不被生产 runner 引用。

## PoC 清单（只含已证实缺口）

| 缺口 | 收益 | 隔离注入条件 | 兼容 contract test | 回滚 | owner gate |
|---|---|---|---|---|---|
| AHR-17 工具步四相位 | 回放能分清选择、执行、观察、决策 | `taskId` 必须 `ahr-fi-*`;`environment=shadow`;shadowRoot 必须含 `ahr-17-25-shadow` | 固定转移，非法跳步拒绝；每相位原子写 | 原子 rename 失败保留上一个完整 checkpoint | 接生产事件 schema 前需主人确认 |
| AHR-19 typed outcome | UI/队列不再靠自由文本猜终态 | 只构造离线旧记录，不读写真实 queue | `typed_outcome` 只追加；旧 `state/status` 与旧消费者输出逐项不变 | 删除可选字段即可回退，旧消费者从未切换 | 全局消费者迁移需主人确认 |
| AHR-20 cost hard budget | 限制失控任务费用 | 离线 clock/usage，不连 new-api usage 或真实额度 | step/time/cost 分别超限并返回明确 typed reason | 不接生产配置；删除 shadow state 即回退 | 预算档位与生产早停策略需主人确认 |
| AHR-22 tool-step atomic checkpoint | 崩溃后不重跑已确认工具步 | 专用 shadow state；禁止与生产 artifacts root 重叠 | rename 注入失败后 canonical bytes 不变；重开可读 | 每个注入前保存 snapshot，失败后字节级恢复 | checkpoint 频率/保留期/磁盘预算需主人确认 |
| AHR-23 format error budget | 防坏 JSON 无限修复循环 | 离线解析结果计数 | 连续 3 次超 2 次预算失败；中间一次成功会清零 consecutive | feature 未接生产；删 shadow record | 生产修复提示次数需主人确认 |
| AHR-24 truncated tool-call guard | 防半参数写文件/执行命令 | executor spy，仅完整调用才可达 | truncated 与坏 JSON 的 executor count=0；完整对象=1 | guard 未接生产；无生产副作用 | 接 CLI/OpenAI tool lifecycle 前需主人确认 |
| AHR-25 steering/follow-up 分队列 | 用户补充不打乱当前工具事务 | `splitMessageQueues=false` 默认；只在独立 shadow state 开实验 | 默认返回 legacy compatibility；开启时 steering 仅 next-step 前、follow-up 仅 turn 后 drain | 关闭 flag 即回到单 steer，生产 queue/UI 未改 | 生产 flag + 精确 task/scope/rollback 批准缺一不可 |

AHR-18 不在表内，因为已完整覆盖。AHR-21 不做终止行为 PoC，因为 runner 统一进程组会影响合法子进程；本轮只新增 owner-gate contract，默认关闭。

## 故障注入矩阵

所有场景使用 `ahr-fi-fault-matrix` 和临时 `.../ahr-17-25-shadow/`。state 强制携带 `healthScore=true`、`quotaBreaker=true`、`productionEventLedger=true` 三个“排除”标记（值为 true 表示排除）；测试还建立独立 production ledger/health/breaker sentinel，并在注入后逐文件复核 SHA-256 未变。

| 场景 | 注入边界 | 预期 | 实测 |
|---|---|---|---|
| network_partition | good checkpoint 后、外部 action 前抛 `ENETUNREACH` | 无外部副作用；snapshot 恢复；不计健康/熔断 | byteExact=true,三项 excluded=true |
| process_crash | 子 Node 进程截断 canonical 后 `exit 73` | 重启读取失败可识别；用注入前 snapshot 恢复 | injectorExitCode=73,byteExact=true |
| data_corruption | canonical 写入非法 JSON | 解析失败不覆盖 snapshot；恢复后 trajectory 可读 | byteExact=true,trajectory 保留 good checkpoint |

真实队列、`engine-events.jsonl`、runner.call、route.score、quota breaker 均不作为注入目标；PoC 模块也不 import EventLog、queue、quota-degrade。故障事件只存在专项测试 stdout/`test-evidence.json`，所以不会污染 e6240ec 后的 runner 账本和 shadow 健康分。

## degraded 回滚

- 回滚直接复用 `shared/engine/loop-engineering.js:365-480` 的 `snapshotFiles -> degraded -> restoreSnapshots -> loop.rollback` 路径。
- 回归先保存 `best-known-good` 为 round 1 snapshot，再把候选改成 `degraded-candidate`，以 score `0.3 < 0.8 - 0.03` 触发 degraded。
- 实测 `stop_reason=degraded_rollback`、`decision=blocked_stop`、`loop.rollback.restored=[candidate.txt]`，文件内容恢复为 `best-known-good`。这同时钉住 2026-07-06 degraded 死锁教训:退化必须停止并保留可运行最佳版本，不能在失败状态里自行无限重试。

## 协议兼容与生产切换条件

1. `production-baseline.json` 覆盖 engine/eventlog/done/protocol/taskstore/queue/cli/loop/engine-runner/ceo-worker；专项测试每次先验哈希，任何漂移 fail closed。
2. 本轮未修改上述文件，也未写真实事件 schema；`typed_outcome` 只存在 PoC 对象。
3. AHR-19 若进入生产，必须保留旧 `state/status` 至所有 UI/queue 消费者 contract test 通过，迁移期只追加可选字段。
4. AHR-25 生产 flag 默认关闭；需要主人批准记录同时绑定 root task `cr-1784019175750-d512c3ff`、精确 scope 和 rollback plan。
5. AHR-21 内层 runner 进程组策略不得借本 PoC 默认启用；需另案进程树测试，确认不误杀合法子进程后再请主人拍板。
6. 任一生产切换失败:先关闭 feature flag/停止新字段消费，再恢复冻结文件；不得用回滚覆盖接手前已有脏改动。
