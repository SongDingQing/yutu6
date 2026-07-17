# 洞察员归档 2026-07

> 冷区归档:由 `board/insights/scripts/maintain-insights.js` 维护。默认不要整卷读入上下文;按仓库名、URL、slot 或标题用 `rg` 命中后只读相关小节。



<!-- insight-scout-run:cr-1782835246300-insight-scout-repos-20260701-00 -->
## 2026-07-01 · 自动洞察(20260701-00 · queue-engine)
network_status=available;已比对 `seen-repos.json`、`borrowed-libs.md`、`insights.md`,本轮 3 个 URL 未命中既有记录。主题聚焦任务队列引擎 / 调度可靠性 / 失败处置;只读公开 GitHub/官方文档,不登录、不装依赖、不改运行代码;Starlaid/星桥 全程排除。

### apache/airflow
- 是什么:Apache-2.0 的 DAG 工作流调度平台,官方定位为代码化 author/schedule/monitor workflows。
- 值得借鉴:task 应像数据库事务且可重跑,scheduler 按依赖派发到 workers,UI 用于生产监控和排障;可借“DAG run/task instance 状态+幂等重跑”词表。
- 迁移边界/许可证不确定项:Python/DB/executor 体系很重;控制台只借调度状态机、重跑幂等约束和排障 UI,不引 Airflow runtime。
- URL: https://github.com/apache/airflow (docs: https://airflow.apache.org/docs/apache-airflow/stable/best-practices.html)

### beanstalkd/beanstalkd
- 是什么:MIT-style 许可的简单快速 work queue,协议内置 ready/reserved/delayed/buried 四态。
- 值得借鉴:reserve 后有 TTR 超时,worker 未 delete/release/bury 就自动回 ready;bury/kick 明确区分“人工隔离失败单”和“重新放回队列”。
- 迁移边界/许可证不确定项:C daemon+TCP 协议,持久化/高可用能力有限;控制台只借四态、TTR、touch、bury/kick 与 stats 字段。
- URL: https://github.com/beanstalkd/beanstalkd (protocol: https://raw.githubusercontent.com/beanstalkd/beanstalkd/master/doc/protocol.txt)

### rabbitmq/rabbitmq-server
- 是什么:MPL-2.0 的消息 broker,quorum queue 文档把 dead-letter 策略、delivery limit 与确认语义讲得很细。
- 值得借鉴:at-least-once dead-lettering 要等目标确认才 ACK 源队列,并明示资源/重复消息/路由失配风险;适合补控制台 DLQ/redrive 风险清单。
- 迁移边界/许可证不确定项:Broker 运维重,GitHub 侧还有 Apache/Unknown 文件提示,复制代码或插件前需复核子目录授权;只借失败处置条款。
- URL: https://github.com/rabbitmq/rabbitmq-server (docs: https://www.rabbitmq.com/docs/quorum-queues)

### 判断
- 不新增公告板卡:已有“控制台队列失败处置契约”卡覆盖 retryPolicy、DLQ/redrive、lease/heartbeat、pause/stop/recover 与失败审计;本轮三例作为该卡的补充证据。



<!-- insight-scout-run:cr-1782849646996-insight-scout-repos-20260701-04 -->
## AI agent 工具/skills/能力库治理(slot=20260701-04)
说明:network_status=available;已按 `seen-repos.json`、`borrowed-libs.md`、`insights.md` 去重,本轮 3 个 URL 未见;只读公开 GitHub/README/LICENSE,未登录、不装依赖、不处理 token;Starlaid/星桥 全程排除。

### snyk/agent-scan
- 是什么:Apache-2.0 的 agent 组件盘点/扫描器,覆盖 harness、MCP servers、skills 多作用域。
- 值得借鉴:把“装了哪些 skills/MCP、在哪个 system/user/project/extension scope、有什么风险”变成 inventory+scan 报告。
- 迁移边界/许可证不确定项:扫描 MCP 配置会执行 server 命令,且 Quick Start 需 Snyk token;控制台只借字段/同意流程,不运行。
- URL: https://github.com/snyk/agent-scan

