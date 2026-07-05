# new-api 网关 + 智谱接入 + 智谱设计师 · 设计规格(给 codex)

> 流程:秘书出规格 → 老板转交 codex 落地 → 秘书验证。出规格 2026-06-19。
> 前提:new-api 未部署,本串依赖它先起来;排在「稳定地基 + 孤儿清理」之后。
> 涉及:Mac docker(new-api)、控制台 server.js/public、shared/routing/runners.yaml、config.json。

## 研究结论(2026-06,接入用)
- 智谱通用 OpenAI 兼容 base_url:`https://open.bigmodel.cn/api/paas/v4/`
- **GLM Coding Plan 专属 OpenAI 兼容 base_url:`https://open.bigmodel.cn/api/coding/paas/v4/`**。接 `glm-5.2` Coding Plan 时必须使用此端点,不要走通用 API 端点。
- 模型:GLM-5 系列(`glm-5`、`glm-5.2`、`glm-5-turbo`、`glm-4.7` …);视觉 `glm-5v`/`glm-5v-turbo`;文生图 CogView(`cogview-4` / `cogview-3-plus`)。**确切可用模型名以智谱平台/账号实际开通为准**,接入时核对。
- new-api 镜像 `calciumion/new-api`,docker 部署,默认端口 **3000**;内置「智谱」渠道类型 + 对外 OpenAI 兼容出口 `/v1`。

## 阶段 1 · 部署 new-api(Mac, docker)
- 先确认 Mac 有 docker(`docker version`);没有则装 Docker Desktop / OrbStack,或回报老板。
- 用 docker compose(QuantumNous/new-api 的 compose:new-api + redis + postgres)或单 `docker run` + SQLite(单机更轻,够用)。
- 端口 **3000**(与控制台 41218 不冲突);数据卷持久化(`./data`)。
- ⚠️ **改掉所有默认密码**(SQL/redis);设 `SESSION_SECRET`(随机串)。
- 起来后访问 `http://localhost:3000` 初始化管理员账号。

## 阶段 2 · 接入智谱渠道(codex 读桌面 key)
- codex 在 `~/Desktop` 找智谱 team key 文件(名字可能含 zhipu/glm/智谱/bigmodel),读取 key。
- ⚠️ **key 只在本地配置,绝不回显**到日志 / 终端输出 / git / 聊天 / result.md。
- 在 new-api 加「智谱 AI」渠道(普通智谱可用内置智谱类型或通用 base_url=`https://open.bigmodel.cn/api/paas/v4/`;GLM Coding Plan 必须使用 OpenAI 兼容自定义 + base_url=`https://open.bigmodel.cn/api/coding/paas/v4/`),填 key。
- 启用模型:`glm-5.2`、`glm-5`、`glm-5-turbo`、`glm-5v`(看图)、`cogview-4`(文生图)等(按账号实际开通)。
- 在 new-api 建一个**内部令牌(token)**,供本系统 agent 走网关用。token 存本地配置/env(如控制台 `config.json` 的私有字段或 `.env`),**不硬编码、不回显**。
- 自测:用该 token 调 `http://localhost:3000/v1/chat/completions`(model=`glm-5.2`)通;调文生图 `/v1/images/generations`(model=`cogview-4`)通。

## 阶段 3 · 控制台加 new-api 图形化管理页
- `public/` 加一页(`newapi.html`,或在 workspace/control-room 顶部导航加入口),作为 new-api 管理入口。
- 最简稳妥:iframe 嵌入 `http://localhost:3000`;若 new-api 设了 `X-Frame-Options` 不能嵌,则改为「在新标签打开」按钮链接过去。
- 控制台 header 加「API 网关」入口。
- 不破现有 `/api/*` 与既有页面(工作区双视图 #22、控制室)。

## 阶段 4 · 加「智谱设计师」角色(全能设计,GLM-5.2,走 new-api 网关)
> 这是**第一个走 new-api HTTP 网关**的 agent(不 spawn CLI),引擎需支持 HTTP runner。

- **引擎加 `openai_http` runner 类型**:
  - runner 配置:`{ type:'openai_http', base_url:'http://localhost:3000/v1', token:<从本地配置/env 读,不硬编码>, model:'glm-5.2' }`。
  - `server.js` 的 runRunner / `cli-runner.js`:加 http 分支——用 fetch 调 `base_url/chat/completions`(`stream:true` SSE),把增量对齐现有 `delta`/`done` 事件流;失败按现有错误事件处理。
  - 文生图:设计师收到出图需求时调 `base_url/images/generations`(model=`cogview-4`),把图存到 `artifacts/`,结果给出文件路径。
- **注册角色**:
  - `config.json` runners 加 `zhipu-designer`(label「智谱设计师」,kind openai_http via new-api);`/api/runners` 自然带出。
  - `shared/routing/runners.yaml` 加同名 runner 注册(klass first_class,role designer,kind api_via_newapi)。
  - roleRouting / 角色加 `zhipu_designer` → `zhipu-designer` runner。
- **工作区 UI**:`AGENT_META`(若 #22 双视图已落地)或 `GRAPH_NODES` 加节点「智谱设计师」(图标 🎨,accent 智谱紫如 `#3859ff`/`#7c5cff`,group edge 或新「设计」组);派单下拉自然出现。
- **全能**:GLM-5.2 做设计方案/对话/看图(多模态);CogView 做文生图。三类需求都能接。

## 红线
- 智谱 key / new-api token **绝不回显**(日志/输出/git/聊天/result.md);token 从本地配置或 env 读,不硬编码。
- new-api 默认密码必改;仅监听本机(不对外暴露 3000,除非老板要)。
- 不破 #18 多队列、#22 双视图、稳定地基成果与 `/api/*`、事件协议。
- new-api 走 docker,**不往控制台 node 加新依赖**(零依赖原则)。Starlaid 排除;登录/授权交主人。

## 验收
1. `http://localhost:3000` 可登录管理;智谱渠道测试通过(`glm-5.2` 对话 + `cogview-4` 文生图)。
2. 控制台有「API 网关」页能进 new-api 管理界面。
3. 工作区可给「智谱设计师」派单:产出一份设计方案(GLM-5.2)+ 一张设计图(CogView),事件写入 `engine-events.jsonl`,产物路径清楚。
4. Peekaboo 截图对照:API 网关管理页 + 智谱设计师的工位卡/链路图节点。
5. `git diff` 只含 server.js / cli-runner.js / public 新页 / runners.yaml / config.json;无回退、无密钥。
