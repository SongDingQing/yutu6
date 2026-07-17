# AHR-26..30 阻塞风险评估

- 初始 implement taskId: `cr-1784014494477-397d53ad`
- 当前复核 taskId: `cr-1784018284182-397d53ad`
- 风险 owner:监管 `governance`；本文由 implement 节点落盘证据，后续由 scoped review-loop 独立重算，不冒充主人批准。
- 状态枚举仅用:`已缓解`、`待验证`、`待主人拍板`、`接受风险`。
- 结论:本轮允许完成准备工作；不允许切换任何全局 blocking hook。

| 风险 | 证据与阻塞机制 | 严重度 | 处置状态 | 处置、回滚与 owner |
|---|---|---|---|---|
| R1 `task.true_done` 是单点大阻塞面 | `engine-runner.js:84-94` 一次注册 5 个 `failureMode:block` hook；`shared/engine/engine.js:270-324` 任一 block 失败即不写 true done | 高 | 接受风险 | 保留现状，不在本任务重配；迁移必须逐 hook shadow。回滚=撤回新 registry 接入并恢复本基线哈希；owner=`worker_code` |
| R2 当前 timeout 不能中断同步卡死 handler | `hook-registry.js:47-67` 先执行 handler，再比较 elapsed。注入预算 5ms、handler 40ms，实测实际阻塞 40ms，之后才返回 `blocked_after_handler_returned`；见 `contract-test-evidence.json` | 高 | 待主人拍板 | 真正中断需把潜在慢 hook 隔离到 worker/child process 并在超时后 kill，属于运行时架构变更。回滚=关闭隔离适配、恢复同步 registry；owner=`worker_code` |
| R3 version-progress 同步 block 预算达 95 秒 | `version-progress-hook.js:868-879` 默认 `LOCK_WAIT_MS+5000` 且 block；内部包含锁、git/审计/发布路径 | 高 | 待主人拍板 | 迁移到隔离执行前不得缩短/改 failureMode。回滚=恢复当前注册参数和基线哈希；owner=`it_engineer` |
| R4 hook 事件缺版本与调用关联键 | `hook-registry.js:70-78,89-96` 的 `hook.executed` 只有 hookId/eventType/elapsed 等；没有 schemaVersion/requestId/taskId/toolCallId | 中 | 待验证 | 先双读旧字段、只在 shadow 生成 v1 canonical event，验证 replay 后再考虑接入。回滚=停止 shadow emitter；owner=`worker_code` |
| R5 pre/post 职责当前未建模 | 当前 registry 只有 eventType，真实注册只见 `task.true_done`；没有 pre/post tool 责任字段 | 中 | 待验证 | 用 contract 限定 pre 只做政策/参数门禁，post 只收 outcome/evidence；先双路径观测。回滚=停止 shadow path；owner=`quality_ops` |
| R6 工具旧名直接退役会破坏脚本/UI 启发式 | `workspace.html:629-636,3521` 与 `server.js:3154` 依赖 `open_file/apply_patch/exec_command` 等字面名；`cli-runner.js:708-719` 还消费配置别名 | 中 | 已缓解 | 设计已固定“先 alias、统计命中、零命中后退役”；contract 覆盖 alias。回滚=继续接受旧名；owner=`quality_ops` |
| R7 相对路径/无 artifact ID 可能跨工作区误交接 | `engine-runner.js:124-128` 对工作区内文件返回相对路径；当前事件没有稳定 artifact ID | 中 | 待验证 | AHR-27 离线 contract 已验证绝对路径、realpath 边界和稳定 path ID；需 shadow replay 后接入。回滚=继续旧相对路径并保留兼容 reader；owner=`worker_code` |
| R8 “主人再次确认”若作为同步等待会死锁 | `board/control-plane/approvals.md` 当前不存在；brief 是任务授权，不是切换批准 | 高 | 已缓解 | `approval-state.json` 明确 `not_authorized`；准备任务直接收口，不等待。后续只接受绑定 rootTaskId、范围和回滚计划的显式批准。回滚=把任何无效批准视为未授权；owner=`supervisor-控制台` |
| R9 共享 hook 文件本来就有用户未提交改动，普通 diff 无法归因 | 本轮起始 `engine-runner.js`、`version-progress-hook.js`、`loop-engineering.js` 已 dirty | 中 | 已缓解 | `production-hook-baseline.json` 记录接手时 5 个关键文件 SHA-256，contract/review 逐字节复核。回滚=不覆盖用户改动；owner=`worker_code` |
| R10 fail-closed 自愈路径缺失有本机停机先例 | commit `d17077d86c88bfe017ee7da54a71c012f81fe3c7`：调度层对 degraded 恒阻断，恢复 probe 永远到不了 cli-runner，造成队列停摆；`ceo-worker.js:1543-1546` 留有根因注释 | 高 | 接受风险 | 将其作为所有 fail-closed 设计的反例；新 block 必须证明恢复动作可达。回滚=切回 fail-open/shadow，保持既有 hook 不动；owner=`governance` |
| R11 非 UI 任务的 `NA+理由` 与真实 DoneGate 冲突 | brief `projects/控制台/brief.md:15619,15631,15643` 要求视觉行写 NA 并禁止无关截图；但 `shared/engine/done-gate.js:36,549-554` 把 `NA` 视为坏证据，并对所有 `视觉/UI证据` 行无条件要求 Peekaboo+Codex。前两次真实任务在 `engine-events.jsonl` seq `249834`、`250254-250256` 因此停在 implement；可重复探针见 `done-gate-na-probe.js` | 高 | 待主人拍板 | 不伪造截图、不改规格、不绕过 gate。回滚=若主人另批全局 DoneGate 兼容修复，则保留旧逻辑开关或重新签发不含视觉行且带新 fingerprint 的非 UI acceptance；owner=`supervisor-控制台` |

## 超时注入解释

5ms 是判定预算，不是中断边界。40ms handler 完整运行后 registry 才设置 `timeout=true` 和整体 `ok=false`；因此测试证明的是“能发现超预算”，同时证明“不能防卡死”。AHR-30 的防卡死能力仍未实现，不能因专项测试为绿就改写这一结论。

## 风险闭环结论

R6、R8、R9 已在准备层缓解；R4、R5、R7 必须 shadow 验证；R2、R3 必须由主人拍板运行时隔离方案；R11 必须由主人决定是修 DoneGate 还是重签 acceptance；R1、R10 是现状风险且本轮接受、未扩大。没有任何风险项仅写 `done`。
