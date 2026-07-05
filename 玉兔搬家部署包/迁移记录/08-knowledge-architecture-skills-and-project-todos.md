# 新 Mac mini 知识架构、Skills 与项目迁移待办

生成时间：2026-06-17  
用途：给 Claude/Codex/未来安装智能体读取，用来把本机 Mac mini 上的 Hermes/玉兔、全局模块索引、指令补齐稿、专门 skills、项目仓库、自动研究优秀代码库和过往踩坑经验迁移到新 Mac mini。  
安全原则：本文件不保存 API key、token、cookie、session、验证码、密码、私钥、邮箱通讯录明文或付款信息。遇到密钥只写“需要用户重新授权/重新提供”。

## 0. 先给安装智能体看的结论

本机改版 Hermes 代码目录：

`/Users/yutu/.hermes/hermes-agent`

迁移资料包入口：

`/Users/yutu/Desktop/Hermes-Yutu-Migration-Records/README.md`

本文件是新增总目录：

`/Users/yutu/Desktop/Hermes-Yutu-Migration-Records/08-knowledge-architecture-skills-and-project-todos.md`

新机安装智能体应先读 `README.md`，再读本文件，然后按“项目仓库待办”和“需用户授权清单”逐项执行。不要直接复制敏感文件；应该让用户在新机重新登录 GitHub/Gitee/Gmail/飞书/OpenAI/模型 API。

## 1. 当前迁移包位置与结构

迁移包：

`/Users/yutu/Desktop/Hermes-Yutu-Migration-Records`

两层结构：

```text
/Users/yutu/Desktop/Hermes-Yutu-Migration-Records
├── 00-handoff-prompt.md
├── 01-system-overview.md
├── 02-capabilities-and-flows.md
├── 03-migration-checklist.md
├── 04-operations.md
├── 05-conversation-timeline.md
├── 06-known-risks.md
├── 07-live-paths-and-data.md
├── 08-knowledge-architecture-skills-and-project-todos.md
├── README.md
├── manifest.json
├── module-snapshot/
│   ├── INDEX.md
│   ├── quick-context.md
│   └── ...
└── reference/
    ├── INDEX.md
    └── registry.json
```

已有文件分工：

| 文件 | 用途 |
| --- | --- |
| `00-handoff-prompt.md` | 给未来 agent 的直接交接提示词。 |
| `01-system-overview.md` | Hermes/玉兔整体架构。 |
| `02-capabilities-and-flows.md` | 语音、飞书、Codex handoff、热词、Brave Search 流程。 |
| `03-migration-checklist.md` | 换机/换 agent 检查清单。 |
| `04-operations.md` | 常用重启、验证和日志命令。 |
| `05-conversation-timeline.md` | 初期配置过程摘要。 |
| `06-known-risks.md` | 已知风险。 |
| `07-live-paths-and-data.md` | 真实运行路径、日志、插件、敏感数据位置。 |
| `08-knowledge-architecture-skills-and-project-todos.md` | 本文件：全局知识架构、skills、项目仓库、优秀代码库和新机待办。 |

## 2. 本机改版 Hermes / 玉兔复刻摘要

### 2.1 代码与版本

| 项 | 当前值 |
| --- | --- |
| 改版 Hermes 代码目录 | `/Users/yutu/.hermes/hermes-agent` |
| 官方远程 | `https://github.com/NousResearch/hermes-agent.git` |
| 当前分支 | `main` |
| 当前提交 | `0e235947b95d48decd1f378fdb111aff62155894` |
| 版本描述 | `v2026.4.23-108-g0e235947-dirty` |
| 工作区状态 | 有 5 个未提交源码改动，需要迁移为补丁或提交到私有 fork。 |

当前被改动文件：

```text
/Users/yutu/.hermes/hermes-agent/gateway/platforms/feishu.py
/Users/yutu/.hermes/hermes-agent/gateway/run.py
/Users/yutu/.hermes/hermes-agent/hermes_cli/plugins.py
/Users/yutu/.hermes/hermes-agent/tests/gateway/test_busy_session_ack.py
/Users/yutu/.hermes/hermes-agent/tools/transcription_tools.py
```

新机复刻方式建议：

1. 新机先 clone 官方 Hermes 或用户自己的私有 fork。
2. 再把上面 5 个文件的本机差异做成 patch 应用。
3. 再恢复 `/Users/yutu/.hermes/plugins`、`/Users/yutu/.hermes/voice-wake`、`.codex/modules`、`.codex/skills` 中的玉兔相关能力。
4. 最后由用户重新配置飞书、模型、Gmail、Brave Search、语音服务等密钥。