### modelcontextprotocol/inspector
- 是什么:MCP 官方可视化测试/调试工具,含 client UI 与 proxy,用于检查 server 的 tools/resources/prompts。
- 值得借鉴:入库前先做“连接、列出工具、试跑、超时/鉴权/local-only/DNS rebinding 检查”的质检门。
- 迁移边界/许可证不确定项:MCP 项目处 MIT→Apache-2.0 迁移,文档 CC-BY-4.0;只借测试清单,不复制 UI。
- URL: https://github.com/modelcontextprotocol/inspector

### pathintegral-institute/mcpm.sh
- 是什么:MIT 的 MCP server manager/registry,提供全局安装、profile 分组、跨 Claude/Cursor/Windsurf 等 client 配置管理。
- 值得借鉴:install once/use everywhere + virtual profiles,适合控制台能力库按场景启用/禁用工具集合。
- 迁移边界/许可证不确定项:涉及 registry、secure tunnel、env 编辑和 client config 写入;本轮只借 profile/配置模型,不安装 CLI。
- URL: https://github.com/pathintegral-institute/mcpm.sh

### 判断
- 不新增公告板卡:现有“起草控制台能力库信任/入库契约 v0”已覆盖本轮行动;建议把 inventory scope、入库质检门、profile 化启停并入该卡。



<!-- insight-scout-run:cr-1782864047609-insight-scout-repos-20260701-08 -->
## 2026-07-01 · 自动洞察(20260701-08 · llm-gateway)
network_status=available;已按 `seen-repos.json`、`borrowed-libs.md`、`insights.md` 去重,LiteLLM/Portkey/Langfuse/Bifrost/Helicone/TensorZero/OpenLIT/Phoenix/OpenLLMetry/NadirClaw 等既有 URL 不重复推荐。本轮只读公开 GitHub/官方文档/许可证,未登录、不装依赖、不处理密钥或授权。

### ferro-labs/ai-gateway
- 是什么:Apache-2.0 的 Go 原生 OpenAI-compatible 网关,覆盖 29+ provider/2500+ models,路由、插件和 Prometheus/结构化日志。
- 值得借鉴:8 类路由含 fallback/weighted/least-latency/cost-optimized/content-based/A-B,可借给控制台“成本-质量-实验”路由配置词表。
- 迁移边界/许可证不确定项:Apache-2.0;项目仍年轻且托管版含企业插件,只借路由策略、插件阶段和 /metrics 字段,不接 runtime。
- URL: https://github.com/ferro-labs/ai-gateway

### api7/aisix
- 是什么:Apache-2.0 的 Rust AI gateway,把模型别名、provider 凭据、caller key、预算、限流、缓存、guardrail、观测作为 AI traffic 一等资源。
- 值得借鉴:“稳定模型别名→后端多 provider/failover/预算策略”的边界清楚,适合控制台把应用侧 model name 与真实供应商解耦。
- 迁移边界/许可证不确定项:依赖 etcd/静态 binary 与云控制面分层;只借资源模型和 alias/failover/budget 语义,不引网关进程。
- URL: https://github.com/api7/aisix

### monocle2ai/monocle
- 是什么:Apache-2.0 的 GenAI OpenTelemetry 观测层,为 agents/prompts/responses/tools/vector operations 定义 metamodel,输出 OTLP traces。
- 值得借鉴:trace 不只看输入输出,还能用 test tools 断言 agent 调用了哪些工具、token cost、错误状态,适合补控制台质量回归证据。
- 迁移边界/许可证不确定项:Python/TS instrumentation 与现有栈需适配;先借 span 属性、trace-as-test 和 OTLP 出口,不迁入 SDK。
- URL: https://github.com/monocle2ai/monocle

