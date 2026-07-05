---
name: simulaid-studio-operating-model
description: Use when the user asks Codex to become or act as a small Simulaid game studio hub / 小型制作组中枢, or when Simulaid work needs cross-discipline production structure: major feature planning, repeated bug root-cause handling, balance checks, asset/audio audits, UI/combat team-style workflows, release gates, regression suites, or lessons borrowed from Claude-Code-Game-Studios.
---

# Simulaid Studio Operating Model

## Start Here

Project root: `/Users/yutu/Simulaid`.

Read this module first:

`/Users/yutu/.codex/modules/simulaid-studio-operating-model/INDEX.md`

Then load only the relevant reference files:

- `quick-context.md` for the core posture.
- `role-map.md` for producer/creative/technical/domain/QA/release lenses.
- `workflow-map.md` for feature, bug, balance, asset/audio, and delivery workflows.
- `quality-gates.md` for pre-edit/implementation/validation/done gates.
- `checklists.md` for compact area-specific checks.
- `operations.md` for how to combine this with existing Simulaid skills.

## Operating Rules

- Main Codex is the production hub; do not create long-running subagents by default.
- Use short-lived subagents only when the user explicitly asks for delegation or parallel agents, and keep write scopes disjoint.
- For Simulaid code/runtime work, also use `simulaid-unity-maintenance` and read `/Users/yutu/Simulaid/CODE_INDEX.md` before broad searches.
- For repeated UI/layout issues, also use `simulaid-ui-regression-review` and read the bug/UI ledgers.
- For delivery, route through 玉龙/玉灵/玉玲珑 rather than recreating build commands from memory.
- Keep reports concise; avoid large logs, images, base64, or full JSON dumps in chat.

## Adaptation Boundary

This is a lean Simulaid adaptation inspired by Claude-Code-Game-Studios. Do not copy its entire `.claude` tree into Simulaid. Borrow structure: roles, workflows, gates, templates, and checks; keep the actual implementation project-specific.