### 2.2 Hermes/Yutu 多出来的主要功能

| 功能 | 对应位置/模块 | 一句话实现思路 |
| --- | --- | --- |
| 飞书消息队列/忙碌提示 | Hermes gateway + `hermes-yutu-voice-bridge` 模块 | Hermes 忙时不打断当前任务，把新消息变成队列提示。 |
| Codex handoff | `multi-agent-collaboration-contract` + Hermes 插件 | 玉兔识别编码/邮件/文件等任务后，经用户确认转给 Codex。 |
| 飞书确认卡片 | Hermes Feishu 平台层 | 需要人工确认的任务用卡片授权，避免口头误触发。 |
| 语音唤醒与发声 | `/Users/yutu/.hermes/voice-wake` + LaunchAgent | 本机监听唤醒词，回复“我在/重启完成/飞书来消息了”等语音。 |
| 语音回复同步到飞书 | Hermes/Yutu voice bridge | 本地语音交互也沉淀为飞书可见记录。 |
| ASR 热词与纠错 | `tools/transcription_tools.py` + 模块文档 | 持久化热词，减少“Codex/玉兔/项目名”等识别错误。 |
| Brave Search | Hermes 配置/工具层 | 让玉兔具备联网搜索能力；新机需重新填 API。 |
| 定时/延时任务规划 | 多 agent 协作契约 + Hermes 任务层 | 后续让用户用自然语言安排延时或循环任务。 |
| 文件/APK 交付意识 | Hermes/Yutu + Simulaid/YuanXiao skills | 玉兔知道大文件或安装包应交给 Codex/对应构建流程处理。 |

### 2.3 运行与敏感路径

常见运行目录：

```text
/Users/yutu/.hermes
├── hermes-agent/
├── plugins/
├── voice-wake/
├── .env              # 含密钥，不要打包明文
└── auth.json         # 含授权状态，不要打包明文

/Users/yutu/.codex
├── modules/
├── skills/
├── memories/
└── auth.json         # 含授权状态，不要打包明文
```

常见 LaunchAgent 标签：

```text
ai.hermes.gateway
ai.hermes.dashboard
com.yutu.hermes.voicewake
```

迁移注意：

- `.env`、`auth.json`、飞书 token、模型 API key、Gmail 授权、SSH 私钥都不要放进安装包。
- 新机应生成 `.env.example` 或配置向导，让用户逐项重新授权。
- Hermes 源码是 MIT/开源体系下可修改，但如果重新发布为 “Yutu” 安装包，应保留原项目许可证与出处，并把自定义能力写清楚。

## 3. 全局模块索引架构

模块根目录：

`/Users/yutu/.codex/modules`

入口文件：

```text
/Users/yutu/.codex/modules/INDEX.md
/Users/yutu/.codex/modules/registry.json
/Users/yutu/.codex/modules/scripts/module_lookup.py
```

规则：

1. 用户提到本地旧配置、Hermes/玉兔、飞书、Codex handoff、语音、ASR、多 agent、Simulaid、YuanXiao、Zongzi 时，先读模块索引，不要全局乱搜。
2. 先用 `registry.json` 或 `module_lookup.py` 定位模块。
3. 只打开命中的 `INDEX.md` 和推荐的少量文件。
4. 模块保存长期知识、接口契约、文件图谱、历史坑；skills 只做触发和操作手册。

核心模块：

| 模块 | 路径 | 作用 |
| --- | --- | --- |
| `multi-agent-collaboration-contract` | `/Users/yutu/.codex/modules/multi-agent-collaboration-contract` | Hermes/Yutu、Codex、未来 agent 的能力目录与交接契约。 |
| `hermes-yutu-voice-bridge` | `/Users/yutu/.codex/modules/hermes-yutu-voice-bridge` | 玉兔语音、飞书记录、确认卡片、Codex handoff、ASR 热词、Brave Search。 |
| `chang-e-android-control-plane` | `/Users/yutu/.codex/modules/chang-e-android-control-plane` | 元宵/嫦娥 Android 控制面、任务队列、文件、更新、自恢复。 |
| `simulaid-optimize-build-deliver` | `/Users/yutu/.codex/modules/simulaid-optimize-build-deliver` | Simulaid 优化、测试、Android/iOS 交付工作流。 |
| `simulaid-studio-operating-model` | `/Users/yutu/.codex/modules/simulaid-studio-operating-model` | Simulaid 小型制作组/质量门/协作模型。 |
| `simulaid-taptap-release-gate` | `/Users/yutu/.codex/modules/simulaid-taptap-release-gate` | TapTap 上架包检查门禁。 |
| `starlaid-unity-project` | `/Users/yutu/.codex/modules/starlaid-unity-project` | Starlaid 项目信息；当前自动研究中应硬排除，迁移时只按用户确认处理。 |
| `user-clipboard-response-preference` | `/Users/yutu/.codex/modules/user-clipboard-response-preference` | 用户要“一句话/一段话”时复制到剪贴板的偏好。 |

