# Meowa 游戏素材能力 · 统一调度接入规格(给 codex)

> 流程:秘书出规格 → 老板转交 codex → 秘书验证。出规格 2026-06-19。
> **修正说明**:上一版误把 meowa 当"只装 codex 的私有 skill"。**正确目标:做成系统级、统一调度的共享能力**,任何授权 agent 都能调用,后续可接入更多 agent。走系统现有 `shared/capability_registry/` 机制。

## 定位
- **meowa = 专有游戏素材 API(工具能力)**:像素/HD/背景/无缝循环/贴图/tileset/地图 tile/透明 PNG/动画/音效/BGM/UI mockup。
- 它**不是 OpenAI 兼容 LLM**,不塞进 new-api(那是 LLM 统一网关);meowa 走 `capability_registry` 这条「工具能力统一登记/调度」线,与 new-api **并列**为两类统一能力面。

## 落地
### 1. 共享 CLI(供所有 agent,不只 codex)
- 把 meowa CLI(`meowart_api.py` + game-assets 的 `SKILL.md`/`meowart_api.md`)放共享位置 **`shared/tools/meowa/`**,所有 agent 都能调。
- `python3 -m pip install requests`(CLI 依赖)。
- codex 仍可 `npx skills add https://github.com/Meowa-AI/meowa-skills --skill game-assets -a codex` 作为它自己的便捷入口,但 **CLI 与 key 以共享位置为准**(单一事实源)。

### 2. 统一 key 管理
- codex 在 `~/Desktop` 读 meowa key(`MEOWART_API_KEY`,形如 `ma_live_xxx`),存系统**统一本地位置**(`.env` 或控制台 `config.json` 私有字段),**所有授权 agent 读同一处**。
- ⚠️ **key 绝不回显/提交**(日志/输出/git/聊天/result.md)。官方建 key 页 `https://meowa.ai/#/api-keys`。

### 3. 登记为能力 module(统一调度核心)
- 建 `shared/capability_registry/modules/meowa-game-assets/`,仿 `hermes-yutu-voice-bridge` 格式:`module.json` + `README.md` + `quick-context.md` + `io-contracts.md` + `operations.md`。
- 在 `shared/capability_registry/registry.json` 登记该能力。
- module 内写明:
  - **能力清单**:可生成的素材类型。
  - **统一调用约定(io-contract)**:标准 CLI 命令 + 输入/输出契约(任何 agent 照此调用、拿产物路径)。
  - **统一 key 来源**:从哪个本地位置读(不写 key 本身)。
  - **授权 agent**:初期 `codex` / `zhipu_designer` / `supervisor-Simulaid`;**明确标注「可扩展」**——后续接新 agent 只在此清单加一行。

### 4. 多 agent 接入约定
- agent 需要游戏素材时:经 `capability_registry` 发现 meowa → 按 io-contract 调 `shared/tools/meowa/meowart_api.py` → 拿产物。
- **后续接入别的智能体 = 在 module 授权清单加该 agent + 它读统一 key,无需重装/重配**。这正是"统一调度、可被多 agent 复用"。

### 5.(预留)更强统一调度
- 未来若要把 meowa 也纳入和 new-api 一样的"HTTP 统一面",可包一层 `meowa-gateway` 小服务(封装 submit→poll 的异步 job),agent 走 HTTP 调。**本期先共享 CLI + 能力登记**(够用、轻量)。

## 文档 / 验证
- 官方接入文档:可用 **computer use 打开夸克浏览器**看 `meowa.ai`,或读仓库 `SKILL.md`、跑 `meowart_api.py skill-doc` 拿动态指南。
- 验证:`python3 shared/tools/meowa/meowart_api.py credits-balance` 通(说明 key 通,**回报余额不贴 key**);任一授权 agent 能按 io-contract 调用产出一个素材(如 8 个 64x64 像素图标),产物路径清楚。

## 红线
- key 只本地统一存、不回显/不提交;Starlaid 排除;不破现有结构与 capability_registry 规范;能力 module 文档规范同现有 module。
