# 维修工单 repair-20260713-ticket-id-unicode-slug · repair-ticket-add 中文标题自动 ID 与安全约束冲突

- status: done
- created_at: 2026-07-13T10:51:45.534Z
- source: 秘书
- priority: normal

## 问题
不传 --id 且标题含中文时，slugText 保留 Unicode，但 safeTicketId/repairTicketPath 仅接受 ASCII，导致 repair-ticket-add 在创建文件前报 bad repair ticket id。当前工单新建架构评估单时已真实复现；显式 ASCII --id 可绕过。

## 事件证据 / 路径
- projects/控制台/secretary-tools.js:376-383,1264-1271；本次命令 repair-ticket-add --title 含中文且无 --id exit 1: bad repair ticket id。

## 期望结果
最小统一 ID 契约：自动 ID 必须始终满足 safeTicketId，可采用稳定 ASCII slug/hash；补中文、英文、符号和空标题回归。保持现有显式合法 ID、路径穿越拒绝和幂等语义。

## 红线
- 高危/不可逆操作必须先给主人确认
- 密钥/token/cookie/私钥不回显、不写日志
- 不破现有功能; 能验证就写验证结果

## 维修部门消费方式(v3 主管先行)
`repair-lead` 是维修主管队列(Codex 特权),所有工单默认先进主管:链路核查、根因分析、严重度分级、必要时分派 `repair` Codex 维修员执行。紧急时仍可由独立 Codex 特权会话手动接管。推荐手动命令:

```bash
codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -C /Users/yutu6/玉兔6工作区 "$(cat /Users/yutu6/玉兔6工作区/board/repair-tickets/repair-20260713-ticket-id-unicode-slug.md)"
```

## 处理结果
- status: done

## 维修主管初查（2026-07-17）

### 链路证据
- 上游发现：上一张维修工单 `auto-20260713103533-5d8f47806172d340` 的 `repair-lead` 在收尾时调用无显式 `--id` 的 `repair-ticket-add` 创建“repair-lead→repair 特权 runner 单飞互锁”独立工单，期望返回新工单文件；实际在 `projects/控制台/artifacts/engine-runs/cr-1783939042216-acea4f9a/execute-1-fo1/process.log:7618-7620` 返回 `bad repair ticket id`。同一执行者识别为独立缺陷后，改用显式 ASCII ID 创建本工单，命令及成功结果见同一日志 `:7886-7908`；原维修单把本单列为独立后续，见 `board/repair-tickets/auto-20260713103533-5d8f47806172d340.md:113-120`。
- 当前消费：公告板在 `projects/控制台/artifacts/engine-events.jsonl:45757-45758` 把本单完整派给 `repair-lead/5f39db71`；`projects/控制台/artifacts/engine-runs/cr-1784258612129-5f39db71/task.md` 保留目标、红线、结构化验收与视觉分类；当前队列无 steer，见 `projects/控制台/artifacts/queues/repair-lead/running/5f39db71.json`。
- 期望/实际：上游期望用标题自动生成安全工单 ID 并创建独立维修单；实际中文标题经 `slugText` 保留 Unicode，再被 `repairTicketPath` 的 ASCII 契约拒绝，文件未创建。显式合法 ASCII ID 的绕过成功。

### 需求传递判断
- 无老板需求遗漏、缩写或跨过。上游执行者在真实失败后把症状、源码位置、绕过方式、期望契约和红线完整写入本工单；当前公告板、队列任务和 shadow handoff 又完整保留了主管职责与验收。
- 工单正文中的旧源码行号已因后续代码演进偏移，但函数与故障语义未变；现行权威位置是 `projects/控制台/secretary-tools.js:379-395,1327-1334`。这是证据指针陈旧，不是需求语义遗漏。

### 严重度与根因
- 严重。该缺陷位于公共维修建单入口，任何 agent/任务只要用非 ASCII 标题且不传显式 ID，都会在建立维修闭环前失败；影响面跨任务、跨队列和跨 agent。`repair-policy-check` 对本单给出 `severity=severe`、`repairDepth=global_system_trace`。当前只找到一次真实触发，无重复误报或数据写坏证据。
- 根因：`slugText()` 允许 Unicode 字母/数字，`safeTicketId()`/`repairTicketPath()` 只允许 ASCII，`repairTicketAdd()` 却把前者的结果直接交给后者，自动 ID 的 producer/consumer 契约不一致。缺少中文、英文、纯符号和空标题的自动 ID 回归，使该组合缺口未被测试捕获。

