---
name: simulaid-animation-assets
description: Use with simulaid-pixel-art-assets and imagegen when creating or integrating Simulaid animated bitmap assets, sprite sheets, idle loops, HUD effects, creature animations, card/action effects, or any user-facing animation art under /Users/yutu/Simulaid/Assets/Resources/GeneratedPixel/.
---

# Simulaid Animation Assets

Use this skill for Simulaid raster animations. Combine it with `simulaid-pixel-art-assets` for style and naming, and with `imagegen` when AI-created source art is needed. When the user specifically asks for 火山引擎 / Doubao Seedance / Seedance 2.0 / keyframe-to-video animation generation, also use `/Users/yutu/.codex/skills/doubao-seedance-animation/SKILL.md` as the external animation backend, then still apply this skill's frame-registration and Unity import QA before integration.

## Default Spec

- Default loop: 1 second, 30 frames, 30fps.
- Default sheet layout: 6 columns x 5 rows.
- Dog companion loops use 30 frames in one sprite sheet, not 30 scattered files.
- All player-facing animation assets must be seamless loops. The final frame must transition back to frame 1 without a visual pop, position jump, scale snap, timing hiccup, or effect reset.
- Runtime assets live in `/Users/yutu/Simulaid/Assets/Resources/GeneratedPixel/`.
- Runtime names should be stable and extension-free in code; PNG filenames keep `.png`.
- Use transparent RGBA PNG for character/object loops unless the animation is a full background scene.

## Generation Workflow

1. Decide exact output names before generating.
2. Generate animation assets through the current Codex image/animation backend in the main session by default. Do not use image/animation sub-agents unless the user explicitly asks for one in the same request.
3. When image/animation generation is available and not busy, create the high-quality final animation asset directly. Do not make a low-quality placeholder first just to keep moving.
4. Create or obtain high-quality source art first, then pixel-inform/pixelize with nearest-neighbor style. Do not blur.
   - If using Doubao Seedance, create or choose high-quality Simulaid-style keyframes first, submit only the necessary references through the `doubao-seedance-animation` workflow, then extract/pack/align frames locally.
5. Assemble frames into one sprite sheet using the default 6x5 / 30-frame layout unless the code says otherwise.
6. Keep the subject anchored so idle loops do not drift. For pets, crops, characters, and enemies, preserve a stable bottom baseline and stable visual center.
7. Run frame-registration QA before wiring: split the sheet into frames, measure alpha bounding boxes/centroids/baselines, correct drift, and rebuild the sheet if needed.
8. Validate loop closure before wiring: compare the last frame to the first frame and confirm the motion curve returns cleanly to its starting pose. For authored curves, the implied frame after the final frame must equal frame 1.
9. Validate dimensions and alpha before wiring.
10. Validate Unity importability before wiring. Sprite sheets with invalid `.meta` GUIDs will be ignored by Tuanjie and will look like missing assets even though the PNG exists.
11. In Unity UI, play sheets through a small sprite-sheet animator or equivalent Unity animation component. Avoid per-frame hierarchy rebuilds.

## Performance Planning

Before generating or wiring any Simulaid animation, think through runtime cost and choose the lowest-cost approach that still preserves the requested visual quality.

- Prefer one packed sprite sheet per animation state over many loose runtime sprites.
- Prefer small, bounded frame counts and texture sizes that match the on-screen size. Do not create oversized sheets merely because generation can produce them; increase size only when readability or future scaling needs it.
- Prefer deterministic local rig assembly from high-quality source art when it avoids many independent AI redraws, improves frame registration, or reduces asset churn.
- Prefer a lightweight frame-slicing animator such as `SpriteSheetAnimator` and avoid rebuilding UI hierarchy every frame.
- Avoid redundant layers. Split layers only when they solve a real artifact, such as the dog tail seam; when split, keep both layers using the same grid, frame count, fps, pivot assumptions, and playback timing.
- Keep transparent padding reasonable. Enough for motion and growth is good; very large empty canvases waste texture memory.
- After integration, consider import size, `Resources.Load` count, cached sprite reuse, frame count, alpha bounds, and whether the animation will appear many times on the same screen.

## Missing-Info Clarification

When an animation request lacks details that materially affect asset generation, ask for only the missing information that changes the output. Good clarification targets include exact subject, size, frame count/fps, loop length, transparent/full-background mode, growth stage, layer split, and key motion curve.

