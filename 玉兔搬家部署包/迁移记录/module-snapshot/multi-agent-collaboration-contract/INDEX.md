# Multi-Agent Collaboration Contract

This module is the durable shared map for Hermes/Yutu, Codex, and future local agents.

It defines:

- persistent agent capabilities
- handoff rules
- input/output contracts
- confirmation boundaries
- discovery flow for future sessions

## Read Order

1. `quick-context.md`
2. `private-agent-ecosystem-roadmap.md` for the user's long-term private multi-agent ecosystem intent.
3. `agent-capabilities.md`
4. `handoff-contracts.md`
5. `io-contracts.md`
6. `module-discovery.md`
7. `operations.md`
8. `troubleshooting.md`
9. `change-log.md`

## Classification Logic

- User asks who can do what: read `agent-capabilities.md`.
- User asks about the overall private agent ecosystem, queues, deadlock prevention, sidecar server, game workflow, ASR, large files, or long-term roadmap: read `private-agent-ecosystem-roadmap.md`.
- User asks how Hermes should call Codex or vice versa: read `handoff-contracts.md`.
- User asks for exact fields, cards, files, or message formats: read `io-contracts.md`.
- User asks how future conversations remember this: read `module-discovery.md`.
- User adds another agent: update `agent-manifest.json`, then docs.

## Related Modules

- `/Users/yutu/.codex/modules/hermes-yutu-voice-bridge`

## Safety

- Do not store API keys, auth tokens, cookies, or full `.env` contents.
- Store capability names, interface names, local paths, and non-secret IDs only.
- Actions that send messages, email, files, APKs, or modify local projects require explicit user confirmation unless the user has already confirmed in the current trusted flow.
