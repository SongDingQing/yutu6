---
projectId: 控制台
topicProject: Simulaid
status: candidate/insight
entryId: unity-workflow-methodology
owner: supervisor-控制台
created: 2026-06-29
scope: board/insights document governance only
---

# Unity/团结工作流方法论长期候选

本条目为 `board/insights` 长期索引/候选清单,用于沉淀 Unity/团结工作流方法论的后续维护方向。权威项目档案仍归 `wiki/projects/simulaid.md`;本条目不替代 Simulaid 项目档案、skills 清单、CODE_INDEX 或 bug ledger。

## 决策边界

- 采纳状态:采纳为 `candidate/insight`,只作为董事会长期洞察条目保留。
- 执行边界:本条目不是 Simulaid 代码任务,不得触发 Unity/团结工程接入、UPM 安装、仓库 clone、构建、登录授权或包治理落地。
- 路由边界:后续如要进入 Simulaid 执行层,必须另开明确的 Simulaid 任务,并先走 Simulaid 项目档案、对应 skill 和项目主管验收。
- 去重边界:本条目只维护三类候选方向与引用核验状态;具体工作流规则、构建细节、技能触发条件仍以 `wiki/projects/simulaid.md` 和 `shared/capability_registry/skills-manifest.md` 为准。
- 排除项:Starlaid/星桥全程排除;密钥、token、cookie、私钥、验证码不得写入本文档或日志。

## 来源与引用核验

| 引用 | 状态 | 用法 |
|---|---|---|
| `board/insights/insights.md:218` | 可解析 | 原始 Unity/Simulaid 方法论洞察批次入口。 |
| `board/insights/insights.md:226` | 可解析 | ProjectAuditor 候选,只借静态审计/健康门禁方法。 |
| `board/insights/insights.md:232` | 可解析 | Scriptable Build Pipeline 候选,只借显式构建步骤/产物状态方法。 |
| `board/insights/insights.md:238` | 可解析 | Profile Analyzer 候选,只借优化前后指标对比方法。 |
| `wiki/projects/simulaid.md:5` | 可解析 | Simulaid 工作流权威入口,包含 CODE_INDEX、bug ledger、发布门禁与像素资产管线提示。 |
| `shared/capability_registry/skills-manifest.md:29` | 可解析 | Simulaid 相关 skills 清单入口。 |
| `projects/simulaid.md` | 待补 | brief 中提到的示例路径当前不存在;本条目改用实际存在的 `wiki/projects/simulaid.md`。 |
| `projects/Simulaid/CODE_INDEX.md` | 待补 | 当前本机 `projects/Simulaid` 仅为项目骨架,未发现已 clone 的 Simulaid 仓库源码索引。 |
| Simulaid bug ledger | 待补 | 当前本机 `projects/Simulaid` 未发现 bug ledger;进入 Simulaid 代码任务前必须重新核验。 |

## 后续候选:SO 事件/变量

候选:整理 ScriptableObject(SO) 事件通道、共享变量、配置资产的命名与 ownership 规则,避免运行时状态、编辑器配置和跨场景事件混用。

候选:建立 SO 资产清单字段,至少记录用途、读写方、生命周期、默认值来源、存档/迁移影响和测试入口。

候选:对事件通道与变量变更增加回归提示,尤其关注 domain reload、场景切换、存档兼容和移动端冷启动。

候选:把 ProjectAuditor 类静态审计思路作为健康门禁模板候选,只借方法,不假设可直接接入旧仓库或特定许可证包。

## 后续候选:项目协作规范

候选:任何 Simulaid 代码任务在动手前必须先核验仓库已 clone,并读取当前 `CODE_INDEX.md` 与 bug ledger;若缺失,先完成迁移/索引补齐,不得用过期迁移笔记替代。

候选:反复 bug、架构漂移、UI 回归、构建/发布失败应回写到对应 ledger 或状态文档,并保留根因、复现、修复、验证和回滚说明。

候选:项目档案只保留权威入口与高层规则,本条目只保留候选方向;同一规则不得在两处展开维护,避免 Simulaid 项目档案与 board insight 内容漂移。

候选:后续主管派单时在标题或 front matter 明确 `projectId: 控制台`、`topicProject: Simulaid`、`status: candidate/insight`,防止被队列路由误派到 Simulaid 执行层。

## 后续候选:UPM 包治理

候选:UPM 包采纳前必须核对官方来源、当前包版本、团结/Unity 兼容性、许可证和是否为镜像仓库;镜像 URL 只能作阅读线索,不能作权威安装依据。

候选:包治理清单至少记录包名、来源、版本、许可证、用途、是否 runtime 依赖、回滚方式、负责人和对应验证命令。

候选:Scriptable Build Pipeline 类方法只作为资源构建显式步骤与增量构建思路候选;真正接入需另开 Simulaid 技术任务和构建回归。

候选:Profile Analyzer 类方法只作为性能验收口径候选;落地前需确认目标团结版本可用,并定义优化前后同一指标集对比方式。

## 当前结论

保留为长期候选条目。下一步不是执行代码接入,而是在未来 Simulaid 相关任务出现时,由主管按实际仓库状态把其中一个候选拆成单独文档任务或技术任务。
