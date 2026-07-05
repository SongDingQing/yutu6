---
name: doubao-seedance-animation
description: Use when the user asks to generate Simulaid animations with 火山引擎, Volcengine, Doubao Seedance, Seedance 2.0, keyframes/关键帧, image-to-video, or video-to-sprite-sheet workflows. Coordinates with simulaid-pixel-art-assets and simulaid-animation-assets while keeping API secrets outside repo and skill files.
---

# Doubao Seedance Animation

## Purpose

Use this skill to generate Simulaid animation assets from still keyframes through Volcengine Doubao Seedance, then convert the generated motion into Unity-ready sprite sheets that obey Simulaid's pixel-art, loop, alignment, and runtime-performance rules.

This skill is a backend companion to:
- `/Users/yutu/.codex/skills/simulaid-pixel-art-assets/SKILL.md` for Simulaid visual style, quality, filenames, and Resources placement.
- `/Users/yutu/.codex/skills/simulaid-animation-assets/SKILL.md` for animation frame counts, loop continuity, baseline registration, sprite-sheet packing, and QA.
- `/Users/yutu/.codex/skills/.system/imagegen/SKILL.md` when still keyframes or replacement still art must be generated before video motion.

## Secret and config policy

Never write API keys into:
- Simulaid project files.
- `SKILL.md`, `references/`, scripts, README, docs, logs, or version history.
- Feishu/Yutu reports.

The default persisted secret location is macOS Keychain:

```bash
security find-generic-password -w \
  -s simulaid-volcengine-seedance \
  -a ark-api-key
```

Non-secret defaults live at:

```text
/Users/yutu/.codex/private/simulaid-seedance-config.env
```

The helper script also accepts `VOLCENGINE_ARK_API_KEY` from the environment, but Keychain is preferred for persistence. Do not print the key; only report whether a key is present.

## When to use network generation

Only submit prompts, reference images, keyframes, or storyboards to Volcengine when the user explicitly asks to generate/regenerate animation assets with Seedance or 火山引擎. For planning, dry-run, prompt drafting, or code refactor work, produce a local job spec only.

Before network submission, be aware that prompts and referenced keyframe images/videos leave the local machine for Volcengine processing. If the request contains unreleased/private art, still proceed when the user explicitly requested generation, but avoid sending unrelated files.

## Default Simulaid animation target

Unless the user says otherwise:

- Model display name: `Doubao-Seedance-2.0`.
- Frame rate: `30 fps`.
- Short loop: `30 frames / 1 second`.
- Sprite sheet: `6 columns × 5 rows` for 30-frame loops.
- Stable registration: character/object baseline fixed; do not allow drifting centers.
- Runtime folder: `/Users/yutu/Simulaid/Assets/Resources/GeneratedPixel/`.
- Work folder: `/Users/yutu/Simulaid/Temp/SeedanceAnimationJobs/`.
- Prefer high-quality final assets, not low-quality placeholders.

For longer effects, explicitly define duration, frame count, loop closure, and target sheet layout before generating.

## Workflow

1. **Load Simulaid style rules**
   - Read `simulaid-pixel-art-assets` for asset category, reference style, filename, and Unity import assumptions.
   - Read `simulaid-animation-assets` for frame counts, alignment, loop closure, and QA.

2. **Pick or create keyframes**
   - Reuse same-category Simulaid references whenever possible.
   - If new stills are needed, use `imagegen` first and keep style consistent with existing assets.
   - Keyframes should describe only the moving subject unless a full-scene animation is truly required.
   - For dog/player/enemy sprites, use explicit orientation and baseline instructions.

3. **Prepare a Seedance job spec**
   - Use `scripts/seedance_keyframe_job.py --dry-run` to create a sanitized JSON spec.
   - Keep the prompt concrete: subject, motion arc, loop requirement, camera stability, no drifting, no extra limbs, no duplicate subjects, and no frame-sheet collage artifacts.
   - Include `negative_prompt` style constraints when the API/model supports it.

4. **Generate with Volcengine only when requested**
   - The exact endpoint/model identifier can change; verify against the official Volcengine Ark/Seedance docs before changing endpoint defaults.
   - If the model ID is rejected, stop, check the current docs/console model name, then update only the private config or command argument.
   - If local keyframe uploads are unsupported by the endpoint, upload references through the approved Volcengine-supported method or stop and report.

5. **Extract and normalize frames**
   - Download the generated video to the work folder.
   - Extract frames at the target fps.
   - Pixelize/resize/crop consistently if required by the asset type.
   - Fix transparency/chroma key if Seedance returns an opaque background and the asset needs alpha.

6. **Build the sprite sheet**
   - Pack frames into the agreed layout, e.g. 6×5 for 30 frames.
   - Preserve frame order and loop closure.
   - Output PNG under `Assets/Resources/GeneratedPixel/` with the Simulaid naming convention.

7. **QA before handoff**
   - Verify all frames share canvas size, baseline, and center anchor.
   - Check first/last frame continuity for loops.
   - Confirm no sheet-collage frame accidentally appears inside runtime animation.
   - Confirm file size, Max Size, mipmap, Read/Write, compression, and atlas expectations if integrated into Unity.

## Helper script

Use the local helper for safe config/key checks and dry-run job specs:

```bash
python3 /Users/yutu/.codex/skills/doubao-seedance-animation/scripts/seedance_keyframe_job.py \
  --check-key \
  --dry-run \
  --prompt "30-frame idle loop, stable paws and baseline..." \
  --keyframe /absolute/path/to/first_keyframe.png \
  --duration 1 \
  --fps 30 \
  --size 1024x1024
```

The script must never print the API key. `--submit` is available only for explicit generation work and relies on current Volcengine endpoint/model configuration.

## Failure handling

- Missing key: ask the user to provide/refresh the Keychain secret; do not continue with fake output.
- 401/403: stop and report likely key, account, permission, or model-access issue.
- Quota/rate limit: stop and report the raw non-secret error summary.
- Model not found: verify current official docs/model console; do not invent a model ID.
- Bad generation quality: regenerate with stricter prompt and references; do not silently accept placeholder quality.
- Alignment drift: repair or regenerate before importing; drifting animation is not acceptable for Simulaid runtime assets.

## Official reference

Current Volcengine/Ark Seedance docs should be checked before changing API payloads or endpoints:
- <https://www.volcengine.com/docs/82379/1393047>
- <https://www.volcengine.com/docs/82379/1520757?lang=zh>
