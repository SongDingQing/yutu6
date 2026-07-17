---
name: console-loop-engineering
description: "Use when the Yutu6 console review-loop needs to reuse measured evaluation standards and prior iteration critiques for another generation, review, or done-gate pass."
---

# Loop Engineering Skill

This skill stores reusable generation improvements learned by the local review-loop.

## Current Evaluation Standards
- S1: 结构化验收表(执行 agent 必须逐行填
- S2: done gate 只认表
- S3: 留空/无证据/证据对不上=打回)
- S4: 模板: templates/structured-acceptance-table
- S5: md
- S6: | 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 |
- S7: |---|---|---|---|
- S8: | 任务验收: 在 控制台 项目 scope 内跑 review-loop | 未完成 |  |  |

<!-- loop-engineering:cr-1783677272354-0ec44630:1 -->
## Iteration 1 Improvement

- Task: cr-1783677272354-0ec44630
- Standard focus: 结构化验收表(执行 agent 必须逐行填 | done gate 只认表 | 留空/无证据/证据对不上=打回) | 模板: templates/structured-acceptance-table | md | | 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 | | |---|---|---|---| | | 任务验收: 在 控制台 项目 scope 内跑 review-loop | 未完成 |  |  |
- Critique: 打回：迁移、幂等、有向查询、关闭开关与范围门禁均已复核通过，但真实 memory 自动写图链路存在格式不兼容。实际 memory/experience.md:3 使用“> 更新于 …”，适配器 projects/控制台/lesson-graph-adapter.js:279-282 只允许无引用符的“更新于 …”；专项测试 tests/lesson-graph-canary.test.js:127,142 又使用了非真实格式。按真实格式执行“更新日期+追加教训”的最小复现得到 memory-source-not-append-only，因此 memory-officer 按规范更新时间时不会自动入图。该故障为失败关闭且不损坏 memory，故 severity=medium；需兼容引用式日期行并补真实格式回归后再审。; 真实 memory/experience.md 的引用式日期更新会被 append-only 守卫误拒，导致核心自动入图链路在正常记忆官写入时失败。; 专项测试使用非真实日期格式，形成测试绿但实链路不可用的覆盖盲区。; 将日期行判断兼容实际格式，例如同时接受 /^\s*>?\s*更新于\s+/，仍只放行该日期行变化。; 把 lesson-graph-canary fixture 改为真实的“# 经验库…\n> 更新于 …”格式，并新增日期更新后追加根因/做法可成功入图、其他旧内容改写仍拒绝的正反回归。; 修复后复跑专项、默认查询、并发幂等及只读活库检查，再更新当前验收归档和 status。
- Method change: Before producing the next candidate, explicitly check the measurable standards, address the critique, and include hard evidence for every claimed improvement.

<!-- loop-engineering:cr-1784014494373-d6e1b61a:1 -->
## Iteration 1 Improvement

- Task: cr-1784014494373-d6e1b61a
- Standard focus: 结构化验收表(执行 agent 必须逐行填 | done gate 只认表 | 留空/无证据/证据对不上=打回) | 模板: templates/structured-acceptance-table | md | | 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 | | |---|---|---|---| | | 任务验收: 在 控制台 项目 scope 内跑 review-loop
- Critique: 打回：false-done 由 6/6 降至 0/6、正常样本保持 6/6、token 为 0、Reflexion 自评被拒、生产开关关闭等结论均可复现；但延迟门使用了被 canary 预处理污染的 baseline。canary-runner.js:97-126 对 baseline 和 canary 都执行源哈希与完整 extractFeatures，因而 result.json:115-116 的约 1.00 比值不是声明的 status-only baseline。按同一 12 条源记录补跑 5 批、每批 101 轮交替测量，真实 status-only 对 canary 的中位数比为 1.448-1.480、P95 比为 1.379-1.424，全部超过冻结门槛 1.20。另 samples.json 未保存预期 source_sha256，validateFrozenInputs 也只检查数量、标签和 ID；12 个源文件变化不会 fail-closed。fixture 的 supervisor review 又由 mock-runner.js:121-142 硬编码 pass=true，相关测试没有捕获上述问题。因此不能认定 token/延迟可接受，也不能给出 expansion proposal；生产保持关闭使影响受控。返工需使用真实 status-only 路径重测、冻结并校验 manifest 与每个源文件哈希、增加漂移和真实 baseline 回归，再重新运行主管复审。; S1-S8 只覆盖验收表机械格式，未覆盖 CEO brief 中 false-done、真实 baseline 延迟、冻结样本内容和 Reflexion 外部验证语义，因此即使得分 1.0 也不能推出目标完成。; baseline 与 canary 共用 canary 特征提取和哈希路径，1.20 延迟门结果失真。; manifest 及 12 个源记录没有运行前预期哈希，所谓冻结样本无法抵御源内容变化。; scoped fixture 的 review 由 mock 硬编码通过，没有独立重算核心指标。; 把 baseline 拆为真实 status-only 路径，并与 canary 以相同轮次、交替顺序、独立计时重新测 median/P95；任一比值超过 1.20 即输出 fail_closed_rollback_baseline。; 在冻结配置中保存 samples.json 预期哈希和每条 source_sha256，运行前逐一比较；新增 manifest/source 漂移必失败测试。; 让 fixture review 从 result、config、samples 和源记录独立重算质量与预算门，禁止直接硬编码 pass/score。; 将 CEO 六项
- Method change: Before producing the next candidate, explicitly check the measurable standards, address the critique, and include hard evidence for every claimed improvement.

