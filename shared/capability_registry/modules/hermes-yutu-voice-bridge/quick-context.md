# Quick Context

Local module name: `hermes-yutu-voice-bridge`.

Purpose: make Hermes, called 玉兔 by the user, support local voice wake, spoken replies, Feishu-visible records, Feishu confirmation cards for tasks, Codex handoff for coding work, persistent ASR correction/hotwords, and Brave Search for live web queries.

Local deployment note: Hermes Agent runs on the same Mac mini that Codex can access. Codex can modify Hermes/Yutu files when the user asks, but changes should be scoped through this module's file map and validated before restarting services.

Main persistent files:

- `/Users/yutu/.hermes/voice-wake/hermes_voice_wake.py`
- `/Users/yutu/.hermes/voice-wake/config.json`
- `/Users/yutu/.hermes/voice-wake/asr-context.json`
- `/Users/yutu/.hermes/voice-wake/voice-preferences.json`
- `/Users/yutu/.hermes/plugins/codex-handoff/__init__.py`
- `/Users/yutu/.hermes/plugins/voice-asr-context/__init__.py`
- `/Users/yutu/.hermes/plugins/brave-search/__init__.py`
- `/Users/yutu/.hermes/config.yaml`

Services:

- Voice listener: `com.yutu.hermes.voicewake`
- Hermes gateway: `ai.hermes.gateway`
- Hermes API server is exposed by gateway at `127.0.0.1:8642`.
- Hermes dashboard may run at `127.0.0.1:9119`.
- Voice listener LaunchAgent is configured with `RunAtLoad: true` so it starts after login/reload.

Current important behavior:

- Wake phrases include variants of `玉兔玉兔` and `Hermes听令`.
- Voice startup message is `主人，重启完成`.
- Wake acknowledgement is `主人，我在`.
- Static received-command cue is `主人，收到` with a 0.5 second delay.
- Yutu voice replies must begin with `主人`; Codex-triggered spoken messages and Feishu reminders must begin with `主人，前情提要：...`, then give the result.
- Voice speed has been restored to normal: `voice_speed_multiplier` is `1.0`, and the active Edge Xiaoyi profile uses `+0%`.
- Active adjusted voice is `edge_xiaoyi`; if logs show `No module named 'edge_tts'`, the bridge falls back to macOS `say` and the voice will sound wrong.
- Silence duration is currently 1.4 seconds.
- Time fast replies use natural Chinese 12-hour format.
- Voice replies are mirrored to Feishu as `【语音回复记录】`.
- Ordinary Feishu text follow-ups are queued while Hermes is busy instead of interrupting; rapid text fragments are appended as separate lines.
- Feishu text batching waits about 1.5 seconds before dispatching ordinary text to Hermes.
- Voice tasks send Feishu cards titled `Command Required: Voice Task`.
- Coding tasks use Codex handoff cards titled `Command Required: Codex Handoff`.
- Codex handoff now supports document/file return requests: when the task asks to send/upload/return a document, Hermes looks for newly generated or modified `.md`, `.txt`, `.pdf`, `.docx`, `.xlsx`, or `.pptx` files and sends them back to the same Feishu chat.
- Codex handoff writes latest run status to `/Users/yutu/.hermes/codex-handoff/latest-status.json` so Hermes can answer whether Codex completed a recent task.
- Codex handoff queue audit files are recovered on Hermes gateway startup; `/codex-queue` shows queue state and `/codex-cancel <id>` cancels queued-but-not-running work.
- Codex handoff supports confirmed delayed/recurring scheduled tasks through Hermes cron. The tool is `codex_handoff_schedule`; pending schedule cards use `Command Required: Codex Scheduled Handoff`; generated runner scripts live under `/Users/yutu/.hermes/scripts/codex-handoff`.
- ASR correction can be persisted from Feishu with `纠错：错词=>正确词`.
- Hotwords can be persisted from Feishu with `热词：词1、词2`.
- Repeated high-value ASR terms auto-promote to hotwords after 3 appearances.
- Brave Search is available through the `brave_search` plugin tool.

Do not inspect global Hermes code first. Use this module to narrow the target.

For Hermes modifications, prefer plugin/config/sidecar changes first. Be conservative with Feishu gateway internals because breaking them can break the user's primary front door.

Migration package for future agents/human developers:

`/Users/yutu/Desktop/Hermes-Yutu-Migration-Records`
