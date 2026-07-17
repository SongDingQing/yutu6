# Agent Harness 深度研究与优化候选

- 日期: 2026-07-14
- 任务链: 秘书受理 -> CEO 研究路线 -> 洞察员取证 -> 质量运营/监管规则复核 -> 主人拍板
- 范围: 研究协议、agent harness、工具与 hooks、skills、多智能体协调、质量评估、token 效率
- 本轮性质: 只固化研究 skill 和复核规则;运行时改动全部进入公告板 `todo`,未自动启用
- 结论: 现有玉兔6已经有 done gate、协议 gate、事件日志、队列 lease 和阻断 hooks,下一步不应重复造 gate,而应补强“研究证据 -> 工具执行 -> 轨迹评估 -> 经验晋升”的闭环。

## 来源清单

| 来源 | 类型 | 本轮采用点 | 访问/版本 |
|---|---|---|---|
| [How to be good at research](https://x.com/itsreallyvivek/article/2064686372737454155) | 研究方法 | 问题定义、宽搜窄证、记录反证 | 主页面受登录限制;仅用可访问镜像作方法线索,不承载关键技术结论 |
| [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) | 官方教程 | 从简单可组合模式开始、workflow/agent 分界、工具接口质量、停止条件 | 2026-07-14 |
| [A practical guide to building agents](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/) | 官方指南 | model/tools/instructions、单 agent 优先、manager/handoff、guardrails | 2026-07-14 |
| [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) | 官方工程文 | 委派合同、宽搜窄证、并行研究、checkpoint、trace、成本约束 | 2026-07-14 |
| [OpenAI Agents SDK orchestration](https://openai.github.io/openai-agents-python/multi_agent/) | 官方文档 | manager-as-tools、handoff、代码编排与 LLM 编排分界 | 2026-07-14 |
| [Microsoft AI agent orchestration patterns](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns) | 官方架构文档 | sequential/concurrent/handoff/group/magentic、最小充分复杂度 | 2026-07-14 |
| [ReAct](https://arxiv.org/abs/2210.03629) | 原论文 | 推理与行动交错、环境观察校正 | arXiv:2210.03629 |
| [Reflexion](https://arxiv.org/abs/2303.11366) | 原论文 | 由反馈产生的语言记忆、限域反思 | arXiv:2303.11366 |
| [SWE-bench](https://arxiv.org/abs/2310.06770) / [项目站](https://www.swebench.com/original.html) | 原论文/项目 | 真实仓库问题、fail-to-pass 与 pass-to-pass 验证 | arXiv:2310.06770 |
| [openai/codex](https://github.com/openai/codex) | 官方仓库 | typed hook lifecycle、阻断/改写结果、token budget、审计字段 | `b24aa20107f365a1d0f06de9e0b28df5c516c7dd`, Apache-2.0 |
| [earendil-works/pi](https://github.com/earendil-works/pi) | 官方仓库 | agent loop、steering/follow-up 分队列、compaction、tool-call 安全 | `0e6909f050eeb15e8f6c05185511f3788357ddb3`, MIT |
| [SWE-agent/mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent) | 官方仓库 | 小型可审计循环、步数/成本/时间上限、逐步轨迹、进程组超时清理 | `e187bcb2ff5825d85761a6f9c1f98c9fa6cfbc79`, MIT |

## Open-source teardown 证据

- Codex:抽查 `codex-rs/hooks/src/events/pre_tool_use.rs` 与 `codex-rs/core/src/session/token_budget.rs`;确认 hook 请求/结果有类型边界,可阻断或改写工具调用,并有预算提醒。
- Pi:抽查 `packages/agent/src/agent-loop.ts` 与 `packages/agent/src/harness/agent-harness.ts`;确认事件流、steering/follow-up 分离、截断工具调用不执行、session/compaction/skill 装载与重复工具名校验。
- mini-swe-agent:抽查 `src/minisweagent/agents/default.py` 与 `src/minisweagent/environments/local.py`;确认每步轨迹持久化、步数/成本/墙钟/格式错误上限,以及超时后按进程组结束。
- 采用边界:只借鉴协议与测试思想,不复制实现;引入代码前仍需许可证、依赖、权限和本机可回滚性审计。

## 本机基线

- 已有: `shared/engine/done-gate.js`、`protocol-gate.js`、`hook-registry.js`、事件日志、队列 lease、资源锁、spec fingerprint、阻断型 `task.true_done` hooks。
- 缺口:研究深度没有分档;建议缺统一 claim-to-evidence schema;工具生命周期/轨迹 replay 不完整;skill 晋升标准不硬;多智能体交接成本和 token 预算缺统一账本。
- 原则:优先补观测、契约和验证;没有指标基线的“再加 agent/再加 hook”不进入实施。

## 50 条候选账本

### 一、研究质量与来源协议

| ID | 问题与建议 | 依据 | 收益与验证 | 风险/回退 | 决策 |
|---|---|---|---|---|---|
| AHR-01 | 建立 `light/deep/audit` 三级研究模式,定时只跑 light,主人点名才 deep。 | Anthropic 简单优先;多 agent 研究成本显著更高。 | 比较每轮 token/候选采纳率;目标日常扫描不增量。 | 可能漏长尾;可按主题临时升档。 | recommend |
| AHR-02 | 研究开始先写唯一决策问题、成功指标和不研究范围。 | How to be good at research; OpenAI instructions。 | 抽查报告是否能回答同一问题;减少跑题。 | 规格过窄;允许 CEO 修订并留版本。 | recommend |
| AHR-03 | 固定来源等级:原论文/官方文档/官方仓库优先,二手只做线索。 | source audit 通用原则。 | 统计关键结论一级来源覆盖率,目标 100%。 | 小众主题缺一级来源;明确标 limited。 | recommend |
| AHR-04 | 建 source manifest:URL、访问日、commit、license、可访问状态。 | 三个仓库 teardown 实践。 | 报告可复现;测试 schema 完整性。 | 元数据维护成本;light 模式仅记关键字段。 | recommend |
| AHR-05 | 建“问题 x 来源”覆盖矩阵,防单一文章支配结论。 | 多源研究与 SWE-bench 证据思路。 | 每个高影响建议至少两类证据或一条源码证据。 | 非必要重复阅读;允许强源码单证。 | experiment |
| AHR-06 | 查询采用 broad-to-narrow:先发现候选,再沿源码/测试窄证。 | Anthropic multi-agent research。 | 记录发现数、深审数、淘汰原因。 | 宽搜成本;设来源上限。 | recommend |
| AHR-07 | 用“新增有效证据率”作为饱和停止条件,而非固定凑满 50 条。 | 研究收敛与成本控制。 | 连续两批新增有效建议低于阈值即停。 | 阈值误停;主人可要求继续。 | experiment |
| AHR-08 | 报告强制保留矛盾证据、失败假设与未决项。 | Reflexion 需真实反馈;source audit。 | 质量运营抽查是否只报喜。 | 报告变长;只保留影响决策的反证。 | recommend |

### 二、开源拆解与源码审计

| ID | 问题与建议 | 依据 | 收益与验证 | 风险/回退 | 决策 |
|---|---|---|---|---|---|
| AHR-09 | 每次 teardown 冻结 repo、commit、license、语言和运行时。 | Codex/Pi/mini-swe-agent 本轮审计。 | 复现同一版本;manifest test。 | 上游快速变化;按需刷新。 | recommend |
| AHR-10 | 只画与问题相关的最小架构切片,不吞整仓。 | Anthropic 简单可组合;本轮源码抽查。 | 降低 token;比较输入字节数。 | 漏跨模块依赖;source-audit 阶段补边界。 | recommend |
| AHR-11 | 先跑/读最小可执行路径再评价框架,README 不作完成证据。 | SWE-bench 真实执行;quality-ops 规则。 | 每个采纳项附命令或源码路径。 | 环境可能不能跑;标 source-only。 | recommend |
| AHR-12 | 固定追踪 `input -> model -> tool -> observation -> stop/persist`。 | ReAct;Pi agent loop;mini-swe-agent。 | 能定位能力在哪一环丢失;用 trace 模板验收。 | 流程图过细;只追一条代表路径。 | recommend |
| AHR-13 | README 的关键声称至少核一处实现和一处测试。 | Codex/Pi/mini-swe-agent source audit。 | 降低“文档即事实”;审计抽样通过率。 | 无测试项目;降为 experiment。 | recommend |
| AHR-14 | 源码审计增加权限、命令注入、路径边界、秘密泄漏检查。 | Codex pre-tool hooks;本地 privileged runner 风险。 | 高危接入前零未解释风险。 | 误报阻塞;区分 blocking/advisory。 | recommend |
| AHR-15 | 增加依赖、平台、维护活跃度和升级成本审计。 | 三仓运行时差异。 | 避免“理念好但接不进”;记录本机 PoC 成本。 | 活跃度易漂移;访问日快照。 | recommend |
| AHR-16 | 输出分成“可借鉴原则 / 可实验代码 / 不应复制”,并加许可证 gate。 | 开源合规与可回滚要求。 | 降低直接搬代码风险;实施卡必须引用分类。 | 增加审核步骤;低风险文档可快速通过。 | recommend |

### 三、Agent loop 与 harness 运行安全

| ID | 问题与建议 | 依据 | 收益与验证 | 风险/回退 | 决策 |
|---|---|---|---|---|---|
| AHR-17 | 将执行循环显式建模为 reason/action/observation/decision 状态机。 | ReAct。 | 事件流可解释;回放时无隐式跳步。 | 事件量上升;只存摘要与引用。 | experiment |
| AHR-18 | 最终状态必须由环境证据决定,模型文字不能直接置 done。 | SWE-bench;现有 done gate。 | 假完成率下降;故意伪声明回归。 | 分析任务无文件 diff;允许结论+依据证据。 | recommend |
| AHR-19 | 统一 typed terminal outcome:success/fail/blocked/cancelled/waiting。 | Codex typed outcomes;Pi event loop。 | UI/队列不再靠字符串猜状态。 | 协议迁移;先兼容旧字段。 | experiment |
| AHR-20 | 每任务硬性 step/time/cost 三预算,超限给明确 reason。 | mini-swe-agent limits。 | 控制失控循环;超限测试。 | 复杂任务被早停;按任务等级给预算。 | recommend |
| AHR-21 | 超时结束整个进程组,并确认子进程清零。 | mini-swe-agent local environment。 | 防孤儿 CLI 吃内存;进程树回归。 | 误杀共享进程;必须独立 process group。 | recommend |
| AHR-22 | 每个工具步后原子落 trajectory checkpoint,支持恢复。 | mini-swe-agent trajectory;Anthropic checkpoint。 | 崩溃后不重跑全部;故障注入验证。 | 磁盘写放大;批量/压缩/保留期。 | experiment |
| AHR-23 | 设连续格式错误预算,超过即 fail with reason。 | mini-swe-agent format-error limit。 | 避免坏 JSON 无限重试;注入格式错测试。 | 可恢复错误被终止;允许一次修复提示。 | recommend |
| AHR-24 | 流式输出被截断的 tool call 永不执行,要求完整重发。 | Pi agent loop。 | 防半参数写文件/执行命令。 | 多一次模型调用;安全优先。 | recommend |
| AHR-25 | steering 与 follow-up 分队列:前者下一步前注入,后者本轮结束后处理。 | Pi agent loop。 | 用户补充不再打乱当前工具事务;顺序测试。 | UI 语义变化;保留兼容入口。 | experiment |

### 四、工具、hooks 与 skills 治理

| ID | 问题与建议 | 依据 | 收益与验证 | 风险/回退 | 决策 |
|---|---|---|---|---|---|
| AHR-26 | 为工具做 overlap/clarity 审计,同能力只留一个首选入口。 | Anthropic ACI/tool design。 | 降低选错工具和 token;统计工具选择纠错率。 | 兼容脚本依赖旧名;先 alias 再退役。 | recommend |
| AHR-27 | 文件工具返回绝对路径和稳定 artifact ID,禁止模糊相对路径交接。 | 本地多工作区事实;SWE-bench repo context。 | 减少改错仓库;路径边界测试。 | 输出略长;事件里用 artifact ID。 | recommend |
| AHR-28 | pre-tool hook 只做政策/参数门禁,post-tool 只做证据采集,职责分离。 | Codex hook lifecycle。 | 避免 hook 互相覆盖;生命周期测试。 | 迁移旧 hook;双写观察后切换。 | experiment |
| AHR-29 | hook 事件 schema 带版本、requestId、taskId、toolCallId 和 outcome。 | Codex typed hook requests/outcomes。 | 可追踪且可升级;schema contract test。 | 事件膨胀;只加索引字段。 | recommend |
| AHR-30 | 每个 hook 声明 fail-open/fail-closed、超时和降级策略。 | 本机 blocking hook 风险;Codex outcome。 | 防全系统被慢 hook 卡死;超时注入测试。 | fail-open 降低保护;高危动作仍 closed。 | recommend |
| AHR-31 | 观测型 hook 异步写审计,不得阻塞主链。 | Anthropic tracing;本机 token/通知历史。 | 降低延迟;对比 p95。 | 异步丢事件;本地缓冲+重放。 | experiment |
| AHR-32 | 给 skill 加 trigger/scope/negative-trigger 回归测试。 | 现有 skill-standard-reviewer。 | 减少误触发与上下文污染;样例集测试。 | 测试维护成本;只测高频 skill。 | recommend |
| AHR-33 | skill metadata 增 owner、证据来源、review cadence、适用项目和失效条件。 | Reflexion 的记忆边界;治理规则。 | 过期知识可清理;定期抽查。 | 元数据负担;模板生成。 | experiment |
| AHR-34 | 优秀经验至少重复出现并经外部验证后才能晋升全局 skill。 | Reflexion 依赖反馈;quality gate。 | 防一次性误判污染所有 agent;晋升测试。 | 学习变慢;项目级 skill 可先试。 | recommend |

### 五、多智能体协调与交接

| ID | 问题与建议 | 依据 | 收益与验证 | 风险/回退 | 决策 |
|---|---|---|---|---|---|
| AHR-35 | 每条流程明确 manager-as-tools 或 handoff,禁止混用而无 owner。 | OpenAI Agents SDK。 | 责任归属清楚;链路 schema 检查。 | 老流程兼容;逐 flow 迁移。 | recommend |
| AHR-36 | delegation envelope 固定 objective/output/tools/bounds/budget/stop。 | Anthropic multi-agent research。 | 下游少丢需求;交接完整率测试。 | brief 变长;引用共享规格。 | recommend |
| AHR-37 | 交接传 artifact refs + evidence IDs,不复制整段 transcript。 | Anthropic trace;token 效率。 | 减少上下文和漂移;统计每次交接 token。 | 下游要多读文件;建立热区摘要。 | recommend |
| AHR-38 | 只并行独立子任务;共享写目标必须串行或锁定。 | Microsoft concurrent pattern。 | 保住并发收益且少冲突;冲突率验证。 | 并行度下降;按资源域动态判断。 | recommend |
| AHR-39 | 共享可变状态设单一 owner、版本或 edit-lock。 | Microsoft patterns;本机资源锁。 | 防覆盖;并发写故障注入。 | 粗锁堵塞;锁到具体资源而非大域。 | recommend |
| AHR-40 | 多 reviewer 建 quorum/缺席/冲突规则,缺席不能等于同意。 | 多 agent 治理风险。 | 董事缺席时不误放行;缺席回归。 | 可用性下降;设置主人拍板降级。 | recommend |
| AHR-41 | handoff 做 context filter:只传职责相关片段、规格和证据。 | OpenAI handoffs;Anthropic delegations。 | 降 token 且少干扰;A/B 完成率与 token。 | 过滤漏关键信息;保留原始 artifact 引用。 | experiment |
| AHR-42 | 按复杂度/价值分配 agent 数和 token,低价值任务不得多 agent。 | Anthropic 多 agent 成本;Microsoft 最小复杂度。 | 直接降低自动消耗;按任务统计成本/收益。 | 复杂度误判;允许 CEO 升档。 | recommend |

### 六、质量评估、记忆与主人 gate

| ID | 问题与建议 | 依据 | 收益与验证 | 风险/回退 | 决策 |
|---|---|---|---|---|---|
| AHR-43 | 运行前把 acceptance 转成可度量 eval checklist 并冻结指纹。 | SWE-bench;现有 spec fingerprint。 | 评审不再临时改标准;指纹测试。 | 探索任务难量化;允许 evidence rubric。 | recommend |
| AHR-44 | 评估同时看 outcome 与 process:结果正确且无越权/无危险捷径。 | ReAct trajectory;done gate。 | 拦住偶然成功;轨迹抽检。 | 审查成本;风险分层抽样。 | recommend |
| AHR-45 | 代码任务同时跑 fail-to-pass 与 pass-to-pass 回归。 | SWE-bench。 | 修新问题不破旧功能;测试汇总硬证据。 | 测试时间;按影响面选集。 | recommend |
| AHR-46 | 建小型 canary trajectory replay,每次核心 prompt/hook 变更回放。 | SWE-bench eval;Codex hooks。 | 发现行为回归;基线通过率对比。 | replay 可能非确定;多次采样和容差。 | experiment |
| AHR-47 | Reflexion 经验只在外部失败证据后写入,带项目范围、TTL 和撤销条件。 | Reflexion 原论文;避免记忆污染。 | 记忆可控;过期与反例测试。 | 维护成本;先对高频故障启用。 | experiment |
| AHR-48 | prompt/skill/hook 变更必须有旧基线、A/B 指标和一键回滚。 | 迭代工程与治理要求。 | 只保留真实提升;退化演练。 | 双跑成本;小流量 canary。 | recommend |
| AHR-49 | 建按 role/model/task 的 token、费用、延迟和成功率账本,配预算告警。 | mini-swe-agent cost limit;Anthropic 成本。 | 找到高耗低产角色;周报对比。 | 计量本身有开销;事件聚合不逐 token 写盘。 | recommend |
| AHR-50 | 50 条建议只合并为主题包进入公告板,默认 todo;批准后才生成实施任务和 hook。 | 本机 owner gate;OpenAI guardrails。 | 主人决策负担可控且不偷改系统;验卡状态。 | 主题包可能过大;启用后再拆子任务。 | recommend |

## 复核记录

### 质量运营检查

- 已按质量运营规则做外部静态检查:删除同义重复项;每条都具备证据方向、收益/验证、风险/回退和决策类别;没有为凑满数量加入纯口号。
- 尚未运行独立 `quality-ops` agent,因此不冒充“质量运营已独立签字”。公告板实施前应由独立质量运营核一次本机基线和预期指标。

### 监管检查

- 已按监管规则把运行时 hooks、路由、并发、权限、模型、全局 gate 全部留在主人 gate;本轮只改研究 skill、角色研究提示和复核提示。
- 尚未运行独立 `governance` agent,因此监管结论标记为待独立复核。任何公告卡启用后必须重新评估共享状态、无限循环、权限面和回滚。

## 建议拍板包

1. 研究协议与来源质量门:研究分档、source manifest、覆盖/收敛/反证。
2. Open-source teardown + source-audit:冻结版本、最小切片、真实路径、许可证与安全边界。
3. Agent loop 可靠性:状态机、环境真值、typed outcome、预算、超时、checkpoint、截断工具安全。
4. Tool/hook 生命周期:工具去重、绝对路径、pre/post 分工、typed schema、故障策略。
5. Skill 学习治理:异步观测、触发测试、metadata、经验晋升门。
6. 多智能体交接:manager/handoff、delegation envelope、artifact refs、并发/锁/quorum/context filter。
7. 硬评估与受控记忆:acceptance、过程+结果、SWE-bench 双回归、trajectory replay、Reflexion 边界。
8. 迭代与成本 owner gate:A/B+回滚、token 成本账本、主题包拍板。
