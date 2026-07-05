---
name: hermes-yutu-voice-bridge
description: Use when the user asks about 玉兔/Hermes voice wake, Feishu voice records, voice task confirmation cards, Codex handoff, ASR hotwords/corrections, Brave Search in Hermes, or debugging the Mac mini Hermes voice workflow. Read the module index first instead of scanning the full Hermes codebase.
---

# Hermes Yutu Voice Bridge

This skill is a lightweight entry point for the persistent local module docs.

Module directory:

`/Users/yutu/.codex/modules/hermes-yutu-voice-bridge`

Start with:

`/Users/yutu/.codex/modules/hermes-yutu-voice-bridge/INDEX.md`

Then read only the relevant reference file:

- `quick-context.md`: shortest current-state summary.
- `feature-map.md`: choose voice, Feishu, ASR, Codex handoff, or Brave Search subsystem.
- `io-contracts.md`: inputs and outputs for records, cards, corrections, and tools.
- `file-map.md`: exact files to inspect before editing.
- `operations.md`: restart, validation, and logs.
- `troubleshooting.md`: known symptoms and fixes.
- `change-log.md`: what was changed so far.

Rules:

- Do not print secrets from `/Users/yutu/.hermes/.env`.
- Address the user as `主人`.
- If the Hermes/Yutu work affects YuanXiao/元宵/汤圆, ChangE/嫦娥, Legend/传奇, mobile control-plane behavior, reminders, queues, sessions, files, notifications, or the `.codex` skills/modules/helper scripts/workflow memory that govern those flows, invoke `yuanxiao-command-expander` first and produce `元宵指令补齐稿` before implementation.
- For Codex-triggered Yutu/Hermes Feishu reminders, call `/Users/yutu/.codex/modules/hermes-yutu-voice-bridge/scripts/send_yutu_reminder.py --context "<short context>" "<result>"`; it automatically applies the persistent `主人，前情提要：...` prefix. Use the raw text rule only if this helper is unavailable.
- Normal Yutu voice speed is `voice_speed_multiplier: 1.0`; do not raise it again unless the user explicitly asks for faster speech.
- Prefer these module docs before broad `rg` searches across `/Users/yutu/.hermes/hermes-agent`.
- If code edits are needed, edit the owning files listed in `file-map.md` and run the validation from `operations.md`.