<!-- loop-engineering:cr-1784171154971-19856f34:1 -->
## Iteration 1 Improvement

- Task: cr-1784171154971-19856f34
- Standard focus: 结构化验收表(执行 agent 必须逐行填 | done gate 只认表 | 留空/无证据/证据对不上=打回) | 模板: templates/structured-acceptance-table | md | | 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 | | |---|---|---|---| | | 任务验收: 同 ticket/source incident 的 queued 重复 repair 被安全取消且留审计
- Critique: 打回。按 console-loop-engineering 的逐行证据门复核后，发现两个硬阻断：completion lease 期间新进入的同源 repair 可在结案后继续 queued 且无审计；主人决策卡的 decisionSecret 会经公告板 API/CLI 返回。另有缺失 engine PID 仍可确认的证明缺口。现有专项、上一轮反例及相邻回归均实跑通过，但未覆盖这些反例。生产开关仍未配置、未启用。; 没有覆盖 preflight 扫描与最终 markClosed 之间以及 closed 之后的 late repair enqueue。; 公告板 API/CLI 未剥离 decisionSecret，安全验收证据只检查了事件日志。; running 子任务缺失 engine PID 时未失败关闭，终止证明不充分。; 审计测试只检查字段键存在，没有验证逃逸子任务和关键字段的非空/语义正确性。; 建立 durable enqueue fence，或在 markClosed 同一锁/事务边界最终复扫同源 repair；closed 状态也必须拒绝或取消后到任务。; 对 GET /api/bulletin、bulletin-list 及其他 cards 返回路径统一做 secret/token 脱敏并增加正反回归。; running 子任务确认必须要求可核 engine identity/PID；缺失证据时失败关闭。; 补 preflight→enqueue→markClosed、closed→late enqueue→repeat、secret redaction、missing-PID confirmation 回归后重填验收表。
- Method change: Before producing the next candidate, explicitly check the measurable standards, address the critique, and include hard evidence for every claimed improvement.

<!-- loop-engineering:cr-1784171154971-19856f34:2 -->
## Iteration 2 Improvement

- Task: cr-1784171154971-19856f34
- Standard focus: 结构化验收表(执行 agent 必须逐行填 | done gate 只认表 | 留空/无证据/证据对不上=打回) | 模板: templates/structured-acceptance-table | md | | 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 | | |---|---|---|---| | | 任务验收: 同 ticket/source incident 的 queued 重复 repair 被安全取消且留审计
- Critique: 打回。上一轮的 durable fence、公告板脱敏和 missing PID 三项阻断已转绿，但确定性反例证明最终 markClosed 复扫发生在结案副作用之后：late running child 虽使握手回到 closing_pending_child，工单却已写成 done，并已生成报告和发出 completed 事件；确认后重试又重复生成两类事件。生产开关仍未配置、未启用，因此严重度定为 medium。; 最终 child 复扫晚于 ticket done、报告、completed 事件、公告卡移除和下游派工等结案副作用。; late running 阻断后工单仍为 done；确认重试会重复生成报告和 completed 事件。; 现有 16 场景缺少报告阶段 late running/queued→running 的确定性回归。; S1-S8 主要衡量验收表格式，0.875 分不能替代 CEO brief 的语义正确性门禁。; 把 final rescan/close permit 移到任何不可逆结案副作用之前，或使用可提交/回滚的事务式 outbox。; late running 被发现时必须返回 blocked、保持工单 closing_pending_child，且不得生成报告、完成事件、通知、memory review 或移除公告卡。; 新增报告阶段注入 late running 的回归，断言首次零结案副作用、确认重试后报告和 completed 事件各仅一次。; 修复后重填结构化验收表第 2、3、5、7、10 行，并继续保持生产开关关闭。
- Method change: Before producing the next candidate, explicitly check the measurable standards, address the critique, and include hard evidence for every claimed improvement.

