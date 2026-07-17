---
name: game-assets
version: "2026.06.14.1"
description: Create, edit, and pipeline game assets with Meowa for pixel sprites, general large pixel characters/assets, character eight-direction multi-view sheets, HD assets, backgrounds, UI mockups, seamless loops, texture tiles, dual-grid tilesets, reusable map presets, isometric and hex map tiles, background removal, pixel cleanup, simple animation, sound effects, and music/BGM generation. Use when Codex needs to produce or refine game art or audio in this project, especially when choosing Meowa commands, searching preset map assets before generation, sizing canvases, selecting templates, generating music or SFX audio, or turning generated assets into game-ready files.
---

# Meowa Game Assets

This skill is a stable loader for the current Meowa game-assets guide.

## Agent Setup And API Workflow

This workflow is grounded in the Meowa Skill tutorial source recorded at
`projects/Simulaid/artifacts/meowa-bv1x8g26heyR-source/source-evidence.md`.

1. Install or load the Meowa skill before generation. If an owner gives a
   skill link, use that link only for the approved project/global scope.
2. Fetch the latest dynamic guide with `skill-doc` before selecting commands.
   The bundled `meowart_api.md` is only the offline fallback.
3. Connect the Meowa API through environment variables or a local ignored
   `.env`. The owner creates the API key on Meowa; do not print, paste, log, or
   commit the key. If a key is missing, stop and ask the owner to configure it.
4. Let the agent inspect the target project before spending credits: source
   style, asset names, pixel dimensions, animation frame count, import path,
   and replacement code should be known before generation.
5. For high-quality output, do not reroll blindly. First inspect available
   templates or presets, pick the template closest to the desired subject,
   pixel size, and asset role, and use `--dry-run` when the command supports it.
6. Generate into a task-specific output directory, then review dimensions,
   alpha/background, frame count, loop quality, contact sheets, and game import
   compatibility before replacing in-game assets.
7. Generate one representative sample first for paid or high-volume tasks.
   Continue batching only after the sample passes human or project QA.

## Required First Step

Before choosing any Meowa command or workflow, fetch the latest guide:

```bash
python3 meowart_api.py skill-doc --task "<brief user request>"
```

If you are already in the `skills/game-assets/` directory, use:

```bash
python3 ./meowart_api.py skill-doc --task "<brief user request>"
```

If you are calling the script from the skill repository root, use:

```bash
python3 skills/game-assets/meowart_api.py skill-doc --task "<brief user request>"
```

Follow the returned Markdown for command selection, API details, templates,
output directories, and validation steps. The command automatically falls back
to bundled `meowart_api.md` if the remote guide is unavailable.

## Diagnostics

Use these commands when the dynamic guide or runner version needs inspection:

```bash
python3 meowart_api.py skill-doc-status --check
python3 meowart_api.py bootstrap-status --check
```

`meowart_api.py` also has a bootstrap wrapper. Normal command runs silently
check the remote runner manifest, download a newer checksummed runner when
available, and execute that cached runner. This updates the CLI runner only.
Changes to this loader file still require reinstalling/updating the skill and
restarting Codex.

## Fixed Rules

- Do not expose API keys, developer keys, signed URLs, or other secrets in chat.
- Prefer environment variables or a local `.env` for credentials.
- Do not call bare `/generate` or `/api/generate`; use the current guide for the correct Meowa endpoint.
- Before paid generation, check credits when feasible and record the command,
  job id, output directory, and validation result in the task artifact/status.
- If generated output is too large, off-style, or otherwise poor, inspect and
  switch to a better matching template before spending more credits on rerolls.
- For animation, start from an approved source image, explicitly check or set
  output size and frame count, and reject loops with bad registration, unstable
  baseline, or obvious motion artifacts.
- For SFX/music, specify duration/count or loop intent, generate variants only
  within the approved cost envelope, and integrate only the selected result.
- For pixel assets, previews and manual resizing must use nearest-neighbor sampling.
- Do not manually shrink pixel art for display; if a smaller final asset is needed, use the workflow or post-processing path specified by the current guide.
- Generated outputs should be placed in an explicit task directory so the files are easy to inspect and reuse.
- Yutu6 office assets under `/Users/yutu6/玉兔6工作区/projects/控制台` must pass `projects/控制台/tools/office-image-template-check.js --spec <generation-spec.json>` before generation. They need a template ID plus an owner-approved reference image from `projects/控制台/templates/office-image/reference-manifest.json`; only `office.reference.sheet.v3` may be generated as a pending reference draft without a prior reference. Current V3 is spec-only pending: do not call imagegen or Meowa until the owner approves `projects/控制台/templates/office-image/reference-v3-brief.md`.
- V3 office generation must preserve complete integer-grid footprints: 2x2 normal workstations, 5x5 chairman office with 2x3 main zone, no missing corners, no white animation halo, and finger-only typing motion.
