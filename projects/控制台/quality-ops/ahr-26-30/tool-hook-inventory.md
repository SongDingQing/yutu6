# AHR-26..30 工具与 hook 清单

- 初始 implement taskId: `cr-1784014494477-397d53ad`
- 当前复核 taskId: `cr-1784018284182-397d53ad`（同 queueId/spec fingerprint；重新核对现状，不把前两次 implement 或离线 fixture 冒充已通过的真实 review-loop）
- rootTaskId: `cr-1784014332008-34ff7914`
- 归属:质量运营负责清单维护；监管复核阻塞面；项目主管做完整性门。
- 清单基线:2026-07-14；只读盘点，没有连接新运行时。

## 完整性验收标准

清单只有同时满足以下条件才可进入迁移阶段：AHR-26..30 每个关键路径均有名称或别名、触发条件、调用方/旧名依赖、priority、failureMode、timeoutMs、当前状态、影响范围和唯一 owner；所有 `registry.register(...)` 调用均被覆盖；旧工具名依赖脚本单列；专项 contract test 和独立 review-loop 复核均通过。扫描口径为 `rg "registry\.register|\.register\('task\.true_done'" shared/engine projects/控制台`，当前只发现下表 5 个注册项。

## 工具与兼容入口

当前控制台并没有逐个暴露 `read_file`/`exec_command` 的一等 tool registry。`openai_http_tool_harness` 是“文本 planner 产出意图，再把整份任务交给 Codex executor”的两段式入口，证据见 `shared/engine/cli-runner.js:978-1031`。因此 AHR-26 本轮只能先冻结已有 runner 配置别名和工具名消费者，再用离线兼容层定义未来首选名，不能宣称已完成生产工具收敛。

| 首选入口/能力 | 现存别名或旧名 | 触发条件 | 调用方与旧名依赖脚本 | priority / failureMode / timeoutMs | 当前状态与影响范围 | 唯一 owner |
|---|---|---|---|---|---|---|
| `execution.toolHarnessRunner` | 顶层 `toolHarnessRunner`、`execution.tool_runner`、`execution.fallbackToolRunner` | `implement`/`execute` 需要写盘而请求 runner 不可写 | 消费:`shared/engine/cli-runner.js:704-765`；当前配置:`projects/控制台/config.json:629-668`；回归:`projects/控制台/tests/runner-writable-flag.test.js:8-9`、`tests/text-tool-harness.test.js:68-173` | 不适用；节点 timeout 由 runner 预算控制 | active；影响纯文本 runner 到真实 executor 的升级路径 | `worker_code` |
| `canWriteFiles` | `writeFiles`、capability `local_file_edits` | runner 能力解析 | `shared/engine/cli-runner.js:704-719`；`shared/routing/runners.yaml:36,280` 仍依赖 capability 名 | 不适用 | active compatibility read；尚无退役遥测 | `worker_code` |
| `canRunCommands` | `shell`、capability `tests_builds` | runner 能力解析 | `shared/engine/cli-runner.js:704-719`；`shared/routing/runners.yaml:36,280` | 不适用 | active compatibility read；尚无退役遥测 | `worker_code` |
| `file.read` | `Read`、`open_file`、`read_file` | 未来 tool request 归一化；本轮仅离线 contract | UI 旧名依赖:`projects/控制台/public/workspace.html:629-636,1865-1875` | 不适用 | proposed canonical；生产未接入 | `quality_ops` |
| `file.search` | `Grep`、`Glob`、`Search`、`scan` | 未来 tool request 归一化；本轮仅离线 contract | UI 旧名依赖:`projects/控制台/public/workspace.html:631-636` | 不适用 | proposed canonical；生产未接入 | `quality_ops` |
| `file.mutate` | `Edit`、`Write`、`MultiEdit`、`edit_file`、`write_file`、`apply_patch`、`patch` | 未来 tool request 归一化；本轮仅离线 contract | UI 旧名依赖:`projects/控制台/public/workspace.html:631-636,3521`；服务端文本启发式:`projects/控制台/server.js:3150-3159` | 不适用 | proposed canonical；alias contract 已有测试，生产未接入 | `quality_ops` |
| `command.run` | `Bash`、`shell`、`shell_command`、`exec`、`exec_command`、`run_command` | 未来 tool request 归一化；本轮仅离线 contract | UI 旧名依赖:`projects/控制台/public/workspace.html:631-636,3521`；服务端文本启发式:`projects/控制台/server.js:3150-3159` | 不适用 | proposed canonical；alias contract 已有测试，生产未接入 | `quality_ops` |
| `web.fetch` | `web_fetch`、`fetch_url` | 未来 tool request 归一化；本轮仅离线 contract | UI 工具站旧名依赖:`projects/控制台/public/workspace.html:635,1864-1875` | 不适用 | proposed canonical；生产未接入 | `quality_ops` |
| `web.search` | `web_search`、`search_query` | 未来 tool request 归一化；本轮仅离线 contract | UI 工具站旧名依赖:`projects/控制台/public/workspace.html:635,1864-1875` | 不适用 | proposed canonical；生产未接入 | `quality_ops` |
| 绝对 artifact path + `artifact:path-sha256:<id>` | 当前相对路径和无 ID 交接 | 文件工具返回产物 | 当前 `engine-runner.js:124-128` 会把工作区内路径转成相对路径；`eventlog.js:64-72` 只加 seq/ts/type | 不适用 | AHR-27 gap；离线 contract 已验证路径边界/稳定 ID，生产未接入 | `worker_code` |

