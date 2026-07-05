---
name: yutun
description: "Use when the user says 玉豚, 玉豚上, 生图, 重做图, 补图, 还图像债, or asks to generate/regenerate/repair high-quality game art. Treat 玉豚 as a cross-project wrapper: first route through /Users/yutu/.codex/skills/project-routes/INDEX.md and the matching project route, then use the project art/story/image pipeline such as Simulaid or Starlaid."
---

# 玉豚

This is the user's short-name entry point for game image generation, image replacement, and image-debt repayment. Route by the active project before reading project-specific files or making art decisions.

## Cross-Project Route Guard

Before project-specific reads or edits, read:

1. `/Users/yutu/.codex/skills/SKILL_ARCHITECTURE.md`
2. `/Users/yutu/.codex/skills/project-routes/INDEX.md`
3. The matching project route, for example `project-routes/Simulaid.md` or `project-routes/Starlaid.md`.

The route file is authoritative for project root, supported wrappers, exclusive-resource locks, and project-specific first reads. If the route says this wrapper is unsupported for the selected project, stop and report the missing route instead of guessing from another game.

Concurrent-agent safety: reading this skill is safe; writing shared assets/docs or using Unity/Tuanjie, Quark, Xcode, Git, or final Feishu/voice requires the matching route lock. Do not wait for another agent's narrative report; consume artifact files/manifests or report a blocker to the user.

## Global Quality Floor

玉豚 must never create, present, integrate, or call complete any low-quality image in any project. This is a global user preference, not a Starlaid-only or conveyor-only rule.

Every image 玉豚 creates or replaces must use a high-quality image-generation or image-editing source as its visual base. This applies to player-facing art, candidate art, source material presented for approval, replacement assets, repair attempts, route art, terrain, icons, characters, enemies, buildings, effects, and review sheets across all projects. User-provided or previously accepted high-quality source art may be used as a reference or compositing base, but 玉豚 must not substitute low-quality local drawing for actual high-quality generation.

Do not replace rejected or mismatched generated art with primitive local/procedural redraws made from simple rectangles, circles, strokes, gradients, flat fills, or noise. Do not create "temporary" low-quality candidates for visual approval unless the user explicitly asks for a debug placeholder. Scripts may crop, split layers, remove backgrounds, clean alpha, defringe, align pivots, lock animation phase, assemble review sheets, and integrate assets into a game project, but they must not become the visual source for any detailed image. If a script overlay is needed for technical consistency, it must preserve the high-quality source art and stay subtle; if the overlay makes the asset look low-quality, reject the attempt and regenerate or image-edit instead.

For newly added player-facing assets, especially cards, enemies, equipment, achievements, and story/event illustrations, "accepted source art plus large hand-authored/procedural effects" is not automatically final art. It is only acceptable for small cleanup, framing, alpha, defringe, or identity-preserving adjustment. If the main readable content of a new asset is a collage of old assets, procedural motion lines, programmatic halos, shape overlays, or manually assembled impact marks, treat it as a temporary composite unless the user explicitly approved that exact visual direction. When the user calls such an asset placeholder-like, 玉豚 must replace it with a fresh real image-generation source and record the composite as the failure cause.

When no real image-generation backend is available, stop the replacement as blocked rather than fabricating a low-quality substitute. Debug placeholders are allowed only when explicitly labeled and must not be described as final, accepted, production-ready, or debt-paid.

Before accepting any output, inspect it at close zoom against the relevant project anchor. Reject it if it looks low-quality for any reason: procedural mockup, flat UI icon, low-detail shape stack, matte/checkerboard artifact, poor generation, weak detail density, or obvious downgrade from the project's accepted art.


## Project Routing

- **Starlaid**: use this route when the cwd is `/Users/yutu/Projects/Starlaid/Starlaid`, the user mentions Starlaid/星桥/自动化工厂/主控核心/炮塔/草地/地形, or target paths are under `/Users/yutu/Projects/Starlaid/Starlaid`. Read the Starlaid route below and do not use Simulaid story/art rules.
- **Simulaid**: use this route when the cwd is `/Users/yutu/Simulaid`, the user mentions Simulaid/模拟纪元/狗/奖励卡/黑莲花, or target paths are under `/Users/yutu/Simulaid`. Keep the existing Simulaid route below.
- If both projects are mentioned, ask which project owns the target assets before generation or replacement.

