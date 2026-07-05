# agent-infra 架构研究与玉兔6吸收建议

- 研究日期: 2026-06-23
- 外部基准仓库: `https://github.com/fitlab-ai/agent-infra`
- 固定研究 commit: `7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37`
- commit 时间: `2026-06-23 08:33:34 +0800`
- commit 描述: `chore: prepare next dev iteration after v0.7.6`
- tag 基准: `v0.7.6-1-g7fb49cb`
- commit count: `444`
- package 基准: `@fitlab-ai/agent-infra | 0.7.7-alpha.0 | MIT | Node >=22`
- 只读边界: 本轮仅研究外部仓库与玉兔6控制台现有文档/代码/审计记录;不改引擎、队列、SOP、skills、通知、服务或沙箱实现。
- 本轮允许写入: 新增本研究文档;更新 `projects/控制台/status.md` 的执行记录。`board/status-rollup.md` 留给系统增量更新。

## 0. 执行口径

本报告按老板要求的 loop 方式执行:

1. 定标准: 五个研究维度各至少有一个外部源码或文档证据,内部对比必须引用玉兔6当前代码/运行审计,不能把“复审失效”当口头前提。
2. 研究: 固定 agent-infra commit 后阅读 README、architecture、workflows、skills、sandbox、平台/源码和 `.agents/skills`。
3. 对比: 对照玉兔6控制台的 `review-loop`、`done-gate`、历史假完成审计、状态记录和本地 `.agents/skills`。
4. 挑刺: 分析 agent-infra 哪些设计不适合直接照搬,尤其 Docker 沙箱、PR/GitHub 默认路径、过度标准化对 CEO/主管/维修分层的影响。
5. 建议: 只给可配置、分阶段、低风险吸收方案;沙箱只吸收理念,不搬实现。

结论先行: agent-infra 的强项不是某个模型更强,而是把“分析、方案、编码、复审、提交、完成”变成同一套文件化、可校验、跨 TUI 可复用的生命周期。玉兔6已经有更贴近本机经营场景的 CEO/主管/队列/Feishu/维修分层和 true-done 门禁,但历史上确有 runner 无写盘、绕过主管 review-loop、缺 logic_chain 等可验证失效症状。建议吸收 agent-infra 的“阶段产物 + 独立 gate + 复审后变更重审”思想,但做成可配置 SOP 模板,不要把它的 GitHub PR 流和 Docker 沙箱硬移植进玉兔6。

## 1. agent-infra 架构研究

### 1.1 项目定位与分层

agent-infra 的 README 将其定位为面向多 AI coding agent 的协作基础设施: skills、workflows、sandboxes 同时服务 Claude Code、Codex、Gemini CLI、OpenCode,并主张从 issue 到 merged PR 用标准命令推进。固定 commit 证据:

