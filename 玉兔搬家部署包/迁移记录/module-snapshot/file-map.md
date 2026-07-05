# File Map

## Voice Bridge

`/Users/yutu/.hermes/voice-wake/hermes_voice_wake.py`

Contains:

- Audio capture loop.
- Wake phrase parsing.
- ASR correction application.
- Auto hotword learning.
- Time/date fast replies.
- TTS profile selection and playback.
- Feishu text and interactive card sender.
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
- Local Codex CLI runner.
- Optional APK return.

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

Validate:

```bash
/Users/yutu/.hermes/hermes-agent/venv/bin/python - <<'PY'
import yaml
from pathlib import Path
yaml.safe_load(Path('/Users/yutu/.hermes/config.yaml').read_text())
print('ok')
PY
```
