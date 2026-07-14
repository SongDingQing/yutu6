# Troubleshooting

## Hermes Does Not Know Codex Should Handle A Task

Likely causes:

- Hermes did not consult the collaboration skill.
- The request did not match a handoff trigger.
- The task lacks a project path.

Fix:

- Check this module's `handoff-contracts.md`.
- Check Hermes skill `multi-agent-collaboration-contract`.
- For code work, ensure `codex-handoff` skill and plugin are enabled.

## Codex Does Not Know Existing Hermes Interfaces

Likely causes:

- Codex did not use the module registry skill.
- The relevant interface was documented only in chat, not in a module.

Fix:

- Read `$HOME/.codex/modules/INDEX.md`.
- Run `module_lookup.py`.
- Add missing contract details to this module.

## A New Agent Is Added But No One Routes To It

Likely causes:

- `agent-manifest.json` was not updated.
- No entry skill points to the manifest.
- No handoff contract defines when to use the new agent.

Fix:

- Add the agent to `agent-manifest.json`.
- Add a section in `agent-capabilities.md`.
- Add a route in `handoff-contracts.md`.
- Update registry keywords.

## Agents Ask For Known Information Again

Likely causes:

- Saved contacts or project conventions are not injected into that route.
- The task went through ordinary chat instead of a confirmed task route.

Fix:

- Add the known information to the relevant contract.
- Ensure task-like voice requests create a confirmation card.

