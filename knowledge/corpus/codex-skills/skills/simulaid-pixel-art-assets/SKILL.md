---
name: simulaid-pixel-art-assets
description: Use with the imagegen skill when creating, converting, pixelizing, or integrating high-quality Simulaid Unity game art assets. This Simulaid-specific wrapper defines prompt style, anti-placeholder quality rules, sacred weapon direction, post-processing, filenames, Unity Resources placement, and import assumptions; image generation itself should use the general imagegen workflow.
---

# Simulaid Pixel Art Assets

## Purpose

Create and integrate Simulaid assets in a consistent art style without duplicating the general `imagegen` skill.

This skill is the Simulaid-specific asset pipeline:

- what to ask for in prompts
- which asset sizes and naming rules to use
- how to cut out, pixelize, validate, and place files in Unity
- how to keep UI references stable through `Assets/Resources/GeneratedPixel/`

For any AI-created raster image, first use the system `imagegen` skill and its built-in generation/chroma-key workflow. Do not invent a second image-generation path here.

Persistent backend note: the real callable image-generation backend for this project may be exposed under the name `Simulaid Pixel Art Assets`. That name can also refer to this local instruction skill, so future sessions must verify whether it is a callable tool before treating it as generation capability.

Backend boundary: this workflow should use Codex's built-in `imagegen` / callable `Simulaid Pixel Art Assets` generation path. Do not inspect or route through Hermes image-generation plugins for Simulaid asset generation unless the user explicitly asks for Hermes.

For animated raster assets, also use `simulaid-animation-assets`. If the user asks for Doubao Seedance / 火山引擎 keyframe animation, use `doubao-seedance-animation` after this style skill to create the video motion, then return to `simulaid-animation-assets` for sprite-sheet packing and QA. The current Simulaid default animation spec is a 1-second, 30-frame, 30fps sprite sheet laid out as 6 columns x 5 rows.

## Queued Work Autonomy

Persistent user preference, 2026-05-26: Simulaid image and asset tasks often arrive as a queue. When the target project, asset family, and style references are discoverable, complete the whole lane without asking for step-by-step confirmation: reference check, prompt/continuity prep, generation, candidate self-review, retry, post-processing, Unity placement, import validation, relevant docs, and final report.

Do not wait for approval between generation and integration unless the user explicitly asks for preview-only review, the style direction is genuinely new or disputed, a required reference/target cannot be discovered, an external paid/account/key/quota step is blocked, or the change risks overwriting unrelated user-owned work. If a candidate fails the style or identity gate, reject it internally and retry or report the concrete blocker.

## Default Workflow

1. Decide whether the asset is player-facing. If it is visible to the player, use high-quality source art that matches the approved Simulaid style; do not satisfy the task with rough procedural/code-drawn art.
2. When image generation is available and not busy, generate high-quality final/player-facing art directly. Do not create a low-quality placeholder as the first pass merely to move faster.
3. Use deterministic/code-drawn art only for invisible tooling or explicitly labeled temporary session placeholders when image generation is failed, busy, unavailable, or blocked. Do not present it as finished player-facing art.
   - If a temporary placeholder enters `/Users/yutu/Simulaid`, add or update `/Users/yutu/Simulaid/IMAGE_PLACEHOLDER_BACKLOG.md` in the same turn.
4. When the user asks to add any new player-facing thing, automatically audit whether it needs art before coding is considered complete. This includes new cards, equipment, items, crops, seeds, enemies, gacha pools, weather/rest summaries, settlement/victory states, menu backgrounds, status icons, and tutorial/feature panels.
   - New Simulaid cards are not complete until their missing art is handled in the same turn. Action cards need a wide `card_art_{cardId}.png` banner at `768x256`; if a card detail or compact icon surface would show the raw resource name, also create `card_{cardId}.png` at `256x256`. Equipment cards normally need the compact `card_{cardId}.png` icon and may also get wide art if they render in card-list rows.
   - A new card's final art must be a real generated/accepted source for that card, not a collage of old card/role art plus procedural motion lines, halos, circles, or impact marks. Local scripts may crop, align, alpha-clean, resize, and make subtle post-processing passes, but they must not provide the main visual content of a new player-facing card. If a source manifest says the visible card was built mainly by compositing old assets and procedural effects, keep it as temporary or regenerate it before calling the card complete.
   - Persistent Simulaid rule, 2026-05-15: adding new visible item/armor/weapon/equipment definitions, enemy definitions, boss definitions, scene/map/biome content, or archive-visible enemy variants is not complete until matching runtime PNGs exist in `/Users/yutu/Simulaid/Assets/Resources/GeneratedPixel/` and pass quick dimension/alpha validation. For enemies, audit the exact runtime combat/archive resource name such as `enemy_{id}` plus any gender/rarity variants. For scenes/maps/biomes, audit any required background, thumbnail, map, story, or event art named by the consuming code. Only leave a backlog item when the real generation backend is blocked, and report that blocker explicitly.