- If the user is active in the current Codex chat, ask the concise question here first.
- If the user is not reachable in chat or explicitly wants Feishu routing, send a concise Feishu confirmation/detail card through the Hermes/Yutu workflow documented in `/Users/yutu/.codex/modules/hermes-yutu-voice-bridge/`, especially `io-contracts.md` and `file-map.md`.
- The Feishu card should include the animation name, project path, missing fields, recommended defaults, and a clear "reply with details" request. Keep it short enough to answer on mobile.
- Because Feishu is an outbound third-party communication channel, obey the active confirmation policy before actually sending the card when action-time confirmation is required.
- Wait up to 5 minutes for the user's Feishu response when the workflow supports waiting. If there is no response after 5 minutes, continue with reasonable defaults and document the assumptions in the final response or the asset backlog/spec.
- When proceeding without a response, prefer a conservative, replaceable result: stable filenames, correct dimensions, correct import settings, and clear notes about which creative assumptions were made.

## Import Guardrails

- Animated sprite sheets are runtime assets, so they must sit under `Assets/Resources/GeneratedPixel/` with stable extension-free resource names in code.
- Do not write arbitrary/random base64-like GUIDs into `.meta` files. Let Unity generate metadata when possible, or verify the `.meta` immediately after creation.
- If the Game view shows an asset name instead of an image, treat it as a resource load failure first: check filename, `.meta`, import Console, and `SimulaidPixelAssets` cache before changing animation code.

## Main-Session Animation Policy

- Keep Simulaid image/animation generation in the main Codex session by default. Do not spawn animation/image sub-agents unless the user explicitly asks for one in the same request.
- Main Codex owns prompts, frame generation, sprite-sheet assembly, post-processing, Unity placement, frame-registration QA, and final reporting.
- If animation generation fails, is busy, or is unavailable, retry locally when reasonable, report the blocker, or create a clearly labeled low-quality session placeholder so code/layout work can continue.
- If any temporary animation placeholder enters `/Users/yutu/Simulaid`, add or update `/Users/yutu/Simulaid/IMAGE_PLACEHOLDER_BACKLOG.md` in the same turn. Include runtime resource name, expected final path, current placeholder path, exact sheet dimensions, frame count, fps, grid layout, cell size, transparency, prompt draft, negative prompt/avoid list, likely reference file paths, code references, and frame-registration validation checklist.

## Dog Companion Standard

- Dog idle/panting animation: 1 second, 30 frames, 6x5 sheet, transparent background.
- Dog carrying-can animation: same sheet spec; only used when the dog has food ready.
- Suggested final sheet size: `1536x1280` for 30 frames of `256x256`, or another exact 6:5 multiple if code is updated.
- Visual quality must match the approved Simulaid item-icon and zombie-sprite standard: refined pixel-informed survival art, crisp silhouette, readable expression, no simple flat doodle, no rough code-drawn cartoon, no cheap sticker look.
- Individual frame composition: dog sitting on or just above its pad, happy and alive. The body has only a slight breathing/sway motion, the tail wags happily, and the tongue extends/retracts while panting.
- The body mass, head, paws, and sitting contact point must stay anchored. Tail and tongue may move, but the torso cannot translate around the frame.
- The dog is allowed and expected to grow by stage. Stage0, stage1, and stage2 must use deliberate whole-stage scale changes, never random per-frame scale changes. Keep the same contact point and bottom baseline across growth stages so the dog grows upward from the pad instead of sliding around.
- Wolfdog and golden retriever should share pose scale and baseline for the same stage so breed changes do not move the UI.
- If the animation looks like jittering, twitching, random per-frame redraws, or mismatched crops, reject it and regenerate/realign before integration.

## Dog Companion Full Regeneration Contract

When the user asks to regenerate Tail's dog companion images, treat the whole dog family as one coordinated asset pass, not as isolated PNG replacements.

