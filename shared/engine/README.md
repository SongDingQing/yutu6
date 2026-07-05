# 玉兔6 · 编排引擎 MVP(阶段2)

> 蓝图 §18 声明式控制平面的可跑实现。**结构已知的流程写死、零 token 走**;只在无边匹配时才交回 LLM 的 planner。同步织入可信地基(§10 + §18.7)。零依赖 Node。

## 模块
| 文件 | 作用 | 蓝图 |
|---|---|---|
| `yaml-lite.js` | flow 文件的极小 YAML 子集解析器 | — |
| `condition.js` | 把 `{{ ... }}` 条件边编译成可求值函数(零 token) | §18.1 |
| `validate.js` | 跑前 dry-run:引用完整 / 可达 / 有 end / 表达式可解析 | §18.7 护栏② |
| `eventlog.js` | append-only 事件日志(JSONL)+ seq + cursor 增量 | §10 / §18.6 |
| `taskstore.js` | 任务状态机 + attempt(queued→running→…→done/failed/awaiting_*) | §10 |
| `cli-runner.js` | **信封运行时**:写 task.md → spawn 真 CLI → 收 result.md → 抽 json 回填 | §3/§4 |
| `engine.js` | 编排主循环:校验→按边走→护栏→human gate→验收证据 | §18 |
| `protocol-gate.js` | 规格指纹、结构化回执、生产基线、通用编辑锁 | MKT 协议吸收 |
| `agents.js` | 加载 `shared/agents/*/agent.json` + dry-run 校验(role/runner/读路径) | §3 阶段3 |
| `demo.js` | mock runner 沙箱自测(零网络) | — |
| `agents-check.js` | 4 个系统级 agent 定义的 dry-run 校验 | 阶段3 |

> 位置:本引擎已从 `projects/控制台/` 提升为**核心模块 `shared/engine/`**(与项目解耦,供控制台/agent 消费)。系统级 agent 定义在 `shared/agents/`。

## 跑自测(沙箱即可,无需 CLI)
```bash
node shared/engine/demo.js          # 编排引擎
node shared/engine/agents-check.js  # 系统级 agent 定义校验
```
覆盖:评审循环→通过→done;一直不过→撞 max_loops→human gate→approve→done;坏流程图被 dry-run 拦截。

## 三道护栏(§18.7)
- **max_loops**:`guards.max_loops`,评审-返工上限;撞顶转 human gate。
- **墙钟超时**:`guards.wall_timeout_sec`,超时停在安全点报 human。
- **跑前校验**:`guards.validate_before_run`,不过不准跑。

## 可信地基(§10)
- 每步落事件日志(可被 WebUI 订阅 = 阶段5);任务状态机 + attempt 计数(监管识别"第几次失败" = 阶段6 输入)。
- `acceptance.require_evidence` → 没证据不算 done(带视觉产物须附截图,对照监管误区库 SVG 元案例)。

## 协议化 Done Gate
- 新 `review-loop` 任务启动时,`engine.js` 会把 `goal/acceptance/bounds/projectId/flow` 固化成 `spec_snapshot` 与 `spec_fingerprint`。后续 brief 或验收边界变化会导致指纹不一致,done gate 打回并要求新 taskId。
- `implement` 节点必须输出结构化回执 `implementation.receipt`: `taskId/specFingerprint/changedFiles/tests/artifacts/verdict/blocked_required_specs`。`changedFiles` 必须覆盖 `implementation.changed_files`;必做规格不能达成时必须事前写入 `blocked_required_specs` 并有主人批准,否则打回。
- `projects/控制台/hardening-hooks.js` 在 `task.true_done` 上再次执行协议 hook,防止绕过最终 gate。
- 生产基线默认写入 `projects/控制台/artifacts/runtime-baseline.json`,记录当前 git/version/service/关键文件 hash。收尾时用 `projects/控制台/tools/gate-closeout.js` 比对,不一致则阻断。
- 通用编辑锁由 `protocol-gate.acquireEditLock()` 提供,目录在 `projects/控制台/artifacts/resource-locks/*.lock`,包含 owner、pid、heartbeat、lease_ms;用于收尾脚本和高风险 gate 任务。

常用命令:
```bash
node tests/protocol-gate.test.js
node projects/控制台/tools/gate-closeout.js --task-id <taskId>
node projects/控制台/tools/gate-closeout.js --write-baseline --task-id <taskId>
```

## 接真 CLI(信封运行时)
`cli-runner.js` 用 `runners`(同控制台 config.json 的 cmd 模板)+ `roleMap`(角色→runner,参照 `model-routing.yaml` roles)。每个 agent 节点 = 写 §4 信封 task.md → spawnSync 对应 CLI → result.md → 抽 ```json 块合并回上下文。以信封 I/O 为权威(§10 best-effort)。
> 沙箱无真 CLI,机制已用假 CLI 验证通过;真 Codex 驱动在 Mac 上由 Codex 验证。

## 现状 / 下一步
- ✅ MVP:声明式编排 + 护栏 + human gate + 事件日志 + 验收证据 + 信封运行时(机制),沙箱自测 PASS。
- ⏳ Mac 侧:用真 Codex 跑一遍信封运行时(Codex 验证)。
- ⏳ 阶段3:把总管/主管/质量运营/监管做成常驻会话,挂到本引擎的角色上。