## 4. Skills 与指令补齐稿体系

Skills 根目录：

`/Users/yutu/.codex/skills`

架构说明：

`/Users/yutu/.codex/skills/SKILL_ARCHITECTURE.md`

当前自定义 skills 数量：41 个。

核心原则：

- Skill 是“薄说明书”：负责何时触发、先读什么、怎么做、不要做什么。
- 模块/项目文档是“长期知识库”：负责架构、文件图谱、接口、历史、台账。
- 全局只保留一个指令补齐入口：`instruction-expansion-router`。
- 项目已有自己的指令补齐稿时，必须让项目 expander 接管，避免重复输出多个补齐稿。
- 显式命名的 skill/agent 优先级最高。

### 4.1 指令补齐兼容规则

优先级：

1. 用户显式点名的 skill/agent。
2. 项目专用 command expander，例如 Simulaid、YuanXiao、Zongzi。
3. 跨项目 wrapper route，例如 玉龙、玉灵、玉豚、玉凤、玉鼠、玉虎、玉衡、玉凰。
4. 全局 `instruction-expansion-router` 的通用补齐。

可见输出规则：

- 每次任务最多输出一个可见“指令补齐稿”块。
- 如果项目 expander 已输出，global router 不再重复输出。
- 指令补齐稿是为了补全执行边界，不应该变成长篇背景。

### 4.2 关键 skills 作用速查

| Skill | 作用 |
| --- | --- |
| `module-registry` | 查本机持久化模块，防止每次全局扫描。 |
| `instruction-expansion-router` | 全局指令补齐路由器，处理口语/简略/截图/跨项目任务。 |
| `skill-standard-reviewer` | 新建或改 skill 的质量门。 |
| `multi-agent-collaboration-contract` | 多 agent 能力目录和 handoff 契约。 |
| `hermes-yutu-voice-bridge` | 玉兔语音/飞书/Codex handoff 入口。 |
| `yuanxiao-command-expander` | 元宵/嫦娥/玉兔/Hermes/Legend/Android 控制面任务补齐。 |
| `嫦娥改装计划` | YuanXiao/ChangE Android 控制面与自更新工作流。 |
| `yuanxiao-mobile-file-inbox` | 手机文件传给玉兔/传奇后的收件箱。 |
| `simulaid-command-expander` | Simulaid 游戏开发、UI、资产、构建、发布前置补齐。 |
| `simulaid-unity-maintenance` | Simulaid Unity/Tuanjie 维护入口。 |
| `simulaid-architecture-guardian` | Simulaid 反复 bug、架构审查、代码臃肿治理。 |
| `玉龙` | Android 打包/交付 wrapper。 |
| `玉灵` | iOS/TestFlight 交付 wrapper。 |
| `玉玲珑` | Android+iOS 合并交付 wrapper。 |
| `黄龙` | Android 交付 + 玩家更新日志 wrapper。 |
| `玉豚` | 游戏生图/补图 wrapper。 |
| `玉凤` | 剧情/世界观/设定一致性审查。 |
| `玉鼠` | 游戏内容定义、卡牌、角色、装备、道具、文本。 |
| `玉虎` | bug 根因修复守门。 |
| `玉衡` | 测试用例/回归测试门禁。 |
| `玉凰` | TapTap/社区/玩家公告文案。 |
| `zongzi-command-expander` | 粽子助手/控制台/服务器任务补齐。 |
| `personal-contacts` | 联系人查询，不能保存邮件内容或密钥。 |
| `user-clipboard-response` | 复制可转发文本到剪贴板。 |

### 4.3 自定义 skills 清单

