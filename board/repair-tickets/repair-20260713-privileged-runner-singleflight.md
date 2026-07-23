# 维修工单 repair-20260713-privileged-runner-singleflight · repair-lead→repair 特权 runner 单飞互锁

- status: done
- created_at: 2026-07-13T10:51:26.261Z
- source: 秘书
- priority: normal

## 问题
维修主管在严重工单内按协议派给 repair 后，repair-lead 与 repair 共用 codex-privileged singleflight；主管占槽等待维修员，维修员已 claim 但等待同一槽，形成结构性自锁。该模式已在 auto-20260713093810-8e1f550782c2d691/repair-1888e352 与 auto-20260713103533-5d8f47806172d340/repair-fc4c9318 连续出现。

## 事件证据 / 路径
- projects/控制台/artifacts/engine-events.jsonl:38871-38877,38964；board/repair-tickets/auto-20260713103533-5d8f47806172d340.md；repair/fc4c9318 engine.slot.wait reason=runner-singleflight；前一单 queue.steered seq 234871。

## 期望结果
全局评估维修主管到维修员的调度契约：避免父任务持有写码 runner 时同步等待子 repair；优先设计显式让槽/独立执行池/异步复核状态机，并补两张连续工单的无死锁回归。不得取消 fail-closed、不得伪造队列完成；高危进程或服务变更先给主人确认。

## 红线
- 高危/不可逆操作必须先给主人确认
- 密钥/token/cookie/私钥不回显、不写日志
- 不破现有功能; 能验证就写验证结果

## 维修部门消费方式(v3 主管先行)
`repair-lead` 是维修主管队列(Codex 特权),所有工单默认先进主管:链路核查、根因分析、严重度分级、必要时分派 `repair` Codex 维修员执行。紧急时仍可由独立 Codex 特权会话手动接管。推荐手动命令:

```bash
codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -C /Users/yutu6/玉兔6工作区 "$(cat /Users/yutu6/玉兔6工作区/board/repair-tickets/repair-20260713-privileged-runner-singleflight.md)"
```

## 处理结果
- status: done

## 维修主管初查（2026-07-17 · task `cr-1784262403029-0af586f8`）

### 链路证据
- 第一条复现链：`repair-lead` 为 `auto-20260713093810-8e1f550782c2d691` 生成完整严重维修 brief，并通过正式入口派给 `repair/1888e352`。归档事件 `projects/控制台/artifacts/engine-events.2026-07-16-0926-50889.jsonl:36177-36182` 记录 enqueue → claim → `engine.slot.wait(reason=runner-singleflight)`；`:36307` 记录主管被迫改派独立 Codex 手动接管并给正式子单加只读 steer。正式 repair 直到主管释放锁后才在 `:37565-37567` 获锁启动，实际返回只读核验，终态见 `projects/控制台/artifacts/queues/repair/done/1888e352.json` 与 `projects/控制台/artifacts/engine-runs/cr-1783935705532-1888e352/execute-1-fo1/result.md`。
- 第二条连续复现链：`repair-lead` 为 `auto-20260713103533-5d8f47806172d340` 生成阶段契约最小修复 brief，派给 `repair/fc4c9318`。同一归档事件 `:38871-38877` 记录 enqueue → claim → 同一 `codex-privileged` 单飞等待，`:38964` 再次记录手动接管/只读 steer；正式 repair 只在主管释放后于 `:39167-39169` 启动，终态见 `projects/控制台/artifacts/queues/repair/done/fc4c9318.json`。
- 当前运行链：本主管任务在活动事件 `projects/控制台/artifacts/engine-events.jsonl:48430-48432` 取得 `codex-privileged` runner lock 并进入 task `cr-1784262403029-0af586f8`，证明当前运行配置仍让主管占用同一特权锁。
- 后续复发：`board/repair-tickets/auto-20260716054644-2a1d07b633627e93.md`、`auto-20260716150914-5bcb2faef11b92cd.md`、`auto-20260716203059-525f5581552a5f87.md`、`auto-20260717024447-b86d9cf1d37d1157.md` 均记录相同的“主管持锁、正式 repair pre-engine 等锁、独立接管后 no-op 收口”模式，故不是 7 月 13 日的一次性卡顿。

