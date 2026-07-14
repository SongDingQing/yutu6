# Meowa IO Contracts

## Discovery

```bash
export YUTU6_ROOT="${YUTU6_ROOT:-$HOME/yutu6}"
python3 "$YUTU6_ROOT/shared/tools/meowa/meowart_api.py" \
  skill-doc --task "<brief user request>"
```

Use the returned guide and `shared/tools/meowa/meowart_api.md` to select the exact command.

## Authentication

The CLI resolves `MEOWART_API_KEY` from the process environment, the private file named by `YUTU6_SECRETS_ENV`, or `~/.config/yutu6/providers.env`. It may retain a legacy private-file fallback for upgraded installations.

Agents must not pass the key on the command line, print it, or copy it into project files.

## Balance Check

```bash
python3 "$YUTU6_ROOT/shared/tools/meowa/meowart_api.py" credits-balance
```

Exit code `0` means authentication and reachability are available. Reports may contain credit fields, but never an API key or Authorization header.

## Asset Generation

```bash
python3 "$YUTU6_ROOT/shared/tools/meowa/meowart_api.py" \
  <selected-command> \
  --output-dir "$YUTU6_ROOT/projects/<projectId>/artifacts/meowa/<taskId>" \
  <command-specific-args>
```

Required caller inputs:

- `taskId` and `projectId`
- `assetType`
- concise requirement
- explicit output directory
- optional approved reference files

Output contract:

- CLI exit code and provider job ID, when present
- every generated local file path
- template/command notes
- no signed URLs, provider keys, or base64 payloads in task reports

## Yutu6 Office Asset Gate

Assets for the built-in office UI must pass the local image template gate:

```bash
node "$YUTU6_ROOT/projects/控制台/tools/office-image-template-check.js" \
  --spec "<generation-spec.json>"
```

Official office people, tiles, workstations, and animations require an approved template and reference image. Free-form prompts are drafts and cannot replace approved runtime assets.

## Multi-Agent Rule

Authorized agents discover this module through `shared/capability_registry/registry.json`. Project departments receive authorization through their project package; they do not receive a private CLI copy or duplicated key.
