# Operations

## Registry Lookup

```bash
cd "$(git rev-parse --show-toplevel)"
python3 - <<'PY'
import json
p='shared/capability_registry/registry.json'
data=json.load(open(p))
print([m['id'] for m in data.get('modules', []) if 'multi-agent' in m.get('id','') or '协作' in m.get('summary','')])
PY
```

Expected:

- `multi-agent-collaboration-contract` should be a top match.

## JSON Validation

```bash
python3 -m json.tool shared/capability_registry/registry.json >/dev/null
python3 -m json.tool shared/capability_registry/modules/multi-agent-collaboration-contract/module.json >/dev/null
python3 -m json.tool shared/capability_registry/modules/multi-agent-collaboration-contract/agent-manifest.json >/dev/null
```

## Installed Skill Check

```bash
sed -n '1,160p' "${CODEX_HOME:-$HOME/.codex}/skills/multi-agent-collaboration-contract/SKILL.md"
```

## After Changes

When this module changes:

1. Validate JSON.
2. Run the lookup test.
3. Run the generic distribution and setup-gate tests before publishing.
