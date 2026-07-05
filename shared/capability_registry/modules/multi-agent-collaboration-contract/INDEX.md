# Multi-Agent Collaboration Contract

This module is the durable shared map for Hermes/Yutu, Codex, and future local agents.

## Current Yutu6 Locations

- Active workspace root: `/Users/yutu6/玉兔6工作区`
- Active capability registry: `/Users/yutu6/玉兔6工作区/shared/capability_registry/registry.json`
- Active module root: `/Users/yutu6/玉兔6工作区/shared/capability_registry/modules/`
- Active control-plane project: `/Users/yutu6/玉兔6工作区/projects/控制台`
- Historical `/Users/yutu/...` and `/Users/yutu/.codex/modules/...` paths in older reference notes are legacy migration context only. Do not use them as current write or lookup targets on 玉兔6.

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

- `/Users/yutu6/玉兔6工作区/shared/capability_registry/modules/hermes-yutu-voice-bridge`

## Safety

- Do not store API keys, auth tokens, cookies, or full `.env` contents.
- Store capability names, interface names, local paths, and non-secret IDs only.
- Actions that send messages, email, files, APKs, or modify local projects require explicit user confirmation unless the user has already confirmed in the current trusted flow.
