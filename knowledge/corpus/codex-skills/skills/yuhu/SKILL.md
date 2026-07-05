---
name: yuhu
description: Use when the user says 玉虎, 玉虎上, asks Codex to fix a bug, repair a regression, investigate a player-reported issue, or audit whether a bug fix has a proven root cause. Enforces root-cause evidence, minimal scoped fixes, regression tests, and rollback notes before reporting a bug as fixed; especially required for Simulaid bug-fix work.
---

# 玉虎

玉虎 is the bug-fix root-cause guardian. Use it before changing code for any bug, regression, player report, or suspicious behavior.

The rule is simple: **do not ship a bug fix whose cause is still vague, and do not assume every player report is a bug.** Avoid "I do not know why, but this probably works" and avoid "this may not be ideal, but I will try it first". If the root cause is not proven, keep investigating or report the blocker instead of presenting a speculative patch as a fix.

## Bug-or-Not Intake

Treat player reports as clues, not verdicts. Before editing, classify the report:

- **Confirmed bug/regression**: observed behavior contradicts current rules, code contracts, tests, release notes, or a recent explicit user decision.
- **Intended behavior with unclear communication**: the system works as designed, but UI text, tutorial copy, feedback, or affordance may be misleading. Do not change gameplay unless the user asks; propose/patch copy or feedback only if it is the smallest correct fix.
- **Player misconception / missing context**: evidence shows the report comes from an understandable misunderstanding. Report the evidence and suggested explanation; do not modify code just to satisfy the misconception.
- **Product/design conflict**: old and new instructions conflict. Prefer the latest explicit user/product instruction when the scope is local and safe. If the conflict is broad, high-risk, or would invalidate prior design, stop before coding and ask the user for confirmation; when a Feishu/Hermes confirmation route is available for the project, use that route, otherwise ask one concise question in chat.
- **Insufficient evidence**: the owning path or expected rule is unclear. Investigate more or report a blocker rather than guessing.

When reporting a non-bug, still provide a `玉虎审计` with `判定`, evidence, and the no-code-change decision. A correct "this is not a bug" judgment is a successful 玉虎 outcome.

## First Reads

1. Identify the active project from the user's path, current working directory, or mentioned files.
2. For `/Users/yutu/Simulaid`, read these before broad search when relevant:
   - `/Users/yutu/Simulaid/CODE_INDEX.md`
   - `/Users/yutu/Simulaid/SIMULAID_BUG_REGRESSION_LOG.md`
   - `/Users/yutu/Simulaid/SIMULAID_TESTING_STRATEGY.md`
   - `/Users/yutu/Simulaid/GameAgentBenchmark.md`
   - `/Users/yutu/Simulaid/SIMULAID_UI_LAYOUT_REVIEW.md` for UI/touch/layout/rendering bugs
   - `/Users/yutu/Simulaid/SIMULAID_SAVE_COMPATIBILITY_INDEX.md` for save/load/version/migration bugs
   - `/Users/yutu/.codex/skills/simulaid-architecture-guardian/SKILL.md` for repeated bugs, old regressions, or architecture drift
   - `/Users/yutu/.codex/skills/yuheng/SKILL.md` when tests need to be added or refreshed
3. For another project, read that project's route/index docs first if they exist; otherwise inspect the repo's own README/test/docs before editing.

## Root-Cause Workflow

1. **Restate the bug precisely.** Include observed symptom, expected behavior, affected version/context, and any player clue.
1.5. **Decide whether it is actually a bug.** Compare the report against current docs, code, tests, version notes, and the most recent user/product instruction. If it is intended behavior or a misconception, stop with evidence unless a small copy/feedback fix is clearly warranted.
2. **Find the owning code path.** Use `rg` first. Trace from UI/input/event/save/render entrypoint to runtime rule/helper/state mutation. Do not patch a nearby-looking method until ownership is clear.
3. **Prove the failing mechanism.** Collect at least one concrete evidence type:
   - contradictory code path or condition,
   - reproduction path,
   - test failure or missing edge case,
   - log/assertion/screenshot/manual observation,
   - git history showing when behavior changed.
4. **Name the root cause in one sentence before editing.** Format:
   - `Root cause: <specific state/branch/order/contract> caused <specific symptom> because <mechanism>.`
5. **Choose the smallest correct fix.** Prefer fixing the source contract/rule/helper over adding UI-only masks, timing hacks, broad null checks, or duplicated special cases.
6. **Add a guard.** Update or add the nearest automated test. If the behavior is visual/mobile-only and cannot be automated, add a manual acceptance item to the project UI/test ledger and explain why automation is not enough.
7. **Check neighboring risks.** Ask: "Could another card/role/item/screen/save path have the same bug class?" Search for similar patterns and either fix the shared helper or document why they are safe.
8. **Document the regression.** For Simulaid, update `SIMULAID_BUG_REGRESSION_LOG.md` and, when relevant, `SIMULAID_TESTING_STRATEGY.md`, `GameAgentBenchmark.md`, `SIMULAID_UI_LAYOUT_REVIEW.md`, or `CODE_INDEX.md`.
9. **Validate.** Run the smallest relevant test first, then broader gates based on risk. For Simulaid runtime changes, prefer `SimulaidTestRunner.RunAll` before delivery.
10. **Keep a rollback point.** Use a patch file, commit, or clear diff summary so the fix can be reverted without losing unrelated work.

## Stop Conditions

Stop and report a blocker instead of claiming the bug is fixed when:

- the suspected code path cannot be connected to the symptom;
- evidence shows the report is intended behavior, player misconception, or a product-rule conflict that needs user confirmation;
- the fix only hides the symptom without explaining the cause;
- validation cannot run and no manual guard is possible;
- the change risks save corruption, player data loss, platform delivery failure, or broad UI breakage without a rollback plan;
- the user asked for a hotfix but the evidence points to a different subsystem than initially assumed.

Diagnostic logging, screenshots, tiny probes, or tests are allowed while investigating. Treat them as investigation artifacts, not the final fix, and remove temporary probes before delivery unless they are intentionally kept as safe diagnostics.

## Required Bug-Fix Report

When reporting a fix, include these concise fields:

```text
玉虎审计：
- 现象：
- 判定：
- 根因：
- 修改：
- 护栏：
- 验证：
- 回滚点：
- 剩余风险：
```

If no code was changed, still report `根因` and `证据/下一步` rather than giving a confident fix claim.