## Starlaid Route

Starlaid 玉豚 wraps Starlaid image generation, asset cleanup, candidate sheets, Unity/Tuanjie integration, and durable prompt/style memory.

Required first reads for Starlaid image work:

1. `/Users/yutu/.codex/modules/starlaid-unity-project/INDEX.md`
2. `/Users/yutu/.codex/skills/starlaid-unity-maintenance/SKILL.md`
3. `/Users/yutu/.codex/skills/starlaid-image-generation/SKILL.md`
4. `/Users/yutu/.codex/skills/yufeng/SKILL.md`
5. `/Users/yutu/Projects/Starlaid/Starlaid/Docs/WorldAndSurvivalSetting.md`
6. The relevant art doc:
   - buildings/infrastructure: `/Users/yutu/Projects/Starlaid/Starlaid/Docs/StarlaidInfrastructureArtDirection.md`
   - grid/terrain handoff: `/Users/yutu/Projects/Starlaid/Starlaid/Docs/GridRenderArtBrief.md`
   - asset debt table: `/Users/yutu/Projects/Starlaid/Starlaid/Docs/ImageDebtTable.md`
   - item icons: `/Users/yutu/Projects/Starlaid/Starlaid/Docs/ItemIconPromptGuide.md`

Apply 玉凤 before prompt writing and again before accepting final art. It must check that prompts/assets fit Starlaid's survival-colony story, grounded material rules, and external-alien threat setting.

Starlaid hard quality gates:

- Final Starlaid art must come from image generation, user-provided/accepted detailed art, or careful compositing from accepted Starlaid source art. Procedural shapes/noise may be used for debug placeholders, masks, cleanup, slicing, previews, or terrain compositing from accepted material sources, but not as a substitute for final building/enemy/item art.
- Preserve native detail. Do not downsample new grid art to 64x64 or item icons to 32x32; runtime sprites can be 512px+ and Unity fits them into cells.
- Mineral/material art must stay Earth-known, industrially grounded, or chemically plausible. No fantasy ore, magic crystal, or unexplained energy gem.
- Formal runtime sprites live under `/Users/yutu/Projects/Starlaid/Starlaid/Assets/Starlaid/Art/Sprites/...`; placeholder fallbacks under `/Users/yutu/Projects/Starlaid/Starlaid/Assets/Starlaid/Art/Placeholders/...` are synchronized only after the formal image is accepted.

Preserved Starlaid visual anchors:

- Command core: `/Users/yutu/Projects/Starlaid/Starlaid/Assets/Starlaid/Art/Sprites/Grid/building_command_core.png`
- Turret base/head/composite:
  - `/Users/yutu/Projects/Starlaid/Starlaid/Assets/Starlaid/Art/Sprites/Grid/building_basic_turret_base.png`
  - `/Users/yutu/Projects/Starlaid/Starlaid/Assets/Starlaid/Art/Sprites/Grid/building_basic_turret_head.png`
  - `/Users/yutu/Projects/Starlaid/Starlaid/Assets/Starlaid/Art/Sprites/Grid/building_basic_turret.png`
- Turret source/review archive: `/Users/yutu/Projects/Starlaid/Starlaid/Docs/StarlaidTurretImageGenSplit`

Command core requirements to preserve for future same-family buildings:

- top-down orthographic square-grid view;
- 3x3 human minimum habitat, not a heavy industrial block;
- glass roof with visible compact life-support, beds, work/living surfaces, storage, hygiene modules, and hydroponics;
- soft grey-white ceramic or warm worn-metal panels, orange functional accents, small cyan-blue indicators, dark inset seams, chunky bevels, subtle hand-painted surface noise;
- one centered universal conveyor/road port on each side;
- clean transparent edge, no white matte, no contact-sheet residue, no text/watermark, no isometric angle, no 64px downsampling;
- opaque footprint should stay roughly 90%+ of the 2048 canvas so it reads large enough in a 3x3 footprint.

