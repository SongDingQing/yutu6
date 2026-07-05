# Meowa IO Contracts

## Discovery

Before choosing a command:

```bash
python3 /Users/yutu6/玉兔6工作区/shared/tools/meowa/meowart_api.py \
  skill-doc --task "<brief user request>"
```

Use the returned guide plus `shared/tools/meowa/meowart_api.md` to select the exact command.

## Authentication

The CLI resolves authentication in this order:

1. Explicit `MEOWART_API_KEY` in the process environment.
2. Unified local secrets file at `/Users/yutu6/.config/yutu6-secrets/secrets.env`.
3. A secrets file specified by `YUTU6_SECRETS_ENV`.
4. Local `.env` files supported by the upstream CLI.

Agents must not pass the key on the command line and must not print it.

## Balance Check

Input:

```bash
python3 /Users/yutu6/玉兔6工作区/shared/tools/meowa/meowart_api.py credits-balance
```

Output contract:

- Command exit code `0` means authentication and API reachability are OK.
- Report the balance/credit fields if present.
- Never report the API key or Authorization header.

## Asset Generation

Standard command shape:

```bash
python3 /Users/yutu6/玉兔6工作区/shared/tools/meowa/meowart_api.py \
  <selected-command> \
  --output-dir "<absolute-output-dir>" \
  <command-specific-args>
```

Required caller inputs:

- `task`: short task id or human-readable brief.
- `asset_type`: pixel sprite, HD transparent PNG, tileset, texture, map tile, animation, SFX, or music.
- `requirement`: concise art/audio requirement.
- `output_dir`: absolute path for generated files.
- Optional `reference_file` or `reference_files`.

Output contract:

- Return the CLI exit code.
- Capture the job id if the command prints one.
- Return every generated local file path.
- Return a concise notes field with template/command used.
- Do not paste signed URLs, provider keys, or large base64 payloads into chat or reports.

## Yutu6 Office Asset Gate

For `/Users/yutu6/玉兔6工作区/projects/控制台` office assets, agents must apply the local office image contract before calling Meowa:

```bash
node /Users/yutu6/玉兔6工作区/projects/控制台/tools/office-image-template-check.js \
  --spec "<generation-spec.json>"
```

The spec must include a `templateId` from `/Users/yutu6/玉兔6工作区/projects/控制台/templates/office-image/image-granularity-templates.json` and a `referenceImage` approved in `/Users/yutu6/玉兔6工作区/projects/控制台/templates/office-image/reference-manifest.json`.

Do not generate official Yutu6 office people, tiles, workstations, or animations from free-form prompts without the approved reference sheet. The only exception is creating `office.reference.sheet.v3` as a pending owner-review draft.

Current V3 state is spec-only pending. Agents must not call imagegen or Meowa for V3 until the owner approves `/Users/yutu6/玉兔6工作区/projects/控制台/templates/office-image/reference-v3-brief.md`.

V3 hard constraints:

- Normal workstations are complete 2x2 source tiles, never 1x1 desks scaled up.
- Chairman office is a complete 5x5 integer-grid component with a clear 2x3 main desk/standing zone.
- Tiles and workstations must have complete joinable boundaries with no missing corners.
- Animation sources must be matte-cleaned; no white halo around hair, hands, desk, or chair.
- Typing animation keeps hands/wrists anchored and moves fingers only.

## Recommended Output Locations

- Simulaid game-ready assets: `/Users/yutu6/TuanjieProjects/Simulaid/Assets/Resources/GeneratedPixel/<task-id>/`
- Control-plane test artifacts: `/Users/yutu6/玉兔6工作区/projects/控制台/artifacts/meowa/<task-id>/`
- Temporary experiments: `/Users/yutu6/玉兔6工作区/shared/artifacts/meowa/<task-id>/`

## Multi-Agent Rule

Authorized agents discover this module through `shared/capability_registry/registry.json`, read this contract, and call the shared CLI. New agents are added by extending the authorized list; they do not get a copied key or a private CLI.
