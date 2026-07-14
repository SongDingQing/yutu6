# 系统级智能体定义 · shared/agents/(阶段3)

> 把蓝图四层组织 + §16/§17 治理角色,落成**挂在 `shared/engine` 上的独立 agent 定义**。
> 每个 agent = 一个可拆解模块:`agent.json`(契约:角色/模型/读路径白名单/触发/IO/解耦/验证)+ `prompt.md`(L0 红线常驻 + L1 角色行为)。
> 引擎/会话起来后(真 CLI 在 Mac 验证),按 `role` 经 `model-routing.yaml` 选模型、经 `runners.yaml` + cli-runner 选 runner 实例化。

## 系统级 agent
| agent | 角色(model-routing) | runner | 上下文 | 看得到(need-to-know) | 职责 |
|---|---|---|---|---|---|
| `secretary` 秘书 | secretary | codex | last_only | 老板原始指令 + 项目 brief/status 摘要 | 通用默认入口;指令补全、判断 projectId、非维修任务转交 CEO 队列 |
| `orchestrator` **CEO**(原总管) | orchestrator | codex | accumulate | board/ + 各项目 brief/status + 控制台队列摘要 | 接秘书信封后拆方向→项目、摘趋势上报;队列长时用现有工具整理 queued/paused |
| `supervisor` 主管 | supervisor | codex | explicit | 自己项目全部 + 共享 reference/能力库 | 拆任务→员工、审产物、上报 |
| `worker-code` 后端程序员 | worker_code | codex | explicit | 当前任务授权的项目/共享代码与测试 + 工程交接索引 | review-loop implement 落盘实现;不做复审/发布/特权维修 |
| `worker-narrow` 外包/轻量执行 | worker_narrow | codex | last_only | 明确输入的日志/文档片段 | 低风险摘要、清单、草案;不默认写源码 |
| `reasoning-architect` 架构/推理 **[已归档-弹性编制]** | reasoning_architect | codex | explicit | 相关源码、事件证据、测试与 reference | 复杂架构/风险/方案仲裁;不接普通实现。2026-07-03 历史零任务软归档(config.roleRouting 带 archived 标记,路由仍可用);复活=移除 config 中 archived 字段 |
| `quality-ops` 质量运营 | quality_ops | codex | explicit | 事件日志/ledger + 能力库 | 找高重复确定性动作→硬化(§16) |
| `governance` 监管 | governance | codex | explicit | 误区库 + attempt 计数 | 反复失败/重大漏洞→复盘→规则(§17) |
| `board-deepseek` 董事 | board_deepseek | deepseek | explicit | 架构/性能/并发指令 + CEO 计划 | DeepSeek 事前评审 |
| `board-glm52` 董事 | board_glm52 | zhipu-glm | explicit | 架构/性能/并发指令 + CEO 计划 | GLM-5.2 事前评审 |
| `board-claude` 董事 | board_claude | claude-fable-5 | explicit | 架构/性能/并发指令 + CEO 计划 | 可选 Claude Fable 5 事前评审 |
| `board-opus48` 董事 | board_opus48 | codex | explicit | 架构/性能/并发指令 + CEO 计划 | Codex 最终硬阻断裁决 |
| `ui-optimizer` UI 自我优化师 | ui_optimizer | codex(+peekaboo) | explicit | WebUI 页面 + 截图 | Peekaboo 看页→Codex 挑错(流畅性/易读性)→交 codex 修,每 3 分钟一轮 |
| `frontend-designer` 前端程序员 | frontend_designer | codex | explicit | 控制台 `workspace.html` + 前端交接文档 | 控制台专属页面/UI 定位与小步改造方案;系统办公室工位;必要时交 worker_code 落盘 |
| `gui-desktop-control` 桌面控制 | gui_desktop_control | peekaboo | explicit | 控制台页面/桌面截图与 artifacts | GUI 观察/点击/输入/视觉验收证据;不做业务判断 |
| `insight-scout` 洞察员 | insight-scout | codex | explicit | board/insights + 公告板候选 | 外部优秀案例扫描来源标识;采纳落地仍走 CEO→主管 |
| `hr-manager` HR 主管 | hr_manager | codex | explicit | memory + 设计方案 + agent 花名册 + DATA-MAP | 新 agent 四要素把关、查重、分级审批、边界审核、花名册/数据地图维护 |
| `hr-specialist` HR 专员 | hr_specialist | codex | explicit | HR 规格卡 + agent 模板 + 路由/配置 | 按批准规格填模板、注册、建工位、跑 smoke、更新知识定位 |
| `repair-lead` 维修主管 | repair-lead | codex-privileged | explicit | 维修工单 + 链路交互记录 + 维修员回报 + 核心代码/测试 | 根因分析、严重度分级、全局排查、分派维修员、复核结案 |
| `repair` 维修员 | repair | repair/codex-privileged | explicit | 维修工单 + 主管派工 brief + 授权范围内核心代码/测试 | 执行主管派发的写码/本机运维/授权/服务救火,回报证据 |
| `it-engineer` IT 工程师 | it_engineer | codex | explicit | `VERSION.json` + version-manager + Git origin 非密配置 + 工程交接索引 | 四段版本号、Git commit/push、安全回滚 dry-run/确认流程 |

