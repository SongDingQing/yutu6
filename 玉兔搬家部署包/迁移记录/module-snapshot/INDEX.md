# Hermes Yutu Voice Bridge Module

This module documents the local Hermes/Yutu voice bridge customizations on the Mac mini.

Registered by:

`/Users/yutu/.codex/modules/registry.json`

Use this directory before searching the full Hermes codebase when a task mentions:

- 玉兔, Hermes voice wake, microphone, TTS, ASR, wake words
- Feishu voice records, confirmation cards, Codex handoff
- ASR corrections, hotwords, misrecognition, repeated vocabulary
- Brave Search, live web search, "latest news", "联网"
- Sending voice-originated tasks to Codex or tools after Feishu confirmation

## Read Order

1. `quick-context.md` for the shortest current-state summary.
2. `feature-map.md` to choose the right subsystem.
3. `io-contracts.md` when changing behavior or debugging a flow.
4. `file-map.md` before editing files.
5. `operations.md` for restart, validation, and logs.
6. `troubleshooting.md` for known symptoms.

## Classification Logic

- Voice capture/listening issues: read `feature-map.md`, `io-contracts.md`, `operations.md`.
- Feishu card/record issues: read `io-contracts.md`, `file-map.md`, `troubleshooting.md`.
- Hotword/correction issues: read `io-contracts.md`, `operations.md`.
- Brave Search or "no internet" issues: read `feature-map.md`, `troubleshooting.md`.
- Codex handoff issues: read `io-contracts.md`, then inspect the codex-handoff plugin only if needed.

## Safety Notes

- Do not print `.env` contents or API keys.
- `BRAVE_SEARCH_API_KEY`, Feishu credentials, and Hermes API keys live in `/Users/yutu/.hermes/.env`.
- The user should be addressed as `主人`.
- Persistent services are LaunchAgents; avoid leaving manual duplicate processes running.
