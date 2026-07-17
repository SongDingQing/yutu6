# Agent Harness 无副作用项执行记录

- 日期: 2026-07-14
- 授权:主人要求“8 条中没有任何副作用的直接执行”
- 原则:只新增研究/审计模板、只读差距报告、离线校验器和测试;未连接生产 hook,未改 runner/路由/并发/权限/状态协议/自动记忆/全局 gate。

## 已直接执行

| 安全项 | 对应建议 | 产物 | 状态 |
|---|---|---|---|
| 研究 light/deep/audit 分档与停止条件 | AHR-01..08 | `.agents/skills/agent-harness-research/SKILL.md`, `templates/research-brief.md`, `templates/source-manifest.md` | 完成 |
| Open-source teardown 与 source-audit 模板 | AHR-09..16 | `templates/open-source-teardown.md`, `templates/source-audit.md` | 完成 |
| 50 条建议机器校验 | AHR-01..50 | `scripts/validate-report.js`, `tests/insight-scout-agent-harness-policy.test.js` | 完成 |
| hook/skill 盘点与独立复核模板 | AHR-26..34 | `templates/hook-skill-quality-review.md` | 完成,未连接运行时 |
| eval canary 设计模板 | AHR-43..48 | `templates/eval-canary.md` | 完成,未执行生产 canary |
| 本机现状只读差距审计 | AHR-17..50 | 本文件“本机覆盖与缺口” | 完成 |
| 研究 skill 生命周期元数据 | AHR-32..34 | skill 的 trigger boundary、owner、review cadence、invalidation | 完成 |
| 当前上下文/token 基线快照 | AHR-42/AHR-49 | 2026-07-14 实测 compact 约 5,041 tokens,预警线 8,000 | 完成 |

## 本机覆盖与缺口

| 主题 | 已有硬能力 | 只读判断 | 仍需拍板的行为变更 |
|---|---|---|---|
| 真完成/环境证据 | `shared/engine/done-gate.js:1129-1151` 要求逻辑链和可核证据;`protocol-gate.js:203-205` 要求 changedFiles/tests/artifacts 索引 | AHR-18、AHR-43、AHR-44 已有较强覆盖,不应再造一套 done gate | 只考虑把可度量 eval schema 与 trajectory replay 接入现有 gate |
| 状态与恢复 | `taskstore.js` 有显式状态;`ceo-worker.js:4318-4492` 有 waiting/downstream/heartbeat 恢复;`queue.js` 有 lease heartbeat | AHR-19、AHR-22 部分覆盖;缺统一 tool-step trajectory schema | typed outcome 兼容迁移、逐步 checkpoint 频率和保留策略 |
| 超时与孤儿进程 | `ceo-worker.js:2152-2169` 有 SIGKILL 兜底;CLI runner 有 node timeout | AHR-20、AHR-21 部分覆盖;需另测所有 runner 是否统一进程组 | process-group 统一策略会影响合法子进程,须 owner gate |
| Hook 生命周期 | `hook-registry.js:7-99` 有 priority、timeout、failureMode、事件日志 | AHR-30 已部分覆盖;缺 schema version、pre/post 职责声明、异步观察通道 | AHR-28..31 的 registry/事件协议变化 |
| 交接 | `handoff.js` 已有 task.md/meta 指纹、shadow/on/off 与失败回退 | AHR-35..41 部分覆盖;尚无统一 delegation envelope 与 quorum 字段 | 改信封、context filter、review quorum 和共享状态 owner |
| 迭代/回滚 | `loop-engineering.js` 已有 snapshot、score、plateau、degraded rollback、skill patch gate | AHR-48 已覆盖核心;缺跨 prompt/hook 的统一 A/B 账本 | 生产 canary 与自动回滚触发条件 |
| Token 效率 | `secretary-tools.js` 有 compact context 与粗估预算;2026-07-14 实测 5,041/8,000 tokens | AHR-37、AHR-41、AHR-42、AHR-49 部分覆盖;缺 role/model/task 成功率联合视图 | 连接 usage/eventlog 的聚合消费者,避免高频写盘 |
| Skill 学习 | 已有 learning-cases、skill-standard-reviewer 和 self-reflection 流程 | AHR-32 部分覆盖;AHR-33/34 缺统一生命周期字段与晋升次数阈值 | 自动晋升、TTL 清理和全局 skill 写入 |

## Skill standard review

- 触发清楚:正触发覆盖 agent harness/论文/仓库拆解/多智能体协调,负触发排除普通 bug、已知文件实现和无关网页查询。
- 所有权清楚:这是玉兔6项目 skill,owner 为 insight-scout,质量运营和监管是独立 reviewer,不伪造签字。
- 自包含:研究 brief、source manifest、teardown、source audit、建议账本、hook/skill 复核和 eval canary 均有模板。
- 可验证:离线 validator 会检查必需章节、15–50 条唯一建议、决策字段和来源数量;测试覆盖轻/深模式、角色可见性和安全边界。
- 范围合格:skill 不安装依赖、不写生产配置、不授权运行时改造;需要生产行为的建议仍走 owner gate。

## 公告板处理

- 包 1、包 2 已完整完成;对应两张 `todo` 卡已通过 `secretary-tools bulletin-remove` 移除,避免重复派单。
- 包 3–8 的安全底稿已完成,但卡片仍保留 `todo`,用于拍板真正会改变运行时行为的剩余部分。
- 未启用任何卡,未产生 CEO/主管/模型调用。
