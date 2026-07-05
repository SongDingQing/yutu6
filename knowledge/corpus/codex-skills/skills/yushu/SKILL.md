---
name: yushu
description: "Use when the user says 玉鼠, 玉鼠上, 新增卡牌, 新增角色, 新增剧情, 新增丧尸, 新增道具, 新增防具, 新增武器, 新增同伴, 新增成就, 神话道具, 神话 Boss, 神话事件, or asks to design/standardize game content definitions and player-facing descriptions. Treat 玉鼠 as a cross-project content-definition steward: route through project-routes first, use 玉凤 for canon, 玉豚 for required art, 玉笛/audio tools for required sound, and 玉衡/test routes for regression coverage."
---

# 玉鼠

玉鼠 is the user's cross-project content-definition steward. It owns the first-pass design and implementation discipline for new cards, roles, story beats, enemies, items, equipment, companions, achievements, events, mythic chains, and player-facing copy standards.

玉鼠 is not an image backend, not an audio backend, not a story canon authority by itself, and not a final build lane. It coordinates the right project route and guards content definitions from becoming inconsistent, under-tested, or placeholder-driven.

## Cross-Project Route Guard

Before project-specific reads or edits, read:

1. `/Users/yutu/.codex/skills/SKILL_ARCHITECTURE.md`
2. `/Users/yutu/.codex/skills/project-routes/INDEX.md`
3. The matching project route, for example `project-routes/Simulaid.md` or `project-routes/Starlaid.md`.

The route file is authoritative for project root, supported wrappers, locks, first reads, and validation commands. If the route marks 玉鼠 unsupported, stop and report the missing route instead of borrowing another game's rules.

Concurrent-agent safety: reading 玉鼠 is safe. Writing shared source/docs/assets requires the matching route lock when the route says so. Do not wait on another agent's live report; use artifact paths, manifests, prompts, screenshots, or concise user reports.

Creating or updating this skill is developer-side workflow memory. It does not bump a game version by itself unless runtime assets, source code, or project docs also change.

## Project Routing

- **Simulaid**: use when the cwd is `/Users/yutu/Simulaid`, the user mentions Simulaid/模拟纪元/奖励卡/模拟世界/主世界/泰尔/黑莲/狗狗, or paths are under `/Users/yutu/Simulaid`.
- **Starlaid**: use when the cwd is `/Users/yutu/Projects/Starlaid/Starlaid`, the user mentions Starlaid/星桥/自动化工厂/殖民地/外星生物, or paths are under `/Users/yutu/Projects/Starlaid/Starlaid`.
- If project ownership is ambiguous, ask one short clarifying question before editing or generating.

## Simulaid Route

For Simulaid, required first reads:

1. `/Users/yutu/Simulaid/CODE_INDEX.md`
2. `/Users/yutu/.codex/skills/simulaid-unity-maintenance/SKILL.md`
3. `/Users/yutu/Simulaid/SIMULAID_TESTING_STRATEGY.md`
4. `/Users/yutu/Simulaid/SIMULAID_STORY_BIBLE.md`
5. `/Users/yutu/Simulaid/SIMULAID_IMAGE_GENERATION_REQUIREMENTS.md` when content needs art
6. `/Users/yutu/.codex/modules/yudi-simulaid-audio-tools` when content needs SFX/music/audio integration
7. The smallest relevant source files, usually:
   - `/Users/yutu/Simulaid/Assets/Scripts/Simulaid/Features/SimulaidGameUI.Definitions.cs`
   - `/Users/yutu/Simulaid/Assets/Scripts/Simulaid/Features/SimulaidGameUI.CollectionArchive.cs`
   - `/Users/yutu/Simulaid/Assets/Scripts/Simulaid/Features/SimulaidGameUI.SimulationWorld.cs`
   - `/Users/yutu/Simulaid/Assets/Scripts/Simulaid/Features/SimulaidGameUI.SimulationRewards.cs`
   - `/Users/yutu/Simulaid/Packages/com.joesong.simulaid.tests/Editor/SimulaidTestRunner.cs`

### Simulaid Content Workflow

1. Identify the content family: card, reward card, role/profession, enemy, boss, item, equipment, companion, achievement, story event, route/scenario, tutorial, audio cue, combat effect, buff/status, or setting text.
2. Check existing IDs, rarity rules, acquisition pools, save fields, archive display, battle behavior, shop/gacha behavior, tutorial impact, and unlock/achievement dependencies.
3. Run 玉凤 when the content touches story, character identity, faction/location, dog/Tail routes, artifacts, enemy identity, endings, events, achievements, or image prompts.
4. Run 玉豚 when the content needs any player-facing art. 玉鼠 must explicitly require **no placeholder final art** and must ensure the art family follows `/Users/yutu/Simulaid/SIMULAID_IMAGE_GENERATION_REQUIREMENTS.md`.
5. Use 玉笛/audio tooling when the content has a new player-facing sound, roar, hit, reveal, UI cue, music loop, or signature combat SFX. Save final audio under the project Resources audio path and keep a fallback in code only as backup, not as the sole finished asset when the user asked for sound.
6. Update definitions, archive copy, runtime behavior, rewards/pools, save migration, and tests together. Do not add only the visible card/item without its acquisition path, archive text, and regression coverage.
7. Use 玉衡/testing strategy for behavior, save compatibility, copy clarity, no-placeholder guards, and asset/audio existence checks.
8. Follow `simulaid-unity-maintenance` for version/docs sync when runtime files changed.

