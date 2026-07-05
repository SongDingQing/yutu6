# Quick Context

- Meowa is now a shared capability under `shared/tools/meowa/`, not a Codex-only private skill.
- Use `python3 /Users/yutu6/玉兔6工作区/shared/tools/meowa/meowart_api.py skill-doc --task "<brief>"` before choosing a generation command.
- The key name is `MEOWART_API_KEY`; the value lives only in `/Users/yutu6/.config/yutu6-secrets/secrets.env`.
- The shared CLI was patched to read that unified secrets file before local `.env` files.
- Generated assets must go to an explicit output directory, usually the requesting project artifact folder, such as `/Users/yutu6/TuanjieProjects/Simulaid/Assets/Resources/GeneratedPixel/` or a project `artifacts/meowa/<task-id>/` folder.
- Starlaid is excluded unless the user explicitly asks for it.
