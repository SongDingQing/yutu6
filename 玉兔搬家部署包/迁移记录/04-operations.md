# Operations

## Restart

Voice listener:

```bash
launchctl kickstart -k gui/$(id -u)/com.yutu.hermes.voicewake
```

Hermes gateway:

```bash
launchctl kickstart -k gui/$(id -u)/ai.hermes.gateway
```

## Status

```bash
launchctl print gui/$(id -u)/com.yutu.hermes.voicewake | rg "state = running|pid =|runs ="
launchctl print gui/$(id -u)/ai.hermes.gateway | rg "state = running|pid =|runs =|last exit code"
cat /Users/yutu/.hermes/gateway_state.json
```

## Logs

Voice:

```bash
tail -80 /Users/yutu/.hermes/voice-wake/logs/voice-wake.log
```

Gateway:

```bash
tail -80 /Users/yutu/.hermes/logs/gateway.log
```

## Validation

Python:

```bash
python3 -m py_compile \
  /Users/yutu/.hermes/voice-wake/hermes_voice_wake.py \
  /Users/yutu/.hermes/plugins/codex-handoff/__init__.py \
  /Users/yutu/.hermes/plugins/voice-asr-context/__init__.py \
  /Users/yutu/.hermes/plugins/brave-search/__init__.py \
  /Users/yutu/.hermes/hermes-agent/gateway/platforms/feishu.py
```

JSON:

```bash
python3 -m json.tool /Users/yutu/.hermes/voice-wake/config.json >/dev/null
python3 -m json.tool /Users/yutu/.hermes/voice-wake/asr-context.json >/dev/null
python3 -m json.tool /Users/yutu/.hermes/voice-wake/voice-preferences.json >/dev/null
python3 -m json.tool /Users/yutu/.codex/modules/registry.json >/dev/null
```

YAML:

```bash
/Users/yutu/.hermes/hermes-agent/venv/bin/python - <<'PY'
import yaml
from pathlib import Path
yaml.safe_load(Path('/Users/yutu/.hermes/config.yaml').read_text())
print('yaml-ok')
PY
```

Module lookup:

```bash
/Users/yutu/.codex/modules/scripts/module_lookup.py "玉兔飞书卡片不更新"
```

Brave Search smoke test:

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

Do not print `.env`.