### 需求传递判断
- 两次原始 `repair` handoff 均保存了目标文件、禁止范围、验收命令、高危确认和密钥红线；`projects/控制台/artifacts/engine-runs/cr-1783935705532-1888e352/task.md` 与 `cr-1783939247888-fc4c9318/task.md` 可核，未发现老板需求被缩写、跳过或传错。
- 实际落差发生在执行契约而非 brief：提示词要求严重任务必须“主管派工 → repair 写码 → 主管独立复核”，但运行时锁模型使 repair 必须等待主管退出，迫使同一主管手动接管写码，无法形成真正独立的实现 trace 与复核者。

### 严重度与根因
- **严重**。故障位于公共 queue/runner/特权执行层，已跨多张工单反复出现；会造成结构性等待、手动接管、重复 steer/no-op、额外 runner 调用，并破坏维修部门职责分离与独立复核证据。
- 精确根因：`projects/控制台/config.json` 将 `repair-lead` 与 `repair` 都映射为 `codex-privileged`；`projects/控制台/ceo-worker.js:86-89` 将该 runnerType 纳入单飞集合，`:1646-1675` 又只按 runnerType 使用单一锁文件。虽然 `:1608-1643` 允许两角色绕过全局 engine capacity，但 runner-type lock 仍共享，所以父任务持锁等待子任务时必然自锁。
- 当前 closeout/cancel/no-op 守卫只能在手动接管之后防重复写，不能让 repair 在主管持锁期间真正执行，属于止血而非根因修复。

### 架构判断与执行范围
- 本问题是可泛化的系统性角色边界缺陷。对照 `memory/decisions.md:1375`，本单采用“受控独立特权槽”而不是无界放开：`repair-lead` 与通过可信工单 scope 的 `repair` 各自保持 token=1；资源域锁、scope 签名、写范围审计、高危 human gate 和 fail-closed 均保留。
- `repair` 执行范围：最小修改 `projects/控制台/ceo-worker.js` 及专门回归测试；只在 `consumeScopedBypassOrFallback()` 已验证 `trusted_repair_ticket_scope` 后，为该 repair 子任务选择独立 delegated-repair lock scope。普通/无签名 repair、其他 `codex-privileged` 角色仍用原锁。事件和锁记录必须同时保留物理 runnerType 与逻辑 lock scope，便于审计。
- 验收至少覆盖：①主管持默认 `codex-privileged` 锁时，可信 repair 子任务可取得独立 token=1 lane；②第二个可信 repair 仍串行；③无签名/错 ticket/错 root 的 payload 不得进入独立 lane；④非 repair 角色不受影响；⑤锁释放、stale sweep、engine PID 绑定仍正确；⑥`node --check`、专项测试、`tests/role-boundary-routing.test.js`、`tests/stale-running-heartbeat.test.js`、lean profile 如实分账。
- 禁止重启/杀进程/删锁/删除或篡改历史队列；不得覆盖工作区已有无关 diff；不得调用本工单 `repair-ticket-complete`；高危/不可逆操作停下给主人确认；密钥不回显。

### 结构化验收表（主管初查）
| 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 |
|---|---|---|---|
| 设计对照 `memory/decisions.md:1375`：分离 repair-lead 与 repair 的特权执行槽并记录接管链；实际代码变更必须有独立 repair trace。 | 部分 | `memory/decisions.md:1375`；本工单“架构判断与执行范围” | 已完成设计对照和执行边界；待 repair 独立 trace、主管复核。 |
| 任务验收: 链路证据、需求传递判断、严重度、根因、处理/派工、复核验证、架构判断、知识沉淀和剩余风险写入工单; 结案生成固定 HTML 并取得飞书/元宵投递回执。 | 部分 | `projects/控制台/artifacts/engine-events.2026-07-16-0926-50889.jsonl:36177-36182,38871-38877`；本工单“维修主管初查” | 链路、传递判断、分级、根因和派工规格已完成；待执行、复核、结案与双通道回执。 |
| 视觉/UI证据: peekaboo截图路径 + Codex对照设计挑错报告 | 未完成 | `task-envelope:visual_acceptance` | `source=task_type`，任务类型强制视觉证据；待修复后对控制台运行态截图并出 Codex 对照报告。 |

## 结案协议
- 本维修请求单独建单,不同故障不得混入本单。
- 完成记录必须包含:链路证据、需求传递判断、严重度、根因、处理过程、复核验证、架构判断、知识沉淀候选、剩余风险 / 下一步。
- 使用 `repair-ticket-complete` 结案;系统生成固定 HTML,飞书发送摘要卡 + 附件,元宵同步报告文档。

