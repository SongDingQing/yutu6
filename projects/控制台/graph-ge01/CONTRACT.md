# yutu-graph@1 · GE-01 最小合同

合同版本：`yutu-graph@1`  
GE 阶段：`GE-01 / shadow_only`  
生产开关：不存在；本目录没有被生产队列、调度器、runner、done gate、human gate 或 UI 引用。

## 零依赖边界

本合同把“零依赖”锁定为：允许 ISO C11 标准库和 macOS 随系统提供的 POSIX 文件/时钟接口；禁止第三方源码、第三方库、包管理器 module、外部服务、外部模型调用、Node 包以及 Node/Python 等解释器运行时。`validator/compiler/review-loop/shadow projector` 编译为同一个本地可执行文件，运行时不调用其他进程。

构建只需要系统 `cc`：

```sh
make -C projects/控制台/graph-ge01 clean all
```

## Manifest 最小字段

- `schemaVersion`：必须精确为 `yutu-graph@1`。
- `graphId / graphVersion / projectId / objectiveRef / startNode`：非空稳定身份与显式起点。
- `sourceSha256`：原始 flow 字节的 SHA-256。
- `nodes[]`：`id / type / agentRole / timeoutMs`。
- `edges[]`：`from / to / when / reasonCode / delivery`。
- `budgets`：最大 loop、墙钟、输入、输出和应用动态内存预算。
- `policies`：证据要求、影子模式、默认关闭、无边策略与 GE-01 禁用运行类型。
- `manifestHash`：对不含本字段的 canonical JSON 做 SHA-256。

canonical JSON 使用固定键顺序；nodes 按 `id`，edges 按 `from/to/when/reasonCode` 排序。相同输入必须逐字节得到相同 manifest 与 hash。

## validator 语义

validator 失败关闭并返回稳定错误码，并直接执行 `schema/yutu-graph@1.schema.json` 的最小合同：根、node、edge、budgets、policies 五级对象均拒绝额外/重复字段，逐项检查 required、类型、长度/模式/范围、enum 与 const。至少拒绝：JSON/字段损坏、版本不符、hash 不符、重复节点、悬空边、不可达节点、无 `end`、未知 node type、非法条件表达式，以及在 GE-01 runtime 使用 `fanout/join/subgraph`。

GE-01 词表允许 `agent/tool/script/router/human_gate/end/fanout/join/subgraph`；后三种扩展类型只占位，任何 runtime manifest 使用它们都返回 `unsupported_in_ge01`。

## review-loop 离线触发合同

`review-loop` 命令轮询一个本地目录，按文件身份追踪并恰好编译一次完整且不可变的 `*.yaml` 修订，最终回执按文件名字典序排列；即使较早文件名晚到，也不得遗漏或重编已处理文件。已处理文件被改写或删除时失败关闭。`DONE` 文件表示没有后续修订。触发完全来自本地文件系统，不调用 agent，也不等待人工 gate。

固定资源界限：

- poll：`500ms`
- 最大修订：`3`
- 墙钟超时：`5000ms`
- 单输入：`1MiB`
- 单 manifest：`1MiB`
- 应用跟踪动态内存：`8MiB`
- nodes/edges：`128/256`

任一修订非法、超过迭代/墙钟/输入/输出/内存上限，都在界限内终止并写确定性失败回执。回执只记录有序修订名、source hash、manifest hash、资源峰值和稳定 verdict。

## shadow 投影与写屏障

shadow 只读带版本戳快照，不读取实时队列或 taskstore。临时写出只能位于系统临时目录的 `yutu-shadow-*` 命名空间；保留日志只能位于 `projects/控制台/artifacts/graph-ge01-*/shadow-logs-*`。临时目录无论成功失败都清理。源快照和冻结生产 eventlog 在运行前后都做 SHA-256/mtime 对照。

影子报告只用于 GE-01 对照，不参与任何生产决策；性能数据是影子基准，禁止外推为生产吞吐、容量或 GE-02 上线结论。

## 回退

没有生产接线或 feature flag。回退只需停止离线命令并删除本目录新增实现/任务 artifact；生产旧路径无需切换或迁移。
