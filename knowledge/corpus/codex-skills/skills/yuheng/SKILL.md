---
name: 玉衡
description: "Use when the user says 玉衡, 玉衡上, 测试用例刷新, 测试门禁, 回归测试, or asks to ensure current gameplay/UI/save/code changes have matching automated or manual regression tests. Treat 玉衡 as a cross-project wrapper: first route through /Users/yutu/.codex/skills/project-routes/INDEX.md and the matching project route. Simulaid and Starlaid routes are currently supported. 玉玲珑 invokes 玉衡 before delivery test gates."
---

# 玉衡

玉衡 is the user's test-maintenance and regression-coverage wrapper. The name means measuring, balancing, and calibrating: before a delivery proceeds, 玉衡 asks what the current changes could break and refreshes the matching tests.

Creating or updating this skill is developer-side workflow memory and does not bump any game version by itself.

## Cross-Project Route Guard

玉衡 is a global wrapper name, not a Simulaid-only concept. Before applying any project-specific workflow, read:

1. `/Users/yutu/.codex/skills/SKILL_ARCHITECTURE.md`
2. `/Users/yutu/.codex/skills/project-routes/INDEX.md`
3. The matching project route, for example `project-routes/Simulaid.md` or `project-routes/Starlaid.md`.

If the selected project route does not explicitly support 玉衡, stop and report that the test route is not configured. Do not borrow another project's test runner, paths, save rules, or version rules by analogy.

Concurrent-agent safety: reading this skill is safe. Running Unity/Tuanjie tests, editing shared tests, or changing source files requires the matching project lock, usually `<project>.unity-editor`; Git commits/pushes require `<project>.git-write`.

## Trigger Meaning

When invoked standalone, 玉衡 should:

1. Inspect the current user request, current diff, and changed-file themes.
2. Identify durable invariants that should be protected by tests.
3. Add or update focused automated regression tests when practical.
4. Update the project testing strategy / bug ledger when the invariant matters long term.
5. Run the project test gate if feasible.
6. Report what tests were added, what remained manual, and whether the gate passed.

When invoked by 玉玲珑, 玉衡 runs once after planned code/resource/refactor/save-compatibility work is complete and before platform delivery continues. If a required test obligation is unresolved or the test gate fails, 玉玲珑 must stop and report the blocker instead of building/uploading.

## Simulaid Route

Project root: `/Users/yutu/Simulaid`

Required reads before broad searches or edits:

1. `/Users/yutu/.codex/skills/simulaid-unity-maintenance/SKILL.md`
2. `/Users/yutu/Simulaid/CODE_INDEX.md`
3. `/Users/yutu/Simulaid/SIMULAID_TESTING_STRATEGY.md`
4. `/Users/yutu/Simulaid/GameAgentBenchmark.md`
5. `/Users/yutu/Simulaid/SIMULAID_BUG_REGRESSION_LOG.md`
6. `/Users/yutu/Simulaid/SIMULAID_UI_LAYOUT_REVIEW.md` when UI/layout/touch/visual text changed

Canonical automated test file:

`/Users/yutu/Simulaid/Packages/com.joesong.simulaid.tests/Editor/SimulaidTestRunner.cs`

Canonical test command:

```bash
/Applications/Tuanjie/Hub/Editor/2022.3.62t7/Tuanjie.app/Contents/MacOS/Tuanjie -batchmode -quit -projectPath /Users/yutu/Simulaid -executeMethod SimulaidTestRunner.RunAll -logFile /tmp/simulaid-tests.log
```

### Simulaid Workflow

1. Preserve unrelated user changes. Use short `git status --short` and `git diff --name-only` to understand the current batch.
2. Classify changed behavior into test areas: gameplay rules, card/item definitions, save compatibility, market/economy, combat, farm, simulation rewards, gift codes, progression, UI layout/text/touch, assets/resources, build metadata, or tooling.
3. For each meaningful behavior change, write a compact test obligation:
   - what invariant should never regress;
   - what old bug or player report it guards;
   - whether it can be automated in `SimulaidTestRunner.cs`.
4. For cross-system, repeated, mobile-only, visual/touch, save-compatibility, or performance regressions, add or reference a `GameAgentBenchmark.md` case. Capture observation state, legal actions, scoring, evidence paths, manual review, and rollback.
5. Add/update automated tests for deterministic rules, data registries, save/load/migration, math, formatting helpers, UI layout configuration, and lifecycle state transitions.
6. If a regression depends on visual perception, real mobile touch routing, external UI, Quark/App Store, or timing too brittle for automation, record a manual regression point in `GameAgentBenchmark.md`, `SIMULAID_TESTING_STRATEGY.md`, `SIMULAID_BUG_REGRESSION_LOG.md`, or `SIMULAID_UI_LAYOUT_REVIEW.md` instead of faking a fragile test.
7. For user-reported bugs, add or update a bug-ledger entry with the guardrail and test name.
8. Run the test command above when feasible. Inspect only concise failure lines and the test summary. Fix source code or stale tests until the gate passes, or report the exact blocker.
9. If 玉衡 itself changes only tests or developer docs, do not create a new player-facing game version entry. If fixing the source/runtime bug requires game-file changes, follow `simulaid-unity-maintenance` version discipline as part of the owning task.

### Simulaid Report Shape

Keep the report short:

- `测试刷新：新增/更新 ...`
- `覆盖风险：...`
- `未自动化项：...` or `未发现需要手动项`
- `测试结果：SimulaidTestRunner N/N 通过` or failed group names

## Starlaid Route

Project root: `/Users/yutu/Projects/Starlaid/Starlaid`

Use `/Users/yutu/.codex/skills/starlaid-test-maintenance/SKILL.md` as the project-specific implementation. 玉衡's responsibility is only to route, insist on test-obligation thinking, and ensure Starlaid source changes update `StarlaidTestSuite.cs` or the relevant manual QA docs before the Starlaid test runner is considered enough.

## Boundaries

- 玉衡 is a test-refresh gate, not a build, upload, art-generation, story-review, or release-copy skill.
- 玉衡 should not add broad, low-value tests merely to increase count. Each test must guard a real invariant or a plausible regression from the current diff.
- Prefer focused deterministic tests over full-scene UI automation unless the project already has a stable harness.
- Do not paste huge test logs into chat; summarize pass/fail and read targeted failure lines only.
