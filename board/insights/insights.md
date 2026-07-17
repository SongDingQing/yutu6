# 洞察员 · 借鉴分析(insights)

> 洞察员产出:找优秀开源案例 + 分析「玉兔6 有哪些值得借鉴」。给老板 / CEO 参考,不是待办任务(只有分析出明确该做的行动,才单独提一张待办卡)。
>
> 渐进披露:默认只读本文件热区。热区定义为最近 4 个 insight-scout 单次运行批次,并受 100KB 上限保护;更早批次归档到 `references/archive-YYYYMM.md`。
>
> 按需检索:需要历史上下文时,先看 `references/archive-index.md`,或用 `rg "<仓库名|URL|slot|标题>" board/insights/references/` 定位归档文件,只读命中的小节。
>
> 去重:默认读取 `seen-repos.json` 的 `repos` URL 列表即可;watch/借鉴库元数据在 `references/borrowed-watch.json`,分析正文不回灌到去重热库。
>
> 最近维护:2026-07-05T10:44:44.448Z

<!-- insights-hot-zone: keep-last-4-batches max-100KB -->
<!-- insight-scout-run:cr-1782964815546-insight-scout-repos-20260702-12 -->
## 2026-07-02 · 自动洞察(20260702-12 · llm-gateway)

> 来源:洞察员; run=cr-1782964815546-insight-scout-repos-20260702-12; queue=insight-scout/insight-scout-repos-20260702-12; network=available

## LLM 网关 / 成本质量路由 / 可观测(slot=20260702-12)
说明:network_status=available;已按 seen-repos.json、borrowed-libs.md、insights.md 去重,本轮 3 个 URL 未命中既有记录;只读公开 GitHub/README/许可证,未登录、不安装、不处理 OAuth/密钥。

### ThinkWatchProject/ThinkWatch
- 是什么:Source-available 的企业 AI bastion/gateway,统一代理 AI API 与 MCP,把虚拟 key、RBAC、审计、限流、预算和成本归因放进一个控制面。
- 值得借鉴:同一把虚拟 key 按 surface 授权 AI/MCP、预算同时覆盖 token 与 MCP tool calls,可给控制台“模型调用+工具调用”统一账本补字段。
- 迁移边界/许可证不确定项:BSL-1.1,生产超过阈值需商业授权且未来转 GPL;不接 runtime、不碰 OAuth,只借对象模型/审计词汇。
- URL: https://github.com/ThinkWatchProject/ThinkWatch

### tbphp/gpt-load
- 是什么:MIT 的 Go 高并发透明 AI proxy,保留 OpenAI/Gemini/Anthropic 原生格式,提供 key 池、自动轮换、加权负载均衡和 Web 管理。
- 值得借鉴:group 级配置、失败 key 黑名单/恢复、热加载参数与请求日志,适合控制台拆“供应商组/密钥组/失败恢复”而非只按模型名路由。
- 迁移边界/许可证不确定项:MIT;偏 API key 池和透传代理,缺少质量评测路由,不能直接替代现有网关;不记录或迁移任何真实 key。
- URL: https://github.com/tbphp/gpt-load

### Arize-ai/openinference
- 是什么:Apache-2.0 的 OpenTelemetry 兼容 AI tracing conventions 与多语言 instrumentation,覆盖 LLM、RAG、工具调用和 agent framework。
- 值得借鉴:把 retrieval、external tools、provider call、agent step 统一成可导出 span,并能把 OpenLIT/OpenLLMetry trace 归一化。
- 迁移边界/许可证不确定项:Apache-2.0;这是 schema/instrumentation 层,不是存储或 UI,控制台应先借字段命名和 span 边界,不引依赖。
- URL: https://github.com/Arize-ai/openinference

### 判断
- 不新增公告板卡:已有“控制台 LLM 网关账本/追踪契约 v0”候选覆盖本轮行动;建议把 ThinkWatch 的双账本、gpt-load 的密钥组失败恢复、OpenInference 的 span 字段并入该卡。