Turret/rotating-building requirements to preserve:

- fixed `*_base` and transparent full-canvas `*_head` layers, plus optional composite preview;
- head default faces east/right and rotates around the canvas center at runtime;
- for long barrels, center by the rear/body mounting socket rather than the full barrel bounds;
- preserve the current `0.1.16.7` turret head visual calibration: the imagegen split apply script shifts the head layer 72px left after socket centering unless a new source is remeasured;
- future rotating buildings may use a combined candidate sheet for selection, but game integration must use independent square base/head panels.

Terrain repair guidance:

- Terrain can be full-cell and opaque, but must avoid drawn borders, gutters, white outlines, or contact-sheet residue.
- Grass/ground edges next to water should feather through the 15-mask `terrain_shore_transition_*` family rather than using hard rectangular strips.
- If shorelines look abrupt, tune `Tools/Art/generate_rounded_terrain_tiles.py` so the water cell owns the strong silhouette and the grass cell owns only a soft, low-contrast wet bank. Keep non-water tile edges close to the base `terrain_ground` material.

Starlaid workflow:

1. Identify target IDs, dimensions, transparency, current runtime references, and whether this is final art or a candidate batch.
2. Run 玉凤 story-setting review on the prompt/asset direction before generation.
3. Use real image generation for new final buildings/enemies/items, or accepted source-art compositing for terrain/cleanup tasks where the source materials are already accepted.
4. Inspect visually before integration; reject flat icons, low-detail shape stacks, fantasy materials, heavy industrial drift, teal vector UI drift, white matte/fringe, or wrong perspective.
5. Save formal assets, sync placeholder fallbacks only after acceptance, and preserve rejected candidates unless the user asks for cleanup.
6. Update Starlaid docs/persistent memory when a durable asset rule changes.
7. For runtime asset or code changes, follow Starlaid version governance, validation, commit, tag, and push unless the user explicitly says not to push.

At the end of a Starlaid 玉豚 task, report the asset families changed, key prompts/style rules preserved, 玉凤 verdict, validation commands, and version/commit status.

### Error Memory Routing

When the user rejects, corrects, or criticizes a generated image, classify the lesson before the next attempt:

- Starlaid-specific mistakes go in `references/starlaid-image-error-memory.md`. Use this for Starlaid lore, material grounding, command-core/turret anchors, terrain masks/autotiles, Unity import behavior, naming contracts, or any asset rule tied to Starlaid's project direction.
- General image-generation mistakes go in `references/image-error-memory.md`. Use this for reusable failures such as visible primitive shapes, white matte residue, contact-sheet artifacts, poor transparency, low-detail outputs, excessive symmetry, or backend/prompt habits that can hurt multiple projects.
- Mixed mistakes should be split: keep the Starlaid-facing rule in the Starlaid memory file and the reusable generation lesson in the general memory file.

Before retrying a rejected image, read the relevant memory file(s), apply the closest matching lesson, and add a concise dated entry if the user's correction exposed a new failure mode. Each entry should include the failure signal, scope, what to avoid, the corrective rule, and a validation check. Keep entries operational and self-contained so future sessions do not need this chat history.

## Simulaid Route

Current workflow generation: `玉豚 3 号（主 Codex 线程直接生图 + 生图后端硬门禁 + 图像债务清单联动）`.

Backend memory update: `Simulaid Pixel Art Assets` may appear as the real callable image-generation backend name for this project. Do not confuse this with the local instruction skill of the same display phrase; verify that it is an actual callable generation tool before using it.


Creating or updating this skill is developer-side workflow memory. It does not bump the Simulaid game version by itself.

Backend boundary: Simulaid image generation for this workflow uses Codex's built-in `imagegen` / callable `Simulaid Pixel Art Assets` tool path. Do not detour into Hermes image-generation plugins or Hermes provider checks for this workflow unless the user explicitly asks for Hermes.

