# 玉兔6 Graph Engineering 演进架构

- 状态：`approved_direction / staged_delivery`
- 日期：2026-07-22
- 目标：把玉兔6从“文件队列驱动的多角色系统”逐步升级为“证据治理的自适应智能体图操作系统”
- 原则：不推翻现有引擎、不引入重运行时、不一次性切换生产语义

## 1. 定位

Graph Engineering 可以理解为：把多个 agent loop、确定性步骤、工具、人工决策和验证器组织成显式图。节点负责工作，边负责路由，状态跨节点流动，图负责并行、汇合、失败恢复和终止。

玉兔6的目标不只是“拥有一张 DAG”，而是让五类图共享同一组稳定身份与事件：

1. **组织能力图 Org/Capability Graph**：角色、模型、工具、权限、项目归属、可写范围、替代 runner。
2. **工作状态图 Work/State Graph**：任务节点、条件边、并行 wave、join、subgraph、loop、human gate、终态。
3. **证据决策图 Evidence/Decision Graph**：验收项、产物、测试、截图、验证者、董事意见、主人决策与 true-done verdict。
4. **资源运行图 Resource/Runtime Graph**：锁、队列槽、模型健康、token/时间预算、进程、lease、重试和故障域。
5. **学习演进图 Learning Graph**：失败案例、根因、候选 skill/hook、canary、指标变化、晋升、休眠和回滚。

五张图通过 `taskId / graphRunId / nodeRunId / artifactId / evidenceId / specFingerprint` 连接。普通 Graph Engineering 解决“谁接谁”；玉兔6还要解决“为什么这样接、是否真的完成、花了多少、失败后学到了什么”。

## 2. 当前架构判断

### 已是图的部分

- `shared/routing/flows/review-loop.yaml` 已声明 nodes、edges、条件和 human gate。
- `shared/engine/engine.js` 已做 compile 前校验、条件边遍历、loop 上限和终态判断。
- `taskstore` 已有 cursor、steps、visits、attempt、history，可作为 snapshot 的迁移基础。
- eventlog、interaction trace、handoff、done gate、resource locks 已提供图运行所需的大部分证据。

### 仍是线性或隐式的部分

- `project-route`、董事会、CEO、主管和队列衔接大多由 `engine-runner.js / ceo-worker.js` 的分支代码决定。
- 当前 engine 每次只持有一个 `current` cursor；多出边只表示“选一条”，不能 fan-out。
- 角色配置告诉系统“谁存在”，flow 告诉系统“做什么”，两者没有编译期 capability/type check。
- UI 链路图依据事件推算节点，不是直接读取权威 graph manifest 和 graph snapshot。
- loop engineering 只在 `review-loop` 特判接入，尚未成为任意 graph node 可组合的 subgraph。

## 3. 目标运行模型

### 3.1 Graph Manifest

每次运行绑定不可变 `graphVersion + specFingerprint`：

```json
{
  "schemaVersion": "yutu-graph@1",
  "graphId": "project-delivery",
  "graphVersion": "1.0.0",
  "projectId": "控制台",
  "objectiveRef": "artifact://task/spec",
  "nodes": [],
  "edges": [],
  "budgets": {},
  "policies": {},
  "rollback": {}
}
```

### 3.2 Node

节点不是 agent 的同义词。首批节点类型：

- `agent`：带自身 harness/loop 的智能体节点。
- `tool`：确定性工具或 capability_registry 能力。
- `script`：零 token 脚本、测试、构建或状态转换。
- `router`：代码规则或受限 planner，输出 typed route。
- `human_gate`：持久化人工决策。
- `fanout` / `join`：并行 wave 与汇合策略。
- `subgraph`：复用 review-loop、维修闭环、发布闭环等子图。
- `end`：`success / failed / blocked / canceled / partial` 明确终态。

节点必须声明：`inputProjection`、`outputContract`、`capabilities`、`resourceClaims`、`budget`、`timeout`、`retry`、`idempotency`、`evidencePolicy`、`failureEdge`。

### 3.3 Edge

边必须是可解释的 typed handoff：

- `from / to`
- `when`：确定性条件；开放决策只能指向 planner/router 节点。
- `projection`：只传所需 state 与 artifact refs。
- `reasonCode`：路由原因，不能只留自然语言。
- `onFailure / onTimeout / onReject`
- `delivery`: `single / fanout / join`

### 3.4 State Snapshot

每个 superstep 写一个轻量 snapshot：

```text
graphRunId, graphVersion, specFingerprint, superstep,
nodeStates, readyNodes, blockedNodes, stateRefs,
artifactRefs, evidenceRefs, resourceLeases, budgetsUsed, hash
```

正文和大文件只存引用，不重复写入 snapshot。短任务可只在节点终态写；长任务按风险和时长分档，避免 SSD 写放大。

### 3.5 编译与执行

1. 秘书把自然语言补成 spec，不直接造运行图。
2. CEO/planner 选择受信 graph template，并只填参数或提出受限 graph patch。
3. graph compiler 做结构、类型、能力、权限、资源、终止性和预算检查。
4. scheduler 根据 ready set、依赖和资源图生成 execution wave。
5. 节点完成只返回状态增量、artifact refs 和 evidence refs。
6. reducer 归并状态；join 判断后生成下一 ready set。
7. true-done 由证据图决定，不由任一模型声明。

## 4. 超越普通 Graph Engineering 的关键机制

### 4.1 证据图原生化