```text
chang-e-android-control-plane
doubao-seedance-animation
hermes-yutu-voice-bridge
huanglong
instruction-expansion-router
module-registry
multi-agent-collaboration-contract
personal-contacts
simulaid-animation-assets
simulaid-architecture-guardian
simulaid-build-qq-delivery
simulaid-code-refactor-navigation
simulaid-command-expander
simulaid-marketing-planning-bridge
simulaid-optimize-build-deliver
simulaid-performance-refactor
simulaid-pixel-art-assets
simulaid-studio-operating-model
simulaid-taptap-release-gate
simulaid-ui-regression-review
simulaid-unity-maintenance
skill-standard-reviewer
starlaid-game-development
starlaid-image-generation
starlaid-test-maintenance
starlaid-unity-maintenance
user-clipboard-response
yuanxiao-command-expander
yuanxiao-mobile-file-inbox
yufeng
yuheng
yuhu
yuhua
yuhuang
yuji
yuling
yulinglong
yulong
yushu
yutun
zongzi-command-expander
嫦娥改装计划
```

新机安装建议：

- 先迁移 `.codex/skills` 和 `.codex/modules` 的结构与文档。
- 再由新机 Codex/Claude 读取 `SKILL_ARCHITECTURE.md` 做一致性检查。
- 不要把某个项目的补齐规则复制到全局，避免冲突。

## 5. YuanXiao / ChangE 控制面经验

核心项目：

`/Users/yutu/Projects/YuanXiao`

设计目标：

- `元宵` 是手机端控制面。
- `嫦娥` 是服务器/控制中枢身份。
- `汤圆` 等同 `元宵`。
- `煮元宵/煮汤圆` 是一条龙优化、构建、校验、部署、自更新、下行、Git 同步和提醒流程。

重要规则：

1. 默认做原生 Android，不做 WebView 包壳。
2. APK 默认在 Mac mini 编译。
3. 服务端按 Ubuntu 运行环境思考，除非新证据改变。
4. Android UI 只订阅 canonical task state，不要在前端各处重复推断任务状态。
5. 文件、patch、release、downlink 都要有 ledger/receipt。
6. 真实审批用 typed card，不用聊天里“是否继续”来阻塞流程。
7. 保护中的 Codex 会话不能被后台直接 resume 打扰；应该默认进入队列，显式允许才直连。

关键能力组件：

| 能力 | 说明 |
| --- | --- |
| `runner_adapters` | 统一不同执行器，例如 Codex、Hermes、本地脚本、服务器任务。 |
| `capability_registry` | 明确谁能做什么、权限范围、输入输出。 |
| `workflow_nodes` | 把任务拆成可恢复节点。 |
| `typed_cards` | approval/artifact/trace/health/security 等结构化卡片。 |
| `artifact_receipt.jsonl` | 文件和产物回执，记录 sha、来源、状态、保留期。 |
| `task id / attempt id / artifact id` | 所有队列、下行、审批、重试都要靠这些 id 串起来。 |

## 6. 项目 GitHub/Gitee 远程与新机待办

扫描范围：

```text
/Users/yutu/Projects
/Users/yutu/Simulaid
/Users/yutu/.hermes/hermes-agent
/Users/yutu/Documents/Codex
```

当前扫描到的 Git remote 都是 GitHub；没有在这些已知项目根里发现 Gitee remote。

| 本机路径 | 分支 | 远程 | 状态 | 新机待办 |
| --- | --- | --- | --- | --- |
| `/Users/yutu/.hermes/hermes-agent` | `main` | `https://github.com/NousResearch/hermes-agent.git` | 有 5 个本地改动 | clone 官方或私有 fork；应用本机 patch；恢复插件/voice/modules；重新授权密钥。 |
| `/Users/yutu/Projects/YuanXiao` | `main` | `git@github.com:SongDingQing/YuanXiao.git` | 工作区干净 | 新机登录 GitHub 后 clone；配置 Android/JDK/Gradle；重新配置服务端与密钥。 |
| `/Users/yutu/Simulaid` | `main` | `git@github.com:SongDingQing/Simulaid.git` | 工作区干净 | 新机登录 GitHub 后 clone；安装 Unity/Tuanjie；检查 `CODE_INDEX.md` 和构建链。 |
| `/Users/yutu/Projects/Starlaid/Starlaid` | `main` | `git@github.com:SongDingQing/Starlaid.git` | 有 4 个未跟踪资源文件 | 标记为低优先/需用户确认；自动研究中不要读取或建议 Starlaid。 |

