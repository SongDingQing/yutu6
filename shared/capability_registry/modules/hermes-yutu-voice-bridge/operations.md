# Operations

## Restart Services

Voice listener:

```bash
launchctl kickstart -k gui/$(id -u)/com.yutu.hermes.voicewake
```

Hermes gateway:

```bash
launchctl kickstart -k gui/$(id -u)/ai.hermes.gateway
```

Check status:

```bash
launchctl print gui/$(id -u)/com.yutu.hermes.voicewake | rg "state = running|pid =|runs ="
launchctl print gui/$(id -u)/ai.hermes.gateway | rg "state = running|pid =|runs =|last exit code"
```

## Logs

Voice log:

```bash
tail -80 /Users/yutu/.hermes/voice-wake/logs/voice-wake.log
```

Gateway log:

```bash
tail -80 /Users/yutu/.hermes/logs/gateway.log
```

Gateway state:

```bash
cat /Users/yutu/.hermes/gateway_state.json
```

## Validation

Python syntax:

```bash
python3 -m py_compile \
  /Users/yutu/.hermes/hermes-agent/gateway/run.py \
  /Users/yutu/.hermes/hermes-agent/gateway/platforms/feishu.py \
  /Users/yutu/.hermes/voice-wake/hermes_voice_wake.py \
  /Users/yutu/.hermes/plugins/codex-handoff/__init__.py \
  /Users/yutu/.hermes/plugins/voice-asr-context/__init__.py \
  /Users/yutu/.hermes/plugins/brave-search/__init__.py
```

JSON configs:

```bash
python3 -m json.tool /Users/yutu/.hermes/voice-wake/config.json >/dev/null
python3 -m json.tool /Users/yutu/.hermes/voice-wake/asr-context.json >/dev/null
python3 -m json.tool /Users/yutu/.hermes/voice-wake/voice-preferences.json >/dev/null
```

Feishu queue/batching tests:

```bash
cd /Users/yutu/.hermes/hermes-agent
/Users/yutu/.hermes/hermes-agent/venv/bin/python -m pytest \
  tests/gateway/test_busy_session_ack.py \
  tests/gateway/test_feishu.py \
  -q
```

Codex handoff queue smoke tests:

```bash
python3 -m py_compile /Users/yutu/.hermes/plugins/codex-handoff/__init__.py
```

Runtime commands from Feishu:

- `/codex-queue` shows queued/running Codex handoff items.
- `/codex-cancel <queue-id-or-short-id>` cancels a queued-but-not-running item.

Brave Search smoke test without printing secrets:

```bash
set -a
source /Users/yutu/.hermes/.env >/dev/null 2>&1
set +a
/Users/yutu/.hermes/hermes-agent/venv/bin/python - <<'PY'
import importlib.util, json
from pathlib import Path
path = Path('/Users/yutu/.hermes/plugins/brave-search/__init__.py')
spec = importlib.util.spec_from_file_location('brave_search_plugin', path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
data = json.loads(mod._brave_search_tool({'query': 'OpenAI news', 'count': 2}))
print(data.get('status'))
for item in data.get('results', [])[:2]:
    print('-', item.get('title', '')[:80], '|', item.get('url', '')[:100])
PY
```

Manual correction parser smoke test:

```bash
/Users/yutu/.hermes/hermes-agent/venv/bin/python - <<'PY'
import importlib.util
from pathlib import Path
path = Path('/Users/yutu/.hermes/plugins/voice-asr-context/__init__.py')
spec = importlib.util.spec_from_file_location('voice_asr_context', path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
print(mod._parse_manual_update('纠错：预图=>玉兔\n热词：Brave Search、姐姐'))
PY
```

## Common Edits

Change silence tolerance:

- Edit `silence_duration` in `/Users/yutu/.hermes/voice-wake/config.json`.
- Restart voice listener.

Add ASR correction manually:

- Prefer Feishu message: `纠错：错词=>正确词`.
- Or edit `asr-context.json`, then validate JSON.

Add a new voice provider:

- Add profile under `voice_profiles` in config.
- Set `active_voice_profile`.
- Test with `--preview-profile` if needed.