## 弹性编制(详见 `shared/organization/role-lifecycle.md`)

> 老板设计哲学:角色 = 专业领域的注意力承接单元——防注意力稀释、提任务并发、强化知识库领域权重。
> 编制原则:闲置归档;重复任务过多或 skill 复杂到需要独立注意力时自动展开;质量运营监督扩编。

**归档名单(软归档:INDEX/绩效报告标闲置,路由仍可用,复活=移除 config archived 字段)**
- `reasoning_architect`(2026-07-03):历史零任务。config.roleRouting 保留条目 + `archived: true` 标记,复活成本最低。
- `zhipu_designer`(历史残留):不在 config.roleRouting、无 agent 目录,仅 `ceo-worker.js` 中残留一条 label 映射(历史展示兼容);视为已退役,不新建条目复活。

**观察名单(低活动但可能被路由/回退链依赖,本轮不动,观察一个周期后再议)**
- `worker_narrow`:codexOffloadPolicy 仍把 worker_code 的低风险文本任务回落到它。
- `hr_specialist`:HR 建档流程(hr-agent-onboarding)依赖,低频但有明确职责。

**扩编触发条件(满足其一,由质量运营提议)**
- 同类任务 7 天内 ≥5 次重复落在同一现有角色上(注意力被稀释);
- 单一 skill 的提示词/知识包超过承接角色 prompt 阈值(约 30% 篇幅),需要独立注意力;
- 质量运营在绩效巡检中发现某领域一次通过率因角色兼职下降。

**扩编/归档流程**
1. 质量运营提议(附事件日志/重复度证据)→ 2. 老板拍板 → 3. HR 建档(规格卡四要素、查重、smoke)/或 HR 归档(config 加 archived 标记 + INDEX 移入归档名单)。
硬归档(路由拒绝/队列剔除,经 `agent.json status` 走 server.js disabledQueueAgentIds)不在本步实施,待观察期后由质量运营提议。

## 运行时/配置角色归档状态

2026-06-22 边界审视已把先前只有 `config.roleRouting` 的主要运行时角色补成独立 agent 合约:

- `worker_code`、`worker_narrow`、`reasoning_architect`、`insight-scout`、`gui_desktop_control`、`repair-lead`、`repair` 已有 `agent.json` + `prompt.md`。
- `board_*` 董事会角色仍是正式 agent;通用席位为 DeepSeek / GLM / 可选 Claude Fable 5 / Codex。未配置的可选模型按缺席记录,不得伪造意见;缺席阈值仍由董事会门禁控制。
- `dev_worker` 自优化开发、`hermes` 通知/桥接目前仍是 UI/runner/外部服务角色,非完整 agent 定义;后续如要队列化,必须走 HR 规格卡。

## 与其它模块的接口
- **模型**:`role` → `shared/routing/model-routing.yaml` 的 roles(已含 orchestrator/supervisor/quality_ops/governance/hr_manager/hr_specialist)。
- **runner**:`runner` → `shared/routing/runners.yaml`(codex/codex-privileged/hermes/peekaboo…);执行经 `shared/engine/cli-runner.js` 的 roleMap。
- **上下文从严**:`context_mode` = explicit(默认)/ last_only / accumulate(仅总管),落到节点级强制(§18.3)。
- **校验**:`shared/engine/agents.js` 加载 + `agents-check.js` dry-run(role 在路由、runner 已注册、read_paths/writes 基路径存在)。

## 现状
- ✅ 系统级定义 + HR 双岗 + 加载/校验器就位,沙箱 dry-run 通过。
- ⏳ 真正实例化成跑着的会话:需引擎在 Mac 上接真 CLI(任务#13 之后)。员工层 agent 由主管运行时按需创建(阶段4)。