### 派工范围与红线
- 写码分派给 `repair`：仅修改 `projects/控制台/secretary-tools.js` 与最贴近的维修建单测试（优先 `tests/repair-department.test.js`；确有必要才触碰 `tests/repair-ticket-bulletin.test.js`），实现稳定 ASCII 自动 slug/hash。
- 必须保持：显式合法 ID 原样；自动英文标题仍可读且安全；中文/混合/纯符号标题始终生成非空安全 ASCII ID；空标题仍按现有契约拒绝；同 ID 文件存在时仍拒绝；路径不得越出 `board/repair-tickets/`。
- 验证：修前语料复现；`node --check projects/控制台/secretary-tools.js`；目标测试；相关维修部门/公告板回归；scoped `git diff --check`。不得触碰工作区其他既有脏改，不重启服务、不清进程；高危/不可逆操作必须停下给主人确认；密钥不回显。

## 结案协议
- 本维修请求单独建单,不同故障不得混入本单。
- 完成记录必须包含:链路证据、需求传递判断、严重度、根因、处理过程、复核验证、架构判断、知识沉淀候选、剩余风险 / 下一步。
- 使用 `repair-ticket-complete` 结案;系统生成固定 HTML,飞书发送摘要卡 + 附件,元宵同步报告文档。

### 完成记录 2026-07-17T03:52:47.572Z
- status: done
- report: projects/控制台/artifacts/repair-reports/repair-20260713-ticket-id-unicode-slug.html
- report_sha256: 3054a92f911d97e0b9f3d172d081e49528775e3d1d1fc202cccc35d651b2c1b4

# 维修主管结案记录 · repair-20260713-ticket-id-unicode-slug

## 链路证据

- 上游发现链：上一张维修工单 `auto-20260713103533-5d8f47806172d340` 的 `repair-lead` 调用未带 `--id` 的 `repair-ticket-add`，期望按中文标题自动创建独立工单；`projects/控制台/artifacts/engine-runs/cr-1783939042216-acea4f9a/execute-1-fo1/process.log:7618-7620` 实际返回 `bad repair ticket id`。同一执行者随后改用显式 ASCII ID 创建本单，命令、绕过判断和成功结果见同一日志 `:7886-7908`；原工单把该缺陷列为独立后续，见 `board/repair-tickets/auto-20260713103533-5d8f47806172d340.md:113-120`。
- 当前交接链：公告板在 `projects/控制台/artifacts/engine-events.jsonl:45757-45758` 派给 `repair-lead/5f39db71`；`projects/控制台/artifacts/engine-runs/cr-1784258612129-5f39db71/task.md` 保留目标、边界、两行结构化验收与视觉分类。主管初查已回填 `board/repair-tickets/repair-20260713-ticket-id-unicode-slug.md:32-50`。
- 维修执行链：首次正式派工因历史队列项缺 `repairTicketId` 被 scope 守卫回退到 CEO，见 `projects/控制台/artifacts/engine-events.jsonl:46196-46197`，主管立即取消误路由；补齐当前队列的既有工单关联后，第二次派工在 `:46225-46234` 由 `repair/8d1618fa` 正确接收，但停在 `runner-singleflight` 的 pre-engine 等待。为避免与本主管特权 runner 互锁，按工单允许的独立 Codex 特权会话手动接管写码；执行记录见 `projects/控制台/artifacts/repair-executor-repair-20260713-ticket-id-unicode-slug.md`。确认该正式队列从未启动 engine、无 PID 后请求取消，终态见 `projects/控制台/artifacts/queues/repair/canceled/8d1618fa.json` 与事件 `engine-events.jsonl:46496-46498`，不存在重复执行。
- 期望返回是安全、稳定的 ASCII 自动 ID 和真实工单文件；实际修复后原中文混合标题命令退出码为 0，生成 `repair-<timestamp>-repair-lead-repair-509ce765c4d6`，且路径位于 `board/repair-tickets/`。

## 需求传递判断

- 无老板需求遗漏、缩写或跨过。真实症状、绕过方式、期望契约、显式 ID/路径/幂等红线均从上游工单完整传到本单、公告板任务、主管 brief 与维修执行记录。
- 工单原始源码行号因后续演进发生偏移，但函数名与故障语义一致；这是证据指针陈旧，不是需求传递遗漏。
- 派工链出现的两项机制问题（历史队列 scope 元数据缺失、repair-lead 与 repair 的特权 runner 单飞互锁）均被证据化并隔离，没有改变维修 brief；单飞互锁已有独立工单 `board/repair-tickets/repair-20260713-privileged-runner-singleflight.md`，本单不混修。

## 严重度

- **严重**。缺陷位于公共维修建单入口；任一 agent/任务使用非 ASCII 标题且省略显式 ID，都会在独立工单建立前失败，影响跨任务、跨队列、跨 agent 的维修闭环。`repair-policy-check` 给出 `severity=severe`、`repairDepth=global_system_trace`。当前证据仅确认一次真实触发，未发现文件越界、覆盖或数据损坏。