5. If a required Simulaid asset is missing, generate the asset through the current Codex image backend in the main session and wire it into `Assets/Resources/GeneratedPixel/` with a stable resource name and `.meta`. Do not wait for the user to explicitly say "generate the picture" unless the art direction is new/disputed, the user asked for a preview-only design pass, or the workflow needs a paid tool/API key.
6. For future Simulaid image-generation work, the user's current persistent preference is to keep generation in the main Codex session; do not use image sub-agents unless explicitly requested in that same task.
7. For AI-generated art, the current session should load/use `imagegen`; generate with a removable chroma-key background when transparency is needed.
8. For new or disputed styles, generate one approved preview first. Do not batch-integrate a whole family after a rejected style sample.
9. Before writing each prompt, choose same-family approved reference assets from `/Users/yutu/Simulaid/Assets/Resources/GeneratedPixel/` and explicitly keep the new art close to that family. Cards should match approved card art, role portraits should match approved role portraits, combat cutouts should match approved combat cutouts, achievements should match approved achievements, item/equipment icons should match approved inventory icons, and enemies should match approved enemy art. Do not let one new generated asset introduce a jarringly different rendering style.
   - Also read and apply `/Users/yutu/Simulaid/SIMULAID_IMAGE_GENERATION_REQUIREMENTS.md` before prompt writing. That project-level document is the authoritative asset-family gate for achievement icons, item/equipment icons, card art, role art, combat sprites, and story comics. If it disagrees with an older one-off prompt or backlog line, the project-level document wins.
   - For story-sensitive assets, also read `/Users/yutu/.codex/skills/yufeng/SKILL.md` and `/Users/yutu/Simulaid/SIMULAID_STORY_BIBLE.md`; use 玉凤's continuity checklist before writing prompts or replacing art.
10. Post-process into the Simulaid target format listed in `references/pixel_style.md`.
11. Save final project assets under `/Users/yutu/Simulaid/Assets/Resources/GeneratedPixel/` unless the user asks for another location.
12. Keep source files or previews outside the Unity project when they are not needed at runtime.
13. In Unity UI, load through `SimulaidPixelAssets.GetSprite()`, use `Image.preserveAspect = true`, cached sprites, and stable layout heights.
14. Validate dimensions, alpha corners for sprites, and readability at phone scale before wiring assets into UI.
15. Validate Unity importability before declaring the asset integrated: check the `.meta` GUID, confirm there are no Tuanjie Console import errors, and verify the runtime resource name renders instead of falling back to text.

## Opening Comic / Story Comic Continuity

When generating, regenerating, extending, or integrating Simulaid opening-comic pages, role story comics, or future game-plot comic pages, first read:

`/Users/yutu/.codex/modules/simulaid-opening-comic-style/INDEX.md`

That module is the durable style lock for Tail's approved opening-comic family. It records the near-realistic animated-film survival comic style, Tail/father/dog identity constraints, dog-breed guardrails, `768x1365` runtime format, prompt skeleton, canonical Tail story beats, source manifests, and common failure modes. Do not rely on chat history for Tail's comic style, and do not let future story art drift into a different anime, 3D, photoreal, superhero-comic, or cheap web-game style.

## Main-Session Image Policy

- Keep Simulaid image-generation work in the main Codex session by default. Do not spawn image-generation or animation-generation sub-agents unless the user explicitly asks for that worker in the same request.
- Main Codex owns prompts, generation, post-processing, Unity placement, docs, validation, and final reporting.
- Before generating a fresh look, compare against accepted same-family assets and source folders. If the user says a character already appears in an existing asset, preserve that identity through careful reference use or local derivation rather than inventing a new style.
- If image generation is slow, unavailable, busy, or failing, retry locally when reasonable, report the blocker, or create a clearly labeled low-quality session placeholder only when necessary. Local tooling may be used for validation, post-processing, or identity-preserving derivations; do not present rough procedural art as final player-facing art.

## AI Generation Policy

This skill does not replace `imagegen`; it constrains it for Simulaid.

- Before replacing any player-facing Simulaid art, explicitly verify the real image-generation backend is available:
  - built-in `image_gen` tool / `image_gen` namespace is exposed in the active Codex toolset, or
  - a callable image-generation/editing backend named `Simulaid Pixel Art Assets` is exposed in tool discovery, or
  - the user has explicitly confirmed CLI fallback and `OPENAI_API_KEY` is available.
