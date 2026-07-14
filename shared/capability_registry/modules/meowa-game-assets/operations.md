# Meowa Operations

```bash
export YUTU6_ROOT="${YUTU6_ROOT:-$HOME/yutu6}"
python3 -m py_compile "$YUTU6_ROOT/shared/tools/meowa/meowart_api.py"
python3 "$YUTU6_ROOT/shared/tools/meowa/meowart_api.py" --help
```

## Configure Locally

Store `MEOWART_API_KEY` in `~/.config/yutu6/providers.env` with mode `600`, or point `YUTU6_SECRETS_ENV` at another private env file. Never place it in the repository.

## Connectivity Check

```bash
python3 "$YUTU6_ROOT/shared/tools/meowa/meowart_api.py" credits-balance
```

Only the command status and non-secret credit information may be reported.

## Upgrade Shared CLI

Review upstream changes first, then replace the files under `shared/tools/meowa/`. Run syntax and help checks before committing. An upgrade must not overwrite the local private env file.