## 根因

- `slugText()` 允许 Unicode 字母/数字，`safeTicketId()` 与 `repairTicketPath()` 只允许 ASCII，原 `repairTicketAdd()` 却直接把前者产物交给后者；自动 ID 的 producer/consumer 契约不一致。
- 测试缺少中文、混合、纯符号、空标题、显式合法 ID、重复 ID 和路径穿越的同组回归，因此契约冲突未在入口测试中暴露。

## 处理过程

- 在 `projects/控制台/secretary-tools.js:384-395` 增加自动工单 slug 生成：标题先 NFKD 归一化，保留可读 ASCII 前缀，并拼接标题 SHA-256 的前 12 位；无可读 ASCII 时使用 `ticket`，保证中文/混合/纯符号标题均得到非空安全 ASCII ID。
- 在 `projects/控制台/secretary-tools.js:1333-1343` 区分显式 ID 与自动 ID：合法显式 ID 原样保留；非空但非法的显式 ID继续 fail-closed；空标题继续拒绝；自动 ID 使用时间戳、可读前缀和稳定哈希。
- 在 `tests/repair-department.test.js:26-94` 增加英文、中文、混合、纯符号、空标题、显式合法 ID、重复 ID、路径穿越与文件落点回归。未修改公告板测试，未触碰任务范围之外的用户脏改，未执行重启、清进程或不可逆操作。

## 复核验证

- 主管独立核对 scoped `git diff`：实现仅涉及 `projects/控制台/secretary-tools.js` 和 `tests/repair-department.test.js`；维修员报告中的代码位置与实际 diff 一致。
- `node --check projects/控制台/secretary-tools.js`：退出码 0。
- `node --check tests/repair-department.test.js`：退出码 0。
- `node tests/repair-department.test.js`：退出码 0，输出 `{"pass":true,"suite":"repair-department"}`。
- `node tests/repair-ticket-bulletin.test.js`：退出码 0，输出 `{"pass":true,"suite":"repair-ticket-bulletin"}`。
- `git diff --check -- projects/控制台/secretary-tools.js tests/repair-department.test.js`：退出码 0。
- 主管在隔离临时目录复跑原中文混合标题 CLI：退出码 0，ID 满足安全 ASCII 格式，文件路径确认位于维修工单目录，测试文件已安全清理。
- 复核期间第一版临时包装断言把数值退出码 `0` 当作布尔假值，导致包装脚本自身退出码 2；当时打印的四项产品检查均为 `true`。修正为仅校验布尔检查项后，同一隔离复现退出码 0、四项仍全部为 `true`。该红灯归因于主管临时复核脚本，不归因于产品实现。
- 正式维修队列终态为 `canceled`、`pre_engine_cancel_confirmed=true`、`engine_started_at=null`、`enginePid=null`，排除手动接管后重复 runner 写入。
- 主管以原始分辨率逐张打开两张真实 Peekaboo 截图，确认全局页面无白屏/遮罩，筛选态卡片可见 `8d1618fa`、维修员角色、工单路径和运行中状态；Codex 对照挑错报告明确区分 UI 可用性证据与 ID 逻辑证据，见 `projects/控制台/artifacts/visual-evidence/repair-20260713-ticket-id-unicode-slug/codex-design-review.md`。

## 架构判断

- 这是系统性入口契约缺口，不是单个文件名偶发错误。修复放在 ID 生产边界，并继续由下游 validator fail-closed；入口回归同时覆盖非拉丁标题、符号标题、合法/非法显式 ID 与路径安全，能阻止同类倒退。
- 后续架构建议：为所有“展示文本 → 文件/队列 ID”转换统一复用安全 ID helper 和契约测试，禁止把宽字符 slug 直接送入 ASCII-only validator。
- `repair-lead` 与 `repair` 共用特权 runner 单飞锁、历史公告队列缺 `repairTicketId` 导致 scope fallback 是本次全局排查发现的独立链路问题；前者已有独立维修工单，后者对新建工单已由现行字段覆盖，历史项兼容需单独治理，不在本单扩大改动。

## 知识沉淀候选

- 泛化判断：面向文件名、队列键或 URL 段的自动 ID，生成器输出集合必须是下游 validator 接受集合的子集。
- 问题模式：Unicode 友好的展示 slug 与 ASCII-only 安全路径校验分别正确，组合后却必然拒绝非 ASCII 标题。
- 根因：producer/consumer 契约分裂，且回归语料只覆盖 ASCII happy path。
- 解法：在生产边界生成“可读 ASCII 前缀 + 稳定内容哈希”，保留下游 fail-closed 校验，并用中文、混合、纯符号、空标题、显式合法/非法 ID 组成契约测试矩阵。
- 项目技术映射：`projects/控制台/secretary-tools.js` 的 `repairTicketAdd()`/`repairTicketPath()` 与 `tests/repair-department.test.js`。

