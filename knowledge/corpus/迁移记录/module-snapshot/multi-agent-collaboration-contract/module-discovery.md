# Module Discovery

## For Codex

Future Codex sessions should:

1. Read `/Users/yutu/.codex/skills/module-registry/SKILL.md` when the task mentions persistent local integrations.
2. Read `/Users/yutu/.codex/modules/INDEX.md`.
3. Use `/Users/yutu/.codex/modules/scripts/module_lookup.py "<request>"`.
4. Open the matched module `INDEX.md`.
5. Read only the module files needed for the task.

For multi-agent coordination, open this module first when the user mentions:

- 多 agent
- 协作
- Hermes 和 Codex 互相调用
- 能力目录
- handoff
- 接口契约

## For Hermes / Yutu

Hermes should use:

`/Users/yutu/.hermes/skills/autonomous-ai-agents/multi-agent-collaboration-contract/SKILL.md`

That skill points Hermes to:

- this module directory
- the machine manifest
- the handoff rules

Hermes should consult it before deciding:

- whether to answer directly
- whether to send a confirmation card
- whether to use Brave Search
- whether to hand a local task to Codex
- whether to ask for missing information

## For Future Agents

Future agents should be given:

- `/Users/yutu/Desktop/Hermes-Yutu-Migration-Records`
- `/Users/yutu/.codex/modules/registry.json`
- this module directory
- `agent-manifest.json`

Minimum requirement:

- read `agent-manifest.json`
- read `handoff-contracts.md`
- respect confirmation boundaries
- do not store or print secrets