<!-- loop-engineering:cr-1784174926627-19856f34:1 -->
## Iteration 1 Improvement

- Task: cr-1784174926627-19856f34
- Standard focus: 结构化验收表(执行 agent 必须逐行填 | done gate 只认表 | 留空/无证据/证据对不上=打回) | 模板: templates/structured-acceptance-table | md | | 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 | | |---|---|---|---| | | 任务验收: 同 ticket/source incident 的 queued 重复 repair 被安全取消且留审计
- Critique: 打回。现有 19 场景专项、历史反例、相邻回归、语法检查和生产关闭门均通过，但新增两条确定性反例击中核心语义：其一，late running 在 completed_event 后出现时，工单虽回到 closing_pending_child，确认前却已发出 report/completed 事件；其二，主人批准强制收口后，queued 取消若未落终态，握手仍会 forced_closed，而子任务仍留在 queued、未转只读。生产开关未配置且未启用，故严重度为 medium。全量测试另有两个已记录的范围外失败，仅列剩余风险。; per-step rescan 位于副作用之后；late running 若在 ticket_done/completed_event 等后期步骤出现，确认前已产生公开完成事件。; forced 模式绕过所有 waiting child；queued 取消未成功时仍能 closed，该子任务没有被取消、steer 或转只读。; 正式测试只在 report_files 后注入 late child；八个 failpoint 测的是异常重试，不是每个步骤后的 late-child 竞态。; 把 ticket done、report/completed 事件及其他公开结案副作用延迟到最终 child eligibility 已锁定后的提交段；若无法与所有 repair 入队原子化，应禁止项目生产路径绕过 fence，并让发现任何 late child 的路径保持零完成事件。; forced 收口后重新读取 queued/running 状态；queued 必须确认进入 canceled 终态，若仍 active 则继续 closing_pending_child/owner warning，禁止 closed。; 为 report_event、ticket_done、completed_event、bulletins_removed、memory_review、owner_notify、yuanxiao_delivery 每个步骤后分别注入 late queued/running，并断言确认前 ticket 非 done、report/completed 事件为 0。; 新增主人批准场景下 Q.cancel 未落终态、queued→running、重复强制调用的故障测试，断言无 active child 可在 closed 后继续执行。
- Method change: Before producing the next candidate, explicitly check the measurable standards, address the critique, and include hard evidence for every claimed improvement.

<!-- loop-engineering:cr-1784179078109-5d6a4273:1 -->
## Iteration 1 Improvement

- Task: cr-1784179078109-5d6a4273
- Standard focus: 结构化验收表(执行 agent 必须逐行填 | done gate 只认表 | 留空/无证据/证据对不上=打回) | 模板: templates/structured-acceptance-table | md | | 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 | | |---|---|---|---| | | 任务验收: trace 完成时
- Critique: 打回。实现的格式、专项测试和常规 observability_warning→audit-gate 路径均通过，但三个核心反例未被现有测试覆盖：第一，完整性检查没有执行统一 JSON Schema，只手工检查部分字段；错误的 manifest.schema，以及缺少 schema_ref、generated_at、exit_code、target_summary、limits 等必填字段的过程摘要可零告警通过。第二，脱敏器会原样保留 Authorization Basic 凭据和含 GitHub token 的 URL，可能进入 safe_output_summary，违反不泄露敏感内容的硬要求。第三，integrity hook 抛错后虽记录 hook_error，但 audit-gate 仍允许该 chain 得到 pass，形成防御缺口。专项与相邻测试均 exit 0；全量测试 exit 1，复现已记录的两个范围外失败。; S1-S8 只衡量结构化验收表格式，无法证明完整性门、脱敏和 audit-gate 的语义正确性。; 完整性检查未执行 schema 的完整 required、const、additionalProperties 和条件约束。; 常见 Basic 与 URL userinfo 凭据未脱敏。; hook_error 虽可审计，但仍可获得质量审计 pass。; 使用真实 JSON Schema validator，或等价完整校验全部 required/const/conditional 字段，并要求 manifest.schema 精确等于 yutu6-interaction-trace@1；新增错误 schema、缺 schema_ref/generated_at/limits/exit_code/target_summary 的失败回归。; 扩展脱敏覆盖 Authorization Basic、URL userinfo、GitHub/GitLab 等常见 token 形态，并新增 stderr 安全摘要正反回归；保留现有长度上限。; 将 hook_error 转为稳定 observability_warning，或让 audit-gate 独立把任一 hook_error 视为 no-pass；新增 completed + hook_error + verdict=pass 必须拒绝的 ingest 回归。; 修复后重跑四个专项/相邻测试、确定性反例及全量测试，再重新填写受影响的第 1、4、6、7、10 行验收结论。
- Method change: Before producing the next candidate, explicitly check the measurable standards, address the critique, and include hard evidence for every claimed improvement.