- Do not rely on `tool_search` alone to decide whether built-in image generation exists. `tool_search` may not return system-level tools such as `image_gen`; the active tool list visible in the current Codex session is authoritative.
- If `image_gen` is not visible in the active tool list, search tool discovery for `Simulaid Pixel Art Assets` before declaring generation blocked. Do not confuse the callable backend with this SKILL.md instruction file.
- Do not use Hermes image-generation code as a substitute for the Codex built-in imagegen path.
- If none of these backends is available, stop the art replacement as blocked. Do not create local procedural/rasterized/vector/code-drawn art as the replacement, do not describe the asset as regenerated/final/complete, and do not make a release/build claim that the art debt was paid. You may only keep or create a clearly labeled temporary placeholder and update `/Users/yutu/Simulaid/IMAGE_PLACEHOLDER_BACKLOG.md`.
- When the user has specifically complained that an asset batch is low quality, first compare it against same-family approved assets in `Assets/Resources/GeneratedPixel/`, then generate one style-correct sample before overwriting the whole batch. If generation is blocked, report the blocker instead of producing another stopgap.
- Use the built-in `image_gen` path described by the `imagegen` skill for normal image generation.
- For transparent sprites, prompt for a flat chroma-key background, then remove the key locally and validate alpha.
- Never leave a Unity-referenced asset only in `$CODEX_HOME/generated_images`; copy the final PNG into `Assets/Resources/GeneratedPixel/`.
- Never treat rough procedural icons, simple vector symbols, blocky placeholder art, or quick code-drawn sprites as final player-facing art. If the user asks for a real asset and generation is blocked, a low-quality session placeholder is allowed only to keep the current task moving and must be named/reported as temporary.
- If the user rejects an output as too realistic, too crude, too blurry, or too cheap-looking, update the prompt/style reference before generating more assets.
- Do not require paid/registration tools unless native transparency, high-quality batch generation, or a specific commercial asset pipeline is explicitly requested.
- If a workflow requires a paid or account-based external service, tell the user before using it.

## Temporary Session Placeholder Policy

- Allowed only when the proper image/animation generation path is failed, busy, unavailable, or blocked by a paid/key requirement. If image generation is available and not busy, generate the high-quality final asset instead of a placeholder.
- Purpose: keep code wiring, layout sizing, import checks, or interaction logic moving during the current session.
- Must be explicitly named or documented as temporary, such as using `_placeholder`, `_debug`, or a final report note.
- Must not be described as "generated", "approved", "final", "production", or "quality complete".
- Must not replace the required high-quality asset in design docs, README claims, release notes, or final delivery.
- Before a build intended for user testing/release, audit temporary placeholders and either replace them with approved art or tell the user what remains temporary.
- Every placeholder entry must give a future image-focused agent enough information to replace it directly: stable runtime resource name, expected final path, current placeholder path, exact dimensions, transparency requirement, prompt draft, negative prompt/avoid list, likely reference file paths, code references, and replacement validation checklist.
- Asset types in scope include animations, card background art, item/crop/seed/enemy/equipment/status/HUD/UI icons, settlement/weather/rest/menu/panel scene images, and any other player-facing visual placeholder.

## Style Rules

Read `references/pixel_style.md` when changing the style, adding asset families, or converting generated art into pixel form.

For Simulaid project assets, also read `/Users/yutu/Simulaid/SIMULAID_IMAGE_GENERATION_REQUIREMENTS.md` before generating or replacing art. This prevents cross-family drift such as treating an achievement icon as a gift-code advertisement, a card banner, or a rest-summary scene.

Core style:
- refined high-definition pixel-informed survival art, not rough placeholder blocks.
- high silhouette readability at phone scale.
- one subject per sprite; generous transparent padding.
- cards/items use symbolic survival icons, not baked text labels.
- crops and farm plots must share soil palette assumptions so wet/dry states do not clash.
- crop growth stages must be bottom-baseline aligned in the transparent canvas so the plant appears to grow upward instead of shifting position between frames.
- item icons, enemy sprites, companion sprites, and card art should match the approved refined icon/zombie standard: crisp silhouette, deliberate pixel-informed edges, strong phone-scale readability, and no flat doodle/simple-symbol look.
- Item icons, equipment icons, seed icons, ticket icons, and other inventory-style square sprites must be transparent-background cutouts by default. Generate on a removable chroma-key background, remove the key locally, and validate RGBA alpha corners before placing them under `/Users/yutu/Simulaid/Assets/Resources/GeneratedPixel/`. Do not bake scenery, colored cards, panels, frames, drop shadows, or decorative backgrounds into these icon PNGs unless the user explicitly asks for a backgrounded illustration.

