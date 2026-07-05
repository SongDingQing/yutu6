# Operations

## Validate Shared CLI

```bash
python3 -m py_compile /Users/yutu6/玉兔6工作区/shared/tools/meowa/meowart_api.py
python3 /Users/yutu6/玉兔6工作区/shared/tools/meowa/meowart_api.py --help
```

## Validate Key Presence Without Printing It

```bash
python3 - <<'PY'
from pathlib import Path
import re
p = Path('/Users/yutu6/.config/yutu6-secrets/secrets.env')
names = []
for line in p.read_text(encoding='utf-8').splitlines():
    m = re.match(r'\s*(MEOWART_API_KEY)\s*=', line)
    if m:
        names.append(m.group(1))
print('\n'.join(names))
PY
```

## Credits Smoke Test

```bash
python3 /Users/yutu6/玉兔6工作区/shared/tools/meowa/meowart_api.py credits-balance
```

Report only status and balance fields. Do not print key values.

## Refresh Upstream CLI Copy

```bash
rm -rf /tmp/meowa-skills
git clone --depth 1 https://github.com/Meowa-AI/meowa-skills.git /tmp/meowa-skills
cp /tmp/meowa-skills/skills/game-assets/meowart_api.py /Users/yutu6/玉兔6工作区/shared/tools/meowa/meowart_api.py
cp /tmp/meowa-skills/skills/game-assets/SKILL.md /Users/yutu6/玉兔6工作区/shared/tools/meowa/SKILL.md
cp /tmp/meowa-skills/skills/game-assets/meowart_api.md /Users/yutu6/玉兔6工作区/shared/tools/meowa/meowart_api.md
cp /tmp/meowa-skills/skills/game-assets/meowart_api.bootstrap.json /Users/yutu6/玉兔6工作区/shared/tools/meowa/meowart_api.bootstrap.json
chmod 755 /Users/yutu6/玉兔6工作区/shared/tools/meowa/meowart_api.py
```

After refreshing, reapply the local unified-secrets patch if the upstream file replaced it.

## Future Gateway Option

If several agents need centralized job scheduling, wrap this CLI in a local `meowa-gateway` HTTP service with submit/poll/download endpoints. Keep it parallel to `new-api`; do not route Meowa through OpenAI-compatible LLM APIs.
