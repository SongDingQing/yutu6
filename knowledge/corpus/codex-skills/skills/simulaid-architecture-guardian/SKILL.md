---
name: simulaid-architecture-guardian
description: Use when the user asks to review or improve Simulaid architecture, investigate repeated/old bugs, explain prior Codex misjudgments, reduce codebase bloat, refresh CODE_INDEX/testing/bug ledgers, create durable safeguards, or make future Simulaid agents more reliable. Pair with simulaid-unity-maintenance and 玉衡 for source changes.
---

# Simulaid Architecture Guardian

This skill is the durable Simulaid workflow for architecture audits, repeated bug forensics, and future-agent reliability hardening. It turns player reports and Codex misjudgments into tests, ledgers, indexes, and small refactors instead of one-off fixes.

## First Reads

Project root: `/Users/yutu/Simulaid`

Before broad searches, read:

1. `/Users/yutu/.codex/skills/simulaid-unity-maintenance/SKILL.md`
2. `/Users/yutu/Simulaid/CODE_INDEX.md`
3. `/Users/yutu/Simulaid/SIMULAID_AGENT_DEVELOPMENT_WORKFLOW.md`
4. `/Users/yutu/Simulaid/SIMULAID_ARCHITECTURE_AUDIT.md`
5. `/Users/yutu/Simulaid/GameAgentBenchmark.md`
6. `/Users/yutu/Simulaid/SIMULAID_TESTING_STRATEGY.md`
7. `/Users/yutu/Simulaid/SIMULAID_BUG_REGRESSION_LOG.md`
8. `/Users/yutu/Simulaid/SIMULAID_OPTIMIZATION_NOTES.md`
9. `/Users/yutu/Simulaid/SIMULAID_UI_LAYOUT_REVIEW.md` when UI, touch, or visual text is involved

Optional research input:

- `/Users/yutu/Projects/agent-game-research-watch/reports/` for recent game-agent / Unity automation / skill architecture ideas. Use summaries and targeted `rg`; do not paste full reports into chat.

## Architecture Audit Command

Run this to detect index/test drift and source-size hotspots:

```sh
/Users/yutu/Simulaid/Tools/simulaid_architecture_audit.py --write /Users/yutu/Simulaid/Logs/simulaid-architecture-audit.md
```

The script is read-only. If it reports runner/strategy/index drift, fix the drift in the same turn or record a deliberate deferral in `SIMULAID_ARCHITECTURE_AUDIT.md`.

## Pre-Code Evidence Gate

Before editing Simulaid source, runtime resources, Unity import settings, build scripts, SDK integrations, or persistent agent/skill workflows, follow `/Users/yutu/Simulaid/SIMULAID_AGENT_DEVELOPMENT_WORKFLOW.md`:

1. Classify the task and risk.
2. Update or select the relevant architecture/test/UI/asset/save/benchmark evidence entry before source edits.
3. Record the invariant, validation command or manual acceptance, evidence path, and rollback point.
4. Only then make the minimal code/resource change.

Developer-only workflow or skill changes do not bump the Simulaid game version. If the same turn also changes player-facing runtime behavior, bump only for the player-facing change and keep version copy free of agent/process wording.

## Forensic Loop For Repeated Bugs

Before editing source for a repeated or old player bug, create a compact mental task card:

1. **Player symptom**: restate the exact page/system/timing in player language.
2. **Path map**: search all plausible paths, not just the nearest function. Check main-world vs simulation-world, UI vs rule vs save, old-save vs new-save, mobile vs editor.
3. **Invariant**: write one sentence that must never regress. If there is no invariant, do not edit yet.
4. **Evidence plan**: choose automated test, architecture audit, UI/manual ledger entry, screenshot/visual inspection, or build log evidence.
5. **Benchmark case**: for cross-system, repeated, mobile-only, visual/touch, save-compatibility, or performance issues, reference or add a `GameAgentBenchmark.md` case with observation state, legal actions, scoring, evidence, manual review, and rollback.
6. **Minimal patch**: prefer pure helper extraction or one bounded partial split. Avoid large mechanical file moves.
7. **Ledger update**: update `SIMULAID_TESTING_STRATEGY.md`, `SIMULAID_BUG_REGRESSION_LOG.md`, `SIMULAID_OPTIMIZATION_NOTES.md`, `GameAgentBenchmark.md`, and/or `CODE_INDEX.md` as appropriate.
8. **Version discipline**: runtime/player-facing source changes still follow `simulaid-unity-maintenance` version rules; developer-only skill/doc changes do not.

## Preferred Hardening Pattern

- Extract pure rules from giant UI partials into `Assets/Scripts/Simulaid/Runtime/SimulaidCoreRules.cs` or a small runtime helper before expanding reflection-heavy tests.
- Add focused tests in `/Users/yutu/Simulaid/Packages/com.joesong.simulaid.tests/Editor/SimulaidTestRunner.cs` or update the strategy matrix when automation is brittle.
- Keep `CODE_INDEX.md` synchronized when adding or moving files.
- Treat save/meta/profession/talent/market/gift-code/card-ID changes as old-save compatibility risks until tested.
- Treat UI drag, long-press, font, crop/portrait, and animation issues as visual/touch evidence problems; record manual checks instead of fragile coordinate tests.
- Treat AI-assisted Unity work as an auditable pipeline, not just code edits: planner/implementer/reviewer/tester notes, commands, failure reasons, artifacts, screenshots/recordings, and rollback points should be captured in project docs or `GameAgentBenchmark.md` when the change is high-risk.
- Do not expose future Unity MCP or semantic editor tools as broad write access until the corresponding benchmark case defines semantic query output, screenshot evidence, undo/rollback, and human review.
- Use `SIMULAID_OPTIMIZATION_NOTES.md` before performance/refactor passes. Do not repeat items marked `已验证`, `已拒绝`, or `禁止重复` without new evidence.

## What Caused Past Misjudgments

Future agents should explicitly guard against these failure modes:

- Fixing only the most visible path while ignoring parallel entry points.
- Adjusting UI layout without checking generated text length, font style, rich-text stripping, safe area, or mobile screen variants.
- Changing combat state without waiting for HP/log/animation feedback gates.
- Trusting current unlock/meta state when archive-local save facts should win.
- Letting player-facing rules live only inside private UI methods with reflection-only tests.
- Recording decisions only in chat instead of project docs, ledgers, scripts, or skills.

## Validation

For source/runtime changes, run 玉衡 and then:

```sh
/Applications/Tuanjie/Hub/Editor/2022.3.62t7/Tuanjie.app/Contents/MacOS/Tuanjie -batchmode -quit -projectPath /Users/yutu/Simulaid -executeMethod SimulaidTestRunner.RunAll -logFile /tmp/simulaid-tests.log
```

Keep outputs short: report changed files, added guardrails, audit result, and failing test names only.