## Queue Task Autonomy

Persistent user preference, 2026-05-26: when the user gives image/content work as a queue, or says `生图`, `补图`, `重做图`, `玉豚`, or similar batch language, default to end-to-end execution in the same turn. Do not stop between planning, generation, self-review, correction, integration, validation, and final report just to ask whether to continue.

For queued art work, 玉豚 should independently:

1. Route to the owning project and acquire required locks.
2. Read the style/story/asset references required by the route.
3. Produce or consume the continuity packet when story identity matters.
4. Generate with the approved backend, inspect candidates, reject failures, and retry when reasonable.
5. Post-process, integrate runtime assets, update source manifests/docs, and run the matching import/test checks.
6. Report the completed result and any real blockers.

Only pause for the user when an essential reference or target is missing, a real generation/backend/account/quota/permission blocker exists, the task would overwrite user-owned content outside the expected project surface, or the user explicitly requested preview-only approval before integration.

## Trigger Meaning

When the user says `玉豚`, treat it as:

1. Use the general `/Users/yutu/.codex/skills/.system/imagegen/SKILL.md` workflow for real AI image generation.
2. Use `/Users/yutu/.codex/skills/simulaid-pixel-art-assets/SKILL.md` for Simulaid style, naming, post-processing, Unity placement, and placeholder policy.
3. Use `/Users/yutu/.codex/skills/simulaid-animation-assets/SKILL.md` too when the requested asset is animated, a sprite sheet, a loop, an effect, a dog animation, or any frame-based art.

## Required First Reads

Before broad searches or asset edits:

1. `/Users/yutu/.codex/skills/.system/imagegen/SKILL.md`
2. `/Users/yutu/.codex/skills/simulaid-pixel-art-assets/SKILL.md`
3. `/Users/yutu/.codex/skills/yufeng/SKILL.md`
4. `/Users/yutu/Simulaid/SIMULAID_STORY_BIBLE.md`
5. `/Users/yutu/Simulaid/SIMULAID_IMAGE_GENERATION_REQUIREMENTS.md`
6. `/Users/yutu/Simulaid/CODE_INDEX.md`
7. `/Users/yutu/Simulaid/IMAGE_PLACEHOLDER_BACKLOG.md`

Conditional reads:

- Animated assets: `/Users/yutu/.codex/skills/simulaid-animation-assets/SKILL.md`
- Tail dog companion assets: `/Users/yutu/Simulaid/DOG_COMPANION_ASSET_REGEN_SPEC.md`
- Existing style rules: `/Users/yutu/.codex/skills/simulaid-pixel-art-assets/references/pixel_style.md`

For any story/role/dog/crystal/portal/artifact/achievement/event image, apply 玉凤 before prompt writing so the generated art does not contradict Simulaid canon.

## Story-Sensitive Generation Gate

For Simulaid story-sensitive art, 玉豚 must not generate from loose vibes alone. Before calling image generation for comics, endings, role-state art, dog scenes, crystal/portal scenes, story events, or any asset that the user recently corrected, consume a 玉凤 continuity packet or create one through 玉凤 first.

Minimum pre-generation checklist:

1. References: exact approved assets/docs were inspected and their roles are named.
2. Timeline: the event order is explicit; no beat is moved earlier/later by accident.
3. Identity: character state, age, body type, and proportions are locked.
4. Pose/scale: hand logic, eye direction, relative body scale, and contact points are plausible.
5. Objects: required props have exact identity, shape, color, placement, and forbidden alternatives.
6. Emotion/aura: target feeling is concrete; forbidden emotional drift is named.
7. Background continuity: same location vs allowed location change is stated.
8. Page rhythm: panel/slice count and pacing match the target asset family.
9. Reject tests: there is a short fail-fast list to compare against the output.
10. Variant coverage: required route/breed/state variants are explicit; do not silently generate only one route when the story owns multiple variants.

If any item is missing, stop and write the missing continuity packet instead of generating. After generation, inspect against this checklist; if a candidate fails, save it only as rejected/review material and do not integrate or use it as future positive reference.