### 判断
- 不新增公告板卡:20260629-00 已有“控制台 LLM 网关账本/追踪契约 v0”卡;本轮建议把 cost-optimized/A-B 路由、model alias/budget 资源、trace-as-test 字段并入该卡。



<!-- insight-scout-run:cr-1782878408875-insight-scout-repos-20260701-12 -->
## GUI grounding / computer-use / a11y 借鉴扫描(slot=20260701-12)
说明:network_status=available;已比对 `seen-repos.json`、`borrowed-libs.md`、`insights.md`,本轮 3 个 URL 未命中既有记录。只读公开 GitHub/API/README/LICENSE,未登录、不装依赖、不处理密钥;Starlaid/星桥 全程排除。

### njucckevin/SeeClick
- 是什么:Apache-2.0 的 ACL 2024 GUI grounding 项目,含 ScreenSpot 基准、预训练数据、推理/评测代码与 checkpoint 指引。
- 值得借鉴:ScreenSpot 把指令、bbox、元素类型、平台来源结构化,可给控制台 computer-use 做 grounding 回归集格式参考。
- 迁移边界/许可证不确定项:Apache-2.0;API 显示未归档,pushed_at=2025-07-13;README 明示数据集/checkpoint 仍受原始许可约束,只借 schema/评测方法。
- URL: https://github.com/njucckevin/SeeClick

### guidepup/guidepup
- 是什么:MIT 的读屏器自动化库,统一驱动 macOS VoiceOver 与 Windows NVDA,并可读取 spoken phrase log。
- 值得借鉴:把“a11y tree 看起来对”推进到“读屏器真实读出是否对”的证据层,适合补关键流程验收。
- 迁移边界/许可证不确定项:MIT;API 显示未归档,pushed_at=2026-06-28;依赖系统读屏器/CI 设置,且不能替代真人无障碍测试。
- URL: https://github.com/guidepup/guidepup

### microsoft/accessibility-insights-web
- 是什么:MIT 的 Chrome/Edge 扩展,用于评估网站和 Web 应用无障碍,底层借 axe 规则与人工检查流程。
- 值得借鉴:FastPass/Assessment 可拆为自动规则、tab stop/focus order、name/role/value、人工复核四类门禁。
- 迁移边界/许可证不确定项:MIT;API 显示未归档,pushed_at=2026-06-24;面向浏览器扩展生态,不能直接覆盖桌面/移动。
- URL: https://github.com/microsoft/accessibility-insights-web

### 判断
- 不新增公告板卡:现有“控制台 computer-use 观察/动作契约 v0”和“a11y 组件行为清单 v0”已覆盖落地方向;本轮建议把 ScreenSpot schema、spokenPhraseLog、Accessibility Insights 分层检查并入既有卡。



<!-- insight-scout-run:cr-1782892812317-insight-scout-repos-20260701-16 -->
## 2026-07-01 · 自动洞察(20260701-16 · pixel-assets-ui)

> 来源:洞察员; run=cr-1782892812317-insight-scout-repos-20260701-16; queue=insight-scout/insight-scout-repos-20260701-16; network=available

