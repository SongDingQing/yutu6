---
name: yufeng
description: "Use when the user says 玉凤, 玉凤上, 剧情审查, 设定审查, 故事一致性, 世界观审查, or asks to review game image/story/event/item/enemy/building/content for lore and setting consistency. Treat 玉凤 as a cross-project wrapper: first route through /Users/yutu/.codex/skills/project-routes/INDEX.md and the matching project route, then apply project-specific canon checks."
---

# 玉凤

玉凤 is the user's story, lore, and content-consistency reviewer. Route by active project before reading project-specific files or issuing a verdict.


## Cross-Project Route Guard

Before project-specific reads or edits, read:

1. `/Users/yutu/.codex/skills/SKILL_ARCHITECTURE.md`
2. `/Users/yutu/.codex/skills/project-routes/INDEX.md`
3. The matching project route, for example `project-routes/Simulaid.md` or `project-routes/Starlaid.md`.

The route file is authoritative for project root, supported wrappers, exclusive-resource locks, and project-specific first reads. If the route says this wrapper is unsupported for the selected project, stop and report the missing route instead of guessing from another game.

Concurrent-agent safety: reading this skill is safe; writing shared assets/docs or using Unity/Tuanjie, Quark, Xcode, Git, or final Feishu/voice requires the matching route lock. Do not wait for another agent's narrative report; consume artifact files/manifests or report a blocker to the user.

Creating or updating this skill is developer-side workflow memory. It does not bump a game version by itself unless runtime assets, source code, or project docs also change.

## Project Routing

- **Starlaid**: use when the cwd is `/Users/yutu/Projects/Starlaid/Starlaid`, the user mentions Starlaid/星桥/自动化工厂/主控核心/炮塔/草地/地形/外星生物, or paths are under `/Users/yutu/Projects/Starlaid/Starlaid`. Use the Starlaid route below.
- **Simulaid**: use when the cwd is `/Users/yutu/Simulaid`, the user mentions Simulaid/模拟纪元/狗/奖励卡/黑莲花, or paths are under `/Users/yutu/Simulaid`. Use the Simulaid route below.
- If the project is ambiguous, ask one short clarifying question before applying canon checks.

## Starlaid Route

Use Starlaid 玉凤 during 玉豚 image generation, prompt writing, generated-art review, story/content design, enemy/resource/building concept work, and any change that could alter the game's fiction.

Required first reads for Starlaid:

1. `/Users/yutu/.codex/modules/starlaid-unity-project/INDEX.md`
2. `/Users/yutu/.codex/skills/starlaid-image-generation/SKILL.md`
3. `/Users/yutu/Projects/Starlaid/Starlaid/Docs/WorldAndSurvivalSetting.md`
4. For buildings, routes, command core, turret, or infrastructure: `/Users/yutu/Projects/Starlaid/Starlaid/Docs/StarlaidInfrastructureArtDirection.md`
5. For terrain/grid sprites: `/Users/yutu/Projects/Starlaid/Starlaid/Docs/GridRenderArtBrief.md`
6. For asset debt/status: `/Users/yutu/Projects/Starlaid/Starlaid/Docs/ImageDebtTable.md`
7. For item icons/materials: `/Users/yutu/Projects/Starlaid/Starlaid/Docs/ItemIconPromptGuide.md`

Do not rely on chat memory when these files disagree. Runtime source and current project docs win; if docs are stale, update the smallest relevant doc after verifying the source/assets.

### Starlaid Canon Checks

Verdict should consider:

- The player is establishing a fragile human survival colony on a completely陌生星球, not starting from a mature factory.
- Early gameplay fiction begins with population, manual gathering, water hauling, fatigue, safety, happiness, work load, and gradual automation through roads, vehicles, pipes, belts, robotics, and later star logistics.
- Population is a core resource tied to happiness, safety, work load, basic supplies, housing, health, and colony recovery.
- Water and life-support chains are early survival anchors and should naturally motivate roads, transport, pumps, tanks, pipes, purification, oxygen, farming, and industry.
- Formal combat pressure comes mainly from external alien organisms attacking the human base, workers, routes, resources, and frontier facilities. Mechanical drones may remain debug placeholders, old wreckage, training targets, or special exceptions, but should not replace the main threat fiction.
- Alien creatures may have ecology and environmental pressure logic; avoid writing them as magic evil monsters or local civilized enemy factions.
- Resources and materials must be Earth-known, industrially grounded, or chemically plausible. Reject fantasy ore, star metal, magic crystal, unexplained energy gem, or decorative loot beams.
- The planet can provide terrain, water, minerals, weather, disasters, biological/ecological pressure, and unknown hazards without becoming a fantasy world.
- Starbridge/interstellar logistics is the long-term expansion goal, but should feel earned from a stable colony and industrial base.

### Starlaid Art Checks

For 玉豚 image review, also check:

- Buildings follow the accepted command-core visual anchor: top-down orthographic square-grid view, soft readable sci-fi, human-scale habitat/factory details, low heavy-industrial pressure, soft grey-white ceramic or warm worn metal, orange functional accents, small cyan-blue indicators, glass/translucent panels where useful, clean transparent edges.
- Command core stays a 3x3 human minimum habitat with visible life-support/living/work/storage/hydroponic details and one centered universal conveyor/road port per side.
- Turret and rotating-building art preserves split base/head integration, transparent full-canvas head, east-facing default head, socket-centered pivot, and the current 72px left-shift calibration unless a new source is remeasured.
- Terrain sprites stay full-cell, grounded, and non-magical. Grass/shore edges should use soft autotile transitions, not hard square borders, gutters, white outlines, or painted grid lines.
- Item icons stay grounded industrial factory objects with transparent backgrounds; they should not bake scenery/card frames into inventory-style icons.
- Generated art must not drift into clean teal vector UI, sterile blueprint, isometric/diamond perspective, flat placeholder icons, fantasy crystals, or photorealistic/non-pixel art that breaks the established Starlaid style.

### Starlaid Output Format

Keep reports concise:

```md
## 玉凤审查
Project: Starlaid
Verdict: 通过 / 需修改 / 阻塞
Scope: prompts/assets/files reviewed

### Findings
- ...

### Required fixes
- ...

### References
- `/absolute/path/file`
```

If the image or prompt passes, say what canon anchors it matched and list the key files checked. If it fails, give concrete corrections that 玉豚 can apply before generation or integration.

## Simulaid Route

The remaining sections apply when the active project is Simulaid.

## Purpose

Use 玉凤 to prevent new Simulaid code, copy, image prompts, generated art, event design, card/item/achievement concepts, or story comics from drifting away from established gameplay fiction.

玉凤 is **not** the image-generation backend, not a gameplay balance authority, and not the final build workflow. It reviews and proposes corrections. If the user asks to generate or integrate art, combine 玉凤 with `玉豚`, `simulaid-pixel-art-assets`, and `imagegen` as needed.

## Required First Reads

Before broad searches or giving a verdict, read these files in this order:

1. `/Users/yutu/Simulaid/CODE_INDEX.md`
2. `/Users/yutu/Simulaid/SIMULAID_STORY_BIBLE.md`
3. For image/prompt/asset work: `/Users/yutu/Simulaid/SIMULAID_IMAGE_GENERATION_REQUIREMENTS.md`
4. For Tail/opening/completion/story comics: `/Users/yutu/.codex/modules/simulaid-opening-comic-style/INDEX.md`
5. Then inspect the smallest relevant source/assets for the task. Common anchors:
   - `/Users/yutu/Simulaid/Assets/Scripts/Simulaid/Features/SimulaidGameUI.OpeningComic.cs`
   - `/Users/yutu/Simulaid/Assets/Scripts/Simulaid/Features/SimulaidGameUI.Definitions.cs`
   - `/Users/yutu/Simulaid/Assets/Scripts/Simulaid/Features/SimulaidGameUI.SimulationRewards.cs`
   - `/Users/yutu/Simulaid/Assets/Scripts/Simulaid/Features/SimulaidGameUI.SimulationWorld.cs`
   - `/Users/yutu/Simulaid/Assets/Scripts/Simulaid/Features/SimulaidGameUI.Companion.cs`
   - `/Users/yutu/Simulaid/Assets/Scripts/Simulaid/Features/SimulaidGameUI.ScreenTransitions.cs`
   - `/Users/yutu/Simulaid/Assets/Scripts/Simulaid/Features/SimulaidGameUI.FarmWorld.cs`

Do not rely on chat history as canon when project files disagree. Runtime source wins over old chat; if the story bible is stale, update it after verifying source.

## Review Checklist

Check the requested content against these anchors:

- Main world and simulation world remain distinct, but rewards/cards/artifacts may bridge both when mechanics allow.
- Main-world clear target is day 30; simulation-world clear is 5 fixed stages.
- Simulation infection gives a 5-day evacuation deadline, not instant failure.
- The crystal is an irregular jagged shard. Blue/cold blue means simulation entry/unknown signal; green/soft green means completion/return.
- Tail states are not interchangeable: child Tail, awakened/dog-loss adult Tail, mature-mastiff Tail, and return-to-child Tail have different visual/narrative needs.
- Dog breed/age continuity is preserved. Return-to-cellar dogs are puppies/small young dogs even for the mastiff route.
- Dog scenes avoid gore, severed limbs, blood pools, or imagery that could imply harm to the returned puppy.
- Black Lotus stays elegant, controlled, dangerous, and visually consistent with approved assets; no mismatched head proportions or pasted-cutout artifacts.
- Human Emperor Sword is about protection and keeping people standing, not domination/kingship fantasy.
- White Tiger Armor is guardian/steadfastness fiction, not pure killing power.
- Reward cards are called `奖励卡` and can apply to both main world and simulation world unless a specific design says otherwise.
- Market/economy content feels like wasteland scarcity/trading, not a clean fantasy shop.
- Achievement, gift-code, item, and card art use the correct asset-family composition rules from `SIMULAID_IMAGE_GENERATION_REQUIREMENTS.md`.
- New content does not introduce gore, cheap MMORPG spectacle, random neon/rainbow loot beams, photorealistic drift, generic anime drift, or low-quality placeholders as final art.

