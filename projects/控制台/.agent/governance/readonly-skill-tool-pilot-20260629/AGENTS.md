# Agent Entry: Console Readonly Tool Governance Pilot

This directory is a readonly evaluation artifact. It does not edit governed
source files, does not install an external runtime, and does not create a
runtime contract. Any field here that should affect execution later requires a
separate `.js` consumer and regression tests.

Location:
`projects/控制台/.agent/governance/readonly-skill-tool-pilot-20260629/`

Status: `pilot_only` / `readonly_governance` / `not_runtime_contract`

## Scope

This pilot covers three existing Console objects. All three are `kind: tool`;
this round does not evaluate any `skill` object.

| ID | Entry | What it is |
|---|---|---|
| `console.engine.review_loop` | `node projects/控制台/engine-runner.js --spec <file>` | Async supervisor review-loop worker using eventlog, taskstore and run directories |
| `console.secretary.queue_organize` | `node projects/控制台/secretary-tools.js queue-organize ...` | Secretary queue organizer, dry-run by default and write-capable with explicit apply |
| `console.tools.serial_smoke_test` | `node projects/控制台/tools/serial-smoke-test.js` | Control-plane serial smoke that creates an isolated fixture and evidence artifacts |

## How To Use

- Read `llms.txt` first for the compact agent-facing summary.
- Read `apm.yml` for source, license, permission, risk and human-review fields.
- Read `apm.lock.yaml` when verifying hashes.
- Verify hashes with `shasum -a 256 <hash_object>`.
- Treat the current lock as a working-tree snapshot at its `git.head_short`; if
  the source file changed after that snapshot, a verification mismatch is
  expected and must be recorded, not silently ignored.

## Hash Rule

- Algorithm: SHA256.
- Object: the full working-tree bytes of each listed project-relative
  `hash_object` file.
- The workspace was already dirty when this pilot was refreshed, so reproducible
  verification is scoped to the lock snapshot, not a clean release commit.

## License Rule

- If no repository-level or file-level license is found, record
  `license: UNKNOWN`.
- `UNKNOWN` must not be guessed into MIT, Apache, internal, or proprietary.
- Until the owner confirms a license policy, treat these local files as internal
  project code and set `requires_human_review: true`.

## Permission Risk Tiers

| Tier | Permission examples | Default review |
|---|---|---|
| low | `file_read` within explicit project scope | no human review if license is known and no higher tier exists |
| medium | `file_write`, `queue_mutation`, `gui_control`, `notification_send` | human review required |
| high | `process_spawn`, `network_request`, `external_model_call`, `secret_env_access`, `env_mutation`, `install_dependency`, `git_operation`, `destructive_delete`, `cross_project_write` | human review required |

Set `requires_human_review: true` when any medium/high permission is present, or
when `license: UNKNOWN`.

Permission fields list capability names and intended use only. They must never
include token values, env var values, cookies, private keys, passwords, or login
steps.

## Boundaries

- Do not install `apm` or any external runtime for this pilot.
- Do not edit the governed source files as part of this governance note.
- Do not use these entries as an automatic routing whitelist.
- Do not trigger the listed high-side-effect capabilities during this readonly
  metadata refresh.
- Do not read or print secrets.
- Login, OAuth, 2FA, token entry and system authorization stay with the owner.
- Starlaid/星桥 is excluded.
