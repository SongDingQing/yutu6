---
name: skill-standard-reviewer
description: Use whenever creating, updating, reviewing, or persisting a Codex skill, SKILL.md, project skill, workflow memory, or reusable agent instruction. Audits skill scope, trigger fit, project ownership, self-contained usability, and whether another future session/agent can use the skill without hidden chat context.
---

# Skill Standard Reviewer

Use this alongside `skill-creator` for every skill creation or skill update.

The goal is not just to write a skill that makes sense in the current chat. The goal is to create a durable operating manual that another Codex session or agent can invoke and use correctly without relying on hidden conversation history.

## Review Order

0. Read `/Users/yutu/.codex/skills/SKILL_ARCHITECTURE.md` when present so the edit fits the current local skill layers and routing rules.
1. Define the skill scope before editing.
2. Decide whether the skill is global, user-specific, or project-specific.
3. If it is project-specific, identify the project root, module index, critical files, validation commands, and non-obvious constraints.
4. Check whether the skill has enough information for a new session to complete the workflow by invoking the skill alone.
5. Remove instructions that are too broad, stale, duplicated, or only true for the current chat.
6. After editing, reread the changed skill and audit it against the checklist below.

## Scope Audit

Classify the skill:

- Global skill: useful across unrelated projects. Keep project paths and user-specific preferences out unless essential.
- User workflow skill: tied to the user's personal automation, contacts, devices, or persistent routines. Include durable paths and handoff rules, but no secrets.
- Project skill: tied to one repo/app/game/workflow. Include the project root, index files, runtime/build/test commands, asset locations, naming conventions, and known traps.

If a skill belongs to a project, prefer project-specific precision over generic advice. The standard is:

> Another future session's agent should be able to invoke this skill and correctly operate the project without reading this chat.

## Completeness Checklist

Before considering a skill done, verify:

- Trigger description names the exact situations where the skill should load.
- Skill body states what to do first and what files or indexes to read before broad searches.
- Project paths are absolute where durable local paths matter.
- Important commands are included or discoverable from named project docs.
- Validation expectations are explicit.
- Safety or approval constraints are captured when they affect the workflow.
- Non-obvious failures are documented with symptoms and likely fixes.
- User preferences that should persist are written as rules, not anecdotes.
- The skill does not rely on "as discussed above", current chat state, temporary agent IDs, or unstated files.
- The skill avoids bloated background explanation and keeps detailed references in referenced files when needed.
- The skill fits `/Users/yutu/.codex/skills/SKILL_ARCHITECTURE.md`: wrapper skills stay thin, engine skills stay focused, long-lived details live in modules/project docs, and project/Feishu ownership boundaries are not blurred.

## Project Skill Requirements

For project-specific skills, include enough to locate and use:

- project root and module index
- main source directories
- important generated/runtime asset directories
- build/test/compile commands
- versioning or release metadata rules
- design or product docs that should be kept in sync
- known environment limitations
- rules for generated files, assets, or migrations
- specific "do not do this again" lessons learned from prior failures

If these details already live in a project index, the skill may point to that index instead of duplicating everything. The skill must still say which index to read and when.

## Skill Boundary Rules

- Do not make one skill responsible for every possible future task.
- Split skills when workflows have different tools, validation, or failure modes.
- Merge only when two skills always trigger together and duplicate the same operating instructions.
- If updating an existing skill, preserve its focused purpose and add only durable rules.
- Avoid storing secrets, tokens, cookies, passwords, private keys, payment data, or one-time verification codes.

## Final Self-Review

Before final response after creating or editing a skill, report briefly:

- which skill files changed
- what scope the skill covers
- whether it is global, user workflow, or project-specific
- what future agents can now do by invoking it

If the skill is still incomplete, say what missing context blocks it.
