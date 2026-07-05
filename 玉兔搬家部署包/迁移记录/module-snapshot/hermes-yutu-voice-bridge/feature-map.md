# Feature Map

## Voice Wake And Reply

Owner file: `/Users/yutu/.hermes/voice-wake/hermes_voice_wake.py`

Config file: `/Users/yutu/.hermes/voice-wake/config.json`

Responsibilities:

- Capture microphone audio.
- Detect wake phrases.
- Transcribe local audio through Hermes local STT.
- Play startup, wake acknowledgement, thinking cue, fast replies, and Hermes replies.
- Apply global voice speed multiplier from config.
- Normalize spoken punctuation pauses before TTS.
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
- `voice_speed_multiplier`
- `spoken_punctuation_pause_enabled`
- `spoken_phrase_pause`
- `spoken_sentence_pause`
- `spoken_force_final_punctuation`
- `spoken_pause_after_prefixes`
- `feishu_send_voice_notice_enabled`
- `feishu_send_voice_notice_text`

Persistent notification format:

- Any Codex-triggered Yutu/Hermes spoken message or Feishu reminder should start with `主人，前情提要：...`.
- The front-context sentence should say what just happened or what task was being handled, then the next clause/sentence should give the actual result.
- Ordinary direct voice answers still begin with `主人`; they only need a `前情提要` when they are task/status/reminder style messages.

## Feishu Voice Records

Owner file: `/Users/yutu/.hermes/voice-wake/hermes_voice_wake.py`

Responsibilities:

- Send text records to Feishu with label `语音回复记录`.
- Include timestamp, user voice text, and 玉兔 reply in a table-style record.
- Send voice task confirmation cards for tool-like requests.
- After ordinary Feishu sends, play local notice `主人，飞书来消息了`.
- Skip extra notice for background `语音回复记录` records by default.
- Skip extra notice for short queue status messages that begin with `排队中`.

Key config keys:

- `feishu_sync_enabled`
- `feishu_voice_reply_sync_enabled`
- `feishu_sync_chat_id`
- `feishu_sync_receive_id_type`
- `voice_reply_sync_label`
- `feishu_send_voice_notice_skip_prefixes`
- `feishu_send_voice_notice_min_interval_seconds`

## Feishu Message Queue And Batching

Owner files:

- `/Users/yutu/.hermes/hermes-agent/gateway/run.py`
- `/Users/yutu/.hermes/hermes-agent/gateway/platforms/feishu.py`
- `/Users/yutu/.hermes/config.yaml`

Responsibilities:

- Keep ordinary Feishu messages queued while Hermes/Yutu is already replying, instead of interrupting the active task.
- Append rapid text follow-ups as separate lines so messages like `a`, `b`, `c` are not overwritten.
- Debounce Feishu text bursts before dispatching to Hermes so human multi-message typing is treated as one request.
- Send compact busy notice `排队中｜等当前回复完成` at most once per cooldown window.

Key config keys:

- `display.busy_input_mode`
- `HERMES_FEISHU_TEXT_BATCH_DELAY_SECONDS`
- `HERMES_FEISHU_TEXT_BATCH_SPLIT_DELAY_SECONDS`

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
- After confirmation, enqueue the local Codex CLI task in a serial in-process queue.
- Run only one immediate Codex handoff task at a time.
- Send a Feishu queue acknowledgement with a queue id and how many tasks are ahead.
- Recover queued or previously-running queue audit files after Hermes gateway restart.
- Allow queued-but-not-running tasks to be canceled with `/codex-cancel <queue-id>`.
- Show the current queue with `/codex-queue`.
- Optionally send APK artifacts back to Feishu.

Queue files:

- `/Users/yutu/.hermes/codex-handoff/queue`
- `/Users/yutu/.hermes/codex-handoff/runs`
- `/Users/yutu/.hermes/codex-handoff/latest-status.json`

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