<!-- loop-engineering:cr-1784183431781-5d6a4273:1 -->
## Iteration 1 Improvement

- Task: cr-1784183431781-5d6a4273
- Standard focus: 结构化验收表(执行 agent 必须逐行填 | done gate 只认表 | 留空/无证据/证据对不上=打回) | 模板: templates/structured-acceptance-table | md | | 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 | | |---|---|---|---| | | 任务验收: trace 完成时
- Critique: 打回。四个专项/相邻测试均实跑 exit 0，完整性告警和 audit-gate 也正确工作；但 `compact(..., 2400)` 截断时额外加入标记，实际长度达到 2419。当前 implement trace 自身已产生 `process_summary_schema_max_length`、`observability_status=warning`，且 audit-gate 明确拒绝 pass，直接推翻验收表第 6、7、10 行的完成结论。需把截断标记计入总长度预算，并增加“完整日志行、stderr 长度介于 2400 与 32768 之间”的回归。全量 `node tests/run.js` 实跑 exit 1，仅复现既有 `hardening-hooks.test.js:142` 与 `ceo-serial-lock.test.js:513`，只作为范围外诊断。; S1-S8 主要衡量验收表机械格式，不能替代长度限制和统一 schema 的语义验证。; compact 截断标记未计入 max 参数，导致任意长于上限的内容超出 schema 19 字符。; 专项测试只对较短 stderr 断言 <=2400，边界用例没有断言最终摘要长度。; 当前实现任务自身已进入 observability_warning，按新 audit-gate 不可能获得 pass。; 修改 compact，使前段、后段和截断标记总长度严格不超过 max。; 新增 stderr 为多行完整内容、长度在 2401..32768 范围内的回归，断言 safe_output_summary.length <= 2400 且 manifest 无 max_length warning。; 保留现有跨 32768 截断边界凭据回归，同时断言该用例最终摘要也不超长。; 修复后重跑四个专项/相邻测试，并更新验收表第 6、7、10 行及 status；全量两个既有红灯继续只作为范围外风险。
- Method change: Before producing the next candidate, explicitly check the measurable standards, address the critique, and include hard evidence for every claimed improvement.

<!-- loop-engineering:cr-1784185100293-5d6a4273:1 -->
## Iteration 1 Improvement

- Task: cr-1784185100293-5d6a4273
- Standard focus: 结构化验收表(执行 agent 必须逐行填 | done gate 只认表 | 留空/无证据/证据对不上=打回) | 模板: templates/structured-acceptance-table | md | | 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 | | |---|---|---|---| | | 任务验收: trace 完成时
- Critique: 打回。专项及相邻回归均实跑 exit 0，全量测试也仅复现已记录的两个范围外失败；但确定性反例证明 read_or_analysis 类型的 process-summary 在 target_summary 为整值占位词“声明”时获得零 observability_warning，随后质量审计仍可给 pass。原因是 schema 的反占位约束和 inspectTraceIntegrity 的 meaningfulText 检查都只对 requires_structured_process_summary=true 生效，直接推翻验收第 1、3、10 行。另有同域风险：当前任务 prompt/验收使用规格指纹 a787cdfb…，实际 handoff meta 与 interaction manifest 却记录 2d87e0e7…，虽不影响 task_id/agent_id 最低关联要求，但削弱规格追溯可靠性。; read_or_analysis 类型的 target_summary 整值占位词不触发 schema 或 meaningfulText 告警，质量审计可继续给 pass。; 现有测试只覆盖写任务占位摘要，未覆盖只读/分析任务的同族反例。; 当前 task prompt/验收与 handoff meta、interaction manifest 的 spec_fingerprint 不一致。; acceptance.md 与 status.md 把存在确定性反例的规格声明为全部完成。; 把 target_summary 的非空、非整值占位约束移到所有 classification 共用的 schema 层，或在 inspectTraceIntegrity 中无条件执行 meaningfulText；仍保持“声明文件已更新”等有效句子通过。; 新增 read_or_analysis 正反回归：target_summary=“声明”必须产生 observability_warning，而“声明文件已更新”必须保持 observability_status=ok；再验证该 warning 会阻止 audit pass。; 修正 handoff meta 与 manifest 的 spec_fingerprint 来源，增加 task envelope、meta、manifest 三者一致性回归。; 修复后重跑专项、相邻、全量诊断，并把 acceptance.md 第 1、3、10 行及 projects/控制台/status.md 更新为与真实结果一致。
- Method change: Before producing the next candidate, explicitly check the measurable standards, address the critique, and include hard evidence for every claimed improvement.

