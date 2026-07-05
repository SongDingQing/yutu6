---
name: multi-agent-collaboration-contract
description: Use when the user discusses Hermes/Codex multi-agent collaboration, agent capability directories, handoff contracts, cross-agent interfaces, persistent agent memory, Feishu confirmation routing, or future agent migration. Read the shared module contract before broad code search.
---

# Multi-Agent Collaboration Contract

This skill is Codex's entry point into the shared Hermes/Codex collaboration contract.

Read first:

`/Users/yutu/.codex/modules/multi-agent-collaboration-contract/INDEX.md`

Machine-readable manifest:

`/Users/yutu/.codex/modules/multi-agent-collaboration-contract/agent-manifest.json`

## Workflow

1. Read the module `INDEX.md`.
2. If deciding who should handle a task, read `agent-capabilities.md` and `handoff-contracts.md`.
3. If changing a route or card behavior, read `io-contracts.md`.
4. If making persistent changes, update `agent-manifest.json`, `module.json`, and `change-log.md`.
5. If the change affects Hermes behavior, update the matching Hermes skill or plugin references too.

## Rules

- Treat the module directory as the durable source of truth, not chat memory.
- Keep Hermes and Codex entries symmetrical when possible.
- Do not store or print secrets.
- Address the user as `主人`.
- Preserve explicit confirmation boundaries for email, files, APKs, and local project edits.

