# Change Log

## 2026-04-25 / 2026-04-26

Built local Hermes/Yutu voice and handoff workflow.

Major changes:

- Enabled voice wake service with local microphone capture.
- Added wake phrases for `玉兔玉兔` and `Hermes听令`.
- Added startup message `重启完成`.
- Added thinking cue `好的主人，让我想一下` with 0.5 second delay.
- Added TTS voice profile system and active cute voice profile.
- Added Markdown/emoji sanitization before speech.
- Added local fast reply for simple time/date questions.
- Changed time answers to natural Chinese 12-hour format.
- Increased silence duration to 1.4 seconds.
- Added Feishu voice reply records labeled `语音回复记录`.
- Added Feishu voice task confirmation card labeled `Command Required: Voice Task`.
- Added pending task storage under `/Users/yutu/.hermes/voice-wake/pending-tasks`.
- Extended codex-handoff plugin to handle voice task card actions.
- Added Codex handoff confirmation cards for local coding tasks.
- Added optional APK return behavior after Codex handoff.
- Added persistent contact notes in Codex contacts memory.
- Added ASR hotword/correction persistence plugin.
- Fixed ASR context save path bug.
- Fixed voice preference save bug that could overwrite ASR context.
- Added Feishu manual correction pattern `纠错：错词=>正确词`.
- Added Feishu manual hotword pattern `热词：词1、词2`.
- Added repeated-term ASR auto-learning with 3-count promotion threshold.
- Added Brave Search plugin and guidance for current/latest web queries.
- Fixed Feishu voice/Codex confirmation cards so after approve/cancel the original card is replaced with an already-confirmed or canceled status card.

Primary validation used:

- Python `py_compile`.
- JSON validation with `python3 -m json.tool`.
- YAML safe load.
- LaunchAgent status checks.
- Feishu test message/card.
- Brave Search smoke test without printing secrets.
