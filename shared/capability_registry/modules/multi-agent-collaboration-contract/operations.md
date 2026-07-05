# Operations

## Registry Lookup

```bash
python3 - <<'PY'
import json
p='/Users/yutu6/玉兔6工作区/shared/capability_registry/registry.json'
data=json.load(open(p))
print([m['id'] for m in data.get('modules', []) if 'multi-agent' in m.get('id','') or '协作' in m.get('summary','')])
PY
```

Expected:

- `multi-agent-collaboration-contract` should be a top match.

## JSON Validation

```bash
python3 -m json.tool /Users/yutu6/玉兔6工作区/shared/capability_registry/registry.json >/dev/null
python3 -m json.tool /Users/yutu6/玉兔6工作区/shared/capability_registry/modules/multi-agent-collaboration-contract/module.json >/dev/null
python3 -m json.tool /Users/yutu6/玉兔6工作区/shared/capability_registry/modules/multi-agent-collaboration-contract/agent-manifest.json >/dev/null
```

## Hermes Skill Check

```bash
sed -n '1,160p' /Users/yutu/.hermes/skills/autonomous-ai-agents/multi-agent-collaboration-contract/SKILL.md
```

## Codex Skill Check

```bash
sed -n '1,160p' /Users/yutu/.codex/skills/multi-agent-collaboration-contract/SKILL.md
```

## After Changes

When this module changes:

1. Validate JSON.
2. Run the lookup test.
3. Sync the desktop migration package if migration records exist.