- Regenerate every active dog companion animation sheet and pad image together from one coherent art direction. Active sheets are `companion_dog_{wolfdog|golden}_stage{0|1|2}_pant` plus `companion_dog_{wolfdog|golden}_stage2_can`; active pads are `companion_dog_pad_{blue|green|red}` and matching `_dead` variants.
- Also audit any legacy `companion_dog_*.png` files that remain in `Assets/Resources/GeneratedPixel/`, such as `companion_dog_pad` or `companion_dog_memory_toy`, and either regenerate them consistently or document why they are unused.
- Produce one approved pose/style sample before batching the full family if the style has changed or the user has complained about quality.
- Animation must be authored as a stable rig-like sequence: locked canvas, locked crop, locked paws/contact point, locked torso/head center, and locally animated tail/tongue/ear/breathing details. Do not create 30 independent redraws that shift the whole dog.
- If tail motion creates a visible crack or seam at the body joint, split the dog into a separate tail animation sheet and a body animation sheet. Render the tail layer underneath the body layer so the body/root fur covers the seam.
- The intended motion is alive but subtle: body breathing or a small seated sway, tail wag arc, tongue in/out panting cycle, optional tiny ear/eye changes. It must not look like walking, hopping, sliding, or resizing every frame.
- Tail, tongue, and body motion must be controlled by explicit 30-frame curves when assembling Tail's dog companion sheets. Tail range is total `30°`, moving `2°` per frame in a closed loop: `-15, -13, -11, -9, -7, -5, -3, -1, 1, 3, 5, 7, 9, 11, 13, 15, 13, 11, 9, 7, 5, 3, 1, -1, -3, -5, -7, -9, -11, -13`, then back to `-15`.
- Tongue and body breathing also need explicit closed 30-frame timing curves; do not leave them to image-model randomness. The current accepted tongue extension curve is `0..15..1px`, and body breathing is only `0/1px` with no `-1` phase so it reads as breathing rather than bobbing. The current accepted body curve is `0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0`.
- Dog companion sheets must be seamless loops. Frame 30 must be deliberately close to frame 1 or have an authored next-step return to frame 1; never leave the dog at a different pose, scale, contact point, tongue state, or tail phase at loop restart.
- Growth is a stage-level design: stage0 younger/smaller, stage1 adolescent, stage2 mature/larger. Stage2 can be visibly bigger, but all stages share the same baseline and pad contact point. Runtime layout should provide enough room before integrating larger stage2 art.
- `*_can` sheets must reuse the exact mature stage2 body baseline and body scale from the matching `*_pant` sheet; only the can/paw/head detail may differ.
- Run frame-registration QA before replacing project assets. For dog sheets, measure a torso/contact mask if possible rather than trusting the full alpha bounds, because tail and tongue movement intentionally changes the full silhouette.
- After import, inspect the Game view. If the dog still appears to move around, investigate runtime layout, stale sprite cache, and sprite import settings before declaring the asset pass complete.

## Frame Registration QA

Run this check for every player-facing sprite sheet before claiming it is complete:

1. Split the sheet row-major, left-to-right then top-to-bottom. For the default sheet, each cell is exactly `sheetWidth / 6` by `sheetHeight / 5`; both divisions must be integers.
2. For every frame, compute the alpha mask bounding box using pixels with alpha greater than a small threshold such as `8/255`.
3. Reject frames with empty masks, subjects clipped by the cell edge, or inconsistent padding.
4. Measure:
   - full alpha bounding-box center,
   - alpha centroid,
   - bottom baseline of the non-transparent pixels,
   - bounding-box width/height/area.
5. Compare each frame to the median frame, not only frame 0. For idle companion loops:
   - bottom baseline drift should be at most `1px` at source frame size,
   - visual center drift should usually be at most `2-4px`,
   - torso/body size drift should stay within about `6-8%`,
   - tail/tongue movement may change the full bounding box, but must not move the torso/contact point.
6. If drift exceeds the threshold, translate frames inside their transparent cells to re-center and rebuild the sheet. Use transparent padding; do not scale frames independently unless all frames receive the same nearest-neighbor scaling.
7. Check loop closure explicitly. Compare frame 30 to frame 1 and frame 29 to frame 30; the final-to-first transition should be no larger than ordinary adjacent-frame movement for the intended curve.
8. Create a contact-sheet or overlay preview with frame boundaries and bounding boxes. Inspect the first, middle, last, and last-to-first transition visually before Unity integration.
9. After Unity wiring, confirm the animation loops without a visible restart pop in the Game view. Computer Use can be used only to observe the screen, not to drive reliable game input.

## Quality Guardrails

- Pixel-informed, crisp, and readable at phone size.
- No photorealism, soft blur, cheap sticker look, text labels, watermarks, or noisy neon.
- Animation should feel alive through subtle frame changes, not shaking the whole sprite.
- Do not generate or integrate rough placeholder/procedural character animation as a finished asset. For visible character, enemy, pet, crop, or card-effect animation, low-quality fallback frames are allowed only as temporary session placeholders when proper generation is failed/busy/unavailable; they are not a deliverable.

## Temporary Animation Placeholder Policy

- Allowed only when the proper image/animation generation path is failed, busy, unavailable, or blocked by a paid/key requirement. If generation is available and not busy, produce the high-quality final animation instead of a placeholder first.
- Purpose: keep animation wiring, frame timing, sprite-sheet import, or UI layout work moving in the current session.
- Must be explicitly named or reported as temporary. Prefer filenames with `_placeholder` or `_debug` if they enter the project.
- Must still obey technical constraints when possible: correct sheet dimensions, exact grid split, no invalid `.meta`, and no code paths that would break the runtime.
- Does not waive final quality standards. Before user testing or release, replace placeholders with approved art that passes frame-registration QA.
