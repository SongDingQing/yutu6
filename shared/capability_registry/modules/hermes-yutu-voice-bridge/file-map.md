# File Map

Hermes/Yutu is local to this Mac mini. Codex can edit these files directly when the user asks, but should follow the owning-file map below, validate after changes, and restart only the affected LaunchAgent.

## Voice Bridge

`/Users/yutu/.hermes/voice-wake/hermes_voice_wake.py`

Contains:

- Audio capture loop.
- Wake phrase parsing.
- ASR correction application.
- Auto hotword learning.
- Time/date fast replies.
- TTS profile selection and playback.
- Global voice speed multiplier.
- Spoken punctuation pause normalization.
- Feishu text and interactive card sender.
- Feishu-send local voice notice helper.
- Voice task card creation.
- Hermes API request.

Before editing:

- Search local functions first with `rg -n "function_name|config_key"`.
- Keep secrets out of logs.
- Run `python3 -m py_compile` after edits.

## Voice Config

`/Users/yutu/.hermes/voice-wake/config.json`

Contains:

- Wake phrases.
- Silence and recording thresholds.
- Feishu sync target.
- Voice task card settings.
- TTS profiles.
- ASR hotword config and auto-learning thresholds.

Validate:

```bash
python3 -m json.tool /Users/yutu/.hermes/voice-wake/config.json >/dev/null
```

## ASR Context

`/Users/yutu/.hermes/voice-wake/asr-context.json`

Contains:

- `hotwords`
- `initial_prompt`
- `corrections`

This is read before transcription. Corrections are deterministic string replacements after STT.

## Voice Preferences

`/Users/yutu/.hermes/voice-wake/voice-preferences.json`

Contains voice style rules injected before asking Hermes.

Persistent preference currently recorded:

- Voice replies begin with `主人`.
- Codex-triggered Yutu/Hermes spoken messages and Feishu reminders begin with `主人，前情提要：...`.
- Normal voice speed is controlled in `config.json` by `voice_speed_multiplier: 1.0`.

## ASR Learning

`/Users/yutu/.hermes/voice-wake/asr-learning.json`

Contains repeated term counts and auto-promoted terms. It may not exist until enough terms are seen.

## Codex Handoff Plugin

`/Users/yutu/.hermes/plugins/codex-handoff/__init__.py`

Contains:

- `/codex` parsing.
- Codex handoff card.
- Voice task card action handler.
- Pending request loading/deleting.
- Immediate Codex handoff serial queue.
- Queue restart recovery.
- Queued task cancel/status commands.
- Local Codex CLI runner.
- Optional APK return.
- Optional document/file artifact return.
- Latest Codex run status writer.
- Confirmed scheduled Codex handoff tool.
- Generated Hermes cron runner script writer.
- Yutu6 owner decision-card callback bridge:
  - accepts non-secret `card_id` + `approve/reject`
  - loads the per-card secret locally
  - signs and calls the localhost control-console decision endpoint

Related generated files:

- `/Users/yutu/.hermes/codex-handoff/queue`
- `/Users/yutu/.hermes/codex-handoff/runs`
- `/Users/yutu/.hermes/codex-handoff/latest-status.json`
- `/Users/yutu/.hermes/codex-handoff/schedule-pending`
- `/Users/yutu/.hermes/codex-handoff/scheduled-runs`
- `/Users/yutu/.hermes/scripts/codex-handoff`

## Voice ASR Context Plugin

`/Users/yutu/.hermes/plugins/voice-asr-context/__init__.py`

Contains:

- `voice_asr_context_update` tool.
- `voice_reply_preferences_update` tool.
- Feishu manual correction parser.
- Persistent ASR context writer.

## Brave Search Plugin

`/Users/yutu/.hermes/plugins/brave-search/__init__.py`

Contains:

- `brave_search` tool registration.
- Brave API request.
- LLM guidance injection.

## Hermes Config

`/Users/yutu/.hermes/config.yaml`

Relevant section:

- `plugins.enabled` must include:
  - `codex-handoff`
  - `voice-asr-context`
  - `brave-search`
- `display.busy_input_mode: queue` keeps ordinary Feishu follow-up text from interrupting active Hermes work.
- Top-level `HERMES_FEISHU_TEXT_BATCH_DELAY_SECONDS` and `HERMES_FEISHU_TEXT_BATCH_SPLIT_DELAY_SECONDS` tune Feishu multi-message typing aggregation.

Validate:

```bash
/Users/yutu/.hermes/hermes-agent/venv/bin/python - <<'PY'
import yaml
from pathlib import Path
yaml.safe_load(Path('/Users/yutu/.hermes/config.yaml').read_text())
print('ok')
PY
```

## Feishu Gateway Adapter

`/Users/yutu/.hermes/hermes-agent/gateway/platforms/feishu.py`

Contains:

- Feishu/Lark send and receive adapter.
- Outbound Feishu send hook for local voice notice after successful sends.
- Reads `/Users/yutu/.hermes/voice-wake/config.json` for the voice notice config.
- Feishu text burst batching before messages enter the base adapter.
- Voice notice is only scheduled when the adapter is connected, so offline/unit-test sends do not spawn local speech tasks.
- Native Yutu6 decision buttons return an inline replacement card immediately, then route the action asynchronously to the local plugin.

Validate:

```bash
python3 -m py_compile /Users/yutu/.hermes/hermes-agent/gateway/platforms/feishu.py
```

## Codex Feishu Image Helper

`/Users/yutu/.codex/modules/hermes-yutu-voice-bridge/scripts/send_feishu_image.py`

Contains:

- Minimal Codex-side helper for sending a local PNG/JPG preview to the configured Hermes/Yutu Feishu chat.
- Reads existing Feishu credentials from `/Users/yutu/.hermes/.env` and the target chat from `/Users/yutu/.hermes/voice-wake/config.json` / env.
- Does not print tokens or secrets.

Use:

```bash
python3 /Users/yutu/.codex/modules/hermes-yutu-voice-bridge/scripts/send_feishu_image.py /absolute/path/to/image.png --caption "主人，前情提要：..."
```

Validate:

```bash
python3 -m py_compile /Users/yutu/.codex/modules/hermes-yutu-voice-bridge/scripts/send_feishu_image.py
```

## Hermes Gateway Runner

`/Users/yutu/.hermes/hermes-agent/gateway/run.py`

Contains:

- Busy-session behavior for active Hermes runs.
- Queue mode acknowledgement `排队中｜等当前回复完成`.
- Pending follow-up merge behavior for ordinary Feishu text while Hermes is busy.

Validate:

```bash
python3 -m py_compile /Users/yutu/.hermes/hermes-agent/gateway/run.py
```
