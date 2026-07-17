# AHR-26..30 兼容迁移设计

- 状态:`design_and_contract_only`
- 生产接入:`disabled`
- 全局 blocking hook 切换授权:`not_authorized`
- 当前复核 taskId:`cr-1784018284182-397d53ad`（前两次 implement taskId:`cr-1784014494477-397d53ad`、`cr-1784017768825-397d53ad`）
- 对照决议:`memory/decisions.md:1305-1309`

## 不变量与“全局”定义

全局 blocking hook 指接入共享 `review-loop` 的 `task.true_done`，或能影响全部 AHR-26..30 相关服务、路由和任务生命周期的 `failureMode:block` hook。局部测试 registry 不在此定义内。本轮不得改 `failureMode`、扩大 hook 覆盖面、新增生产 `task.true_done` 注册或把离线 contract 引入 `engine-runner.js`。

## AHR-26:先 alias，再退役

1. 冻结现状:清单列全 `toolHarnessRunner/canWriteFiles/canRunCommands` 配置别名，以及 `workspace.html`/`server.js` 对旧工具字面名的依赖。
2. 兼容期:reader 同时接受旧名，emitter 只输出 `file.read`、`file.search`、`file.mutate`、`command.run`、`web.fetch`、`web.search`；未知名由 `resolveToolAlias()` 保留原名并 fail-open 到原始 executor，但严格 canonical emitter 的 `canonicalToolName()` 仍拒绝未知名，shadow 只写脱敏命中统计。
3. 双路径验证:同一个 fixture 同时过旧 alias 和 canonical 名，比较最终 tool category、授权边界和 artifact refs，不执行两次真实副作用。
4. 退役条件:连续 14 天旧名命中为 0，所有列明依赖脚本已迁移，专项和 replay 全绿，且主人批准具体别名清单。任一条件缺失就继续 alias。
5. 回滚:canonical reader 关闭，旧名仍可直接进入既有 executor；不删配置字段。

离线参考实现是 `compat-contract.js`，不是 production adapter。`ahr-26-30-contract.test.js` 已覆盖 `apply_patch/edit_file -> file.mutate`、`exec_command/shell_command -> command.run`、`readFile -> file.read`、`web_fetch -> web.fetch`、`search_query -> web.search`，以及未知 vendor 工具名由兼容 reader 保留原名但被严格 canonical emitter 拒绝。

## AHR-27:绝对路径与稳定 artifact ID

canonical artifact ref 为:

```json
{"absolutePath":"/absolute/workspace/path","artifactId":"artifact:path-sha256:<normalized-realpath-hash>"}
```

兼容 reader 暂时仍接受相对路径，但必须以任务冻结的 workspaceRoot 解析、realpath 后再次检查不越界；canonical emitter 只写绝对路径和 ID。path ID 对同一路径稳定，内容版本另用 content hash，不把两种语义混在一个 ID。退役相对路径的条件与 AHR-26 相同；回滚为继续双读，不丢旧事件。

## AHR-28:pre/post 职责分离

| phase | 允许 | 禁止 | 建议 failureMode |
|---|---|---|---|
| `pre` | 参数 schema、路径/权限/政策门禁、可选 argumentsPatch | outcome/evidence 持久化、网络通知、版本发布 | 高危写动作可 `block`，但 handler 必须纯且有真实中断边界 |
| `post` | outcome、耗时、artifact/evidence refs 的采集 | 改写已经执行的参数、补做 policy deny、阻断已发生副作用 | 默认 `warn`，观测失败不得拖住主链 |

迁移顺序是“特征化当前 registry → 离线 v1 contract → shadow 双读/单写 → replay → 主人批准 → 小范围 canary”。pre/post 用同一个 `requestId/taskId/toolCallId` 关联；shadow 期不得执行双份工具副作用。职责断言已由 contract test 的正反样本钉住。

## AHR-29:event schema v1

canonical 最小字段:

```json
{
  "schemaVersion":"yutu6.hook-event@1",
  "phase":"pre|post",
  "requestId":"req-...",
  "taskId":"cr-...",
  "toolCallId":"call-...",
  "toolName":"file.mutate",
  "outcome":{"status":"success|failed|blocked|cancelled"}
}
```

兼容 reader 接受 `schema_version/request_id/task_id/tool_call_id/tool_name/event_type`，canonical emitter 禁止继续输出这些 snake_case 别名。post 必须有 outcome，pre 禁止 outcome/evidence。未知 schema version fail closed 于解析器自身，但 shadow 解析失败只记 warning，不阻断当前业务。

## AHR-30:timeout、降级与真实中断

每个新 hook 必须显式声明 `failureMode`、正数 `timeoutMs` 和 `degradationMode`。现有同步 registry 的 timeout 只是 handler 返回后的预算检查，不能中断死循环或阻塞 I/O；`contract-test-evidence.json` 已记录 5ms 预算实际阻塞 40ms。

潜在慢 hook 的目标结构是隔离 worker/child process + IPC：主进程在预算到期后终止独立进程组并写结构化 outcome；观测型 post hook 走本地缓冲并 fail-open；高危 pre hook 只有在恢复动作可达、kill 已验证、并有回滚时才可 fail-closed。`console.version_progress` 的 95 秒同步路径是首要隔离候选，但本轮不实施。

## 主人确认机制与无死锁收口

准备任务在无批准时以 `not_authorized` 正常收口，不同步等待。只有清单、风险报告、设计、contract tests、独立监管/主管复核全部通过后，主管才可发起确认。有效批准必须:

这里的“主人”专指玉兔6系统所有者/董事长，不是项目主管或执行 agent；项目主管只负责整理证据并发起确认，不能代批。

1. 明确绑定 root taskId `cr-1784014332008-34ff7914`，并关联当前 implementation taskId `cr-1784018284182-397d53ad`（前两次尝试为 `cr-1784014494477-397d53ad`、`cr-1784017768825-397d53ad`）；
2. 逐项列出 `approvedScope`，不能只写“同意”；
3. 附可执行 rollbackPlan、批准人和时间；
4. 出现在对应公告板任务的主人明确回复，或 `board/control-plane/approvals.md` 的持久记录。

当前 `board/control-plane/approvals.md` 不存在，brief 本身只授权“做准备”，不授权“切换”。因此 `approval-state.json` 为 `not_authorized`。后续批准也只触发新的实施任务，不能让本任务自行恢复并偷偷切换。

## 验证与回滚门

- 特征化:默认 fail-open=`warn`、timeout=100、priority/id 排序、duplicate id 抛错、同步拒绝 Promise。
- 兼容:AHR-26 alias、AHR-27 path/ID、AHR-28 phase、AHR-29 v1 correlation、AHR-30 policy/timeout 注入。
- 未切换证明:`production-hook-baseline.json` 的 5 个 SHA-256 在 contract test 和 review-loop 结束时必须相等。
- 任一测试失败:保持现有运行时、禁止扩大 blocking；回滚仅删除本目录的离线设计/contract 与 fixture，不触碰用户原有 dirty 文件。

## 视觉/UI

NA（不适用）:本任务只涉及引擎、hook、兼容协议和自动化测试，没有 UI 页面或视觉设计变更；依据 CEO brief `projects/控制台/brief.md:15631,15643`，不要求 Peekaboo 截图，也不以 failure marker 充当截图。

真实完成链当前存在独立契约冲突：`shared/engine/done-gate.js:36,549-554` 既把裸 `NA` 当坏证据，又对标题为 `视觉/UI证据` 的行无条件要求真实 Peekaboo 图片与 Codex 报告。前两次真实任务已在 `projects/控制台/artifacts/engine-events.jsonl` seq `249834`、`250254-250256` 因该冲突失败；`done-gate-na-probe.js` 可重复复现。修复全局 DoneGate 或重签 acceptance 都超出本轮授权，因此本文不以无关截图绕过。