<!-- insight-scout-run:cr-1782979215834-insight-scout-repos-20260702-16 -->
## 2026-07-02 · 自动洞察(20260702-16 · gui-grounding)

> 来源:洞察员; run=cr-1782979215834-insight-scout-repos-20260702-16; queue=insight-scout/insight-scout-repos-20260702-16; network=available

## GUI grounding / computer-use / a11y 借鉴扫描（20260702-16）
### trycua/cua
- 是什么: Computer-use agent 基础设施，覆盖 macOS/Linux/Windows sandbox、driver、agent 与 bench。
- 值得借鉴: driver、sandbox、agent、bench 分层清楚，适合控制台把观察、执行、评估拆成可替换接口。
- 迁移边界/许可证不确定项: MIT；第三方 OmniParser 为 CC-BY-4.0，可选 ultralytics 为 AGPL-3.0，不能直接合入可选 omni 依赖。
- URL: https://github.com/trycua/cua
### bytebot-ai/bytebot
- 是什么: 自托管 Linux 桌面 agent，把自然语言任务放进容器化桌面执行。
- 值得借鉴: “独立电脑给 agent 用”的隔离思路、任务会话/UI/执行器分离，以及可审计桌面轨迹。
- 迁移边界/许可证不确定项: Apache-2.0；当前偏 Docker/Linux 桌面，无正式 release，不等于本机 macOS 控制可直接复用。
- URL: https://github.com/bytebot-ai/bytebot
### pa11y/pa11y-ci
- 是什么: 面向 CI 的网页无障碍测试 runner，可按 URL/sitemap 输出 JSON 并设置阈值。
- 值得借鉴: 控制台 UI 变更可增加 a11y 门禁，不只依赖截图挑错。
- 迁移边界/许可证不确定项: LGPL-3.0-only；适合作独立外部检查器或借鉴报告模型，嵌入式集成需许可证复核。
- URL: https://github.com/pa11y/pa11y-ci

<!-- insight-scout-run:cr-1782993615866-insight-scout-repos-20260702-20 -->
## 2026-07-02 · 自动洞察(20260702-20 · pixel-assets-ui)

> 来源:洞察员; run=cr-1782993615866-insight-scout-repos-20260702-20; queue=insight-scout/insight-scout-repos-20260702-20; network=available

## 2026-07-02 · 像素素材生成 / 控制台网页设计借鉴扫描(slot=20260702-20)
> network=available;已比对 `seen-repos.json`、`borrowed-libs.md`、`insights.md`,本轮 3 个 URL 未命中;不登录、不授权、不装依赖、不改运行代码。

### 0x0funky/agent-sprite-forge
- 是什么:面向 Codex 的 2D sprite/map 资产生成技能库,把生图、清理、拆帧、透明 PNG/GIF、Godot/Unity 交付串成 pipeline。
- 值得借鉴:标准产物很清楚:raw、clean、transparent、frames、animation.gif、prompt-used、pipeline-meta,适合作控制台像素素材任务的验收目录。
- 迁移边界/许可证不确定项:MIT;README 含安装依赖步骤,本轮只借产物契约与 QA 元数据,不安装;商用素材仍需自有 IP 与模型/provider 授权确认。
- URL: https://github.com/0x0funky/agent-sprite-forge

### Void8Bit/Pixel-Perfect-AI-Art-Converter
- 是什么:浏览器内运行的 AI 像素图转真像素工具,支持自定义网格、缩放定位、多种代表色算法、编辑和 PNG 导出。
- 值得借鉴:把粗糙 AI 图先映射到固定网格,再用 dominant/weighted/average/neighbor 选色和人工修正,可作为素材清洗前端的交互参考。
- 迁移边界/许可证不确定项:Apache-2.0;项目小且偏单页工具,只借网格预览、算法选项和编辑复核流程,不复制实现代码。
- URL: https://github.com/Void8Bit/Pixel-Perfect-AI-Art-Converter

