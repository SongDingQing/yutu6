---
name: simulaid-command-expander
description: Use before any Simulaid / 模拟纪元 / /Users/yutu/Simulaid development, bug fix, balance, UI, story, card, Boss, art asset, build, package, test, release, architecture review, regression repair, or 玉猿 / 玉鼠 / 玉豚 / 玉凤 / 玉虎 / 玉衡 / 玉龙 / 黄龙 related task. Expands the user's terse, spoken, queue-like, screenshot-backed, or mixed Simulaid request into a complete executable working command with inferred intent, target files/systems, acceptance criteria, tests, version/build expectations, risks, rollback, and downstream skill routing before implementation.
metadata:
  short-description: Expand terse Simulaid tasks before execution
---

# Simulaid Command Expander（玉猿）

Use this as the first step for Simulaid work. Its job is to turn the user's short, spoken, queue-like, screenshot-backed, or multi-demand instruction into the richer command Codex should actually execute.

This skill does **not** replace `simulaid-unity-maintenance`, `玉鼠`, `玉豚`, `玉凤`, `玉虎`, `玉衡`, `玉龙`, `黄龙`, or other Simulaid specialist skills. It runs before them, then the task continues through the most specific downstream skill(s).

If `instruction-expansion-router` also triggers, this skill is the authoritative visible expander for Simulaid work. Produce only `Simulaid 指令补齐稿：`; do not also produce a generic `全局指令补齐稿`.

## Output Contract

Before code edits, asset edits, tests, builds, release work, or architecture planning, produce one concise Chinese block titled exactly `Simulaid 指令补齐稿：`. Treat that block as the real working command for the rest of the turn.

Shape:

```text
Simulaid 指令补齐稿：
请在 /Users/yutu/Simulaid ...（完整目标、推测意图、影响范围、可能触碰的系统/文件、验收标准、版本/测试/构建要求、风险、回归点、回滚点、需要调用的后续技能）
```

Do not stop after the block unless the user explicitly asked only for planning or copywriting. Continue implementation using the expanded command. Do not hold the user for confirmation when a conservative implementation path can be inferred.

## Expansion Workflow

1. Read the latest user message, immediately relevant prior turn context, and screenshots/attachments if provided.
2. Classify the task:
   - bug/regression/player report → route after expansion through `玉虎` and usually `玉衡`;
   - card/item/equipment/Boss/achievement/reward/role/balance/copy/content → route through `玉鼠`, plus `玉凤` if lore/story-sensitive and `玉豚` if art is needed;
   - UI/touch/layout/phone readability → include `simulaid-ui-regression-review` and matching interaction tests/manual checks;
   - image/audio/animation/runtime asset → include asset quality gates and Resources/importer checks; use `玉豚`/asset skills as needed;
   - tests/regression matrix → route through `玉衡`;
   - architecture/repeated bug/future-agent reliability → route through `simulaid-architecture-guardian`;
   - Android/package/update log delivery → route through `玉龙` or `黄龙` as requested;
   - iOS/combined delivery → route through `玉灵`/`玉玲珑` only when explicitly in scope.
3. Read durable context before broad search when execution will touch the project:
   - `/Users/yutu/Simulaid/CODE_INDEX.md`
   - `/Users/yutu/Simulaid/SIMULAID_AGENT_DEVELOPMENT_WORKFLOW.md`
   - `/Users/yutu/Simulaid/SIMULAID_TESTING_STRATEGY.md`
   - `/Users/yutu/Simulaid/SIMULAID_BUG_REGRESSION_LOG.md`
   - `/Users/yutu/Simulaid/SIMULAID_UI_LAYOUT_REVIEW.md`
   - `/Users/yutu/Simulaid/SIMULAID_SAVE_COMPATIBILITY_INDEX.md` when save/version semantics may change
   - `/Users/yutu/Simulaid/GameAgentBenchmark.md` for cross-system, repeated, UI/mobile, save, resource, or delivery risk
   - `/Users/yutu/Simulaid/SIMULAID_STORY_BIBLE.md` and `/Users/yutu/Simulaid/SIMULAID_IMAGE_GENERATION_REQUIREMENTS.md` for story/art work.
4. Expand the instruction with enough detail for another Codex session to execute without rereading the original chat:
   - complete target behavior and inferred product intent;
   - affected gameplay/UI/save/content/assets/build systems;
   - likely source/resource/docs/tests to inspect;
   - acceptance criteria from the player's point of view;
   - required tests, manual checks, screenshots, build/security/upload gates if relevant;
   - version bump, changelog, save-compatibility, benchmark, bug-ledger, or CODE_INDEX updates if relevant;
   - risks, regression points, and rollback path;
   - downstream skills to invoke after this expansion.
5. Preserve Simulaid operating constraints:
   - never revert/reset/delete uncommitted work unless the user explicitly orders it;
   - use `rg`/project indexes before broad file reads;
   - keep tool output short; do not paste huge logs, base64, image data, encrypted caches, or large JSON;
   - before runtime/source/resource/build changes, follow the pre-code evidence gate in `SIMULAID_AGENT_DEVELOPMENT_WORKFLOW.md`;
   - player-facing runtime/source/resource changes normally require version metadata and player-safe changelog updates; skill/docs-only work does not;
   - source/runtime/UI/save/content changes should add or update matching tests in the same turn when feasible;
   - use route locks from `/Users/yutu/.codex/skills/project-routes/Simulaid.md` for Tuanjie, builds, Quark upload, image assets, iOS, or Git writes.
6. If critical information is missing and cannot be safely inferred, ask one short question. Critical means destructive deletion, credentials/secrets, paid/irreversible external action, ambiguous public release target, or two materially conflicting product rules. Otherwise make a conservative assumption and proceed.

## Quality Bar For The Expanded Command

The expanded command should be compact but actionable. It should mention:

- what the user wants in plain Simulaid terms;
- what Codex infers from context and what assumptions it will use;
- where to look first and which skill(s) to continue with;
- what proves success, including tests/manual checks/build gates;
- how old saves, UI interaction, assets, hidden content, and player-facing copy should be protected when relevant;
- what to update for future agents so the fix or feature is findable later.

Avoid long essays. The block is a working command, not a separate plan document.