### Simulaid Complex Content Package Workflow

When the user asks 玉鼠 to add or revise a compound feature that spans multiple content families—especially a mythic chain such as a special Boss, mythic drop, companion, hatch/awakening event, achievement, audio cue, combat effect, and buff—玉鼠 must own the orchestration. The user should not need to list every supporting skill.

Use this sequence:

1. **Scope decomposition.** Build a checklist of every affected family:
   - acquisition source: scene/map, special Boss, ordinary Boss, drop probability, guaranteed drop, gacha/shop exclusions,
   - inventory item/equipment/card/reward-card definition,
   - companion or persistent state fields,
   - story event/cut-in and event timing,
   - achievement definition and reveal/progress rules,
   - battle behavior: damage, timing, target rules, VFX/UI indicators, turn order, death/victory edge cases,
   - Buff/status display: name, rarity, color/frame, hold-tip copy, hidden/visible behavior,
   - audio cue/SFX/music,
   - art assets for every runtime resource name,
   - save/load/migration/temporary-leave fields,
   - archive/bag/settlement/market/gacha/tutorial copy,
   - tests, docs, version entry, and public-spoiler safety.
2. **玉凤 canon gate.** Before writing prompts or final copy, ask 玉凤's rules through `SIMULAID_STORY_BIBLE.md`: define where the content belongs in the world, what must not appear in art/text, what emotion/tone it should carry, and whether hidden content should be public-facing or oblique.
3. **Definition contract.** Choose stable IDs, asset names, rarity, player-facing names, descriptions, acquisition restrictions, and save fields. Do not rename existing IDs without an explicit migration.
4. **玉豚 art gate.** For every visible runtime resource name, require final generated/accepted assets, not placeholders. Update `SIMULAID_IMAGE_GENERATION_REQUIREMENTS.md` or a source manifest when a new asset family is introduced. Validate dimensions, alpha/cutout expectations, and Resources paths.
5. **玉笛 audio gate.** For signature SFX/music, create or integrate a real audio asset and load it through the existing generated-audio pattern. Procedural fallback can remain in code, but finished content should have a project asset when audio is part of the request.
6. **Runtime integration.** Implement battle timing and UI in the correct subsystem. For companions or automatic effects, explicitly test edge cases: enemy killed before attack, Boss multiplier, main-world vs simulation-world scope, no-target cases, retreat/temporary-leave saves, and settlement timing.
7. **玉衡 test gate.** Add/update focused tests for data definitions, acquisition/settlement order, save compatibility, battle math/timing, UI-visible resource references, art/audio existence, and public-copy clarity. If visual or device behavior cannot be automated, document a manual benchmark/ledger entry instead of pretending it is covered.
8. **Docs/version hygiene.** Update `CODE_INDEX.md`, `SIMULAID_TESTING_STRATEGY.md`, story/art docs, source manifests, and version surfaces when runtime/player-facing files changed. Public version logs must avoid unrevealed spoilers; use broad wording like `后续内容`, `特殊线索`, or `隐藏内容` when needed.
9. **Final report.** Report the content package as a coherent system: what unlocks it, what assets/audio were created, what tests were added/run, and any blocked validation such as Tuanjie already open.

If any required lane is blocked—canon contradiction, no image backend, missing audio tooling, unclear save migration, or untestable dangerous edge case—stop and report the blocker instead of shipping a partial content package as complete.

### Simulaid Card Description Standard

All card descriptions and dynamic detail text should use the same vocabulary:

- Attribute names: use `力量`, `防御`, `敏捷`, `庇护`. Avoid old `攻击力` wording in player-facing copy unless describing legacy migration/debug data.
- Attribute scope must be explicit on every attribute-changing text surface: definition description, archive short effect, dynamic detail, battle log, reward-card text, and item-linked equipment text.
  - Battle-only ordinary stat change: `本场战斗力量 +1` / `本场战斗防御 +1` / `本场战斗敏捷 +1` / `本场战斗庇护 +1`.
  - Battle-only temporary stat change: `本场战斗临时力量 +1` / `本场战斗临时防御 +1` / `本场战斗临时敏捷 +1`.
  - Current simulation-run stat change: `本次模拟世界力量 +1` / `本次模拟世界敏捷 +1`.
  - Permanent cross-world reward: `主世界与模拟世界永久力量 +1`, or for reward cards `永久奖励：主世界与模拟世界战斗开局力量 +1`.
  - Equipment stat change: `装备期间力量 +1` / `装备期间防御 +1` / `装备期间敏捷 +1` / `装备期间庇护 +1`.
  - When one card changes multiple attributes, repeat the scope for each attribute instead of relying on comma inheritance: prefer `装备期间力量 +2；装备期间敏捷 -1` over `装备期间力量 +2、敏捷 -1`.
