# GE-01：Graph Manifest 与影子编译器

## 任务元数据

- `projectId`: `控制台`
- `route`: 秘书 -> CEO -> 控制台主管 -> 后端程序员 -> 质量/架构复审
- `priority`: 高
- `releaseImpact`: `none`
- `runtime_mode`: `shadow_only`

## 目标

落实 `docs/设计/玉兔6-Graph-Engineering-演进架构.md` 的第一阶段：建立可机读、可校验的 `yutu-graph@1` 最小合同，把现有 `review-loop.yaml` 和一条真实 `project-route` 事件链转换成 canonical graph manifest。只做影子编译、离线对照和指标记录，不改变生产队列、调度、runner、done gate、human gate 或 UI 行为。

## 实施范围

1. 建 Graph Manifest、Node、Edge、Budget、Policy 的最小 schema 和零依赖 validator。
2. 建 compiler：读取现有 flow，输出稳定排序、稳定 hash 的 canonical manifest。
3. 支持当前已有语义：agent/tool/human/end、条件边、loop guard、timeout、acceptance policy。
4. 对尚未支持的 `fanout/join/subgraph` 只保留 schema 词表；若误用于 runtime 必须明确报 `unsupported_in_ge01`。
5. 建 shadow projector：从一条真实 `project-route` 的 eventlog/interaction trace 投影节点和边，输出 artifact；不得反向写 queue/taskstore。
6. 比较旧执行轨迹与 canonical graph：节点顺序、边、终态、task/spec identity 一致；差异写报告，不阻塞生产任务。
7. 通过 feature flag 或离线命令启用；默认关闭。不得增加常驻模型调用。

## 执行锁定（董事会第 1 轮修订）

- “零依赖”精确指：允许 ISO C11 标准库与 macOS 系统 POSIX 接口；禁止第三方源码/库/module、包管理器、外部服务/模型以及 Node/Python 等解释器运行时。
- review-loop 仅由本地文件系统每 `500ms` 轮询完整不可变 YAML revision，以 `DONE` 结束；不依赖外部 agent 或人工 gate。上限为 3 次 revision、5000ms 墙钟、1MiB 单输入/manifest 和 8MiB 应用跟踪动态内存。
- 等价性基准锁定为带版本戳的只读生产 eventlog 快照与固定 golden，必须记录两者 SHA-256；不使用实时漂移输出作基准。
- 影子临时数据只能写 `${TMPDIR}/yutu-shadow-*` 且退出自动清理；保留日志只能写 task-scoped `projects/控制台/artifacts/graph-ge01-*/shadow-logs-*` 时间戳目录。生产 eventlog/queue/taskstore 必须前后指纹不变。
- 性能以已锁定的当前生产 flow-load/dry-run 投影代理基准对比：p50 退化不超过 5%，p99 退化不超过 10%。结论只适用于影子基准，不得外推生产吞吐、容量或 GE-02 readiness。

## 建议归属文件

主管可按现有边界调整，但不得另建第二套引擎：

- `shared/engine/graph-schema.js`
- `shared/engine/graph-compiler.js`
- `shared/engine/graph-shadow.js`
- `shared/routing/graphs/`
- `tests/graph-compiler.test.js`
- `tests/graph-shadow.test.js`
- `projects/控制台/artifacts/graph-shadow/`

## 验收

1. `review-loop.yaml` 可编译为稳定 manifest；同输入重复编译 hash 一致。
2. validator 拦截：重复节点、悬空边、不可达节点、无终态、非法条件、未知 node type、GE-01 未支持的运行时 fanout/join。
3. 至少一条真实 `project-route` 可离线投影，报告列出 canonical nodes/edges、缺口和映射证据。
4. shadow 不修改 queue、taskstore、eventlog 历史或任务终态；默认关闭时零行为变化。
5. 启用 shadow 后不新增模型调用；离线或 smoke 数据证明额外 p95 延迟低于 `50ms`，额外常驻内存低于 `100MB`。
6. 运行新增专项测试、现有 `shared/engine/demo.js`、project routing/review-loop 相邻测试及 `node tests/run.js`；若全量测试有既有失败，需区分并给专项通过证据。
7. 输出逻辑链：changed files、测试命令与退出码、shadow artifact、性能数据、已知缺口和一键回退方法。

## 红线

- 不在 GE-01 改生产执行语义，不启用并行、subgraph、time travel 或自适应改图。
- 不引入 LangGraph、ADK、Temporal 等运行时或 Node 依赖。
- 不增加新的全局 gate；shadow 错误只记录，不阻塞原链。
- 不读取或回显密钥、token、cookie、私钥。
- 不 push、不发布；任何生产激活留给 GE-02 单独审批。
