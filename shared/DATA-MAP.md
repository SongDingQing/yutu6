# 玉兔6 数据地图

> 单一索引:当 agent 不知道数据在哪,先读这张图。HR 每创建或调整 agent 时同步更新。
> 更新:2026-06-22

## 读取顺序

1. 先读当前任务信封和授权边界。
2. 再读本 agent 的 `agent.json.read_paths`。
3. 不知道知识在哪时查本文件。
4. 长期记忆只读 `memory/`;需要原文深检索时用 `knowledge/query.py`。
5. 密钥、token、cookie、验证码不进入本地图。

## 数据分层

| 区域 | 放什么 | 读取方式 | 主要维护者 |
|---|---|---|---|
| `memory/` | 提炼后的偏好、决策、经验、实体、会话摘要 | 任务前按需注入或直读 | 记忆官 |
| `knowledge/` | 原文 RAG、corpus、`kb.sqlite`、`query.py` | 深度问题用 `python knowledge/query.py "<问题>"` | 记忆官/监管 |
| `board/` | 方向、进展、汇总、维修工单、洞察记录 | 运营态实时直读 | 秘书/CEO/维修员 |
| `projects/控制台/` | 控制台源码、brief/status、artifacts、队列运行态 | 控制台任务直读 | 控制台主管/员工 |
| `projects/MagicMushroom/` | MagicMushroom brief/status、部门契约、任务和项目知识；代码仓库位于 `/Users/yutu6/UnityProject/MagicMushroom` | MagicMushroom 任务直读 | MagicMushroom 主管/程序员 |
| `shared/agents/` | 系统级 agent 花名册、契约、prompt | HR 和引擎校验直读 | HR |
| `shared/routing/` | 角色模型路由、runner 注册、flow | 路由/引擎任务直读 | 控制台主管 |
| `shared/capability_registry/` | 可复用工具、模块、能力说明 | 新任务先查能力 | 秘书/主管 |
| `shared/knowledge/hr/` | HR 部门共享标准、模板和审核索引 | HR 主管/专员直读 | HR |
| `shared/knowledge/engineering/` | 工程岗位 GLM-5.2 接手交接、岗位上下文、质量/回测门槛 | 工程 agent 接手前直读 | 控制台主管/HR |
| `projects/控制台/artifacts/hr/` | HR smoke、边界审核报告、加固清单 | 验收证据直读 | HR |
| `VERSION.json` | 玉兔6工作区四段版本号、更新时间、最近发布说明 | `GET /api/version` 或 IT 工程师脚本读取 | IT 工程师 |
| `projects/控制台/artifacts/versioning/` | 版本发布/回滚审计产物 | IT 工程师按需写入 | IT 工程师 |

## Agent 知识定位

| agent | 核心知识入口 | 部门共享 | 深度检索 |
|---|---|---|---|
| 秘书 `secretary` | `board/`, `shared/capability_registry/`, `projects/*/brief.md`, `projects/*/status.md` | 无 | `knowledge/query.py` 按需 |
| CEO `orchestrator` | `board/`, 各项目 `brief.md/status.md` | 无 | `knowledge/query.py` 按需 |
| 项目主管 `supervisor-*` | `projects/<项目>/`, `shared/reference/`, `shared/capability_registry/` | 项目区 | `knowledge/query.py` 按需 |
| MagicMushroom 主管 `magicmushroom_supervisor` | `projects/MagicMushroom/`、MagicMushroom 仓库只读 | MagicMushroom 项目区 | 按任务需要 |
| MagicMushroom 程序员 `magicmushroom_programmer` | 当前任务、`projects/MagicMushroom/capabilities.md`、MagicMushroom Unity 仓库 | MagicMushroom 项目区 | 不默认检索 |
| 后端程序员 `worker_code` | 当前任务授权的项目代码、`shared/engine/`, `shared/routing/`, `tests/`, 工程交接索引 | `shared/knowledge/engineering/`, 控制台项目区 | 不默认检索 |
| 外包员工 `worker_narrow` | 明确输入的 brief/status、日志片段、`shared/reference/` | `projects/控制台/artifacts/worker-narrow/` | 不默认检索 |
| 架构/推理 `reasoning_architect` | 相关源码、事件证据、测试和 `shared/reference/` | `projects/控制台/artifacts/architecture/` | `knowledge/query.py` 按需 |
| 维修员 `repair` | `board/repair-tickets/`, `projects/控制台/artifacts/`, `shared/engine/`, `projects/控制台/` | 维修工单区 | 先查 `memory/experience.md` |
| IT 工程师 `it_engineer` | `VERSION.json`, `projects/控制台/tools/version-manager.js`, `shared/config/ssh-and-remotes.md`, 工程交接索引 | `shared/knowledge/engineering/`, `projects/控制台/artifacts/versioning/` | 不默认检索 |
| 记忆官 `memory_officer` | `memory/`, `board/`, `knowledge/归档/` | 记忆区 | `knowledge/query.py` |
| HR 主管 `hr_manager` | `shared/agents/`, `shared/DATA-MAP.md`, `memory/`, 设计方案 | `shared/knowledge/hr/` | `knowledge/query.py` |
| HR 专员 `hr_specialist` | HR 主管规格卡、`shared/agents/`, `projects/控制台/config.json` | `shared/knowledge/hr/` | `knowledge/query.py` |
| 董事会 `board_*` | `玉兔6-董事会设计方案.md`, `projects/控制台/brief.md`, `memory/decisions.md` | 董事会记录 | 不默认检索 |
| UI 优化师/前端程序员 | `projects/控制台/public/`, 前端交接文档、截图产物 | 控制台 artifacts | 不默认检索 |
| 桌面控制 `gui_desktop_control` | 控制台页面/桌面截图、`projects/控制台/artifacts/` | 控制台 artifacts | 不默认检索 |
| 洞察员 `insight-scout` | `board/insights/`, 公告板候选、能力库 | 洞察记录 | 不默认检索 |

## HR 维护规则

- 新 agent 入职时,必须在本文件增加知识定位。
- 如果新增部门,优先建 `shared/knowledge/<部门>/`。
- 如果 agent 只属于项目,优先使用 `projects/<项目>/knowledge/` 或项目 artifacts。
- 不把密钥路径的实际内容、token 值或验证码写入本文件。