### 完成记录 2026-07-17T05:06:24.383Z
- status: done
- report: projects/控制台/artifacts/repair-reports/repair-20260713-privileged-runner-singleflight.html
- report_sha256: 840e10326677df6701ccd722a2209d07252083f2d34cf621a060e636eca815a3

# 维修主管结案记录 · repair-20260713-privileged-runner-singleflight

## 链路证据

- 历史连续复现：`projects/控制台/artifacts/engine-events.2026-07-16-0926-50889.jsonl:36177-36182,36307,37565-37567` 记录 `repair-lead → repair/1888e352` enqueue/claim 后等待同一 `codex-privileged` 锁、主管手动接管，直到主管释放后 repair 才启动只读核验；`:38871-38877,38964,39167-39169` 对 `repair/fc4c9318` 再次出现同型链路。
- 当前正式派工：活动事件 `projects/控制台/artifacts/engine-events.jsonl:48731,48738-48741` 与 `projects/控制台/artifacts/queues/repair/running/d71e479c.json` 证明签名子单经 `trusted_repair_ticket_scope` 消费后仍被旧 runtime 的 runner singleflight 卡在 pre-engine、无 engine PID。
- 维修主管的完整执行 brief 保存在 `projects/控制台/artifacts/queues/repair/running/d71e479c.json`；独立 repair 手动接管结果见 `projects/控制台/artifacts/repair-executor-repair-20260713-privileged-runner-singleflight.md`，主管复核见 `projects/控制台/artifacts/repair-supervisor-repair-20260713-privileged-runner-singleflight.md`。

## 需求传递判断

- 未发现老板需求在 secretary/repair-lead/repair handoff 中遗漏、缩写、跳过或传错；目标文件、fail-closed、禁止范围、验收矩阵、高危确认和密钥红线均完整。
- 落差位于执行契约：父任务持有按 runnerType 唯一的锁，同时同步等待同 runnerType 的子 repair，导致职责分离无法落地。

## 严重度

- 严重。缺陷位于公共 queue/runner/特权执行层，跨多张工单和多个日期反复出现，造成结构性等待、手动接管、重复 no-op runner 消耗，并破坏独立维修 trace 与主管复核边界。

## 根因与处理

- 根因：`repair-lead` 与 `repair` 都使用 `codex-privileged`，旧 `runnerTypeLockFile()/acquireRunnerTypeLock()` 只按 runnerType 选择一个锁；engine capacity bypass 不能绕过该 runner-type singleflight。
- 处理：独立 repair executor 最小修改 `projects/控制台/ceo-worker.js`，只让权威消费 `trusted_repair_ticket_scope` 且 issuer/root/role 全一致的 repair 子任务使用固定 `delegated-repair` scope；其他 repair/privileged 任务沿用旧锁。新增 `projects/控制台/tests/privileged-runner-singleflight.test.js`，保留每 scope token=1 和 fail-closed。
- 未重启、未杀进程、未删锁、未改历史队列、未触碰无关脏改、未回显密钥。

## 复核验证

- 主管独立复跑：singleflight 专项 10 cases exit 0；role-boundary 39 cases exit 0；stale-running-heartbeat exit 0；两个 `node --check` 与 scoped diff check exit 0。
- Lean：32 个文件中 31 通过；唯一 `tests/hardening-hooks.test.js` exit 1 可单独稳定复现，且不引用本单 `ceo-worker.js`，按本单外既有基线红灯分账。
- Peekaboo 真图与 Codex 对照报告：`projects/控制台/artifacts/repair-visual-repair-20260713-privileged-runner-singleflight/peekaboo-repair-lead-0af586f8.png`、`peekaboo-repair-d71e479c.png`、`codex-visual-review.md`。

## 架构判断

- 系统性角色边界缺陷。采用受控独立逻辑槽，不做无界 privileged 并发；物理 runnerType、资源域、scope 签名、写范围审计、高危 human gate 和 fail-closed 均保留。
- 对照 `memory/decisions.md:1375`，现在实际代码变更有独立 repair executor trace，主管只做归因、派工、复核和关票。

## 知识沉淀候选