额外注意：

- `/Users/yutu/Projects/agent-game-research-watch` 当前没有在本次扫描里发现 `.git`，但它保存自动研究脚本、报告和 `seen-repos.json`，新机应作为本地项目目录复制或之后纳入仓库。
- 如果用户在新机要同步 Gitee，应由安装智能体提示“请连接 Gitee 账号并提供需要拉取的仓库列表”，不要猜。
- SSH remote 需要新机重新配置 SSH key 或改用 HTTPS 登录。

## 7. 自动优化师/研究任务发现的优秀代码库待办

原则：

- 这些库不要直接打包进用户安装包。
- 新机安装包应把它们变成“待办/参考库清单”，提醒用户授权 GitHub 后按需 clone 到参考目录。
- 建议参考目录：`/Users/yutu/Projects/reference-repos`。
- clone 前检查许可证、活跃度、是否有替代仓库、是否需要大模型/云服务账号。

### 7.1 最应该优先看的基础架构库

| 方向 | 仓库 | 用途 |
| --- | --- | --- |
| 状态机/可靠队列 | `https://github.com/fgmacedo/python-statemachine` | 把任务状态显式化，减少“等对方汇报”卡死。 |
| 上下文检索 | `https://github.com/zilliztech/claude-context` | 大代码库语义检索和上下文压缩。 |
| 低常驻 agent ledger | `https://github.com/sean2077/oh-my-agents` | 借鉴 agent ledger；注意它替代了旧 `agent-ledger`。 |
| prompt-as-code | `https://github.com/microsoft/genaiscript` | 结构化 prompt、输出和批处理。 |
| coding-agent 压缩 | `https://github.com/dean0x/skim` | 工具输出、AST、测试日志压缩。 |
| repo map | `https://github.com/raymondchins/agentmap` | 仓库结构图和 token-budget digest。 |
| AST 导航 | `https://github.com/aeroxy/ast-bro` | API、调用关系、影响范围分析。 |

### 7.2 多 agent、任务编排与收件箱

```text
https://github.com/lastmile-ai/mcp-agent
https://github.com/Enderfga/claw-orchestrator
https://github.com/cloudflare/agentic-inbox
https://github.com/restatedev/restate
https://github.com/temporalio/temporal
https://github.com/litements/litequeue
https://github.com/humanlayer/humanlayer
https://github.com/humanlayer/12-factor-agents
https://github.com/ag-ui-protocol/ag-ui
https://github.com/microsoft/autogen
https://github.com/microsoft/magentic-ui
https://github.com/SWE-agent/SWE-agent
```

重点借鉴：

- 单向工作流。
- 占位符/异步替换。
- task id、attempt id、artifact id。
- approval card。
- 中断、熔断和可恢复状态。

### 7.3 安全、权限和可审计

```text
https://github.com/slowmist/MCP-Security-Checklist
https://github.com/InnerWarden/innerwarden
https://github.com/gabrielsoltz/clauditor
https://github.com/MasuRii/pi-permission-system
https://github.com/langfuse/langfuse
https://github.com/openlit/openlit
https://github.com/Helicone/helicone
https://github.com/linux-system-roles/journald
```

重点借鉴：

- MCP/tool/bash/file 权限策略化。
- dry-run 安全摘要。
- hash-chain audit trail。
- 配置扫描和风险等级。
- 日志/调用 trace 可回放。

### 7.4 UI、网页状态机和视觉回归

```text
https://github.com/storybookjs/storybook
https://github.com/microsoft/playwright-mcp
https://github.com/cypress-io/cypress
https://github.com/lost-pixel/lost-pixel
https://github.com/reg-viz/reg-suit
https://github.com/percy/cli
https://github.com/pa11y/pa11y
https://github.com/dequelabs/axe-core
https://github.com/statelyai/xstate
```

重点借鉴：

- 组件 story。
- 移动端安全区、弱网、长文本、空/错/加载状态截图矩阵。
- approval/file/task 卡片视觉回归。
- 状态机驱动页面恢复。

### 7.5 游戏、Unity、资产和生图/视频

