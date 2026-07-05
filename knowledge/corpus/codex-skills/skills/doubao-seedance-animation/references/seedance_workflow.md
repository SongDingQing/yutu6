# Simulaid Seedance keyframe animation workflow

This reference records the persistent, non-secret workflow for using Volcengine Doubao Seedance as an external animation backend for Simulaid.

## Persistent config

- Secret key: macOS Keychain service `simulaid-volcengine-seedance`, account `ark-api-key`.
- Non-secret config: `/Users/yutu/.codex/private/simulaid-seedance-config.env`.
- Default model display name: `Doubao-Seedance-2.0`.
- Do not store the API key in this repository, a skill file, or Feishu output.

## Prompt checklist

Every animation prompt should include:

1. Asset role: dog/player/enemy/card FX/UI FX/crop/watering/etc.
2. Simulaid style reference category and any reference paths.
3. Exact motion cycle: e.g. tail angle range, body bob amplitude, tongue disabled/enabled, attack anticipation, recovery frame.
4. Loop rules: first frame and final frame must close cleanly.
5. Stability rules: fixed feet/bottom baseline, no drifting center, no camera shake unless explicitly wanted.
6. Negative constraints: no duplicate bodies, no extra limbs, no split seams, no sprite-sheet collage embedded as one frame, no random text, no black borders.
7. Output plan: fps, duration, frames, sprite-sheet layout, target size.

## Unity acceptance checklist

After generating and packing frames, check:

- PNG dimensions match the intended sheet layout.
- Each frame has the same visible subject scale and baseline.
- Max Size/compression/mipmap/read-write settings fit the runtime use.
- No accidental giant sheet frame appears in a frame animation.
- Resource path and name match code references.
- Package size impact is noted for 玉龙/玉玲珑 asset acceptance.
