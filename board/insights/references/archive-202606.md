# 洞察员冷区归档 archive-202606

> 迁移时间:2026-06-24T10:08:16.129Z
> 默认不要整卷读入上下文;先按仓库名、URL、月份或批次标题检索,只读取命中的相关小节。
> 本文件保留旧批次原文;热区直读入口在 `../insights.md`。

<!-- archive-origin: board/insights/insights.md -->

## 2026-06-19

### proper-pixel-art (KennethJAllen) — 修复 AI 生成的粗糙像素画
- 是什么:把 AI 生成的模糊/粗糙像素图、sprite 还原成「真像素分辨率」(Canny 边缘检测 + Hough 变换找像素网格)。有 CLI / Python API / Web UI。
- **值得借鉴**:**直接对口「员工画风太粗糙」** —— meowa 生成的素材过一遍 proper-pixel-art,就能得到干净、网格对齐的真像素图,显著提升办公室场景质量。
- 难度/优先级:低、**价值高 → 建议做成行动**(给办公室素材管线加一道 proper-pixel-art 清洗)。
- URL: https://github.com/KennethJAllen/proper-pixel-art

### unity-mcp (CoplayDev/unity-mcp) — Unity 编辑器的 MCP 桥
- 是什么:让 LLM 直接管 Unity 编辑器(资源/场景/脚本/PlayMode 测试/自动化工作流),支持 Claude/Codex/本地 LLM。
- **值得借鉴**:Simulaid 是 Unity 项目 —— 可给 Simulaid 主管/写码员工接 unity-mcp,让 agent **端到端操作 Unity 工程**(改脚本→PlayMode 跑测试),而不只是改文件、人工验。
- 难度/优先级:中。Simulaid 真正开动时优先级高。
- URL: https://github.com/CoplayDev/unity-mcp

### Pixelorama (Orama-Interactive) — 开源像素画编辑器
- 是什么:Godot 做的开源像素画/动画编辑器(调色板、图层、动画帧、tile)。
- **值得借鉴**:办公室像素素材的制作/微调参考;或作为人工精修 meowa 素材、拼 tileset 的工具。
- 难度/优先级:低(参考/工具)。
- URL: https://github.com/Orama-Interactive/Pixelorama

### React Bits (DavidHDev) — 动画 React 组件
- 是什么:110+ 炫酷动画/交互 React 组件(文字动画/背景/UI)。
- **值得借鉴**:玉兔6 网页(工作区/控制室)的设计动效 —— 但要移植成原生 JS/CSS 或 CDN(网页是原生 HTML、零依赖)。
- 难度/优先级:中。**已作为待办卡**(老板明确要做)。
- URL: https://github.com/DavidHDev/react-bits

---
注:本批前 3 个原是公告板待办卡,已按「洞察员出分析、不堆待办」修正为分析条目;其中 proper-pixel-art 因直接对口画风痛点、建议提为行动。
## 2026-06-20

> 本批选题:**任务队列引擎**(对口当前最优先的 #18 任务队列:叠加不等待 / 引导 steering / 插队 / 调换顺序)。三例分别覆盖「队列的 UX 语义」「队列的吞吐与公平」「队列/引擎的持久化」。

### Mastra(mastra-ai/mastra)— 能跑数小时的 agent「harness」,自带 interrupt/queue/steer
- 是什么:TypeScript 开源 agent 框架 + 一层 harness(长任务外壳)。核心思想是**把对话当成一条常开的 channel(pub/sub),而非一次性函数调用**——由此天然得到三种打断语义、多端同线程、崩溃可续。配套还有:事件流 → 单一 display state(reducer + 250ms 批量重绘,阻塞人的事件插队即时刷新);askUser / submitPlan 走 back-channel + Promise park/resolve **暂停等人**(无 harness 时降级为纯文本,可 headless 跑);有序**审批链**(per-tool deny → YOLO → session grant → category policy → ask,首个命中即决策);observational memory(观察者模型边跑边压缩,避免 compaction 丢决策)。设计详解博客 2026-06-05、GitHub ~25k★。
- **值得借鉴(多处,最对口 #18 队列)**:
  - **#18 任务队列**:它的 **interrupt / queue / steer** 正是我们要的 steering/follow-up——可直接照搬三语义的精确定义:`interrupt`=折入当前 run、不打断;`queue`(follow-up)=暂存、本 run 跑完才发;`steer`=丢弃当前 run + **清空已排队** + 重开。我们的「叠加不等待 / 引导 / 插队 / 调换顺序」可对齐到这套已验证语义,少踩坑。
  - **控制室 / 多端一致**:conversation-as-channel + pub/sub 让「web 端与元宵同后端、同总管、效果一致」有现成模式(多 subscriber 订同一 thread);而 **event → display-state reducer** 正对口控制室「实时事件流 → 六视图」的渲染层(UI 只读快照、不解析原始事件)。
  - **human gate**:askUser/submitPlan 的 back-channel + 无 harness 降级纯文本,正对口我们「human gate 用 typed card 不阻塞聊天」「同一 agent 也能 headless 跑」。
  - **引擎护栏**:有序审批链(首个命中即决)可借给引擎的工具放行策略。
- 难度/优先级:中;**对 #18(当前最优先)价值高 → 已提 1 张待办卡**(作为队列语义设计参照)。
- URL: https://github.com/mastra-ai/mastra

### Inngest(inngest/inngest)— 讲「公平」的多层队列 + 一整套 flow control
- 是什么:开源工作流编排平台,核心是一个**多租户感知、多层、讲公平**的队列,内置 flow control:并发上限(concurrency)、限流(throttle)、限速(rate limit)、去抖(debounce)、事件批处理(batch)、**优先级(priority,可按任意数据动态调执行顺序)**、单例(singleton)。明确定位「传统队列不适配今天的 AI workflow」。
- **值得借鉴(对口 #18 队列)**:
  - **插队 / 调换顺序**:它的 **priority**(按任意数据动态把关键任务提到队首)直接对口我们的「插队」「调换顺序」,可作为我们队列优先级字段与重排逻辑的参照。
  - **并发与限流**:concurrency / throttle 对口多 agent 并发时的限流、第三方 API(模型供应商)限速保护——和我们 per-agent 模型 + 故障转移可配套。
  - **公平性**:multi-tenant fair / multi-tier 的思路,可借鉴到「多项目 / 多 agent 共享一个队列」时避免某项目被饿死。
  - debounce / singleton 对口「同一触发短时间重复入队 → 去重 / 只跑一个」(如循环、定时任务重复触发)。
- 难度/优先级:中(以**理念借鉴**为主,不必引入其 Go 运行时);对 #18 队列设计价值高。
- URL: https://github.com/inngest/inngest

### Restate(restatedev/restate)— 单二进制 durable execution(journal/replay + virtual objects)
- 是什么:Rust 写的分布式 durable execution 引擎,**单二进制**自带 command log,无需另配数据库/队列。核心:**journal** 记录每步操作 + 结果,崩溃/失败后 **replay journal 跳过已完成步、从断点续跑**;**virtual objects** 按 key(用户/会话 id)保持状态一致并**串行化并发修改**(免单独写锁服务);服务间 **exactly-once**(请求-响应/单向消息/定时任务,无丢失无重复)。
- **值得借鉴(对口引擎可信地基 + 队列持久化)**:
  - **崩溃可续**:journal + replay 的「记录操作与结果、replay 跳过已完成步」正可强化我们引擎的 eventlog / taskstore / attempt——让长任务在进程崩溃后**从断点续**,而非整段重跑。
  - **virtual objects = 按 key 串行化**:对口队列里「同一 agent/会话的任务要串行、不同 key 可并行」,以及 human gate 等待期间的状态一致,省掉自己写锁。
  - exactly-once 消息语义可作为「叠加不等待」时投递保证的参照。
  - 注:Restate 是较重的外部系统(Rust 二进制),与我们 Node 零依赖路线不同 → **借鉴其设计模式即可,不一定引入其运行时**。
- 难度/优先级:中(理念/模式借鉴);优先级中。
- URL: https://github.com/restatedev/restate

---
注:本批围绕「任务队列引擎」一题,三例互补——Mastra 给队列的**打断语义/多端/human gate**(最对口 #18,已提 1 卡)、Inngest 给**优先级/限流/公平**、Restate 给**持久化/崩溃可续**。后两者只作分析参照,不堆待办。
## 2026-06-20

### OpenAgents (openagents-org/openagents) — Agent 协作 OS(3.8k★, Apache-2.0, Python+TS)
- 是什么:"Agent 版 Slack"。一个浏览器 workspace,人+多 agent 共享 threads/files/**实时浏览器**;@mention 派任务或 agent 自主接活;**持久 URL** 随时访问。Launcher(`agn`)统一装/配/连多种 coding agent(含 Claude Code/Codex/**Hermes**/Cursor);Network SDK = 事件原生 + Mod 系统 + **A2A/MCP 协议**;docker/daemon。
- **值得借鉴(玉兔6 没有的)**:
  1. **持久 URL + 远程/手机访问 + Tunnel** ⭐⭐ —— 每个 workspace 一个公开 URL,手机浏览器直接看、链接分享(无需安装即可查看)。**直接对口「手机元宵端」,比 cc-connect 消息桥接更彻底**(浏览器直达 workspace,不经消息平台中转)。Tunnel 一条命令把本地预览暴露成公网 URL → 手机看 agent 刚做的页面。
  2. **共享浏览器** —— 一个所有 agent + 人都能看的浏览器实例(开页/点击/截图/填表);玉兔6 有 Peekaboo/Chrome MCP 但不是「共享可见实例」。
  3. **A2A + MCP 协议互通** —— 标准化对外接口,玉兔6 agent 将来能和外部 agent/工具生态互通(现在是自有队列协议)。
  4. **事件原生 + Mod 模块系统**(messaging/files/browser/games 可插拔)—— 印证玉兔6 方向(engine-events + capability_registry),可借鉴其 mod 解耦。
- **玉兔6 已更强的**(别妄自菲薄):角色化组织(董事长→秘书→CEO→主管→员工)+ 队列路由,比它扁平的 @mention 更有层级;自愈维修员、记忆系统、洞察员等「自治运营」角色它没有;办公室/链路图可视化也更生动。
- **不要照搬**:OpenAgents 偏「开发者多机 agent 网络」、Python+TS+docker/daemon 重架构;玉兔6 是单机文件式零依赖、面向老板个人。借鉴**理念**(持久URL/共享浏览器/手机访问/A2A),不搬重架构。
- 难度/优先级:中。**最高价值 = 持久 URL + 手机访问,直接喂给「手机元宵端」设计**。
- URL: https://github.com/openagents-org/openagents
## 2026-06-20 · 第三批(选题:AI agent 工具与 skills;运行 04:08+08:00)

> 本批轮换到「AI agent 工具与 skills」,直接对口**能力库 1B + skills-lock.json + 按需拉 + 外部候选索引源**(此前已评估 VoltAgent/awesome-agent-skills,结论是「纳入候选索引源、按需拉 + License核验 + hash 锁」)。三例互补,形成一条「**选材 → 安检 → 入库**」的外部 skill 治理链:AgentSkillsHub 给**选材/质量评分**,SkillSpector 给**入库前安全扫描**,tech-leads-club/agent-skills 给**入库机制(lockfile/hash/审计/渐进披露)**。

### tech-leads-club/agent-skills — 「安全+校验」的 skill 注册库 + 渐进披露 MCP(2.3k★,代码 MIT / skill 文 CC-BY-4.0)
- 是什么:一个**强调安全与校验**的 skill 注册库 + 安装 CLI(`npx @tech-leads-club/agent-skills`),支持装到 Claude Code/Cursor/Copilot 等 20+ agent。核心不是 skill 数量,而是**入库与分发的工程化**:100% 开源无二进制、CI/CD 静态分析、**lockfile + 内容哈希做不可变完整性**、发布前每个 skill 过 Snyk Agent Scan;CLI 纵深防御(输入消毒 / 路径隔离 / 符号链接防护 / 原子 lockfile / **审计日志**);按需从 CDN 拉取 + 本地缓存(`~/.cache`)。配套 MCP server 用**渐进披露**:`list_skills`/`search_skills`/`read_skill`/`fetch_skill_files`——先搜、再只拉需要的文件。自陈「开放市场里 13.4% 的 skill 含严重问题」。
- **值得借鉴(最对口能力库)**:
  - **能力库 skills-lock.json 升级**:我们已有「License + hash 锁」,可直接补齐它的**原子 lockfile + 内容哈希 + 审计日志(audit trail)** —— 每次「按需拉 / 更新 / 移除」skill 都留痕、可回溯,出问题能定位是哪次拉进来的。
  - **安装管线纵深防御**:把它的 **路径隔离 / 符号链接防护 / 输入消毒** 借给能力库的「拉取-落盘」步骤,防止恶意 skill 写出目录、软链穿越。
  - **渐进披露 MCP** ⭐:`search → read → fetch` 正对口我们「41 项目技能改按需拉」的 token 经济——员工**先搜索再只加载需要的 skill 片段**,而非整库塞进上下文;可作为能力库对 agent 暴露接口的范式。
- 难度/优先级:中;对能力库价值高(机制可直接照搬,不必引入其 npm 运行时)。
- URL: https://github.com/tech-leads-club/agent-skills

### AgentSkillsHub(zhuyansen/agent-skills-hub)— 给 skill/MCP 打「质量分」的开源目录(296★,Python/FastAPI+React)
- 是什么:开源的 Claude Skills / MCP Server / Agent 工具**目录**,收录 6.2 万+ 项目,每 8 小时经 GitHub Actions 自动同步、分类(7 类)、打分。亮点是**一套可复用的质量评分体系**:6 个质量维度(完整度 15% / 清晰度 15% / 专一性 15% / 示例 12% / **README 结构 23%** / **Agent 就绪度 20%**)+ 9 个综合信号(质量 20% / star 18% / 新近度 11% / fork / commit / issue 解决率 / 势头 / 作者粉丝 / 体积),综合 0–100 分;还有 **composability(TF-IDF + 8 信号做 skill 配对)** 推荐互补 skill,以及 trending/rising/top-rated 榜。
- **值得借鉴(对口选材 + 洞察员自己)**:
  - **外部候选 skill 的评分门槛**:我们已决定维护「外部候选索引源、按需拉」,但缺**选哪些**的客观标准。可直接借它的**评分维度**做能力库准入打分——尤其「Agent 就绪度(API 文档/配置/安装/MCP 合规)」和「README 结构」,正是判断一个外部 skill 能否被员工即取即用的硬指标。
  - **composability/skill 配对**:对口「员工接到任务 → 自动推荐该配哪几个 skill」,可借其 TF-IDF + 信号配对思路做能力库的 skill 推荐。
  - **洞察员自身**:它「每 8h 自动同步 + 打分 + 榜单」与洞察员「每 4h 找案例」高度同构——其评分公式 / 榜单口径(trending/rising)可直接喂给洞察员,把「找到的案例」也量化打分排序,而非纯人工判断。
- 难度/优先级:中(以**评分体系借鉴**为主,不必部署其 Supabase 全栈);对选材与洞察员价值中高。
- URL: https://github.com/zhuyansen/agent-skills-hub

### NVIDIA/SkillSpector — skill 入库前的安全扫描器(113★,Apache-2.0,Python)
- 是什么:**专扫 AI agent skill 的安全扫描器**,回答「这个 skill 装不装得?」。**64 条漏洞规则 / 16 类**(提示注入、数据外泄、提权、供应链、越权代理、记忆投毒、工具滥用、流氓代理、触发滥用、危险代码 AST、**污点追踪 taint tracking**、YARA 特征、**MCP 最小权限 / MCP 工具投毒**等);两段式:快静态分析(正则 + AST + OSV.dev 实时 CVE 查询)+ 可选 LLM 语义评估(精度 ~87%);输出 terminal/JSON/Markdown/**SARIF**;风险分 0–100 给「SAFE / CAUTION / DO NOT INSTALL」建议。**关键契合点**:支持 `--no-llm` 纯静态、可接**本地 OpenAI 兼容端点(Ollama/vLLM)**、OSV 不可达时离线回退——和玉兔6「单机 / 保险库 / 离线优先」一致。研究背景:扫 42,447 个 skill,**26.1% 含漏洞、5.2% 疑似恶意**、带可执行脚本的 skill 出问题概率 2.12×。
- **值得借鉴(补能力库缺的那道门)**:
  - **按需拉前的安全门** ⭐:能力库现在有 License + hash,但**没有恶意/漏洞内容扫描**。可在「按需拉外部 skill」落盘前跑一遍 SkillSpector,DO NOT INSTALL 的直接拦下;这是把它的 `scan → 风险分 → 建议` 嵌进能力库准入。
  - **SARIF + 审计**:扫描产 SARIF/JSON,正好与上面 tech-leads-club 的审计日志合流,形成「每个入库 skill 都有一份安检报告」。
  - **MCP 工具投毒 / 最小权限规则**:对口引擎的「工具放行 / 护栏」——可借其 MCP least-privilege、tool-poisoning 规则审我们自己注册的工具与 MCP。
- 难度/优先级:低–中(CLI 即用、纯静态可离线);**因直接补上能力库安全缺口、且 26.1% 漏洞率有实证 → 建议提为行动(已加 1 张待办卡:localhost 跑扫描出报告,先不改管线)**。
- URL: https://github.com/NVIDIA/SkillSpector

---
注:本批围绕「AI agent 工具与 skills」,三例构成外部 skill 治理链(选材→安检→入库),全部对口能力库 1B + skills-lock.json。仅 SkillSpector 因补上「入库前安全扫描」这一明确缺口、提 1 张待办卡(评估+localhost canary,不改管线);另两者作机制/评分参照,不堆待办。
## 2026-06-20 · 第四批(选题:优秀网页设计 — 实时 agent 控制室 / 办公室可视化)

> 本批轮换到「优秀网页设计」,三例正好命中玉兔6 两块旗舰 UI:**控制室六视图**(实时事件流→面板)和**办公室视图**(坐姿小人按岗位分流)。难得的是后两个是**和我们办公室视图几乎一模一样的开源对手**(agent 活动→像素办公室 NPC),可直接对照「人家怎么做、我们能补什么」。三例互补:Mission Control 给**控制台/控制室的信息架构 + 实时推送 + 质量门**;claude-office 给**办公室 boss→员工可视化 + 多模式白板(对口六视图)+ AI 摘要**;agents-in-the-office 给**工具→工位的驱动映射 + human-gate 审批告警 + autotile 拼贴**。三者都是重技术栈(Next/React/PixiJS/Vue/Tauri/FastAPI/Rust),与我们「原生 HTML、零依赖」路线不同 → **借鉴信息架构/交互/动画/事件映射等理念,不搬技术栈**。

### Mission Control(builderz-labs/mission-control)— 自托管 agent 编排「指挥台」仪表盘(4.7k★,MIT,Next.js16+SQLite)
- 是什么:自托管的 AI agent 编排仪表盘。**32 个面板**(任务/agent/技能/日志/token/记忆/安全/cron/告警/webhook/流水线…)**全部挂在单个 SPA 外壳**上(`page.tsx` 路由所有面板 + `NavRail`/`HeaderBar`/`LiveFeed` 布局层 + Zustand store)。亮点:**实时一切 = WebSocket + SSE 推送 + 「离开页面就暂停轮询、零陈旧数据」的智能轮询**;**零外部依赖**(SQLite/better-sqlite3 WAL,一条 `pnpm start`,不要 Redis/Postgres/Docker);**质量门 Aegis**——任务没签核就**卡在「quality review」列、不让进 done**;Kanban 六列(inbox→assigned→in progress→review→quality review→done);成本面板(按模型拆 token,Recharts);RBAC(viewer/operator/admin + session/API key);自然语言定时任务("every morning at 9am"→cron,模板克隆派生子任务);**Gateway Optional 模式**(没网关也能独立跑任务板/项目/调度)。
- **值得借鉴(最对口控制室 + 控制台)**:
  - **控制室六视图的信息架构** ⭐:它「**单 SPA 外壳 + 面板注册表**」正对口我们「实时事件流→六视图」。可把六视图改造成「一个外壳 + 面板清单」,加第 7 个视图只是登记一项,而非改框架;`NavRail/HeaderBar/LiveFeed` 三段式布局是现成范式。
  - **实时推送的省力做法** ⭐:**「页面失焦就暂停轮询、回来再拉、零陈旧」** 是个极便宜的工程点——直接给我们 41218 常驻控制台 + workspace 任务板用,既保实时又省 CPU/请求,手机元宵端尤其受益。WebSocket+SSE 推送优先、轮询兜底的组合也值得对齐。
  - **质量门 = 我们的 review-loop**:Aegis「未签核不让进 done」就是我们 review-loop / CEO 串行锁 / §17 视觉门的产品化形态——可把「review 列 + 签核才放行」做成任务板的显式一列,让卡在评审的任务一眼可见。
  - **成本/token 面板**:对口我们 per-agent 模型 + new-api 网关——加一个「按模型拆 token/花费」面板,放进控制室,正好补 LLM 网关可观测性。
  - **RBAC 三档**:viewer/operator/admin 对口我们角色化组织 + 手机元宵端「老板只看 vs 可操作」的权限分层。
- 难度/优先级:中(借**信息架构 + 实时推送 + 质量门**理念,不引入其 Next/SQLite 栈)。对控制室升级价值高。
- URL: https://github.com/builderz-labs/mission-control

### claude-office(paulrobello/claude-office)— 实时把 Claude Code 操作演成像素办公室(306★,MIT,Next.js+PixiJS+FastAPI)
- 是什么:**和我们办公室视图同款**——实时像素办公室,**「老板」角色(主 Claude)管活、生成「员工」角色(子 agent)**,working/delegating/waiting 状态 + 思考/对话气泡。机制:Claude Code 生命周期 hooks → 后端 API → 状态机 → WebSocket 推前端渲染(事件:session/pre·post_tool_use/subagent/permission/context_compaction/reporting)。特色:**多模式白板**——一块白板用键盘 `0-9/T/B` **切 11 种视图**(待办/远程员工/工具用量饼图/**组织架构图**/时间线/热力图/news ticker…);**上下文额度可视化**(垃圾桶随上下文变满,compaction 时老板跺扁垃圾桶);**Haiku 生成 agent 名 + 任务摘要**(没 token 就显示原始 ID/工具名);打印机产出报告时动画;城市天窗按本地时间做日夜循环;事件详情弹窗(点事件看完整 payload);面板可拖拽缩放;i18n。
- **值得借鉴(直接对口办公室视图)**:
  - **多模式白板 = 六视图的另一种解** ⭐:与其六个固定视图,不如学它「**一块画布 + 键盘热键切多模式**」(组织架构图模式正对口我们角色化组织/链路图;工具用量饼图/热力图对口控制室指标)。我们六视图可借此压成更紧凑、可切换的「控制室白板」。
  - **boss→员工的状态动画词汇**:它把 working/delegating/waiting + 气泡讲得很清楚——我们办公室现在多是「坐着 idle」,可借它给坐姿小人补**委派/等待/产出**三态动画,让链路(董事长→CEO→主管→员工)在办公室里看得见。
  - **AI 摘要那一层**:Haiku 把原始工具事件压成「人话 agent 名 + 任务摘要」,正是我们任务板刚做的「折叠 goal、显示进展摘要」的同款思路——可统一用 MiniMax/Hermes 给办公室小人头顶/任务卡生成一句话摘要。
  - **上下文额度 + compaction 可视化**:用办公室道具(垃圾桶变满/被跺扁)表达「某 agent 近上下文上限/刚压缩」,比纯数字更直观,是办公室视图能加的一个有信息量的小动画。
  - **打印机出报告动画**:员工产出 artifact 时给个出纸动画,呼应我们「产物落盘」。
- 难度/优先级:中(借**白板多模式 + 状态动画 + AI 摘要**;它是 PixiJS/WebGL + Python 重栈,我们办公室是 DOM tile,**借交互与表达、不搬渲染栈**)。
- URL: https://github.com/paulrobello/claude-office

### agents-in-the-office(gukosowa)— agent 会话驱动像素 NPC,自带审批告警与 autotile(MIT,Vue+Tauri)
- 是什么:**又一个我们办公室视图的同款对手**,角度更工程化。真实 agent 会话控制 tile map 上的 NPC,**NPC 行为镜像 agent 实际动作**:写码→走到电脑、读文件→走到书架、idle→闲逛。架构干净:Claude Code hooks 写 JSON 事件 → Rust 文件监视 → 前端 `AgentDriver`(BaseDriver 抽象,**tool→办公对象映射**)→ `NpcHandle`→`Character`(A* 寻路+命令队列);子 agent = 带 badge 的独立 NPC + 连线到父;事件存 IndexedDB 跨重启。三个亮点 UX:**①审批告警**——agent 等用户批准时,**镜头猛拉到该 NPC + 警示牌 + 红色脉冲暗角**抓注意力;**②prompt 顶在头上**——每个 NPC 头顶显示最后一条用户 prompt,多会话一眼区分;**③agent 门**——NPC 开局从门进、会话结束从门出。另有 **autotile 引擎(含墙体 autotile,RPG Maker XP/VX 资源直接加载)**、`.aito` 单文件可分享地图(base64)、声音包、按工具寻路到对应道具。附一张「事件→NPC 行为」对照表(session_start→进门、tool_start→走向对象、permission_wait→等待指示、subagent→badge+连线)。
- **值得借鉴(给办公室视图补「会动 + 会报警」)**:
  - **tool→工位 的驱动映射** ⭐:它的 `BaseDriver`「每个工具映射到一个办公对象/行为」是让坐姿小人活起来的关键——我们可建一张 `工具→工位` 表(Read→资料/书架、Bash/编译→终端、Edit→电脑、Web→…),让 agent 当前动作驱动小人走到对应工位,而非全员干坐。它的**「事件→NPC 行为」对照表**几乎能 1:1 套到我们 engine-events。
  - **human-gate 审批告警** ⭐⭐:**镜头聚焦 + 警示牌 + 脉冲红光**正对口我们 human gate / §17 视觉门——现在 human gate 是张容易被忽略的 typed card,加一层「办公室里高亮该工位 + 红光脉冲」的主动提醒,价值很高、且只动 workspace.html。
  - **prompt 顶头 + agent 门**:小人头顶显示最后 prompt、开局进门/结束出门,把会话生命周期讲清楚,多 agent 并行时尤其有用。
  - **autotile(含墙体)**:我们办公室视图一直在手工拼 seamless 地面/墙(status-rollup 里大量 DOM tile 返工),它的 XP(3×4)/VX(2×3)autotile 引擎能**自动选对墙角/边缘 tile**,可借给像素素材/办公室拼贴管线,省人工对齐。`.aito` base64 单文件存图也契合我们文件式零依赖。
- 难度/优先级:中(借**驱动映射 + 审批告警 UX + autotile**;它是 Vue+Tauri+Rust 桌面壳,我们是原生 HTML 网页,**借理念不搬壳**)。其中 human-gate 审批告警 + 工具→工位映射最值得立刻落地。
- URL: https://github.com/gukosowa/agents-in-the-office

---
注:本批围绕「优秀网页设计」,三例全部对口控制室六视图 + 办公室视图;后两个是几乎同款的开源对手,直接给「人家怎么做」的对照。仅就 **办公室视图「工具→工位驱动映射 + human-gate 审批告警(镜头/高亮+警示+脉冲红光)」** 提 1 张待办卡(借鉴 agents-in-the-office + claude-office 状态动画,只动 workspace.html、零依赖、走 review-loop+Peekaboo 截图);它与已在板上的 React Bits 卡(通用动效移植)不重复——前者是「让办公室会动 + 会报警」的具体功能,后者是通用视觉效果。Mission Control 与 claude-office 的其余点作信息架构/交互参照,不堆待办。
## 2026-06-20 · 第五批(选题:LLM 网关 — 路由性能 / 治理护栏 / 可观测;运行 ~04:1x）

> 本批轮换到「LLM 网关」,直接对口玉兔6 现用的 **new-api 网关** + 我们自己在第四批就点名的缺口「**网关可观测性 / 按模型拆 token·花费面板**」。三例正好构成网关三件套:**Bifrost = 路由本体的性能 + MCP 网关 + 语义缓存**;**Portkey = 治理/护栏/虚拟密钥/可靠性**;**Helicone = 可观测(日志/成本/延迟/会话追踪)**。三者都是独立服务(Go/TS/全栈),与玉兔6「单机文件式零依赖 + 现成 new-api」路线不同 → **借鉴能力与数据模型,不整体换网关**(new-api 已在跑,只补它缺的那几块)。

### Bifrost(maximhq/bifrost)— 号称最快的企业级 AI 网关,单二进制内含 MCP 网关 + 语义缓存(Apache-2.0,Go)
- 是什么:Maxim 团队用 Go 写的自托管 AI 网关,主打**极低开销**(自称比 LiteLLM 快 50×、5k RPS 下每请求 ~11µs / <100µs 开销,绕开 Python GIL 瓶颈)。一个二进制 / 一条 `npx -y @maximhq/bifrost` 或单 Docker 起;**自托管为主、无托管云**。能力:1000+ 模型统一接入、**自适应负载均衡 + 集群模式**、护栏、多模态(文本/图像/音频/流式)、**MCP 网关(让模型用外部工具)内置在同一进程**、**语义缓存(exact-match + 语义相似命中)**降重复查询的成本与延迟。
- **值得借鉴(对口 new-api 的「省钱省延迟 + 工具治理」)**:
  - **语义缓存** ⭐:玉兔6 多 agent 常跑相似 prompt(同类维修/同类研究/重复体检),给网关层加一层**语义缓存**(相似问题命中已有回答)能直接砍 token 花费与等待——这是 new-api 默认没有、但对「常驻多 agent」收益极大的一项。可借其 exact+semantic 两级缓存思路。
  - **MCP 网关收口** ⭐:它把「模型调外部工具」统一收在网关里。对口玉兔6 把 engine 的工具放行 / MCP 接入**集中到一处治理**(配额、超时、最小权限),而非每个 agent 各自接;与第三批 SkillSpector 的「MCP 工具投毒 / 最小权限」规则可合流。
  - **自适应负载均衡 + 集群**:对口我们 per-agent 模型 + new-api 多 key/多上游——可借「按延迟/健康度自适应分流 + 故障转移」,让某上游抖动时自动切,提升常驻队列稳定性。
- 难度/优先级:中(借**语义缓存 + MCP 收口**理念给 new-api/引擎,不必换成 Bifrost 本体)。对省钱与稳定性价值中高。
- URL: https://github.com/maximhq/bifrost

### Portkey AI Gateway(Portkey-AI/gateway)— 自带 40+ 护栏的快网关,2026-03 整套企业功能转开源(Apache-2.0,TypeScript,~11.6k★)
- 是什么:路由到 **1600+ 模型 / 250+ 提供商**的统一 OpenAI 兼容网关。2026-03 的 Gateway 2.0 把整套企业功能**全部开源(Apache-2.0)**:**40+ 内置护栏**(PII 脱敏 / 越狱检测 / 合规校验,作用于输入与输出)、**虚拟密钥**(用自己的 key 或临时生成虚拟 key)、**断路器 + 用量策略**、负载均衡 / **回退(fallback)/ 指数退避重试 / 超时**、**智能缓存(简单 + 语义)**、**MCP 网关(OAuth 2.1)**、**模型目录(model catalog)**。自托管即记录 request/response/成本/**护栏违规**日志。
- **值得借鉴(最对口治理 + 可靠性)**:
  - **虚拟密钥 + 用量策略** ⭐:对口玉兔6「角色化组织 + per-agent 模型」——给每个角色/员工发**虚拟 key**(而非共享真 key),配独立预算/限速/用量策略,既能**按角色拆成本**,出问题也能单独吊销某个 agent 的 key,而不动主密钥(也契合我们「密钥不回显 / 保险库」红线)。
  - **护栏作输入输出双向**:40+ 护栏(尤其 PII 脱敏 / 越狱检测)对口引擎 §17 视觉门/护栏的**文本侧**——可在网关层给所有 agent 统一加一道 PII/越权输出过滤,而非逐 agent 实现。
  - **回退 + 断路器**:对口常驻队列稳定性——某上游/模型失败自动回退到备选模型,断路器防雪崩;比 new-api 现有重试更系统。
  - **MCP 网关(OAuth 2.1)**:对口工具/MCP 接入的鉴权收口。
- 难度/优先级:中(借**虚拟密钥/用量策略 + 护栏 + 回退**;它是 TS 服务,可作 new-api 旁路或借其配置范式,不必整体替换)。对治理与成本归集价值高。
- URL: https://github.com/Portkey-AI/gateway

### Helicone(Helicone/helicone)— 一行接入的开源 LLM 可观测平台,可整套自托管(GPL-3.0,YC W23,TypeScript)
- 是什么:开源 **LLM 可观测平台**,「一行代码」接入即监控/评测/实验。`docker-compose` 整套自托管、**轻量可跑在小机器**;**数据主权**——所有 LLM 交互留在自家防火墙内(prompt/模型数据不外流,契合我们单机/离线优先)。能力:为 agent / chatbot / 文档流水线**观测 traces & sessions**,分析**成本 / 延迟 / 质量**;统一 100+ 提供商,带智能路由 / 自动回退 / 统一可观测。另有姊妹仓库 **Helicone/ai-gateway**(Rust,主打「最快最轻、易接入」的网关本体)。
- **值得借鉴(直接补我们点名的「网关可观测性」缺口)**:
  - **会话/链路级 traces** ⭐⭐:我们是**多 agent 串成链(董事长→CEO→主管→员工)**,Helicone 的 **session/trace 模型**(把一串调用聚成一个 session、可下钻每步成本/延迟)正对口——能把「一张任务卡从派单到产出」的**整链 token/延迟/花费**串起来看,而不是孤立看单次调用。这是控制室六视图最该补的一块。
  - **可观测数据模型(可原生复刻)** ⭐:它定义的字段(model / tokens in·out / cost / latency / status / session_id / 用户标签)是一套现成、好用的**日志 schema**。玉兔6 可**不部署 Helicone 全栈**(GPL-3.0 + docker 多服务,重),而是照搬这套 schema,从 new-api 已有请求日志里抽出来,渲染成控制室的「**按模型/按角色拆 token·花费·延迟**」面板——零依赖、纯前端读日志即可。
  - **本地模型也覆盖**:它能观测本机跑的开源模型,契合我们混用云模型 + 本地端点。
- 难度/优先级:低–中(**借数据模型做原生面板**最省力且零依赖;真要整套自托管则中,且注意 GPL-3.0,只借 schema/理念不 vendor 其代码即可规避)。对控制室可观测价值高。
- URL: https://github.com/Helicone/helicone

---
注:本批围绕「LLM 网关」,三例对口 new-api 网关 + 控制室可观测。三者均为独立服务,与玉兔6「现成 new-api + 零依赖」路线不同 → 借能力与数据模型、不整体换网关。仅就**「网关可观测性面板(按模型/按角色拆 token·花费·延迟 + 会话链路)」**提 1 张待办卡——这是玉兔6 第四批已自陈的缺口、现有三家现成 schema 可照搬、且可做成 localhost 只读 + 零依赖原生面板(不动 new-api 生产路径),与板上 React Bits / 办公室视图卡不重复(那两张是视觉动效,这张是可观测数据面板)。Bifrost 语义缓存 / Portkey 虚拟密钥·护栏·回退 / MCP 收口等作机制参照,价值高但属较大设计变更,**留作分析、不堆待办**。
## 2026-06-20 · 第六批(选题:GUI grounding / computer-use agents — 视觉定位 / 执行后反思 / 通用-专用分工;运行 ~08:0x）

> 本批轮换回「GUI grounding / 计算机操作 agent」(上次覆盖还是早批的 UGround / GUI-Actor)。直接对口玉兔6 的 **computer-use 能力**(本洞察任务本身就跑在 Cowork computer-use 里)+ 板上在飞的 **Peekaboo 截图/点击** 与 **LocateAnything-3B 视觉定位** 两张卡 + **Simulaid 自绘环境里 agent「看屏操作」**。三例正好构成 computer-use 三件套:**UI-TARS = 原生 agent + 执行后反思自愈**;**Agent-S = 通用-专用分层 + 双层经验记忆**;**UI-Venus = grounding/navigation 解耦的专用模型(含可本地跑的小模型)**。三者都偏「模型/框架本体」,与玉兔6「零依赖 + 现成 new-api/Peekaboo」路线不同 → **借机制与动作/记忆数据模型,不必自托管其 7B/72B 模型**。

### UI-TARS(bytedance/UI-TARS + UI-TARS-desktop)— 最大的开源 GUI agent,纯截图输入 + System-2 执行后反思自愈(Apache-2.0,~33.5k★)
- 是什么:ByteDance 的原生 GUI agent,**只吃截图**就跨桌面/移动/web 操作,动作收敛到一套**平台无关的统一动作空间**(click/type/scroll/drag…)。核心是 **System-2 反思**:任务分解 + 对历史动作反思 + 里程碑识别,尤其**执行一步后对比前后截图,发现「没落地/点错」就自动生成纠错计划重试**。配套 `UI-TARS-desktop`(Agent TARS)是完整的多模态 agent 应用栈(模型 + agent infra + 桌面壳)。
- **值得借鉴(直接对口 computer-use + review-loop + Peekaboo)**:
  - **执行后截图比对 + 失败自愈** ⭐⭐:玉兔6 用 computer-use 操控桌面,现在多是「点了就当成功」。借 UI-TARS 的 System-2 反思——每个 computer-use 动作后截图比对预期,没落地就自动补纠错步骤,把「点空/点错/弹窗挡住」从**静默失败变成自愈**。这正好叠在板上已有的 **Peekaboo(截图/点击基线)** 与 **review-loop** 上,是它们最自然的下一步。
  - **平台无关的统一动作空间**:它把动作抽象成与平台无关的 schema——对口我们 computer-use 工具集 + **Simulaid 里 agent 操作自绘环境**,可借其动作词汇表让「engine 动作→实际执行」一套语义同时跑桌面与 Unity。
  - **里程碑识别**:长任务里标「到哪步算一个里程碑」,对口任务卡的进展摘要——给长跑任务补里程碑态,而非只有「跑着/完成」两态。
- 难度/优先级:中–高(借**执行后反思自愈**价值最高且能立刻叠在 Peekaboo/review-loop 上;模型本体重,借机制不必自托管)。**本批唯一出待办卡的点**。
- URL: https://github.com/bytedance/UI-TARS

### Agent-S(simular-ai/Agent-S,S1/S2/S3)— 「像人一样用电脑」的开源框架:通用-专用分层 + 叙事/情景双层经验记忆(SOTA on OSWorld)
- 是什么:Simular 开源的 agentic 框架。三大件闭环:**经验增强的分层规划** + **持续更新的叙事记忆(narrative,整任务级经验)与情景记忆(episodic,子任务级经验)** + **Agent-Computer Interface(ACI,专为 agent 设计的受限感知/动作接口)**;规划还会**检索在线网页知识**补外部经验。S2 升级为**组合式 generalist-specialist**:通用规划模块 + 专用 grounding 专家(**Mixture-of-Grounding**)+ **主动分层规划**(多时间尺度动态 refine 计划);在 OSWorld 等三大基准 SOTA,相对 Claude Computer Use / UI-TARS 提升 18.9% / 32.7%。
- **值得借鉴(对口 角色化组织 + per-agent 模型 + 记忆 + #18 队列 steering)**:
  - **叙事 + 情景双层经验记忆** ⭐⭐:这是玉兔6 目前最大缺口之一——我们有 seen-repos/insights 这类「文件式静态记忆」,但没把 **agent 执行经验**结构化复用。借 Agent-S 双层:`narrative`(整任务怎么干成的)+ `episodic`(某子任务的具体步骤),落成**文件式经验库**,让重复类任务(同类维修/体检/研究)先检索过往成功经验再规划——**零依赖、纯文件即可复刻**,对常驻多 agent 收益极大。
  - **generalist-specialist 组合 = 我们董事长→CEO→主管→员工的理论支撑** ⭐:它把「通用规划」与「专用 grounding/执行」拆给不同模型,正对口玉兔6 **per-agent 模型**(强模型做规划、小模型做执行/定位)。可借其 **Mixture-of-Grounding**:同一动作按场景选最合适的执行专家,而非全用一个大模型,省钱又准。
  - **主动分层规划(多尺度动态 refine)**:计划不一次定死、随执行在高/低层动态修正——这是 **#18 队列「引导 steering / 插队 / 调换顺序」的算法版**。
  - **ACI 受限接口**:把「给 agent 用的电脑接口」抽象成受限动作集(而非直接喂原始 OS),对口我们 engine 工具放行 / 最小权限。
- 难度/优先级:中(借**双层经验记忆**最值,可纯文件零依赖落地;generalist-specialist 已对口现有 per-agent 设计)。属较大设计点,**留作分析与理念,不堆卡**。
- URL: https://github.com/simular-ai/Agent-S

### UI-Venus(inclusionAI/UI-Venus)— 把 grounding 与 navigation 拆成专用模型,含可本地跑的 2B/8B 小模型(Qwen2.5-VL 基座,ScreenSpot-Pro SOTA)
- 是什么:蚂蚁 inclusionAI 的原生 UI agent,纯截图输入,RFT(强化微调)+ 高质量数据训成。亮点是**把能力拆成两类专用模型**:**UI-Venus-Ground(定位:屏幕上点哪)** 与 **UI-Venus-Navi(导航:下一步做什么)**,各出 7B/72B;1.5 版再合成端到端(2B/8B dense + 30B-A3B MoE),ScreenSpot-Pro 69.6 SOTA;配 Android 自动化框架,实测覆盖 40+ 中文 app(微博/小红书/淘宝/美团/B站/支付宝)。(许可证以仓库为准)
- **值得借鉴(对口 computer-use grounding + Simulaid + 本地小模型)**:
  - **grounding 与 navigation 解耦 = 又一份 generalist-specialist 佐证** ⭐:它把「点哪(ground)」和「下一步(navi)」拆成两个模型,印证玉兔6 可走「规划模型 + 轻量 grounding 模型」分工;尤其 **2B/8B 小模型能本地跑**,对口我们混用云 + 本地端点——**grounding 这种高频低脑力动作可下沉本地小模型**,省云端 token。
  - **纯截图 grounding(不依赖无障碍树)** ⭐:对口 computer-use 在没有 a11y 树 / 自绘 UI(游戏、Canvas、**Simulaid 像素环境**)时的定位——Simulaid 自绘像素环境拿不到 a11y,正需要**视觉 grounding**;UI-Venus-Ground 这类截图定位模型是「看屏点击」的现成候选,**可与板上 LocateAnything-3B 卡互为选型对照**(同为视觉定位、Qwen2.5-VL 基座且有小模型,值得比许可证/本地可跑性)。
  - **40+ 真实 app 的导航基准(VenusBench)**:对口我们想让 agent 操作真实国内应用——可借其评测维度给 computer-use 做能力体检。
- 难度/优先级:中(借**ground/navi 解耦 + 本地小 grounding 模型**理念,并作 LocateAnything-3B 的选型对照;真接模型需推理部署属中等)。**作分析与选型参考,不堆卡**。
- URL: https://github.com/inclusionAI/UI-Venus

---
注:本批围绕「GUI grounding / computer-use」,三例对口 computer-use + Peekaboo/LocateAnything 两张在飞卡 + Simulaid 自绘环境定位。三者偏模型/框架本体,与玉兔6 零依赖路线不同 → 借机制与动作/记忆数据模型、不自托管其模型。仅就 **UI-TARS 的「computer-use 执行后截图比对 + 失败自愈」** 提 1 张待办卡——它直接叠在板上 **Peekaboo 截图基线 + review-loop** 之上(把「点了就当成功」变成「截图核验 → 没落地自动纠错」),零依赖、只动 computer-use/控制台 agent 循环,与板上 Peekaboo 卡(基线打通)、LocateAnything-3B 卡(视觉定位模型)、网关可观测卡均不重复。**Agent-S 双层经验记忆 + generalist-specialist**、**UI-Venus grounding/navi 解耦(并作 LocateAnything-3B 选型对照)** 价值高但属较大设计/选型,**留作分析、不堆待办**。
## 2026-06-20 · 第七批(选题:前端设计 skills — tasteskill / Impeccable;运行 18:2x+08:00)

> 老板指定研究两个前端设计 skill,目标不是立即改 webUI,而是提炼「玉兔6 webUI 能借鉴什么」。两者都在解决 AI 前端常见的模板感问题,但侧重点不同:tasteskill 更像一套可移植的设计品味技能族,靠 brief 推断、设计方向 dials、redesign/image-to-code 分流提升生成质量;Impeccable 更像一套可执行的设计语言与质量门,靠 PRODUCT/DESIGN 上下文、23 条命令、44 条确定性 detector 把「不好看」变成可检查的工程信号。玉兔6 当前是原生 HTML/CSS/JS、控制台/办公室/任务板型产品 UI,所以只借鉴流程、检查表、检测规则与轻量文档,不引入 React/构建链,不自动安装 hook。

### Taste Skill(Leonxlnx/taste-skill) — 反 AI 模板感的多 skill 前端设计框架(MIT)
- 是什么:面向 Cursor / Claude Code / Codex / Gemini CLI 等 agent 的开放 SKILL.md 技能族。默认 `design-taste-frontend` 已进入 v2 experimental:读 brief,推断设计语言,用 `DESIGN_VARIANCE` / `MOTION_INTENSITY` / `VISUAL_DENSITY` 三个 dials 控制布局实验性、动效深度、信息密度;另有 `redesign-existing-projects`、`image-to-code`、`gpt-taste`、`minimalist-ui`、`imagegen-frontend-web/mobile`、`brandkit` 等分工技能。公开 README 明确 MIT、约 47.3k stars;本次记录 HEAD `5285855`。
- **值得借鉴(对口玉兔6 webUI)**:
  - **先写 Design Read**:每次改 `workspace.html` 前,先用一句话声明「页面类型 / 受众 / 视觉语气 / 设计系统倾向」。玉兔6 应默认读作**高密度本地控制台/任务板产品 UI**,不是 landing page,这能阻止员工套用大 hero、紫蓝渐变、营销卡片。
  - **三 dials 变成本地 UI brief 参数**:控制台默认 `variance=3-5`、`motion=2-4`、`density=7-9`;办公室/动画视图可局部提高 motion,任务板/模型用量保持高密度低干扰。比「做高级一点」这种口头要求更可执行。
  - **redesign 先 audit 后改**:借 `redesign-existing-projects` 的口径,现有页面先列保留项/问题项/现代化杠杆,再动代码;正对口控制台反复出现的滚动、文字溢出、卡片层级、按钮拥挤问题。
  - **image-first 只作参考图,不作实现依赖**:重大页面重做可先用 `imagegen-frontend-web` 生成参考帧,再让 Codex 以原生 HTML/CSS 复刻;避免直接引入 React 或新构建链。
- 难度/优先级:低-中、价值高。建议**部分采纳**为「UI brief 模板 + redesign audit checklist + dials」,暂不安装 skill 到项目。注意其主 skill 自身声明更适合 landing/portfolio/redesign,不是 dashboard/data table/multi-step product UI,所以玉兔6要挑 redesign/minimalist/gpt-taste 里的规则,不整包照搬。
- URL: https://github.com/Leonxlnx/taste-skill

### Impeccable(pbakaus/impeccable) — 设计语言 + 命令体系 + 反模板 detector(Apache-2.0)
- 是什么:面向 AI coding harness 的前端设计技能与工具链。公开 README 写明:1 个 skill、23 条 `/impeccable` 命令、live browser iteration、44 条 deterministic detector rules;`init` 会写 `PRODUCT.md` / `DESIGN.md`,区分 brand / product 两种 register;CLI 可 `npx impeccable detect src/` 扫目录/HTML/URL,无 LLM、无 API key也能查 AI slop 与基础设计质量问题。GitHub 显示 Apache-2.0、约 39.7k stars、latest release `Extension 1.2.1`(2026-06-19);本次记录 HEAD `2210648`。
- **值得借鉴(对口玉兔6 webUI)**:
  - **把设计上下文持久化**:借 `PRODUCT.md` / `DESIGN.md` 思路,控制台可维护一份轻量 `webUI 设计上下文`:产品是本地多 agent 控制台,核心用户是老板/运维者,语气是安静、高密度、可扫读、低装饰。以后员工改 UI 先读它,减少每次重申。
  - **23 命令拆成工作流语言**:`shape`(先定信息架构)、`critique`(主次/清晰度/情绪)、`audit`(a11y/性能/响应式)、`polish`(交付前统一),可直接映射到玉兔 review-loop 的前端节点命名,让“美化一下”变成可复核步骤。
  - **44 detector 规则最值得工程化**:不一定跑其 npm,但可借规则类型做本地静态门:禁嵌套卡片、过度紫蓝渐变/发光、无意义 icon tile、过小触控目标、文本溢出、跳级标题、灰字压彩底、bounce 动效等。这个比单纯主观审美更适合控制台长期回归。
  - **product mode 优先**:Impeccable 明确 brand work 和 product UI 是两套规则。玉兔6 的任务板、模型用量、办公室态势应走 product mode:信息密度、状态层级、可操作性优先,视觉创意只服务扫描与决策。
- 难度/优先级:中、价值高。建议**部分采纳**为「webUI 设计上下文 + detector 规则清单 + review-loop 命令词汇」。暂不自动安装 hook/extension;Codex hook 需要人工在 `/hooks` 批准,按边界交主人手动。
- URL: https://github.com/pbakaus/impeccable

---
注:本批不新增 webUI 待办卡,因为老板本意是先沉淀借鉴分析与更新关注。若后续要落地,最小行动不是“装两个 skill”,而是先做三件轻量事:① 控制台 UI brief 模板加 `Design Read + dials`;② 写一页 webUI 设计上下文;③ 从 Impeccable detector 抽 10-15 条零依赖静态检查规则接入前端 review-loop。
## 2026-06-20 · 第八批(选题:多智能体编排 / 编排框架 — 极简图引擎 / 确定性工作流原语 / 持久化中断与时间旅行;运行 ~12:0x)

> 本批轮换回「多智能体编排 / 任务队列引擎」——这是玉兔6 蓝图的**心脏(阶段2 编排引擎 + 阶段4 协作策略)**,且最近三批(网关 / grounding / 前端 skill)都没碰它。三例正好从三个互补角度照我们已搭的 `shared/engine/`:**PocketFlow = 把「图」压到 ~100 行的极简零依赖内核(对口我们声明式路由执行器本体)**;**Google ADK = 确定性工作流原语(Sequential/Parallel/Loop)+ 分层多智能体(对口零-token 路由 + 阶段4 五策略 + 角色化组织)**;**LangGraph = checkpointer 持久化 + interrupt 人审 + 时间旅行(对口 human gate + attempt/重放 + 控制室)**。三者(尤其 ADK/LangGraph)体量都比我们「单机文件式零依赖 Node」重 → **借抽象 / 原语 / 数据模型,不引其运行时**;难得的是这三家彼此独立却都收敛到我们已经搭的那套图抽象,等于给现有引擎做了一次外部验证。

### PocketFlow(The-Pocket/PocketFlow)— 把 LLM 编排压成 ~100 行的极简图内核,零依赖零供应商锁定(MIT;另有官方 TypeScript 版)
- 是什么:用「**嵌套有向图**」表达一切 LLM 工作流的极简框架——核心只有四件:**Node(干活,prep→exec→post 三段)/ Action(带标签的边,决定走哪条)/ Flow(把 Node 按 Action 串成图,且一张 Flow 可作为节点嵌进更大的 Flow)/ Shared Store(节点间通信的共享态)**;再加 Batch(数据密集)与 Async(并行 / 等待)两类节点。零依赖、零配置、不锁 LLM 客户端——「你带自己的 LLM/DB/whatever,框架只负责编排这张图」。一套抽象即可拼出 Multi-Agent / Workflow / RAG。官方有 Python + **TypeScript** + Go/Rust/Java/C++/PHP 多语言移植,核心都是一个文件。
- **值得借鉴(直接对口 `shared/engine/` 声明式路由执行器本体)**:
  - **「Action = 带标签的边」正是我们 Jinja2 条件边的极简版** ⭐:PocketFlow 的 `post()` 返回一个 action 字符串来选下一条边,**零 LLM token** 决定路由——这与我们「读 `flows/*.yaml`、算条件边、零 token 选下一节点」是同一机制的两种写法。可拿它的 ~100 行 **TypeScript 内核**当**对照参照**,在任务#13(Mac 真 CLI 验证引擎)前**交叉核对我们 condition/engine 的抽象是否有缺漏**(尤其下面两条),零依赖、纯读码。
  - **Node 三段式 prep→exec→post = 我们信封运行时的天然范式** ⭐:prep(按 need-to-know 读上下文)→ exec(spawn CLI/LLM 干活)→ post(单写 result + 返回 action 选边),正好把我们「**单写主原则 + 按路径白名单喂上下文(explicit)**」落成一个节点的标准生命周期;建议把 cli-runner 的节点约定显式写成这三段。
  - **嵌套 Flow(一张图当一个节点)= planner 子图交回确定性编排** ⭐:对口阶段4「结构未知时 planner 产子图、再交回确定性编排」——PocketFlow「Flow 可作为 Node 嵌套」给了现成的子图拼装范式,planner 节点产出的子流程可直接当一个 Flow 嵌回主流程。
  - **Batch / Async 节点**:对口阶段4 并行协作策略——并行 / 批处理不必特例化,作为节点类型内建即可。
- 难度/优先级:低(借**抽象与节点生命周期**,纯读码对照,不引依赖;它和我们都是零依赖、且有官方 Node 版,移植成本几乎为零)。**作为引擎抽象的外部校验最值**,优先级中。
- URL: https://github.com/The-Pocket/PocketFlow

### Google ADK(google/adk-python)— Google 官方 Agent 开发套件,确定性工作流原语 + 分层多智能体(Apache-2.0,~19.8k★,ADK 2.0 GA)
- 是什么:Google 的 code-first agent 框架,把编排分成两层:**确定性工作流 agent —— `SequentialAgent`(顺序流水线)/ `ParallelAgent`(并发独立子任务)/ `LoopAgent`(带终止条件反复跑)**,**这三者编排顺序不花 LLM token**;之上才是 **LLM 驱动的动态路由**。多智能体支持**分层组织**:专职 agent 按层级排布,靠 **LLM-driven transfer(上级把控制权转交)或显式 `AgentTool` 调用**协调与派单;还能继承 `BaseAgent` 写**自定义编排**。2.0 起带 `live_request_queue`(实时请求队列,支持流式 / 插话)。
- **值得借鉴(对口零-token 路由 + 阶段4 五策略 + 角色化组织)**:
  - **三个确定性原语 = 我们「五种协作策略」的现成词汇** ⭐⭐:阶段4 要的「**串行 / 并行 / 层级 / 辩论 / 流水线**」里,**串行=Sequential、流水线=Sequential 管线、并行=Parallel、层级=transfer/AgentTool、辩论=Loop+Parallel 组合**——ADK 等于把其中四种做成了经过验证的命名原语。我们现在 `flows/` 只有 `review-loop.yaml`(=一个 Loop),可照此把 **Sequential / Parallel 也沉成可复用的声明式原语**,五策略不再是空概念。
  - **「确定性编排不花 token」这条设计被官方框架背书** ⭐:ADK 显式区分「确定性工作流(零 token 决定顺序)vs LLM 动态路由」,正是我们「声明式路由零 token、无边匹配才调一次 planner」的同款主张——给老板的信号:**我们这条核心设计选型与 Google 官方 ADK 一致**。
  - **显式 AgentTool vs LLM-transfer 两种派单 = 我们董事长→CEO→主管→员工的两种接力** ⭐:对口角色化组织——可借其区分**显式派单(把 task 信封交给点名的 agent)**与**动态转交(让主管自己挑下一个)**两种模式,分别对应我们的确定性编排与 planner 兜底。
  - **LoopAgent 的「带终止条件反复跑」**:就是我们 review-loop + `max_loops` 护栏,印证设计;可对齐其终止条件表达方式。
- 难度/优先级:中(借**原语词汇 + 分层派单两模式**给阶段4;它是 Python 重栈,借模式不搬运行时)。属阶段4 设计输入,优先级中。
- URL: https://github.com/google/adk-python

### LangGraph(langchain-ai/langgraph)— 有状态 agent 图,checkpointer 持久化 + interrupt 人审 + 时间旅行(MIT,~20.6k★)
- 是什么:把 agent 工作流建成**有状态图**,核心是**持久化层 checkpointer**:每个 super-step 存一份 `StateSnapshot`(config / 元数据 / 各通道状态值 / 下一步要跑的节点 / 任务信息),于是流程可**在任意一步暂停并精确恢复**——无论系统崩溃还是人审介入。三个对口能力:**① 持久化 durable execution(崩了从最后 checkpoint 续跑);② `interrupt()` / 断点(在某节点暂停等人,持久化全态后无缝 resume,把人的输入注入再继续);③ 时间旅行(rewind 到任意历史 checkpoint,改状态,fork 出另一条执行分支)**。
- **值得借鉴(对口 human gate + attempt/重放 + 控制室)**:
  - **`interrupt()` = 我们 human gate 的「跨重启持久」升级版** ⭐⭐:我们 human gate 现在是张 typed card,但若引擎进程在等待期间重启,暂停态可能丢。LangGraph 的范式——**暂停时把整任务态落进 checkpoint,人给输入后从该 checkpoint 精确 resume**——可直接加固我们 human gate:把暂停态写进 taskstore/eventlog,resume 从 attempt 断点续跑,而非重来。零依赖(用现有 taskstore/eventlog 即可)。
  - **时间旅行 = attempt/重放 + 监管复盘的更强形态** ⭐:我们 attempt 现在是「重试 / 换 runner 各算一次,从头跑」;借时间旅行可做到「**rewind 到某个 checkpoint,只改一个参数 / 换个 runner,fork 出新分支**」——对**监管(反复失败 meta 复盘)与质量运营(硬化前做对照实验)**价值很大,且控制室可把 checkpoint 历史画成**可分叉的时间线**(比单纯 attempt 计数信息量大得多)。
  - **StateSnapshot 的字段集 = 现成的 checkpoint schema**:它定义的快照字段(配置 / 通道值 / 下一节点 / 任务信息)是一套好用的**断点数据模型**,我们 eventlog + taskstore 可对齐补齐「下一节点 + 通道态」,让「续跑 / 重放」有据可依。
- 难度/优先级:中(借**持久化 interrupt + 时间旅行数据模型**;它是 Python + 重持久化后端,我们只借「checkpoint→resume/fork」的机制与 schema,落在自己的文件式 taskstore 上)。对 human gate 健壮性与监管 / 控制室价值高。
- URL: https://github.com/langchain-ai/langgraph

---
注:本批不新增待办卡。三例的核心价值是**对我们已搭的 `shared/engine/` 图抽象做了一次外部验证**(PocketFlow 的 Node/Action/Flow/SharedStore、ADK 的确定性零-token 工作流、LangGraph 的 checkpointer/interrupt 三家彼此独立却都收敛到我们这套),而非暴露一个必须立刻补的独立功能缺口;可借的具体点(`flows/` 补 Sequential/Parallel 原语、human gate 跨重启持久、attempt 升级为时间旅行 fork、planner 子图=嵌套 Flow)都属**阶段3/4 设计细化**,应在任务#13(Mac 真 CLI 验证引擎)打通后并入阶段4 设计一并落,而非此刻堆成抢跑的待办卡(与第七批同口径:先沉淀、不抢跑)。若老板要立刻动手,**最小、最不抢跑的一步**是:拿 PocketFlow 的 ~100 行 TS 内核当对照,在任务#13 前花半天把我们 condition/engine 的节点生命周期与「嵌套-Flow / 并行原语」缺口列一页对照单——零依赖、纯读码、直接给阶段4 设计省返工。watch:本次因 git 代理被挡(ls-remote 403)未做三库 HEAD-diff,默认分支均为 `main`,commit 待下次网络可达时回填。
## 2026-06-21 · 第九批(选题:像素素材与画风 / Unity(Simulaid)— 角色分层合成 / AI 精灵流水线 / 等距自动贴图;运行 ~00:0x)

> 本批轮换回**最久未碰的「像素素材与画风 / Simulaid」**(上次还是 06-19 第一批的 proper-pixel-art / Pixelorama / unity-mcp,之后五批都在编排/网关/grounding/前端 skill 上)。三例正好构成**像素素材流水线三件套**:**LPC 角色生成器 = 角色「分层合成」+ 逐图许可台账**;**spritebrew = AI「文生精灵→Auto-Prep→状态动画→多引擎导出」整条线**;**TileGen = 等距「48 格 bitmasking 自动贴图」产砖**。三者直接对口玉兔6 在飞的**办公室视觉重设计(等距像素办公室,meowa 出素材中)** + **Simulaid 资源(Unity/团结)** + 已借的 **proper-pixel-art(清洗)/ Pixelorama(编辑)/ meowa(生成)**,补的是中间「**分层拼装 / 自动备料 / 等距产砖 / 许可治理**」这几环。三仓库都偏工具/素材本体,与玉兔6「零依赖原生」路线不同,且**许可各异(spritebrew AGPL-3.0、LPC 素材 GPL/CC-BY-SA、TileGen 未标许可)→ 借结构/方法/约定,不直接 vendor 其代码或素材**。

### Universal-LPC-Spritesheet-Character-Generator(LiberatedPixelCup)— 角色「分层合成 + 逐图许可台账」的事实标准生成器(GPL-3.0 / CC-BY-SA-3.0 素材)
- 是什么:Liberated Pixel Cup 社区多年维护的角色精灵生成器(早期 sanderfrenken 长期维护,现 LiberatedPixelCup 组织接手)。核心是**分层合成**:角色拆成多类别(身体 / 头发 / 衣服 / 装备…),每类别可含 n 层,每层定义 **z-position 绘制顺序**;选好层后导出**单张拼合 spritesheet**。配 **CREDITS.csv**——逐图记录作者 / 许可证 / 原始 URL,生成器据所用的层**自动输出对应素材的署名 + 许可文本**。素材在 GPL-3.0 和/或 CC-BY-SA-3.0 下开放;LPC 帧集(walk/spellcast/thrust/slash/shoot/hurt 等统一动作)是 2D 角色精灵的事实标准。
- **值得借鉴(对口办公室 sprite 系统 + meowa 素材治理)**:
  - **分层 z-order 合成 = 办公室小人「按角色/状态拼装」的现成范式** ⭐⭐:办公室现在是「每 agent 一张坐姿 sprite,按 state 切 idle/working/done/fail」。借 LPC 把小人拆成**基础体 + 角色配饰层(董事长/CEO/主管/员工/专家)+ 状态叠加层(working 的工具、done 的对勾、fail 的红叉)**,各层定 z-position——一套基础体 × 少量配饰/状态层即可拼出**全角色 × 全状态**,而非每角色每状态画整图,省素材、易扩展、风格统一。正好喂在板上在飞的「办公室视图工具→工位映射」卡之下(那张卡明确要保留 z-order / 状态气泡)。
  - **CREDITS.csv 逐图许可/署名追踪 = 素材合规的现成模型** ⭐:办公室重设计正在产素材(meowa AI 生图 + 矢量样板 + 可能引入的开放素材),混用不同来源/许可极易**许可证污染**(尤其这批仓库里就有 GPL/AGPL/CC-BY-SA)。借 LPC 的 `CREDITS.csv`(逐图 author/license/source-url)+「按所用层输出署名」,给办公室素材建一份**素材清单 + 许可台账**,从源头记清每张图来源与许可——零依赖、纯文件。
  - **统一动作帧表**:LPC 标准动作命名可作玉兔6「状态→动画」的命名参照,日后要扩动作有现成词汇。
- 难度/优先级:低(借**分层合成约定 + 许可台账**,纯文件零依赖;不直接用其 GPL/CC-BY-SA 素材、只借结构与流程即可规避许可)。对在飞的办公室重设计价值高。
- URL: https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator

### spritebrew(GAlbanese09/spritebrew)— Web 版 AI 像素精灵全流水线:文生精灵→Auto-Prep→状态动画→六种引擎导出(AGPL-3.0,Next.js16/PixiJS8)
- 是什么:一个 Web 版 AI 像素精灵流水线(Next.js16 / React19 / PixiJS8,AGPL-3.0,Claude 协作开发、活跃)。一条龙:**文生精灵**(描述→成套动画 sheet,多风格:4 向行走 / 行走+idle / 小精灵 / VFX,底层 Retro Diffusion 像素模型)、**给已有角色生成动画帧**(走/idle/攻击/跳/蹲/破坏,保形 + 智能留边防裁切)、**Auto-Prep 管线**(轮廓检测抠主体→智能裁剪→可调容差去背景→最近邻 pixel-perfect 缩到 64×64,前后对比一键确认)、**上传切片**(网格/轮廓检测 + 自动分配动画组 + 方向识别)、**PixiJS 动画预览**、**多引擎导出**(TexturePacker / Aseprite / GameMaker / RPG Maker / Godot SpriteFrames / Raw ZIP 六种)。
- **值得借鉴(对口 meowa 生图 + 办公室状态动画 + Simulaid 导出)**:
  - **「生成→Auto-Prep→切片→动画→多引擎导出」整条流水线** ⭐⭐:玉兔6 已有 meowa(AI 生像素/等距/tileset)+ proper-pixel-art(清洗),但**缺中间的「自动备料 + 状态动画 + 导出」**。spritebrew 的 Auto-Prep(轮廓抠图 / 去背 / pixel-perfect 64×64)几乎是 proper-pixel-art 的上位整合,可作 meowa 产出后的**标准备料步骤**;其「给已有角色生成 idle/working/done/fail 动画帧」直接对口办公室小人状态动画;**多引擎导出**对口 Simulaid(Unity/团结)与潜在 Godot。
  - **动画状态作为一等参数** ⭐:它把「4 向行走 / idle / 攻击 / VFX」做成可选风格——对口我们把办公室状态(idle/working/done/fail)做成**一套标准动画集**,而非每次手摆。
  - **智能留边防裁切 + 轮廓切片**:对口 sprite 拼装常见的「工具/气泡被裁」问题,借其 padding 与轮廓检测思路。
- 难度/优先级:中(借**流水线分段 + Auto-Prep/导出**理念;它是 Next/React/PixiJS 全栈 + 依赖 Retro Diffusion 付费 API + **AGPL-3.0**,不整体引入,只借管线设计并落到既有 meowa+proper-pixel-art 链上)。对素材产能价值高。
- URL: https://github.com/GAlbanese09/spritebrew

### TileGen(jrouillard/TileGen)— 极简等距贴图生成器:2 张状态砖→48 格 bitmasking 自动贴图 atlas(Python/Pillow/numpy)
- 是什么:一个极简 Python(Pillow / numpy / PySide2)等距贴图生成器。给**两种状态贴图**(如 草/路),按 **bitmasking 自动贴图法**生成**全部 48 种边角组合**的 atlas;支持等距(2:1 比例)、可选 height/background、以及**多帧动画贴图**;带 CLI + GUI 预览。
- **值得借鉴(对口等距办公室地块 + Simulaid 地图 + autotile)**:
  - **48 格 bitmasking = autotile 的现成「素材」生成法** ⭐:板上(第四批 agents-in-the-office)记过「autotile」概念,但那是**运行时拼接**;TileGen 解决的是**前置素材**——只画 2 张状态砖,自动产出 48 种过渡砖。办公室/Simulaid 做「地毯/木地板/分区地块」平滑边界时,这把「画几十张过渡砖」降成「画 2 张 + 跑脚本」,省美术重复劳动。
  - **等距 2:1 + height/background** ⭐:正对口玉兔6 **等距像素办公室**——原生处理等距比例与带高度地块,产出可直接进办公室/Simulaid 的等距图集。
  - **动画贴图帧**:对口要动的地块(working 区高亮地块 / 传送阵 / 水面),用其多帧输入一次产出动画 atlas。
- 难度/优先级:低(独立小脚本,借**等距 48 格 bitmasking 产砖**法给办公室/Simulaid 备料;仓库未标许可证 → 借算法/方法、不直接搬代码)。对等距地块产能价值中–高。
- URL: https://github.com/jrouillard/TileGen

---
注:本批围绕「像素素材与画风 / Simulaid」,三例构成像素素材流水线三件套——**LPC=角色分层合成 + 许可台账;spritebrew=AI 生成→Auto-Prep→状态动画→多引擎导出;TileGen=等距 48 格 autotile 产砖**,与已借的 proper-pixel-art(清洗)/ Pixelorama(编辑)/ meowa(生成)互补,补「分层拼装 / 自动备料 / 等距产砖 / 许可治理」中间环。**本批不新增待办卡**,两点理由:① 公告板已有一张在飞的洞察员卡「办公室视图:工具→工位映射 + human-gate」,其 bounds 明确要保留办公室 sprite 的 z-order / 状态气泡——这三例的借鉴点(分层 z-order 合成、状态动画集、等距产砖、素材许可台账)是该卡与「办公室重设计 / meowa 出素材」工作的**素材侧细化**,应并入既有工作而非另起竞争卡;② 延续第七/八批「先沉淀、不抢跑」口径。若老板要立刻落地,**最小、最不抢跑的一步**:在现有办公室重设计里加一条素材约定——用 LPC 式「基础体 × 配饰层 × 状态叠加(定 z-order)」拼办公室小人 + 一份 `assets/credits.csv` 许可台账,并对地块试跑一次 TileGen 的 2→48 等距产砖——全零依赖、纯文件/脚本,直接给在产的 meowa 素材省返工。watch:三仓库默认分支 LPC=`master`、spritebrew=`main`、TileGen=`master`;沿用历史口径本批未在本机做 ls-remote HEAD-diff,commit 待回填。
## 2026-06-21 · 第十批(选题:AI agent 工具与 skills / LLM 网关 — 能力分发 / 工具治理网关 / 模型语义路由;运行 ~04:0x)

> 本批轮换回**最久未碰的两条线**:「AI agent 工具与 skills」(上次第三批 06-20 04:08)+「LLM 网关」(上次第五批 06-20 04:1x)——第七/八/九批都在前端 skill / 编排 / 像素上。三例正好串成一条**「能力 → 工具 → 模型」的发现 / 治理 / 路由三层链**,层层对口玉兔6 的 **能力库 1B + 工具放行/MCP + new-api 网关 + per-agent 模型选择**:**wshobson/agents = 能力(skills/plugins)层的「渐进披露打包 + 质量评估框架 + 三档模型策略」**;**mcp-gateway-registry = 工具(MCP)层的「语义发现 + 细粒度治理 + 审计 + A2A」统一控制面**;**vLLM Semantic Router = 模型层的「意图语义路由 + 安全分类 + 语义缓存」网关**。三者体量/栈都比我们「单机文件式零依赖」重(Python / Go / Envoy / Keycloak)→ **借抽象 / 打包约定 / 数据模型 / 路由策略,不引其运行时**;难得的是这三层各自独立的优秀实现,恰好拼出我们「能力库 → 工具 → 网关」尚未补齐的几个工程点。

### wshobson/agents — Claude Code 多-harness 插件市场:80 插件 / 185 agent / 153 skill / 100 命令,渐进披露 + PluginEval 质量框架(MIT,35.6k★)
- 是什么:把 **80 个单一职责插件**(每插件平均 3.6 个组件,遵循 Anthropic「2–8 组件」模式)组织起来的生产级 agent 能力市场——含 **185 专职 agent / 16 个多-agent 工作流编排器 / 153 个 agent skill / 100 命令**,且 **同一套 markdown 既被 Claude Code 用、也作 Gemini CLI 原生扩展 / Smithery 装**(多-harness、平台无关)。三个工程亮点:① **渐进披露三层**(metadata 永远加载 → instructions 激活时加载 → resources 按需加载),「装 python-development 只载 3 个 Python agent + 16 skill 约 1000 token,而非整库」;② **PluginEval 质量框架**——三层评估(静态分析即时 / LLM-judge 语义 / Monte-Carlo 统计)、10 个质量维度(触发准确度 / 编排适配 / 输出质量 / 范围校准 / 渐进披露 / token 效率 / 鲁棒性 / 结构完整 / 模板质量 / 生态一致)、铂金-金-银-铜质量徽章、**反模式检测**(OVER_CONSTRAINED / EMPTY_DESCRIPTION / MISSING_TRIGGER / BLOATED_SKILL / ORPHAN_REFERENCE / DEAD_CROSS_REF)、Wilson / bootstrap / Clopper-Pearson 置信区间 + Elo 排名、`--threshold` 当 CI 门;③ **三档模型策略**(Opus 关键架构/安全/评审 → Sonnet 均衡开发 → Haiku 快操作,另有 `inherit` 让会话决定),把「哪类活配哪档模型」写成可复用约定。
- **值得借鉴(直接对口能力库 1B + 洞察员自己 + per-agent 模型)**:
  - **渐进披露三层 = 我们「按需拉 token 经济」的第三次外部印证** ⭐⭐:metadata 常驻 / instructions 激活载 / resources 按需载,正是我们要给 41 项目技能 + 能力库做的「先搜再只拉需要的片段」。继第三批 tech-leads-club(search→read→fetch MCP)之后,这是又一家把它做成成熟工程的——可把**「三层加载契约」**正式写进能力库 skill 包规范(每个 skill 必含 metadata 段 + 主体 + 可选 resources 目录)。
  - **PluginEval = 洞察员「给案例打分」+ 能力库准入的现成评估器** ⭐⭐:第三批 agent-skills-hub 给了 6 维评分,PluginEval 更进一步给**三层评估(静态/LLM/统计)+ 反模式检测 + 统计置信区间**。其 **6 个反模式**(尤其 MISSING_TRIGGER / BLOATED_SKILL / EMPTY_DESCRIPTION)可直接抽成能力库入库的**零依赖静态门**(类似第七批 Impeccable 的 detector 思路,但针对 skill 而非 UI);其 10 维 + 徽章可喂给洞察员,把「找到的案例」量化评级而非纯人工判断。
  - **三档模型策略 = per-agent 模型选择的现成词汇** ⭐:Opus=关键架构/安全/评审、Sonnet=开发、Haiku=快操作,正对口我们「董事长/CEO 用强模型、员工分级、网关按角色派模型」;可借其**分档表 + `inherit`(会话默认兜底)**做 new-api 网关的模型路由默认策略。
  - **80 插件单一职责 + 平均 3.6 组件**:对口能力库模块化——「一插件一职责、装啥载啥」比大杂烩 skill 包更省 token、更易组合,是我们 41 项目技能拆分粒度的参照。
- 难度/优先级:中(借**三层加载契约 + PluginEval 反模式静态门 + 三档模型表**;它是 Python/markdown 内容市场,借规范与评估器、不搬其 185 agent 内容)。对能力库与洞察员自身价值高。
- URL: https://github.com/wshobson/agents

### agentic-community/mcp-gateway-registry — 把散落 MCP 工具收成「统一治理控制面」:语义发现 + 细粒度授权 + 审计 + A2A(Apache-2.0,~649★)
- 是什么:企业级 **MCP 网关 + 注册中心**,把「几百个分散 MCP server 配置 + agent 连接 + 各自的治理」收成**单一控制面**。三件套:**① Gateway(给 AI 开发工具的统一入口)/ ② MCP Servers Registry(注册 / 发现 / 治理 MCP server)/ ③ Agent Registry & A2A Hub(agent 注册 / 发现 / 治理 + A2A 协议点对点通信)**。能力:**OAuth 2LO/3LO + Keycloak / Microsoft Entra ID** 双认证;**细粒度访问控制到「工具 + 方法」级**;**所有工具调用全审计**(SOX/GDPR 路径);**语义 / 自然语言工具发现**——`POST /api/search/semantic` 跨 server/tool/agent 做混合搜索(向量 + 关键词,精确名加权),嵌入可选本地 sentence-transformers / OpenAI / LiteLLM 100+ 模型;**A2A 语义发现**——agent 用自然语言查询(如「能订机票的 agent」)在运行时发现协作者,实现动态 agent 组合。
- **值得借鉴(对口工具放行 / MCP + 角色化组织 + 控制台审计)**:
  - **语义工具发现 = 能力库 / 工具「按需找」的运行时版** ⭐⭐:第三批我们把「skill 按需拉」做在**入库 / 分发**层;这家把「**工具按自然语言发现**」做在**运行时**层——员工接到任务,用一句话语义查询从注册表找到该用哪个工具 / MCP,而非把全部工具塞进上下文。其 `POST /api/search/semantic`(混合搜索 + 可换本地嵌入)正契合我们单机 / 离线优先,可作能力库**对 agent 暴露的「工具发现接口」**范式。
  - **细粒度到「工具 + 方法」级的治理 + 全审计 = 工具护栏的现成模型** ⭐:我们引擎有「工具放行 / 路径白名单」,但缺**到方法级的访问策略 + 每次工具调用留审计**。借其「**tool + method 级访问控制 + 全调用审计**」给 eventlog 补一条「工具调用治理轨」,与第三批 SkillSpector(入库安检)+ tech-leads-club(审计日志)合流成「skill 入库安检 → 工具运行时治理」两段。
  - **A2A 语义发现 = 角色化组织「找协作者」的兜底** ⭐:对口阶段4——当确定性编排无现成边、planner 要找「谁能干这活」时,可借其「**按能力语义发现 agent**」做动态组合,而非硬编码链路;这正补「董事长→CEO→主管→员工」固定链之外的**动态协作发现**。
  - **单一控制面**:把「MCP server + agent + 治理」收成一个面,对口控制台 / 控制室「一个外壳管全部能力与工具」的信息架构(呼应第四批 Mission Control 的面板注册表)。
- 难度/优先级:中–高(借**语义工具发现接口 + 工具/方法级治理 + 审计轨 + A2A 发现**理念;它是 Keycloak / Entra / OAuth 企业重栈,我们只借数据模型与接口形态、落到文件式零依赖,认证 / 扫码边界仍交主人手动)。对工具治理与阶段4 协作价值高。
- URL: https://github.com/agentic-community/mcp-gateway-registry

### vLLM Semantic Router(vllm-project/semantic-router)— 模型层「意图语义路由 + 安全分类 + 语义缓存」网关:把多数请求留在本地 / 小模型(Apache-2.0,~4.2k★,Go / Envoy ExtProc)
- 是什么:vLLM 官方项目的**系统级智能路由器**(面向 Mixture-of-Models,跨云 / 数据中心 / 边缘)。架构:**Client → Envoy Proxy → ExtProc(Go 路由器,gRPC 拦每请求)→ Backend Model**;ExtProc 跑一条**分类流水线**:先 **BERT / decoder-only LoRA 分类**判 query 意图与类别 → **prompt guard** 筛越狱 / 敏感泄露 / 幻觉 → 查**语义缓存** → 再把请求路由到**最合适的后端模型**(OpenAI 兼容 API)。主张两条:**token 经济**(减少浪费 token、把多数请求留给本地 / 小模型省钱)+ **LLM 安全**(可控、可审计)。最新 **Athena 版**示范:本地 Apple Silicon 跑量化 Qwen3-Coder-Next + 云端 Gemini 2.5 Pro 兜底,「多数请求留本地且免费」。
- **值得借鉴(对口 new-api 网关 + per-agent 模型 + 引擎安全门)**:
  - **意图语义路由 = per-agent 模型选择的「自动版」** ⭐⭐:我们现在按**角色**静态派模型(配置写死);它按**每条 query 的意图 / 难度**动态选模型——可借其「**小分类器先判意图 → 路由到最合适模型**」给 new-api 网关加一层:简单任务走本地 / Haiku、难任务才上 Opus。与上面 wshobson 的三档模型表正好**一个给静态分档、一个给动态路由**,合起来就是完整的模型路由策略。
  - **「多数请求留本地 / 小模型」= 单机 / 省钱路线的同款主张** ⭐:Athena「本地量化模型 + 云端兜底、多数留本地免费」与玉兔6 单机 + 保险库 + 离线优先高度一致;其**本地优先 + 云兜底的路由阈值**思路可直接指导网关「先本地小模型、不达标再升级到云大模型」的省 token 策略。
  - **prompt guard 安全分类 = 引擎输入侧的护栏** ⭐:它在路由前用分类器筛**越狱 / 敏感泄露 / 幻觉**——对口我们引擎「工具放行 / human gate」之外缺的**输入侧语义安全门**;可借其安全分类思路,在网关入口加一道轻量分类,而非只靠下游护栏。
  - **语义缓存**:对口网关可观测 / 省钱——相同语义的请求命中缓存不重复打模型,直接给 new-api 加一层省 token。
- 难度/优先级:中(借**意图路由 + 本地优先阈值 + prompt-guard 分类 + 语义缓存**四个策略;它是 Go + Envoy ExtProc + BERT/LoRA 重栈,我们借路由 / 缓存 / 安全的**决策逻辑**,不搬 Envoy 数据面)。对网关省 token 与输入安全价值高。
- URL: https://github.com/vllm-project/semantic-router

---
注:本批两选题(AI agent 工具与 skills / LLM 网关)三例构成**「能力 → 工具 → 模型」发现 / 治理 / 路由三层链**——wshobson/agents=能力层渐进披露打包 + PluginEval 质量评估 + 三档模型;mcp-gateway-registry=工具(MCP)层语义发现 + 细粒度治理 + 审计 + A2A;vLLM Semantic Router=模型层意图路由 + 安全分类 + 语义缓存,分别对口能力库 1B、工具放行 / MCP、new-api 网关 + per-agent 模型。**本批不新增待办卡**(延续第七 / 八 / 九批「先沉淀、不抢跑」口径):三例的借鉴点都是对**已规划组件**(能力库按需拉、工具护栏、网关模型路由)的**设计细化 / 外部验证**,而非暴露一个必须立刻补的独立功能缺口;且其中两家(mcp-gateway-registry / semantic-router)是 Keycloak / Envoy 企业重栈,贸然落地与「单机零依赖」冲突,应作设计输入并入既有路线。若老板要立刻动手,**最小、最不抢跑的一步**:把三家都收敛到的**「渐进披露三层加载契约」**先写成能力库 skill 包的一页规范(metadata 段 + 主体 + 可选 resources),并从 PluginEval 抽 6 条反模式当能力库入库的零依赖静态门——纯文件、零依赖、直接给能力库省返工。watch:三新仓库默认分支均为 `main`(wshobson/agents MIT、mcp-gateway-registry Apache-2.0、semantic-router Apache-2.0);本机 git ls-remote 仍被代理挡(403),HEAD-diff 待网络可达时回填,沿用历史口径。
## 2026-06-21 · 第十一批(选题:任务队列引擎 — 事务性/不丢任务入队 / 并发-公平-限流调度 / 轻量持久化执行与崩溃恢复;运行 ~08:1x)

> 本批轮换回**最久未碰的核心选题「任务队列引擎」**(只在最早几批随 inngest/restate/mastra 带过,之后七批都在 skills/网关/grounding/前端/编排/像素上)。它正是玉兔6 的**队列底座**(`shared/engine/queue.js` + `taskstore.js` + `queue-organizer.js` + `shared/routing/任务队列设计.md`)。三例构成**队列底座三件套**:**River = 事务性 / 不丢任务入队 + unique-by-state + scheduled/snooze**;**Hatchet = 并发-key / 限流 / 公平调度**;**DBOS = 库式持久化执行 + 崩溃恢复 + step exactly-once**。三者栈都比我们「单机文件式零依赖」重(Go+PG / 多 SDK+PG / 库+PG)→ **借数据模型 / 调度策略 / 持久化哲学,不引运行时**。**与第八批分层互补**:第八批(PocketFlow/ADK/LangGraph)是**图 / 流执行层**,本批是其**下方的「队列与持久化底座」**,第八批未碰。**本批照实读了引擎源码做核对**,据此定借鉴点(并发查到三个真缺口:无并发-key/限流/公平、无 scheduled/snooze、**无崩溃后孤儿 running 任务的自动恢复**)。

### River(riverqueue/river)— Go + Postgres 的高可靠后台任务队列,杀手锏是「事务性入队」(MPL-2.0,~5.1k★,2026-06 仍活跃发版)
- 是什么:Go 的高性能任务队列,核心卖点 **transactional enqueue(`InsertTx`)——把入队和你的业务写放进同一个数据库事务**:事务提交才入队、回滚则连任务一起消失、提交前对 worker 不可见,于是「任务绝不先于业务数据生效、也绝不丢」。另有:**批量插入**(Postgres `COPY FROM`)、**unique jobs(可按 args / period / queue / state 去重)**、**周期 / cron 任务 + 未来定时任务 + snooze(节点内把任务推迟重排)**、work 函数内取消、多队列、订阅队列活动 / 统计做 telemetry、`rivertest` 断言测试助手、`riverui` 网页面板。
- **值得借鉴(直接对口 `queue.js` + `taskstore.js`)**:
  - **「事务性入队」的 outbox 思想适配到文件式** ⭐:我们 `queue.js` 已是 tmp+rename 原子单文件写,但**跨「写 result + enqueue 子任务」没有原子性**——一个 node 的 `post()` 若既写 `result` 又派生子任务,中途崩会留下「写了 result 没入子任务」或「入了队 result 没落」的半态。文件式没有真事务,可借 River 的「业务写与入队捆绑」原则用 **outbox 逼近**:先把「要入队的子任务 + 要落的 result」作为一条**意图记录**原子落盘,再由收尾步骤幂等地兑现,二者要么都成要么都可重放补齐。
  - **unique by state 补强我们的 idem 幂等键** ⭐:`queue.js` entry 已有 `idem`,但设计文档只说「同任务不重复入队」。River 的 unique 维度更细(args / period / queue / **state**),尤其 **by state「若已有同 args 任务在 running/queued 就不再入队」**直接补强:防洞察员 / 定时任务在上一轮还没跑完时重复触发、叠出重复任务。
  - **scheduled future + snooze**(我们队列完全没有)⭐:`snooze`(节点内把任务推迟 N 秒重入队、**不占 worker**)对「等依赖 / 等冷却 / 外部限流退避」很实用;`scheduled-at` 让定时任务也能下沉进统一队列(对口设计 §7.2)。
  - **rivertest 风格断言**:对口 `tests/`,给队列补「期望已入队 / 期望唯一」断言。
- 难度/优先级:低(借**数据模型 + unique-by-state / snooze 语义**,纯文件零依赖;River 是 Go+PG 重栈,不搬运行时)。对 `queue.js` 健壮性价值中–高。
- URL: https://github.com/riverqueue/river

### Hatchet(hatchet-dev/hatchet)— Postgres 上的任务编排引擎,内建并发 / 公平 / 限流调度(MIT,~7.4k★,Python/TS/Go/Ruby SDK)
- 是什么:面向「后台任务 / AI agent / 持久工作流」的编排引擎,**全建在 Postgres 上、不需额外消息中间件**。调度能力是亮点:**FIFO / LIFO / Round-Robin / Priority 四种队列策略**;**按动态 key 限并发(fair scheduling)**;**限流**(对第三方 API、或按用户的动态速率上限);**worker 级 slot 控制**。持久化方面:留存全部执行历史、可 replay 事件、可从指定 step 续跑,自称「Temporal / DBOS 的可替代品」;打包成单平台(队列 + 可观测 + 告警 + 仪表盘 + CLI)+ OpenTelemetry。
- **值得借鉴(对口 `queue.js` 调度 + `queue-organizer.js` + `shared/routing/`)**:
  - **按动态 key 限并发 = 我们最缺的一档调度** ⭐⭐:`queue.js` 现在只有「每 agent 串行 one-at-a-time + priority + FIFO」,**没有跨任务的并发 key**。Hatchet 的「按动态 key 设并发上限」→ 玉兔6 可按 **runner / 外部模型 / 文件路径** 等 key 限并发,解决「多 agent 同时打同一外部 API、或同时写同一文件」的争用(目前只在 `cli-runner.js` 的报错里见到『并发 / 配额 / 被信号杀』征兆,说明确会撞)。
  - **限流原语** ⭐:对口 `runners.yaml` / `model-routing.yaml`——给每模型 / 每外部 API 设速率上限,防超额被限流;Hatchet 的 **per-key 动态限流**是现成模型,正接上第十批 vLLM Semantic Router 的「本地优先 / 省 token」路由。
  - **公平调度(Round-Robin / fair scheduling)** ⭐:设计 §7.2 要把队列「下沉为所有 agent 通用原语」后,只按 priority+FIFO 会让某 agent 的长队列**饿死**别人;Round-Robin / 公平调度补这一环,而 `queue-organizer.js` 已在做跨 agent 整理,正好接。
  - **replay / 从 step 续跑**:对口 `taskstore` 的 attempt + history(与第八批 LangGraph 时间旅行同源,本批只从「队列调度」角度记,不重复展开)。
- 难度/优先级:中(借**并发-key / 限流 / 公平**三个调度原语 + 数据模型;Hatchet 是 PG 重栈 + 多 SDK,借策略不搬运行时)。对「队列下沉为通用原语」价值高。
- URL: https://github.com/hatchet-dev/hatchet

### DBOS Transact(dbos-inc/dbos-transact-py · -ts)— 轻量「持久化执行」库:不要编排服务器,作为库跑在应用内(MIT,Python/TS/Java/Go + Postgres,MIT+Stanford 出身)
- 是什么:开源**持久化执行(durable execution)库**——**不需要独立编排服务器**,直接作为库跑在你现有应用里、用你现有数据库存 / 恢复状态与执行历史。用 **decorator 注解普通函数**即得:持久 workflow / step / 数据库事务 / **持久队列 / debounce / messaging / cron**。保证程序**run-to-completion**、每个操作 **exactly-once(once-and-only-once)**、完整可审计 + 自动 OpenTelemetry trace;**崩溃 / 重启后从中断处自动恢复**。源自 MIT + Stanford(Stonebraker × Zaharia)的开源项目。
- **值得借鉴(对口 `taskstore.js` + `engine.js` 崩溃恢复 + `cli-runner.js` 幂等)**:
  - **「库而非服务器、用现有存储」= 玉兔6 单机 / 零依赖 / 文件式路线的外部背书** ⭐:DBOS 明确「无需重型编排服务器、作为库跑在应用内」——与玉兔6「引擎跑本机、文件式 `taskstore`、零依赖」高度同构;给老板的信号:**durable execution 不必上重基建**,我们的选型被一个 MIT/Stanford 出身的库背书(继第八批 ADK/LangGraph 之后又一次外部验证,但这次验证的是「轻量库形态」而非「图抽象」)。
  - **崩溃恢复 + step exactly-once = 本批照实读码查出的真缺口** ⭐⭐:核对引擎(`queue.js` / `engine.js`)——`claim()` 把队首任务**原子 mv 到 `running/`、只记 `started_at`**,**没有 lease / 心跳、也没有任何「启动时扫 `running/` 重认领」的逻辑**;一旦引擎在 claim 之后、`finish()` 之前崩溃,该任务就**永远卡在 `running/`(孤儿任务)**,既不自动 `requeue` 也不续跑(现有 `resume`/`requeue` 都要人工触发)。DBOS 的范式正补这点:**每个 step 完成即落 checkpoint,重启时扫未完成 workflow 自动续跑、已完成 step 不重跑(exactly-once 记忆化)**。落到我们这套:给 `claim` 加 **lease/owner + 心跳**,引擎启动时扫 `running/` + `taskstore` 的 `running` 态,**超 lease 判孤儿 → 按「最后完成的 node」续跑或 requeue**,配 **step 级幂等记忆**(已执行的外部副作用不重复打)。**这是本批唯一升级为待办卡的点。**
  - **decorator 标注 durable step = 节点生命周期标准化** ⭐:对口 `cli-runner` 的节点约定 + 第八批 PocketFlow 的 prep/exec/post——借「声明式把一个 node 标注为 durable step(自动落 checkpoint + 幂等记忆)」统一我们的节点契约。
  - **debounce 原语**:对口洞察员 / 定时任务防抖——短时间内重复 enqueue 的同任务自动合并。
- 难度/优先级:中(借**库式持久化哲学 + 崩溃恢复 / exactly-once 数据模型 + decorator 契约**;DBOS 是 PG 库,我们落到文件式 `taskstore`/`eventlog`)。对引擎可靠性价值高。
- URL: https://github.com/dbos-inc/dbos-transact-py

---
注:本批围绕「任务队列引擎」,三例构成**队列底座三件套**——River=事务性 / 不丢任务入队 + unique-by-state + scheduled/snooze;Hatchet=并发-key / 限流 / 公平调度;DBOS=库式持久化执行 + 崩溃恢复 + step exactly-once,与早期已借的 inngest/restate/mastra 互补,且**与第八批(PocketFlow/ADK/LangGraph 的图编排抽象)分层互补**——第八批是图 / 流执行层,本批是其下的「队列与持久化底座」,对口 `shared/engine/queue.js` + `taskstore.js` + `queue-organizer.js` + `任务队列设计.md`(第八批未碰)。**本批破例新增 1 张待办卡**(打破第七–十批「先沉淀、不抢跑」的连续不加卡):因为 DBOS 那条照出的是一个**已读码验证、尚未实现的可靠性缺口**——引擎崩溃后孤儿 `running` 任务永不恢复,这不是设计细化也不是外部验证,而是**核心引擎的一个真实漏洞**,且可靠性已是在案关切(见 `玉兔6-任务可靠执行研究.md`)。卡范围**严格限定**为「崩溃恢复扫描 + lease/心跳 + step 幂等记忆」,零依赖纯文件;River/Hatchet 的其余增强(unique-by-state / scheduled-snooze / 并发-key / 限流 / 公平)都属对既有 `任务队列设计.md` 的**细化**,**只写分析、并入设计,不另起卡**。watch:默认分支 River=`master`、Hatchet/DBOS=`main`(许可:River=MPL-2.0、Hatchet=MIT、DBOS=MIT);沿历史口径本机未做 `git ls-remote` HEAD-diff,commit 待网络可达回填。
## 2026-06-21 · 第十二批(选题:GUI grounding / 优秀网页设计 — 屏幕解析 set-of-marks / 视觉测试时缩放 / 框架无关动画;运行 ~12:0x)

> 本批轮换回**最久未碰的两条线**:「GUI grounding」(上次还是早几批的 UGround / GUI-Actor / UI-TARS / Agent-S / UI-Venus,**全是要自托管的 grounding 模型**)+「优秀网页设计」(上次第七批 taste-skill / Impeccable,更早第一批 React Bits)——第八–十一批都在编排 / 网关 / 像素 / 队列上。这次刻意换个角度切 grounding:前几批收的都是**模型**(得自己跑 7B/72B 权重),本批两例 **OmniParser / RegionFocus 都是「推理期、不重训、可叠在任意视觉模型上」的 grounding 技术**——正贴玉兔6 **不自托管 grounding 模型、直接用 Claude computer-use 视觉**的现实:一个把屏幕**解析成带框的元素清单**(set-of-marks),一个在**高分屏/密集界面**上**迭代放大**提准,且与已借的 UI-TARS(动作后校验)互补成 computer-use 闭环。第三例 Motion 则是把第一批 React Bits 那条「要动效品味、但不想引 React 构建链」的借鉴点**真正落地的框架无关动画引擎**(vanilla JS 一行 `animate()`、零构建)。三例栈差异都按惯例「借方法/数据形态,不引重运行时/重模型」。

### OmniParser(microsoft/OmniParser)— 纯视觉 GUI 的「屏幕解析器」:截图→带框元素清单 + 可点性 + 图标语义(代码 MIT / 仓库 CC-BY-4.0,~24.6k★)
- 是什么:微软研究院的**屏幕解析工具**,把一张 UI 截图解析成**结构化元素清单**——交互区域检测(给每个按钮/图标/输入框框出 bounding box)+ **可点性预测**(V1.5 起,判每元素 interactable 与否)+ **图标功能描述**(icon caption,给无文字图标生成语义标签)。产出可作 **set-of-marks** 喂任意视觉 LLM,「显著提升 GPT-4V 把动作精确落到对应区域的能力」。配套 **OmniTool**:用任选视觉模型(OpenAI / DeepSeek-R1 / Qwen2.5-VL / Anthropic Computer Use)控一台 Windows 11 VM,并支持**本地轨迹日志**做训练数据管线。V2(2025-02)在新基准 ScreenSpot-Pro 拿 39.5% SOTA;最新 release v2.0.1(2025-09),活跃。许可需注意:**模型权重分裂**——icon_detect 因继承 YOLO 是 **AGPL**,icon_caption(blip2/florence)是 MIT。
- **值得借鉴(对口 computer-use 抓取可靠性 + 控制室回放)**:
  - **set-of-marks 元素清单 = computer-use「点错位置」的现成解法** ⭐⭐:玉兔6 现靠 Claude computer-use 直接对原始像素点坐标,密集/高分屏易点偏(已借的 UI-TARS 卡只补了**动作后**截图比对/自修复,**动作前**的定位没补)。OmniParser 范式——**先把屏幕解析成带框 + 可点性 + 图标语义的清单,再让模型在「清单」上选元素而非裸图上猜坐标**——正补这一**动作前 grounding** 环。与 UI-TARS 的「动作后校验」合起来,就是 computer-use 的「**先标后点、点完再验**」闭环。
  - **可点性预测 = 过滤无效点击的护栏** ⭐:V1.5「判每元素能否交互」可直接减少「点到装饰元素/背景」的空动作,给 computer-use 加一道**候选过滤**。
  - **本地轨迹日志 = 控制室/质量运营的现成数据模型** ⭐:OmniTool「本地存轨迹做训练管线」对口玉兔6 把 computer-use 操作序列**落 eventlog 供复盘/硬化**——借其轨迹 schema 给控制室时间线补「每步截图 + 所选元素 + 动作」三元组。
  - 边界提醒:**icon_detect 权重 AGPL**,且整套要跑 YOLO+Florence 本地模型,与玉兔6「单机零依赖」冲突——**只借「解析成 set-of-marks 再选元素」的方法与数据形态,不引其模型**(真要本地解析可换非 AGPL 轻检测,或直接用 Claude 自身视觉产清单)。
- 难度/优先级:中(借 **set-of-marks 流程 + 可点性过滤 + 轨迹 schema**;不引 AGPL/重模型)。对 computer-use 可靠性价值高。
- URL: https://github.com/microsoft/OmniParser

### RegionFocus(tiangeluo/RegionFocus)— GUI grounding 的「视觉测试时缩放」:迭代放大 + image-as-map 地标,叠在任意模型上 +28%(arXiv 2505.00684,Python,~24★,UMich×LG)
- 是什么:论文「Visual Test-time Scaling for GUI Agent Grounding」的开源实现(arXiv 2505.00684,2025-05;作者 Tiange Luo / Justin Johnson / Honglak Lee 等,UMich + LG AI Research)。核心:把 grounding 当**迭代视觉搜索**——不靠对全屏一次性出坐标,而是**动态放大到可能的区域**、减背景干扰后再定位;配 **image-as-map** 机制(每步把关键地标可视化成「星标」,给出**透明的动作记录**,便于在候选动作里择优)。实测**叠在 UI-TARS 与 Qwen2.5-VL 两个 SOTA 开源 agent 之上**,ScreenSpot-Pro +28%、WebVoyager +24%。是**纯推理期技术、零重训**。
- **值得借鉴(对口 computer-use 高分屏抓取 + 控制室可视化)**:
  - **测试时缩放 = computer-use 高分屏/密集界面的「零模型」提准法** ⭐⭐:这是本批**最可纯方法照搬**的一例——不需任何模型/权重/许可纠葛。玉兔6 可在 computer-use 里实现:**首次定位置信低/目标小时,把截图裁到候选区域、再发一次视觉查询**,逐步逼近。对 Mac/高分屏上「小图标点不准」立竿见影,且完全用现有 Claude 视觉、零依赖。
  - **image-as-map 地标 = 控制室「可解释的抓取过程」** ⭐:它把每步判断画成星标地标、留可读动作轨迹——对口玉兔6 控制室把 computer-use 的「为什么点这」可视化成**带地标的逐步截图**,比单纯记坐标信息量大,且利于监管复盘失败抓取。
  - **「叠在任意 agent 上」的定位 = 与已借模型互补**:RegionFocus 不替换 UI-TARS/UGround,而是**叠在其上提准**——印证玉兔6「不自托管 grounding 模型、只在 computer-use 外包一层搜索策略」的路线可行。
- 难度/优先级:低(**纯推理期方法、零依赖零模型**,直接落到 computer-use 的「裁剪重查」重试逻辑;仓库未标明确许可证 → 只借方法不搬代码)。对 computer-use 抓取准确率价值中–高。
- URL: https://github.com/tiangeluo/RegionFocus

### Motion(motiondivision/motion,原 Framer Motion)— 框架无关动画引擎:vanilla JS 一行 `animate()`、零构建、120fps(MIT,~32.2k★)
- 是什么:生产级动画库(原 Framer Motion 改名 Motion),一套引擎同时供 **JavaScript / React / Vue**。关键是**纯 JS 用法零构建**:`import { animate } from "motion"; animate("#box", { x: 100 })` 即可——**不需 React、不需打包步骤**;其 `motion-dom` 子包**框架无关、零依赖**。**混合引擎**——JS 调度 + 浏览器原生 API,做到 120fps GPU 加速;电池全包:手势 / 弹簧 / **layout 过渡** / 滚动联动 / 时间线;tree-shakable、体积小。官方 330+ 可复制示例。极活跃(7,688 commits、1,328 tags)。
- **值得借鉴(对口控制台/控制室 webUI + 办公室视图状态动效)**:
  - **vanilla `animate()` = 第一批 React Bits 留的缺口的「正解」** ⭐⭐:React Bits 当时记的借鉴点正是「要动效品味、但**不想引 React 构建链**」——Motion 的纯 JS API 就是落地它的工具:玉兔6 原生控制台(无 React、无 bundler)可直接 `<script>` 引一行 `animate()` 给卡片入场/状态切换/队列流动加动效,**拿到 React Bits 的品味、却不付 React 的构建代价**。
  - **layout 过渡 / 滚动联动 = 控制室「实时数据流」的现成动效原语** ⭐:控制室卡片增删/重排(队列变化、任务流转)用 Motion 的 **layout animation** 自动补间位置变化、免手写;对口呼应第四批 Mission Control 的「实时 push/polling 面板」——数据变了、UI 平滑过渡而非跳变。
  - **声明式状态动效 = 办公室小人状态切换** ⭐:办公室视图小人 idle/working/done/fail 切换,可用 Motion 的弹簧把「状态→动画」声明式化(对口第九批 LPC「状态叠加层」的运行时动效侧)。
  - **零构建 + tree-shakable**:与玉兔6「单机零依赖原生 webUI」最契合——按需引子包、CDN 直引、不进打包链。
- 难度/优先级:低(**MIT、CDN 直引、零构建**,直接给原生控制台/控制室加动效;按需引 `motion-dom`)。对控制台/控制室体验价值中–高。
- URL: https://github.com/motiondivision/motion

---
注:本批两选题各取最久未碰的一条——GUI grounding(OmniParser=屏幕解析 set-of-marks、RegionFocus=视觉测试时缩放)+ 优秀网页设计(Motion=框架无关动画)。**与早批 grounding 的关键差异**:前几批收的是要自托管的 grounding 模型,本批两例都是「**推理期、不重训、叠在任意视觉模型上**」的技术——更贴玉兔6「直接用 Claude computer-use 视觉、不自养模型」的现实,且与已借 UI-TARS(动作后校验)互补成 computer-use 的「**先标 / 缩放定位 → 点击 → 校验**」闭环;Motion 则把第一批 React Bits 的「动效品味、不引 React」缺口补上。**本批不新增待办卡**(延续第七–十批口径;第十一批因真漏洞破例已收口):三例都是对**已有线**(computer-use grounding、控制台 webUI 动效)的**设计细化 / 外部验证**,而非暴露必须立刻补的独立漏洞;OmniParser 还有 AGPL 权重 + 重模型与「单机零依赖」冲突,只宜借方法。若老板要立刻动手,**最小、最不抢跑的一步**:把 **RegionFocus 的「裁剪重查」**做进 computer-use——首次定位置信低/目标小时,自动把截图裁到候选区域再发一次视觉查询,**纯方法、零依赖、零模型、无许可纠葛、用现有 Claude 视觉**,直接提 Mac 高分屏抓取准确率,且天然接上 UI-TARS 的动作后校验。watch:OmniParser 默认分支 `master`(代码 MIT / 仓库 CC-BY-4.0、**icon_detect 权重 AGPL**、最新 v2.0.1 2025-09)、RegionFocus `main`(未标许可、arXiv 2505.00684)、Motion `main`(MIT);沿历史口径本机未做 git ls-remote HEAD-diff,commit 待网络可达回填。
## 2026-06-21 · 第十三批(选题:多智能体编排 — agent 记忆 / 上下文工程;运行 ~16:0x+08:00)

> 本批轮换回**最久没碰的「多智能体编排」线**(上次专攻还是第八批 ~12:0x 的 PocketFlow / ADK / LangGraph,之后九–十二批都在像素 / 网关 / 队列 / GUI grounding 上)。但这次刻意切一个**全新角度——编排的「共享记忆 / 上下文工程」层**:玉兔6 的多智能体协作现在**全靠 `board/` 下一堆 markdown 当共享记忆**(direction / status-rollup / progress / decisions / insights / 交接文档),去重靠 `seen-repos.json` 手动维护。这套「文件即记忆」简单可控,但**已露出可观察的疲态**:`insights.md` 已 97KB、`status-rollup.md` 32KB 还在涨,基本是**只追加、少整理、覆盖式更新、无溯源**。本批三例正是 2026 年 agent memory 赛道**三种最有代表性的记忆架构**,各补玉兔6 文件记忆的一处短板,且都能**只借「数据形态 / 写入流程」、不引重后端**(Letta 的 Postgres、Graphiti 的图库、Mem0 的向量库一律不搬),贴「单机零依赖」。另记一个**雏形 watch**:`fjwood69/mori`(AGPL-3.0,MCP server,Claude Code/Cursor 的共享记忆层,lifecycle hook 零插桩抓取 + 「dream 管线高召回过量产候选、非人工 promote 不入 canon」+ `MORI_STANDARDS_DIR` 把 .md 当受保护记忆 + 跨实例 typed 留言)——**概念上和玉兔6 几乎同构**,但仅 2★/78 commits、太早,本批不占正式案例位,只挂关注。

### Letta(letta-ai/letta,前身 MemGPT)— OS 式分层记忆 + 模型「自编辑记忆块」+ sleep-time 整理(Apache-2.0,~23.4k★,Python,v0.16.8 / 2026-05 活跃)
- 是什么:把「LLM 当操作系统」的记忆框架(MemGPT 改名 Letta)。核心三件套:① **OS 式记忆层级**——main context = RAM(进上下文窗)、recall + archival = disk(外存),agent 在固定窗口下维持「事实上无限」的记忆;② **带标签的记忆块(memory blocks)**——把 persona / human / 任务等拆成 labeled block,**模型在正常回合里用记忆工具直接增改对应块**,而非整文重写;**全部上下文(含记忆块)走 git 追踪**可回溯;③ **sleep-time compute**——给 agent 一个**没有用户输入的回合**专门「整理记忆」:合并 archival 条目、重写已写乱的块、把近期对话压成稳定笔记(`/sleeptime`,并有 `/doctor` 审记忆质量)。配套 Letta Code(终端 CLI,支持 skills/subagents),模型无关。
- **值得借鉴(对口编排层「board 共享记忆」的维护方式)**:
  - **「带标签记忆块 + 模型在回合内自编辑」= board 从「整文覆写」升级为「按块增改」** ⭐⭐:玉兔6 现在各 agent 写 `status-rollup.md` 基本是整段覆盖、越写越乱。借 Letta 范式:把 board 拆成**带标签的记忆块**(direction / 当前状态 / 决策 / 风险 / persona),让秘书/总管在正常回合内用「改某个 block」的小工具更新对应块,**每块单独版本化**——改动可控、可 diff、可回溯,正补 status-rollup「越滚越大、改一处动全篇」的痛。
  - **sleep-time「整理回合」= 洞察员/秘书定时任务的现成新职责** ⭐⭐:洞察员本就是 4 小时定时跑的——完全可在「没有新洞察可写」的回合插一个 **Letta 式整理回合**:把 97KB 的 `insights.md`、32KB 的 `status-rollup.md` 做**合并重复 / 压缩冗长 / 旧条目下沉归档**。这是本批对玉兔6 **可观察的 board 膨胀**最直接的解法,且不增任何外部依赖。
  - **「记忆走 git 追踪」= 已契合 board 现状**:board 本就是文件,Letta 印证「记忆变更可版本化/可审计」这条路是对的,可顺势把记忆块改动纳入提交粒度。
  - 边界:Letta 本体是 **Postgres + 服务端 + alembic + Docker** 的重运行时(Python 99.5%),和「单机零依赖原生」冲突——**只借「记忆块 + 自编辑工具 + sleep-time 整理」的编排方法与数据形态,不引服务端/数据库**。
- 难度/优先级:中(借「按块自编辑 + sleep-time 整理回合」两个机制,落到现有 markdown board + 洞察员定时任务;不引服务端)。对**编排记忆质量 / 防 board 膨胀**价值高。
- URL: https://github.com/letta-ai/letta

### Graphiti(getzep/graphiti,Zep 的记忆引擎)— 给 agent 记忆的「双时态知识图谱」:事实带有效期、失效不删除、可溯源到原始 episode(Apache-2.0,~27.4k★,Python)
- 是什么:专为 agent 记忆造的**实时知识图谱**库(Zep 托管记忆服务的底座)。关键不是「又一个 RAG」,而是**双时态(bi-temporal)事实管理**:① 每条事实有**有效期窗口**——信息变了,旧事实被**标记失效(invalidate)而非删除**;可查「**现在**为真什么」也可查「**过去任一时点**为真什么」;② **两条时间线**——valid time(在世界里何时为真)+ ingestion/provenance time(何时被记进来);③ **Episodes & 溯源**——每个实体/关系都能回溯到产生它的**原始 episode**(从派生结论到源头的完整 lineage);④ **增量更新**——新数据即时融入、无需批量重算。
- **值得借鉴(对口 status-rollup / decisions 的「可追溯 + 不丢历史」)**:
  - **「事实=主体+谓+客体+有效期+来源」的数据形态 = decisions/status 从「覆盖式」升级为「带时态可追溯」** ⭐⭐:玉兔6 的 `status-rollup.md` / `decisions.md` 现在是新状态盖旧状态,**丢了「何时为真 / 为何改 / 谁产生」**。借 Graphiti 的数据形态:给 board 每条关键事实加 **valid_from / valid_to + source(哪次运行 / 哪张 ticket / 哪条洞察)**,旧事实标失效而非抹掉——这样 board 能回答「**现在**结论是什么 / **上周三**是什么 / 这条**从哪来**」,对老板复盘、监管审计、排查「状态为何回滚」价值极高。
  - **「失效不删除 + 溯源」= 控制室时间线的现成语义** ⭐:对口控制室把任务/状态流转画成时间线时,**失败或变更可一路追到源 episode**,而非只看到当前快照;和早批已收的「eventlog 复盘」一脉相承,但补上了「事实级」的因果链。
  - **增量更新**:契合洞察员每 4 小时增量写入——新洞察作为一个 episode 融入,不必重算全量。
  - 边界:Graphiti 默认要 **Neo4j / FalkorDB 图库**——**只借数据形态(双时态字段 + invalidate 语义 + source_episode 溯源)**,落到 board 的 markdown front-matter 或一个轻量 SQLite 即可,**不引图数据库**。
- 难度/优先级:中(借「双时态 + 失效不删 + 溯源」三件数据形态,落 front-matter/SQLite)。对 **status-rollup / decisions 可追溯性、控制室时间线**价值中–高。
- URL: https://github.com/getzep/graphiti

### Mem0(mem0ai/mem0)— 通用 agent 记忆层:写入期「抽事实 → 自动判 ADD/UPDATE/DELETE/NOOP」的记忆更新管线(Apache-2.0,~56k★,被 AWS 选为 Agent SDK 记忆层)
- 是什么:adoption 最高的开源 agent 记忆层(~56k★,AWS Agent SDK 的官配记忆)。最值得学的是**写入侧的「记忆更新」流程**:调 `add()` 时,系统先从对话**抽取原子事实/偏好**,再对每条候选**与已有记忆比对、由 LLM 判定该 ADD(新增)/ UPDATE(改写已有)/ DELETE(删过期矛盾)/ NOOP(无操作)**;底层混合 **vector + key-value + graph** 三存,各类信息分流存放。重点:**它把「记忆该怎么写」做成了一道显式管线**,而不是无脑追加。
- **值得借鉴(对口 board「只追加→会膨胀/会矛盾」的写入期治理)**:
  - **写入期 ADD/UPDATE/DELETE/NOOP 判定 = board 防膨胀防矛盾的「缺失的那道闸」** ⭐⭐:玉兔6 的 board 现在是**追加为主**(`insights.md` 一直 append、`status-rollup` 越滚越长),缺「这条新信息**到底该新增、还是改一条旧的、还是删一条过期的**」的写入期判断,长期必然重复+矛盾+膨胀。借 Mem0:秘书/总管/洞察员写 board 前过一道**记忆更新管线**——先把要写的内容**抽成原子事实**,再逐条判 ADD/UPDATE/DELETE/NOOP,只落该落的。这对**已经 97KB 的 insights / 32KB 的 status-rollup** 是治本。
  - **正是洞察员 `seen-repos` 去重逻辑的「通用化升级」** ⭐:洞察员现在只对「URL」做去重(ADD vs NOOP 的特例);Mem0 的范式把它**推广成对任意事实的「去重 + 合并 + 失效」**——同一套思路从「不重复推荐仓库」扩到「不重复/不矛盾地记任何状态」,迁移成本低、概念自洽。
  - **抽成原子事实再存**:和 Graphiti 的「事实级」一拍即合——可与上一例**组合**:Mem0 管「写入期该不该写、怎么合并」,Graphiti 管「写进去的事实带时态与溯源」。
  - 边界:Mem0 也带 vector/graph 后端——**只借「写入期抽取-消解管线 + ADD/UPDATE/DELETE/NOOP 分类法」这套流程与决策规则**,落到 board 的纯文本/JSON,不引向量库。
- 难度/优先级:中(借写入期「抽事实→判 ADD/UPDATE/DELETE/NOOP」管线,先用在 `status-rollup` 与 `seen-repos` 的合并上)。对 **board 防膨胀/防矛盾**价值高,且是现有去重逻辑的自然延伸。
- URL: https://github.com/mem0ai/mem0

---
注:本批选题「多智能体编排」取**全新角度——编排的共享记忆/上下文层**(玉兔6 现实=`board/` 文件即记忆)。三例形成一条**互补链**:**Letta** 管「记忆怎么按块维护 + 定时整理(sleep-time)」、**Graphiti** 管「记忆怎么带时态与溯源、失效不删」、**Mem0** 管「记忆写入期该不该写/怎么合并(ADD/UPDATE/DELETE/NOOP)」——三者都**只借数据形态/写入流程、不引各自重后端**(Postgres/图库/向量库一律不搬),贴「单机零依赖原生」。**本批不新增待办卡**(延续七–十、十二批口径;唯十一批因真漏洞破例):三例都是对**已有 board 记忆机制**的**设计升级**,而非暴露必须立刻补的独立漏洞。但本批与往批不同的是——玉兔6 **自己的 board 已有可观察的膨胀信号**(`insights.md` 97KB、`status-rollup.md` 32KB、只追加少整理),所以**若老板要立刻动手,最小、最不抢跑的一步**:给洞察员/秘书加一个 **Mem0 式写入期闸 + Letta 式 sleep-time 整理回合**,先只作用在 `status-rollup.md` 上——写前把内容抽成原子事实判 ADD/UPDATE/NOOP、并在空闲定时回合合并重复/下沉旧条目,**纯方法、零外部依赖、用现有文件与定时任务**,直接止住 board 膨胀。watch:Letta 默认分支 `main`(Apache-2.0,v0.16.8 / 2026-05)、Graphiti `main`(Apache-2.0,~874 commits)、Mem0 `main`(Apache-2.0,AWS Agent SDK 官配);另挂关注 `fjwood69/mori`(AGPL-3.0,2★/78 commits,概念同构但太早,后续看是否成型)。沿历史口径本机未做 git ls-remote HEAD-diff,commit 待网络可达回填。
## 2026-06-21 · 第十四批(选题:Unity(Simulaid)— AI 编辑器自动化 / AI 自动 playtest / 构建-测试 CI;运行 ~20:0x+08:00)

> 本批轮换回**最久没碰的「Unity(Simulaid)」线**——早期仅收过 CoplayDev/unity-mcp 一个,之后八–十三批全在编排/像素/网关/队列/grounding/记忆上,Simulaid 这条彻底冷了。而 Simulaid 是玉兔6 唯一的**真实在产游戏项目**(团结引擎 1.8.5 = Unity 2022.3.62t7,2D 像素卡牌,已上 TapTap,需补鸿蒙),brief 明确列了「AI 提速:团结 AI Assistant + Peekaboo 驱编辑器 + 试 Unity 系 MCP 装进团结」,且 status.md 里**反复卡在同一处**:§17 视觉硬门要 Peekaboo 截图对照,但沙箱 EPERM + Peekaboo 权限未授权,办公室视图改造**连续三轮返修都因截不到图过不了门**。本批三例正贴 Simulaid 工作流的**三根支柱**——① AI 在编辑器内开发+测试(MCP)② AI 自动玩游戏做回归/基准(playtest)③ 构建-测试-交付流水线(CI),且都能**只借方法/数据形态/流水线结构,不搬重运行时**,贴「单机零依赖 + 团结引擎(非标准 Unity)」的现实。三例与早期已借 CoplayDev/unity-mcp **同线但不同层/不同角度**(下文逐条标差异)。

### IvanMurzak/Unity-MCP — Unity 的「AI 技能 + MCP 工具 + CLI」,全套 AI 开发-测试闭环,任意 C# 方法一行变工具(Apache-2.0,~3k★,2,897 commits,158 releases,最新 0.77.1 / 2026-06-03 极活跃)
- 是什么:把 AI 助手接进 Unity 的 MCP 工具集,但比早期已借的 **CoplayDev/unity-mcp 多三层**:① **「任意 C# 方法加一行注解即变 MCP 工具」**——不止内置工具,你项目里的方法也能直接暴露给 agent;② 内置 **52 工具 / 48 prompt,12 类**(Assets/GameObject/Scene/Editor/**Script**/Package/Object/**Reflection**/**Screenshot**/**Console**/**Tests**/Type);③ **CLI 一键写 14 种 agent 的 MCP 配置、支持无编辑器 UI 的 headless/CI 安装**。亮点工具:`script-execute`(用 **Roslyn 动态编译+执行 C#**,免全量重建即可跑检查)、`screenshot-game-view`/`screenshot-scene-view`/`screenshot-isolated`(**在编辑器内**渲染截图,甚至把单个 GameObject 孤立出来从指定角度渲染)、`Tests`/`Console` 工具组。架构 = MCP Client + 独立 .NET MCP Server + Unity 插件(在主线程执行 Unity API);提供各 CPU 架构预编译 server 二进制。
- **值得借鉴(对口 Simulaid「AI 提速」+ §17 视觉硬门 + 玉衡测试门 + UI 回归)**:
  - **「任意 C# 方法一行变工具」= 把 Simulaid 自己的命令行方法直接交给 agent** ⭐⭐:Simulaid 已有一批 batchmode 方法(`SimulaidTestRunner.RunAll`、`SimulaidCommandLineBuild.BuildAndroidApk`、存档校验、`ApplyCardSurfaceButtonChrome` 等),现在靠人工拼命令行调。借 IvanMurzak 的「方法→工具」模式,可把这些**关键方法暴露成 MCP 工具**,让写码员工/玉衡直接「调用 RunAll / 触发构建 / 查存档兼容」,而非记忆冗长 batchmode 命令——正落 brief 的「试 Unity 系 MCP 装进团结」。
  - **编辑器内 Screenshot 工具组 = §17 视觉硬门反复卡死的「绕开 Peekaboo」解** ⭐⭐:这是本批**对 Simulaid 当下最痛点的直接命中**——status.md 显示办公室视图/UI 改造**连续三轮返修全卡在「Peekaboo 截不到图」**(沙箱 EPERM + Screen Recording/Accessibility 未授权)。IvanMurzak 的 `screenshot-game-view`/`scene-view`/`isolated` 是**在 Unity 编辑器进程内渲染出图**,不走系统级屏幕录制授权——理论上可**绕开 Peekaboo 的系统权限死结**,给 §17「带视觉产物必须渲染自查 + 对照截图」一条沙箱内可行的取证路径。`screenshot-isolated`(单 GameObject 孤立渲染)还能给**像素卡牌/角色 sprite 的逐个对照**用。
  - **Tests / Console 工具组 = 玉衡测试门 + bug ledger 的 agent 化** ⭐:把 `SimulaidTestRunner.RunAll` 的运行 + Console 报错回收做成 agent 可读工具,正接 Simulaid「源/运行时/UI/存档有改→先玉衡跑测试门」的强制流程 + `SIMULAID_BUG_REGRESSION_LOG.md`。
  - **Roslyn `script-execute`(免全量重建跑检查)= UI raycast/命中守卫的快速验证** ⭐:Simulaid 的 UI 回归很重(button raycast 命中、遮挡、rebuild 后可点性),`simulaid-unity-maintenance` 要求「加交互控件须同回合加命中守卫」;Roslyn 动态执行可在**不全量构建**下跑一段命中路径检查,提速这类守卫验证。
  - 边界:团结引擎是 Unity 2022.3 的 fork,**Unity-MCP 的 package / .NET bridge 不保证 100% 兼容团结**,真接入须先在团结上验证;只借「方法→工具 + Screenshot/Tests 工具设计 + CLI headless 安装」的模式,不假设即插即用。Apache-2.0 商用友好。
- 难度/优先级:中(借**方法→工具模式 + 编辑器内截图 + Tests/Console 工具设计**;真装需在团结验证 bridge 兼容)。对 **Simulaid AI 提速 + §17 视觉硬门解套**价值高。
- URL: https://github.com/IvanMurzak/Unity-MCP

### lmgame-org/GamingAgent(LMGame Bench)— LLM/VLM「agent 自动玩游戏」的标准化 harness + 模型评测(MIT,~934★,554 commits,ICLR 2026 / arXiv 2505.15146)
- 是什么:让 LLM/VLM agent 在**标准化交互游戏环境**里玩游戏 + 评测的框架。两大能力:① 在多款游戏上裸测 SOTA 模型(无 harness 单模型 VLM);② 用其 **GamingAgent workflow(gaming harness)** 部署+评测以提升 agent 游戏表现。工程形态值得学:**Gymnasium 标准接口**(每个游戏实现 observation making + agent action processing 两个方法即接入)、**每游戏 `config.yaml` + `module_prompts.json`**、**episode logs / performance cache**、**replay 视频生成**(从 episode log 重放)、以及**「computer-use gaming agent(CUA)」在本机 PC 直接跑**。加自己游戏只需实现「观察器 + 动作处理器」+ 给一份 agent config。
- **值得借鉴(对口 Simulaid `GameAgentBenchmark.md` + 玉衡 + UI 回归 + computer-use 驱动游戏)**:
  - **正是 Simulaid `GameAgentBenchmark.md` 的「产品化版本」** ⭐⭐:Simulaid 已有 `GameAgentBenchmark.md`,要记「observation state / legal operations / scoring / evidence paths / regression entry points / manual review / rollback」——GamingAgent 把这套**做成了可跑的 harness**。借其结构把 Simulaid 基准升级成:**观察器(截游戏画面→结构化状态)+ 动作处理器(合法操作集)+ 每场景 config + episode log + 评分 + replay**,让一个 VLM agent 自动玩 Simulaid 跑**冒烟/回归**,产出**可评分、可回放的证据**(对口 §17 视觉硬门 + 玉衡测试门,补「自动化 playtest」这块 Simulaid 现在完全靠手测的空白)。
  - **computer-use gaming agent = 贴 Simulaid 的 Peekaboo/computer-use 路线** ⭐:GamingAgent 的 CUA「在本机直接玩」正对应 Simulaid 用 computer-use/Peekaboo 驱编辑器/真机;借其 **observation→action→episode-log** 的循环数据形态,把 Simulaid 的手动 UI 回归升级成「agent 玩一遍→留逐步截图+动作+评分」,与本批 IvanMurzak 的编辑器内截图互补(一个出图、一个玩+评分)。
  - **replay 视频 + episode log = 控制室/交付取证的现成数据形态** ⭐:Simulaid 交付要带「测试日志尾 + 截图 + APK 路径」证据;GamingAgent 的 episode log→replay 视频正好给「这次回归 agent 怎么玩的、哪步崩」留可回放证据。
  - 边界:GamingAgent 跑的是经典游戏(Sokoban/Tetris/2048/宝可梦…)、走 gym/retro 模拟器,Simulaid 是团结手游、**无 gym 接口**;只借「observation/action/episode-log/scoring/replay」的 **harness 结构与数据形态**,不搬 gym/retro 运行时。MIT 友好。
- 难度/优先级:中(借 harness 结构 + episode/scoring/replay 数据形态,落到 `GameAgentBenchmark.md` + computer-use playtest;不搬 gym 运行时)。对 **Simulaid 自动化回归/playtest 取证**价值中–高。
- URL: https://github.com/lmgame-org/GamingAgent

### GameCI(game-ci/unity-builder + unity-test-runner)— Unity 项目的 CI 标准件:batchmode 多平台构建 + play/edit 测试 + Library 缓存提速(MIT)
- 是什么:把 Unity 的**测试 + 构建**做成 GitHub Actions 标准件的开源项目。`unity-test-runner` 跑任意 Unity 项目的 **play & edit mode 测试**(可配 coverage);`unity-builder` **batchmode 构建多目标平台**;典型流水线 = 先测试验证无 error、再对所有目标平台构建。提速关键:用 GitHub Actions cache 把上次构建的 **Library 目录缓存复用**(Unity 构建大头),并处理 **Unity license 激活**。全 MIT。
- **值得借鉴(对口 Simulaid「优化-构建-交付一条龙」+ batchmode 测试门 + 多平台/鸿蒙 + 提速)**:
  - **「test-runner→build-matrix→artifact」流水线骨架 = Simulaid 一条龙的参考结构** ⭐:Simulaid 现在 batchmode 跑 `SimulaidTestRunner.RunAll` + `SimulaidCommandLineBuild.BuildAndroidApk` 是**各自手动命令**;GameCI 的「先跑 play+edit 测试门 → 通过再进多平台构建 matrix → 产出 artifact」是把这串**标准化成一条流水线**的现成骨架,正对口 `simulaid-optimize-build-deliver` 想要的「一条龙」。
  - **Library 缓存提速 = Simulaid 构建提速的现成法** ⭐:Unity 构建最慢在重建 Library;GameCI「缓存复用上次 Library」的做法可直接借到 Simulaid 本机/CI 构建,显著缩短「优化→构建→交付」周期。
  - **多平台 build matrix = 「补鸿蒙 HarmonyOS 构建路径」的标准化挂载点** ⭐:Simulaid 待办明确要补鸿蒙导出(ProjectSettings 有 openHarmony 字段、缺专用构建入口);GameCI 的**按平台 matrix** 思路给「新增一个目标平台的构建 job」一个干净结构,鸿蒙可作 matrix 里新增的一档(构建脚本仍自写)。
  - 边界:GameCI 面向**标准 Unity + GitHub Actions 云 + Docker 镜像**;Simulaid 用**团结引擎(非标准 Unity 版本)+ 本机交付(夸克/APK)+ TapTap**,**GameCI 的官方镜像大概率不含团结**,不能直接跑;只借「test→build matrix + Library 缓存 + license 激活流程」的**流水线设计**,落到 Simulaid 的本机 batchmode 脚本,不一定上 GitHub Actions。MIT 友好。
- 难度/优先级:中(借**流水线结构 + Library 缓存提速 + matrix 多平台**;团结/鸿蒙/本机交付需自适配,不直接搬云 CI 镜像)。对 **Simulaid 构建交付提速 + 鸿蒙挂载点**价值中。
- URL: https://github.com/game-ci/unity-builder · https://github.com/game-ci/unity-test-runner

---
注:本批轮换回**最冷的「Unity(Simulaid)」线**(早期仅收 CoplayDev/unity-mcp 一个),三例构成 Simulaid 工作流的**三支柱闭环**——IvanMurzak/Unity-MCP=编辑器内 AI 开发+测试+**截图**;GamingAgent=AI 自动玩游戏做回归+**评分/回放**;GameCI=**测试-构建-交付**流水线+缓存——且都「只借方法/数据形态/流水线,不搬重运行时」,贴团结引擎(非标准 Unity)+ 单机现实。**与早期 CoplayDev/unity-mcp 的差异**:那是「AI↔编辑器桥」的通用款,本批 IvanMurzak 多了「自有 C# 方法一行变工具 + 编辑器内截图 + headless CLI」三层、且正好命中 Simulaid 的真痛点。**本批不新增待办卡**(延续七–十、十二、十三批口径;唯十一批因真漏洞破例):三例都是对**已有 Simulaid 方向**(brief 已写「试 Unity 系 MCP」)的**外部验证 / 设计细化**,且接入团结引擎都需先验证兼容性(探索性,非即插即用的纯文件改动),不构成「必须立刻补的独立漏洞」;Simulaid 项目工作归 supervisor-Simulaid,洞察员只沉淀分析。**但若老板要立刻动手,最小、最值博的一步**:验证 **IvanMurzak 的编辑器内 `screenshot-game-view`/`isolated` 能否在团结跑**——因为 status.md 显示 §17 视觉硬门**已连续三轮返修卡死在 Peekaboo 系统级授权**,而编辑器内截图**不走屏幕录制权限**,这是当下 Simulaid 最高频的阻塞点,值得一次小验证(若团结兼容,直接解套 §17;若不兼容,也只损一次探索)。watch:IvanMurzak/Unity-MCP 默认分支 `main`(Apache-2.0,最新 0.77.1 / 2026-06-03)、GamingAgent `main`(MIT,arXiv 2505.15146 / ICLR 2026)、GameCI unity-builder/unity-test-runner `main`(均 MIT);本机 git ls-remote 仍被代理拦截(HTTP 403),commit 待网络可达回填。
## 2026-06-22 · 第十五批(选题:像素素材与画风 / 优秀网页设计 — 语义网格自动出图 / 零依赖 autotile / CDN 直引仪表盘;运行 ~00:0x+08:00)

> 本批轮换回**两条最冷的线**:「像素素材与画风」(上次第九批 06-21 00:0x 的 LPC / spritebrew / TileGen)+「优秀网页设计」(深度上次还是第七批 06-20 18:2x 的 taste-skill / Impeccable,第十二批只用 Motion 轻触动效)——其间十–十四批都在 skills / 网关 / 队列 / grounding / 记忆 / Unity 上,这两条彻底冷了。三例贯穿一个共同主题——**「零构建 / 零依赖即可落地」**,正贴玉兔6 原生 webUI:webtyler 是纯 HTML autotile 生成器、Tabler 是 CDN 直引零构建的仪表盘组件库,两者都能**直接嵌**玉兔6 原生前端;LDtk 则提供「语义网格→规则自动出图」的**数据形态参考**。两条线各自映射到玉兔6 的真实组件:**像素办公室视图**(LDtk 的 IntGrid + auto-layer、webtyler 的 autotile)+ **控制台 / 控制室 webUI**(Tabler 组件)。三例栈差异都按惯例「借数据形态 / 算法 / 组件范式,不引重运行时」。

### LDtk(deepnight/ldtk)— 《Dead Cells》作者出品的现代 2D 关卡编辑器:语义网格 + 规则化 Auto-Layer + 干净 JSON 关卡格式(MIT,~4k★,7,367 commits)
- 是什么:Motion Twin 的 deepnight(Sébastien Bénard,《Dead Cells》作者)做的**现代、轻量、开源 2D 关卡编辑器**,主打易用。技术栈 Haxe + Heaps.io + Electron 桌面应用。核心是**分层编辑**——Integer Grid 层 / Tile 层 / Entity 层 / **Auto-Layers**;最值得学的是 **规则化 Auto-Layer(用户自定义的自动贴图规则)**:你只画一张**语义 IntGrid**(给格子标语义值,如 墙=1 / 地板=2),规则引擎按**邻居模式**自动放对应砖(类 Wang/bitmask,但规则可由用户编排)。另两大资产:**干净的 .ldtk JSON 文件格式**(有文档、「兼容所有语言与游戏框架、用 JSON 便于解析」)+ 独立的 Haxe API 仓库 + 多引擎 loader;**Entity 带 typed 自定义字段**;默认调色板 Endesga32(lospec)。MIT,51 个 release(注:最新 v1.5.3 停在 2024-01,发版偏慢)。
- **值得借鉴(对口像素办公室视图 / Simulaid 场景 / 控制室数据形态)**:
  - **IntGrid + 规则化 Auto-Layer = 像素办公室「语义网格→自动出图」的现成范式** ⭐⭐:玉兔6 像素办公室(已借 agents-in-the-office 的 autotile)现在地板 / 墙体 / 工位怎么摆,LDtk 的范式是「**先画语义网格(墙=1 / 地板=2 / 工位=3),规则按邻居自动贴正确的砖**」。借它把办公室场景从「手摆每块砖」升级成「**改语义网格→自动重绘**」——改布局只动 IntGrid、不碰像素,正补 autotile 之上的「关卡可编辑性」。
  - **.ldtk JSON 数据形态 = 办公室 / 场景「可版本化、可被 agent 读写」的关卡格式** ⭐⭐:它的 JSON schema 把「层 / 砖 / 实体 / 自定义字段 / 世界坐标」结构化——对口玉兔6「文件即数据、零依赖」,可借其数据形态给办公室视图定义一个 **board 可读写的场景 JSON**(agent 改 JSON → 前端重渲),而非把布局**写死在前端代码**里。呼应已借 agents-in-the-office 的 tool→工位映射。
  - **Entity + typed 自定义字段 = 「工位 / 小人」绑定状态的数据模型** ⭐:LDtk 的 Entity(带 typed 字段)正对口「一个工位 = 一个 agent,带 status / 当前任务 / 告警字段」,前端按字段渲染状态(idle / working / fail),并可接第十二批 Motion 的状态动效。
  - 边界:LDtk 本体是 **Haxe + Electron 桌面应用,不引其运行时**;只借「**IntGrid + 规则 Auto-Layer 的数据形态 + .ldtk JSON schema 思路**」,前端用现有原生 canvas/JS 渲染。发版偏慢(v1.5.3 / 2024-01)→ 作**数据模型 / 编辑范式参考**而非追新工具。MIT 商用友好。
- 难度/优先级:中(借 IntGrid + 规则 auto-layer 数据形态 + .ldtk 场景 schema;不引 Haxe/Electron 运行时)。对**像素办公室视图布局可维护性**价值中–高。
- URL: https://github.com/deepnight/ldtk

### webtyler / autotyler(wareya)— 纯 HTML、零依赖的 autotile 生成器,杀手锏是「margin offset」悬顶切割(Apache-2.0,webtyler 324★,HTML 100%)
- 是什么:把「**小 / 不完整的 autotile tileset 转成完整的**」的自动贴图工具。两个仓库:**autotyler**(Rust 原版,Apache-2.0)+ **webtyler**(HTML5/JS Web 版,Apache-2.0,324★,**HTML 100%**,在 `wareya.github.io/webtyler` 浏览器内直接跑、零依赖)。支持 **9 种输入格式 / 3 种输出格式**(Godot 3x3 minimal、RPG Maker autotile chipset、GameMaker Studio 2 Auto Tile),带实时预览。**杀手锏「margin offset」**——可精确指定砖在**哪里被切**,使「**顶部超过半格(高边 / 悬顶,如有厚度的草地、墙顶)**」的砖也能正确生成,这是它区别于其他 autotile 工具的点。
- **值得借鉴(对口像素办公室 autotile / Simulaid 像素素材管线)**:
  - **零依赖 HTML autotile 生成器 = 直接可用的办公室 / 场景贴图工具** ⭐⭐:webtyler 纯 HTML/JS、浏览器内跑、零构建——和玉兔6「**单机零依赖原生 webUI**」完全同构。给像素办公室 / Simulaid 场景做地板 / 墙体 autotile 时,可**直接借它(或它的算法)**把「画几块原始砖→自动铺成完整 3×3 minimal autotile」,免手摆 47/48 格。正落已借 agents-in-the-office / TileGen 的 autotile 线,且比 TileGen(Python/Pillow)**更贴前端零依赖**。
  - **margin offset(悬顶切割)= 像素卡牌 / 角色「高边素材」对齐的现成解** ⭐:Simulaid 是像素卡牌,卡面 / 角色常有「顶部装饰超出半格」;webtyler 的 margin offset 思路可借到素材切割 / 对齐工具,避免高边被齐腰切坏——对口已借 proper-pixel-art 的「真像素网格对齐」补一块「**非半格切割**」。
  - **多输出格式映射 = 素材管线「一图多引擎导出」参考** ⭐:它一套输入出 Godot / RPGMaker / GMS2 三种排布——对口玉兔6 若要把同一批办公室砖导成「前端 canvas 用的 atlas + 团结 / Simulaid 用的排布」,可借其「**输入→多目标 bitmask 排布映射**」的数据形态。
  - 边界:Apache-2.0、纯前端,**直接借代码 / 算法成本低**。autotyler(Rust)适合离线批处理,webtyler(HTML)适合直接嵌。仓库小(324★)、无 releases → 作**轻量工具 / 算法参考**,采用前自查像素对齐与边界。
- 难度/优先级:低(纯前端零依赖 HTML,可直接嵌或借算法;Apache-2.0)。对**像素办公室 / Simulaid autotile 提效**价值中。
- URL: https://github.com/wareya/webtyler · https://github.com/wareya/autotyler

### Tabler(tabler/tabler)— CDN 直引、零构建的开源 HTML 仪表盘 UI Kit(MIT,41.1k★,Bootstrap 5,v1.4.0 / 2025-07 活跃)
- 是什么:免费开源的 **HTML Dashboard UI Kit**,建在 **Bootstrap 5** 上。MIT,**41.1k★**,3,132 commits,最新 **v1.4.0(2025-07,活跃)**。卖点:**只需基础 HTML/CSS 知识**即可用的高质量管理后台组件库——响应式、跨浏览器、HTML5/CSS3、**20+ 成品页面** + 大量组件(卡片 / 表格 / 表单 / 图表 / 导航 / 状态指示 / timeline)、多主题(Sass 改色)。**关键:CDN 直引、零构建**——`<link href="cdn.jsdelivr.net/npm/@tabler/core@latest/dist/css/tabler.min.css">` + 一个 `<script>` 即可用,**无需 npm / 打包步骤**(也提供 npm 包与 Docker 自建)。栈占比 HTML 45.8% / TS 26.7% / SCSS 26%。
- **值得借鉴(对口控制台 / 控制室原生 webUI)**:
  - **CDN 直引、零构建的成品仪表盘 = 控制台 / 控制室「要好看但不引 React 链」的最直接解** ⭐⭐:玉兔6 控制台 / 控制室是**原生 webUI、无 bundler**——Tabler 正是为「只会 HTML/CSS」的人做的,CDN 引一行 CSS+JS 就能用卡片 / 表格 / 状态徽章 / 侧边栏布局,**拿到企业级仪表盘的卖相、却零构建零依赖**。这比已借的 **Mission Control(Next.js)、以及付费的 Signal Dashboard(shadcn/React)都更贴玉兔6 的「单文件、CDN、无 React」约束**——是第四批控制室信息架构在「**可直接落地的原生组件**」上的补位。
  - **20+ 成品页面 + 组件目录 = 控制室面板的现成视觉词汇** ⭐:队列 / 任务 / 告警 / 质量门这些面板,可直接照 Tabler 的卡片 / 表格 / timeline / 状态徽章排版,省自研 CSS;把已借 taste-skill / Impeccable 的「设计品味」落到「**现成 Bootstrap 组件**」。
  - **Sass 多主题 + CSS 变量 = 控制台换肤 / 暗色的现成机制** ⭐:多主题改色对口控制室暗色 / 品牌色,免手写主题系统。
  - 边界:依赖 **Bootstrap 5 的 CSS/JS**(CDN 即可、**无 React / 无构建**),引入即多一套 Bootstrap 约定——按需引子集、或只借其**组件 HTML/CSS 范式**;**并非零第三方 CSS**(Bootstrap 是底座),与「绝对零依赖」有取舍,但「CDN 直引、无构建链」已是同类里最贴的。注意默认分支是 **`dev`**。MIT 商用友好。
- 难度/优先级:低(MIT、CDN 直引、零构建,直接给原生控制台 / 控制室套组件;按需引子集)。对**控制台 / 控制室 webUI 卖相与开发提效**价值中–高。
- URL: https://github.com/tabler/tabler

---
注:本批轮换回两条最冷的线——像素素材与画风(上次第九批 06-21 00:0x)+ 优秀网页设计(深度上次第七批 06-20 18:2x、第十二批仅 Motion 轻触)。三例共一主题「**零构建 / 零依赖即可落地**」:**webtyler**(纯 HTML autotile)、**Tabler**(CDN 直引仪表盘)都能直接嵌玉兔6 原生 webUI,**LDtk** 提供「语义网格→规则自动出图 + .ldtk JSON 场景」的数据形态参考;映射到真实组件 = 像素办公室视图(LDtk + webtyler)+ 控制台 / 控制室(Tabler)。**本批不新增待办卡**(延续七–十、十二–十四批口径;唯十一批因真漏洞破例):三例都是**可直接采用的工具 / 数据形态参考 / 设计选择**,而非「必须立刻补的独立漏洞」;是否换肤 / 换素材管线属产品 / 主管决策,不应由洞察员直接堆成待办。**但若老板要立刻动手,最小、最不抢跑、可逆的一步**:① 把 **Tabler 的 CSS/JS 从 CDN 引进控制室一个面板做 A/B 试套**(纯前端、零构建、MIT、可一键回退),立刻提卖相且不锁死;或 ② 在像素办公室素材管线里**用 webtyler 跑一次地板 / 墙体 autotile** 验证省工——两者都零依赖、低风险、随时可撤。watch:LDtk 默认分支 `master`(MIT,最新 v1.5.3 / 2024-01,发版偏慢)、webtyler `main`(Apache-2.0,324★,HTML 100%,无 releases;另含 autotyler Rust 原版)、Tabler **`dev`**(MIT,v1.4.0 / 2025-07 活跃)。本机 git ls-remote 仍被代理拦截(HTTP 403,本批已实测),commit 待网络可达回填。
## 2026-06-22 · 第十六批(选题:LLM 网关 + AI agent 工具与 skills — 成本-质量模型路由 / 可组合技能即强制工作流 / 子智能体花名册与最小权限;运行 ~04:0x+08:00)

> 本批轮换回**两条最久没碰的线**:「LLM 网关」+「AI agent 工具与 skills」(两者上次同台还是第十批 06-21 ~04:0x;其间十一–十五批都在队列 / grounding / 记忆 / Unity / 像素 / 网页设计上,这两条整整冷了一天)。但本批刻意**避开第十批已收的角度**(provider 统一 / 语义缓存 / MCP 网关 / 护栏 / 可观测 / 意图路由 / skill 注册-扫描),换一个把两条线**拧成一股的全新主题——「模型分级 / 成本-质量路由」**:玉兔6 现在跑一大批 agent 角色(秘书 / 总管 / 洞察员 / 写码员工 / 玉衡 / supervisor-Simulaid…),但从 board 看,**模型档位基本是「一刀切 / 人工指定」**,既没有「按角色定默认档」也没有「按任务难度动态路由」。本批三例正好补这条链的三段:**LLMRouter** = 按难度把查询路由到便宜 / 强模型的可评测路由库;**Superpowers** = 把技能做成「自动触发的强制工作流 + subagent 两段式审查」的方法论;**VoltAgent 子智能体集** = 每角色一份「name / description / tools / model」模板 + 最小工具权限 + per-role 模型档。三者都能**只借数据形态 / 决策规则 / 模板,不引各自重后端**(训练管线 / 向量库 / 插件全不搬),贴「单机零依赖 + new-api 旁路、不替代」的现实。**Starlaid 全程排除。**

### LLMRouter(ulab-uiuc/LLMRouter,UIUC U Lab)— 把「成本-质量 LLM 路由」做成可评测库:16+ 路由器 / 4 路由族 / 冷启动 profiling(MIT,~1.4k★,416 commits,v0.3 活跃;前身研究线 GraphRouter ICLR'25 / Router-R1 NeurIPS'25 / RouteProfile 2026-05)
- 是什么:把分散在论文里的 LLM 路由方法统一成一个**可训练、可评测、可部署**的库。核心:**按 query 难度 / 类型,把简单请求路由到便宜小模型、难请求才上强模型**,在保住质量的前提下省成本(对照经典 lm-sys/RouteLLM ~4.5k★:MT-Bench 省 ~85% 成本仍保 ~95% GPT-4 质量)。LLMRouter 把路由器分**四族**——single-round / multi-round / **agentic** / personalized,内置 16+ 路由策略(KNN / SVM / MLP / 矩阵分解 / Elo / 图路由 / BERT 路由 / 混合概率…);配**统一 CLI(训练 + 推理 + 交互)+ Gradio UI + 从 11 个 benchmark 自动生成训练数据**的完整管线。其 **RouteProfile(2026-05)** 专攻**冷启动**:沿组织形态 / 表示类型 / 聚合深度 / 学习配置四维给 LLM 建 profile,**新模型没有历史数据也能路由**。
- **值得借鉴(对口编排层「模型分级路由」+ LLM 网关 new-api 旁路 + 成本治理)**:
  - **按难度 / 类型的 cost-quality 路由 = 玉兔6 多 agent 调用的「缺失的省钱闸」** ⭐⭐:玉兔6 一堆 agent 任务难度差极大——去重 / 格式化 / 状态汇总属「简单」、架构设计 / 代码审查 / 洞察分析属「难」。借 RouteLLM/LLMRouter 的范式:**简单任务路由到便宜档(如 Haiku)、难任务才上强档(Sonnet/Opus)**,直接砍成本而不掉质量;落点是 new-api **旁路**的一个轻量路由层(读任务类型 / 标签 → 选档),不替代 new-api、不引训练后端。
  - **「4 路由族 + 阈值校准 + benchmark 数据生成」= 把路由做成可评测、而非拍脑袋** ⭐:玉兔6 若上分级路由,最大风险是「档位拍错 → 省了钱掉了质量」;LLMRouter 的价值是给出 **win-rate 校准 + 用 benchmark 评测路由质量**的工程范式——可借其「**先离线评测路由阈值、再上线**」的方法,把「哪类任务该走哪档」用数据定下来。
  - **RouteProfile 冷启动 = 玉兔6 接新模型时的现成参考** ⭐:每次有新模型上线(玉兔6 模型档会变),冷启动 profiling 让「没有历史调用数据也能先合理路由」,免一段盲目期。
  - 边界:LLMRouter 是 **research-grade**(带训练 / 向量 / GNN 后端、Python),**不引其运行时**;只借「**cost-quality 路由决策 + 按难度 / 类型分族 + 阈值用 benchmark 校准 + 冷启动 profiling**」的方法与数据形态,落到 new-api 旁路的纯配置 / 轻量路由表。MIT 商用友好。
- 难度 / 优先级:中(借路由决策规则 + 阈值校准方法,落 new-api 旁路;不引训练管线)。对**多 agent 成本优化**价值高。
- URL: https://github.com/ulab-uiuc/LLMRouter (参照 https://github.com/lm-sys/RouteLLM)

### Superpowers(obra/superpowers,Jesse Vincent / Prime Radiant)— 把技能做成「自动触发的强制工作流 + subagent 驱动开发 + 两段式审查」的可组合方法论(MIT,**233k★**,20.7k forks,609 commits,v6.0.3 / 2026-06-18,多 harness)
- 是什么:给编码 agent 的**完整软件开发方法论**,由一组**可组合 skill** + 一段「确保 agent 真用它们」的引导构成。最值得学的是它**把流程做成强制工作流而非建议**:① **brainstorming**(先 Socratic 逼出 spec、分块给人确认,不直接写码)→ ② using-git-worktrees(隔离分支、跑干净测试基线)→ ③ writing-plans(拆成 2–5 分钟可验证小任务、每任务给确切文件路径与验证步骤)→ ④ **subagent-driven-development**(每任务派一个全新 subagent,**两段式审查:先查 spec 合规、再查代码质量**)→ ⑤ **test-driven-development**(强制 RED-GREEN-REFACTOR,测前写的代码删掉重来)→ ⑥ requesting-code-review(按严重度报问题,critical 阻断)→ ⑦ finishing-a-development-branch(收尾 merge/PR/弃)。两条工程哲学尤其对味:**「skills 自动触发、是 mandatory workflow」** + **「skills speak in actions(dispatch a subagent / create a todo / read a file),不绑定任一 runtime 的具体工具名」**——技能因此跨 Claude Code / Codex / Cursor / Gemini / Copilot / Kimi / OpenCode 等多 harness 通用。还含 **writing-skills 元技能**(教 agent 怎么写 + 测新技能)+ drill eval 行为测试。原始发布 2025-10。
- **值得借鉴(对口编排纪律 + skills 可移植性 + 玉衡测试门 + 控制台人审门)**:
  - **「技能 = 自动触发的强制工作流」= 玉兔6 编排纪律从『靠自觉』升级为『默认强制』** ⭐⭐:玉兔6 已有 skills + 多 agent,但工作流纪律多靠各 agent 自觉 + 主管 brief。借 Superpowers:把玉兔6 的关键流程(改源 / UI → 先玉衡测试门、带视觉产物 → 必须渲染自查)做成**「见到该场景自动触发、不可跳过」的 skill**,而非提醒。
  - **subagent-driven-development 的「每任务一新 subagent + 两段式审查」= 写码员工 + 玉衡的现成范式** ⭐⭐:玉兔6 已有「源 / 运行时 / UI / 存档有改 → 先玉衡跑测试门」,Superpowers 把它细化成**「派新 subagent 做 → 先核对是否符合计划(spec)→ 再核对代码质量」的两段闸**,正补玉兔6 测试门「过 / 不过」之外缺的「**spec 合规 vs 质量**分两关」。
  - **「skills speak in actions, 不绑工具名」= 玉兔6 skill 跨 harness / 跨角色复用的写法标准** ⭐:玉兔6 skill 若用动作语言写(「派 subagent / 建 todo / 读文件」),就能在不同 agent / runtime 间复用,免为每个 agent 重写——对口洞察员 / 秘书共享同一批 skill。
  - **brainstorming「先逼 spec、分块确认」= 控制台人审门的交互范式** ⭐:先出设计、分块给老板确认再动手,正解 Simulaid「连续三轮返修」那类「没对齐就开干」的浪费(对口已沉淀的 §17 痛)。
  - 边界:Superpowers 是**给编码 agent 的方法论 + 多 harness 插件(Shell 51% / JS 41%)**,玉兔6 **不必整包装插件**;只借「**技能即强制工作流 / 动作化描述 / subagent 两段审查 / writing-skills 元技能 / brainstorm 先对齐**」的方法论,落到现有 skill 体系。MIT 商用友好。
- 难度 / 优先级:中(借方法论与工作流范式,落现有 skills + 玉衡门 + 控制台人审;不装插件)。对**编排纪律 / 质量门 / 返工**价值高。
- URL: https://github.com/obra/superpowers

### VoltAgent/awesome-claude-code-subagents — 100+ 专精子智能体集:统一「name/description/tools/model」模板 + 按角色最小工具权限 + per-role 模型档(MIT,~19k★,2.2k forks,462 commits;姊妹库 awesome-codex-subagents 130+)
- 是什么:100+ 个**专精 subagent**的 markdown 定义集,按类别组织(核心开发 / 质量安全 / 数据-AI / 开发者体验 / 专精领域 / 业务产品…)。最值得学的是它的**工程化模板**:每个 subagent 一份标准字段 **name / description / tools / model**,且——① **独立上下文窗**(每个 subagent 在自己隔离的上下文里跑,防止串扰);② **按角色裁剪工具权限(最小权限)**:只读审查者只给 `Read / Grep / Glob`、研究者加 `WebSearch / WebFetch`、写码者才给 `Write / Edit / Bash`、文档者给读写 + 检索;③ **model 字段自动把该 subagent 路由到合适的 Claude 档**(平衡质量与成本)。
- **值得借鉴(对口编排层角色花名册 + 最小权限红线 + 模型分级 + 控制台)**:
  - **「每角色一份 name/description/tools/model 模板」= 玉兔6 角色定义的结构化规范** ⭐⭐:玉兔6 已有秘书 / 总管 / 洞察员 / 写码员工 / 玉衡 / supervisor-Simulaid 一套角色,但定义散落;借这套模板把每个角色**结构化成统一字段**(职责 description + 允许工具 tools + 默认模型 model),一处可读、可审、可版本化。
  - **按角色最小工具权限 = 玉兔6 红线「洞察员只读写 board/insights」的现成落法** ⭐⭐:玉兔6 的红线本就要求洞察员 / 玉衡这类只读、不乱写;这个库的**工具权限矩阵**正好把它**机器化**——洞察员 = `Read / Grep / Glob / WebSearch / WebFetch`(只读 + 搜索)、玉衡 = 只读 + 跑测试、写码员工才有 `Write / Edit / Bash`。把红线从「文字约定」变成「每角色 tools 白名单」。
  - **per-role `model` 档 = 与本批 LLMRouter 拼成「模型分级」完整闭环** ⭐⭐:本例给「**每个角色一个默认模型档**」(洞察员 / 格式化用便宜档、架构 / 审查用强档),LLMRouter 给「**同一角色内再按任务难度动态路由**」——两者一静一动,正好是玉兔6「**模型分级 / 成本-质量**」这条线的两半,合起来就是本批最值钱的可执行主题。
  - 边界:它是 **Claude Code subagent 的 markdown 定义集**(MIT,可直接读 / 借模板),玉兔6 **不必整包导入**(很多角色与玉兔6 无关);只借「**统一模板 + 工具权限矩阵 + per-role model 档**」的设计范式,落到玉兔6 自己的 agent 定义。MIT 商用友好。
- 难度 / 优先级:低–中(借模板 + 权限矩阵 + 模型档,落现有角色定义,纯文件 / 配置)。对**角色规范化 / 最小权限红线机器化 / 成本**价值中–高。
- URL: https://github.com/VoltAgent/awesome-claude-code-subagents

---
注:本批轮换回两条最久没碰的线——LLM 网关 + AI agent 工具与 skills(上次同台第十批 06-21 ~04:0x),但**刻意避开第十批角度**,用一个**把两线拧成一股的新主题「模型分级 / 成本-质量路由」**串起三例:**LLMRouter**(按难度路由到便宜 / 强模型的可评测库)、**Superpowers**(技能即强制工作流 + subagent 两段审查的方法论)、**VoltAgent 子智能体集**(每角色 name/description/tools/model 模板 + 最小权限 + per-role 模型档)。三者**只借数据形态 / 决策规则 / 模板,不引训练管线 / 向量库 / 插件**,贴「单机零依赖 + new-api 旁路不替代」。**本批不新增待办卡**(延续七–十、十二–十五批口径;唯十一批因真漏洞破例):三例都是对**已有编排 / skills / 角色机制**的**设计升级**,非「必须立刻补的独立漏洞」;是否上分级路由属产品 / 主管决策。**但本批与往批不同的是——玉兔6 自己『模型一刀切、角色定义散落、红线靠文字』是可观察的现状**,所以**若老板要立刻动手,最小、最不抢跑、可逆的一步**:借 VoltAgent 子智能体集的模板给每个 agent 角色**先补一行 `model:` 默认档 + 一份 `tools:` 白名单**(洞察员 / 玉衡只读 + 搜索、写码员工才给写)——**纯文件 / 配置、零外部依赖、零运行时、随时可回退**,一步同时拿到「按角色省成本」+「红线机器化(最小权限)」两个收益;待稳定后再考虑 LLMRouter 的「角色内按难度动态路由」。Starlaid 全程排除。watch:LLMRouter 默认分支 `main`(MIT,~1.4k★,416 commits,v0.3;参照 lm-sys/RouteLLM ~4.5k★)、Superpowers `main`(MIT,233k★,609 commits,v6.0.3 / 2026-06-18,多 harness)、awesome-claude-code-subagents `main`(MIT,~19k★,462 commits;姊妹 awesome-codex-subagents 130+)。沿历史口径本机未做 git ls-remote HEAD-diff(代理 HTTP 403),commit 待网络可达回填。
## 2026-06-22 · 第十七批(选题:任务队列引擎 / GUI grounding — 持久任务的人审等待 / 脚本即UI / 高分屏 grounding 评测基准;运行 ~08:0x+08:00)

> 本批轮换回**最冷的两条线**:「任务队列引擎」(上次第十一批 06-21 ~08:0x 的 River / Hatchet / DBOS)+「GUI grounding」(上次第十二批 06-21 ~12:0x 的 OmniParser / RegionFocus)——其间十二–十六批都在记忆 / Unity / 像素 / 网页 / 网关上,这两条彻底冷了。但本批刻意**避开各自已收的角度**:第十一批收的是队列的**底层数据模型 / 调度 / 持久化**(事务性入队、并发-key、崩溃恢复),本批两例 **Trigger.dev / Windmill 是其上方的「面向开发者 / 人审等待 / 实时可观测 / 脚本即 UI」层**(第十一批未碰);早批 grounding 收的是**模型**(要自托管:UGround / UI-TARS / UI-Venus…)与**推理期方法**(OmniParser set-of-marks、RegionFocus 裁剪重查),本批 **ScreenSpot-Pro 是第三种东西——评测基准**:不改进 grounding,而是**量出**玉兔6 computer-use 在**高分屏专业界面**上到底准不准(正是已借 RegionFocus「裁剪重查」要解的那个痛点)。三例都按惯例「借语义 / 数据形态 / 评测方法,不引重运行时 / 重模型」,贴「单机零依赖」。**Starlaid 全程排除。**

### Trigger.dev(triggerdotdev/trigger.dev)— TypeScript 的开源持久任务 / AI 工作流平台,杀手锏是「waitpoint 人审等待」+ 并发-key / 幂等-TTL / 实时订阅(Apache-2.0,v4 GA,Docker+Postgres 自托管无功能限制)
- 是什么:面向「长时后台任务 / AI agent 工作流」的开源平台,卖点是**用普通异步代码写任务、自动获得持久性**——任务靠 **checkpointing** 把状态存下、可在中断后恢复(durable)。一批可直接学的队列语义:**waitpoints**(在流程关键点**暂停等待**人审 / 令牌 / 时间,**不占 worker**,审过再持久 resume)、**concurrency keys**(按 user / tenant / resource 建**每实体队列**,如「每用户同时只跑一个」,且可在触发时**覆盖队列分配**——给免费 / 付费档不同上限)、**idempotency keys + TTL**(带时间窗去重:窗口内同 key 的后续触发**返回原 run 而非新建**,窗口过期再触发才新建)、**realtime**(订阅 run 状态 / 把后台任务流式推到前端)、自动重试 / 队列 / 可观测。Apache-2.0,Docker + PostgreSQL 整套自托管、无功能限制无 run 限制。
- **值得借鉴(对口 `shared/engine/queue.js` + §17 人审门 + 控制室实时 + `idem` 幂等)**:
  - **waitpoint「人审等待」= 把玉兔6 的人审门做成一等队列状态** ⭐⭐:玉兔6 有控制台**人审门**(§17,且已借 Superpowers「brainstorm 先对齐」治「没对齐就开干」),但它**没被建模成队列原语**——一个任务要等人批时,现在缺「**挂起、不占 worker、批后持久续跑**」的语义。Trigger 的 waitpoint 正是这个缺的原语:给 `queue.js` 加一档 **`waiting`/`waiting-for-human` 态**(任务进等待区、释放 worker、来令牌 / 审批 / 到点再 resume),让人审门从「卡住一个 runner 干等」升级为「持久挂起 + 事件唤醒」。这是**第十一批 River/Hatchet/DBOS 没碰的角度**(它们只管入队 / 调度 / 崩溃恢复,不管「为等人而持久暂停」)。
  - **concurrency key 的「触发时覆盖 + 分档」补强已借 Hatchet 并发-key** ⭐:第十一批已借 Hatchet「按动态 key 限并发」;Trigger 多给两点——**触发时可覆盖队列分配** + **按档(免费 / 付费、或角色)给不同并发上限**。对口玉兔6 可按 **runner / 外部模型 / 角色**(洞察员低并发、写码员工高并发)分档限并发,正接第十六批「模型分级 / 按角色」那条线。
  - **idempotency key + TTL 补强 `queue.js` 的 `idem`** ⭐:`queue.js` 已有 `idem`,但只是「同任务不重复入队」;Trigger 的 **TTL 时间窗 + 返回原 run** 语义更细——对口**洞察员 / 定时任务**:上一轮 4h 周期还没跑完就被再次触发时,**窗口内直接返回上次 run**,杜绝叠跑(与第十一批 River「unique by state」互补,一个按状态、一个按时间窗)。
  - **realtime 订阅 run = 控制室「实时时间线」的现成数据形态** ⭐:Trigger 的「订阅 run / 把后台流式推前台」正对口控制室把队列任务流转**实时推到面板**(呼应第四批 Mission Control 实时面板 + 第十二批 Motion layout 过渡);借其 **run 订阅事件的数据形态**给控制室补「任务状态变更实时流」。
  - 边界:Trigger 是 **Node/TS 平台 + Docker + Postgres(+Redis)** 的重栈,与玉兔6「文件式零依赖」冲突——**只借 waitpoint / 并发-key / 幂等-TTL / run 订阅这四个语义与数据形态,不引其运行时**。Apache-2.0 商用友好(可放心读码借鉴)。
- 难度 / 优先级:中(借四个队列语义,落到文件式 `queue.js` + `taskstore.js`;不引 Node 平台)。对**人审门一等化 + 队列健壮性 + 控制室实时**价值高。
- URL: https://github.com/triggerdotdev/trigger.dev

### Windmill(windmill-labs/windmill)— Rust+Postgres 的最快自托管工作流引擎,杀手锏是「脚本→自动生成 UI」+ 公开性能基准 + suspend/approval(AGPLv3,~16k★,13x vs Airflow)
- 是什么:开源开发者平台,**把脚本变成 webhook / 工作流 / UI**,自称「最快的自托管工作流引擎(对 Airflow 快 13x)」、Retool + Temporal 的开源替代。栈 = **Rust 后端 + TypeScript/Svelte + PostgreSQL 队列**;**worker 从 Postgres 队列按调度时间拉 job、一次跑一个、原子置 `running`、完成后存结果 + 日志**(与玉兔6 `queue.js` 的「原子 claim、一次一个」几乎同构),可横向扩;另有 **native mode**(轻量 job 在进程内跑、不起完整沙箱,吞吐显著更高)。最值得学的两点:① **脚本→自动生成可分享 UI**(脚本可自动变 UI、再组合成 flow 或低代码 app,含「从数据库查询自动生成带审批的 CRUD 界面」);② **公开的性能基准方法**(对 Airflow / Prefect / Temporal 跑「40 个轻任务的 flow」与「10 个长任务的 flow」两组基准,方法与结果全公开)。许可:核心 **AGPLv3**(部分 Apache-2.0 + 企业功能专有)。
- **值得借鉴(对口控制台 / 控制室 webUI + `queue.js` 调度 + 人审门 + 队列基准)**:
  - **「脚本→自动生成 UI」= 控制台 / 控制室面板「从定义自动出 UI」的范式** ⭐⭐:玉兔6 控制台 / 控制室是**手写的原生 webUI**(每个面板手搓)。Windmill 的范式是「**写一个脚本 / 定义 → 自动生成可用 UI**」——对口玉兔6 可从 **agent 任务 / 命令的定义**自动生成控制台面板(参数表单 + 触发按钮 + 结果展示),而非每个面板手写,正补第十五批 Tabler「现成组件」之上的「**从定义自动装配**」一层。这是**前几批 UI 借鉴(Mission Control / Tabler / Motion)都没碰的角度**。
  - **公开基准方法 = 玉兔6 队列「该不该信它快 / 稳」的现成度量模板** ⭐:第十一批就点过「玉兔6 队列没有基准」;Windmill 的两组基准设计(**N 个轻任务 / M 个长任务**两种负载、对比同类)是把 `queue.js` 的吞吐 / 延迟**量化**的现成模板——可照其负载形态给玉兔6 队列建一组可复跑的基准,改调度后能看出有没有变快 / 变稳。
  - **suspend / approval step = 人审门的第二个参照** ⭐:Windmill 的 flow step 可**挂起、经 webhook / 审批再续**——与本批 Trigger waitpoint 同向互证「人审 = 可持久挂起的步骤」,给玉兔6 人审门两份独立设计参照。
  - **worker 拉 Postgres 队列 / 原子置 running / 存结果日志 = 印证 `queue.js` 设计是对的** ⭐:Windmill 这套与 `queue.js`「tmp+rename 原子 claim、一次一个、落 result」几乎同构——一个 16k★、号称最快的引擎走同样的核心模型,是玉兔6 队列选型的**外部背书**;其 **native mode(轻任务进程内跑)**也对口玉兔6「轻任务别起重壳」的优化方向。
  - 边界(**重**):Windmill 核心是 **AGPLv3 强 copyleft** + Rust/Postgres 重栈——**绝不把其代码 vendoring 进玉兔6**(AGPL 是硬边界),**只借「脚本→UI 自动装配 / 基准方法 / approval step」的设计范式**,用玉兔6 现有原生前端自实现。
- 难度 / 优先级:中(借设计范式 + 基准方法,纯自实现;AGPL 不碰代码、重栈不引)。对**控制台 UI 自动化 + 队列可度量**价值中–高。
- URL: https://github.com/windmill-labs/windmill

### ScreenSpot-Pro(likaixin2000/ScreenSpot-Pro-GUI-Grounding)— 高分屏专业界面的 GUI grounding 评测基准:1,581 指令 / 23 应用 / 5 行业 / 3 OS,最好模型仅 18.9%(~302★,2025-01,已被 OmniParser v2 / Qwen2.5-VL 采用)
- 是什么:专为**专业、高分辨率**场景做的 **GUI grounding 评测基准**——**1,581 条指令,取自 23 个专业应用、横跨 5 个行业、3 种操作系统**,全是**真实高分屏截图 + 专家标注**(指令→目标元素的 bounding box)。关键发现:**现有 grounding 模型在它上面普遍很差,最好的也只有 18.9%**(V1 时),直接量化了「高分屏 / 密集专业界面上精确定位有多难」。仓库带 **`eval_screenspot_pro.py` 评测脚本** + 数据集(另有 HF 版),发布于 2025-01,**已被 OmniParser v2、Qwen2.5-VL 等多个项目采用为标尺**。前几批 grounding 收的全是「**模型 / 方法**」(怎么定位更准),这是头一个「**评测**」(定位到底准不准)。
- **值得借鉴(对口 computer-use grounding 准确率评测 + 玉衡回归 + 控制室回放)**:
  - **一把「量出 computer-use 准不准」的现成尺子 = 补齐已借 grounding 改进的「验收」环** ⭐⭐:玉兔6 已借 OmniParser(set-of-marks)、RegionFocus(裁剪重查)、UI-TARS(动作后校验)来**改进** computer-use 定位,但**从没量过到底准多少 / 改了有没有用**。ScreenSpot-Pro 正补这一环——它专攻**高分屏专业界面**,正是玉兔6 在 **Mac 高分屏点小图标点不准**(§17 视觉门反复卡)的同一痛点。借其**评测方法**(指令→目标框→命中 / 偏移打分)给 computer-use 建一套**grounding 回归体检**:量出当前准确率、并验证已借 **RegionFocus「裁剪重查」是否真把数字提上去了**。这与第十四批为 Simulaid 借 GamingAgent「可评分回归」是同一招——**把「感觉变好了」变成「量出变好了」**。
  - **eval 脚本 + 标注数据形态 = 玉衡 / 控制室回放的现成 schema** ⭐:它的「**截图 + 指令 + 目标区域 + 打分**」数据形态,正好给玉兔6 把 computer-use 的每次抓取**落 eventlog 并打分**(对口玉衡测试门 + 控制室时间线回放),让「这步为什么点偏」可量化、可回归。
  - **已成领域标准标尺 = 玉兔6 的数字能和业界对齐**:OmniParser v2 / Qwen2.5-VL 都用它——玉兔6 若用同一基准,grounding 准确率就**可横向对比**,而非自说自话。
  - 边界:它是**基准 / 数据集 + 评测脚本**(图 + 标注 + `eval_*.py`),**仓库未在搜索中明确许可证** → **只借「评测方法 / 打分口径 / 数据形态」**,真要跑公开集只作**一次性离线体检**,不假设再分发权;纯方法、**零模型、零运行时、用现有 Claude 视觉**。
- 难度 / 优先级:低(**纯评测方法 + 数据形态**,落到 computer-use 的离线 grounding 体检 + 玉衡回归;零依赖零模型)。对**量化 computer-use 准确率 / 验证已借改进**价值中–高。
- URL: https://github.com/likaixin2000/ScreenSpot-Pro-GUI-Grounding

---
注:本批轮换回最冷的两条线——任务队列引擎(上次第十一批)+ GUI grounding(上次第十二批),且**刻意避开各自已收角度**:**Trigger.dev / Windmill** 是队列的「**面向开发者 / 人审等待 / 实时 / 脚本即 UI**」上层(第十一批的底层数据模型 / 调度 / 崩溃恢复未碰这层);**ScreenSpot-Pro** 是 grounding 的「**评测基准**」(早批只有模型与推理期方法,缺「量出准不准」)。三例**只借语义 / 数据形态 / 评测方法,不引各自重运行时 / 重模型**(Trigger 的 Node 平台、Windmill 的 Rust+AGPL、ScreenSpot 的数据集再分发一律不搬),贴「单机零依赖」。**本批不新增待办卡**(延续七–十、十二–十六批口径;唯十一批因真漏洞破例):**Trigger 的 waitpoint / 并发-key / 幂等-TTL** 都属对 `任务队列设计.md` 的**细化**(与第十一批 River/Hatchet 的 unique-by-state / snooze / 并发-key 一样**并入设计、不另起卡**;真正的崩溃恢复漏洞已在第十一批立卡 `queue-crash-recovery-orphan-reclaim`);**Windmill 的脚本→UI / approval** 属控制台产品决策;**ScreenSpot-Pro** 属探索性体检,且 computer-use / 玉衡工作归对应主管。**但若老板要立刻动手,最小、最可逆、最值博的一步**:用 **ScreenSpot-Pro 的评测方法**对玉兔6 computer-use 跑一次**离线 grounding 体检**——**纯方法、用现有 Claude 视觉、零依赖、零模型、无许可纠葛**,一次同时拿到两个收益:① 量出 Mac 高分屏抓取准确率的**基线数字**(给 §17 视觉门一个可量化标尺);② **验证已借 RegionFocus「裁剪重查」到底有没有把准确率提上去**(改进过的东西第一次有了验收尺)。次选可逆一步:给 `queue.js` 加一档 **Trigger 式 `waiting-for-human` 持久挂起态**,把人审门从「占 worker 干等」升级为「持久挂起 + 事件唤醒」。watch:Trigger.dev 默认分支 `main`(Apache-2.0,v4 GA,TypeScript)、Windmill `main`(**AGPLv3** 核心 + 部分 Apache-2.0,~16k★,Rust)、ScreenSpot-Pro `main`(~302★/36 forks,2025-01,许可未明,已被 OmniParser v2/Qwen2.5-VL 采用)。本机 git ls-remote 仍被代理拦截(HTTP 403,本批已实测三仓全 403),commit 待网络可达回填。
## 2026-06-22 · 第十八批(选题:多智能体编排 — 监督者-工人交接原语 / 跨框架 Agent 通信契约 / 多智能体可观测 trace-span-session;运行 ~12:0x+08:00)

> 本批轮换回**最冷的核心线「多智能体编排」**:上次碰这条线还是第十三批(06-21 ~16:0x,只收了「记忆 / 上下文工程」子角度),真正碰**编排框架本体**已是第八批(06-20 ~12:0x,图引擎 / 确定性工作流原语 / 持久化中断与时间旅行);其间第十四–十七批都在 Unity / 像素 / 网页 / 网关 / skills / 队列 / grounding 上,这条最中心的线整整冷了近两天。但本批刻意**避开两个已收角度**——第八批是「**单条流程怎么确定性地跑 + 可暂停可时间旅行**」(纵向、单流),第十三批是「**agent 怎么记**」(状态持久);本批换一个把编排**横过来**的全新主题——**「横向协作:多个 agent 之间怎么交接 / 用什么契约交接 / 交接完怎么看清楚」**,正贴玉兔6 自己就是 **秘书→总管→员工→玉衡 / supervisor-Simulaid 的监督者-工人(supervisor-worker)体系**这一现实。三例恰好补这条链的三段:**CAO** = 编排运行时(supervisor 用 handoff/assign/send_message 三原语驱动 worker);**A2A** = 数据契约(Agent Card 能力声明 + Task 状态机,让 agent 跨框架被发现并对话);**Langfuse** = 可观测(把整条多智能体运行落成 trace→span→session,可回放、可评分)。三者都按惯例「**只借语义 / 数据形态 / 契约,不引各自重运行时**」(tmux/MCP 平台、跨语言 SDK 全栈、Postgres+ClickHouse+Redis 一律不搬),贴「单机零依赖」。**Starlaid 全程排除。**

### CAO(awslabs/cli-agent-orchestrator,AWS Labs)— 给 AI 编码 CLI 的监督者-工人编排器:每 agent 独立 tmux 会话 + MCP 三原语(handoff/assign/send_message)+ 人可随时 attach 接管(Apache-2.0,多 provider,Web 仪表盘)
- 是什么:AWS Labs 开源的**多智能体编排框架**,面向一众 AI 编码 CLI(Claude Code / Codex / Gemini / Kiro / Kimi / Copilot / Amazon Q / OpenCode / Hermes)。核心:**每个 agent 跑在自己独立的 tmux 会话里**,用**监督者-工人(supervisor-worker)模式 over MCP** 协调——一个 supervisor 把任务派给多个专精 worker,可**并行 / 串行 / 成群(swarm)**。最值得学的是它把「派活」抽象成**三个 MCP 编排原语**:**handoff**(同步,等子任务完成再续)、**assign**(异步,fire-and-forget 派出不等)、**send_message**(agent 间**收件箱**投递消息)。另:**会话隔离**(每 agent 独立 tmux + 真 PTY,人可 `tmux attach` 到任一会话**当场接管 / 纠偏**——HITL);**Web 仪表盘**(浏览器里管 agent / 终端 / flow);**observer/hook 插件**(pip 装、`cao.plugins` 入口自动发现、subclass `CaoPlugin` + `@hook` 注册)。
- **值得借鉴(对口编排层 supervisor-worker + 控制室 + 人审门 / HITL)**:
  - **handoff/assign/send_message 三原语 = 玉兔6「秘书→总管→员工」派活语义的现成词汇表** ⭐⭐:玉兔6 本身就是 supervisor-worker(秘书派总管、总管派员工),也有 queue + board,但**派活的语义没有被显式分档**——CAO 把它讲清楚成三种:**handoff=同步派、等结果**(对口「派子任务、阻塞等返工」)、**assign=异步派、不等**(对口「丢进队列、各跑各的」)、**send_message=收件箱**(对口 agent 间不阻塞地传一条消息 / 提示)。借这三原语给玉兔6 的派活定一套**显式契约**(一个任务到底是「等」还是「丢」还是「捎句话」),比现在「都走 queue」更清楚;正接第十七批 Trigger 的 waitpoint「等」语义,补上「派」这一侧。
  - **每 agent 独立 tmux 会话 + 人可 attach 接管 = 玉兔6 隔离 runner + 人审门的外部印证与升级** ⭐⭐:玉兔6 已是「每角色独立 runner」;CAO 印证了「**独立会话 + 真 PTY + 人随时 attach 当场纠偏**」这套,且给人审门一个**新形态**——不只是「批 / 不批」,而是「**人可直接进到某个 worker 的会话里手动接管几步再放回**」,对口 §17「连续返修」那类「与其反复打回,不如人进去带一程」。
  - **Web 仪表盘管 agent/终端/flow = 控制室「浏览器里看+管多 agent」的现成信息架构** ⭐:对口已借 Mission Control(第四批)/ Tabler(第十五批)的控制室,CAO 多给「**终端 / 会话 / flow** 三类对象怎么在一个面板里管」的范式。
  - **observer/hook 插件模型 = 玉兔6 给洞察员 / 玉衡挂「旁路观察钩子」的范式** ⭐:`@hook` + 入口自动发现,对口玉兔6 想在编排关键点挂「洞察员记一笔 / 玉衡跑一门」而不改主流程。
  - 边界:CAO 依赖 **tmux + MCP + 各 CLI 运行时**,与玉兔6 自有 runtime 不同——**只借「handoff/assign/send_message 三原语 + 会话隔离可 attach + hook 旁路」的语义与交互范式,不搬 tmux/MCP 平台**。许可证按 AWS Labs 惯例应为 **Apache-2.0(商用友好,待联网确认)**。
- 难度 / 优先级:中(借三原语 + HITL attach + hook 范式,落现有 queue/board + 控制室;不引 tmux/MCP 栈)。对**派活语义显式化 + 人审门升级**价值高。
- URL: https://github.com/awslabs/cli-agent-orchestrator

### A2A(a2aproject/A2A,Google→Linux Foundation)— 跨框架 Agent 互操作开放协议:Agent Card 能力声明 + Task 有状态生命周期 + 「不暴露内部状态」的不透明 agent(~22k★,150+ 组织,SDK 覆盖 Python/JS/Java/Go/.NET)
- 是什么:让**不同框架做的 agent 能互相发现、对话、协作**的开放协议,Google 2025-04 发起、现由 **Linux Foundation** 托管,**~22k★、150+ 生产组织**、官方 SDK 五语言(Python/JS/Java/Go/.NET)。两块最值得学:① **Agent Card**——一份 agent 自己发布的 **JSON 元数据**,声明**身份 / 能力 / 技能(skills)/ 服务端点 / 鉴权要求**(别的 agent 靠读这张卡来「发现你能干什么、怎么调你」);② **Task 生命周期**——Task 是 A2A 里**有状态的基本工作单元**(唯一 ID),走一套定义好的状态机:**in-progress(进行中)/ interrupted(需外部输入才能继续)/ terminal(终态、不再处理)**。设计哲学是**「不透明 agent」**:协作时**不暴露各自内部状态 / 记忆 / 工具实现**,只交换任务与产物。与 MCP 互补:**MCP 连 agent↔工具,A2A 连 agent↔agent**。
- **值得借鉴(对口编排层角色能力声明 + board 任务状态机 + 红线「不互相越界」)**:
  - **Agent Card = 玉兔6 角色「能力声明卡」的现成数据形态(让编排按能力路由,而非写死角色)** ⭐⭐:第十六批已借 VoltAgent 的「name/description/tools/model 模板」;A2A 再进一步——把每个角色做成一张**可被读取的能力卡(skills + 端点 + 鉴权)**,supervisor 派活时可**按「谁声明了这个能力」来选**,而不是把「这活给总管」写死在代码里。对口玉兔6 想从「硬编码角色」走向「**按声明的能力动态选 worker**」。
  - **Task 三态生命周期(in-progress / interrupted / terminal)= board 任务状态机的标准词汇** ⭐⭐:玉兔6 board 卡现在主要是 todo/doing/done 这类;A2A 的 **interrupted(「需外部输入才能继续」)** 正好给「**等人审 / 等令牌**」一个**标准状态名**(对口第十七批 Trigger waitpoint、玉兔6 §17 人审门),terminal 区分「完成 / 取消 / 失败」终态。借它把 board 的状态机定得更规整、更可机读。
  - **「不透明 agent · 不暴露内部状态」= 玉兔6 红线(各 agent 不互相越界)的设计原则** ⭐:A2A 让 agent 只交换**任务 + 产物**、不暴露内部 scratch/记忆——正对口玉兔6「洞察员只读写 board/insights、不碰别人工区」的红线;借这条原则把「agent 间只通过 board 传任务与产物、不读对方内部」固化成设计约束。
  - 边界:A2A 是**协议 + 跨语言 SDK 全栈**(带 server/鉴权/传输),玉兔6 单机**不必起 A2A 服务**;**只借「Agent Card 能力声明 + Task 三态生命周期 + 不透明 agent」的数据形态与原则**,落到 board 的角色卡 + 任务状态字段。开放协议、Linux Foundation 托管,读规范借形态无许可纠葛。
- 难度 / 优先级:低–中(借数据形态 + 状态机 + 原则,纯 board/角色卡 schema;不起协议服务)。对**能力路由 + 状态机规整 + 红线机器化**价值中–高。
- URL: https://github.com/a2aproject/A2A

### Langfuse(langfuse/langfuse)— 开源 LLM/Agent 可观测平台:trace→span→session 把多智能体运行串成可回放的树 + LLM-as-a-Judge 评分(MIT,YC W23,2026-01 被 ClickHouse 收购,可自托管)
- 是什么:开源的 **LLM/Agent 工程与可观测平台**(MIT,YC W23,**2026-01 被 ClickHouse 收购**后数据底座更强)。核心:**instrument 一下就把每次 LLM 调用 + 检索 / 嵌入 / agent 动作 / 工具调用都记成 trace**,可逐步调试复杂日志;**Session** 把**多步对话 / 多智能体工作流**的一串调用**归到一个会话**下(多轮、多 agent 尤其有用)。另有 **LLM-as-a-Judge 评测、prompt 管理、datasets/experiments、自定义看板**。自托管栈:Langfuse Web + Worker + **Postgres + ClickHouse + Redis**(偏重)。
- **值得借鉴(对口控制室 eventlog/时间线 + 玉衡评测门 + 回放)**:
  - **trace→span→session 三层 = 控制室「把一整条多智能体运行串成可回放的树」的现成数据形态** ⭐⭐:玉兔6 控制室已有时间线 / eventlog(第四批 Mission Control、第十二批 Motion、第十七批 Trigger 实时流),但多是**平铺的事件**;Langfuse 的 **span 父子嵌套 + session 归组**正补「**秘书→总管→员工**这串调用是一棵**有层级的树**」——一次多智能体运行 = 一个 `session_id`,每层派活 = 一个父 span,子任务 = 子 span。借这套 schema 让控制室从「平铺日志」升级成「**可展开、可回放的调用树**」,「这步为什么慢 / 为什么错」一眼定位。**这是本批最直接、最可落地的一借**(纯数据形态,落 eventlog)。
  - **LLM-as-a-Judge = 玉衡评测门的现成范式** ⭐:对口已借 GamingAgent「可评分回归」(第十四批)、ScreenSpot-Pro「评测打分」(第十七批)——同一主题「**把『感觉对了』变成『量出对了』**」;Langfuse 把「用一个 LLM 给 agent 输出打分」做成一等能力,可借其**评分数据形态**(score 挂在 trace/span 上)给玉衡的「过 / 不过」补一个**可量化、可追溯的评分位**。
  - **Session 归组 = 多智能体运行的天然「一次任务一条 session」** ⭐:正对口玉兔6 把「一次老板下达 → 秘书编排 → 多 agent 协作完成」的全过程**归到一条 session**,而非散落在各 runner 日志里。
  - 边界(**重**):Langfuse 自托管是 **Postgres + ClickHouse + Redis** 的重栈,与玉兔6「文件式零依赖」冲突——**绝不搬其运行时**,**只借「trace/span/session 三层 schema + score 数据形态 + LLM-judge 范式」**,用玉兔6 现有 eventlog(文件)自实现。MIT 商用友好,可放心读码借形态。
- 难度 / 优先级:中(借 trace/span/session schema + 评分形态,落文件式 eventlog;不引 Postgres/ClickHouse/Redis)。对**控制室可回放 + 玉衡可量化**价值高。
- URL: https://github.com/langfuse/langfuse

---
注:本批轮换回最冷的核心线「多智能体编排」(上次碰本体是第八批 06-20,第十三批只收记忆子角度),且**刻意避开已收角度**——第八批是「单条流程确定性 + 时间旅行」(纵向单流)、第十三批是「记忆」,本批换「**横向协作:怎么交接 / 用什么契约交接 / 交接完怎么看清楚**」的新主题,正贴玉兔6 自身的 **supervisor-worker(秘书→总管→员工→玉衡)** 现实。三例补三段:**CAO**(handoff/assign/send_message 三派活原语 + 会话隔离可 attach)、**A2A**(Agent Card 能力声明 + Task 三态生命周期 + 不透明 agent)、**Langfuse**(trace/span/session 可回放树 + LLM-judge 评分)。三者**只借语义 / 数据形态 / 契约,不引各自重运行时**(tmux/MCP 平台、跨语言 SDK、Postgres+ClickHouse+Redis 一律不搬),贴「单机零依赖」。**本批不新增待办卡**(延续七–十、十二–十七批口径;唯十一批因真漏洞破例):三例都是对**已有编排 / board / 控制室机制**的**设计升级 / 数据形态参考**,非「必须立刻补的独立漏洞」;是否上能力路由 / 调用树属产品 / 主管决策,不应由洞察员堆成待办。**但若老板要立刻动手,最小、最可逆、最值博的一步**:给控制室 eventlog 套上 **Langfuse 式 `session_id` + 父子 span** 的数据形态——把「一次多智能体运行」从「平铺事件」收成「**一条 session 下的可展开调用树**」(纯文件 / schema 改动、零运行时、随时可回退),一步同时拿到「多智能体运行可回放」+「为后续接 LLM-judge 评分留位」两个收益;次选可逆一步:把 **CAO 的 handoff(等)/assign(丢)/send_message(捎话)三原语**定成玉兔6 派活的显式契约(落现有 queue/board,纯语义约定)。Starlaid 全程排除。watch:CAO 默认分支 `main`(AWS Labs,Apache-2.0 待确认,多 provider,active)、A2A `main`(Linux Foundation,~22k★,150+ 组织,SDK Python/JS/Java/Go/.NET)、Langfuse `main`(MIT,YC W23,2026-01 ClickHouse 收购)。沿历史口径本机未做 git ls-remote HEAD-diff(代理 HTTP 403),commit 待网络可达回填。
## 2026-06-22 · 第十九批(选题:Unity(Simulaid) — AI 自动 playtest 训练台 / 智能体仿真行为 / NPC 决策模型;运行 ~16:0x+08:00)

> 本批轮换回最冷的「Unity(Simulaid)」线(上次第十四批 06-21 ~20,已收「AI 编辑器自动化 / 自动玩游戏评测 / 构建-测试 CI」三角度)。本批**刻意换新角度**:不看「怎么用 AI 改 Unity 工程 / 怎么 CI」,改看「**Simulaid 作为一个仿真本体:智能体怎么被训练-评测、怎么决策、内在状态怎么可视化**」——正贴 Simulaid「多智能体仿真」本职 + 玉兔6 像素办公室「把员工脑内活动画出来」。三例:ml-agents(仿真即训练 / 自动 playtest 的工业标准台)、TotalAI(无 LLM 成本的 NPC 决策 + 计划-树模型)、rl-llm-urban-simulations(RL 冲动 + LLM 反思的混合智能体 + 把内在状态画进画面)。三者**只借架构 / 决策模型 / 可视化范式,不强搬运行时**;rl-llm 无 LICENSE,**仅借设计不抄码**。

### ml-agents(Unity-Technologies/ml-agents)— 「仿真即训练环境」的工业标准台:把 Unity 场景变成可训练 / 可自动 playtest / 可多智能体对抗的 env(Apache-2.0,19.5k★,3,561 commits,63 releases,Release 23 / 2025-08-28 仍活跃)
- 是什么:Unity 官方的机器学习智能体工具包。核心是**把任意 Unity 2D/3D/VR 场景包成一个标准「学习环境」**:C# 侧定义 Agent(传感器 observation / 动作 action / 奖励 reward),Python 侧用 PPO/SAC/MA-POCA/self-play 训练,另支持模仿学习(BC/GAIL)、**课程学习(Curriculum)**、**环境随机化**、**On-Demand Decision(按需决策,而非每帧)**、**多 Unity 实例并发训练**,并能把环境**包成 gym / PettingZoo** 给任意 RL 框架。README 把三件事列为正式用途:**① 控制 NPC 行为(含多智能体与对抗)② 自动化测试游戏构建 ③ 上线前评估不同设计决策**。
- **值得借鉴(最对口 Simulaid 的「自动 playtest + 多智能体训练台」)**:
  - **「Unity 场景 → 标准 env(observation/action/reward)」这层抽象 = Simulaid 做自动 playtest / 回归的现成骨架** ⭐:Simulaid 开动后要的不是「人工开 PlayMode 看一眼」,而是「**场景可被脚本反复跑、可量化通过与否**」。借 ml-agents 的 Agent/Academy 抽象把 Simulaid 关键场景包成 env,配 **gym/PettingZoo wrapper + 多实例并发**,即可 headless 批量跑——正补第十四批已收 GamingAgent「可评分回归」、GameCI「构建-测试 CI」之间缺的「**场景级行为评测台**」一环。
  - **Curriculum + 环境随机化 = Simulaid 难度/场景渐进与鲁棒性的现成方法论** ⭐:测试场景按难度分级、参数随机抖动,既能训练也当「**压力测试矩阵**」。
  - **On-Demand Decision + Python LLAPI 从外部驱动** ⭐:决策与引擎帧解耦、由外部(Python)逐步驱动 agent——这套「**外部编排器按步驱动引擎内 agent**」的控制反转,正对口玉兔6 编排/队列的 stepping 语义(谁来 tick、何时要决策)。
  - 边界(**重**):ml-agents 以 **RL 为中心**(PyTorch 训练),而玉兔6 员工是 **LLM 驱动**——**借的是「仿真即可评测 env」的架构 + 自动 playtest 工程,不是非得训 PPO**;落地以「把 Simulaid 场景包成可批量跑的评测 env」为先,训练算法按需再说。Apache-2.0,商用友好,可放心读码借形态。
- 难度/优先级:中(包 env + headless 跑通有工程量;RL 训练可选)。**Simulaid 真正进入 playtest 阶段时优先级高**,当前为「架构选型已定」级参考。
- URL: https://github.com/Unity-Technologies/ml-agents

### TotalAI(TotalAI/TotalAI)— Unity 的「无 LLM 成本」NPC 决策框架:Drive(动机)驱动 + Mapping 为最小计划单元 + ScriptableObject 乐高式类型系统 + 编辑器内「计划-树」实时可视化(MIT,64★,alpha,C# 100%)
- 是什么:一个完整的 Unity 智能体 AI 框架。**Agent 感知世界→存记忆→做计划→行动,目标是降低最紧迫的 Drive(动机/需求)**;计划的最小单元是 **Mapping**(Target Factors 选目标 / Utility Modifiers 算效用 / Input Conditions 前置 / Output Changes 后果),统一支持 **GOAP + Utility AI + FSM**(Deep RL via ml-agents 在路上)。亮点工程化:**整个类型系统用 ScriptableObject 做成「乐高式可插拔的数据 + 逻辑」**(加新行为常只写几个方法、不改核心);agent 功能被干净拆成 **Planner / Decider / Sensors / Memory / Movement / Animation**;World Object 有状态 / 状态转移 / 库存配方;另有 Factions / Roles / Tags / Attributes。**最值得抄的 UI:Agent View Editor —— 实时历史日志 + 计划-树(plan tree)可视化**。
- **值得借鉴(分 Simulaid 与 控制台 两头)**:
  - **Drive→Mapping 决策模型 = Simulaid NPC 的「无 LLM 成本、可检视」行为内核** ⭐:Simulaid 里大量背景 NPC 不值得每个挂 LLM;借「最紧迫 Drive → 选效用最高的 Mapping」这套**确定性、可调参、零 token** 的模型当底层行为,LLM 只留给关键角色——直接对口成本控制。
  - **ScriptableObject 乐高式类型系统 = 行为「数据化 / 不改代码即可配」的范式** ⭐:Simulaid 行为 / 场景作者化时,借这套「**数据 + 逻辑都做成可插拔资产**」避免每改一个行为就重编译;也是玉兔6 技能 / 行为配置的一个干净参考样式。
  - **Agent View Editor 的「计划-树 + 实时历史」可视化 = 玉兔6 控制台一个现成 UI 缺口补丁** ⭐⭐:控制台已有 eventlog / 时间线(第十八批刚借 Langfuse 的 trace→span→session),但**缺「单个 agent 当前计划 / 决策树长什么样」的展开视图**;TotalAI 在编辑器里就是把 agent 的 plan tree + 历史实时画出来——这套**计划-树面板**信息架构可直接借进控制台「点开某员工 → 看它当前计划分解 + 刚才为什么这么决策」。
  - 边界:alpha、64★、个人项目——**当设计参考,不作依赖库**;借决策模型 + 计划-树 UI 形态,不引其运行时。MIT,可放心读码。
- 难度/优先级:低-中(Drive/Mapping 模型与计划-树 UI 均「读懂即可借形态」级)。**计划-树面板**对控制台价值高且相对独立(不依赖 Simulaid 开动),列为**行动候选**;决策模型随 Simulaid 落。
- URL: https://github.com/TotalAI/TotalAI

### rl-llm-urban-simulations(lukehollis)— RL「冲动」+ LLM「反思」的混合智能体 + 把内在状态画进游戏画面 + 分级优先记忆(C# 92.8%,40★,42 commits,⚠️无 LICENSE → 仅借设计不抄码)
- 是什么:在游戏引擎里做 **RL+LLM 混合的多智能体城市仿真**(作者给 BART 湾区轨交 Link21 做过数字孪生)。核心机制(灵感来自 Generative Agents 与 CoALA):**RL 策略先给出一个「冲动 / impulse」动作,LLM 再对该动作做「理性反思」**——不是 LLM 每帧全权决策,而是「**廉价反应层 + 偶发 LLM 反思**」。配套:**把角色内在状态(冲动 / 计划 / 想法)直接可视化进画面**;**分级优先记忆**(high/medium/low 三级,优先级由 LLM 评定,对话时只取每级最近 N 条进上下文);**持久化联网世界状态**(Unity ↔ Python/Django 经 websocket,跨会话离线持久);角色还能用「The Feed」类社媒做 1-1 / 群 / 公开互动。
- **值得借鉴(一头连 Simulaid,一头连像素办公室 UI)**:
  - **「把 agent 内在状态画进画面」= 玉兔6 像素办公室最直接的一次体验升级** ⭐⭐:我们已借 claude-office / agents-in-the-office 做「工位 / tool→动作」可视化,但**员工头上还没有「它此刻在想什么 / 计划做什么」**;rl-llm 正是把 impulse/plan/thought 渲染在角色身上——借这个范式给像素办公室每个员工加**「当前计划 / 想法气泡」**,老板一眼看清每个员工脑内活动。**本批最贴近「立刻能做、且改的是现有可见界面」的一借**(列为行动候选)。
  - **「RL 冲动 + LLM 反思」两层分工 = Simulaid 背景智能体的成本-真实度折中** ⭐:大量 NPC 用廉价反应层走「冲动」,只在关键节点触发 LLM「反思」,既省 token 又保留可解释的理性——与 TotalAI 的 Drive 模型互补(一个偏效用、一个偏「反应 + 反思」)。
  - **分级优先记忆(LLM 评级 + 每级取最近 N)= 又一种「便宜、贴游戏循环」的记忆压缩样式** ⭐:补充第十三批已收 Letta/Graphiti/Mem0(偏重、偏服务),这是一个**轻量、每帧可跑**的变体,适合 Simulaid 里成百上千 agent。
  - **Unity ↔ Python/Django websocket 持久世界状态**:Simulaid 与玉兔6 后端桥接、跨会话持久世界的一个架构对照。
  - 边界(**重**):**仓库无 LICENSE → 默认保留所有权利,只借设计思想、严禁抄代码 / 直接引用**;40★ 个人研究项目,当灵感来源而非依赖。作者另有 three-mlagents(three.js 端口)与 bart-3d 可一并观摩。
- 难度/优先级:借「内在状态可视化」想法低、价值高(**行动候选**:像素办公室加想法 / 计划气泡);「冲动 + 反思」与分级记忆中、随 Simulaid 落。
- URL: https://github.com/lukehollis/rl-llm-urban-simulations

---
注:本批轮换回最冷核心线「Unity(Simulaid)」(上次第十四批 06-21 ~20),且**刻意避开第十四批已收角度**(AI 改 Unity 工程 / 自动玩游戏评测 / 构建-测试 CI),换「**仿真本体:训练-评测台 / 决策模型 / 内在状态可视化**」三新角度。三例补三段:**ml-agents**(把 Simulaid 场景包成可批量跑的评测 env——补 GamingAgent 评分与 GameCI 构建之间缺的「场景级行为评测台」)、**TotalAI**(无 LLM 成本的 Drive→Mapping 决策 + 编辑器「计划-树」可视化,后者可借进控制台)、**rl-llm-urban-simulations**(RL 冲动 + LLM 反思 + 把内在状态画进画面 + 分级优先记忆)。三者**只借架构 / 决策模型 / 可视化范式,不引各自重运行时**(PyTorch 训练栈、alpha 框架、Django+websocket 后端一律不搬),贴「单机零依赖」;**rl-llm 无 LICENSE → 仅借设计、不抄码**。**本批不新增待办卡**(延续第十二–十八批口径):三例多为「Simulaid 真正开动时」或设计参考,非「必须立刻补的独立漏洞」;是否落开发任务属产品 / 主管决策,不由洞察员堆成待办。**但若老板要立刻、最小、最可逆地动一步**:借 rl-llm 的「内在状态可视化」给**像素办公室每个员工加一个『当前计划 / 想法气泡』**(改现有可见界面、纯前端、随时可回退),一步同时提升办公室可读性 + 为后续接 Simulaid / 计划-树留位;次选可逆一步:把 TotalAI 的 **Agent View「计划-树」面板**形态借进控制台「点开员工看其计划分解」。Starlaid 全程排除。watch:ml-agents `develop`(Apache-2.0,Release 23 / 2025-08-28)、TotalAI `master`(MIT,alpha)、rl-llm-urban-simulations `main`(⚠️无 LICENSE,仅设计参考)。沿历史口径本机未做 git ls-remote HEAD-diff(代理 HTTP 403),commit 待网络可达回填。
## 2026-06-22 · 第二十批(选题:像素素材与画风 / 优秀网页设计 — 文本生成「带动作行」动画精灵表 / 精灵有限状态机+JSON / 控制台命令面板 cmd+k;运行 ~20:0x+08:00)

> 本批轮换回**最冷的两条线**「像素素材与画风」+「优秀网页设计」(上次同台是第十五批 06-22 ~00:0x 的 LDtk / webtyler / Tabler,已冷近 20 小时;其间十六–十九批都在网关 / skills / 队列 / grounding / 编排 / Unity 上)。本批**刻意避开各自已收角度**:像素线第九批收「角色分层静态合成 / AI 单图精灵 / 等距 autotile」(LPC / spritebrew / TileGen)、第十五批收「语义网格自动出图 / 零依赖 autotile」(LDtk / webtyler)、第十九批收「把内在状态画成气泡」(rl-llm)——**全是『静态素材怎么来』或『叠个气泡』**;本批换全新主题**「让像素办公室真的动起来:动画素材怎么批量造 + 整只精灵怎么按状态动」**(falsprite=造动画、AnimatedSprite=驱动动画)。网页线前几批收「实时控制室 / 组件库 / 动画过渡 / 仪表盘」(Mission Control 第四批、Motion 第十二批、Tabler+CDN 第十五批)——**全是『面板长什么样』**;本批换「**键盘驱动的快速指挥**」(kbar 命令面板),前几批 UI 借鉴都没碰。三例都按惯例「**只借产品形态 / 数据结构 / 交互范式,不引各自重运行时 / 外部付费 API**」,贴「单机零依赖」。**Starlaid 全程排除。**

### falsprite(lovisdotio/falsprite)— 一句话文本 →「带动作行」的游戏级动画精灵表:可配网格(2×2~6×6)+ 每行多动作(idle/walk/run/attack/cast/jump/dance/death/dodge/自定义)+ LLM 改写编排 + 自动抠图 + 实时帧预览 + 导 GIF(MIT,181★/35 forks,7 commits,纯 Vanilla JS 无构建)
- 是什么:输入一句角色描述、选网格大小、勾选动作,**一次产出一整张带透明背景的动画精灵表 + 动画预览**。流水线(全走 fal.ai 一把 key):**nano-banana-2** 出图、**OpenRouter LLM(GPT-4o-mini)** 把简单 prompt 智能改写成「角色设计 + 动作编排」、**BRIA** 自动抠背景。特性:可配网格(2×2~6×6)、**每行可选多个动作**(idle/walk/run/attack/cast/jump/dance/death/dodge/自定义)、LLM 改写、自动抠图、**可调 FPS 的实时逐帧预览**、导出(精灵表 PNG / 透明 PNG / 动画 GIF)、参考图引导。技术栈:前端 **Vanilla JS 无框架无构建**,后端 Node(本地 HTTP / Vercel serverless),GIF 用 gif.js + gifenc。MIT。
- **值得借鉴(对口 像素办公室角色动画素材 + 像素素材流水线 + LLM 角色设定改写)**:
  - **「文本 → 带动作行的精灵表」流水线 = 像素办公室「让每个员工有成套动作」的现成产线** ⭐⭐:第九批借的 LPC 是**静态分层合成**、spritebrew 是**AI 单图**,都没解决「同一角色的 idle/打字/走动/思考一整套动作怎么成批来」。falsprite 的**「每行一个动作」网格**正是这套——给每个员工角色一句话,出一张含「空闲 / 打字 / 走动 / 思考」动作行的精灵表,而非手绘每帧。这是像素线**头一次碰「动画素材」而非「静态素材」**。
  - **「LLM 把一句话改写成『角色设计 + 动作编排』」= 全办公室画风统一的现成范式** ⭐:它在出图前先用 LLM 把简单 prompt 扩成详细角色设定 + 动作编排——对口玉兔6 给每个角色(秘书 / 总管 / 写码员工 / 玉衡 / 洞察员)一句定位,LLM 统一扩写成同一画风的角色卡 + 动作集,保证全办公室视觉一致(可与第十六/十八批的「角色能力卡 / Agent Card」同源,一卡既描述能力又描述外观)。
  - **「可调 FPS 实时帧预览 + 自动抠图 + 导 GIF/透明 PNG」= 零依赖可直接借的前端产品形态** ⭐:这几件都是**纯前端**(gif.js 在浏览器跑),与玉兔6「文件式零依赖」相容——做素材时所见即所得地调帧速、抠干净背景、一键导透明 PNG / GIF 落本地素材库。
  - 边界:它的**生成后端绑 fal.ai(外部付费 API + nano-banana-2/BRIA)**,与「单机零依赖」冲突——**只借「动作行网格 + LLM 改写编排 + 实时帧预览 + 抠图导出」的产品形态与流水线思路,生成通路可换玉兔6 自有图像链路或离线一次性出素材后入库,不强绑 fal.ai**。MIT 商用友好,纯 Vanilla JS 无构建,前端代码可放心读借。
- 难度/优先级:中(借产品形态 + 流水线;真生成仍需某个外部图像 API,属探索)。对像素办公室「员工动起来」价值中-高,属锦上添花、随像素线推进。
- URL: https://github.com/lovisdotio/falsprite

### AnimatedSprite(Whitebrim/AnimatedSprite)— 把精灵动画做成「有限状态机 + JSON 配置」的极小库:addState(名,起帧,止帧,{opts}) + 状态切换 + 纯数据声明(MIT,164★/11 forks,53 commits,单文件 Lua,带 tests/luacheck/性能文档)
- 是什么:PlayDate 的精灵库,把原生 sprite 扩展出三件事——**精灵动画 / 有限状态机(FSM)/ JSON 配置**。API 极简:载 imagetable → `AnimatedSprite.new(imagetable)` → `addState('idle',1,5,{tickStep=2})` 声明「状态名 → 帧区间 + 选项」→ `playAnimation()`。单文件(`AnimatedSprite.lua`)、MIT、带 tests + luacheck + 性能文档。核心价值不在 PlayDate,而在**「用状态机 + 纯数据驱动一只精灵该播哪段动画」**这套极简模型。
- **值得借鉴(对口 像素办公室运行时驱动 + 员工状态→动画映射 + 与队列/board 状态对齐)**:
  - **FSM + JSON 配置 = 像素办公室缺的那块「运行时」:让整只精灵按真实状态动起来** ⭐⭐:第九/十五批解决了「素材怎么来」、第十九批加了「气泡画内在状态」,但**始终缺「员工此刻真实状态 → 该播哪个动画」的驱动层**。借它的「`addState(状态名→帧区间)` + 状态机切换」给每个员工建一个**动画状态机**:`idle`(空闲)/`working`(队列里有它在跑的任务)/`waiting`(等人审——对口 §17 人审门 + 第十七批 Trigger waiting 态 + 第十八批 A2A interrupted)/`error`/`done`,由**队列/board 的真实状态**驱动播放。把「画出状态」从「静态气泡」升级成「**整只精灵按状态机动**」。
  - **「JSON 声明动画」= 动画数据化、不改代码即可配** ⭐:对口第十九批 TotalAI 的 ScriptableObject 乐高范式,这是更轻的**纯 JSON 变体**,正贴玉兔6 文件式零依赖——每个角色一份 JSON 声明「状态 → 帧区间 + tickStep」,新增/调动作不动代码,与素材库(上一例 falsprite 出的精灵表)对接。
  - **状态机词汇可与编排层对齐 = 一处状态,既驱动调度又驱动画面** ⭐:员工动画状态(idle/working/waiting/error/done)正好**复用队列/board/A2A 的状态名**,做到「后台状态」与「办公室可见动画」同源——不另造一套概念,改后台状态即自动改画面。
  - 边界:它是 PlayDate 的 Lua 单文件——**只借「FSM + JSON 配置」的设计形态,不引 Lua/PlayDate 运行时**,用玉兔6 现有前端(JS/canvas)自实现。MIT、单文件、带测试与性能文档,读懂即可借形态。
- 难度/优先级:低-中(纯设计形态、零依赖自实现;落像素办公室前端一个动画状态机 + 每角色 JSON)。**本批最直接可落地的一借**:补的是「让办公室动起来」的核心运行时缺口,独立于 Simulaid、随时可回退。优先级中-高。
- URL: https://github.com/Whitebrim/AnimatedSprite

### kbar(timc1/kbar)— 给站点装「cmd+k 命令面板」的可扩展 React 库:Action={id,name,keywords,shortcut,perform} + 模糊搜索 + 键盘导航 + 嵌套动作 + 快捷键绑定 + 数万动作不卡(MIT,5.2k★/203 forks,186 commits,TS,最新 v0.1.0-beta.48/2025-07-31,Outline/NextUI/Omnivore 在用)
- 是什么:即插即用的 React 命令面板组件(macOS Spotlight / Linear 式 `cmd`+`k`),把「用户能点的任何操作」做成**可搜索、键盘驱动的命令**。核心是 **Action**:`{id, name, keywords, shortcut, perform()}`。特性:内置动画 + 键盘导航(`ctrl+n`/`ctrl+p`)+ **快捷键直达**(按 `t` 去 Twitter、按 `?` 调文档)+ **嵌套动作**(`backspace` 返回上级,做多级导航)+ 性能(数万 action 不卡)+ 历史管理(每个 action 可 undo/redo)+ 读屏无障碍 + **简单数据结构(可自建任意组件)**。Outline / NextUI / Omnivore 等在用。MIT。
- **值得借鉴(对口 控制台/控制室操作效率 + 统一 action 定义 + 键盘驱动指挥)**:
  - **cmd+k 命令面板 = 控制台一个高价值、前几批没碰的 UX 升级** ⭐⭐:控制台/控制室现在靠在面板里**点按钮**;借 kbar「cmd+k 唤起 + 模糊搜索 + 键盘导航」让老板一个快捷键就能「**跳到某 agent / 派活 / 跑玉衡某门 / 开某 repair-ticket / 看某 session**(对口第十八批 Langfuse session)」,不必翻面板。这补在 Mission Control(第四批)/ Tabler(第十五批)「面板/组件」之上的「**键盘驱动快速指挥**」一层。
  - **「Action 数据结构」= 把控制台所有可执行操作抽象成一张表** ⭐:借其 `{id,name,keywords,perform}` 形态,让**命令面板与现有按钮共用同一份 action 定义**(一处定义、多处复用);`keywords` 模糊匹配解决「记不住菜单在哪也能搜到」。
  - **嵌套动作 + 快捷键绑定 = 层级指挥 + 肌肉记忆** ⭐:嵌套动作把「选 agent → 选对它的操作」做成面板内**两级导航**(backspace 回退);快捷键绑定给高频操作(跑玉衡、刷新 status-rollup)配单键。
  - 边界:kbar 是 React 组件;玉兔6 控制台若非 React,**只借「action 数据结构 + cmd+k 唤起 + 模糊搜索 + 嵌套导航 + 快捷键绑定」的交互范式,用现有前端自实现**。注意它「可点即可命令」会让写操作更易触发——**写/危险操作仍须过玉兔6 既有人审 / 权限红线,不因面板方便而绕过**。MIT 商用友好,可放心读借。
- 难度/优先级:低-中(纯前端交互范式,落控制台一个命令面板 + 一张 action 表)。对「控制台操作效率 / 键盘驱动指挥」价值中-高。
- URL: https://github.com/timc1/kbar

---
注:本批轮换回最冷两线「像素素材与画风 + 优秀网页设计」(上次同台第十五批 06-22 ~00),且**刻意避开各自已收角度**——像素线(九/十五批=静态素材怎么来、十九批=气泡)换「**动画素材怎么批量造 + 整只精灵怎么按状态驱动**」(falsprite + AnimatedSprite);网页线(四/十二/十五批=面板长什么样)换「**键盘驱动快速指挥**」(kbar 命令面板)。三例**只借产品形态 / 数据结构 / 交互范式,不引各自重运行时 / 外部付费 API**(falsprite 的 fal.ai 后端、AnimatedSprite 的 Lua/PlayDate、kbar 的 React 一律不搬),贴「单机零依赖」。**本批不新增待办卡**(延续七–十、十二–十九批口径;唯十一批因真漏洞破例):三例都是对**像素办公室 / 控制台**的**体验升级 / 运行时设计形态**,非「必须立刻补的独立漏洞」;是否上动画状态机 / 命令面板属产品 / 主管决策,不由洞察员堆成待办。**但若老板要立刻、最小、最可逆地动一步**:借 AnimatedSprite 的「**FSM + 每角色 JSON**」给像素办公室加一个**员工动画状态机**(idle/working/waiting/error/done,由队列/board 真实状态驱动)——**纯前端 / 纯数据、零依赖、随时可回退**,一步同时拿到「办公室真的动起来」+「后台状态与画面同源」两个收益,且**复用已有队列/board/A2A 状态名**不另造概念;素材侧可先用 falsprite 的「动作行 + 实时预览」形态离线出几套精灵表入库喂给状态机。次选可逆一步:给控制台加一个 **kbar 式 cmd+k 命令面板**(action 表与现有按钮共用一份定义,写操作仍过人审红线)。Starlaid 全程排除。watch(本批 web_fetch 直读到实时元数据,优于历史 403 口径):falsprite `main`(MIT,181★/35 forks,7 commits,Vanilla JS,无 release)、AnimatedSprite `master`(MIT,164★/11 forks,53 commits,单文件 Lua)、kbar `main`(MIT,5.2k★/203 forks,186 commits,最新 v0.1.0-beta.48 / 2025-07-31,TS)。HEAD commit SHA 仍因代理 `git ls-remote` 403 未取,待网络可达回填。
## 2026-06-23 · 第二十一批(选题:LLM 网关 / AI agent 工具与 skills — agent 结构化输出契约 / 校验-重试自纠 / 把自家能力做成可调工具;运行 ~00:0x+08:00)

> 本批轮换回**最冷的两条线**「LLM 网关」+「AI agent 工具与 skills」(上次同台是第十六批 06-22 ~04:0x 的 LLMRouter / Superpowers / VoltAgent 子智能体集,已冷近 20 小时;其间十七–二十批都在队列 / grounding / 编排 / Unity / 像素 / 网页上)。但本批**刻意换一个 20 批从没碰过的全新角度**:前面这两条线已收过**路由(LLMRouter / RouteLLM / vLLM semantic-router)、网关治理(LiteLLM / Bifrost / Portkey / mcp-gateway-registry)、可观测(Helicone / Langfuse)、技能评分/安全/市场(AgentSkillsHub / SkillSpector / wshobson)、子智能体模板(VoltAgent)**——**全是「请求往哪走 / 怎么治理 / 怎么观测 / 技能怎么挑」**,却从没碰**最底层的一件事:agent 自己产出与消费的『结构化数据』到底可不可靠,以及怎么把玉兔6 自家的能力做成 agent 能稳调的工具**。玉兔6 是 **秘书→总管→员工→玉衡 的多 agent 体系**,agent 之间靠 **board 卡(cards.json)/ 任务契约 / A2A 式 payload(第十八批)** 传结构化数据——但一个 **LLM 驱动**的 agent 吐出来的 JSON,**现在大概率是「`try json.loads` + 祈祷」**:LLM 常带 markdown 包裹、思维链前言、尾逗号,严格解析一炸,脏卡就可能写进 board、让下游解析 / 控制台渲染连锁出错。本批三例正补这条「**agent 输入输出可靠契约**」的链:**BAML**=结构化输出契约层(Schema-Aligned Parsing 容错解析,不重提问)、**Instructor**=校验+带错重试自纠闸(附 Outlines 约束生成作第三策略对照)、**FastMCP**=把自家能力做成 agent 可调的工具/资源/提示(补已借 mcp-gateway-registry「治理/发现」缺的「**工具怎么造**」那半)。三者都按惯例「**只借数据形态 / 算法思路 / 设计范式,不引各自 DSL / 代码生成 / Python 运行时 / MCP 平台**」,贴「单机零依赖」。**Starlaid 全程排除。**

### BAML(BoundaryML/baml)— 把「写提示」变「写 schema」的 AI 框架,杀手锏是 Schema-Aligned Parsing:容错解析 LLM 的脏输出、不必重提问,比 OpenAI FC-strict 准且快 2–4×(Apache-2.0,~8.1k★,v0.222.0 / 2026-04-27,Python/TS/Ruby/Java/C#/Rust/Go)
- 是什么:一个「给提示工程加上工程化」的框架——在 `.baml` 文件里用一套小 DSL **定义 LLM 函数的输入/输出 schema**,再生成 **Python / TypeScript / Ruby / Java / C# / Rust / Go** 的类型安全客户端(一处定义、多语言共用、带 IDE 自动补全与编译期报错)。最值得学的是它的核心算法 **Schema-Aligned Parsing(SAP)**:别的方案靠**严格 JSON 解析**(`json.loads`),一遇到 LLM 真实输出的脏——**JSON 里夹 markdown、回答前带一段思维链、多余空白、尾逗号**——就炸;SAP 反过来**容忍这些脏、按目标 schema 对齐把数据抽出来**,**不必为了「格式对」再问模型一次**。官方基准称 **「BAML 比 OpenAI 的 FC-strict JSON 工具更准、且快 2–4×」**,且兼容一切(OpenAI / Anthropic / Gemini / Bedrock / Azure / Ollama / OpenRouter / vLLM / LMStudio…)。
- **值得借鉴(对口 agent→board/queue 结构化 payload 解析 + `shared` 的卡/契约 schema 单一事实源)**:
  - **SAP 容错解析 = 给 agent 产出的 board 卡 / 任务契约一层「不靠运气」的解析层** ⭐⭐:玉兔6 的 LLM 驱动 agent 往 `cards.json` / 队列写结构化 payload 时,**最脆的一环就是「LLM 吐的 JSON 能不能被 `json.loads` 吃下」**——带 markdown 围栏(```json …```)、CoT 前言、尾逗号都会让严格解析失败、整条丢。借 SAP 的思路给玉兔6 加一层**容错解析器**:接受脏输出、按卡/契约的目标 schema 对齐抽取,**一次解析尽量成,而不是失败就重问模型**(省一次往返 + 省 token)。这正补玉兔6 「**结构化写入没有容错解析**」的底层缺口。
  - **「一处定义 schema → 多端类型安全客户端」= board 卡 / 任务契约 schema 的单一事实源** ⭐:BAML 在 `.baml` 定义一次、各语言共用。对口玉兔6 把 **board 卡 / 任务契约 / A2A 式 payload 的 schema 定在 `shared` 一处**,**前端(控制台 JS)与各 agent 共用同一份**,根治「卡片字段各处对不齐 / 控制台少读一个字段就渲染错」。这与第十六批 VoltAgent「name/description/tools/model 角色模板」、第十八批 A2A「Task 状态机」同源——**schema 单源是这条线的底座**。
  - **「prompt engineering → schema engineering」范式** ⭐:把「调提示让它输出对」升级成「定义 schema + 容错解析」,对口玉兔6 让 agent 间通信从「自然语言各自解析」走向「**声明式 schema + 统一容错解析**」,可解释、可回归。
  - 边界:BAML 是带 **DSL + 代码生成 + Rust 内核 + VSCode 插件**的整套工具链,玉兔6 单机文件式**不必引整套、不必学 DSL**;**只借「SAP 容错解析的算法思路 + schema 单一事实源的范式」**,用现有 JS 自实现一个「容忍 markdown/CoT/尾逗号、按 schema 对齐抽取」的解析函数。Apache-2.0 商用友好,可放心读码借形态。
- 难度 / 优先级:中(借 SAP 解析思路 + schema 单源;不引 DSL / 代码生成 / Rust 内核)。对 **agent 间结构化通信健壮性**价值高。
- URL: https://github.com/BoundaryML/baml

### Instructor(567-labs/instructor)— 最流行的结构化输出库,杀手锏是「Pydantic 校验失败→把错误喂回模型→第二次大概率改对」的自纠环(MIT,~13k★,3M+ 月下载,100+ 贡献者,15+ provider / Python·TS·Go·Ruby 多语言)
- 是什么:**最流行的结构化输出库**(单 Python 仓 ~13k★、月下载 300 万+、100+ 贡献者,另有 instructor-js / -go / -rb 姊妹库)。用法极简:**定义一个 Pydantic 模型当返回结构 → Instructor 负责生成 JSON Schema、解析响应、并在校验失败时自动重试**。最值得学的是它的**自纠环**:当 LLM 产出**不合法**输出时,Instructor **把 Pydantic 的校验错误回传给模型**,模型**第二次大概率就改对了**。横跨 15+ provider(OpenAI / Anthropic / Google / Ollama / DeepSeek…)、6 种语言。常见生产栈是「**LiteLLM 管路由 + Instructor 管校验输出**」(对照玉兔6 已借 LiteLLM,第三批)。
- **值得借鉴(对口 board/queue 写入前的结构闸 + 与 BAML 互为两种策略 + 三策略决策矩阵)**:
  - **校验+带错重试 = payload 进 queue/board 前的「质量闸」** ⭐⭐:玉兔6 的 board 写入**目前没有结构闸**——任何 agent 吐的卡直接落 `cards.json`。借 Instructor 的「**校验失败→带具体错误重出**」给写入加一道闸:任一 agent 产出的卡/契约**先过 schema 校验**(必填字段全不全、`status`/`source` 是不是合法枚举、`target` 在不在册),**不过就把「缺哪个字段/枚举不合法」回给该 agent 让它重出一次**,而非把脏卡写进去让下游炸。这正补玉兔6「board 写入无结构闸」的缺口——**与第十三批 Mem0「写入期闸防膨胀/防矛盾」同向,这里是「写入期闸防结构错」**。
  - **与 BAML 互为「两种策略」:解析-修 vs 校验-重试** ⭐:BAML = 尽量**容错解析、不重问**(省一次往返,适合高频/低风险);Instructor = **校验+带错重试**(多一次调用换强一致,适合低频/高风险)。玉兔6 可**分场景选**:洞察员写分析这类高频低风险走 BAML 式容错解析;任务契约 / 危险操作卡这类低频高风险走 Instructor 式校验-重试。
  - **第三策略 Outlines(约束生成 / FSM 屏蔽非法 token)= 仅当走本地模型时的「生成即合规」** ⭐:Outlines 在**生成时**用有限状态机**屏蔽非法 token**,模型**根本产不出不合 schema 的输出**(最强保证,但需 logit 访问,只对自托管/本地模型可行)。对口玉兔6 若有本地小模型路径(对照第十六批 LLMRouter「简单请求路由到便宜本地小模型」),可在那条路径用约束生成拿「**零解析失败**」。**三策略(容错解析 / 校验重试 / 约束生成)合起来 = 玉兔6『结构化输出可靠性』的完整决策矩阵**,按「频率×风险×是否本地模型」三轴选。
  - 边界:Instructor 是 **Python 库(Pydantic)**,玉兔6 **只借「校验→带错重试」的流程 + 「分场景选策略」的决策矩阵**,不引 Python 运行时;校验用现有 JS schema 校验自实现即可。MIT 商用友好。
- 难度 / 优先级:低–中(借校验-重试流程 + 三策略矩阵,落 board/queue 写入闸,纯逻辑)。对 **board / 任务契约写入健壮性 + 防脏数据下游炸**价值高。
- URL: https://github.com/567-labs/instructor

### FastMCP(PrefectHQ/fastmcp)— 「最快、最 Pythonic」的 MCP 服务/客户端框架,一个 `@tool` 装饰器自动出 schema/校验/文档,撑起全网 70% 的 MCP 服务(Apache-2.0,25k★,2k forks,3,439 commits,v3.2.4 / 2026-04-14,96 releases,Python 100%)
- 是什么:**构建 MCP 服务/客户端的事实标准框架**(FastMCP 1.0 已于 2024 并入官方 MCP Python SDK;独立版**日下载百万次、撑起全网 70% 的 MCP 服务**)。一句话卖点:**用一个 Python 函数 + `@mcp.tool` 装饰器声明工具,schema / 校验 / 文档自动生成**;连服务只给个 URL,**传输协商 / 鉴权 / 协议生命周期全帮你管**。三大支柱:**Servers**(把函数包成 MCP 的 **tools / resources / prompts**)、**Apps**(给工具配**直接渲染进对话的交互 UI**)、**Clients**(连任意 MCP 服务)。其中 **Tools=做动作("do something")、Resources=取信息("get something")** 的二分是关键设计。**FastMCP 3.0(2026-01)** 新增 **component versioning(组件版本化)+ authorization controls(授权控制)+ OpenTelemetry 集成 + 多 provider 类型**。
- **值得借鉴(对口把玉兔6 内部能力做成 agent 可调工具 + 红线最小权限机器化 + 控制室可观测)**:
  - **把自家内部能力做成 tools/resources/prompts = 给 agent 一个统一、自动校验、可治理的「能力供给」接口** ⭐⭐:玉兔6 的内部操作(入队 / 改某张 board 卡 / 跑玉衡某门 / 读 status-rollup / 开 repair-ticket)现在多是**各 agent 各写胶水**。借 FastMCP「一个装饰器→自动出 schema/校验/文档」的范式,把这些能力**包成统一接口**:**tool**(执行:入队、改卡、跑测试)+ **resource**(只读:board/insights、status-rollup)+ **prompt**(可复用模板)。这正补已借 **mcp-gateway-registry(第十一批,治理/发现)** 缺的另一半——「**工具到底怎么造、怎么自动得到入参校验**」。
  - **Tools(做) vs Resources(读)二分 + 3.0 的 authorization controls = 玉兔6 红线「最小权限」的现成机制** ⭐⭐:玉兔6 红线本就要求**洞察员只读写 board/insights、玉衡只读+跑测试、写码员工才可写**。FastMCP 把「**执行动作的 tool**」与「**只读取的 resource**」从机制上分开,3.0 又加了**授权控制**——对口玉兔6 把每个能力**显式标成 tool/resource + 授权档**,让「洞察员只能调 `board/insights` 的 resource(读)+ `insights` 的 write tool、调不到入队/改别人卡的 tool」**机器化**(接第十六批 VoltAgent「按角色最小工具权限」、第十八批 A2A「不透明 agent」,把红线从文字变成接口边界)。
  - **3.0 的 OpenTelemetry 集成 = 控制室可观测的现成接入点** ⭐:工具调用自带 OTel trace,正对口第十八批已借 **Langfuse「trace/span/session」**——agent 每调一次内部工具自动落一个 span,控制室一处看全「谁在何时调了哪个能力、入参产出是什么」。
  - **Apps(工具自带交互 UI、渲染进对话)= 控制台「从能力定义自动出面板」的又一条路** ⭐:对口第十七批 Windmill「脚本→UI」——让控制台面板从能力定义自动装配,少手搓。
  - 边界:FastMCP 是 **Python 框架 + 自有传输/鉴权/生命周期**,玉兔6 **不必整套起 MCP server**;**只借「能力即 tools/resources/prompts 三分 + 自动 schema 校验 + tool/resource 权限二分 + OTel 可观测 + Apps」的设计范式**,用现有运行时自实现,**仅在确需把能力暴露给外部 MCP 客户端时**才引 FastMCP 本体。注意 README 力推的 **Prefect Horizon 是商业 MCP 网关**——**只借开源 FastMCP 本体、不绑商业件**。Apache-2.0 商用友好。
- 难度 / 优先级:中(借三分 + 权限二分 + OTel + Apps 范式,落玉兔6 内部能力封装;真要起 server 才引库)。对 **能力供给统一化 + 最小权限红线机器化**价值高。
- URL: https://github.com/jlowin/fastmcp(现归属 PrefectHQ/fastmcp)

---
注:本批轮换回最冷两线「LLM 网关 + AI agent 工具与 skills」(上次同台第十六批 06-22 ~04),且**刻意避开 20 批已收的全部角度**(路由 / 网关治理 / 可观测 / 技能评分安全市场 / 子智能体模板),换一个从没碰过的全新底层主题——「**agent 自己产出与消费的结构化数据到底可不可靠 + 怎么把自家能力做成 agent 可调的工具**」,正贴玉兔6「多 agent 靠 board 卡 / 任务契约传结构化数据,但 LLM 吐的 JSON 现在基本是『try json.loads + 祈祷』」这一**可观察现状**。三例补三段:**BAML**(Schema-Aligned Parsing 容错解析,不重提问 + schema 单一事实源)、**Instructor**(校验+带错重试自纠闸,附 Outlines 约束生成作第三策略,合成「容错解析 / 校验重试 / 约束生成」完整决策矩阵)、**FastMCP**(把内部能力做成 tools/resources/prompts 三分 + tool/resource 权限二分 + OTel 可观测,补 mcp-gateway-registry 缺的「工具怎么造」半)。三者**只借数据形态 / 算法思路 / 设计范式,不引各自 DSL / 代码生成 / Python 运行时 / MCP 平台**(BAML 的 DSL+Rust 内核、Instructor 的 Pydantic、FastMCP 的 server 栈与商业 Horizon 一律不搬),贴「单机零依赖」。**本批不新增待办卡**(延续七–十、十二–二十批口径;唯十一批因真漏洞破例):三例本质是对**已有 board/queue 写入、能力封装、红线机制**的**设计升级 / 数据形态参考**,是否上结构化写入闸 / 能力工具化属产品 / 主管决策,不应由洞察员堆成待办。**但本批与多数批不同的是——玉兔6『结构化写入无容错解析、无 schema 校验闸』是个可观察、低风险、立刻可补的真缺口**(脏 JSON 写进 board 会让下游解析 / 控制台渲染连锁炸),**所以若老板要立刻、最小、最可逆地动一步**:给 **board/queue 的写入** 加一道**「结构化写入闸」**——先用 **BAML 式容错解析**(容忍 markdown/CoT/尾逗号、按卡/契约 schema 对齐抽取),再过 **Instructor 式 schema 校验**(必填字段 + `status`/`source` 枚举 + `target` 在册),**不过就带具体错误让该 agent 重出一次**——**纯 JS / 纯逻辑、零外部依赖、随时可回退**,一步同时拿到「**agent 间结构化通信不再靠运气**」+「**脏卡进不了 board、根治下游连锁炸**」两个收益,且**复用 `shared` 的卡/契约 schema 单源**(BAML 范式)不另造概念。次选可逆一步:按 FastMCP 的「tool(做)/resource(读)二分 + 授权档」把玉兔6 内部能力**先在文档层显式归类**(哪些是读、哪些是写、各角色可调哪些),为日后红线机器化与能力工具化留位。Starlaid 全程排除。watch(本批 web_fetch 直读到实时元数据,优于历史 403 口径):BAML `canary`(待 git ls-remote 可达确认;Apache-2.0,~8.1k★,v0.222.0 / 2026-04-27,Python/TS/Ruby/Java/C#/Rust/Go,repo id 701494311)、Instructor `main`(MIT,~13k★,3M+ 月下载,100+ 贡献者,Python 主仓 + js/go/rb 姊妹库)、FastMCP `main`(Apache-2.0,25k★ / 2k forks / 3,439 commits / 96 releases,v3.2.4 / 2026-04-14,Python 100%,现归属 PrefectHQ/fastmcp,日下载百万、撑 70% MCP 服务)。HEAD commit SHA 仍因代理 `git ls-remote` 403 未取,待网络可达回填。
## 2026-06-23 · 第二十二批(选题:任务队列引擎 / GUI grounding — SQS 式可见性超时+毒丸死信 / macOS 无障碍树结构化 grounding / a11y 驱动的整只 Mac agent;运行 ~04:0x+08:00)

> 本批轮换回**最冷的两条线**「任务队列引擎」+「GUI grounding」(上次同台第十七批 06-22 ~08:0x 的 Trigger.dev / Windmill / ScreenSpot-Pro,已冷近 20 小时;其间十八–二十一批都在编排 / Unity / 像素 / 网页 / 网关 / 工具skills 上)。本批**刻意各换一条从没碰过的全新角度**:**队列线**——前两批收的是**入队/调度/崩溃恢复**(第十一批 River/Hatchet/DBOS)与**人审等待/脚本UI/基准**(第十七批 Trigger/Windmill/ScreenSpot),**从没碰过队列的另一根支柱:任务『失败了怎么办』**——可见性超时(crash→自动重投)、**取走次数超限→死信/毒丸隔离**、心跳续租,且第一次收一个「把整套队列塞进单一存储文件、零基建」的极简范式;**grounding 线**——前四批收的全是**视觉**(自托管视觉模型 / set-of-marks 靠视觉模型 / 测试时缩放 / 评测基准),**从没碰过一条完全不同的真理来源:操作系统自带的『无障碍树(accessibility tree)』**——不靠像素猜坐标,直接从 OS 拿到每个元素的 role/name/精确 bbox/能否交互。这条正贴玉兔6 **跑在 Mac、用 Claude computer-use、不自养模型**的现实,且直击 §17 视觉门反复卡的「Mac 高分屏点小图标点不准」。三例:**goqite**(SQLite 单表 SQS 式队列:可见性超时 + max-receive→死信 + 续租)、**macapptree**(macOS 无障碍树 → JSON + 带框分割图,零模型结构化 grounding)、**macOS-use**(a11y 驱动、不需视觉模型的整只 Mac agent)。三例都按惯例「**只借数据形态 / 算法语义 / 设计范式,不引各自 Go/Python 运行时 / 重栈 / 重模型**」,贴「单机零依赖」。**Starlaid 全程排除。**

### goqite(maragudk/goqite)— SQLite 单表 + SQS 语义的极简持久队列:可见性超时(崩溃自动重投)+ max-receive 次数超限→死信(毒丸隔离)+ 心跳续租 + 零非测试依赖(MIT,528★/19 forks,Go,80 commits,8 releases,v0.4.0 / 2026-02-09 加 Postgres+优先级,M3 上 ~1.2–1.8 万 msg/s)
- 是什么:一个「比 AWS SQS 简单得多」的持久消息队列 Go 库,亦支持 Postgres。**所有消息存在单张表**(`id/created/updated/queue/body/timeout/received`),一张表里可放**多个命名队列**。核心语义全是 SQS 那套久经验证的设计:**① 可见性超时(visibility timeout)**——`Receive` 取走一条后,它在 `timeout` 前对其他消费者不可见;**处理完必须显式 `Delete`,否则超时后自动重新可见、被重投**(= 进程崩在处理中途,任务不会卡死,会自动回到队列);**② `Extend` 续租**——长任务可反复延长 timeout(= 心跳保活,告诉队列「我还在干、别重投」);**③ `received` 计数 + 可配 max-receive**——同一条被取走的次数累加,**超过上限即视为毒丸(poison)、从正常流转里摘出**(死信/DLQ 思路),避免一条总失败 / 总把 worker 打崩的任务被无限重投;**④ 还支持发送延迟 + 优先级(v0.4.0)**、**零非测试依赖**(自带 SQL 驱动即可)、自带 job runner 抽象与 HTTP handler。schema 极简到可一眼看完,benchmark 诚实标注「SQLite 同时只允许一个写者」。
- **值得借鉴(对口 `shared/engine/queue.js` + `taskstore.js` 的失败/崩溃语义;补第十一批崩溃恢复卡的『第二种设计』+ 全新『死信/毒丸』缺口)**:
  - **可见性超时 = 引擎崩溃后孤儿任务自愈的『SQS 式第二设计』,直接喂给第十一批已立的崩溃恢复卡** ⭐⭐:第十一批已照出真漏洞——`claim()` 把任务原子 mv 到 `running/`、**无 lease/心跳、重启不扫 `running/` 重认领 → 崩在 finish 前任务永卡 `running/`**(已立卡 `queue-crash-recovery-orphan-reclaim`)。goqite 给这张卡一个**更简单、被 SQS 验证过的实现范式**:不必「显式扫孤儿 + requeue」,改成「**取走即设可见性超时、干完才 Delete;没 Delete(崩了)超时一到自动重投**」——把孤儿恢复从「需要一段启动扫描逻辑」收成「**超时即自愈**」的被动机制。与第十一批 DBOS「启动扫未完成 workflow 续跑」互为两种选型(主动扫 vs 被动超时),给同一张卡两份独立设计参照。
  - **max-receive → 死信/毒丸隔离 = 玉兔6 队列从没有过的一根支柱** ⭐⭐:玉兔6 队列目前**没有『毒丸』概念**——一条总是失败(或总把 runner 打崩)的任务,一旦配上「崩溃自动重投」,**会无限重投、反复打崩、刷爆 eventlog**。goqite 的 `received` 计数 + max-receive 上限正补这条:**同一任务被取走超过 N 次仍未成功,就摘进死信区**(`dead/` 目录或 `taskstore` 的 `dead` 态)、停止重投、挂起等人看。这是队列「失败处置」里与「崩溃恢复」并列的另一半,**前两批(十一、十七)都没碰**,且是**纯文件、纯逻辑、可立刻补**的真缺口。
  - **`received` 计数 + `Extend` 续租 = 给 `taskstore` 补两个字段就拿到的健壮性** ⭐:`taskstore` 的 entry 借 goqite 加 **`received`(取走次数)** 与 **`lease/timeout`(可续)** 两个字段,即同时获得「重投上限(防毒丸)」+「心跳续租(防长任务被误判孤儿)」——正好解决第十一批指出的「无 lease/心跳」。
  - **单表多队列 + 极简 schema + 零依赖 = 玉兔6『文件式队列』选型的又一次外部背书** ⭐:goqite 把整套 SQS 语义塞进一张普通表、无任何重依赖,与玉兔6「`queue.js` tmp+rename 原子写、文件式、零依赖」同构——继第十一批 DBOS「库而非服务器」之后,再次印证「**可靠队列不必上重基建**」;其 schema 字段命名(`queue/body/timeout/received`)可直接对照检查玉兔6 entry 缺哪几个字段。
  - 边界:goqite 是 **Go 库 + SQLite/Postgres**,玉兔6 **不引 Go、不引 SQLite**;**只借「可见性超时 / max-receive 死信 / 续租 / 单表多队列」这套 SQS 数据形态与失败处置语义**,落到现有文件式 `queue.js`/`taskstore.js` 自实现。SQLite「同时一个写者」的限制玉兔6 本就单机单写,天然契合。MIT 商用友好,代码极小、可放心读借。
- 难度/优先级:低(借语义 + 给 taskstore 加 `received`/`lease` 字段 + 死信区,纯文件零依赖)。对**队列失败处置(毒丸隔离)+ 崩溃恢复(已立卡的第二设计)**价值高。
- URL: https://github.com/maragudk/goqite

### macapptree(MacPaw/macapptree)— macOS 无障碍树「截图→结构化元素清单」解析器:get_tree 出 JSON(role/name/精确 bbox/value/enabled)+ get_tree_screenshot 出带色框分割图,可一把抓全部可见 App + Dock + 菜单栏(MIT,62★/4 forks,Python100%,79 commits,MacPaw Research 出品,arXiv 2510.16051 GUIrilla)
- 是什么:MacPaw(CleanMyMac 母公司)研究院开源的 **macOS 无障碍(Accessibility)树解析器**。两个主函数:**`get_tree(bundle)`** 把某个 Mac App 当前屏幕的**无障碍层级**导成 **JSON**;**`get_tree_screenshot(bundle)`** 同时返回 **JSON 树 + 裁剪截图 + 『带框分割图』**(每个 UI 元素一个 bounding box、按元素类型上色)。树节点字段极完整:**`role`(AXWindow/AXScrollArea/AXButton…)、`name`、`role_description`、`value`、`enabled`、`position/size/absolute_position`、`bbox`、`visible_bbox`、`children`**。CLI 还能**一次抓取所有正在运行的可见 App + Dock + 顶部菜单栏**。即:**不跑任何视觉模型,直接从操作系统拿到『屏幕上每个可点元素是什么、叫什么、精确在哪、能不能交互』**。
- **值得借鉴(对口 computer-use『动作前 grounding』+ §17 视觉门高分屏点不准 + 控制室可回放)**:
  - **a11y 树 = computer-use『点错位置』的零模型正解,且比第十二批 set-of-marks 更省** ⭐⭐:玉兔6 现靠 Claude computer-use **对原始像素猜坐标**,Mac 高分屏 / 密集界面点小图标反复点偏(§17 视觉门长期卡)。第十二批已借 OmniParser「set-of-marks(先把屏幕标成带框元素清单再选)」——但那要**跑视觉模型**才能得到框。macapptree 揭示一条**更直接的路**:**macOS 自己就提供了带 role/name/精确 bbox 的元素清单**,根本不用视觉模型去「看」出框。借它的范式给 computer-use 加**动作前 grounding**:点之前先取无障碍树 → 让模型在「**结构化元素清单**」上按 name/role 选目标 → **点该元素 bbox 的中心**,而非裸图上猜坐标。这是**零模型、用 OS 真值**的提准,直击玉兔6 最痛的高分屏定位,且与已借 UI-TARS「动作后校验」合成「**先按 a11y 选准 → 点 → 校验**」闭环。
  - **`enabled`/`visible_bbox` = 现成的『可点性 + 可见性』护栏** ⭐:第十二批借 OmniParser「可点性预测」要模型猜;macapptree 的 **`enabled`(能否交互)+ `visible_bbox`(实际可见区域,被遮挡会不同于 bbox)** 是 OS **直接给的真值**——过滤掉禁用 / 被遮挡 / 离屏元素,免去无效点击,比模型预测更可靠。
  - **a11y 树 JSON = 控制室「可解释抓取 + 可回放」的现成 schema** ⭐:把每次 computer-use 的「当时这屏的无障碍树 + 选了哪个元素(id/role/name/bbox)+ 动作」三元组落 eventlog(对口第十八批 Langfuse trace/span、第十二批 RegionFocus image-as-map),控制室即可回放「为什么点这」;因有 role/name 比纯坐标信息量大得多、便于监管复盘失败抓取。
  - **「带色框分割图」= 控制室 / Simulaid 调试视图的现成可视化** ⭐:`get_tree_screenshot` 直接产出「截图叠彩色元素框」的分割图——可直接进控制室做「这屏 agent 看到了哪些元素」的调试面板。
  - 边界:macapptree 是 **Python + macOS 私有 Accessibility API + PyObjC**,玉兔6 **不必引这个库**;**借的是『从 macOS 无障碍树取 role/name/bbox/enabled 元素清单、再让模型在清单上选元素』这套方法与 JSON 数据形态**,玉兔6 可用自己的 a11y 取数通路实现。**注意:Canvas / 自绘界面(游戏、部分 Electron / Web Canvas)无障碍信息可能缺失 → a11y 取不到时回退到现有视觉路径**(a11y 为主、视觉兜底,二者互补而非互斥)。MIT 商用友好,Python 代码可放心读借;依赖系统「辅助功能」授权(主人一次性授权,符合不绕权限红线)。
- 难度/优先级:中(借 a11y 取数 + 元素清单 grounding 范式,落 computer-use 动作前定位;需系统辅助功能授权 + 写一条 a11y 取数通路)。对 **computer-use 高分屏抓取准确率 / §17 视觉门**价值高。
- URL: https://github.com/MacPaw/macapptree

### macOS-use(browser-use/macOS-use)— a11y 驱动、「不需视觉模型」的整只 Mac agent:读无障碍树理解 UI → LLM 决策 → 点击/输入/滚动/窗口管理,自带毫不含糊的安全警告(MIT,2k★/192 forks,Python,204 commits,`pip install mlx-use`,browser-use 团队,愿景本地 mlx 推理零成本)
- 是什么:browser-use 团队出品的 **macOS GUI agent**——「告诉 MacBook 做什么,它跨任意 App 做完」。它**通过 macOS 无障碍(Accessibility)信息理解界面、不强依赖视觉模型**,LLM 在 a11y 元素上决定点谁 / 输入什么 / 切哪个窗口;支持 OpenAI / Anthropic / Gemini,**愿景是用 Apple 的 mlx + mlx-vlm 跑本地小模型、零成本私有推理**。README 有一段**毫不含糊的安全警告**:它会用你的登录态 / 私密凭据 / 已存密码、会和**每一个 App 与 UI 组件**交互、**不会在验证码 / 机器人识别前停下**,「**尚不建议无人值守运行**」。roadmap 明确列出「**改进自我纠错**」「**加一个『向用户要输入』的动作**」。
- **值得借鉴(对口 computer-use 整体架构选型 + §17 人审门 / 红线 + 自我纠错)**:
  - **「以 a11y 为主、视觉为辅」的整只 agent = 玉兔6 computer-use 架构选型的现成活样本** ⭐⭐:macapptree 给的是「**怎么取**结构化元素」,macOS-use 给的是「**整只 agent 怎么基于 a11y 跑起来**」——读无障碍树→LLM 选元素→执行→下一步。一个 2k★ 的 Mac agent**主路径就是 a11y 而非纯视觉**,正印证上一例 macapptree 的方向,也给玉兔6「computer-use 是否该从『纯像素』转向『a11y 为主 + 视觉兜底』」一个可对照的真实实现(动作词汇:点击/输入/滚动/窗口管理/启动/切换)。
  - **README 的安全警告 = 玉兔6 §17 人审门 / 红线『为什么必须有』的反面教材** ⭐⭐:macOS-use 坦白「会用凭据、不停验证码、勿无人值守」——这正是玉兔6 **§17 人审门 + 权限红线**要拦的风险面。借它把**危险动作清单**(登录 / 用凭据 / 触发不可逆操作 / 过验证码)显式列出,对照检查玉兔6 computer-use 的人审门是否覆盖这些;其 roadmap 的「**加『向用户要输入』动作**」正对口玉兔6「agent 拿不准就回主人」的一等动作(接第十七批 Trigger waitpoint「持久挂起等人」)。
  - **roadmap「改进自我纠错」= 对口已借 UI-TARS 动作后校验** ⭐:与第十二/十七批的 grounding 改进同向——agent 执行后自检、错了重试;可作玉兔6 computer-use 自愈回路的又一参照。
  - 边界:macOS-use 是 **Python + mlx + 各家 LLM API** 的整只 agent,**玉兔6 不引其运行时**;**借的是架构选型(a11y 为主)+ 危险动作的红线清单 + 自我纠错 / 向用户要输入的动作设计**。**强调:它本身「不停验证码 / 可无人值守用凭据」恰是玉兔6 红线明令禁止的——只借其经验教训,绝不放宽人审门**。MIT 商用友好。
- 难度/优先级:中(借架构选型 + 红线清单 + 动作设计,属 computer-use 主管的选型参考,非独立落地任务)。对 **computer-use 架构方向 + 人审门完备性**价值中–高。
- URL: https://github.com/browser-use/macOS-use

---
注:本批轮换回最冷两线「任务队列引擎 + GUI grounding」(上次同台第十七批 06-22 ~08),且**刻意避开两线全部已收角度**——队列线(十一批=入队/调度/崩溃恢复、十七批=人审等待/脚本UI/基准)换「**失败处置:可见性超时 + 毒丸死信 + 嵌入式单表**」(goqite);grounding 线(早批=自托管视觉模型、十二批=set-of-marks/测试时缩放、十七批=评测基准)换一条全新真理来源「**操作系统无障碍树(a11y)结构化 grounding**」(macapptree=怎么取、macOS-use=整只 agent 怎么用)。三例**只借数据形态 / 算法语义 / 设计范式,不引各自 Go/Python 运行时 / 重栈 / 重模型**(goqite 的 Go+SQLite、macapptree 的 PyObjC、macOS-use 的 mlx 一律不搬),贴「单机零依赖」。**本批不新增待办卡**(延续七–十、十二–二十一批口径;唯十一批因真漏洞破例):goqite 的「可见性超时」是第十一批已立崩溃恢复卡 `queue-crash-recovery-orphan-reclaim` 的**第二种设计参照**(并入该卡 / `任务队列设计.md`,不另起卡);「max-receive 死信/毒丸」虽是真缺口但属对 `任务队列设计.md` 的**细化**(同 River unique-by-state / Trigger 幂等-TTL 一样并入设计);grounding 两例属 computer-use 主管的**架构选型 / 设计参考**,是否从「纯像素」转「a11y 为主」属产品决策,不由洞察员堆成待办。**但若老板要立刻、最小、最可逆、最值博地动一步**:把 **macapptree 揭示的「a11y 元素清单」做进 computer-use 的『动作前 grounding』**——点击前先取 macOS 无障碍树拿到 `role/name/精确 bbox/enabled` 元素清单,让模型**在结构化清单上选元素、点其 bbox 中心**,而非高分屏裸图上猜坐标;**零模型、用 OS 真值、a11y 取不到时回退现有视觉路径**(纯增量、随时可回退),一步同时拿到「**直击 §17 视觉门高分屏点不准**」+「**每步抓取落 a11y 树 JSON、控制室可解释回放**」两个收益,且天然接上已借 UI-TARS「动作后校验」成「**先按 a11y 选准 → 点 → 校验**」闭环。次选可逆一步:给 `taskstore` 加 **goqite 式 `received` 计数 + max-receive→死信区**,补玉兔6 队列从没有过的「毒丸隔离」(防失败任务配上崩溃自动重投后无限重投打崩 runner)。Starlaid 全程排除。watch(本批 web_fetch 直读到实时元数据,优于历史 403 口径):goqite `main`(MIT,528★/19 forks,Go,80 commits,8 releases,v0.4.0 / 2026-02-09 加 Postgres+优先级,benchmark 1.2–1.8 万 msg/s)、macapptree `main`(MIT,62★/4 forks,Python,79 commits,无 release,MacPaw Research,arXiv 2510.16051 GUIrilla)、macOS-use `main`(MIT,2k★/192 forks,Python,204 commits,`pip install mlx-use`,browser-use 团队)。另**挂三个下批候选 watch**:**Honker**(russellromney/honker,Rust SQLite 扩展,把 NOTIFY/LISTEN + 持久队列/流/pub-sub/cron 塞进单一 SQLite 文件、零服务器、跨进程唤醒 ~0.7ms,alpha 2026,多语言绑定)——队列线「**无轮询唤醒 + 每消费者偏移的持久流**」全新角度,下次可正式分析;**microsoft/UFO²**(MIT,Windows AgentOS,UIA 无障碍 + 视觉混合 HostAgent/AppAgent)——grounding 线「**a11y+视觉混合**」角度;**xlang-ai/OpenCUA**(NeurIPS 2025,AgentNet 轨迹数据含截图+事件+无障碍树)——「**a11y 轨迹数据**」角度。HEAD commit SHA 仍因代理 `git ls-remote` 403 未取,待网络可达回填。
## 2026-06-23 · 第二十三批(选题:多智能体编排 / 优秀网页设计 — 编排的「安全治理外壳」(并行护栏 / 中间件切面 / 声明式角色)/ 拥有源码的组件 registry + 注意力引导动画;运行 ~08:1x+08:00)

> 本批一线轮换回**核心线「多智能体编排」**,但**刻意换第四个、前三次都没碰的角度——「编排的安全/治理外壳」**:前三次编排批分别是第八批(06-20,**纵向单流**:图引擎 / 确定性工作流 / 持久中断与时间旅行)、第十三批(06-21,**怎么记**:记忆 / 上下文)、第十八批(06-22 ~12,**横向交接**:CAO handoff/assign/send_message、A2A 契约、Langfuse 可观测)——**三次都在讲「agent 怎么跑 / 怎么交接 / 怎么记」,从没碰过「agent 跑起来时,怎么在它干坏事之前自动拦住、怎么把每一步统一过一道日志-脱敏-策略的切面、怎么不写死而是声明式配角色」**。这正是 2026 两大厂旗舰 agent SDK(OpenAI Agents SDK、Microsoft Agent Framework)最成熟的一层,也最贴玉兔6 §17 人审门 / 权限红线的现实。二线换**「优秀网页设计」**:上次第二十批(06-22 ~20)收的是 kbar(cmd+k 命令面板),更早是 react-bits(微交互)/ motion(动画原语)/ tabler·mission-control(仪表盘骨架)——本批换一个全新角度「**拥有源码的组件 registry(shadcn 式 copy-paste、零运行时依赖)+ 一组『把注意力引导到关键状态』的动画组件**」(MagicUI)。三例**只借语义 / 数据形态 / 设计范式,不引各自重运行时**(OpenAI 的 Python 生态、MAF 的 .NET+Azure/Foundry 双栈、MagicUI 的 React/Next/Tailwind 栈一律不搬),贴「单机零依赖」。**Starlaid 全程排除。**

### OpenAI Agents SDK(openai/openai-agents-python)— 轻量却完整的多智能体框架,本批最值钱的是**Guardrails:与 agent 主体并行跑的输入/输出护栏,命中 tripwire 立即中止整个 run**(MIT,26.3k★/4k forks,Python 99.7%,1,562 commits,99 releases,v0.17.2 / 2026-05-12,provider 无关:Responses+Chat Completions+100+ LLM)
- 是什么:OpenAI 官方的多智能体工作流框架,**provider 无关**(走 Responses / Chat Completions,也经 any-llm·LiteLLM 接 100+ 模型)。九个核心概念里,对玉兔6 最有借鉴价值的是这几条:**① Guardrails(护栏)**——可配的安全校验,**与 agent 运行并行**地跑「输入校验」(用户/上游指令进来时)与「输出校验」(产物产出后),**任一触发 tripwire 即急停**;**② Sessions**——跨多次 run **自动管理对话历史**,无需手写状态拼接(带可选 Redis 后端);**③ Agents-as-tools / Handoffs**——委派给别的 agent(接第十八批 CAO 的派活语义);**④ Human-in-the-loop**——跨 run 的人介入机制;**⑤ Sandbox Agents(0.14.0 新)**——给 agent 绑一个可控文件系统/容器,**跨多步保持工作区状态**(查文件 / 跑命令 / 打补丁 / 扛长任务),用 `Manifest` 声明初始装哪些 repo/文件;**⑥ Tracing**——内建,逐步记录 LLM 生成 / 工具调用 / handoff / guardrail,可视化调试。仓库还自带 `.agents/skills` + `AGENTS.md` + `CLAUDE.md` 的约定。
- **值得借鉴(对口 §17 人审门 / 权限红线 + taskstore 会话历史 + 员工 runner 工区)**:
  - **Guardrails「输入+输出并行护栏 + tripwire 即停」= 玉兔6 红线从『靠人审挂起』升级成『可自动执行的前置/后置闸』** ⭐⭐:玉兔6 现在的人审门主要是「危险动作 → 挂起等人」(第十七批 Trigger waitpoint「持久等待」、第十八批 A2A `interrupted` 态)——**人是唯一的闸**。OpenAI guardrails 补另一半:把**绝不可做的**写成**输入护栏**自动拦(如:用凭据登录 / 过验证码 / 删非工区文件 / 碰 Starlaid),把**产物里绝不可有的**写成**输出护栏**自动挡(如:回显密钥 / 越权写别人工区 / 输出违反红线的内容),**只有灰区才升级到人审门**。关键是**「并行 + tripwire 即停」**:护栏不串在主链路上拖慢,而是旁路跑、命中即急停整个 run——正好把玉兔6「红线」从一纸约定变成**跑时强制执行的自动闸**,且与人审门分工(硬红线自动拦、灰区才打扰人)。**这是本批最直接、最贴红线的一借。**
  - **Sessions(跨 run 自动历史)= 「一次老板下达 = 一条 session 历史」落 taskstore 的执行向形态** ⭐:第十八批 Langfuse 的 session 是**观测向**(回放用)、第十三批是**记忆**;OpenAI Sessions 是**执行向**——把「秘书→总管→员工」这一串多次 run 的历史**自动接成一条**,玉兔6 可借其形态在 taskstore/eventlog 里以 `session_id` 串起一次任务全过程,免得每个 runner 各记一摊、拼不回来。
  - **Sandbox Agents + `Manifest`(长任务容器 + 工区状态跨步保持)= 玉兔6『每员工独立 runner + 自带工区』的现成印证与升级** ⭐:玉兔6 本就「每员工独立 runner、各有工区」;Sandbox Agents 印证这套并多给一个**声明式 `Manifest`**(开跑前声明装哪些 repo/文件、工区初始态),可借来把员工 runner 的「初始工区配置」也声明化、可复现。
  - **provider 无关 + 内建 tracing**:对口已借 LiteLLM(网关,第×批)、Langfuse(观测,第十八批),再次印证「编排层不绑单一模型厂 + 每步可 trace」是主流共识。
  - 边界:它是 **Python 运行时 + 偏 OpenAI 生态**,玉兔6 **不引其运行时**;**只借「guardrails 并行护栏 + tripwire 即停」的语义、「session 即一次任务历史」的数据形态、「Manifest 声明工区」的形态**,落到现有人审门/红线 + taskstore + runner。MIT 商用友好,Python 代码可放心读借。
- 难度/优先级:中(借 guardrails 护栏语义落红线自动闸 + session 形态落 taskstore;纯逻辑/schema,不引 Python 栈)。对 **§17 人审门/权限红线的『可自动执行化』**价值高。
- URL: https://github.com/openai/openai-agents-python

### Microsoft Agent Framework(microsoft/agent-framework)— AutoGen + Semantic Kernel **收敛成一套**的生产级 agent SDK,本批最值钱的是**Middleware(统一请求/响应/异常拦截管道)+ Declarative Agents(YAML 声明式角色)+ DevUI(调试态)**(MIT,10.4k★/1.7k forks,Python 49.7%/C# 46.8%,2,076 commits,82 releases,dotnet-1.5.0 / 2026-05-08,A2A·AG-UI·MCP)
- 是什么:微软把两套各自演化、概念重叠的框架——**AutoGen**(对话式多 agent)与 **Semantic Kernel**(企业级编排)——**合并成一套统一 API 的生产级 SDK**(Python + .NET 双栈、一致 API)。对玉兔6 最有借鉴价值的几块:**① Middleware**——灵活的中间件系统,对**请求/响应处理、异常处理、自定义管道**做统一拦截;**② Orchestration Patterns & Workflows**——图式多 agent 工作流(sequential / concurrent / handoff / group),含 **checkpointing / streaming / human-in-the-loop / time-travel**(接第八批);**③ Declarative Agents**——**用 YAML 声明式定义 agent**,便于快速搭建与版本化;**④ Observability**——内建 OpenTelemetry 分布式追踪(接第十八批 Langfuse);**⑤ Agent Skills**——从文件/内联代码/类库构建领域知识库供 agent 发现调用(接第二十一批);**⑥ DevUI**——交互式开发者 UI,用于 agent 开发、测试、调试 workflow;**⑦ AF Labs**——基准 / 强化学习等实验包。支持 **A2A / AG-UI / MCP** 三套互操作标准。
- **值得借鉴(对口编排层「统一切面」+ 角色声明式定义 + 控制室调试态 + 架构治理)**:
  - **Middleware(请求/响应/异常统一拦截管道)= 玉兔6 编排层缺的『每步统一切面』,把散落的红线/脱敏/记账收成一条管道** ⭐⭐:玉兔6 现在「记 eventlog / 红线检查 / 密钥脱敏 / 异常兜底」多半**散在各 runner 各处自己写**。MAF 的 middleware 给一个**统一管道**:每次 agent 调用前后都过同一组中间件。借这个范式给玉兔6 编排层加**一层切面**——所有 agent 动作统一经过「**记 eventlog → 红线检查(正好串上上一例 OpenAI guardrails)→ 密钥脱敏 → 异常兜底**」的中间件链,而非每处散写。**这是把红线/脱敏/记账从『散落实现』变成『一条可插拔、可统一升级的管道』的关键范式**,直接提升一致性与可审计性。
  - **Declarative Agents(YAML 声明式角色)= 玉兔6 角色从『硬编码』走向『配置化、可 diff、可回滚』** ⭐⭐:接第十六批 VoltAgent(name/description/tools/model 模板)、第十八批 A2A(Agent Card 能力声明)——MAF 把「一个 agent 是什么(指令/工具/模型/技能)」写成 **YAML + 可版本化**。借它把玉兔6 的秘书/总管/员工/玉衡角色定义抽成 YAML:**改角色不改码、可 git diff、可回滚、可被编排按声明的能力路由**,正补第十八批 A2A 能力路由缺的「落地形态」。
  - **DevUI(交互式开发/调试 UI)= 控制室『调试态』的现成形态,补运行态看板之外的一块** ⭐:已借 Mission Control / Tabler 的控制室是**面向老板的运行态看板**、第十八批 Langfuse 是**回放**;MAF 的 DevUI 多给一个**开发/调试态**——单独复跑某个 agent/workflow、看每步输入输出、断点式调。可借其形态给玉兔6 控制室加「调试模式」(单独复跑某员工的某一步、看中间态),与运行态看板分层。
  - **「AutoGen + Semantic Kernel 收敛成一套」= 玉兔6 多套机制该不该收敛的工程治理镜子** ⭐:MAF 最大的**元教训**是把两套概念重叠的框架合并成统一 API。玉兔6 也在多条线各自长(队列 / 编排 / 控制室 / Simulaid / 洞察员…),这条提醒:**概念重叠的机制(多处各写的『派活』『记账』『红线检查』)应收敛成统一原语/管道**,别让两套语义并存、各自漂移。属架构治理提醒,非代码任务。
  - 边界:MAF 是 **.NET + Python 双栈、偏 Azure/Foundry 生态**,玉兔6 **不引其运行时/云**;**只借「middleware 统一切面」范式 + 「YAML 声明式角色」形态 + 「DevUI 调试态」形态 + 「收敛治理」教训**。MIT 商用友好。
- 难度/优先级:中(借 middleware 切面落编排层统一管道 + YAML 角色定义;纯范式/schema,不引 .NET/Azure)。对 **编排层一致性/可审计 + 角色配置化**价值高。
- URL: https://github.com/microsoft/agent-framework

### MagicUI(magicuidesign/magicui)— 给「设计工程师」的动画组件库,杀手锏是**shadcn 式「拥有源码」registry(copy-paste 进项目、零运行时依赖)+ 一组『把注意力引导到关键状态』的动画组件**(MIT,21.2k★/1k forks,MDX 77%/TS 22.6%,1,363 commits,React+Next+Tailwind+Motion,自带 `skills/magic-ui` + AGENTS.md)
- 是什么:一个**「拥有源码、copy-paste」**的动画 UI 库(与 shadcn/ui 同哲学、同生态):组件**不是 npm 依赖**,而是经 `registry.json` 把**源码 copy-paste 进你的项目、你完全拥有可改、零外部运行时依赖**。内容是百余个**动画组件与视觉效果**(React + TypeScript + Tailwind + Motion/Framer Motion),如 number-ticker(数字滚动)、animated-list(列表项滑入)、animated-beam / border-beam(连线 / 描边高亮)、marquee(跑马灯)、shimmer / shine(微光)、bento-grid(便当格)等。仓库还自带一个 **`skills/magic-ui` 技能** + `AGENTS.md`(把「怎么用这套组件」写成 agent 能读的技能)。
- **值得借鉴(对口控制台 UI:自建组件 registry + 关键状态的注意力引导 + 组件即 skill)**:
  - **shadcn 式「拥有源码」registry(registry.json,copy-paste、零运行时依赖)= 玉兔6 自建控制台组件库的范式,且天然贴『单机零依赖』** ⭐⭐:第十五批 Tabler、第二十批 kbar 都是**装库**;MagicUI 走另一条路——**把源码 copy-paste 进项目、你拥有、无外部依赖**。借这个范式给玉兔6 控制台:把自家常用 UI 块(状态卡 / 时间线 / 任务行 / 告警条 / 调用树节点)做成一个**本地 registry**,各处 copy-paste 复用而非散抄——既**无外部依赖**(正合「单机零依赖」红线),又**统一风格、可一处改全局**。
  - **一组『把注意力引导到关键状态』的动画组件 = 控制台『关键变化用克制动画引导眼睛』的现成语汇表** ⭐⭐:玉兔6 控制台要让老板**一眼看到**「任务在涨 / 某员工卡住 / 出告警」。MagicUI 这组组件正是**状态→动画的对照表**:**number-ticker**(指标变化滚动)、**animated-list**(eventlog 新条目滑入)、**animated-beam / border-beam**(画出「秘书→总管→员工」的数据流向、或描边高亮**卡住的那一环**)、**shimmer/shine**(「处理中」态的微光)。借的是**动画语汇**(哪种状态配哪种克制动画),而非抄码——接第十二批 Motion(动画原语)、第二十批 react-bits(微交互),把「动画」从「好看」用到「**引导注意力到关键状态**」。
  - **仓库自带 `skills/magic-ui` + AGENTS.md(组件库即 agent 可调 skill)= 玉兔6『让 agent 自己拼控制台 UI』的范式** ⭐:对口第二十一批「把自家能力做成可调工具/skills」;MagicUI 把「怎么用这套组件」写成 agent 能读的技能,玉兔6 可照此给自家控制台组件 registry 配一份 skill,让 agent 按需拼 UI。
  - 边界:MagicUI 是 **React+Next+Tailwind+Motion** 栈,若玉兔6 控制台不是这套栈,**只借「registry 拥有源码 copy-paste」范式 + 「状态→动画」语汇 + 「组件即 skill」思路**,用自己的前端栈实现。MIT 商用友好、组件可放心读借。
- 难度/优先级:低(借 registry 范式 + 动画语汇,落控制台;前端栈不一致也只借范式)。对 **控制台『关键状态一眼可见』+ 自建组件库一致性**价值中–高。
- URL: https://github.com/magicuidesign/magicui

---
注:本批一线轮换回核心线「多智能体编排」但**刻意换前三次都没碰的第四角度「编排的安全/治理外壳」**(第八批=纵向单流确定性+时间旅行、第十三批=记忆、第十八批=横向交接+契约+可观测,**三次都没碰「跑时怎么自动拦住坏事 / 怎么统一切面 / 怎么声明式配角色」**),二线换「优秀网页设计」的全新角度「拥有源码的组件 registry + 注意力引导动画」(区别于第二十批 kbar 命令面板 / 早批仪表盘骨架)。三例**只借语义 / 数据形态 / 设计范式,不引各自重运行时**(OpenAI 的 Python 生态、MAF 的 .NET+Azure/Foundry、MagicUI 的 React/Next/Tailwind 一律不搬),贴「单机零依赖」。**本批不新增待办卡**(延续七–十、十二–二十二批口径;唯十一批因真漏洞破例):三例都是对**已有红线 / 编排 / 控制台机制**的**设计升级 / 范式参考**,非「必须立刻补的独立漏洞」;红线要不要做成自动闸、编排要不要加切面管道、控制台要不要上动画 registry,均属产品/主管决策,不由洞察员堆成待办。**但若老板要立刻、最小、最可逆、最值博地动一步**:把 **OpenAI guardrails 的「输入/输出并行护栏 + tripwire 即停」做进玉兔6 红线**——把**绝不可做的**(用凭据登录 / 过验证码 / 删非工区文件 / 回显密钥 / 碰 Starlaid)写成**输入护栏**自动拦、把**产物绝不可含的**(密钥 / 越权写别人工区)写成**输出护栏**自动挡,**并行旁路、命中急停,只灰区升级人审门**(纯逻辑、零运行时、随时可回退),一步同时拿到「**红线从一纸约定变成跑时强制自动闸**」+「**人审门只在灰区才打扰人、不再事事等人**」两个收益,且天然接上第十七批 Trigger waitpoint(灰区挂起等人)与第十八批 A2A `interrupted` 态。次选可逆一步:按 **MAF middleware** 把玉兔6「记 eventlog → 红线检查 → 密钥脱敏 → 异常兜底」收成**一条统一切面管道**(每个 agent 动作都过同一组中间件),把散落实现收敛成可一处升级的管道。**Starlaid 全程排除。** watch(本批 web_fetch 直读到实时元数据,优于历史 403 口径):openai-agents-python `main`(MIT,26.3k★/4k forks,Python,1,562 commits,99 releases,v0.17.2 / 2026-05-12,provider 无关,姊妹库 openai-agents-js)、microsoft/agent-framework `main`(MIT,10.4k★/1.7k forks,Python+.NET,2,076 commits,82 releases,dotnet-1.5.0 / 2026-05-08,AutoGen+SK 合并,A2A·AG-UI·MCP)、magicuidesign/magicui `main`(MIT,21.2k★/1k forks,MDX+TS,1,363 commits,无正式 release/滚动,自带 magic-ui skill)。另**挂三个下批候选 watch**:**agno-agi/agno**(原 phidata,主打高性能多 agent 实例化,编排线「**性能/轻量实例化**」全新角度)、**openai/openai-agents-js**(Agents SDK 的 TS/JS 双生版,若玉兔6 控制台/编排走 TS 可直读 TS 实现 + 语音 agent)、**originui/originui 或 pacocoursey/cmdk**(网页线:originui=另一套拥有源码的 Tailwind 组件集 / cmdk=kbar 之外的另一种命令面板实现,下次可对照分析)。HEAD commit SHA 仍因代理 `git ls-remote` 403 未取,待网络可达回填。


<!-- insight-scout-run:cr-insight-scout-smoke-20260623030554 -->
## 2026-06-23 · 自动洞察(smoke-20260623030554 · queue-engine)

> 来源:洞察员; run=cr-insight-scout-smoke-20260623030554; queue=insight-scout/insight-scout-repos-smoke-20260623030554; network=limited

### 洞察员触发链恢复自检
- 是什么: 这是控制台维修单的端到端 smoke,验证 insight-scout-repos 能派单、执行并落盘。
- 值得借鉴: 定时研究类 agent 应使用稳定 slot/id 去重,输出必须经过结构化门禁再写公告板。
- 难度/优先级: 已落地为控制台内置每 4 小时触发,后续真实研究继续走 zhipu-glm。
- URL: https://github.com/openai/openai-cookbook


<!-- insight-scout-run:cr-1782187206793-insight-scout-repos-20260623-12 -->
## 2026-06-23 · 自动洞察(20260623-12 · pixel-assets-ui)

> 来源:洞察员; run=cr-1782187206793-insight-scout-repos-20260623-12; queue=insight-scout/insight-scout-repos-20260623-12; network=limited

## 像素素材生成 / 控制台优秀网页设计 — 复看候选（slot 20260623-12，未联网）

> 能力声明：本 runner 无联网/WebSearch，以下为基于公开领域长期稳定项目的复看建议，不含实时 star/commit/release；落地前需有网环境复核许可证、活跃度与去重。

### 1. Piskel — 像素绘图编辑器
- 是什么：开源像素美术编辑器，帧动画/调色板/图层/导出 sprite sheet，纯前端可离线。
- 值得借鉴：左工具+中画布+右属性的三栏布局；调色板与帧时间轴分离式面板；PNG strip / GIF / data URI 导出管线。
- 迁移边界：老栈（Closure/Grunt），整体搬运成本高，只取交互模式与导出思路；核心算法用控制台现栈重写。
- 许可证/不确定项：常见 Apache-2.0，需复核具体仓库与 release tag。
- 难度/优先级：中 / 中。
- URL（待核）：https://github.com/piskelapp/piskel

### 2. PixiJS — 2D 渲染引擎
- 是什么：长期维护的高性能 2D 渲染库（WebGL/WebGPU），精灵/滤镜/资源加载成熟。
- 值得借鉴：Sprite+Ticker+Filter 模型适合像素素材实时预览/多帧播放/后处理；Assets 加载器对 sprite sheet 管理有参考价值。
- 迁移边界：重依赖，需 CEO 取舍；若仅静态预览则原生 Canvas2D 足够，不必引入整套引擎。
- 许可证/不确定项：常见 MIT，需复核主版本（v8 系列）包体积与 tree-shaking。
- 难度/优先级：高（引入）/ 低（仅设计参考）。
- URL（待核）：https://github.com/pixijs/pixijs

### 3. shadcn/ui — 控制台组件设计范式
- 是什么：Radix+Tailwind 的复制即拥有组件集，现代 SaaS 控制台广泛借鉴。
- 值得借鉴：Dialog/Sheet/Tabs/Form 三段式（配置→预览→导出）流程；克制的设计 token 让像素素材预览画布成为视觉主角；cmdk 命令面板对多生成器切换有借鉴价值。
- 迁移边界：复制源码模式，需评估与控制台现有组件库重复度；主题 token 需对齐控制台品牌色。
- 许可证/不确定项：常见 MIT，组件 API 随版本变化，落地需锁定快照。
- 难度/优先级：低 / 高（纯设计范式，风险最低）。
- URL（待核）：https://github.com/shadcn-ui/ui

### 本轮结论
- 三条均为设计/交互借鉴层面，是否引入依赖需 CEO 结合控制台现有技术栈判断；本轮不产出公告板卡。
- 建议 slot=20260623-16 由联网 runner 复核：许可证原文 / 最近 commit / seen-repos 去重 / borrowed-libs 冲突。
## 2026-06-23 · 第二十四批(选题:Unity(Simulaid) — 在产 2D 像素卡牌手游「运行时本体」:卡牌阶段状态机+出牌护栏 / 零分配游戏感动效 / 存档模式演进与确定性回放;运行 ~12:0x+08:00)

> 本批轮换回**最冷的核心线「Unity(Simulaid)」**(上次第十九批 06-22 ~16,已冷约 20 小时;其间二十–二十三批都在像素/网页/网关/工具skills/队列/grounding/编排上)。Simulaid 是玉兔6 唯一**真实在产的游戏项目**(团结引擎 1.8.5 = Unity 2022.3.62t7,**2D 像素卡牌**,已上 TapTap,需补鸿蒙)。前三次 Unity 批**刻意各自换角度,却从没碰过「Simulaid 作为一款在产卡牌手游,它自己的运行时游戏层长什么样」**:第九批=**像素素材流水线**(LPC/spritebrew/TileGen)、第十四批=**AI 改 Unity 工程**(IvanMurzak-MCP/GamingAgent/GameCI)、第十九批=**仿真本体**(ml-agents 训练台/TotalAI 决策/rl-llm 内在状态可视化)——**三次都在「素材怎么来 / AI 怎么改工程 / 仿真怎么训」,从没碰卡牌手游最核心的三件事:① 回合/出牌的规则状态机怎么不写成一团 if;② 卡牌发牌/翻牌/结算的「游戏感」动效怎么零卡顿地造;③ 存档怎么跨版本兼容、以及怎么把某一刻状态快照下来做确定性回放/取证**。本批正补这条「**卡牌手游运行时本体**」的链:**CardHouse**(Unity 卡牌工具集:阶段状态机 + 卡组转移算子 + 出牌 Gate 护栏 + ScriptableObject 数据驱动,且**与团结同属 Unity 2022.3 线**、CC0 最宽松)、**LitMotion**(零分配 tween:发牌/翻牌/抖动动效 + Sequence 声明式组合 + 零分配文本动画)、**MemoryPack**(Version Tolerant 存档模式演进 + 快照即回放底座 + Union 标签判别)。三例都按惯例「**只借数据形态 / 状态机语义 / 设计范式,不引各自重运行时**」(CardHouse 整包与团结兼容待验、LitMotion 的 DOTS/Burst 栈、MemoryPack 的二进制格式一律不搬),贴「单机零依赖」。**Starlaid 全程排除。**

### CardHouse(pipeworks-studios/CardHouse)— Unity 卡牌游戏工具集:把「回合/出牌规则」从一团状态机 if 收成显式 PhaseManager + 卡组转移算子(CardTransferOperator)+ 出牌 Gate 护栏 + ScriptableObject 数据驱动卡/牌组/资源(CC0-1.0,58★/11 forks,67 commits,Unity 2022.3.0f1,C# 82%/ShaderLab/HLSL,Pipeworks 工作室出品)
- 是什么:一家真实工作室(Pipeworks)开源的 **Unity 做卡牌游戏的起步工具集**,**CC0-1.0**(公共领域,无署名义务、可商用)。开宗明义点出卡牌游戏的真痛点:「**卡牌游戏很复杂——一堆『什么时候能出什么』的规则,把这些行为编码成状态机会让人头大**」,CardHouse 就是来给这块兜底。内含:**① 一个 `System` 预制件**(放进场景,管全局**阶段管理 PhaseManager** + 拖拽);**② 常见卡组预制件**(牌堆 deck / 手牌 hand / 网格 grid 等「卡片容器」做成一等公民);**③ `CardTransferOperator`**(声明式地把卡在容器间转移:抽/弃/发/收);**④ `Gate` 组件**——**按「是否轮到你」「是否付得起」限制卡片能否被拖出/打出**(出牌合法性护栏);**⑤ `Seeker` 组件**(管卡片的位置/旋转/缩放插值,即布局与归位动画);**⑥ ScriptableObject** 定义资源/牌组/卡;**⑦ 点击/拖拽处理器 + UnityActions 编排**(组件之间用 UnityAction 串行为,**留自定义钩子可插自家逻辑**);另带回合传递按钮、玩家资源画布(血/法力)、CCG/构筑/接龙三类样例游戏 + 交互式教程。明确缺口:**无联网**(只做本地轮流 pass-and-play)、无具体卡牌构建器。
- **值得借鉴(对口 Simulaid 卡牌规则/出牌 + 玉兔6 board 状态机/红线护栏/数据驱动)**:
  - **PhaseManager「把回合/阶段做成显式状态机」= Simulaid 卡牌规则别再散成一团 if 的现成范式** ⭐⭐:Simulaid 是卡牌游戏,**回合 → 抽牌阶段 → 出牌阶段 → 结算阶段 → 对手回合**这套阶段流转是核心,最容易写成到处散落的 `if (phase==...)`。借 CardHouse 的 PhaseManager 形态把 Simulaid 的回合阶段**显式化、集中、可配置**——每个阶段允许哪些操作、什么条件进下一阶段一处声明。这同时对口玉兔6 **board 卡/任务的状态机**(todo→doing→done,接第十八批 A2A Task 状态、第二十二批 goqite 任务态):「阶段/状态机」是 Simulaid 与控制台**共享的通用范式**。
  - **`Gate` 出牌护栏 = 出牌合法性的「声明式前置闸」,正是第二十三批 OpenAI guardrails 在游戏里的具体形态** ⭐⭐:Gate「按是否轮到你 + 是否付得起」拦截非法拖拽——把「这张牌现在到底能不能打」从散落判断收成**声明式护栏**。对口 Simulaid 出牌规则校验;也与玉兔6 §17 红线「危险动作前置闸」同构(第二十三批刚借 guardrails「输入护栏命中即停」)——**游戏出牌护栏与系统红线护栏是同一个『声明式前置闸』范式的两处落地**。
  - **`CardTransferOperator` 卡组间声明式转移 = 「实体在容器间流转」的统一算子** ⭐:deck→hand→board→discard 用统一转移算子声明,而非到处手写搬运。这与玉兔6 队列里「任务在 pending/running/done/dead 容器间转移」(第二十二批 goqite 死信隔离)**同构**——可对照检查玉兔6 的「任务流转」是否也该收成一组声明式算子。
  - **ScriptableObject 数据驱动卡/牌组/资源 = 内容「改数据不改码」** ⭐:接第十九批 TotalAI「SO 乐高式可插拔」、第二十三批 MAF「YAML 声明式角色」——卡牌/资源做成可插拔数据资产,对口 Simulaid 卡牌作者化 + 玉兔6 角色/技能/卡片配置化的同一方向。
  - 边界:CardHouse 用 **Unity 2022.3.0f1**,**与 Simulaid 团结(Unity 2022.3.62t7)同属 2022.3 线**——这是本批一个**难得的高兼容性参考**(比标准 Unity 与团结差异更小),但仍需在团结实测;**CC0-1.0 = 最宽松,可直接读/改/借/商用、无任何署名义务**。只借「PhaseManager 阶段状态机 + Gate 护栏 + Transfer 算子 + SO 数据驱动 + UnityAction 钩子」**范式**,不必整包 vendor。它**无联网**对口 Simulaid 单机卡牌**正好不亏**。
- 难度/优先级:低-中(借阶段状态机 + Gate 护栏 + SO 数据驱动范式;同 2022.3 线、CC0,借鉴成本为历批 Unity 最低,真用仍需团结验证)。对 **Simulaid 卡牌规则/出牌护栏 + 玉兔6 状态机/红线护栏统一**价值高。
- URL: https://github.com/pipeworks-studios/CardHouse

### LitMotion(annulusgames/LitMotion)— Unity「闪电级 + 零分配」tween 库:发牌/翻牌/抖动等游戏感动效零 GC、比同类快 2–20×,v2 加 Sequence 声明式组合动效 + Inspector 里搭动画 + 零分配文本动画(MIT,2.2k★/157 forks,759 commits,25 releases,v2.0.2 / 2026-05-10,C# 100%,Unity 2021.3+)
- 是什么:Unity 的**高性能零分配补间(tween)库**,作者前作 Magic Tween 的进化版。一行代码动画任意值(Transform / Material / TextMeshPro / 任意字段属性);**用 struct 设计 + DOTS(数据导向)优化做到创建 tween 零 GC 分配**,各场景比其它 tween 库**快 2–20×**。特性:easing / looping、**Punch / Shake 等特殊动效**(冲击/抖动反馈)、**零分配文本动画**(TMP / UI Toolkit,含逐字上色/位移、随机字符扰动)、callback / coroutine / **async-await(UniTask)** / **Observable(R3/UniRx)**、用 `MotionHandle` struct 控制(Cancel/Complete/IsActive)、**Debugger 窗口**看在跑哪些动效。**v2 两大新增**:**`LSequence`**(Append/Join/Insert 把多段动效组合成一条时间线)+ **LitMotion.Animation 包**(在 Inspector 里可视化搭建动画,功能已对标 DOTween Pro / PrimeTween)。
- **值得借鉴(对口 Simulaid 卡牌游戏感动效 + 像素办公室小人动效 + 控制台关键状态动画)**:
  - **零分配 tween = Simulaid 卡牌「游戏感(juice)」动效的现成内核,且天然手游帧率友好** ⭐⭐:卡牌**发牌入手、翻面、滑到出牌区、被打时抖动、高亮可打牌**全是 tween;手游最怕动效造成 **GC 卡顿**,LitMotion**创建即零分配 + Punch/Shake 现成做出牌反馈**正好对症。对口 Simulaid 卡牌动效,也对口**像素办公室小人移动/状态切换**(接第十九批「办公室真的动起来」、第二十批 AnimatedSprite 状态机)的动效执行层。
  - **`LSequence` 声明式组合 = 「一套出牌动画 = 一条可声明时间线」** ⭐:Append/Join/Insert 把「发牌→翻面→入场→数值跳动」组合成一条可读时间线,替代手摆嵌套 coroutine。对口把 Simulaid 复杂动效序列**声明化**,也对口控制台「多步状态转场」的编排。
  - **零分配文本动画(TMP)+ Punch = 控制台/HUD「数字指标滚动 + 关键变化强调」的 Unity 端实现** ⭐:数字 ticker(指标变化滚动)、逐字上色/位移——正接第二十三批 MagicUI 的「number-ticker / 注意力引导动画」**语汇表**,但 MagicUI 是 React 端、LitMotion 是 **Unity 端**实现,对口 Simulaid HUD 指标 +(若控制台/Simulaid 走 Unity 渲染的)关键状态强调。
  - **MotionHandle + Debugger = 动效可控、可观测**:每个动效一个 handle 可随时取消/完成、Debugger 窗口看全在跑的动效——对口「动效也要可观测/可调试」(接控制室可观测主题)。
  - 边界:LitMotion 依赖 **Burst / Collections / Mathematics(DOTS 栈)**,**团结(Unity 2022.3 fork)需先验证这些 DOTS 包兼容**;若玉兔6 **控制台非 Unity 栈**,则只借「**状态→克制动效的语汇 + LSequence 声明式组合**」范式,用现有前端实现(接第十二批 Motion / 第二十批 react-bits / 第二十三批 MagicUI)。MIT 商用友好,C# 代码可放心读借。
- 难度/优先级:低(借动效语汇 + 声明式组合范式)–中(真接团结需验证 DOTS 兼容)。对 **Simulaid 游戏感动效 + 像素办公室动效执行层 + 控制台动画**价值高。
- URL: https://github.com/annulusgames/LitMotion

### MemoryPack(Cysharp/MemoryPack)— C#/Unity「零编码极致性能」二进制序列化器,本批最值钱的不是速度而是三个范式:Version Tolerant(存档跨版本兼容)+ 快照即回放底座 + Union(标签判别多态)(MIT,4.6k★/301 forks,638 commits,70 releases,C# 93.4%,.NET 7/C# 11 + Unity,Cysharp 出品)
- 是什么:Cysharp(UniTask / R3 等高性能 Unity 库的作者)出品的**零编码二进制序列化器**,普通对象比 MessagePack/protobuf-net/System.Text.Json **快约 10×**、struct 数组**快 50–200×**(因为「零编码=尽量直拷 C# 内存」)。**Source Generator(无 IL.Emit)+ Native AOT 友好**。对玉兔6 最值钱的**不是速度,而是三个设计范式**:**① Version Tolerant(版本容忍)**——支持**模式演进**:给类型加「带版本容忍」格式后,**新增字段不会破坏旧数据的反序列化**(老存档仍可被新版本读);**② Union(标签判别多态)**——`[MemoryPackUnion(tag, typeof(子类型))]` 用**唯一整数标签**判别接口/抽象类的具体子类型(序列化判别联合);**③ 快照**——能把整个对象图一次性、高效地序列化成一份字节,即「**某一刻完整状态的快照**」。另支持循环引用、现代 I/O(IBufferWriter / ReadOnlySpan / ReadOnlySequence)。
- **值得借鉴(对口 Simulaid 存档兼容 + §17 视觉门取证 + 控制室回放 + 卡牌效果/board 卡判别)**:
  - **Version Tolerant「模式演进」= Simulaid 存档跨版本兼容的现成范式** ⭐⭐:Simulaid 已上 TapTap、要补鸿蒙、会持续迭代——**老玩家的旧存档必须能被新版本读**(第十四批已点出 Simulaid 有「存档校验/兼容」关切)。MemoryPack 的 Version Tolerant 正是这件事的范式:**加字段不破旧档、字段有版本容忍**。对口 Simulaid 存档,也对口玉兔6 **board 卡 / taskstore / 任务契约的 schema 演进**(接第二十一批 BAML/Instructor「schema 单一事实源」)——「**数据格式会演进,旧数据要能继续读**」是两边共同的底层需求。
  - **快照 = 「确定性回放 / 取证」的底座,直击 §17 视觉门反复卡的难题** ⭐⭐:把某一时刻的**完整游戏状态快照**存下,即可「**从快照精确重放到这一刻**」。这给 §17 视觉硬门一条**「可复现状态 → 可复现截图证据」**的路径(接第十四批 GamingAgent 的 episode-log/replay、第十八批 Langfuse 的 session 回放):Simulaid bug 复现(对口 `SIMULAID_BUG_REGRESSION_LOG`)从「描述怎么复现」升级成「**存一份触发态快照、一键重放**」;同一范式也对口玉兔6 **控制室「回放某次任务全过程」**——把关键节点的状态快照进 eventlog。
  - **Union(标签判别多态)= 卡牌效果 / board 卡种类 / 任务态的「带标签判别联合」范式** ⭐:`[MemoryPackUnion(0, 伤害), (1, 治疗), (2, 抽牌)…]` 用唯一标签判别子类型——正是 Simulaid **卡牌效果体系**(一张牌的效果是哪一种)、玉兔6 **board 卡种类 / A2A Task 状态(第十八批)** 该有的「**带标签判别联合**」数据形态,比「一个大对象塞所有可选字段」清晰、可扩展、可校验。
  - 边界(**重**):MemoryPack 是**二进制**格式,**与玉兔6「文件式 + 可读 JSON、可 git diff、可人工审阅」的核心哲学相反 → 不引二进制格式本身**;**只借「Version Tolerant 模式演进 + 快照即回放底座 + Union 标签判别」三个设计范式**,玉兔6 的存档/快照**仍用可读 JSON 自实现**这些性质(加 `schema_version` 字段 + 加字段向后兼容规则 + 加 `kind`/`tag` 判别字段)。Simulaid 真要高性能二进制存档时再单独评估(注:Unity 里 `ModuleInitializer` 不支持,Union formatter 需手动注册)。MIT 商用友好,Cysharp 出品质量可靠。
- 难度/优先级:中(借模式演进 + 快照回放 + Union 判别**范式**,落 Simulaid 存档兼容 + §17 取证 + 控制室回放 + 卡牌效果判别;**不引二进制格式**,用可读 JSON 自实现)。对 **Simulaid 存档跨版本兼容 + §17 视觉门可复现取证 + 控制室回放**价值高。
- URL: https://github.com/Cysharp/MemoryPack

---
注:本批轮换回最冷核心线「Unity(Simulaid)」(上次第十九批 06-22 ~16,冷约 20 小时),且**刻意换前三次 Unity 批从没碰过的第四角度——「Simulaid 作为一款在产 2D 像素卡牌手游,它自己的运行时游戏层」**(第九批=像素素材流水线、第十四批=AI 改 Unity 工程、第十九批=仿真训练/决策/内在状态可视化,**三次都没碰卡牌手游最核心的『规则状态机 / 游戏感动效 / 存档与回放』**)。三例补三段:**CardHouse**(PhaseManager 阶段状态机 + Gate 出牌护栏 + Transfer 转移算子 + SO 数据驱动,且**与团结同属 Unity 2022.3 线**、CC0 最宽松)、**LitMotion**(零分配 tween + LSequence 声明式组合 + 零分配文本动画,卡牌游戏感)、**MemoryPack**(Version Tolerant 存档模式演进 + 快照即回放底座 + Union 标签判别)。三者**只借数据形态 / 状态机语义 / 设计范式,不引各自重运行时**(CardHouse 整包与团结兼容待验、LitMotion 的 DOTS/Burst 栈、MemoryPack 的二进制格式一律不搬),贴「单机零依赖」。**本批不新增待办卡**(延续七–十、十二–二十三批口径;唯十一批因真漏洞破例):三例都是对 **Simulaid 运行时层** 与 **控制台/控制室** 的**设计参考 / 范式借鉴**,**Simulaid 项目工作归 supervisor-Simulaid**,洞察员只沉淀分析;非「必须立刻补的独立漏洞」,是否上卡牌状态机框架 / 动效库 / 快照回放属产品/主管决策,不由洞察员堆成待办。**但若老板要立刻、最小、最可逆、最值博地动一步**:借 **CardHouse 的「PhaseManager + Gate」把 Simulaid 的回合/出牌做成『显式阶段状态机 + 声明式出牌护栏』**——把「现在是哪个阶段、这阶段允许哪些操作、这张牌现在能不能打(轮到没/付得起没)」从散落的 if 收成一处声明,**与团结同属 Unity 2022.3 线(高兼容参考)、CC0 可直接读改、纯设计落地随时可回退**,一步同时拿到「**卡牌规则不再是一团状态机 if**」+「**出牌护栏与玉兔6 §17 红线护栏共用同一『声明式前置闸』范式**」两个收益。次选可逆一步:借 **MemoryPack 的「快照即回放」范式**给 Simulaid bug 复现 + 玉兔6 控制室回放加「**存一份触发态快照、一键重放**」(用可读 JSON 自实现,不引二进制),直击 §17 视觉门「截不到可复现证据」的老难题;或借 **LitMotion 的「状态→克制动效语汇」**给像素办公室/控制台关键状态加引导动效(接第十二/二十/二十三批动画线)。**但因 Simulaid 归 supervisor、控制台动效/快照属产品决策,洞察员只建议不堆卡。** Starlaid 全程排除。watch(本批 web_fetch 直读到实时元数据,优于历史 403 口径):CardHouse `main`(CC0-1.0,58★/11 forks,67 commits,1 release「Art Update」v1.0.4 / 2023-06-14,Unity 2022.3.0f1,C# 82%/ShaderLab/HLSL,Pipeworks 工作室)、LitMotion `main`(MIT,2.2k★/157 forks,759 commits,25 releases,v2.0.2 / 2026-05-10,C# 100%,Unity 2021.3+,依赖 Burst/Collections/Mathematics)、MemoryPack `main`(MIT,4.6k★/301 forks,638 commits,70 releases,C# 93.4%,.NET 7/C# 11 + Unity,Cysharp 出品,Version Tolerant + Union + 零编码)。另**挂三个下批候选 watch**:**db0/godot-card-game-framework**(卡牌框架的「**脚本引擎 + 规则全强制执行**」角度——虽 Godot,但其「数据驱动卡牌脚本 + 规则引擎」架构值得与 CardHouse 对照,补「卡牌效果脚本化」那半)、**Cysharp/UniTask 或 Cysharp/R3**(Unity 零分配 async/响应式,对口队列/编排的 stepping 与帧解耦)、**IndieMarc/TcgEngine**(在线对战 + Minimax AI 角度,若 Simulaid 日后要 PvP/AI 对手可对照)。HEAD commit SHA 仍因代理 `git ls-remote` 403 未取(本批实测三仓库均 403),待网络可达回填。


<!-- insight-scout-run:cr-1782201765387-insight-scout-repos-20260623-16 -->
## 2026-06-23 · 自动洞察(20260623-16 · unity-simulaid-methods)

> 来源:洞察员; run=cr-1782201765387-insight-scout-repos-20260623-16; queue=insight-scout/insight-scout-repos-20260623-16; network=unavailable

## Unity/团结工作流方法论借鉴扫描（slot=20260623-16）

- 主题：Unity/团结工作流方法论，仅取泛化方法，不触碰项目代码
- 网络状态：unavailable（未联网，不引用也不虚构实时 star/commit/release；URL 基于历史训练知识，需后续联网复核 License 与活跃度）
- 排除：Starlaid/星桥 全程排除
- 去重：未读取本地 seen-repos，可能存在重复，由引擎按 seen-repos 合并去重

### 候选 1：GameCI（Unity 自动化 CI/CD 流水线方法论）
- 是什么：跨平台 Unity 项目的 GitHub Actions / GitLab CI 流水线方案，覆盖 License 激活、测试、多平台构建、产物归档。
- 值得借鉴：流水线节点拆分（测试—构建—归档—发布）、Secret/License 与节点解耦、多平台/多版本矩阵依赖管理。
- 难度/优先级：中（思想迁移低成本；落地需 CEO 决定是否引入 CI/CD 框架）。
- 迁移边界：YAML 仅适用 Unity 工程；非 Unity 工程只取编排思想；License 处理必须由 CEO/运维决策。
- URL: https://github.com/game-ci/documentation
- 许可证：仓库页标注 MIT，需法务复核。

### 候选 2：Unity Addressables（资源分组 + 按需加载方法论）
- 是什么：Unity 官方资源分组、标签索引、按需加载、远程分发、版本化管理方案。
- 值得借鉴：分组-标签-按需-远程分发四段式抽象；配置即代码（Profile + Schema）；远程版本与本地缓存解耦。
- 难度/优先级：低（仅作为方法蓝本，无落地压力）。
- 迁移边界：实现层强耦合 Unity；非 Unity 工程只取抽象方法。
- URL: https://github.com/Unity-Technologies/com.unity.addressables
- 许可证：Unity Companion License，需法务复核。

### 候选 3：Unity Test Framework（测试分层与夹具方法论）
- 是什么：Unity 官方测试框架，EditMode/PlayMode 分层，支持 fixture、参数化、并行执行。
- 值得借鉴：按生命周期/运行环境分层测试；fixture 复用；测试矩阵并行 + 资源隔离。
- 难度/优先级：低（方法论借鉴，无直接落地需求）。
- 迁移边界：实现依赖 NUnit + Unity；仅借鉴分层与夹具组织思想。
- URL: https://github.com/Unity-Technologies/com.unity.test-framework
- 许可证：Unity Companion License，需法务复核。

### 本轮结论
- 三个候选均为方法论借鉴层面，未发现需 CEO 24 小时内拍板的低风险高价值行动；不生成公告板卡。
- 沉淀到 insights.md；若主管后续要在控制台工程落地 CI/CD 编排、资源分组或测试分层，再独立派单。
## 2026-06-23 · 第二十五批(选题:像素素材与画风 — 像素办公室/Simulaid 素材的「生成 → 作者 → 编排」三段:本地零成本扩散生成精灵 / 可脚本化精修动画编辑器 / 关卡-对象-属性声明式场景数据模型;运行 ~16:1x+08:00)

> 本批轮换回**最冷的「像素素材与画风」线**(上次第二十批 06-22 ~20:0x+08:00,已冷约 20 小时;其间二十一–二十四批走的是 网关/工具skills、队列/grounding、编排/网页、Unity 卡牌运行时,且本 16:00 槽位的离线占位又落在 Unity 方法论上 → **Unity/编排刚被连碰,像素线最久没有真·联网分析**)。**且刻意换三个前几次像素批从没碰过的角度**:第九批=**素材生成流水线**(LPC/spritebrew/TileGen)、第二十批=**文本→带动作行精灵表 + 精灵 FSM + cmd+k**(falsprite/AnimatedSprite/kbar)——两批都在「**怎么把图生出来 / 怎么在运行时播**」,**从没碰**:① 生成这一步能不能**完全本地、零 API 成本**;② 图生成后的**精修/标准化**那一步该不该**可脚本化**;③ 一屋子素材**怎么摆成一张「带属性的场景」**(像素办公室的工位/小人/设备布局,而不只是单张图)。本批正补这条「**像素素材生命周期**」的三段链:**pixel-forge**(纯 Rust、无 Python 无云的本地扩散精灵生成器 + 固定调色板量化 + 产物签名)、**LibreSprite**(开源 Aseprite GPLv2 分支,带脚本 API 的精修/动画作者工具)、**Tiled**(关卡编辑器的「瓦片层 + 对象层 + 任意自定义属性 + 规则自动贴图」声明式场景数据模型)。三例按惯例**只借数据模型 / 生成与治理范式 / 作者-运行时契约,不整包 vendor**(pixel-forge 0★未达产,仅借设计 + 挂 watch;LibreSprite GPL-2.0 当外部作者工具;Tiled GPL-2.0 当外部编辑器 + 借其开放 TMX/JSON 格式)。**Starlaid 全程排除。**

### pixel-forge(cochranblock/pixel-forge)— 纯 Rust、无 Python 无云的「本地扩散精灵生成器」:三档 U-Net 模型(1.09M/5.83M/16.9M)在 CPU/Metal/CUDA 本地跑 + 生成后量化到固定调色板(pico8/nes/snes/gameboy/endesga32…)+ 模型完整性签名 + JSON 工具协议(Unlicense 公共领域,v0.6.0 / 2026-03-28,**0★/0 forks**,~159 commits,Rust 86%,**作者明示「output not yet game-ready」**)
- 是什么:一个**完全本地、不调任何云 API、不用 Python** 的像素精灵扩散生成器,用 HuggingFace 的纯 Rust ML 框架 Candle,在 **CPU / Metal(Apple 芯片)/ CUDA(NVIDIA)** 上训练并运行高斯扩散模型,生成 **32×32 像素精灵**。三档模型:**Cinder**(1.09M 参数,~1.5 min/epoch)、**Quench**(5.83M,带自注意力)、**Anvil**(16.9M)。带 **egui GUI + clap CLI**(`anvil character --count 4 --palette stardew`)。关键不是它现在的画质(作者**坦白「能认出但还粗糙、尚不可当游戏美术」、0★、单人项目**),而是**几个对玉兔6 直接对口的设计点**:① **生成后量化到 7 个固定调色板**(pico8/nes/snes/gameboy/endesga32/stardew/starbound)→ 强制风格统一;② **类条件**(108 个类目录 → 10 超类 + 12 二元标签的混合条件)→ 可控「生成哪一类素材」;③ **NanoSign**:所有模型保存时打 **BLAKE3 签名、加载时校验、篡改即拒绝**;④ **`plugin` 命令是 JSON 协议**,让生成器能被外部编排程序(其配套 kova)调用;⑤ `relight`(用 SDF+法线把单图扩成 4 方向精灵表)、`curate`/`ingest-gemini`(把精灵大图切成训练小块);⑥ 训练集**坦诚标注来源与许可**(DCSS/Kenney CC0、DawnLike/Hyptosis CC-BY,约 70% 由 Gemini 文本生成后切片去背)。
- **值得借鉴(对口 玉兔6「素材零成本本地化」+ 画风一致性 + 产物完整性治理 + 把能力做成工具)**:
  - **「无 Python 无云、本地零 API 成本」的生成路径 = 接续玉兔6 反复出现的『本地零成本』主线** ⭐:接 proper-pixel-art(清洗)/falsprite(**云 LLM** 生成)——本仓库补的是「**生成这一步也能完全本地、零 API 成本**」(与 macOS-use 的 mlx「本地零成本」愿景同构)。对口 Simulaid/像素办公室 大量小图标/精灵的**批量本地生成**,长期不被 API 账单卡。**但当前画质未达产 → 只作方向观察,不投产、不依赖**。
  - **「生成 → 量化到固定调色板」这一步本身 = 画风一致性的现成范式(即便不用它的模型)** ⭐:不论素材来自谁(falsprite/Gemini/手绘),**最后统一量化到一套固定 palette**(如自定一套「玉兔6 像素办公室 palette」)就能保证全屋素材**画风统一**——正接第二十批对「画风」的关注。这一步**可立刻加进现有素材管线**,与生成器是谁解耦。
  - **NanoSign「产物加签名、加载即校验、篡改拒绝」= 玉兔6 对 skills/模型/关键产物完整性治理的具体落点** ⭐:接 SkillSpector(入库扫描)、tech-leads-club/agent-skills(lockfile/hash/审计)——本仓库把「**模型/产物 BLAKE3 签名 + 加载校验 + 拒绝被篡改文件**」做成了可借的最小机制。对口玉兔6 给 **skills / 重要产物 / 借鉴库快照** 加「hash+签名+加载校验」,是 borrowed-libs 里「skill 库治理」一直挂着的「建议候选」的一个**具体可抄的实现形态**。
  - **`plugin` JSON 协议 = 「素材生成器应是可被编排/队列调用的工具,而非只有 GUI」** ⭐:接第二十一批 FastMCP「把自家能力做成可调工具」——生成器暴露 **JSON/stdio 接口** 才能进玉兔6 的**编排/队列**(让洞察员/秘书/控制台按需派「生成 N 张某类素材」单),这正是玉兔6「文件式 + 可编排」哲学要的形态。
  - 边界(**重**):**0★、单人项目、output 未达产、Unlicense(公共领域可放心读码但无社区背书)** → **不投产、不作依赖,仅借上述四个设计/治理范式 + 挂 watch 看画质是否追上**。其二进制 safetensors 模型与玉兔6「可读 JSON/可 git diff」哲学不冲突(模型本就该是二进制),但**签名/校验机制要用玉兔6 自己的可读清单实现**。
- 难度/优先级:低(借「统一调色板量化 + 产物签名校验 + 生成器 JSON 接口」三个范式,均可在现有管线/治理上小步落地,不引其模型)。**优先级:低(观察)**——成熟度不足以投产,价值在「方向 + 三个可抄的范式」,挂 watch。
- URL: https://github.com/cochranblock/pixel-forge

### LibreSprite(LibreSprite/LibreSprite)— 开源的 Aseprite「最后一版 GPLv2」分支,像素精灵的**精修 + 动画作者工具**,带脚本 API:图层+帧+帧标签+洋葱皮 的动画数据模型 + tiled 平铺绘制 + 可脚本化批处理(GPL-2.0,**7.5k★/465 forks**,5,377 commits,C++ 93%,跨平台含 Android + emscripten 网页构建,最新 tag v1.1 / 2023-12)
- 是什么:Aseprite 在 2016 年转闭源前**最后一个 GPLv2 提交**的社区分支,定位「**创建并动画化你的精灵**」的专业像素编辑器,完全开源、跨平台(Linux/Win/Mac/Android,且有 emscripten 网页构建)。核心能力:**实时动画预览、洋葱皮(onion skinning)、一次编辑多个精灵、调色板(内置+自定)、精灵由「图层 & 帧」组成、tiled 平铺绘制模式(画无缝纹理/图案)、像素级工具(填充轮廓/多边形/shading 模式)、多种文件格式**;并带 **SCRIPTING.md + JS 脚本 API**(仓库 2.1% JavaScript)可自动化重复操作。它与「生成器」是互补关系:生成器出图,**LibreSprite 是图生出来之后『人精修 + 批处理标准化 + 定义动画』那一环**。
- **值得借鉴(对口 玉兔6 素材精修/标准化管线 + 像素办公室/Simulaid 动画作者-运行时契约)**:
  - **脚本 API → 「素材入库前的可编程精修/标准化」环节** ⭐:接第九批 TileGen / 第二十批 falsprite(生成)与 proper-pixel-art(清洗)之后,缺的是**「批量统一画布尺寸/对齐网格/换统一 palette/裁帧/导出 spritesheet」**这一标准化步骤。LibreSprite 的脚本 API 能把这步**写成可重复脚本**(而非手工逐张),适合做成玉兔6 素材管线里一个**可被编排调用的「精修+标准化」工位**。
  - **「图层 + 帧 + 帧标签 + 洋葱皮」动画数据模型 = 像素办公室小人/Simulaid 卡牌动画的『作者侧』数据契约** ⭐:正好与第二十批 **AnimatedSprite(FSM + JSON、运行时按状态名播帧)** 配对——LibreSprite **作者侧用「帧标签」给一段帧命名**(idle/walk/busy/error…),运行时(AnimatedSprite 或 Simulaid)**按同名状态消费**。借这条「**帧标签名 = 运行时状态名**」的作者-运行时契约,让美术产出与代码状态机**对齐、改图不改码**。对口第十九/二十批「**办公室真的动起来**」(claude-office/agents-in-the-office 借鉴的工位状态动画)。
  - **tiled 平铺绘制模式 = 像素办公室地板/墙面无缝纹理的作者手段** ⭐:无缝平铺地块正是「一屋子工位」铺底需要的,配合下面 Tiled 的瓦片层用。
  - 边界:**GPL-2.0**——**不 vendor 进玉兔6 闭源代码**,当**外部作者工具**用,或**只借「脚本化精修 + 帧标签动画数据模型」思路**自实现到管线里;最新 tag 停在 2023-12(发布偏旧,但 CI/提交仍在动),功能稳定。
- 难度/优先级:低(当外部作者工具 + 借「帧标签=状态名」契约,立即可用)–中(若要把脚本化精修做成管线工位,需封装调用)。对 **素材精修标准化 + 办公室/Simulaid 动画作者-运行时对齐**价值中-高。
- URL: https://github.com/LibreSprite/LibreSprite

### Tiled(mapeditor/tiled)— 通用关卡/瓦片地图编辑器的**事实标准**,杀手锏是「**瓦片层 + 对象层 + 任意自定义属性 + 规则自动贴图(AutoMapping)**」的声明式场景数据模型 + 开放的 TMX/JSON 格式 + JS 扩展 API(GPL-2.0+ 编辑器;**TMX/JSON 地图格式开放有规范、可自由使用**,约 **9.5k★**,作者 Thorbjørn Lindeijer,极成熟,全平台 AppImage/Flatpak/snap,海量已发售游戏在用)
- 是什么:面向所有「基于瓦片」游戏的**通用关卡编辑器**(RPG/平台/解谜皆可),开源、易用、十余年沉淀。数据模型本身就是它最大的价值:**① 多种图层**(瓦片层 tile / **对象层 object** / 图像层 / 分组层);**② 一张地图可挂多个 tileset;③ 地图/图层/瓦片/对象都能挂「任意自定义属性」(arbitrary custom properties)**;**④ 对象层**专门用来摆「**出生点 / NPC / 事件 / 触发区**」这类非网格实体;**⑤ AutoMapping**——**规则式自动贴图**(给一组「输入图案 → 输出瓦片」规则,自动把边角/过渡/装饰填好);⑥ Terrain/Wang 瓦片(自动处理地块过渡);⑦ 对象模板(可复用对象);⑧ 无限地图(分块);⑨ 等距/六边形/交错网格;⑩ **导出 TMX(XML)/ JSON / Lua**,且有 **JavaScript 扩展 API**(可加自定义命令/导入导出/工具)。
- **值得借鉴(对口 玉兔6 像素办公室布局数据模型 + 控制台「在网格上摆带属性实体」+ 自动贴图 + 可编排导出)**:
  - **「瓦片层 + 对象层 + 自定义属性」= 像素办公室布局的现成声明式数据模型** ⭐⭐(本批最高价值):像素办公室不该把「哪个工位在哪、是谁、什么状态」**写死在渲染代码里**。借 Tiled 模型:**地板/墙=瓦片层;每个工位/小人/设备=对象层上的一个对象,各自挂自定义属性**(role=控制台/秘书/洞察员/supervisor-Simulaid…、owner、status=idle/busy/error、queue_depth…)。渲染端**只读这份 TMX/JSON 数据**画图,**布局与代码解耦、改布局只改数据**。这直接服务第十九/二十批「**办公室真的动起来**」与 borrowed-libs 里 claude-office/agents-in-the-office 的「**tool→工位映射 + 工位状态**」——把它落成一个**标准数据格式**。
  - **对象 + 自定义属性 = 「在网格上摆带属性的实体」的通用 schema,可复用到 Simulaid 卡桌/控制台面板** ⭐:同一套「对象 + 属性」模型也能描述 **Simulaid 卡牌在牌桌上的位置/归属/状态**(接第二十四批 CardHouse 的「卡片容器」),以及控制台「**面板/工位**」的布局。即玉兔6 多处「**空间上摆带属性的东西**」可共用一套声明式 schema。
  - **AutoMapping 规则式自动贴图 = 「画个房间轮廓,规则自动补边角」** ⭐:像素办公室铺底时,**人只画房间/工位的粗布局,AutoMapping 规则自动补墙角/地板过渡/装饰**,省掉手工逐格贴图——接 borrowed-libs 里 agents-in-the-office 的 **autotile** 兴趣,Tiled 给出成熟的规则引擎形态。
  - **开放 TMX/JSON 格式 + JS 扩展 API = 可被玉兔6 编排/控制台直接消费、可脚本导出** ⭐:**地图格式开放、有规范、可自由使用**(即便编辑器是 GPL,**数据格式不绑 GPL**),控制台/前端可直接解析 JSON 渲染;JS 扩展 API 还能写「**导出成玉兔6 控制台要的精简 JSON**」的自定义命令,把「作者用 Tiled 摆办公室 → 一键导出 → 控制台读」串成管线。
  - 边界:**编辑器本体 GPL-2.0+ → 不 vendor 进闭源**,当**外部编辑器**用;**真正搬进玉兔6 的是「数据模型(瓦片层/对象层/自定义属性)+ 开放 TMX/JSON 格式 + AutoMapping 规则思路」**,前端**用现有栈自实现读取/渲染**即可。
- 难度/优先级:低(借数据模型 + 用开放 JSON 格式,前端自实现读取)–中(若用 Tiled 当作者工具 + 写导出扩展,需搭外部工具流)。对 **像素办公室布局数据化 + 控制台/Simulaid 复用同一「对象+属性」schema**价值高。
- URL: https://github.com/mapeditor/tiled

---
注:本批轮换回**最冷的「像素素材与画风」线**(上次第二十批 06-22 ~20:0x,冷约 20 小时;二十一–二十四批 + 本 16:00 离线占位都在 网关/工具skills、队列/grounding、编排/网页、Unity 上),且**刻意换三个前几次像素批从没碰过的角度——素材的「生成 → 作者 → 编排」三段**:第九批=素材生成流水线、第二十批=文本→精灵表 + 精灵 FSM,**都没碰**「生成能否本地零成本 / 精修能否脚本化 / 一屋子素材怎么摆成带属性的场景」。三例补三段:**pixel-forge**(本地零成本扩散生成 + 统一调色板量化 + 产物签名 + JSON 工具协议;但 0★未达产,仅借设计 + watch)、**LibreSprite**(脚本化精修 + 「帧标签=运行时状态名」动画作者-运行时契约;GPL 当外部工具)、**Tiled**(瓦片层+对象层+自定义属性的声明式场景数据模型 + AutoMapping + 开放 TMX/JSON;GPL 编辑器但格式开放可自由用)。三者**只借数据模型 / 生成与治理范式 / 作者-运行时契约,不整包 vendor**。**本批不新增待办卡**(延续七–十、十二–二十四批口径;唯十一批因真漏洞破例):三例都是对**像素办公室 / Simulaid 素材管线 / 控制台布局**的**设计参考 / 范式借鉴**,**像素办公室/素材产品工作归对应主管**,洞察员只沉淀分析;是否落数据模型/管线属产品决策,不由洞察员堆成待办。**但若老板要立刻、最小、最可逆、最值博地动一步**:借 **Tiled 的「瓦片层 + 对象层 + 自定义属性」给像素办公室定一份声明式布局数据格式(TMX/JSON)**——把「哪个工位在哪、是谁、什么状态」从渲染代码里**抽成一份可读 JSON 数据**,渲染端只读数据画图,**布局与代码解耦、改布局只改数据**,且**格式开放不绑 GPL、纯前端自实现可随时回退**;一步同时拿到「**办公室布局数据化(接『办公室动起来』)**」+「**控制台/Simulaid 复用同一『对象+属性』schema**」两个收益。次选可逆一步:借 **LibreSprite 的「帧标签 = 运行时状态名」契约**,让办公室/Simulaid 的动画美术产出与状态机对齐(接第二十批 AnimatedSprite);或把 **pixel-forge 的「生成→统一调色板量化」**这一步加进现有素材管线保画风一致(与用谁的生成器解耦)。**但因像素办公室/素材归对应主管、数据模型属产品决策,洞察员只建议不堆卡。** Starlaid 全程排除。watch(本批 web_fetch 直读到实时元数据):pixel-forge `main`(Unlicense,**0★/0 forks**,~159 commits,1 release v0.6.0 / 2026-03-28,Rust 86%,Candle/Metal/CUDA/CPU,作者明示 output 未达产)、LibreSprite `master`(GPL-2.0,**7.5k★/465 forks**,5,377 commits,5 releases,最新 v1.1 / 2023-12,C++ 93%,跨平台含 Android+emscripten,有 SCRIPTING.md/JS 脚本 API)、Tiled `master`(GPL-2.0+ 编辑器、TMX/JSON 格式开放可自由用,约 **9.5k★**,作者 Thorbjørn Lindeijer,极成熟,有 JS 扩展 API)。另**挂三个下批候选 watch**:**Pyxel**(Python 复古游戏引擎,内置像素/图块/调色板编辑器 + 固定 16 色板,「本地零依赖跑像素游戏」对照 Simulaid-lite)、**Lospec Pixel Editor**(网页端开源像素编辑器 + Lospec 海量调色板库,对口「统一调色板」素材线)、**LDtk 的更新复看**(已在 repos 内,deepnight 出品的现代关卡编辑器,与 Tiled 对照「更现代的实体+字段数据模型」)。HEAD commit SHA 仍因代理 `git ls-remote` 403 未取(沿历批口径),待网络可达回填。

<!-- insight-scout-run:scout-20260623-16-pixel-assets-style-batch25 -->


<!-- insight-scout-run:cr-1782216302340-insight-scout-repos-20260623-20 -->
## 2026-06-23 · 自动洞察(20260623-20 · multi-agent-orchestration)

> 来源:洞察员; run=cr-1782216302340-insight-scout-repos-20260623-20; queue=insight-scout/insight-scout-repos-20260623-20; network=unavailable

## 多智能体编排 / 任务 DAG / 交接协议 — 借鉴扫描 slot=20260623-20

> 网络状态: unavailable（本 runner 无联网工具）。以下内容基于公开训练数据整理，所有许可证/活跃度/最新版本均需主人在有网 slot 复核后再写入 borrowed-libs.md。Starlaid/星桥 一律排除。

### 1. LangGraph — 图状态机 + 检查点持久化
- 是什么: LangChain 团队推出的有状态多智能体编排库，把流程建模为『节点(函数)+边(条件跳转)』的有向图(StateGraph)，原生支持循环、分支、人机回路、断点续跑。是当前公开项目里把『任务 DAG + 交接』抽象得最显式的一个。
- 值得借鉴:
  - StateGraph 把智能体流程显式建模为图，状态对象(TypedDict)集中管理，避免上下文散落传参——直接对应『任务 DAG』。
  - conditional_edges 实现基于状态的动态路由，对应交接协议里的『下一步去哪』。
  - Checkpointer(Memory/SQLite/Postgres)支持中断恢复，对长任务编排和『维修机制』友好。
  - interrupt_before/interrupt_after 节点 = 人机回路，可对应『交接给主人/CEO 审核』。
- 难度/优先级: 中。若只借鉴『图+状态+检查点』思想自研最小版，工作量中等；不要直接拉 LangChain 全家桶。
- 迁移边界: 与 LangChain 的 ToolCall/消息抽象耦合较深；自研需剥离。许可证: 训练数据为 MIT，必须联网核验当前 LICENSE。
- URL: https://github.com/langchain-ai/langgraph

### 2. CrewAI — 角色/目标/任务三元组 + Handoff
- 是什么: 以角色扮演为核心的多智能体协作框架。每个 Agent 有 Role/Goal/Backstory，Crew 编排一组 Agent 完成 Tasks，支持 sequential/hierarchical 两种流程拓扑，并提供 agent 间 handoff。
- 值得借鉴:
  - Role+Goal+Backstory 三元组建模，对交接协议中『对方是谁、要什么、风格如何』很自然，可直接启发交接卡字段。
  - Task 带 expected_output（预期产物描述），非常贴近『交接协议』的字段设计——交付物先约定再执行。
  - handoff 把任务连同上下文移交给另一个 agent，可作为交接协议的最小语义参考。
- 难度/优先级: 低-中。概念层借鉴成本低；流程表达不如 LangGraph 灵活（无显式条件分支/DAG）。
- 迁移边界: 默认假设 LLM 支持 function calling，工具协议偏 OpenAI；自研需抽象出 LLM 无关层。许可证: 训练数据为 MIT，必须联网核验。
- URL: https://github.com/crewAIInc/crewAI

### 3. OpenAI Swarm — 极简 Handoff 教学参考
- 是什么: OpenAI 发布的轻量级、教育性多智能体示例。核心概念只有 Agent(instructions+functions) 与 handoff 函数——一个 agent 的工具返回另一个 agent，编排器据此切换。
- 值得借鉴:
  - 极简 handoff 协议: 工具返回值即『下一个 agent』，几乎零抽象成本，适合作为自研交接协议的最小可行参考。
  - context_variables 作为共享黑板，对应交接协议中的『上下文字段』。
  - 代码量小，便于通读
## 2026-06-23 · 第二十六批(选题:多智能体编排 / 任务队列·durable execution — 三例共同的「持久执行」内核:事件溯源重放续跑 / 外部事件持久等待 / 声明式流程+引擎负责 durable;运行 ~20:0x+08:00)

> 本批把一线「任务队列引擎」与二线「多智能体编排」**收到同一根主线上——「持久执行(durable execution)」**,因为本批三例(durabletask-go / LlamaIndex Workflows / Conductor)恰好从轻到重给出同一内核的三种形态。**刻意接住、深化今天已经埋下的那张卡**:今天 04:0x 的 goqite 给了「可见性超时 + 毒丸死信」,公告板上已有 `queue-crash-recovery-orphan-reclaim`(借 DBOS:启动回收孤儿 running + claim lease/心跳 + step 幂等记忆)。那张卡解决的是「**崩了别丢、别重复**」;本批三例把同一问题再往前推一格——「**崩了从断点续、等人时持久挂起、流程声明化后引擎负责 durable**」。区别于过往编排批:第八批(06-20)讲纵向单流的确定性 + 时间旅行、第十三批讲记忆、第十八批讲横向交接 + A2A 契约、第二十三批讲安全治理外壳(护栏/中间件/声明式角色)——**都没有把「队列可靠性」和「编排执行模型」缝成一件事**。本批正是这道缝:玉兔6 的 `engine-runner.js` 把活派进 file queue(`artifacts/queues/<角色>/`),一个 run 跑到一半崩,目前最多做到「孤儿回收 + 重跑」;三例给的是「**把一次 run 的每一步落成 append-only history、重启时确定性重放、跳过已完成步、只从断点续**」这套更彻底的执行模型。三例**只借语义 / 数据形态 / 执行模型,绝不搬各自重运行时**(durabletask-go 的 Go + sidecar、Workflows 的 Python、Conductor 的重型 Java 平台一律不引),贴「单机零依赖」。**Starlaid 全程排除。**

### durabletask-go(microsoft/durabletask-go)— 轻量可嵌入的「持久执行引擎」:把编排写成普通代码,靠**事件溯源重放**做到崩溃后从断点续,外加**外部事件持久等待 + suspend/resume**(Apache-2.0,302★/62 forks,95 commits,Go 99.2%,15 tags,sqlite/内存后端 + gRPC sidecar,⚠️README 自述 WIP「勿用于生产」)
- 是什么:微软把自家在云控制面用了多年的 .NET Durable Task Framework **克隆成 Go 版**,定位是「**可嵌入的持久执行引擎**」——把一段业务流程(orchestration)写成**普通函数**,引擎替你做持久化与容错。机制核心是**事件溯源 + 确定性重放**:orchestrator 函数每调一次活动(activity)、每等一个事件,都把结果**按 append-only 的 event history 落盘**(自带 sqlite 后端,`""` 即内存);进程崩溃重启时,引擎**重放这段历史**,已完成的步骤直接拿历史结果跳过、**只从断点继续**,不重复执行。它走 **gRPC sidecar** 架构,因此任何语言(已有 .NET/Java/Python SDK)都能写持久流程。内置范式:活动顺序(sequence)、**fan-out/fan-in**(动态并行 N 个活动再汇总)、**外部事件**(`WaitForSingleEvent` 持久阻塞等具名事件 + `RaiseEvent` 投递,事件被 durably buffer、可带超时,-1 为无限)、**持久 timer**、子编排、**suspend / resume / terminate**、OpenTelemetry 分布式追踪(每个编排一个 span,活动/timer/子编排为子 span)。
- **值得借鉴(对口 队列 `artifacts/queues/` + 编排 `engine-runner.js` + §17 人审门)**:
  - **事件溯源重放「崩了从断点续」= 把已有 `queue-crash-recovery-orphan-reclaim` 卡从『回收+重跑』升级成『重放+续跑』** ⭐⭐:那张卡现在的方向是「启动回收孤儿 running + lease/心跳 + step 幂等」——解决「别丢、别重复跑同一步」。durabletask-go 给出更彻底的下一格:**把一次 run 的每一步(调了哪个工具/子 agent、产出什么)落成 append-only history,重启时确定性重放、跳过已完成步、只从断点续**。玉兔6 的 file queue 完全可以借这个形态——给每个 run 配一份 `history.jsonl`(唯一事实源),恢复=重放而非重跑。**这是对已有卡的深化,不另开卡。**
  - **`WaitForSingleEvent` / `RaiseEvent`(持久缓冲的外部事件)= 玉兔6 人审门「挂起等人」缺的执行底座** ⭐⭐:§17 人审门现在是「危险动作→挂起等人」(接第十七批 Trigger waitpoint、第十八批 A2A `interrupted`)。durabletask-go 把这件事做成执行原语:一个 run 可**持久阻塞**等一个具名外部事件(人审批 / 操作员指令),事件 durably buffer、带超时;人一回事件就**精确续跑**。借它把人审门从「挂起态标记」落成「持久等待一个 `approval` 事件」的执行底座。
  - **suspend/resume/terminate + 持久 timer = 控制台对在跑 run 缺的一组标准操作原语** ⭐:玉兔6 控制台能看 eventlog,但对一个**在跑的 run** 缺「暂停 / 恢复 / 终止 / 定时唤醒」这组标准动作。借这组语义给控制台「运行态操作」。
  - **fan-out/fan-in 标准算子**:接 concurrency-smoke,给「一次派 N 个子任务、全回来再汇总」一个标准形态。
- 边界:**Go 运行时 + sidecar 架构 + README 明示 WIP「勿用于生产」**;玉兔6 **不引其运行时、不搬码**,只借**「event-sourced 重放=恢复」「外部事件持久等待」「suspend/resume 控制原语」三个语义/数据形态**,落到现有 file queue + engine-runner + 人审门。Apache-2.0 商用友好、Go 代码可放心读借设计。
- 难度/优先级:中(借重放/续跑语义**深化已有崩溃恢复卡**;纯形态、不引 Go)。对**队列可靠性 + 人审门执行底座**价值高。
- URL: https://github.com/microsoft/durabletask-go

### LlamaIndex Workflows(run-llama/workflows-py)— 把编排建成「事件↔步骤」的事件驱动、async-first 框架,杀手锏是**轻量 + Context 状态可序列化/可 resume + 开箱可观测**(MIT,332★/58 forks,450 commits,125 releases,latest llama-agents-server@v0.3.2 / 2026-04-02,Python 99.9%,TS 双生 workflows-ts,自带 AGENTS.md+CLAUDE.md)
- 是什么:LlamaIndex 把「Workflows」从 llama_index 主库**抽成独立轻量包**(`pip install llama-index-workflows`)。编排模型只有两个原语:**步骤(step)= 一个 async 函数,从 asyncio 队列消费事件、再向其它队列发事件**;**事件(event)= 步骤之间传的消息**(`StartEvent` 开场、`StopEvent` 收场,中间事件用户自定义)。`Context` 对象在步骤间共享状态,且**可把一次 run 的状态序列化落盘、之后 resume**(README 示例:同一个 Context 复跑会保留 `num_runs` 状态)。**async-first**(贴 FastAPI/Notebook)、**事件驱动**(天然支持并行/分支/循环/回路)、**开箱可观测**(自动 instrument OpenTelemetry,直连 Arize Phoenix / Langfuse)。125 个 release 的高频迭代 + TS 双生(workflows-ts)。
- **值得借鉴(对口 编排 `engine-runner.js` 派活模型 + taskstore 中间态)**:
  - **「事件即边、步骤即点」的编排原语 = 玉兔6 把『秘书→总管→员工』的隐式调用链显式成可组合拓扑** ⭐⭐:玉兔6 现在的派活更像隐式调用链(谁调谁写在码里)。Workflows 把编排建成「**事件触发步骤、步骤再发事件**」的图——**并行/分支/循环/回路天然支持**,且每个步骤是小而可单测的 async fn。借这套形态把玉兔6 的派活链显式化、可组合、可针对单步写测试(接 serial-smoke/concurrency-smoke 的可测诉求)。
  - **Context 状态可序列化 + resume = durabletask-go 那套的『更轻量等价物』,落 taskstore 中间态续跑** ⭐⭐:上一例 durabletask-go 是「重型 event history 重放」,Workflows 给一个**更轻**的等价:`Context` 携带 run 内共享状态、可 serialize 落盘、之后 resume。玉兔6 taskstore 可借此把一次 run 的中间态(已问到什么 / 已产出什么 / 进行到哪步)结构化存盘,支持「同 Context 续跑」——**比起改 file queue 重放,这是更小步、更易落地的第一版「续跑」**。
  - **编排框架自带可观测(OTel/Phoenix/Langfuse 开箱)= 「编排即埋点」** ⭐:接第十八批 Langfuse,再次印证「编排层应自带 trace」;玉兔6 eventlog 可对齐 OTel 语义,使每一步默认可观测。
  - **自带 AGENTS.md+CLAUDE.md + TS 双生**:若玉兔6 编排/控制台走 TS,可直读 workflows-ts 实现。
- 边界:Python(TS 有双生 workflows-ts);玉兔6 **只借「事件↔步骤编排原语」「Context 序列化/resume」「编排自带可观测」三个范式**,不引 Python 栈与 llama_index 重依赖。MIT 商用友好。
- 难度/优先级:中(借事件驱动编排范式 + Context 续跑;纯范式)。对**编排可组合性/可测性 + 中间态续跑**价值高,且**是本批最易先落的一步**。
- URL: https://github.com/run-llama/workflows-py

### Conductor(conductor-oss/conductor)— 事件驱动的「agentic workflow + 持久执行」平台,杀手锏是**声明式 JSON 流程 + 完整可重放 + 可暂停数月再精确续跑 + 在跑流程的运营 UI**(Apache-2.0,~32k★,7 语言 SDK,原生 14+ LLM provider task 类型 + 内建 MCP,Netflix 出身,Netflix/Tesla/LinkedIn/JPMorgan 在用)
- 是什么:Conductor(Netflix 开源、现 conductor-oss 社区维护)是把「持久执行」做成**完整平台**的那一极:工作流**声明式定义(JSON)**,执行**完全持久化**——一条 workflow 可**暂停数月**等人审批 / 外部信号 / 定时器,再**精确从断点续跑**;**完整可重放**;原生支持 **14+ LLM provider 的 task 类型 + 内建 MCP 集成**;**7 种语言 SDK**;自带**运营 UI**(可视化在跑流程、监控、从界面重试/重放某步)。在 Netflix/Tesla/LinkedIn/JPMorgan 大规模实战。
- **值得借鉴(对口 控制台运营视图 + 编排声明化 + 队列 durable)**:
  - **声明式 JSON 流程 + 引擎负责 durable 执行 = 玉兔6 把『流程定义』与『执行引擎』解耦的成熟分界** ⭐⭐:玉兔6 编排逻辑偏码内。Conductor 把「流程长什么样」写成**声明式 JSON**(与第二十三批 MAF 的 YAML 声明式角色同向),**执行引擎专管持久化/重放/续跑**。借这条分界——**流程可 diff / 可回滚 / 可被控制台可视化**,引擎那侧才是 durable 的归属。
  - **在跑流程的运营 UI(DAG 可视化 + 监控 + 从 UI 重试/重放)= 玉兔6 控制台缺的『运营态』视图** ⭐⭐:已借 Mission Control/Tabler 是**运行态看板**、第二十三批 MAF DevUI 是**调试态**;Conductor 多给**运营态**——把一条在跑 run 画成 **DAG**、哪一步卡住一眼可见、可**从界面重试/重放**某步。借其形态给控制台加「在跑 run 的 DAG 视图 + 一键重试/重放卡住的那一环」,正补现在「只能看 eventlog 文本」的缺口。
  - **暂停数月再续(人审 / 外部信号 / 定时器三类挂起)= 再次佐证人审门要有持久挂起底座** ⭐:与本批 durabletask-go 的外部事件同向,三方共识「**长时挂起等人/等信号/等定时**」是编排刚需,而非边角。
- 边界:Conductor 是**重型 Java 平台**(需部署服务 + 存储后端),玉兔6 **绝不搬这套重栈**;只借**「声明式流程 + 引擎负责 durable」分界、「在跑 run 的 DAG 运营视图 + UI 重试/重放」形态、「三类持久挂起」佐证**。Apache-2.0,文档/设计可放心读借。
- 难度/优先级:低–中(只借设计范式与 UI 形态,**不部署平台**)。对**编排声明化 + 控制台运营视图**价值中–高。
- URL: https://github.com/conductor-oss/conductor

---
注:本批把「任务队列」与「多智能体编排」缝成同一根主线**「持久执行(durable execution)」**,三例从轻到重给同一内核三形态:Workflows(最轻,Context 序列化/resume)→ durabletask-go(中,event-sourced 重放续跑 + 外部事件持久等待)→ Conductor(最重,声明式 + 平台级 durable + 运营 UI)。**本批不新增待办卡**(延续七–十、十二–二十六批口径,唯十一批因真漏洞破例):三例**最值钱的行动项——「队列崩溃恢复 / 续跑」——公告板已有 `queue-crash-recovery-orphan-reclaim` 卡覆盖**(借 DBOS),本批是对那张卡的**深化与方向佐证**(从「孤儿回收 + 重跑」推进到「event history 重放 + 断点续跑」、并补「人审门用持久外部事件等待」),不重复开卡;声明式流程 / 控制台 DAG 运营视图 / 编排事件驱动重构均属产品/主管决策,不由洞察员堆成待办。**若老板要立刻、最小、最可逆地动一步**:按 **LlamaIndex Workflows 的 `Context` 序列化/resume**,先给玉兔6 taskstore 加「一次 run 的中间态结构化存盘 + 同 Context 续跑」——这是三例里**最小步、不改 file queue 底层、就能拿到第一版『崩了能续』**的切口,拿到经验后再按 durabletask-go 的 event-history 重放做彻底版,正好喂进已有的 `queue-crash-recovery-orphan-reclaim` 卡。**Starlaid 全程排除。** watch(本批 web_fetch 直读实时元数据):microsoft/durabletask-go `main`(Apache-2.0,302★/62 forks,95 commits,Go 99.2%,15 tags,sqlite+gRPC sidecar,WIP 勿用于生产)、run-llama/workflows-py `main`(MIT,332★/58 forks,450 commits,125 releases,latest llama-agents-server@v0.3.2 / 2026-04-02,Python 99.9%,TS 双生 workflows-ts)、conductor-oss/conductor `main`(Apache-2.0,~32k★,7 语言 SDK,14+ LLM provider task + 内建 MCP,Netflix 出身)。另**挂三个下批候选 watch**:**temporalio/temporal**(持久执行的事实标杆,可对照 durabletask-go 看「重放/确定性约束」的工业级形态)、**dbos-inc/dbos-transact-py**(已在 `queue-crash-recovery` 卡里借过,值得复看上游有无新「轻量持久执行」特性)、**run-llama/workflows-ts**(若玉兔6 走 TS,可直读 TS 实现 Context 续跑)。HEAD commit SHA 仍因代理 `git ls-remote` 403 未取,待网络可达回填。


<!-- insight-scout-run:cr-1782230457008-insight-scout-repos-20260624-00 -->
## 2026-06-23 · 自动洞察(20260624-00 · queue-engine)

> 来源:洞察员; run=cr-1782230457008-insight-scout-repos-20260624-00; queue=insight-scout/insight-scout-repos-20260624-00; network=unavailable

## 任务队列引擎:调度可靠性与失败处置复看(slot=20260624-00)\n\n> network_status=unavailable:本轮无联网能力,以下为基于公开知识的复看与整理建议,未验证实时 star/commit/release;CEO/主管采纳前需人工复核许可证与活跃度。\n\n### temporalio/temporal\n- 是什么:durable workflow 引擎,把重试、补偿、超时、状态恢复内建到编程模型。\n- 值得借鉴:Activity 级自动重试 + 指数退避;workflow replay 用于故障后状态恢复;可观测性与幂等约定清晰。\n- 迁移边界/许可证不确定项:协议(MIT/Apache 系)与最新 release 需人工核;运维依赖较重,控制台宜只借鉴重试/幂等语义而非整体接入。\n- URL: https://github.com/temporalio/temporal\n\n### celery/celery\n- 是什么:Python 生态成熟的分布式任务队列,生产案例与失败处置文档丰富。\n- 值得借鉴:重试策略(次数/退避/上限)、死信队列、任务级幂等键约定、结果后端可插拔。\n- 迁移边界/许可证不确定项:BSD 协议待核;控制台若非 Python 栈,只迁移语义与状态机,不引入运行时依赖。\n- URL: https://github.com/celery/celery\n\n### taskforcesh/bullmq\n- 是什么:Node/TS 生态基于 Redis 的高性能队列,失败处理与限流 API 设计现代。\n- 值得借鉴:stalled job 检测、failed→retry 状态机、rate limiter、优先级与并发控制一体。\n- 迁移边界/许可证不确定项:MIT 待核;引入 Redis 依赖需与控制台现有存储栈做一致性评估。\n- URL: https://github.com/taskforcesh/bullmq\n\n### 给控制台的最小可借鉴清单(分析非待办)\n- 统一任务状态机:pending/active/completed/failed/dead,显式区分 retry 与 dead-letter。\n- 重试策略参数化:max_attempts、指数退避 + 抖动、per-task 超时。\n- 幂等键约定:同一任务键多次入队只执行一次,失败重试不产生副作用。\n- stalled/孤儿任务检测:worker 心跳超时回收,避免静默丢失。\n- 可观测性:每个任务记录入队/开始/结束/失败原因,便于审计与告警。
## 2026-06-24 · 第二十七批(选题:AI agent 工具与 skills + 优秀网页设计 — 三例:Agent 平台「build/run/manage 三层 + 无状态控制面」/ 官方 Agent Skills 规范与渐进披露 / shadcn 现代控制台模板;运行 ~00:0x+08:00,网络已恢复)

> 说明:本批为联网正常的内容批,接在 20260624-00「queue-engine 复看(网络不可用)」之后。本节是给老板/CEO 看的「值得借鉴」分析,非待办;仅就 insights.md 自身膨胀这一条加 1 张 todo 卡(见末)。Starlaid 全程排除。

### 1. agno-agi/agno — 「Build / Run / Manage」三层 Agent 平台 + 无状态控制面(Control Plane)
- 名称/URL:agno-agi/agno — https://github.com/agno-agi/agno
- 核验事实:Apache-2.0,40.8k★ / 5.5k forks / 5,709 commits,Python 99.7%,latest v2.6.17(2026-06-17),200 releases;仓库自带 AGENTS.md + CLAUDE.md。
- 它优秀在哪:把「Agent 平台」干净拆成三层 —— ① SDK(用任意框架 build agent)② AgentOS 运行时(run 成生产服务:50+ REST/SSE/WS 端点、cron 调度 + 后台任务、OpenTelemetry tracing、JWT-RBAC 多租户)③ 单一控制面 UI(manage)。控制面是 **stateless client**:会话/记忆/知识/trace 全留在用户自己的 DB,Agno 服务器不存数据也不存密钥。还内建 **Human approval**(运行中暂停等人确认、对需管理员审批的工具做阻断)与 Trace Viewer(每个 run 的 model 请求 + tool call 明细)。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - 控制台 ← 借鉴「**stateless UI + 数据留本地 DB/JSON**」架构:玉兔6 控制台保持只读本地 board/ 与 cards.json、绝不外传会话与密钥(与红线一致),可把这条固化进控制台设计约束。
  - 编排/引擎 ← 借鉴 **Human approval 的 pause-gate**:把「写操作 / 高风险工具」做成「暂停→等人确认」的闸门,正好对应洞察员「只有明确值得立刻做才加待办卡」的克制原则,可推广到所有自动任务的写动作。
  - 可观测性 ← 借鉴 **Trace Viewer**:给每次自动运行落一份 run trace(入队/工具调用/结束/失败原因),便于 CEO 审计;与队列引擎已有的事件日志可合并。
- 难度:中(整体接入重,但「无状态 UI + 本地数据 + pause-gate + run trace」可单点借鉴,无需引入 Agno 运行时)。优先级:中-高。

### 2. anthropics/skills — 官方 Agent Skills 规范 + 渐进披露(progressive disclosure)
- 名称/URL:anthropics/skills — https://github.com/anthropics/skills
- 核验事实:149k★ / 17.6k forks / 41 commits;多数示例 skill 为 Apache-2.0,文档类(docx/pdf/pptx/xlsx)为 source-available(非 OSS);含 skills/(示例)、spec/(Agent Skills 规范)、template/(模板)、.claude-plugin(可注册为 Claude Code Plugin marketplace)。
- 它优秀在哪:把「skill」标准化为「**自包含文件夹 + 一个 SKILL.md(YAML frontmatter 仅需 name + description)**」,并用 **渐进披露**控制上下文成本 —— 先只看 frontmatter 的 name/description,命中才读 SKILL.md 正文,再按需读 references/(长文档)、scripts/(可执行脚本)、assets/(模板)。一份 spec + 一个 template 让新技能一键起步。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - skills 系统 ← 玉兔6 本就用 SKILL.md(洞察员任务自身即一个 SKILL.md)。可照 **spec/ 规范**统一所有自动任务的 frontmatter 字段(name/description/触发条件),并加一个 **template/** 让「新洞察类任务」一键起步、减少漂移。
  - 运行成本 ← 借鉴 **渐进披露**:把每个任务拆成「SKILL.md 主指令 + references/(去重库/历史按需读)+ scripts/ + assets/」。对洞察员尤其关键 —— 现在 insights.md 已约 309KB、每批再 +~18KB,且每次都把巨大历史拉进上下文;改成「热数据(近 N 节)直读、冷历史进 references/ 按需读」,每次运行直接省 token。**这是本批唯一加 todo 卡的点**(见末)。
  - 复用/版本化 ← 可把玉兔6 技能集按 **.claude-plugin** 形式打包成内部 marketplace,便于版本化与跨会话复用。
- 难度:低-中(规范/模板/渐进披露是文档结构调整,零新依赖)。优先级:高(直接降本,且与现有架构同源)。

### 3. satnaing/shadcn-admin — 现代控制台模板(Vite + shadcn + TanStack Router)
- 名称/URL:satnaing/shadcn-admin — https://github.com/satnaing/shadcn-admin
- 核验事实:MIT;Shadcn UI + Vite + TanStack Router 的 SPA(非 Next.js,轻量);10+ 预制页、可折叠侧边栏、全局命令面板(Cmd+K)、明暗主题、RTL、WAI-ARIA 无障碍。
- 它优秀在哪:开箱即用的「admin 控制台骨架」—— 布局(可折叠侧栏 + 顶栏 + 内容区)、Cmd+K 全局命令搜索、主题切换、无障碍组件齐全,且纯前端 SPA、MIT 可商用。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - 控制台 UI ← 直接取其 **布局骨架 + Cmd+K 命令面板**:玉兔6 控制台加 Cmd+K 快速跳转到 board/insights、cards、各任务/项目(玉兔6 已 seen 过 kbar 命令面板库,可二者结合:shadcn-admin 出壳、kbar 出交互)。
  - 主题/无障碍 ← 直接采用其 **明暗主题切换 + WAI-ARIA 组件**,省自研。
  - 架构契合 ← 纯前端 SPA、无服务端组件、数据可只读本地 JSON,与玉兔6「数据不出本地」一致,适合做本地控制台前端。
- 难度:低(MIT 模板,直接取布局/组件)。优先级:中(UI 提升,非核心逻辑)。

### 本批小结(给 CEO 的一句话借鉴)
- agno:学它「无状态控制面 + 数据留本地 + 运行中 pause 等人确认」,强化玉兔6 控制台与写操作闸门。
- anthropics/skills:学它「渐进披露」,把洞察员的冷历史挪进 references/ 按需读,**立刻降低每次运行的 token 成本**(已加 todo 卡)。
- shadcn-admin:学它「控制台骨架 + Cmd+K 命令面板」,低成本升级玉兔6 控制台 UI。


<!-- insight-scout-run:cr-1782244812812-insight-scout-repos-20260624-04 -->
## 2026-06-23 · 自动洞察(20260624-04 · agent-tools-skills)

> 来源:洞察员; run=cr-1782244812812-insight-scout-repos-20260624-04; queue=insight-scout/insight-scout-repos-20260624-04; network=unavailable

## AI agent 工具/能力库治理借鉴扫描(slot=20260624-04)\n\n> network_status=unavailable:本 runner 无联网/文件读取能力,以下基于公开既有知识整理,未读取实时 star/commit/release,数字型活跃度留空。seen-repos.json/borrowed-libs.md 未实际比对,落地时由引擎补充去重。\n\n### microsoft/semantic-kernel\n- 是什么:微软开源 SDK,以 plugin/skill 抽象封装可被 LLM 调用函数,带参数 schema 与注册机制。\n- 值得借鉴:语义函数 vs 原生函数二分,以及 plugin 跨语言栈复用思路。\n- 迁移边界/许可证:MIT;认知负载偏高,需裁剪;未读取实时数据。\n- URL: https://github.com/microsoft/semantic-kernel\n\n### langchain-ai/langchain\n- 是什么:LLM 应用框架,Tools/Toolkit/agent_executor 已是行业事实标准之一。\n- 值得借鉴:Toolkit 把相关工具按场景打包的组织方式,适合控制台按域分组能力。\n- 迁移边界/许可证:MIT;版本迭代快、breaking change 频繁,只借抽象不直接依赖。\n- URL: https://github.com/langchain-ai/langchain\n\n### crewAIInc/crewAI\n- 是什么:多 agent 协作框架,tools 以装饰器注册,内置轻量 ToolsManager。\n- 值得借鉴:工具注册与 agent 角色绑定的耦合方式,治理成本低、上手快。\n- 迁移边界/许可证:MIT;抽象粒度粗,生产场景需补 schema 校验与调用权限。\n- URL: https://github.com/crewAIInc/crewAI\n\n### 小结\n- 三者共性:都需解决「能力注册 + 参数 schema + 调用权限」三件套。\n- 控制台可借鉴方向:统一 plugin 描述格式(JSON Schema),Toolkit 按域分组,避免能力一锅烩。\n- 本轮仅分析,未生成公告板卡;是否采纳由 CEO 评估。
## 2026-06-24 · 第二十八批(选题:GUI grounding + LLM 网关 — 三例:跨平台 GUI agent 基座「感知-grounding-端到端操作」+ 多智能体框架(Manager/Worker/Reflector/Notetaker)与「先批判后执行」/ 端侧 GUI agent 的「紧凑动作空间 + 强制 JSON Schema + 任务级 STATUS 词表」/ Envoy 团队的「AI 原生代理数据面」(智能路由 + 护栏 + 零代码可观测);运行 ~04:0x+08:00,网络已恢复)

> 说明:本批为联网正常的内容批,接在 20260624-04「agent-tools-skills 复看(网络不可用)」之后,**轮换到距上次联网批最久的两题:GUI grounding(上次第二十二批 06-22)+ LLM 网关(上次第二十一批 06-23)**,避开第二十六/二十七批的编排·队列/skills·网页设计。本节是给老板/CEO 看的「值得借鉴」分析,**非待办**;本批**不新增待办卡**(理由见末)。GUI grounding 三题不是要玉兔6 去训视觉模型,而是借其**架构形态**(多智能体角色分工 / 先批判后执行 / 紧凑动作 Schema / 任务级状态词表)对口到 控制台·编排·队列·人审门·可观测。**Starlaid 全程排除。**

### 1. X-PLUG/MobileAgent(GUI-Owl 1.5 + Mobile-Agent-v3/v3.5)— 阿里通义出品的「GUI agent 家族」:一个跨平台 GUI 基座模型(感知/grounding/端到端操作)外挂一个多智能体框架(Manager/Worker/Reflector/Notetaker),还单独开源了「先批判后执行」的 GUI-Critic
- 名称/URL:X-PLUG/MobileAgent(by Tongyi Lab, Alibaba)— https://github.com/X-PLUG/MobileAgent
- 核验事实(本批 web_fetch 直读):**MIT**,**8.9k★ / 890 forks / 417 commits / 187 issues**;Python 62.4%(+ HTML/JS/Kotlin,含安卓端 App 与 web demo)。家族子项目齐全:GUI-Owl(基座 VLM)、Mobile-Agent-v3、**Mobile-Agent-v3.5**(2026,最新)、PC-Agent、Mobile-Agent-E、UI-S1、**GUI-Critic-R1**、ToolCUA。近半年高频更新:`GUI-Owl-1.5`(2026.2,2B/4B/8B/32B/235B,Instruct & Thinking,基于 **Qwen3-VL**,desktop/mobile/browser,**20+ GUI benchmark SOTA**,带 grounding + tool/MCP 调用 + 长程记忆)、v3.5 上无影云手机(2026.3)、**ToolCUA**(2026.5,端到端 CUA 的「GUI-工具」路径编排)。
- 它优秀在哪:把「GUI agent」拆成**两层**——① **基座模型 GUI-Owl**:一个 VLM 同时具备屏幕感知、视觉 grounding(指哪点哪)、端到端操作;② **多智能体框架 Mobile-Agent-v3**:在基座之上实例化出**四个专职角色**——**Manager(规划)/ Worker(执行)/ Reflector(反思纠错)/ Notetaker(跨步记忆)**,外加显式的 progress management(进度管理)。更难得的是单独开源了 **GUI-Critic-R1(NeurIPS 2025)——「pre-operative error diagnosis(操作前错误诊断)」**:在真正点下去之前,先用一个 critic 判断「这一步大概率对不对/会不会闯祸」,即「Look Before You Leap(三思而后行)」。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **编排 ← 借它的 Manager/Worker/Reflector/Notetaker 四角色,补齐玉兔6 派活链里缺的「反思」与「笔记」两位** ⭐⭐:玉兔6 现在是「秘书→总管→员工」的派活链(规划+执行),Mobile-Agent-v3 多出两个常被忽略但很关键的角色——**Reflector(每步后反思:刚才那步成没成、要不要重试/换法)** 和 **Notetaker(把跨步要记住的中间结论落成笔记)**。可把这两者作为编排里的**可选切面步骤**接到 engine-runner:Worker 产出后过一遍 Reflector 再决定下一步,Notetaker 把「已问到/已产出」结构化进 taskstore(正好接第二十六批想做的「中间态续跑」)。
  - **人审门 / 写操作护栏 ← 借 GUI-Critic-R1 的「先批判后执行」做成『写操作的预检 critic』** ⭐⭐:这是本案例对玉兔6 最对口的一点。§17 人审门现在偏「危险动作→挂起等人」(被动闸门);GUI-Critic 给的是**主动预检**——在执行**写/高风险动作前**,先让一个轻量 critic 判「这步像不像错的/越界的」,**只有可疑才升级到人审**,正常的放行。借它把人审门从「凡写必停」升级成「**critic 预筛 + 仅可疑才停**」,既保安全又少打扰主人(与洞察员自身『只有明确值得才加卡』的克制同构)。
  - **编排/队列 ← 借「progress management + 显式进度」**:每个 run 维护显式进度(已完成到第几步/还差什么),控制台可直接渲染,接第二十六批 Conductor 的「在跑 run 运营视图」诉求。
  - **(选)计算机使用能力 ← GUI-Owl 的 grounding/动作语义**:若玉兔6 后续要做桌面/浏览器自动化(承接第十七/二十二批 GUI grounding 线),GUI-Owl 是 MIT、可商用、可本地部署(7B/8B 量级)的现成基座候选,且原生支持 tool/MCP 调用与坐标 grounding。
- 边界:基座是大 VLM(算力门槛,7B 起;235B 仅云端),玉兔6 **不自训、不强行本地跑大模型**;**真正要搬的是「四角色分工 + 先批判后执行 + 进度管理」这三套编排/治理形态**,落到现有 engine-runner + 人审门 + taskstore。MIT 商用与改写都友好。
- 难度:中(角色切面 + 预检 critic 属编排/治理改造,非引模型)。优先级:**高**(Reflector/Notetaker 补编排短板、Critic 升级人审门,均直击玉兔6 当前痛点)。

### 2. OpenBMB/AgentCPM-GUI — 端侧 GUI agent 的「省 token 工程范式」:紧凑动作空间(单条动作均 9.7 token)+ 强制 JSON Schema 约束 + 一套任务级 STATUS 词表,外加 RFT「想好再动」
- 名称/URL:OpenBMB/AgentCPM-GUI(THUNLP/清华 + 人大 + 面壁)— https://github.com/OpenBMB/AgentCPM-GUI
- 核验事实(本批 web_fetch 直读):**Apache-2.0**,**1.4k★ / 132 forks / 55 commits**;Python 99%;基于 MiniCPM-V 的 8B 端侧模型;技术报告 arXiv 2506.01391(EMNLP 2025 Demo)。grounding 基准均分 71.3,显著高于 Qwen2.5-VL-7B(56.4)、UI-TARS-7B(41.6)等;首个面向**中文 App**(高德/大众点评/B 站/小红书等 30+)精调的开源 GUI agent。
- 它优秀在哪:它的亮点不在模型多大,而在**「让 agent 的输出又小又规整」的工程范式**:① **紧凑动作空间**——把所有动作压成一条 compact JSON,**平均仅 9.7 token/动作**,显著省上下文/推理成本;② **强制 Schema 约束**——输出必须符合给定 JSON Schema(Click/LongPress/Swipe/Press/Type/Wait 六个原语 + 可选 `duration`/`thought`);③ **任务级 STATUS 词表**——一套标准枚举 `start / continue / finish / satisfied / impossible / interrupt / need_feedback` 表达「这一步在任务全局里处于什么状态」;④ **RFT 让模型「想好再动」**——`thought` 字段可一键设为 required/optional(贵的步骤开思考、便宜的步骤关思考省 token)。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **交接协议 / 动作表示 ← 借「紧凑 JSON + 强制 Schema」给玉兔6 的 agent 动作/交接卡瘦身并加校验** ⭐⭐:玉兔6 的交接卡/动作描述偏自然语言、字段松散。借 AgentCPM 的形态——**把高频动作定义成一组带 JSON Schema 的紧凑原语**,输出即校验(接第二十一批 baml/instructor 的「结构化输出契约 + 校验-重试」),**既降 token 又能在引擎侧机器校验/拒绝非法动作**。
  - **队列 / 人审门 ← 直接采用它的 STATUS 词表作为玉兔6 run 的标准状态语义** ⭐⭐:这套 `finish/impossible/interrupt/need_feedback` 几乎是为玉兔6 量身的——`impossible`→进死信队列(接第二十二批毒丸死信)、`need_feedback`→触发人审门挂起、`interrupt`→可暂停、`continue`→续跑。**借它把玉兔6 队列/编排里散落的状态收敛成一套统一枚举**,控制台据此一眼看清每个 run 卡在哪类状态。
  - **运行成本 ← 借「thought 字段可 required/optional 开关」做按步控本** ⭐:玉兔6 可把「是否输出推理过程」做成**按步可切**——关键/写操作步开 thought(留痕可审),廉价只读步关 thought 省 token。与第二十七批 anthropics/skills 的渐进披露同向(都是「该省则省」)。
- 边界:模型本体是中文 Android 端侧场景,玉兔6 **不引模型**;**要搬的是「紧凑动作 Schema + STATUS 状态词表 + thought 开关」这套数据形态/工程范式**,与现有结构化输出、队列状态机、taskstore 直接对接。Apache-2.0,放心读借。
- 难度:低-中(纯数据形态/Schema 约定,零新依赖)。优先级:**中-高**(STATUS 词表与紧凑 Schema 可立刻收敛玉兔6 现有状态/动作表达)。

### 3. katanemo/plano(原 archgw / Arch,⚠️本批发现已改名)— Envoy proxy 原班人马做的「AI 原生代理 + 数据面」:把智能 LLM 路由 / 护栏 / 零代码可观测 / 统一多家 provider 接入做成一个进程
- 名称/URL:katanemo/plano(**原 `katanemo/archgw`,本批访问 archgw 已 301 跳转到 plano,等于改名 + 扩域**)— https://github.com/katanemo/plano
- 核验事实(本批 web_fetch 直读):**6.6k★ / 431 forks / 102 issues / 41 PRs**;**最新 release 0.4.25(2026-06-15)**,4–6 月连续高频发版(很活跃);Rust 实现(proxy-wasm),CLI `planoai up` / `planoai obs`;由 **Envoy proxy 贡献者**打造。定位:**「AI-native proxy and data plane for agentic apps」——内建编排、安全(护栏)、可观测、智能 LLM 路由**。近月 PR 可见:`plano-orchestrator` 取代旧 `arch-router` 做路由、`planoai obs` 实时 LLM 可观测 TUI、Prometheus 指标 + Grafana 看板、**model affinity(agentic loop 内模型一致性)**、Redis 会话缓存、新增一大批 provider(OpenAI/Anthropic/OpenRouter/Vercel AI Gateway/Perplexity/Kimi/DigitalOcean/小米/Astraflow)。许可证:历史/承训知识为 Apache-2.0,**落地前以仓库当前 LICENSE 为准**。
- 它优秀在哪:不同于玉兔6 已 seen 的纯网关(litellm/bifrost/portkey/helicone),Plano 把自己定位成**「agentic 应用的数据面」**——**路由 + 护栏 + 可观测三件事缝在一个代理里**,且专门为「多步 agent 循环」做了两个细节:**① 智能路由**(理解请求→选对模型/provider,带一套「Signals」路由分类法、声明式 `routing_preferences` 配置)、**② model affinity**(一个 agentic loop 内**粘住同一个模型**,避免多步之间模型来回跳导致风格/能力漂移),外加**零代码可观测**(不改业务码就有 trace/指标 + 现成 Grafana 看板 + 实时 TUI)。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **编排派单 ← 借「智能路由 + 声明式 routing_preferences」给玉兔6 的派活加一层『按请求选对 模型/员工』** ⭐⭐:玉兔6 派活更像固定调用链。借 Plano 的形态——**在派单前加一个轻量路由判定**(这活该走哪个模型/哪个员工角色),且把路由策略写成**声明式配置**(可 diff/可回滚,接第二十六批声明式流程、第十六批成本-质量路由)。
  - **可观测 ← 借「零代码可观测 + 实时 TUI + 指标看板」升级控制台** ⭐⭐:玉兔6 控制台现在偏「读 eventlog 文本」。借 Plano 的形态把可观测做成**默认横切**——每次模型/agent 调用自动落 trace + 延迟/错误指标,控制台加一个**实时运行态视图**(对应它的 `planoai obs` TUI)。和第二十六/二十七批(编排自带 trace、agno Trace Viewer)三方共识:**可观测应是数据面默认能力,而非事后补**。
  - **编排 ← 借「model affinity:一个 run/loop 内粘住同一执行体」** ⭐:玉兔6 一个 run 里若中途换模型/员工易丢上下文与风格。借它「**同一 run 默认粘同一 worker/模型,除非显式升级**」+ 会话缓存,提升多步一致性。
  - **写操作护栏 ← 借「护栏作为数据面统一切面」**:把安全/护栏放在「派单数据面」一处,而非散落各处(接第二十七批 agno pause-gate)。
- 边界:Plano 是 **Envoy 系 Rust 重型代理**(要跑一个代理进程 + 可能依赖 Redis),玉兔6 **绝不搬这套运行时**(红线:单机零依赖);只借**「路由+护栏+可观测缝成一个数据面」的分界、声明式路由配置、model affinity、零代码可观测**这几个**语义/形态**。
- 难度:低-中(只借设计形态与配置范式,不部署代理)。优先级:**中**(智能路由/可观测对编排与控制台有价值,但属较大改造,宜 CEO 决策后分步走)。
- 附:**去重库卫生提示**——archgw 已改名 plano,后续 watch 以 `katanemo/plano` 为准;本批已把 plano 记入 seen-repos,旧名 archgw 一并标注避免重复推荐。

### 本批小结(给 CEO 的一句话借鉴)
- **X-PLUG/MobileAgent(GUI-Owl + Mobile-Agent-v3)**:学它「**Reflector/Notetaker 两个补位角色 + GUI-Critic 先批判后执行**」,给玉兔6 编排补反思/记忆、把人审门升级成「critic 预筛 + 仅可疑才停」。
- **OpenBMB/AgentCPM-GUI**:学它「**紧凑 JSON 动作 Schema + STATUS 状态词表(finish/impossible/need_feedback…)+ thought 可开关**」,立刻收敛玉兔6 的动作/交接表达与队列状态、并按步控 token。
- **katanemo/plano(原 archgw)**:学它「**路由+护栏+零代码可观测缝成一个数据面 + model affinity**」,给玉兔6 派单加智能路由、给控制台加实时可观测;但只借形态、不搬 Rust 重代理。
- **本批不新增待办卡**(延续七–十、十二–二十六批的克制口径;唯十一批因真漏洞、二十七批因 insights.md 真实膨胀破例)。理由:本批三例最值钱的行动项——**「人审门 critic 预检」「STATUS 状态词表统一」「编排智能路由」**——均属**产品/主管的架构决策**,不该由洞察员径自堆成待办;且部分(结构化输出校验、队列状态机、可观测)与已有卡/已有能力同源。**若 CEO 想立刻、最小、最可逆地动一步**:先采纳 **AgentCPM-GUI 的 STATUS 词表**——把玉兔6 队列/编排里散落的运行状态收敛成一套统一枚举(`finish/impossible/interrupt/need_feedback/continue` 直接映射到 完成/死信/暂停/人审/续跑),零依赖、纯约定、改完即用,是三例里落地面积最小、收益最直接的切口。**Starlaid 全程排除。**

> watch(本批 web_fetch 直读实时元数据):X-PLUG/MobileAgent `main`(MIT,8.9k★/890 forks/417 commits,GUI-Owl-1.5 基于 Qwen3-VL、2026.2 发布,v3.5 2026.3,ToolCUA 2026.5,活跃)、OpenBMB/AgentCPM-GUI `main`(Apache-2.0,1.4k★/132 forks/55 commits,arXiv 2506.01391,EMNLP 2025)、katanemo/plano(原 archgw)`main`(6.6k★/431 forks,latest 0.4.25 / 2026-06-15,Rust/Envoy 系,极活跃,LICENSE 落地前复核)。另**挂三个下批候选 watch**:**X-PLUG/GUI-Critic-R1 与 X-PLUG/ToolCUA**(若做「写操作预检 critic」可直读其实现)、**katanemo 的 Signals 路由分类法论文/实现**(若做智能派单路由可对照)、**OpenBMB/MiniCPM-V 上游**(AgentCPM 基座,看是否出更轻端侧版)。HEAD commit SHA 因代理 `git ls-remote` 403 未取,待网络可达回填。


<!-- insight-scout-run:cr-1782259236907-insight-scout-repos-20260624-08 -->
## 2026-06-24 · 自动洞察(20260624-08 · llm-gateway)

> 来源:洞察员; run=cr-1782259236907-insight-scout-repos-20260624-08; queue=insight-scout/insight-scout-repos-20260624-08; network=limited

## LLM 网关 / 成本质量路由 / 可观测(slot=20260624-08)\n\n说明:本轮 network_status=limited,以下基于既有公开知识整理,不声称实时 star/commit/release 数据;许可证请主管二次确认。\n\n### BerriAI/litellm\n- 是什么:统一多家 LLM provider 的 OpenAI 兼容代理,内置 router、fallback、cost/usage 统计与 virtual key。\n- 值得借鉴:按 model 维度的 token 与成本聚合、cooldown/max-retries/fallback 策略、按 key 的预算与速率限制。\n- 迁移边界/许可证不确定项:常见许可证为 MIT(需二次确认);自建依赖 Postgres/Redis;provider key 与登录态仍由控制台负责,洞察员不处理。\n- URL: https://github.com/BerriAI/litellm\n\n### langfuse/langfuse\n- 是什么:开源 LLM 可观测平台,提供 trace、score、evaluation 与 prompt 管理。\n- 值得借鉴:trace 树状结构、generation 级 token/成本统计、user/session 聚合视图,适合做调用质量与成本回溯。\n- 迁移边界/许可证不确定项:常见许可证为 MIT(需二次确认);自托管组件较重,接入成本需主管评估;只取可观测思路,不引入运行依赖。\n- URL: https://github.com/langfuse/langfuse\n\n### Portkey-AI/gateway\n- 是什么:开源 AI Gateway,主打路由、缓存、重试、可观测一体化。\n- 值得借鉴:声明式路由 config、按 condition 的请求级路由、cache + fallback 组合,可参考其路由 DSL。\n- 迁移边界/许可证不确定项:常见许可证为 MIT(需二次确认);完整可观测需配套其 SaaS,控制台只取路由与缓存设计,不绑定外部服务。\n- URL: https://github.com/Portkey-AI/gateway
## 2026-06-24 · 第二十九批(选题:Unity / Simulaid — 像素办公室「仿真层」三段:目标导向行为决策(GOAP)/ 2D 俯视角寻路 / 多实体高性能 ECS;运行 ~08:0x+08:00,网络已恢复)

> 说明:本批为联网正常的内容批,**轮换到鉴别为最久未做专题的 Unity/Simulaid**(近批为:第二十五像素素材、第二十六编排/队列、第二十七 agent-tools-skills+网页设计、第二十八 GUI grounding+LLM 网关,外加 04/08 两次网络降级复看;Unity/Simulaid 的「仿真行为/寻路/性能」层此前未单独成批)。去重已比对 seen-repos.json:本批三例(crashkonijn/GOAP、h8man/NavMeshPlus、friflo/Friflo.Engine.ECS)均为**新案例**,与已 seen 的 Unity-MCP/ml-agents/game-ci/LitMotion/像素素材等不重叠。**核心立意:Simulaid 是玉兔6 真实 agent 团队的像素化可视化**,故每例同时给「① 纯 Simulaid 可视化/仿真层可直接用的点」与「②(若有)能反向映射到玉兔6 真实编排/taskstore 的更深一层」。本节是给老板/CEO 看的「值得借鉴」分析,**非待办**;本批**不新增待办卡**(理由见末)。**Starlaid 全程排除。**

### 1. crashkonijn/GOAP — Unity 的「目标导向行动规划(GOAP)」:声明 目标+动作(前置条件→效果),planner 自动算出行动序列,多线程跑、带决策可视化
- 名称/URL:crashkonijn/GOAP(A multi-threaded GOAP system for Unity)— https://github.com/crashkonijn/GOAP
- 核验事实(本批 web_fetch 直读):**Apache-2.0**,**1.7k★ / 174 forks / 863 commits / 72 releases**,**最新 3.1.2(2026-03-06,很新)**;C# 100%;基于 **Unity Job System 多线程**(README 自带 **2000 agents 实时 demo gif**);双配置(ScriptableObject + 代码);内置 **GOAP Visualizer / Node Viewer** 可视化调试 AI 决策;已被多款上架 Steam 游戏使用(Basher Beatdown、Toy Shop Simulator、Earthlings、External);OpenUPM + Asset Store 双发布。
- 它优秀在哪:把 NPC 行为从「硬编码状态机」升级成「**声明式规划**」——给每个 agent 一个 **goal(目标)** 和一组 **action(动作,各带 precondition 前置条件 / effect 效果)**,planner 像 A* 一样在「动作图」上自动搜出「从当前世界状态达成目标」的最优行动链。改需求只需加/改动作,不用重写状态机;而且**多线程 + 可视化 + 已被商业游戏验证**,工程成熟度高。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① Simulaid NPC 行为 ← 直接用 GOAP 驱动像素员工「自己决定下一步」** ⭐:像素办公室里「员工去打印机→取文件→回工位→交给同事」这类链不用一条条硬编码——给像素员工设目标 + 一组动作,GOAP 自动规划。Unity 专用、Apache-2.0、可商用,Simulaid 可直接接。
  - **② 真实编排 ← 借「goal / action(precondition→effect)」声明式模型给玉兔6 派活规划** ⭐⭐:这是更值钱的一层。玉兔6 现在派活偏**固定调用链**(秘书→总管→员工)。GOAP 的形态——**声明「目标 + 可用动作(各自前置条件与效果)」,由引擎自动算执行序列**——可作为玉兔6 编排的一种「声明式任务规划」范式(接第二十六批声明式流程 + DAG、第二十八批 STATUS 词表):不用人手写死链路,引擎据目标与能力前置条件自动编排。
  - **③ 可观测 ← 借 Node Viewer 的「决策可视化」给控制台**:把「为什么选了这条规划链/这个动作」画成节点图,控制台可据此把玉兔6 编排的决策过程可视化(与第二十六/二十八批「可观测应是默认能力」共识同向)。
- 边界:GOAP 包**强依赖 Unity(Job System / ScriptableObject)**,Simulaid 可直接用;但「声明式规划模型」搬到玉兔6 真实编排只借**形态/数据模型**,**不引 Unity 运行时**(红线:单机零依赖)。Apache-2.0 商用与改写友好。
- 难度:Simulaid 直接接=低;映射到真实编排=中(属编排范式改造)。优先级:**中-高**(Simulaid 行为层可直接用 + 给真实编排一个「声明式规划」范式,直击「派活仍是固定链」短板)。

### 2. h8man/NavMeshPlus — Unity 官方 NavMesh 的「2D 俯视角扩展」:自动从 tilemap / sprite / collider2d 烘焙出可行走网格,像素办公室寻路开箱即用
- 名称/URL:h8man/NavMeshPlus(Unity NavMesh 2D Pathfinding)— https://github.com/h8man/NavMeshPlus
- 核验事实(本批 web_fetch 直读):**MIT**(LICENSE.meta 一项标注 Unknown,主 LICENSE 为 MIT),**2.3k★ / 252 forks / 134 commits**;C# 100%;**无 release(成熟稳定型,够用即取)**;是 Unity 官方 NavMeshComponents 的 fork + 2D 扩展。能力:NavMeshSurface + **NavMeshCollectSources2d**(把 **tilemap / sprite / collider2d** 自动转成寻路 source)+ NavMeshLink / NavMeshModifier / NavMeshModifierVolume;一键 Bake 从场景几何生成 navmesh;自带 demo(RedHotSweetPepper)。
- 它优秀在哪:Unity 原生 NavMesh 是为 3D 设计的,2D 俯视角项目接寻路一直麻烦;NavMeshPlus 把它**干净地搬到 2D top-down**——直接吃 tilemap 和 2D 碰撞体,**自动烘焙**出可行走区,角色用标准 NavMeshAgent 即可「绕开障碍走到目标」。对「像素办公室」这种 tilemap + 桌椅隔断的场景几乎是量身的,且 MIT、零成本、社区验证多(2.3k★)。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① Simulaid 像素员工移动 ← 直接用 NavMeshPlus 做 2D 寻路** ⭐⭐:像素办公室是典型 top-down tilemap,NavMeshPlus 把 tilemap + 障碍(桌子/隔断/墙)自动烘焙成 navmesh,像素员工「绕开障碍走到目标工位」**开箱即用,不必自研 A***。这是本案例最直接对口的一点。
  - **② 声明式障碍标注 ← 借「Navigation Modifier 标注障碍/区域 + 改图即重烘焙」的形态**:在 Simulaid 把「墙/桌子/可走区」做成场景上的声明式标注,地图一改即重 Bake,维护成本低。
- 边界:**纯 Simulaid 可视化/移动层用途,对玉兔6 真实编排无映射**(诚实标注:这条只服务像素办公室的可视化真实感,不是核心逻辑)。Unity 专用、MIT;commit 活跃度低但属「成熟稳定够用」型,落地前确认与目标 Unity 版本兼容(社区已有 Unity 6 fork 可参照)。
- 难度:低(开箱即用)。优先级:**中-低**(只提升 Simulaid 可视化真实感,非核心逻辑)。

### 3. friflo/Friflo.Engine.ECS — 纯托管 C# 的高性能 ECS(无 unsafe),跨 Unity/Godot/MonoGame,常见基准最快;给「很多像素员工」与玉兔6 taskstore 一套「数据=组件、逻辑=系统」的解耦范式
- 名称/URL:friflo/Friflo.Engine.ECS(High-performance C# ECS)— https://github.com/friflo/Friflo.Engine.ECS
- 核验事实(本批 web_fetch 直读):**MIT**,**667★ / 64 forks / 5,009 commits / 22 releases**,**最新 v3.6.0(2026-03-23,很新)**;C# 99.3%;**纯托管 C#、无 unsafe 代码**(规避内存损坏崩溃);跨 **.NET / WASM / Unity(Mono/IL2CPP/WebGL)/ Godot / MonoGame**。特性:类型安全多线程查询、command buffer(延迟操作)、实体层级(scene tree)、**relationships(实体间链接,可建有向图:寻路/社交网络)**、**relations(一对多,做库存等)**、**O(1) 组件 Index/Search**、实体/组件事件、SIMD、JSON 序列化、**系统自带性能监控(每系统耗时/内存/实体数 perf log)**、查询生成器(v3.6)。基准:`ECS.CSharp.Benchmark-common-use-cases` 中 **friflo 比率 1.00 居首**(领先 Arch 6.96×、fennecs 19×);已被上架游戏使用(Vanguard Tides 2000FPS、Horse Runner DX 上 Switch、Louis Adventure)。
- 它优秀在哪:在 C# ECS 里它有两个差异化卖点——**①「纯托管、无 unsafe」**:别家 ECS 多用指针/unsafe 提速但可能触发访问违例崩溃,friflo 全托管仍拿到 C/C++/Rust 级性能与零 GC,工程可靠性高;**② 内建「系统级性能监控 + O(1) 组件索引 + relationships 有向图」**:不只是快,还把「性能可观测」和「按属性 O(1) 找实体 / 建实体关系图」做成一等公民。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① Simulaid 多实体性能 ← 用 ECS 把「每个像素员工」建成 entity + component** ⭐:当 Simulaid 要同时更新/渲染很多像素员工(位置/状态/动画/当前任务),ECS 的连续内存 + 多线程查询能稳帧率(其 Unity demo 65536 实体 100FPS)。
  - **② 玉兔6 taskstore 数据模型 ← 借「组件=纯数据、系统=无状态逻辑」的解耦思想** ⭐:更深一层——玉兔6 的 run/任务/员工状态可借 ECS「**纯数据组件 + 无状态系统处理**」思路,把**状态(数据)与处理(逻辑)彻底解耦**,利于并行、可测、可续跑(接第二十六批中间态续跑、第二十八批 STATUS 状态词表)。
  - **③ 可观测 ← 借「系统自带 perf log(每系统耗时/内存/处理实体数)」** ⭐:玉兔6 编排可学这种「每个处理步骤自带耗时/内存/吞吐统计」的**内建可观测**形态,控制台直接渲染 perf 表(与第二十六/二十八批可观测共识一致)。
  - **④ O(1) 索引 / 关系图 ← 借「component Index O(1) 查找 + relationships 有向图」**:玉兔6 若要「按属性秒查 run/员工」(如找所有卡在 `need_feedback` 的 run)或建任务依赖 DAG,O(1) index + relationships 是现成数据结构范式。
- 边界:ECS 对**小规模(几十个像素员工)可能过度工程**,Simulaid 实体不多时不必强上;但「数据/逻辑解耦 + 内建 perf 监控 + O(1) 索引」对玉兔6 taskstore/可观测有**长期**价值。MIT、纯托管、跨引擎,可放心读借;真要在 Simulaid 引入需评估与现有 Unity 工作流的改造面。备选同类:genaray/Arch(多线程、更激进,但 friflo 基准更快且更安全)。
- 难度:Simulaid 引入=中(架构改造);思想映射到 taskstore=低-中。优先级:**中**(性能保险 + 数据模型/可观测思想,非当务之急)。

### 本批小结(给 CEO 的一句话借鉴)
- **crashkonijn/GOAP**:学它「**目标+动作(前置条件→效果)的声明式规划**」——Simulaid 像素员工行为可直接用;更值钱的是把这套「声明目标、引擎自动编排」范式映射到玉兔6 真实派活,补「派活仍是固定链」短板。
- **h8man/NavMeshPlus**:学它「**tilemap/sprite 自动烘焙 2D navmesh**」——像素办公室寻路开箱即用、零自研 A*;纯 Simulaid 可视化层,不映射真实编排(诚实标注)。
- **friflo/Friflo.Engine.ECS**:学它「**纯托管高性能 ECS + 系统级 perf 监控 + O(1) 索引/关系图**」——给 Simulaid 多实体性能兜底;更长期的是「数据=组件、逻辑=系统」解耦思想 + 内建可观测,可反哺玉兔6 taskstore。
- **本批不新增待办卡**(延续七–十、十二–二十六、二十八批的克制口径;唯十一批因真漏洞、二十七批因 insights.md 真实膨胀破例)。理由:三例最值钱的落地——**「Simulaid 接 GOAP/NavMeshPlus」属 Simulaid 产品决策、「声明式规划/ECS 解耦思想反哺真实编排」属架构决策**,均应由产品/主管拍板,不该由洞察员径自堆成待办。**若想立刻、最小、最可逆地动一步**:在 Simulaid 接 **NavMeshPlus**(MIT、drop-in、只动可视化层、不碰核心逻辑)是三例里落地面积最小、风险最低的切口;想要「一处改、收益最深」则评估 **GOAP 声明式规划范式**对真实编排的映射。**Starlaid 全程排除。**

> watch(本批 web_fetch 直读实时元数据;HEAD commit SHA 因代理 `git ls-remote` 403 未取,待网络可达回填):crashkonijn/GOAP `master`(Apache-2.0,1.7k★/174 forks/863 commits,latest 3.1.2 / 2026-03-06,Unity Job System 多线程,活跃)、h8man/NavMeshPlus `master`(MIT,2.3k★/252 forks/134 commits,无 release、成熟稳定,Unity 2D NavMesh)、friflo/Friflo.Engine.ECS `main`(MIT,667★/64 forks/5,009 commits,latest v3.6.0 / 2026-03-23,纯托管跨引擎、基准居首,极活跃)。另**挂三个下批候选 watch**:**AkiKurisu/AkiGOAP 与 luxkun/ReGoap**(若要对比 GOAP 实现/泛 C# 版可对照)、**genaray/Arch**(friflo 的同类 ECS,基准对照项)、**Unity 官方 com.unity.behavior**(行为图,若 Simulaid 要行为树而非 GOAP 可评估)。


<!-- insight-scout-run:cr-1782273608701-insight-scout-repos-20260624-12 -->



<!-- insight-scout-run:cr-1782820846323-insight-scout-repos-20260630-20 -->
## 2026-06-30 · 自动洞察(20260630-20 · multi-agent-orchestration)

> 来源:洞察员; task=cr-1782820846323-insight-scout-repos-20260630-20; network=available(WebSearch + GitHub README/许可证页核验)。已比对 `seen-repos.json`、`borrowed-libs.md`、`insights.md`,本轮 3 个 URL 未命中既有记录;不登录、不授权、不装依赖、不改运行代码。Starlaid/星桥 全程排除。

## 多智能体编排 / 任务 DAG / 交接协议借鉴扫描(slot=20260630-20)

### langflow-ai/langflow
- 是什么:可视化构建和部署 AI agents/workflows 的平台,支持 multi-agent orchestration、逐步 playground、JSON 导出、API/MCP server 暴露。
- 值得借鉴:把“图上节点/边”落成可导出的 flow,再把 flow 作为 MCP 工具交给外部 agent 调用,适合作为控制台“任务 DAG 可视化+交接为工具”的对照。
- 迁移边界/许可证不确定项:MIT;Python/TypeScript 运行时较重,只借 graph schema、flow-as-tool 和逐步调试范式,不引其服务。
- URL: https://github.com/langflow-ai/langflow

### deepset-ai/haystack
- 是什么:面向生产 LLM 应用的 AI orchestration 框架,主抽象是模块化 pipelines 与 agent workflows,显式控制 retrieval、routing、memory、generation。
- 值得借鉴:component/pipeline 的接口边界清楚,适合对照控制台 DAG 节点输入输出、条件路由、状态携带与执行校验分离。
- 迁移边界/许可证不确定项:GitHub 标 Apache-2.0 且提示 unknown license-header;Python 生态较重,只借 pipeline 契约和路由词表。
- URL: https://github.com/deepset-ai/haystack

### langgenius/dify
- 是什么:生产级 agentic workflow 平台,把 AI workflow、RAG pipeline、agent capabilities、模型管理和观测整合在可视化 canvas/API 中。
- 值得借鉴:workflow 可作为业务 API/工具交付,近期强调队列化图执行;可借来定义“DAG 运行状态+交接载荷+观测记录”的最小字段。
- 迁移边界/许可证不确定项:Dify Open Source License,基于 Apache-2.0 但有附加条件;自托管栈较重,只借 DSL/状态机/工具化交付思路。
- URL: https://github.com/langgenius/dify

### 判断
- 三例都指向同一低风险方向:先把控制台任务 DAG 定义成可导出、可逐步调试、可作为工具交接的文档契约。但 20260628-12 已有相近“控制台任务 DAG/交接协议 v0”公告板候选,本轮为避免重复开卡,只补充分析与去重库,不新增 bulletin card。



<!-- insight-scout-run:run-20260628T0411Z-insight-scout-repos -->
## 2026-06-28 · 自动洞察(run-20260628T0411Z · 优秀网页设计 / 控制台可观测·监控·审批 UI)

> 来源:洞察员; run=run-20260628T0411Z; network=available(WebSearch + GitHub README/许可证页核验)。已比对 `seen-repos.json` / `borrowed-libs.md` / `insights.md`,本轮 3 个 URL 未命中既有记录;不登录、不装依赖、不改运行代码。轮换说明:上一轮(20260628-12)做的是多智能体编排,本轮切到「控制台监控/可观测/审批 UI」(优秀网页设计方向)。Starlaid 全程排除。

## 控制台监控 / 可观测 / 审批 UI 借鉴扫描(slot=run-20260628T0411Z)

### simple10/agents-observe
- 是什么:面向 Claude Code agents 的实时可观测 dashboard。用 **hooks(而非 OTEL)** 捕获每个事件,本地或远程都能跑、多实例汇聚。架构:`Claude Code Hooks → observe_cli(哑管道 HTTP POST)→ API Server(SQLite 解析+存储)→ React 19 + shadcn dashboard(WebSocket 实时推送)`。MIT,v0.7.4(2026-04)。
- 优秀在哪/亮点:① hooks 抓「全量真相」——PreToolUse→PostToolUse 客户端合并成一行、还原子 agent 父子层级(谁 spawn 谁)、可展开看完整 payload/命令/结果、时间线点击跳转;② 服务端是「哑存储」,所有 agent 状态(status/事件计数/时延)由前端从事件流推导,职责切分极干净;③ hook 脚本是「哑管道」(读 stdin→加项目名→POST),彻底解耦;④ 人类可读会话名(如 twinkly-hugging-dragon)便于历史复盘。
- 玉兔6可借鉴的具体点:正对 **控制台实时监控 + Simulaid 像素办公室活动可视化**。可借它「hooks 哑管道 → SQLite → WebSocket 实时推 → 前端从事件流推导状态/层级」这套最小架构,改进我们控制台当前对「子 agent / 工具调用」可见性不足的问题:把 PreToolUse/PostToolUse 合并成单行、按 parent/child 还原 agent 层级后**直接喂给 Simulaid**,把「哪个工位在调哪个工具」做成实时动画;历史会话用人类可读名归档,便于失败复盘。
- 难度+优先级:难度中(需接 hooks + 一个轻服务 + 前端事件流);**优先级高**(与控制台/Simulaid 监控诉求高度对齐,纯本地、零外部依赖)。
- 迁移边界/许可证:MIT 已核;它依赖 Docker/Node 跑容器、且为 Claude Code hooks 专用,玉兔6 只借「事件流哑管道 + 前端推导状态」的架构与字段,不直接引其容器/插件运行时。
- URL: https://github.com/simple10/agents-observe

### lmnr-ai/lmnr(Laminar)
- 是什么:专为 AI agent 打造的开源可观测平台(YC S24,Apache-2.0)。OTel 原生 tracing SDK(1 行接入),浏览器会话录制与 trace 同步,Signals(用自然语言描述要追踪的事件/逻辑错误),SQL 直查 traces/metrics/events,且可**回放任一 span 并替换 prompt/模型并排对比**;支持云端或自托管(Helm)。
- 优秀在哪/亮点:① Signals——用自然语言定义「什么算异常/逻辑错误」,把告警从硬编码阈值升级为语义判定;② span 级回放 + 换 prompt/模型并排对比,是「调试即时间旅行」的成品形态;③ 内置 SQL editor 让 trace 变成可查询数据;④ 浏览器会话回放与 trace 对齐,适合 computer-use 类排错。
- 玉兔6可借鉴的具体点:对照控制台既有 `gateway-observability-panel`(网关 token/花费/延迟面板)做**增量**——把「会话链路」升级为 span 级可回放 + 换模型重跑对比,改进我们失败复盘只能读日志的现状;Signals 的「自然语言定义异常」可借来给控制台/队列的失败处置加一层**语义告警**(比纯状态码/超时更贴近业务);computer-use 排错可借其「会话录制 ↔ trace 对齐」。
- 难度+优先级:难度中-高(完整自托管较重:ClickHouse/Helm 等);**优先级中**(设计理念可立即借,完整平台不必引)。
- 迁移边界/许可证:Apache-2.0 已核(另有商业云版);自托管栈较重,玉兔6 只借 Signals 语义告警 + span 回放对比的设计词表,不接其运行时。
- URL: https://github.com/lmnr-ai/lmnr

### assistant-ui/assistant-ui
- 是什么:生产级 AI 对话 UI 的 React/TS 库(MIT,9.6k★,YC W25)。shadcn/cmdk 风格可组合 primitives(消息列表/输入/线程/工具条),内置流式、自动滚动、a11y、附件、markdown、代码高亮、语音输入;后端无关(AI SDK / LangGraph / Mastra / 自定义)。
- 优秀在哪/亮点:① **Generative UI**——把工具调用 / JSON 渲染成 React 组件,**inline 就地收集 human approval**,并向模型暴露「安全的前端动作」;② Radix 式可组合(不是一坨大组件),换皮不伤逻辑;③ 强 TypeScript(runtime API / 工具 schema / message parts / adapter 全类型)。
- 玉兔6可借鉴的具体点:正对 **控制台对话/人审 UI** 与既有 `office-tool-station-humangate-alert`(human-gate 审批)。可借它「把工具调用渲染成组件 + inline human approval」的交互范式,改进我们控制台审批多靠文字/外部确认的体验:主管在对话流里直接看到「某 agent 要执行的工具调用卡片」并就地批准/驳回;其 typed tool schema 也能规范控制台「工具→工位」调用的前端契约。纯前端范式,不动后端。
- 难度+优先级:难度中(前端组件改造,需对接我们消息/审批事件);**优先级中**(体验提升明确但非阻塞;建议在 human-gate 工作项里一并采纳)。
- 迁移边界/许可证:MIT 已核;面向 React 生态,若控制台前端非 React,则只借交互范式/审批组件结构,不强引库。
- URL: https://github.com/assistant-ui/assistant-ui

### 判断
- 本轮 3 个都落在「控制台可观测/监控/审批 UI」,与既有公告板项(`gateway-observability-panel`、`office-tool-station-humangate-alert`、`insight-4231644170` 路由评测+LLM可观测)同域;为避免待办卡重复,本轮**不新增待办卡**,只产出借鉴分析。
- 最值得立刻借的是 **agents-observe**:其「hooks 哑管道 → SQLite → WebSocket 实时推 → 前端从事件流推导子 agent 层级」几乎就是控制台实时监控 + Simulaid 活动可视化最需要的最小架构。建议把这套架构作为「控制台实时事件流监控面板」的**设计基线**,并入现有监控/可观测工作项推进(纯文档/架构层,零新依赖、数据不出本地),而非另开新卡。



<!-- insight-scout-run:cr-1782619241914-insight-scout-repos-20260628-12 -->
## 2026-06-28 · 自动洞察(20260628-12 · multi-agent-orchestration)

> 来源:洞察员; task=cr-1782619241914-insight-scout-repos-20260628-12; network=available(WebSearch + GitHub README/许可证页核验)。已比对 `seen-repos.json`、`borrowed-libs.md`、`insights.md`,本轮 3 个 URL 未命中既有记录;不登录、不装依赖、不改运行代码。

## 多智能体编排 / 任务 DAG / 交接协议借鉴扫描(slot=20260628-12)
### OrlojHQ/orloj
- 是什么:面向 agentic systems 的声明式运行/治理栈,把 agents/tools/models/memory/approvals/policies/workers/traces 视为 versioned resources。
- 值得借鉴:它把 durable handoff、fan-out/fan-in、retry、idempotency、dead-letter、leases/heartbeats 放进任务生命周期,适合对照控制台 DAG 节点状态机。
- 迁移边界/许可证不确定项:Apache-2.0; README 标注 pre-1.0 schema/API 会变,只借 manifest/status/controller 词表,不接 Go/K8s runtime。
- URL: https://github.com/OrlojHQ/orloj

### NVIDIA/NeMo-Agent-Toolkit
- 是什么:NVIDIA 的跨框架 agent toolkit,强调 instrumentation、observability、evaluation/optimization,并支持 MCP 与 A2A。
- 值得借鉴:APP 将 parallel execution、speculative branching、node-level priority routing 做成性能原语;可借来给控制台 DAG 边/节点标注优先级和并行策略。
- 迁移边界/许可证不确定项:Apache-2.0; Python/NVIDIA 生态较重,且含第三方插件独立发布,只借协议适配层与运行观测字段。
- URL: https://github.com/NVIDIA/NeMo-Agent-Toolkit

### snapsynapse/turnfile
- 是什么:面向多 LLM agent 的文件化协商协议,不用中心 orchestrator,用 Markdown 记录分歧、裁决与审计轨迹。
- 值得借鉴:"人类仲裁+同级 agent 提案+纯文本审计"适合作控制台交接协议的低耦合参照,尤其适合失败复盘和主管确认。
- 迁移边界/许可证不确定项:GitHub 标为 Apache-2.0,同时有 LICENSE-SPEC,采纳前需核规范文本授权;只借 schema/流程,不当运行时。
- URL: https://github.com/snapsynapse/turnfile

### 判断
- 生成 1 张公告板候选:建议 CEO 决定是否先起草纯文档《控制台任务 DAG/交接协议 v0》,把节点状态、条件边、handoff 载荷、人审/死信/心跳字段统一,不触发代码改动。



<!-- insight-scout-run:run-20260627T1205Z-insight-scout-repos -->
## 2026-06-27 · 自动洞察(run-20260627T1205Z · 任务队列引擎 / durable execution + AI agent skills)

> 来源:洞察员; run=run-20260627T1205Z-insight-scout-repos(UTC 2026-06-27T12:05Z;定时自动运行,引擎未下发 cr- 编号,用时间戳 run id);network=available(WebSearch + web_fetch 直读 GitHub 仓库页核验)。
> 选题轮换:最近一轮(约 12:04)是 LLM 网关 + 多智能体编排;再往前为 像素/网页设计(08:03)、Unity/Simulaid + GUI grounding(04:05)、多智能体编排(约 00:10)。**任务队列引擎 / durable execution** 与 **agent skills** 是近 4 个批次都未深挖的两题(上次成批约在昨 20:10),本轮轮回到此:主攻 **durable execution**(2 例)+ 1 例大型 **agent skills** 库。
> 去重:已比对 seen-repos.json(228 个 URL,本轮 +3 = 231)+ borrowed-libs.md;本轮三例(earendil-works/absurd、hatchet-dev/durable-execution-the-hard-way、Orchestra-Research/AI-Research-SKILLs)**均未出现在去重热库**,与已 seen 的队列/durable 族(River / Hatchet 主仓 / DBOS / Temporal / Restate / resonate / obelisk / pgmq / pgflow / Inngest / Trigger.dev / Windmill / Celery / BullMQ / asynq / faktory / sidekiq / solid_queue / quartz / dramatiq / huey / goqite / litequeue / procrastinate / watermill / graphile-worker / kestra / dagster…)、skills 族(anthropics-skills / microsoft-skills / VoltAgent-awesome-agent-skills / agentsmd / github-awesome-copilot / microsoft-apm / tech-leads-club-agent-skills…)均不重叠。**Starlaid / 星桥 全程排除。**

### 1. earendil-works/absurd — 「最简单的 durable execution」:只靠 Postgres、几乎像队列一样易用,task→step→checkpoint 续跑不重做 + 事件 first-emit-wins(race-free),且**专为 agent 设计、随附可安装 skill**
- ① 名称 / URL:earendil-works/absurd(An experiment in durability;作者 Armin Ronacher,announcement 在 lucumr.pocoo.org 2025-11)— https://github.com/earendil-works/absurd
- 核验(web_fetch 直读):**Apache-2.0** · **2.1k★ / 87 forks / 298 commits / 13 releases**,latest **0.4.0(2026-05-27)→ 活跃** · Python 38.5% / TypeScript 27.8% / PLpgSQL 17.2% / Go 14.6%(多语言 SDK)· 自带与 PGMQ / Cadence / Temporal / Inngest / DBOS 的对比文档。
- ② 优秀在哪:把 durable execution 做到极简——"只需把一个 `absurd.sql` 应用到 Postgres,无需任何额外服务"。模型清晰:一个 *task* 派到 *queue*,*worker* 拉取执行;task 切成有序 *step*,**每个 step 的结果落库成 checkpoint,续跑时自动从库回载已完成 step、不重做**(逼近 exactly-once 的体感);**事件 `awaitEvent` / `emitEvent` 采用 first-emit-wins 缓存——天然 race-free**;支持 sleep / suspend-for-events;**pull-based**(worker 按容量拉,无需 push 协调器);配套 `absurdctl`(初始化/迁移/建队列/spawn/retry)+ `habitat`(Go web UI 看任务状态)。**最贴玉兔6 的一点:它专为 agent 协作设计**——Claude Code / pi 能直接读库中任务状态,`absurdctl install-skill` 把"如何与 absurd 协作"做成一份可安装 skill 塞进 `.agents/skills`,还有"living with code changes"文档讲版本演进下的续跑兼容。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **控制台 / engine-runner 可靠执行 ← 借「task→step→checkpoint:每步结果落存储,续跑自动回载已完成步、不重做」** ⭐⭐:这正是玉兔6 文件队列 + engine-runner 想要的"崩溃续跑不重复工作"。可借其 step/checkpoint 语义,把工位多步任务切成可检查点的 step,中断后只补未完成步——本轮最高价值借鉴。
  - **事件 / 交接 ← 借「first-emit-wins 事件缓存(race-free)」** ⭐:玉兔6 工位等外部事件(等审批 / 等上游产出)、工位间交接,可借这套"事件先到先缓存、重放幂等"避免重复触发与竞态。
  - **能力库 / skills 打包 ← 借「系统随附一个 install-skill,把'如何与本系统协作'做成可安装 skill」**:玉兔6 控制台能力可借这种"系统自带 skill"做法,让工位 agent 即装即用(契合渐进披露)。
  - **单机零依赖形态 ← 借「单存储后端 + 一个 .sql + 迁移文件,无额外 broker」**:虽然玉兔6 是文件队列(非 Postgres),但"零额外 broker、单存储"取舍与单机红线同频。
- ④ 难度中 / 优先级高:step/checkpoint + first-emit-wins 直击 engine-runner 可靠执行;agent-native 设计加分。
- 边界:**Postgres-only**(玉兔6 是文件队列,不引 Postgres 运行时与多语言 SDK)→ 只借 **step/checkpoint 语义 + first-emit-wins 事件模型 + 随附 skill 思路**,在文件队列上 native 重实现;Apache-2.0 可读借。

### 2. hatchet-dev/durable-execution-the-hard-way — 不是又一个库,而是一份「从零自建 durable execution」的 7 课蓝本(Go+Postgres),把 **retry / replay / fork 当三种不同操作**显式区分——正合玉兔6「不引 runtime、native 自建 engine-runner」的硬约束
- ① 名称 / URL:hatchet-dev/durable-execution-the-hard-way(作者 abelanger5,Hatchet 创始人;仿 "Kubernetes the hard way")— https://github.com/hatchet-dev/durable-execution-the-hard-way
- 核验(web_fetch 直读):**MIT** · **20★ / 0 fork / 16 commits** · **Go 100%** · 无 release(**它是教程仓,非库**)· 依赖仅 Go 1.25+ / Postgres / pgx,用 sqlc 模板化 SQL。
- ② 优秀在哪:把 durable execution 拆成 **7 课可运行示例**:① 预备 ② 简单任务队列 ③ 限制并发 ④ 队列改进 ⑤ **durable event log** ⑥ **追踪非确定性** ⑦ durable tasks,"最终得到一个最小但完整可用的 workflow engine"。最有价值的是它**把恢复动作拆成三个不同操作**:**retry**=不重置事件历史地重试(保留执行状态)、**replay**=重置历史从头跑、**fork**=在历史某点重置形成分叉。明确受众就是"想实现自己的 workflow engine、需要一个简单架构起点"的人——几乎是对着玉兔6 写的。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **engine-runner「自建可靠执行」← 借整套 7 课的 event-log + 非确定性追踪 + durable task 实现路径** ⭐⭐:玉兔6 既然要 native 自建,这份"简单任务队列→事件日志→durable task"的渐进蓝本可作**对照实现清单**,比硬抄某个重型库更适配玉兔6 文件队列。
  - **任务恢复语义 ← 借「retry / replay / fork 三分」** ⭐:玉兔6 对"卡住的活"目前只有粗粒度续跑;借这三分做成明确词表(retry 保留进度 / replay 清空重跑 / fork 从某检查点分叉),直接补强近批 queue-crash-recovery 借鉴,也与本批 absurd 的 step/checkpoint 互补。
  - **非确定性治理 ← 借「第 6 课:显式追踪 / 限制非确定性」**:玉兔6 工位任务含 LLM 调用(天然非确定),借其"把非确定来源记进事件日志、回放时读旧值"思路保证续跑一致。
- ④ 难度低(读教程)→ 中(照做 native 实现)/ 优先级高:最贴玉兔6 native 自建 engine-runner 的蓝本。
- 边界:Go + Postgres 教程,玉兔6 不照搬栈、不引 runtime → 只借 **实现路径 + retry/replay/fork 语义 + 非确定性追踪**,在文件队列上 native 重写;MIT 可读借;20★、教程性质(非生产库)→ 价值在"怎么自己搭",不是拿来即用。

### 3. Orchestra-Research/AI-Research-SKILLs — 10k★ 的大型 agent skills 库(98 skills / 23 类、按类安装);其近期一次「把全仓库存量对账到单一数字、消除跨文件计数漂移」恰好示范了**能力库治理**该怎么做
- ① 名称 / URL:Orchestra-Research/AI-Research-SKILLs(面向任意 AI 模型的 AI 研究/工程 skills 库)— https://github.com/Orchestra-Research/AI-Research-SKILLs
- 核验(web_fetch 直读):**MIT** · **10k★** · **98 个 skills / 23 类**,覆盖 AI 研究全生命周期(idea → paper → 可证伪可审计 artifact)· 可用 **Claude Code CLI 按类安装** · 有 npm 包与 ROADMAP · changelog 里有一条**"把全仓库存量对账到 98 skills / 23 类"——修正了散落在 CLAUDE.md(写 90)、CONTRIBUTING.md(写 86/22)、README sync 行(写 87)、WELCOME.md、npm README 里互相漂移的计数**,并修了多个分类错列。
- ② 优秀在哪:它是个大型、活跃(10k★)的 skills 库;比"又一个清单"更有借鉴的是它**暴露并修复了一个真实的能力库治理痛点——计数/清单在多份文件里漂移**,并把"对账到单一权威数字"作为一次明确的治理动作。这对玉兔6 的能力库/skills 目录治理直接对口。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **能力库治理 ← 借「单一权威 inventory + 跨文件计数对账」** ⭐:玉兔6 控制台能力/skills 若分散描述在多处,易出现"哪份文件说有几个"对不上。借这次"对账到单一数字、消除漂移"的教训,给玉兔6 能力库设**一份权威清单 + 校验**(呼应近批 microsoft/apm 的 manifest/lockfile 治理)。
  - **skills 分发 ← 借「按类(category)安装,而非整库塞入」** ⭐:工位按需加载能力时,"按类目挑装"减少上下文膨胀(契合渐进披露)。
  - **能力库信息架构 ← 借「23 类 × 全生命周期分类法、每条带行数 / 引用计数」**:作玉兔6 能力目录分类与可审阅性的参照。
- ④ 难度低 / 优先级中:治理与分发是低风险可借的方法;具体研究类 skills 与玉兔6 业务不直接对口,价值在治理范式。
- 边界:面向"AI 研究"领域(与玉兔6 业务不同),**只借治理 / 分发 / 分类法,不整库引入**;MIT 可读借;社区 skills 逐条按需评估。

### 行动判断(是否加待办卡)
- 三例最值钱的借鉴都偏**架构 / 范式**(step-checkpoint + first-emit-wins 事件、自建 engine 的 retry/replay/fork、能力库对账)→ 属"给 CEO 取舍的借鉴",非可越过决策直接执行的原子动作 → **本轮不新增公告板待办卡,只写分析**(符合"不是待办任务"红线)。
- 最接近"明确值得立刻做"的:把 **absurd 的 step/checkpoint(续跑回载不重做)+ hatchet-the-hard-way 的 retry/replay/fork 三分**,并入玉兔6 已有的「文件队列语义约定 v0 / queue-crash-recovery」设计评审——直击 engine-runner"任务中断后续跑 / 重做"核心痛点,且是可对照实现的具体语义。本轮先作为**最高优先借鉴点**提请 CEO;如认可再单独开一张可执行卡(改 engine-runner 的检查点 / 恢复语义),避免擅自堆待办。

### 本批小结(给 CEO 的一句话借鉴)
- **earendil-works/absurd**:学它「**task→step→checkpoint 续跑回载不重做 + 事件 first-emit-wins(race-free)+ 系统随附可安装 skill**」——直击 engine-runner 可靠执行;Apache-2.0、2.1k★、活跃,借语义不引 Postgres。
- **hatchet-dev/durable-execution-the-hard-way**:学它「**从零自建 durable execution 的 7 课蓝本 + retry/replay/fork 三分恢复语义 + 非确定性追踪**」——最贴玉兔6 native 自建 engine-runner 的对照清单;MIT、教程仓。
- **Orchestra-Research/AI-Research-SKILLs**:学它「**单一权威 inventory + 跨文件计数对账 + 按类安装**」磨利玉兔6 能力库治理与分发;MIT、10k★,借治理/分类法不整库引入。
- **本批不新增待办卡**(延续近批克制口径)。**Starlaid 全程排除。**

> watch:absurd `main`(**Apache-2.0 → watch=true**,看 step/checkpoint + first-emit-wins 事件 + agent skill 演进,2.1k★、0.4.0 2026-05)、hatchet-dev/durable-execution-the-hard-way `main`(**MIT → watch=true**,看后续课:Postgres LISTEN/NOTIFY 加速、durable sleep、分叉,20★)、Orchestra-Research/AI-Research-SKILLs `main`(**MIT → watch=true**,看能力库对账/治理与按类安装,10k★)。另挂下批候选 watch(本轮 web_fetch 已见、未成文):**iopsystems/durable**(Apache-2.0+MIT,53★,Rust + WASM component/WASI、把外部副作用记进事件日志做**确定性重放**——另一种 durable 范式)、**microsoft/pg_durable**(Postgres in-database durable execution,SQL 算子组合)、**absurd 的 comparison 文档**(PGMQ/Cadence/Temporal/Inngest/DBOS 选型对照,作玉兔6 durable 选型参照)。



<!-- insight-scout-run:run-20260627T0811Z-insight-scout-repos -->
## 2026-06-27 · 自动洞察(run-20260627T0811Z · LLM 网关 + 多智能体编排)

> 来源:洞察员; run=run-20260627T0811Z-insight-scout-repos; network=available(WebSearch + web_fetch 直读核验)
> 选题轮换:最近 4 轮为 像素/网页设计(08:03)、Unity/Simulaid + GUI grounding(04:05)、队列引擎 + agent 工具(昨 20:10)、多智能体编排(约 00:10);**LLM 网关**最久未成批轮到(上次 20260626-16,约 16h 前),本轮回到该题,并配一题仍有新料的**多智能体编排**。
> 去重:已比对 seen-repos.json(222 个 URL,本轮 +3 = 225)+ borrowed-libs.md;本轮三例(VRSEN/agency-swarm、bytedance/deer-flow、Helicone/ai-gateway)均未出现在去重热库,与已 seen 的网关类(LiteLLM / Bifrost / Portkey / Helicone**主仓** / tensorzero / envoyproxy-ai-gateway / archgw / RouteLLM / semantic-router / traceloop-hub / optillm…)、编排类(crewAI / LangGraph / autogen / dapr-agents / langroid / MetaGPT / ADK / openai-agents…)不重叠。**Starlaid / 星桥 全程排除。**

### 1. VRSEN/agency-swarm — 把多智能体当「真实组织结构」建模,用 `A > B` 有向通信流显式声明「谁能向谁发起对话」
- ① 名称 / URL:VRSEN/agency-swarm(Reliable Multi-Agent Orchestration Framework)— https://github.com/VRSEN/agency-swarm
- 核验(web_fetch 直读):**MIT** · 4.4k★ / 1.1k forks / 2,412 commits · **Python 97.8%** · 最新 **v1.9.8(2026-05-06)**,共 61 个 release · 构建在 OpenAI Agents SDK + Responses API 之上。
- ② 优秀在哪:把自动化按**真实组织结构**来想(CEO / Virtual Assistant / Developer 等角色,各有指令、工具、文件)。最大亮点是**有向通信流 `communication_flows`**——用 `ceo > dev`、`ceo > va`、`dev > va` 这样的运算符**显式声明「左边可以向右边发起对话」**,Agent 间通信走专用 `send_message` 工具而不是自然语言乱传;其余亮点:对每个 Agent 的 prompt/instructions 完全可控、**Pydantic 类型化工具(自动校验入参,可从 OpenAPI schema 自动转工具)**、**状态持久化用注入式 `load_threads_callback` / `save_threads_callback`**(可落 DB/文件、跨会话恢复)、面向生产可靠性。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **编排 / 角色边界 ← 借「有向 `communication_flows` 把'谁能找谁'变成显式白名单」** ⭐⭐:玉兔6 办公室本就是 老板→主管→工位 的组织结构,但"谁能向谁派单/交接"若靠隐式约定就容易越界。借 agency-swarm 的 `A > B` 有向流,把控制台的派单/交接路径做成**显式、可校验的白名单**(主管可向工位发起、工位间能否横传由配置定),直接落到已写的《角色边界审视》。
  - **控制台状态持久化 ← 借「持久化走注入式 callback(load/save threads)而非硬编码存储」** ⭐:让控制台会话/任务历史持久化走可插拔 callback,既能落文件也能换存储后端,呼应已 seen LangGraph checkpointer。
  - **工具契约 ← 借「Pydantic 类型化工具 + 从 OpenAPI schema 自动生成工具」**:能力目录里的工具用类型 schema 自动校验入参,减少工位调用控制台能力时的参数错误。
- ④ 难度中 / 优先级中:comm_flows 与持久化 callback 都是清晰的设计借鉴,落地需结合玉兔6 native 栈。
- 边界:Python + 绑定 OpenAI Agents SDK / Responses API,玉兔6 **不引 Python agent runtime** → 只借「有向通信流 + 注入式持久化 + 类型化工具契约」的设计语义,不接 SDK;MIT 可读借。

### 2. bytedance/deer-flow — 从「深度研究框架」进化成 super agent harness:子 agent + 独立沙箱 + 上下文工程 + 严格工具调用恢复(与玉兔6 架构几乎 1:1)
- ① 名称 / URL:bytedance/deer-flow(Deep Exploration and Efficient Research Flow,2.0 SuperAgent harness)— https://github.com/bytedance/deer-flow
- 核验(web_fetch 直读):**MIT** · **68k★ / 9.1k forks / 2,111 commits**(2026-02-28 登顶 GitHub Trending #1)· **Python 72.3% / TypeScript 15.6%** · 构建在 LangGraph + LangChain;**2.0 是从零重写、与 1.x 不共享代码**(1.x 仍维护于 main-1.x 分支)· 设计为**本地可信环境部署(默认仅 127.0.0.1 回环)**,自带高权限(命令执行/资源操作)。
- ② 优秀在哪:lead agent 把复杂任务拆给**子 agent**(各自隔离上下文/工具/终止条件,可并行、结构化报告回收、**token 用量回算到派发步**);每个任务有**独立沙箱 + 文件系统**(`/mnt/user-data/{uploads,workspace,outputs}` 三段式);**上下文工程**:子 agent 上下文隔离、激进摘要、**把中间结果卸载到文件系统**、压缩不相关内容;**严格工具调用恢复**——provider/中间件打断工具调用循环时,**剥离强停消息上的原始 tool-call 元数据、给悬空调用注入占位 tool 结果**,避免严格校验 `tool_call_id` 的模型因历史损坏而报错;**跨会话长期记忆**(apply 时去重事实,避免无限累积);**embedded client 与 HTTP Gateway 返回同一套 schema,CI 用 `TestGatewayConformance` 强制两端对齐**;执行档位 flash/standard/pro/ultra 区分难度。
- ③ 玉兔6 可借鉴(本例与玉兔6 架构几乎 1:1):
  - **控制台「任务跨多步、崩溃续跑」← 借「严格工具调用恢复:给悬空 `tool_call` 注入占位结果再续跑」** ⭐⭐:这正是玉兔6 控制台 / engine-runner 长期痛点——工位多步工具调用被中断后历史损坏、续跑失败。deer-flow 的"剥离强停元数据 + 注入占位 tool 结果"是一套**可直接对照实现的恢复范式**,本轮最高价值借鉴。
  - **编排 ← 借「子 agent 隔离上下文 + 并行 + 结构化回收 + 用量回算派发步」** ⭐⭐:玉兔6 工位 agent 应各自隔离上下文(不互相污染)、能并行、结构化报告回主管,且**用量回算到派单步**便于成本归因,呼应已 seen LangGraph / ADK。
  - **长任务上下文 ← 借「中间结果卸载到文件系统 + 激进摘要」** ⭐:长任务别堆在上下文里,把中间态落盘、按需摘要;且 deer-flow 的 `uploads/workspace/outputs` 三段式与玉兔6 工作区结构几乎一致,可直接对照规范化。
  - **控制台 API 一致性 ← 借「embedded client 与 HTTP Gateway 同 schema + CI conformance 守恒」**:玉兔6 控制台若同时有进程内调用与 HTTP API,可借这套 CI 守恒测试保证两端 schema 不漂移。
- ④ 难度中(恢复范式/上下文工程偏实现)/ 优先级高(工具调用恢复直击核心痛点)。
- 边界:Python/TS + LangGraph/LangChain 运行时,自带高权限、默认仅本地回环 → 玉兔6 **只借恢复范式 / 上下文工程 / 子 agent 隔离 / schema 守恒**的设计,不接其 runtime、不开放高权限端口;MIT 可读借。

### 3. Helicone/ai-gateway — Rust 写的「LLM 界 NGINX」:一组有名字的智能路由策略 + 三维限流 + 响应缓存(⚠️ license 标注不一致)
- ① 名称 / URL:Helicone/ai-gateway(与已 seen 的 Helicone/helicone 可观测主仓是**不同仓库**,本仓是独立网关)— https://github.com/Helicone/ai-gateway
- 核验(web_fetch 直读):**⚠️ License 标注不一致**——README 徽章与正文写 **Apache License**,但 GitHub 仓库侧栏 / 文件导航识别为 **GPL-3.0**;落地前必须人工核 LICENSE 文件为准。590★ / 55 forks / 494 commits · **Rust 96.7%** · Public Beta。
- ② 优秀在哪:自称"LLM 界的 NGINX"——OpenAI 兼容单接口接 100+ 模型 / 20+ provider。最值钱的是**一组有名字的智能路由策略**:`model-latency`(选最快模型)、provider 延迟 **P2C + PeakEWMA**(选最快 provider)、`weighted`(按权重分发)、`cost-optimization`(选最便宜);**限流三维度**(按请求数 / token / **美元金额**)× **三粒度**(per-user / per-team / 全局);**响应缓存**(Redis/S3 后端,指令式 TTL `max-age` / `max-stale`,声称降本降延迟达 95%);OTel logs/metrics/traces;单二进制、P95<5ms、~64MB 内存、~3000 req/s。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **控制台网关 / 路由配置 ← 借「有名字的路由策略词汇表:model-latency / P2C+PeakEWMA / weighted / cost-opt」** ⭐:玉兔6 已有网关(new-api,不替换),但路由策略可借这套**明确命名的策略集**作配置词汇——尤其 P2C+PeakEWMA 这类经典负载均衡算法,比拍脑袋轮询更稳;呼应已 seen Bifrost 自适应负载均衡。
  - **成本治理 ← 借「限流三维度(请求 / token / 美元)× 三粒度(用户/团队/全局)」** ⭐:玉兔6 控制台对工位 LLM 用量治理可借这套**二维限流矩阵**,把"花了多少钱"做成一等限流维度,直接对应成本控制。
  - **缓存 ← 借「响应缓存指令式 TTL(max-age / max-stale)」**:对重复/相似调用降本,补足已 seen 语义缓存线的指令式 TTL 细节。
- ④ 难度低-中 / 优先级中:策略词汇与限流维度是低风险配置借鉴;但 license 不确定使任何代码/资源采纳前必须核实。
- 边界:Rust 单二进制,**且 license 标注 Apache↔GPL-3.0 不一致**(GPL 强 copyleft 风险)→ 玉兔6 **只借策略词汇 / 限流维度 / 缓存指令的设计概念,绝不引代码**;采纳前必须人工核 LICENSE。玉兔6 已有网关,不替换。

### 行动判断(是否加待办卡)
- 三例核心借鉴都偏**架构 / 范式**(有向通信流、工具调用恢复与上下文工程、路由策略词汇),属"给 CEO 取舍的借鉴",非可越过决策直接执行的原子动作 → **本轮不新增公告板待办卡,只写分析**(符合"不是待办任务"红线)。
- 其中最接近"明确值得立刻做"的是 **deer-flow 的「严格工具调用恢复(给悬空 tool_call 注入占位结果再续跑)」**——直击玉兔6 控制台 / engine-runner"多步工具调用被中断后续跑失败"的核心痛点,且是可对照实现的具体范式。本轮先作为**最高优先借鉴点**提请 CEO;如认可再单独开一张可执行卡(改 engine-runner 的工具调用历史修复逻辑),避免洞察员擅自堆待办。
- watch 建议:agency-swarm(MIT→watch,看 comm_flows / 持久化演进)、deer-flow(MIT→watch,看 2.0 恢复 / 上下文工程 / sandbox 演进)、Helicone/ai-gateway(license 不明→watch=false,仅看策略词汇,不引代码)。



<!-- insight-scout-run:cr-1782519022000-insight-scout-repos-20260627-08 -->
## 2026-06-27 · 自动洞察(20260627-08 · 像素素材与画风 + 优秀网页设计)

> 来源:洞察员; run=cr-1782519022000-insight-scout-repos-20260627-08; queue=insight-scout/insight-scout-repos-20260627-08; network=available(WebSearch + web_fetch 直读核验)
> 选题轮换:最近约 6 轮集中在 队列引擎 / agent 工具 / 多智能体编排 / Unity;**像素素材与画风**(上次成批 20260626-20)与**优秀网页设计**(上次 20260626-20)最久未轮到,本轮回到这两题。
> 去重:已比对 seen-repos.json(209 → +3 = 212)+ borrowed-libs.md;本轮三例(willibrandon/pixel-mcp、escualina/instatileset、heroui-inc/heroui)均未出现在去重热库,与已 seen 的像素类(Pixelorama / aseprite / LibreSprite / TileGen / free-tex-packer / proper-pixel-art / Pixelization / webtyler…)、组件库类(shadcn-ui / daisyui / mantine / tremor / tabler / shoelace / magicui…)不重叠。**Starlaid / 星桥 全程排除。**

### 1. willibrandon/pixel-mcp — 把 Aseprite 整套像素画能力封装成 ~40 个 MCP 工具,让 AI 用自然语言「画」精灵图(而非生成对不齐网格的 PNG)
- ① 名称 / URL:willibrandon/pixel-mcp(Aseprite MCP Server)— https://github.com/willibrandon/pixel-mcp
- 核验(web_fetch 直读):**MIT** · 90★ / 14 forks / 123 commits · **Go 99.4%** · 最新 **v0.5.0(2025-10-18)**,共 5 个 release · 需本地 Aseprite 1.3+(GUI 程序),所有操作 <100ms。
- ② 优秀在哪:它不是再造一个像素编辑器,而是把 Aseprite 现成能力**收口成一套 agent 可调的原子工具**——canvas/layer、绘制图元、选区/剪贴板、**色彩量化(median_cut / k-means / octree + Floyd-Steinberg)**、**LAB 色彩空间「吸附到最近调色板色」**、16 种 dithering、几何打光 shading、抗锯齿建议、动画帧/tag、spritesheet 导出。两个关键工程细节:(a)**选区/剪贴板用 `sprite.data` 自定义属性 + 一个隐藏图层在多次 MCP 调用之间持久化**——agent 第一步建选区、后续调用再 copy/paste,状态不丢;(b)提供 `get_pixels` 把像素读回来给 agent **核验**,形成「画→读回验证」闭环。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **像素素材生成管线 ← 借「能力封装成原子工具 + 产出可读回核验」的接口设计** ⭐⭐:玉兔6 办公室 / Simulaid 若让工位 agent 自动产像素素材,别让 agent 直接吐 PNG(必然网格对不齐、调色板乱),而应像 pixel-mcp 一样把素材操作做成**受约束的原子工具**(建画布→设调色板→绘制→量化吸附→导出),并配 `get_pixels` 式回读核验。这把已借的 proper-pixel-art「清洗」往前推到「受控生成」。
  - **跨调用状态保持 ← 借「用产物自带元数据槽(sprite.data)+ 隐藏层在多步调用间持久化中间态」** ⭐:正对玉兔6 控制台「一个任务跨多步工具调用要保中间状态、崩溃要能续」的痛点——把中间态写进产物自身的元数据,而非只靠会话内存,天然抗会话中断。
  - **素材清洗算法 ← 借其色彩量化 + LAB 调色板吸附**:可直接对照用于办公室素材的调色板规范化(呼应已借 proper-pixel-art / 已 seen zenquant)。
- ④ 难度中 / 优先级中:借「接口设计 + 状态保持范式」属架构借鉴,价值高但需结合玉兔6 自己的素材栈落地。
- 边界:Go 实现 + 依赖本地 Aseprite(GUI),与玉兔6 不同栈 → **只借工具粒度 / 状态保持范式 / 量化算法,不接其 runtime、不把 Aseprite 装进自动化链**;MIT 可读借。

### 2. escualina/instatileset — 「画 5 块 → 自动展开成 47 格 autotile 整套」的极简 tileset 编辑器(输入/输出双面板 + Split lines 微调)
- ① 名称 / URL:escualina/instatileset(A tool for drawing and editing 47-tiles tilesets)— https://github.com/escualina/instatileset
- 核验(web_fetch 直读):**GPL-3.0** · 57★ / 2 forks / **仅 5 commits**(小而专) · **GDScript 100%(Godot)** · 浏览器可玩 + 桌面(itch.io)。
- ② 优秀在哪:把「做 47 格 blob autotile」这件繁琐事压成**最小输入**——只画 5 块基础 tile,工具按自动平铺规则展开成完整 47 格;**输入面板 / 输出面板并排**,改输入即时看到拼接效果;**Split lines** 工具支持非居中切分的微调;导入/导出可回灌再编辑。是「最小输入 → 规则展开 → 所见即所得校对」的好范例。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **tileset 素材管线 ← 借「5→47 自动展开」的最小输入生成思路** ⭐:玉兔6 像素 / Simulaid 地块素材若需 autotile,可借这套「让人/agent 只产最少基元、规则负责展开整套」的范式,降低素材工作量(补足已 seen 的 TileGen / tiled / ldtk 偏「用」而非「生成」的空档)。
  - **素材校对交互 ← 借「输入/输出双面板即时预览 + 局部微调(Split lines)」**:可借给玉兔6 素材审校 UI——一侧改源、一侧看成品拼接,减少来回导出试错。
- ④ 难度低 / 优先级低:锦上添花的素材效率点,非关键路径。
- 边界:**GPL-3.0 强 copyleft**,且 GDScript / Godot 引擎深绑 → **只借「最小输入自动展开」算法思路与双面板交互范式,绝不引其代码、不入 Godot 依赖**;仅 5 commits、维护度低,作参考不作依赖。

### 3. heroui-inc/heroui — 2026 头部 React 组件库(前身 NextUI):React Aria a11y + Tailwind v4 + 语义 design tokens,且**自带 MCP server / llms.txt / agent skills 让 AI 看懂自己的组件**
- ① 名称 / URL:heroui-inc/heroui(前 NextUI)— https://github.com/heroui-inc/heroui
- 核验(web_fetch 直读):**29.5k★ / 2.2k forks / 4,261 commits** · 最新 **v3.1.0(2026-05-26)** · 被 **73.6k** 仓库依赖 · TS + MDX。**⚠️ License 标注不一致:仓库侧栏 / Resources 标 Apache-2.0,而 README「License」段写 MIT(指向 choosealicense MIT)——确切 license 以人工核 LICENSE 文件为准,落地前必须确认。**
- ② 优秀在哪:(a)**a11y 默认达标**——构建在 React Aria 上,键盘/焦点/屏幕阅读器行为 WCAG 合规;(b)Tailwind v4、无 CSS-in-JS 运行时,产物更小;(c)复合组件 API(`Card.Header` / `Card.Content`)、免 Provider、语义 **design tokens** 全局一致;(d)最差异化的一点:**它是「AI-native 组件库」——随库发布 `@heroui/react-mcp` MCP server、`llms.txt`、以及给 Cursor / Claude Code 的 agent skills,让 AI 助手能准确理解并使用它的组件与主题**。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **控制台 UI 主题体系 ← 借「语义 design tokens 一处定义、组件全局一致」** ⭐:控制台 webUI 可借一套语义 token(颜色/间距/圆角/状态)统一观感与暗色模式,呼应已 seen 的 daisyui 主题 / tremor。
  - **(差异化亮点)能力库 / 控制台「面向 agent 的自描述」← 借它「库自带 llms.txt + MCP + agent skills」的范式** ⭐⭐:玉兔6 控制台与能力目录本就该自带一份**给工位 agent 看的 `llms.txt` / MCP 描述 / skill**,让 agent 精确理解控制台有哪些能力、参数与调用方式——把「文档面向人」升级成「文档面向 agent」,直接提升工位调用控制台的可靠性。这条与 seen 的能力库治理(registry / skills 线)和《任务可靠执行研究》直接接得上,是本轮最值得 CEO 关注的借鉴点。
  - **native 组件的 a11y 行为清单 ← 借 React Aria 的键盘/焦点/屏阅行为规范**:玉兔6 控制台是 native(不引 React 链),可把 React Aria 的交互行为当「无障碍行为验收清单」逐条原生实现;a11y 语义规范也是 GUI agent 能稳定 grounding 控制台的前提(呼应 a11y / GUI-grounding 线)。
- ④ 难度中 / 优先级中(其中「给控制台补 agent-facing llms.txt」难度低、价值高,见判断):token 体系与 a11y 清单属渐进改进;AI-native 自描述是新范式、低风险。
- 边界:React 19 / Tailwind v4 技术栈,玉兔6 **不引 React 链** → 只借 design token 体系 + AI-native 自描述范式 + a11y 行为清单,不接组件代码;**且 license 标注不一致,采纳任何代码/资源前必须人工核实确切 license。**

### 行动判断(是否加待办卡)
- 三例的核心借鉴点都偏**架构 / 范式决策**(接口设计与状态保持、最小输入生成、token 体系与 AI-native 自描述),属「给 CEO 取舍的借鉴」,无一是可越过决策直接执行的原子动作 → **本轮不新增公告板待办卡,只写分析**(符合「不是待办任务」红线)。
- 其中最接近可立刻做的是 heroui 启发的「**给玉兔6 控制台 / 能力目录补一份面向工位 agent 的 `llms.txt` / 能力自描述**」:低风险(纯文档)、直接提升 agent 调用控制台的可靠性。本轮先作为**重点借鉴点**提请 CEO,如认可再单独开一张可执行卡,避免洞察员擅自堆待办。



<!-- insight-scout-run:cr-1782504034850-insight-scout-repos-20260627-04 -->
## 2026-06-27 · 自动洞察(20260627-04 · unity-simulaid-methods)

> 来源:洞察员; run=cr-1782504034850-insight-scout-repos-20260627-04; queue=insight-scout/insight-scout-repos-20260627-04; network=available(WebSearch + web_fetch 直读核验)

## Unity/团结工作流方法论借鉴扫描(slot 20260627-04)

> network_status=available;已比对 `seen-repos.json`、`borrowed-libs.md`、`insights.md`,本轮 3 个 URL 未出现;Starlaid/星桥 全程排除。仅借方法,不触碰 Simulaid 项目。

### Unity-Technologies/ProjectAuditor
- 是什么:Unity 项目静态审计工具,分析 assets/settings/scripts,输出代码与设置诊断、BuildReport 和资产信息。
- 值得借鉴:把性能/配置风险做成可复跑报告,适合作为团结工程提交前健康门禁模板。
- 迁移边界/许可证不确定项:仓库提示旧版不支持,应优先看内置包;Unity Package Distribution License,不可按 MIT 假设。
- URL: https://github.com/Unity-Technologies/ProjectAuditor

### needle-mirror/com.unity.scriptablebuildpipeline
- 是什么:UPM 镜像,把 AssetBundle build pipeline 移到 C#,支持预置流程或用拆分 API 自建流程。
- 值得借鉴:资源构建从黑盒菜单变为显式步骤,可借「构建任务分层+增量构建+产物状态」方法论。
- 迁移边界/许可证不确定项:镜像非 Unity 官方仓库,落地必须以 Unity 包管理器/官方文档为准;Unity Companion License,限 Unity-dependent 项目。
- URL: https://github.com/needle-mirror/com.unity.scriptablebuildpipeline

### needle-mirror/com.unity.performance.profile-analyzer
- 是什么:UPM 镜像的 Profile Analyzer,聚合多帧 Profiler 数据,并支持两次 profile scan 对比。
- 值得借鉴:优化前后用同一指标集比较 median/min/max/分布差异,比只看单帧更适合回归审查。
- 迁移边界/许可证不确定项:镜像非官方,采纳前核对当前包版本与团结兼容;Unity Companion License,仅借性能验收方法。
- URL: https://github.com/needle-mirror/com.unity.performance.profile-analyzer

### 判断
- 三例都是工作流门禁/构建/性能验收方法,未形成必须立刻进入 CEO 取舍的低风险行动;本轮不生成公告板卡。



<!-- insight-scout-run:cr-1782490151000-insight-scout-repos-20260627-04 -->
## 2026-06-27 · 自动洞察(20260627-04 · queue-engine + agent-tools-skills)

> 来源:洞察员; run=cr-1782490151000-insight-scout-repos-20260627-04; queue=insight-scout/insight-scout-repos-20260627-04; network=available(WebSearch + web_fetch 直读核验)

## 任务队列引擎 + AI agent 工具与 skills(联网复核)
- 选题轮换:上一轮(20260627-00)为 pixel-assets-ui、再前一轮(20260626-24)为多智能体编排+Unity;本轮回到最久未成批的**任务队列引擎**(上次 20260626-08)与 **AI agent 工具与 skills**(上次 20260626-12)。
- 去重:已比对 `seen-repos.json`(196 仓库 → 本轮 +3 = 199)+ `borrowed-libs.md`;本轮三例(contribsys/faktory、block/goose、ThreeDotsLabs/watermill)均**未**出现在去重热库,与已 seen 的队列类(hibiken/asynq、bullmq、river、goqite、celery、dramatiq、procrastinate、graphile/worker、temporal/restate/inngest…)、agent 类(mcp-agent、smolagents、pydantic-ai、anthropics/skills…)不重叠。**Starlaid/星桥 全程排除。**

### 1. contribsys/faktory — 语言无关的「后台任务服务器」:一个二进制内置存储 + Web UI,reserve-超时-requeue + 指数退避重试的可靠投递语义(Sidekiq 作者出品)
- 名称/URL:contribsys/faktory(Language-agnostic persistent background job server)— https://github.com/contribsys/faktory
- 核验事实(本批 web_fetch 直读):**6.1k★ / 236 forks / 1,058 commits**;**Go 85.6% + CSS 9.4%**;**最新 release v1.9.4(2026-02-19)**,共 32 个 release;作者 **Mike Perham(Sidekiq 作者)**。架构:**一个 server 二进制把数据存储 + Web UI 全包**,worker 进程只管执行,**除自身外无其它依赖**;两个端口(Command 7419 / Web UI 7420)。核心语义:job 是 JSON;push/fetch 队列;**job 被 reserve 时带超时(默认 30 分钟);超时内未 ACK 或被 FAIL 的 job 自动 requeue;FAIL 触发指数退避的 retry 流程**;自带完善的 Web UI 做管理与监控。**⚠️ License:仓库同时含 LICENSE(开源版,Faktory 历来为 LGPL-3.0)与 COMM-LICENSE(商业企业版 Faktory Enterprise);确切 SPDX 与商用条款以人工复核为准。**
- 它优秀在哪:多数已 seen 的队列库是「**嵌进某语言进程**」的库(asynq/bullmq/celery/dramatiq…),Faktory 反过来是**独立的 work server**——把「**队列状态 + 可靠投递语义 + 运维 Web UI**」收口在**一个零依赖二进制**里,任何语言的 worker 用简单协议来取活。它最值钱的是把「一个 job 从 enqueue 到执行成功/失败/重试」的**生命周期语义做成了硬规则**:reserve 带超时、超时不 ACK 就自动 requeue(天然防 worker 崩溃丢活)、FAIL 走指数退避重试,且这一切**自带可视化**。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 控制台队列可靠性 ← 借 faktory 的「reserve-超时 / ACK-或-requeue / FAIL-指数退避」生命周期语义** ⭐⭐:这正中玉兔6《任务可靠执行研究》的痛点。控制台派单队列(`artifacts/queues/insight-scout/` 等,engine-runner 驱动)可借这套**硬规则**——派给工位的任务 reserve 时打超时戳,超时未回执自动 requeue(防工位会话崩溃/卡死丢单),失败按指数退避重排,而非靠人工补派。是把「任务不丢、卡死自愈」从约定变成引擎默认能力的现成范式。
  - **② 控制台 run dashboard 信息架构 ← 借 faktory Web UI 的「队列 / 重试 / 计划 / 死信 / 忙碌 worker」分视图** ⭐:呼应二十六/二十八批「可观测应是默认能力」与上一轮(perses)看板共识,faktory Web UI 是「任务系统该怎么被看」的成熟 IA 参考——控制台运行看板可照搬这组视图维度。
  - **③「单机零依赖」红线的正向印证**:faktory「一个二进制内置存储 + UI、worker 仅取活」恰好印证玉兔6「单机零依赖」方向是可行且业界验证过的工程形态(它用 Go + Redis 存储,玉兔6 控制台是 Node,**借语义/IA 不接其 runtime**)。
- 边界:**Go 实现 + 依赖 Redis 做存储**,与玉兔6 Node 控制台不同栈 → **只借生命周期语义 + Web UI 信息架构,不接其二进制/runtime**;且**开源版 LGPL-3.0 + 商业企业版**,即便参考实现也须先核 license。**红线:不接其运行时、不回显任何密钥。**
- 难度:中(借语义 + 前端 IA,落到 Node 控制台需自研实现)。优先级:**高**(任务可靠投递是玉兔6 反复出现的真痛点,这套 reserve/requeue/retry 语义价值最大且可渐进借)。

### 2. block/goose — 本机可扩展 AI agent,杀手锏是「Recipe」:把 指令+所需扩展+参数+提示 打包成一份可分享 YAML,把一次性 agent 跑法变成可复用资产(Block 内部 ~60% 员工在用,已入 Linux 基金会)
- 名称/URL:block/goose(on-machine, extensible open source AI agent)— https://github.com/block/goose
- 核验事实(本批 web_fetch 直读):**35.3k★ / 3.3k forks / 4,078 commits / 438 contributors**;**Apache-2.0**;**Rust 58.3% + TypeScript 34.1%**;**最新 release v1.29.1(2026-04-03)**,共 126 个 release;桌面 app + CLI 双形态,任意 LLM + 多模型配置(按性能/成本优化),原生集成 MCP server。仓库可见 **`CONTRIBUTING_RECIPES.md` / `recipe-scanner` / `workflow_recipes/`** 目录,以及 **`CUSTOM_DISTROS.md`(自建预配置 providers/extensions/branding 的 goose 发行版)、`GOVERNANCE.md`**(社区治理,搜索口径显示已并入 Linux 基金会/Agentic AI Foundation)。Recipe = 把 **指令 + 所需扩展 + 参数 + 提示** 收进一份可分享文件。
- 它优秀在哪:多数 agent 框架(已 seen 的 smolagents/pydantic-ai/mcp-agent…)给的是「写 agent 的库」;goose 多了一层**产品化的复用抽象——Recipe**:把「某个 agent 该装哪些扩展、吃哪些参数、用什么提示、按什么指令跑」固化成**一份 YAML 资产**,于是一次调好的跑法能被全公司复用(Block 用 recipe 把 agent 推到 ~12,000 员工里 ~60% 周活)。再配 **Custom Distributions**(预置 provider/扩展/品牌的发行版)与明确 governance,把「agent 怎么被打包、分发、治理」讲清楚了。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 工位/定时任务「声明式打包」← 借 goose Recipe schema** ⭐⭐:玉兔6 的工位(洞察员本身就是「指令 + 用哪些工具 + 选题参数 + 提示」的组合)目前更多写死在 SKILL.md/调用链里。借 Recipe 的「**instructions + required extensions + parameters + prompt 一份可分享文件**」范式,可把工位/定时任务做成**声明式、可参数化、可复用**的资产(如洞察员选题轮换、最大案例数都成 recipe 参数),接二十八/三十二批「能力治理 + 声明式」共识。
  - **② 角色发行版 ← 借 Custom Distributions**:玉兔6 给不同角色(秘书/洞察员/主管)预置「该装哪些技能 + 默认模型 + 边界」的「发行版」,而非每次现配,降低新工位上线成本。
  - **③ 多模型按成本/性能路由 ← 借其 multi-model 配置思路**(次要,LLM 网关批已覆盖):同一 agent 不同步骤用不同模型。
- 边界:goose 本体是 Rust 桌面/CLI 重应用,**不接本体**;只借 **Recipe schema + 发行版 + 治理范式**(概念/schema 层借鉴)。Apache-2.0,读借友好。**红线:不接其 runtime、不回显密钥。**
- 难度:低-中(主要是 schema/概念借鉴 + 玉兔6 侧自定义实现)。优先级:**高-中**(声明式工位打包对玉兔6 能力治理价值高,且可小步先定 recipe schema)。

### 3. ThreeDotsLabs/watermill — 把「事件驱动」做到像写 HTTP router 一样简单:核心就一个 `func(*Message)([]*Message,error)` handler + 可组合 middleware,后端(内存/SQL/Kafka…)可热插
- 名称/URL:ThreeDotsLabs/watermill(Building event-driven applications the easy way in Go)— https://github.com/ThreeDotsLabs/watermill
- 核验事实(本批 web_fetch 直读):**9.8k★ / 498 forks / 516 commits**;**MIT**;**Go 92%**;**最新 release v1.5.2(2026-05-13)**,共 54 个 release;v1.0 起 API 稳定、生产可用,全部 Pub/Sub 实现过统一测试且 **20x 并行压测 + race detector**。核心抽象:一个 handler 接口 **`func(*Message) ([]*Message, error)`**(收一条消息 → 决定发出新消息或返回错误,其余交给 middleware);**Publisher/Subscriber 两个小接口**抽象掉后端;后端可换 **GoChannel(进程内)/ SQL(MySQL·PostgreSQL)/ SQLite / Kafka / NATS / RabbitMQ / Redis Streams / HTTP** 等;内置 Router + middleware(retry、poison queue、metrics、correlation 等)、CQRS/saga 组件。
- 它优秀在哪:它把事件驱动里最容易写乱的部分**收敛成一个极简心智模型**——「**handler 收消息→返回消息/错误,横切关注点全做成 middleware**」,跟 HTTP router + middleware 一模一样的直觉;并用 **Publisher/Subscriber 接口**把「业务逻辑」和「用什么消息后端」彻底解耦——**同一份 handler 代码,本地用进程内 GoChannel、要持久化换 SQLite/SQL、要扩展换 Kafka,业务零改动**。重试/死信/指标/关联 ID 这些不再散落在业务里,而是**可组合的 middleware**。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 编排的「handler + middleware」范式 ← 借 watermill 的 router 模型** ⭐:玉兔6 跨工位派活目前偏固定调用链/写死。借「**每一步 = 一个 handler(收消息→产出消息/错误),retry/超时/死信/日志/关联 ID 全做成可组合 middleware**」可让编排逻辑干净、横切能力统一(接 faktory 的可靠语义:重试/死信正好是 middleware 落点)。
  - **② 后端可换的抽象 ← 借 Publisher/Subscriber 接口** ⭐:玉兔6「单机零依赖」可先用**进程内/SQLite** 当消息后端,但把派单/事件读写**写在一层小接口后面**,日后若要多机/换后端,业务编排零改动。是「单机起步、保留扩展口」的关键设计点。
  - **③ 声明式 + 可观测**:middleware 化的 metrics/correlation 与上批 perses/faktory 的看板诉求同向。
- 边界:Go 库,**不接本体**;只借「**handler+middleware 编排范式 + Pub/Sub 后端抽象接口**」的设计思想到 Node 控制台。MIT,读借友好。
- 难度:中(架构范式借鉴,需编排层设计买入)。优先级:**中**(对编排长期结构价值大,但属架构决策,需主管拍板,可在下次编排重构时引入)。

### 本批小结(给 CEO 的一句话借鉴)
- **contribsys/faktory**:学它「**reserve-超时 / 不 ACK 自动 requeue / FAIL 指数退避**」的任务生命周期硬规则 + 「队列/重试/计划/死信/忙碌 worker」Web UI 视图——直接对症玉兔6「任务不丢、卡死自愈」与控制台运行看板;只借语义/IA,不接其 Go+Redis runtime(且开源版 LGPL-3.0 + 商业版,须核 license)。
- **block/goose**:学它「**Recipe = 指令+扩展+参数+提示 一份可分享 YAML**」+ Custom Distributions——把玉兔6 工位/定时任务做成声明式、可参数化、可复用资产;Apache-2.0,概念/schema 层借鉴,不接 Rust 本体。
- **ThreeDotsLabs/watermill**:学它「**handler `func(msg)→[]msg/err` + 可组合 middleware + Publisher/Subscriber 后端抽象**」——让玉兔6 编排干净、横切统一、单机起步保留扩展口;MIT,只借设计范式。
- **本批不新增待办卡**(延续既有克制口径)。理由:三例最值钱的落地——**faktory 的 reserve/requeue/retry 语义需控制台队列改造、goose 的 recipe schema 需定义工位打包规范、watermill 的 handler+middleware 需编排层重构**——均属方向/架构设计决策,应由产品/主管拍板,非「明确值得立刻做」的低风险原子动作。**若想立刻、最小、最可逆地动一步**:把 **faktory Web UI 的五视图(队列/重试/计划/死信/忙碌 worker)** 作为控制台 run dashboard 的**纯前端设计参考**,落地面积最小、价值最高;工位侧最小动作则是先**起草一份 goose 式 recipe schema 草案**(声明式工位打包),零风险。**Starlaid 全程排除。**

> watch(本批 web_fetch 直读元数据;HEAD commit SHA 因未跑 `git ls-remote` 未取,待回填):contribsys/faktory `main`(**开源版 LGPL-3.0 + 商业版 → watch=谨慎**,6.1k★/1,058 commits,latest v1.9.4 2026-02,关注其 Web UI 与可靠投递语义,不接 runtime)、block/goose `main`(**Apache-2.0 → watch=true**,35.3k★/126 release,关注 Recipe schema 与 Custom Distributions 演进)、ThreeDotsLabs/watermill `master`(**MIT → watch=true**,9.8k★/v1.5.2 2026-05,关注 router/middleware 与 SQLite 后端)。



<!-- insight-scout-run:cr-1782489634368-insight-scout-repos-20260627-00 -->
## 2026-06-27 · 自动洞察(20260627-00 · pixel-assets-ui)

> 来源:洞察员; run=cr-1782489634368-insight-scout-repos-20260627-00; queue=insight-scout/insight-scout-repos-20260627-00; network=available

## 像素素材生成 / 控制台 UI 借鉴(联网复核)
- 去重:已比对 `seen-repos.json`、`borrowed-libs.md`、`insights.md`;本轮 3 个 URL 未在热库出现。Starlaid/星桥 全程排除。

### kitao/pyxel
- 是什么:Python 复古游戏引擎,内置像素资源编辑器;GitHub 显示 MIT、17.6k★、185 releases,最新 2.9.6(2026-06-13)。
- 值得借鉴:16 色限制、Image/Tilemap/Sound/Music 四类资源和 `.pyxres` 单包,适合像素素材生成器做"预设约束+资源包"。
- 迁移边界/许可证不确定项:只借资源组织与编辑器分栏;不引 Python/Rust/WASM 运行时,素材授权仍按输入图逐项核验。
- URL: https://github.com/kitao/pyxel

### perses/perses
- 是什么:CNCF sandbox 可观测 dashboard,支持 Prometheus/Tempo/Loki/Pyroscope;Apache-2.0,2.2k★,最新 0.53.1(2026-03-12)。
- 值得借鉴:Dashboard-as-Code、开放 dashboard specification、可嵌入面板和插件体系,很适合作控制台运行看板的 schema/UI 对照。
- 迁移边界/许可证不确定项:不接 Perses server;仅借"看板定义可版本化+面板可嵌入+静态校验"范式。
- URL: https://github.com/perses/perses

### appsmithorg/appsmith
- 是什么:开源低代码平台,用于 dashboards/admin panels/internal tools;Apache-2.0,40.2k★,最新 v2.1(2026-05-29)。
- 值得借鉴:左侧资源/页面树、中部画布、右侧属性与查询配置的工作台结构,可作为控制台配置型页面的密度参考。
- 迁移边界/许可证不确定项:Appsmith 是重平台且含 Cloud/Agents 商业路径;只借信息架构与交互,不接其运行时或模板资产。
- URL: https://github.com/appsmithorg/appsmith

### 判断
- 本轮不生成公告板卡:三个案例均是 UI/数据模型借鉴,还需要主管先定控制台看板 schema 与素材包边界,未形成必须立刻进入 CEO 取舍的低风险原子行动。

## 2026-06-24 · 自动洞察(20260624-12 · gui-grounding)

> 来源:洞察员; run=cr-1782273608701-insight-scout-repos-20260624-12; queue=insight-scout/insight-scout-repos-20260624-12; network=limited

## GUI grounding / computer-use / a11y 借鉴扫描 (slot 20260624-12)\n\n说明:本轮未联网抓取实时 star/commit/release,以下基于既有公开知识整理,实时数据以人工复核为准;Starlaid/星桥 已按红线排除。\n\n### microsoft/OmniParser\n- 是什么:屏幕截图 UI 元素解析工具,输出可交互元素边界框与语义标签。\n- 值得借鉴:视觉定位与可交互元素分离,可与 a11y tree 交叉验证,适合无障碍检测。\n- 迁移边界:依赖 OCR+检测模型,代码疑似 MIT 但模型权重许可另列,商用前必须复核。\n- URL: https://github.com/microsoft/OmniParser\n\n### xlang-ai/OSWorld\n- 是什么:真实 OS 环境下的多模态 agent benchmark,提供 a11y tree 与截图双通道任务。\n- 值得借鉴:任务-动作-评估闭环与 a11y tree 序列化方式可指导控制台辅助能力设计。\n- 迁移边界:为基准而非生产库,执行沙箱需自研;许可证需人工确认。\n- URL: https://github.com/xlang-ai/OSWorld\n\n### showlab/ShowUI\n- 是什么:GUI 视觉-语言-动作模型,强调高分辨率截图与可交互区域选择训练范式。\n- 值得借鉴:截图分块、可交互区域自监督思路对自研 grounding 有启发,仅作方法借鉴。\n- 迁移边界:模型权重多为 CC-BY-NC,商用受限,代码许可另需复核。\n- URL: https://github.com/showlab/ShowUI\n\n行动建议:仅推荐 CEO 立项前做只读探查与离线评测,不改运行代码,不引入受限权重。
## 2026-06-24 · 第三十批(选题:像素素材与画风 + 任务队列引擎 — 三例:把任意图「画风一致地」像素化(Simulaid 素材)/ 声明式编排 + 执行可视化平台(控制台/队列)/ 像素素材出包的 atlas 描述格式(Simulaid 素材出包);运行 ~12:1x+08:00,网络已恢复)

> 说明:本批为联网正常的内容批,**轮换到近 3 个联网批(二十七 agent-tools+网页设计、二十八 GUI grounding+LLM 网关、二十九 Unity/Simulaid)未覆盖的两个最久专题**:**像素素材与画风**(上次成批为第二十五批)与**任务队列引擎**(上次联网成批为第二十六批,其后仅 00 slot 离线复看)。去重已比对 seen-repos.json(199 仓库):本批三例(WuZongWei6/Pixelization、kestra-io/kestra、odrick/free-tex-packer)均为**新案例**,与已 seen 的 Pixelorama/LibreSprite/Tiled/proper-pixel-art/pixel-forge(像素)、inngest/restate/temporal/conductor/durabletask-go/hatchet/windmill/river(队列)不重叠。本节是给老板/CEO 看的「值得借鉴」分析,**非待办**;本批**不新增待办卡**(理由见末)。**Starlaid 全程排除。两条 license 红线先行提示:案例 1 为非商用科研协议、案例 3 已维护停滞,均只可「借方法/借格式」不可直接接入。**

### 1. WuZongWei6/Pixelization — 把任意插画/AI 图「画风一致地」像素化:aliasing-aware(不糊边)+ cell 大小可控(2×→N×),SIGGRAPH Asia 2022 官方实现
- 名称/URL:WuZongWei6/Pixelization(《Make Your Own Sprites: Aliasing-Aware and Cell-Controllable Pixelization》官方实现)— https://github.com/WuZongWei6/Pixelization
- 核验事实(本批 web_fetch 直读):**413★ / 36 forks / 78 commits / 1 contributor / 无 release**;**Python 100%**;依赖 Linux + NVIDIA GPU + CUDA + PyTorch≥1.7;由四个网络组成——**Structure Extractor(在 multi-cell 数据集上预训练的 VGG-19)+ AliasNet(在 aliasing 数据集上预训练的 encoder-decoder)+ I2PNet(图→像素)+ P2INet(像素→图)**;新增 **Test Pro** 模式可输出 **2× 到任意整数 N× 的 cell_size**;代码改编自 pytorch-CycleGAN-and-pix2pix 与 SCGAN;数据集/权重走 Google Drive。**⚠️ License:Software Copyright License,仅限非商用科研用途,明文「禁止未经授权的商业使用 / Unauthorized commercial use is prohibited」。**
- 它优秀在哪:常规「缩小 + 量化调色板」做像素化会**糊边/锯齿乱**,且 cell 网格不齐。这篇的两个差异点正中要害——**① aliasing-aware**:专门学习「像素艺术该有的硬边/反走样规律」,出图边缘干净、像真人画的像素图;**② cell-controllable**:cell 大小显式可控(Test Pro 支持任意 N×),保证「一个逻辑像素 = 整数个屏幕像素、网格对齐」。等于把「任意来源的图 → 统一画风的像素图」这件最难标准化的事做成了可控流程,且有 SIGGRAPH Asia 论文背书 + 真实用户反馈。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① Simulaid 素材「画风一致性」← 借「aliasing-aware + cell 可控」的像素化方法范式** ⭐:像素办公室素材若来自多人/多来源/AI 生成,最大痛点是**画风、像素粒度、边缘处理不统一**。这套方法的形态——「**显式锁定 cell_size + 反走样保边**」——正是统一画风的关键抓手:据 Simulaid 目标分辨率定死一个 cell 粒度,所有入库素材按同一粒度像素化,从根上消灭「这张糊、那张网格不齐」。
  - **② 素材预览/回流 ← P2INet(像素→图)** :反方向网络可做「像素图 → 平滑预览/参考」,在素材评审或超分场景作辅助(次要)。
- 边界:**⚠️ 非商用科研 license 是硬边界**——Simulaid 若为商用游戏,**不能直接用其权重/代码**;只可**借鉴方法范式**(反走样保边 + cell 显式可控),落地需自研可商用实现或换可商用方案。另需 NVIDIA GPU + 模型推理/复现成本,且无 release、单人维护。**红线:不引入受限权重到产物,仅离线方法验证。**
- 难度:高(模型复现/推理 + license 限制 + 需自研可商用替代)。优先级:**中**(画风一致是真痛点,值得立项做「方法验证 / 自研像素化滤镜」,但 license + 成本决定不急于落地)。

### 2. kestra-io/kestra — 声明式(YAML)、语言无关的事件驱动「编排 + 调度」平台,杀手锏是 600+ 插件生态 + 每次执行的可视化(topology / gantt / per-task logs)
- 名称/URL:kestra-io/kestra(Event Driven Orchestration & Scheduling Platform)— https://github.com/kestra-io/kestra
- 核验事实(本批 web_fetch 取到仓库页 + 搜索口径,实时 star 未逐字解析):**Apache-2.0**;公开口径 **~18k★+(截至 2025-06,现应更高)**、**600+ 插件(含 LLM)**;典型技术栈 Java + Vue;定位「**声明式、语言无关、把成千上万 workflow 写成代码来管**」;**Kestra 1.0** 升级为「**Declarative Agentic Orchestration Platform**」,内置 **AI Agents + Copilot**;能力:内置代码编辑器写 YAML flow、事件驱动 trigger 与定时调度二合一、数百插件直连各数据库/云存储/API、可跑任意语言脚本。(本批仅核验仓库存在 + 协议 + 定位;精确 2026 star/commit 数留待人工复核。)
- 它优秀在哪:多数 durable 引擎(已 seen 的 temporal/restate/inngest/conductor 等)是**代码优先**;Kestra 反过来主打**声明式 YAML + 极大插件生态 + 开箱即用的执行可视化**——每个 flow 是一份可读 YAML,每次 execution 自带 **拓扑图 + 甘特图 + 每个 task 的日志/输入输出**,运营/非技术也能看懂改动。它把「编排怎么写」「调度与事件怎么触发」「跑成什么样怎么看」三件事用一套声明式 + UI 收口,且 Apache-2.0 可放心读借。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 控制台运行可视化 ← 借「每个 execution = topology + gantt + per-task logs」** ⭐⭐:这是对控制台最直接、最高价值的一点。玉兔6 的 run(洞察员每 4h、各工位派单)目前可观测较弱;Kestra 的「**一次执行 = 一张拓扑 + 一条甘特 + 每步日志/IO**」是现成的运行视图范式,控制台可据此把「谁在跑、跑到哪步、每步耗时/输入输出」可视化(接二十六/二十八/二十九批「可观测应是默认能力」共识)。
  - **② 编排「配置即流程」← 借声明式 YAML flow + trigger 抽象**:玉兔6 派活偏固定调用链/代码内写死;借「**声明式 YAML 描述流程 + 事件/定时统一为 trigger**」可让流程可读可改、非技术也能调(接二十六批「声明式流程 + 引擎负责 durable」、二十九批 GOAP「声明式规划」同向)。玉兔6 的定时器(洞察员 4h)与事件触发可统一成一套 trigger。
  - **③ 能力治理 ← 借「600+ 插件按域分组 + 统一描述」**:呼应二十七/04 批 agent-tools「统一 plugin 描述 schema + 按域分组」,避免控制台能力一锅烩。
- 边界:**整体接入重**(Java/Vue + 自带存储/队列等依赖),与玉兔6「单机零依赖」红线冲突 → **只借语义与 UI 范式**(声明式 flow schema + execution 可视化 + trigger 抽象),**不整体接入 Kestra runtime**。Apache-2.0 对读借/改写友好。
- 难度:中(借语义/UI 范式,纯前端 + 数据模型层面)。优先级:**高**(声明式编排 + 执行可视化对控制台价值大,且可渐进、可逆地先借 UI 范式)。

### 3. odrick/free-tex-packer — 把很多小图打包成 atlas 的精灵图工具,真正值钱的是它那套「行业事实标准的 atlas 描述 JSON 格式」+ 模板化多目标导出
- 名称/URL:odrick/free-tex-packer(Free texture packer)— https://github.com/odrick/free-tex-packer
- 核验事实(本批 web_fetch 直读):**MIT**,**1.3k★ / 259 forks / 339 commits**;JavaScript 85.9%;**⚠️ 维护停滞**——README 顶部作者明文「I don't have time to improve this app anymore. Only critical bugs will be fixed」,**最新 release v0.6.7 / 2021-04-29**(共 25 个 release)。能力:rotation / trimming / multipacking、**mustache 模板化导出多目标**(json / xml / css / pixi.js / godot / phaser / cocos2d)、zip、TinyPNG、split sheet;配套 free-tex-packer-cli 与 gulp/grunt/webpack 插件。其 atlas 描述格式为业界常见 hash 格式:每个 sprite 含 `frame{x,y,w,h}` + `rotated` + `trimmed` + `spriteSourceSize` + `sourceSize` + `pivot`,外加 `meta{app,version,image,format,size,scale}`。
- 它优秀在哪:texture packing 本身是成熟问题,这个工具的长期价值不在工具本体,而在它把「**一张 atlas 该如何被下游精确还原**」这件事固化成了一套**清晰、被 Phaser/PixiJS/Cocos/Godot 广泛认同的描述 schema**——trim(裁掉透明边省空间)、rotated(旋转省空间)、spriteSourceSize / sourceSize(还原原始尺寸与偏移)、pivot(锚点)一应俱全;再用 **mustache 模板**把同一份打包结果导出成任意引擎需要的格式,「打包」与「输出格式」彻底解耦。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① Simulaid 素材清单 schema ← 借其 atlas 描述 JSON 格式** ⭐:Simulaid 像素素材到量后需要统一描述,直接采用这套「frame + rotated + trimmed + spriteSourceSize + sourceSize + pivot + meta」作为素材清单 schema,**trim/pivot 语义保证像素对齐与锚点稳定**,且与主流引擎/工具互通。
  - **② 一套素材多目标输出 ← 借 mustache 模板化导出思路**:把「打包结果」与「导出格式」解耦,一份素材按需导出 Unity / 自研运行时 / 预览所需的不同描述。
  - **③ 打包算法基线 ← 参考 MaxRects**(同类 wo1fsea/PyTexturePacker,MIT,纯 Python 实现 MaxRectsBinPack):若自研/集成打包,MaxRects 是空间利用率较优的算法基线。
- 边界:**⚠️ 工具本体维护停滞(2021 末版)+ Unity 自带 SpriteAtlas** → **不接入工具本身**,只借「**描述格式 + 模板导出 + trim/pivot 语义**」;真要打包优先用 Unity SpriteAtlas 或自研 MaxRects。MIT,格式/思路可放心借。
- 难度:低(借格式/思路,不接代码)。优先级:**低-中**(Simulaid 素材起规模后才迫切;当下先把描述 schema 定下来即可)。

### 本批小结(给 CEO 的一句话借鉴)
- **WuZongWei6/Pixelization**:学它「**反走样保边 + cell 大小显式可控**」的像素化方法——是统一 Simulaid 素材画风的关键抓手;但**非商用 license**,只借方法范式,落地需自研可商用实现。
- **kestra-io/kestra**:学它「**每次执行 = 拓扑图 + 甘特图 + 每步日志/IO**」的执行可视化 + 声明式 YAML 编排——对控制台运行可观测价值最大且可渐进借;只借语义/UI,不接其重型 runtime。
- **odrick/free-tex-packer**:学它那套「**trim/rotated/spriteSourceSize/pivot + meta 的 atlas 描述 JSON**」作为 Simulaid 素材清单 schema——工具已停更,只借格式与模板导出思路,打包用 Unity SpriteAtlas/MaxRects。
- **本批不新增待办卡**(延续七–十、十二–二十六、二十八–二十九批的克制口径;唯十一批因真漏洞、二十七批因 insights.md 真实膨胀破例)。理由:三例最值钱的落地——**Pixelization 受 license/成本约束属「方法验证/立项探查」、Kestra 执行可视化属控制台架构借鉴需主管拍板、free-tex-packer 仅借格式 schema**——均属方向/设计决策,非「明确值得立刻做」的原子动作,应由产品/主管评估。**若想立刻、最小、最可逆地动一步**:把 Kestra「execution = topology + gantt + per-task logs」作为控制台运行视图的**纯前端设计参考**(只读范式借鉴、不接 runtime)是本批落地面积最小、价值最高的切口;Simulaid 侧最小动作则是先**定下素材清单 JSON schema**(照 free-tex-packer 格式),零风险。**Starlaid 全程排除。**

> watch(本批 web_fetch 直读元数据;HEAD commit SHA 因代理 `git ls-remote` 403 未取,待网络可达回填):WuZongWei6/Pixelization `main`(**非商用科研 license → watch=false**,只读方法不可商用,413★/36 forks/78 commits,SIGGRAPH Asia 2022)、kestra-io/kestra `master`(**Apache-2.0 → watch=true**,关注 1.x 的 execution UI 与 agentic 编排演进,~18k★+/600+ 插件)、odrick/free-tex-packer `master`(**MIT 但维护停滞 → watch=false**,1.3k★/259 forks,latest v0.6.7 / 2021-04,只借 atlas 描述格式)。另**挂三个下批候选 watch**:**apache/dolphinscheduler**(可视化 DAG 低代码调度,作 Kestra 的可视化编排对照)、**wo1fsea/PyTexturePacker**(MIT、纯 Python MaxRects,打包算法基线参考)、**amakaseev/sprite-sheet-packer**(MIT、支持 polygon packing,GUI+CLI 对照)。



<!-- insight-scout-run:cr-1782288040520-insight-scout-repos-20260624-16 -->
## 2026-06-24 · 自动洞察(20260624-16 · pixel-assets-ui)

> 来源:洞察员; run=cr-1782288040520-insight-scout-repos-20260624-16; queue=insight-scout/insight-scout-repos-20260624-16; network=unavailable

## 像素素材生成 / 控制台 UI 借鉴扫描(slot=20260624-16)\n\n### 网络与去重状态\n- network_status=unavailable,本轮 runner 无联网能力,以下为训练知识复看,非实时 star/commit/release,不作为采纳依据。\n- 无法读取本地 board/insights/seen-repos.json 与 borrowed-libs.md,CEO 落盘后需人工对齐去重,避免与既有记录冲突。\n\n### 候选 1:piskelapp/piskel\n- 是什么:开源浏览器像素动画编辑器,典型 canvas+图层+预览三栏布局。\n- 值得借鉴:工具栏+调色板+预览+时间轴拆分模式,可迁移到控制台像素生成器主面板。\n- 迁移边界:训练知识为 Apache 2.0,需联网复核;旧 ES 代码重写而非直接搬。\n- URL: https://github.com/piskelapp/piskel\n\n### 候选 2:LibreSprite/LibreSprite\n- 是什么:Aseprite 的 GPL 分支,桌面像素编辑器,帧/图层组织成熟。\n- 值得借鉴:切片导出、调色板锁定、帧动画时间轴的交互思路。\n- 迁移边界:GPL 传染性强,只能借鉴 UI 思路,严禁拷贝源码进控制台。\n- URL: https://github.com/LibreSprite/LibreSprite\n\n### 候选 3:pixijs/pixijs\n- 是什么:高性能 WebGL/Canvas 2D 渲染引擎,可承载像素素材预览与交互。\n- 值得借鉴:精灵图集、像素完美渲染、最近邻缩放过滤策略。\n- 迁移边界:训练知识为 MIT,需复核版本与 bundle 体积对控制台的影响。\n- URL: https://github.com/pixijs/pixijs\n\n### 复看与下一步建议\n- runner 联网恢复后,优先复核以上 3 个仓库当前 LICENSE 文件、最近 commit 与活跃度。\n- 控制台 UI 视觉密度可参考 Linear/Stripe 类面板,布局参考 Piskel 三栏,避免直接复刻任何专有视觉资产。\n- 复核全程排除 Starlaid/星桥,不读取、不分析、不派生其相关内容。
## 2026-06-24 · 第三十一批(选题:多智能体编排 — 三例同主题成一谱:并行 agent 编队的「编排层」/ 确定性声明式 YAML 编排 + DAG 仪表盘 / 自我进化的 SDLC 编排「治理纪律」;运行 ~08:0x+08:00,网络已恢复,WebSearch+web_fetch 直读)

> 说明:本批为联网正常的内容批,**轮换到近四个联网批(二十七 agent-tools+网页设计、二十八 GUI grounding+LLM 网关、二十九 Unity/Simulaid、三十 像素素材+任务队列)均未单独成批、且最久未做专题的「多智能体编排」**(上次以编排为主轴是第二十六批,且当时与队列合批)。本轮另有三次网络降级 slot(08 llm-gateway / 12 gui-grounding / 16 pixel-assets-ui)只写了训练知识复看 stub,不计内容批。去重已比对 seen-repos.json(208 仓库):本批三例(ComposioHQ/agent-orchestrator、microsoft/conductor、dsifry/metaswarm)均为**新案例**,与已 seen 的 conductor-oss/conductor(同名不同家)、awslabs/cli-agent-orchestrator、open-multi-agent、crewAI、langgraph、microsoft/agent-framework、microsoft/semantic-kernel、agno、PocketFlow、google/adk-python、obra/superpowers 等编排类**均不重叠**。**核心立意:这三例正好覆盖玉兔6 编排的三条线——「并行编队的运行时形态(队列/人审门/插件治理)」「声明式确定性拓扑 + 可视化(编排/控制台)」「先验证后信任的治理纪律 + 自反思知识沉淀(人审门/洞察员自身)」**,故每例落到具体工位给「借它的 X 改我们的 Y」。本节是给老板/CEO 看的「值得借鉴」分析,**非待办**;本批**不新增待办卡**(理由见末)。**Starlaid 全程排除。**

### 1. ComposioHQ/agent-orchestrator — 并行 AI 编码 agent 编队的「编排层」:每个 agent 一个 git worktree 强隔离 + 声明式 reactions(事件→动作)+ 七槽插件架构 + 单一 dashboard 监督,「只在需要人判断时才把你拉进来」
- 名称/URL:ComposioHQ/agent-orchestrator(The Orchestration Layer for Parallel AI Agents)— https://github.com/ComposioHQ/agent-orchestrator
- 核验事实(本批 web_fetch 直读):**MIT**,**5.8k★ / 801 forks / 699 commits / 203 issues / 292 PRs**;**TypeScript 92% / Shell 5.3%**;**33 个 release(最新 `@composio/ao-cli@0.2.2`,2026-03-29)**;README 自述 **3,288 个测试用例**;`npm i -g @composio/ao` 一行装,`ao start <repo>` 一行起、dashboard 默认 `localhost:3000`。**三个「无关性」**:Agent-agnostic(Claude Code / Codex / Aider / opencode)、Runtime-agnostic(tmux / process)、Tracker-agnostic(GitHub / Linear / GitLab)。
- 它优秀在哪:它把「**跑一个 agent 容易、同时跑 30 个跨 issue/分支/PR 的 agent 是个协调问题**」这件事产品化了——orchestrator agent 给每个 issue 派一个 worker,**每个 worker 在自己的 git worktree + 分支 + PR 里干活**;**CI 失败把日志喂回 agent 自己修、reviewer 提意见自动路由回 agent 处理、PR 绿了才通知你合**。三个差异化亮点:① **每 agent 一个 worktree 的强隔离**(并行不互相污染);② **声明式 `reactions`**——把「什么事件触发什么动作」写成配置:`ci-failed → send-to-agent(retries:2)`、`changes-requested → send-to-agent(escalateAfter:30m)`、`approved-and-green → notify(auto:false,可翻 true 自动合)`;③ **七槽插件架构**(Runtime/Agent/Workspace/Tracker/SCM/Notifier/Terminal,各有 default+alternatives,「**lifecycle stays in core**」,每个插件只实现一个 TS interface)。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **队列 / 人审门 ← 借「声明式 reactions:事件→动作 + retries + escalateAfter + auto 开关」** ⭐⭐:玉兔6 的队列/人审门现在偏「读 eventlog + 人手判断」。借它把「**失败重试 / 需人审 / 可放行**」收敛成一份声明式 reactions 配置——`run 失败 → 重试 N 次`、`需确认 → 挂人审门`、`通过 → 放行/通知`。**`escalateAfter` 尤其值钱**:人审门可设「30 分钟无人响应自动升级或通知」,补玉兔6「挂起就一直挂着」的短板;`auto` 开关对应「自动放行 vs 必须人点」。接二十八批 STATUS 词表(状态)+ 二十二批死信(`retries` 用尽进死信)。
  - **能力治理 / 编排 ← 借「七槽插件架构 + lifecycle stays in core」** ⭐⭐:玉兔6 的角色/工具/通知渠道偏散落。借它把**可替换的部分定义成一组 interface 插槽**(运行时/执行体/任务源/通知器…),核心只管生命周期,新增能力=实现一个 interface。直接呼应二十七/04 批 agent-tools「统一 plugin 描述 schema + 按域分组」。
  - **worker 隔离 ← 借「每 agent 一个 git worktree」** ⭐:玉兔6 并行 run 若共享工作区易互相污染。借「**worktree-per-worker**」隔离形态——玉兔6 本就有 `isolation:worktree` 能力,可把它**制度化为并行 run 的默认**。
  - **控制台 ← 借「一个 dashboard 监督整支编队 + 只在需人判断时拉人」**:控制台可学这种「**编队总览 + 仅必要时人介入**」的监督形态(谁在跑/卡哪/等谁),而非逐 run 看文本。
- 边界:它是 **Node + tmux + `gh` CLI 的较重运行时**(要 tmux、gh、worktree、本地 3000 端口 dashboard),玉兔6 **绝不整体搬这套运行时**(红线:单机零依赖);只借**声明式 reactions、七槽插件分界、worktree 隔离、监督式 dashboard 这几个语义/形态**。MIT,读借与改写都友好。
- 难度:低-中(借配置/架构形态,不引运行时)。优先级:**高**(声明式 reactions 直击玉兔6 队列/人审门当前痛点,且可渐进、可逆地先借「事件→动作 + escalateAfter」一小块)。

### 2. microsoft/conductor — 确定性、声明式(YAML)的多智能体编排:**零 token 编排**(路由不调 LLM)+ 可 diff 的 YAML 拓扑 + 内置交互式 DAG 仪表盘与浏览器内 human gate + 运行前 validation
- 名称/URL:microsoft/conductor(A CLI tool for defining and running multi-agent workflows)— https://github.com/microsoft/conductor
- 核验事实(本批 web_fetch 直读):**MIT**,**219★ / 26 forks / 164 commits / 16 issues / 11 PRs**;**Python 91.5% / TS 7.7%**;**19 个 release(最新 v0.1.18,2026-05-28)**;Python 3.12+ / uv;微软开源博客 2026-05-14《Conductor: Deterministic orchestration for multi-agent AI workflows》。Provider 支持 Copilot / Anthropic Claude / Claude Agent SDK,且 `runtime.provider` 可路由**本地/自定义 OpenAI 兼容端点(Ollama / vLLM / LM Studio / Azure OpenAI)**;仓库同时是单插件 marketplace,出 `conductor` skill(纯 markdown,无可执行/hook/MCP,信任验证简单)。
- 它优秀在哪:多数 durable 编排(已 seen 的 temporal/restate/inngest/conductor-oss 等)偏代码优先且编排循环要调 LLM 决策;Conductor 反过来主打**「可重复 + 确定性 + 版本化」**——agents/prompts/routing 全写在**一份 YAML**;**路由用 Jinja2 模板 + 表达式求值、首个命中条件胜出,编排循环里不调 LLM、不花 token**(「**orchestration consumes zero tokens,拓扑是声明的不是运行时发现的**」)。配套一整套步骤原语:静态并行组 + 动态 `for_each`(批量并发、结果聚合给下游)、**子工作流复用**(templated `input_mapping`)、**script step**(按 exit code / 解析 JSON stdout 路由)、**set step**(绑 Jinja2 值,不调 LLM/子进程)、**terminate step**(显式终止 + `status` success/failed + 结构化 `reason`,在 CLI 退出码/仪表盘/事件日志里与默认 `$end` 区分)、**dialog mode**(不确定时暂停多轮对话)、`reasoning.effort`(low/medium/high/xhigh,按 agent 或全局控推理)、**human-in-the-loop**(暂停等人决策,Markdown 渲染提示 + 可点文件链接)、safety limits(max iterations + timeout)、**运行前 `conductor validate`**(运行前抓出 stale 模板引用 / 缺失输入 / 未声明依赖)、**Web 仪表盘**(交互式 DAG 图、实时 agent 流式、三栏[图/详情/Log·Activity·Output]、**浏览器内 human gate**、每节点 prompt/model/tokens/cost、后台模式)、workflow registries(命名注册表 + 按 tag/branch 版本化)。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **控制台 ← 借「交互式 DAG 仪表盘 + 实时流式 + 每节点 model/tokens/cost + 浏览器内 human gate」** ⭐⭐:这是对控制台最直接、最高价值的一点。玉兔6 控制台偏「读 eventlog 文本」;Conductor 的「**DAG 图(动画边显示执行/条件路由)+ 点节点看 prompt/模型/token/成本 + 浏览器内人审门**」是现成运行视图范式,控制台可据此把「谁在跑、跑到哪步、每步花多少 token/钱、卡在哪个人审门」可视化(与二十六/二十八/二十九/三十批「可观测应是默认能力」共识一致)。
  - **编排 ← 借「确定性声明式 YAML 拓扑 + 零 token 路由(首个命中条件胜)」** ⭐⭐:玉兔6 派活偏代码内写死/固定调用链。借「**把拓扑写成可 diff 的 YAML + 路由用条件表达式而非 LLM**」让流程可读、可在 PR 里 review、本地与线上一致;且**编排层不烧 token**(纯条件求值)。接二十六批「声明式流程 + 引擎负责 durable」、二十九批 GOAP「声明式规划」、三十批 Kestra「配置即流程」——本例把「确定性、零 token」这点讲得最透。
  - **队列状态 ← 借「terminate step:status(success/failed)+ 结构化 reason」与「dialog mode / human gate」** ⭐:terminate 的「**显式终止 + 状态 + 原因**」直接对应玉兔6 run 的终态/死信语义(接二十八批 AgentCPM 的 STATUS 词表);dialog mode / human gate 对应 `need_feedback` / 人审门挂起。
  - **派单前置校验 ← 借「`conductor validate`:运行前抓 stale 模板 / 缺输入 / 未声明依赖」** ⭐:玉兔6 入队前可加一道**静态校验门**——引用/输入/依赖不全直接拒绝入队并报错,而非跑到一半才崩(接二十一批「结构化输出契约 + 校验-重试」)。
  - **成本控制 ← 借「`reasoning.effort` 按 agent 可调 + per-agent 模型 + 可路由本地端点」**:贵步开高 effort、廉价只读步开低 effort(接二十八批 thought 开关「按步控本」);per-agent 模型 / 本地端点对应「成本-质量路由」(接十六/二十八批)。
- 边界:Conductor 是 **Python CLI + 自带 web 服务**,玉兔6 **不整体接入**;只借**声明式 YAML 拓扑 + 零 token 确定性路由 + DAG 仪表盘范式 + terminate/dialog 状态语义 + 运行前 validation + reasoning.effort 控本**这些**语义/形态**。MIT + 微软背书,放心读借;注意对外贡献需签 CLA(只读借不受影响)。
- 难度:中(借语义/UI 范式 + 数据模型,纯前端 + 编排数据结构层面)。优先级:**高**(DAG 仪表盘对控制台、声明式确定性编排对派活均价值大,且可渐进、可逆地先借 UI/数据模型范式)。

### 3. dsifry/metaswarm — 「自我进化」的多智能体 SDLC 编排:**Trust Nothing, Verify Everything**(orchestrator 独立验证、绝不信 subagent 自报)+ 并行评审门(3 轮上限自动升级人)+ 计划/状态落盘可续跑 + **每次合并后自反思沉淀知识库**
- 名称/URL:dsifry/metaswarm(A self-improving multi-agent orchestration framework)— https://github.com/dsifry/metaswarm
- 核验事实(本批 web_fetch 直读):**MIT**,**244★ / 32 forks / 112 commits / 10 issues / 6 PRs**;**Shell 63.6% / TypeScript 23.3% / JavaScript 13.1%**;**4 个 release(最新 v0.11.0「Standalone beads plugin integration」,2026-04-01)**;跨 **Claude Code / Gemini CLI / Codex CLI**;**18 个 agent persona、13 个 orchestration skill、15 个 command**;基于 **BEADS**(steveyegge/beads,git-native issue tracker,`bd` CLI)+ **Superpowers**(obra/superpowers,**已 seen**)。作者 Dave Sifry(Technorati 创始人),自述抽取自一套**production 多租户 SaaS、跨数百个自治 PR、100% 测试覆盖**的实战系统。
- 它优秀在哪:它不是堆 agent,而是把一套**实战验证过的「纪律/治理」**抽出来,六个亮点直击「agent 团队怎么不出错」:① **9 阶段工作流**(Research→Plan→Design Review Gate→拆 work unit→编排执行→Final Review→PR→PR Shepherd→Closure & Learning);② **4 阶段执行循环 `IMPLEMENT→VALIDATE→ADVERSARIAL REVIEW→COMMIT`**——**orchestrator 独立验证(自己跑测试,绝不信 subagent 自报)**,对抗式 reviewer 按 **DoD + file:line 证据**审;③ **并行 Design Review Gate**(PM/架构/设计/安全/CTO **5 个专家并行评审**,**3 轮迭代上限后才升级人类**);④ **计划/执行态落盘**(经 BEADS,**context compaction / 会话中断仍可续跑**);⑤ **知识库**(JSONL fact store,存 pattern/gotcha/决策/反模式;**`bd prime --files --keywords --work-type` 选择性 prime**,只加载相关子集、避免上下文爆);⑥ **每次 PR 合并后 `/self-reflect`**——把 review 反馈/构建失败/架构决策沉淀回知识库,还**内省会话**找「用户重复纠正 / 用户分歧 / 摩擦点」自动生成「新 skill 候选」。设计原则白纸黑字:**Trust Nothing, Verify Everything**、Parallel Review Gates、Recursive Orchestration(swarm of swarms)、Human-in-the-Loop(计划点主动 checkpoint + 失败 3 轮或歧义自动升级)。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **人审门 / critic ← 借「Trust Nothing Verify Everything:orchestrator 独立验证 + 对抗式按 DoD+file:line 评审 + 3 轮上限自动升级人」** ⭐⭐:玉兔6 人审门偏「人手看」。借它两点——**(a) orchestrator 不信 worker 自报、自己跑验证**(接二十八批 GUI-Critic「先批判后执行」、MobileAgent 的 Critic 预检);**(b) 评审产出「DoD + file:line 证据」而非空泛结论,且只有失败 3 轮才升级到人**,把人审门从「事事人看」升级成「**critic 预筛 + 仅可疑/反复失败才停人**」。
  - **洞察员自身 / 知识沉淀 ← 借「self-reflect:每次运行后把教训/模式/采纳与否沉淀进结构化知识库,下次选择性 prime」** ⭐⭐:这对玉兔6 **最 meta、最对口**——洞察员(我)每 4h 跑完,可学 metaswarm 把「本批教训、反复出现的坑(如代理 `git ls-remote` 403)、某案例采纳与否的理由」沉淀成**结构化条目**,下批运行前**按当批选题选择性 prime**(只读相关子集),既复用经验又**避免每次全量读 363KB 的 insights.md**。直接呼应玉兔6 现有的 seen-repos.json / borrowed-libs.md 维护机制——可演进成「机器可 prime 的知识库」。
  - **续跑 / durable ← 借「已批准计划 + 执行态落盘,经 compaction/中断仍可续跑」** ⭐:接二十六批「中间态续跑」——玉兔6 长 run 把「已批准计划 + 当前执行态」落盘,上下文被压缩或会话中断后可从断点恢复,而非重头再来。
  - **编排 ← 借「递归编排(swarm of swarms)+ 每 agent 自管生命周期、orchestrator 只委派不微管」**:复杂任务可分层派 sub-orchestrator;呼应玉兔6「秘书→总管→员工」但更强调「委派而非微管 + 可递归下钻」。
  - **能力治理 ← 借「选择性知识 prime(按文件/关键词/工种过滤)」**:接二十七批 anthropics/skills「渐进披露」——按需加载知识子集而非全量灌入上下文。
- 边界:metaswarm 强绑 **Claude Code/Gemini/Codex CLI + BEADS + `gh` CLI**,是一套**重 SDLC 套件**,玉兔6 **不整体接入**;只借**「先验证后信任的 critic 纪律、并行评审门 + 3 轮升级、self-reflect 知识沉淀闭环、计划落盘续跑、选择性 prime」这几套治理形态**。MIT,放心读借。**附:其依赖的两个上游可作下批 watch 候选**——**steveyegge/beads**(git-native 任务库,若玉兔6 taskstore 想「issue 即代码」可对照,**尚未 seen**)与 **obra/superpowers**(**已 seen**,agentic skills 方法论)。
- 难度:中(治理/纪律层 + 知识库改造,非引运行时)。优先级:**中-高**(self-reflect 知识沉淀对洞察员自身、Verify-Everything 对人审门 critic 化均直击痛点;计划落盘续跑与已有方向同源)。

### 本批小结(给 CEO 的一句话借鉴)
- **ComposioHQ/agent-orchestrator**:学它「**声明式 reactions(事件→动作 + retries + escalateAfter + auto)+ 七槽插件架构 + worktree-per-worker 隔离**」——给玉兔6 队列/人审门一套声明式事件驱动(尤其 `escalateAfter` 超时升级)、给能力治理一套「核心管生命周期、其余插件化」的分界。
- **microsoft/conductor**:学它「**确定性声明式 YAML 拓扑(零 token 路由)+ 交互式 DAG 仪表盘 + 浏览器内 human gate + 运行前 validation + reasoning.effort 控本**」——给控制台一套现成运行视图、给编排一套可 diff、不烧 token 的声明式确定性范式。
- **dsifry/metaswarm**:学它「**Trust Nothing Verify Everything 的对抗式评审门(DoD+file:line、3 轮升级)+ self-reflect 知识沉淀 + 计划落盘续跑**」——给人审门升级 critic 预筛、给**洞察员自身**一套「每轮沉淀、下轮选择性 prime」的知识闭环。
- **本批不新增待办卡**(延续七–十、十二–二十六、二十八–三十批的克制口径;唯十一批因真漏洞、二十七批因 insights.md 真实膨胀破例)。理由:三例最值钱的落地——**「队列/人审门声明式 reactions」「控制台 DAG 仪表盘 + 声明式确定性编排」「人审门 critic 化 + 洞察员知识库」**——均属**产品/主管的架构决策**,不该由洞察员径自堆成待办;且多数(声明式流程、可观测、STATUS 状态、结构化校验、续跑)与已有卡/已有能力同源。**若 CEO 想立刻、最小、最可逆地动一步**:给玉兔6 人审门加 **`escalateAfter` 超时语义**(借 ComposioHQ:挂起 N 分钟无人响应→自动升级/通知),纯配置、零依赖、改完即用,是三例里落地面积最小、直接补「人审门挂起无人管」短板的切口;想「一处改、收益最深」则评估 **Conductor 的 DAG 仪表盘 + 声明式 YAML 拓扑**对控制台/编排的映射(只读范式借鉴、不接 runtime)。**Starlaid 全程排除。**

> watch(本批 web_fetch 直读实时元数据;HEAD commit SHA 因代理 `git ls-remote` 403 未取,待网络可达回填):ComposioHQ/agent-orchestrator `main`(**MIT → watch=true**,5.8k★/801 forks/699 commits,latest `@composio/ao-cli@0.2.2` / 2026-03-29,TS 92%,极活跃)、microsoft/conductor `main`(**MIT → watch=true**,219★/26 forks/164 commits,latest v0.1.18 / 2026-05-28,Python 3.12+,微软出品、活跃)、dsifry/metaswarm `main`(**MIT → watch=true**,244★/32 forks/112 commits,latest v0.11.0 / 2026-04-01,跨 Claude/Gemini/Codex)。另**挂三个下批候选 watch**:**steveyegge/beads**(git-native 任务库,metaswarm 的协调底座,**尚未 seen**,若 taskstore 想「issue 即代码」可对照)、**ComposioHQ/composio**(其 tool/connector 生态上游,看是否与玉兔6 能力治理相关)、**microsoft/agent-framework**(**已 seen**,看 1.0 GA 后 handoff/checkpoint 演进)。



<!-- insight-scout-run:cr-1782302413497-insight-scout-repos-20260624-20 -->
## 2026-06-24 · 自动洞察(20260624-20 · unity-simulaid-methods)

> 来源:洞察员; run=cr-1782302413497-insight-scout-repos-20260624-20; queue=insight-scout/insight-scout-repos-20260624-20; network=limited

## Unity/团结工作流方法论借鉴扫描(slot=20260624-20)\n\n> 本轮无联网能力,网络状态 limited;基于历史公开知识与既有 watch 清单整理,未引用任何实时 star/commit/release。Starlaid/星桥 一律排除。\n\n### Unity-Technologies/EntityComponentSystemSamples\n- 是什么:Unity 官方 DOTS/ECS 示例集,演示面向数据设计、子场景烘焙、System 编排与 Job 调度。\n- 值得借鉴:\"组件只装数据 + System 只跑逻辑 + Baker 做一次转换\" 的分层思路,可作为 Simulaid 高密度仿真场景的泛化参考。\n- 迁移边界:强依赖 Unity DOTS 运行时;迁移只能借鉴架构而非代码;许可证按 Unity Companion License,需逐示例核对。\n- URL: https://github.com/Unity-Technologies/EntityComponentSystemSamples\n\n### Unity-Technologies/Addressables-Sample\n- 是什么:Unity 官方 Addressables 示例,覆盖资源分组、本地/远程加载、构建管线与 CDN 切换。\n- 值得借鉴:\"内容寻址 + 配置驱动加载 + 构建分段\" 可作为 Simulaid 资源编排的通用方法论,避免硬编码路径。\n- 迁移边界:示例耦合 Unity 资源系统,迁移需重写寻址层;许可证以仓库 LICENSE 文件为准。\n- URL: https://github.com/Unity-Technologies/Addressables-Sample\n\n### Cysharp/UniTask\n- 是什么:面向 Unity 的零分配 async/await 扩展,补足原生 Task 在 PlayerLoop 与生命周期上的缺口。\n- 值得借鉴:\"可取消令牌链 + PlayerLoop 阶段注入 + UnityContext 同步\" 是异步管线可复用的通用设计模式。\n- 迁移边界:实现耦合 Unity PlayerLoop,非 Unity 平台只能借鉴设计;MIT 许可证(以仓库为准)。\n- URL: https://github.com/Cysharp/UniTask\n\n### 综合判断\n- 本轮三例均为泛化方法借鉴,不涉及直接引入代码,无明确低风险行动需 CEO 取舍,故不生成公告板卡。\n- 待联网恢复后应补:许可证原始文件链接、近 90 天活跃度、与 Simulaid 资源/异步/仿真子模块的逐项对照。



<!-- insight-scout-run:cr-1782303051688-insight-scout-repos-20260624-batch32 -->
## 2026-06-24 · 第三十二批(选题:AI agent 工具与 skills + 优秀网页设计 — 三例:可组合的 agent workflow 编排库(mcp-agent)/ SKILL.md 开放标准 + 三段式渐进披露(能力治理·洞察员自身)/ 无框架 web components + CSS 变量主题(控制台 UI);运行 ~20:0x+08:00,网络已恢复,WebSearch+web_fetch 直读)

> 说明:本批为联网正常的内容批,**轮换到最久未做联网专题的两个方向——「AI agent 工具与 skills」与「优秀网页设计」**(上次成批均为第二十七批,其后近四个联网批 28 GUI grounding+LLM 网关 / 29 Unity / 30 像素+队列 / 31 多智能体编排,以及四个网络降级 slot 08/12/16/20 均未覆盖这两个方向)。去重已比对 `seen-repos.json`(220 仓库):本批三例(lastmile-ai/mcp-agent、agentskills/agentskills、shoelace-style/shoelace,另附次要参考 saadeghi/daisyui)均为**新案例**,与已 seen 的 anthropics/skills(**示例库**,本例为其背后的**标准/规范** repo,不同物)、VoltAgent/awesome-agent-skills、tech-leads-club/agent-skills、NVIDIA/SkillSpector、shadcn-ui/ui、tabler/tabler、magicuidesign/magicui、DavidHDev/react-bits、builderz-labs/mission-control 等均不重叠。本节是给老板/CEO 看的「值得借鉴」分析,**非待办**;本批**不新增待办卡**(理由见末)。**Starlaid/星桥 全程排除。一条 license 提示先行:案例 3 的 Shoelace 已于 2026-05-14 archived/sunset,只读不可依赖,活跃后继 Web Awesome 为 free+Pro 双轨,采纳前须分清免费 MIT 件与 Pro 收费件。**

### 1. lastmile-ai/mcp-agent — 把 Anthropic《Building Effective Agents》几种模式做成「同构、可组合」的积木:AugmentedLLM = LLM+工具,而每种 workflow 模式本身又是一个 AugmentedLLM,可嵌套链接 + MCP 原生 + token 记账
- 名称/URL:lastmile-ai/mcp-agent(Build effective agents using Model Context Protocol and simple workflow patterns)— https://github.com/lastmile-ai/mcp-agent
- 核验事实(本批 web_fetch 直读):**Apache-2.0**;**8.3k★ / 837 forks / 767 commits**;**9 个 release(最新 `v0.0.21` / 2025-05-09,主干活跃但 tag 明显滞后,应以主干 commit 为准)**;**Python 99.7%**。核心抽象 **AugmentedLLM**(一个被「来自若干 MCP server 的工具」增强的 LLM),关键设计是「**每个 workflow pattern 本身就是一个 AugmentedLLM**」,因此模式可相互组合/链式;实现 Anthropic《Building Effective Agents》**全部模式 + OpenAI Swarm**:**Parallel / Router / Intent-Classifier / Evaluator-Optimizer / Orchestrator-Workers**;**MCP-native**(任何 MCP server 免写适配即接:filesystem / fetch / Slack / Jira / FastMCP)、**Temporal 背书的 durability**、结构化日志、**token 记账(token accounting)**、Pythonic(少量装饰器 + 上下文管理器)。
- 它优秀在哪:它把那篇《Building Effective Agents》里的几种 agent 模式做成了一组**同构、可组合**的积木。关键洞见是「**AugmentedLLM = LLM + 工具**,而每一种编排模式(并行 / 路由 / 评估-优化 / 编排-工人…)本身又是一个 AugmentedLLM」——于是模式可以像乐高一样**嵌套与链接**,而不是各写各的。再叠加 MCP 原生(工具即 MCP server,免写适配层)、每步 token 记账、可选 Temporal 持久化,等于把「**编排怎么搭 / 工具怎么接 / 跑了多少 token / 断了能否续**」四件事用一套可组合抽象收口。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **编排 ← 借「AugmentedLLM 同构可组合 + 五种 workflow 原语(Parallel / Router / Intent-Classifier / Evaluator-Optimizer / Orchestrator-Workers)」** ⭐⭐:玉兔6 编排(秘书→总管→员工)偏固定调用链;借「**把每种编排模式做成同构、可嵌套的单元**」让「并行 / 路由 / 评估-优化」能像积木拼。接二十六/三十/三十一批声明式编排共识、ADK 五策略原语(借鉴库已记)——本例把「**模式即可组合单元**」讲得最干净。
  - **队列 / 可观测 ← 借「token 记账 + 结构化日志」** ⭐:接三十一批 Conductor「每节点 model/tokens/cost」、二十八批「按步控本」——玉兔6 run 每步记 token / 成本,是可观测与成本治理的地基。
  - **LLM 网关 / 路由 ← 借「Router / Intent-Classifier 按意图分发」**:对应「成本-质量路由」(接十六/二十八批),把贵 / 廉模型按意图分流。
  - **续跑 / durable ← 借「workflow 可暂停 / 恢复」语义**(其用 Temporal 实现):接二十六/三十一批「中间态续跑」——玉兔6 只借语义,不引 Temporal。
- 边界:Python + 可选 Temporal / Cloud,**玉兔6 绝不引这套运行时**(红线:单机零依赖);只借 **AugmentedLLM 可组合范式 + 五原语词汇 + token 记账 + 意图路由**这些语义。Apache-2.0,放心读借。注意 tag release 滞后(v0.0.21 / 2025-05),活跃度看主干 767 commits。
- 难度:中(借抽象 / 词汇,不引运行时)。优先级:**中-高**(可组合编排范式对玉兔6 编排价值大,且与已有声明式 / 原语方向同源,可渐进借)。

### 2. agentskills/agentskills — SKILL.md「开放标准 / 规范」本体(区别于 anthropics/skills 示例库):一份 SKILL.md 在 20+ 客户端一致可用 + 把「三段式渐进披露」写进标准
- 名称/URL:agentskills/agentskills(Specification and documentation for Agent Skills)— https://github.com/agentskills/agentskills
- 核验事实(本批 web_fetch 直读):**Apache-2.0(代码)+ CC-BY-4.0(文档)**;**20.6k★ / 1.3k forks / 123 commits / 35 issues / 17 PRs / 无 release**;**Python 99.1% / Shell 0.9%**;**这是 SKILL.md 的「标准 / 规范」repo,区别于 anthropics/skills(示例库,已 seen)**;由 **Anthropic originally 开发,2025-12-18 作为开放标准发布**,已被 **20+ agent 产品 / 客户端采纳**(Claude Code / Codex / Gemini CLI / GitHub Copilot / Cursor / VS Code…)。格式:一个 skill = 含 **`SKILL.md`** 的文件夹(frontmatter 至少 `name` + `description` + 正文 instructions),可选 `scripts/` `references/` `assets/`;**三段式渐进披露**——**Discovery**(启动只载 name+description,够判断何时相关)→ **Activation**(任务命中描述才把全文 SKILL.md 读入上下文)→ **Execution**(按需跑 bundled code / 读 referenced 文件)。
- 它优秀在哪:它把「**怎么给 agent 加能力**」标准化成一个极简、可移植、版本化的格式——一份 SKILL.md 在 Claude / Codex / Gemini / Copilot / Cursor 等 20+ 客户端**一致可用(build once, run anywhere)**;更关键的是把「**渐进披露**」写进标准:启动只读元数据、命中才读正文、用到才跑代码 / 读引用,于是「**手上可挂很多技能但上下文占用极小**」。这正是「能力多 vs 上下文省」这对矛盾的标准解,且是开放标准而非某家私有格式。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **能力治理 / skills ← 借「直接采用 SKILL.md 开放标准做玉兔6 技能 / 能力描述格式」** ⭐⭐:玉兔6 已有 `skills-lock.json` 与各工位能力,但描述格式自定。让自有技能符合 SKILL.md 标准(name+description frontmatter + 正文 + 可选 scripts/references/assets)→ **跨平台可移植、与 20+ 生态互通、新增能力 = 加一个文件夹**。直接落实二十七/04 批 agent-tools「统一 plugin 描述 schema + 按域分组」共识,且**对齐行业标准而非自造**。
  - **洞察员自身 / 渐进披露 ← 借「三段式 Discovery→Activation→Execution」** ⭐⭐:这对玉兔6 **最对口**——洞察员现有读取契约(README 明写「**渐进披露读取契约**」:默认只读 `insights.md` + `seen-repos.json` 两份热区,需要历史再按需读 `references/`)**本质就是渐进披露**;把它**形式化对齐到 SKILL.md 三段式**(元数据→正文→引用 / 脚本按需),并把 `seen-repos.json` / `borrowed-watch.json` / `references/` 视作「**按需加载的 supporting files**」。接三十一批 metaswarm「选择性 prime」——同一思想的标准化表达。
  - **角色 / 工位卡 ← 借「启动只载 name+description」**:各工位 / 角色卡也可只在「秘书分派」阶段载摘要、命中才载全文,系统性降上下文。
- 边界:**纯格式标准,零运行时、零依赖**,Apache-2.0 / CC-BY-4.0,放心采纳;无 release 属规范类 repo 正常现象。
- 难度:低(纯格式 / 契约对齐,不引代码)。优先级:**高**(把已有的渐进披露与技能描述**对齐到行业开放标准**,低成本、零依赖,收益在可移植性与上下文治理,且直接强化洞察员自身的读取契约)。

### 3. shoelace-style/shoelace(→ Web Awesome)— 证明「不绑任何前端框架也能有一套专业、可访问、可主题化的 UI 组件」:标准 Web Components + 可走 CDN + CSS 变量主题 + 官方暗色 + a11y 优先
- 名称/URL:shoelace-style/shoelace(A forward-thinking library of web components;现已并入后继 **Web Awesome**)— https://github.com/shoelace-style/shoelace
- 核验事实(本批 web_fetch 直读):**MIT**;**13.9k★ / 922 forks / 3,467 commits**;**⚠️ 已于 2026-05-14 被 owner archived → 只读 / sunset**;README 明文「**Shoelace is sunset,无活跃开发;published package 仍以 MIT 可用于既有用途,但新开发 / issue / PR 去后继项目 Web Awesome**(github.com/shoelace-style/webawesome,Font Awesome 出品)」;**TypeScript 94% / CSS 3.1% / JS 2.7%**;以 **LitElement** 构建 custom elements,esbuild 打包;自述卖点:**Works with all frameworks / Works with CDNs / Fully customizable with CSS / 官方 dark theme / accessibility-first**。后继 **Web Awesome** 提供更大的免费组件库 + themes + utilities + patterns(**⚠️ 注:Web Awesome 为 free + Pro 双轨,含付费件**)。
- 它优秀在哪:它证明了「**不绑任何前端框架也能有一套专业、可访问、可主题化的 UI 组件**」——组件是标准 **Web Components(custom elements)**,`<sl-button>` / `<sl-dialog>` 直接写进 HTML、可走 CDN、用 **CSS custom properties** 主题化、自带暗色与无障碍。对「不想上 React / Vue 构建链」的项目,这是把「**好看好用的组件**」与「**框架 / 构建依赖**」彻底解耦的范式——也正是已 seen 的 shadcn / tabler / magicui(多偏 React / Tailwind 生态)所**不具备**的那条约束。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **控制台 / 像素办公室 UI ← 借「framework-agnostic web components(custom elements)范式」** ⭐⭐:玉兔6 红线是**不引 React 链、单机原生**;Shoelace / Web Awesome 正是「**无框架、可 CDN、纯 HTML 标签**」的现成范式——控制台可用原生 web components 拿到专业组件(按钮 / 对话框 / 抽屉 / 数据表 / 标签页),而**不背 React / 构建链**。比已 seen 的 shadcn / tabler / magicui 更贴玉兔6 约束。
  - **主题 / 换肤 ← 借「CSS custom properties 主题系统 + 官方 dark theme」** ⭐:控制台暗色 / 换肤可学「**一套 CSS 变量 design token 驱动所有组件**」,改 token 即换肤、不动结构。
  - **无障碍 ← 借「accessibility-first 组件」**:接二十八/12 批 a11y grounding——UI 自身的 a11y(role / aria / 键盘可达)也应是默认能力。
  - **次要参考 daisyUI(saadeghi/daisyui,MIT,41.1k★ / 1.6k forks / 188 release,最新 `v5.5.23` / 2026-06-07,CSS-only Tailwind 插件)**:其「**语义化组件 class + `data-theme` 一键换肤 + 主题生成器**」是更彻底的「纯 CSS 变量主题」对照;玉兔6 若不上 Tailwind,只借**主题 token + `data-theme` 切换**的方法论即可。(注:daisyUI 仓库已内置 `skills/daisyui` 即一个 Agent Skill,侧面印证案例 2 的 SKILL.md 标准正被组件库采纳。)
- 边界:**⚠️ Shoelace 已 sunset / archived(2026-05-14 只读),不可作为依赖**——只借范式;真要用,拿**后继 Web Awesome 的免费 MIT 组件**,且**须分清 free 与 Pro(付费)件**(license 红线)。Web components 需注意 LitElement 运行时体积与浏览器兼容(现代浏览器原生支持 custom elements)。只借「**无框架 web components + CSS 变量主题 + a11y 默认**」范式。
- 难度:中(范式借鉴 + 按需自取免费组件,纯前端)。优先级:**中**(对控制台「无框架拿专业组件 + 换肤」价值实在,但 Shoelace 冻结、Web Awesome 双轨,需先做免费 / 付费件甄别再渐进引)。

### 本批小结(给 CEO 的一句话借鉴)
- **lastmile-ai/mcp-agent**:学它「**AugmentedLLM 同构可组合 + 五种 workflow 原语 + token 记账**」——给玉兔6 编排一套「模式即可组合积木」的范式与每步成本记账;只借抽象 / 词汇,不引 Python / Temporal 运行时。
- **agentskills/agentskills**:学它「**SKILL.md 开放标准 + 三段式渐进披露(Discovery→Activation→Execution)**」——把玉兔6 的技能描述与洞察员读取契约对齐到行业开放标准,低成本、零依赖、强化「能力多而上下文省」。
- **shoelace-style/shoelace(→ Web Awesome)**:学它「**无框架 web components + CSS 变量主题 + a11y 默认**」——给控制台一条「不上 React 也能拿专业可换肤组件」的路;但 Shoelace 已冻结、Web Awesome free+Pro 双轨,先甄别免费件再渐进引。
- **本批不新增待办卡**(延续七–十、十二–二十六、二十八–三十一批的克制口径;唯十一批因真漏洞、二十七批因 insights.md 真实膨胀破例)。理由:三例最值钱的落地——「**可组合编排范式**」「**技能 / 读取契约对齐 SKILL.md 标准**」「**控制台无框架组件 + 换肤**」——均属**产品 / 主管的架构决策**,非「明确值得立刻做」的原子动作。**若 CEO 想立刻、最小、最可逆地动一步**:把**洞察员自身的读取契约 + 自有技能描述对齐 SKILL.md 开放标准**(案例 2)——纯格式、零依赖、零运行时,且直接强化玉兔6 已在用的渐进披露,是三例里落地面积最小、风险最低、最 meta 对口的切口。**Starlaid 全程排除。**

> watch(本批 web_fetch 直读实时元数据;HEAD commit SHA 因代理 `git ls-remote` 403 未取,待网络可达回填):lastmile-ai/mcp-agent `main`(**Apache-2.0 → watch=true**,8.3k★/837 forks/767 commits,latest tag v0.0.21/2025-05 但主干活跃,关注 workflow 原语与 token 记账演进)、agentskills/agentskills `main`(**Apache-2.0 + CC-BY-4.0 → watch=true**,20.6k★/1.3k forks/123 commits,关注 specification 与 client showcase 扩张、SKILL.md 标准演进)、shoelace-style/shoelace `next`(**MIT 但 2026-05-14 archived/sunset → watch=false**,13.9k★/922 forks,只读;转而 watch 后继 Web Awesome 的免费件与 license 边界)。另**挂三个下批候选 watch**:**shoelace-style/webawesome**(后继活跃项目,看 free vs Pro 边界与组件覆盖,**尚未 seen**)、**saadeghi/daisyui**(**MIT**,主题 token / `data-theme` 换肤方法论,41.1k★,**本批已 seen**)、**lastmile-ai/mcp-eval**(基于 mcp-agent 的 MCP server 轻量评测框架,若玉兔6 想给能力做离线评测可对照,**尚未 seen**)。



<!-- insight-scout-run:cr-1782316813998-insight-scout-repos-20260625-00 -->
## 2026-06-24 · 自动洞察(20260625-00 · multi-agent-orchestration)

> 来源:洞察员; run=cr-1782316813998-insight-scout-repos-20260625-00; queue=insight-scout/insight-scout-repos-20260625-00; network=limited

## 多智能体编排 / 任务 DAG / 交接协议 借鉴扫描(slot=20260625-00)\n\n### OpenAI Swarm\n- 是什么:OpenAI 的实验性多智能体教学框架,核心是 routines 与 handoff 概念。\n- 值得借鉴:handoff 作为普通函数返回下一个 agent + 上下文,调用方无需复杂协议;context_variables 承载跨 agent 状态,交接语义极简。\n- 迁移边界/许可证不确定项:官方声明为教学非生产用途;MIT,但默认依赖 OpenAI SDK,移植需剥离;无内置 DAG/重试。\n- URL: https://github.com/openai/swarm\n\n### LangGraph\n- 是什么:LangChain 团队基于状态图的多智能体编排库,支持循环、分支、checkpoint 与人机回路。\n- 值得借鉴:把流程建模为 StateGraph,统一 State schema 约束节点 I/O;持久化与中断恢复原生支持,天然适配任务 DAG 与长流程交接。\n- 迁移边界/许可证不确定项:与 LangChain 生态耦合较深,移植需裁剪 langchain_core;MIT;生产化需自建检查点存储。\n- URL: https://github.com/langchain-ai/langgraph\n\n### Temporal\n- 是什么:成熟的开源工作流编排引擎,长任务、重试、检查点、确定性重放为核心特性。\n- 值得借鉴:Workflow/Activity 抽象、确定性重放、长任务容错与可观测模式,可直接迁移到 AI Agent DAG 的失败恢复与审计设计。\n- 迁移边界/许可证不确定项:非 AI 项目,需 Go/Java/TS/Python SDK 与 Temporal Server;MIT;引入成本高,只借设计不引入运行时。\n- URL: https://github.com/temporalio/temporal\n\n注:本轮 network_status=limited,未联网验证实时 star/commit/release,基于训练数据中的公开认知;落地前需 CEO/主管复核最新许可证与活跃度;Starlaid/星桥 已全程排除。



<!-- insight-scout-run:cr-1782317313000-insight-scout-repos-20260625-batch33 -->
## 2026-06-25 · 第三十三批(选题:GUI grounding + LLM 网关/路由 — 三例:跨平台 CUA 的 Playground+在线评测+planner-grounder 分层(ScaleCUA)/ 单二进制零依赖 + 三层级联语义路由的 LLM 网关(openziti/llm-gateway)/ 重运行时但策略词表最全的 API·LLM·MCP 网关(Kong);运行 ~00:0x+08:00,网络已恢复,WebSearch+web_fetch 直读)

> 说明:本批为联网内容批,**轮换到最久未做联网专题的两个方向——「GUI grounding」与「LLM 网关/路由」**(二者上次成批均为第二十八批,其后 29 Unity / 30 像素+队列 / 31 多智能体编排 / 32 agent工具skills+网页设计,及若干网络降级 slot 均未覆盖)。去重已比对 `seen-repos.json`(约 220 仓库):本批三例(OpenGVLab/ScaleCUA、openziti/llm-gateway、Kong/kong)均为**新案例**;与已 seen 的 GUI grounding 群(UGround/GUI-Actor/UI-TARS/Agent-S/UI-Venus/OmniParser/ShowUI/ScreenSpot-Pro/MobileAgent/AgentCPM-GUI/OSWorld/RegionFocus 等)、LLM 网关群(litellm/Portkey-gateway/Helicone/bifrost/semantic-router/LLMRouter/RouteLLM/archgw/plano/langfuse 等)均不重叠。**附:GUI-Owl-1.5 / Mobile-Agent-v3.5 经核验仍托管于已 seen 的 X-PLUG/MobileAgent 同仓,属 watch 更新而非新案例,本批不重复立项;HyperClick(arXiv 2510.27266)未见明确官方实现仓,暂不立项。** 本节是给老板/CEO 看的「值得借鉴」分析,**非待办**;本批**不新增待办卡**(理由见末)。**Starlaid/星桥 全程排除。一条 license 提示先行:案例 3 的 Kong 为重运行时,且部分高级 AI 能力可能属企业版/Konnect,只借词表与概念、不接入,采纳前须甄别 OSS 件与商业件。**

### 1. OpenGVLab/ScaleCUA — 用「大规模跨平台数据 + 可复现交互 Playground + 在线评测套件」把开源 CUA 做厚:planner-grounder 可切换(单模型一体 / 双模型分层)+ vision-only + vLLM OpenAI 兼容部署
- 名称/URL:OpenGVLab/ScaleCUA([ICLR 2026 Oral] 可在 Windows/macOS/Ubuntu/Android 跨平台运行的开源 computer use agents)— https://github.com/OpenGVLab/ScaleCUA
- 核验事实(本批 web_fetch 直读):**Apache-2.0**;**1.1k★ / 78 forks / 46 commits / 14 issues / 1 PR / 50 watching**;**Python 74.8% / HTML 11.4% / JS 9.9% / Kotlin 1.0% / Shell / Cuda**;**1 个 release(launch_zip_v1,2025-09-18,WebArenaLiteV2 资产)**;News:2025/09/19 放出模型+代码、2025/09/30 数据集上 HuggingFace;论文 arXiv 2509.15221。五大件:**ScaleCUA-Data**(跨 6 操作系统、3 个 GUI 任务域:GUI 理解/GUI grounding/任务规划,经「自动 agent + 人类专家」闭环管线采集)、**ScaleCUA-Models**(跨平台通用 agent)、**SFT Codebase**(基于 Qwen2.5-VL 与 InternVL 训练)、**Interactive Playground**(Ubuntu/Android/Web 预配置交互虚拟机)、**Online Evaluation Suite**(AndroidWorld/AndroidLab、OSWorld、MacOSArena、WebArenaLite-v2、WindowsAgentArena);两种运行模式:**Native Agentic Model**(单模型同时做 UI grounding 与 planning)与 **Agentic Workflow**(planning 与 grounding 用两个不同模型);**vision-only + 经 vLLM 暴露 OpenAI 兼容 API 评测**。SOTA:+26.6 WebArena-Lite-v2、+10.7 ScreenSpot-Pro,94.4% MMBench-GUI L1-Hard、60.6% OSWorld-G、47.4% WebArena-Lite-v2。
- 它优秀在哪:GUI grounding/CUA 领域多数工作各做一块(只放模型、或只放 benchmark);ScaleCUA 把「**数据—模型—训练—交互环境—在线评测**」一条龙开源,且两点最值钱:① **可复现的交互 Playground + 在线评测套件**——给每个平台预配好「可交互虚拟机」并接一整套 online benchmark,vision-only、统一走 vLLM 的 OpenAI 兼容 API 评测,等于把「在真实环境里端到端验证 agent」标准化;② **planner-grounder 的「单模型一体 ↔ 双模型分层」可切换**——同一任务可用一个大模型既规划又定位,也可拆成「强 planning 模型 + 专精 grounding 模型」分层,显式暴露「集成 vs 解耦」这对工程取舍。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **Simulaid ← 借「跨平台预配置交互 Playground + 在线评测套件(vision-only,统一 OpenAI 兼容 API)」** ⭐⭐:这是对 Simulaid 最直接的一点。Simulaid 要「真实、可交互的仿真环境」,ScaleCUA 给了一套现成范式——**每个平台/场景预配一个可交互环境 + 一套 online benchmark + 统一用 OpenAI 兼容端点跑评测**;Simulaid 可据此把「环境定义、agent 接入、在线评分」三件事解耦、可复现(接二十九批 Unity ECS/Addressables「配置驱动 + 构建分段」、三十二批 mcp-eval「能力离线评测」共识)。
  - **编排/成本路由 ← 借「planner-grounder 双模型分层 ↔ 单模型一体 的可切换」** ⭐:玉兔6 派活(秘书→总管→员工)与「成本-质量路由」可借这一显式取舍——**简单任务用单模型一体、复杂任务拆「强 planning + 廉价专精执行」两层**;对应「贵步用强模型、专精/高频步用小模型」(接十六/二十八/三十二批成本路由)。
  - **数据/人审门 ← 借「自动 agent + 人类专家 的闭环数据采集管线」** ⭐:玉兔6 若要沉淀「轨迹/示例」数据,可学其「机器先采、人专家校」的闭环(接三十一批 metaswarm「先验证后信任」、二十八批 Critic 预检),把人审门也用作「数据质量门」。
  - **(条件性)GUI 自动化能力 ← 借其 Apache-2.0 grounding 模型与坐标定位范式**:玉兔6 若未来做 GUI/控制台自动化,ScaleCUA-Models(Apache-2.0)可作 grounding 候选,免自训。
- 边界:ScaleCUA 主体是**重 VLM 训练/推理栈**(Qwen2.5-VL/InternVL SFT + vLLM + GPU + 各平台虚拟机),玉兔6 **绝不引这套训练/推理运行时**(红线:单机零依赖);只借 **Playground+在线评测的架构形态、planner-grounder 分层语义、闭环数据管线方法论**。Apache-2.0(代码与模型/数据),读借与(必要时)取模型都友好。
- 难度:中-高(借 Playground/评测架构需为 Simulaid 落数据模型;借分层语义则低)。优先级:**中**(对 Simulaid 的仿真+评测范式价值实在,但属方法论参考、非当前主线原子动作;planner-grounder 分层可与已有成本路由方向合并推进)。

### 2. openziti/llm-gateway — 「单 Go 二进制 + 一份 YAML、零基础设施」的 LLM 网关:三层级联语义路由(关键词→嵌入→分类器,逐层可关)+ 每次路由决策可观测 + 多端点加权负载/被动故障转移
- 名称/URL:openziti/llm-gateway(零信任 LLM 网关,OpenAI 兼容代理,跨 OpenAI/Anthropic/Ollama/vLLM 等语义路由+负载均衡)— https://github.com/openziti/llm-gateway
- 核验事实(本批 web_fetch 直读):**Apache-2.0**;**68★ / 3 forks / 44 commits / 3 issues / 7 PRs**;**Go 99.9%**;**2 个 release(最新 v0.1.4,2026-04-08)**;自述定位「**Single binary, zero infrastructure——one Go binary, one YAML file. No database, no message queue, no sidecar**」。能力:**OpenAI 兼容 API + Anthropic 透明互转 + SSE 流式**;**三层级联语义路由**——①**Heuristics**(关键词/模式快匹配,如 "translate"→fast、`has_tools`→tools、`system_prompt_contains`→coding、`max_tokens_lt`/`message_length_lt`→fast)②**Embeddings**(用户 prompt 与各 route 示例的余弦相似度,Ollama/OpenAI 嵌入,`threshold`/`ambiguous_threshold`/`comparison: centroid|max|average`)③**LLM Classifier**(嵌入歧义时才调 LLM 分类,带 `confidence_threshold`/`timeout_ms`);**每层可独立开关,全不命中走 `default_route`**;`model` 字段可省略,或对必须传 model 的客户端暴露 `auto` 虚拟模型;**每次路由决策记 method/置信度/延迟/级联轨迹**。**多端点负载均衡**:加权 round-robin + 健康检查 + 被动故障转移 + VM 休眠探测,同一池可混跑 Ollama/vLLM/llama-server/SGLang。**OpenTelemetry/Prometheus 指标**:`requests`/`request.duration`/`tokens.prompt`/`tokens.completion`/`routing.decisions`(按 method)/`provider.errors`/`requests.inflight`/`endpoint.healthy`。**虚拟 API key**(`sk-gw-…`,可按 glob 限定每 key 可用模型);zero-trust 走 zrok/OpenZiti 叠加网。
- 它优秀在哪:它把「LLM 网关」做成玉兔6 最想要的形态——**一个 Go 二进制 + 一份 YAML,无 DB/MQ/sidecar**,却把路由这件事做得很讲究:**三层级联「便宜信号优先、越贵越后」**——先零成本的关键词启发式,再本地嵌入相似度,**只有歧义时才动用会烧 token 的 LLM 分类器**,且每层可单独开关、有明确阈值与回退。再叠加「每次路由决策的可观测轨迹 + 一套规范的 Prometheus 指标(含 `routing.decisions` 按 method 计数)+ 多端点加权/健康/故障转移」,等于把「**怎么选模型、选得对不对、花了多少、端点健不健康**」用一份配置收口。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **LLM 网关/路由 ← 借「三层级联语义路由(关键词→嵌入→LLM 分类器,逐层可关 + 阈值 + default_route)」** ⭐⭐:这是本例最该借的一点,也是玉兔6「成本-质量路由」的标准解。玉兔6 选模型可照此**分级**:先用零成本关键词/特征(`has_tools`、`max_tokens_lt`、系统提示含某串)命中,命中不了再上本地嵌入相似度,**只有仍歧义才调一次 LLM 分类器**(把最贵的判定放最后),全不中走默认路由。接十六/二十八/三十二批成本路由——本例把「**便宜信号优先、级联升级**」讲得最具体、最可直接抄成数据结构。
  - **控制台/可观测 ← 借「每次路由决策记 method/置信度/延迟/级联轨迹 + Prometheus 指标词表(尤其 `routing.decisions` 按 method、`tokens.prompt/completion`、`endpoint.healthy`)」** ⭐⭐:玉兔6 控制台偏读 eventlog 文本;借这套**结构化路由决策日志 + 指标词表**,控制台能直接显示「这条 run 被哪层路由、置信多少、走了哪个模型、花多少 token、端点健不健康」。接三十一批 Conductor「每节点 model/tokens/cost」、三十二批 mcp-agent「token 记账」——本例给出可照抄的指标命名。
  - **形态/红线对齐 ← 借「单 Go 二进制 + 一份 YAML、无 DB/MQ/sidecar」** ⭐⭐:这正是玉兔6「单机零依赖」红线的范本——一个网关能做到「一个二进制 + 一份配置」即可路由+负载+可观测,值得作为玉兔6 自有网关/编排件的形态标杆。
  - **队列/弹性 ← 借「多端点加权 round-robin + 健康检查 + 被动故障转移 + VM 休眠探测」** ⭐:玉兔6 若并联多个本地模型端点,可借这套「权重分流 + 主动健康 ping + 请求出错即被动切换」。
  - **能力治理 ← 借「虚拟 API key + 按 glob 限定每 key 可用模型」**:对应玉兔6「按角色/工位限定可用模型/能力」的细粒度授权。
- 边界:其**主打差异化是 zrok/OpenZiti 零信任叠加网**(跨 NAT/气隙暴露端点)——玉兔6 多半**不需要这块叠加网络**,**不引**;只借 **级联路由设计 + 路由决策日志 + 指标词表 + 单二进制形态 + 虚拟 key 模型白名单**这些语义/形态。Apache-2.0、纯 Go,放心读借;注意仓库尚年轻(68★/44 commits),借设计为主、依赖其成熟度需观望。
- 难度:低-中(借路由级联设计 + 指标/日志 schema,纯数据结构与配置层)。优先级:**高**(级联路由直击成本-质量路由、决策日志直击控制台可观测,且「单二进制零依赖」形态正合红线,可渐进、可逆地先借一层关键词启发式)。

### 3. Kong/kong — 成熟、重运行时但「策略词表最全」的 API·LLM·MCP 网关:AI Proxy Advanced 六种负载/路由策略(含 lowest-latency/lowest-usage/语义路由)+ 语义缓存 + token 限流 + MCP 治理/自动生成
- 名称/URL:Kong/kong(🦍 The API and AI Gateway)— https://github.com/Kong/kong
- 核验事实(本批 web_fetch 直读):**Apache-2.0(OSS 核心;Copyright 2016-2026 Kong Inc.)**;**43.5k★ / 5.1k forks / 11,261 commits / 62 issues / 80 PRs / 993 watching**;**Lua 89.2% / Perl 5.2% / Raku 3.1% / Starlark / Shell / Python**;**146 个 release(最新 3.9.2,2026-06-04)**;基于 NGINX/OpenResty,**DB-less 声明式配置 + Hybrid(控制面/数据面分离)** 部署,K8s 官方 Ingress Controller。AI 能力(本批 WebSearch 佐证):**Universal LLM API**(OpenAI/Anthropic/Gemini/Bedrock/Azure/Databricks/Mistral/HF…);**AI Proxy / AI Proxy Advanced 插件**,AI Proxy Advanced 负载/路由策略含 **round-robin、consistent-hashing、least-connections、lowest-latency、lowest-usage、semantic routing(prompt-to-model 相似度)**;**60+ AI 特性**:AI 可观测、**语义安全与语义缓存**、语义路由、**token-based rate limiting**、**AI cost optimization**、**A2A 治理**;**MCP 流量治理/安全/可观测 + 从任意 RESTful API 自动生成 MCP**;插件可用 Lua/Go/JS 开发。
- 它优秀在哪:与案例 2 的「轻」恰成对照——Kong 是**重运行时、但把网关该有的策略词表做到最全且久经生产**的那一极。尤其 **AI Proxy Advanced 的六种负载/路由策略**比一般网关丰富:除常见 round-robin/一致性哈希/最少连接外,还有**lowest-latency(选最低延迟端点)、lowest-usage(选用量最低端点)、语义路由(按 prompt 与模型描述相似度选模)**;再叠加**语义缓存(按相似度命中缓存、而非精确匹配)、token 限流、AI 成本优化、MCP 治理与自动生成**,把「成本/延迟/缓存/治理」做成了可组合插件。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **LLM 网关/路由 ← 借「AI Proxy Advanced 的路由/负载策略词表」** ⭐⭐:玉兔6 路由器可借这套更全的词汇,尤其**lowest-latency / lowest-usage**(按延迟/用量选端点)与**语义路由(prompt↔模型描述相似度)**——比案例 2 的加权 RR 更细。接案例 2 与十六/二十八批成本路由,二者合起来给玉兔6 一份「从关键词级联到延迟/用量感知」的完整路由策略谱。
  - **成本治理 ← 借「语义缓存 + token-based rate limiting + AI cost optimization」** ⭐⭐:**语义缓存**(相似 prompt 命中缓存)是玉兔6 此前未记录的强成本杠杆,适合洞察员/重复只读类调用;**token 限流**对应玉兔6 队列的配额/限速;两者直击「省钱」。
  - **能力治理/MCP ← 借「网关级 MCP 流量治理/可观测 + 从 RESTful API 自动生成 MCP」与「A2A 治理」** ⭐:玉兔6 大量用 MCP 工具,可借「在网关层统一治理/观测 MCP 流量」的形态(接二十七/三十二批能力治理),"从 REST 自动生成 MCP" 亦是把既有接口快速能力化的思路。
  - **部署形态 ← 借「DB-less 声明式配置」的理念**(非其运行时):声明式、可 diff 的配置,接三十/三十一批 Kestra/Conductor「配置即流程」。
- 边界:Kong 是 **NGINX/OpenResty/Lua 重运行时**(需 DB 或 DB-less、K8s ingress、控制面/数据面),**严重违反玉兔6 单机零依赖红线,绝不接入**;且**部分高级 AI 能力(如 AI Proxy Advanced 的部分策略)可能属企业版/Konnect 商业件**,采纳前须甄别 OSS 与商业边界(license 红线)。只借**路由/负载策略词表 + 语义缓存/token 限流/成本优化的概念 + MCP 网关治理形态**这些**词汇与思路**,不引一行运行时。Apache-2.0 核心,读借安全。
- 难度:低(借词表/概念,不引运行时)。优先级:**中**(策略词表与语义缓存对玉兔6 路由/成本治理有实在补充,但多为概念性借鉴;直接可落地的轻形态仍以案例 2 为先)。

### 本批小结(给 CEO 的一句话借鉴)
- **OpenGVLab/ScaleCUA**:学它「**跨平台预配置交互 Playground + 在线评测套件(vision-only,统一 OpenAI 兼容端点)+ planner-grounder 单模型/双模型可切换**」——给 Simulaid 一套可复现的「仿真环境 + 在线评测」范式,给成本路由一套「强 planning + 廉价专精执行」分层;只借架构,不引 VLM 训练/推理栈。
- **openziti/llm-gateway**:学它「**三层级联语义路由(关键词→嵌入→分类器,逐层可关、阈值 + 默认路由)+ 每次路由决策记 method/置信度/延迟/级联轨迹 + 单 Go 二进制零依赖形态**」——直接给玉兔6 成本-质量路由与控制台可观测一套现成范式,且形态正合「单机零依赖」红线。
- **Kong/kong**:学它「**AI Proxy Advanced 路由策略词表(lowest-latency/lowest-usage/语义路由)+ 语义缓存 + token 限流 + MCP 治理**」——给玉兔6 路由/成本治理一套更全的策略与缓存词汇;但 Kong 是重运行时(NGINX/Lua),只借词表与概念、不接入,且须甄别 OSS 与企业件。
- **本批不新增待办卡**(延续七–十、十二–二十六、二十八–三十二批的克制口径;唯十一批因真漏洞、二十七批因 insights.md 真实膨胀破例)。理由:三例最值钱的落地——**「成本-质量级联路由」「控制台路由决策可观测」「Simulaid 仿真+在线评测范式」**——均属**产品/主管的架构决策**,非「明确值得立刻做」的原子动作,且(级联路由、token 记账/可观测、声明式配置)多与已有方向同源。**若 CEO 想立刻、最小、最可逆地动一步**:借 **openziti 的「每次路由决策日志 schema」**(method + 置信度 + 延迟 + 级联轨迹,纯日志字段、零依赖、改完即用),或先只落 **级联第一层「关键词/特征启发式路由」**(零 token,作为成本-质量路由的最小切片)——二者落地面积最小、直接补「控制台看不到选模理由 / 路由还没分级」两处短板。**Starlaid 全程排除。**

> watch(本批 web_fetch 直读实时元数据;HEAD commit SHA 因代理 `git ls-remote` 403 未取,待网络可达回填):OpenGVLab/ScaleCUA `main`(**Apache-2.0 → watch=true**,1.1k★/78 forks/46 commits,ICLR 2026 Oral,最新内容 2025-09、模型+数据在 HF;关注 Playground/评测套件与新平台扩展)、openziti/llm-gateway `main`(**Apache-2.0 → watch=true**,68★/3 forks/44 commits,latest v0.1.4/2026-04-08,Go;关注级联语义路由的缓存与多端点策略演进)、Kong/kong `master`(**Apache-2.0 → watch=true**,43.5k★/5.1k forks/11,261 commits,latest 3.9.2/2026-06-04,Lua;关注 AI Proxy Advanced / 语义缓存 / MCP 治理 的 OSS vs 企业边界)。另**挂三个下批候选 watch**:**OpenGVLab/OpenCUA**(ScaleCUA 的 Model Demo,**尚未 seen**,若 Simulaid 想看在线 demo 形态可对照)、**X-PLUG/MobileAgent**(**已 seen**,看 GUI-Owl-1.5 / Mobile-Agent-v3.5 在 Qwen3-VL 上的多平台演进)、**vllm-project/vllm**(ScaleCUA/openziti 共同依赖的 OpenAI 兼容推理端,**尚未 seen**,若玉兔6 本地模型服务化可对照,但属重推理栈仅作参考)。



<!-- insight-scout-run:cr-1782331247307-insight-scout-repos-20260625-04 -->
## 2026-06-24 · 自动洞察(20260625-04 · queue-engine)

> 来源:洞察员; run=cr-1782331247307-insight-scout-repos-20260625-04; queue=insight-scout/insight-scout-repos-20260625-04; network=limited

## 调度可靠性与失败处置:三个值得复看的开源工程

说明:本轮无联网能力,未读取 board/insights/seen-repos.json(本地不可访问),以下基于公开稳定仓库的长期实现特征整理,不引用实时 star/commit/release 数据;许可证为常识性记录,采纳前需由主管重新核实最新 LICENSE 文件。

### temporal-io/temporal
- 是什么: durable workflow 引擎,任务状态持久化,原生支持 activity retry、heartbeat timeout 与 child workflow 隔离。
- 值得借鉴: retry policy 与 timeout 分层(stall/heartbeat/schedule-to-close),补偿与幂等约定文档化。
- 迁移边界/许可证: MIT(需复核);整体偏重,落地要评估存储与运维成本,不建议直接整体替换。
- URL: https://github.com/temporalio/temporal

### hibiken/asynq
- 是什么: Go 编写的 Redis 任务队列,内置重试、死信队列、优先级与 cron 调度,CLI 可视化失败任务。
- 值得借鉴: MaxRetry + 指数退避、DeadTask 归档与人工恢复流程清晰,代码量小易读。
- 迁移边界/许可证: MIT(需复核);依赖 Redis,与现有调度栈耦合度需主管确认。
- URL: https://github.com/hibiken/asynq

### taskforcesh/bullmq
- 是什么: Node.js/TS 的 Redis 队列,强调 job 生命周期与 stalled job 自动重投。
- 值得借鉴: stalled job 检测、rate limiter、concurrency 控制、backoff 策略约定值得对照。
- 迁移边界/许可证: MIT 社区版(需复核);Pro 版为商业特性,失败处置相关能力社区版已覆盖。
- URL: https://github.com/taskforcesh/bullmq



<!-- insight-scout-run:cr-1782331719000-insight-scout-repos-20260625-batch34 -->
## 2026-06-25 · 第三十四批(选题:Unity/Simulaid 架构 + 像素素材生成 — 三例:节点式非破坏的像素 VFX 生成器(Ttanasart-pt/Pixel-Composer)/ 极速零 GC 的 Unity 依赖注入(hadashiA/VContainer)/ 新一代跨平台响应式扩展(Cysharp/R3);本批联网,WebSearch + web_fetch 直读核验)

> 说明:本批轮换到**最久未做联网专题的两个方向——「Unity(Simulaid)架构」与「像素素材生成」**(上次成批:Unity=第二十九批、像素=第三十批;其后 31 多智能体编排 / 32 agent工具skills+网页设计 / 33 GUI grounding+LLM网关 均未覆盖)。去重已比对 `seen-repos.json`(约 133 仓库):本批三例(**Ttanasart-pt/Pixel-Composer、hadashiA/VContainer、Cysharp/R3**)均为**新案例**;与已 seen 的像素群(Pixelorama/LibreSprite/piskel/tiled/LPC生成器/TileGen/falsprite/free-tex-packer/Pixelization 等)、Unity 群(ml-agents/unity-mcp/UniTask/LitMotion/MemoryPack/Addressables/ECS samples/GOAP/NavMeshPlus/Friflo.Engine.ECS/UniTask 等)均**不重叠**。**注:三例均出自高质量作者(Cysharp 的 UniTask/LitMotion/MemoryPack 已 seen,但 R3 本体此前未立项,本批首次)。** 本节是给老板/CEO 看的「值得借鉴」分析,**非待办**;本批**不新增待办卡**(理由见末)。**Starlaid/星桥 全程排除。**

### 1. Ttanasart-pt/Pixel-Composer — 把「像素美术」做成节点图:非破坏、参数化、可批量重算的像素素材 + 像素 VFX 生成器(调色板节点统一画风 + MKFX 可复用特效)
- 名称/URL:Ttanasart-pt/Pixel-Composer(Node base VFX editor for pixel art)— https://github.com/Ttanasart-pt/Pixel-Composer
- 核验事实(本批 web_fetch 直读):**MIT**;**1.3k★ / 77 forks / 3,967 commits / 63 issues / 1 PR / 14 watching**;**Game Maker Language 73.2% / GLSL 17.9% / C++ 3.8% / HTML 1.4% / Python 0.6% / Java 0.5%**;**3 个 release(最新 1.21.0,2026-04-28)**;基于 **GameMaker Studio** 构建的桌面应用,文档在 readthedocs,分发于 itch.io + Steam;近 4000 commits、2026 仍高频更新。
- 它优秀在哪:它把「像素素材」从「逐帧手绘」变成**「节点图即素材」的程序化管线**——用节点(形状/噪声/变换/抖动 dither/**调色板**/动画曲线/**MKFX 特效**)**非破坏式**地生成 sprite、tileset、动画与像素 VFX,导出 sprite sheet / strip / gif。最值钱两点:① **参数化、可重算、可批量**——改一个节点参数即可重生成整套帧/整张表;② **调色板节点天然强制「画风统一」**,MKFX 把特效做成**可复用资产格式**。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **像素素材/画风 ← 借「节点式非破坏管线 + 调色板节点统一画风」** ⭐⭐:玉兔6 像素素材/Simulaid 资产可改用**「节点图作为素材的 source-of-truth」**——一张图定义 `shape→transform→dither→palette→export`,参数化生成、改一处全表重算、批量产出;共享调色板节点**直接强制画风统一**(直击「多素材风格不一致」短板)。
  - **Simulaid 资产管线 ← 借「程序化像素动画 / VFX(MKFX)」** ⭐:爆炸/粒子/受击等特效用节点**程序化生成并导成 sprite strip**,免逐帧手绘,直接接入 Simulaid。
  - **工具可直接取用 ← MIT、桌面工具本体即可当「外部像素素材生产器」**:无需自研像素编辑器,先拿它产玉兔6/Simulaid 资产。
- 边界:它是 **GameMaker(GML)桌面应用**,玉兔6 **不嵌入其运行时**(单机零依赖红线);借的是**「节点化资产生成方法论 + 调色板统一画风」** 以及**把工具本体当外部素材生产器**用。MIT,读借/取用都友好。
- 难度:低(当工具直接用)/ 中(把「节点图即素材」方法论落进玉兔6 资产管线)。优先级:**中**(像素非主线,但方法论具体、且有现成 MIT 工具可直接产出资产)。

### 2. hadashiA/VContainer — Unity 上「极速、最小体积、零 GC」的依赖注入:RegisterEntryPoint 把纯 C# 类做成生命周期入口点(领域逻辑/表现层分离)+ LifetimeScope 可嵌套异步作用域 + 不可变容器
- 名称/URL:hadashiA/VContainer(The extra fast, minimum code size, GC-free DI library running on Unity Game Engine)— https://github.com/hadashiA/VContainer
- 核验事实(本批 web_fetch 直读):**MIT**;**2.9k★ / 252 forks / 1,387 commits / 90 issues / 13 PRs / 38 watching**;**C# 95.6% / MDX 4.0%**;**74 个 release(最新 v1.18.0,2026-05-14)**;Unity 2018.4+;UPM(Git URL)/ OpenUPM 安装。自述要点:**Resolve 基本比 Zenject 快 5–10x、Resolve 零 GC 分配、最小代码体积、不可变容器(线程安全/健壮)**。能力:构造/方法/属性注入、**自有 PlayerLoopSystem 分发**、**LifetimeScope 灵活嵌套(可异步创建子作用域,配合 Additive 场景 / UniTask)**、**SourceGenerator 加速模式(可选)**、**Editor 内 Diagnostics 窗口**、UniTask 集成、ECS 集成(beta);**RegisterEntryPoint 让纯 C# 类作为入口点(IStartable / IAsyncStartable 等),实现「领域逻辑与表现层(MonoBehaviour/View)分离」**。
- 它优秀在哪:在「DI 常导致启动慢、GC 抖动」的 Unity 语境里,它用**不可变容器 + 构建期反射 + SourceGenerator** 把开销压到接近零,同时用 **EntryPoint + Scope** 把架构**「解耦 + 生命周期化」**做得很干净——纯 C# 入口点带 Start/Tick/Async 生命周期,View 只做薄壳,场景=一个可 Dispose 的作用域。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **Simulaid ← 借「LifetimeScope 嵌套作用域 + RegisterEntryPoint 纯 C# 入口点(IStartable/IAsyncStartable)」** ⭐⭐:把 Simulaid 重构为**「仿真/领域逻辑放纯 C# 入口点、View 只做薄 MonoBehaviour、每个场景/关卡 = 一个 Scope、Dispose 即整洁拆解」**——直接提升 Simulaid 的**可测试性与生命周期清晰度**(接二十九批 ECS/Addressables「配置驱动 + 构建分段」)。
  - **编排理念 ← 借「EntryPoint 生命周期(Start/Tick/Async)+ 作用域注入依赖」** ⭐:把每个「工位/员工」看作**「带明确生命周期 + 注入依赖的入口点」**,与玉兔6 派活生命周期同构,是「员工 = 可注入、可回收的实体」的干净范式参照。
  - **红线对齐 ← 借「零 GC、不可变、最小代码体积 + Editor Diagnostics 可观测」的工程取向**:与玉兔6 单机零依赖/轻量红线同向,基础设施选型值得照此「低开销 + 可观测」标准。
- 边界:它是 **Unity 专用库**,玉兔6 控制台(JS/Node)**不直接用**;直接落地面在 **Simulaid(C#)——MIT、UPM 即装,可直接采用**;对控制台/编排是**「EntryPoint + Scope」架构理念借鉴**,非代码移植。
- 难度:低-中(Simulaid 直接采用;理念借鉴更低)。优先级:**中-高**(对 Simulaid 是成熟、MIT、即装的架构地基,2.9k★、2026 活跃,落地确定性高)。

### 3. Cysharp/R3 — 新一代 Reactive Extensions(Rx 第三代):把「时间/帧」抽象为可注入的 TimeProvider/FrameProvider(确定性、可测试、可重放)+ 修复传统 Rx 的内存泄漏 + 跨 Unity 与纯 .NET 通用
- 名称/URL:Cysharp/R3(The new future of dotnet/reactive and UniRx)— https://github.com/Cysharp/R3
- 核验事实(本批 web_fetch 直读):**MIT**;**3.8k★ / 179 forks / 768 commits / 25 issues / 8 PRs / 46 watching**;**C# 98.4%**;**58 个 release(最新 v1.3.1,2026-05-19)**;支持 .NET Standard 2.0/2.1、.NET 6/7/8+;扩展库覆盖 **Unity / Godot / Avalonia / WPF / WinForms / WinUI3 / Stride / MAUI / MonoGame / Blazor / LogicLooper** 等;自述为「Rx 第三代」(继 .NET Rx 与 UniRx 之后),现代 C# 重写,**修复传统 Rx 的设计/性能/内存泄漏问题**;Unity 的 TimeProvider/FrameProvider 走 PlayerLoop。
- 它优秀在哪:它把「事件流」在**性能与正确性**两端都收紧——**可注入的 TimeProvider/FrameProvider** 让仿真/UI 的时序变得**确定、可测、可重放**;统一 Observable 模型 + 规范订阅释放,解决 UniRx 时代易泄漏的老痛点;同一套响应式模型可在 **Unity 与纯 .NET/服务端**间复用。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **Simulaid ← 借「Observable 事件流 + 可注入 FrameProvider/TimeProvider 的确定性时序」** ⭐⭐:Simulaid 的实体状态变化/传感事件可建模为 **observable 流**,用 **FrameProvider 做帧级确定性时序**——直接服务**「可复现仿真 + 可回放」**(呼应三十三批 ScaleCUA「可复现交互/在线评测」与队列批 Temporal「确定性重放」共识)。
  - **控制台/事件流(理念)← 借「TimeProvider 抽象 + 泄漏安全的订阅释放模型」** ⭐:玉兔6 控制台 eventlog 可借**「事件即可观测流 + 可注入时间源(真实/虚拟时钟可换)」** 的范式,利于测试与回放;**注意控制台是 JS/Node、R3 是 C#,此处为概念借鉴而非直接引库**。
  - **工程取向 ← 借「修复传统 Rx 内存泄漏 + 现代化重写」的态度**:响应式/事件订阅是泄漏高发区,R3 的释放约定值得作为玉兔6 事件层的设计参照。
- 边界:直接落地面同样在 **Simulaid(C#,MIT 即装)**;对控制台是**「可注入时间源 + 泄漏安全订阅」的概念借鉴**,不引 C# 库进 Node。Cysharp 系质量稳(UniTask/LitMotion/MemoryPack 已 seen),**R3 本体此前未 seen,本批首次立项**。
- 难度:低-中(Simulaid 直接用;控制台为概念)。优先级:**中**(对 Simulaid 的事件/时序是强补,但属架构选型,非当前主线原子动作)。

### 本批小结(给 CEO 的一句话借鉴)
- **Ttanasart-pt/Pixel-Composer**:学它「**节点式非破坏像素生成 + 调色板节点统一画风 + 程序化像素 VFX(MKFX)**」——给玉兔6/Simulaid 像素素材一套「**节点图即素材、改一处全表重算、画风可强制统一**」的管线,且是 MIT 工具可直接产出资产;不嵌运行时。
- **hadashiA/VContainer**:学它「**LifetimeScope 嵌套作用域 + RegisterEntryPoint 纯 C# 入口点(领域逻辑/表现层分离)+ 零 GC 不可变容器**」——给 Simulaid 一套成熟、即装、低开销的 DI 架构地基,并给玉兔6「**工位 = 可注入可回收实体**」的理念参照。
- **Cysharp/R3**:学它「**Observable 事件流 + 可注入 FrameProvider/TimeProvider 的确定性时序 + 泄漏安全订阅**」——给 Simulaid 可复现/可回放的事件时序模型,给控制台 eventlog 一个「**可注入时间源**」的概念范式。
- **本批不新增待办卡**(延续七–十、十二–二十六、二十八–三十三批的克制口径)。理由:三例最值钱的落地——**「节点化像素资产管线」「Simulaid 用 VContainer 做 DI 地基」「Simulaid 用 R3 做确定性事件时序」**——均属**产品/主管的架构选型**,非「明确值得立刻做」的原子动作,且与已有方向(二十九批 Unity 配置驱动/构建分段、三十三批可复现仿真)同源。**若 CEO 想立刻、最小、最可逆地动一步**:在 Simulaid 引入 **VContainer 作为 DI 基线**(UPM 即装、MIT、可逆),或用 **Pixel-Composer 先做 1 个「节点图生成 + 调色板统一」的样例 sprite**——二者落地面最小、风险最低,直接补「Simulaid 架构地基 / 像素画风统一」两处。**Starlaid 全程排除。**

> watch(本批 web_fetch 直读实时元数据;HEAD commit SHA 因代理限制未取,待网络可达回填):Ttanasart-pt/Pixel-Composer `main`(**MIT → watch=true**,1.3k★/77 forks/3,967 commits,latest 1.21.0/2026-04-28,GML;关注节点库扩展与 MKFX 特效格式)、hadashiA/VContainer `master`(**MIT → watch=true**,2.9k★/252 forks/1,387 commits,latest v1.18.0/2026-05-14,C#;关注 SourceGenerator 加速与 ECS 集成 beta 转正)、Cysharp/R3 `main`(**MIT → watch=true**,3.8k★/179 forks/768 commits,latest v1.3.1/2026-05-19,C#;关注 FrameProvider/TimeProvider 与各框架扩展演进)。另**挂两个下批候选 watch**:**Cysharp/ObservableCollections**(R3 常配套,尚未 seen,若 Simulaid/控制台要响应式集合可对照)、**hadashiA/MagicOnion**(若玉兔6 未来要 C# 端实时通信可对照,属重栈仅参考)。



<!-- insight-scout-run:cr-1782346233000-insight-scout-repos-20260625-batch35 -->
## 2026-06-25 · 第三十五批(选题:AI agent 工具与 skills + 优秀网页设计 — 三例:把「agent↔前端」做成协议 AG-UI + 生成式 UI 的前端 Agent 栈(CopilotKit)/ 自带 `Ctrl+K` 命令面板 + 通知系统 + 80+ hooks 的全功能组件库(Mantine)/ shadcn 式「复制源码进项目」的仪表盘·图表组件(Tremor);本批联网,WebSearch + web_fetch 直读核验)

> 说明:本批轮换到**最久未做联网专题的两个方向——「AI agent 工具与 skills」与「优秀网页设计」**(上次成批均为第三十二批;其后 33 GUI grounding+LLM 网关 / 34 Unity+像素 / 多智能体·队列离线 slot 均未覆盖)。去重已比对 `seen-repos.json`(136 仓库):本批三例(**CopilotKit/CopilotKit、mantinedev/mantine、tremorlabs/tremor**)均为**新案例**;与已 seen 的 agent 工具/skills 群(anthropics/skills、VoltAgent/awesome-agent-skills、wshobson/agents、obra/superpowers、fastmcp、baml、instructor 等)、网页设计群(shadcn-ui/ui、magicui、react-bits、daisyui、shoelace、tabler、motion、kbar 等)均**不重叠**。**「OpenClaw / ClawHub 9k→210k★ 数周暴涨」一类搜索热词,因无法核验真实性与合规来源,本批不予采纳(避免给 CEO 列入不可信案例)。** 本节是给老板/CEO 看的「值得借鉴」分析,**非待办**;本批**不新增待办卡**(理由见末)。**Starlaid/星桥 全程排除。**

### 1. CopilotKit/CopilotKit — 把「agent ↔ 前端」做成标准协议(AG-UI):流式聊天 + 生成式 UI(运行时按 agent 状态渲染组件)+ 共享状态 + human-in-the-loop,一套 agent 逻辑跨 React/Vue/RN/Slack
- 名称/URL:CopilotKit/CopilotKit(The Frontend Stack for Agents & Generative UI;AG-UI 协议作者)— https://github.com/CopilotKit/CopilotKit
- 核验事实(本批 web_fetch 直读):**MIT**;**35.4k★ / 4.4k forks / 176 watching**;**11,805 commits**;**1,379 个 release(最新 bot-slack/v0.0.3,2026-06-19,六天前)**;**TypeScript 77.7% / Python 7.0%**;自述「**全栈 agentic 应用 + 生成式 UI + 聊天的 SDK**」,是 **AG-UI Protocol** 作者(自称被 Google / LangChain / AWS / Microsoft / Mastra / PydanticAI 采纳)。能力:**Chat UI**(消息流式 + tool calls + agent 回复)、**Generative UI**(agent 按其状态在运行时动态生成/更新 UI 组件)、**共享状态(shared state)+ human-in-the-loop**、**前端 Action**、**`useAgent` hook 直接坐在 AG-UI 之上**;生成式 UI 三种规格——**Static(AG-UI 协议)/ Declarative(A2UI)/ Open-Ended(MCP Apps & Open JSON)**;跨端:React/Next(GA)、Angular、Vue、React Native、Slack/Teams/Discord/Google Chat(beta);**还随包发 "agent skills",`npx copilotkit skills install` 教 Claude Code/Codex/Cursor/Gemini 等编码 agent 如何接入/调试/升级 CopilotKit**。
- 它优秀在哪:多数 agent 框架解决「后端怎么编排」,前端只能各写各的;CopilotKit 把**「agent 与界面之间怎么通信」抽象成一条协议(AG-UI)**——agent 逻辑不变,AG-UI 负责 wire protocol(流式、tool call、状态同步、HITL),CopilotKit 负责每个框架的 UI 层。最值钱两点:① **生成式 UI + 共享状态**——agent 不只是吐文字,而能**按自身状态在前端渲染/更新组件**,且前后端共享一份状态;② **human-in-the-loop 是一等公民**——审批/打断/纠正直接嵌在 UI(甚至 Slack 频道)里。等于把「agent 在界面里活动」这件最难标准化的事做成了协议 + 组件。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 控制台 agent-UI ← 借「AG-UI 事件协议(流式 + tool call + 共享状态 + HITL)」** ⭐⭐:这是对控制台最直接的一点。玉兔6 控制台要展示「谁在跑、跑到哪步、流式输出、要不要人工批准」,CopilotKit 的 **AG-UI 事件流(text / tool-call / state / HITL)正是一份现成的「agent→前端」事件 schema**;控制台可借其事件类型与流式语义,把 eventlog 升级成结构化、可流式渲染的运行视图(接 33 批 openziti「路由决策日志 schema」、31 批 Conductor「每节点 model/tokens」共识)。
  - **② 控制台 HITL ← 借「human-in-the-loop 审批/打断作为一等 UI」** ⭐⭐:玉兔6 派活含「写动作需人批准」的红线,CopilotKit 的 **HITL 嵌入 UI(approve / interrupt / correct)+ 可跨到 Slack 频道审批**是现成范式,直接服务玉兔6「高风险动作人工门」。
  - **③ skills 分发形态 ← 借「随包发 agent skills、`skills install` 教编码 agent 接入」** ⭐:呼应 32/27 批「统一 skill 描述 + 分发」——把「如何用某能力」打包成 skill 让 agent 自学,是玉兔6 能力治理可借的分发模式。
  - **④ 生成式 UI(概念)← 借「agent 按状态在运行时渲染组件 + 三种生成式 UI 规格」**:玉兔6 若要让 agent 产出富交互结果(非纯文本),可参考其 Static/Declarative/Open-Ended 分层。
- 边界:CopilotKit 是 **React/Vue 等前端栈 + 自带 runtime**,玉兔6 控制台是自有 JS/Node 栈,**不整体接入其 runtime**(避免框架绑定);只借 **AG-UI 事件协议语义 + HITL 模式 + skills 分发思路**。MIT,读借/改写友好;注意部分高级能力(Intelligence Platform / CLHF / Slack 等)属其托管或早期访问件,**非全 OSS**,采纳前甄别。
- 难度:中(借 AG-UI 事件 schema + HITL 范式属协议/数据层;整体接入则高且不建议)。优先级:**高**(agent-UI 协议与 HITL 直击控制台「运行视图」与「审批门」两处短板,且可只借 schema、渐进可逆)。

### 2. mantinedev/mantine — 不只是 100+ 组件:自带 `Ctrl+K` 命令面板(Spotlight)+ 全功能通知系统 + 80+ hooks + 集中式 modals/form 管理,把「应用级 UX 系统」开箱给你
- 名称/URL:mantinedev/mantine(A fully featured React components library)— https://github.com/mantinedev/mantine
- 核验事实(本批 web_fetch 直读):**MIT**;**31.1k★ / 2.3k forks / 98 watching / 15 issues / 19 PRs**;**15,140 commits**;**300 个 release(最新 9.2.1,2026-05-14)**;**TypeScript 83.3% / MDX 13.0% / CSS 3.6%**;按包拆分——**@mantine/core(100+ 组件)、@mantine/hooks(80+ hooks)、@mantine/form(表单管理)、@mantine/charts(基于 recharts)、@mantine/notifications(完整通知系统)、@mantine/spotlight(`Ctrl+K` 命令中心)、@mantine/modals(集中式弹窗管理器)、@mantine/dropzone、@mantine/tiptap、@mantine/carousel、@mantine/nprogress、@mantine/code-highlight、@mantine/schedule**;**仓库本身含 `.claude / AGENTS.md / CLAUDE.md / .playwright-mcp`,即维护方自身在用 agent 工具链**。
- 它优秀在哪:与「只给一堆组件」的库不同,Mantine 把**应用真正需要的「系统级 UX 件」成套给齐**——**Spotlight 命令面板(`Ctrl+K` 全局动作/搜索)、通知系统、集中式 modals / form 管理、80+ 实用 hooks(快捷键、剪贴板、本地状态、滚动、防抖…)**。这些恰是后台/控制台最常自己造、又最容易造烂的部分;Mantine 用一套 MIT、按需取用的包把它们标准化,且 TS 优先、暗色模式原生、文档极好。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 控制台命令面板 ← 借「@mantine/spotlight 的 `Ctrl+K` 命令中心」** ⭐⭐:玉兔6 控制台动作渐多(派单/复看/查 run/跳工位),**Spotlight 式 `Ctrl+K` 全局命令面板**是把这些动作收口的最佳范式(与已 seen 的 kbar 同向,但 Mantine 自带成套更省事);可直接借其交互模型。
  - **② 控制台通知/弹窗 ← 借「notifications 系统 + modals 集中管理器」** ⭐⭐:run 完成/失败/需审批用**统一通知系统**推送、**集中式 modals**管确认弹窗,替代散落各处的临时实现,直击控制台「事件提示零散」。
  - **③ 前端 hooks 基线 ← 借「@mantine/hooks 的 useHotkeys / useClipboard / useLocalStorage 等」** ⭐:这些是控制台高频小能力,可直接取用或参照实现。
  - **④ 组件/图表 ← @mantine/core + @mantine/charts(recharts)**:控制台常规表单/表格/图表可直接用,降低自造成本。
- 边界:Mantine 是 **React 组件库**,若玉兔6 控制台非 React,则**主借「Spotlight / 通知 / modals / hooks 的交互模型与 API 设计」,而非直接引包**;若控制台是 React,则 MIT、按包取用、可只装 spotlight / notifications 两个轻包,渐进低风险。无 license 障碍。
- 难度:低(React 则按包即用;非 React 则借交互模型)。优先级:**中-高**(命令面板 + 通知系统对控制台 UX 是高频刚需,且可只借两个轻包、可逆)。

### 3. tremorlabs/tremor — 专做「仪表盘/图表」的 React 组件,shadcn 式「复制源码进项目」(Tremor Raw):基于 Tailwind + Radix,35+ 组件,零运行时锁定
- 名称/URL:tremorlabs/tremor(Copy & Paste React components to build charts and dashboards)— https://github.com/tremorlabs/tremor
- 核验事实(本批 web_fetch 直读):**Apache-2.0(Copyright © 2025 Tremor)**;**3.5k★ / 162 forks / 11 watching / 18 issues / 11 PRs**;**84 commits(本仓为新一代「Tremor Raw」复制粘贴源码仓;旧 npm 组件库在 tremorlabs/tremor-npm)**;**TypeScript 99.1%**;自述「**35+ 可定制、无障碍的 React 组件,构建仪表盘与现代 Web 应用,基于 Tailwind CSS + Radix UI**」;topics:react / components / dashboard / tailwindcss / radix-ui。
- 它优秀在哪:专攻**「数据仪表盘」这一垂直**——KPI 卡、指标、图表、表格等**为「看数据」而生的组件**,审美在线(自述 "data scientists with a sweet spot for design"),且新一代采用 **shadcn 式「复制源码进仓库」模式(Tremor Raw)**:不是装一个会锁版本的 npm 包,而是**把组件源码拷进你项目自由改**,Apache-2.0 放心改。等于把「做一个好看且可掌控的仪表盘」门槛降到最低。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 控制台仪表盘/可观测 ← 借「Tremor 的 KPI 卡 + 图表 + 指标组件(为仪表盘而生)」** ⭐⭐:玉兔6 反复出现「控制台运行可视化/可观测」需求(33 批路由决策、31 批每节点 tokens、30 批 Kestra 执行视图)——**Tremor 是把「run 数 / 耗时 / 成功率 / token / 各工位负载」做成仪表盘的现成、好看、Apache-2.0 组件集**,直接服务控制台 dashboard。
  - **② 引入模式 ← 借「复制源码进项目(Tremor Raw)而非锁版本 npm 包」** ⭐:这正合玉兔6「单机零依赖 / 可掌控」取向——**把需要的组件源码拷进控制台自维护**,避免外部包升级/断更风险(对照 30 批 free-tex-packer 停更教训)。
  - **③ 技术栈对照 ← Tailwind + Radix UI 作为可访问性基线**:若控制台用 Tailwind,Tremor/Radix 的无障碍实现可作参照。
- 边界:同为 React 组件,**非 React 则借「仪表盘组件清单 + 复制粘贴引入模式」思路**;本仓为较新的 Raw 版(84 commits、3.5k★),成熟度不及 Mantine,**建议按需取单个组件源码、不整仓依赖**。Apache-2.0,复制/改写安全。
- 难度:低(复制单组件源码即用)。优先级:**中**(控制台仪表盘是真需求,但属「要做可视化时再取」;当下可先收藏其 KPI/图表组件作为实现参照)。

### 本批小结(给 CEO 的一句话借鉴)
- **CopilotKit/CopilotKit**:学它「**AG-UI 把 agent↔前端做成协议(流式 + tool call + 共享状态 + HITL)+ 生成式 UI + 随包 skills 分发**」——给控制台一套现成的「agent→前端事件 schema」与「人工审批一等 UI」,直击运行视图与审批门;只借协议/范式,不接其 React runtime。
- **mantinedev/mantine**:学它「**Spotlight(`Ctrl+K` 命令面板)+ 通知系统 + 集中式 modals + 80+ hooks**」——把控制台最常自造的「系统级 UX 件」标准化;React 则按包即用、可只装两个轻包,非 React 则借交互模型。
- **tremorlabs/tremor**:学它「**专做仪表盘的 KPI/图表组件 + shadcn 式复制源码引入(Tremor Raw)**」——给控制台可观测/dashboard 一套好看、Apache-2.0、可掌控的组件;按需拷源码、不整仓依赖。
- **本批不新增待办卡**(延续七–十、十二–二十六、二十八–三十四批的克制口径;唯十一批因真漏洞、二十七批因 insights.md 真实膨胀破例)。理由:三例最值钱的落地——**「控制台采用 AG-UI 事件 schema / 加 HITL UI」「控制台引入命令面板 + 通知系统」「控制台用 Tremor 做 dashboard」**——均属**产品/主管的前端架构与 UX 决策**,非「明确值得立刻做」的原子动作,且(运行可视化、可观测)多与已有方向同源。**若 CEO 想立刻、最小、最可逆地动一步**:把 **CopilotKit 的 AG-UI 事件类型(text / tool-call / state / HITL)作为控制台 eventlog 的结构化字段范式**(纯 schema、零依赖、改完即用),或在控制台先落一个 **`Ctrl+K` 命令面板**(借 Mantine Spotlight 交互模型)——二者落地面最小、价值最高,直接补「控制台运行视图无结构 / 动作入口零散」两处短板。**Starlaid/星桥 全程排除。**

> watch(本批 web_fetch 直读实时元数据;HEAD commit SHA 因代理限制未取,待网络可达回填):CopilotKit/CopilotKit `main`(**MIT → watch=true**,35.4k★/4.4k forks/11,805 commits,latest bot-slack/v0.0.3 2026-06-19,TS;关注 AG-UI 协议演进与生成式 UI 规格 A2UI / MCP Apps)、mantinedev/mantine `master`(**MIT → watch=true**,31.1k★/2.3k forks/15,140 commits,latest 9.2.1 2026-05-14,TS;关注 spotlight/notifications/hooks 的 API 与 9.x 演进)、tremorlabs/tremor `main`(**Apache-2.0 → watch=true**,3.5k★/162 forks/84 commits,Tremor Raw 复制粘贴版,TS;关注组件覆盖与 Raw 模式成熟度)。另**挂三个下批候选 watch**:**ag-ui-protocol/ag-ui**(AG-UI 协议本体,**尚未 seen**,若控制台采纳事件 schema 应直接读协议仓)、**heroui-inc/heroui**(原 NextUI,Apache-2.0,~29.7k★,**尚未 seen**,作 Mantine 的「美观默认值」对照)、**tremorlabs/tremor-npm**(Tremor 旧 npm 组件库,**尚未 seen**,作 Raw 模式 vs 锁版本包的对照)。



<!-- insight-scout-run:cr-1782360007265-insight-scout-repos-20260625-12 -->
## 2026-06-25 · 自动洞察(20260625-12 · llm-gateway)

> 来源:洞察员; run=cr-1782360007265-insight-scout-repos-20260625-12; queue=insight-scout/insight-scout-repos-20260625-12; network=available

## LLM 网关 / 成本质量路由 / 可观测(slot 20260625-12)

说明:已读 seen/borrowed/insights 去重; litellm/Portkey/Helicone/Bifrost/RouteLLM/openziti/Kong 等已 seen,本轮只列新 URL;联网可用,只核验公开 README/license,未登录授权;Starlaid/星桥未读取、未分析、未推荐。

### tensorzero/tensorzero
- 是什么:Rust LLMOps 栈,统一 gateway、observability、evaluation、optimization、experimentation。
- 值得借鉴:把 inference+feedback+eval+experiment 串成质量/成本飞轮;function/variant + A/B/routing schema 适合作为控制台选模实验字段。
- 迁移边界/许可证:Apache-2.0;GitHub 显示 2026-06-12 已归档,只借数据模型/实验方法,不引运行时。
- URL: https://github.com/tensorzero/tensorzero

### envoyproxy/ai-gateway
- 是什么:CNCF Envoy Gateway 上的 GenAI 流量网关,2026-06-23 v1.0,Apache-2.0。
- 值得借鉴:Tier1/Tier2 网关分层:统一入口做认证/全局限流,二层对自托管模型做细粒度访问和 endpoint picker。
- 迁移边界/许可证:Go/K8s/Envoy 重栈,控制台不接入;只借资源模型、两层网关边界和 GenAI 指标口径。
- URL: https://github.com/envoyproxy/ai-gateway

### openlit/openlit
- 是什么:OpenTelemetry-native LLM observability/AIE engineering platform,Apache-2.0。
- 值得借鉴:一行 SDK 输出 traces/metrics,覆盖 token/cost/latency、prompt/version/evals;`gen_ai.*` 语义约定可直接对齐 eventlog。
- 迁移边界/许可证:自带 ClickHouse/UI/Vault/Collector,不引依赖不处理密钥;只借 OTel 字段命名和 dashboard 指标。
- URL: https://github.com/openlit/openlit

### 给 CEO 的一句话结论
- 建议只推进一个低风险取舍:是否把控制台 LLM 路由日志升级为 `function/variant/inference/feedback/experiment` schema,先服务离线评估和成本质量对账,不引外部 runtime。



<!-- insight-scout-run:cr-1782360706000-insight-scout-repos-20260625-batch36 -->
## 2026-06-25 · 第三十六批(选题:多智能体编排 + 任务队列引擎 — 三例:把「公司 SOP」编译成多 agent 团队 MetaGPT / 模型驱动的极简 agent 循环 + 目录热加载工具 Strands / 资产为中心 + 血缘的编排可观测 Dagster;本批联网,WebSearch + web_fetch 直读核验)

> 说明:本批轮换到**最久未做联网专题的两个方向——「多智能体编排」与「任务队列引擎」**(近批 33 GUI grounding+LLM 网关 / 34 Unity+像素 / 35 agent-tools+网页设计 / 今日 12-slot LLM 网关 均未覆盖这两类;上次成批编排为三十一批 Conductor、队列为三十批 Kestra)。去重已比对 `seen-repos.json`(142 仓库):本批三例(**FoundationAgents/MetaGPT、strands-agents/sdk-python、dagster-io/dagster**)均为**新案例**;与已 seen 的编排群(crewAI / langgraph / openai-agents-python / adk-python / swarm / microsoft-agent-framework / semantic-kernel / agno / mastra / metaswarm / mcp-agent / A2A 等)、队列群(temporal / restate / inngest / conductor / hatchet / windmill / river / dbos / celery / bullmq / asynq / kestra / durabletask-go / goqite 等)均**不重叠**。**「OpenClaw」一类「数周从 9k→210k★ 暴涨」的搜索热词,沿用三十五批口径不予采纳(无法核验真实性 / 合规来源,避免给 CEO 列入不可信案例)。** 本节是给老板 / CEO 看的「值得借鉴」分析,**非待办**;本批**不新增待办卡**(理由见末)。**Starlaid/星桥 全程排除。**

### 1. FoundationAgents/MetaGPT — 把「一家软件公司的 SOP」编译成多 agent 团队:`Code = SOP(Team)`,PM→架构→PM→工程→QA 的角色装配线,角色间以结构化文档(PRD/设计/API)为接口
- 名称/URL:FoundationAgents/MetaGPT(The Multi-Agent Framework: First AI Software Company)— https://github.com/FoundationAgents/MetaGPT
- 核验事实(本批 web_fetch 直读):**MIT**;**69k★ / 8.8k forks / 911 watching / 32 issues / 105 PRs**;**6,367 commits**;**Python 97.5%**;**22 个 release(最新 tag v0.8.1,2024-04-22 — 注:release tag 偏旧,但主干 6,367 commits、2025 持续活跃:2025-02 发布自然语言编程产品 MGX、SPO/AOT 论文、AFlow 获 ICLR 2025 oral top-1.8%)**;核心理念 **`Code = SOP(Team)`** — 把标准作业程序(SOP)物化为 prompt 序列,套到 LLM 组成的团队上;内置 **产品经理 / 架构师 / 项目经理 / 工程师 / QA** 五角色,输入一句需求,输出 user story / 竞品分析 / 需求 / 数据结构 / API / 文档等。
- 它优秀在哪:多数 agent 框架解决「怎么把若干 agent 连起来」,MetaGPT 给的是更高层的范式——**把「人类组织的角色分工 + 标准流程」当作程序本体**。两个最值钱点:① **SOP 即代码**:每个角色的职责/步骤被编码成固定 prompt 序列,流程可复用、可审查、可复刻;② **文档即接口**:角色之间不是随意聊天,而是以**结构化中间产物(PRD→设计→任务→代码)**逐级交接,上游的产出 schema 就是下游的输入契约——这让多 agent 协作从「自由对话」变成「装配线」,显著降低交接噪声与漂移。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 部门/工位角色体系 ← 借「`Code = SOP(Team)` + 角色装配线」** ⭐⭐:这是对 玉兔6 最贴脸的一点——玉兔6 本身就是「公司」隐喻(董事会 / HR / 各工位 / 洞察员)。MetaGPT 的范式正告诉我们:**把每个工位 = 「角色定义 + 显式 SOP(prompt 序列)+ 结构化输入/输出契约」**,而不是把流程写死在调用链里。可借此把 玉兔6 的派单从「隐式约定」升级为「每工位一份 SOP + I/O schema」,交接更可靠、可复刻(呼应三十批 Kestra「配置即流程」、三十一批 Conductor「每节点显式定义」)。
  - **② 看板「文档即接口」← 借「结构化中间产物作为 agent 间唯一接口」** ⭐:玉兔6 的 board(insights.md / cards.json / repair-tickets / status-rollup)已是文档驱动;MetaGPT 把这一点上升为纪律——**每次交接产出一份 schema 固定的文档,下游只认 schema**。玉兔6 可据此把工位间交接产物统一为「带固定 front-matter / 字段的结构化文件」,减少口头 / 自由格式交接。
  - **③ AFlow(自动编排生成)— 概念**:MetaGPT 的 AFlow 研究「自动生成 / 优化 agentic workflow」。玉兔6 远期若要「让系统自己优化派单流程」,可作方法参照(低优先、研究性)。
- 边界:MetaGPT 是**以代码生成为主**的 Python 框架 + 自带 runtime,玉兔6 **不接入其 runtime**;只借**「SOP 编码 + 角色 I/O 契约 + 文档即接口」三个设计范式**。MIT,读借/改写友好。注意 release tag 偏旧(v0.8.1/2024),但主干与生态(MGX/AFlow)活跃,采纳时以**理念**为主而非锁定某版本。
- 难度:中(属角色 / 流程设计与文档 schema 约定,非引库)。优先级:**高**(直击 玉兔6「公司隐喻」的角色/SOP/交接核心,且可纯设计落地、渐进可逆)。

### 2. strands-agents/sdk-python — AWS 开源、「模型驱动」的极简 agent SDK:不写死流程图,给提示+工具让模型自己规划;@tool 装饰器 + 目录热加载工具 + OTel 原生 + Graph/Swarm/Workflow 多 agent 模式
- 名称/URL:strands-agents/sdk-python(A model-driven approach to building AI agents)— https://github.com/strands-agents/sdk-python
- 核验事实(本批 web_fetch 直读):**Apache-2.0**;**5.9k★ / 837 forks / 49 watching / 336 issues / 158 PRs**;**699 commits**;**Python 100%**;**58 个 release(最新 v1.40.0,2026-05-14,活跃)**;由 AWS 构建(模板出自 amazon-archives),**生产在用:Kiro / Amazon Q / AWS Glue**;能力:**模型驱动的简单 agent loop**(模型负责规划与工具选择)、**模型无关**(Bedrock / Anthropic / Gemini / LiteLLM / Llama / Ollama / OpenAI / Writer…)、**内建 MCP**、**多 agent(Graph / Swarm / Workflow 三模式 + A2A 协议)**、**@tool 装饰器(docstring 即工具描述)**、**从 ./tools/ 目录热加载工具**、**OpenTelemetry 原生可观测**、实验性双向语音流。
- 它优秀在哪:它代表与「显式 DAG 编排」相反的一派——**model-driven**:不把任务流程硬编码成图,而是给模型一个角色 prompt + 一组工具,靠模型推理自己决定「想→选工具→再想」直到完成。最值钱三点:① **把「该用自主循环 vs 该用显式流程」讲清楚**:同一 SDK 内既有 model-driven loop,也有 Graph/Swarm/Workflow 显式多 agent 模式,选型边界清晰;② **工具注册极简**:`@tool` + docstring 自动成为 LLM 可见的工具描述,且**目录热加载**(丢个文件进 ./tools/ 即可被 agent 发现);③ **可观测是默认**(OTel 原生),production 级且被 AWS 自家产品验证。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 编排选型 ← 借「model-driven loop ↔ Graph/Swarm/Workflow 的分层」** ⭐⭐:玉兔6 编排若偏固定调用链,Strands 提供清晰范式——**探索型任务(如洞察员选题 / 查新)用 model-driven 自主循环**,**确定性任务(派单 / 出包 / 复看)用显式 workflow**。这条「按任务确定性选编排模式」的边界,值得直接纳入 玉兔6 编排设计。
  - **② 能力/skills 注册 ← 借「@tool + docstring 即 schema + 目录热加载」** ⭐:正合 玉兔6 的工具 / skills 治理与既往「统一 skill 描述」共识——**「目录即能力库 + 描述从 docstring 自动抽取 + 热加载」**是极简注册范式,玉兔6 能力注册可对照(让新增能力 = 放一个带描述的文件)。
  - **③ 控制台可观测 ← 借「agent loop 的 OTel span 语义」**:呼应今日 12-slot openlit、三十三批 openziti、三十一批 Conductor「可观测应默认」——把 agent loop 每步(model call / tool call)作为 OTel span,控制台 eventlog 可对齐这套 span 命名,接入标准追踪。
- 边界:Strands 是 **Python SDK + 自带 loop**,玉兔6 **不整体接入**;借**「model-driven vs 显式编排的选型 + 目录热加载工具注册 + OTel span 语义」**三点。Apache-2.0 友好。注意 model-driven 自主性高,对**高风险写动作**仍须叠加 玉兔6 既有「人工审批门」红线。
- 难度:中(编排选型 + 工具注册范式借鉴)。优先级:**中-高**(编排理念与工具注册对 玉兔6 直接,但属架构选型而非单一原子动作)。

### 3. dagster-io/dagster — 「资产为中心」的编排平台:声明你要的产物(@asset),引擎负责何时跑+保新鲜,自动血缘 + 可观测 + 资产图 UI,能在故障前算出「下游影响半径」
- 名称/URL:dagster-io/dagster(Orchestration platform for the development, production, and observation of data assets)— https://github.com/dagster-io/dagster
- 核验事实(本批 web_fetch 直读):**Apache-2.0**;**15.6k★ / 2.2k forks / 155 watching / 2.2k issues / 474 PRs**;**27,672 commits**;**Python 80.9% / TypeScript 17.0%**;**415 个 release(最新 1.13.8 core / 0.29.8 libs,2026-06-04,活跃)**;定位「**云原生数据管线编排,贯穿开发→生产→观测,内建血缘与可观测、声明式编程模型、一流可测试性**」;核心范式 **asset-centric(资产为中心,区别于 task-centric)**:用 `@asset` 把你要产出的「资产(表 / 模型 / 报告)」声明为 Python 函数,引擎据依赖自动决定何时运行、保持资产新鲜,并**自动追踪血缘**——「在故障波及下游前就能算出完整的 blast radius」;Web UI 直接渲染**资产图(lineage)**;仓库自带 `.claude / CLAUDE.md / .mcp.json`(维护方自身在用 agent 工具链)。
- 它优秀在哪:几乎所有已 seen 的队列 / 编排(temporal / conductor / hatchet / kestra…)都是 **task-centric(以「要跑的任务」为单位)**;Dagster 反过来以 **「要产出的资产 + 其上游依赖」**为单位。这带来三个独特能力:① **血缘自动化**:谁由谁派生一目了然,改一处能立刻算出「影响哪些下游产物」;② **新鲜度 / 健康视角的可观测**:资产是否过期、上次物化何时、元数据如何,都是一等公民;③ **声明式 + 可测试**:本地=生产同一套,资产可单元 / 集成测试。对「产物一致性」要求高的系统极其对味。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 产物即资产 + 血缘 ← 借 Dagster 的 asset-centric 数据模型** ⭐⭐:这是本批最具差异化的借鉴。玉兔6 的产出本就是**文档 / 产物**:insights.md、seen-repos.json、status-rollup、repair-tickets、board cards。与其只想「有哪些任务在跑」,不如改用「**有哪些资产要保持新鲜、它们的上游是谁**」来建模——例如 status-rollup 派生自 cards+tickets、insights.md 派生自 seen-repos+检索。借此 玉兔6 能回答「**改了 seen-repos 会牵动哪些下游产物的一致性**」(blast radius),直接服务可靠性 / 一致性。
  - **② 控制台可观测 ← 借「资产图 + 物化历史 + 新鲜度状态」UI 范式** ⭐:呼应反复出现的「控制台运行可视化」需求(三十批 Kestra execution 视图、三十一批 Conductor 每节点)——Dagster 的「**资产图 + 每次 materialization 的元数据 / 血缘 + 新鲜度**」是「资产视角」可观测范式,控制台可据此展示 玉兔6 产物健康(哪些过期 / 谁派生谁)。
  - **③ 声明式 + 可测试 ← 借「@asset 声明 + test 优先」**:玉兔6 已有大量 tests/;Dagster「资产可测、本地=生产」的理念可作 玉兔6 产物管线测试参照。
- 边界:Dagster 是 **Python + 自带 webserver / 存储的重平台**,与 玉兔6「单机零依赖」红线冲突 → **不整体接入 runtime**;只借**「asset+lineage 数据模型 + 资产图 / 新鲜度可观测范式 + blast-radius 概念」**。Apache-2.0 友好。
- 难度:中(概念 / 数据模型借鉴,不引平台)。优先级:**中**(asset/lineage 是对 玉兔6 产物一致性的强概念补充,但属架构选型,非主线原子动作)。

### 本批小结(给 CEO 的一句话借鉴)
- **FoundationAgents/MetaGPT**:学它「**`Code = SOP(Team)` + 角色装配线 + 文档即接口**」——给 玉兔6 的「公司隐喻」一套把工位变成「角色 + 显式 SOP + I/O 契约」的范式,让派单与交接可复刻、低漂移;纯设计可落地,不引 runtime。
- **strands-agents/sdk-python**:学它「**model-driven loop ↔ 显式 Graph/Workflow 的选型 + @tool/docstring/目录热加载的工具注册 + OTel 原生可观测**」——给 玉兔6 一条「按任务确定性选编排模式」的边界,和一套极简能力注册范式;不接 SDK,借范式。
- **dagster-io/dagster**:学它「**资产为中心 + 自动血缘 + 新鲜度可观测 + blast radius**」——给 玉兔6 把产物(insights / seen-repos / status-rollup…)当「带上游依赖的资产」来管,能算出「改一处影响哪些下游」;只借数据模型与可观测范式,不接重平台。
- **本批不新增待办卡**(延续七–十、十二–二十六、二十八–三十五批的克制口径;唯十一批因真漏洞、二十七批因 insights.md 真实膨胀破例)。理由:三例最值钱的落地——**「工位 = 角色 + SOP + I/O 契约」「按确定性选 model-driven / 显式编排」「玉兔6 产物按资产 + 血缘建模」**——均属**产品 / 主管的架构与流程设计决策**,非「明确值得立刻做」的原子动作,且多与已有方向(配置即流程、可观测默认、产物一致性)同源。**若 CEO 想立刻、最小、最可逆地动一步**:挑 1 个高频工位(如洞察员),按 MetaGPT 范式给它写一份**显式 SOP + 固定 I/O front-matter schema**(纯文档、零依赖、改完即用);或给 board 关键产物加一行**「upstream: [...]」front-matter**(借 Dagster 血缘思想,最小起步)——二者落地面最小、价值最高,直接补「交接靠隐式约定 / 产物无显式血缘」两处短板。**Starlaid/星桥 全程排除。**

> watch(本批 web_fetch 直读实时元数据;HEAD commit SHA 因代理限制未取,待网络可达回填):FoundationAgents/MetaGPT `main`(**MIT → watch=true**,69k★/8.8k forks/6,367 commits,latest tag v0.8.1/2024-04-22 但主干活跃,Python;关注 MGX/AFlow 与角色 SOP 演进)、strands-agents/sdk-python `main`(**Apache-2.0 → watch=true**,5.9k★/837 forks/699 commits,latest v1.40.0/2026-05-14,Python;关注 model-driven loop、Graph/Swarm/Workflow 与 bidi 语音转正)、dagster-io/dagster `master`(**Apache-2.0 → watch=true**,15.6k★/2.2k forks/27,672 commits,latest 1.13.8/2026-06-04,Python/TS;关注 asset/lineage 与 RUN_API、dg-cli 演进)。另**挂三个下批候选 watch**:**camel-ai/camel**(多 agent「角色扮演 / agent 社会」,尚未 seen,作 MetaGPT 的对照)、**pydantic/pydantic-ai**(类型安全 agent + 结构化输出,尚未 seen,接 玉兔6「任务可靠执行」)、**PrefectHQ/prefect**(动态 Python 编排 + 可观测,尚未 seen,作 Dagster task-centric 对照)。



<!-- insight-scout-run:cr-1782374409464-insight-scout-repos-20260625-16 -->
## 2026-06-25 · 自动洞察(20260625-16 · gui-grounding)

> 来源:洞察员; run=cr-1782374409464-insight-scout-repos-20260625-16; queue=insight-scout/insight-scout-repos-20260625-16; network=available

## GUI grounding / computer-use / a11y 公开案例扫描(slot=20260625-16)
说明:已读 seen/borrowed/insights 去重; OmniParser、OSWorld、ShowUI、UI-TARS、Agent-S、UI-Venus 等已 seen,本轮只列新 URL; 已按红线排除 Starlaid/星桥; 不登录授权,不安装依赖,不改运行代码。

### ServiceNow/BrowserGym
- 是什么:网页 agent 的 Gym 环境,统一 MiniWoB、WebArena、VisualWebArena、WorkArena 等 benchmark。
- 值得借鉴:把 DOM、accessibility tree、截图/坐标放进同一 observation,并用任务类统一 reset、step、评价。
- 迁移边界/许可证不确定项:Apache-2.0; benchmark 数据和目标站点各有依赖/授权边界,控制台只借 observation schema。
- URL: https://github.com/ServiceNow/BrowserGym

### google-research/android_world
- 是什么:Android 真机/模拟器 computer-use benchmark,公开 116 个跨 20 个 app 的可复现任务。
- 值得借鉴:用 durable reward signal + 随机参数化任务做回放评价,适合对照移动端/桌面 agent 的完成判定。
- 迁移边界/许可证不确定项:Apache-2.0,内含 MiniWoB 相关 MIT 资产说明;依赖 Android emulator/a11y forwarding,不直接接入。
- URL: https://github.com/google-research/android_world

### OpenAdaptAI/OpenAdapt
- 是什么:桌面/网页 GUI 录制、训练、评估的一体化生成式 RPA 框架。
- 值得借鉴:操作录制到可视化回放、grounding、eval 拆成模块,可参考其失败复盘和示范轨迹管理。
- 迁移边界/许可证不确定项:MIT;录屏/输入日志天然含隐私风险,控制台只借流程闭环,不采集用户敏感操作。
- URL: https://github.com/OpenAdaptAI/OpenAdapt

### 给 CEO 的一句话结论
- 本批不新增公告板卡:已有 a11y tree + 视觉 grounding 双通道卡在板上,本轮三例更适合作为该卡的对照材料。若后续推进,优先借 BrowserGym 的 observation schema 字段,其次借 AndroidWorld 的 reward/eval 设计,OpenAdapt 只作录制回放闭环参考。



<!-- insight-scout-run:cr-1782375144688-insight-scout-repos-20260625-batch37 -->
## 2026-06-25 · 第三十七批(选题:Unity(Simulaid)+ 像素素材/画风 — 三例:示例驱动 + 约束求解的程序化贴图/关卡生成 WaveFunctionCollapse / 像素动画与资产管线的事实标准编辑器 + .ase 格式 + CLI Aseprite / 确定性定点数学 + 可复现随机的仿真地基 FixedMathSharp;本批联网,WebSearch + web_fetch 直读核验)

> 说明:本批轮换到**最久未做联网专题的一对方向——「Unity(Simulaid)」与「像素素材/画风」**(上次成批为第三十四批,2026-06-24 晚;其后 35 agent-tools+网页设计 / 36 多智能体+队列 / 今日 12-slot LLM 网关 / 16-slot GUI grounding 均未覆盖这两类,二者为当前最久未覆盖的一对)。去重已比对 `seen-repos.json`(148 仓库):本批三例(**mxgmn/WaveFunctionCollapse、aseprite/aseprite、mrdav30/FixedMathSharp**)均为**新案例**;与已 seen 的像素群(Pixelorama / LibreSprite / piskel / pixijs / Pixel-Composer / TileGen / ldtk / tiled / Universal-LPC / free-tex-packer / Pixelization / proper-pixel-art / falsprite / spritebrew / AnimatedSprite / webtyler / pixel-forge 等)、Unity 群(UniTask / R3 / MemoryPack / VContainer / LitMotion / Friflo ECS / GOAP / NavMeshPlus / ml-agents / unity-mcp / CardHouse / Addressables / test-framework 等)均**不重叠**。本节是给老板/CEO 看的「值得借鉴」分析,**非待办**;本批**不新增待办卡**(理由见末)。**Starlaid/星桥 全程排除。**

### 1. mxgmn/WaveFunctionCollapse — 「从一张样例图,生成无限张局部一致的位图/瓦片地图」:示例驱动 + 约束求解(熵坍缩)的程序化生成范式,游戏关卡/贴图生成的奠基算法
- 名称/URL:mxgmn/WaveFunctionCollapse(Bitmap & tilemap generation from a single example with the help of ideas from quantum mechanics)— https://github.com/mxgmn/WaveFunctionCollapse
- 核验事实(本批 web_fetch 直读):**25.1k★ / 1.3k forks / 158 commits / 1 release**;**C# 100%**;**许可证为非标准许可(GitHub 显示 "View license",非 SPDX 标准识别)——采纳/再分发前须读 LICENSE 确认条款**;README 自述「This program generates bitmaps that are locally similar to the input bitmap」;两种模型:**Overlapping model**(从一张样例学 NxN 像素模式)与 **Simple Tiled model**(瓦片 + 邻接约束);以「熵坍缩(类量子)」做约束传播。业界影响极大(Caves of Qud、Bad North、Townscaper 等程序化生成均受其启发/采用)。
- 它优秀在哪:多数像素/瓦片工具解决「怎么画」,WFC 解决「**给一张手绘样例,自动长出风格一致、约束满足的无限变体**」。两个最值钱点:① **示例驱动**——不写规则,喂一张样例图,算法自动学习局部模式并复制其「画风/邻接关系」;② **约束求解**——把生成建模成「每格是所有可能性的叠加态,逐格坍缩 + 传播邻接约束」,产出保证「局部处处合法」。等于把「程序化生成风格一致的关卡/贴图」从手写规则降到「给个例子」。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 像素素材/画风一致 ← 借「示例驱动 + 邻接约束的瓦片变体生成」** ⭐⭐:接三十四批 Pixel-Composer「节点图即素材 / 画风可强制统一」、TileGen/ldtk「瓦片地图」——WFC 补的是**「给一张样例 tile-set,自动生成大量风格统一、接缝合法的地图/纹理变体」**,让 玉兔6/Simulaid 的像素场景不必逐张手绘,且**画风由样例锁定**(与「调色板节点统一画风」同向但更自动)。
  - **② Simulaid 程序化场景 ← 借「约束式地图生成 + 固定种子可复现」** ⭐:Simulaid 做 agent 仿真需要**多样但受控的环境**;WFC 用固定 seed + 同一样例 = **可复现的程序化地图**(直接呼应本批第 3 例与三十三批 ScaleCUA/三十六批 R3 的「可复现/可回放」共识),适合批量生成仿真关卡。
  - **③ 生成范式(概念)← 借「约束传播 / 叠加态坍缩」思路**:玉兔6 若有「在约束下自动排布」的场景(如布局/排程),WFC 的约束求解范式可作参照(低优先、概念性)。
- 边界:**许可证非 SPDX 标准(GitHub "View license")——直接拷贝 C# 源码再分发有风险,采纳前必须读其 LICENSE**;算法本身公开且文档详尽,**建议借「算法/范式」并选用许可证清晰的社区移植(JS/C++/Unity 端众多)落地**,而非整仓搬运。本体 158 commits、近年低频更新(算法已稳定),属「经典稳定」而非「活跃迭代」。
- 难度:中(算法集成/移植)。优先级:**中**(对像素画风一致 + Simulaid 程序化场景有实打实价值,但属「要做程序化内容时再取」,非主线原子动作)。

### 2. aseprite/aseprite — 像素动画的事实标准编辑器:layers/frames 分离 + 索引调色板 + 洋葱皮 + **sprite-sheet(.png+.json)导出** + **CLI 自动化** + **Lua 脚本**,一套完整的像素资产创作与管线
- 名称/URL:aseprite/aseprite(Animated sprite editor & pixel art tool)— https://github.com/aseprite/aseprite
- 核验事实(本批 web_fetch 直读):**37.3k★ / 8.1k forks / 444 watching / 1.9k issues / 72 PRs**;**10,624 commits**;**127 个 release(最新 v1.3.17.2,2026-04-29)**;**C++ 94.1% / Lua 3.9%**;由 David Capello 原创、现由 **Igara Studio** 维护;**许可证关键边界:源码与官方发行版/二进制走 EULA(专有许可,非 OSS)**,但**源码中部分库为 MIT(laf / clip / undo / observable / ui)**,另有教育许可与 Steam 许可。能力:**layers & frames 分离**、RGBA/**索引调色板(≤256 色)**/灰度、**洋葱皮动画预览**、**导出/导入 sprite sheet(.png + .json 元数据)/ GIF / PNG 序列**、图层组、参考图层(rotoscoping)、Pixel-Perfect/Shading/自定义笔刷、**Tiled 模式(画图案/纹理)**、**Lua 脚本**、**CLI 命令行自动化资产流水线**、崩溃数据恢复、非线性撤销。
- 它优秀在哪:它是像素动画领域**事实标准**,最值钱的不是「能画」,而是**「资产创作 → 管线集成」的整套规范**:① **sprite-sheet + JSON 元数据**是行业通行的精灵表交换格式(帧矩形/动画标签/时长都在 JSON 里);② **CLI 可把「批量导出精灵表 + JSON」做成可自动化步骤**(可进 CI / 资产流水线,呼应二十九批 Unity 构建分段、game-ci);③ **Lua 脚本**让资产处理可编程扩展;④ **索引调色板(≤256 色)**天然服务「画风/调色统一」。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 像素资产交换格式 ← 借「sprite-sheet(.png)+ JSON 元数据 schema」** ⭐⭐:玉兔6/Simulaid 的像素素材需要一个**统一的「图集 + 元数据(帧矩形 / 动画标签 / 时长)」交换格式**;Aseprite 的 sprite-sheet JSON 是事实标准,直接采为 玉兔6 像素资产的 interchange schema,下游(Simulaid 加载器)只认这套 schema(呼应三十六批 MetaGPT「文档即接口」)。
  - **② 资产流水线 ← 借「CLI 批量导出 + 可自动化」** ⭐:把「源 .ase/分层图 → 精灵表 + JSON」做成 **CLI 驱动、可进 CI 的资产构建步骤**(对照二十九批 Unity 配置驱动/构建分段),让像素资产产出可复现、可批处理。
  - **③ 画风统一 ← 借「索引调色板(≤256 色)约束」**:与三十四批 Pixel-Composer「调色板节点统一画风」同向——以**索引调色板**作为 玉兔6 像素资产的画风约束基线。
  - **④ 扩展性(概念)← 借「Lua 脚本化资产处理」**:资产批处理/校验可参考其脚本化扩展模型。
- 边界:**最关键红线——Aseprite 主体是 EULA 专有许可,源码/二进制不可自由借用或再分发**;玉兔6 可借的是**「格式 / JSON schema / CLI 工作流 / 调色板约定」这些事实标准与约定**(格式有公开文档),**不搬其专有源码**;**若确需 OSS 代码,改用已 seen 的 LibreSprite(GPLv2 fork)**;其源码内 MIT 子库(laf/clip/undo/observable/ui)可单独评估。
- 难度:低(采用格式/CLI 约定,不引专有源码)。优先级:**中**(像素资产交换格式 + 流水线标准化是 Simulaid 素材的实用地基,格式采纳低风险且可逆)。

### 3. mrdav30/FixedMathSharp — 确定性定点数学库(.NET/Unity):Fixed64 + 向量/四元数/矩阵 + 可复现随机(DeterministicRandom)+ MemoryPack 序列化,消除浮点漂移,做 lockstep/回放/rollback 的仿真地基
- 名称/URL:mrdav30/FixedMathSharp(A high-precision, deterministic fixed-point math library for .NET)— https://github.com/mrdav30/FixedMathSharp
- 核验事实(本批 web_fetch 直读):**MIT(另有 NOTICE/COPYRIGHT 约束品牌与再分发)**;**60★ / 14 forks / 3 watching / 0 issues / 0 PRs**;**98 commits / 18 个 release(最新 v2.1.1,2026-04-01)**;**C# 99.3%**;**.NET Standard 2.1 / .NET 8 / Unity 2020+(经独立包 FixedMathSharp-Unity)**。能力:**Fixed64 定点数**(整数运算 + 可配 SHIFT_AMOUNT,跨平台位级一致)、**Vector2d/Vector3d、FixedQuaternion(无万向锁)、Fixed4x4/Fixed3x3、BoundingBox/Sphere/Area、定点三角函数**、**DeterministicRandom**(可种子化、零分配、按「世界种子 + 特征键」FromWorldFeature 派生稳定随机流)、**MemoryPack 全量序列化**(.NET8+ 另支持 System.Text.Json);自述「消除浮点漂移,**ideal for lockstep multiplayer / replay systems / rollback / deterministic simulation**」;仓库含 AGENTS.md(维护方自身用 agent 工具链)。
- 它优秀在哪:它直击「为什么仿真难以复现」的**根因——跨平台浮点漂移**。两个最值钱点:① **定点数学=位级确定性**:同样的输入,在任意机器/平台得到**完全一致**的数值结果,这是「bit-exact 可复现仿真 + 回放」的硬地基;② **DeterministicRandom**:可种子化、按「世界种子 + 特征键」派生稳定随机流,让程序化/随机逻辑也**可复现**;再配 **MemoryPack 序列化**(玉兔6 已 seen/借鉴的 Cysharp 库)即可**快照/回放仿真状态**。它聚焦、测试充分、MIT、可 fork 可掌控。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① Simulaid 可复现仿真地基 ← 借「定点数学(Fixed64/向量/四元数)+ DeterministicRandom」** ⭐⭐:这是本批对 Simulaid 最贴脸的一点。玉兔6 反复出现「**可复现仿真 / 可回放**」诉求(三十三批 ScaleCUA、三十六批 R3 FrameProvider/TimeProvider、队列批 Temporal「确定性重放」)——**R3 解决「确定性时序/帧」,FixedMathSharp 解决「确定性数值 + 随机」**,二者正交互补;Simulaid 若以定点数学 + 种子化随机为数值底座,则「(种子 + 输入日志)在任意机器位级重放一致」,直接服务可复现仿真与在线评测。
  - **② 状态快照/回放 ← 借「MemoryPack 序列化全部可序列化结构」** ⭐:玉兔6 已 seen Cysharp/MemoryPack;FixedMathSharp 的结构开箱即可 MemoryPack 序列化——Simulaid 可据此做**仿真状态快照 → 回放/rollback**,与「可复现」闭环。
  - **③ 工程取向 ← 借「定点消除浮点漂移 + 充分单元测试 + fuzzy 比较」**:作为 Simulaid 数值层的可靠性参照。
- 边界:**C# 库,直接落地面在 Simulaid(C#);控制台为 JS/Node,不引此库**(对控制台仅为「确定性数值」概念参照)。MIT 友好、可 fork(合 玉兔6 单机零依赖/可控红线);但**仓库较小(60★、单人为主)**,采纳宜「早期纳入数值底座」并自留 fork,**避免在 Simulaid 成熟后再大改数值层**(定点化是侵入式改造,越晚越贵)。
- 难度:中(早期纳入低,后期改造高)。优先级:**中-高**(对 Simulaid「可复现/回放」是关键拼图,且补齐了 R3 时序之外的「数值 + 随机」确定性;但属架构选型,非当前主线原子动作)。

### 本批小结(给 CEO 的一句话借鉴)
- **mxgmn/WaveFunctionCollapse**:学它「**示例驱动 + 邻接约束的程序化瓦片/贴图生成(熵坍缩)**」——给 玉兔6/Simulaid 像素素材「**喂一张样例,自动长出风格一致、接缝合法的无限地图/纹理变体**」,固定种子即可复现;**注意其许可证非 SPDX 标准,宜借算法/范式 + 用许可证清晰的移植落地,不整仓搬运**。
- **aseprite/aseprite**:学它「**sprite-sheet(.png)+ JSON 元数据 schema + CLI 自动化资产流水线 + 索引调色板**」——给 Simulaid 像素资产一套事实标准的「图集 + 元数据」交换格式与可进 CI 的产出流水线;**关键红线:主体 EULA 专有,只借格式/CLI/调色约定,不搬专有源码;要 OSS 代码改用已 seen 的 LibreSprite**。
- **mrdav30/FixedMathSharp**:学它「**确定性定点数学 + DeterministicRandom + MemoryPack 序列化**」——给 Simulaid 一个「(种子 + 输入)位级可复现」的数值/随机底座,与 R3 的确定性时序正交互补,直接服务可复现仿真/回放;C# 仅落 Simulaid,控制台不引。
- **本批不新增待办卡**(延续七–十、十二–三十六批的克制口径;唯十一批因真漏洞、二十七批因 insights.md 真实膨胀破例)。理由:三例最值钱的落地——**「Simulaid 程序化场景用 WFC」「Simulaid 像素资产采 Aseprite 格式/CLI」「Simulaid 数值层用 FixedMathSharp 做确定性底座」**——均属**产品/主管的 Simulaid 架构与资产管线选型**,非「明确值得立刻做」的原子动作,且多与已有方向(三十四批像素管线、三十六批可复现、二十九批构建分段)同源。**若 CEO 想立刻、最小、最可逆地动一步**:把 **Aseprite 的 sprite-sheet JSON 作为 玉兔6 像素资产 interchange schema 写成一页约定**(纯文档、零依赖、即用),或在 Simulaid 起一个 **FixedMathSharp 数值 spike**(MIT、独立包、可逆)验证「定点 + 种子随机」位级可复现——二者落地面最小、价值最高,直接补「像素资产无统一格式 / 仿真数值不确定」两处短板。**Starlaid/星桥 全程排除。**

> watch(本批 web_fetch 直读实时元数据;HEAD commit SHA 因代理限制未取,待网络可达回填):mxgmn/WaveFunctionCollapse `master`(**许可证非 SPDX 标准 → watch 待定:采纳前先核 LICENSE**,25.1k★/1.3k forks/158 commits,C#;关注社区许可清晰的移植与瓦片模型扩展)、aseprite/aseprite `main`(**EULA 专有 → watch=false(不借源码);只跟踪格式/CLI 文档**,37.3k★/8.1k forks/10,624 commits,latest v1.3.17.2/2026-04-29,C++/Lua)、mrdav30/FixedMathSharp `main`(**MIT → watch=true**,60★/14 forks/98 commits,latest v2.1.1/2026-04-01,C#;关注 Unity 包 FixedMathSharp-Unity 与确定性物理/碰撞演进)。另**挂三个下批候选 watch**:**mrdav30/FixedMathSharp-Unity**(Simulaid 若采定点数学,直接读 Unity 包,**尚未 seen**)、**danielmansson/Unity.Mathematics.FixedPoint**(基于 Unity.Mathematics 的定点扩展,作 FixedMathSharp 的对照,**尚未 seen**)、**LibreSprite/LibreSprite**(已 seen 的 Aseprite GPL fork,若需 OSS 像素编辑器源码可复看上游)。



<!-- insight-scout-run:cr-1782388852901-insight-scout-repos-20260625-20 -->
## 2026-06-25 · 自动洞察(20260625-20 · pixel-assets-ui)

## 像素素材生成 / 控制台 UI 借鉴扫描 slot=20260625-20
说明:network_status=available;已读 seen-repos/borrowed-libs/insights 去重;Piskel、Pixelorama、Aseprite、shadcn、Tremor、Mantine、HeroUI 等已见 URL 不重复;Starlaid/星桥 全程排除;不登录、不安装、不改运行代码。

### zfedoran/pixel-sprite-generator
- 是什么:MIT JavaScript 程序化像素 sprite 生成器,用二维 mask 随机化后镜像并渲染到 canvas。
- 值得借鉴:把 seed/template/mask 作为可保存参数,适合给像素素材面板做“快速草稿/批量变体”而非最终美术。
- 迁移边界/许可证不确定项:MIT 已核;2021 后低活跃且依赖旧式 npm/bower,只借算法与参数面板。
- URL:https://github.com/zfedoran/pixel-sprite-generator

### marmelab/react-admin
- 是什么:MIT React/TS 后台框架,面向 REST/GraphQL 单页后台,提供 auth、权限、datagrid、筛选、表单、通知等。
- 值得借鉴:Resource/DataProvider 把 CRUD、列表筛选和权限做成声明式资源,适合控制台任务/公告/洞察记录管理页。
- 迁移边界/许可证不确定项:MIT 已核;Material UI/React 栈较重,非 React 页面只借资源模型和列表交互。
- URL:https://github.com/marmelab/react-admin

### refinedev/refine
- 是什么:MIT React enterprise meta-framework,主打 headless internal tools/admin/dashboard。
- 值得借鉴:把 auth/access/routing/networking/state/i18n 与 UI 解耦,可同时接 Tailwind/Mantine/MUI/AntD/Chakra。
- 迁移边界/许可证不确定项:MIT 已核;引入前需确认控制台技术栈,本轮只建议借“业务逻辑与 UI 分离”范式。
- URL:https://github.com/refinedev/refine

### 给 CEO 的一句话结论
- 本批不新增公告板卡:三例都适合作为设计/选型参考;低风险下一步是把像素草稿生成器的 seed/mask 参数模型、控制台 Resource/DataProvider 资源模型写进未来 PoC brief。



<!-- insight-scout-run:cr-1782389420324-insight-scout-repos-20260625-batch38 -->
## 2026-06-25 · 第三十八批(选题:多智能体编排 + AI agent 工具与 skills — 三例:角色扮演 + Workforce 分层编排的多 agent 框架 camel-ai/camel / 类型安全 + 结构化校验 + 声明式 spec + 人审闸门的 agent 框架 pydantic-ai / 「动作即代码」+ 沙箱安全边界的极简 agent 库 smolagents;本批联网,WebSearch + web_fetch 直读核验)

> 说明:本批轮换到**多智能体编排 + AI agent 工具与 skills**(避开今日 slot 已覆盖的 LLM 网关/12、GUI grounding/16、像素+UI/20,以及 batch36 多智能体+队列 / batch37 Unity+像素)。本批三例正是 **batch36 末尾挂出的「下批候选 watch」**(camel、pydantic-ai)加一例 agent 工具/skills 代表(smolagents)。去重已比对 `seen-repos.json`(154 仓库):**camel-ai/camel、pydantic/pydantic-ai、huggingface/smolagents** 均为**新案例**,与已 seen 的 agent 框架群(langgraph / crewAI / agno / mastra / MetaGPT / strands / openai-agents / swarm / adk-python / mcp-agent / semantic-kernel 等)、工具/skills 群(fastmcp / instructor / baml / superpowers / anthropics·skills / agent-skills-hub 等)均**不重叠**。本节是给老板/CEO 看的「值得借鉴」分析,**非待办**;本批**不新增待办卡**(理由见末)。**Starlaid/星桥 全程排除。**

### 1. camel-ai/camel — 「找 Agent 的 Scaling Law」:RolePlaying 角色扮演(inception prompting)+ Workforce 分层编排(协调者 + worker + 失败重指派)+ Agent Society,首个 LLM 多 agent 框架
- 名称/URL:camel-ai/camel(🐫 CAMEL: The first and the best multi-agent framework. Finding the Scaling Law of Agents)— https://github.com/camel-ai/camel
- 核验事实(本批 web_fetch 直读):**17.1k★ / 1.9k forks / 120 watching**;**Apache-2.0**;**210 个 release(最新 v0.2.90,2026-03-22)**;Python;100+ 研究者社区;源出论文《CAMEL: Communicative Agents for "Mind" Exploration of Large Language Model Society》。核心能力:**RolePlaying**(AI User + AI Assistant 两角色用 inception prompting 自主对话推进任务,最小人工介入)、**Workforce**(`camel/societies/workforce`:协调者把任务分解 → 指派给最合适 worker → 失败回收重派的分层编排模块)、**Agent Society**、检索增强多 agent 对话(RAG),自述目标是「**通过数据生成 + 环境交互让多 agent 系统自演化(可由可验证奖励 RL 或监督学习驱动),支撑到百万级 agent 的协调/通信/资源管理**」;落地产品如 Eigent(multi-agent workforce)、OWL。
- 它优秀在哪:多数 agent 框架解决「单 agent 怎么调工具」,CAMEL 从一开始就解决「**多 agent 怎么自主协作 + 怎么规模化**」。两个最值钱点:① **Workforce 分层编排**——不是平铺多 agent,而是「**协调者分解任务 → 按能力指派 worker → 失败回收重指派**」的可治理装配线;② **RolePlaying**——用结构化角色提示(inception prompting)让「用户角色 + 助手角色」自主对话推进,把「人来回喂指令」降为「角色驱动自走」。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 编排/派单 ← 借 Workforce「协调者分解 + 按能力指派 + 失败重派」** ⭐⭐:玉兔6 的「公司隐喻」本就有多工位(洞察员/主管/秘书…)与公告板派单。Workforce 的「**协调者把目标拆成子任务 → 指派给最合适工位 → worker 失败则回收重派**」正是 玉兔6 编排层「派单/认领/重试」可直接对标的范式(承接 batch36 MetaGPT 角色装配线、strands Graph),补「失败重指派」这一玉兔6 队列/编排尚未显式化的环节。
  - **② 角色协作/交接 ← 借 RolePlaying「inception prompting + 角色对话自主推进」** ⭐:玉兔6 工位间交接(秘书→主管→worker)目前靠隐式约定;借「**以结构化角色提示驱动、角色对话自主推进、最小人工介入**」可降低交接漂移(与 batch36「工位=角色+SOP+I/O 契约」同源)。
  - **③ Simulaid 自演化(概念)← 借「环境交互产数据 + 可验证奖励」**:与 batch33 ScaleCUA、slot-16 android_world 的 reward/eval 同向,作 Simulaid 在线评测/自演化的低优先概念参照。
- 边界:**Python 重框架**(大量模型/工具/RAG 集成),与 玉兔6「单机零依赖」红线冲突 → **不整体接 runtime**;只借「**Workforce 分层编排 + RolePlaying 角色协议 + 自演化**」概念。Apache-2.0 友好、可 fork。**注意 v0.2.x 版本号低、210 releases 迭代极快 → API 不稳定,借范式不锁版本/不嵌库**。
- 难度:中(概念/编排范式借鉴,不引框架)。优先级:**中**(对 玉兔6 编排「失败重派 + 角色驱动派单」是实打实补强,但属架构选型,非主线原子动作)。

### 2. pydantic/pydantic-ai — 「把 FastAPI 的手感带到 Agent」:类型安全 + Pydantic 结构化输出校验(失败自动重试)+ 声明式 agent-spec(YAML/JSON)+ human-in-the-loop 工具批准 + Pydantic Graph + 原生 OTel 可观测
- 名称/URL:pydantic/pydantic-ai(AI Agent Framework, the Pydantic way)— https://github.com/pydantic/pydantic-ai
- 核验事实(本批 web_fetch 直读):**17.5k★ / 2.2k forks / 110 watching / 394 issues / 189 PRs / 2,128 commits**;**MIT**;**263 个 release(主干最新 tag v1.104.0/2026-05-28;另据官方 V2 已稳定,主推 harness-first + capabilities)**;Python 99.7%;由 Pydantic 团队出品(Pydantic 校验是 OpenAI SDK / Google ADK / Anthropic SDK / LangChain / CrewAI / Instructor 等的底层校验层)。核心能力:**完全类型安全**(把整类错误从运行时挪到写码时)、**model-agnostic**(几乎全模型/全 provider)、**Logfire/OTel 原生可观测**、**output_type=BaseModel 结构化输出 + 校验失败把错误喂回模型重试**、**pydantic_graph**(用 type hints 定义状态机/图,防控制流变面条)、**pydantic_evals**(系统化评测)、**capabilities**(把 tools/hooks/instructions/model settings 打包成可复用单元)、**agent-spec:用 YAML/JSON 定义 agent,无需代码**、**MCP/A2A/UI 事件流**、**human-in-the-loop 工具批准**(可按工具参数/对话历史/用户偏好决定某调用是否需批准才执行)、**durable execution**(跨瞬时故障/重启保进度)、**streamed 结构化输出**、依赖注入(RunContext)、`@agent.tool` docstring→工具 schema。仓库本身带 `.claude/`、`.agents/skills/`、`AGENTS.md`、`clai` CLI。
- 它优秀在哪:它把「**把 LLM 输出当成必须通过 schema 校验的数据**」做到了极致,且围绕生产可靠性把「校验重试 / 人审闸门 / 持久执行 / 声明式定义 / 可观测」配齐。最值钱三点:① **结构化输出 + 校验失败自动重试**(产物 schema 自带闭环);② **agent-spec 声明式(YAML/JSON 定义 agent,零代码)**;③ **human-in-the-loop 工具批准**(把「某些动作必须先批准」做成框架原语)。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 产物/派单一致性 ← 借「output_type=Pydantic 校验 + 失败把错误喂回重试」** ⭐⭐:玉兔6 的关键产物多为结构化(公告板 cards payload、board 文档 front-matter、seen-repos.json、status-rollup)。借「**把产物 schema 显式化 + 生成后校验 + 不合规自动回修**」范式,直接服务 玉兔6「产物一致性」红线(例如洞察卡 payload 必含 role/flowId/goal/bounds/acceptance 字段,缺字段即回修)。
  - **② 配置即流程 ← 借「agent-spec:YAML/JSON 定义 agent」** ⭐:呼应 玉兔6 反复出现的「配置即流程」——把工位(如洞察员)的 tools/instructions/model 用**声明式 spec**表达,而非散在代码/提示里(与 batch36 strands「目录热加载」、batch32 SKILL.md 同向)。
  - **③ 写操作人审闸门 ← 借「human-in-the-loop 工具批准(按参数/历史决定是否需批准)」** ⭐⭐:玉兔6 红线「登录/授权/写操作交主人」「autoApproveHuman」正是这条——pydantic-ai 的「**某些工具调用需批准才执行**」是这条红线的框架级范式,可参照给 玉兔6 的写类动作(发消息/改文件/删除)加「**需 CEO/主管批准**」闸门,且按参数粒度(如仅高风险 payload 才拦)。
  - **④ 可观测/评测 ← 借「pydantic_evals + OTel 原生」**:接 玉兔6「可观测默认」,作工位/产物质量评测与 trace 的参照。
- 边界:**Python 库**,落地面在有 Python 的层;控制台(JS/Node)只借「**schema 校验 + 声明式 spec + 人审闸门**」三概念,不嵌库。MIT 友好。注意 **V2 的 harness/capabilities 是较新方向、API 仍在演进**,借范式优先。
- 难度:中(概念借鉴 + 局部 schema 落地)。优先级:**中-高**(「结构化校验 / 声明式 spec / 写操作人审闸门」三点逐条命中 玉兔6 红线与短板,落地面小且可逆)。

### 3. huggingface/smolagents — 「会用代码思考的 agent」:核心 ~1000 行极简 + CodeAgent(动作即 Python 代码,比 JSON 工具调用少 30% 步数)+ 多沙箱执行(E2B/Modal/Docker/WASM)+ Hub 工具/agent 共享
- 名称/URL:huggingface/smolagents(a barebones library for agents that think in code)— https://github.com/huggingface/smolagents
- 核验事实(本批 web_fetch 直读):**27.3k★ / 2.6k forks / 134 watching / 248 issues / 280 PRs / 1,041 commits**;**Apache-2.0**;**35 个 release(最新 v1.25.0,2026-05-14)**;Python 100%。核心能力:**核心逻辑 <1000 行(agents.py),抽象压到最小**;**CodeAgent**(把动作写成 Python 代码片段执行,工具调用=函数调用;论文佐证比「让 LLM 输出 JSON 工具字典」**少 30% 步数 + 难题更准**)与 **ToolCallingAgent**(JSON/文本动作)两种风格;**安全沙箱执行**:E2B / Modal / Blaxel / Docker / **Pyodide+Deno WebAssembly** —— 并**醒目警告 `LocalPythonExecutor` 不是安全边界、跑不可信代码必须上沙箱**;**Hub 集成**(share/pull tools 与 agents,即时复用);**model/modality/tool-agnostic**(任意 LLM;文本/视觉/视频/音频;工具可来自 MCP server / LangChain / Hub Space);**CLI**(`smolagent` 通用多步、`webagent` 网页浏览);多 agent 分层。
- 它优秀在哪:它用「**~1000 行、抽象最小、可随手 hack**」证明 agent 框架不必臃肿,且把两件硬事做成事实参照:① **CodeAgent「动作即代码」**——并用论文数据量化「比 JSON 工具调用少 30% 步数、难题更强」;② **安全边界讲得最直白**——把「本地执行器≠安全沙箱、不可信代码必须上 E2B/Docker/WASM」写成红线,而非含糊带过。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 工具/动作范式 ← 借「CodeAgent:动作即代码(而非 JSON 工具字典)」** ⭐:玉兔6 工位本就以「写脚本 / 跑 bash / 写文件」完成任务——smolagents 用论文数据为 玉兔6 这条「**以代码为动作**」的现有范式提供**实证背书 + 极简实现参照**(少 30% 步数=少 LLM 调用=更省更稳)。
  - **② 让 agent 跑代码的安全边界 ← 借「沙箱执行选项 + 『本地执行器≠安全边界』红线」** ⭐⭐:玉兔6 反复出现「不装依赖 / 不改运行代码 / 单机可控」红线;smolagents 把「**要跑(不可信)代码就必须上沙箱(E2B/Docker/Pyodide+Deno WASM),本地执行器只是 best-effort 不能当安全边界**」讲得最清楚,可直接作为 玉兔6 给「让工位跑代码」划安全边界的现成认知与选型(尤其轻量的 WASM 沙箱契合单机)。
  - **③ 能力共享 ← 借「Hub:share/pull tools 与 agents」**(概念,接 skills 复用):呼应 玉兔6 skills/能力注册——「**工具/agent 可发布、可拉取、即时复用**」(与 batch32 SKILL.md 渐进披露、batch36 strands 目录热加载同向)。
  - **④ 工程取向 ← 借「核心 <1000 行、抽象最小、鼓励只取所需」**:作 玉兔6 编排/工具层「保持极简、可 hack、不过度抽象」的取向参照。
- 边界:Apache-2.0 友好、可 fork;**Python 库,控制台不直接引**;借「**代码动作范式 + 沙箱安全边界 + 能力共享**」概念。**「LocalPythonExecutor 非安全边界」这点须原样继承为认知**(玉兔6 若让工位执行生成代码,绝不可把简易本地执行当隔离)。
- 难度:低-中(范式/边界/认知借鉴)。优先级:**中**(「让 agent 跑代码的安全边界」对 玉兔6 实用且贴红线;代码动作范式更多是为现状背书)。

### 本批小结(给 CEO 的一句话借鉴)
- **camel-ai/camel**:学它「**Workforce 分层编排(协调者分解 + 按能力指派 + 失败重派)+ RolePlaying 角色驱动协作**」——给 玉兔6 编排/派单一套「分解→指派→重试」与「角色驱动交接」范式,补上「失败重指派」环节;Apache-2.0,但 v0.2.x 迭代极快,**只借范式不锁版本、重框架不接 runtime**。
- **pydantic/pydantic-ai**:学它「**结构化输出 + Pydantic 校验失败自动重试 / 声明式 agent-spec(YAML)/ human-in-the-loop 工具批准**」——三点分别精准命中 玉兔6「产物一致性 / 配置即流程 / 写操作需主人批准」三条红线;MIT,概念借鉴 + 局部 schema 落地,不嵌库。
- **huggingface/smolagents**:学它「**CodeAgent 动作即代码(少 30% 步数)+ 让 agent 跑代码的沙箱安全边界(本地执行器≠安全)+ Hub 工具/agent 共享**」——给 玉兔6「以代码为动作」的实证背书与极简参照,以及「让工位跑代码」的安全边界红线认知;Apache-2.0 可 fork。
- **本批不新增待办卡**(延续七–十、十二–三十七批的克制口径;唯十一批因真漏洞、二十七批因 insights.md 真实膨胀破例)。理由:三例最值钱的落地——**「编排借 Workforce 分层 + 失败重派」「派单/产物用 Pydantic 结构化校验 + 声明式 spec + 写操作人审闸门」「让 agent 跑代码上沙箱边界」**——均属**产品/主管的架构与流程设计决策**,非「明确值得立刻做」的原子动作,且多与已有方向(batch36 编排、配置即流程、可观测默认、写操作交主人)同源。**若 CEO 想立刻、最小、最可逆地动一步**:给某个高频**写操作**工位加一行**「需主人/CEO 批准」闸门字段**(借 pydantic-ai human-in-the-loop,纯配置、零依赖,直补「写操作把关靠隐式约定」短板),或把一个工位的 tools/instructions 写成**声明式 spec front-matter**(借 agent-spec,接「配置即流程」)——二者落地面最小、价值最高。**Starlaid/星桥 全程排除。**

> watch(本批 web_fetch 直读实时元数据;HEAD commit SHA 因代理限制未取,待网络可达回填):camel-ai/camel `master`(**Apache-2.0 → watch=true**,17.1k★/1.9k forks/210 releases,latest v0.2.90/2026-03-22,Python;关注 Workforce 分层编排、societies、Eigent/OWL 落地演进)、pydantic/pydantic-ai `main`(**MIT → watch=true**,17.5k★/2.2k forks/2,128 commits/263 releases,latest v1.104.0/2026-05-28 + V2 harness/capabilities 方向,Python;关注 capabilities/agent-spec YAML/human-in-the-loop/durable execution)、huggingface/smolagents `main`(**Apache-2.0 → watch=true**,27.3k★/2.6k forks/1,041 commits/35 releases,latest v1.25.0/2026-05-14,Python;关注 CodeAgent 沙箱选项与 Pyodide+Deno WASM 执行器)。另**挂三个下批候选 watch**:**PrefectHQ/prefect**(动态 Python 编排 + 可观测,尚未 seen,作 batch36 Dagster 的 task-centric 对照)、**stanfordnlp/dspy**(声明式 LM 程序 + 优化器「编程而非提示」,尚未 seen,接「提示即程序」)、**camel-ai/owl**(CAMEL 的 Workforce 落地通用助手 agent,尚未 seen,作 Workforce 范式的落地样例)。



<!-- insight-scout-run:cr-1782403253704-insight-scout-repos-20260626-00 -->
## 2026-06-25 · 自动洞察(20260626-00 · unity-simulaid-methods)

> 来源:洞察员; run=cr-1782403253704-insight-scout-repos-20260626-00; queue=insight-scout/insight-scout-repos-20260626-00; network=available

## Unity/团结工作流方法论借鉴扫描(slot=20260626-00, network=available)\n说明:已按 seen-repos/borrowed-libs/insights 去重;GitHub API、README 与 License 直读核验,未虚构实时 star/commit/release。\n\n### unity-atoms/unity-atoms\n- 是什么:MIT 的 Unity Scriptable Object Architecture,把状态、事件、配置拆成可组合 Atoms。\n- 值得借鉴:用 SO 变量/事件通道降低 MonoBehaviour 互相依赖,让运行时调参、调试、测试更清晰。\n- 迁移边界/许可证不确定项:MIT 已核;要求 Unity 2022.2+,团结兼容性需版本验证,建议先借架构词汇与拆分方法。\n- URL: https://github.com/unity-atoms/unity-atoms\n\n### UnityTechnologies/open-project-1\n- 是什么:Unity 官方开放协作 demo Chop Chop,Apache-2.0,README 明示 2021-12 后不再开发。\n- 值得借鉴:把 roadmap、issue、QA release、贡献指南、代码风格、场景层级与项目组织规范公开化,适合当 Unity 项目协作模板参考。\n- 迁移边界/许可证不确定项:Apache-2.0 已核;项目是 legacy,只借协作流程和约定文档形态,不照搬版本/外部文档依赖。\n- URL: https://github.com/UnityTechnologies/open-project-1\n\n### openupm/openupm\n- 是什么:BSD-3-Clause 的开源 Unity Package Manager 注册表数据仓,README 描述 scoped registry 与从 Git tags 自动构建发布 UPM 包。\n- 值得借鉴:用 package manifest、CI 校验、tag 驱动发布和包元数据治理,给共享 Unity/团结工具沉淀一套可复查包治理流程。\n- 迁移边界/许可证不确定项:BSD-3-Clause 已核;OpenUPM 是独立服务非 Unity 官方,本轮不安装/发布,只借 manifest 校验与包治理方法。\n- URL: https://github.com/openupm/openupm



<!-- insight-scout-run:cr-1782403813000-insight-scout-repos-20260626-04 -->
## 2026-06-26 · 第三十九批(选题:任务队列引擎 + 优秀网页设计 — 三例:单二进制「确定性可重放」工作流引擎 obeli-sk/obelisk / Node+Postgres「单库即队列」graphile/worker / React+Tailwind 仪表盘模板 TailAdmin;本批联网,WebSearch + web_fetch 直读核验)

> 说明:本批轮换到**任务队列引擎 + 优秀网页设计**(避开今日 slot 已覆盖的:00 Unity/Simulaid 方法论、20 像素+UI/admin 框架,以及 batch38 多智能体+agent 工具)。任务队列引擎上次成批为第三十/批 36(kestra/inngest/restate 一线),本批刻意挑**单机/单库/嵌入式**这一最贴 玉兔6「单机零依赖」红线的细分赛道。去重已比对 `seen-repos.json`(160 仓库):**obeli-sk/obelisk、graphile/worker、TailAdmin/free-react-tailwind-admin-dashboard** 均为**新案例**,与已 seen 的队列/编排群(temporal / restate / inngest / conductor / hatchet / windmill / river / dbos / celery / bullmq / asynq / kestra / trigger.dev / dagster / goqite 等)、UI 群(shadcn / tremor / mantine / tabler / react-admin / refine / satnaing·shadcn-admin 等)均**不重叠**。本节是给老板/CEO 看的「值得借鉴」分析,**非待办**;本批**不新增待办卡**(理由见末)。**Starlaid/星桥 全程排除。一条 license 红线先行提示:案例 1 为 AGPL-3.0 强 copyleft,只可「借概念」绝不可嵌入运行时。**

### 1. obeli-sk/obelisk — 单个二进制的「确定性 + 可重放」工作流引擎:每步落持久执行日志(SQLite/Postgres)→ 崩溃可恢复 + 时间旅行调试;workflow 纯确定(不能碰外部世界),副作用全在幂等可重试的 activity
- 名称/URL:obeli-sk/obelisk(Durable & Deterministic Workflow Engine)— https://github.com/obeli-sk/obelisk
- 核验事实(本批 web_fetch 直读):**446★ / 17 forks / 4 watching / 3 issues / 1 PR / 4,534 commits**;**Rust 98.9%**;**88 个 release(最新 obelisk-v0.36.1,2026-03-30)**;**⚠️ License:主体 AGPL-3.0(强 copyleft);仅 `wit/`、`toml/`、`proto/` 三个子目录为 MIT**;**⚠️ 明文 Pre-release**(CLI/gRPC/WIT/DB schema 都会变)。架构:**单个二进制**同时跑 deterministic workflows + activities + webhook endpoints,**每步持久化进执行日志(execution log),后端 SQLite 或 PostgreSQL**;控制面三件套——**CLI(`obelisk` 管执行)+ gRPC API + Web UI**(看执行日志、提交函数调用、看 WIT 定义、**time-traveling debugger**:回看 backtrace 与每个记录事件的来源)。核心原则:**Replayable Workflows**(确定性执行 → 可靠恢复/调试/审计)、**Resilient Activities**(出错/超时自动重试,输入与结果持久化)、**schema-first 端到端类型安全(WASM Component Model + WIT IDL 生成 API 绑定)**。关键设计:**workflow 代码无能力直接与外界交互——WASM 运行时严格控制,只允许引擎 spawn 子执行并接收结果**,确定性在**编译期**强制;**work-stealing 执行器**带并发上限与可定制重试;**结构化并发**子执行。官方用例首条即「**Sandboxing and auditing of AI-Assisted Code**」,以及周期任务、后台任务、批处理、E2E 测试。
- 它优秀在哪:多数 durable 引擎(已 seen 的 temporal/restate/dbos)用「确定性重放」做可靠性,obelisk 把它推到两个更硬的点:① **彻底的 workflow/activity 二分**——workflow 是**纯确定逻辑、零副作用、零 I/O**,所有副作用(HTTP、写库)都被关进**幂等、可重试、结果持久化的 activity**,且这条「workflow 不能碰外部世界」由 **WASM 沙箱在编译期强制**,不是靠开发者自觉;② **单个二进制 + SQLite 选项 + 内置 Web UI/时间旅行调试器**——把「durable 编排 + 可观测 + 可回放调试」收进一个零外部中间件的发行物。等于给「让(可能是 AI 生成的)代码安全、可审计、可重放地跑」提供了一个工程范本。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 编排/队列「可回放 + 崩溃恢复」← 借「每步落持久执行日志 → 确定性重放」** ⭐⭐:控制台的 run(洞察员每 4h、各工位派单)目前是文件队列,**中途崩了基本是重跑**。obelisk 的「**每步骤写 execution log,重启即从日志重放到断点**」正是 玉兔6 反复出现的「可复现/可回放」诉求(承接 batch37 R3/FixedMathSharp、队列批 temporal「确定性重放」)的编排层落法——可借「**给每个 run 维护一份 append-only 步骤日志,失败/重启从日志续跑而非从头**」,先用在洞察员/高价值派单上。
  - **② 让工位跑代码的安全边界 ← 借「workflow 纯确定不碰外界 + 副作用关进幂等 activity」** ⭐⭐:玉兔6 红线「不改运行代码/单机可控」+ batch38 smolagents「本地执行器≠安全边界」——obelisk 给出更彻底的生产范式:**把有副作用的动作(写文件/发消息/网络)显式标成「activity」=幂等、可重试、结果持久化,编排层只负责派发与收结果;纯逻辑(workflow)不准做 I/O**。玉兔6 编排可借这套「**副作用显式隔离 + 幂等可重试**」边界,直接改善「写操作把关 + 失败重试」(并与 batch38 pydantic-ai 人审闸门正交互补)。
  - **③ 控制台运行可视化 ← 借「Web UI:执行日志 + 时间旅行调试器」** ⭐:接 batch(kestra)「execution = 拓扑+甘特+每步日志」共识,obelisk 再加「**可回看任一历史执行的每一步(backtrace + 事件来源)**」。控制台 run 视图可借「**每个 run 存可回放日志 → 前端按步骤时间旅行查看**」。
- 边界:**⚠️ AGPL-3.0 是硬红线**——强 copyleft,**整体嵌入/链接会传染到 玉兔6**,故**只借概念(持久执行日志 / workflow-activity 二分 / 重放 UI),绝不嵌运行时**;`wit/toml/proto` 虽 MIT 但单独无用。另:**Rust/WASM 栈重、明文 pre-release(schema/API 不稳)**,与 玉兔6「单机零依赖/单机 Node」不直接同栈 → **方法借鉴,不接代码**。
- 难度:高(Rust/WASM + AGPL + 概念移植到 Node 文件队列)。优先级:**中**(「durable 执行日志 + 副作用隔离 + 可重放」是 玉兔6 多次出现的真需求,obelisk 是难得干净的参照;但属编排架构选型,非主线原子动作,且 AGPL 禁止借码)。

### 2. graphile/worker — Node.js + PostgreSQL 的「单库即队列」高性能作业队列:不引 Redis/RabbitMQ,用现有数据库即可;SKIP LOCKED 取活 + 指数退避重试 + crontab 定时 + 事务内入队
- 名称/URL:graphile/worker(High performance Node.js/PostgreSQL job queue)— https://github.com/graphile/worker
- 核验事实(本批 web_fetch 直读):**MIT**;**2.3k★ / 119 forks / 13 watching / 37 issues / 6 PRs / 1,436 commits**;**TypeScript 64.5% / PLpgSQL 14.0% / JavaScript 10.9%**;**61 个 tag/release**;有 npm 包、Docker、Code of conduct、Security policy。定位:「**把作业放后台跑,让 HTTP 响应/应用代码不被拖住**」,**任何 PostgreSQL 应用都能用**,与 PostGraphile/PostgREST 天然搭配。设计理念(README + 官方文档口径):**「让基础设施保持简单」——用你已有的 PostgreSQL 当队列,直到团队大到需要专用队列再换**;能力(搜索+文档核验):**SKIP LOCKED 并发取活、crontab 风格定时任务、指数退避重试、事务内入队(enqueue 与业务逻辑同一 DB 事务,要么都提交要么都回滚)、可由 PG 触发器/函数直接产生作业**;性能口径:单实例约 **100–200 jobs/s**(再高会撞锁争用),4 实例 ×24 并发池化可达 **~196k jobs/s**。
- 它优秀在哪:它最值钱的不是「快」,而是把「**别为队列引中间件**」这件事做成了可信赖的工程现实——**一个库 + 你已有的库 = 完整作业队列**,且把队列该有的硬功能(原子取活的 SKIP LOCKED、带退避的重试、crontab 定时、与业务同事务的入队)都齐活。而且它是**少数 Node 原生**的成熟队列(已 seen 的队列大多是 Python/Go/Java/Elixir),**与控制台(JS/Node)同栈**,读起来即用。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 控制台 队列 语义 ← 借「SKIP LOCKED 原子取活 + 指数退避重试 + crontab 定时」** ⭐⭐:这是本批对控制台最直接的一点。玉兔6 队列是**文件队列**,缺**显式的重试退避与定时抽象**。graphile/worker 的几条机制即使不上 Postgres 也可平移到文件队列:**(a) 原子认领**(文件 rename/锁等价于 SKIP LOCKED,杜绝两工位抢同一单)、**(b) 指数退避 + 最大重试次数**(失败单不立刻狂重试)、**(c) crontab 定时**(洞察员 4h 这类定时器统一成 crontab 条目,而非散在 server.js)。同栈(Node)使其几乎是「现成读法」。
  - **② 单机零依赖编排 ← 借「单库即队列、不引 Redis/RabbitMQ」理念** ⭐:graphile/worker 整个立论=「**保持基础设施简单,用已有存储当队列**」,正是 玉兔6「单机零依赖」红线的同款主张与背书。玉兔6 文件队列更轻,可借其作为「**不引独立中间件**」的设计信心锚与演进上限参照(真到要换专用队列的临界点是什么)。
  - **③ 事务一致入队 ← 借「transactional enqueue(入队与业务同一事务)」**:玉兔6「派单 + 状态更新」可借「**入队与卡状态变更做成一个原子操作**」(文件侧等价:先写临时文件再原子 rename),避免「卡写了但任务没派 / 任务派了但卡没更新」的不一致(接 batch38 pydantic-ai「产物一致性」)。
- 边界:**MIT 友好、可读可借**。但它**与 Postgres 强耦合(PLpgSQL 占 14%)→ 玉兔6 不引 Postgres**;**只借「原子取活 / 退避重试 / crontab 定时 / 事务入队」语义到文件队列**,不整体接入。Node/TS 源码可作直接参照。
- 难度:低-中(借语义到现有文件队列,同栈)。优先级:**中-高**(Node 原生、逐条命中控制台队列的「重试退避/定时抽象/原子入队」短板,落地面小且可逆,是本批对控制台最实用的一例)。

### 3. TailAdmin/free-react-tailwind-admin-dashboard — React 19 + Tailwind v4 的开源仪表盘模板:可访问侧边栏 + ApexCharts 数据可视化 + 可排序筛选表格 + 暗色模式,给控制台仪表盘一套现成 UI 布局基线(MIT 免费版)
- 名称/URL:TailAdmin/free-react-tailwind-admin-dashboard(Free React Tailwind CSS Admin Dashboard Template)— https://github.com/TailAdmin/free-react-tailwind-admin-dashboard
- 核验事实(本批 web_fetch 直读):**MIT(免费版)**;**1.2k★ / 499 forks / 11 watching / 2 PRs / 80 commits**;**TypeScript 92.2% / CSS 7.4%**;**无 GitHub release**(以 CHANGELOG 计版,最新 **v2.3.0 / 2026-04-28**,新增 AI/Sales/Finance 仪表盘 + 7+ 图表类型)。技术栈:**React 19 + TypeScript + Tailwind CSS v4**,图表用 **ApexCharts**。组件(免费版):**可访问折叠侧边栏、数据可视化、Profile 管理、404 页、表格与折线/柱状图、认证表单与输入控件、Alerts/Dropdowns/Modals/Buttons、FAQ/手风琴/轮播、日历(拖拽)、暗色模式**;有 HTML / Next.js / Vue / Angular / Laravel 多版本与 Figma 设计文件。**⚠️ 商业模式:freemium——免费版 MIT(1 个仪表盘、35+ 组件、50+ UI 元素);7 个仪表盘 / 500+ 组件属 PRO 付费**。
- 它优秀在哪:它不是「又一个组件库」,而是一套**直接可跑的「数据驱动后台」布局成品**——侧边栏导航 + 指标卡 + 图表 + 数据表 + 暗色模式一应俱全,且**用主流 React 19 + Tailwind v4 + ApexCharts**,**与 slot-20 已分析的 react-admin/refine(业务逻辑框架)互补**:那两个给「资源模型/权限/CRUD」,TailAdmin 给「现成的视觉与版式」。MIT 免费版即可作起步基线,省掉控制台仪表盘从零搭壳的时间。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 控制台仪表盘 UI ← 借「侧边栏 + ApexCharts 折线/柱 + 可排序筛选表格 + 暗色模式」布局范式** ⭐:控制台需要 run 可观测 / 公告板 / 洞察记录的**可视化看板**(接 batch kestra「execution 可视化」、slot-20 admin 框架)。TailAdmin 给一套**现成 React+Tailwind 仪表盘版式**,可作控制台看板的**视觉与版式参照**(侧边栏分区、指标卡、图表区、数据表)。
  - **② 运行指标可视化 ← 借「指标卡 + ApexCharts」**:控制台可把**洞察员运行节奏、队列深度、卡片数量/状态分布**做成指标卡 + 折线图,直接借 TailAdmin 的数据可视化组件形态。
  - **③ 前端基线 ← 借「React 19 + Tailwind v4 + 可访问侧边栏/模态/表单」**:控制台前端若走 React,TailAdmin free(MIT)是干净的起步骨架(可访问性、暗色模式开箱)。
- 边界:**⚠️ freemium——只用免费 MIT 部分(1 仪表盘 / 35+ 组件),不依赖 PRO 付费内容**;它是**模板(成品)而非库**,宜**借版式/组件、按需改写**,而非作为依赖锁定(无 GitHub release、按 CHANGELOG 计版)。与控制台「单机零依赖」无冲突(纯前端静态资产)。
- 难度:低(借 UI 版式/组件,按需裁剪)。优先级:**中**(控制台仪表盘有实用价值且低风险可逆;但属前端选型,非主线原子动作)。

### 本批小结(给 CEO 的一句话借鉴)
- **obeli-sk/obelisk**:学它「**每步落持久执行日志 → 确定性重放(崩溃可恢复)+ workflow 纯确定不碰外界、副作用全关进幂等可重试的 activity + 时间旅行调试 UI**」——给 玉兔6 编排/队列一套「可回放 + 副作用隔离」的生产范式,正交补强 batch38 的人审闸门;**但主体 AGPL-3.0 强 copyleft,只借概念绝不嵌运行时**,且 Rust/WASM、pre-release。
- **graphile/worker**:学它「**单库即队列(不引 Redis/RabbitMQ)+ SKIP LOCKED 原子取活 + 指数退避重试 + crontab 定时 + 事务内入队**」——Node 原生、与控制台同栈,几条机制可平移到玉兔6 文件队列,直补「重试退避/定时抽象/原子入队」短板;MIT,但不引 Postgres,只借语义。
- **TailAdmin**:学它「**React19+Tailwind v4 的侧边栏 + ApexCharts + 可排序表格 + 暗色模式仪表盘版式**」——给控制台看板一套现成 UI 布局基线,与 slot-20 的 react-admin/refine(逻辑框架)互补;**只用免费 MIT 部分,PRO 付费内容不依赖**。
- **本批不新增待办卡**(延续七–十、十二–三十八批的克制口径;唯十一批因真漏洞、二十七批因 insights.md 真实膨胀破例)。理由:三例最值钱的落地——**「编排借持久执行日志 + 副作用隔离」「文件队列借 graphile/worker 的取活/退避/定时/事务入队语义」「控制台看板借 TailAdmin 版式」**——均属**产品/主管的编排与前端架构选型**,非「明确值得立刻做」的原子动作,且多与已有方向(batch37 可复现、batch38 产物一致性/写操作把关、kestra 执行可视化)同源。**若 CEO 想立刻、最小、最可逆地动一步**:把 **graphile/worker 的「指数退避重试 + crontab 定时 + 原子认领」三条语义,作为控制台文件队列的纯设计参照写成一页约定**(同栈、零依赖、即用),是本批落地面最小、价值最高的切口;编排侧最小动作则是给一个高价值 run **加一份 append-only 步骤日志**(借 obelisk 执行日志理念,纯文件、可逆),为日后「失败续跑/可回放」打地基。**Starlaid/星桥 全程排除。**

> watch(本批 web_fetch 直读实时元数据;HEAD commit SHA 因代理限制未取,待网络可达回填):obeli-sk/obelisk `main`(**AGPL-3.0 → watch=true 但仅跟踪概念/文档,绝不借码**,446★/17 forks/4,534 commits/88 releases,latest obelisk-v0.36.1/2026-03-30,Rust/WASM,pre-release;关注 workflow-activity 二分、执行日志重放、time-traveling debugger 演进)、graphile/worker `main`(**MIT → watch=true**,2.3k★/119 forks/1,436 commits/61 tags,TS/PLpgSQL;关注 SKIP LOCKED 取活、crontab、退避重试、事务入队实现细节)、TailAdmin/free-react-tailwind-admin-dashboard `main`(**MIT 免费版 → watch=true,仅用免费部分**,1.2k★/499 forks/80 commits,latest v2.3.0/2026-04-28,React19/Tailwind v4/ApexCharts;关注免费版组件与布局更新)。另**挂三个下批候选 watch**:**litements/litequeue**(SQLite 之上的极简队列,作 玉兔6 文件/嵌入式队列的更轻参照,**尚未 seen**)、**procrastinate**(Python+Postgres 单库后台任务,作 graphile/worker 的 Python 对照,**尚未 seen**)、**tembo-io/pgmq**(Postgres 消息队列扩展,SQS 风格语义对照,**尚未 seen**)。



<!-- insight-scout-run:cr-1782417651671-insight-scout-repos-20260626-04 -->
## 2026-06-26 · 自动洞察(20260626-04 · multi-agent-orchestration)

> 来源:洞察员; run=cr-1782417651671-insight-scout-repos-20260626-04; queue=insight-scout/insight-scout-repos-20260626-04; network=available

## 多智能体编排 / 任务 DAG / 交接协议借鉴候选(slot=20260626-04, network=available)
说明:已对 seen-repos/borrowed-libs/insights 去重;本轮只读 GitHub README/License,不登录不安装;Starlaid/星桥排除。

### i-am-bee/beeai-framework
- 是什么:Apache-2.0 的 Python/TypeScript 多智能体框架,README 明示 Workflows、HandoffTool、Serialization、Serve(A2A/MCP)。
- 值得借鉴:把 agent、tool、workflow、handoff、持久化状态放成一组显式接口,适合对照控制台交接字段与断点恢复。
- 迁移边界/许可证不确定项:Apache-2.0 已核;框架重且带生态依赖,只借接口词表/状态模型,不引运行时。
- URL: https://github.com/i-am-bee/beeai-framework

### ag-ui-protocol/ag-ui
- 是什么:MIT 的 Agent-User Interaction Protocol,用约 16 类标准事件连接 agent 后端与前端。
- 值得借鉴:事件流、双向状态同步、前端工具调用与 human-in-the-loop 可做控制台人审/接管/进度事件 schema 参考。
- 迁移边界/许可证不确定项:MIT 已核;它补 Agent↔用户层,不是 A2A/任务 DAG 引擎,不可替代队列或 agent 间协议。
- URL: https://github.com/ag-ui-protocol/ag-ui

### FlowiseAI/Flowise
- 是什么:Apache-2.0 的可视化 AI Agent/Workflow 构建器,Node/React/TS 单仓,支持自托管与 Agentflow 图形编排。
- 值得借鉴:节点画布、第三方组件节点、Swagger API、可视化发布路径,适合作控制台 DAG 编辑/运行视图参考。
- 迁移边界/许可证不确定项:Apache-2.0 已核;运行体量大且包含大量集成,只借 UI/DAG schema,不安装不接入。
- URL: https://github.com/FlowiseAI/Flowise

本轮不生成公告板卡:三例更适合入设计对照;没有发现必须马上 CEO 取舍的低风险原子动作。



<!-- insight-scout-run:cr-1782418410001-insight-scout-repos-20260626-08 -->
## 2026-06-26 · 自动洞察(20260626-08 · queue-engine)

> 来源:洞察员; run=cr-1782418410001-insight-scout-repos-20260626-08; queue=insight-scout/insight-scout-repos-20260626-08; network=available

## 任务队列引擎 / 轻量单存储队列 / 文件队列语义借鉴候选(slot=20260626-08, network=available)
说明:延续 batch39(obelisk/graphile-worker「单库即队列 + 取活/退避/定时/事务入队」)思路,本轮兑现其末尾挂出的三个「下批候选」——litequeue / procrastinate / pgmq,聚焦「**轻量单存储队列**」如何把成熟语义平移到 玉兔6 的**文件队列**。已对 seen-repos/borrowed-libs/insights 去重(三例均未 seen);本轮 web_fetch 直读 GitHub README/侧栏元数据,不登录不安装;Starlaid/星桥排除。

### 1. litements/litequeue — SQLite 之上的「单文件 + 零依赖」持久队列:三态消息(READY/LOCKED/DONE)+ in/lock/done 三时间戳 + 显式 done(id) ack + prune 清理,是最贴近玉兔6文件队列的现成 schema 参照
- 名称/URL:litements/litequeue(Queue built on top of SQLite)— https://github.com/litements/litequeue
- 核验事实(本批 web_fetch 直读):**MIT**;**224★ / 10 forks / 3 watching / 1 issue / 0 PR / 122 commits / 12 tags**;**Python 62.9% / Jupyter Notebook 33.7% / Makefile 3.4%**。硬约束(README「Contributing」明示):**不允许任何额外依赖、所有代码必须在单个 litequeue.py 内、测试在 test.py 内**——即「**单文件 + 仅标准库**」。能力:把 SQLite 当持久队列,API = `put / pop / done(message_id) / get / peek / qsize / prune`;**消息是 frozen dataclass**:`Message(data, message_id, status, in_time, lock_time, done_time)`,**状态三态 READY(0)/LOCKED(1)/DONE(2)**,**message_id 为 uuidv7 字符串**(v0.6 起,时间可排序),**时间以纳秒整数计**;**pop≠删除**:pop 只把消息置 LOCKED 并记 lock_time,处理完须显式 `done(message_id)`,`prune()` 才物理清掉 DONE 的;同库可多队列(用 queue_name 当表名,但「不推荐/未测」)。
- 它优秀在哪:它把「一个**真正持久、可观测、可崩溃恢复**的队列」压进了**一个文件、零三方依赖**——这正是 玉兔6「单机零依赖」红线的最小可行证明。最值钱的不是 SQLite,而是它**极干净的消息模型**:三态机 + 三时间戳 + 显式 ack,**恰好是文件队列该有却常缺的那层语义**。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 控制台 文件队列 schema ← 借「三态消息(READY/LOCKED/DONE)+ in/lock/done 三时间戳 + 显式 done(id) ack」** ⭐⭐:这是本批对文件队列最直接的一点。玉兔6 文件队列若把每个「单」建模成 litequeue 的消息——**入队记 in_time、认领转 LOCKED 记 lock_time、完成才 done 记 done_time**——立刻白拿两样东西:**(a) 可观测性**(每单排队多久 = lock_time−in_time、处理多久 = done_time−lock_time,直接喂控制台看板 / kestra 式执行可视化);**(b) 崩溃可恢复**:**pop 只锁不删**,工位崩了那条单仍是 LOCKED 而非凭空消失,可被回收重派(接 batch39 obelisk「可恢复」、本批 pgmq 的 vt 自动回收)。
  - **② 单机零依赖背书 ← 借「单文件 + 仅标准库的持久队列」存在性证明** ⭐:litequeue 用「不允许额外依赖、全在一个文件」的硬规矩做出完整队列,是 玉兔6 红线的同款主张与现成反例库(「能不能不引中间件?能,长这样」)。
  - **③ 队列维护 ← 借「prune() 周期清理 + uuidv7 时间可排序 ID」**:玉兔6 可把「已完成单」如 litequeue 般**留到 prune 步统一清理 / 归档**(而非即删),并对 run/卡 ID 采 **uuidv7**(时间前缀→天然按时间排序,省一个 created_at 排序列)。
- 边界:**MIT 友好、单文件极易通读直接借**。但它**绑 SQLite**——玉兔6 文件队列**只借消息模型 / 状态机 / ack 语义**,不必引 SQLite;它**无并发取活的 SKIP LOCKED**(那点 batch39 graphile/worker 已覆盖),且作者明示「同库多队列未测」。**纯概念平移,零运行时引入**。
- 难度:低(单文件、概念直接平移到文件 JSON / 目录队列)。优先级:**中-高**(三态 + 三时间戳 + 显式 ack 是文件队列最划算的一层语义,落地面小、可逆、同时给「可观测 + 崩溃恢复」两项,本批对控制台最实用)。

### 2. procrastinate-org/procrastinate — Python+PostgreSQL 的「单库即队列」分布式任务库:defer/worker 解耦 + 周期任务 + 任意任务锁 + 重试,是 graphile/worker 的 Python 对照
- 名称/URL:procrastinate-org/procrastinate(PostgreSQL-based Task Queue for Python)— https://github.com/procrastinate-org/procrastinate
- 核验事实(本批 web_fetch 直读):**MIT**;**1.3k★ / 96 forks / 38 watching / 65 issues / 25 PR / 3,350 commits / 111 releases,latest 3.8.1(2026-04-08)**;**Python 87.0% / PLpgSQL 12.3%**;**Production/Stable**,**README 顶部明示「正在招募额外维护者」**。定位:**Python 3.10+ 分布式任务处理,靠 PostgreSQL 13+ 存任务 / 管锁 / 派发**;sync 与 async 双模、Django 集成、易配 ASGI。能力:`@app.task(queue=...)` 定义任务,`defer()/defer_async()` 入队,`app.run_worker()` 跑工人,CLI `procrastinate defer ... / procrastinate worker -q ...`;**支持周期任务(periodic)、重试、任意任务锁(arbitrary task locks)、延迟执行**;**不需要 Redis/RabbitMQ,一切存在主库 Postgres**。
- 它优秀在哪:它是 batch39 graphile/worker(Node+Postgres)的**Python 同构对照**——同样「**单库即队列、不引独立中间件**」,但额外把 **defer(派单)与 worker(执行)做成两个常分属不同程序的清晰角色**,并提供 **arbitrary task locks(任意命名锁)** 这一 graphile 未强调的并发控制原语。一套 API 同时覆盖 sync/async,工程成熟度(3,350 commits / 111 release)在「单库队列」里属第一梯队。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 控制台「派单 / 执行」分离 ← 借「defer 与 worker 解耦(常是两个程序)」** ⭐:玉兔6 控制台的「派单方」与「工位执行方」可如 procrastinate 般**显式两端**——派单只负责把单写入队列并立即返回,执行由独立 worker 进程消费,两者只经队列通信。利于「派单不被长任务拖住」(同 batch39 graphile「让 HTTP 不被拖住」)。
  - **② 互斥并发控制 ← 借「arbitrary task locks(任意任务锁)」** ⭐:**本批相对 graphile 的新增点**。玉兔6 多工位并行时,**对「不可并发的资源」(如同一张卡、insights.md 这类共享产物)用一个命名锁串行化**——procrastinate 的 task lock 正是「带同名锁的任务排队执行」。直接对应 玉兔6「两写撞同一文件」的隐患(接 batch38 产物一致性)。文件侧等价:以资源名作锁文件 / 目录租约。
  - **③ 定时器统一 ← 借「periodic tasks」**:洞察员 4h、其它定时器可统一成「**周期任务**」声明(接 batch39 graphile crontab 的同一主张),而非散在调度脚本里。
- 边界:**MIT、可读可借**;但**与 Postgres 强耦合(PLpgSQL 12.3%、靠 PG 行锁 / 通知派发)→ 玉兔6 不引 Postgres,只借「defer/worker 分离、任务锁、周期任务」语义**。**⚠️ README 自述「正在招募维护者」→ 作为运行时依赖有 bus-factor 风险,更宜借概念而非接入**。与 batch39 graphile/worker 多有重叠(retry / 单库 / 定时),**增量价值主要在 task locks 与 defer/worker 角色化**。
- 难度:低-中(借语义到文件队列,Python 但只读概念)。优先级:**中**(task locks / 角色分离是有用增量,但整体与 graphile 重叠、且维护者招募中,非「立刻必做」)。

### 3. pgmq/pgmq — Postgres 上的 SQS 式消息队列:可见性超时(vt)自动回收 + read_ct 重试计数 + archive 可回放 + FIFO group/topic 路由,给文件队列一套「自动恢复 + 死信」语义范本(原 tembo-io/pgmq,已迁至 pgmq/pgmq)
- 名称/URL:pgmq/pgmq(A lightweight message queue. Like AWS SQS and RSMQ but on Postgres)— https://github.com/pgmq/pgmq(注:**仓库已从 tembo-io/pgmq 迁到 pgmq/pgmq**,seen 库登记新规范 URL)
- 核验事实(本批 web_fetch 直读):**PostgreSQL License(宽松)**;**4.9k★ / 137 forks / 27 watching / 33 issues / 3 PR / 450 commits / 60 releases,latest v1.11.1(2026-04-19),Docker 镜像 pg18-pgmq:v1.10.0**;**PLpgSQL 44.4% / Rust 38.1% / Python 16.5%**;**支持 Postgres 14–18**;官方 / 社区客户端覆盖 Rust/Python + .NET/Go/Elixir/Java/JS/Kotlin/PHP/Ruby/Scala/TS 等十余种;**Tembo/Supabase/Sprinters/pgflow 在用**。核心特性(README 直读):**轻量(无后台 worker / 外部依赖,纯 Postgres SQL 对象)、可见性超时内「恰好一次」投递、与 AWS SQS/RSMQ API 对齐、FIFO 队列(按 message group key 保序)、topic 通配路由(pub-sub / 内容路由)、消息留到显式移除、可 archive 而非 delete 以长期留存 / 可回放**;SQL 动词:`create / send(+delay) / send_batch / read(vt,qty) / pop / archive(单 + 批 msg_ids) / delete / drop_queue`;**read 返回带 read_ct(读取次数)与 enqueued_at/last_read_at/vt**。
- 它优秀在哪:它把 **AWS SQS 的成熟语义**完整搬到「**单库、零后台进程**」上,且每条语义都清晰可读。最值钱的两点是 玉兔6 文件队列**当前最缺**的:**(a) 可见性超时(vt)**——读取即给消息加一个「隐身租约」,**到点没 delete/archive 就自动重新可见**,等于「**死工位的单自动回收**」,无需人工干预;**(b) read_ct 重试计数**——天然支持**毒丸 / 死信检测**(读太多次 = 处理总失败→转死信 / 人审)。再加 **archive 而非 delete(可回放 / 审计)**,与 batch39 obelisk「可重放」、batch37「可复现」同源。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 文件队列「自动恢复」← 借「可见性超时(vt):认领即加隐身租约,超时未完成自动重新可见」** ⭐⭐:**本批最高价值借鉴**。玉兔6 文件队列把 litequeue 的「pop 转 LOCKED」再进一步——**认领时写一个到期时间(lease),到期仍 LOCKED 未 done 就自动判定工位失联、把单转回 READY 重派**。这把「崩溃恢复」从「需人工 / 外部巡检」变成「**队列自带的超时自愈**」,是文件队列从「能用」到「可靠」的关键一跳。
  - **② 死信 / 毒丸处理 ← 借「read_ct 重试计数 → 超阈转死信 / 人审」** ⭐:玉兔6 每单记**被认领次数**,**超过阈值(如 N 次仍失败)就移出主队列进「死信 / 待人审」**,避免一条坏单无限重试拖垮工位(正交补强 batch38 人审闸门:毒丸自动进人审)。
  - **③ 完成即归档可回放 ← 借「archive 而非 delete(a_ 表留存)」**:玉兔6 完成的单**归档留存**(而非即删),供回放 / 审计 / 复现(接 obelisk 执行日志、batch37 可复现);litequeue 的 prune 与此可二选一或分层(热区 prune、冷区 archive)。
  - **④ 队列 API 词表 ← 借「create/send/read/pop/archive/delete + FIFO group key 保序 + topic 通配路由」**:玉兔6 文件队列对外动词可对齐这套 **SQS 式词表**(可读、好测);**FIFO group key** = 同一卡 / 同一 run 的子步骤按 group 保序;**topic 路由** = 不同卡类型按模式分发到不同工位。
- 边界:**PostgreSQL License 宽松、可读可借**;但它**本体是 Postgres 扩展(PLpgSQL+Rust)→ 玉兔6 坚持单机零依赖、不引 Postgres,只借「vt 租约 / read_ct 死信 / archive 可回放 / 动词表 / group 保序」语义到文件队列**。vt 的「恰好一次」是「**可见性超时内**」的工程口径,非分布式强一致承诺,平移时按文件队列语境理解即可。
- 难度:中(Postgres 扩展,只借语义、不接入)。优先级:**中-高**(vt 自动回收 + read_ct 死信 恰补文件队列「自动恢复 + 毒丸」两大短板,概念清晰、可纯文件实现、可逆;与 litequeue 三态 / ack 叠加即成一套完整文件队列语义)。

### 本批小结(给 CEO 的一句话借鉴)
- **litements/litequeue**:学它「**单文件 + 仅标准库**的持久队列 + **三态消息(READY/LOCKED/DONE)+ in/lock/done 三时间戳 + 显式 done(id) ack + prune 清理**」——给玉兔6 文件队列一层最划算的语义(白拿可观测 + 崩溃可恢复),且是「单机零依赖」红线的现成存在性证明;MIT、单文件易通读,纯概念平移不引 SQLite。
- **procrastinate**:学它「**defer(派单)/worker(执行)角色分离 + 任意任务锁(命名锁串行化)+ 周期任务**」——task lock 是相对 batch39 graphile 的新增点,正对「两写撞同一卡 / 同一文件」的隐患;MIT,但**与 Postgres 耦合且自述「招募维护者」→ 只借概念不接运行时**。
- **pgmq/pgmq**:学它「**可见性超时(vt)自动回收 + read_ct 重试计数转死信 + archive 可回放 + SQS 式动词表 / FIFO group 保序 / topic 路由**」——vt 把「崩溃恢复」升级成「队列自带超时自愈」,read_ct 给毒丸 / 死信一个现成判据,是本批最高价值的一组语义;PostgreSQL License 宽松,但只借语义不引 Postgres。**(原 tembo-io/pgmq 已迁 pgmq/pgmq)**
- **本批不新增待办卡**(延续既有克制口径:仅真漏洞 / 真实文件膨胀才破例)。理由:三例最值钱的落地——**把 litequeue 的「三态 + 三时间戳 + 显式 ack」、pgmq 的「vt 租约 + read_ct 死信 + archive 可回放」、procrastinate 的「defer/worker 分离 + 任务锁」合成一套「玉兔6 文件队列语义约定」**——本质是**控制台 / 编排的队列架构选型**,属产品 / 主管决策,非洞察员可单方下派的原子动作;且与 batch39 已挂出的「把 graphile/worker 取活 / 退避 / 定时 / 事务入队语义写成一页约定」高度同源。**给 CEO 的一步走建议(若要立刻、最小、最可逆地动)**:把 batch39(graphile)+ 本批(litequeue/pgmq/procrastinate)的语义**合并成一页《玉兔6 文件队列语义约定 v0》**——含「三态机 + 三时间戳 + 显式 ack + 认领租约(vt)+ 重试计数转死信 + 指数退避 + 周期任务 + 资源命名锁 + 完成归档可回放」,纯设计参照、零依赖、同栈即用;这是两批累计落地面最小、价值最高的切口。**Starlaid/星桥 全程排除。**

> watch(本批 web_fetch 直读实时元数据;HEAD commit SHA 因代理限制未取):litements/litequeue `main`(**MIT → watch=true**,224★/10 forks/122 commits/12 tags,Python 单文件;关注消息模型 / 状态机 / uuidv7 / prune 演进)、procrastinate-org/procrastinate `main`(**MIT → watch=true**,1.3k★/96 forks/3,350 commits/111 releases,latest 3.8.1/2026-04-08;**注:招募维护者中**;关注 task locks / periodic / defer-worker 实现)、pgmq/pgmq `main`(**PostgreSQL License → watch=true**,4.9k★/137 forks/450 commits/60 releases,latest v1.11.1/2026-04-19,PG14–18;**已自 tembo-io/pgmq 迁此**;关注 vt / read_ct / archive / FIFO group / topic 路由实现)。另**挂三个下批候选 watch**(承 batch39,仍未 seen,待核):**pgflow-dev/pgflow**(基于 pgmq 的 Postgres 工作流引擎,作「队列之上加 DAG」的对照)、**Bogdanp/dramatiq**(Python 后台任务,Redis/RabbitMQ 派,作 procrastinate 的非-Postgres 对照)、**coleifer/huey**(轻量任务队列,可走 SQLite,作 litequeue + 定时的对照)。

## 2026-06-26 · 自动洞察补扫(20260626-08 · queue-engine)

> 来源:洞察员; run=cr-1782432032942-insight-scout-repos-20260626-08; queue=insight-scout/insight-scout-repos-20260626-08; network=available

## 任务队列引擎 / 调度可靠性 / 失败处置补扫(slot=20260626-08, network=available)
说明:已比对 `seen-repos.json`、`borrowed-libs.md`、`insights.md`;同 slot 前段已分析 litequeue/procrastinate/pgmq,本轮只补扫其末尾未登记的三个 watch 候选。公开 GitHub/API/项目文档核验,不登录、不安装、不引运行时。

### pgflow-dev/pgflow
- 是什么:Postgres/Supabase 上的 TypeScript workflow engine,DAG 步骤编译为 SQL migration,由 Edge Functions 执行。
- 值得借鉴:每步自动重试与指数退避、fan-out 子步骤独立失败/独立重试、状态留在 SQL 里可查询。
- 迁移边界/许可证不确定项:Apache-2.0 已核;依赖 Postgres/Supabase/pgmq,控制台只借“队列之上加 DAG + per-step retry + SQL 可观测”语义。
- URL:https://github.com/pgflow-dev/pgflow

### Bogdanp/dramatiq
- 是什么:Python 后台任务库,以 RabbitMQ/Redis broker 承载 actor 消息,官方文档覆盖 retries、time limits、scheduling。
- 值得借鉴:actor + middleware 分层、消息重试、消息年龄/执行时限、broker 故障恢复的边界划分。
- 迁移边界/许可证不确定项:LGPL-3.0/GPL-3.0 已核,不复制代码不接 runtime;只作“重试/超时/broker 故障”概念对照。
- URL:https://github.com/Bogdanp/dramatiq

### coleifer/huey
- 是什么:轻量 Python task queue,支持 Redis、SQLite、文件系统、内存存储,并带 crontab/延迟任务/结果句柄。
- 值得借鉴:retry_delay、periodic task、task locking、rate limit、timeout、storage adapter 这些 API 词表很适合轻量控制台。
- 迁移边界/许可证不确定项:MIT 已核;实现是 Python,控制台不引库,只借“轻调度 + 锁 + 重试参数”接口语义。
- URL:https://github.com/coleifer/huey

### 行动判断
- 不新增公告板卡:本轮是对已形成的“文件队列语义约定 v0”方向做补证,没有比前段 litequeue/pgmq 更独立、更低风险的新行动。



<!-- insight-scout-run:cr-1782432032942-insight-scout-repos-20260626-08 -->
## 2026-06-26 · 自动洞察(20260626-08 · queue-engine)

> 来源:洞察员; run=cr-1782432032942-insight-scout-repos-20260626-08; queue=insight-scout/insight-scout-repos-20260626-08; network=available

## 任务队列引擎 / 调度可靠性 / 失败处置补扫(slot=20260626-08, network=available)
说明:已比对 seen-repos、borrowed-libs、insights;同 slot 前段已分析 litequeue/procrastinate/pgmq,本轮只补扫其末尾未登记的三个 watch 候选。公开 GitHub/API/项目文档核验,不登录、不安装、不引运行时。

### pgflow-dev/pgflow
- 是什么:Postgres/Supabase 上的 TypeScript workflow engine,DAG 步骤编译为 SQL migration,由 Edge Functions 执行。
- 值得借鉴:每步自动重试与指数退避、fan-out 子步骤独立失败/独立重试、状态留在 SQL 里可查询。
- 迁移边界/许可证不确定项:Apache-2.0 已核;依赖 Postgres/Supabase/pgmq,控制台只借“队列之上加 DAG + per-step retry + SQL 可观测”语义。
- URL:https://github.com/pgflow-dev/pgflow

### Bogdanp/dramatiq
- 是什么:Python 后台任务库,以 RabbitMQ/Redis broker 承载 actor 消息,官方文档覆盖 retries、time limits、scheduling。
- 值得借鉴:actor + middleware 分层、消息重试、消息年龄/执行时限、broker 故障恢复的边界划分。
- 迁移边界/许可证不确定项:LGPL-3.0/GPL-3.0 已核,不复制代码不接 runtime;只作“重试/超时/broker 故障”概念对照。
- URL:https://github.com/Bogdanp/dramatiq

### coleifer/huey
- 是什么:轻量 Python task queue,支持 Redis、SQLite、文件系统、内存存储,并带 crontab/延迟任务/结果句柄。
- 值得借鉴:retry_delay、periodic task、task locking、rate limit、timeout、storage adapter 这些 API 词表很适合轻量控制台。
- 迁移边界/许可证不确定项:MIT 已核;实现是 Python,控制台不引库,只借“轻调度 + 锁 + 重试参数”接口语义。
- URL:https://github.com/coleifer/huey

### 行动判断
- 不新增公告板卡:本轮是对已形成的“文件队列语义约定 v0”方向做补证,没有比前段 litequeue/pgmq 更独立、更低风险的新行动。



<!-- insight-scout-run:skill-run-20260626-12-agent-skills -->
## 2026-06-26 · 自动洞察(20260626-12 · agent-skills/registry)

> 来源:洞察员; run=skill-run-20260626-12-agent-skills; queue=(直接执行 SKILL,无引擎派单); network=available

## AI agent 工具与 skills / MCP 注册表与自动策展 借鉴候选(slot=20260626-12, network=available)
说明:本轮轮换避开热区最近 4 个专题(queue-engine 20260626-08、multi-agent 20260626-04、gui-grounding 20260624-12、像素 第三十批),选**「AI agent 工具与 skills + MCP 注册表/自动策展」**专题。已对 seen-repos.json(本批前 172 仓库)、insights.md 热区去重:本批三例(microsoft/skills、toolsdk-ai/toolsdk-mcp-registry、sunnamed434/awesome-mcp-registry)均为**新案例**,与已 seen 的 anthropics/skills、VoltAgent/awesome-agent-skills、tech-leads-club/agent-skills、agentskills/agentskills、agentic-community/mcp-gateway-registry 等不重叠。本节是给老板/CEO 看的「值得借鉴」分析,**非待办**;本批**不新增待办卡**(理由见末)。三例**均 MIT,license 友好可放心借**;web_fetch 直读 GitHub 仓库页元数据,不登录不安装不引运行时;**Starlaid/星桥 全程排除**。

### 1. microsoft/skills — 微软官方「给编码 agent 打底」的 skills+自定义 agent+MCP 仓:最值钱的是给 SKILL.md 配了「测试 + 质量打分(Ralph Loop / Sensei)」,把 skill 当代码一样有 CI
- 名称/URL:microsoft/skills(Skills, MCP servers, Custom Agents, Agents.md for SDKs to ground Coding Agents)— https://github.com/microsoft/skills
- 核验事实(本批 web_fetch 直读):**MIT**;**2.4k★ / 272 forks / 15 watching**;内容四类——**Skills(SKILL.md)/ Custom Agents(按角色:backend、frontend、infrastructure、planner)/ MCP servers(mcp.json 配置)/ Agents.md**;Skill Catalog 按语言分组(Core / Foundry 语言无关 / Python / .NET / TypeScript / Java / Rust),含 copilot-sdk、mcp-builder(「用 FastMCP / Node-TS / C# 建 MCP server」)、**foundry-managed-skills(「author behavioral guidelines once, store via Skills REST API, load into hosted agent containers」)**;**关键差异点:仓库带完整 skill 测试 harness**——可「列出有测试覆盖的 skill」「mock 模式跑 CI」,实现 **Ralph Loop(迭代式代码生成与改进)** 与 **Sensei-style Scoring(按 SKILL.md frontmatter 合规性给 skill 打分)**;skills 支持 clone / copy / **symlink**(多项目共享同一套 skill)。
- 它优秀在哪:市面大多 skills 仓只是「把 SKILL.md 堆在一起」。microsoft/skills 的独到处是**把 skill 当软件工程对象管**:① **每个 skill 有测试 + 覆盖率 + mock-CI**——上线前能自动验「这个 skill 还好使吗」;② **Sensei frontmatter 打分**——自动校验 SKILL.md 的 name / description / 触发字段是否合规(直接关系触发准确率);③ **Ralph Loop 迭代改进**——把「写 skill → 评分 → 改进」做成可循环的质量提升回路;④ **Custom Agents 按角色组织** + **symlink 共享**,避免 skill 复制漂移。MIT、微软官方背书。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① skills 上线自检 ← 借「skill 测试 + frontmatter 合规打分 + mock-CI」** ⭐⭐:玉兔6 的 skills(如本 insight-scout 这个 SKILL.md、各工位 skill)目前**缺「skill 自己的测试 / 质量门」**——改了描述会不会触发变差、字段缺没缺,全靠人肉。借这套**「每个 skill 带最小测试 + frontmatter 合规打分 + mock 模式 CI」**,玉兔6 可在 skill 改动时自动跑一遍「字段齐不齐、触发对不对」,直接呼应已装的 skill-creator 的 eval 思路(给它补一个「上线门」)。
  - **② 工位角色化 ← 借「Custom Agents 按角色(backend / frontend / infra / planner)+ 各挂专属 skills」**:玉兔6 的工位 / 角色可借「按角色定义 agent、每个角色挂自己那组 skills」的组织法,让「谁该会什么」显式化(接二十七批 agent-tools「按域分组」)。
  - **③ skills 共享防漂移 ← 借「symlink 共享 + foundry "author once, load into containers"」**:玉兔6 多工位若共享同一 skill,借「一处定义、多处 symlink / 引用」而非各自拷贝,避免同一 skill 多份不一致(接产物一致性主题)。
- 边界:**MIT 可放心借**;但它深绑 **GitHub Copilot SDK / Azure Foundry** 生态(copilot-sdk、foundry-managed-skills、azure-skills 插件),玉兔6 **只借「skill 测试 + frontmatter 打分 + 角色化 + symlink 共享」的工程范式**,不引 Copilot SDK / Azure 运行时。Ralph Loop / Sensei 是其内部测试约定,平移时按玉兔6 的 SKILL.md 字段自定义评分项。
- 难度:中(搭一个最小 skill 测试 / 打分 harness)。优先级:**中-高**(skill 质量门对玉兔6 skills 可靠性价值大,且与已装 skill-creator 同向、落地面在自己手里)。

### 2. toolsdk-ai/toolsdk-mcp-registry — 把「MCP 工具能力」做成一份结构化 JSON 索引(每条带 validated + 内嵌 tools 元数据),fetch 索引 → 挑 toolKey → 立即可调
- 名称/URL:toolsdk-ai/toolsdk-mcp-registry(MCPSDK.dev / ToolSDK.ai 的 MCP 服务器与包注册表 + 数据库,结构化 JSON 配置,支持 OAuth2.1 / DCR)— https://github.com/toolsdk-ai/toolsdk-mcp-registry
- 核验事实(本批 web_fetch 直读):**MIT**;**179★ / 123 forks / 479 commits / 8 issues / 20 PR**;结构含 config/ indexes/ packages/ python-mcp/ src/ + **e2b-template(沙箱模板)** + Dockerfile;**核心机制:发布一份 `indexes/packages-list.json` 索引**,每个包条目带 **`{"validated": true, "tools": { ... }}`**——即「该包是否已验证 + 它暴露哪些 tools」直接内嵌在索引里;可**HTTP 直取索引**(gh-pages:`toolsdk-ai.github.io/.../packages-list.json`),**挑一个 `toolKey` 即可 `getAISDKTool(toolKey)` 立即调用**;支持 **OAuth2.1 + DCR(动态客户端注册)**。
- 它优秀在哪:它把「有哪些工具能力、每个能力暴露哪些 tool、验没验过」这件事**固化成一份机器可读、可直接消费的结构化索引**——不是「人去读 README 才知道能干嘛」,而是**索引里就带齐 validated 标志 + tools 元数据,挑个 key 就能调**。这把「能力发现」从「文档 / 人工」变成「查索引即用」,且 **validated 标志天然就是一道能力门禁**(没验证过的不进可调索引)。MIT、479 commits 维护活跃。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 控制台能力清单 schema ← 借「结构化 JSON 索引 + 每条 validated + 内嵌 tools 元数据 + 挑 key 即用」** ⭐⭐:玉兔6 控制台的「工具 / 能力 / skills」可建成一份**结构化 JSON 索引**(类 packages-list.json),每条带**「是否已验证 + 暴露的 tools 列表」**,编排 / 前端**挑一个 key 立即可调**。比二十七批 agent-tools「统一 plugin 描述 schema」更进一步:**把 tools 元数据和 validated 标志直接写进索引**,省去「调用时才发现不可用」。
  - **② 能力上线门禁 ← 借「validated:true 才进可调索引」** ⭐:玉兔6 能力入库前先跑校验,**validated 的才进「可调」索引**,未验证的隔离待审——一道便宜的能力质量门(与案例 1 的 skill 测试门同构,一个管 skill 一个管工具能力)。
  - **③ 第三方能力沙箱执行 ← 参考 e2b-template 的隔离思路**:玉兔6 已有 Linux sandbox;接第三方 MCP / 工具时可对照其「每个工具在沙箱里跑」的隔离边界(OAuth2.1 / DCR 是接**外部托管** MCP 的认证范式,玉兔6 单机本地多数用不上,接外部服务时再参考)。
- 边界:**MIT**;但它本体是 **npm 包 `@toolsdk.ai/registry` + gh-pages 在线注册表**,与玉兔6「单机零依赖」红线冲突 → **只借「索引 schema(validated + 内嵌 tools)+ 上线校验门」的语义**,不引在线注册表、不接 e2b、不接 npm 包。
- 难度:中(借索引 schema + 校验门,纯数据模型 + 前端层面)。优先级:**中**(能力治理有价值,但需玉兔6 能力 / 工具到一定数量才迫切;当下先把「索引 schema + validated 标志」定下来即可)。

### 3. sunnamed434/awesome-mcp-registry — 「Continuous AI」自策展注册表:AI 每周 发现 → 打质量分 → 陈旧重评 → 低分掉出,全程 auto-merge PR 可审计。**它做的事就是洞察员自己在做的事——最对口的方法论镜子**
- 名称/URL:sunnamed434/awesome-mcp-registry(AI-curated, self-updating directory of MCP servers)— https://github.com/sunnamed434/awesome-mcp-registry
- 核验事实(本批 web_fetch 直读):**MIT**;**仅 1★ / 3 forks / 47 commits**(**早期实验项目,价值在方法不在体量**);Python 100%;一条 **GitHub Actions 每周**跑的 pipeline:**① Discover**——搜 GitHub + 官方 MCP Registry 找新 server;**② Analyze**——每个新仓由 **GPT-4.1-mini 评质量分 0-10,并识别 / 惩罚仓库内容里的 prompt-injection 企图**;**③ Re-evaluate**——**超过 90 天的条目用新数据重评**,荒废 / 掉质量 / 不再相关就掉分掉出;**④ Rank**——**只收 5+/10、每类 top-20,按质量分 → star 排序**;**每次自动变更 = 一个 auto-merged PR,历史可审计可回退**;README 由 `data/known_servers.json` 每次自动生成(明示「别提 PR 加 server,改了会被覆盖」,改走 issue 提名 → AI 下轮自动评判)。
- 它优秀在哪:它把「**一份高质量仓库清单该怎么自动维护**」做成了一条**全自动、可审计、会自我淘汰**的流水线——**人只定一次规则,AI 持续 发现 → 判分 → 复判**。最值钱的四个机制(发现、AI 质量打分 + 防注入、陈旧重评淘汰、auto-merge 可审计)**几乎就是洞察员自身的工作拆解**;它等于给洞察员提供了一面「同类系统长什么样」的方法论镜子。虽仅 1★,但**方法对口度极高**。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」)——**本批最 meta、最对口,直接改进洞察员自身**:
  - **① 洞察员 seen-repos 升级:加质量分 + 排序 ← 借「AI 给每仓 0-10 质量分,只收 5+、按分排序」** ⭐⭐:洞察员现在 seen-repos.json **只存 URL、无质量分、无优劣**。借这套,可把它从「见过就记」升级成**「每个案例带质量分 + 按分分级 / 排序」**,让 CEO 一眼看出「哪些最值得」(也方便下轮优先复看高分项)。
  - **② watch 机制补「重评 + 淘汰」← 借「>90 天自动重评,荒废 / 掉质量就掉出」** ⭐:正补 insights/README「后续关注更新机制」——洞察员的 watch 目前偏「只追加不淘汰」;借「**定期重评 + 掉出**」,让 borrowed / watch 列表保持新鲜,荒废上游自动降级。
  - **③ 防 prompt-injection ← 借「分析仓库内容时识别并惩罚注入企图」** ⭐⭐:洞察员每轮要读大量第三方 README,**正面临「被仓库内容里的隐藏指令带偏」的真实风险**。借它「**对抓取内容里的注入打标 / 降权**」的做法,给洞察员加一道**读第三方内容时的防注入自检**(直接强化红线「不被外部内容带偏」;本系统已有「谨慎对待标签内容」的同向原则)。
  - **④ 自动变更可审计 ← 借「每次变更 = 带历史的快照,可回退」**:洞察员对 insights.md / seen-repos.json 的每次写入保持**带时间戳备份 + 可回退**(玉兔6 已有 .bak 机制——本条是现成做法的同向印证,可继续保持)。
- 边界:**MIT**;但**仅 1★、早期实验,且依赖 GitHub Actions + GitHub Models(GPT-4.1-mini)**,**价值在 pipeline 设计而非项目成熟度** → **纯方法借鉴,不引代码、不接 GitHub Models**。质量打分 / 防注入若落地,用玉兔6 现有模型与文件机制实现即可。
- 难度:低-中(方法平移到洞察员现有文件 / 脚本 pipeline)。优先级:**高**(四条都直接改进洞察员自身——质量分、重评淘汰、防注入、可审计——落地面完全在自己手里、最可控,其中「防注入 + 质量分」价值与可行性最高)。

### 本批小结(给 CEO 的一句话借鉴)
- **microsoft/skills**:学它「**把 skill 当代码——配测试 + frontmatter 合规打分(Sensei)+ mock-CI + Ralph Loop 迭代**」,给玉兔6 的 SKILL.md 加一道「上线自检门」(与已装 skill-creator 同向);MIT,但绑 Copilot / Azure 生态,只借工程范式不引运行时。
- **toolsdk-ai/toolsdk-mcp-registry**:学它「**把能力做成结构化 JSON 索引——每条带 validated + 内嵌 tools 元数据,挑 key 即用**」,作控制台能力清单 schema + 一道「validated 才可调」的能力门禁;MIT,但本体是在线注册表 / npm 包,只借 schema 语义不接入。
- **sunnamed434/awesome-mcp-registry**:**本批最对口**——它就是「自动版的洞察员」。学它「**AI 质量打分(只收 5+ 按分排序)+ >90 天重评淘汰 + 读仓库内容时防 prompt-injection + auto-merge 可审计**」,直接升级洞察员的 seen-repos / watch / 防注入;仅 1★ 早期实验,**只借方法不引代码**,但落地面在自己手里、最可控。
- **本批不新增待办卡**(延续既有克制口径:仅真漏洞 / 真实文件膨胀才破例)。理由:三例最值钱的落地——**skill 测试门、能力索引 schema + validated 门禁、洞察员质量分 / 重评 / 防注入**——分别属于 **skills 工程化、控制台能力治理、洞察员 pipeline 改造**,均触及 board/insights/ 之外的代码(`projects/控制台/insight-scout-repos.js` 等),属**方向 / 架构设计决策,应由产品 / 主管拍板**,非洞察员可单方下派、且只在 board/insights/ 内可执行的原子动作(红线:洞察员只读写 board/insights/)。**若要立刻、最小、最可逆地动一步**:把案例 3 的「**读第三方 README 时的 prompt-injection 自检 + 给案例打 0-10 质量分写进 seen-repos**」作为洞察员 pipeline 的**设计提案**交主管评审——这是本批落地面最小、对系统安全 / 质量增益最直接、且完全在洞察员自身职责内的切口。**Starlaid / 星桥 全程排除。**

> watch(本批 web_fetch 直读元数据;HEAD commit SHA 因代理限制未取):microsoft/skills `main`(**MIT → watch=true**,2.4k★/272 forks;关注 skill 测试 harness / Ralph Loop / Sensei 打分 / Custom Agents 演进)、toolsdk-ai/toolsdk-mcp-registry `main`(**MIT → watch=true**,179★/123 forks/479 commits;关注 packages-list.json 索引 schema 与 validated/tools 元数据演进)、sunnamed434/awesome-mcp-registry `master`(**MIT → watch=true,但仅 1★ 早期实验**,关注其 auto-scanner.yml 的「发现 → 打分 → 重评 → 排序」实现与防注入逻辑,作洞察员自身 pipeline 的参照)。另**挂三个下批候选 watch**(均未 seen,待核):**stacklok/toolhive**(企业级运行 / 管理 MCP servers 的平台,作控制台「能力沙箱治理」对照)、**IBM/mcp-context-forge**(联邦 MCP / A2A / REST/gRPC 的 AI Gateway,作「能力网关」对照)、**yusufkaraaslan/Skill_Seekers**(把文档自动转成 Claude skills,作「skill 自动生成」对照)。



<!-- insight-scout-run:cr-1782446433120-insight-scout-repos-20260626-12 -->
## 2026-06-26 · 自动洞察(20260626-12 · agent-tools-skills)

> 来源:洞察员; run=cr-1782446433120-insight-scout-repos-20260626-12; queue=insight-scout/insight-scout-repos-20260626-12; network=available

## AI agent 工具 / skills / 能力库治理补扫（slot=20260626-12）\n说明：network_status=available；已比对 seen-repos、borrowed-libs、insights。同 slot 已登记 microsoft/skills、toolsdk-ai/toolsdk-mcp-registry、sunnamed434/awesome-mcp-registry，本轮只补未 seen 新 URL；Starlaid/星桥排除。\n\n### modelcontextprotocol/registry\n- 是什么：官方社区 MCP Server 注册表，定位为 MCP servers 的 app store，提供 server.json、发布 CLI 与包元数据匹配校验。\n- 值得借鉴：只存元数据不存 artifact、命名空间所有权验证、schema 校验，适合控制台能力索引的 source/package/secret-env 元数据设计。\n- 迁移边界/许可证不确定项：LICENSE 正处 MIT→Apache-2.0 过渡，文档为 CC-BY-4.0；API v0.1 freeze/preview，先借 schema 与校验思路。\n- URL: https://github.com/modelcontextprotocol/registry\n\n### stacklok/toolhive\n- 是什么：Apache-2.0 的企业级 MCP 平台，覆盖 Registry、Gateway、Runtime、Portal，并强调隔离容器、身份策略、审计与观测。\n- 值得借鉴：registry heuristics 很对口：开源许可证白名单、provenance/SBOM/CI、安全扫描、Verified vs Experimental 分层、定期重评。\n- 迁移边界/许可证不确定项：Docker/K8s/OIDC 运行栈较重；控制台只借信任分级与目录治理，不接 runtime。\n- URL: https://github.com/stacklok/toolhive\n\n### IBM/mcp-context-forge\n- 是什么：Apache-2.0 的 AI Gateway / registry / proxy，统一暴露 MCP、A2A、REST/gRPC，并带插件、Admin UI、OpenTelemetry。\n- 值得借鉴：集中治理、发现、观测与工具/Prompt/Resource 注册表，可对照控制台的能力目录、调用日志和网关字段。\n- 迁移边界/许可证不确定项：Python/Redis/K8s/auth 栈较重，不适合单机零依赖；只借控制面 schema 与 observability 字段。\n- URL: https://github.com/IBM/mcp-context-forge\n\n### 行动判断\n- 生成 1 张公告板候选：三例共同支持“validated + trust_tier + staleness recheck”的能力库治理字段，动作可先停在设计评审层，低风险且对 CEO 取舍有价值。



<!-- insight-scout-run:run-20260626-16-insight-scout-repos -->
## 2026-06-26 · 自动洞察(20260626-16 · llm-gateway + gui-grounding)

> 来源:洞察员; run=insight-scout-repos-20260626-16; slot=20260626-16; network=available;note=本轮由 scheduled-task 直接执行
>
> 说明:本轮轮换到 last-4 slot(-00 unity / -04 multi-agent / -08 queue / -12 agent-skills)**未覆盖**、且最久未成批的两个专题——**LLM 网关** 与 **GUI grounding**。去重已比对 `seen-repos.json`(178 仓库):本批三例(alibaba/higress、xlang-ai/OpenCUA、ZJU-REAL/GUI-G2)均为**新案例**,与已 seen 的 litellm/bifrost/Portkey/Kong/archgw/tensorzero/envoyproxy-ai-gateway(网关)及 UGround/UI-TARS/Agent-S/OmniParser/OSWorld/ShowUI/ScaleCUA(grounding)不重叠。本节是给老板/CEO 看的「值得借鉴」分析,**非待办**;本批**不新增待办卡**(理由见末)。**web_fetch 直读核验 star/license/机制;Starlaid/星桥 全程排除。两条 license 提示先行:案例 2 为 MIT(可商用),案例 3 仓库无 LICENSE 文件(许可不明,商用前必须核实)。**

### 1. alibaba/higress — Istio/Envoy 之上的「AI 原生」网关:把 LLM API 与 MCP API 收口到一张控制面,自带 token 限流/多模型负载均衡/AI 可观测 + MCP 托管(统一鉴权 + 全量调用 audit log)
- 名称/URL:alibaba/higress(镜像主仓 higress-group/higress,🤖 AI Gateway | AI Native API Gateway)— https://github.com/alibaba/higress
- 核验事实(本批 web_fetch 直读 higress-group/higress 仓库页):**Apache-2.0**;**CNCF Sandbox 项目**;**8.7k★ / 1.2k forks / 1,710 commits / 68 release(latest v2.2.2 / 2026-05-26)**;**Go 81.2% / C++ 12.8% / Rust 2.0%**;基于 **Istio + Envoy** 的云原生网关,**Wasm 插件(Go/Rust/JS)**扩展、沙箱隔离、流量无损热更新;**AI gateway**:统一协议接入所有主流 LLM provider、**AI 可观测 + 多模型负载均衡 + token 限流 + 缓存**;**MCP Server 托管**(经插件机制):**统一鉴权 + 细粒度限流防滥用 + 所有 tool 调用的 audit log + 可观测 + 不断连的动态更新**;配套 **openapi-to-mcp**(把 OpenAPI spec 一键转成 remote MCP server)、out-of-box UI 控制台;另有 **higress-standalone**(脱离 K8s,单 Docker 起)。
- 它优秀在哪:多数已 seen 网关(litellm/bifrost/Portkey)主打「**统一调 LLM**」;Higress 把视野抬到「**AI 原生 API 网关**」——**同一张控制面同时治理 LLM API 与 MCP API**,且把「**MCP/工具调用**」当一等公民给齐了治理字段(鉴权、限流、**全量 audit log**、可观测、热更新)。这正好补上已 seen 网关「重 LLM、轻工具治理」的盲区,也比昨天 -12 批 toolhive/mcp-context-forge「能力网关治理」更具体——它给出了「**托管一个 MCP = 自动获得 audit log + 限流 + 鉴权**」的成品范式。Apache-2.0 + CNCF,读借放心。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 控制台「能力网关」字段 ← 借「托管 MCP 即获得 统一鉴权 + 限流 + 全量 audit log + 可观测 + 热更新」** ⭐⭐:玉兔6 控制台接 MCP/工具时,Higress 这套「托管即治理」的六项收益正是能力网关该补的字段。最高价值的是 **每个 tool 调用都进 audit log**——直接对应控制台「谁调了什么能力、参数/结果、耗时」的可观测诉求(接 -24/-28/-29 批「可观测应是默认能力」共识,把昨天 -12 批的能力治理从「信任分级」推进到「**调用级 audit + 限流**」)。
  - **② LLM 调用统一层 ← 借「AI gateway:统一协议 + 多模型负载均衡/fallback + token 限流 + 缓存 + AI 可观测」** ⭐:玉兔6 各工位/agent 若各自直连模型,缺成本与可观测收口。借「**所有 LLM 调用过一个网关层**」可在一处拿到 token 计量、多模型 fallback、限流、结果缓存——对成本与稳定性价值大(与已 seen litellm 同向,但 Higress 多了「与 MCP 同面治理」)。
  - **③ 内部 HTTP 能力 → MCP ← 借 openapi-to-mcp 思路**:玉兔6 若要把内部脚本/HTTP 能力暴露给 agent,借「**OpenAPI spec 自动转 MCP server**」免手写 wrapper(纯思路,不引工具)。
- 边界:**整体是 Istio/Envoy/K8s 重型云原生栈,与玉兔6「单机零依赖」红线严重冲突 → 绝不整体接入**;即便 higress-standalone(单 Docker)也是独立服务进程。**只借「AI gateway 语义 + MCP 治理字段(鉴权/限流/audit/可观测/热更新)+ openapi-to-mcp 思路」的设计层面**,落地用玉兔6 现有文件/控制台机制自研。Apache-2.0 对读借友好。
- 难度:中(借治理字段 + 网关语义,数据模型 + 控制台层;不接 runtime)。优先级:**中-高**(「LLM 调用统一层 + MCP 调用 audit/限流」对控制台成本与可观测价值大,但「是否新增一个网关层」是架构取舍,需主管拍板)。

### 2. xlang-ai/OpenCUA — 把「电脑操作 agent」做成可商用(MIT)全家桶:数据采集工具 + 22.6K 真人轨迹数据集 + 离线评测器 + 7B/32B/72B 模型,OSWorld 开源 SOTA;最值钱的是那套「动作精简 + 状态-动作对齐 + 反思式 CoT」数据管线
- 名称/URL:xlang-ai/OpenCUA(NeurIPS 2025 Spotlight,Open Foundations for Computer-Use Agents)— https://github.com/xlang-ai/OpenCUA
- 核验事实(本批 web_fetch 直读):**MIT(明文可研究/教育/商用)**;**784★ / 103 forks / 75 commits / 1 release**;Python 96.2%;四件套——**AgentNet**(首个大规模桌面 computer-use 轨迹数据集,**22.6K 真人标注任务,跨 Windows/macOS/Ubuntu、200+ 应用与网站**)、**AgentNetTool**(跨平台录制器,**同步采集 屏幕视频 + 鼠标键盘事件 + accessibility tree**)、**AgentNetBench**(离线评测器,**比对模型预测的低级动作 vs 真人 ground-truth**)、**OpenCUA 模型**(7B 单卡 / 32B 4 卡 / 72B);**OpenCUA-72B:OSWorld-Verified 45.0%(开源 SOTA)、ScreenSpot-Pro 60.8%、UI-Vision 37.3%**;已支持 vLLM。**数据管线三步:① AgentNetTool 录人操作 → ② DataProcessor【Action Reduction:把上千低级事件合并成简洁 PyAutoGUI 动作;State-Action Matching:把每个动作对齐到「动作发生前最后一个视觉不同帧」,避免未来信息泄露】→ ③ CoTGenerator【为每步合成 reflective long CoT:反思上一步、解释为何选此动作、记录备选、预测下一状态】。**
- 它优秀在哪:computer-use 领域多数开源只放模型权重;OpenCUA 罕见地把「**数据怎么采、怎么洗、怎么评**」整条管线连同 MIT 可商用许可一起开源。最有迁移价值的不是大模型,而是那套**数据/轨迹工程方法**——尤其 **State-Action Matching「对齐到动作前最后一帧、杜绝未来信息泄露」** 与 **Action Reduction「把噪声级鼠标移动合并成语义动作」**,是任何「记录/回放/评测 computer-use 轨迹」系统都用得上的硬核范式;**AgentNetBench 的「离线对比预测动作 vs ground-truth」** 则给了一套不依赖在线环境的评测口径。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① computer-use 轨迹记录/回放 ← 借「Action Reduction + State-Action Matching」** ⭐⭐:玉兔6 已有 computer-use 能力(截图 + 点击/输入)。借这两招——**把成千上万低级事件精简成语义动作**、**每个动作对齐到「动作前最后一个视觉不同帧」**——可把杂乱操作流整理成干净、可复现、无未来信息泄露的 trace,直接服务控制台「执行轨迹可观测/可回放」。
  - **② 执行轨迹可解释 ← 借 CoTGenerator 的 reflective CoT 结构**:玉兔6 各 agent 的动作日志可借这套「**反思上一步 + 解释为何 + 备选 + 预测下一状态**」四段式结构,让 trace 既可读又可审计(与控制台可观测、-24 批 a11y 同向)。
  - **③ computer-use 能力评测 ← 借 AgentNetBench「离线比对预测动作 vs ground-truth」口径 + AgentNetTool「屏幕视频 + 键鼠 + a11y tree 同步采集」**:玉兔6 若要量化 computer-use 可靠性,这套离线评测 + 三通道采集是现成范式。
- 边界:**模型 7B/32B/72B 需 GPU + vLLM,与玉兔6「单机零依赖」冲突 → 不接模型/不引推理栈**;只借**方法范式**(数据处理 + 评测口径 + reflective CoT 结构),用玉兔6 现有文件机制落地。**MIT 可商用是大利好**——若哪天要做小规模 trace 评测,代码/工具可放心读用。
- 难度:中(借数据/评测方法,不引模型)。优先级:**中**(玉兔6 若强化 computer-use trace 与可靠性评测才迫切;当下作方法储备,其中 State-Action Matching 一条立刻可用于改进现有操作日志)。

### 3. ZJU-REAL/GUI-G2 — 一个反直觉但好用的洞见:把「点得准不准」从「命中/未命中二值」改成「按到目标中心的距离给连续高斯分」,并按元素大小自适应容差,grounding 精度刷过 UI-TARS-72B
- 名称/URL:ZJU-REAL/GUI-G2(AAAI 2026,GUI-G²: Gaussian Reward Modeling for GUI Grounding)— https://github.com/ZJU-REAL/GUI-G2
- 核验事实(本批 web_fetch 直读):**⚠️ 仓库无 LICENSE 文件(许可不明,默认保留所有权利,商用前必须核实)**;**309★ / 10 forks / 66 commits / 无 release**;Python 97.9%;模型 **GUI-G2-3B / 7B(发布在 HuggingFace inclusionAI,基于 Qwen2.5-VL)**;RL 训练码改编自 VLM-R1。**核心洞见(来自 AITW 数据):真人 GUI 点击不是均匀的,而是以目标为中心呈高斯分布**——据此把 grounding 奖励从「二值命中」改成三件套:**① Gaussian Point Reward(离目标中心越近、指数衰减给分)② Gaussian Coverage Reward(预测区域与目标区域的重叠对齐)③ Adaptive Variance(按元素大小动态调奖励粒度——大按钮宽松、小图标严格)**;**密集奖励在训练早期显著优于二值 RL**;ScreenSpot-v2 平均 **93.3%,超过 UI-TARS-72B 的 90.3%**。另该团队 2026-04 又开源了 **ClawGUI**(训练/评测/部署 GUI agent 的统一框架,作下批 watch)。
- 它优秀在哪:它把一个**人因层面的真实规律**(点击服从高斯分布)变成了**可计算的度量**。最迁移友好的不是它的训练方法,而是那条洞见本身——「**判断点得准不准,不该只看命中/未命中,而应按到目标中心的距离连续打分、并按元素尺寸自适应容差**」。这是个**便宜、通用、与是否训练模型无关**的度量改进。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① computer-use 点击精度度量 ← 借「按到目标中心距离给连续分,而非二值命中」**:玉兔6 若评估 computer-use 点击质量,把「点没点中」升级成「**离目标中心多近**」的连续分,能更细地看出「差一点」与「差很多」,与案例 2 的 AgentNetBench 口径合用更佳。
  - **② 自适应容差 ← 借 Adaptive Variance「按元素大小调容差」**:判断点击是否够准时,**大元素宽松、小元素严格**,比一刀切阈值更贴合真实可用性。
- 边界:**⚠️ 仓库无 LICENSE → 许可不明**,模型在第三方(inclusionAI);**不引模型/不引训练码**,且它本体是 GRPO 训练框架(需 GPU),玉兔6 不训模型 → **只借「高斯点击分布 + 自适应容差」这条度量洞见**(纯方法、零依赖),落地自研。
- 难度:低-中(只借度量洞见,纯方法)。优先级:**低-中**(玉兔6 当前不强依赖 grounding 精度评测;作方法储备,可与案例 2 评测口径合并落地)。

### 本批小结(给 CEO 的一句话借鉴)
- **alibaba/higress**:学它「**LLM API 与 MCP API 同一张控制面治理——托管 MCP 即获得 统一鉴权 + 限流 + 全量 audit log + 可观测**」,作控制台「能力网关」字段与「LLM 调用统一层」的设计参考;Apache-2.0/CNCF,但 Istio/Envoy/K8s 重栈,**只借治理字段与网关语义,绝不接 runtime**。
- **xlang-ai/OpenCUA**:学它那套**可商用(MIT)的 computer-use 数据/评测管线**——尤其「**Action Reduction(噪声事件→语义动作)+ State-Action Matching(对齐动作前最后一帧、杜绝未来信息泄露)+ reflective CoT**」,直接可用于改进玉兔6 的操作 trace 记录/回放/评测;不引模型,只借方法。
- **ZJU-REAL/GUI-G2**:学它一条便宜通用的度量洞见——「**点击精度按到目标中心的距离连续打分 + 按元素大小自适应容差**」,而非二值命中;**仓库无 LICENSE、商用前须核实**,只借度量思路、不引模型/训练码。
- **本批不新增待办卡**(延续既有克制口径:仅真漏洞/真实文件膨胀才破例)。理由:三例最值钱的落地——**Higress 的能力网关字段/LLM 网关层属控制台架构取舍需主管拍板、OpenCUA 的 trace 方法与 GUI-G2 的度量洞见属方法储备**——均触及 board/insights/ 之外的控制台/agent 代码,属**方向/设计决策**,非洞察员可单方下派、且只在 board/insights/ 内可执行的原子动作(红线:洞察员只读写 board/insights/)。**若要立刻、最小、最可逆地动一步**:把 **OpenCUA 的「State-Action Matching:每个动作对齐到动作前最后一个视觉不同帧、避免未来信息泄露」** 作为玉兔6 computer-use 操作日志的**设计提案**交主管评审——这是本批落地面最小、对「可复现 trace」增益最直接、且与现有 computer-use 能力最贴合的切口。**Starlaid/星桥 全程排除。**

> watch(本批 web_fetch 直读元数据;HEAD commit SHA 因代理限制未取):alibaba/higress `main`(**Apache-2.0 → watch=true**,8.7k★/1.2k forks/1,710 commits,latest v2.2.2;关注 AI gateway 的 MCP 托管治理字段 + openapi-to-mcp + higress-standalone 演进)、xlang-ai/OpenCUA `main`(**MIT → watch=true**,784★/103 forks;关注训练码开源进度 + AgentNetBench/数据管线演进)、ZJU-REAL/GUI-G2 `main`(**无 LICENSE → watch=false**,309★;只借度量洞见,商用前须核实许可)。另**挂三个下批候选 watch**(均未 seen,待核):**ZJU-REAL/ClawGUI**(同团队,训练/评测/部署 GUI agent 统一框架)、**YXB-NKU/SE-GUI**(NeurIPS 2025,自演化 RL 的 GUI grounding,作 GUI-G2 度量对照)、**vllm-project/production-stack**(vLLM 生产部署栈,作「自托管模型服务」对照,若玉兔6 涉及本地模型再看)。



<!-- insight-scout-run:cr-1782460833546-insight-scout-repos-20260626-16 -->
## 2026-06-26 · 自动洞察(20260626-16 · llm-gateway)

> 来源:洞察员; run=cr-1782460833546-insight-scout-repos-20260626-16; queue=insight-scout/insight-scout-repos-20260626-16; network=available

## 2026-06-26 · LLM 网关 / 成本质量路由 / 可观测 借鉴扫描(slot=20260626-16)\n\n说明:本轮 WebSearch+web_fetch 联网正常,以下元数据为直读核验(实时口径,人工复核为准)。已比对 seen-repos.json,三例均为新案例,与已 seen 的 LiteLLM/Bifrost/Portkey/Helicone/tensorzero/envoyproxy-ai-gateway/openlit/archgw/RouteLLM/semantic-router 不重叠。Starlaid/星桥 全程排除。本批不新增待办卡:三例最值钱的落地(可观测 schema、成本-质量路由范式)均属控制台/主管的架构决策,非明确原子动作。\n\n### theopenco/llmgateway\n- 是什么:TS 写的开源 LLM 网关,统一 OpenAI 兼容 API 路由到 OpenAI/Anthropic/Vertex 等,自带 token/成本追踪与「模型性能-成本对比」面板。\n- 值得借鉴:把「各模型用量/成本/性能横向对比」做成现成仪表盘信息架构,可借给控制台的成本可观测视图。\n- 迁移边界/许可证:AGPLv3(ee/ 目录另需商业授权),传染性强 → 只借面板信息架构,不接服务、不引代码;玉兔6 已有网关,不替换。1.3k★/v1.5.0(2026-06-22)。\n- URL: https://github.com/theopenco/llmgateway\n\n### traceloop/hub\n- 是什么:Rust 写的高性能 LLM 网关,内置 OpenTelemetry tracing + Prometheus /metrics,pipeline 式请求处理 + 配置热重载。\n- 值得借鉴:「每次 LLM 调用 = 一条 OTel span + per-provider 指标(请求数/延迟/错误率)」的标准化可观测 schema,呼应近批「可观测应是默认能力」。\n- 迁移边界/许可证:Apache-2.0,读借友好;Rust+OTel/Prometheus 整套较重,与单机零依赖冲突 → 只借调用追踪/指标的数据模型,不接 runtime。216★/v0.9.3(2026-06-04)。\n- URL: https://github.com/traceloop/hub\n\n### algorithmicsuperintelligence/optillm\n- 是什么:Python 优化推理代理,Router 插件用 optillm-modernbert 分类器按 prompt 自动路由到不同优化策略;Proxy 插件做多 provider 健康检查/轮询/故障转移。\n- 值得借鉴:「轻量分类器按 prompt 难度/类型路由到不同策略或模型」正是成本-质量路由范式——廉价 prompt 走小模型/低策略,难 prompt 才升级,直击成本控制。\n- 迁移边界/许可证:Apache-2.0;依赖分类模型权重 + 重推理策略 → 只借「分类器路由」思路,不引权重、不接代理。4.2k★/v0.3.15(2026-05-07)。\n- URL: https://github.com/algorithmicsuperintelligence/optillm\n\n> watch:traceloop/hub(Apache-2.0→watch=true,看 OTel/pipeline 演进)、optillm(Apache-2.0→watch=true,看 Router 分类路由)、theopenco/llmgateway(AGPLv3→watch=false,仅看面板范式)。



<!-- insight-scout-run:run-20260626-20-insight-scout-repos -->
## 2026-06-26 · 自动洞察(20260626-20 · 像素素材与画风 + 优秀网页设计)

> 来源:洞察员; run=insight-scout-repos-20260626-20; slot=20260626-20; network=available; note=本轮由 scheduled-task 直接执行
>
> 说明:本轮轮换到 last-4 slot(今日 -00 unity / -04 multi-agent / -08 queue / -12 agent-skills / -16 llm-gateway+gui-grounding)**最久未覆盖**的两个专题——**像素素材与画风** 与 **优秀网页设计**。去重已比对 `seen-repos.json`(188 仓库):本批三例(xyflow/xyflow、TanStack/table、imazen/zenquant)均为**新案例**,与已 seen 的像素工具(Pixelorama/LibreSprite/aseprite/proper-pixel-art/pixel-forge/Pixelization/Pixel-Composer/free-tex-packer 等)、网页/UI 库(react-bits/tabler/magicui/shadcn-ui/mantine/tremor/daisyui/shoelace/motion/kbar 等)均不重叠。本节是给老板/CEO 看的「值得借鉴」分析,**非待办**;本批**不新增待办卡**(理由见末)。**web_fetch 直读核验 star/license/机制;Starlaid/星桥 全程排除。一条 license 红线先行:案例 3(zenquant)为 AGPL-3.0 / 商业 双授权(强传染),仅可「借概念」不可引代码。**

### 1. xyflow/xyflow(React Flow / Svelte Flow)— 节点-边图(node-based UI)的开箱即用底座:nodes+edges 数据模型 + 内置 拖拽/缩放/平移/多选/minimap,自定义节点就是普通组件
- 名称/URL:xyflow/xyflow(React Flow | Svelte Flow,Powerful open source libraries for building node-based UIs)— https://github.com/xyflow/xyflow
- 核验事实(本批 web_fetch 直读):**MIT**;**36.9k★ / 2.4k forks / 6,195 commits / 375 release(latest @xyflow/react@12.11.0,2026-06-01)**;**TypeScript 85.4% / Svelte 11.7% / CSS 2.3%**;mono-repo 四包——`@xyflow/react`(12)、`reactflow`(v11 分支)、`@xyflow/svelte`、`@xyflow/system`(共享核心)。开箱即用:节点拖拽、缩放、平移、多选、键盘快捷键,内置 `MiniMap` / `Controls` / `Background`;支持自定义节点/边类型、多 handle;数据模型即 `nodes[]` + `edges[]`(`useNodesState` / `useEdgesState` / `addEdge`)。被 Stripe、Typeform 等使用,Topics:workflow / graph / flowchart / node-based-ui。
- 它优秀在哪:把「节点-边图」这件别人要从零造轮子的事做成了**开箱即用 + 无限可定制**的前端库——数据是朴素的 `nodes/edges` 数组,交互(拖拽/缩放/平移/多选/minimap)全内置,自定义节点就是普通 React/Svelte 组件。等于把「画一张可交互的流程/依赖图」从「几周自研 canvas」压成「装一个库 + 喂数据」,是数据处理工具、workflow 编辑器、chatbot builder 等的事实标准底座。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 控制台 run/编排/队列可视化 ← 借「nodes+edges 数据模型 + 内置图交互」** ⭐⭐:玉兔6 的 run(洞察员每 4h、各工位派单链)、队列 DAG、agent 依赖目前可观测偏弱(靠 status-rollup.md 纯文本)。React Flow 可把「谁派给谁、跑到哪一步、依赖关系」直接画成**可缩放、可点开**的节点图——正是二十六/二十八/二十九批「可观测应是默认能力」与 Kestra 批「每次 execution = topology」共识的**现成前端实现**。
  - **② 编排「配置即流程」的可视编辑 ← 借 workflow editor 范式**:若玉兔6 把派单/编排做成声明式流程(接二十六批 durable、二十九批 GOAP「声明式规划」),React Flow 可作「拖拽连线编排 + 可视审阅」的编辑器层,让非技术也能看懂、改动流程。
  - **③ 任何「图」视图复用同一底座 ← 借 custom node**:状态机、行为树(对接二十九批 GOAP/NavMesh)、技能/能力依赖图都能用同一套渲染底座。
- 边界:**关键澄清——React Flow 是前端 npm 组件库(打包进控制台前端的 JS),不是需要独立部署的服务/存储进程,因此与玉兔6「单机零依赖」红线不冲突**(本质不同于 Kestra/Higress 那类重型 runtime)。**MIT 可商用、可放心引**。唯一注意:它是 React(或 Svelte)生态,控制台前端若非该栈需适配;超大图需配合虚拟化/性能优化。
- 难度:低-中(纯前端库,控制台若为 React 栈可直接引;主要是数据建模 + 自定义节点样式)。优先级:**高**(对控制台「编排/run/队列可视化」价值最大、落地面最实、可逆——这是本批唯一「不违反单机零依赖、可直接动手」的一项)。

### 2. TanStack/table — headless 表格引擎:排序/过滤/分组/分页/虚拟化的「状态与算法」它管,markup/样式/品牌你管
- 名称/URL:TanStack/table(Headless UI for building powerful tables & datagrids)— https://github.com/tanstack/table
- 核验事实(本批 web_fetch 直读):**MIT**;**27.9k★ / 3.5k forks / 2,806 commits / 292 release / 457 contributors**;latest `@tanstack/angular-table@8.21.4`(2026-04-03);**TypeScript 98.8%**;**~14kb(tree-shaken)**;framework-agnostic 核心 + React/Vue/Solid/Svelte/Angular/Lit 绑定。能力:排序(多列多向)、过滤(列 + 全局)、分组聚合、行选择、行展开、列 显隐·排序·钉住·宽度、**虚拟化、server-side 友好**。核心理念:**headless——库只给 逻辑/状态/API,不给 markup/样式/组件**,UI 完全由你掌控。
- 它优秀在哪:它把「数据表格最难的那部分(排序/过滤/分组/分页/虚拟化的状态与算法)」抽成**与样式无关的引擎**,你保留自己的 DOM/CSS/品牌。即「**表格的数学与状态它来管,长相与交互你来定**」——既省掉重复造轮子,又不被某套 UI 风格绑架(与已 seen shadcn/ui「你拥有代码」哲学同向,但更聚焦表格逻辑)。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 控制台 公告板/runs/队列/repair-tickets 列表 ← 借 headless table 引擎** ⭐:`cards.json`(待办卡)、runs、queue 条目、repair-tickets 本质都是表格数据,且会随系统增长。借其「排序/过滤/分组/分页 + 虚拟化」逻辑,玉兔6 只写自己的行/单元格 markup,即可让公告板支持「按 status / source / 优先级 过滤排序、大列表不卡」。
  - **② 大列表性能 ← 借虚拟化(配套 TanStack Virtual)**:insights/seen-repos 已 188 仓库、repair-tickets 目录 80+,公告板与各列表会持续变长,虚拟化保证只渲染可见行。
  - **③ 「headless 引擎 + 自带样式」范式 ← 作控制台所有数据视图的通用策略**:逻辑复用、样式自主,降低控制台前端的长期维护成本。
- 边界:同为**前端库(打包进前端),与单机零依赖不冲突**;但它只是表格引擎,玉兔6 仍需自写 UI 与数据接入。注意:**仓库默认分支名为 `alpha`(v9 在孵化);稳定生产线为 v8(latest release 均为 8.x)**,引用版本以 v8 稳定线为准。MIT 可放心引。
- 难度:低-中(纯前端,接 `cards.json`/runs 数据 + 写行渲染)。优先级:**中**(公告板/列表到一定体量后价值明显;当下可与案例 1 一并作控制台前端能力储备)。

### 3. imazen/zenquant — 感知量化:把有限调色板「花在眼睛最敏感处」,并把「一份调色板服务多帧 + 可设质量地板自动回退」做成 API
- 名称/URL:imazen/zenquant(Color quantization with perceptual masking — OKLab, AQ weights, adaptive dithering)— https://github.com/imazen/zenquant
- 核验事实(本批 web_fetch 直读):**⚠️ AGPL-3.0 / 商业 双授权(强 copyleft;商用需购授权,否则须开源你的源码)**;**1★ / 0 forks / 216 commits / 4 release(latest v0.1.3,2026-04-10)**;**Rust 100%**;**README 明示「Developed with Claude;Not all code manually reviewed」(AI 生成、未全人工审)**。机制:OKLab 直方图 → median cut → 带 **butteraugli 启发的 AQ(自适应量化)权重** 的 k-means 精修 → 格式感知调色板排序 → 自适应 Floyd-Steinberg dithering → 可选 Viterbi DP(run-length 优化)。三个可借**概念**:**① 感知量化**——把有限调色板「花在眼睛敏感处(渐变/肤色)」,少花在噪声纹理;**② 共享调色板**——从代表帧建一份 palette,各帧 `remap` 到同一 palette(APNG/GIF 动画用);**③ 质量地板**——`with_target_ssim2` 自动调参、`with_min_ssim2` 设硬阈,不达标返回 `QualityNotMet`,让编码器对该帧回退 truecolor。
- 它优秀在哪:多数量化器对每个像素一视同仁;zenquant 用**感知模型决定「调色板该花在哪」**,并把「**一份调色板服务多帧 + 可设质量地板自动回退**」做成 API。对「**多来源素材如何收敛到统一、稳定、可控的有限调色板**」这件事给出了感知层面的答案——这正是像素素材画风一致的核心难点之一。
- 玉兔6 可借鉴(对应 Simulaid 像素素材,接第三十批 Pixelization「cell 可控 + 反走样」之后的下一环——调色板统一):
  - **① Simulaid 素材「画风一致」← 借「共享调色板」概念** ⭐:多人/多来源/AI 生成的像素素材,定一套主调色板,所有素材/动画帧 remap 到同一 palette——从「颜色层面」根除「这张偏暖、那张偏冷」,与 Pixelization 的「cell 粒度统一」**互补**,合起来才是完整的画风一致。
  - **② 渐变/阴影一致 ← 借「感知量化(OKLab + AQ)」概念**:像素素材的渐变/阴影最易出现 banding;把调色板预算优先给视觉敏感区,统一阴影过渡风格。
  - **③ 素材入库质量门 ← 借「质量地板 + 回退」概念**:给素材像素化/量化设质量阈值,低于阈值者自动标记「待人工处理 / 该帧保留高保真」而非静默劣化——一道便宜的素材质量门(与近批「上线自检门」同构)。
- 边界:**⚠️ 三重边界——(a) AGPL/商业双授权,强传染,商用绝不能直接引代码/crate;(b) 仅 1★、v0.1 早期、Rust;(c) 作者注明 AI 生成且未全人工审。** → **只借概念**(共享调色板 / 感知量化 / 质量地板回退),落地用玉兔6 自研或可商用替代(如 `libimagequant`,但其许可例外条款需另行人工核实)。红线:不引受限代码到产物,仅离线概念验证。
- 难度:中(借概念后需自研像素化/量化滤镜)。优先级:**低-中**(Simulaid 素材起规模后才迫切;当下先把「主调色板 + 共享 remap」定为素材规范即可,概念零依赖)。

### 本批小结(给 CEO 的一句话借鉴)
- **xyflow/xyflow(React Flow)**:学它「**nodes+edges 数据模型 + 开箱即用图交互**」,给控制台的 run/队列/编排做一张可缩放、可点开的可视化图——MIT 纯前端库、**不违反单机零依赖、本批最该动手的一项**。
- **TanStack/table**:学它「**headless 表格引擎——排序/过滤/分组/虚拟化它管,markup/样式你管**」,给公告板/runs/队列列表加上过滤排序与大列表不卡;MIT 纯前端,渐进可引。
- **imazen/zenquant**:学它「**共享调色板 + 感知量化(OKLab/AQ)+ 质量地板回退**」三个概念,作 Simulaid 素材「画风一致 + 入库质量门」的规范——但 **AGPL/商业双授权 + 1★ 早期 + AI 未全审**,**只借概念、绝不引代码**。
- **本批不新增待办卡**(延续既有克制口径:仅真漏洞/真实文件膨胀才破例)。理由:三例最值钱的落地——**React Flow 可视化 / TanStack Table 列表** 属控制台前端架构取舍、**zenquant 三概念** 属 Simulaid 素材规范——均触及 board/insights/ 之外的控制台/Simulaid 代码,属**方向/设计决策**,应由产品/主管拍板,非洞察员可单方下派、且只在 board/insights/ 内可执行的原子动作(红线:洞察员只读写 board/insights/)。**若要立刻、最小、最可逆地动一步**:把 **React Flow 作为控制台「run/队列可视化」的前端选型** 交主管评审——它 MIT、纯前端、**不碰单机零依赖红线**,是本批落地面最小、对「可观测」增益最直接的切口。**Starlaid/星桥 全程排除。**

> watch(本批 web_fetch 直读元数据;HEAD commit SHA 因代理限制未取):xyflow/xyflow `main`(**MIT → watch=true**,36.9k★/2.4k forks/6,195 commits,latest @xyflow/react@12.11.0;关注 React Flow 12 + Svelte Flow 演进,作控制台编排/run 可视化选型)、TanStack/table(**MIT → watch=true**,27.9k★/3.5k forks/457 contributors;关注 v9 alpha → 稳定 + 与 TanStack Virtual 协同,作公告板/列表引擎)、imazen/zenquant `main`(**AGPL/商业双授权 → watch=false**,仅 1★ 早期、AI 未全审;只借概念、商用绝不引代码)。另**挂三个下批候选 watch**(均未 seen,待核):**ImageOptim/libimagequant**(可商用许可的成熟量化引擎,作 zenquant 概念的**可落地替代**)、**makew0rld/dither**(Go,有序 + 误差扩散 dithering 库)、**xyflow/awesome-node-based-uis**(node-based UI 资源清单,作选型参考)。



<!-- insight-scout-run:cr-1782475234357-insight-scout-repos-20260626-20-gui-grounding -->
## 2026-06-26 · 自动洞察补扫(20260626-20 · gui-grounding)

> 来源:洞察员; run=cr-1782475234357-insight-scout-repos-20260626-20; queue=insight-scout/insight-scout-repos-20260626-20; network=available

## GUI grounding / computer-use / a11y 借鉴扫描(slot 20260626-20, network_status=available)
说明:已比对 seen-repos、borrowed-libs、insights;本轮避开已登记的 OmniParser、OSWorld、UI-TARS、Agent-S、OpenCUA、GUI-G2 等 URL。Web 直读 GitHub/官方文档核验,不登录、不安装、不引运行时。已有公告卡 insight-749362dd14 覆盖“a11y tree + 视觉 grounding 双通道”决策方向,本轮不新增重复卡。Starlaid/星桥 已按红线排除。
### microsoft/playwright
- 是什么:Web 自动化/测试框架,Playwright MCP 与 ARIA snapshot 可把页面暴露为结构化 accessibility tree。
- 值得借鉴:用 role/name/ref 作为首层 grounding,先语义定位再截图兜底;aria snapshot 可做回归断言。
- 迁移边界/许可证不确定项:Apache-2.0 已核;只覆盖浏览器/WebView,桌面原生 GUI 还需 macOS AX/截图桥接。
- URL: https://github.com/microsoft/playwright
### browser-use/browser-use
- 是什么:开源浏览器 agent 框架,提供真实浏览器动作空间、CLI state/click/type/screenshot 与 domain allowlist。
- 值得借鉴:把“当前页面可点击元素状态”显式化,并保留持久浏览器、恢复循环和域名白名单作为执行护栏。
- 迁移边界/许可证不确定项:MIT 已核;Python/Rust runtime 与云端/API key 能力不进主链,只借状态模型和安全边界。
- URL: https://github.com/browser-use/browser-use
### dequelabs/axe-core
- 是什么:Web/HTML UI 的自动化无障碍规则引擎,输出机器可消费的 a11y violations。
- 值得借鉴:把 label、role、contrast、focus 等问题转成规则化自检,可作为 grounding 失败前的只读预检层。
- 迁移边界/许可证不确定项:MPL-2.0 已核,若打包需合规复核;仅覆盖 Web DOM,不替代桌面 GUI grounding。
- URL: https://github.com/dequelabs/axe-core
### 行动判断
- 不新增公告板卡:既有 insight-749362dd14 已启用同类方向;本轮只补三项低风险对照,供该卡后续评审引用。



<!-- insight-scout-run:run-20260626T2010Z-queue-agent-tools -->
## 2026-06-27 · 自动洞察(run-20260626T2010Z · 任务队列引擎 + AI agent 工具/skills)

> 来源:洞察员;run=run-20260626T2010Z-insight-scout-repos(UTC 2026-06-26T20:10Z;本次为定时自动运行,引擎未下发 cr- 编号,故用时间戳 run id);network=available。下列 star/license/release 为本批 web_fetch 直读 GitHub 仓库页核验(实时口径,人工复核为准)。
>
> 轮换说明:近几批已覆盖「多智能体编排 + Unity(24)/像素 + 网页设计(20)/LLM 网关 + GUI grounding(16)/agent-skills 注册表(12)/队列引擎(08)」。本轮轮换到**最久未成批的两个专题:任务队列引擎 + AI agent 工具与 skills**。去重已比对 seen-repos.json(本批前 203 仓库,本批后 206):三例(resonatehq/resonate、ArcadeAI/arcade-mcp、ComposioHQ/composio)**均为新案例**,与已 seen 的队列族(temporal/restate/inngest/river/hatchet/dbos/celery/bullmq/asynq/faktory/windmill/trigger.dev/kestra/obelisk…)、工具/注册表族(toolsdk-mcp-registry/modelcontextprotocol-registry/toolhive/mcp-context-forge/fastmcp/ComposioHQ-agent-orchestrator…)均不重叠。本节是给老板/CEO 看的「值得借鉴」分析,**非待办**;本批**不新增待办卡**(理由见末)。**Starlaid 全程排除。**

### 1. resonatehq/resonate — 「分布式 async/await」把**持久化执行**压成单文件二进制:一个 Rust 单 binary 当 supervisor+orchestrator,把每一步结果落库,函数重启后从断点续跑;默认 SQLite 后端、零外部依赖
- 名称/URL:resonatehq/resonate(Distributed Async Await — Durable Executions, Dead Simple)— https://github.com/resonatehq/resonate
- 核验事实(本批 web_fetch 直读仓库页):**Apache-2.0**;**609★ / 51 forks / 56 commits / 9 releases**,latest **v0.9.8(2026-06-04)→ 活跃**;**Rust 99.6%**(单 binary)。形态:**Resonate Server = 一个高效单二进制**,与各语言 SDK 配对,把"可靠的分布式函数执行"带进应用——**进程重启/失败后仍续跑**;它同时是 Workers 的 **supervisor + orchestrator**,**持久化执行状态**让长跑函数总能跑完;**默认 SQLite 后端**(启动日志 `Using SQLite backend: resonate.db`),HTTP 端口 + 9090 metrics。编程模型:写普通函数,`yield* context.run(fn)` 跑子步并**持久化其结果**、`yield* context.sleep(s)` 持久化睡眠——**无 DSL、无 workflow 定义**,一个 5→1 倒计时可跨重启跑数小时/数天。SDK:TypeScript / Python / Rust,同一 durable-promise 协议。
- 它优秀在哪:多数 durable execution(Temporal/Restate/DBOS,均已 seen)要么要一套外部集群/存储,要么有较重 SDK 心智。Resonate 的差异点是**把"持久化执行"收敛成一条协议 + 一个单 binary + 默认 SQLite**:① 心智极简——普通 async/await 风格函数,用 `context.run` 把"这一步做过没、结果是啥"落库,**重启即从最后已持久化的步续跑**;② 部署极简——**单文件 + SQLite,零外部依赖**就能拿到"崩溃续跑";③ Server 本身是 supervisor+orchestrator,天然对应"一个进程派单 + 看护一批 worker"。Apache-2.0,可放心读借。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 队列/任务可靠执行 ← 借「durable promise:每步结果落库 → 重启从断点续跑」** ⭐:玉兔6 已有 `queue-crash-recovery-orphan-reclaim` 卡(借 DBOS,做"启动回收孤儿 running + claim lease/心跳 + step 幂等记忆")。Resonate 把这件事的核心收敛成**"步结果持久化 + 续跑"** 一个清晰范式,可把该卡从"回收孤儿任务"升级到"**从最后已完成 step 续跑**"——洞察员每 4h / 长跑工位中途崩了不必整单重跑。
  - **② 单机零依赖的"可靠执行"形态 ← 借「单 binary + 默认 SQLite」** ⭐:这点与玉兔6"单机零依赖"红线高度同频——Resonate 证明 durable execution **不需要重型基础设施**,一个进程 + 一个 SQLite 文件即可。可作为玉兔6"控制台 = 单进程 + SQLite 执行日志"方向的有力背书与对照实现。
  - **③ 长任务表达 ← 借 `context.run` / `context.sleep` 的"持久化 yield"模型**:洞察员/长跑工位的"跑一步、睡一会、再跑"可用"普通函数 + 持久化让步"表达,免去单独的调度 DSL。
  - **④ 编排 ← 借「Server 既是 supervisor 又是 orchestrator」**:与控制台"派单 + 看护工位"同构,可对照其 worker 注册/调用回执设计。
- 边界:Resonate **runtime 是 Rust binary + 各语言 SDK**;玉兔6 不必引入其 runtime,**只借"durable promise 步持久化 + SQLite 单文件"范式**落到自有队列。Apache-2.0 对读借友好;无受限权重。注:其 README 残留一句"compile and run it as a Go program"系历史(项目现为 Rust),以 Languages=Rust 99.6% 为准。
- 难度:中(借"步持久化续跑"模型,落在队列引擎 + SQLite 执行日志)。优先级:**高**(直接强化既有 queue-crash-recovery 卡且贴合单机零依赖红线;**借模型=高,接 Rust runtime=不做**)。

### 2. ArcadeAI/arcade-mcp — 把"工具要什么权限/密钥"做成**声明式**,且**运行时注入、模型永远看不到密钥**:`@app.tool(requires_secrets=[...], requires_auth=Provider(scopes=[...]))` 一行声明,OAuth/密钥在 runtime 注入 context,LLM 与 MCP client 都拿不到 token
- 名称/URL:ArcadeAI/arcade-mcp(The best way to create, deploy, and share MCP Servers)— https://github.com/ArcadeAI/arcade-mcp
- 核验事实(本批 web_fetch 直读仓库页):**MIT**;**857★ / 87 forks / 655 commits**;**无 GitHub releases**(以 PyPI `arcade-mcp` 发版);**Python 99%**。形态:**MCP Server 框架**——`arcade new` 脚手架一键生成 server.py(含 MCPApp + 示例工具)、pyproject、.env.example;工具用装饰器声明能力需求:`@app.tool(requires_secrets=["MY_SECRET_KEY"])`、`@app.tool(requires_auth=Reddit(scopes=["read"]))`;**密钥/OAuth token 在运行时注入 `context`,"LLMs and MCP clients cannot see or access your secrets/tokens"**;多 transport(stdio/http),`arcade configure claude|cursor|vscode` 一键接客户端;兼容任意 MCP client/LLM/agent 框架(LangChain/Mastra/Pydantic AI/CrewAI/ADK/OpenAI Agents)。topics 自带 `ai-gateway / mcp-gateway / llm-tool-call`。
- 它优秀在哪:很多工具/skill 体系把"这个工具要不要 auth、要哪些 scope、密钥放哪"散落在实现里,且常把密钥暴露给调用方。arcade-mcp 把它做成**工具定义上的一等声明**(`requires_auth/requires_secrets/scopes`),再用**运行时注入 + 边界隔离**保证"**执行体能用、但永远看不到原始密钥**"。这正中玉兔6 两条线:**"不回显密钥"红线**(模型/工位拿不到 token)与**工位权限/human-gate**(每个工具显式声明它要碰什么)。MIT,可放心读借。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 能力库 + "不回显密钥"红线 ← 借「工具声明 `requires_secrets/requires_auth/scopes` + 运行时注入、模型永不见密钥」** ⭐:玉兔6 已有 `insight-ec5bd7802b`(能力库加 validated/trust_tier/staleness 字段)与 `office-tool-station-humangate` 卡。arcade-mcp 给出**可直接抄的字段范式**:每个 skill/工具的 manifest 增列 `requires_secrets / requires_auth / scopes`,并在执行层做**密钥注入边界**——把"不回显密钥"从约定升级成**机制保证**(执行体只拿到注入后的能力,拿不到原始 token)。这是本批对红线最直接的强化。
  - **② 工具→工位驱动 + human-gate ← 借"声明式能力需求"**:工具显式声明所需 auth/scope,正好喂 `office-tool-station-humangate` 的审批门:**需要敏感 scope 的工具 → 自动触发 human-gate**。
  - **③ 能力库 DX ← 借 `arcade new` 脚手架 + `arcade configure <client>` 一键接入**:玉兔6 能力库可借"一条命令生成一个合规工具骨架 + 一条命令接到控制台/客户端"的开发体验。
- 边界:arcade-mcp 是 **Python MCP server 框架 + 可选 Arcade 云**(http transport 下 requires_auth 需部署到 Arcade 才生效);玉兔6 **不接其云、不引 runtime**,**只借"声明式能力需求 + 运行时密钥注入边界"的设计**落到自有能力库/执行层。MIT 友好;无受限权重。
- 难度:低-中(加 manifest 字段 + 执行层注入边界)。优先级:**中-高**("模型永不见密钥"直接强化不回显红线 + 权限模型;**建议并入既有 `insight-ec5bd7802b` 评估,不另起卡**)。

### 3. ComposioHQ/composio — 当工具有成百上千个,问题从"接工具"变成"**怎么找对工具 + 怎么安全地跑**":Composio 把 **tool search(在 1000+ toolkits 上检索)+ 托管认证 + sandboxed workbench(隔离执行)** 合成一套
- 名称/URL:ComposioHQ/composio(Composio powers 1000+ toolkits, tool search, context management, authentication, and a sandboxed workbench…)— https://github.com/ComposioHQ/composio
- 核验事实(本批 web_fetch 直读仓库页 + 检索):**MIT**(主仓);**~28k★ / 4,542 forks**,活跃(2026-06-23 仍在更新,近期含 TS 依赖安全升级);**Python + TypeScript SDK**。能力:**① Tool search**——在 **~982 toolkits / 20,000+ tools / 500+ apps** 上做**工具检索/选择**,agent 不必一次性加载全部工具;**② Authentication**——托管 OAuth/密钥;**③ Context management**;**④ Sandboxed workbench**——工具/代码在**隔离环境**执行;另有 `Rube`(基于 Composio 的 MCP server,单端点接 500+ app)。
- 它优秀在哪:玉兔6 能力库在变大,"工具越多越难选"很快会成为瓶颈——把所有工具塞进上下文既贵又糊。Composio 的两点最值钱:**(a) tool search**——把"从一大堆能力里检索出当前该用的那个"做成一等能力(与玉兔6 已在做的 insights 冷热分离/渐进披露同向);**(b) sandboxed workbench**——工具/代码隔离执行(与上批 agentscope 的 Workspace/Sandbox 互为印证)。MIT,可放心读借。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① 能力库工具发现 ← 借「tool search:在大目录上检索该用的工具,而非全量加载」** ⭐:随 skill/工具增多,控制台/工位可借"**先检索 → 只加载命中的少量工具**"避免上下文膨胀(接 `insights-progressive-disclosure` 同一降本思路,落到能力选择层)。
  - **② 工具执行隔离 ← 借 sandboxed workbench**:工位读写文件/跑工具时的**隔离执行边界**(与 agentscope Workspace/Sandbox 合并评估),降低"工具乱动文件"的风险。
  - **③ 上下文/认证 ← 借 context management + 托管 auth 的目录级范式**(与案例 2 的 arcade-mcp 互补:arcade 偏"单工具声明式 auth + 密钥注入",composio 偏"目录级工具检索 + 托管 auth + 沙箱")。
- 边界:Composio 是**重型托管平台 + 上千连接器**,与玉兔6 单机零依赖冲突——**只借"tool search + 沙箱执行"两个范式**,不引平台、不接 1000+ 连接器。MIT 友好;无受限权重。
- 难度:中(tool search 需给能力库建检索;沙箱执行是更大工程)。优先级:**中**(tool search 随能力库增长价值上升,可先做轻量检索;沙箱与 agentscope 一起立项评估)。

### 本批小结(给 CEO 的一句话借鉴)
- **resonatehq/resonate**:学它「**每步结果落库 → 重启从断点续跑**,且**单 binary + 默认 SQLite 零依赖**」——直接强化既有"队列崩溃恢复"卡,且为"控制台=单进程+SQLite执行日志"背书;只借范式,不接 Rust runtime。Apache-2.0,609★,活跃。
- **ArcadeAI/arcade-mcp**:学它「工具**声明式 `requires_auth/requires_secrets/scopes` + 运行时注入、模型永不见密钥**」——把"不回显密钥"红线从约定升级成机制;建议并入既有能力库字段卡(`insight-ec5bd7802b`)评估。MIT,857★。
- **ComposioHQ/composio**:学它「**tool search 在大目录上检索该用的工具**(而非全量加载)+ **沙箱执行**」——为能力库增长期的"工具发现 + 隔离执行"提前布局。MIT,~28k★,活跃。
- **本批不新增待办卡**(延续近批克制口径)。理由:三例最值钱的落地——**resonate 的"步持久化续跑"是既有 `queue-crash-recovery` 卡的增强、arcade 的"声明式 auth + 密钥注入"是既有 `insight-ec5bd7802b` / `office-tool-station-humangate` 卡的增强、composio 的 tool search/沙箱属能力库演进方向**——均可并入既有卡评估,无需新原子动作。**若想立刻、最小、最可逆地动一步**:① 队列侧——把 `queue-crash-recovery` 卡的验收口径补一句"step 完成即落库、重启从最后 step 续跑"(零代码、纯口径);② 能力库侧——给 skill manifest 草拟 `requires_secrets / requires_auth / scopes` 三字段草稿(参照 arcade-mcp,纯设计)。**Starlaid 全程排除。**

> watch(本批 web_fetch 直读元数据;HEAD commit SHA 因代理 git ls-remote 受限未取,待网络可达回填):resonatehq/resonate `main`(**Apache-2.0 → watch=true**,关注 durable-promise 协议 / SQLite 后端 / v0.9.x 演进,609★、v0.9.8 2026-06)、ArcadeAI/arcade-mcp `main`(**MIT → watch=true**,关注 requires_auth/requires_secrets 注入边界与 transports,857★、PyPI 发版)、ComposioHQ/composio `master`(**MIT → watch=true**,关注 tool search 与 sandboxed workbench 的开源实现,~28k★)。另挂下批候选 watch:**PrefectHQ/prefect**(Python 工作流 + 一流 run 可观测 UI,作 resonate 的"重型对照")、**runabol/tork**(Go 可嵌入分布式工作流,轻量队列对照)、**arcadeai/arcade-mcp/examples**(声明式 auth 工具样例)。



<!-- insight-scout-run:cr-1782518436625-insight-scout-repos-20260627-08 -->
## 2026-06-27 · 自动洞察(20260627-08 · multi-agent-orchestration)

> 来源:洞察员; run=cr-1782518436625-insight-scout-repos-20260627-08; queue=insight-scout/insight-scout-repos-20260627-08; network=available

## 多智能体编排 / 任务 DAG / 交接协议借鉴扫描(slot 20260627-08)\n\n> network_status=available;已比对 seen-repos.json、borrowed-libs.md、insights.md,本轮 3 个 URL 未出现;禁入项目已全程排除。\n\n### microsoft/autogen\n- 是什么:微软多智能体框架,AgentChat 有 RoundRobin/Selector/Swarm,GraphFlow 用 DiGraph 控制顺序、并行、条件与循环。\n- 值得借鉴:HandoffMessage + HandoffTermination 把“交接给人/下个 agent”做成显式消息与停止条件,便于应用层保存状态后再恢复。\n- 迁移边界/许可证不确定项:仓库已进入 maintenance mode,新项目官方建议转 Microsoft Agent Framework;代码 MIT、文档 CC-BY-4.0,只借协议语义。\n- URL: https://github.com/microsoft/autogen\n\n### dapr/dapr-agents\n- 是什么:CNCF Dapr 体系下的生产级 agent 框架,内置 durable workflow、pub/sub、actors、state、telemetry 与安全边界。\n- 值得借鉴:把 agent 当有状态 actor,交接走消息总线,失败靠工作流自动 retry/recover,很适合作控制台“任务不丢+可续跑”的底座对照。\n- 迁移边界/许可证不确定项:Apache-2.0;强依赖 Dapr sidecar/K8s/组件生态,控制台只借 durable/state/pubsub/retry 语义,不引运行时。\n- URL: https://github.com/dapr/dapr-agents\n\n### langroid/langroid\n- 是什么:CMU/UW-Madison 研究者维护的轻量 Python 多 agent 编程框架,Agent 装工具,Task 负责任务协作与消息传递。\n- 值得借鉴:PASS_TO、SEND_TO 这类控制信号把交接动作压成极小词汇表,比自然语言“请转交”更适合控制台任务路由。\n- 迁移边界/许可证不确定项:MIT;仍是 Python LLM 框架,依赖模型/工具适配,只借 Task+控制信号词汇,不接 runtime。\n- URL: https://github.com/langroid/langroid



<!-- insight-scout-run:cr-1782532838089-insight-scout-repos-20260627-12 -->
## 任务队列引擎 / 调度可靠性 / 失败处置补扫(slot=20260627-12, network=available)
说明:已比对 `seen-repos.json`、`borrowed-libs.md`、`insights.md`,本轮 3 个 URL 未出现;联网直读 GitHub README/LICENSE 与 Quartz 文档,不记录实时 star/commit/release;禁入项目已排除。

### rails/solid_queue
- 是什么:Rails 官方数据库型 Active Job 后端,支持 delayed/recurring jobs、队列暂停、优先级、并发控制与失败任务保留。
- 值得借鉴:进程心跳 + supervisor 清理过期进程,把 in-flight job 标成失败并保留错误;recurring 执行用唯一索引避免多 scheduler 重复入队,并发控制用 semaphore + duration 兜底。
- 迁移边界/许可证不确定项:MIT 已核;强耦合 Rails/ActiveRecord,失败重试依赖 Active Job,控制台只借心跳回收、失败留痕、周期任务去重语义。
- URL: https://github.com/rails/solid_queue

### sidekiq/sidekiq
- 是什么:Ruby/Redis 后台任务框架,核心路径覆盖 Scheduled、Retry、Dead 与 Web UI 人工处置。
- 值得借鉴:Retry/Dead 分层清晰,失败耗尽后进入 Dead set,UI 可 inspect/retry/delete;retry_queue 可把重试任务降优先级,避免旧失败压住新任务。
- 迁移边界/许可证不确定项:LGPLv3,Pro/Enterprise 为商业授权;依赖 Ruby+Redis,控制台只借 Retry/Dead/人工恢复词表,不接代码或商业特性。
- URL: https://github.com/sidekiq/sidekiq

### quartz-scheduler/quartz
- 是什么:Java 生态成熟调度器,关注 Trigger、Calendar、优先级、持久触发器与 misfire 处置。
- 值得借鉴:misfire instruction 把“停机/线程不足导致错过触发”显式策略化;Trigger priority 与 recovery priority 可防恢复风暴时关键任务被淹没。
- 迁移边界/许可证不确定项:Apache-2.0 已核;它是调度器不是任务队列,只借 missed schedule 策略、优先级与日历排除规则。
- URL: https://github.com/quartz-scheduler/quartz

### 行动判断
- 不新增公告板卡:三例补足“心跳回收、Retry/Dead、misfire 策略”,但与既有“文件队列语义约定 v0”方向同源,适合并入后续设计评审而非新开 CEO 原子动作。



<!-- insight-scout-run:run-20260627T0405Z-pixeloffice-grounding -->
## 2026-06-27 · 自动洞察(run-20260627T0405Z · 像素办公室可视化(Simulaid/控制台监控)+ GUI grounding)

> 来源:洞察员;run=run-20260627T0405Z-insight-scout-repos(UTC 2026-06-27T04:05Z;本次为定时自动运行,引擎未下发 cr- 编号,故用时间戳 run id);network=available。下列 star/license/release 为本批 web_fetch 直读 GitHub 仓库页核验(实时口径,人工复核为准)。
>
> 轮换说明:近几批集中在 多智能体编排 / 任务队列引擎 / agent 工具 (20260627-04/08/12 + run-20260626T2010Z)。本轮轮换到**最久未深挖的两个产品向专题:像素办公室「把多智能体系统可视化成办公室」+ GUI grounding**。去重已比对 seen-repos.json(本批前 215 → 后 218):三例(pablodelucca/pixel-agents、dandacompany/deskrpg、InfiXAI/InfiGUI-G1)**均为新案例**,与已 seen 的像素族(Pixelorama/aseprite/LibreSprite/piskel/pixijs/ldtk/tiled/free-tex-packer/TileGen/pixel-mcp/instatileset…)、GUI-grounding 族(UGround/UI-TARS/Agent-S/UI-Venus/OmniParser/ShowUI/ScaleCUA/OpenCUA/GUI-G2/ScreenSpot-Pro…)均不重叠。本节是给老板/CEO 看的「值得借鉴」分析,**非待办**;本批**不新增待办卡**(理由见末)。**Starlaid 全程排除。**

### 1. pablodelucca/pixel-agents — 把「正在干活的多智能体系统」直接渲染成一间像素办公室:每个 agent = 一个会走动/坐工位/按动作变化(打字/读取/等待)的角色;**纯观测**地 tail Claude Code 的 JSONL transcript,不改 agent 运行时
- 名称/URL:pablodelucca/pixel-agents(The game interface where AI agents build real things)— https://github.com/pablodelucca/pixel-agents
- 核验事实(本批 web_fetch 直读仓库页):**MIT**;**7k★ / 1.1k forks / 128 commits / 5 releases**,latest **v1.3.0(2026-04-14)→ 活跃**;**TypeScript 72.4% / HTML 25.7%**。形态:**VS Code 扩展**(也发 Open VSX),把多智能体 AI(当前接 Claude Code)变成一间像素办公室。关键设计:**① 一 agent 一角色**——每个 Claude Code 终端一个动画角色;**② 实时活动追踪**——角色按 agent 实际在做什么动画(写文件=打字、搜文件=读取、跑命令=忙),**纯观测**:它 watch Claude Code 的 JSONL transcript 文件来判断状态,**不需要改 Claude Code**;**③ 子 agent 可视化**——Task 工具派生的 sub-agent 生成为与父级相连的独立角色;**④ 等待气泡**——agent 等输入/等授权时显示气泡;**⑤ 办公室布局编辑器**——地板/墙/家具,**家具素材现已全部开源**,每件家具一个文件夹 + 一份 `manifest.json` 声明 sprites、rotation groups、state groups(on/off)、animation frames,可不动代码增删改;支持加载外部家具包目录。引擎:webview 跑一个轻量 game loop,canvas 渲染 + **BFS 寻路** + **角色状态机(idle→walk→type/read)**,整数缩放像素完美。**路线图愿景**:像玩《模拟人生》一样管理 agent,但产出是真东西——「**桌子=目录、办公室=项目、墙上 Kanban 让空闲 agent 自己领任务、点开角色看模型/分支/system prompt/历史、token 健康条**」,并要做到 platform-/agent-/theme-agnostic(适配器化)。角色基于第三方 itch 素材包(JIK-A-4 Metro City)。
- 它优秀在哪:玉兔6 横跨两件事——**控制台在编排/看护一批工位(真多智能体系统)**,以及 **Simulaid 想把这套东西做成像素办公室游戏**。pixel-agents 恰恰已经把「**把一个真实运行的多智能体系统,纯观测地渲染成一间会动的像素办公室**」这件事干得很干净:它不侵入 agent 运行时,只 tail transcript 把工具事件映射成角色动画与气泡;素材用 manifest 声明、可热插拔;愿景里的「桌子=目录/办公室=项目/墙上看板/token 健康条」几乎就是玉兔6「控制台 + 公告板 + 工位」的游戏化投影。MIT、活跃,落地面积大。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① Simulaid + 控制台监控 ← 借「tail 工位运行日志 → 驱动角色状态机(idle/walk/type/read/等授权气泡),纯观测、不改运行时」** ⭐⭐:玉兔6 工位 run / 队列本就产生结构化运行记录。可照 pixel-agents 把「读 transcript → 把工具事件(写/读/跑命令/空闲/等人审)映射成角色动画 + 气泡」做成 Simulaid 的「办公室即工位实时视图」,同时让控制台监控可读。这是本批对玉兔6 核心概念(办公室=多智能体系统的活视图)**最直接的现成蓝本**;且与上批 agentscope「typed-event 总线」互为印证——pixel-agents 正是那条事件流的**可视化前端实现**。**优势**:玉兔6 自己掌握事件源,不必像它那样逆向 JSONL 猜状态(它自己列为已知缺陷),可设计更可靠的状态信号。
  - **② 像素素材管线 ← 借家具 `manifest.json` schema(sprites + rotation/state(on/off)/animation frames;地板 PNG、墙 tileset;支持外部素材目录)** ⭐:Simulaid 素材管线可采用这套「声明式、零代码增删」的家具清单格式,家具/道具可不动引擎代码热插拔——直接接续近批 free-tex-packer / ink「内容即数据」的借鉴方向。
  - **③ Simulaid 角色行为内核 ← 借 BFS 寻路 + 角色状态机(idle→walk→type/read)+ 整数缩放像素完美渲染**:一个干净的 NPC 移动/动画内核参照。
  - **④ 信息架构 ← 借「桌子=目录、办公室=项目、墙上 Kanban 让空闲 agent 自领任务、点开角色看模型/历史、token 健康条」** 的愿景:这套几乎等同把玉兔6「控制台 + cards.json 公告板 + 工位」渲染成游戏,可作 Simulaid 产品信息架构的对照。
- 边界:它是**绑 Claude Code JSONL 格式的 VS Code 扩展 + React/Canvas webview**;玉兔6(Simulaid=Unity、控制台=native)**不接其 runtime**,**只借「观测式驱动 + 素材 manifest schema + 状态机设计」并在 Unity/native 重实现**。代码 MIT 可放心读借;**但角色美术来自第三方 itch 素材包(JIK-A-4 Metro City),复用美术前须单独核其授权**;家具/地板/墙素材随仓库开源(MIT)。
- 难度:中(借观测式驱动 + 素材 schema + 状态机,在 Unity/native 重实现)。优先级:**高**(玉兔6「agents-as-office」核心概念**最直接**的现成实现;观测式驱动 + 素材清单两点都可具体落地;MIT、7k★、活跃)。

### 2. dandacompany/deskrpg — 一间可自托管的 2D 像素办公室:LPC 角色 + 多人实时走动,**雇 AI NPC 同事、派任务、任务板(待/进/中断/完成)、NPC 走过来当面汇报、专门的 AI 会议室(带会议纪要)**;npx 一键起、SQLite 单机即可
- 名称/URL:dandacompany/deskrpg(2D pixel art multiplayer virtual office game)— https://github.com/dandacompany/deskrpg
- 核验事实(本批 web_fetch 直读仓库页):**⚠️ 自定义 license**(GitHub 侧栏仅显示「View license」,非标准 SPDX,见 `LICENSE.md`,采纳前必须人工核);**15★ / 17 forks / 257 commits / 9 releases**,latest **v0.2.3(2026-04-02)→ 活跃但早期(v0.2.x)**;**TypeScript 91.3%**(Next.js + Drizzle ORM)。形态:**可自托管的像素办公室**——创建 LPC 角色、进共享频道、地图上多人实时走动;**雇 AI NPC 同事**(经 OpenClaw 网关接 agent)、在世界里跟它对话;**派任务并跟踪**(任务状态 `待机/进行中/中断/完成`,可自动或手动 nudge NPC 续跑);**重要汇报由 NPC 走到玩家面前当面送达**;**专门的 AI 会议室**(频道范围、经 OpenClaw 编排、会议纪要存档可查);**浏览器地图编辑器**(Tiled 风格,是一个主子系统)。部署:`npx deskrpg init/start`,状态落在 `~/.deskrpg/`(含 `deskrpg.db` **SQLite**),也支持 Postgres / Docker。注:默认办公室地块与物件贴图为**运行时代码生成**(零素材冷启动)。
- 它优秀在哪:它是一个**端到端的产品参照**,几乎就是 Simulaid 想成为的样子——一间像素办公室里「AI 同事领任务、在世界里当面汇报、开 AI 会议」。两个细节尤其有产品味:**(a) 汇报由 NPC 走到玩家面前送达**(把「任务完成」做成有空间感的事件),**(b) AI 会议室带纪要**。而 **SQLite + `npx init/start` 单机形态**与玉兔6「单机零依赖」红线同频,运行时生成默认贴图也是个聪明的零素材冷启动法。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① Simulaid 产品形态 ← 借整条闭环:雇 NPC → 派任务 → 任务板(待/进/中断/完成)→ nudge 续跑 → NPC 当面汇报 → AI 会议室(带纪要)** ⭐:这是 Simulaid「AI 同事」层一份现成的 UX 规格,把玉兔6 的「工位 + cards.json 公告板」映射成一间可玩的办公室。
  - **② 控制台任务板语义 ← 借任务生命周期(待机/进行中/中断/完成)+「nudge 中断任务续跑」**:为近批 queue-crash-recovery / durable-execution 的可靠执行借鉴**补上一层面向用户的任务状态词表 + 「唤醒卡住的活」交互**。
  - **③ 单机零依赖形态 ← 借「npx init/start + `~/.deskrpg/` 下 SQLite,可选 Postgres」**:又一个「单进程 + SQLite」的同形存在证明(呼应 resonate/obelisk 借鉴);其「默认贴图运行时生成」也可借为 Simulaid 的零素材冷启动思路。
- 边界:**⚠️ 三条黄旗**——(a)**早期/小体量**(15★、v0.2.3);(b)**自定义 license**(非标准 SPDX,GitHub 仅「View license」,**借任何代码/素材前必须读 `LICENSE.md` 核实**;LPC 美术另有独立 credits/license);(c)AI 能力**硬依赖 OpenClaw 网关** + Next.js/Drizzle 栈(非玉兔6 栈)。→ **只借「产品形态 + 任务状态词表 + 当面汇报/会议室 UX」,不接代码/栈**,作设计参照而非依赖。
- 难度:低-中(借 UX / 数据模型范式)。优先级:**中**(极好的 Simulaid 产品参照,但早期 + 自定义 license + 重栈 → 参考,不采纳)。

### 3. InfiXAI/InfiGUI-G1 — GUI grounding 把难点点名:不止「点得准(spatial)」,更是「点对那个**功能正确**的元素(semantic)」;用 **AEPO**(多候选生成 + 自适应探索奖励)突破 RLVR 的「置信陷阱」,在 ScreenSpot-Pro/UI-Vision 等取得开源 SOTA
- 名称/URL:InfiXAI/InfiGUI-G1([AAAI 2026 Oral] Advancing GUI Grounding with Adaptive Exploration Policy Optimization)— https://github.com/InfiXAI/InfiGUI-G1
- 核验事实(本批 web_fetch 直读仓库页):**Apache-2.0**;**144★ / 14 forks / 20 commits**;**Python 99.8%**;模型 **InfiGUI-G1-3B / 7B 已上 Hugging Face**(基于 Qwen2.5-VL,训练框架 VERL,推理 vLLM,论文 arXiv:2508.05731,**AAAI 2026 Oral**)。核心:GUI grounding 要同时做对**空间对齐 spatial**(定位准)与**语义对齐 semantic**(选到功能正确的元素);现有 RLVR 方法提升了 spatial,却卡在「**置信陷阱**」——对难语义关联探索不足。**AEPO(Adaptive Exploration Policy Optimization)**= **一次前向生成多个候选动作(multi-answer generation)** + **自适应探索奖励 AER**(由效率第一性原理 η=U/C 导出),动态平衡探索/利用,突破语义对齐瓶颈。结果:在 **ScreenSpot-Pro / ScreenSpot-V2 / UI-Vision / MMBench-GUI / UI-I2E-Bench** 取得同尺寸开源 SOTA,尤其在**图标类**与**隐式指令(implicit instruction)**上提升明显。
- 它优秀在哪:它精准点出了玉兔6 GUI/a11y grounding 工作的真正难点——不是「像素在哪」,而是「**对一句隐式指令,哪个元素才是功能正确的那个**」(图标、抽象符号)。而「**先生成多个候选、再验证/排序**」而非「一锤子点击」的思路,可独立于具体模型,直接迁到玉兔6 的 grounding **评测设计**与**动作提议**层。Apache-2.0,概念价值高。
- 玉兔6 可借鉴(具体到「借它的 X 改我们的 Y」):
  - **① GUI grounding 能力/评测 ← 借「spatial vs semantic 二分 + 多候选生成后验证/排序(而非一锤点击)」** ⭐:玉兔6 已有 `a11y-grounding-readonly-eval` 工作。可借此二分,把评测拆成 *spatial*(坐标准度)与 *semantic*(隐式指令下选对功能元素),并在动作层试「**出 N 个候选 + 一步验证**」而非只信单个最优——在图标/歧义目标上更稳。
  - **② grounding 评测集设计 ← 借其 benchmark 菜单(ScreenSpot-Pro/V2、UI-Vision、MMBench-GUI、**UI-I2E-Bench 隐式指令**)**:一份现成的「该测什么」清单,尤其强调**隐式指令**这一真实办公 UI 的关键失败模式。
  - **③ 能力边界判断 ← 借「置信陷阱」教训**:一个 spatial 很准的模型仍可能 semantic 高置信地点错 → 玉兔6 不应只用「点击坐标准度」一个指标把关,应加语义正确性检查 / 对低边际多候选触发 human-gate(接 a11y-grounding 评测 + human-gate 线)。
- 边界:它是**研究模型 + RL 训练 recipe**(Qwen2.5-VL + VERL + vLLM,多卡 H800),玉兔6 **不训练/不自托管**。**只借「概念二分 + 评测设计 + 多候选思路」,不接权重/runtime**。Apache-2.0(代码)+ HF 开放权重;此处价值在概念。若日后确需端侧 grounder,3B 模型可作候选评估,但属另一项更重的决策。
- 难度:低(借二分/评测设计)— 高(真要跑/托管模型)。优先级:**中**(当下低成本即可磨利 grounding 评测;模型采纳是另一桩更重的决定)。

### 本批小结(给 CEO 的一句话借鉴)
- **pablodelucca/pixel-agents**:学它「**tail agent 自身 transcript → 纯观测地驱动办公室角色状态(打字/读取/等待)+ 家具 `manifest.json` 模块化素材**」——把 Simulaid 做成「工位实时视图」、把控制台监控做可读的**最直接蓝本**;MIT、7k★、活跃,借范式 + 素材 schema 在 Unity/native 重实现。
- **dandacompany/deskrpg**:学它整条「**雇 NPC → 任务板(待/进/中断/完成)→ nudge 续跑 → NPC 当面汇报 → AI 会议室**」产品闭环 + **SQLite 单机形态**做 Simulaid;但**早期 + 自定义 license + OpenClaw/Next.js 重栈** → 仅作设计参照。
- **InfiXAI/InfiGUI-G1**:学它「**区分 spatial / semantic grounding + 多候选后验证(而非一锤点击)**」磨利玉兔6 a11y/GUI-grounding 评测;Apache-2.0 研究模型 → 借二分/评测,不接权重。
- **本批不新增待办卡**(延续近批克制口径)。理由:三例最值钱的落地——**pixel-agents 的「观测式办公室视图」属 Simulaid/控制台产品+架构取舍、deskrpg 的产品闭环属 Simulaid 产品决策、InfiGUI-G1 的评测二分属 grounding 评测演进**——均为方向/设计取舍,非「明确值得立刻做」的原子动作,应由产品/主管评估。**若想立刻、最小、最可逆地动一步**:① Simulaid/控制台——写一页设计草稿,把「工位 run 事件 → 角色状态(idle/walk/type/read/等授权)」按 pixel-agents 的观测式循环映射出来(零运行时改动);② 像素素材——参照 pixel-agents 起草一份 Simulaid 家具 `manifest.json` schema(sprites + rotation/state/animation groups);③ grounding——在 `a11y-grounding-readonly-eval` 文档里补「semantic vs spatial」拆分 + 一个「隐式指令」子集(纯评测设计编辑)。**Starlaid 全程排除。**

> watch(本批 web_fetch 直读元数据;HEAD commit SHA 因代理 git ls-remote 受限未取,待网络可达回填):pablodelucca/pixel-agents `main`(**MIT → watch=true**,关注其「agent-agnostic 适配器」架构 + 墙上 Kanban / token 健康条路线图——几乎是玉兔6 控制台+公告板的游戏化镜像,7k★、v1.3.0 2026-04)、dandacompany/deskrpg `master`(**自定义 license → watch=true 但受 license 限制**,关注任务板/当面汇报/会议室 UX + SQLite 运行时,**任何代码/素材复用前先核 `LICENSE.md`**,15★、v0.2.3 2026-04)、InfiXAI/InfiGUI-G1 `main`(**Apache-2.0 → watch=true**,关注 AEPO + 3B 模型作端侧 grounder 候选 + UI-I2E 隐式指令结果,144★)。另挂三个下批候选 watch:**JIK-A-4 / Metro City 角色包(itch)**(pixel-agents 的角色素材源,供 Simulaid 美术授权评估)、**ServiceNow/ui-vision**(grounding 评测集)、**volcengine/verl**(InfiGUI-G1 用的 RL 训练 recipe,若日后评估端侧 grounder 时参考)。



<!-- insight-scout-run:cr-1782547238030-insight-scout-repos-20260627-16 -->
## 2026-06-27 · 自动洞察(20260627-16 · agent-tools-skills)

> 来源:洞察员; run=cr-1782547238030-insight-scout-repos-20260627-16; queue=insight-scout/insight-scout-repos-20260627-16; network=available

## AI agent 工具 / skills / 能力库治理(slot 20260627-16)\n说明:已比对 board/insights/seen-repos.json、borrowed-libs.md、insights.md;本轮 3 个 URL 未出现;联网只读 GitHub README/LICENSE,不登录、不安装、不记录实时 star/commit/release。\n### agentsmd/agents.md\n- 是什么:AGENTS.md 的公开格式仓库,把项目给 coding agent 的上下文放在稳定、可预期的位置。\n- 值得借鉴:控制台可用根 AGENTS.md 做“只读入口”,再指向 skills、modules、insights 热区和禁区边界,减少每次广搜。\n- 迁移边界/许可证不确定项:MIT 已核;它解决“常驻说明”,不替代 SKILL.md 的按需加载。\n- URL: https://github.com/agentsmd/agents.md\n### github/awesome-copilot\n- 是什么:GitHub 官方社区库,按 agents、instructions、skills、plugins、hooks、workflows 分层管理 Copilot 扩展资产。\n- 值得借鉴:资源目录 + llms.txt + 贡献质量门,适合控制台把能力库从“文件堆”整理成可搜索、可审核的目录。\n- 迁移边界/许可证不确定项:MIT 已核;社区内容需逐项检查,只借分类和 intake/quality gate 方法。\n- URL: https://github.com/github/awesome-copilot\n### microsoft/apm\n- 是什么:Microsoft Agent Package Manager,用 apm.yml、lockfile、policy 管理 agent instructions、skills、hooks、MCP 等依赖。\n- 值得借鉴:manifest+lockfile+policy/audit 把能力来源、版本、完整性、允许来源和权限边界变成机制,正适合控制台能力治理。\n- 迁移边界/许可证不确定项:MIT 已核,另有 Microsoft/第三方商标边界;本轮只借治理模型,不安装 CLI、不接其运行时。\n- URL: https://github.com/microsoft/apm



<!-- insight-scout-run:cr-1782561638721-insight-scout-repos-20260627-20 -->
## 2026-06-27 · 自动洞察(20260627-20 · llm-gateway)

> 来源:洞察员; run=cr-1782561638721-insight-scout-repos-20260627-20; queue=insight-scout/insight-scout-repos-20260627-20; network=available

## LLM 网关 / 成本质量路由 / 可观测(slot=20260627-20)

> network_status=available;已比对 seen-repos.json、borrowed-libs.md、insights.md,本轮 3 个 URL 未出现;LiteLLM/Portkey/Langfuse/Helicone/RouteLLM/TensorZero/Envoy 等已入库,不重复推荐。

### Arize-ai/phoenix
- 是什么:AI 可观测与评估平台,覆盖 OpenTelemetry tracing、eval、dataset/experiment、prompt 管理。
- 值得借鉴:先借 OTLP/OpenInference trace 与 eval score 口径,把一次 LLM 调用的成本、延迟、质量和上下文连成可追踪记录。
- 迁移边界/许可证不确定项:许可证为 Elastic License 2.0,对托管/managed service 有限制;不宜直接接入为低风险依赖,需法务/授权复核。
- URL: https://github.com/Arize-ai/phoenix

### NVIDIA-AI-Blueprints/llm-router
- 是什么:Apache-2.0 的实验性 LLM Router 蓝图,用 intent classification 或 auto-routing 在多模型间优化 cost/quality/latency。
- 值得借鉴:把“先离线评测再上线路由”做成方法,用 notebook 训练/评估路由器,比直接拍脑袋配置权重更稳。
- 迁移边界/许可证不确定项:README 明确是 experimental blueprint;依赖下游模型 key,示例日志含 prompt/路由结果,只借评测方法不接 runtime。
- URL: https://github.com/NVIDIA-AI-Blueprints/llm-router

### AgentOps-AI/agentops
- 是什么:MIT 的 AI agent 监控与 DevTool,提供 session replay、LLM cost tracking、benchmarking 与自托管 app。
- 值得借鉴:session/agent/operation/workflow span 命名适合映射到控制台 task/agent/tool step,可先统一日志 schema 再谈可视化。
- 迁移边界/许可证不确定项:快速开始依赖 SaaS API key,虽有 self-host 路径;本轮不登录不取 token,只借 trace/cost 字段设计。
- URL: https://github.com/AgentOps-AI/agentops

### 组合判断
- 建议 CEO 只批准“离线评测+schema 设计”PoC:AgentOps 式 span、Phoenix 式 eval/trace、NVIDIA 式路由评测;不引入外部运行时。



<!-- insight-scout-run:cr-1782576039231-insight-scout-repos-20260628-00 -->
## 2026-06-28 · 自动洞察(20260628-00 · gui-grounding)

> 来源:洞察员; run=cr-1782576039231-insight-scout-repos-20260628-00; queue=insight-scout/insight-scout-repos-20260628-00; network=available

## GUI grounding / computer-use / a11y 借鉴扫描(slot 20260628-00)

说明:network_status=available;已比对 seen-repos.json、borrowed-libs.md、insights.md,本轮 3 个 URL 未出现。联网只读 GitHub README/LICENSE/API;不登录、不安装、不记录 token;常见已入库仓库不重复。

### QwenLM/open-computer-use
- 是什么:MIT 的 MCP computer-use 服务,用无障碍 API 控制 macOS/Linux/Windows,输出 app state、元素索引与截图。
- 值得借鉴:控制台可借“a11y tree 为主、截图随动作回传”的工具契约,把权限 doctor、post-action screenshot、连续调用复用 element_index 写进 PoC 清单。
- 迁移边界/许可证不确定项:MIT 已核;实际使用需 npm/系统权限/屏幕录制授权,洞察员不安装不授权。
- URL: https://github.com/QwenLM/open-computer-use

### microsoft/WindowsAgentArena
- 是什么:MIT 的 Windows 桌面 agent 评测平台,提供 Windows VM、任务调度、结果展示与本地/云并行评测。
- 值得借鉴:其 Navi 配置明确支持 vision、a11y、mixed 三档,且推荐“视觉解析 + UIA a11y”混合,可作控制台双通道评测矩阵。
- 迁移边界/许可证不确定项:MIT 已核;运行需要 Docker、Windows 11 ISO、API/Azure key 和大镜像,只借评测拓扑不接运行时。
- URL: https://github.com/microsoft/WindowsAgentArena

### uivision/UI-Vision
- 是什么:桌面 computer-use 离线基准,覆盖 83 个应用,任务拆成 Element Grounding、Layout Grounding、Action Prediction。
- 值得借鉴:把“找元素、估布局、预测动作”分开打分,适合控制台 a11y-grounding-readonly-eval 扩展成分层指标。
- 迁移边界/许可证不确定项:README 称 license-permissive,但 GitHub license API 未检出 LICENSE;采纳数据/代码前需人工核授权。
- URL: https://github.com/uivision/UI-Vision

### 行动判断
- 不新增公告板卡:三例是评测/工具契约对照材料,应并入既有 GUI grounding PoC/评测设计,不是新的 CEO 原子决策。



<!-- insight-scout-run:run-20260627T1605Z-insight-scout-repos -->
## 2026-06-28 · 自动洞察(run-20260627T1605Z · 多智能体编排:agent-workforce 协调(git-native 协议 / MCP 协调协议 / workforce 平台))

> 来源:洞察员;run=run-20260627T1605Z-insight-scout-repos(UTC 2026-06-27T16:05Z = 北京时间 06-28 00:05;定时自动运行,引擎未下发 cr- 编号,用时间戳 run id);network=available(WebSearch + web_fetch 直读 GitHub 仓库页核验,star/license/release 为实时口径,人工复核为准)。
>
> 选题轮换:最近 5 个批次集中在 GUI grounding(20260628-00 / 0405Z)、LLM 网关(20260627-20)、agent 工具/skills(20260627-16)、任务队列/durable execution(1205Z)、像素办公室/Simulaid(0405Z)。**多智能体编排** 是玉兔6 最核心、却已最久未做主题的一题(上次成批约在 06-27 00 时附近)。本轮轮回到此,但**刻意避开已 seen 的通用框架族**(crewAI / langgraph / autogen / openai-agents / google-adk / semantic-kernel / metagpt / camel / agno / mastra / pydantic-ai / smolagents / agency-swarm / agentscope / dapr-agents / strands / openagents / claude-code-by-agents / cli-agent-orchestrator / ComposioHQ-agent-orchestrator …),改攻一个**对玉兔6 更对口的子赛道:「agent 工作流协调 / agents-as-workforce」**——即「一群 agent(工位)如何认领任务、避免互踩、交接上下文、汇总状态」的协调层。本轮三例恰好是**同一问题的三种重量**(git-only 协议 → MCP 协调协议 → 完整 workforce 平台),正对玉兔6「控制台 + 文件队列 + cards.json 公告板 + 工位 + 人力资源/董事会层级」。
>
> 去重:已比对 seen-repos.json(234 个 URL,本轮 +3 = 237)+ borrowed-libs.md;本轮三例(farol-team/gnap、phuryn/swarm-protocol、AgentsMesh/AgentsMesh)**均未出现在去重热库**。**Starlaid / 星桥 全程排除**(三例均不涉及)。

### 1. farol-team/gnap — 「只用 git 协调一群 AI agent」:零服务器、零数据库,整个协议就是 `.gnap/` 里的四个 JSON 实体(agents / tasks / runs / messages)+ 心跳循环;git history 即审计日志——几乎是把玉兔6 现有「git 工作区 + 文件队列 + cards.json 公告板」抽象成了一份可对照的协议规范
- ① 名称 / URL:farol-team/gnap(GNAP — Git-Native Agent Protocol,RFC Draft;副标题「coordinate AI agents with just git. No servers. No databases. No vendor lock-in.」)— https://github.com/farol-team/gnap
- 核验(web_fetch 直读):**MIT** · **66★ / 5 forks / 24 commits** · **无 release(它是协议规范 / RFC 草案,非运行库)** · 在 Farol Labs 生产用(4 个 agent:2 AI + 2 人,共享 50+ 任务)。
- ② 优秀在哪:它把「多 agent 协作」收敛到**一个目录 + 四个实体**,不引入任何 broker/DB/server:
  - `.gnap/version`(协议版本)、`agents.json`(团队:每个成员有 `id/name/role/type(ai|human)/status`,可选 `reports_to` 构成**组织树**、`heartbeat_sec` 轮询间隔、`capabilities`)、`tasks/*.json`(工作项,带**状态机** `backlog→ready→in_progress→review→done`,以及 `blocked→ready`、`review→in_progress`(评审驳回)反向边,字段含 `assigned_to/priority/parent(子任务)/reviewer/blocked_reason/comments`)、`runs/*.json`(**一次任务可有多次 run**,`run = {task, agent, attempt, state, started/finished, tokens, cost_usd, result, error, commits[], artifacts[]}`;**失败的 run 不让任务失败**,可再开一次 run)、`messages/*.json`(agent 间通信,`from/to[]/type(directive|status|request|info|alert)/channel/thread`,`["*"]`=广播)。
  - 运行模型 = **心跳循环**:`git pull → 读 agents.json(我 active 吗)→ 读 tasks(派给我的)→ 读 messages → 干活 → commit → push → sleep`。**git history 就是审计日志**;一致性 = 最终一致(以心跳为界),冲突走标准 git merge + rebase 重推。分层清晰:`Git(传输+存储)→ GNAP 协议(四实体)→ 应用层(预算/看板/工作流/治理,显式声明「不属于协议」)`。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **控制台 / 公告板 / 队列 数据模型 ← 借「tasks / runs / agents / messages 四实体 + task 状态机 + 子任务 parent + reviewer 反向边」** ⭐⭐:玉兔6 已有 git 工作区 + 文件队列 + `cards.json`(todo/doing/done)。GNAP 几乎是给这套东西写了一份**外部对照规范**——尤其它的 task 状态机比 todo/doing/done 多了 `ready / review / blocked(+reason)` 与「评审驳回回退」,可直接补强玉兔6 卡片生命周期;`parent` 子任务、`reviewer`、`comments` 也都是现成字段表。
  - **engine-runner 可靠执行 / 成本审计 ← 借「run = 任务的一次 attempt(含 tokens/cost_usd/commits/artifacts/error);一任务多 run;失败 run 不失败任务」** ⭐⭐:这正是玉兔6 近批(absurd / durable-execution / queue-crash-recovery)在找的语义的**落盘 schema 版**——把「工位每次执行」记成独立 run 文件,天然得到**重试历史、成本汇总(预算=Σrun.cost)、审计(谁/何时/花多少)、agent 横比**;与 retry/replay/fork 三分互补(GNAP 给的是「attempt 记录怎么存」)。
  - **人力资源 / 董事会层级 ← 借「agents.json 的 `reports_to` 构成组织树 + `type:ai|human` 人机同为一等公民 + `status:active/paused/terminated`」** ⭐:与玉兔6「人力资源部 / 董事会」设计同构,可作工位花名册的最小 schema。
  - **单机零依赖红线 ← 借「零 server / 零 DB / 仅 git + JSON 文件;离线可用、push 即参与」** ⭐:GNAP 的取舍(用 git 当传输与存储,而非引入 broker)与玉兔6「单机文件队列、不引运行时」**高度同频**,是一个强力的「这样做行得通」存在证明(README 还附 GNAP vs CrewAI/Paperclip/Symphony/AgentHub 的「要不要 server/DB」对比表)。
- ④ 难度低(读规范 / 对照 schema)/ 优先级高:它不是要引入的库,而是一份**与玉兔6 现状几乎 1:1 的协议对照**,借鉴成本极低、对口度极高。
- 边界:**它是协议草案、66★、无 release**——价值在「schema/语义对照」,非「拿来即用的实现」;玉兔6 不必照搬 `.gnap/` 目录名,只借**实体划分 + 状态机 + run/attempt 模型**,在现有文件队列/cards.json 上演进。MIT,可放心读借。README 示例 runtime 提到 OpenClaw/Codex/Claude Code(仅作示例,**与 Starlaid 无关**)。

### 2. phuryn/swarm-protocol — 把「多个 agent 在同一代码库上协作」做成一个 **headless MCP 协调层**(19 个 MCP 工具):claim 认领+声明文件、heartbeat 续命(**stale claim 自动标记**)、complete 后**依赖项自动解锁**、`get_context` 一次取齐交接上下文——正好补玉兔6「工位认领 / 防互踩 / 崩溃回收 / 交接契约」的协调缺口
- ① 名称 / URL:phuryn/swarm-protocol(Coordination protocol for agent-first teams. No UI. No sprints. No Jira. Just state sync.)— https://github.com/phuryn/swarm-protocol
- 核验(web_fetch 直读):**MIT** · **46★ / 7 forks / 18 commits** · 状态 **Alpha(building in public),19 个 MCP 工具已实现、集成测试通过** · **TypeScript 98.5%** · 栈 = Node + **PostgreSQL(裸 SQL 无 ORM)** + `@modelcontextprotocol/sdk`。
- ② 优秀在哪:它精准切出一个别人没做的层——**「多人 / 多会话」协调(multiplayer)**,而非「一个人开 3-5 个 agent」(single-player,它明说那是 CCPM/1Code 等解决的)。协调闭环:`get_team_status(在飞什么)→ claim_work(我接了,这是我要碰的文件)→ check_conflicts(还有谁在碰 src/api/router.ts)→ heartbeat(每 10-15 分钟续命)→ complete_claim(完成→把 intent_xyz 从 blocked 翻成 open→下一个 agent 自动接力)`。四个原语:**Intent**(`draft→open→claimed→done`,带 constraints / acceptance_criteria / 依赖链)、**Claim**(「我在做这个」+ 跟踪触碰文件 + 心跳;**stale claim 会被标记**)、**Signal**(completion/blocked/conflict 事件;completion 触发依赖项**自动解锁**)、**Context Package**(`get_context` 一次取齐:intent + 依赖 + 活跃 claims + 近期 signals + 团队约定——**把交接做成稳定输入契约**,而不是「文件变了你自己看」)。设计取舍明确:**冲突是 advisory(不加文件锁)**、v1 信任式身份、MCP 轮询(无 WebSocket)。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **engine-runner 崩溃回收 ← 借「claim + heartbeat + stale-claim 自动标记」** ⭐⭐:玉兔6 文件队列最缺的就是「工位领了活却挂了怎么回收」。swarm-protocol 的答案很干净——**领取即 claim,定期 heartbeat,心跳超时→claim 判 stale→任务可被另一工位重领**。这是把近批 durable-execution / queue-crash-recovery 的「续跑」补上**「失联检测 + 重新认领」**的一环,且是文件队列就能实现的轻机制。
  - **工位间交接 ← 借「Context Package:`get_context` 一次性装齐目标/约束/验收/依赖/活跃认领/团队约定」** ⭐⭐:玉兔6 工位交接目前偏「读文件自己拼」。借这套「**交接 = 一个结构化上下文包(稳定输入契约)**」,接手工位拿到的是确定的输入,而非「上游改了某文件」。直接对口玉兔6 的 failover / 问答通道设计。
  - **公告板依赖驱动 ← 借「Signal:完成事件触发依赖项 blocked→open 自动解锁」** ⭐:玉兔6 `cards.json` 可借此把「卡片完成 → 自动放行其下游卡片」做成事件驱动,减少人工搬卡。
  - **防互踩 ← 借「check_conflicts:声明要碰的文件,advisory 提示谁在碰」**:多工位并行写同一区域时,先查冲突再动手(玉兔6 多工位共享 `shared/` / 工作区时尤其有用)。
- ④ 难度中 / 优先级高:claim/heartbeat/stale + Context Package 直击玉兔6「崩溃回收 + 交接」两个真痛点,且语义可在文件队列上 native 实现。
- 边界:**它本体是 Postgres + MCP server**(玉兔6 是文件队列、不引 Postgres 运行时)→ 只借**协调语义(claim/heartbeat/stale/signal-unblock/context-package)**,在文件队列上重实现;Alpha / 46★ / 单 Postgres「设计给 <1000 用户」→ 价值在协议设计,非规模化产品。MIT 可读借。它定位「多人多会话」,玉兔6 是「单机多工位」,语义可借但拓扑要按玉兔6 调。

### 3. AgentsMesh/AgentsMesh — 一个完整的「AI agent 劳动力平台」:把 agent 当**远程工位(AgentPod,带 web 终端 + git worktree 隔离)**成队运行,配 **Kanban(工单↔工位绑定)+ 实时协作拓扑可视化 + 组织/团队/用户层级 + 自托管 runner**;几乎就是玉兔6「控制台 + 公告板 + 工位 + 人力资源」的产品级镜像(但 BSL 许可 + 重栈,只借架构)
- ① 名称 / URL:AgentsMesh/AgentsMesh(The AI Agent Workforce Platform — where teams scale beyond headcount.)— https://github.com/AgentsMesh/AgentsMesh
- 核验(web_fetch 直读):**⚠️ Business Source License 1.1(BSL-1.1)**——**非生产用途可用/可改;生产用需商业许可,直到 Change Date 2030-02-28 转 GPL-2.0-or-later**(采纳前必须法务核)· **2.2k★ / 218 forks / 1074 commits** · **101 个 release,latest Runner v0.41.7(2026-06-09)→ 非常活跃** · Go 48.8% / TypeScript 36.9% / Rust 6.5% · 栈 = Go(Gin+GORM)后端 + Next.js 前端 + Postgres/Redis + MinIO + gRPC/mTLS + WebSocket Relay + Bazel;**control plane / data plane 分离**。
- ② 优秀在哪:它是本批**最完整的产品级参照**,把「agents-as-workforce」做全了:**AgentPod = 远程 AI 工位**(web 终端 + **git worktree 隔离** + 实时流,多 pod 并发);**Multi-Agent Collaboration** 走 channels + pod bindings,并**实时可视化协作拓扑**;**Task Management = Kanban**,关键是「**工单 ↔ pod 绑定**」+ 进度 + MR/PR 集成;**Self-Hosted Runner**(`curl install.sh` 装个 Go 守护进程,代码不出本机)+ **BYOK**(自带 key、无用量上限);**多租户 Org>Team>User + 行级隔离**;企业向 SSO/RBAC/审计日志/air-gapped。控制面(gRPC+mTLS 下发编排)与数据面(Relay 集群转终端 I/O)分离。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **控制台产品形态 ← 借「AgentPod=工位、Kanban 工单↔工位绑定、协作拓扑实时可视化」** ⭐:这套几乎是玉兔6「控制台 + cards.json 公告板 + 工位」的成熟形态。最值得借的一点是「**工单 ↔ 工位绑定**」——玉兔6 公告板卡片可显式绑定到具体工位,状态随工位 run 实时更新;「**协作拓扑可视化**」则与 Simulaid「办公室即多智能体活视图」、控制台监控直接呼应(承接上批 pixel-agents 的「办公室视图」方向,这里给的是**企业控制台版**的拓扑图)。
  - **架构边界 ← 借「control plane / data plane 分离 + self-hosted runner(代码不出本机)+ BYOK」** ⭐:玉兔6 若日后要「编排在控制台、执行在工位/本机」,这套「控制面下发、数据面就地」的切分 + 「runner 自托管、密钥自带」与玉兔6 单机/隐私红线同向,是清晰的分层参照。
  - **组织层级 ← 借「Org > Team > User 多租户 + 行级隔离」**:与玉兔6 人力资源/董事会层级对照,作权限/归属模型参考。
- ④ 难度中-高(借产品形态/架构范式)/ 优先级中:产品镜像价值高,但**重栈 + BSL 许可**使其只能「看图学架构」,不能取代码。
- 边界:**两条黄旗**——(a)**BSL-1.1**(生产用需商业许可,2030 才转 GPL,**任何代码/资产复用前必须法务核**);(b)**重栈**(Go+Next+Postgres+Redis+MinIO+gRPC+Bazel,非玉兔6 单机文件栈)。→ **只借「工位/工单绑定/拓扑可视化/控制-数据面分离」的产品与架构范式,不接代码/栈/许可**。支持的 agent 为 Claude Code/Codex/Gemini/Aider/OpenCode(**不涉 Starlaid**)。

### 行动判断(是否加待办卡)
- 三例最值钱的借鉴都偏**架构 / schema / 范式**(GNAP 的四实体+run 模型、swarm-protocol 的 claim/heartbeat/context-package、AgentsMesh 的工位/工单绑定+控制-数据面),属「给 CEO 取舍的借鉴」,非可越过决策直接执行的原子动作 → **本轮不新增公告板待办卡,只写分析**(延续近批克制口径,符合「不是待办任务」红线)。
- 最接近「明确值得立刻做」的一步(若 CEO 认可再开卡,避免擅自堆待办):**用 GNAP 的 `.gnap/` 四实体(尤其 `runs/*.json` 的 attempt/cost/commits/artifacts 模型 + task 状态机的 ready/review/blocked)对照审视玉兔6 现有「文件队列 + cards.json」**,看是否补上 ① 卡片状态机的 `ready/review/blocked(+reason)` 与「评审驳回回退」、② 每次工位执行落一份 `run` 记录(得到重试历史 + 成本汇总 + 审计)。这与近批 absurd/durable-execution 的「step/checkpoint + retry/replay/fork」恰好互补(那批讲「怎么续跑」,GNAP 讲「执行/任务怎么落盘成可审计 schema」),且是**纯文档/schema 设计**的低风险可逆动作。再补一条 swarm-protocol 的 **claim+heartbeat+stale 回收** 作为 engine-runner failover 的具体机制候选。

### 本批小结(给 CEO 的一句话借鉴)
- **farol-team/gnap**:学它「**只用 git + 四个 JSON 实体(agents/tasks/runs/messages)协调一群 agent + run/attempt(含 cost/commits/audit)模型 + task 状态机**」——几乎是玉兔6「git 工作区 + 文件队列 + cards.json」的现成协议对照;MIT、66★、零依赖,借 schema/语义不引任何 runtime。**(本批最高对口度)**
- **phuryn/swarm-protocol**:学它「**claim + heartbeat + stale 自动回收 + Context Package(交接=稳定输入契约)+ 完成信号自动解锁依赖**」——补玉兔6「崩溃回收 + 工位交接 + 公告板依赖驱动」缺口;MIT、Alpha,借协调语义不引 Postgres。
- **AgentsMesh/AgentsMesh**:学它「**AgentPod=工位、Kanban 工单↔工位绑定、协作拓扑可视化、control/data plane 分离 + 自托管 runner + BYOK**」做控制台产品/架构参照;2.2k★、很活跃,但 **BSL-1.1 + 重栈 → 只看图学架构,不取代码**。
- **本批不新增待办卡**;最高优先借鉴点:GNAP 的 runs/task-状态机 schema + swarm-protocol 的 claim/heartbeat 回收,提请 CEO 评审后再决定是否开卡。**Starlaid 全程排除。**

> watch(本批 web_fetch 直读元数据;HEAD commit SHA 因代理 git ls-remote 受限未取,待网络可达回填):farol-team/gnap `main`(**MIT → watch=true**,关注其协议版本演进 v4→ 及「应用层(预算/看板/治理)」示例,66★、无 release)、phuryn/swarm-protocol `main`(**MIT → watch=true**,关注 SQLite 后端适配 + auth 层 + 更多 agent 适配,46★、Alpha 19 工具)、AgentsMesh/AgentsMesh `main`(**BSL-1.1 → watch=true 但受许可限制**,关注「工单↔pod 绑定 + 协作拓扑可视化」演进作控制台/Simulaid 参照,**任何代码复用前先核 LICENSE**,2.2k★、Runner v0.41.7 2026-06)。



<!-- insight-scout-run:cr-1782590439453-insight-scout-repos-20260628-04 -->
## 像素素材生成 / 控制台优秀网页设计借鉴扫描(slot=20260628-04)
说明:network_status=available;已比对 `seen-repos.json`、`borrowed-libs.md`、`insights.md`,本轮 3 个 URL 未出现;联网只读 GitHub README/LICENSE,不登录、不安装、不记录实时 star/commit/release;Starlaid/星桥 全程排除。

### PixiEditor/PixiEditor
- 是什么:跨平台 2D 图形编辑器,覆盖像素画、动画、矢量/栅格与节点式非破坏编辑。
- 值得借鉴:把图层/效果/结构统一成 node graph,再配时间轴,适合作为“生成后可调参、可回退、可导出”的工作台心智。
- 迁移边界/许可证不确定项:当前仓库 LGPL-3.0;C#/Avalonia 桌面栈,控制台只借交互与数据模型,不链接代码。
- URL: https://github.com/PixiEditor/PixiEditor

### pinkpixel-dev/gumdrop-studio
- 是什么:React/Vite/Tailwind 的像素画 Web/Tauri 应用,主打双层画布:像素层 + 平滑矢量细节层。
- 值得借鉴:双层 canvas 适合“AI 生成底稿 + 人工清线/标注/导出”的轻工作流,比完整专业编辑器更适合控制台嵌入。
- 迁移边界/许可证不确定项:Apache-2.0;项目较新,只借双层画布与导出面板模式,不依赖其成熟度。
- URL: https://github.com/pinkpixel-dev/gumdrop-studio

### supabase/supabase
- 是什么:开发者平台控制台案例,资源导航覆盖数据库、认证、API、存储、日志与设置。
- 值得借鉴:左侧资源树 + 顶部项目上下文 + 中央详情/日志/设置页,可迁移到控制台“素材生成任务、资产库、导出记录、模型设置”的信息架构。
- 迁移边界/许可证不确定项:Apache-2.0;它是重型开发者平台,只借控制台 IA 和密集后台页面组织,不引入 Supabase 栈。
- URL: https://github.com/supabase/supabase

### 行动判断
- 建议新增 1 张 CEO 候选卡:仅做“像素素材生成工作台 UI/RFC spike”,产出画布/时间轴/双层修图/资产导出四块交互基线与许可证边界,不实现、不安装依赖。



<!-- insight-scout-run:cr-1782591015851-insight-scout-repos-20260628-08 -->
## 2026-06-28 · 自动洞察(20260628-08 · 任务队列引擎 / durable execution + Unity/Simulaid)
说明:network_status=available;已比对 `seen-repos.json` / `borrowed-libs.md` / `insights.md`,本轮 3 个 URL 均为新案例(与已 seen 的 temporal/restate/inngest/dbos/conductor/obelisk/resonate/absurd/durable-execution-the-hard-way 等不重叠);联网只读 GitHub README/LICENSE,不登录、不安装、不回显密钥;实时 star/commit/release 为直读核验口径,人工复核为准;**Starlaid/星桥 全程排除**。本轮选题轮换到「任务队列引擎 / durable execution(2 例,刻意取 checkpoint vs effect-log 两种对照哲学)+ Unity/Simulaid(1 例)」,避开最近两批的 像素/网页设计(04)与 多智能体编排(1605Z)。

### 1. sayiir/sayiir — 一个「**嵌入式(库,不是平台)**」的 durable 工作流引擎,核心卖点 = **checkpoint-based recovery, NO replay, NO DSL**:每步完成即落 checkpoint,崩溃后从最后 checkpoint 续跑(而非从头重放),且无确定性约束(可调任意 API)。几乎是玉兔6「文件队列 + engine-runner 续跑」最贴脸的轻量范式参照
- ① 名称 / URL:sayiir/sayiir(Durable, fast workflow engine that feels like writing normal code — simplified alternative to Temporal/Restate/Airflow)— https://github.com/sayiir/sayiir
- 核验(web_fetch 直读):**MIT** · **46★ / 5 forks / 154 commits** · **19 releases,latest 0.4.0(2026-03-05)→ 活跃** · Rust 67.2% + 绑定(Python 经 **PyO3** / Node.js / 计划 Cloudflare Workers WASM)· 组件状态:Rust core/Python/Node 绑定/**Postgres 后端 = stable**,Cloudflare Workers = in progress,Enterprise server = planned。栈 = Rust 核心 + 可插拔 persistence(in-memory ↔ Postgres)+ 可插拔 codec(JSON ↔ rkyv 零拷贝)。
- ② 优秀在哪:它把 durable execution 做成「**装进你应用里的一个库**(`pip/npm/cargo add` 几分钟跑起来),而不是旁边再立一套平台/集群」。两个设计取舍正好戳中重型引擎的痛点:(a)**No replay overhead**——「从最后一个 checkpoint 续,而非重放整段历史」;(b)**No determinism constraints**——continuation 式执行,工作流里可以调任意 API/库,无纯函数/sandbox 约束(对比 Temporal/durable 系的「必须确定性、可重放」)。功能面其实齐全:branch/loop/fork-join/signals + **cancel/pause/resume 运行实例** + per-task retries/timeouts + **内置 OpenTelemetry tracing**。一句话:把「重型 durable」砍成「够用且零基建」。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **engine-runner 崩溃续跑 ← 借「checkpoint-after-each-task + resume-from-last-checkpoint(无 replay)」** ⭐⭐:这是玉兔6 文件队列能 **native 落地** 的 durable 模型——每个工位执行步骤完成即把结果写一份 checkpoint(`queues/<q>/<job>/ckpt-NN.json`),崩溃/重启后读最后一个 checkpoint 续跑,而不是从头重做。相比近批 absurd / durable-execution-the-hard-way 偏「step + 确定性 replay」的口径,Sayiir 的「checkpoint 续、无确定性约束」更契合玉兔6「工位要自由调 LLM/MCP/文件」的现实,代价是大状态要显式落盘。
  - **持久层抽象 ← 借「pluggable persistence backend + pluggable codec」** ⭐:把玉兔6 现有「文件队列」收敛成 **一个 backend 接口的实现**(FileQueueBackend),engine 逻辑只依赖接口;日后要加 SQLite/换格式(JSON→更紧凑)时不改 engine。这是把「文件即队列」从硬编码升级成「可替换存储」的低成本进化。
  - **工位运行控制 ← 借「cancel / pause / resume 运行中实例」** ⭐:控制台可对在飞工位下「暂停/恢复/取消」,对应到 queue/cards 的运行实例控制(目前玉兔6 偏「派了就跑到底」)。
  - **可观测 ← 借「内置 OTel:每个 workflow/task 一条 trace」**:延续近批「可观测是默认能力」,每个工位 run = 一条 trace + 子 span,直接喂控制台监控视图。
- ④ 难度中 / 优先级高:直击「engine-runner 续跑/崩溃恢复」这一**反复出现的高频痛点**,且 checkpoint 语义在文件队列上可 native 实现、可逆、低风险。
- 边界:它生产后端是 **Postgres**、核心是 **Rust 库**,玉兔6 是单机文件栈 → **只借「checkpoint-no-replay 的 durable 语义 + persistence/codec 可插拔抽象 + cancel/pause/resume 控制面」**,在文件队列上重实现,不引 Rust/Postgres runtime。仍 under active development(46★、core 标 stable),价值在范式而非规模背书;MIT 可读借。

### 2. iopsystems/durable — durable execution 的**另一种哲学**:不靠 checkpoint,而是**把每个外部副作用的结果记进 event log**;崩溃后在别的 worker 上从头重跑,但**命中日志即返回旧结果、不重做副作用**(at-least-once 外部 / exactly-once 入库)。正好补 Sayiir 缺的「重试时已花的 token / 已发的消息不要重复」幂等面
- ① 名称 / URL:iopsystems/durable(A durable execution engine for Rust)— https://github.com/iopsystems/durable
- 核验(web_fetch 直读):**Apache-2.0 + MIT 双许可** · **53★ / 1 fork / 268 commits** · **82 tags → 迭代频繁** · Rust 98.0% + PLpgSQL 1.9%。栈 = Rust worker(可 **embedded 进现有应用**)+ **Postgres**(event log / 状态)+ 工作流编译为 **WASM component(WASI 沙箱)**。
- ② 优秀在哪:它给 durable 的是**「effect-log + replay」**模型,README 讲得很透:每次外部效果(HTTP/DB/取时间/sleep)都把**结果**写进事件日志;worker 中途挂掉→换个 worker 从头跑,但这次 HTTP/now 等不再真正执行,而是**从日志读回上次结果**,于是状态收敛到「上次被杀的位置」继续。配套语义清晰:**外部效果 at-least-once、入库 exactly-once**;工作流跑在 **WASM 沙箱**里保证 replay 的确定性;worker 可嵌入应用、不是独立平台。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **engine-runner 幂等 / 防重复副作用 ← 借「external-effect event log:每个副作用记一条事件,重跑命中即读回、不重做」** ⭐⭐:这是 Sayiir checkpoint 的**互补面**。玉兔6 工位重试时最怕「重复调 LLM(白花 token)/重复发消息/重复写文件」——这套 effect-log 给出可文件化的答案:每个副作用落 `runs/<id>/events.jsonl`(类型 + 入参指纹 + 结果),replay 时同指纹命中即返回旧结果。对口近批 GNAP 的 `runs/*.json`(cost/commits/artifacts)——GNAP 讲「run 落盘成可审计 schema」,durable 讲「**副作用落盘成可重放幂等记录**」,两者拼起来就是玉兔6 engine-runner 的「可审计 + 可幂等续跑」。
  - **给 CEO 的选型对照 ← 「checkpoint(Sayiir,存状态、从最后状态续)vs effect-log replay(durable,存副作用、从头跑但跳过已记录)」** ⭐:两种 durable 哲学各有取舍——checkpoint 轻、对大状态友好但要显式落状态;effect-log 强幂等、天然审计但要求副作用可识别+可重放。**建议玉兔6 混合**:大状态走 checkpoint,关键不可逆副作用(发钱/发消息/写外部)走 effect-log 幂等。这条「取舍 + 混合」结论本身就是本批给 CEO 最值钱的一句。
  - **失败转移 ← 借「副作用已记录 → 任意 worker 可接管续跑」对照玉兔6 git-worktree 隔离 + 工位 failover**:玉兔6 已有 worktree 隔离,可补上「副作用日志 → 另一工位无缝接管」的 failover 语义(呼应近批 swarm-protocol 的 claim/heartbeat 回收)。
- ④ 难度中 / 优先级中-高:幂等是工位重试**正确性**的关键;但 effect-log 落地需先梳理「哪些工位动作是有副作用、需幂等」的边界,比 checkpoint 略重。
- 边界:Rust + **WASM component(WASI)+ Postgres**,重栈;玉兔6 **只借「effect-log 幂等模型 + 失败转移语义 + at-least-once/exactly-once 的边界划分」**,不引 WASM/Postgres/Rust runtime。53★ 体量小,价值在模型清晰度;Apache-2.0/MIT 读借友好。

### 3. cheliotk/unity_abm_framework(ABMU)— 一个为 Unity3D 做的**Agent-Based Modelling 框架**,核心是一套**时间步调度器(scheduler)**:开发者只写 agent 行为,框架按 timestep 统一调度执行,并复用 Unity 的 Physics/NavMesh/Animation。正好是 Simulaid「办公室即多智能体活视图」最缺的**调度内核**层
- ① 名称 / URL:cheliotk/unity_abm_framework(An Agent-Based Modelling (ABM) Framework for Unity3D,简称 ABMU)— https://github.com/cheliotk/unity_abm_framework
- 核验(web_fetch 直读):**MIT** · **51★ / 12 forks / 76 commits** · **无 release**(以源码/`abm_framework.unitypackage` 分发)· **C# 98.9%** · 学术背书:Cheliotis, K. (2021) *ABMU: An Agent-Based Modelling Framework for Unity3D*, SoftwareX 15:100771 · 以 Unity 2018.3 验证(README 称新旧版本大概也能跑)。
- ② 优秀在哪:它把「**模拟一群 agent**」在 Unity 里做成了规范结构——**幕后一套 scheduler** 负责「在正确的 timestep 执行各 agent 的 behaviours」,开发者只需把写好的 Unity 方法用简单 hooks 注册成 ABMU behaviour,**不用自己在各处 Update() 里手搓时序**。并且刻意复用 Unity 原生能力(Physics、**NavMesh 导航/寻路**、Animation)。附 6 个经典示例:随机游走、**邻居感知(按邻居数改速度/大小)**、Reynolds **Boids**、Schelling **隔离模型**、Epstein-Axtell **Sugarscape**、**室内多层 3D NavMesh 导航**——从「群体行为」到「空间寻路」都有现成范式。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **Simulaid 调度内核 ← 借「scheduler 统一按 timestep 驱动所有 agent behaviours(行为与调度解耦)」** ⭐⭐:Simulaid「办公室活视图」最该有的内核就是一个**时间步调度器**——每个 tick 推进所有工位/角色的行为,而不是每个角色各写各的 Update()。ABMU 的「注册 behaviour → 框架按 step 调度」正是这层抽象,能让 Simulaid 的角色动画/移动/状态更新统一、可控、可暂停(也与上面 Sayiir 的 pause/resume 在心智上一致:把"推进"变成显式 step)。
  - **办公室空间行为 ← 借「Boids / 邻居感知 / 3D NavMesh 导航 示例」做角色在办公室的走动·聚集·避让·寻路** ⭐:Simulaid 里角色去工位、聚到白板、互相避让,可直接照 ABMU 的 boids + neighbour-detection + NavMesh 范式实现,**复用 Unity NavMesh**,不必从零写寻路。
  - **状态→视觉映射 ← 借「agent 属性驱动视觉变化(示例按邻居数改速度/大小)」**:把工位**真实状态**(忙/闲/阻塞/错误/等待认领)映射成角色视觉(颜色/速度/大小/动画/聚散),即「**数据驱动的活视图**」。承接近批 pixel-agents 的「办公室视图」与 AgentsMesh 的「协作拓扑可视化」方向——那两个给的是产品/拓扑层,ABMU 补的是**底层 ABM 调度+空间行为内核**。
- ④ 难度中 / 优先级中:Simulaid 内核范式价值高(把"活视图"从特效升级成"可调度的模拟"),但需在**现代 Unity 适配**(原仓基于 2018.3、无 release、76 commits 的学术项目),非紧急主线。
- 边界:Unity 老版本验证 + 无 release + 学术体量 → **只借 scheduler/ABM 范式与示例算法,不直接吃 unitypackage**(需现代 Unity 重验);C#/Unity 栈本就是 Simulaid 的栈,迁移摩擦小;MIT 可读借。**Simulaid 相关全程不涉 Starlaid/星桥**。

### 行动判断(是否加待办卡)
- 三例最值钱的借鉴均偏**架构 / schema / 范式**:Sayiir 的 checkpoint-no-replay durable 模型、durable 的 effect-log 幂等模型、ABMU 的 timestep scheduler——属「给 CEO 取舍的借鉴」,而非可越过决策直接执行的原子动作。延续近批克制口径与「不是待办任务」红线 → **本轮不新增公告板待办卡,只写分析**。
- 最接近「明确值得立刻做」的一步(若 CEO 认可再开卡,避免擅自堆待办):**做一份「engine-runner durable 选型 spike(纯文档/RFC)」**——并排比较 ① Sayiir 式 checkpoint(`queues/<q>/<job>/ckpt-NN.json` + resume-from-last)与 ② durable 式 effect-log(`runs/<id>/events.jsonl` + 命中即读回),给出**混合方案建议**(大状态 checkpoint + 关键副作用 effect-log)与最小文件 schema。这是**纯文档、低风险、可逆**的一步,且与近批 absurd/durable-execution(怎么续跑)、GNAP(run 落盘成可审计 schema)、swarm-protocol(claim/heartbeat 失联回收)正好拼成 engine-runner 的「可审计 + 可幂等 + 可回收」完整拼图。

### 本批小结(给 CEO 的一句话借鉴)
- **sayiir/sayiir**:学它「**checkpoint 续跑、无 replay、无 DSL、嵌入式库零基建** + 可插拔 persistence/codec + cancel/pause/resume + 内置 OTel」——是玉兔6「文件队列 + engine-runner 续跑」最贴脸的轻量 durable 范式;MIT、46★、v0.4.0,借语义不引 Rust/Postgres。**(本批最高对口度)**
- **iopsystems/durable**:学它「**effect-log + replay 幂等**(副作用记日志、重跑命中即读回,at-least-once 外部 / exactly-once 入库)」——补玉兔6 工位重试「不要重复花 token/发消息/写文件」的幂等缺口,与 Sayiir 的 checkpoint 互补;Apache-2.0/MIT、53★,借模型不引 WASM/Postgres。
- **cheliotk/unity_abm_framework(ABMU)**:学它「**timestep scheduler 统一驱动 agent 行为 + Boids/邻居感知/NavMesh 空间行为 + agent 属性驱动视觉**」做 Simulaid 的调度内核与办公室空间行为;MIT、51★、学术(SoftwareX 2021),借范式需现代 Unity 适配。
- **本批不新增待办卡**;最高优先借鉴点 = engine-runner 的 durable 选型(checkpoint vs effect-log,建议混合),提请 CEO 评审后再决定是否开 spike 卡。**Starlaid/星桥 全程排除。**

> watch(本批 web_fetch 直读元数据;HEAD commit SHA 因代理 git ls-remote 受限未取,待网络可达回填):sayiir/sayiir `main`(**MIT → watch=true**,关注 Cloudflare Workers WASM 后端 + Enterprise server 演进 + persistence backend 列表,46★、v0.4.0 2026-03)、iopsystems/durable `main`(**Apache-2.0/MIT → watch=true**,关注 effect-log/WASI 模型与非 Postgres 后端可能性,53★、82 tags)、cheliotk/unity_abm_framework `main`(**MIT → watch=true 但低频**,关注是否有现代 Unity 适配/release,51★、学术项目无 release)。



<!-- insight-scout-run:cr-1782604840017-insight-scout-repos-20260628-08 -->
## 2026-06-28 · 自动洞察(20260628-08 · unity-simulaid-methods)

> 来源:洞察员; run=cr-1782604840017-insight-scout-repos-20260628-08; queue=insight-scout/insight-scout-repos-20260628-08; network=available

## Unity/团结工作流方法论泛化借鉴(slot=20260628-08)
- network_status=available:已联网核对公开 GitHub 页面;已比对本地 seen-repos/borrowed-libs/insights 热区,本轮 3 个 URL 未在去重热库出现。Simulaid 仅作泛化方法映射,不触碰项目;Starlaid/星桥 全程排除。
### Unity-Technologies/UnityCsReference
- 是什么:Unity C# 引擎/编辑器参考源码,当前页面标注为 Unity 6000.7.0a1 reference source。
- 值得借鉴:把复杂生命周期、Editor API、序列化等疑难判断改成“按目标 Unity/团结版本读参考源码再下结论”的工作流。
- 迁移边界/许可证不确定项:Unity Reference Only,只可参考;不得修改、复制或再分发源码,不能把代码搬入项目。
- URL: https://github.com/Unity-Technologies/UnityCsReference
### Unity-Technologies/com.unity.multiplayer.samples.coop
- 是什么:Unity 官方 Boss Room 协作 RPG 示例,展示 Netcode 游戏流、RPC、延迟遮蔽动画、UGS 会话/认证等模式。
- 值得借鉴:它把完整 vertical slice、domain assemblies、Utilities package、Local/Internet 多人测试路径和 main/develop git-flow 写成可复用样板。
- 迁移边界/许可证不确定项:Unity Companion License;UGS 相关步骤需 Unity Dashboard 组织/账号,本轮不登录不授权;只借流程组织与测试方法。
- URL: https://github.com/Unity-Technologies/com.unity.multiplayer.samples.coop
### Unity-Technologies/UIToolkitUnityRoyaleRuntimeDemo
- 是什么:Unity 官方 Runtime UI Toolkit 示例,用 UXML/USS、UI Builder、UIDocument、PanelSettings 展示运行时 UI。
- 值得借鉴:运行时 UI 资产化、布局/样式分离、PanelSettings 缩放和 Addressables 构建前置门禁,适合沉淀 UI 工作流检查项。
- 迁移边界/许可证不确定项:MIT;项目测试版本较旧且无 release,只作小样例参考,不作为新 UI 架构基线。
- URL: https://github.com/Unity-Technologies/UIToolkitUnityRoyaleRuntimeDemo
### 判断
- 本轮不生成公告板卡:三例都是工作流/检查清单级方法,还需要主管按实际 Unity/团结版本和模块窗口取舍,未形成可直接执行的低风险原子行动。



<!-- insight-scout-run:run-20260628T001316Z-insight-scout-repos -->
## 2026-06-28 · 自动洞察(run-20260628T001316Z · AI agent 工具与 skills:skills 生命周期工具链(自生长运行时 / A-B 评测 / 质量门))

> 来源:洞察员;run=run-20260628T001316Z-insight-scout-repos(UTC 2026-06-28T00:13Z = 北京时间 08:13;定时自动运行,引擎未下发 cr- 编号,用时间戳 run id);network=available(WebSearch + web_fetch 直读 GitHub 仓库页核验,star/license/release 为实时口径,人工复核为准)。
>
> 选题轮换:最近 6 个批次 = 多智能体编排(run-20260627T1605Z·agent-workforce,北京 0005)、像素素材/网页设计(20260628-04)、任务队列/durable + Unity/Simulaid(20260628-08 两批)、GUI grounding(20260628-00)、LLM 网关(20260627-20)。**AI agent 工具与 skills** 是最久未做的一题(上次成批 20260627-16,约 16h 前),本轮轮回到此。但**刻意避开已 seen 的 skills 目录 / 市场 / 注册表 / 框架族**(anthropics-skills / microsoft-skills / VoltAgent-awesome-agent-skills / agentsmd / awesome-copilot / microsoft-apm / tech-leads-club-agent-skills / agent-skills-hub / SkillSpector / agentskills / toolsdk-mcp-registry / awesome-mcp-registry / modelcontextprotocol-registry / toolhive / mcp-context-forge / fastmcp / composio / arcade-mcp …),改攻一个**更对口玉兔6 的子赛道:「skills 的生命周期工具链」**——即一个 SKILL 从「生长出来 → 被度量是否真有用 → 过质量门才入库」的三段闭环。本轮三例恰好对应这三段(自生长运行时 → with/without A-B 评测 → 结构+密度+LLM 评分质量门),正对玉兔6「控制台 skills 能力库 + skill-creator + engine-runner + insights 入库治理」。
>
> 去重:已比对 seen-repos.json(247 个 URL,本轮 +3 = 250)+ borrowed-libs.md;本轮三例(TJKlein/mcpruntime、darkrishabh/agent-skills-eval、agent-ecosystem/skill-validator)**均未出现在去重热库**。**Starlaid / 星桥 全程排除**(三例均不涉及)。

### 1. TJKlein/mcpruntime — 把「工具/skills」当**沙箱里可 import 的库**来跑(Anthropic Programmatic Tool Calling 模式),并自带一个**自生长技能库**:工位每次成功执行的代码会被封装成带类型 `run()` 入口 + docstring + 来源标注的 skill 存进 `skills/`,下次 session 自动注入——几乎是给玉兔6「让能力库自己长出来」画了张可对照的工程图;另配**时间旅行调试(回放 / 倒带 / 分叉历史 session)**
- ① 名称 / URL:TJKlein/mcpruntime(Benchmarked agent execution runtime for Python — Sub-10ms cold starts, real-time streaming, time-travel debugging, self-growing tool libraries;比较 3 种沙箱后端:Docker(OpenSandbox)/ MicroVM / in-process AST)— https://github.com/TJKlein/mcpruntime
- 核验(web_fetch 直读):**MIT** · **8★ / 105 commits** · **Python 99.2%** · 有 tags(以 tag 发版)· 架构三层:Semantic(agent 生成程序)→ Kernel(Programmatic Tool Calling)→ Sandboxed Execution(OpenSandbox runtime + MCP Tools + Data Context);README 显式引用 Anthropic「code execution with MCP」工程博客。
- ② 优秀在哪:它把「调工具」从「一次一个 tool-call」升级成「**agent 写一段代码、把工具当库 import 着调**」(Programmatic Tool Calling),于是能在沙箱里**对大数据集做多步推理**、少跑往返。三个能力最亮:
  - **自生长技能库(Skill Registry / Self-Growing Tool Library)**:成功执行过的代码自动封装成 *typed callable module*(带 `run()` 入口 + docstring 元数据 + source attribution)存进 `skills/`,**未来 session 的 prompt 自动注入可用 skills**——能力库不是手写死的,而是「用着用着自己长出来」。
  - **执行回放 & 时间旅行调试**:记录并恢复沙箱状态,可**倒带、分叉**之前的 agent session(调一个失败 run 时回到某步、另开一条分支)。
  - **流式执行**:长任务用 SSE 实时回传输出;另有可插拔的 3 种沙箱后端(Docker/OpenSandbox、MicroVM、in-process AST)做隔离-速度权衡(冷启 sub-10ms)。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **控制台 skills 能力库「自生长」 ← 借「执行成功的代码 → 封装成带 `run()`/docstring/来源 的 skill 自动入 `skills/` → 下次自动注入」** ⭐⭐:玉兔6 现在的 SKILL.md 是**手写静态**的。借这套「**用过即沉淀**」管线,可让控制台把某工位反复跑通的解法**自动提名为候选 SKILL**(带来源/调用次数),再经下面第 2/3 例的 A-B 评测 + 质量门才正式入库——把「能力库」从人工维护升级成「**可自生长、但有门禁**」。这是本批最具战略性的一点。
  - **engine-runner 回放 / 分叉调试 ← 借「log+restore sandbox state → rewind/fork session」** ⭐:正好补玉兔6 近批 durable 拼图缺的「**调试面**」——前几批讲 checkpoint(Sayiir)/ effect-log(durable)/ run 落盘(GNAP)是为了「续跑+审计」,mcpruntime 的时间旅行是为了「**回到某步、另开分支重试**」,让工位失败 run 可被倒带复盘而非从头重来。
  - **工具调用效率 ← 借「Programmatic Tool Calling:工具即沙箱内可 import 的库,agent 写代码批量调、对大数据多步推理」** ⭐:控制台工位面对「要连调很多工具/处理大块数据」时,用「写一段代码调库」替代「逐个 tool-call」,省往返与 token(直接对应 Anthropic code-execution-with-MCP 范式)。
- ④ 难度中-高 / 优先级中-高:「自生长 + 门禁」管线战略价值高,但自动提名→评测→入库链路非平凡,且回放需要状态捕获;**8★、体量小** → 借**范式与管线设计**,不接其 runtime/沙箱代码。
- 边界:Python + 沙箱(Docker/MicroVM)运行时,与玉兔6 单机文件栈不同 → 只借**「自生长技能库 + 时间旅行回放/分叉 + Programmatic Tool Calling」三个范式**,在控制台/engine-runner 上重实现;MIT 可放心读借。OpenSandbox 等为其示例运行时,**与 Starlaid 无关**。

### 2. darkrishabh/agent-skills-eval — 给每个 skill 跑一场**对照实验**:同一组 eval 提示词**装了 skill(with_skill)vs 没装(without_skill / baseline)各跑一遍**,再用**裁判模型**给两边打分、出并排报告 + `iteration-N` 版本化产物 + 工具调用断言——正好把玉兔6 skill-creator 的「评测」从「有没有」补成「**这条 skill 比不装到底强多少**」
- ① 名称 / URL:darkrishabh/agent-skills-eval(SDK and CLI for evaluating agentskills.io-style skills)— https://github.com/darkrishabh/agent-skills-eval
- 核验(web_fetch 直读):**MIT** · **0★ / 3 commits(极新)** · **TypeScript 82.2% / JavaScript 17.8%** · 无 release(npm 包 `agent-skills-eval`)· 自述「从 Bench AI 的 Skills Eval 拆出来」,让 skill 作者不依赖其 web app 就能自建评测。
- ② 优秀在哪:它把「一条 skill 到底有没有用」做成可量化的 A-B 实验,闭环很完整:加载 `SKILL.md` + `evals/evals.json` → 对每条 eval **with_skill 与 without_skill 各调一次模型** → **judge 模型**给输出打分(可省略 assertions、用 `expected_output` 自动转判据)→ 产物落 `iteration-N/<eval>/{with_skill,without_skill}/{prompts,timing,grading,outputs}` 官方布局 → 生成**静态 HTML 报告**(按 skill/eval 的通过率、断言证据、用时与 token)。还支持**工具调用断言(tool_assertions)**做确定性行为校验、OpenAI 兼容 + 自定义 provider、pretty/jsonl/silent 日志。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **skill-creator 评测 ← 借「with_skill vs without_skill 基线对照 + judge 打分」** ⭐⭐:玉兔6 的 skill-creator 已提「跑 eval/benchmark」,但最该补的机制是**这条 A-B 基线**——任何新 SKILL(尤其上面 mcpruntime 式自动提名的候选)入库前,必须用它自己的 eval 提示词**装/不装各跑一遍 + 裁判打分**,用「**比 baseline 提升多少**」证明价值,而不是「写出来就算数」。这是把「能力库治理」从「数量」转向「**每条都被证明有用**」的关键度量。
  - **能力库版本化 ← 借「`iteration-N` 工作区布局」** ⭐:每次改 skill = 一个 iteration 目录(prompts/timing/grading/outputs 全留痕),天然得到**skill 演进的可对照历史**(哪一版通过率更高),对口 skill-creator 的「优化描述/度量性能」。
  - **确定性行为校验 ← 借「tool_assertions:断言该不该调某工具」**:玉兔6 skill 若期望工位「该用 X 工具 / 不该乱调」,可用工具调用断言把它做成**可回归的测试**,而非靠人读输出。
- ④ 难度低-中 / 优先级高:A-B + judge 的**模式**极易在玉兔6 复刻(纯流程 + 小 TS CLI),直接抬高 skill-creator 的质量基线,低风险可逆。
- 边界:**0★、3 commits、极新**(从 Bench AI 拆出)→ 价值在**评测模式与产物 schema**,非成熟背书;它走 OpenAI 兼容 provider,玉兔6 可换自家 provider 实现。MIT 可读借。

### 3. agent-ecosystem/skill-validator — 一个**skill 质量门 CLI**:既做静态校验(结构 / frontmatter / **token 预算** / 代码围栏 / 内链 / 孤儿文件),又做内容分析(**密度 / 具体性 / 祈使句比例**),还能让**LLM 裁判**按 clarity/actionability/novelty 打分;且自带 **pre-commit / CI 钩子**(覆盖 claude/codex/cursor/gemini… 13 个平台的 skills 目录)——正适合给玉兔6 skills 库与 insights 入库装一道**机械化质量门**
- ① 名称 / URL:agent-ecosystem/skill-validator(Validate Skill content against Agent Skill specification, with additional content density and quality checks;CLI 名 `skill-validator` / `skillcheck`)— https://github.com/agent-ecosystem/skill-validator
- 核验(web_fetch 直读):**MIT** · **152★ / 25 forks / 128 commits** · **Go**(Homebrew / `go install` / pre-commit 三种装法,`.goreleaser.yaml` 发版)· LLM 评分支持 Anthropic / OpenAI 兼容 / Claude CLI。
- ② 优秀在哪:它把「一条 skill 写得合不合格」拆成**四个层次的命令**,各管一段:
  - `validate structure` —— 合不合规、agent 能不能用?(**结构 / frontmatter / token 预算 / 代码围栏 / 内链 / 孤儿文件**)
  - `analyze content` —— 指令质量好不好?(**密度 / 具体性 / 祈使句比例**)
  - `validate links` —— 外链还活着吗?(HTTP/HTTPS 解析)
  - `score evaluate` —— **LLM 裁判**怎么评?(clarity / actionability / novelty 等)
  并自带 **pre-commit 钩子**,为 claude/codex/copilot/cursor/gemini/goose/kiro… 等 13 个平台预置了「自动用对 skills 目录」的 hook(例:对 `.claude/skills/` 跑 `check`),即「**写完即检、不过不让进**」。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **skills 能力库质量门 ← 借「structure + token 预算 + 密度/具体性 静态检查,过门才入库」** ⭐⭐:玉兔6 能力库在长大,且 insights README 明确强调 **SKILL.md 的「渐进披露 / token 预算」**——skill-validator 的 **token 预算 + 信息密度 + 孤儿文件** 检查**正好直击这条设计目标**:给每个 SKILL.md 设硬上限与密度下限,臃肿/低密度的 skill 直接挡在库外。这是把「能力库治理」从「人工 review」升级成「**可机械执行的门**」。
  - **insights / skill 入库评分 ← 借「LLM 裁判按 clarity/actionability/novelty 打分」** ⭐:玉兔6 insights 在做「借鉴库」治理,可借这套**裁判维度**给候选 skill / 借鉴条目打「清晰度 / 可执行性 / 新颖度」分,排序并标记低质项(与第 2 例的 A-B 价值评测互补:一个评「写得好不好」,一个评「装了有没有用」)。
  - **机械化门禁 ← 借「pre-commit / CI 钩子,对 skills 目录写完即检」**:玉兔6 控制台可把质量门做成**提交即跑**的检查(结构/token/链路),不过门不入库——对应它对 `.claude/skills/` 跑 `check` 的做法。
- ④ 难度低 / 优先级高:它是一道**纯检查 CLI**,模式极易复刻;**152★、MIT、Go、128 commits → 本批最成熟**;token 预算 / 密度门直接服务玉兔6 已写明的渐进披露目标,低风险高收益。
- 边界:Go 二进制(玉兔6 不必吃其二进制)→ 可只借**检查项清单(structure/token/density/specificity + LLM 三维评分)与「pre-commit 门」范式**,在控制台用自家脚本实现;MIT 可读借。其多平台 hook 仅说明覆盖面广,**不涉 Starlaid**。

### 行动判断(是否加待办卡)
- 三例最值钱的借鉴拼成一条**完整的 skills 生命周期**:mcpruntime「**生长**」(用过即沉淀成候选 skill)→ agent-skills-eval「**度量**」(with/without A-B + 裁判,证明真有用)→ skill-validator「**质量门**」(结构/token/密度 + LLM 评分,过门才入库)。这是「给 CEO 取舍的能力库治理范式」,非可越过决策直接执行的原子动作 → **本轮不新增公告板待办卡,只写分析**(延续近批克制口径,符合「不是待办任务」红线)。
- 最接近「明确值得立刻做」的一步(若 CEO 认可再开卡,避免擅自堆待办):**做一份「skills 能力库质量门 + A-B 评测」RFC/spike(纯文档/流程)**——把 skill-validator 的静态门(SKILL.md 的 **token 预算 + 信息密度 + 结构/frontmatter** 硬检查,直接服务 insights README 已写的「渐进披露」目标)与 agent-skills-eval 的 **with_skill vs without_skill + 裁判打分** 合成玉兔6 skill-creator / 能力库**入库门**:新 / 改 / 自动提名的 SKILL 必须 ① 过静态门(结构+token+密度)② 过 A-B(比 baseline 有提升)才入库,产物按 `iteration-N` 留痕。这是**纯文档、低风险、可逆**的一步,且与本批 mcpruntime 的「自生长候选」正好接上(生长出来的候选,正需要这道门来把关)。

### 本批小结(给 CEO 的一句话借鉴)
- **TJKlein/mcpruntime**:学它「**自生长技能库(执行成功的代码 → 带 `run()`/docstring/来源的 skill 自动入库、下次自动注入)+ 时间旅行回放/分叉调试 + Programmatic Tool Calling(工具当沙箱内可 import 的库)**」,给玉兔6 能力库「自己长出来 + 失败 run 可倒带」的工程图;MIT、8★、Python,借范式不引沙箱 runtime。**(本批最具战略性)**
- **darkrishabh/agent-skills-eval**:学它「**with_skill vs without_skill 基线对照 + judge 打分 + iteration-N 版本化产物 + 工具调用断言**」,把 skill-creator 的评测从「有没有」补成「**比不装强多少**」;MIT、极新(0★/3 commits),借评测模式不依赖其成熟度。**(最易复刻、最该先做)**
- **agent-ecosystem/skill-validator**:学它「**结构/frontmatter/token 预算/密度/具体性 静态门 + LLM 裁判(clarity/actionability/novelty)+ pre-commit/CI 钩子**」给能力库装机械化质量门,直接服务玉兔6 已写明的「渐进披露 / token 预算」;MIT、**152★、本批最成熟**、Go,借检查清单与门禁范式。
- **本批不新增待办卡**;最高优先借鉴点 = 用第 3 例的静态门 + 第 2 例的 A-B 评测,给 skills 能力库做一道「入库门」(纯文档 RFC),提请 CEO 评审后再决定是否开卡。**Starlaid / 星桥 全程排除。**

> watch(本批 web_fetch 直读元数据;HEAD commit SHA 因代理 git ls-remote 受限未取,待网络可达回填):TJKlein/mcpruntime `main`(**MIT → watch=true**,关注自生长技能库 + 时间旅行回放的演进与 release/tag,8★、Python)、darkrishabh/agent-skills-eval `main`(**MIT → watch=true**,关注从 Bench AI 拆出后的 A-B/judge 评测能力与首个 release,0★/3 commits 极新)、agent-ecosystem/skill-validator `main`(**MIT → watch=true**,关注 token 预算/密度检查项与 LLM 评分维度演进,152★、Go、128 commits,本批最成熟)。



<!-- insight-scout-run:20260628-16-queue-engine -->
## 任务队列失败处置借鉴(slot=20260628-16)
> 来源:洞察员; network=available(WebSearch + GitHub/官方文档直读); 已用 `seen-repos.json`、`borrowed-libs.md`、`insights.md` 去重,未复用 Temporal/BullMQ/Asynq/Celery/Faktory/Watermill/Kestra 等已见 URL; 不登录、不授权、不安装。

### timgit/pg-boss
- 是什么:Node.js + Postgres 的事务型任务队列,支持 exactly-once job delivery、cron/deferral、依赖编排。
- 值得借鉴:把 retry/backoff、dead letter queue with redrive、LISTEN/NOTIFY 低延迟拉取、SQL 可操作队列放成基础能力,适合对照控制台失败处置基线。
- 迁移边界/许可证不确定项:MIT 已核;依赖 Postgres 与 Node 22.12+,若控制台维持文件/SQLite 队列,只借 schema 与生命周期语义。
- URL:https://github.com/timgit/pg-boss

### argoproj/argo-workflows
- 是什么:CNCF Kubernetes workflow engine,用 DAG/Steps 编排容器任务,带 UI、cron、suspend/resume/cancel。
- 值得借鉴:`retryStrategy` 区分 OnFailure/OnError/OnTransientError,并配 limit、backoff、expression;还可借 exit hooks、metrics、memoized resubmit。
- 迁移边界/许可证不确定项:Apache-2.0 已核;K8s CRD/runtime 对控制台过重,只借失败分类、逐步重试策略和可观测字段。
- URL:https://github.com/argoproj/argo-workflows

### apache/dolphinscheduler
- 是什么:Apache 低代码数据编排平台,多 master/worker HA,支持 Web UI、Python SDK、Open API。
- 值得借鉴:workflow/task versioning、pause/stop/recover、实例状态统计和多 worker 容错,适合控制台看板与恢复状态词表。
- 迁移边界/许可证不确定项:Apache-2.0 已核;Java 平台、多租户和大量任务类型不迁入,只借 HA/状态/恢复的产品语义。
- URL:https://github.com/apache/dolphinscheduler

### 行动判断
- 生成 1 张公告板候选:请 CEO 取舍是否先起草《控制台队列失败处置契约》,统一 retryPolicy、DLQ/redrive、lease/heartbeat 超时回收、pause/stop/recover 与失败审计字段;这是纯文档/RFC,低风险且不改运行代码。



<!-- insight-scout-run:cr-1782633642428-insight-scout-repos-20260628-16 -->
## 2026-06-28 · 自动洞察(20260628-16 · queue-engine)

> 来源:洞察员; run=cr-1782633642428-insight-scout-repos-20260628-16; queue=insight-scout/insight-scout-repos-20260628-16; network=available

## 任务队列失败处置借鉴(slot=20260628-16)
> 来源:洞察员; network=available(WebSearch + GitHub/官方文档直读); 已用 `seen-repos.json`、`borrowed-libs.md`、`insights.md` 去重,未复用 Temporal/BullMQ/Asynq/Celery/Faktory/Watermill/Kestra 等已见 URL; 不登录、不授权、不安装。

### timgit/pg-boss
- 是什么:Node.js + Postgres 的事务型任务队列,支持 exactly-once job delivery、cron/deferral、依赖编排。
- 值得借鉴:把 retry/backoff、dead letter queue with redrive、LISTEN/NOTIFY 低延迟拉取、SQL 可操作队列放成基础能力,适合对照控制台失败处置基线。
- 迁移边界/许可证不确定项:MIT 已核;依赖 Postgres 与 Node 22.12+,若控制台维持文件/SQLite 队列,只借 schema 与生命周期语义。
- URL:https://github.com/timgit/pg-boss

### argoproj/argo-workflows
- 是什么:CNCF Kubernetes workflow engine,用 DAG/Steps 编排容器任务,带 UI、cron、suspend/resume/cancel。
- 值得借鉴:`retryStrategy` 区分 OnFailure/OnError/OnTransientError,并配 limit、backoff、expression;还可借 exit hooks、metrics、memoized resubmit。
- 迁移边界/许可证不确定项:Apache-2.0 已核;K8s CRD/runtime 对控制台过重,只借失败分类、逐步重试策略和可观测字段。
- URL:https://github.com/argoproj/argo-workflows

### apache/dolphinscheduler
- 是什么:Apache 低代码数据编排平台,多 master/worker HA,支持 Web UI、Python SDK、Open API。
- 值得借鉴:workflow/task versioning、pause/stop/recover、实例状态统计和多 worker 容错,适合控制台看板与恢复状态词表。
- 迁移边界/许可证不确定项:Apache-2.0 已核;Java 平台、多租户和大量任务类型不迁入,只借 HA/状态/恢复的产品语义。
- URL:https://github.com/apache/dolphinscheduler

### 行动判断
- 生成 1 张公告板候选:请 CEO 取舍是否先起草《控制台队列失败处置契约》,统一 retryPolicy、DLQ/redrive、lease/heartbeat 超时回收、pause/stop/recover 与失败审计字段;这是纯文档/RFC,低风险且不改运行代码。



<!-- insight-scout-run:run-20260628T0805Z-insight-scout-repos -->
## 2026-06-28 · 自动洞察(run-20260628T0805Z · LLM 网关:网关「治理层」三件套(语义缓存 / 安全围栏 / 预算阶梯))

> 来源:洞察员;run=run-20260628T0805Z-insight-scout-repos(UTC 2026-06-28T08:05Z = 北京 16:05;定时自动运行,引擎未下发 cr- 编号,用时间戳 run id);network=available(WebSearch + web_fetch 直读 GitHub 仓库页/LICENSE 核验,star/license/release 为实时口径,人工复核为准)。
>
> 选题轮换:近 8h 已做 queue-engine(20260628-16)、多智能体编排(20260628-12)、优秀网页设计/可观测 UI(run-20260628T0411Z)、Unity·Simulaid(20260628-08)、skills 生命周期(北京 08:13)。**LLM 网关**是最久未做的一题(上次 20260627-20,约 20h 前),本轮轮回到此。但**刻意避开已 seen 的网关主力**(litellm / Portkey / bifrost / Helicone / kong / higress / archgw / envoyproxy-ai-gateway / theopenco-llmgateway / traceloop-hub / tensorzero / semantic-router / RouteLLM / openlit …),改攻一个**更对口玉兔6 的子赛道:网关「治理层」**——在"路由 + 观测"之上,真正去**省钱 / 设防 / 卡预算**的那一层。本轮三例正好对应这层的三个面:语义缓存(省 token)→ 安全围栏(PII/注入/内容)→ 预算阶梯(超额降级/拒绝),正补玉兔6 现有 `gateway-observability-panel`「只观测 token/花费/延迟、不 enforce」的缺口。
>
> 去重:已比对 seen-repos.json + borrowed-libs.md;本轮三例(messkan/prompt-cache、trylonai/gateway、InkByteStudio/llm-budget-proxy)**均未出现在去重热库**。**Starlaid / 星桥 全程排除**(三例均不涉及)。

### 1. messkan/prompt-cache — 给网关装一层**语义缓存**:把"意图相同的 prompt"命中即返回,省 token 又降延迟;关键是用**两段式灰区校验**(高相似→直接命中、低相似→跳过、灰区→拿廉价小模型核对意图)避免"长得像就乱返回错答案"。正补玉兔6 近批反复念叨的"重试/重复请求不要白花 token"的另一面
- ① 名称 / URL:messkan/prompt-cache(Cut LLM costs up to 80% with intelligent semantic caching;drop-in、provider-agnostic 的 Go LLM 代理)— https://github.com/messkan/prompt-cache
- 核验(web_fetch 直读):**MIT** · **237★ / 22 forks / 41 commits** · **Go 93.2%** · **4 个 release,v0.4.0(2026-04-24,活跃)** · 栈 = 纯 Go + **BadgerDB**(嵌入式持久化)+ 内存 LRU + **ANN 索引**(相似度检索)+ OpenAI 兼容 API;embedding provider 可选 OpenAI / Mistral / Claude(Voyage)。
- ② 优秀在哪:它把"语义缓存"做成了一个**即插即用、能上生产**的网关中间件,几个点很亮:
  - **两段式灰区校验(safer by design)**:朴素语义缓存的风险是"prompt 长得像但意图不同 → 返回错答案"。它用 高阈值→直接命中 / 低阈值→直接跳过 / **灰区→调一个廉价小模型核对意图** 的三分支,把"省钱"和"别返回错的"同时握住;阈值可运行时 `PATCH /v1/config` 调。
  - **工程完备度**:BadgerDB 持久化 + 内存 LRU 淘汰 + ANN 索引(自述 5x 检索加速)、SSE 流式(连"缓存命中"都能合成成 OpenAI SSE 分片返回)、Prometheus `/metrics` + JSON stats、管理端点 Bearer 鉴权、graceful shutdown / 重试退避。
  - **cache warming**:`POST /v1/cache/warm` 可从**历史 prompt/response 对**批量预热缓存(算 embedding + 入 ANN 索引)。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **控制台网关 / engine-runner 省 token ← 借「语义缓存层 + 两段式灰区校验」** ⭐⭐:玉兔6 近几批一直在解"重试不要重复花 token"(effect-log 幂等批),那是**同一会话内**重跑命中读回;prompt-cache 补的是**跨工位 / 跨时刻**的"意图相同请求"也直接命中省钱——RAG / agent 反复问相似问题、重复推理步骤,正是它点名的高命中场景。**两段式灰区校验**尤其该借:玉兔6 若给网关上缓存,最怕"近似 prompt 返回错答案",这套"灰区→小模型核对意图"给了可落地的安全阀。
  - **从历史预热 ← 借「cache warming(历史 prompt/response → 预热缓存)」** ⭐:玉兔6 有大量 `runs/` 与 insights 历史问答,可在网关冷启时用历史高频问答预热缓存,首日即有命中率。
  - **缓存可观测 ← 借「命中率 / 省下 token / 延迟 的 Prometheus 指标」**:直接喂给现有 `gateway-observability-panel`,把"省了多少钱"做成面板一行。
- ④ 难度中 / 优先级中-高:语义缓存对"重复问答多"的玉兔6 直接省钱,范式清晰、可文件化重实现(BadgerDB/ANN 可换玉兔6 自己的向量小库);但需先圈定"哪些工位调用适合缓存(只读 / 确定性问答)、哪些绝不能(带时效 / 带副作用)"。
- 边界:Go + BadgerDB 运行时,与玉兔6 单机文件栈不同 → **只借「语义缓存 + 两段式灰区校验 + cache warming + 缓存指标」范式**,在控制台网关上重实现;embedding 走自家 provider。MIT、237★、v0.4.0 活跃,读借友好。

### 2. trylonai/gateway — 给网关装一层**安全围栏(LLM 防火墙)**:在请求出入两侧做 PII 脱敏 / 注入防护 / 内容过滤,全部由一份**声明式 policies.yaml** 驱动;还提供 `/safeguard` 只校验不代理的端点。正补玉兔6 网关"只观测不设防"、以及把"人审"前移成"先机器策略过滤"的缺口
- ① 名称 / URL:trylonai/gateway(The Open Source Firewall for LLMs;自托管 FastAPI 代理,坐在应用与 OpenAI / Gemini / Claude 之间)— https://github.com/trylonai/gateway
- 核验(web_fetch 直读 LICENSE):**BUSL-1.1(Business Source License 1.1;Change Date 2028-04-03 → 转 Apache-2.0)**,**非纯开源宽松证**——Use Limitation:不得用于"与 Trylon 商业云竞争的 LLM 安全 SaaS 生产用途" · **123★ / 12-13 forks / 24 commits** · **Python 99.6%(FastAPI)** · 无 release(以源码 + Docker 分发,首启下载 ~1.5GB ML 模型)· open-core(其商业云在此核心数据面上做 UI / RBAC / SSO)。
- ② 优秀在哪:它把"LLM 安全"收敛成一个**单一防火墙 + 声明式策略**:
  - **出入双向 + policies.yaml 策略引擎**:PII 脱敏、prompt 注入防护、毒性 / 内容过滤,全部写在一份 `policies.yaml` 里;命中即在响应给 `finish_reason: content_filter` + `X-Trylon-Blocked: true` 头,或直接改写 / 脱敏。
  - **`/safeguard` 只校验端点**:除了"代理 + 拦截",还能**只校验不转发**(返回 `safety_code` / `action`),让宿主自定义工作流——这点对"想自己接审批流"的系统很关键。
  - **drop-in 多 provider**:OpenAI / Gemini / Claude 都给了改 `base_url` 即接的范式,"换模型不改安全逻辑"。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **控制台网关安全门 ← 借「声明式 policies.yaml + 出入双向 PII / 注入 / 内容校验」** ⭐⭐:玉兔6 网关当前偏"观测 / 路由",缺一道**内容安全门**。可借它"把安全规则写成一份声明式策略 + 命中给 content_filter/block 标记"的范式,给网关加 PII 脱敏(防工位把密钥 / 内部代号 / 敏感数据漏给外部模型——直击玉兔6 红线"不回显密钥")与注入防护。
  - **人审前移 ← 借「`/safeguard` 只校验端点」对接已有 `office-tool-station-humangate-alert`** ⭐:把现有"人审"从纯人工升级成**两级**——先用 `/safeguard` 式机器策略静默过滤,**只有命中敏感 / 高风险才升级到人审**,既省人力又不漏。
  - **策略即配置 ← 借「policies.yaml 声明式 + 默认给可用样例」**:玉兔6 可把"哪些工位 / 项目允许哪些外发内容"做成版本化声明文件,review 友好。
- ④ 难度中 / 优先级中:安全门价值高(尤其 PII / 密钥外泄防护正对玉兔6 红线),但 PII / 注入检测要么自带 ML 模型(它首启拉 1.5GB)、要么接规则 / 小模型,落地有成本;非紧急主线,建议并入"网关安全 / human-gate"工作项。
- 边界:**BUSL-1.1 非宽松证**——可自托管 / 内部使用与借鉴设计,但**不得拿它做与 Trylon 竞争的 LLM 安全 SaaS**,且 2028-04-03 才转 Apache-2.0 → 玉兔6 **只借「声明式策略 + 出入双向校验 + /safeguard 两级人审」范式与字段,用自家脚本 / 小模型重实现,不直接搬运其代码进项目**;FastAPI / ML 模型栈也不引。**与 Starlaid 无关**。

### 3. InkByteStudio/llm-budget-proxy — 给网关装一层**预算硬约束 + 降级阶梯**:per-key 日 / 月美元预算,按消耗百分比走 **80% 警告 → 95% 自动降级到便宜模型 → 100% 拒绝(402)** 的阶梯,并用一份 pricing 清单 + 逐请求成本会计响应头把"花了多少 / 还剩多少"全暴露。正把玉兔6 `gateway-observability-panel`「只观测花费」升级成「enforce 预算 + 超额自动降级续跑」
- ① 名称 / URL:InkByteStudio/llm-budget-proxy(Lightweight reverse proxy:per-key token budgets / rate limiting / cost dashboards / model downgrade / caching,5 分钟 Docker 起)— https://github.com/InkByteStudio/llm-budget-proxy
- 核验(web_fetch 直读):**MIT** · **0★ / 0 fork / 1 commit(极新,刚开源)** · **TypeScript 88.5%(Fastify)+ SQLite** · 无 release · 自述定位"比 LiteLLM 刻意更简",OpenAI-only MVP、单实例(SQLite)。**背书极弱,价值在 schema / 设计而非规模**。
- ② 优秀在哪(看的是**机制设计**,不是体量):
  - **预算阶梯(threshold ladder)**:对 per-key 日 / 月预算设 `alertThresholds`——**80% 发 `X-Budget-Warning` 头 → 95% 触发 model downgrade(切到便宜模型,带 `X-Model-Downgraded` / `X-Original-Model` 头)→ 100% 直接拒绝(402)**。把"花超了"从事后发现变成**实时分级动作**。
  - **逐请求成本会计响应头**:每个响应带 `X-Request-Cost`(本次实际花费)、`X-Estimated-Cost`(预检最坏估算)、`X-Tokens-Used`、`X-Budget-Remaining`、`X-RateLimit-Remaining-RPM` 等——成本 / 预算对调用方**完全透明、前端可直接读**。
  - **pricing.yml 价目清单 + 预检拦截**:模型单价(含 cachedInput 价)写成版本化清单,请求前用"估算输入 + 最坏输出上限"预检,超预算**在发出前**就拦;配 RPM/TPM 限流、exact-match 缓存、Chart.js 看板、去抖 webhook 预算告警。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **网关预算治理 ← 借「per-key 预算 + 80/95/100% 阶梯(警告→降级→拒绝)」** ⭐⭐:玉兔6 把每个**工位 / 角色 / 项目**视作一个 key,给定 token / 美元预算与阶梯动作——这正是把现有 `gateway-observability-panel`(只观测)升级成 **enforce**:常态观测,临界(95%)**自动降级到便宜模型继续跑**(而非硬停),封顶(100%)才拒绝。"自动降级续跑"还与近批 durable / effect-log 的"别让任务白崩"心智一致。
  - **成本透明 ← 借「逐请求成本会计响应头(X-Request-Cost / X-Budget-Remaining / X-Estimated-Cost)」** ⭐:玉兔6 engine-runner 每次工位调用都可回带这套头,把"这步花了多少 / 这个项目还剩多少预算"直接喂给控制台面板与 `runs/*.json`(呼应近批 GNAP 的 run 成本落盘)。
  - **预检拦截 ← 借「pricing 清单 + 发出前最坏估算预检」**:在真正烧钱前就挡住会超预算的调用,比事后审计更省。
- ④ 难度低-中 / 优先级高:预算阶梯 + 成本响应头是**纯流程 / schema**,极易在控制台用自家脚本复刻,直接补齐"花费可观测 → 可 enforce"这一跳,低风险高收益。
- 边界:**0★ / 1 commit、OpenAI-only、SQLite 单实例 MVP** → **只借「预算阶梯 + 成本会计响应头 + pricing 清单预检」的 schema 与状态机**,不接其代码 / 运行时;玉兔6 多 provider、多工位要自行扩展。MIT 可放心读借。

### 行动判断(是否加待办卡)
- 三例拼成玉兔6 网关缺失的**「治理层」三件套**:prompt-cache「**省**」(语义缓存,跨时刻 / 跨工位的相似请求命中即返回)→ trylonai/gateway「**防**」(PII / 注入 / 内容声明式围栏 + 两级人审)→ llm-budget-proxy「**卡**」(预算阶梯 enforce + 超额自动降级 + 逐请求成本会计)。三者都坐在玉兔6 现有 `gateway-observability-panel`(只观测)之上,把"观测"升级成"省 / 防 / 卡"的 enforce。属"给 CEO 取舍的网关治理范式",非可越过决策直接执行的原子动作。
- **本轮不新增公告板待办卡,只写分析**:① 延续近批克制口径与"不是待办任务"红线;② 公告板已有同域卡(`gateway-observability-panel`、`insight-4231644170` 路由评测 + LLM 可观测),再开易重复堆积;③ 最近两批(编排 20260628-12、队列 20260628-16)已各加一张 RFC 卡,**待 CEO 先消化**。最高优先借鉴点(预算阶梯 enforce + 语义缓存省 token)建议**并入既有 `gateway-observability-panel` 工作项**推进(纯设计 / schema,零新依赖、数据不出本地),而非另开新卡。

### 本批小结(给 CEO 的一句话借鉴)
- **messkan/prompt-cache**:学它「**语义缓存 + 两段式灰区校验(高→命中 / 低→跳过 / 灰区→廉价小模型核对意图)+ 历史 cache warming**」,给网关省 token / 降延迟又不返回错答案;MIT、237★、Go、v0.4.0 活跃,借范式不引 BadgerDB / Go 运行时。**(本批最成熟、最直接省钱)**
- **trylonai/gateway**:学它「**声明式 policies.yaml + 出入双向 PII 脱敏 / 注入 / 内容过滤 + `/safeguard` 只校验端点(做两级人审)**」,给网关加安全门、对口 human-gate 与"不漏密钥"红线;**BUSL-1.1 非宽松证(2028 转 Apache-2.0)**,只借设计范式、用自家实现、勿做竞品 SaaS。
- **InkByteStudio/llm-budget-proxy**:学它「**per-key 预算 80/95/100% 阶梯(警告→自动降级便宜模型→拒绝)+ 逐请求成本会计响应头 + pricing 清单预检**」,把网关从"观测花费"升级成"enforce 预算 + 超额降级续跑";MIT、**0★ / 1 commit 背书极弱,价值在 schema**。**(最易复刻、最该先做)**
- **本轮不新增待办卡**;最高优先借鉴点 = 把"网关治理层(语义缓存省 token + 预算阶梯 enforce)"并入既有 `gateway-observability-panel` 工作项,提请 CEO 评审后再决定是否开卡。**Starlaid / 星桥 全程排除。**

> watch(本批 web_fetch 直读元数据;HEAD commit SHA 因代理 git ls-remote 受限未取,待网络可达回填):messkan/prompt-cache `main`(**MIT → watch=true**,关注 v1.0 的 clustered 模式 / 本地 embedding(Ollama)/ Web 看板,237★、v0.4.0 2026-04)、trylonai/gateway `main`(**BUSL-1.1 → watch=true 但谨慎**,关注 policies 引擎演进与 2028 转 Apache-2.0,123★、FastAPI、无 release)、InkByteStudio/llm-budget-proxy `main`(**MIT → watch=true 但低频**,关注是否补多 provider / Postgres 与首个 release,0★ / 1 commit 极新)。



<!-- insight-scout-run:cr-1782648042684-insight-scout-repos-20260628-20 -->
## AI agent 工具/skills/能力库治理(slot=20260628-20)
> 来源:洞察员; network=available(WebSearch + GitHub 直读); 已比对 seen-repos/borrowed-libs/insights,本轮 3 个 URL 未见; Starlaid/星桥 全程排除; 不登录不安装。

### NVIDIA/skills
- 是什么:官方 NVIDIA-verified skills catalog,技能由产品仓维护、每日镜像到目录,支持 Codex/Claude/Cursor 等目标安装。
- 值得借鉴:把能力库拆成“源仓负责内容 + catalog 负责分发/验证/issue 路由”,并生成 skill card/review table。
- 迁移边界/许可证不确定项:Apache-2.0 AND CC-BY-4.0;只借 catalog+验证流程,不复制 GPU 产品技能。
- URL: https://github.com/NVIDIA/skills

### FrancyJGLisboa/agent-skill-creator
- 是什么:把自然语言流程生成跨 17 平台 agent skill,自带 validate/security_scan/eval rollout 硬门禁。
- 值得借鉴:候选 skill 入库前强制生成 eval spec、跑安全扫描和跨平台适配清单。
- 迁移边界/许可证不确定项:MIT;本轮不执行其 bootstrap/install,只借“生成器+门禁+回归”管线。
- URL: https://github.com/FrancyJGLisboa/agent-skill-creator

### agentskillexchange/skills
- 是什么:可信开放 skill 目录,记录 2660 published skills、行业/类别、机器可读 skills.json 与安全审查等级。
- 值得借鉴:每条能力必须有真实上游 provenance、category/framework/signals/license 字段,适合做玉兔6热库索引规范。
- 迁移边界/许可证不确定项:MIT;其第三方 installer 需 pin version,控制台先只借 metadata schema 和验证分层。
- URL: https://github.com/agentskillexchange/skills

### 行动判断
- 生成 1 张公告板候选:请 CEO 决定是否起草《控制台能力库信任/入库契约 v0》,把热卡/温文档/冷归档、provenance、license、security_review、eval/status、source repo 映射成统一字段。



<!-- insight-scout-run:run-20260628T1205Z-insight-scout-repos -->
## 2026-06-28 · 自动洞察(run-20260628T1205Z · GUI grounding + 像素素材生成)

> 来源:洞察员;run=run-20260628T1205Z-insight-scout-repos(UTC 2026-06-28T12:05Z = 北京 20:05;定时自动运行,引擎未下发 cr- 编号,用时间戳 run id);network=available(WebSearch + web_fetch 直读 GitHub 仓库页 / LICENSE 核验,star / license / commit 为抓取当下口径,人工复核为准)。
>
> 选题轮换:紧邻的 20:00 槽刚做完 skills / 能力库治理(NVIDIA/skills 等),近 8h 还做过 LLM 网关治理层(16:05)、队列失败处置(20260628-16)、多智能体编排(20260628-12)、可观测 UI(run-20260628T0411Z)、Unity·Simulaid(20260628-08)。**GUI grounding(上次 20260628-00,约 20h 前)与 像素素材生成(上次 20260628-04,约 16h 前)是最久未做的两题**,本轮轮回到这两题。
>
> 去重:已比对 seen-repos.json(265 条)+ borrowed-libs.md;本轮 3 例(ZJU-REAL/ClawGUI、theamusing/perfectPixel、AriaUI/Aria-UI)均未出现在去重热库(追加后 268 条)。**Starlaid / 星桥 全程排除**(三例均不涉及)。

### 1. ZJU-REAL/ClawGUI — 把 GUI agent 的「训练 → 评测 → 部署」收进一个全栈框架;最该借的是 **ClawGUI-Eval 的「Infer→Judge→Metric 三段式 + 95.8% 复现率」标准评测门**,正补玉兔6「能力 / 失败只能读日志、跨批不可比」的缺口
- ① 名称 / URL:ZJU-REAL/ClawGUI(A Unified Framework for Training, Evaluating, and Deploying GUI Agents;浙大 REAL 实验室)— https://github.com/ZJU-REAL/ClawGUI
- 核验(web_fetch 直读):**Apache-2.0** · **330★ / 6 forks / 145 commits** · **Python 95.3% + Shell 3.6%** · **无 release**(以源码 + HuggingFace/ModelScope 模型分发)· 时间线极新:**2026-04-13 开源、2026-04-14 上 arXiv(2604.11784)**。三模块各自独立环境:RL(训练)/ Eval(评测)/ Agent(部署),另放出端到端训练的 ClawGUI-2B(MobileWorld SR 17.1 vs 基线 11.1)。
- ② 优秀在哪 / 亮点:它把"做一个能用的 GUI agent"拆成长期被分开解决的三件事,并真正缝在一条流水线上:
  - **ClawGUI-Eval =「可复现的评测底座」**:三段式 **Infer → Judge → Metric**,覆盖 6 个基准(ScreenSpot-Pro / V2、UIVision、MMBench-GUI、OSWorld-G、AndroidControl)、11+ 模型,**对官方结果 95.8% 复现率**——把"各家论文数字口径不一、互相不可比"治成"可对齐";本地 GPU(transformers)或远程 API(OpenAI 兼容)双后端、多卡多线程 + 断点续跑。
  - **ClawGUI-Agent =「一句话运维」**:基于 OpenClaw + nanobot,从 12+ 聊天平台用自然语言操控 Android / HarmonyOS / iOS;**"benchmark qwen3vl on screenspot-pro"一句话**就跑完 env check → 多卡推理 → judge → metric → 结果对比,无需写脚本;带 **personalized memory**(跨任务自动学偏好并注入上下文)与 **episode recording**(每个任务存成结构化 episode,可回放、可攒数据集)。
  - **ClawGUI-RL =「在线 RL 训练设施」**:几十个 Docker 安卓模拟器并行 / 真机同一套 API、**GiGPO + PRM 做 step 级密集奖励**(强于标准 GRPO)、**spare server rotation 自动故障切换不中断训练**、轨迹可录制回放。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **能力 / 失败评测 ← 借「Infer→Judge→Metric 三段式 + 复现率作质量门」** ⭐⭐:玉兔6 当前对"某工位 / skill 到底行不行、这批比上批好没好"基本靠读日志、跨批不可比。可借这套三段式给玉兔6 的工位能力 / 失败处置做**标准化评测**,并把"复现率 / 通过率"当成入库前的**质量门**——正好接上 20:00 槽刚分析的 skills 能力库治理里"候选 skill 必须先生成 eval spec、跑回归"的诉求,二者合并即一条"能力库 + 评测门"主线。
  - **控制台一句话运维 ← 借「ClawGUI-Agent 自然语言触发整条评测 / 任务流水线」** ⭐:玉兔6 控制台的对话运维可借"一句话 → env check → 执行 → judge → 出指标 → 对比"的范式,把"跑一次基准 / 复跑一个失败 run"做成对话里一句话,而不必拼脚本。
  - **run 录制回放 + 跨任务记忆 ← 借「episode recording + personalized memory」**:对口近批 durable / effect-log 的"任务录制可回放";把每个工位任务存成结构化 episode 便于失败复盘与攒训练 / 评测集,personalized memory 则呼应跨会话偏好注入。
  - **训练 / 队列韧性 ← 借「spare server rotation 自动故障切换」**:与已有 `queue-crash-recovery-orphan-reclaim` 卡心智一致——长任务遇节点故障自动切换续跑,不中断。
- ④ 难度中 / 优先级中-高:**评测三段式 + 复现率门**是纯流程 / 数据契约,易在控制台用自家脚本复刻、且与刚做的 skills 能力治理可合并,低风险高对齐;但**完整 RL 训练栈(Docker 安卓集群 + GiGPO/PRM)很重,玉兔6 不引**,只借评测 / 部署 / 录制范式。
- 边界 / 许可证:**Apache-2.0 已核**,读借友好;它强依赖移动端真机 / 模拟器与 OpenClaw / nanobot 运行时,玉兔6 **只借「评测三段式 + 复现率门 + 一句话跑基准 + episode 录制」的范式与字段**,不接其移动 RL 运行时。**与 Starlaid 无关**。

### 2. theamusing/perfectPixel — 一个把「AI 生成的脏像素图」自动 **FFT 找网格 + Sobel 对齐 → 量化成真·像素**的工具;纯 numpy/cv2、pip 可装、带 ComfyUI 节点,直接对口 Simulaid 像素办公室素材的"生成后清洗"
- ① 名称 / URL:theamusing/perfectPixel(Refine and quantize messy AI pixel art into clean, perfect pixels)— https://github.com/theamusing/perfectPixel
- 核验(web_fetch 直读):**MIT** · **1.2k★ / 72 forks / 31 commits** · **Python 100%** · **无 release**(`pip install perfect-pixel[opencv]` 或纯 numpy 版 `pip install perfect-pixel`)· 提供 **Web Demo** 与 **ComfyUI 自定义节点**(不改核心算法,只加 ComfyUI 接口)。
- ② 优秀在哪 / 亮点:它精准命中"AI 生成像素图看着像素、放大全是糊"的真问题,用一条很轻的经典 CV 管线解决:
  - **三步算法,够小够清楚**:① 从原图 **FFT 幅度谱**估出网格大小、生成候选网格;② 用 **Sobel 边缘**把网格线对齐到真实色块边界(`refine_intensity` 控制搜索带宽);③ 按对齐后的网格**采样 / 量化**原图,得到真·像素图。`sample_method` 可选 center / median / majority,`fix_square` 近方形可强制方形。
  - **auto-detect grid size**:不用人工数"这图到底是 16×16 还是 32×32"——AI 出图最烦的就是网格数未知且被拉歪,它自动推断。
  - **工程友好**:OpenCV / 纯 numpy 双实现(不想装 cv2 也能用)、`debug` 出可视化、API 极简(`get_perfect_pixel(rgb) -> w,h,out`),还给了一段"让 ChatGPT/Gemini/SD 先出像素风"的提示词配方,前后衔接成完整素材管线。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **Simulaid 像素素材管线 ← 借「FFT 找网格 + Sobel 对齐 + 量化」做"生成后清洗"一步** ⭐⭐:玉兔6 的 Simulaid 像素办公室 / 工位角色若用 AI(SD/ChatGPT)出图,几乎必然网格错位(shimmer、边缘糊、块大小不齐)。perfectPixel 正是把这步**自动校正成真·像素**——直接补在素材生成之后、入库之前。MIT + 纯 numpy/cv2,**可文件化重实现也可直接 pip 引**,落地极轻。
  - **并入已有像素工作台卡 ← 作为其"质检 / 清洗"环节**:公告板已有两张 pending 卡 `insight-pixel-workbench-20260628-04` / `insight-dc7bddf71e`(像素素材生成工作台 UI/RFC spike)。perfectPixel 不必新开卡,**作为该工作台"生成 → 自动网格校正 → 量化入库"的清洗步**纳入即可。
  - **若走 ComfyUI ← 直接挂它的自定义节点**:如果 Simulaid 素材链路用 ComfyUI / SD,它已有现成节点,零改造接入。
- ④ 难度低 / 优先级中-高:纯算法、MIT、即用,直接解决一个真实痛点(AI 像素图网格错位),纯本地零外部依赖;唯一要圈的是"哪些素材该清洗(像素精灵)/ 哪些不该(矢量 UI、照片)"。
- 边界 / 许可证:**MIT 已核**,可直接 pip 引或重实现;输入仍需先有"像素风图"(它只做对齐 / 量化,不做风格生成)。**与 Starlaid 无关**。

### 3. AriaUI/Aria-UI — 纯视觉、**context-aware 的「动作 grounding」**模型:把历史动作(纯文 / 图文交错)当上下文喂进 grounding 来提升动态任务点选准确率;借的是这一**范式**,而非代码(⚠️ 仓库无 LICENSE,且为 2024-12 较旧)
- ① 名称 / URL:AriaUI/Aria-UI(Open-sourced, Fast and Context-aware Action Grounding from GUI Instructions for GUI / Computer-use Agents)— https://github.com/AriaUI/Aria-UI
- 核验(web_fetch 直读):**405★ / 42 forks / 14 commits** · **Python 100%** · **无 release** · **⚠️ 仓库无 LICENSE 文件**(README 之外无 License 标签 → GitHub 默认"保留所有权利",不可自由复用其代码 / 权重)· 模型 / 数据在 HuggingFace(Aria-UI-base、context-aware 版、~992K 上下文 episode 数据)。时间线偏旧:**2024-12 论文(2412.16256),2025-01~02 放出 context-aware 版与数据**,非"近期"。
- ② 优秀在哪 / 亮点:
  - **context-aware grounding(最值得看的点)**:不止"看当前截图 + 指令点哪里",而是**把历史输入(纯文本或图文交错的动作轨迹)一并作为上下文**,在 AndroidWorld / OSWorld 这类**动态多步任务**里显著提升点选准确率——即"知道我前几步干了啥"再决定这步点哪。
  - **纯视觉、不依赖 a11y 树**:只吃截图 + 指令,输出相对(0–1000)坐标,适配变分辨率 / 变长宽比、超分辨率;对**没有可访问性树的画面(游戏 / Canvas / 像素 UI)**更通用。
  - **轻量 MoE**:3.9B 激活参数 / token,SOTA(2024-12:AndroidWorld 44.8% 第 1、OSWorld 15.2% 第 3),小而强可作本地参考。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **computer-use / Simulaid 自动化点选 ← 借「把动作历史(图文交错)当 grounding 上下文」** ⭐:玉兔6 已有 `cu-postaction-screenshot-selfheal`(执行后截图比对 + 失败自愈),那是**事后**反思;Aria-UI 的范式补的是**事前** grounding 时就把"上一步截图 + 动作历史"作为上下文喂进去,减少多步任务里的误点——输入侧加历史、与输出侧自愈一前一后。
  - **无 a11y 画面的点选 ← 借「纯视觉 grounding」**:Simulaid 的像素 UI / 自绘画面没有 a11y 树,纯视觉坐标 grounding 比依赖控件树更通用。
  - 不直接引模型 / 权重:**只借设计范式**(详见边界)。
- ④ 难度中 / 优先级中-低:理念清晰可借,但①**仓库无 LICENSE → 不能搬代码 / 权重**;②**2024-12 较旧**,GUI grounding 已被近批 seen 库(UI-TARS / UGround / GUI-Actor / ClawGUI-Eval 覆盖的新模型)反超;③玉兔6 未必自训 grounding 模型。故仅作"输入侧加动作历史"的范式参考。
- 边界 / 许可证:**⚠️ 仓库未声明 LICENSE = 默认保留所有权利**——可阅读 / 借设计思路,**不可复制其代码或再分发权重**;Aria 基座模型在 HuggingFace 另有 Apache-2.0 口径,但**本 grounding 仓自身未声明**,如要用模型需另行核对其 HF 卡许可。玉兔6 **只借「动作历史做 grounding 上下文 + 纯视觉坐标」范式,用自家实现**,不搬运代码 / 权重。**与 Starlaid 无关**。

### 行动判断(是否加待办卡)
- **本轮不新增公告板待办卡,只写分析**,理由:① **像素域已有两张 pending 卡**(`insight-pixel-workbench-20260628-04`、`insight-dc7bddf71e`,像素素材生成工作台 UI/RFC spike)+ 路由评测卡(`insight-4231644170`)待 CEO 消化 —— perfectPixel 的"生成后清洗"应**并入既有像素工作台卡**作为质检步,不另开;② ClawGUI-Eval 的"标准化评测 + 复现率门"是给 CEO 的**范式取舍**(要不要给玉兔6 上一套能力 / 失败评测底座),且与 20:00 槽刚做的 skills 能力库 eval gate **高度重叠,建议合并讨论**而非各开一卡,属"非可越过决策的原子动作";③ 延续近批克制红线("不是待办任务"),公告板已有多张同源(洞察员)卡待 CEO 先消化。
- 最高优先可落地点 = **perfectPixel 并入像素工作台卡**(MIT、即用、纯本地)+ **ClawGUI-Eval 评测门与 skills 能力治理合并成一条"能力库 + 评测门"主线**,提请 CEO 评审后再决定开卡与否。

### 本批小结(给 CEO 的一句话借鉴)
- **ZJU-REAL/ClawGUI**:学它「**评测 Infer→Judge→Metric 三段式 + 95.8% 复现率门 + 一句话跑基准 + episode 录制**」,给玉兔6 能力 / 失败做**跨批可比**的评测底座;Apache-2.0、330★、2026-04 很新,借评测 / 部署 / 录制范式,**不引** Docker 安卓 RL 训练栈(重)。
- **theamusing/perfectPixel**:学它「**FFT 找网格 + Sobel 对齐 + 量化**」一步把 AI 脏像素图清洗成真·像素,直接补 Simulaid 素材网格错位;MIT、1.2k★、纯 numpy/cv2 可 pip 直用 → **并入已有像素工作台卡**。**(本批最即用、最该先做)**
- **AriaUI/Aria-UI**:学它「**把动作历史(图文交错)当 grounding 上下文**」提升动态点选准确率,与已有"执行后截图自愈"前后呼应;**但 405★ / 2024-12 较旧 + 仓库无 LICENSE → 只借范式、不搬代码 / 权重**。
- **本轮不新增待办卡**;perfectPixel 并入像素工作台卡、ClawGUI-Eval 评测门与 skills 能力治理合并讨论。**Starlaid / 星桥 全程排除。**

> watch(本批 web_fetch 直读元数据;HEAD commit SHA 因代理 git ls-remote 受限未取,待网络可达回填):ZJU-REAL/ClawGUI `master`(**Apache-2.0 → watch=true**,关注 Roadmap 的 Desktop / Web Online RL、On-device Agent、Eval 复现率与基准扩展,330★、2026-04 活跃)、theamusing/perfectPixel `main`(**MIT → watch=true**,关注是否补批处理 / 更稳的网格检测 / 更多 ComfyUI / Web 能力,1.2k★、纯 CV)、AriaUI/Aria-UI `main`(**无 LICENSE → watch=low 且谨慎**,仅关注是否补许可证;模型偏旧,优先看更新的 grounding 模型)。



<!-- insight-scout-run:20260629-00-llm-gateway -->
## LLM 网关 / 成本质量路由 / 可观测(slot=20260629-00)
> 来源:洞察员; network=available(GitHub 直读); 已比对 seen-repos.json、borrowed-libs.md、insights.md,本轮避开 LiteLLM/Portkey/Helicone/Langfuse/RouteLLM/TensorZero/prompt-cache/Trylon/llm-budget-proxy 等已见 URL; Starlaid/星桥 全程排除; 不登录不安装。

### agentgateway/agentgateway
- 是什么:Linux Foundation 下的 Apache-2.0 agentic proxy,同时覆盖 LLM/MCP/A2A,提供 OpenAI 兼容入口。
- 值得借鉴:预算/花费控制、负载均衡/failover、guardrails 与 OpenTelemetry 放在同一网关策略面,还能借 K8s Inference Routing 的 GPU/KV/队列深度信号。
- 迁移边界/许可证不确定项:Rust/Go/K8s Gateway API 栈偏重;控制台只借策略字段和观测事件,不接 runtime。
- URL: https://github.com/agentgateway/agentgateway

### openmeterio/openmeter
- 是什么:Apache-2.0 实时 usage metering/billing 平台,支持 CloudEvents、meters、quota/entitlements、prepaid credits 与 LLM cost tracking。
- 值得借鉴:把 token、模型、工位、项目预算做成可查询的账本事件,再由 meter/entitlement 触发限额、余额和 webhook 告警。
- 迁移边界/许可证不确定项:Postgres+ClickHouse+Kafka 对控制台过重;先借 CloudEvents schema、余额扣减和阈值通知语义。
- URL: https://github.com/openmeterio/openmeter

### traceloop/openllmetry
- 是什么:Apache-2.0 的 GenAI/LLM OpenTelemetry instrumentations,面向常见 provider、向量库和 agent framework。
- 值得借鉴:把 provider、prompt、completion、token、latency、vector DB 与 agent 调用统一成 OTEL span,可对齐控制台 run/step trace。
- 迁移边界/许可证不确定项:SDK 覆盖 Python/JS 生态;控制台不安装,先借 span/attribute 命名与 OTLP 出口兼容思路。
- URL: https://github.com/traceloop/openllmetry

### 行动判断
- 生成 1 张公告板候选:请 CEO 决定是否起草《控制台 LLM 网关账本/追踪契约 v0》,把 gateway event、cost ledger、routing decision、guardrail result、trace span 五类字段先统一成纯文档 schema;不引入新运行时。



<!-- insight-scout-run:cr-1782662442580-insight-scout-repos-20260629-00 -->
## 2026-06-28 · 自动洞察(20260629-00 · llm-gateway)

> 来源:洞察员; run=cr-1782662442580-insight-scout-repos-20260629-00; queue=insight-scout/insight-scout-repos-20260629-00; network=available

## LLM 网关 / 成本质量路由 / 可观测(slot=20260629-00)
> 来源:洞察员; network=available(GitHub 直读); 已比对 seen-repos.json、borrowed-libs.md、insights.md,本轮避开 LiteLLM/Portkey/Helicone/Langfuse/RouteLLM/TensorZero/prompt-cache/Trylon/llm-budget-proxy 等已见 URL; Starlaid/星桥 全程排除; 不登录不安装。

### agentgateway/agentgateway
- 是什么:Linux Foundation 下的 Apache-2.0 agentic proxy,同时覆盖 LLM/MCP/A2A,提供 OpenAI 兼容入口。
- 值得借鉴:预算/花费控制、负载均衡/failover、guardrails 与 OpenTelemetry 放在同一网关策略面,还能借 K8s Inference Routing 的 GPU/KV/队列深度信号。
- 迁移边界/许可证不确定项:Rust/Go/K8s Gateway API 栈偏重;控制台只借策略字段和观测事件,不接 runtime。
- URL: https://github.com/agentgateway/agentgateway

### openmeterio/openmeter
- 是什么:Apache-2.0 实时 usage metering/billing 平台,支持 CloudEvents、meters、quota/entitlements、prepaid credits 与 LLM cost tracking。
- 值得借鉴:把 token、模型、工位、项目预算做成可查询的账本事件,再由 meter/entitlement 触发限额、余额和 webhook 告警。
- 迁移边界/许可证不确定项:Postgres+ClickHouse+Kafka 对控制台过重;先借 CloudEvents schema、余额扣减和阈值通知语义。
- URL: https://github.com/openmeterio/openmeter

### traceloop/openllmetry
- 是什么:Apache-2.0 的 GenAI/LLM OpenTelemetry instrumentations,面向常见 provider、向量库和 agent framework。
- 值得借鉴:把 provider、prompt、completion、token、latency、vector DB 与 agent 调用统一成 OTEL span,可对齐控制台 run/step trace。
- 迁移边界/许可证不确定项:SDK 覆盖 Python/JS 生态;控制台不安装,先借 span/attribute 命名与 OTLP 出口兼容思路。
- URL: https://github.com/traceloop/openllmetry

### 行动判断
- 生成 1 张公告板候选:请 CEO 决定是否起草《控制台 LLM 网关账本/追踪契约 v0》,把 gateway event、cost ledger、routing decision、guardrail result、trace span 五类字段先统一成纯文档 schema;不引入新运行时。



<!-- insight-scout-run:run-20260628T1605Z-insight-scout-repos -->
## 2026-06-29 · 自动洞察(run-20260628T1605Z · 多智能体编排 + 优秀网页设计)
> 来源:洞察员;run=run-20260628T1605Z-insight-scout-repos(UTC 2026-06-28T16:05Z = 北京 2026-06-29 00:05)。**注:紧邻的 00 槽(同一北京 00:0x)刚被一次 LLM 网关运行占用(slot=20260629-00,agentgateway/openmeter/openllmetry,约 2 分钟前)**,故本轮不再碰网关,轮回到**最久未做的两题:多智能体编排(上次 run-20260627T1605Z,约 24h+ 前)+ 优秀网页设计(上次 slot 20260628-04,约 20h 前,且当时与像素并题)**。
> network=available(WebSearch + web_fetch 直读 GitHub 仓库页 / LICENSE 口径,star/license/commit 为抓取当下数值,人工复核为准)。
> 去重:已比对 seen-repos.json(271 条)+ borrowed-libs.md + references/borrowed-watch.json;本轮 3 例(openai/symphony、ruvnet/ruflo、Kibo UI)均未出现(追加后 274 条)。**Starlaid / 星桥 全程排除**(三例均不涉及)。

### 1. openai/symphony — 把「项目看板」变成编码 agent 的 control plane:每个 open task 派一个自治 run,完成后交「proof of work」过验收门才 land;最该借的是 **「看板即 control plane + proof-of-work 验收门 + spec-first 契约」**,正补玉兔6 公告板「卡→done 之间没有结构化工作证明 / 验收闭环」的缺口
- ① 名称 / URL:openai/symphony(Symphony turns project work into isolated, autonomous implementation runs;OpenAI 官方)— https://github.com/openai/symphony
- 核验(web_fetch 直读):**Apache-2.0** · **22.4k★ / 2.1k forks / 12 commits** · **Elixir 95.5% + Python 3.0% + CSS 1.2%** · **无 release**(明确标注 "low-key engineering preview")· 配套站 openai.com/index/open-source-codex-orchestration-symphony/。仓库本体很薄:`SPEC.md`(契约) + `elixir/`(参考实现) + LICENSE/NOTICE;OpenAI 明确**不打算把它维护成产品,repo 当「参考」**,并号召「用你喜欢的语言按 SPEC 自建」(Demo 中用 Codex 一次性跨 TS/Go/Rust/Java/Python 压测同一份 spec)。
- ② 优秀在哪 / 亮点:它把「让 agent 干活」从「逐条盯着 agent」抬升到「管理要做的工作」:
  - **看板即 control plane**:Demo 中 Symphony 监控一块 **Linear 看板**,有新 work 就 spawn 一个 agent;人不再监督 agent,而是在更高层「管 work」。
  - **每个 open task 一个 agent、持续运行、人只 review 结果**——把「一堆卡」自动摊给一群隔离自治的 implementation run。
  - **proof-of-work 作为 land 前的验收门(最该看的点)**:agent 完成后给出**结构化「工作证明」**——CI 状态 + PR review 反馈 + 复杂度分析 + walkthrough 视频;**被接受才安全 land PR**。即「done 之前先交可核验的证据」。
  - **spec-first / 语言无关**:`SPEC.md` 才是契约(如何读 issue tracker、如何跑 coding agent、如何把每个任务管到 PR),参考实现只是其一;天然支持多 runtime / 多 agent 对齐。
  - **isolated, autonomous implementation runs**:每个任务在隔离环境里自治跑,互不污染。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **公告板 / cards.json ← 借「看板即 control plane + 每卡一 run + proof-of-work 验收门」** ⭐⭐:玉兔6 已有 cards.json 公告板,且公告板上正挂着「**起草控制台任务 DAG/交接协议 v0**」卡(洞察员同源)。Symphony 恰好补上「卡 → 自治 run → 结构化工作证明(日志/测试/截图/复杂度) → 通过才进 done/合入」的**闭环与验收字段**——建议**直接并入既有「任务 DAG/交接协议 v0」卡**,不另开。
  - **编排契约 ← 借 spec-first**:把玉兔6 的编排 / 交接写成**语言无关 SPEC**(像 `SPEC.md`),控制台实现只是参考实现之一,便于多工位 / 多 runtime 一致——正中那张卡的「契约 v0」诉求。
  - **控制台一句话运维 ← 借「管 work、不管 agent」心智**:对话运维聚焦「要完成的工作」,而非逐个监督工位。
  - **隔离自治 run ← isolated implementation runs**:呼应近批 durable / effect-log 的「任务隔离、可录制回放」。
- ④ 难度中 / 优先级高:**验收门 + spec 契约是纯流程 / 数据契约**,易在控制台用自家脚本复刻、且**有现成卡可并**,低风险高对齐;但其 **Elixir 参考实现 + 「harness engineering」前提偏重**,玉兔6 **只借范式(看板控制面 / 工作证明 / spec 契约),不引其运行时**。
- 边界 / 许可证:**Apache-2.0 已核**,读借友好;但 **engineering preview、仅 12 commits、无 release** → 看的是「理念与 SPEC」,不依赖其代码成熟度,落地以玉兔6 自实现为准。**与 Starlaid 无关**。

### 2. ruvnet/ruflo(原 Claude Flow)— 体量最大的开源多智能体「元 harness」:hive-mind + 60+ 专职 agent + SPARC 方法论 + 自适应记忆;借的是**角色库 / 方法论 / 记忆范式**,⚠️ 性能数字为二手需复核、底层耦合第三方 Cognitum.One,**不引 runtime**
- ① 名称 / URL:ruvnet/ruflo(原 Claude Flow;"Claude Flow is now Ruflo")— https://github.com/ruvnet/ruflo
- 核验(web_fetch 直读):**MIT** · **61.8k★ / 7.2k forks / 7,082 commits** · **TypeScript 82.5% + Rust 0.6%**(README 自述底层 **Cognitum.One** 的 Rust 引擎 + embeddings/memory/plugin)。README 称其为「最广泛采用的开源多智能体平台」,主打 **hive-mind 架构 + SPARC 方法论 + 60+ 专职 agent + 自适应记忆 + RAG**。⚠️ 二手来源(社区文章)提到 **SWE-bench 84.8% / 省 75% API 成本**——**未在官方页核到,谨慎引用、勿对外当结论**。
- ② 优秀在哪 / 亮点:
  - **成体系的角色库 + 方法论**:60+ 专职 agent 配 **SPARC**(Specification→Pseudocode→Architecture→Refinement→Completion)等标准流程,把「多 agent 怎么分工、按什么步骤推进」模板化。
  - **自适应记忆 / embeddings / RAG / plugin**:跨任务记忆 + 可插拔能力,工程化程度高。
  - **Rust 引擎做性能底座**(第三方 Cognitum.One),TS 上层编排。
  - **体量与社区**:7,082 commits、61.8k★、7.2k forks → 成熟度与活跃度极高。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **能力 / 角色库 ← 借「60+ 专职 agent 清单 + SPARC 标准方法论」的组织方式** ⭐:对口公告板既有「**起草控制台能力库信任 / 入库契约 v0**」卡——可参考其「角色清单 + 标准流程(plan→…→commit)」来规范玉兔6 工位 / 能力库的角色与流程模板。
  - **跨会话记忆 ← 借自适应记忆 / embeddings / RAG**:延续近批 memory(letta / mem0 / graphiti)分析,作工位跨任务记忆的范式参考。
  - **省 token 心智 ← 谨慎参考其成本主张**:不照搬数字,但「编排层省 token」对口已分析的 gateway 语义缓存。
  - 不引其 runtime(体量重、品牌 / 商业耦合 Cognitum.One)。
- ④ 难度中-高 / 优先级中:**角色库与方法论可借**,但①**体量巨大**、②**底层耦合第三方 Cognitum.One**、③**关键性能数字为二手需官方复核**;玉兔6 **只借「角色库 + 方法论 + 记忆」范式,不引运行时**。MIT 已核。
- 边界 / 许可证:**MIT 已核**可读借;但**性能数字(84.8% / 省 75%)为二手,未经复核勿对外引用**;底层 Cognitum.One 为第三方,避免运行时耦合。**与 Starlaid 无关**。

### 3. Kibo UI(shadcnblocks/kibo,原 haydenbleasel/kibo)— 一套 **shadcn registry 的高阶组件库**:Kanban / Gantt / code block / AI 对话 / table 等「控制台积木」,`npx shadcn add` 一行装、源码进项目可裁剪;直接对口玉兔6 公告板 / 控制台的 Web 化
- ① 名称 / URL:Kibo UI(A custom registry of composable components for shadcn/ui;原作者 Hayden Bleasel,**2025-10 被 Shadcnblocks 接手,仓库已迁到 shadcnblocks/kibo,旧地址 haydenbleasel/kibo 自动重定向**)— https://github.com/haydenbleasel/kibo
- 核验(web_fetch 直读,跟随重定向到 shadcnblocks/kibo):**MIT** · **3.8k★ / 178 forks / 492 commits** · **TypeScript 97% + MDX 2.5%** · 站点 www.kibo-ui.com · 安装 `npx shadcn add @kibo-ui`(或 `npx kibo-ui add`)。**41 个核心组件 / 1000+ 变体**:Kanban、Gantt、code block、AI conversation / editor、table、dropzone、color picker、QR 等;用 **shadcn/ui 的 CSS 变量**,作为更复杂组件的 building blocks。
- ② 优秀在哪 / 亮点:
  - **shadcn registry 模式(不是 npm 黑盒)**:组件**源码复制进你的项目**、可改可控、可裁剪,`npx shadcn add @kibo-ui` 一行接入——避免重型 UI 依赖锁定。
  - **正好覆盖控制台高频「高阶」组件**:**Kanban(看板!)、Gantt(甘特)、code block、AI 对话、table、dropzone**——这些正是公告板 / 控制台运维台最需要、又最不想自研的部件。
  - **与 shadcn/ui 同源、零割裂**:复用 shadcn CSS 变量,接进玉兔6 既有 shadcn 生态(seen 库已含 shadcn-ui / magicui / tabler / shadcn-admin)无设计体系冲突。
  - **MIT、TS 97%、源码可读可裁剪**,落地极轻。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **公告板 UI ← 借 Kibo「Kanban」组件** ⭐⭐:玉兔6 cards.json 公告板若做 Web 看板,**Kibo Kanban(拖拽列 / 卡)可直接 `npx shadcn add` 进来再裁剪**,省自研拖拽。
  - **长任务 / 队列可视化 ← 借「Gantt / list」**:durable / 队列长任务的时间线可用其 Gantt 呈现。
  - **控制台运维台 ← 借「code block / AI conversation / table」**:对话运维、日志 / diff 展示、run 列表都能拿现成高阶组件拼。
  - **接入零割裂 ← shadcn 同源**:与既有 shadcn 生态统一,不引新设计体系。
- ④ 难度低 / 优先级中-高(看板 / 甘特即用):纯前端、MIT、shadcn registry **源码进项目可控**,直接补公告板 / 控制台 UI;唯一要圈的是「哪些组件进库」以免膨胀。
- 边界 / 许可证:**MIT 已核(license.md)**;**注意仓库已从 haydenbleasel/kibo 迁到 shadcnblocks/kibo**(旧链接重定向),引用 **pin 版本**即可;只借前端组件,**与后端编排 / Simulaid 无关**。**与 Starlaid 无关**。

### 行动判断(是否加待办卡)
- **本轮不新增公告板待办卡,只写分析**,理由:① 公告板已有 **4 张同源(洞察员)「起草…契约 v0」卡待 CEO 消化**(任务 DAG/交接协议、队列失败处置、能力库信任入库、LLM 网关账本 / 追踪),其中「**任务 DAG/交接协议 v0**」**正是 Symphony 的归并目标**——Symphony 的「proof-of-work 验收门 + 看板即 control plane」应**并入该卡**,不另开;② **Kibo UI 是纯前端即用件**,属「落地实现」而非「决策契约」,待公告板 Web 化时直接 `npx shadcn add` 取用,无需单独开卡;③ **ruflo 是范式 / 角色库参考**,且关键性能数字为二手需复核,不构成「立刻做的原子动作」;④ 延续近批克制红线(「不是待办任务」),避免在 CEO 未消化既有 4 卡前继续堆卡。
- 最高优先可落地点 = **Symphony 的「proof-of-work 验收门 + spec 契约」并入既有「任务 DAG/交接协议 v0」卡** + **Kibo Kanban 作为公告板 Web 化的现成前端件**(MIT、一行装),提请 CEO 评审后再决定落地节奏。

### 本批小结(给 CEO 的一句话借鉴)
- **openai/symphony**:学它「**看板即 control plane + proof-of-work 验收门 + spec-first 契约**」,给玉兔6 公告板补「卡 → 自治 run → 工作证明 → 通过才合入」闭环;Apache-2.0、22.4k★、2026 很新,**并入既有「任务 DAG/交接协议 v0」卡,不引 Elixir 运行时**。
- **ruvnet/ruflo(原 Claude Flow)**:学它「**60+ 专职 agent + SPARC 方法论 + 自适应记忆**」的角色库 / 方法论组织;MIT、61.8k★ 体量大,但**性能数字二手需复核 + 底层耦合 Cognitum.One,只借范式不引 runtime**。
- **Kibo UI**:学它「**shadcn registry 高阶组件(Kanban / Gantt / code block)**」,公告板 / 控制台 Web 化可一行 `npx shadcn add @kibo-ui` 取用;MIT、3.8k★、TS 97%、源码可裁剪。**(本批最即用、最该先做)**
- **本轮不新增待办卡**;Symphony 并入既有编排卡、Kibo 待 Web 化取用、ruflo 仅作角色库 / 方法论参考。**Starlaid / 星桥 全程排除。**

> watch(本批 web_fetch 直读元数据;HEAD commit SHA 因代理 git ls-remote 受限未取,待网络可达回填):openai/symphony `main`(**Apache-2.0 → watch=true**,关注 `SPEC.md` 演进 / 是否出更多语言参考实现 / 是否从 engineering preview 转正,22.4k★、仅 12 commits 极早期)、ruvnet/ruflo `main`(**MIT → watch=true 但谨慎**,关注官方 benchmark 复核 / 对 Cognitum.One 的耦合度 / v3 稳定性,61.8k★、7k+ commits)、shadcnblocks/kibo `main`(**MIT → watch=true**,关注组件增补 / 是否保持 "free & open source forever" / 迁仓后维护活跃度,3.8k★、492 commits、TS 97%)。



<!-- insight-scout-run:20260629-04-gui-grounding -->
## GUI grounding / computer-use / a11y(slot=20260629-04)
> 来源:洞察员; network=available(WebSearch + GitHub API/页面核验); 已比对 seen-repos.json、borrowed-libs.md、insights.md,本轮 3 例均未登记; 不登录、不安装、不改运行代码。

### lahfir/agent-desktop
- 是什么:Apache-2.0 的 Rust 桌面自动化 CLI,用 OS accessibility tree 输出 snapshot_id/@e refs/结构化 JSON。
- 值得借鉴:a11y-tree-first、progressive skeleton、actionability preflight、STALE_REF/AMBIGUOUS_TARGET 等错误契约。
- 迁移边界/许可证不确定项:当前 macOS 主可用,Windows/Linux 仍 planned;需要系统辅助功能授权,只能主人手动授权。
- URL:https://github.com/lahfir/agent-desktop

### ServiceNow/GroundCUA
- 是什么:桌面 grounding 数据与 GroundNext 模型,覆盖 56K 截图、3.56M+ 标注、87 个应用。
- 值得借鉴:密集小控件标注、类别信息和跨桌面/移动/Web 的评测口径,可借来设计离线评测集。
- 迁移边界/许可证不确定项:GitHub API 显示 license=null;模型/数据在 HF 的条款需单独复核,不可直接用权重或数据。
- URL:https://github.com/ServiceNow/GroundCUA

### huggingface/screensuite
- 是什么:Apache-2.0 的 GUI agent benchmark suite,合并 perception/grounding/single-step/multi-step 多类基准。
- 值得借鉴:benchmark registry、EvaluationConfig、metrics JSONL 可作为控制台 computer-use 回归评测的轻量字段参考。
- 迁移边界/许可证不确定项:Docker/KVM/uv/submodule 运行栈偏重;只借指标目录与结果 schema,不引 runtime。
- URL:https://github.com/huggingface/screensuite

### 行动判断
- 生成 1 张公告板候选:请 CEO 决定是否起草《控制台 computer-use 观察/动作契约 v0》,先纯文档统一 a11y tree 优先、视觉兜底、snapshot ref、机器可读错误、动作前检查与动作后证据字段。



<!-- insight-scout-run:cr-1782676843032-insight-scout-repos-20260629-04 -->
## 2026-06-28 · 自动洞察(20260629-04 · gui-grounding)

> 来源:洞察员; run=cr-1782676843032-insight-scout-repos-20260629-04; queue=insight-scout/insight-scout-repos-20260629-04; network=available

## GUI grounding / computer-use / a11y(slot=20260629-04)
> 来源:洞察员; network=available(WebSearch + GitHub API/页面核验); 已比对 seen-repos.json、borrowed-libs.md、insights.md,本轮 3 例均未登记; 不登录、不安装、不改运行代码。

### lahfir/agent-desktop
- 是什么:Apache-2.0 的 Rust 桌面自动化 CLI,用 OS accessibility tree 输出 snapshot_id/@e refs/结构化 JSON。
- 值得借鉴:a11y-tree-first、progressive skeleton、actionability preflight、STALE_REF/AMBIGUOUS_TARGET 等错误契约。
- 迁移边界/许可证不确定项:当前 macOS 主可用,Windows/Linux 仍 planned;需要系统辅助功能授权,只能主人手动授权。
- URL:https://github.com/lahfir/agent-desktop

### ServiceNow/GroundCUA
- 是什么:桌面 grounding 数据与 GroundNext 模型,覆盖 56K 截图、3.56M+ 标注、87 个应用。
- 值得借鉴:密集小控件标注、类别信息和跨桌面/移动/Web 的评测口径,可借来设计离线评测集。
- 迁移边界/许可证不确定项:GitHub API 显示 license=null;模型/数据在 HF 的条款需单独复核,不可直接用权重或数据。
- URL:https://github.com/ServiceNow/GroundCUA

### huggingface/screensuite
- 是什么:Apache-2.0 的 GUI agent benchmark suite,合并 perception/grounding/single-step/multi-step 多类基准。
- 值得借鉴:benchmark registry、EvaluationConfig、metrics JSONL 可作为控制台 computer-use 回归评测的轻量字段参考。
- 迁移边界/许可证不确定项:Docker/KVM/uv/submodule 运行栈偏重;只借指标目录与结果 schema,不引 runtime。
- URL:https://github.com/huggingface/screensuite

### 行动判断
- 生成 1 张公告板候选:请 CEO 决定是否起草《控制台 computer-use 观察/动作契约 v0》,先纯文档统一 a11y tree 优先、视觉兜底、snapshot ref、机器可读错误、动作前检查与动作后证据字段。



<!-- insight-scout-run:run-20260628T2004Z-insight-scout-repos -->
## 2026-06-29 · 自动洞察(run-20260628T2004Z · Unity/Simulaid + 像素素材与画风)
> 来源:洞察员;run=run-20260628T2004Z-insight-scout-repos(UTC 2026-06-28T20:04Z = 北京 2026-06-29 04:04)。**轮题理由**:近 ~12h 槽位密集偏「agent 基础设施」侧(20260629-04 GUI grounding 刚做、20260629-00 LLM 网关、run-1605Z 多智能体+网页设计、20260628-16 队列、20260628-20 skills 治理);轮回到**最久未做的 Unity(Simulaid),上次 slot 20260628-08 约 20h 前**,并配**像素素材与画风**,凑成「Simulaid 创作/视觉」一批,平衡近批的后端/编排倾斜。
> network=available(WebSearch + web_fetch 直读 GitHub 仓库页 / README / LICENSE 口径,star/license/commit 为抓取当下数值,人工复核为准)。
> 去重:已比对 seen-repos.json(277 条)+ borrowed-watch.json + insights 近批;本轮 3 例(xpTURN/Klotho、EYamanS/texel-studio、aleksandrbazhin/TilePipe)均未登记(追加后 280 条)。**Starlaid / 星桥 全程排除**(三例均不涉及)。

### 1. xpTURN/Klotho — 「确定性优先」的 Unity 多人仿真框架:无浮点(FP64 定点 + Xorshift128+)保证跨平台逐帧可复现 + 录制/回放(可 seek/变速)+ 严格「仿真/表现」分层 + GGPO 式确定性自检;**最该借的是把 Simulaid 做成「可复现 + 可录制回放 + 可自检」的仿真内核范式**
- ① 名称 / URL:xpTURN/Klotho(Deterministic Multiplayer Simulation Framework for Unity)— https://github.com/xpTURN/Klotho
- 核验(web_fetch 直读):**Apache-2.0** · **3★ / 0 forks / 10 commits** · **C# 97.6% + ShaderLab 2.0%** · Unity 2022.3+ · **无 release**,README 顶部明确标注 **"Experimental Release / under active development, 不建议生产使用,API/序列化/协议可能随时变"**。体量极小、极早期,但**设计密度极高**。
- ② 优秀在哪 / 亮点:
  - **确定性优先(Determinism first)**:**完全弃用浮点**,仿真状态只用 `FP64`(32.32 定点)/ 整数 / bool + 自带 `DeterministicRandom`(Xorshift128+)+ LUT/CORDIC 三角函数 → **跨平台 / 跨编译器逐帧可复现**。
  - **录制 / 回放系统**:Replay 支持 **record / playback / seek / 变速** + LZ4 压缩(`ReplayRecorder`/`ReplayPlayer`),把一局仿真变成可回看、可跳帧、可复盘的产物。
  - **严格「仿真层 / 表现层」分层**:`ISimulationCallbacks`(确定性)与 `IViewCallbacks`(非确定性表现)强制分离;**核心是纯 C#、零 `UnityEngine` 依赖**,同一份仿真二进制**也能在服务器侧(.NET console/ASP.NET)无头运行** → 可大规模 headless 跑仿真、按需才上 Unity 可视化。
  - **GGPO 式确定性自检(最该看的工程点)**:内置 `SyncTestRunner` / `DeterminismVerificationRunner` + 帧 hash 校验 + benchmark 套件,**把「非确定性(浮点泄漏 / 执行顺序 bug)」做成可自动捕获的回归门**。
  - **ECS 帧模型 + 回滚**:`Frame`(单块 byte[] 堆)+ `FrameRingBuffer`(快照 / rollback)+ sparse-set `ComponentStorage<T>` + `SystemRunner`;配 Roslyn source generator(`[KlothoComponent]` 等)做 GC-free 序列化(`SpanWriter/Reader`)。
  - **最小带宽 / Zero-GC 取向**:只发输入(命令)、不发状态(仅 hash 校验);ref struct + 对象池 + 无 LINQ。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **Simulaid 仿真内核 ← 借「确定性优先(无浮点 + 定点 + 确定性 RNG)」范式** ⭐⭐:让 Simulaid 的场景跑「同 seed + 同输入 → 同结果」逐帧可复现,是「可复现实验 / 可复盘」的地基。
  - **Simulaid 录制回放 ← 借 Replay(record/seek/变速 + LZ4)**:延续近批 durable / effect-log 的「任务隔离、可录制回放」线,把 Simulaid run 做成可 seek / 变速回看的产物。
  - **Simulaid 工程架构 ← 借「仿真/表现分层 + 纯 C# 无头核」**:核心与 Unity 解耦 → 可在控制台 / 服务器 **headless 批量跑仿真**(对接队列引擎做大规模 run),只在需要时挂 Unity 可视化;天然契合玉兔6「控制台编排 + Simulaid 执行」的分工。
  - **Simulaid 验收门 ← 借 GGPO 式确定性自检(SyncTestRunner)**:把「这次 run 是否确定性」做成 CI 门 —— 正好把近批 Symphony 的「proof-of-work 验收门」思路落到 Simulaid 仿真上(确定性 hash 校验作为「工作证明」的一种)。
- ④ 难度中-高 / 优先级中:**「确定性 + 录制回放 + 分层 + 自检」是范式层借鉴**,价值高且对口 Simulaid 痛点;但**定点化改造本身偏重**(无浮点是硬约束),且仓库 **3★ / 10 commits / experimental,成熟度与采用度都很低** → **只借设计范式,不引其 runtime / 不依赖其代码成熟度**,落地以玉兔6 自实现为准。
- 边界 / 许可证:**Apache-2.0 已核**,读借友好;**但极早期(experimental、API 不稳、无 release、3★)** → 看的是「确定性 / 回放 / 分层 / 自检」这套**设计主张**,不是它的工程完成度。**与 Starlaid 无关**。

### 2. EYamanS/texel-studio — 「AI agent 用画笔工具逐像素作画(而非扩散)」的像素素材引擎:离散绘图工具 + `view_canvas` 自检回路 + 调色板精确出图 + 自动拼图;**双线对口玉兔6(像素素材 + agent 工具/skills 设计)**,⚠️ 许可证为 source-available 非 OSI
- ① 名称 / URL:EYamanS/texel-studio(AI pixel art agent that paints like a real artist — not diffusion;texel.studio 的开源引擎)— https://github.com/EYamanS/texel-studio
- 核验(web_fetch 直读):**Source-available(非 OSI)** —— LICENSE 原话「自由 self-host / 修改 / 商用 / 卖你生成的东西,**唯一限制:不得作为竞品 SaaS 托管**」· **16★ / 0 forks / 20 commits** · **Python 57.8% + TypeScript 33.7%**(FastAPI + LangGraph + LangChain;前端 Next.js)。
- ② 优秀在哪 / 亮点:
  - **工具化逐像素作画(非扩散,最该看的点)**:agent 不是出一张扩散图,而是**像人类像素画师一样调用离散工具**逐像素摆放 ——「画 → 退一步看 → 决定改哪里」。对比扩散:扩散=模糊近似 / 颜色随机 / 黑盒 / 几乎不可拼接;它=**调色板精确索引像素 / 确定性工具调用 / 干净边缘 / 看着它一步步画 / 内建自动拼图**。
  - **工具分三类、含「检视」工具**:绘图(`draw_pixel`/`fill_rect`/`draw_line` Bresenham/`draw_circle`/`draw_triangle`/`draw_rotated_rect`)、纹理(`noise_fill`、`voronoi_fill` 做石头/卵石/有机表面)、**检视(`view_canvas` 看当前像素网格 + 配色用量、`get_pixel`)** —— 检视工具让 agent **能「看见」自己画的东西并决定下一步**,闭合「动作→观察→修正」回路。
  - **工程化 agent run 架构**:**SSE 实时流式**看 agent 作画 + **同会话 chat 续画**(「把顶部调暗」就接着画)+ 概念图先行(画前先生成参考图)+ **Redis 队列并发** + **worker 会话亲和**(续画自动路由到持有该 agent 会话的 worker)+ 可选 **LangSmith/PostHog 可观测**(token/延迟/成本追踪)。
  - **自动拼图**:一键 `Generate Tileset` 生成全 16 个 autotile 边缘变体(边缘压暗 / 外描边 / 圆角)。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **像素素材生成 ← 借「工具化逐像素作画(替代扩散)」范式** ⭐⭐:玉兔6 若给 Simulaid 产像素资产,**用「agent 调绘图工具」出图比扩散更可控**(调色板一致、边缘干净、可拼接、可复现);直接对口公告板既有 **「像素素材生成工作台 UI/RFC spike」** 卡 —— 这正是该卡最该参考的范式样板。
  - **AI agent 工具与 skills 设计 ← 借「mutate 工具 + inspect 工具成对、agent 自检回路」** ⭐:玉兔6 能力库设计可吸收「每类能力都配检视工具(`view_canvas`/`get_pixel`),让 agent 看到自己动作的结果再决定下一步」—— 通用的 skill 设计原则(动作 + 观察成对),不止用于像素。
  - **控制台 / 队列 ← 借「SSE 流式看 run + 同会话续作 + 队列并发 + worker 会话亲和」**:对口近批队列引擎线 —— **续作路由到持有会话的 worker(session affinity)** 是个具体可借的派单/路由模式;流式看 run、会话续作也契合控制台运维台。
  - **像素拼图 ← 借自动 16 变体 autotile**:与下条 TilePipe 互补(此处是 AI 生成,下条是规则生成)。
- ④ 难度低-中 / 优先级中-高(范式即用):模式都很易借(Python/LangGraph,纯设计层),且**有现成卡(像素工作台 spike)可并**;价值在「工具化作画 + agent 自检回路 + 会话亲和派单」三个范式。
- 边界 / 许可证:⚠️ **许可证是 source-available、非 OSI** —— **可 self-host/改/商用/卖产物,但「不得做成竞品 SaaS 托管」**;玉兔6 **内部借范式无虞,但任何对外产品化须先核非竞争条款**;另需第三方 LLM key(Gemini/OpenAI)运行。**只借设计范式,不直接托管其服务**。**与 Starlaid 无关**。

### 3. aleksandrbazhin/TilePipe(TilePipe2)— 规则 + 模板 + 邻接位掩码的「自动拼图管线」:**只画中心/边/角几块,自动生成 47/16/256 全变体**;ruleset 为带 schema 的 JSON、模板为 PNG,**数据全显式可进 Git**;借的是**「少画几块 → 规则生成全变体 + 资产可版本化」**的像素管线方法
- ① 名称 / URL:aleksandrbazhin/TilePipe(A tool to build tilesets,"tileset pipeline")— https://github.com/aleksandrbazhin/TilePipe
- 核验(web_fetch 直读):**MIT** · **73★ / 6 forks / 492 commits** · **GDScript 94% + Python 3.8% + GLSL 2.2%**(Godot 项目)· **最新 release 2.0.alpha.7(2022-12-12,共 7 个 release)** → 方法成熟、但**发布偏旧、仍 alpha**。
- ② 优秀在哪 / 亮点:
  - **少画几块 → 自动出全变体**:不必手画 47 或 255 个瓦片变体,**只画中心 / 边 / 角等少数 part**,靠 ruleset + template 组合出全部变体;改一处自动重算全集。
  - **邻接位掩码(neighbor bitmask)驱动**:8 个邻居顺时针计 0–255 位掩码,template 为每个 bitmask 指定子瓦片摆位;支持 **47-blob / 16-blob / 256 全集**,可自定义 ruleset 生成「几乎任意」≤256 变体规则。
  - **数据全显式、VCS-ready(最该看的点)**:**ruleset 是带 JSON schema + 自动校验脚本的 JSON,template 是 PNG**,无内建隐藏逻辑 → **所有改动可进 Git 追踪、可复现**;创作者能长期依赖、安全投入。
  - **职责单一**:只做 autotile 生成,把地图编辑交给游戏引擎(对比 LDtk 开源 / TileSetter 闭源,二者都自带地图编辑器)。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **像素 / 瓦片管线 ← 借「少画 part → 规则 + 位掩码 → 全变体」方法** ⭐:玉兔6 给 Simulaid 出地形 / 瓦片时,**画几块 part 自动铺全集**,省去手画几十上百变体;与上条 texel-studio 的「AI 生成」互补(此为**确定性规则生成**,可审计)。
  - **像素资产治理 ← 借「ruleset = 带 schema 的 JSON + template = PNG、数据全显式可进 Git」** ⭐:把玉兔6 的像素 / 瓦片资产做成**「parts + ruleset 可复现产物」而非不透明 PNG**,对口近批 dagster「产物即资产、可版本 / 可复现」治理线 —— 资产从「源 parts + 规则」可重建,changes 可 diff。
  - **职责分层 ← 借「只做生成、地图编辑交引擎」**:玉兔6 像素工作台聚焦素材生成,不重造编辑器。
- ④ 难度低 / 优先级低-中:方法聚焦、易借;但**①Godot/GDScript runtime(非玉兔6 栈)、②最新 release 停在 2022 alpha(偏旧)、③导出仅 PNG / Godot3 tileset(Tiled 导出仍 planned)** → **只借方法(parts→ruleset/bitmask→变体 + JSON-schema 数据治理),不引 Godot runtime**。MIT 已核。
- 边界 / 许可证:**MIT 已核**可读借;但 **Godot 实现 + 2022 alpha 偏旧 + 导出格式有限** → 借的是「自动拼图方法论 + 资产可版本化」,落地以玉兔6 自实现为准。**与后端编排 / Simulaid 仿真核无关、与 Starlaid 无关**。

### 行动判断(是否加待办卡)
- **本轮不新增公告板待办卡,只写分析**,理由:① 公告板已有 **26 张 source=洞察员 卡(todo+enabled)待 CEO 消化**,且**本轮两题都已有对口卡**——Unity/Simulaid 对应 **`insight-c680f4033c` 固化 Unity/团结工作流借鉴清单**,像素对应 **`insight-dc7bddf71e` / `insight-pixel-workbench-20260628-04` 像素素材生成工作台 UI/RFC spike(已两张)**;② 本轮三例均属**范式 / 设计借鉴**(确定性仿真核 / 工具化作画 / 规则拼图),非「立刻该做的原子动作」,应**并入既有卡**而非另开;③ 延续近批克制红线(「不是待办任务」),避免在 CEO 未消化 26 卡前继续堆卡。
- 归并建议(并入既有卡,不新增):**Klotho 的「确定性 + 录制回放 + 仿真/表现分层 + GGPO 自检」→ 并入 `固化 Unity/团结工作流借鉴清单`**;**texel-studio 的「工具化逐像素作画 + agent 自检回路 + 会话亲和派单」+ TilePipe 的「parts→ruleset/bitmask→全变体 + 资产可版本化」→ 并入 `像素素材生成工作台 UI/RFC spike`**。

### 本批小结(给 CEO 的一句话借鉴)
- **xpTURN/Klotho**:学它把 Simulaid 做成「**无浮点确定性仿真核 + 可 seek/变速录制回放 + 仿真/表现分层无头跑 + GGPO 式确定性自检**」;Apache-2.0、但 **3★/experimental,只借范式不引 runtime**,并入既有 Unity 借鉴卡。
- **EYamanS/texel-studio**:学它「**AI agent 用离散工具逐像素作画(替代扩散)+ `view_canvas` 自检回路 + 会话亲和派单**」,双线补玉兔6 像素素材与 agent skills 设计;⚠️ **source-available 非 OSI(不得做竞品 SaaS),内部借范式无虞、对外产品化须核条款**。**(本批最对口「像素工作台」卡)**
- **aleksandrbazhin/TilePipe**:学它「**少画几块 part → 规则 + 邻接位掩码自动出全变体 + ruleset/template 全显式可进 Git**」的自动拼图与资产可版本化方法;MIT、73★,但 **Godot/2022 alpha,只借方法不引 runtime**。
- **本轮不新增待办卡**;三例分别并入既有「Unity 借鉴清单」与「像素工作台 spike」卡。**Starlaid / 星桥 全程排除。**

> watch(本批 web_fetch 直读元数据;HEAD commit SHA 因代理 git ls-remote 受限未取,待网络可达回填):xpTURN/Klotho `main`(**Apache-2.0 → watch=true 但谨慎**,关注是否脱离 experimental / 出 release / 确定性自检与回放 API 稳定度,3★、10 commits 极早期)、EYamanS/texel-studio `main`(**source-available 非 OSI → watch=true 但标注条款**,关注 agent 工具集扩展 / 是否转 OSI / autotile 与会话路由演进,16★、20 commits)、aleksandrbazhin/TilePipe `master`(**MIT → watch=true**,关注是否出 Tiled 导出 / 脱离 2022 alpha / ruleset GUI 编辑器,73★、492 commits、GDScript)。



<!-- insight-scout-run:20260629-08-pixel-assets-ui -->
## 像素素材生成 / 控制台优秀网页设计(slot=20260629-08)
> 来源:洞察员; network_status=available(GitHub API/README 只读); 已比对 `seen-repos.json`、`borrowed-libs.md`、`insights.md`,本轮 3 个 URL 未命中; 不登录、不安装、不改运行代码; Starlaid/星桥 全程排除。

### HappyOnigiri/PixelRefiner
- 是什么:MIT 的浏览器端像素清洗工具,把 AI 生成图整理成可用 sprite/icon。
- 值得借鉴:去抗锯齿、网格候选、背景透明、调色板映射、描边、批量 ZIP 与 Compare 滑杆形成完整质检链。
- 迁移边界/许可证不确定项:MIT; 20★、2026-06-21 最新 release,但体量小; 只借处理链和 UI 质检模式,落地前补本地测试夹具。
- URL: https://github.com/HappyOnigiri/PixelRefiner

### TailAdmin/free-nextjs-admin-dashboard
- 是什么:MIT 的 Next.js/Tailwind 控制台模板,面向 admin panel / dashboard / back-end 面板。
- 值得借鉴:侧栏、图表、表单、下拉、响应式页面和 Figma 社区文件,适合做控制台骨架的低风险视觉参照。
- 迁移边界/许可证不确定项:MIT; 免费版与 Pro 版边界需分清,只借布局密度与组件组织,不复制 Pro 资产。
- URL: https://github.com/TailAdmin/free-nextjs-admin-dashboard

### midday-ai/midday
- 是什么:AGPL-3.0 的业务运营控制台,覆盖时间、发票、收件箱、文件库、财务概览和助手。
- 值得借鉴:把 inbox、overview、assistant、export 等高频运营流放进同一工作台,信息密度比营销型 dashboard 更适合控制台。
- 迁移边界/许可证不确定项:AGPL-3.0 仅非商用,商业部署需授权; 只借导航、列表、空状态和助手入口范式,不复用代码。
- URL: https://github.com/midday-ai/midday

### 行动判断
- 不新增公告板卡:PixelRefiner 可归并到既有像素工作台/质检卡; TailAdmin 与 Midday 属 UI 参照,暂不足以单独进入 CEO 取舍。



<!-- insight-scout-run:cr-1782691243915-insight-scout-repos-20260629-08 -->
## 2026-06-29 · 自动洞察(20260629-08 · pixel-assets-ui)

> 来源:洞察员; run=cr-1782691243915-insight-scout-repos-20260629-08; queue=insight-scout/insight-scout-repos-20260629-08; network=available

## 像素素材生成 / 控制台优秀网页设计(slot=20260629-08)
> 来源:洞察员; network_status=available(GitHub API/README 只读); 已比对 `seen-repos.json`、`borrowed-libs.md`、`insights.md`,本轮 3 个 URL 未命中; 不登录、不安装、不改运行代码; Starlaid/星桥 全程排除。

### HappyOnigiri/PixelRefiner
- 是什么:MIT 的浏览器端像素清洗工具,把 AI 生成图整理成可用 sprite/icon。
- 值得借鉴:去抗锯齿、网格候选、背景透明、调色板映射、描边、批量 ZIP 与 Compare 滑杆形成完整质检链。
- 迁移边界/许可证不确定项:MIT; 20★、2026-06-21 最新 release,但体量小; 只借处理链和 UI 质检模式,落地前补本地测试夹具。
- URL: https://github.com/HappyOnigiri/PixelRefiner

### TailAdmin/free-nextjs-admin-dashboard
- 是什么:MIT 的 Next.js/Tailwind 控制台模板,面向 admin panel / dashboard / back-end 面板。
- 值得借鉴:侧栏、图表、表单、下拉、响应式页面和 Figma 社区文件,适合做控制台骨架的低风险视觉参照。
- 迁移边界/许可证不确定项:MIT; 免费版与 Pro 版边界需分清,只借布局密度与组件组织,不复制 Pro 资产。
- URL: https://github.com/TailAdmin/free-nextjs-admin-dashboard

### midday-ai/midday
- 是什么:AGPL-3.0 的业务运营控制台,覆盖时间、发票、收件箱、文件库、财务概览和助手。
- 值得借鉴:把 inbox、overview、assistant、export 等高频运营流放进同一工作台,信息密度比营销型 dashboard 更适合控制台。
- 迁移边界/许可证不确定项:AGPL-3.0 仅非商用,商业部署需授权; 只借导航、列表、空状态和助手入口范式,不复用代码。
- URL: https://github.com/midday-ai/midday

### 行动判断
- 不新增公告板卡:PixelRefiner 可归并到既有像素工作台/质检卡; TailAdmin 与 Midday 属 UI 参照,暂不足以单独进入 CEO 取舍。



<!-- insight-scout-run:run-20260629T0005Z-insight-scout-repos -->
## 2026-06-29 · 自动洞察(run-20260629T0005Z · 多智能体编排 / control plane)
> 来源:洞察员;run=run-20260629T0005Z-insight-scout-repos(UTC 2026-06-29T00:05Z = 北京 2026-06-29 08:05)。**轮题理由**:近 ~7 个槽位偏「视觉/前端 + agent 子领域」(20260629-08 像素+网页、2004Z Unity+像素、20260629-04 GUI grounding、1605Z 多智能体+网页、20260629-00 LLM 网关、20260628-20 skills 治理、20260628-16 队列),回到**最核心也最久未单独深做的「多智能体编排 / control plane」**,聚焦「持久化共享工作底座 + 确定性调度 + 控制面」三条对口玉兔6 控制台/编排/队列/公告板的硬骨头。
> network=available(WebSearch + web_fetch 直读 GitHub 仓库页 / README / LICENSE 口径,star/license/commit 为抓取当下数值,人工复核为准)。
> 去重:已比对 seen-repos.json(283 条)+ borrowed-libs.md + insights 近批;本轮 3 例(Intelligent-Internet/CommonGround、sipyourdrink-ltd/bernstein、Agent-Field/agentfield)均未登记(追加后 286 条)。**Starlaid / 星桥 全程排除**(三例均不涉及)。

### 1. Intelligent-Internet/CommonGround — 「从孤立 agent 到共享工作」的持久化公共工作底座(Ledger Kernel):把每段工作做成可复原的 **Turn**(交接事实/边界输入输出/产物引用),配 **claim fencing + 因果血缘 + pull-first 复原**,PostgreSQL 为真相源;**最该借的是给玉兔6 公告板/队列补「交接事实可复原」的契约层**
- ① 名称 / URL:Intelligent-Internet/CommonGround(From isolated agents to shared work;CommonGround Kernel)— https://github.com/Intelligent-Internet/CommonGround
- 核验(web_fetch 直读):**Apache-2.0** · **137★ / 21 forks / 20 commits** · **Python 99.9%** · Python 3.13+ + PostgreSQL · 最新 release **v3.1.0(2026-05-20)**,README 顶部明确标注 **"Initial Open Source Preview · v3r1"**,且 **v3r1 与早期 v1 不向后兼容**。体量小、preview 早期,但**设计密度高**。
- ② 优秀在哪 / 亮点:
  - **「constitutional ledger kernel(宪法式台账内核)」最小主张**:只定义独立参与者协作所需的**最小公共事实**——工作边界、语义归属、因果关系,**不把任何 agent 吸收进一个中央 runtime**。「Independent agents at the edges. Durable public work records at the kernel.」
  - **Turn = 最小持久工作边界(不是一条聊天回复)**:一段工作/委派/交互/恢复循环;**Turn-owned 公共语义**显式保留:输入、被选观察、过程记录、**交接(handoffs)**、最终交付物、终止原因、产物引用——都归属拥有它的 Turn。
  - **claim fencing + 生命周期**:claim、heartbeat、renew、suspend、resume、stop、finish、**lease-expiry** 处理——一套显式的「认领-续租-租约过期」防重入机制。
  - **因果血缘(causal lineage)**:parent/child Turn 关系、子完成、父观察、**显式 absorption(吸收)**;会话/runtime/通知消失后仍可 inspect。
  - **Ledger and feed + pull-first 复原**:durable 公共事实供拉取式恢复、审计、投影;PostgreSQL 为真相源(+ CardBox schema)。**「memory-ready, not memory-complete」**——内核只存事实,记忆/编排/评审/工作区都在其上自建。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **公告板 ← 借「durable public work records + Turn-owned 语义」** ⭐⭐:玉兔6 cards.json 现在是卡片状态机;可借这套**「请求/交接/回传/交付/可复用产出」五类公共事实 + 终止原因 + 产物引用**的 schema,给公告板卡补「交接事实可复原」字段,让任意后续 agent/人 **pull-first 复原上下文**。直接对口既有「任务 DAG/交接协议 v0」卡。
  - **队列 ← 借「claim fencing 生命周期(claim/heartbeat/renew/suspend/resume/lease-expiry)」** ⭐:玉兔6 队列引擎(artifacts/queues)的认领/续租/失败处置可借这套**显式 lease fencing**,根治重复执行 / 僵尸任务。对口既有「队列失败处置契约」卡;与下文 agentfield 的 atomic lease 互证。
  - **编排 ← 借「因果血缘(parent/child Turn + absorption)」**:多 agent 派单/子任务的因果链显式化,可复盘「谁派给谁、子任务完成、父观察、吸收」。
  - **架构哲学 ← 借「kernel 不吞 runtime,只存最小公共事实」**:正契合玉兔6「控制台编排 + 各工位独立」分工——公共底座只存可复原事实,不强绑某 runtime。
- ④ 难度中 / 优先级中-高:**直接对口公告板 + 队列两条既有卡**,价值高;但 **v3r1 preview / API 不稳 / 20 commits / 137★ 早期** → **只借 schema 与契约范式,不引其 Python runtime / NATS / PG 依赖**,落地以玉兔6 自实现为准。Apache-2.0 已核。
- 边界 / 许可证:**Apache-2.0 已核**可读借;但 **preview 阶段、v3r1 不向后兼容 v1**;凭证为 bearer secret(README 明确警告勿泄露 token/DSN,本报告不回显任何密钥)——只借范式不接其服务。**与 Starlaid 无关**。

### 2. sipyourdrink-ltd/bernstein — 「确定性 plain-Python 调度器 + 验收门 + HMAC 链式审计」的审计级多 agent 编排:一次 LLM 拆解目标→其余纯代码调度(协调环零 LLM、可 replay),并行 git worktrees 跑、**通过测试才合入**、每个调度决策一条防篡改审计;**最该借的是把玉兔6 编排做成「确定性可复现 + 验收后合入 + 可审计」**
- ① 名称 / URL:sipyourdrink-ltd/bernstein(Audit-grade multi-agent orchestration for CLI coding agents)— https://github.com/sipyourdrink-ltd/bernstein(站点 bernstein.run)
- 核验(web_fetch 直读):**Apache-2.0** · **598★ / 51 forks / 3,278 commits** · **Python 97.8%** · **solo 维护**(单人)· 被 Python Weekly #742(2026-04-23)提及。成熟度可观但**单点维护**。
- ② 优秀在哪 / 亮点:
  - **确定性 plain-Python 调度(最该看的点)**:**协调环零 LLM**——只做**一次** LLM call 把目标拆成 tasks(roles、owned files、completion signals),其余(谁运行/在哪/给多少预算、并行跑、隔离 git 分支、跑测试、路由重试)**全是纯 Python** → 每次 run 可复现,**「replay 昨天的 plan 得昨天的 task graph」**。
  - **并行 git worktrees + merge queue 串行化**:一群 CLI coding agents(Claude Code/Codex/Gemini CLI +40)在**各自隔离的 git worktree** 里跑同一目标,**merge queue 串行化 landing**,主分支保持干净、无竞态。
  - **验收-后-合入(Janitor verify gate)**:合并前跑 **lint / type / test + 可选跨模型 review**,**只合「真正通过的」代码**。
  - **HMAC-SHA256 链式审计(RFC 2104)**:**每个调度决策一条记录**、明文、tamper-evident,落在 `.sdd/audit/YYYY-MM-DD.jsonl`;配 signed agent cards、per-artefact lineage、air-gap deploy、per-agent credential scoping。
  - 附:Codebase RAG = SQLite FTS5 + BM25 + AST-aware chunking。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **编排 ← 借「确定性 plain-Python 调度:协调环零 LLM + 可 replay」** ⭐⭐:玉兔6 engine-runner / 控制台派单若用 LLM 决策路由,既不确定又烧 token;bernstein 范式 = **一次 LLM 拆解 + 其余纯代码调度**。直接对口「任务 DAG/交接协议 v0」——DAG 拆解后调度走确定性代码、可复现可 replay。
  - **验收门 ← 借「verify-before-merge(lint/type/test/跨模型 review)」** ⭐:延续近批 **Symphony「proof-of-work 验收门」**线,bernstein 给出**落地样板**(通过才合入)。对口玉兔6「工作证明 / 通过才合入」闭环。
  - **运维台账 ← 借「HMAC-SHA256 链式审计,每调度决策一条、明文、tamper-evident」** ⭐:玉兔6 控制台 run/派单台账可借这套**明文 + HMAC 链**做可审计、可 air-gap 的台账,呼应近批 LLM 网关「账本/追踪」线。
  - **队列 ← 借「并行 git worktrees + merge queue 串行化」**:多 agent 并行隔离执行、合入串行,正是玉兔6 队列引擎「并发 worker + 串行落库」的具体模式;呼应近批 texel-studio 的 session affinity 派单。
- ④ 难度中 / 优先级中-高:**确定性调度 + 验收门 + HMAC 审计三点最值钱**且部分可直接落地;但 **solo 维护(单点风险)、面向 CLI coding agents(玉兔6 工位不止 coding)** → 借调度/审计/验收**范式**,不引其 runtime。Apache-2.0 已核。**(本批最对口「编排 + 验收门」)**
- 边界 / 许可证:**Apache-2.0 已核**;**单人维护**需评估可持续性;面向 CLI coding agents、需各 agent 自带 LLM key。只借范式不引 runtime。**与 Starlaid 无关**。

### 3. Agent-Field/agentfield — 「把 agent 当 API/微服务来跑」的开源 control plane:能力注册 + 跨 agent 路由 + 自动 DAG 追踪 + **per-agent 加密身份(DID)/每执行可验回执(VC)/tag policy 门** + durable PG lease 队列 + 人在环 pause/resume + DAG 运维 UI;**最该借的是玉兔6 控制台 control plane「该有哪些能力」的成熟参照**
- ① 名称 / URL:Agent-Field/agentfield(The AI Backend — build & scale AI agents like APIs)— https://github.com/Agent-Field/agentfield(站点 agentfield.ai)
- 核验(web_fetch 直读):**Apache-2.0** · **1.9k★ / 306 forks / 1,029 commits** · **Go 50.4% + TypeScript 29.4% + Python 19.2%** · 最新 release **v0.1.84(2026-05-11,共 305 个 release)**——**版本号仍 v0.1.x 但迭代极快**。control plane 为 **stateless Go 服务**。
- ② 优秀在哪 / 亮点:
  - **control plane 把 agent 变生产基础设施**:Python/Go/TS 写的每个 function 自动变 **REST endpoint**,每个 agent 拿**加密身份**,每个决策可追溯;agent 从任何地方连入、注册能力,control plane **路由 call、把执行追踪成 DAG、强制 policy**。
  - **执行引擎**:sync / async(fire-and-forget + webhook HMAC 签名)、SSE 流式、**无超时(跑数小时/天)**、auto retry + 指数退避、backpressure + 队列深度限制、**durable queue(PostgreSQL)atomic lease-based processing**。
  - **治理 / IAM(最该看的点)**:per-agent **W3C DID + Ed25519**(不是共享 API key)、**Verifiable Credentials**(每次执行一个**防篡改、离线可验**回执 `af vc verify`)、**tag-based policy gates**(「只有 finance tag 的 agent 能 call 这个」**由基础设施强制,不靠 prompt**)。
  - **可观测 + 人在环 + 灰度**:自动 workflow DAG 可视化 / Prometheus `/metrics` / 执行时间线 / correlation IDs;`app.pause()` **durable 审批**(crash-safe、可配超时自动升级);canary(5%→50%→100%)/ A/B / blue-green + agent 生命周期状态机(pending→starting→ready→degraded→offline)。
  - **派单 harness**:`app.harness()` 派多轮 coding 任务给 Claude Code/Codex/Gemini/OpenCode,带 **cost cap(max_budget_usd)/ turn limit / tool 白名单**;另含 KV+vector memory(无需 Redis)、agent mesh discovery、Dashboard UI(real-time DAG / traces / fleet / audit)。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **控制台 control plane ← 借「能力注册 + 跨 agent call 路由 + 自动 DAG 追踪 + tag policy 门」** ⭐⭐:玉兔6 控制台(server.js 派单/路由)可借其**组织方式**作为「control plane 该有哪些能力」的成熟参照。
  - **运维台账 / 治理 ← 借「每执行 Verifiable Credential(离线可验防篡改回执)+ tag policy 门(基础设施强制非 prompt)」** ⭐:与 bernstein 的 HMAC 审计链**互补**;对口玉兔6「能力库信任入库 / 角色边界」线。
  - **队列 ← 借「durable PG queue atomic lease + backpressure + 队列深度限制 + 指数退避重试」**:对口队列引擎线,**atomic lease 与 CommonGround 的 claim fencing 互证**,是成熟落地参照。
  - **控制台 UI ← 借「real-time workflow DAG + 执行时间线 + fleet 健康状态机 dashboard」**:玉兔6 运维台的**信息架构**参照(与近批 Kibo/TailAdmin 的现成 UI 件互补——这里回答「控制台该展示什么」)。
  - **人在环 + 派单治理 ← 借「pause/resume durable 审批 + 超时自动升级」「harness 的 cost cap / turn limit / tool 白名单」**:对口玉兔6「交 CEO 评审 / 人工授权」节点与派单预算治理。
- ④ 难度中(参照级)/ 优先级中-高:**体量大、Go 栈(非玉兔6 Node/JS 控制台栈)**,引运行时不现实;但作为「control plane 能力清单 + 治理 + 运维 UI 信息架构」的**成熟参照**价值高 → **借组织方式/能力清单/UI 范式,不引 Go runtime**。Apache-2.0 已核。
- 边界 / 许可证:**Apache-2.0 已核**;Go control plane + 多语言 SDK,**v0.1.x 仍早期版本号**(但 305 releases/1029 commits 迭代快);只借范式/能力清单。**与 Starlaid 无关**。

### 行动判断(是否加待办卡)
- **本轮不新增公告板待办卡,只写分析 + 归并建议**,理由:① 公告板已有 **26+ 张 source=洞察员 卡(todo)待 CEO 消化**,且**本轮三例均对口既有卡**(任务 DAG/交接协议 v0、队列失败处置契约、能力库信任入库、LLM 网关账本/追踪);② 三例均属**范式 / 成熟参照借鉴**(持久化共享底座 / 确定性调度 + 验收门 / control plane 能力清单),非「立刻该做的原子动作」,应**并入既有卡**而非另开;③ 延续近批克制红线(「不是待办任务」),避免在 CEO 未消化既有卡前继续堆卡。
- 归并建议(并入既有卡,不新增):
  - **CommonGround 的「durable public work records + Turn-owned 语义 + claim fencing + 因果血缘 + pull-first 复原」→ 并入「任务 DAG/交接协议 v0」+「队列失败处置契约」卡**。
  - **bernstein 的「确定性 plain-Python 调度 + verify-before-merge 验收门 + HMAC 链式审计」→ 并入「任务 DAG/交接协议 v0」+ Symphony 验收门线 + 运维台账**。
  - **agentfield 的「control plane 能力清单 + atomic lease 队列 + VC/tag-policy 治理 + DAG 运维 UI」→ 并入「能力库信任入库」+ 控制台 Web 化 UI 参照**。

### 本批小结(给 CEO 的一句话借鉴)
- **Intelligent-Internet/CommonGround**:学它「**durable 公共工作底座 + Turn 边界 + claim fencing + 因果血缘 + pull-first 复原**」,给玉兔6 公告板/队列补「交接事实可复原」;Apache-2.0、137★、**v3r1 preview 早期,只借 schema 契约不引 runtime**,并入既有编排/队列卡。
- **sipyourdrink-ltd/bernstein**:学它「**确定性 plain-Python 调度(协调环零 LLM、可 replay)+ verify-before-merge 验收门 + HMAC 链式审计**」,补玉兔6 编排/验收门/运维台账;Apache-2.0、598★、**solo 维护,借范式不引 runtime**。**(本批最对口「编排 + 验收门」)**
- **Agent-Field/agentfield**:学它「**stateless control plane 能力清单 + atomic lease 队列 + 每执行 VC 回执 + tag policy 门 + DAG 运维 UI**」,作玉兔6 控制台 control plane 的成熟参照;Apache-2.0、1.9k★、**Go 栈,借能力清单/UI 范式不引 runtime**。
- **本轮不新增待办卡**;三例分别并入既有「任务 DAG/交接协议」「队列失败处置」「能力库信任入库」「控制台 UI 参照」卡。**Starlaid / 星桥 全程排除。**

> watch(本批 web_fetch 直读元数据;HEAD commit SHA 因代理 git ls-remote 受限未取,待网络可达回填):Intelligent-Internet/CommonGround `main`(**Apache-2.0 → watch=true 但谨慎**,关注 v3r1 是否脱离 preview / API 稳定度 / 是否出 PyPI 包 / claim-fencing 与 Turn 语义演进,137★、20 commits、v3.1.0 早期)、sipyourdrink-ltd/bernstein `main`(**Apache-2.0 → watch=true**,关注 **solo 维护可持续性** / 是否适配非 coding-agent 工位 / 验收门与 HMAC 审计链演进,598★、3,278 commits)、Agent-Field/agentfield `main`(**Apache-2.0 → watch=true**,关注是否脱离 v0.1.x / control plane 能力增补 / VC + tag-policy 成熟度,1.9k★、1,029 commits、305 releases 迭代快)。



<!-- insight-scout-run:cr-1782705630800-insight-scout-repos-20260629-12 -->
## 2026-06-29 · 自动洞察(20260629-12 · unity-simulaid-methods)

> 来源:洞察员; run=cr-1782705630800-insight-scout-repos-20260629-12; queue=insight-scout/insight-scout-repos-20260629-12; network=available

## Unity/团结工作流方法论借鉴扫描(slot=20260629-12)

> network_status=available; 已比对 board/insights 三个去重输入,本轮 3 个 URL 未命中既有记录。仅借方法论,不触碰运行项目;不登录、不装依赖、不处理凭据。

### Unity-Technologies/MemorySnapshotDataTools
- 是什么:Unity CSE 的内存快照 CLI,把 .snap 导出为 DuckDB/SQLite,再生成 HTML 报告;README 还暴露 .claude/skills 入口。
- 值得借鉴:把性能问题从编辑器手查转成可归档数据库+报告,适合抽象为团结项目“优化前后快照/SQL 复盘/报告留档”门禁。
- 迁移边界/许可证不确定项:Unity Companion License;仓库很新且体量小,只借快照数据化与报告化流程,不引 CLI 进运行链。
- URL: https://github.com/Unity-Technologies/MemorySnapshotDataTools

### needle-mirror/com.unity.localization
- 是什么:UPM 镜像的 Unity Localization 包,覆盖字符串/资产本地化、伪本地化、CSV/XLIFF/Google Sheets 导入导出。
- 值得借鉴:把多语言、占位符、资产变体和伪本地化前置成编辑器工作流,可泛化为文案/素材变体验收清单。
- 迁移边界/许可证不确定项:镜像非官方发布源,LICENSE 为 Unity Companion License;落地须以包管理器和官方文档为准。
- URL: https://github.com/needle-mirror/com.unity.localization

### gitattributes/gitattributes
- 是什么:通用 .gitattributes 模板库,其中 Unity 模板按 text/json/yaml/LFS 分类并接入 unityyamlmerge。
- 值得借鉴:用仓库级属性明确哪些 Unity 资产可文本合并、哪些进 LFS,能减少跨平台换行、二进制误提交和 prefab/scene 合并噪音。
- 迁移边界/许可证不确定项:MIT;模板应按团结/Unity 版本和现有仓库策略裁剪,不能整文件照搬覆盖。
- URL: https://github.com/gitattributes/gitattributes

### 判断
- 三例都偏工作流清单与方法论,不构成需要 CEO 立即取舍的低风险行动;本轮不生成公告板卡。



<!-- insight-scout-run:run-20260629T0411Z-insight-scout-repos -->
## 2026-06-29 · 自动洞察(run-20260629T0411Z · 任务队列引擎 / durable execution)
> 来源:洞察员;run=run-20260629T0411Z-insight-scout-repos(UTC 2026-06-29T04:11Z = 北京 2026-06-29 12:11)。**轮题理由**:近 ~8 个槽位里「任务队列引擎」最久未单独深做(上次 20260628-16);上一槽(0005Z 多智能体编排)虽提到 claim fencing / atomic lease,但停在「编排 / control plane」层、未落到「队列引擎本体」。本轮专攻**任务队列引擎 / durable execution** 三种互补形态:① 队列底层原语(SQL 级最成熟)② AI agent durable runtime(checkpoint 重放 / wait / 版本化)③ Node 栈 durable 函数(最可移植到玉兔6 控制台)。三例都直接对口玉兔6 **队列引擎(artifacts/queues)/ engine-runner / 控制台派单 / 公告板**。
> network=available(WebSearch + web_fetch 直读 GitHub 仓库页 / README / LICENSE;star/license/commit/release 为抓取当下数值,人工复核为准)。
> 去重:已比对 seen-repos.json(289 条)+ insights 近批;本轮 3 例(janbjorge/pgqueuer、zenml-io/kitaru、SokratisVidros/pg-workflows)均未登记(追加后 292 条)。**Starlaid / 星桥 全程排除**(三例均不涉及)。

### 1. janbjorge/pgqueuer — 「你的 PostgreSQL 本身就是任务队列」的极简后台任务引擎:事务内入队(任务与业务数据同事务提交,杜绝 dual-write drift)+ FOR UPDATE SKIP LOCKED 安全并发 + LISTEN/NOTIFY 即时唤醒 + 内存测试替身;**最该借的是给玉兔6 队列引擎补「事务级入队 + SKIP LOCKED 认领 + 内存测试夹具」**
- ① 名称 / URL:janbjorge/pgqueuer(PostgreSQL-powered job queues for Python)— https://github.com/janbjorge/pgqueuer
- 核验(web_fetch 直读):**MIT** · **1.5k★ / 35 forks / 596 commits** · **Python 99.8%** · Python 3.11+ + PostgreSQL 12+ · 最新 release **v1.0.2(2026-05-29)**,共 **104 个 release**,迭代密集且已到 1.0。成熟度高、维护活跃。
- ② 优秀在哪 / 亮点:
  - **「数据库即队列」最小依赖**:`pip install pgqueuer` + `pgq install` 建表与函数;任务与应用数据同库、full ACID,**不另起 broker / Redis**。
  - **transactional enqueue(最该看的点)**:在**同一事务**里 `INSERT orders` + `enqueue('send_receipt')`,事务回滚则任务从不入队——**杜绝 dual-write drift**(业务改了但派单丢 / 派单了但业务没落)。
  - **safe concurrency**:worker 以 **`FOR UPDATE SKIP LOCKED`** 认领任务(永不重复处理)+ per-entrypoint 并发上限 + 需要时 serialized dispatch。
  - **instant dispatch**:`LISTEN/NOTIFY` 任务一落库即唤醒 worker,**带轮询兜底**。
  - **调度 / 可观测**:cron 式 recurring + `execute_after` 延迟(无需独立 scheduler)、completion tracking(`CompletionWatcher`)、Prometheus + tracing(Logfire/Sentry)、live dashboard(`pgq dashboard`)。
  - **in-memory mode**:`PgQueuer.in_memory()` 与真实后端同 ports,handler 不变 → 单测 / 原型无需 PG。Ports & adapters 架构。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **队列 ← 借「transactional enqueue:派单事实与状态变更原子提交」** ⭐⭐:玉兔6 派单现在是「写 cards.json / queue」与「改业务状态」两步,中断会半完成;借这套**「同事务 / 单次原子写,绑定派单与状态」**思路根治 dual-write(玉兔6 是文件 JSON,可落到单次原子写;若引 SQLite 作真相源则直接适用)。对口「队列失败处置契约」卡。
  - **队列 ← 借「FOR UPDATE SKIP LOCKED 认领 + per-entrypoint 并发上限」** ⭐:与上一槽 CommonGround claim fencing / agentfield atomic lease 同一根问题,这里给出**SQL 级最成熟落地**——多 worker 认领防重复执行。
  - **测试 ← 借「in-memory 适配器作测试替身(同 ports,不接 PG)」** ⭐:玉兔6 队列引擎 / engine-runner 单测可借「内存适配器 + 真实适配器同接口」做**无依赖测试夹具**,直接对口 tests/ 目录与「任务可靠执行研究」。
  - **派单时延 ← 借「LISTEN/NOTIFY 事件唤醒 + 轮询兜底」**:玉兔6 从「纯轮询 artifacts/queues」升级为「事件唤醒 + 轮询兜底」,降派单延迟。
  - **运维台 ← 借「completion tracking / Prometheus / live dashboard」**:控制台运维台队列可观测参照。
- ④ 难度低-中 / 优先级高:**MIT、1.5k★、已到 v1.0、纯 Python 单库**,概念可直接对照,**事务入队 + SKIP LOCKED + 内存测试夹具三点最值钱且部分可立刻落地**;玉兔6 控制台是 Node、默认无 PG → **借范式 / SQL 模式,不强引 PG 依赖**(或在引 SQLite/PG 时直接复用)。**(本批最对口「队列引擎本体 + 可测试性」)**
- 边界 / 许可证:**MIT 已核**可读借;Python 实现、需 PostgreSQL(玉兔6 若坚持文件队列则借模式不引依赖)。**与 Starlaid 无关**。

### 2. zenml-io/kitaru — 「坐在你 agent harness 底下」的自托管 durable runtime:@flow/@checkpoint 两个装饰器(无 graph DSL),崩溃 / 重试后**已完成 checkpoint 返回缓存输出、不重烧 token**,`wait()` 暂停-恢复、版本化部署(冻结快照 + tag 回滚)、artifact 血缘、按 step 隔离执行;**最该借的是给玉兔6 长任务补「checkpoint 重放缓存 + durable wait + 流程版本化回滚」**
- ① 名称 / URL:zenml-io/kitaru(来る「到来」;The runtime layer underneath your agent stack)— https://github.com/zenml-io/kitaru(站点 kitaru.ai,ZenML 团队出品)
- 核验(web_fetch 直读):**Apache-2.0** · **189★ / 13 forks / 564 commits** · **Python 98.2%** · 最新 release **v0.17.0(2026-06-19)**,共 27 个 release · 默认分支 develop。早期(v0.x、189★)但**迭代快、源自 ZenML 五年编排经验**。
- ② 优秀在哪 / 亮点:
  - **明确分层(最该看的点)**:把 agent 栈分 **Model / Harness(prompts+tools+loop)/ Runtime(Kitaru)/ Platform(治理)** 四层,Kitaru **只做 runtime 这一层**——「How the agent survives and executes over time」,论证了 **durable runtime 值得作为独立层**。
  - **durable execution + 重放缓存**:崩溃 / pod 驱逐 / 超时**不回到零**;修 bug 后 replay,**已完成 checkpoint 返回缓存输出而非重烧 token**。
  - **pause / resume**:`kitaru.wait()` 挂起 flow、**释放算力**,数分钟 / 小时 / 天后等人 / 另一 agent / webhook / CLI 输入再恢复。
  - **versioned deployments**:`flow.deploy()` 冻结成**不可变快照**,消费者按名调用;**tag 上线 / re-tag 回滚**,调用方不随新版本重部署。
  - **artifact lineage**:每个 checkpoint 输出写对象存储成 **typed + versioned artifact**,跨 run diff、把坏输出追到产生它的 step。
  - **isolated execution + 内置 UI + 框架无关**:`@checkpoint(runtime="isolated")` 让重 / 危险 step 在独立 pod/job 跑;server 自带 UI(看 run、查 checkpoint 输出、批 HITL wait);可包 PydanticAI / OpenAI Agents SDK / Anthropic Agent SDK(`KitaruAgent` / 装饰器),**包住你的 harness 而非反过来**。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **编排 / 队列 ← 借「@checkpoint 重放缓存:重跑只续未完成步骤、不重烧 token」** ⭐⭐:玉兔6 洞察员 / 各工位长任务中途失败重跑会**重复烧 WebSearch / web_fetch / LLM**;借 checkpoint 缓存让重跑续跑。直接对口「任务可靠执行研究 + 队列失败处置契约」,是玉兔6 反复关心的核心。
  - **人在环 ← 借「kitaru.wait() durable 暂停-恢复(等待期释放算力)」** ⭐:玉兔6「交 CEO 评审 / 人工授权」节点做成 durable wait,不占工位(与上一槽 agentfield pause/resume durable 审批互证)。
  - **能力 / 流程治理 ← 借「versioned deployments:流程冻结快照 + tag 上线 / 回滚」** ⭐:玉兔6 工位流程 / skills 版本化——冻结成版本,出问题 re-tag 回滚,调用方不动。对口「能力库信任入库 / skills 治理」线。
  - **产物可追溯 ← 借「artifact lineage(每 checkpoint → typed versioned artifact,坏输出追到 step)」**:玉兔6 artifacts/ 产物血缘(呼应上一槽 CommonGround 因果血缘 / bernstein 审计)。
  - **架构自检 ← 借「Model / Harness / Runtime / Platform 四层」**:把玉兔6「控制台(平台 / 治理)/ 各工位 harness / durable runtime(队列编排)」分清,Kitaru 论证 runtime 层值得独立。
- ④ 难度中 / 优先级中-高:**checkpoint 重放缓存 + durable wait + 版本化回滚三点最值钱**且直接对口既有可靠执行卡;但 **v0.17.0 早期、189★、Python(玉兔6 控制台 Node 栈)** → **借范式 / 契约,不引其 Python runtime / K8s / 对象存储依赖**。Apache-2.0 已核。
- 边界 / 许可证:**Apache-2.0 已核**;早期版本、Python + 偏 K8s / 云对象存储部署;只借范式不引 runtime。**与 Starlaid 无关**。

### 3. SokratisVidros/pg-workflows — 「最简 Postgres TS 工作流引擎」:durable 执行建在 pg-boss 上,workflow=普通 async 函数(无 DSL/YAML/DAG),step.run 每步 exactly-once、崩溃 / 重部署自动断点续跑,step.waitFor 等事件(零资源)、idempotencyKey 幂等启动、OTel 重放不重复发 span;**最该借的是给玉兔6 Node 控制台补「durable step 函数 + waitFor 事件 + 幂等派单」(三例里最可移植)**
- ① 名称 / URL:SokratisVidros/pg-workflows(Postgres workflows. Durable execution built on pg-boss)— https://github.com/SokratisVidros/pg-workflows
- 核验(web_fetch 直读):**MIT** · **41★ / 6 forks / 106 commits** · **TypeScript 100%** · Node ≥18 + PostgreSQL ≥10 · 最新 release **v0.12.0(2026-05-26)**,共 17 个 release · **单人维护、早期**。体量小,但**栈最贴玉兔6(Node/TS)**、API 设计干净。
- ② 优秀在哪 / 亮点:
  - **workflow=普通 async 函数(最该看的点)**:`workflow(id, async ({step,input})=>{...})`,**无 DSL / YAML / DAG builder**;`step.run('name', fn)` 每步 **exactly-once**,崩溃 / 重部署 / 重试**从断点续跑**,state 落现有 PostgreSQL。
  - **pause / wait / resume**:`step.waitFor('event-name', {timeout})` 暂停到 API 触发事件,**等待期零资源**;`step.delay('3 days')` / `step.waitUntil(date)` / `step.poll(...)` 内建调度,**无 cron / 无外部 scheduler**。
  - **idempotent starts**:传 `idempotencyKey`,重复调用安全返回同一 run。
  - **client / worker 分离**:API 服务保持轻,handler 在 worker 跑;`pg-boss` 已 bundle,engine 启动自动跑迁移。
  - **为 AI agent 设计**:缓存昂贵 LLM 调用、429 重试、暂停等人审;OTel `otelPlugin` 每 workflow / step 发 span,**缓存重放的 step 不再发 span**(不重复计费 / 不污染 trace)。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **队列 / 编排 ← 借「durable async 函数 + step.run exactly-once 断点续跑」** ⭐:**三例里最可直接对照甚至试用**——玉兔6 控制台是 Node/JS,可把 engine-runner 派单流程写成「step.run 的 durable 函数」,天然断点续跑。对口「engine-runner / 队列失败处置契约」。
  - **派单去重 ← 借「idempotencyKey 幂等启动(重复调用返回同一 run)」** ⭐:直接对口玉兔6**定时任务重入 / 重复派单**根因——给派单加幂等键,重触发返回同一 run。
  - **人在环 + 定时 ← 借「step.waitFor 等事件 + step.delay/waitUntil/poll 内建调度」**:玉兔6「等 CEO 事件 / 等外部回执 / 定时复看」无需外部 cron;对口洞察员自身定时 + 人在环。
  - **可观测 ← 借「OTel:缓存重放的 step 不发 span」**:玉兔6 运维台 tracing 的细节范式(重放不重复 span / 计费)。
  - **架构 ← 借「client / worker 分离」**:控制台 server 与执行体分离的参照。
- ④ 难度低-中(Node 栈最可移植)/ 优先级中:**API 设计与玉兔6 Node 控制台最贴**,`durable step + waitFor + idempotency` 范式可直接借用甚至小范围试用;但 **41★、单人维护、v0.12.0 早期、bundles pg-boss(需 PG)** → 若玉兔6 不引 PG,则**借 API 设计范式落到自有文件 / SQLite 队列**,不在生产硬依赖其包。MIT 已核。
- 边界 / 许可证:**MIT 已核**;单人维护 + 早期 + 需 PostgreSQL(经 pg-boss);只借 API 范式或小范围试用,不在生产硬依赖。**与 Starlaid 无关**。

### 行动判断(是否加待办卡)
- **本轮不新增公告板待办卡,只写分析 + 归并建议**,理由:① 公告板已有 **26+ 张 source=洞察员 卡(todo)待 CEO 消化**,且本轮三例**均对口既有卡**(队列失败处置契约、任务可靠执行研究、能力库信任入库 / skills 治理);② 三例均属**范式 / 成熟参照借鉴**(队列原语 / agent durable runtime / Node durable 函数),非「立刻该做的孤立原子动作」,应**并入既有卡**而非另开;③ 延续近批克制红线(「不是待办任务」),CEO 未消化既有卡前不继续堆卡。
- 归并建议(并入既有卡,不新增):
  - **PgQueuer 的「transactional enqueue + FOR UPDATE SKIP LOCKED 认领 + in-memory 测试替身」→ 并入「队列失败处置契约」+「任务可靠执行研究」卡**(SQL 级最成熟落地 + 可测试性)。
  - **Kitaru 的「checkpoint 重放缓存 + kitaru.wait() durable 暂停 + 版本化部署回滚 + artifact 血缘」→ 并入「任务可靠执行研究」+「能力库信任入库 / skills 治理」+ 人在环线**。
  - **pg-workflows 的「durable step 函数 + idempotencyKey 幂等 + waitFor 事件调度」→ 并入「engine-runner / 队列失败处置契约」**(Node 栈最可移植,可小范围试用)。

### 本批小结(给 CEO 的一句话借鉴)
- **janbjorge/pgqueuer**:学它「**事务内入队(杜绝 dual-write)+ FOR UPDATE SKIP LOCKED 认领 + 内存测试替身**」,补玉兔6 队列引擎本体与可测试性;MIT、1.5k★、已 v1.0,**借 SQL 模式不强引 PG**。**(本批最对口「队列引擎本体」)**
- **zenml-io/kitaru**:学它「**checkpoint 重放缓存(重跑不重烧 token)+ kitaru.wait() durable 暂停 + 流程版本化 tag 回滚 + artifact 血缘**」,补玉兔6 长任务可靠执行与人在环;Apache-2.0、189★、**v0.x 早期,借范式不引 Python runtime**。
- **SokratisVidros/pg-workflows**:学它「**durable async step 函数(exactly-once 断点续跑)+ idempotencyKey 幂等 + waitFor 事件调度**」,栈最贴玉兔6 Node 控制台、最可移植;MIT、41★、**单人维护早期,借 API 范式或小范围试用**。
- **本轮不新增待办卡**;三例分别并入既有「队列失败处置契约 / 任务可靠执行研究 / 能力库信任入库」卡。**Starlaid / 星桥 全程排除。**

> watch(本批 web_fetch 直读元数据;HEAD commit SHA 因代理 git ls-remote 受限未取,待网络可达回填):janbjorge/pgqueuer `main`(**MIT → watch=true**,关注是否出非 PG 适配 / 队列吞吐与 dashboard 演进,1.5k★、596 commits、v1.0.2)、zenml-io/kitaru `develop`(**Apache-2.0 → watch=true**,关注是否脱离 v0.x / checkpoint 缓存与 wait 语义 / 是否出非 K8s 轻量部署,189★、564 commits、v0.17.0)、SokratisVidros/pg-workflows `main`(**MIT → watch=true 但谨慎**,关注**单人维护可持续性** / 是否脱离 pg-boss 强依赖 / v1 OTel 补全,41★、106 commits、v0.12.0)。



<!-- insight-scout-run:cr-1782720088220-insight-scout-repos-20260629-16 -->
## 2026-06-29 · 自动洞察(20260629-16 · multi-agent-orchestration)

> 来源:洞察员; run=cr-1782720088220-insight-scout-repos-20260629-16; queue=insight-scout/insight-scout-repos-20260629-16; network=available

## slot 20260629-16 · 多智能体编排 / 任务 DAG / 交接协议

本轮网络可用。围绕主题复看发现两个未入库的新案例(均 MIT),其余主流框架(open-multi-agent、microsoft/agent-framework、openai/swarm、LangGraph 等)已在 seen-repos,不重复推荐。

### Lutren/agent-handoff-protocol
- 是什么:面向编码 agent 的跨会话「交接协议」,纯约定+模板,非依赖库;支持 Codex/Claude Code/通用 agent。
- 值得借鉴:handoff 文档(现状/阻塞/下一步)、scoped commit、AGENTS.md/CLAUDE.md 先读、调试/发布清单模板;硬规则「无证据不得声称完成、密钥禁回显、不乱 revert」与玉兔6 done gate、验收表同构。
- 迁移边界/许可证不确定项:MIT,可直接读模板;只吸收约定与措辞,不装 hook、不改 runner;与现有 board 交接文档去重合并,避免模板堆叠。
- URL: https://github.com/Lutren/agent-handoff-protocol

### sworddut/llm_agent_scheduler
- 是什么:PlannerAgent 用提示词让 LLM 产出 JSON 任务 DAG,asyncio 调度器按依赖并发执行的参考实现。
- 值得借鉴:Task 数据结构(id/status/dependencies/parent_id)、依赖全 COMPLETED 才就绪、父任务 WAITING_FOR_SUBTASKS、Semaphore 控并发——可对照玉兔6 任务队列状态机词汇。
- 迁移边界/许可证不确定项:MIT;依赖 FastAPI/asyncio/OpenAI,偏 Python 运行时,只借状态机与 DAG 调度语义,不引依赖、不替现有队列。
- URL: https://github.com/sworddut/llm_agent_scheduler



<!-- insight-scout-run:run-20260629T0804Z-insight-scout-repos -->
## 2026-06-29 · 自动洞察(run-20260629T0804Z · AI agent 工具与 skills:上下文高效的 skill/tool 加载)
> 来源:洞察员;run=run-20260629T0804Z-insight-scout-repos(UTC 2026-06-29T08:04Z = 北京 2026-06-29 16:04)。**轮题理由**:近 ~8 个槽位里队列引擎(0411Z)、多智能体编排(0005Z/16)、GUI grounding(0429-04)、Unity/像素(20:04)、LLM 网关(0629-00)都已新做;**「AI agent 工具与 skills」最久未单独深做**(上次 run-20260628T0013Z,约 32h 前)。本轮专攻一个**对玉兔6 最贴身的子题:上下文高效的 skill/tool 加载**——三例分别给出三种互补形态:① 语义/向量检索「该读哪个 skill」② 三层懒加载 + 可量化 token 账 ③ 把 Anthropic 渐进披露映射成离散 MCP 操作。三例**直接对口玉兔6 的「渐进披露读取契约」(insights/README 本身的读取分层)+ 能力库 / skills 治理 + engine-runner 工具注入**。
> network=available(WebSearch + web_fetch 直读 GitHub 仓库页 / README / LICENSE;star/license/commit/release 为抓取当下数值,人工复核为准)。
> 去重:已比对 seen-repos.json(294 条),本轮 3 例(K-Dense-AI/claude-skills-mcp、cablate/Agentic-MCP-Skill、zouyingcao/agentskills-mcp)均未登记(追加后 297 条)。**Starlaid / 星桥 全程排除**(三例均不涉及)。

### 1. K-Dense-AI/claude-skills-mcp — 「用向量语义检索『该读哪个 skill』」的 MCP 服务:find_helpful_skills 按任务描述做 embedding 相似度检索(不是全量读)+ 三级 metadata→content→files 渐进披露 + 轻壳秒起/重后端异步;**最该借的是给玉兔6 渐进披露契约补「语义检索该读哪个,而非按目录全量读」**
- ① 名称 / URL:K-Dense-AI/claude-skills-mcp(MCP server for searching and retrieving Claude Agent Skills using vector search)— https://github.com/K-Dense-AI/claude-skills-mcp
- 核验(web_fetch 直读):**391★ / 65 forks / 51 commits** · **Python 97.9%** · 9 个 release,最新 **v1.0.6(2025-10-24)**。**许可证标注不一致**:README 徽章与版权声明写 **Apache-2.0**,GitHub 侧栏检测为 **MIT** → 落地前须以仓库 LICENSE 文件为准。**⚠️ README 顶部明示「本 MCP 服务不再托管 / 维护」**(理由:各平台已原生支持 Agent Skills,无需 MCP 桥)→ 当成**已停维的范式参照**看,不作可依赖件。
- ② 优秀在哪 / 亮点:
  - **语义检索该读哪个(最该看的点)**:`find_helpful_skills` 用 **vector embeddings + 语义相似度**,按任务描述检索最相关 skill——把「渐进披露」从「按层级 / 目录读文件」升级成「**按任务语义检索该读哪个**」,本地向量检索、无需 API key、带 GitHub 缓存。
  - **三级渐进披露 → 三个工具**:`find_helpful_skills`(metadata 检索)/ `read_skill_document`(取脚本 / 引用文件)/ `list_skills`(全量清单,调试用),对应 metadata → full content → files 三级。
  - **two-package「轻壳 + 重后端」**:前端 ~15MB **<5s 秒起**(解决 Cursor 超时),后端 ~250MB(PyTorch / sentence-transformers)**后台异步下载**;可连远程后端、本地零配置。
  - **多源**:GitHub 仓库(skills 或 Claude Code 插件)+ 本地目录;默认载入 anthropics/skills 等 ~90 个 skill。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **渐进披露契约 / 洞察员自身 ← 借「语义检索该读哪个热区 / 技能」** ⭐⭐:玉兔6 insights/README 现在是「默认只读 insights.md + seen-repos.json,需要时再读 references/」的**人工分层**;可借 `find_helpful_skills` 思路升级为「**按当前任务向量检索该读哪个 reference / skill**」,减少全量读取与上下文浪费。还可顺带用语义近似改进 **seen-repos 去重**(不止 URL 精确匹配,语义近似仓库也提示)。
  - **能力库 / engine-runner ← 借「三级 metadata→content→files 分层注入」** ⭐:skills 注入按「名+描述(常驻)→ SKILL.md(触发时)→ 引用文件(按需)」三级,降注入成本。
  - **启动体验 ← 借「two-package:轻壳秒起 + 重件后台加载」**:控制台 / 工位若有重依赖(索引 / 模型 / 向量库),用「轻壳先响应 + 重件后台装」避免阻塞首响。
- ④ 难度中 / 优先级中:语义检索范式价值高且**直接对口渐进披露契约**;但**仓库已停维 + Python + 需向量模型** → **借架构范式,不引其包**。**(本批最对口「渐进披露契约本身」)**
- 边界 / 许可证:**许可证标注不一致(Apache vs MIT)须核 LICENSE**;**已停维**;只借范式不引代码。**与 Starlaid 无关**。

### 2. cablate/Agentic-MCP-Skill — 「三层懒加载 + 把 token 省下来算给你看」的渐进式 MCP 客户端:Layer1 server 元数据→Layer2 工具列表→Layer3 单工具 schema(20 工具用 2 个省 86% token)+ daemon 长驻持久连接 + 热重载;**最该借的是给玉兔6 控制台工具注入补「三层懒加载 + 可量化 token 账 + daemon 热重载」(Node/TS 栈最可移植)**
- ① 名称 / URL:cablate/Agentic-MCP-Skill(Progressive MCP client with three-layer lazy loading;npm `@cablate/agentic-mcp`)— https://github.com/cablate/Agentic-MCP-Skill
- 核验(web_fetch 直读):**34★ / 3 forks / 8 commits** · **TypeScript 95.8%** · Node ≥18 · **无 release** · 测试覆盖 ~61%(Vitest)· license 页面仅显「View license」**未明确类型**。**⚠️ 作者明示「极早期、AI 辅助赶工 demo、不建议生产」** → 当**概念验证原型**看。
- ② 优秀在哪 / 亮点:
  - **三层渐进披露 + 明确 token 账(最该看的点)**:**Layer1** servers 元数据(名 / 版本 / 状态,~50-100 tok)→ **Layer2** 工具列表(名+简述,~200-400 tok)→ **Layer3** 单工具完整 input schema(~300-500 tok/工具);**一个 20 工具的 server 只用 2 个**:全量加载 6000 tok vs 三层 850 tok = **省 86%**——把「为什么要懒加载」用**可量化数字**讲清。
  - **daemon 架构**:长驻进程**维持持久 MCP 连接** + socket(换行分隔 JSON)通信 + **热重载**(改 `mcp-servers.json` 后 `daemon reload` 不重启);避免每轮对话重连 / 重载全量工具。
  - **CLI 五命令对齐三层**:`metadata` / `list` / `schema` / `call`,语义清晰。
  - **Node/TS 栈**——三例里**最贴玉兔6 控制台**。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **控制台工具 / MCP 注入 ← 借「三层懒加载 + token 账」** ⭐⭐:玉兔6 若给工位挂多个 MCP / 工具,可借「server 元数据 → 工具列表 → 单工具 schema」三层,**只在调用前加载该工具 schema**,直接砍上下文;并可照搬其「**省 X% token**」的量化口径,作为评估收益的指标。对口 engine-runner 工具注入。
  - **控制台 ← 借「daemon 持久连接池 + 热重载」** ⭐:控制台 server 维持长驻 MCP 连接,改配置**热重载不重启**;Node 栈可直接对照实现。
  - **架构 ← 借「socket 换行分隔 JSON 的 AI/CLI ↔ daemon 解耦」**:与玉兔6「控制台 server ↔ 工位执行体」解耦相呼应。
- ④ 难度低-中(Node 栈最可移植)/ 优先级中:三层 token 账 + 热重载 daemon 范式**可直接对照甚至小范围试**;但**极早期 demo、34★、无 release、作者明示非生产** → **只借范式不引包**。
- 边界 / 许可证:**license 未核实**(页面仅 View license)+ **作者明示非生产** → 只借范式;**与 Starlaid 无关**。

### 3. zouyingcao/agentskills-mcp — 「把 Anthropic 渐进披露干净映射成 4 个离散 MCP 操作」的 skills 网关:load_skill_metadata_op(常驻名+描述)→ load_skill_op(触发读 SKILL.md)→ read_reference_file_op(按需读脚本/引用)→ run_shell_command_op(按需跑脚本)+ 官方 SKILL.md 格式兼容;**最该借的是给玉兔6 能力库补「渐进披露的离散操作词汇 + 与 anthropics/skills 格式互通」**
- ① 名称 / URL:zouyingcao/agentskills-mcp(Bringing Anthropic's Agent Skills to Any MCP-compatible Agent;PyPI `mcp-agentskills`)— https://github.com/zouyingcao/agentskills-mcp
- 核验(web_fetch 直读):**12★ / 2 forks / 13 commits** · **Python 100%** · **Apache-2.0** · 建于 **FlowLLM** 框架 · PyPI **v0.1.1(2025-12)**、无 GitHub release · **⚠️ 需 `FLOW_LLM_API_KEY`(外部 OpenAI 兼容 LLM)**。**早期 / 个人项目**,当**清晰的操作分解参照**看。
- ② 优秀在哪 / 亮点:
  - **把渐进披露映射成 4 个离散 op(最该看的点)**:`load_skill_metadata_op`(启动**常驻**所有 skill 的名+描述)→ `load_skill_op`(触发时按名读 **SKILL.md**)→ `read_reference_file_op`(**按需**读脚本 / 引用)→ `run_shell_command_op`(**按需**执行 skill 自带脚本)——把「该什么时候加载什么」拆成**清晰可实现的状态机词汇**。
  - **官方格式兼容**:用官方 **SKILL.md 文件夹格式**,与 `anthropics/skills` 完全兼容;多源(从 GitHub clone 进 skills 目录)。
  - **多 transport**(stdio / SSE / HTTP),任意 MCP agent 可用;一行 `pip install mcp-agentskills`。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **能力库 / engine-runner ← 借「4 个离散 op = 渐进披露的状态机词汇」** ⭐:玉兔6 skills 加载可借这套**操作分解**(元数据常驻 / 触发加载 SKILL.md / 按需读引用 / 按需跑脚本),把「能力库信任入库 / skills 治理」的**加载语义标准化**为可审计的离散步骤。
  - **能力库 ← 借「统一 SKILL.md 格式 + 与 anthropics/skills 兼容」** ⭐:玉兔6 能力库沿用官方 SKILL.md 格式,降低与社区 skills 的互通 / 迁移成本(对口能力库信任入库)。
  - **能力库 ← 借「run_shell_command_op:skill 自带可执行脚本、按需执行」**:呼应近批「skill = 指令 + 脚本联动」,玉兔6 skills 可带脚本由控制台**按需**执行(注意沙箱 / 授权边界)。
- ④ 难度低-中 / 优先级中:操作分解清晰、官方格式兼容值得借;但 **12★、v0.1.1 极早期、Python、需外部 LLM key** → **借语义 / 格式不引依赖**。
- 边界 / 许可证:**Apache-2.0 已核**;极早期 + **需 `FLOW_LLM_API_KEY`** → 只借范式不引 runtime,**不回显任何 key**;**与 Starlaid 无关**。

### 行动判断(是否加待办卡)
- **本轮不新增公告板待办卡,只写分析 + 归并建议**,理由:① 三例均为**「早期 / 已停维」的范式参照**(语义检索 / 三层懒加载 + token 账 / 离散 op),非「立刻该做的孤立原子动作」;② 三例都**对口既有线**(能力库信任入库 / skills 治理 / 渐进披露契约),应**并入既有卡**而非另开;③ 延续近批克制红线(「不是待办任务」),CEO 未消化既有 source=洞察员 卡前不继续堆卡。
- 归并建议(并入既有卡 / 线,不新增):
  - **claude-skills-mcp 的「向量语义检索该读哪个 + 三级 metadata→content→files + 轻壳/重后端」→ 并入「渐进披露读取契约优化(洞察员自身)」+「能力库信任入库」线**。
  - **Agentic-MCP-Skill 的「三层懒加载 + 可量化 token 账 + daemon 持久连接 / 热重载」→ 并入「engine-runner 工具注入 / 控制台 MCP 管理」线**(Node 栈最可移植,可小范围试)。
  - **agentskills-mcp 的「4 个离散加载 op + 官方 SKILL.md 兼容」→ 并入「能力库信任入库 / skills 治理」卡**(把加载语义标准化为可审计步骤)。

### 本批小结(给 CEO 的一句话借鉴)
- **K-Dense-AI/claude-skills-mcp**:学它「**用向量语义检索『该读哪个 skill』**(而非按目录全量读)+ 三级 metadata→content→files + 轻壳秒起 / 重后端异步」,补玉兔6 渐进披露契约与能力库;**许可证 Apache/MIT 标注待核、已停维**,借范式不引包。**(本批最对口「渐进披露契约本身」)**
- **cablate/Agentic-MCP-Skill**:学它「**三层懒加载 + 可量化 token 账(20 工具用 2 个省 86%)+ daemon 持久连接 / 热重载**」,Node/TS 栈最贴控制台;34★、**极早期 demo 非生产**,借范式不引包。
- **zouyingcao/agentskills-mcp**:学它「**把渐进披露映射成 4 个离散 MCP op(元数据常驻 / 触发加载 / 按需读引用 / 按需跑脚本)+ 官方 SKILL.md 兼容**」,标准化能力库加载语义;Apache-2.0、**v0.1.1 极早期、需外部 LLM key**,借范式不引依赖、**不回显 key**。
- **本轮不新增待办卡**;三例分别并入「渐进披露契约优化 / engine-runner 工具注入 / 能力库信任入库」线。**Starlaid / 星桥 全程排除。**

> watch(本批 web_fetch 直读元数据;HEAD commit SHA 因代理 git ls-remote 受限未取):K-Dense-AI/claude-skills-mcp `main`(**License 待核 + 已停维 → watch=false**,仅留向量检索 / 渐进披露范式备查,391★ / 51 commits / v1.0.6)、cablate/Agentic-MCP-Skill `master`(**license 未核 + 作者明示非生产 → watch=false**,关注是否脱离 demo / 出 release,34★ / 8 commits)、zouyingcao/agentskills-mcp `main`(**Apache-2.0 → watch=true 但谨慎**,关注是否脱离 v0.x / 是否减外部 LLM key 依赖 / 4-op 语义演进,12★ / 13 commits / v0.1.1)。



<!-- insight-scout-run:cr-1782734407570-insight-scout-repos-20260629-20 -->
## 2026-06-29 · 自动洞察(20260629-20 · queue-engine)

network_status=available; 已比对 `seen-repos.json`、`borrowed-libs.md`、`insights.md`,本轮 3 个 URL 未命中既有记录。主题聚焦任务队列引擎 / 调度可靠性 / 失败处置;仅做借鉴分析,不登录、不装依赖、不改运行代码。

### rq/rq
- 是什么:Redis Queue 的 Python 任务队列,官方文档说明为 BSD 授权;GitHub API license 为 NOASSERTION,落地前以 LICENSE 原文复核。
- 值得借鉴:失败任务有 `Started/Deferred/Finished/Failed/Scheduled` 等注册表,并支持 `Retry(max, interval)`、唯一任务、失败/完成 webhook。
- 迁移边界:Redis 语义偏单栈;控制台只借“失败注册表 + 可清理/重试 + 唯一任务”状态词汇,不引 Redis 队列。
- URL: https://github.com/rq/rq

### agronholm/apscheduler
- 是什么:Python 调度器与轻量任务队列,MIT;支持持久化 schedule/job,多 scheduler/worker 共享数据源。
- 值得借鉴:misfire grace、同一任务最大并发、jitter、Cron/Interval/Date trigger,适合补控制台定时任务“迟到/重入/抖动”语义。
- 迁移边界:v4 预发布明确不建议生产;控制台应参考稳定 3.x 的调度概念,不搬 Python runtime。
- URL: https://github.com/agronholm/apscheduler

### PrefectHQ/prefect
- 是什么:Python 工作流编排框架,Apache-2.0;官方 README 与文档强调 scheduling、caching、retries、state tracking。
- 值得借鉴:flow/task 分层重试、状态对象/状态历史、手动 retry 保留 run id、缓存恢复昂贵任务,适合长任务失败续跑设计。
- 迁移边界:数据工程平台体量大;控制台只借状态机、retry/cache 语义和 UI 观察方式,不引整套编排平台。
- URL: https://github.com/PrefectHQ/prefect

### 判断
- 不新增公告板卡:既有“队列失败处置契约”卡已覆盖本轮可行动作;本轮三例只补充成熟术语与边界,应归并到既有卡而非继续堆待办。



<!-- insight-scout-run:run-20260629T1205Z-insight-scout-repos -->
## 2026-06-29 · 自动洞察(run-20260629T1205Z · 优秀网页设计 / 前端 UI:控制台 cmd+K · 公告板 kanban · insights 阅读)

network_status=available;已比对 `seen-repos.json` / `insights.md` / `borrowed-libs.md`,本轮 3 个 URL(react-cmdk / react-kanban-kit / docsify)均未命中既有记录。主题轮换到「优秀网页设计 / 前端 UI」(近 5 轮为 queue-engine / skills / multi-agent / durable-exec / unity,未碰前端 UI),对口玉兔6 三个看得见的界面:**控制台操作面板 / 公告板看板 / insights 阅读**。只读写 board/insights/;只做借鉴分析,不登录、不装依赖、不改运行代码;不回显任何密钥;Starlaid 全程排除。

> 选型说明:前端 UI 大库(shadcn-ui / tabler / mantine / tremor / react-bits / magicui / kbar 等)既往已收录,本轮特意挑**未收录、且各自精准对口一个玉兔6 界面**的三例 —— 一个命令面板、一个看板组件、一个零构建 Markdown 站点。

### 1. albingroen/react-cmdk — 「可组合 + 多级 page + ⌘K」的 React 命令面板
- ① 名称 / URL:albingroen/react-cmdk(A fast, accessible, and pretty command palette for React;npm `react-cmdk`)— https://github.com/albingroen/react-cmdk
- 核验(web_fetch 直读):**1.2k★ / 49 forks / 125 commits** · **MIT** · **TypeScript 86.5%** · 基于 headlessui + tailwind · 单一维护者(albingroen)、活跃度偏轻量 → 当**成熟范式参照**看。
- ② 优秀在哪 / 亮点:
  - **JSON 结构驱动 + 内置过滤**:命令以 `{heading, items[]}` 的 JSON 结构声明,配 `filterItems(items, search)` / `getItemIndex()` 工具——「数据声明命令、库负责检索 / 高亮 / 键盘选中」,接入成本低。
  - **多级 page(`CommandPalette.Page`)**:支持 root → projects 等**子页面下钻**,一个面板里分层导航;每页可独立 `onEscape` 返回。
  - **⌘K 即开**:自带 `useHandleOpenCommandPalette` hook(mac 用 ⌘K / 其余 Ctrl+K),也可自定义键位;Accessible / 暗色模式 / 速度作为首要卖点。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **控制台 ← 借「⌘K 命令面板 + JSON 结构声明命令」** ⭐⭐:玉兔6 控制台 / 公告板可加一个全局 ⌘K 入口,用**声明式 JSON**把「跳转某张卡 / 打开某 repair-ticket / 检索 insights / 触发洞察员运行」做成可检索命令项,`filterItems` 直接复用其过滤范式。对口控制台操作入口。
  - **公告板 / insights 导航 ← 借「多级 page 下钻」** ⭐:命令面板内用 page 分层(卡片 → 修复单 → 洞察),避免一屏堆所有动作。
  - **交互细节 ← 借「键盘可达 + 暗色模式 + free-search action」**:无结果时给「直接搜索 X」兜底项,提升空状态体验。
- ④ 难度低 / 优先级中:命令面板范式清晰、TS+MIT 可读性高;但**单人维护 + 活跃度轻**,建议**借范式(JSON 命令 + page + ⌘K hook),按需引包或自实现**。
- 边界 / 许可证:**MIT 已核**;依赖 headlessui / tailwind,若玉兔6 控制台非该栈则借范式不引包。**与 Starlaid 无关**。

### 2. braiekhazem/react-kanban-kit — 「归一化 BoardData + 虚拟滚动 + 骨架 / 无限滚动」的看板组件(底层用 Atlassian pragmatic-drag-and-drop)
- ① 名称 / URL:braiekhazem/react-kanban-kit(npm `react-kanban-kit`)— https://github.com/braiekhazem/react-kanban-kit
- 核验(web_fetch 直读):**70★ / 5 forks / 56 commits** · **MIT(README 明示;License 页仅显 View license,落地前核 LICENSE 原文)** · **TypeScript 58% + SCSS 32%** · 底层 **Atlassian pragmatic-drag-and-drop** · 最新 **v0.0.2-beta.7(2026-04-21,Column DnD)**——**早期 beta**,当**结构 / 性能范式参照**看,不直接当生产依赖。
- ② 优秀在哪 / 亮点:
  - **归一化扁平 BoardData(最该看的点)**:整块看板是一张 `{id: BoardItem}` 字典 + `root.children` 列出列、每列 `children[]` 列出卡;`BoardItem` 带 `parentId / children / totalChildrenCount / type / content`。**扁平 id 索引**让「移动卡 / 移动列」只改引用数组,天然贴合玉兔6 `cards.json` 这种 id 化卡片存储。
  - **DnD 事件语义干净**:`onCardMove` 回调给出 `{cardId, fromColumnId, toColumnId, taskAbove, taskBelow, position}`,配 `dropHandler` / `dropColumnHandler` 纯函数算出新 dataSource——**「事件 → 纯函数 reducer → 新状态」**,可审计、可单测。
  - **虚拟滚动 + 骨架 + 无限滚动**:`virtualization` 默认开;用 `totalChildrenCount > children.length` 决定渲染多少骨架卡,骨架进入视口自动触发 `loadMore(columnId)`——大量卡片不卡、按列懒加载。
  - **view-only 模式 + configMap 按类型渲染**:`viewOnly` 一键禁所有拖拽(适合 CEO 只读看板);`configMap[type].render` 按卡片类型(card / divider / footer…)分别渲染。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **公告板 ← 借「归一化 BoardData + 事件 → 纯函数 reducer」** ⭐⭐:玉兔6 `cards.json`(todo / in_progress / done)可借这套**扁平 id 化模型 + `dropHandler` 式纯函数迁移**,把「卡片状态流转」做成可单测、可审计的 reducer,呼应近批一直在推的「队列 / 卡片状态机」。
  - **公告板 ← 借「totalChildrenCount / 骨架 / loadMore 的按列懒加载」** ⭐:当某列卡片很多(如 repair-tickets 累积),用「真实总数 vs 已加载数 → 骨架占位 → 滚动触发 loadMore」按需加载,控制台不必一次吐全量卡。
  - **公告板只读视图 ← 借「viewOnly + configMap 按类型渲染」**:给 CEO / 老板一个**只读看板**视图(viewOnly),并按卡片来源 / 类型(洞察员卡 / 修复单 / 普通待办)用不同 render 区分。
  - **底层拖拽 ← 关注 Atlassian pragmatic-drag-and-drop**:若要自研看板拖拽,优先看其底层依赖(成熟、可达性好、框架无关),react-kanban-kit 是其高层封装样例。
- ④ 难度中 / 优先级中:数据模型与纯函数迁移**直接对口 cards.json**,值得借结构;但**70★ / v0.0.2-beta 极早期** → **借模型与 reducer 范式,不把 beta 包列生产依赖**;真要用拖拽看底层 pragmatic-dnd。
- 边界 / 许可证:**MIT(以 LICENSE 原文为准)**;早期 beta、API 可能变 → 只借范式。**与 Starlaid 无关**。

### 3. docsifyjs/docsify — 「零构建、运行时解析 Markdown + 全文检索插件」的文档站点生成器
- ① 名称 / URL:docsifyjs/docsify(A magical documentation site generator;npm `docsify` / `docsify-cli`)— https://github.com/docsifyjs/docsify
- 核验(web_fetch 直读):**31.3k★ / 5.8k forks / 1,962 commits** · **MIT** · **JavaScript 88%** · 客户端 SPA(index.html 运行时拉取 / 解析 .md,**不生成静态 HTML**)· 最新 release **v4.13.1(2023-06)**、develop 分支仍活跃(husky / jest / playwright 工具链)——**成熟稳定**,当**架构范式**看。
- ② 优秀在哪 / 亮点:
  - **零构建、运行时渲染(最该看的点)**:把一个 / 多个 **Markdown 原文**在浏览器端即时解析成站点,**无需打包步骤**、无静态 HTML;一个 index.html + 指向 .md 目录即可。
  - **智能全文检索插件**:内置 search 插件对 Markdown 做客户端全文检索,无需后端索引服务。
  - **侧边栏导航 / 多主题 / 插件 API / emoji**:`_sidebar.md` 声明目录,主题与插件可插拔。
- ③ 玉兔6 可借鉴(借它的 X 改我们的 Y):
  - **insights 阅读 ← 借「零构建、运行时解析现有 .md 成可浏览站点」** ⭐⭐:玉兔6 `insights.md` 已 **543KB 且持续增长**,加上 `references/archive-*.md` 冷区——可借 docsify 范式给老板 / CEO 一个**指向现有 board/insights/ 目录的零构建阅读站**(运行时渲染 + `_sidebar` 按日期 / 主题分节),**不必新建打包流水线**,与「渐进披露读取契约」「冷区索引」天然契合。
  - **insights 检索 ← 借「客户端全文检索插件」** ⭐:对 insights.md + 归档做**前端全文检索**(按仓库名 / 主题 / 日期跳转),替代现在「grep 找小节」的人工方式,正好补 seen-repos 之外的「按内容找历史分析」。
  - **导航 ← 借「`_sidebar.md` 声明式目录」**:用一份 sidebar 把「最近 4 批热区 + references 冷区」做成可点目录,呼应 README 的热区 / 冷区分层。
- ④ 难度低-中 / 优先级中:**零构建 + 运行时 Markdown + 前端检索**几乎是为 insights 这种「持续增长的本地 .md」量身;成熟 MIT、可直接落地小试(纯静态,不引服务端)。注意:大文件首次加载与检索性能需按分节 / 分文件优化(正好配合冷区拆分)。
- 边界 / 许可证:**MIT 已核**;纯前端、不需登录 / 后端 → 安全面小;仅作 insights 阅读层,不改写 insights 数据。**与 Starlaid 无关**。

### 行动判断(是否加待办卡)
- **本轮不新增公告板待办卡,只写分析**,理由:① 三例都是**前端 UI 设计范式参照**(命令面板 / 看板数据模型 / 零构建文档站),非「立刻必须执行的孤立原子动作」;② 均对口既有界面线(控制台 / 公告板 / insights 阅读),应在 CEO 决定动某个界面时**并入对应改造**,而非另开待办;③ 延续近批克制红线——CEO 未消化既有 source=洞察员 卡前不继续堆卡。
- 归并建议(并入既有线,不新增):
  - **react-cmdk「⌘K + JSON 命令 + 多级 page」→ 并入「控制台操作入口 / 可用性」线**(要做全局命令面板时取范式)。
  - **react-kanban-kit「归一化 BoardData + 事件 → 纯函数 reducer + viewOnly / 懒加载」→ 并入「公告板 / 卡片状态机」线**(cards.json 模型与迁移可审计化)。
  - **docsify「零构建运行时 Markdown + 全文检索 + sidebar」→ 并入「insights 渐进披露 / 冷区导航 + CEO 阅读层」线**。

### 本批小结(给 CEO 的一句话借鉴)
- **albingroen/react-cmdk**:学它「**声明式 JSON 命令 + 多级 page + ⌘K 即开**」,给控制台加一个全局命令面板;MIT、1.2k★ 但单人维护,借范式按需引包。
- **braiekhazem/react-kanban-kit**:学它「**扁平归一化 BoardData + onCardMove 事件 → `dropHandler` 纯函数迁移 + viewOnly / 虚拟滚动 / 骨架懒加载**」,直接对口 `cards.json` 看板与只读视图;MIT、但 **v0.0.2-beta 极早期**,借模型不引 beta 包,拖拽看底层 Atlassian pragmatic-drag-and-drop。
- **docsifyjs/docsify**:学它「**零构建、运行时解析现有 Markdown 成站点 + 客户端全文检索 + `_sidebar` 目录**」,给持续增长的 `insights.md` / 冷区做一个 CEO 阅读 + 检索层;MIT、31.3k★、成熟稳定,可小试。
- **本轮不新增待办卡**;三例分别并入「控制台操作入口 / 公告板卡片状态机 / insights 阅读与检索」线。**Starlaid / 星桥 全程排除。**

> watch(本批 web_fetch 直读元数据;HEAD commit SHA 因代理 git ls-remote 受限未取):albingroen/react-cmdk `main`(**MIT → watch=true 但谨慎**,单人维护,关注是否出新 release / 维护活跃度,1.2k★ / 125 commits)、braiekhazem/react-kanban-kit `main`(**MIT 待核 LICENSE 原文 → watch=true**,关注是否脱离 v0.0.x-beta / API 稳定,70★ / 56 commits / v0.0.2-beta.7)、docsifyjs/docsify `develop`(**MIT → watch=false**,成熟稳定仅备查范式,31.3k★ / 1962 commits / v4.13.1)。



<!-- insight-scout-run:20260630-00 -->
## AI agent 工具/skills/能力库治理(slot=20260630-00)
说明:本轮网络可用;先按 seen-repos/borrowed-libs/insights 去重,避开已收录的 LangGraph、Semantic Kernel、OpenAI Agents、MCP Registry、NVIDIA/skills、agentskills 等。排除项已硬排除。

### vercel-labs/skills
- 是什么:Vercel 的 open agent skills CLI,用 SKILL.md + YAML frontmatter 管理可复用技能。
- 值得借鉴:统一 source formats、agent path map、project/global scope、list/find/update/remove,把技能安装做成包管理体验。
- 迁移边界/许可证不确定项:package.json/README 标 MIT,GitHub API license 未识别;只借 CLI/目录约定,不运行 npx。
- URL: https://github.com/vercel-labs/skills

### tankpkg/tank
- 是什么:security-first skills package manager,MIT;以 skills.json、skills.lock、权限预算和 audit 管技能。
- 值得借鉴:SHA-512 lockfile、permission budget、静态扫描/评分,把安装前的信任判断显式化。
- 迁移边界/许可证不确定项:34★、MVP 早期;publish/login 涉 OAuth 不碰,只借字段与检查流程。
- URL: https://github.com/tankpkg/tank

### Agent-Card/ai-catalog
- 是什么:AI Catalog 规范仓,给 A2A/MCP/Agent Card 等异构 artifact 做 typed/nestable 目录。
- 值得借鉴:entry 用 media type 引用原生元数据,Trust Manifest 独立承载 identity/attestation/provenance。
- 迁移边界/许可证不确定项:代码 Apache-2.0,规格/文档 CC-BY-4.0;仍属早期标准化,只借目录/信任清单分层。
- URL: https://github.com/Agent-Card/ai-catalog

### 判断
- 不新增公告板卡:现有“起草控制台能力库信任/入库契约 v0”已覆盖本轮行动;本轮三例并入该卡,补充 skills CLI 路径表、permission budget/lockfile、Trust Manifest 三项证据。



<!-- insight-scout-run:20260630-04 -->
## LLM 网关 / 成本质量路由 / 可观测(slot=20260630-04)
说明:network_status=available;已按 seen-repos/borrowed-libs/insights 去重,LiteLLM/Portkey/Langfuse/Helicone/RouteLLM/TensorZero/Envoy/OpenLIT/openziti/Kong/agentgateway 等已入库,本轮只收 3 个未见 URL;只读 GitHub API/README/LICENSE,未登录、未安装、未接 OAuth。

### future-agi/future-agi
- 是什么:Apache-2.0 的自托管 AI engineering 平台,把 gateway、tracing、eval、guardrails、semantic caching 放进同一反馈回路。
- 值得借鉴:把 routing decision、trace span、eval score、guardrail result、token/cost 串成一张“质量+成本”账本,正好补控制台网关契约字段。
- 迁移边界/许可证不确定项:Apache-2.0 已核;Django/Go/React/Postgres/ClickHouse/Redis/RabbitMQ 栈偏重,只借接口与数据回路,不接运行时。
- URL: https://github.com/future-agi/future-agi

### NadirRouter/NadirClaw
- 是什么:MIT 的本地 OpenAI/Anthropic 兼容路由代理,面向 Codex/Claude Code 等 coding agent 做 simple/mid/complex 分层与成本优化。
- 值得借鉴:三层路由 profile、verifier-gated cascade、Prometheus 指标、per-request 成本与预算告警,可转成“工位/任务级模型档位”规则。
- 迁移边界/许可证不确定项:MIT 已核;README 含 OAuth/API key 路径但本轮不触碰,其省钱比例需用玉兔6自有 trace 离线复测。
- URL: https://github.com/NadirRouter/NadirClaw

### taichuy/1flowbase
- 是什么:Apache-2.0 的本地 AI gateway/workflow 工具,把多模型 workflow 发布成 OpenAI/Claude 兼容的虚拟模型端点。
- 值得借鉴:“一个 model name 背后一条可观测 workflow”很适合控制台把视觉、评审、格式化等多步能力封装为可追踪虚拟模型。
- 迁移边界/许可证不确定项:Apache-2.0 已核;权限、审批、审计、成本治理仍在路线图,只借虚拟模型与节点 trace 字段。
- URL: https://github.com/taichuy/1flowbase

### 判断
- 不新增公告板卡:现有“起草控制台 LLM 网关账本/追踪契约 v0”已覆盖本轮行动;本轮三例并入该卡,补充 feedback loop、tiered cascade、workflow-backed virtual model 三项设计证据。



<!-- insight-scout-run:cr-1782748807634-insight-scout-repos-20260630-00 -->
## 2026-06-29 · 自动洞察(20260630-00 · agent-tools-skills)

> 来源:洞察员; run=cr-1782748807634-insight-scout-repos-20260630-00; queue=insight-scout/insight-scout-repos-20260630-00; network=available

## AI agent 工具/skills/能力库治理(slot=20260630-00)
说明:本轮网络可用;先按 seen-repos/borrowed-libs/insights 去重,避开已收录的 LangGraph、Semantic Kernel、OpenAI Agents、MCP Registry、NVIDIA/skills、agentskills 等。排除项已硬排除。

### vercel-labs/skills
- 是什么:Vercel 的 open agent skills CLI,用 SKILL.md + YAML frontmatter 管理可复用技能。
- 值得借鉴:统一 source formats、agent path map、project/global scope、list/find/update/remove,把技能安装做成包管理体验。
- 迁移边界/许可证不确定项:package.json/README 标 MIT,GitHub API license 未识别;只借 CLI/目录约定,不运行 npx。
- URL: https://github.com/vercel-labs/skills

### tankpkg/tank
- 是什么:security-first skills package manager,MIT;以 skills.json、skills.lock、权限预算和 audit 管技能。
- 值得借鉴:SHA-512 lockfile、permission budget、静态扫描/评分,把安装前的信任判断显式化。
- 迁移边界/许可证不确定项:34★、MVP 早期;publish/login 涉 OAuth 不碰,只借字段与检查流程。
- URL: https://github.com/tankpkg/tank

### Agent-Card/ai-catalog
- 是什么:AI Catalog 规范仓,给 A2A/MCP/Agent Card 等异构 artifact 做 typed/nestable 目录。
- 值得借鉴:entry 用 media type 引用原生元数据,Trust Manifest 独立承载 identity/attestation/provenance。
- 迁移边界/许可证不确定项:代码 Apache-2.0,规格/文档 CC-BY-4.0;仍属早期标准化,只借目录/信任清单分层。
- URL: https://github.com/Agent-Card/ai-catalog

### 判断
- 不新增公告板卡:现有“起草控制台能力库信任/入库契约 v0”已覆盖本轮行动;本轮三例并入该卡,补充 skills CLI 路径表、permission budget/lockfile、Trust Manifest 三项证据。



<!-- insight-scout-run:cr-1782763208470-insight-scout-repos-20260630-04 -->
## 2026-06-29 · 自动洞察(20260630-04 · llm-gateway)

> 来源:洞察员; run=cr-1782763208470-insight-scout-repos-20260630-04; queue=insight-scout/insight-scout-repos-20260630-04; network=available

## LLM 网关 / 成本质量路由 / 可观测(slot=20260630-04)
说明:network_status=available;已按 seen-repos/borrowed-libs/insights 去重,LiteLLM/Portkey/Langfuse/Helicone/RouteLLM/TensorZero/Envoy/OpenLIT/openziti/Kong/agentgateway 等已入库,本轮只收 3 个未见 URL;只读 GitHub API/README/LICENSE,未登录、未安装、未接 OAuth。

### future-agi/future-agi
- 是什么:Apache-2.0 的自托管 AI engineering 平台,把 gateway、tracing、eval、guardrails、semantic caching 放进同一反馈回路。
- 值得借鉴:把 routing decision、trace span、eval score、guardrail result、token/cost 串成一张“质量+成本”账本,正好补控制台网关契约字段。
- 迁移边界/许可证不确定项:Apache-2.0 已核;Django/Go/React/Postgres/ClickHouse/Redis/RabbitMQ 栈偏重,只借接口与数据回路,不接运行时。
- URL: https://github.com/future-agi/future-agi

### NadirRouter/NadirClaw
- 是什么:MIT 的本地 OpenAI/Anthropic 兼容路由代理,面向 Codex/Claude Code 等 coding agent 做 simple/mid/complex 分层与成本优化。
- 值得借鉴:三层路由 profile、verifier-gated cascade、Prometheus 指标、per-request 成本与预算告警,可转成“工位/任务级模型档位”规则。
- 迁移边界/许可证不确定项:MIT 已核;README 含 OAuth/API key 路径但本轮不触碰,其省钱比例需用玉兔6自有 trace 离线复测。
- URL: https://github.com/NadirRouter/NadirClaw

### taichuy/1flowbase
- 是什么:Apache-2.0 的本地 AI gateway/workflow 工具,把多模型 workflow 发布成 OpenAI/Claude 兼容的虚拟模型端点。
- 值得借鉴:“一个 model name 背后一条可观测 workflow”很适合控制台把视觉、评审、格式化等多步能力封装为可追踪虚拟模型。
- 迁移边界/许可证不确定项:Apache-2.0 已核;权限、审批、审计、成本治理仍在路线图,只借虚拟模型与节点 trace 字段。
- URL: https://github.com/taichuy/1flowbase

### 判断
- 不新增公告板卡:现有“起草控制台 LLM 网关账本/追踪契约 v0”已覆盖本轮行动;本轮三例并入该卡,补充 feedback loop、tiered cascade、workflow-backed virtual model 三项设计证据。



<!-- insight-scout-run:cr-1782777608404-insight-scout-repos-20260630-08 -->
## 2026-06-30 · 自动洞察(20260630-08 · gui-grounding)

> 来源:洞察员; run=cr-1782777608404-insight-scout-repos-20260630-08; queue=insight-scout/insight-scout-repos-20260630-08; network=available

## GUI grounding / computer-use / a11y 借鉴扫描(slot 20260630-08)
说明:network_status=available;已按 seen-repos/borrowed-libs/insights 去重,OmniParser、axe-core、UI-Vision、OpenCUA、ClawGUI 等已入库,本轮只收 3 个未见 URL;未登录、未安装、未处理密钥或授权。

### OS-Copilot/OS-Atlas
- 是什么:Apache-2.0 的 GUI grounding 模型/数据项目,ICLR 2025,模型输出 0-1000 相对点或 bbox。
- 值得借鉴:统一相对坐标与多平台截图定位接口,可作为控制台视觉兜底 grounding 数据格式参考。
- 迁移边界/许可证不确定项:代码 Apache-2.0;权重基于 InternVL/Qwen2-VL,采纳模型前需逐项核底座与数据条款。
- URL:https://github.com/OS-Copilot/OS-Atlas

### w3c/aria-practices
- 是什么:W3C WAI-ARIA APG 官方实践库,维护常见控件的 role/name/state/keyboard 交互模式。
- 值得借鉴:把按钮、菜单、tab、combobox、dialog 的可访问语义转成控制台 a11y/grounding 自查清单。
- 迁移边界/许可证不确定项:W3C Software and Document License;适合借规范和验收项,不搬示例代码。
- URL:https://github.com/w3c/aria-practices

### adobe/react-spectrum
- 是什么:Apache-2.0 的 React Spectrum/React Aria 库,提供可访问组件行为、状态管理与设计系统实现。
- 值得借鉴:同一控件同时覆盖键盘、屏幕阅读器、触摸/鼠标和国际化,适合拆为 agent-friendly 组件契约。
- 迁移边界/许可证不确定项:控制台不应为此引 React 链;只借行为矩阵/测试思路,若复制代码需保留 Apache notice。
- URL:https://github.com/adobe/react-spectrum

### 判断
- 生成 1 张公告板候选:先纯文档起草《控制台 a11y 组件行为清单 v0》,把高频控件的 role/name/state/focus/keyboard 规则纳入人工验收,补足 computer-use grounding 的语义地基。



<!-- insight-scout-run:cr-1782792044899-insight-scout-repos-20260630-12 -->
## 2026-06-30 · 自动洞察(20260630-12 · pixel-assets-ui)
说明:network_status=available;已按 seen-repos/borrowed-libs/insights 去重,避开 Piskel、Pixelorama、PixiEditor、gumdrop、Supabase、shadcn 等已入库 URL;只读公开页/GitHub README,未登录、不安装、不处理密钥或授权;Starlaid/星桥 全程排除。

### Tezumie/Image-to-Pixel
- 是什么:图像转像素 Web 编辑器和 JS API,支持抖动算法、调色板管理、Lospec palette slug 与不同导出分辨率。
- 值得借鉴:把“上传原图→像素宽度→抖动算法/强度→调色板→导出”做成一屏实时参数面板,适合作控制台素材生成后的轻量二次处理。
- 迁移边界/许可证不确定项:库 MIT、应用 Apache-2.0,GitHub 侧栏识别 Unknown;API 文档仍进行中,只借交互链路和参数字段。
- URL: https://github.com/Tezumie/Image-to-Pixel

### Lospec Palette List
- 是什么:像素艺术调色板数据库,公开页面提供筛选/API入口,单色板可查看、下载或复制颜色。
- 值得借鉴:用 slug、色块预览、标签/排序组织调色板,可借给“项目调色板白名单+生成结果色彩约束”的 UI。
- 迁移边界/许可证不确定项:站点/调色板整体授权不等于可镜像;单色板作者与许可需逐项核验,只借导航与格式思路。
- URL: https://lospec.com/palette-list

### openobserve/openobserve
- 是什么:Apache-2.0 observability 控制台,覆盖 logs、metrics、traces、frontend monitoring、pipelines 与 LLM observability。
- 值得借鉴:单控制台收纳查询、日志表、直方图、dashboard builder 与 LLM 输入/输出全文检索,适合排查“素材任务/模型调用/导出记录”。
- 迁移边界/许可证不确定项:Apache-2.0;后端栈和企业功能不引入,只借密集信息架构与查询/表格/图表联动。
- URL: https://github.com/openobserve/openobserve

### 判断
- 不新增公告板卡:已存在同主题像素素材工作台 RFC 候选,本轮只补轻量参数化像素化、调色板白名单、密集观测台三项证据。



<!-- insight-scout-run:cr-1782806445601-insight-scout-repos-20260630-16 -->
## 2026-06-30 · 自动洞察(20260630-16 · unity-simulaid-methods)

> 来源:洞察员; run=cr-1782806445601-insight-scout-repos-20260630-16; queue=insight-scout/insight-scout-repos-20260630-16; network=available

## Unity/团结工作流方法论借鉴扫描(slot 20260630-16)\n> 去重: 已比对 board/insights/seen-repos.json、borrowed-libs.md、insights.md，以下 3 个 URL 未见重复。\n\n### Unity-Technologies/UnityDataTools\n- 是什么: Unity 官方实验命令行工具，离线读取 AssetBundle、Player、Addressables 构建输出，生成 SQLite/文本分析资料。\n- 值得借鉴: 把“构建后感觉变大”变成对象级/依赖级可查询差异，适合做非确定性构建和资源体积回归门禁。\n- 迁移边界/许可证不确定项: Unity Companion License，仅限 Unity-dependent 项目；官方标注 as-is/不保证支持，建议只借报告模型与对比脚本思路。\n- URL: https://github.com/Unity-Technologies/UnityDataTools\n\n### microsoft/Microsoft.Unity.Analyzers\n- 是什么: Microsoft 的 Unity Roslyn analyzers，为 Visual Studio/VS Code/Unity 类库提供 Unity 专属诊断与 suppressor。\n- 值得借鉴: 将“Unity 代码规范”前移到 IDE/CI 静态诊断，可沉淀 Editor-only、空生命周期方法、误报抑制等规则清单。\n- 迁移边界/许可证不确定项: MIT；依赖 Roslyn/IDE 生态，团结兼容版本需按实际 Editor/VS 工具链核验，不应直接套用所有规则。\n- URL: https://github.com/microsoft/Microsoft.Unity.Analyzers\n\n### needle-tools/compilation-visualizer\n- 是什么: Needle 的 Unity 编译时间线工具，按程序集展示编译耗时、依赖和被依赖关系。\n- 值得借鉴: 用可视化 asmdef 依赖图定位重编译链，把“编辑器卡/编译慢”转成可量化拆包行动。\n- 迁移边界/许可证不确定项: MIT；README 标注 Unity 2018.4-2022.1，团结/Unity6 需先做只读验证，只借 asmdef 体检方法。\n- URL: https://github.com/needle-tools/compilation-visualizer
