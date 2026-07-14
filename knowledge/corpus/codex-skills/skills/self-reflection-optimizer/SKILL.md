---
name: self-reflection-optimizer
description: Use when the owner asks for 自省优化, 反思优化, 挑刺优化, 模块复盘, or wants a reusable case to trigger evidence-based critique and safe improvements.
---

# 自省优化

Critique a named module against its code, tests, logs, and learning cases. Do not rely on an agent's success claim.

## Workflow

1. Resolve the target through `shared/capability_registry/registry.json`, then read its module contract and focused tests.
2. Read `board/learning-cases/README.md` and related cases.
3. Record each issue with evidence, impact, proposed fix, risk, classification, and validation.
4. Use `auto_execute` only for narrow, reversible, clearly beneficial changes with local validation.
5. Use `owner_decision` for disputed, breaking, costly, permission-sensitive, destructive, or externally configured changes.
6. Use `defer` when evidence is insufficient or the proposal is outside the named module.
7. Validate every executed change and append reusable lessons to `board/learning-cases/self-reflection-optimizer-cases.md`.

Keep normal work on the `secretary -> CEO -> supervisor` route. A project must have a registered project department before project-specific work is dispatched, and no task may cross project boundaries implicitly.

Read [references/decision-policy.md](references/decision-policy.md) before classifying a proposed change.

## Report

Return the target and evidence read, critique ledger, auto-executed changes and validation, owner decisions, and learning cases added. Never include credentials.