- Damage formulas:
  - additive damage: `伤害公式：基础值 + 力量。`
  - multiplier damage: `伤害公式：基础项 × 倍率。`
  - multi-hit damage: state each hit or segment, then any total/preview separately.
  - fixed damage: `固定伤害 N，不叠加力量。`
  - temporary chain effects: use `仅本次出牌链生效`.
  - battle-only effects: use `仅本场战斗生效`.
  - run-only effects: use `仅本次模拟世界生效`.
  - permanent cross-world effects: state `主世界与模拟世界永久...`.
- Enemy attack clarity: use `丧尸命中率` or `命中率下限`, not `受击概率`.
- Directional cards should say what can be targeted, what area is affected, and whether empty-cell targeting is allowed by current runtime behavior.
- Simulaid passive cards (`被动卡`) are use-and-destroy cards, not reusable actions. Every new passive card must have a stable special/buff identity, be recognized by `IsPassiveCard(card)`, route through `CardExhaustsOnUse(card)` after `PlaySimCard`, never enter `simDiscardPile`, include “使用后销毁，不进入弃牌堆” in player-facing copy, and update `Simulation_PassiveCardBuffRules` so both definition recognition and the direct hand/discard path are covered.
- Highlight important numbers, attributes, and scopes through existing project rich-text helpers when writing runtime copy, for example `CardAttributeName`, `CardEffectValue`, `CardPositiveValue`, `DamageValueText`, `SignedAttack`, `SignedConcealment`, and related helpers.
- Avoid redundant flavor where it hides rules. Flavor can remain in flavor fields, but rule fields must answer: cost, target, formula, duration/scope, acquisition/use restriction, and special failure condition.

### Simulaid New Content Checklist

For every new or changed content item, verify:

- ID is stable, unique, lower-risk for save migration, and not renamed without a migration.
- Rarity, color, archive row, detail popup, and acquisition pools agree.
- If art is needed, final art exists under the correct asset family and passes no-placeholder checks.
- If audio is needed, a real project audio asset exists or the user has explicitly accepted a fallback-only implementation.
- If story/lore is involved, 玉凤 verdict is `通过` or required fixes are applied.
- If behavior changes save data or unlock progression, migration and old-save tests are added.
- If card/equipment/enemy behavior changes combat, add or update a focused `SimulaidTestRunner` test.
- If a companion, automatic effect, turn-order effect, or Buff is involved, test timing, display, save/load persistence, and edge cases where the effect kills or disables enemies before their action.
- If UI copy changes, long descriptions are checked for mobile display risk and dynamic detail text is updated.
- If hidden achievements/gift codes are involved, public version logs must avoid spoilers.

## Starlaid Route

For Starlaid, use 玉鼠 as a content-definition steward for roles, resources, buildings, enemies, events, recipes, disasters, UI copy, and progression content.

Required first reads:

1. `/Users/yutu/.codex/modules/starlaid-unity-project/INDEX.md`
2. `/Users/yutu/.codex/skills/starlaid-game-development/SKILL.md`
3. `/Users/yutu/.codex/skills/starlaid-test-maintenance/SKILL.md`
4. `/Users/yutu/Projects/Starlaid/Starlaid/Docs/WorldAndSurvivalSetting.md`
5. Relevant art/content docs from `project-routes/Starlaid.md` when content needs images or setting checks.

Use 玉凤 for world-setting consistency and 玉豚/Starlaid image generation for final art. Do not borrow Simulaid rarity, card, or delivery assumptions unless a Starlaid route doc explicitly adopts them.

## Output Format

For content review/design tasks:

```md
## 玉鼠审视
Project: Simulaid / Starlaid
Verdict: 通过 / 需修改 / 阻塞
Scope: content families and files checked

### Findings
- ...

### Edits / Proposed edits
- ...

### Tests / Gates
- ...

### Follow-ups
- ...
```

For implementation tasks, keep the final user report short: changed content, changed files, tests run, and any blocked art/story dependency.

## Hard Stops

Stop and report a blocker instead of guessing when:

- The active project route does not support 玉鼠.
- A new player-facing art asset is required but no valid real generation backend is available and no accepted source art exists.
- The content contradicts hard canon and the user did not ask to rewrite canon.
- The change could corrupt saves and no migration/test path is clear.
- A hidden unlock, gift code, or spoiler would be exposed in public copy.
