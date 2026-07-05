---
name: instruction-expansion-router
description: Use before any non-trivial coding, debugging, refactoring, deployment, release, build, test, game-development, UI/assets/content, agent-control-plane, Hermes/Yutu, YuanXiao, Zongzi, Simulaid, Starlaid, or project-planning request where the user gives a terse, spoken, screenshot-backed, queue-like, cross-agent, or ambiguous command. Routes to the correct project-specific command expander and produces a concise 指令补齐稿 before implementation. Default for new or unrecognized projects.
metadata:
  short-description: Route and expand terse project commands
---

# Instruction Expansion Router（全局指令补齐总路由）

This is the global first-pass command expansion router. It makes terse user requests executable while keeping project-specific rules in their own skills and route docs.

## Core Rule

Use this skill as the first step for non-trivial project work, then continue execution in the same turn unless the user explicitly asks only for planning.

Do not turn this into a giant all-project manual. It should route, normalize, and enforce shared safeguards. Project-specific details belong in the matched project command expander, project route, module, or repo docs.

## Routing Order

1. If the user explicitly names a skill, load that skill first.
2. If the request matches Simulaid / 模拟纪元 / `/Users/yutu/Simulaid`, load `simulaid-command-expander` and emit only `Simulaid 指令补齐稿：`.
3. If the request matches YuanXiao / 元宵 / 汤圆 / ChangE / 嫦娥 / Yutu / 玉兔 / Hermes / Legend / 传奇 / control-plane queues, load `yuanxiao-command-expander` and emit only `元宵指令补齐稿：`.
4. If the request matches Zongzi / 粽子 / 粽子 Codex / 粽子管理控制台, load `zongzi-command-expander` and emit only `粽子指令补齐稿：`.
5. If the request matches Starlaid / 星桥 / `/Users/yutu/Projects/Starlaid/Starlaid`, use `starlaid-unity-maintenance`, `starlaid-game-development`, and `starlaid-test-maintenance` as needed, then emit `Starlaid 指令补齐稿：`.
6. If the request uses a cross-project wrapper such as `玉猿`, `玉豚`, `玉凤`, `玉鼠`, `玉衡`, `玉虎`, `玉鸡`, `金鸡`, `玉龙`, `玉灵`, `玉玲珑`, `玉凰`, or `黄龙`, read `/Users/yutu/.codex/skills/project-routes/INDEX.md`, choose the project route, then apply that route's supported wrapper.
7. If no known project route matches, emit `全局指令补齐稿：` with the generic template below.

## Compatibility Contract

This router must cooperate with existing command expander skills rather than compete with them.

Priority order:

1. Explicit user-named skill or agent.
2. Project-specific command expander, such as `simulaid-command-expander`, `yuanxiao-command-expander`, `zongzi-command-expander`, or a future `<project>-command-expander`.
3. Cross-project wrapper route selected through `project-routes/INDEX.md`.
4. This router's generic `全局指令补齐稿` fallback.

If another loaded skill already has an output contract for `指令补齐稿`, treat that skill as authoritative for the visible expansion. This router may still provide shared safeguards internally, but it must not rewrite, nest, summarize, or second-guess that expander's block unless the user explicitly asks for a review.

For future agents with their own command expander skills, use this rule: if the skill name or body clearly owns a project/agent and defines its own `指令补齐稿`, route to it and suppress the generic block.

## No Double Expansion

Only one visible command expansion block should appear per turn.

- If a downstream project expander emits its own block, do not also emit `全局指令补齐稿`.
- If this router is the only applicable expander, emit the generic block.
- If both this router and a project expander trigger, the project expander owns the one visible block.
- Keep the block short enough for the user to read quickly. The expansion is a working brief, not a full design document.

## Generic Expansion Template

Use this when no project-specific expander exists:

```text
全局指令补齐稿：
目标：...
项目/位置：...
我理解你要我做的是：...
需要优先确认的边界：...
可能影响的文件/服务：...
执行步骤：...
验证方式：...
风险与回滚：...
需要持久化记录的位置：...
```

## Project Lenses

Apply these lenses when writing the matched expansion.

### Game Development

Include gameplay intent, architecture ownership, save/data compatibility, UI/mobile constraints, asset/style consistency, performance risk, regression tests, and build or delivery impact.

### Agent / Control Plane

Include queue behavior, session ownership, confirmation cards, notification/voice side effects, task id or agent id routing, durable logs, failure recovery, secrets boundary, and user-facing audit trail.

### Web / Server / API

Include service entrypoint, port/domain, request flow, database or file persistence, logs, deployment target, health check, rollback path, and security boundary.

### Skills / Modules / Memory

Include trigger scope, duplicate-rule prevention, future-session readability, module/index updates, reviewer skill usage, and whether the change belongs in a skill or a module.

## Shared Safeguards

- Prefer existing project conventions and canonical docs before broad source search.
- Use `module-registry` when the request depends on persistent local modules, Hermes/Yutu, Feishu, prior setup, or multi-agent contracts.
- Use `skill-standard-reviewer` before creating, editing, or reviewing skills.
- Do not write secrets, tokens, cookies, private keys, passwords, payment data, or verification codes into skills or docs.
- Do not run destructive commands unless the user clearly asked for that operation.
- Ask one short question only when the target project or destructive scope cannot be inferred safely.

## Completion Habit

After implementation, report:

- what expansion route was used;
- what files changed;
- what validation ran;
- any remaining user action or risk.