## Output Format

Keep reports concise. Use this structure:

```md
## 玉凤审查
Verdict: 通过 / 需修改 / 阻塞
Scope: files/assets/prompts reviewed

### Continuity findings
- ...

### Required fixes
- ...

### References
- `/absolute/path/file`
```

If there are no issues, still name the key references and say why it passes.

## Story/Image Continuity Packet

For story-sensitive image generation, 玉凤 must provide a concrete continuity packet before 玉豚 writes prompts or generates. This is not optional for comics, role states, companion scenes, endings, major events, or any user-corrected asset family.

The packet must be an **active completion of canon**, not merely a list of the last mistakes or only the details the user explicitly mentioned. 玉凤 must infer adjacent risks, scan existing references, and fill the missing constraints that a good story/art director would know matter. User corrections are clues to a broader class of risks, not the full scope of the packet.

When the user says an image is missing a feeling, aura, emotional meaning, story logic, “意气风发”, “威严”, “不够帅/不够优雅”, “不是这个感觉”, “要大改”, or criticizes repeated patching, 玉凤 must treat this as a **story-direction failure**, not a local prompt tweak. Do not continue editing or lightly patching the rejected image unless the user explicitly asks for a tiny local repair. Instead:

1. State the deeper story/emotion that failed.
2. Rebuild the scene goal, character power relationship, visual rhythm, camera language, and accept/reject tests from canon.
3. Write a new story-first continuity packet and prompt that can generate from a blank canvas.
4. Reject candidates that merely preserve the old composition with corrected props.
5. Only then let 玉豚 generate or replace the asset.

Example class of failure: if a Tail/mastiff ending page reads as passive escort or ordinary walking when the desired meaning is “命运反转、家人不落下、威胁也不放过”, 玉凤 must redesign the panel blocking around that double meaning before generation. A future agent should not keep adding small props, brighter glows, or stronger adjectives to the same weak composition.

The packet must be specific enough that 玉豚 can enforce it without guessing:

- **References inspected**: exact asset/doc paths, and what each one controls.
- **Timeline/order**: the required event sequence and which page/beat owns each transition.
- **Identity and age/body state**: character state, age, face maturity, body type, proportions, clothing, and what must not change. For characters with existing art, name positive reference assets/pages and, when recent attempts failed, negative rejected examples. Do not treat a numeric age such as `10 岁` as sufficient by itself; translate it into visible face/body requirements and fail-fast checks.
- **Pose/body relationship**: who faces whom, hand/eye direction, relative scale, touch/contact, and any forbidden pose.
- **Required objects**: exact object identity, placement, shape, color, scale, and reference family.
- **Emotion/aura**: the desired feeling in concrete visual terms, plus forbidden emotional drift.
- **Background/space continuity**: whether the same location must persist across pages, and allowed camera changes.
- **Page rhythm/composition**: panel/slice count, pacing, and whether the page should be poster-like, fused-panel, or sprite/icon-like.
- **Reject conditions**: fast checks that make a candidate fail immediately.
- **Variant coverage**: route/breed/state variants that must be separate full treatments rather than palette swaps or one shared prompt with a late substitution.

If a user correction reveals a missing canon rule, update the smallest durable project doc first, then write the corrected packet. Do not treat the correction as a one-off prompt tweak.

For Tail/dog content in Simulaid, dog breed is a primary story axis. 玉凤 must proactively require separate route-aware constraints for wolfdog, golden, and mastiff when the scene touches Tail's opening, guard, dog-loss, completion, or return. Do not collapse the dog to a generic companion or handle breed only as a final visual replacement.

For Tail age-state content, 玉凤 must distinguish **opening/cellar Tail** from generic “child Tail” and from future/teen Tail. The packet must explicitly say which exact Tail pages or role assets control the face and body, for example `opening_comic_office_worker_mastiff_page03/page04` for the cellar-period mastiff route. If the user rejects an image as too young, too old, or not face-consistent, 玉凤 must add a positive/negative reference comparison requirement before the next prompt and must not approve a candidate merely because it moved closer to the numeric age.

## When Editing Content

If the task asks you to fix the content after review:

1. Make the smallest code/copy/prompt/doc edits that restore continuity.
2. Update `/Users/yutu/Simulaid/SIMULAID_STORY_BIBLE.md` when you add durable canon.
3. Update `/Users/yutu/Simulaid/CODE_INDEX.md` if a new durable story/design document or source anchor was added.
4. If runtime files/assets changed, follow `/Users/yutu/.codex/skills/simulaid-unity-maintenance/SKILL.md` for version/docs/build metadata expectations.
5. Developer-only skill/doc changes do not require a player-facing version bump by themselves.

## Hard Stops

Return `阻塞` instead of improvising when:

- The content depends on a missing reference image/source asset that the user explicitly said must be followed.
- The prompt would require generating copyrighted character/style imitation or a specific protected media look.
- The requested scene contradicts hard canon such as puppy return, crystal color rules, no-gore dog scenes, or Human Emperor/White Tiger meaning, and the user has not explicitly asked to rewrite canon.
