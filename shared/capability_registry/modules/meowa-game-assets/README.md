# Meowa Game Assets

Meowa is an optional asset-generation API exposed through the shared CLI:

```bash
python3 "$YUTU6_ROOT/shared/tools/meowa/meowart_api.py" <command>
```

It is a tool capability, not an LLM provider.

## Capability List

- Pixel sprites, characters, props, items, icons, and UI art.
- Transparent PNG assets, backgrounds, textures, tilesets, map tiles, and animation loops.
- Optional sound effects and music generation supported by the upstream service.

## Shared Ownership

- Shared CLI: `shared/tools/meowa/meowart_api.py`.
- Shared documentation: `shared/tools/meowa/SKILL.md` and `shared/tools/meowa/meowart_api.md`.
- Key name: `MEOWART_API_KEY`.
- Default private file: `~/.config/yutu6/providers.env`.
- Override file: `YUTU6_SECRETS_ENV`.

## Authorized Agents

Initial callers are `secretary`, `codex`, and an installed project's `supervisor-<projectId>`. A project package may extend the authorization list, but must reuse this CLI and must never copy the key into its repository.
