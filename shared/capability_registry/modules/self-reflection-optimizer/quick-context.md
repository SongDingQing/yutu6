# Quick Context

- Codex skill: `/Users/yutu6/.codex/skills/self-reflection-optimizer/SKILL.md`
- Workspace trigger: `projects/控制台/tools/self-reflection-trigger.js`
- Case library: `board/learning-cases/self-reflection-optimizer-cases.md`
- Auto insight integration: `shared/agents/ui-optimizer/loop.sh` calls the trigger after appending UI learning cases.
- Normal route: trigger enqueues `secretary`, preserving `owner -> secretary -> CEO -> supervisor`.

Self-reflection outputs a critique ledger, classifies each fix, executes only safe obvious wins, and turns uncertain or breaking changes into owner decision items.
