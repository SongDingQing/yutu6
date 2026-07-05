# Quick Context

Local module name: `hermes-yutu-voice-bridge`.

Purpose: make Hermes, called 玉兔 by the user, support local voice wake, spoken replies, Feishu-visible records, Feishu confirmation cards for tasks, Codex handoff for coding work, persistent ASR correction/hotwords, and Brave Search for live web queries.

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

Current important behavior:

- Wake phrases include variants of `玉兔玉兔` and `Hermes听令`.
- Voice startup message is `重启完成`.
- Static thinking cue is `好的主人，让我想一下` with a 0.5 second delay.
- Silence duration is currently 1.4 seconds.
- Time fast replies use natural Chinese 12-hour format.
- Voice replies are mirrored to Feishu as `【语音回复记录】`.
- Voice tasks send Feishu cards titled `Command Required: Voice Task`.
- Coding tasks use Codex handoff cards titled `Command Required: Codex Handoff`.
- ASR correction can be persisted from Feishu with `纠错：错词=>正确词`.
- Hotwords can be persisted from Feishu with `热词：词1、词2`.
- Repeated high-value ASR terms auto-promote to hotwords after 3 appearances.
- Brave Search is available through the `brave_search` plugin tool.

Do not inspect global Hermes code first. Use this module to narrow the target.
