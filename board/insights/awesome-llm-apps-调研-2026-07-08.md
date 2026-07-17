# 玉兔6 × awesome-llm-apps 调研报告

> 调研日期:2026-07-08 · 来源:https://github.com/Shubhamsaboo/awesome-llm-apps (60k+ stars)
> 调研员:洞察员(Haiku,联网) · **主控核验:claude-code(维修主管,核验了现状对照)**

## 结论先行(经主控核验修正)
洞察员方向可参考,但作为 Haiku **它低估了玉兔6 现状**——它判为"缺失"的三样,代码里其实都有基础。**修正后真实待办 = "在已有基础上优化",不是"从零新建"**:

1. **交接握手优化**(不是"新建协议"):`shared/engine/handoff.js` 已存在 + 有 `task-dag-handoff-protocol` artifacts。真问题是**信封冗余**(与 vibe-coding 手册"交接传简报不传全史"咬合),值得优化。价值高/成本中。
2. **事件驱动/主动推送扩展**(不是"完全缺失"):金丝雀/周清算/自省定时/CEO伸缩已落地(见任务#12),`worker-reaper.js`/`async-unblock.js` 在。真缺口是"**主动推送式**任务"(定时评审→推元宵/飞书),是扩展。价值中/成本小。
3. **知识库图谱**(不是"纯FTS5无向量"):`knowledge/embed_provider.py` 已有语义向量基础。真缺口是**关系图谱**(教训根因自动关联),是升级。价值中/成本中。

## 一、awesome-llm-apps 全景(Haiku 联网调研,可信部分)
收录类别及代表项目:
| 类别 | 代表项目 | 关键能力 | 玉兔6 真实现状(主控核验) |
|---|---|---|---|
| Starter/Advanced Agents | 旅行规划/深度研究/尽调 | 单文件+API、复杂工具链 | ✅ 已有(CEO/主管/员工三层+19角色) |
| Always-on Agents | HN 定时简报、市场监控 | 后台常驻、定时/事件、主动推送 | ⚠️ **部分已有**(定时机制在,缺主动推送) |
| Multi-agent Teams | 法律/融资/房产团队 | 显式角色分工+交接合同 | ⚠️ **已有 handoff.js**,缺"简报式"瘦交接 |
| Voice Agents | 客服/理赔实时语音 | 双向实时语音 <500ms | ❌ 缺(不推荐,跨系统成本大) |
| Generative UI | 仪表板/动态表单 | 交互组件渲染 | ⚠️ 弱(有 ui-optimizer 截图挑错) |
| MCP Integration | Browser/GitHub/Notion MCP | 工具标准化接入 | ⚠️ 基础(维修员硬编码工具) |
| RAG(Agentic/Corrective/Graph) | GraphRAG 带引用 | 多源检索+图谱扩展 | ⚠️ **已有向量**,缺图谱 |
| Memory Systems | 跨会话记忆/画像 | 长期状态+漂移检测 | ✅ 有(experience.md+lesson-index 注入) |
| Agent Skills | 19 可复用 skill | 技能组件化即插即用 | ⚠️ 有 skill 但无"市场/注册表" |

## 二、待办清单(修正后,按 价值×成本 排序)

### 🔥 高优先(值得立项)
**#1 交接信封瘦身 + 握手校验**
- 借鉴:AI Legal Team 显式移交检查清单 | 落到:`shared/engine/handoff.js`(已有,补协议)
- 做:CEO→主管→员工交接合同(原始指令+需求checksum+上下文边界);信封去冗余(指针替代全文背景包);handoff 阶段加必需字段校验
- 价值高/成本中(3-4天)/**需老板拍板交接边界** | 与 vibe-coding 手册"任务简报交接"+ 已知信封冗余问题咬合

**#2 主动推送式定时任务(扩展现有定时机制)**
- 借鉴:HN Briefing 定时+主动推送 | 落到:复用金丝雀/周清算的定时底座 + 新增推送通道(元宵/飞书)
- 做:定时 scan(如洞察员自动扫 awesome-list/竞品)→ 结果主动推老板,而非等老板看队列
- 价值中/成本小(<1天)/不需拍板(纯补充) | ⚠️ 推送失败本身要作为独立工单上报(防静默失败)

### 🟠 中优先
**#3 教训关系图谱(升级现有向量库)**
- 借鉴:GraphRAG | 落到:`knowledge/` 在 kb.sqlite 加 entities/relations 表
- 做:memory-officer 提炼教训后自动把"根因→做法"作为有向边入库;query 支持 2-3 跳关联
- 价值中/成本中(2-3天+观测)/内测灰度不需全量拍板

**#4 MCP 工具注册表** — 维修员硬编码工具迁入声明式注册表,按权限动态加载。价值中/成本中/需拍板权限模型。
**#5 Agent Skills 注册表** — 现有 skill 组件化+市场化。价值中/成本中/涉HR编制需拍板。

### ❌ 不推荐
- **Voice Agents**:跨元宵/嫦娥/语音API,成本大收益需长周期;替代=先做文转音读信。
- **完整 Generative UI**:需重写前端框架;替代=ui-optimizer 上加"JSON描述符→组件"渐进扩展。

## 三、主控核验注(为何修正洞察员结论)
洞察员是 Haiku,联网调研 awesome-llm-apps 本身准确,但"玉兔6 现状对照"未深入代码,三处判断偏弱(2026-07-08 grep 核实):
- `shared/engine/handoff.js` **存在** → 握手不是"缺失"是"可优化"
- 金丝雀/周清算/自省定时/worker-reaper **已落地**(任务#12) → Always-on 不是"完全缺失"
- `knowledge/embed_provider.py` **存在** → 知识库不是"纯FTS5"是"有向量缺图谱"
**教训**:洞察员报告的"缺口判断"要经代码核实再拍板(vibe-coding 手册:自我报告不可全信,要证据)。方向价值保留,现状数字以核验为准。

## 来源
- https://github.com/Shubhamsaboo/awesome-llm-apps + README(2026-07-08)
- 现状核验:本地 grep shared/engine、knowledge、projects/控制台(2026-07-08)