## 剩余风险 / 下一步

- 自动 ID 使用 12 位十六进制内容哈希（48 bit）；理论碰撞风险非零，但时间戳前缀和现有文件存在守卫会 fail-closed，当前风险低。
- 特权 runner 单飞互锁继续由独立工单 `repair-20260713-privileged-runner-singleflight` 处理；历史 bulletin 队列的 scope 元数据兼容建议另开工单，二者不影响本次 ID 契约修复的正确性。
- 本单没有高危、不可逆或密钥相关遗留；固定 HTML 和飞书/元宵回执以 `repair-ticket-complete` 的持久化报告及 delivery state 为结案最终证据。

## 结构化验收表

验收表协议：`structured-acceptance@2`

| 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 |
|---|---|---|---|
| 任务验收: 链路证据、需求传递判断、严重度、根因、处理/派工、复核验证、架构判断、知识沉淀和剩余风险写入工单; 结案生成固定 HTML 并取得飞书/元宵投递回执。 | 完成 | `board/repair-tickets/repair-20260713-ticket-id-unicode-slug.md:32`; `projects/控制台/artifacts/repair-supervisor-repair-20260713-ticket-id-unicode-slug.md:3`; `projects/控制台/secretary-tools.js:384`; `tests/repair-department.test.js:26`; `projects/控制台/artifacts/repair-executor-repair-20260713-ticket-id-unicode-slug.md:3`; `projects/控制台/artifacts/repair-reports/repair-20260713-ticket-id-unicode-slug.html`; `projects/控制台/artifacts/repair-reports/delivery-state.json`; `projects/控制台/artifacts/engine-events.jsonl` | 代码与测试已由主管独立复核；本行以唯一结案命令退出码 0、固定 HTML 存在、飞书与元宵 delivery state 均成功为最终放行条件。 |
| 视觉/UI证据: peekaboo截图路径 + Codex对照设计挑错报告 | 完成 | `projects/控制台/artifacts/visual-evidence/repair-20260713-ticket-id-unicode-slug/peekaboo-repair-filtered.png`（SHA-256 `be5633640f7273b5870aa42d5f9c6d863a13b3811e31470458eb5d94f2641415`）; `projects/控制台/artifacts/visual-evidence/repair-20260713-ticket-id-unicode-slug/codex-design-review.md:1` | Peekaboo 真实控制台截图证明页面可用、派工可观察且无可见回归；报告明确 ID 功能本身由 diff 与自动测试证明，不以截图替代。 |

## 结案后回执复核（2026-07-17）

- 唯一结案命令 `repair-ticket-complete` 退出码 0；工单头和处理结果均为 `status: done`，见本文件 `:3,30`。
- 固定 HTML：`projects/控制台/artifacts/repair-reports/repair-20260713-ticket-id-unicode-slug.html`，实际 SHA-256 `3054a92f911d97e0b9f3d172d081e49528775e3d1d1fc202cccc35d651b2c1b4`，与本文件 `:60` 及 `projects/控制台/artifacts/engine-events.jsonl:46752` 一致；`missingSections=[]`。
- 飞书回执：`projects/控制台/artifacts/engine-events.jsonl:46758` 为 `repair.ticket.notify_sent`、`channel=feishu`、`code=0`；`projects/控制台/artifacts/owner-auto-notify-state.json` 中 fingerprint `de1c646cee7cb6a4` 为 `status=sent`。
- 元宵回执：`projects/控制台/artifacts/engine-events.jsonl:46759` 为 `repair.report.yuanxiao_sent`，receipt `msg_1784260370654_17fcdece`；`projects/控制台/artifacts/repair-reports/delivery-state.json` 的记录键 `685d0ec072f8957c806ed2bc3ef9a342539ca7dac1a1611f12d039fd8543a5b9` 为 `status=sent`、HTTP 200、同一 report SHA 与 receipt。
- 记忆提炼已入队 `memory-officer/repair-memory-dd01f80a71`，证据见 `projects/控制台/artifacts/engine-events.jsonl:46754` 与 `projects/控制台/artifacts/queues/memory-officer/30-0000000082-repair-memory-dd01f80a71.json`。
- 结案后审计发现固定报告解析/脱敏的两个独立问题，未混入本单改动，已分别建立 `board/repair-tickets/repair-20260717-report-section-label-collision.md` 与 `board/repair-tickets/repair-20260717-report-redaction-false-positive.md`；它们不影响本单自动 ID 修复与两通道已成功投递的事实。