<!-- loop-engineering:cr-1784191963139-2d9b62e9:1 -->
## Iteration 1 Improvement

- Task: cr-1784191963139-2d9b62e9
- Standard focus: 每份独立复核记录必须绑定独立 taskId/traceId、角色、runner、显式 prompt hash、输出 hash、时间窗及终态事件 | 文件内自称 reviewer_task_path 不构成独立证据 | 任一必需 receipt 缺失、无效或无法追溯时自动判为 warning/blocked | 任务事件日志可追踪且产物路径清楚 | 视觉验收为 not_applicable，无需截图。 | 实现阶段完成 控制台 项目 CEO brief 的交付、逐项证据和 projects/控制台/status.md 更新（review 由系统随后单独执行，不要求 implement 预先声明 review 已完成）。
- Critique: 打回：正常双角色链路、文件自称拒绝、事件追踪及专项/相邻回归均已核实，但存在两个核心语义缺口。其一，projects/控制台/independent-role-receipts.js:541 仅凭 provenancePolicy 缺失就把 state 降级为 legacy_warning；确定性临时目录反例中，删除新 state 的该字段后，无 provenance 的 receipt 仍以 ok=true、gateStatus=warning 被父链接受，provenance_count=0，与 status.md:8 所称“新 state 失败关闭、篡改 blocked”不符。其二，normalizedRequirements 接受单一 quality_ops 角色，未落实 brief 中多角色独立复核的最低角色数语义。lean 诊断仍仅有既有范围外 hardening-hooks 红灯，不是本次打回原因。; 新 state 与真实存量 state 仅靠可删除的 provenancePolicy 字段区分，缺少可信 cutover/schema 边界。; requiredIndependentReceipts 未要求至少两个不同角色。; 57 场景没有覆盖新 state 删除 provenancePolicy、无 provenance 仍被接受，以及单角色独立链反例。; 升级 state schema 或增加不可歧义的迁移/cutover 依据；新建时间晚于 cutover 却缺 provenancePolicy 时必须 blocked，不能自动 legacy_warning。; 多角色独立复核模式至少要求两个不同允许角色；如需单角色审查，应使用显式非独立模式。; 新增三条回归：新 state 删除 policy 必须 blocked；单角色独立链必须拒绝；真实 pre-cutover state 仍保持 legacy warning。
- Method change: Before producing the next candidate, explicitly check the measurable standards, address the critique, and include hard evidence for every claimed improvement.

<!-- loop-engineering:cr-1784199716042-51a76d1d:1 -->
## Iteration 1 Improvement

