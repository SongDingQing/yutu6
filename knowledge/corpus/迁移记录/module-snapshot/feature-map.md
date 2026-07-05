# Feature Map

## Voice Wake And Reply

Owner file: `/Users/yutu/.hermes/voice-wake/hermes_voice_wake.py`

Config file: `/Users/yutu/.hermes/voice-wake/config.json`

Responsibilities:

- Capture microphone audio.
- Detect wake phrases.
- Transcribe local audio through Hermes local STT.
- Play startup, wake acknowledgement, thinking cue, fast replies, and Hermes replies.
- Send spoken user command to local Hermes API.
- Mirror meaningful voice interactions to Feishu.

Key config keys:

- `wake_phrases`
- `startup_message`
- `wake_ack_message`
- `thinking_cue_message`
- `thinking_cue_delay_seconds`
- `silence_threshold`
- `silence_duration`
- `min_recording_peak_rms`
- `wake_only_min_recording_peak_rms`
- `active_voice_profile`
- `fast_reply_voice_profile`

## Feishu Voice Records

Owner file: `/Users/yutu/.hermes/voice-wake/hermes_voice_wake.py`

Responsibilities:

- Send text records to Feishu with label `语音回复记录`.
- Include timestamp, user voice text, 玉兔 reply, and correction hint.
- Send voice task confirmation cards for tool-like requests.

Key config keys:

- `feishu_sync_enabled`
- `feishu_voice_reply_sync_enabled`
- `feishu_sync_chat_id`
- `feishu_sync_receive_id_type`
- `voice_reply_sync_label`

## Voice Task Confirmation

Owner files:

- `/Users/yutu/.hermes/voice-wake/hermes_voice_wake.py`
- `/Users/yutu/.hermes/plugins/codex-handoff/__init__.py`

Responsibilities:

- Voice bridge sends `Command Required: Voice Task` Feishu card.
- Pending task is saved under `/Users/yutu/.hermes/voice-wake/pending-tasks`.
- Gateway plugin handles card button actions.
- Confirmed voice task is replayed into Hermes as an already-confirmed Feishu request.

Key config keys:

- `voice_task_forward_enabled`
- `voice_task_confirmation_card_enabled`
- `voice_task_pending_dir`
- `voice_task_forward_reply_message`

## Codex Handoff

Owner files:

- `/Users/yutu/.hermes/plugins/codex-handoff/__init__.py`
- `/Users/yutu/.hermes/skills/autonomous-ai-agents/codex-handoff/SKILL.md`

Responsibilities:

- Recognize coding/project/Unity/APK tasks in Feishu.
- Ask for missing project path if needed.
- Send `Command Required: Codex Handoff` card.
- After confirmation, run local Codex CLI.
- Optionally send APK artifacts back to Feishu.

## ASR Corrections And Hotwords

Owner files:

- `/Users/yutu/.hermes/plugins/voice-asr-context/__init__.py`
- `/Users/yutu/.hermes/skills/autonomous-ai-agents/voice-asr-context/SKILL.md`
- `/Users/yutu/.hermes/voice-wake/asr-context.json`
- `/Users/yutu/.hermes/voice-wake/asr-learning.json`

Responsibilities:

- Persist correction mappings.
- Persist ASR hotwords.
- Parse Feishu messages like `纠错：错词=>正确词`.
- Parse Feishu messages like `热词：词1、词2`.
- Auto-promote repeated important terms into hotwords.

## Brave Search

Owner file: `/Users/yutu/.hermes/plugins/brave-search/__init__.py`

Responsibilities:

- Register `brave_search` tool.
- Inject guidance that Hermes should use Brave Search for current/latest/web information.
- Prevent incorrect "I cannot access the internet" replies unless the tool fails.

Secret:

- `BRAVE_SEARCH_API_KEY` is in `/Users/yutu/.hermes/.env`; do not print it.