```text
https://github.com/asdqsczser/CivAgent
https://github.com/meta-quest/agentic-tools
https://github.com/IvanMurzak/Unity-MCP
https://github.com/CoplayDev/unity-mcp
https://github.com/undreamai/LLMUnity
https://github.com/leigest519/OpenGame
https://github.com/ybuild-ai/ai-game-art-pipeline-skill
https://github.com/HKUDS/ViMax
https://github.com/rishidesai/charforge
https://github.com/YouMind-OpenLab/awesome-gpt-image-2
https://github.com/Comfy-Org/ComfyUI
https://github.com/TencentARC/PhotoMaker
https://github.com/instantX-research/InstantID
https://github.com/cubiq/ComfyUI_IPAdapter_plus
https://github.com/kijai/ComfyUI-WanVideoWrapper
```

重点借鉴：

- AI NPC 长期状态。
- Unity/MCP 设备和编辑器能力。
- 角色卡、风格卡、镜头卡、prompt manifest。
- 图像/视频一致性验收。

### 7.6 浏览器、桌面控制、文件和知识抓取

```text
https://github.com/browser-use/browser-use
https://github.com/browserbase/stagehand
https://github.com/wonderwhy-er/DesktopCommanderMCP
https://github.com/rrweb-io/rrweb
https://github.com/firecrawl/firecrawl
https://github.com/Dicklesworthstone/frankenterm
https://github.com/supermemoryai/supermemory
https://github.com/supermemoryai/opencode-supermemory
https://github.com/getzep/zep
https://github.com/continuedev/continue
```

重点借鉴：

- 浏览器自动化状态记录。
- 桌面控制边界。
- 页面回放和问题复现。
- 私有知识索引和长期记忆。

## 8. 过往优秀设计，需要保留

1. 全局模块索引：先查模块，再查源码，减少上下文浪费。
2. Skills 薄化：skill 负责触发和流程，长期细节放模块。
3. 指令补齐稿路由：全局 router 只分发，项目 expander 才输出完整补齐稿。
4. 飞书确认卡片：高风险动作先让用户确认。
5. Hermes 忙碌排队：避免新消息打断正在执行任务。
6. 语音记录同步飞书：本地语音也要留下文本记录，便于追溯和纠错。
7. ASR 热词/纠错持久化：项目名、人名、agent 名不要靠临场猜。
8. Codex handoff：玉兔负责接入和提醒，Codex 负责复杂编码/邮件/文件/构建。
9. YuanXiao typed cards：approval、artifact、trace、health、security 分开。
10. 文件 receipt：任何文件下行/上传/交付都要有 sha、状态、来源、保留期。
11. 保护会话：不能让后台任务随便打断用户正在操作的 Codex session。
12. Simulaid CODE_INDEX：游戏项目先读索引和 bug ledger，再改代码。
13. 自动研究报告：固定栏目、去重台账、清理记录、飞书摘要。

## 9. 过往失败和注意案例

| 案例 | 症状 | 原因 | 新机要怎么避免 |
| --- | --- | --- | --- |
| Hermes/Codex 联系不精准 | 玉兔不知道任务应交给 Codex | 能力目录和 handoff 规则不够显式 | 保留 `multi-agent-collaboration-contract`，安装后先做 handoff smoke test。 |
| 队列消息太吵 | 忙碌时多条飞书提示/语音播报 | 排队提示没有合并，也触发了语音提醒 | 队列提示要短；排队中提示不触发“飞书来消息了”。 |
| 语音回复后唤醒失败 | 玉兔播报后再次唤醒不稳定 | 音频播放/监听状态切换有时未恢复 | 新机安装后必须做“播报后再次唤醒”测试。 |
| ASR 误识别 | Codex、项目名、人名被听错 | 没有持久热词/纠错闭环 | 热词库迁移结构，内容由用户确认后导入。 |
| 深度解读上下文污染 | 第二个新问题引用上一问 | 默认带入 lastReading/history | 默认 `contextMode=new`，只有用户点“参考上一问”才是 followup。 |
| YuanXiao placeholder host | APK 访问占位 host | 发布前没扫占位配置 | release candidate 必须检查 placeholder、base URL、metadata。 |
| 后台打断 Codex session | 移动端任务等不到回复 | 后台直接打活跃 Codex 会话 | 保护 session 默认排队；直连必须显式允许。 |
| 队列不可见 | 用户不知道任务已经排队 | handoff queued 元数据没有传到 UI | 队列 notice 要带 queue id、position、task summary。 |
| 任务位置误导 | 旧 blocked 任务让队列排名很大 | 全局队列和用户视角混用 | UI 显示 scoped position，运维保留 global position。 |
| 交付命令走错 worker | `煮元宵` 只交接不交付 | 用了 read-only handoff worker | delivery 命令必须走 delivery-worker lane。 |
| 聊天确认阻塞 | agent 反复问是否继续 | 把自然语言确认当工作流审批 | 能执行就执行；真实审批用 typed card。 |
| 报告太长发不出 | 飞书摘要多次压缩 | 一开始写得过长 | 摘要先短写，报告正文放文件路径。 |
| Starlaid 被误纳入自动研究 | 报告给废弃项目建议 | 硬排除被当成软偏好 | 自动研究必须硬排除 Starlaid；迁移只按用户确认处理。 |