## 2026-07-01 · 自动洞察(20260701-16 · pixel-assets-ui)\n说明:network_status=available;已按 seen-repos/borrowed-libs/insights 去重,三项 URL 未见重复;只读公开 GitHub README/LICENSE,未登录、未安装、未处理授权或密钥。Peekaboo 截图不可用:当前 Chrome DevTools MCP 未连接且未检测到 Chrome,本轮不虚构截图。\n\n### systemcrash92/DogSprite\n- 是什么:MIT 的浏览器端离线像素画编辑器,README 强调无账号、无云端、绘制/保存/导出都在本机完成。\n- 值得借鉴:多标签工作区、图层/时间线/onion skin、PNG/GIF/spritesheet+Aseprite JSON 导出,适合作“素材生成后人工精修台”的控件清单。\n- 迁移边界/许可证不确定项:MIT;内置大量模板和 MCP server 只借信息架构与质量检查词表,不运行 server,模板商用前仍复核来源。\n- URL: https://github.com/systemcrash92/DogSprite\n\n### bukkbeek/GodotPixelRenderer\n- 是什么:MIT 的 Godot 3D 转像素工具,支持实时像素化、量化色阶、边缘/抖动/描边、逐帧 PNG 序列导出。\n- 值得借鉴:把“模型/动画→像素尺寸→调色/后处理→逐帧导出”做成可预览参数面板,可补素材管线的 3D 参考转像素分支。\n- 迁移边界/许可证不确定项:MIT;不引 Godot runtime,只借参数分组和导出报告思路;输入 3D 模型/动画授权需另核。\n- URL: https://github.com/bukkbeek/GodotPixelRenderer\n\n### spyrae/harness-control-plane\n- 是什么:BSL 2.0 的 AI coding tool 生态地图/控制台,聚合 skills、agents、MCP servers、sessions、usage、policies 等面板。\n- 值得借鉴:Command Center、Library Workbench、跨工具 badges、会话 replay、用量窗口和 diff-before-save,对口控制台优秀网页设计。\n- 迁移边界/许可证不确定项:BSL 2.0 有竞品限制;README 提到扫描凭据路径,玉兔6不可运行/照搬扫描器,只借 UI 信息架构且必须硬排除凭据文件。\n- URL: https://github.com/spyrae/harness-control-plane\n\n### 判断\n- 不新增公告板卡:同主题像素素材工作台/RFC 已有历史候选,本轮只补“离线精修台、3D 转像素参数面板、控制台生态地图”三项证据,避免重复堆 CEO 待办。



<!-- insight-scout-run:cr-1782907213479-insight-scout-repos-20260701-20 -->
## 2026-07-01 · 自动洞察(20260701-20 · unity-simulaid-methods)

> 来源:洞察员; run=cr-1782907213479-insight-scout-repos-20260701-20; queue=insight-scout/insight-scout-repos-20260701-20; network=available

## Unity/团结工作流方法论借鉴扫描(slot=20260701-20)
> network_status=available;已比对 seen-repos.json、borrowed-libs.md、insights.md,本轮 3 个 URL 未命中既有记录。仅做泛化方法研究,不触碰运行项目;Starlaid/星桥 全程排除。

### needle-mirror/com.unity.testtools.codecoverage
- 是什么:UPM 镜像的 Unity Code Coverage 包,可从自动化测试导出覆盖率数据与 HTML 报告,也支持手动 Coverage Recording。
- 值得借鉴:把“测试跑过”升级成“关键代码路径是否被覆盖”的报告门禁,适合沉淀 EditMode/PlayMode 回归覆盖清单。
- 迁移边界/许可证不确定项:镜像非官方发布源,LICENSE 为 Unity Companion License;落地应以 Unity Package Manager 与官方文档为准。
- URL: https://github.com/needle-mirror/com.unity.testtools.codecoverage

### needle-mirror/com.unity.memoryprofiler
- 是什么:UPM 镜像的 Unity Memory Profiler 前端包,用于采集、检查和解释应用内存分配与泄漏线索。
- 值得借鉴:将优化前后快照、泄漏排查和内存报告留档固定成工作流,减少只靠主观体感判断性能变化。
- 迁移边界/许可证不确定项:镜像非官方发布源,README 与 LICENSE 指向 Unity Companion License;只借快照/报告方法,不引入运行链。
- URL: https://github.com/needle-mirror/com.unity.memoryprofiler

