# Graph Engineering 洞察归并 · 2026-07-22

## 结论

“Graph Engineering”是 2026 年 7 月刚形成的社区术语，并非 OpenAI、Google、Anthropic 或 LangGraph 的正式统一标准。对玉兔6有用的不是追逐新名字，而是把已经存在的多智能体关系从“提示词约定 + 文件队列 + 事后画图”升级为“运行前可编译、运行中可恢复、运行后可证明”的显式图。

Loop Engineering 不被废弃。每个复杂节点仍可运行自己的生成、验证、挑刺、改进循环；Graph Engineering 负责决定哪些节点存在、谁依赖谁、状态如何流动、何时并行、何时汇合、何时停下或交给主人。

## 本次归并的近期洞察

| 来源 | 对玉兔6的有效结论 | 归并位置 |
|---|---|---|
| `board/insights/agent-harness-deep-research-20260714.md` | manager/handoff 二选一、delegation envelope、artifact refs、独立任务才并行、共享状态单 owner、quorum、context filter、按价值分配 agent/token | 组织图、工作图、资源图 |
| `projects/控制台/artifacts/self-reflection-optimizer/insight-50-review-20260716.md` | 不再堆 gate；优先补可观测、轻量协议和可回滚迁移；高成本 checkpoint 只给长任务 | 迁移策略与性能预算 |
| `board/insights/borrowed-libs.md` | PocketFlow 的 Node/Flow、Google ADK 的 Sequential/Parallel/Loop、LangGraph 的 checkpoint/interrupt/time travel | 图原语和持久化状态 |
| `projects/控制台/artifacts/architecture/task-dag-handoff-protocol-current-1783229985336-20260705.md` | DAG manifest、handoff、fan-out/fan-in、retry、idempotency、lease、heartbeat 已有 RFC，但仍未进入运行时 | 作为现有 RFC 基线，不另造平行协议 |
| `projects/控制台/artifacts/architecture/swarm-langgraph-handoff-stategraph-current-1783244721286-20260705.md` | 显式 handoff、state/reducer、conditional edge、compile check、superstep | 图编译和状态归约 |
| OpenAI Agents SDK 官方 orchestration 文档 | LLM 编排与代码编排可以混合；确定路径优先代码，开放问题才由模型决策 | 确定性边与 planner 节点分界 |
| LangGraph 官方 Graph/Persistence/Interrupt 文档 | 节点和边共享状态；checkpoint 支撑人审、故障恢复和时间旅行 | 状态快照与 durable human gate |
| Google ADK 官方 workflow agent 文档 | Sequential、Parallel、Loop 是可组合的确定性原语 | 图节点类型与并行 wave |

## 玉兔6当前已经具备

- `shared/engine/engine.js` 已按 `nodes + edges + when` 运行声明式流程。
- `shared/engine/taskstore.js` 已保存状态、cursor、steps、visits、attempt 和恢复信息。
- `shared/engine/eventlog.js`、interaction trace、handoff、resource lock 已能重建部分运行链路。
- `review-loop.yaml` 已把 loop engineering、human gate、done gate 串起来。
- 规格指纹、结构化回执、真实证据 gate 已明显强于多数普通图编排框架。

## 真正缺口

1. 只有 `review-loop.yaml` 是完整声明式图；CEO project-route、董事会、项目主管和队列交接仍大量硬编码。
2. 引擎是单 cursor 串行遍历，没有一等 `fan-out / join / parallel wave / subgraph`。
3. 组织关系、能力、模型、权限与工作图分离，派错角色只能运行后发现。
4. 任务状态有 checkpoint 雏形，但没有统一的 superstep snapshot、fork 和 time-travel 语义。
5. done gate 证据很强，但验收项、证据、验证者和终态还不是可查询的“证据图”。
6. UI 链路图主要是事件投影，不是运行时权威 graph manifest。
7. 资源锁、token、模型健康和并发预算没有成为节点/边的调度输入。
8. 洞察、失败、skill、hook 与改进结果已有记录，但未形成“失败 -> 候选改进 -> canary -> 晋升/回滚”的学习图。

## 不建议做

- 不直接引入 LangGraph、ADK 或其他重运行时来替换现有零依赖 Node 引擎。
- 不把每个节点都做成 LLM agent；脚本、工具、测试、join、human gate 和 end 都应是一等节点。
- 不允许 LLM 自由生成未经编译检查的生产图。
- 不为“图化”新增一层全局重 gate；先 shadow、对照、canary，再逐 flow 激活。
- 不把完整 transcript 沿边复制；只传 state projection、artifact ref 和 evidence ref。

## 建议

采用 `docs/设计/玉兔6-Graph-Engineering-演进架构.md` 作为唯一演进基线。先实施 GE-01“Graph Manifest + 影子编译器”，验证现有执行可被图模型无损描述；之后才逐步启用并行、子图、持久中断、证据图和自适应优化。

