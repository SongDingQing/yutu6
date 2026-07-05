# Meowa Game Assets

Meowa is a proprietary game-asset API exposed locally through the shared CLI:

```bash
python3 /Users/yutu6/玉兔6工作区/shared/tools/meowa/meowart_api.py <command>
```

It is a tool capability, not an LLM provider. It sits beside `new-api`, not inside it.

## Capability List

- Pixel sprites, characters, monsters, props, items, icons, and UI small art.
- HD non-pixel assets such as transparent PNG characters, icons, and item packs.
- Background concepts and UI mockups through the supported Meowa/Gemini wrapper commands.
- Seamless self-loop images, pixel textures, dual-grid tilesets, isometric map tiles, and hex map tiles.
- Background removal, pixel cleanup/pixelate, simple animation loops.
- Sound effects, SFX packs, and music/BGM generation.

## Shared Ownership

- Shared CLI: `shared/tools/meowa/meowart_api.py`.
- Shared docs copied from the Meowa `game-assets` skill: `shared/tools/meowa/SKILL.md` and `shared/tools/meowa/meowart_api.md`.
- Unified key source: `MEOWART_API_KEY` in `/Users/yutu6/.config/yutu6-secrets/secrets.env`.
- The CLI also honors `YUTU6_SECRETS_ENV` when a different local secrets file is needed.

## Authorized Agents

Initial authorized callers:

- `secretary`
- `codex`
- `supervisor-Simulaid`

This list is intentionally extensible. Add a new agent here and in `module.json`, then require that agent to follow `io-contracts.md`; do not install a separate CLI or copy the key.

## Codex Convenience Skill

Codex may install the upstream skill as a convenience loader:

```bash
npx skills add https://github.com/Meowa-AI/meowa-skills --skill game-assets -a codex
```

Even if that private skill is installed, the shared CLI and unified key source in this module remain the source of truth.
