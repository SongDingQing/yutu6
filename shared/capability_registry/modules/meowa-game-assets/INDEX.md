# Meowa Game Assets Module

This module registers Meowa as a shared tool capability for the local multi-agent system.

Use this module before installing any agent-private Meowa skill or copying API keys into a project.

## Read Order

1. `quick-context.md` for the current shared setup.
2. `io-contracts.md` for the exact command shape and output contract.
3. `operations.md` for validation and maintenance commands.
4. `README.md` for capability notes and ownership.

## Classification Logic

- Pixel sprites, game icons, item art, HD transparent assets, tilesets, texture tiles, map tiles, animation, sound effects, or BGM: use this module.
- LLM text/image reasoning through OpenAI-compatible APIs: use `new-api` / runner routing instead; Meowa is not an OpenAI-compatible model provider.
- GUI clicking and screen inspection: use Peekaboo; Meowa can generate or process visual assets but does not replace desktop control.

## Safety Notes

- Do not print, commit, paste, or store `MEOWART_API_KEY` outside the unified local secrets file.
- Report only key names, balance, command status, and artifact paths.
- Unregistered project work is excluded until a project capability pack defines ownership and output paths.