## 10. 新机自动安装包应生成的待办

### 10.1 用户授权待办

- 连接 GitHub 账号，确认是否使用 SSH key 或 HTTPS token。
- 如需要 Gitee，连接 Gitee 账号并提供仓库列表。
- 重新授权 Gmail 插件/账号。
- 重新配置飞书机器人/应用凭证。
- 重新提供模型 API key，例如 OpenAI、MiniMax、Brave Search、TTS/ASR 服务。
- 重新配置 SSH 登录，不迁移旧私钥明文。
- 确认是否迁移通讯录；默认只迁移联系人结构，不显示邮箱明文给日志。

### 10.2 必拉项目待办

1. clone `SongDingQing/YuanXiao` 到 `/Users/yutu/Projects/YuanXiao`。
2. clone `SongDingQing/Simulaid` 到 `/Users/yutu/Simulaid`。
3. clone 官方 Hermes 或用户私有 fork 到 `/Users/yutu/.hermes/hermes-agent`。
4. 对 Hermes 应用本机 patch。
5. 询问用户是否迁移 `SongDingQing/Starlaid`；默认不进入自动研究。
6. 复制或重建 `/Users/yutu/Projects/agent-game-research-watch`，保留 `seen-repos.json` 和最近 reports。

### 10.3 必装/必查工具待办

- Xcode Command Line Tools。
- Homebrew。
- Python 3。
- Node.js。
- Git。
- Android Studio / JDK / Gradle。
- Unity/Tuanjie。
- macOS LaunchAgent 权限。
- 麦克风/扬声器权限。
- Feishu/Gmail/Codex/Claude 插件授权。

### 10.4 验证待办

- Hermes 能启动。
- 飞书能收发消息。
- 玉兔能发声。
- 语音播报后能再次唤醒。
- 忙碌时新消息进入队列，不打断当前任务。
- Codex handoff 能创建任务并回传结果。
- Gmail 发送需要确认时能走正确卡片。
- YuanXiao 能构建 debug/release APK。
- Simulaid 能打开 Unity/Tuanjie 项目并跑基础检查。
- 自动研究能生成报告，但继续硬排除 Starlaid。

## 11. 额外应保留的信息

- 用户偏好：复杂编码、构建、文件、邮件、项目修改类任务优先交给 Codex；玉兔更像入口、提醒和确认层。
- 多 agent 原则：所有结果向用户收口；agent 之间只传任务和结构化结果，避免互相等待汇报。
- 不要依赖 Codex 子 agent 作为长期 worker；它们完成后会消失，适合短任务，不适合持续绑定关系。
- 新机应把“能力目录/路由表/任务队列/回执 ledger”当一等公民，而不是只靠聊天上下文。
- 安装包不应试图一次性全自动完成所有敏感配置，应生成清晰待办让用户授权。
- 对外发布 Yutu/Hermes 改版包时，必须附许可证说明、第三方项目出处、敏感信息排除清单和配置向导。

## 12. 给 Claude/新机智能体的执行顺序

1. 读取本文件和 `README.md`。
2. 读取 `/Users/yutu/.codex/skills/SKILL_ARCHITECTURE.md`。
3. 读取 `/Users/yutu/.codex/modules/INDEX.md` 和 `registry.json`。
4. 先恢复目录结构和文档，再处理源码和服务。
5. 先列出“需要主人授权”的待办，不要索要或打印密钥。
6. 逐个 clone 项目仓库。
7. 对 Hermes 应用 patch，恢复插件和 voice bridge。
8. 安装 LaunchAgent，但启动前先做配置检查。
9. 跑飞书、语音、Codex handoff、YuanXiao、Simulaid 的 smoke test。
10. 把每一步结果写入迁移日志，并给主人一个短报告。

