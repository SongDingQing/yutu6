# 控制台只读治理试点候选快照

状态:只读治理试点输入快照 / current refresh
原始日期:2026-06-29
本轮刷新:2026-07-05
任务:cr-1783228718439-c42c7ece; root=cr-1783228495485-1247c429
范围:`projects/控制台/` 内已有 tool 入口;本轮未覆盖 skill;Starlaid/星桥排除

## 快照来源

| 来源 | 路径/行 | sha256 | 用途 |
|---|---|---|---|
| 当前 CEO brief | `projects/控制台/brief.md:14288`-`projects/控制台/brief.md:14324` | `sha256:6e991a5a4f08e786a161b48501e9bf144068d639e7e4a1a575404a2612cf9ac6` | 明确本轮目标、边界、验收和董事会修订 |
| 洞察员公告板候选 | `board/insights/insights.md:230`-`board/insights/insights.md:243` | `sha256:45c3f6553c1b6a9e04ee3c889babbd3e05393ff504ffed78a36c94cf4964cf70` | HeroUI 借鉴点:库自带 `llms.txt` / MCP / agent skills,建议给控制台补 agent-facing 自描述 |
| 控制台能力治理前序提案 | `memory/decisions.md:679` | `sha256:f890aec2263b2cdd23b0d0a2b7ef8d8f87772037ce2c7093e50ee8bd2ceff954` | 已列出 3 个控制台试点样例:`secretary-tools.js queue-organize`、`tools/serial-smoke-test.js`、`engine-runner review-loop` |
| 详细样例映射 | `projects/控制台/artifacts/architecture/skill-interface-contract-governance-20260629.md:112`-`projects/控制台/artifacts/architecture/skill-interface-contract-governance-20260629.md:160` | `sha256:1dce84ec5f937fd4432201afbfc2d8d46894f244598be53d3f494b7cbed90b4e` | 三个对象已有执行模式、输入输出、红线操作和边界草案 |

## 选择对象

| 对象 | kind | 哈希对象 | sha256 | 选择理由 |
|---|---|---|---|---|
| `console.engine.review_loop` | tool | `projects/控制台/engine-runner.js` | `sha256:840fc72cefb440264a0a032ca18c1d9d872581b36fda8853a7f0e3bcc84916df` | 当前任务 done gate 本身依赖 review-loop;也是前序治理提案列出的异步/高副作用样例 |
| `console.secretary.queue_organize` | tool | `projects/控制台/secretary-tools.js` | `sha256:6996315316d099472da71f89fde5f2264b2a113c84a9955145c5e2c5e48ba25d` | 代表同步 CLI + 写队列管理动作;有 dry-run/apply 分界,适合验证权限/人审规则 |
| `console.tools.serial_smoke_test` | tool | `projects/控制台/tools/serial-smoke-test.js` | `sha256:c64e40c57b8f9eb97301956b17e23b60289955028084548a7346af50002f7003` | 代表长任务工具脚本和可复跑验收证据;会生成 artifact 并拉起 worker |

## 排除项

- 不选择外部仓库或外部 skill,因为本轮目标是控制台现有 2-3 个 skill/tool 的只读治理试点。
- 本轮实际对象均为 tool,不得读成已覆盖 skill。
- 不选择 Starlaid/星桥相关内容,即使其他清单中存在历史条目。
- 不批量迁移 `shared/capability_registry/skills-manifest.md` 或旧机 skills 清单;本轮只做上述 3 个对象的快照和说明。