- [README.md#L7-L12](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/README.md#L7-L12): 项目定位、多 TUI、三阶段 review。
- [README.md#L31-L33](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/README.md#L31-L33): 标准化同一任务生命周期、skill vocabulary、governance files、isolated sandboxes、upgrade path。
- [docs/en/architecture.md#L5-L13](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/docs/en/architecture.md#L5-L13): CLI 初始化、AI skills/workflows 接管、完整生命周期。
- [docs/en/architecture.md#L15-L33](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/docs/en/architecture.md#L15-L33): AI TUI Layer -> Shared Layer -> Project Layer。

它的核心分层很薄:

| 层 | 作用 | 证据 |
| --- | --- | --- |
| AI TUI Layer | Claude Code、Codex、Gemini CLI、OpenCode 入口不同,语义同一 | `lib/builtin-tuis.ts:1-16`; `README.md:146-157` |
| Shared Layer | skills、workflows、templates 作为共享协作层 | `docs/en/architecture.md:24-33` |
| Project Layer | 渲染到项目内 `.agents/`、`AGENTS.md`、各 TUI 命令目录 | `README.md:173-180`; `.agents/.airc.json:59-74` |

### 1.2 标准化任务生命周期 SOP

agent-infra 的最强设计是把“任务怎么做”写成固定链路和阶段产物,不是只靠提示词。README 示例给出 11 个命令:

`import/create -> analyze -> review-analysis -> plan -> review-plan -> code -> review-code -> code(fix) -> commit -> create-pr -> complete`

证据:

- [README.md#L51-L79](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/README.md#L51-L79): 11 命令生命周期与跨工具状态连续。
- [README.md#L155-L165](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/README.md#L155-L165): 核心命令顺序。
- [docs/en/workflows.md#L5-L8](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/docs/en/workflows.md#L5-L8): 三个预置 workflow 共享 gated delivery lifecycle。
- [docs/en/workflows.md#L22-L68](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/docs/en/workflows.md#L22-L68): 生命周期图,每个 review 可回到上一阶段。
- [.agents/workflows/feature-development.yaml#L11-L196](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/.agents/workflows/feature-development.yaml#L11-L196): feature-development 的 analysis、analysis-review、design、design-review、code、code-review、commit 细化任务、输入、输出和版本化规则。

这套 SOP 的价值在于:

- 每个阶段有明确输入/输出,降低“只写思路没落盘”的空间。
- review 不只在代码后发生,而是在 analysis、plan、code 三处 gate。
- artifact versioning 用 `analysis-r{N}.md`、`plan-r{N}.md` 等保存多轮上下文,方便审计。
- fix mode 明确让 code 阶段读取最新 `review-code` 产物,避免复审意见丢失。

### 1.3 三阶段 review/gate 机制

agent-infra 的 gated review 不是单一最终审查,而是三段:

1. analysis-review: 确认需求分析完整、边界清晰、风险可验证。
2. design-review / review-plan: 确认方案可实施、低风险、测试策略足够。
3. code-review: 确认实现、测试、安全、性能、风格。

关键证据:

- [.agents/workflows/feature-development.yaml#L35-L59](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/.agents/workflows/feature-development.yaml#L35-L59): analysis-review 的任务与输出。
- [.agents/workflows/feature-development.yaml#L91-L115](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/.agents/workflows/feature-development.yaml#L91-L115): design-review 的任务与输出。
- [.agents/workflows/feature-development.yaml#L153-L177](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/.agents/workflows/feature-development.yaml#L153-L177): code-review 的任务与输出。
- [.agents/scripts/validate-artifact.js#L119-L162](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/.agents/scripts/validate-artifact.js#L119-L162): `gate` 命令按 skill 的 verify config 聚合检查结果并返回 exit code。
- [.agents/scripts/validate-artifact.js#L567-L632](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/.agents/scripts/validate-artifact.js#L567-L632): disagreement ledger 必须终态收敛或升级人工。
- [.agents/scripts/validate-artifact.js#L635-L690](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/.agents/scripts/validate-artifact.js#L635-L690): review 之后如果代码路径有新 commit,必须重跑 `review-code` 或记录人工豁免。

这套 gate 的可借鉴点是“审查后的变更必须再被审查”。玉兔6当前 done-gate 关注 implementation/review 最终证据,但对于“复审后又改动”的文件级 baseline/fingerprint 还可以增强。

### 1.4 skill-driven 机制与 `.agents/skills`

agent-infra 把 day-to-day 工作绑定到 skill。skill 不是薄命令别名,而是包含结构化产物、多轮版本、严重级别复审、跨工具状态延续和 activity log。

证据:

- [docs/en/skills.md#L5-L15](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/docs/en/skills.md#L5-L15): skill 的设计目标和结构化产物。
- [docs/en/skills.md#L19-L29](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/docs/en/skills.md#L19-L29): 任务生命周期 skills。
- [.agents/README.md#L124-L171](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/.agents/README.md#L124-L171): 外部模板/skill 源、本地 `.agents/skills/<name>/SKILL.md`、更新后生成命令。
- [.agents/.airc.json#L59-L74](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/.agents/.airc.json#L59-L74): `.agents/skills/`、workflows、templates 和多 TUI 命令目录被纳入 managed files。

本轮固定 commit 下,agent-infra `.agents/skills` 文件数为 79。典型结构:

```text
.agents/skills/analyze-task/SKILL.md
.agents/skills/analyze-task/config/verify.json
.agents/skills/review-analysis/SKILL.md
.agents/skills/review-analysis/config/verify.json
.agents/skills/plan-task/SKILL.md
.agents/skills/review-plan/SKILL.md
.agents/skills/code-task/SKILL.md
.agents/skills/review-code/SKILL.md
.agents/skills/complete-task/SKILL.md
.agents/skills/update-agent-infra/scripts/sync-templates.js
```

### 1.5 多模型 / 多 TUI 统一

agent-infra 支持的内置 TUI 是 Claude Code、Codex、Gemini CLI、OpenCode。它通过同一 `.agents` 工作流和不同 TUI 的命令前缀实现“入口不同,语义相同”。

证据:

- [lib/builtin-tuis.ts#L1-L16](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/lib/builtin-tuis.ts#L1-L16): 内置 TUI id 和各自 owned path。
- [README.md#L146-L157](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/README.md#L146-L157): Claude/Codex/Gemini/OpenCode 的命令前缀不同,workflow semantics 不变。
- [.agents/.airc.json#L15-L20](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/.agents/.airc.json#L15-L20): sandbox tools 列出四个 TUI。
- [.agents/README.md#L74-L92](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/.agents/README.md#L74-L92): 推荐按模型能力分配分析、审查、实现、大上下文、命令式迭代。

对玉兔6的启发是: 可以保留现有角色/队列模型,但在“同一个任务证据结构”上打通不同 runner。runner 可以不同,交付 JSON、logic_chain、review_verification、artifact gate 应相同。

### 1.6 沙箱设计

agent-infra 的沙箱是相对完整的 Docker/VM 方案: 按项目生成 worktree、container、share dirs、shell config、dotfiles、AI tool credentials channel,并根据平台选择 Colima/OrbStack/Docker Desktop/native/wsl2。

证据:

- [docs/en/sandbox.md#L7-L21](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/docs/en/sandbox.md#L7-L21): sandbox aliases、GitHub CLI、token 注入、工具更新和凭据同步。
- [docs/en/sandbox.md#L23-L53](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/docs/en/sandbox.md#L23-L53): host-sandbox 文件交换 `/share/common`、`/share/branch`、`/clipboard`。
- [docs/en/sandbox.md#L55-L106](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/docs/en/sandbox.md#L55-L106): dotfiles channel 与“不要放 secrets”的警告。
- [lib/sandbox/config.ts#L12-L21](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/lib/sandbox/config.ts#L12-L21): sandbox 默认 runtime/tools。
- [lib/sandbox/config.ts#L93-L170](https://github.com/fitlab-ai/agent-infra/blob/7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37/lib/sandbox/config.ts#L93-L170): `.agents/.airc.json` 加载、worktree/share/config/dotfiles 路径。

需要特别注意: 这部分不能直接照搬进玉兔6。它默认 GitHub/PR/Docker/worktree 路径,且涉及 token/credential channel。玉兔6有 Feishu 通知、CEO/主管队列、项目 scope、维修员权限、系统状态 rollup 等本机耦合,直接迁移 Docker 隔离会产生路径、权限、通知、锁和状态同步风险。

## 2. 玉兔6现状对比

### 2.1 玉兔6现有优势

玉兔6不是空白系统。控制台已有确定性 review-loop、done-gate、历史假完成审计、项目 scope、CEO/主管/worker/维修分层和系统 rollup 约定。

关键证据:

- `shared/routing/flows/review-loop.yaml:1-14`: 固定 implement -> review -> human/done 流程,2026-06 起叠加 loop engineering,最多三轮,有墙钟和 dry-run。
- `shared/routing/flows/review-loop.yaml:22-38`: review false 回 implement,高危或超轮次进 human gate,验收要求证据。
- `shared/engine/done-gate.js:292-315`: implementation 必须有 `logic_chain`、状态/结论/actions/evidence 和可核指针。
- `shared/engine/done-gate.js:344-371`: 主管复审必须有 hard verification、checked/evidence、逐项核 `changed_files` 和测试证据。
- `shared/engine/done-gate.js:374-405`: review-loop 完成必须满足 implementation.done、logic_chain、review.pass、hard review、changed files、hard regression、loop engineering。
- `shared/engine/engine.js:203-228`: 到 end 时执行 true done gate,失败即 `done_gate.blocked` 并置 failed。
- `shared/engine/engine.js:367-395`: implement/review 节点过程内即时校验 logic_chain 和 review_verification。

这说明玉兔6的控制台已经针对“假完成”做了运行时硬门,尤其比 agent-infra 更贴合本地 CEO/主管体系和任务队列。

### 2.2 “复审失效”不能泛化,但历史症状有证据

董事会提醒是正确的: 不能直接把“玉兔6复审失效”当结论。现有证据更准确地说是:

- 历史链路中存在绕过主管 review-loop 或缺少 logic_chain 的假完成/需复验项。
- 有些 implement runner 物理上没有写盘能力,导致多轮只产草案不落盘。
- 新 done-gate 已经在修复这些问题,不能把当前机制简单归类为失效。

证据:

- `projects/控制台/artifacts/done-gate-audit-2026-06-22.md:5-9`: 检查 80 个 done,80 个需复验。
- `projects/控制台/artifacts/done-gate-audit-2026-06-22.md:20-52`: 多个根任务下游为非主管/非 project-route done 或缺 implementation.logic_chain。
- `projects/控制台/artifacts/history-false-done-audit-20260623.md:9-14`: 扫描 476 项、306 个 done,确认假完成/漏做根任务 3 个,结构性风险 27 个,交付型 done 缺证据候选 40 个。
- `projects/控制台/artifacts/history-false-done-audit-20260623.md:20-22`: 三个明确假完成根任务都依赖 `agent-once`,不是 supervisor review-loop。
- `projects/控制台/artifacts/history-false-done-audit-20260623.md:68-78`: 新 guard 要求 CEO 根任务 done 必须来自 supervisor review-loop,且已有回归 fixture。
- `projects/控制台/status.md:2636-2672`: 办公室 tile 方案三轮空转,根因是 implement 节点路由到无写盘 runner。
- `projects/控制台/status.md:2680-2694`: 硬化攻坚中仅产 JSON Schema 草案,未落盘、无测试、changed_files 空。

因此本报告用“历史复审/执行链路的硬证据不足和 runner 能力错配”作为问题定义,不是用“复审失效”做先验判断。

### 2.3 对比表

| 维度 | agent-infra 优势 | agent-infra 劣势 / 不适合处 | 玉兔6优势 | 玉兔6短板 | 吸收优先级 / 迁移成本 |
| --- | --- | --- | --- | --- | --- |
| 任务生命周期 SOP | create/import -> analyze -> review-analysis -> plan -> review-plan -> code -> review-code -> commit -> PR -> complete,阶段边界清楚 | 默认 GitHub issue/PR 语境强,不覆盖玉兔6 CEO 带外队列和 Feishu 汇报 | 已有 CEO/主管/worker/维修分层和 project scope,更适合本机经营任务 | 生命周期更多依赖 brief/角色提示词,分析/方案阶段 gate 不够文件化 | 短期吸收: 高;成本中 |
| 三阶段 gated review | analysis/plan/code 三个 gate,复审后代码变更必须重审 | 对小任务可能流程过重;自 review 容易同模型偏差 | 已有 done-gate 强验证最终完成,并接 taskstore/eventlog | 主要是最终 implementation/review gate,前置分析/方案 gate 不够强 | 短期试点高风险任务;成本中 |
| skill-driven | `.agents/skills` + verify config + command renderer,跨 TUI vocabulary 一致 | 管理文件多,模板更新机制复杂;外部 skill 脚本可信边界要管 | Codex runtime 已有大量项目 skill,适合 Simulaid/控制台等本地场景 | repo 内 `.agents/skills` 很薄,缺 SOP skill 目录化和 verify config | 中期吸收;成本中到高 |
| 多模型统一 | Claude/Codex/Gemini/OpenCode 同 lifecycle,命令前缀不同语义一致 | 模型分工是建议型,不理解玉兔6内部角色权限 | 玉兔6角色职责、队列、主管 gate 更明确 | runner 能力与角色有时错配,如无写盘 runner 执行 implement | 短期做 runner capability preflight;成本低 |
| 沙箱隔离 | Docker/VM/worktree/share/credential channels 完整 | 与 Feishu、队列、状态卷宗、权限锁兼容风险高;凭据通道敏感 | 玉兔6本机路径和服务一体化,维修员/主人授权边界清楚 | 任务隔离和写盘权限 preflight 不够体系化 | 只吸收理念;短期轻量隔离成本低,完整沙箱长期高 |
| 审计与完成证明 | artifact versioning、activity log、review ledger、post-review commit gate | 依赖任务 workspace 规范,迁入存量系统工作量大 | 已有 logic_chain、hard verification、changed_files、tests、true_done | 缺阶段产物版本化和 disagreement ledger 统一格式 | 中期吸收;成本中 |

## 3. `.agents/skills` 同源与差异

董事会要求对 `.agents/skills` 做文件级对齐。本轮固定基准下:

| 项 | agent-infra | 玉兔6当前仓库 |
| --- | --- | --- |
| repo 内 `.agents/skills` 文件数 | 79 | 1 |
| 典型文件 | `analyze-task/SKILL.md`, `review-analysis/config/verify.json`, `plan-task/SKILL.md`, `review-plan/config/verify.json`, `code-task/SKILL.md`, `review-code/config/verify.json`, `complete-task/config/verify.json`, `update-agent-infra/scripts/sync-templates.js` | `.agents/skills/game-assets/SKILL.md` |
| 共同相对文件 | 无 | 无 |
| skill 形态 | SOP 生命周期 + verify config + 脚本 + 模板同步 | Meowa game-assets 稳定 loader,动态读取共享能力文档 |
| 证据 | 固定 commit 下 `find .agents/skills -maxdepth 4 -type f` 为 79; `.agents/README.md:145-171` 描述本地 skill 机制 | 本仓 `find .agents/skills -maxdepth 5 -type f` 仅输出 `.agents/skills/game-assets/SKILL.md`;该文件 `:11-17` 指向共享 Meowa CLI 与密钥不入 skill 目录 |

需要补充一层语义: 玉兔6并不是没有 skill 体系,而是 repo 内 `.agents/skills` 与用户级 `/Users/yutu6/.codex/skills` 分工不同。当前 Codex 会从用户级 skill roots 加载大量项目 skill,例如 `instruction-expansion-router`、`module-registry`、`simulaid-*`、`yuhu`、`yuling`、`yulong` 等。agent-infra 则强调把协作 SOP skills 渲染进项目 `.agents/skills` 并生成多 TUI 命令。

吸收时不要把二者简单覆盖。更合理的对齐方式是:

- 保留用户级 project skill 作为跨项目能力和长期路由。
- 在控制台项目内新增少量 SOP 型 `.agents/skills` 或 `shared/knowledge/engineering` 模板,专门服务任务生命周期 gate。
- 对每个 SOP skill 配置机器可检的 verify schema/脚本,而不是只写提示词。

## 4. 五维证据门槛检查

| 研究维度 | 外部证据 | 内部对比证据 | 门槛结论 |
| --- | --- | --- | --- |
| 任务生命周期 | `README.md:51-79`, `docs/en/workflows.md:5-68`, `.agents/workflows/feature-development.yaml:11-196` | `shared/routing/flows/review-loop.yaml:1-38` | 已满足 |
| 三阶段 review/gate | `.agents/workflows/feature-development.yaml:35-177`, `.agents/scripts/validate-artifact.js:119-162` | `shared/engine/done-gate.js:292-405`, `shared/engine/engine.js:203-228` | 已满足 |
| skill 机制 | `docs/en/skills.md:5-29`, `.agents/README.md:124-171`, `.agents/.airc.json:59-74` | `.agents/skills/game-assets/SKILL.md:1-65`, 用户级 skill roots 清单 | 已满足 |
| 多模型统一 | `lib/builtin-tuis.ts:1-16`, `README.md:146-157`, `.agents/README.md:74-92` | 控制台 worker_code/主管/CEO 角色提示词与 review-loop 分层; runner 能力错配记录见 `status.md:2636-2672` | 已满足 |
| 沙箱隔离 | `docs/en/sandbox.md:7-106`, `lib/sandbox/config.ts:12-170` | 玉兔6项目 scope/Starlaid 排除/维修授权边界;历史无写盘 runner 问题见 `status.md:2636-2672` | 已满足 |

## 5. 挑刺: 不应照搬的部分

### 5.1 沙箱实现风险高

agent-infra 的沙箱强在完整,风险也来自完整。它会管理 worktree、container、share dirs、dotfiles、token/credential channels。玉兔6现有控制台不是纯 GitHub PR 工程,而是有本机队列、Feishu、状态 rollup、维修员救火、主人授权和多项目排除约束。直接复制 Docker 沙箱会带来:

- 队列文件与 taskstore/eventlog 是否在容器内外一致的问题。
- Feishu/通知/浏览器/本机自动化能力在容器中不可用或权限漂移。
- 凭据通道如果复制错误,会违反“密钥不回显、不写文件、不进日志”的红线。
- Docker/OrbStack/Colima 本身增加维修面,可能把 agent 失败从逻辑问题变成环境问题。

建议只吸收三个理念: runner 能力预检、工作区隔离、共享目录/凭据红线声明。不要在短期改成 Docker 全沙箱。

### 5.2 过度标准化会伤害玉兔6的灵活性

agent-infra 的统一生命周期适合 issue/PR 型软件工程。但玉兔6任务有 CEO brief、董事会修订、主管复审、维修员、HR、质量运营、图像/构建/Feishu 等非 GitHub PR 路径。若强制所有任务都走 analyze-plan-code 三段 gate,会让小修、纯状态收口、紧急维修变慢。

建议做“可配置 SOP 模板”:

- 默认轻任务: 现有 implement -> review -> done。
- 高风险交付: 加 analysis-review + plan-review。
- 架构/沙箱/队列/发布: 强制三阶段 gate。
- 紧急维修: 允许维修员 fast path,但完工后补证据审计。

### 5.3 agent-infra 的 review 自洽性仍需外部制衡

agent-infra 很多 review 是 AI self-review。它靠模板、severity、ledger、verify config 降低风险,但不能保证模型不会集体误判。玉兔6的主管/董事会/主人手动 gate 在高风险任务上仍有价值。吸收时应把“模板化 gate”叠到现有主管复审上,不是替代主管。

## 6. 可吸收设计与落地建议

### P0 短期: runner capability preflight

问题证据: `projects/控制台/status.md:2636-2672` 明确出现 implement 被派给无写盘 runner,三轮空转。这个比完整沙箱更急。

建议:

- 在控制台 review-loop implement 节点前增加 runner capability 预检概念: `can_read`, `can_write`, `can_run_tests`, `network`, `browser`, `paid_tool`, `secrets_allowed=false`。
- 交付型任务要求 `can_write=true`;视觉任务要求 browser/screenshot 或明确降级证据;Meowa/付费工具要求显式审批。
- 若 runner 能力不满足,直接 fail/转派,不要消耗 loop 轮次。

迁移成本: 低到中。优先级最高。它吸收的是 agent-infra “工具能力/沙箱 tools 显式配置”的思想,不需要 Docker。

### P1 短期: 可配置三阶段 gate 模板

建议新增控制台 SOP 模板,不是替换现有 review-loop:

```text
light:
  implement -> review -> done

delivery:
  analyze -> review-analysis -> implement -> review-code -> done

architecture/high-risk:
  analyze -> review-analysis -> plan -> review-plan -> implement -> review-code -> done
```

适用范围:

- 架构、队列、done-gate、版本推进、沙箱、发布、Feishu 链路: 强制 high-risk。
- 普通文档研究、状态收口: light 或 delivery。
- 视觉/构建/上线: delivery + 专项证据 gate。

迁移成本: 中。先做配置和文档 gate,后续再接 runtime。

### P1 短期: 阶段产物 verify config

agent-infra 的 `.agents/skills/*/config/verify.json` 和 `validate-artifact.js` 值得吸收。玉兔6可先不引入全部 skill,只给高风险阶段定义机器可检条件:

- `analysis.md`: 必须包含范围、非范围、源证据、风险、验收标准。
- `review-analysis.md`: 必须包含 pass/fail、blocking findings、逐项证据。
- `plan.md`: 必须包含改动文件、回滚、测试、兼容性、边界。
- `review-plan.md`: 必须核方案可实施性和风险遗漏。
- `code.md` 或 implementation.logic_chain: 必须列 changed_files、diff/test/evidence。

这会弥补“最终 logic_chain 很强,但前置分析/方案缺机器门”的缺口。

### P2 中期: review baseline / post-review change gate

agent-infra 明确检查 review 之后是否又有代码路径 commit,否则要求重跑 review-code 或人工豁免。玉兔6可以做本地化版本:

- 每次主管 review pass 时记录 `review_baseline_hash`: changed_files 的 path + mtime/hash + git diff fingerprint。
- done 前重新算 fingerprint;如文件变动,必须重跑 review 或记录 human_decided exemption。
- 对文档研究也可记录文档 hash,避免 review 后被悄悄改。

迁移成本: 中。收益高,尤其适合控制台经常并发修改 `workspace.html`、队列和状态文件的场景。

### P2 中期: skill-driven SOP 目录

不建议一次性复制 agent-infra 79 个 skill。建议最小吸收 4 类:

| skill | 用途 | 放置建议 |
| --- | --- | --- |
| `analyze-control-task` | 生成控制台任务分析产物 | `.agents/skills/` 或 `shared/knowledge/engineering/` |
| `review-analysis-control` | 主管复审分析 | 同上 |
| `plan-control-change` | 高风险改动方案 | 同上 |
| `review-plan-control` | 方案 gate | 同上 |

保留现有 `/Users/yutu6/.codex/skills` 作为跨项目/角色路由来源,不要让项目内 `.agents/skills` 覆盖用户级技能。项目内 SOP skill 应只描述控制台交付流程和 verify schema。

### P3 长期: 轻量隔离优先,完整沙箱后置

短期可做:

- 为每个交付任务创建 `projects/控制台/artifacts/work/<taskId>/` 作为临时输出区,禁止乱写根目录。
- 写入前列 allowed paths;done-gate 核 `changed_files` 是否落在 scope。
- 对需要外部工具的任务只挂只读凭据红线,不复制凭据。
- 对高风险代码改动用 git worktree dry-run 或 patch preview,由主人/维修员确认后落主线。

长期才考虑 Docker/VM:

- 先验证 Feishu、queue、eventlog、Browser/Chrome、Meowa、Quark 等本机能力是否可用。
- 不把 token 自动注入容器;任何 OAuth/扫码/2FA 仍交主人。
- 保留维修员本机 fast path,避免容器故障阻断救火。

## 7. 建议落地顺序

| 时间线 | 建议 | 成本 | 风险 | 验收 |
| --- | --- | --- | --- | --- |
| 1-2 天 | runner capability preflight 方案与最小门禁 | 低/中 | 低 | 无写盘 runner 不能进入交付型 implement |
| 2-4 天 | 高风险任务 SOP 模板,可配置启用三阶段 gate | 中 | 中 | architecture/high-risk 任务必须有 analysis/plan/review 产物 |
| 3-5 天 | 阶段产物 verify schema/脚本 | 中 | 中 | 缺范围/证据/测试/changed_files 时 gate fail |
| 1 周 | review baseline / post-review change fingerprint | 中 | 中 | review pass 后改文件会阻断 done |
| 2 周+ | 项目内 SOP skills 最小集 | 中/高 | 中 | Codex/Claude/OpenCode 入口语义一致,但不覆盖用户级 skill |
| 1 月+ | 沙箱方案 PoC | 高 | 高 | 仅在 isolated branch/测试项目验证,不接生产队列 |

## 8. 最终建议

优先吸收:

1. 三阶段 gated review 的思想,但做成可配置模板,只对高风险任务强制。
2. 阶段产物 + verify config,补足玉兔6前置分析/方案 gate 的机器可检性。
3. review baseline/post-review change gate,防止复审通过后再改动绕过。
4. runner capability preflight,直接解决历史“无写盘 runner 空转”的硬伤。
5. `.agents/skills` 项目内 SOP skill 最小集,与用户级 Codex skills 并存。

暂不吸收或只研究:

1. Docker/VM 全沙箱实现: 高风险,先吸收理念和轻量隔离。
2. GitHub PR 默认流: 玉兔6可借鉴 commit/PR 证据格式,但不能强绑所有任务。
3. 全量 79 个 skills: 维护面太大,先抽取控制台高频生命周期。

一句话结论: agent-infra 比玉兔6强在“标准任务生命周期和阶段 gate 的文件化/可复现性”;玉兔6比 agent-infra强在“本机业务角色、CEO/主管/维修/Feishu/队列的场景适配”。最佳路线是把 agent-infra 的 SOP/gate/skill/隔离理念本地化为玉兔6的可配置硬门,而不是搬它的仓库结构和沙箱实现。

## 9. 本轮复核记录

- 复核时间: 2026-06-23T12:08:49+0800。
- 外部基准轻量核验: `git ls-remote https://github.com/fitlab-ai/agent-infra.git HEAD refs/tags/v0.7.6 refs/heads/main` 返回 `HEAD/main = 7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37`,`refs/tags/v0.7.6 = f2fa8855a3d5be274664684beaa8ec4e82958348`;本报告仍以固定 commit `7fb49cbdd5bdc3e2a6b9feb6d5e15b593dc58a37` 为可复现研究基准。
- 文档自检: `rg` 命中固定 commit、只读边界、五维证据门槛、`.agents/skills` 文件级差异、runner capability preflight、可配置三阶段 gate、review baseline/post-review change gate 与沙箱风险章节。
- 控制台 scope 验证: `node shared/engine/demo.js` PASS;`node projects/控制台/tools/serial-smoke-test.js` PASS,runRoot `projects/控制台/artifacts/serial-smoke/20260623040653`;`node tests/run.js` PASS。