### unkeyed/unkey
- 是什么:现代 API developer platform,仓库含 dashboard/web 前端,主信息架构围绕 Deploy、Gateway、API Keys、Rate limiting、RBAC、Analytics、Audit logs。
- 值得借鉴:控制台可借它的密钥/权限/审计/分析并列导航,把高频操作、风险操作和不可变审计记录分层呈现。
- 迁移边界/许可证不确定项:主体 AGPLv3 且 packages 有例外说明,外部 PR 暂停;只借控制台信息架构与状态词表,不引代码或组件。
- URL: https://github.com/unkeyed/unkey

### 判断
- 最低风险行动是先定《控制台像素素材生成产物契约 v0》:目录、元数据、人工复核点、密钥/IP红线。该动作是文档/验收标准,适合进入 CEO 取舍,不触发代码和依赖变更。

<!-- insight-scout-run:cr-1783068250739-insight-scout-repos-20260703-rerun -->
## 2026-07-03 · 自动洞察(20260703-16 · llm-gateway)

> 来源:洞察员; run=cr-1783068250739-insight-scout-repos-20260703-rerun; queue=insight-scout/insight-scout-repos-20260703-rerun; network=available

## LLM 网关 / 成本质量路由 / 可观测借鉴扫描(slot=20260703-16)\n说明: network_status=available; 已比对 seen-repos.json、borrowed-libs.md、insights.md, 排除 LiteLLM/Portkey/Helicone/Langfuse/RouteLLM/TensorZero/agentgateway/openmeter/openllmetry/future-agi/NadirClaw/1flowbase 等已见 URL; 未登录、未安装、未处理密钥。\n\n### Inebrio/Routerly\n- 是什么: AGPL-3.0 self-hosted LLM gateway, OpenAI/Anthropic 兼容, README 称无数据库、JSON 配置、内置 dashboard。\n- 值得借鉴: 9 个并行评分 policy(llm/cheapest/health/performance/capability/context/budget-remaining/rate-limit/fairness)给“成本+质量+可靠性”路由词表。\n- 迁移边界/许可证不确定项: AGPL 强 copyleft 且仓库体量较小; 只借策略命名、项目 token 隔离、预算硬限额,不引代码/runtime。\n- URL: https://github.com/Inebrio/Routerly\n\n### comet-ml/opik\n- 是什么: Apache-2.0 的 LLM observability/evaluation/optimization 平台,覆盖 traces、LLM-as-judge、online evaluation rules、token/cost dashboard。\n- 值得借鉴: 把 trace/span、feedback score、eval result、token usage 与 prompt/tool optimization 形成生产反馈闭环,适合补控制台路由决策后的质量回写字段。\n- 迁移边界/许可证不确定项: 自托管依赖 Docker/K8s 等服务; 只借字段和反馈闭环,不安装 SDK 或平台。\n- URL: https://github.com/comet-ml/opik\n\n### MilkThink-Lab/RouterEval\n- 是什么: MIT 的 EMNLP 路由评测基准代码库,提供 12 类 LLM evaluations、8500+ 模型、2 亿级记录的路由评估数据口径。\n- 值得借鉴: 用候选池大小、强弱模型组合、质量-成本指标来评估 router,避免只看单次省钱比例。\n- 迁移边界/许可证不确定项: 数据量巨大且下载走 HF/网盘,外部数据授权需另核; 控制台先借评测 schema 和小样本离线复测方式。\n- URL: https://github.com/MilkThink-Lab/RouterEval\n\n### 判断\n- 不新增公告板卡: 既有“控制台 LLM 网关账本/追踪契约 v0/路由评测+LLM可观测”已覆盖本轮行动; 本轮补充 multi-policy routing、quality feedback loop、RouterEval benchmark 三项证据。