For Tail/dog story art, treat wolfdog, golden, and mastiff as separate narrative variants, not a dog skin swap. If the request says Tail ending/comic/return and does not explicitly limit the route, plan the three dog-route comic sets or clearly label a single generated set as one-route review only.

For character-age-sensitive story art, especially Tail, 玉豚 must validate the generated candidate against **specific positive reference assets**, not only against the prompt words. Numeric age text is not enough. Build or inspect a small comparison sheet with the approved same-family reference page(s), the candidate, and any recent rejected example when available. Reject the candidate if the face maturity, body scale, or identity reads as a different age state, even if it is closer than the last attempt. Do not call a candidate “可用” until it passes this side-by-side identity check.

## Hard Generation Gate

Before replacing or claiming any player-facing art:

1. Verify a real generation backend is available in the current session:
   - built-in `image_gen` tool / `image_gen` namespace is exposed in the active tool list, or
   - a callable image-generation tool exposed as `Simulaid Pixel Art Assets` is available, or
   - the user explicitly confirmed CLI fallback and `OPENAI_API_KEY` is available.
2. Do not rely on `tool_search` alone to decide whether built-in image generation exists. `tool_search` may not return system-level tools such as `image_gen`; the active tool list visible in the current Codex session is authoritative. Use `tool_search` only as a supplement to discover deferred/dynamic tools such as a callable `Simulaid Pixel Art Assets` backend.
3. If `image_gen` is not visible in the active tool list, search tool discovery for `Simulaid Pixel Art Assets` before declaring generation blocked. Treat it as usable only when discovery exposes a callable image-generation/editing backend, not merely the local `/Users/yutu/.codex/skills/simulaid-pixel-art-assets/SKILL.md` instruction file.
4. Do not use Hermes image-generation code as a substitute for the Codex built-in imagegen path.
5. If none of these backends is available, stop the image replacement as blocked.
6. In the blocked state:
   - Do not create local procedural/rasterized/vector/code-drawn art as the replacement.
   - Do not describe assets as regenerated, final, approved, complete, production-ready, or debt-paid.
   - Do not put a player-facing release note implying the visual debt was fixed.
   - Report the blocker clearly and keep or update `/Users/yutu/Simulaid/IMAGE_PLACEHOLDER_BACKLOG.md` when relevant.

Current known failure modes:

- A session may list the `imagegen` skill or the Simulaid pixel-art instruction skill but not expose an actual callable generation backend. The skill being present is not enough; the real callable backend must exist.
- A session may expose built-in `image_gen` while `tool_search` returns zero results, because `tool_search` discovers deferred/dynamic tools rather than every system tool. In that case, use the active `image_gen` namespace.
- If a callable tool named `Simulaid Pixel Art Assets` exists, it satisfies the generation gate for Simulaid art.

## Direct Main-Session Rule

The user's persistent preference changed again on 2026-05-07: Simulaid image-generation work should stay in the main Codex session by default. Do not spawn image-generation or animation-generation sub-agents for Simulaid art unless the user explicitly asks for a separate worker in that same request.

Reason: the user found that delegating image work to another agent made review and coordination difficult, and recent Black Lotus generation drifted away from the established character style.

Rules:

- Main Codex owns prompt framing, generation, post-processing, Unity placement, docs, validation, and final reporting for Simulaid image work.
- Prefer existing accepted Simulaid art references and source folders before generating a new style direction. If the user says an image already exists in another asset, derive or regenerate against that exact existing identity instead of inventing a new look.
- Do not use a sub-agent just to avoid waiting for image generation. If generation is slow or blocked, report the blocker or continue with non-image work that does not conflict.
- If the user explicitly asks for a separate worker later, provide a self-contained brief and avoid parent/worker report loops, but treat that as an exception, not the default.
- Persist important results as files under `/Users/yutu/Simulaid/generated_source_keep/<batch_name>/`, runtime PNGs under `/Users/yutu/Simulaid/Assets/Resources/GeneratedPixel/`, and backlog/spec notes when relevant.