- Task: cr-1784199716042-51a76d1d
- Standard focus: 链终态仅由最后 task.done/task.failed 与 queue.completed.ok 归并，中途 runner 失败只记过程 | result.done=false、implementation.done=false、review.pass=false 或结构化验收部分/未完成时不得进入 done | 兼容 result/implementation/review 三类 schema，灰度期记录冲突，获批后再 fail-closed，并保留人工覆盖入口 | IT failover、repair done=false、fallback-success 三类回归全部通过。 | 实现阶段完成 控制台 项目 CEO brief 的交付、逐项证据和 projects/控制台/status.md 更新（review 由系统随后单独执行，不要求 implement 预先声明 review 已完成）。 | 视觉/UI证据: not_applicable
- Critique: 打回：终态 reducer、direct false-done 硬门、shadow 冲突记录及三类回归均已核实；但人工覆盖没有接入真实队列链路。projects/控制台/ceo-worker.js 的 makeSpec 不透传 manual_completion_override，只读反例得到 payload_had_override=true、spec_has_override=false。因此第3项只能判部分，第5项不能认定 CEO brief 全部交付。lean 的唯一红灯仍是已记录的范围外 hardening-hooks fixture，不是本次打回原因。; 生产队列的 makeSpec 未接收或透传 manual_completion_override，人工覆盖只能绕过正常队列直接调用 engine-runner/runFlow。; 现有测试只验证 runFlow 参数层和 runner 后加伪造，没有覆盖 queue payload→ceo-worker.makeSpec→engine-runner→edge.take 的真实入口。; projects/控制台/status.md:9 将参数层能力写成了已保留的生产人工覆盖入口。; 建立可信 owner-decision 入口：在 taskId 可确定后生成并持久化回执，或将回执绑定 queueAgent/queueId，再由 ceo-worker.makeSpec 校验来源并透传。; 新增真实队列链回归：合法主人回执可覆盖；普通 payload 自称 owner、taskId 不匹配及 runner 后加覆盖均必须失败并留审计。; 修复后重跑 agent-once-self-report、queue/ceo-worker 入口专项、gate-policy、lean，并更新 status.md 与结构化验收表第3、5行。
- Method change: Before producing the next candidate, explicitly check the measurable standards, address the critique, and include hard evidence for every claimed improvement.

<!-- loop-engineering:cr-1784207363486-17f56b05:1 -->
## Iteration 1 Improvement

- Task: cr-1784207363486-17f56b05
- Standard focus: 稳定背景按有标题边界的完整块去重且仅保留一份 | 各角色与 fallback 复用同一只读 context_ref | 任务目标及角色专属语义完整保留 | 429/transport 回退仅追加失败原因与 runner 差异，不重复拼接完整背景 | 须证明语义等价并降低输入 token，无法确认等价的块不得去重。 | 实现阶段完成 控制台 项目 CEO brief 的交付、逐项证据和 projects/控制台/status.md 更新（review 由系统随后单独执行，不要求 implement 预先声明 review 已完成）。
- Critique: 打回。完整标题块哈希去重、角色专属指令和薄回退结构基本落地，专项及相邻回归均通过；但生产中的 DeepSeek/GLM 主 runner 是无本地文件读取能力的 openai_http。确定性请求链复核证明其只收到 context_ref 路径，未收到路径指向的稳定背景，因此所谓 token 降幅实际包含内容丢失，不能证明语义等价。另一个确定性反例证明 redactReason 会原样保留 URL userinfo 凭据，并通过 fallback delta/event detail 回显，违反密钥不回显红线。需让每个候选具备可验证的 context_ref 解析能力，不能解析时回退完整信封；以真实 runner 请求/usage 证明等价和 token 收益，并复用统一密钥脱敏器后再审。; openai_http 只把生成的 prompt 作为 user message 发送，没有读取或物化 context_ref；DeepSeek/GLM 直连因此缺失稳定背景。; 79.5999%/88.2018% 只计算删除引用内容后的本地 prompt 字符估算，没有计入引用解析，也没有供应商 usage 或缓存命中证据。; 现有专项只断言 goal 含路径且不含背景，没有捕获各生产 runner 的最终请求体或证明远端模型能解析路径。; redactReason 未覆盖 URL userinfo 等凭据形态，失败原因可能进入 fallback 信封和事件日志。; status.md 和结构化验收产物把上述未闭合项声明为 done。; 增加 runner capability：只有 primary 与全部 fallback 都能解析并校验 context_ref 时才启用；否则失败关闭到旧全文信封。; 为 openai_http 建立真实可消费的受控引用协议或服务端物化机制，并对 DeepSeek、GLM、Claude、Codex 及 fallback 分别捕获最终请求验证。; 用供应商返回的 prompt_tokens/cached_tokens 或等价账单口径量化收益；本地字符估算只能作为辅助指标。; 复用项目统一密钥脱敏器，覆盖 URL userinfo、查询参数、常见平台 token，并增加信封及事件日志正反回归。; 修复后更新专项测试、structured-acceptance.md 和 projects/控制台/status.md，再重跑 lean。
- Method change: Before producing the next candidate, explicitly check the measurable standards, address the critique, and include hard evidence for every claimed improvement.

<!-- loop-engineering:cr-1784207363486-17f56b05:2 -->
## Iteration 2 Improvement

