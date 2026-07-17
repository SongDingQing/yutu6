# 洞察员 · 借鉴库清单

_更新:2026-06-20T12:12+08:00_

这份清单只记录「已经借鉴/分析过,值得后续回看上游更新」的外部库。去重与更新关注的机器可读数据在 `seen-repos.json`: `repos` 防重复推荐,`borrowed_libraries` 用于后续 watch。

## 使用规则

- 有新上游版本/commit 时,洞察员先复看 release/changelog/README diff,确认是否影响玉兔6,再补 `insights.md`。
- 只借鉴设计/机制/数据模型;是否落成开发任务,另开 CEO/主管 brief,不要把分析直接变成待办堆积。
- 不登录、不拉私有仓库、不回显密钥;需要授权的更新源交主人手动。

## 清单

| 库 | 类型 | 已借鉴点 | 当前建议 | Watch |
|---|---|---|---|---|
| proper-pixel-art | 像素素材清洗 | AI 粗糙像素图清洗成真像素网格 | 已用于办公室素材管线思路,后续看算法/CLI 更新 | 是 |
| unity-mcp | Unity MCP | LLM 端到端操作 Unity 编辑器 | Simulaid 方向保留,控制台只记录不处理 | 是 |
| Pixelorama | 像素画编辑器 | 人工精修/tileset/动画帧工作流 | 工具参考 | 是 |
| React Bits | 前端动效 | 动效审美与组件效果,需原生化 | 已有 webUI 动效借鉴任务,不引 React 链 | 是 |
| Mastra | 队列语义 | conversation-as-channel、interrupt/queue/steer | 部分采纳语义,不引运行时 | 是 |
| Inngest | 队列/flow control | priority、throttle、fairness、debounce/singleton | 借理念 | 是 |
| Restate | durable execution | journal/replay、virtual objects、exactly-once | 借持久化模式 | 是 |
| OpenAgents | agent workspace | 持久 URL、共享浏览器、A2A/MCP、Mod | 借手机/远程 workspace 范式 | 是 |
| cc-connect | 消息桥接 | 飞书/微信/Telegram 等双向桥接,多数场景无需公网 IP | 手机元宵端重要参考 | 是 |
| taste-skill | 前端设计 skill | Design Read、dials、redesign audit、image-first reference | 新增分析;部分采纳为 UI brief/checklist | 是 |
| Impeccable | 前端设计 skill | PRODUCT/DESIGN 上下文、23 命令、44 detector | 新增分析;部分采纳为设计上下文/静态规则 | 是 |
| open-multi-agent | DAG 多智能体 | goal-to-task DAG、依赖调度 | 借 DAG flow 思路 | 是 |
| claude-code-workflow-orchestration | Claude Code 编排插件 | plan-native 并行 wave、专职委派 | 部分采纳,不装插件 | 是 |
| claude-code-by-agents | 本地/远程 agent 编排 | @mention 寻址、本地/远程混合、一 agent 一仓库 | 借跨机协作范式 | 是 |
| awesome-agent-skills | skill 索引 | 外部 skill 选材源 | 纳入候选索引,不批量导入 | 是 |
| crewAI | 多智能体抽象 | role/crew/task、结构化输出 | 借抽象,不引 Python runtime | 是 |
| LiteLLM | LLM 网关 | provider 统一、virtual key、成本/限流 | 旁路候选,不替代 new-api | 是 |
| UGround | GUI grounding | GUI 元素定位模型选型 | 许可证/模型候选持续观察 | 是 |
| GUI-Actor | coordinate-free GUI grounding | 无坐标候选、grounding verifier | 有条件 canary 候选 | 是 |
| tech-leads-club/agent-skills | skill 注册库 | lockfile/hash/审计/渐进披露 | 借能力库治理机制 | 是 |
| AgentSkillsHub | skill 目录评分 | 质量评分、composability、trending | 借洞察员评分口径 | 是 |
| SkillSpector | skill 安全扫描 | 入库前 scan、SARIF、MCP 最小权限 | 建议行动候选 | 是 |
| Mission Control | agent 控制室 | 单 SPA 外壳、面板注册、实时推送、质量门 | 控制室信息架构参考 | 是 |
| claude-office | 像素办公室 | boss->员工可视化、多模式白板、AI 摘要 | 办公室状态动画参考 | 是 |
| agents-in-the-office | 像素 NPC 控制室 | tool->工位映射、human-gate 告警、autotile | 办公室交互优先参考 | 是 |
| Bifrost | AI 网关 | 语义缓存、MCP 网关、自适应负载均衡 | 借机制,不换网关 | 是 |
| Portkey Gateway | AI 网关治理 | 虚拟密钥、护栏、fallback/断路器 | 借治理配置范式 | 是 |
| Helicone | LLM 可观测 | session/trace、成本/延迟日志 schema | 已借面板 schema | 是 |
| UI-TARS | computer-use agent | 执行后截图比对、自愈、动作空间 | 建议行动候选 | 是 |
| Agent-S | computer-use 框架 | 双层经验记忆、generalist-specialist、ACI | 借记忆/分工模型 | 是 |
| UI-Venus | UI grounding/navigation | grounding/navi 解耦、本地小模型候选 | LocateAnything 对照参考 | 是 |
| PocketFlow | 极简图引擎 | Node/Action/Flow/SharedStore 100 行内核、prep/exec/post、嵌套 Flow | 引擎抽象外部对照,官方 TS 版可直接读,不引依赖 | 是 |
| Google ADK | agent 编排框架 | Sequential/Parallel/Loop 零-token 原语、分层 transfer/AgentTool | 借阶段4 五策略原语词汇,不搬 Python 运行时 | 是 |
| LangGraph | 持久化 agent 图 | checkpointer、interrupt 人审跨重启、时间旅行 fork | 借 human gate 持久化 + attempt 时间旅行 schema | 是 |

## 新增两项前端 skill 的落地提醒

- tasteskill 不应整包驱动控制台 dashboard。它的主 skill 更偏 landing/portfolio/redesign,玉兔6 只借「读 brief、调 dials、先 audit、image reference」。
- Impeccable 的 detector 比 hook 更适合先借鉴。hook/extension 涉及安装和授权,不自动执行;先抽取本地静态规则即可。