## Normal Workflow

1. Identify target runtime resource names, expected dimensions, transparency, and current code references.
2. Check `IMAGE_PLACEHOLDER_BACKLOG.md` first. If the target is already listed, follow that entry and close it only after the final PNGs are generated, imported, wired, and visually checked.
3. If `PENDING-20260501-01` is still open, treat it as the top priority debt: Black Lotus role art, Charge Up card art, Warcry/Black Lotus/progression achievements, and the cleared stamp must be replaced before lower-priority Simulaid art unless the user explicitly redirects.
4. Compare against same-family approved assets in `/Users/yutu/Simulaid/Assets/Resources/GeneratedPixel/` before writing prompts. Future image generation must reference the same asset family so the new file does not look visually abrupt:
   - role portraits reference approved role portraits,
   - combat cutouts reference approved combat cutouts,
   - card long art and card icons reference approved cards,
   - achievement icons reference approved achievements,
   - item/equipment icons reference approved inventory icons,
   - enemy art references approved enemy art.
   Include these reference paths in the prompt notes or source folder record.
   Before choosing the prompt structure, also apply `/Users/yutu/Simulaid/SIMULAID_IMAGE_GENERATION_REQUIREMENTS.md`: identify the exact asset family, dimensions, transparency/background rule, same-family reference priority, and avoid list. Do not use an item/card/comic composition rule for an achievement icon or vice versa.
5. If the user rejected a style batch, generate one corrected sample first. Do not batch-overwrite a full family after a rejected style without a new approved direction.
6. Use real AI generation through `imagegen` or the callable `Simulaid Pixel Art Assets` backend in the main Codex session by default. If the user explicitly asks to derive from an existing accepted image, local post-processing/cropping is allowed when it preserves the approved identity better than another style-drifting generation pass.
7. For transparent sprites, use the `imagegen` chroma-key workflow, remove the background locally, and validate alpha corners/bounds.
8. Save final runtime assets under `/Users/yutu/Simulaid/Assets/Resources/GeneratedPixel/`.
9. Keep source previews, contact sheets, prompt records, and intermediate files outside `Assets`, normally under `/Users/yutu/Simulaid/generated_source_keep/<batch_name>/`.
10. Validate:
   - dimensions and aspect ratio,
   - alpha and visual bounds,
   - phone-scale readability,
   - matching Simulaid refined pixel-informed style,
   - filename/resource-name case,
   - `.meta` importability through Tuanjie logs,
   - runtime sprite renders instead of fallback text.
11. For animation sheets, run frame-registration and loop-closure QA from `simulaid-animation-assets`.
12. Update `IMAGE_PLACEHOLDER_BACKLOG.md` status only after actual final assets are imported and checked.
13. If runtime assets or game code changed, follow `simulaid-unity-maintenance` for version/README/VersionHistoryEntries/ProjectSettings sync. Developer-only skill edits do not bump the game version.

## Asset Output Standards

- Card long art: `card_art_{cardId}.png`, `768x256`, 3:1.
- Card/item/equipment/achievement icons: usually `256x256`, transparent RGBA unless the specific UI expects opaque framed art.
- Character and combat cutouts: follow `CODE_INDEX.md` names and dimensions, usually transparent RGBA.
- Dog and companion animation sheets: follow `DOG_COMPANION_ASSET_REGEN_SPEC.md` and `simulaid-animation-assets`, especially stable contact point and no frame jitter.
- Inventory-style item icons must not bake scenery, card frames, panels, shadows, or colored backgrounds into the PNG unless explicitly requested.

## Reporting

At the end of a 玉豚 task, report:

- backend used: built-in `image_gen`, `Simulaid Pixel Art Assets`, confirmed CLI fallback, or blocked,
- generated/replaced asset names and saved paths,
- prompt batch or prompt summary,
- validation performed,
- backlog entries closed or still pending,
- whether a Simulaid version bump was needed.

If blocked, keep the report blunt and useful: say exactly which backend was missing, which debt remains unpaid, and what is needed before trying again.