- Task: cr-1784207363486-17f56b05
- Standard focus: 稳定背景按有标题边界的完整块去重且仅保留一份 | 各角色与 fallback 复用同一只读 context_ref | 任务目标及角色专属语义完整保留 | 429/transport 回退仅追加失败原因与 runner 差异，不重复拼接完整背景 | 须证明语义等价并降低输入 token，无法确认等价的块不得去重。 | 实现阶段完成 控制台 项目 CEO brief 的交付、逐项证据和 projects/控制台/status.md 更新（review 由系统随后单独执行，不要求 implement 预先声明 review 已完成）。
- Critique: 打回。标题块哈希去重、同一只读 context_ref 的调用前物化、角色语义保留、fallback 不重复背景及真实供应商 prompt_tokens 降幅均已复核成立；但全候选失败时 board-failover-runner.js:247 将最后一个原始错误直接返回。确定性反例证明：fallback goal 已脱敏，最终 fail 仍包含构造凭据；该值随后会被 board-review.js:725-750 写入董事冷却状态和事件，违反密钥不回显红线。现有专项仅覆盖 primary 泄漏后 fallback 成功，未覆盖最后候选也失败。另有 shared/engine/cli-runner.js 的跨项目共享引擎改动，原任务边界未明确授权。lean 的唯一既有红灯仅列剩余风险，不是本次打回依据。; 最后一个候选失败时原始 lastFail 未脱敏，随后可进入 result、董事冷却状态及事件日志。; 专项只覆盖中途失败后 fallback 成功，没有覆盖 context_ref 已物化且所有候选均失败的终态安全路径。; shared/engine/cli-runner.js 属共享引擎，原项目边界未明确授权该跨范围修改。; 保留原始错误仅供当前调用栈分类；任何返回值、冷却状态和事件写入前统一调用 InteractionTrace.redact，并让 markDirectorCooldown 再做一层防御性脱敏。; 新增 primary 与最终 fallback 都以429/transport失败的 context_ref 回归，断言背景仍只有一份，fallback goal、最终 fail、node.absent、cooldown 文件和事件均不含 URL userinfo、查询 token、Basic/Bearer 构造值。; 将 Board 专属字段过滤和 usage 适配收回项目 wrapper，或先取得共享引擎修改授权并补 shared/engine 的独立回归；修复后重填 structured-acceptance.md 与 status.md。
- Method change: Before producing the next candidate, explicitly check the measurable standards, address the critique, and include hard evidence for every claimed improvement.

<!-- loop-engineering:cr-1784230338799-61b6adf8:1 -->
## Iteration 1 Improvement

- Task: cr-1784230338799-61b6adf8
- Standard focus: 每个 runner 均生成统一合同的脱敏 process-summary，无法生成时明确标记 unavailable | process-summary 仅记录白名单允许的工具名或命令名 | process-summary 记录已执行动作的退出码 | process-summary 记录受影响文件 | process-summary 记录可复核的证据引用 | 质量运营 ingest 等关键动作分别生成独立 receipt
- Critique: 打回。常规专项、相邻回归、15 个配置 runner、三类质量运营 receipt、安全字段和默认关闭门均已核实；但确定性边界反例证明 compactToLimit 会删除全部 evidence_refs 后仍输出 availability=available，违反自身 JSON Schema，并按最小化 JSON 而非最终落盘文本计长，导致实际文件达到 8415/8424 字符、超过 8192 上限。另有不存在的仓库内路径可被当作 available evidence，contractShapeValid 仍返回 true。生产配置保持关闭，因此影响受控。; 长列表压缩后产生 schema-invalid 的 available process-summary，没有转为 unavailable。; 证据引用只校验路径形态，不校验目标存在，无法保证可复核。; 长度预算使用最小化 JSON，未覆盖实际 pretty-printed 落盘长度。; 现有专项未执行完整 JSON Schema，只检查 $id/additionalProperties 和不完整的 contractShapeValid。; 按最终落盘字符串长度执行压缩和上限检查。; 压缩后重新执行完整合同校验；available 丢失最后一条证据时转 unavailable/summary_length_limit。; 校验 evidence_refs 的基础文件真实存在，并增加带行号引用检查。; 为 process-summary 和 critical receipt 增加长列表、空证据、幽灵路径及真实 schema 正反回归。
- Method change: Before producing the next candidate, explicitly check the measurable standards, address the critique, and include hard evidence for every claimed improvement.

<!-- loop-engineering:cr-1784236377579-a575d518:1 -->
## Iteration 1 Improvement