### Unity-Technologies/AssetGraph
- 是什么:Unity 官方旧版可视化资产工作流自动化工具,用图形节点配置资产导入、AssetBundle 构建和 Player 构建前处理。
- 值得借鉴:把素材处理从口头步骤改成显式 DAG/节点清单,适合抽象“导入-设置-分组-构建-报告”的可复查流水线。
- 迁移边界/许可证不确定项:Unity Companion License;Unity 2019.4 文档标 preview/legacy,只借 graph workflow 语义和节点拆分方法。
- URL: https://github.com/Unity-Technologies/AssetGraph

### 判断
- 本轮三例均可并入既有“固化 Unity/团结工作流借鉴清单”方向,未形成需要新开 CEO 公告板卡的独立低风险行动。



<!-- insight-scout-run:cr-1782921614432-insight-scout-repos-20260702-00 -->
## 2026-07-01 · 自动洞察(20260702-00 · multi-agent-orchestration)

> 来源:洞察员; run=cr-1782921614432-insight-scout-repos-20260702-00; queue=insight-scout/insight-scout-repos-20260702-00; network=available

## 多智能体编排 / 任务 DAG / 交接协议借鉴扫描(slot 20260702-00)

> network_status=available;已比对 board/insights/seen-repos.json、borrowed-libs.md、insights.md,以下 3 个 URL 未出现;Starlaid/星桥 已排除。本轮不输出实时 star/commit/release,只记录可借鉴设计与许可证风险。

### apache/burr
- 是什么:Apache Burr 用状态机/流程图表达 AI 应用,强调状态、复杂决策、人类反馈、幂等与自持久化 workflow。
- 值得借鉴:Action + State + transition 的小模型适合控制台把 agent 工位、队列节点、人工确认建成可重放任务图。
- 迁移边界/许可证不确定项:GitHub API 显示 Apache-2.0;不要引入运行时,优先借鉴 GraphSpec、状态快照与重放语义。
- URL: https://github.com/apache/burr

### humanlayer/agentcontrolplane
- 是什么:面向长跑 outer-loop agents 的 Agent Control Plane,核心对象含 LLM、Agent、Tools、Task、ToolCall,支持异步执行与人工审批方向。
- 值得借鉴:Task Execution History、ToolCall 审计、Humans/Other Agents 作为工具,很贴近控制台的 CEO/主管/工位交接链。
- 迁移边界/许可证不确定项:README 写 Apache 2 License,但 GitHub API license=NOASSERTION,落地前需复核 LICENSE;项目 alpha 且偏 Kubernetes,只借对象模型。
- URL: https://github.com/humanlayer/agentcontrolplane

### agi-inc/agent-protocol
- 是什么:技术栈无关的 agent 通信 API,以 task 创建、step 执行、任务/步骤列表、artifact 上传下载为核心。
- 值得借鉴:POST task + POST step 的最小协议可作为控制台“交接单/续跑单”的外部化 schema 参考。
- 迁移边界/许可证不确定项:MIT;仓库路线图含未来 agent-to-agent,当前协议较轻,不覆盖复杂 DAG 调度,需结合 Burr/ACP 补状态与审计。
- URL: https://github.com/agi-inc/agent-protocol

### CEO 取舍建议
- 若要推进,只做协议草案和字段对照,不要引入任何框架运行时;优先定义 task_id、step_id、handoff_from/to、state_snapshot、artifacts、approval_gate、failure_resume。



<!-- insight-scout-run:cr-1782936014332-insight-scout-repos-20260702-04 -->
## 2026-07-01 · 自动洞察(20260702-04 · queue-engine)

> 来源:洞察员; run=cr-1782936014332-insight-scout-repos-20260702-04; queue=insight-scout/insight-scout-repos-20260702-04; network=available