## `task.true_done` 全局 blocking hook 面

这里的“全局”是：接入共享 `review-loop` 的 `task.true_done` 生命周期、可影响全部控制台任务完成，或未来覆盖全部 AHR-26..30 相关服务/路由的 hook。它不是指单个测试 fixture 内的局部 registry。

| hook id | 触发条件与调用方 | priority | failureMode | timeoutMs | 当前状态与影响范围 | 唯一 owner |
|---|---|---:|---|---:|---|---|
| `console.done_gate_meta` | `engine-runner.js:84-94` 注册；所有 review-loop 真完成前；实现:`hardening-hooks.js:68-78` | 10 | `block` | 50 | active/global；DoneGate 元契约异常会阻断完成 | `worker_code` |
| `console.protocol_gate` | `engine-runner.js:84-94` 注册；所有 review-loop 真完成前；实现:`hardening-hooks.js:79-88` | 15 | `block` | 100 | active/global；协议迁移错误会阻断完成 | `worker_code` |
| `console.hard_regression_coverage` | `engine-runner.js:84-94` 注册；所有 review-loop 真完成前；实现:`hardening-hooks.js:89-98` | 20 | `block` | 100 | active/global；硬回归证据缺失会阻断完成 | `worker_code` |
| `engine.loop_engineering_convergence` | `engine-runner.js:84-94` 注册；所有 review-loop 真完成前；实现:`shared/engine/loop-engineering.js:522-532` | 30 | `block` | 100 | active/global；循环未收敛会阻断完成 | `worker_code` |
| `console.version_progress` | `engine-runner.js:84-94` 注册；所有 review-loop 真完成前；实现:`version-progress-hook.js:868-879` | 50 | `block` | 95000 (`LOCK_WAIT_MS + 5000`) | active/global；含锁、版本、审计和发布路径，爆炸半径最大 | `it_engineer` |

## registry 隐式契约

`shared/engine/hook-registry.js:17-23` 当前默认为 `enabled=true`、`priority=100`、`timeoutMs=100`、`failureMode=warn`；同 priority 再按 id 排序。`hook-registry.js:47-67` 在同步 handler 返回后才检查耗时；`hook-registry.js:48-51` 拒绝 Promise。上述行为已由 `projects/控制台/tests/ahr-26-30-contract.test.js` 直接针对真实 registry 做特征化测试。

## 完整性结论

当前 10 个工具/兼容入口、5/5 个真实注册项与 AHR-26..30 路径缺口均已入表。清单可作为兼容迁移输入，但不等于批准生产接入；`approval-state.json` 仍为 `not_authorized`。
