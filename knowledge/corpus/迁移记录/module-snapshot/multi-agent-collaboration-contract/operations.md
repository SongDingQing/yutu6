# Operations

## Lookup Test

```bash
/Users/yutu/.codex/modules/scripts/module_lookup.py "Hermes Codex 多 agent 协作 发邮件"
```

Expected:

- `multi-agent-collaboration-contract` should be a top match.

## JSON Validation

```bash
python3 -m json.tool /Users/yutu/.codex/modules/registry.json >/dev/null
python3 -m json.tool /Users/yutu/.codex/modules/multi-agent-collaboration-contract/module.json >/dev/null
python3 -m json.tool /Users/yutu/.codex/modules/multi-agent-collaboration-contract/agent-manifest.json >/dev/null
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