## 20260702-04 队列调度可靠性借鉴
去重: 本地已见 Temporal、Airflow、Prefect、BullMQ、Sidekiq、Dramatiq、RabbitMQ、pg-boss 等 URL，本轮只列未见 URL。
### Netflix/maestro
- 是什么: Netflix 开源的工作流编排器，面向 Data/ML 的大规模 Workflow-as-a-Service。
- 值得借鉴: README/TechBlog 把 retries、queuing、task distribution、time trigger 和事件扩展拆成清晰模块，适合对照控制台任务生命周期。
- 迁移边界/许可证不确定项: Apache-2.0；Java/Spring/AWS/SQS 生态较重，只借鉴状态机、SLO 和事件流，不迁代码。
- URL: https://github.com/Netflix/maestro
### spotify/luigi
- 是什么: Spotify 维护的 Python 批处理工作流工具，覆盖依赖解析、调度、可视化和失败处理。
- 值得借鉴: 用 Task/Target 表达“完成证据”，让重试围绕可验证产物而不是只围绕进程退出码。
- 迁移边界/许可证不确定项: Apache-2.0；偏批处理/中心调度，不适合作为 agent 实时会话队列，只借鉴完成证据和失败 UI。
- URL: https://github.com/spotify/luigi
### dagucloud/dagu
- 是什么: 本地优先、单二进制的 YAML DAG/任务调度器，带 Web UI、队列、重试、日志和审批。
- 值得借鉴: “失败 run 保留快照、兼容编辑后继续重试”的议题很适合控制台定义失败处置边界。
- 迁移边界/许可证不确定项: GPL-3.0 且 SSO/RBAC/audit 等有 self-host 授权层；只能借鉴操作模型，不能拷贝实现。
- URL: https://github.com/dagucloud/dagu



<!-- insight-scout-run:cr-1782950414588-insight-scout-repos-20260702-08 -->
## 2026-07-02 · 自动洞察(20260702-08 · agent-tools-skills)

> 来源:洞察员; run=cr-1782950414588-insight-scout-repos-20260702-08; queue=insight-scout/insight-scout-repos-20260702-08; network=available

## 20260702-08 Agent Tools/Skills 能力库治理复看
### Kilo-Org/kilo-marketplace
- 是什么: 面向 Kilo 生态的社区市场，将 Skills、MCP Servers、Agents 放在同一资源目录；页面说明 Skill 以 SKILL.md 加可选 scripts/references/assets/examples 组织。
- 值得借鉴: 用一种目录协议承载技能、外部工具和专用 agent，适合控制台把“能力库”从散落 skill 升级为可审计目录。
- 迁移边界/许可证不确定项: 仓库标 Apache-2.0；需另查每个上架资源是否含第三方授权、脚本副作用和平台绑定。
- URL: https://github.com/Kilo-Org/kilo-marketplace
### fluxcd/agent-skills
- 是什么: Flux 官方 GitOps skills，可通过 Flux CLI 安装到 .agents/skills，并由 CLI 验证 OCI artifact 的 cosign 签名。
- 值得借鉴: “规范路径 + agent 专属 symlink + 签名更新”是能力包分发治理样板，可减少本地 skill 来源不明和版本漂移。
- 迁移边界/许可证不确定项: 仓库 Apache-2.0；控制台可先借鉴验签/安装清单，不照搬 Flux/K8s 领域内容。
- URL: https://github.com/fluxcd/agent-skills
### preset-io/agent-skills
- 是什么: Preset/Superset 的跨客户端 skills，按 API、MCP、CLI 三类插件包拆分，支持 Codex/Claude/Cursor/Copilot/Gemini 等加载方式。
- 值得借鉴: README 明确“用 MCP 包就不回退 API/CLI”的边界和 mutation 前确认，适合能力库治理里的路由与危险动作分级。
- 迁移边界/许可证不确定项: 仓库 Apache-2.0；涉及认证/业务 API 的部分只能借鉴边界写法，不复制具体密钥/登录流程。
- URL: https://github.com/preset-io/agent-skills

行动建议: 建议 CEO 只立一张评估卡：把控制台 skills/插件/agent 的入口清单、许可证字段、危险动作门禁、来源验签/版本更新策略合成一份“能力包准入规范”草案。