每条 acceptance 是节点，每份测试/产物/截图是证据节点，verifier 产生 verdict 边。只有所有 required acceptance 都存在可信 evidence path，图才能进入 success。现有 done gate 迁移为证据图的终态 reducer，而不是再加一层平行 gate。

### 4.2 组织图与工作图编译检查

graph compiler 在运行前验证：角色是否存在、runner 是否健康、是否有所需 capability、写路径是否允许、reviewer 是否独立、缺席是否触发降级。这样“派错角色”在模型调用前失败，而不是跑半天才发现。

### 4.3 资源感知调度

ready node 不等于立即运行。scheduler 同时读取：

- 文件/项目资源锁；
- 同类 CLI 串行约束；
- 模型健康与 quota breaker；
- token、墙钟和内存预算；
- 节点优先级与公平性。

只并行互不依赖且资源不冲突的节点。

### 4.4 可回放与可分叉

- `resume`：从最近可信 snapshot 继续。
- `replay`：用同一 manifest 和输入重放，验证确定性部分。
- `fork`：从历史 snapshot 复制新 graphRunId，修改策略或 runner 做 A/B；原运行不可变。
- `compare`：按 acceptance score、成本、延迟、失败率比较分支，只晋升真实提升。

### 4.5 学习图而非自动改生产

失败和质量抽查先生成 learning candidate：

```text
incident -> rootCause -> proposedChange -> canary -> metricDelta -> promote|dormant|rollback
```

只有重复错误、外部证据和 canary 指标共同支持时，才把改进晋升为 skill/hook/graph template。高风险或影响现有行为的变化仍由主人拍板。

## 5. 渐进迁移路线

### GE-01：Graph Manifest + 影子编译器

- 定义 `yutu-graph@1` 最小 schema、validator 和 compiler。
- 把现有 `review-loop.yaml` 无损编译为 canonical manifest。
- 把一次真实 `project-route` 事件链离线投影成 shadow graph，对照节点/边/终态。
- 只写 shadow artifact/event，不改变调度、队列、gate 或 UI。
- 默认关闭；启用时 p95 延迟与内存增量目标均低于 1%。

### GE-02：单 cursor 运行时统一

- 让现有 review-loop 通过 compiled manifest 运行。
- 保持严格串行，输出必须与旧 engine 等价。
- 双跑 compare，失败自动回旧路径。

### GE-03：Subgraph 与显式 Handoff

- 把 review-loop、维修、发布、董事会评审变成可复用 subgraph。
- 统一 manager-as-tools 与 handoff 的 owner 语义。
- 边只传 context projection + refs，压缩交接 token。

### GE-04：Fan-out / Join / Parallel Wave

- 增加并行 wave、all/any/quorum join、取消传播和部分失败策略。
- 先在只读研究/多董事评议 canary，禁止共享写目标并行。
- 资源图参与调度，保留现有并发槽和 runner singleflight。

### GE-05：Durable Interrupt / Snapshot / Time Travel

- human gate 跨重启恢复。
- 长任务节点级 snapshot，短任务保持轻量。
- replay/fork/compare 可用于回归和模型路由评估。

### GE-06：证据图与学习图

- acceptance/evidence/verdict 变为可查询图。
- done gate 读取证据图，而非扩大文本规则。
- 失败案例触发候选改进、canary、晋升或休眠。

### GE-07：Graph Control Room

- UI 读取权威 manifest + snapshot，不再从字符串猜链路。
- 同时展示 Org Graph 与 Work Graph；按需叠加 evidence/resource/learning 图层。
- 支持查看当前 ready/blocked 节点、关键路径、成本、失败边和人工门。

## 6. 性能与 token 目标

- 固定拓扑和确定性路由零模型调用。
- 交接默认只传当前节点所需投影；完整历史保留为可追溯 artifact，不自动注入。
- planner 每个 graph run 原则上只调用一次；无边匹配才允许重新规划。
- 低价值任务使用单节点或单 loop，禁止为“图化”强制多 agent。
- 观测异步聚合；snapshot 分档；事件保留期和大产物引用化。
- 每个 graph run 记录 `token / latency / memory / retries / useful-output`，与旧路径做基线比较。

## 7. 硬边界与回滚

- 新 graph runtime 在 GE-02 前不得控制生产调度。
- 每阶段有 feature flag、旧路径 fallback 和等价性测试。
- graph compiler fail closed，但 shadow 阶段的失败只记录，不阻塞原任务。
- LLM 只能选择已批准模板或提出 patch；patch 未通过编译和主人/策略授权不得执行。
- 不复制完整 prompt、密钥、token、cookie、私钥或未脱敏输出到图状态。
- 任何阶段性能、成功率或恢复能力退化，立即切回上一 graphVersion/旧 engine。

## 8. 验收指标

| 指标 | 基线后目标 |
|---|---|
| 可由 manifest 重建的任务链比例 | GE-03 后 >= 95% |
| 无模型参与的路由比例 | >= 85% |
| 交接上下文 token | 比当前中位数下降 >= 30% |
| 孤儿/卡死任务恢复率 | >= 99% |
| 声明与实际不一致的假完成 | 0 个通过 true-done |
| 独立任务并行带来的关键路径缩短 | >= 25%，且冲突率不升 |
| 图层额外常驻内存 | GE-04 前 < 100MB |
| shadow/compile 额外 p95 延迟 | < 1% 或 < 50ms，取较宽者 |

## 9. 当前批准动作

只批准 GE-01：Graph Manifest、validator/compiler、离线/影子对照和测试。GE-02 及以后每阶段必须基于上一阶段真实数据，由 CEO 给出收益、风险和回滚后再进入实施。