Quality guardrails:
- "Pixel style" means deliberate visible pixel clusters, crisp hard edges, and simplified readable shapes. It does not mean low-resolution, mushy, rough, or cheap.
- Generate high-quality source art first, then pixelize or prompt for pixel-informed rendering. Do not blur the image to make it "less detailed".
- Avoid photorealism, 3D product renders, painterly haze, soft-focus blur, random neon, excessive gold, rainbow loot beams, and generic low-budget web-game weapon effects.
- Legendary/mythic sacred weapons such as `倚天剑` and `人皇剑` should feel elegant, restrained, clean, and holy: pale jade, moonlit silver, warm white, subtle cyan/gold accents, graceful silhouettes, and calm aura. They must not look like noisy MMORPG loot.

## Static Asset Alignment QA

Before wiring a visible PNG into Unity:

- Confirm dimensions match the target format and aspect ratio.
- For transparent sprites, compute the alpha bounding box of non-transparent pixels. Reject empty masks, clipped subjects, or content touching the canvas edge unless the art is an intentional full-bleed background.
- Check centering with the alpha bounding box:
  - square icons should be visually centered within about `2-4px` at 64px scale after resizing,
  - crops and standing characters should share a stable bottom baseline,
  - action-card long art should keep the important subject inside the central safe region and not only occupy one quarter of the 3:1 frame.
- If a generated asset is off-center, crop/pad/translate it with transparent padding and nearest-neighbor scaling before importing.
- For families of related assets, compare all bounding boxes as a set so one crop stage, item icon, enemy variant, or companion frame does not appear to jump in UI.

## Dog Companion Static Asset Standard

When generating or replacing Tail's dog companion pads:

- Treat `companion_dog_pad_{blue|green|red}` and `companion_dog_pad_{blue|green|red}_dead` as paired variants of the same three pads. Each alive/dead pair must keep the same pad shape, camera, palette, perspective, and transparent canvas.
- Alive pads are empty because the dog renders above them. Dead pads show the matching dirtier pad with a broken, dirty toy on it; the toy should not look like a living dog or a second companion.
- Pads should stay `512x256` transparent RGBA unless the code/layout spec is intentionally changed.
- The active dog animation sheets and active dog pads should be generated as one coherent family so the dog appears seated on the pad, has room to grow, and does not clash with the pad perspective.
- Any low-quality procedural dog pad or dog memory toy that remains in `Assets/Resources/GeneratedPixel/` must be tracked in `/Users/yutu/Simulaid/IMAGE_PLACEHOLDER_BACKLOG.md` or replaced during the dog companion regeneration pass.

## Unity Integration Pattern

Runtime sprite loading is centralized in `Assets/Scripts/Simulaid/Runtime/SimulaidPixelAssets.cs`. Prefer adding PNGs to `Assets/Resources/GeneratedPixel/` and referencing them by resource name through existing UI helpers instead of reimplementing loading logic.

## Import and Metadata Contract

- PNG existence is not enough. Unity/Tuanjie must import it successfully before `Resources.Load("GeneratedPixel/name")` works in builds.
- Do not create random non-Unity GUID strings in `.meta` files. Invalid `.meta` GUIDs can make Tuanjie ignore the corresponding PNG even when the file opens normally outside Unity.
- This user's Tuanjie editor may store encrypted base64-like `guid:` values in `.meta` when `com.unity.editor.guid.encryption` is active. Do not treat those as broken just because they are not plain 32-character hex. Validate with the Tuanjie import log: healthy imports show `using Guid(<32 hex>)`; real failures mention `does not have a valid GUID` or ignored assets.
- If a custom script writes a PNG, either omit the `.meta` and let Unity generate one, or write a valid Unity/Tuanjie-compatible `.meta`. Afterward, inspect the Console or batch log for invalid GUID warnings rather than using a regex-only scan.
- If the Game view shows the resource name as visible text, the UI helper did not receive a sprite. First check resource naming and import/cache status before redesigning the UI.
- Long action-card art follows `card_art_{cardId}.png`, 3:1 ratio, and should keep enough resolution for import at up to 2048px. Detail icons and inventory sprites may use smaller square formats.
- After generating assets while the editor is open, account for stale `SimulaidPixelAssets` missing-sprite cache and Unity's delayed asset import. Reopen the screen, clear cache through code if needed, or restart Play mode before final visual judgement.
