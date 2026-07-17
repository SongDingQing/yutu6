# 控制台只读治理试点小结

状态:`pilot_only` / `readonly_governance` / `not_runtime_contract`
本轮刷新:2026-07-05
任务:cr-1783228718439-c42c7ece; root=cr-1783228495485-1247c429
原始试点:cr-1782712888258-a3e9f8b0; root=cr-1782712358768-2e7de4f4

## 结论

建议**采纳为只读治理试点格式**,但**暂不采纳为运行时规范**。

可以保留 `AGENTS.md` / `llms.txt` + `apm.yml` / `apm.lock.yaml` 作为控制台能力治理的轻量说明层,用于 agent-facing 阅读、人工评审和未来 manifest 讨论。当前不得用于自动路由、权限放行、执行准入或 hot 层隐藏。任何字段进入运行时前,必须另起实现卡补 `.js` 消费点、schema/lint 和回归测试,以符合 `memory/decisions.md:595` 的 NR13 要求并避免 `memory/decisions.md:599` 的假闭环。

## 本轮拍板建议

| 决策 | 建议 | 可验证要求 |
|---|---|---|
| 采纳 | 采纳本目录作为只读治理试点样式 | `AGENTS.md` 顶部、`llms.txt` 和 `apm.yml` 均写明 `pilot_only/not_runtime_contract` |
| 暂不采纳 | 暂不把 `apm.yml` 字段接入运行时 | 后续若接入,必须先提交 `.js` 消费点和测试 |
| 需补证 | 许可证归属 | owner 确认本仓库/控制台自有代码 LICENSE,或批准继续以 `UNKNOWN` + human review 处理 |
| 需补证 | schema 收敛 | 决定 `apm.yml` 是否并入 `skill_manifest.v0`,避免形成第二套长期 schema |
| 需补证 | 推广范围 | 若要覆盖 skill,另选至少 1 个真实 skill 对象并单独登记;本轮只覆盖 3 个 tool |

## 本轮产物

| 文件 | 作用 |
|---|---|
| `candidates-snapshot.md` | 固定当前 brief、洞察候选、前序治理提案和 3 个 tool 的选择理由 |
| `AGENTS.md` | 面向 agent 的入口说明,显式声明只读、pilot-only、非运行时契约 |
| `llms.txt` | 紧凑 agent-facing 摘要 |
| `apm.yml` | 来源、版本/哈希、许可证、权限、风险等级、是否需人审的可读台账 |
| `apm.lock.yaml` | 可复核 SHA256 锁文件,含 `head_short` 与 dirty-worktree caveat |

## 修订核对

| 要点 | 结果 |
|---|---|
| SHA256 口径 | 完成;算法为 SHA256,对象为 `hash_object` 文件的 working-tree bytes,命令为 `shasum -a 256` |
| dirty worktree 复现性 | 完成;lock 记录 `git.head_short=e542a50` 和 dirty/untracked caveat |
| license unknown | 完成;统一写 `UNKNOWN`,不臆造 license,owner 确认前按 internal project code + human review 处理 |
| 权限分级 | 完成;低/中/高三档写入 `AGENTS.md` 与 `apm.yml`,中高风险和 UNKNOWN license 均需人审 |
| 高副作用不触发 | 完成;本轮只登记权限名称与用途,未触发网络、模型、进程、队列、GUI 或密钥副作用 |
| 范围口径 | 完成;明确本轮只覆盖 3 个 tool,不声明已覆盖 skill |
| 闭环结论 | 完成;给出采纳/暂不采纳/需补证表,每项有下一步可验证要求 |

## 只读边界核对

| 要点 | 结果 |
|---|---|
| 不安装外部运行时 | 完成;本轮未安装 `apm` 或其他依赖 |
| 不批量迁移历史 | 完成;只选 3 个前序提案样例 |
| 被治理对象文件零改动 | 完成;未编辑 `engine-runner.js`、`secretary-tools.js`、`tools/serial-smoke-test.js` |
| 集中放置,避免就近触发 | 完成;全部入口集中在 `.agent/governance/readonly-skill-tool-pilot-20260629/` |
| 密钥边界 | 完成;权限字段只写 capability 名称与用途,未记录任何 token/env/cookie/private key 内容 |

## 残留风险

- 当前工作区已有大量未提交/未跟踪文件;锁文件记录的是工作树快照,不是干净 release hash。
- `license: UNKNOWN` 是真实缺口。若未来要分发、复用或复制代码,必须先补 LICENSE 或逐文件 owner 确认。
- `requires_human_review: true` 当前是静态治理字段,没有运行时强制;不能把它当成已落地权限门。
- 本轮未覆盖 skill 对象。后续若要证明 skill/tool 统一治理,必须补真实 skill 样本。