- Task: cr-1784236377579-a575d518
- Standard focus: 格式合法且 review.pass=true 的审查结果进入 approve 放行路由。 | review.pass=false 且全部硬证据条件成立的审查结果进入 rework 路由。 | rework 路由的目标阶段标识明确为 implement，并由集成测试直接断言。 | 合法负向审查的每个 issue 均为非空内容。 | 合法负向审查的 severity 属于合同规定的有效枚举。 | 合法负向审查的 evidence 引用可解析为允许范围内的有效证据。
- Critique: 打回。专项及相邻回归均实跑 exit 0，approve、合法负向 rework、implement 目标、格式损坏 hard_block、verdict 冲突 manual_review 等主路径成立；但伪造负向审查的语义一致性仍未闭合。确定性 acceptance-contract@1 反例返回 {route:"rework",ok:true,review_pass:false,row_statuses:["完成"]}，说明门禁没有要求 pass=false 至少对应一项“部分/未完成”，也没有把全完成验收表视为方向冲突。生产合同开关仍未启用，当前影响受控，故 severity=medium。lean 复跑为 27/28，唯一非零项仍是 tests/hardening-hooks.test.js:142 的既有脏工作树 fixture，仅列剩余风险。; pass=false 未要求至少一个非视觉 requiredRow 为“部分”或“未完成”，全完成验收表仍可自动 rework。; 通用核实 notes 可替代真实 issue，不能证明存在具体返工问题。; 现有 21 场景没有覆盖 pass=false + verdict=fail + requiredRows 全部完成的伪造负向对照夹具。; 在自动 rework 前要求至少一个非视觉验收行状态为“部分”或“未完成”；若所有行均完成，则进入 manual_review，不得进入 implement。; 将 issue 来源限制为显式非空 issues、critique 或 evaluation.gaps/improvement_points；仅有通用 notes 时 hard_block。; 新增 acceptance-contract@1 集成夹具，直接断言全完成负向审查不得 rework，并补 runFlow 断言不存在 review→implement edge。
- Method change: Before producing the next candidate, explicitly check the measurable standards, address the critique, and include hard evidence for every claimed improvement.

<!-- loop-engineering:cr-1784236377579-a575d518:2 -->
## Iteration 2 Improvement

- Task: cr-1784236377579-a575d518
- Standard focus: 格式合法且 review.pass=true 的审查结果进入 approve 放行路由。 | review.pass=false 且全部硬证据条件成立的审查结果进入 rework 路由。 | rework 路由的目标阶段标识明确为 implement，并由集成测试直接断言。 | 合法负向审查的每个 issue 均为非空内容。 | 合法负向审查的 severity 属于合同规定的有效枚举。 | 合法负向审查的 evidence 引用可解析为允许范围内的有效证据。
- Critique: 打回。第二轮已关闭“requiredRows 全部完成仍 rework”和“notes-only 充当 issue”两项上一轮漏洞，专项 24 场景及相邻回归均实跑 exit 0；但 brief 明确要求验证 issue 证据，当前 reviewIssueContract 只验证非空。独立反例得到 issue_present_in_evidence=false 且 route=rework，伪造负向仍可沿 shared/routing/flows/review-loop.yaml:25 进入 implement。生产 feature flag 与主人批准均未启用，当前影响受控，故 severity=medium。lean 为 27/28，唯一非零仍是既有 tests/hardening-hooks.test.js:142，只列剩余风险。; reviewIssueContract 未要求每个 issue 绑定可解析证据或对应的部分/未完成 acceptance_id。; validateReviewHardEvidence 只能证明证据路径和验收行存在，不能证明证据支持具体 issue。; 24 场景专项缺少 unsupported-issue-evidence 的分类与真实 runFlow 反例。; 为自动 rework 增加结构化 issue_evidence 映射：每个 issue 至少绑定一个 acceptance_id 和可解析 path:line，且至少一个 issue 对应“部分/未完成”非视觉验收行。; 无法证明 issue 与证据、未完成行一致时进入 hard_block 或 manual_review，不得返回 rework。; 新增正反双向夹具：证据明确支持 issue 时 rework→implement；issue sentinel 不存在于证据时不得 rework，并断言没有 review→implement edge。; 修复后同步 README、test-evidence、structured-acceptance.md 与 projects/控制台/status.md。
- Method change: Before producing the next candidate, explicitly check the measurable standards, address the critique, and include hard evidence for every claimed improvement.