- 泛化判断：可泛化模式。
- 问题模式：父任务持有物理 runner 单飞锁，又同步等待同 runner 的受信子任务，形成 pre-engine 自锁。
- 根因：singleflight key 未表达验签后的逻辑执行 scope，锁模型与父子调度契约不匹配。
- 解法：由权威验签消费点产生内部能力，以 `runnerType + 固定 lockScope` 选锁；每 scope token=1；补伪 scope、角色不变、release/stale/PID 与双字段审计回归。
- 项目技术映射：`控制台 → Node.js 文件锁 + HMAC repair scope + 逻辑 lock scope → projects/控制台/ceo-worker.js`。

## 剩余风险 / 下一步

1. 磁盘代码已验证，但本单未获高危服务重启授权；常驻旧 worker 未被强制热切换。后续在安全空闲窗口自然 reload，或由主人批准受控重启后，用真实 `engine.runner_lock.acquired(lockScope=delegated-repair)` 做运行态回访。
2. `hardening-hooks` 基线红灯另开/归属独立工单，不在本单越界修复。
3. UI 缺少 pre-engine/engine-started 分态、父子 root 和 lockScope/wait reason；按视觉报告列为后续可观察性改进。

## 结构化验收表

| 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 |
|---|---|---|---|
| 设计对照 `memory/decisions.md:1375`：分离 repair-lead 与 repair 的特权执行槽并记录接管链；实际代码变更必须有独立 repair trace。 | 完成 | `memory/decisions.md:1375`; `projects/控制台/artifacts/repair-executor-repair-20260713-privileged-runner-singleflight.md`; `git diff -- projects/控制台/ceo-worker.js`; `projects/控制台/tests/privileged-runner-singleflight.test.js` | 仅可信 repair 使用固定 delegated token=1；主管独立复核。 |
| 任务验收: 链路证据、需求传递判断、严重度、根因、处理/派工、复核验证、架构判断、知识沉淀和剩余风险写入工单; 结案生成固定 HTML 并取得飞书/元宵投递回执。 | 完成 | `board/repair-tickets/repair-20260713-privileged-runner-singleflight.md`; `projects/控制台/artifacts/repair-supervisor-repair-20260713-privileged-runner-singleflight.md`; `projects/控制台/artifacts/repair-reports/repair-20260713-privileged-runner-singleflight.html`; `projects/控制台/artifacts/engine-events.jsonl` 的 `repair.ticket.notify_*` / `repair.report.yuanxiao_*`; `projects/控制台/artifacts/repair-reports/delivery-state.json` | 本 `repair-ticket-complete` 事务生成固定 HTML、写工单完成记录并保留双通道成功或失败回执；通道结果在命令返回后二次核验。 |
| 视觉/UI证据: peekaboo截图路径 + Codex对照设计挑错报告 | 完成 | `projects/控制台/artifacts/repair-visual-repair-20260713-privileged-runner-singleflight/peekaboo-repair-lead-0af586f8.png`; `projects/控制台/artifacts/repair-visual-repair-20260713-privileged-runner-singleflight/peekaboo-repair-d71e479c.png`; `projects/控制台/artifacts/repair-visual-repair-20260713-privileged-runner-singleflight/codex-visual-review.md` | `source=task_type`；真图证明父子派工、旧运行态等待和页面可用，报告明确不把截图冒充新 lane 热加载证明。 |

## 结案后回执复核（2026-07-17 13:06 +08:00）

- 固定报告：`projects/控制台/artifacts/repair-reports/repair-20260713-privileged-runner-singleflight.html`，SHA-256 `840e10326677df6701ccd722a2209d07252083f2d34cf621a060e636eca815a3`，10531 bytes，`missingSections=[]`；元数据见同目录 `.report.json`。
- 飞书：`projects/控制台/artifacts/engine-events.jsonl:49396` 为 `repair.ticket.notify_sent`，`channel=feishu`、`code=0`。
- 元宵：`projects/控制台/artifacts/engine-events.jsonl:49397` 为 `repair.report.yuanxiao_sent`，回执 `msg_1784264787193_8ac3f776`；持久状态见 `projects/控制台/artifacts/repair-reports/delivery-state.json:218-222`，`status=sent`、`http_code=200`。
- 结案握手返回 `proposal_only_feature_disabled`，未擅自启用需主人拍板的生产开关。正式子单 `repair/d71e479c` 在写入 mandatory read-only/no-op steer 时仍为 `pre_engine_waiting=true`、无 `engine_started_at`、无 engine PID；主管释放旧锁后只允许只读核验，禁止重复落码/派工/结案。
- 以上二次核验不改变固定 HTML；它补充的是结案事务执行后才能取得的真实投递回执和残余子单状态。
