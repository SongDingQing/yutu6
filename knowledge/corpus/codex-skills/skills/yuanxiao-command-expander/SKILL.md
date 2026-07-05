---
name: yuanxiao-command-expander
description: Use before modifying, fixing, optimizing, reviewing, deploying, building, releasing, or planning YuanXiao/元宵/汤圆, ChangE/嫦娥, Yutu/玉兔, Hermes, Legend/传奇, the Huawei Android APK, mobile agent control plane, related skills/modules/helper scripts/workflow memory, self-update, Quark fallback, session/queue sync, file inbox/outbox, notifications, artifacts, typed cards, or any request that says 煮元宵 or 煮汤圆. Expands the user's terse request into a complete actionable command with inferred intent, missing details, likely touchpoints, validation, release, handoff, memory/module lookup, and safety requirements before implementation.
---

# YuanXiao Command Expander

Use this as the first step for YuanXiao/ChangE and their supporting Yutu/Hermes/Legend control-plane work. Its job is to turn the user's short, queue-like, screenshot-backed, or follow-up instruction into the richer command Codex should actually execute.

This includes edits to `.codex` skills, local modules, Hermes/Yutu helper scripts, bridge scripts, workflow memory, and reminder/reporting helpers when those edits affect YuanXiao/ChangE/Yutu/Legend behavior. Do not skip this expander merely because the Android app or ChangE server source is not being edited.

If `instruction-expansion-router` also triggers, this skill is the authoritative visible expander for YuanXiao/ChangE/Yutu/Hermes/Legend work. Produce only `元宵指令补齐稿`; do not also produce a generic `全局指令补齐稿`.

## Output Contract

Before code edits, deployment, release, Quark upload, or architecture planning, produce one concise Chinese block titled `元宵指令补齐稿`. Treat that block as the real working command for the rest of the turn.

Shape:

```text
元宵指令补齐稿：
请在元宵/嫦娥...（完整目标、推测意图、范围、约束、实现要点、验证方式、发布/交接要求）
```

Do not stop after the block unless the user explicitly asked only for planning. Continue implementation using the expanded command. If `嫦娥改装计划` or `yuanxiao-mobile-file-inbox` also triggers, run this expansion first, then use those skills to execute.

## Expansion Workflow

1. Read the latest user message, attachments, screenshots, and immediately relevant prior turn context.
2. Identify the target surface:
   - Android app UI, Compose screens, notification, update dialog, file picker, document center, or chat renderer;
   - ChangE server API, relay, async queue, self-update, release metadata, diff/patch delivery, or cleanup policy;
   - Mac mini bridge, Hermes/Yutu, Codex Desktop session routing, runner/session sync, task queue, or Feishu/Yutu reminder;
   - supporting `.codex` skills, module docs, helper scripts, workflow memory, or fixed reminder/reporting functions for YuanXiao/ChangE/Yutu/Legend;
   - file inbox/outbox, artifact ledger, preview, chunk upload, resume, checksum, or mobile share intent;
   - control-room features such as typed cards, approvals, trace, failures, DAG tasks, runner adapters, capability registry, and audit.
3. Read durable local context before broad searching when it is relevant:
   - `/Users/yutu/.codex/modules/chang-e-android-control-plane/INDEX.md`
   - `/Users/yutu/Projects/YuanXiao/README.md`
   - `/Users/yutu/Projects/YuanXiao/docs/chang-e-android-control-plane/change-log.md`
   - `/Users/yutu/Projects/YuanXiao/docs/chang-e-android-control-plane/api-contracts.md`
   - `/Users/yutu/Projects/YuanXiao/docs/chang-e-android-control-plane/agent-control-plane-contracts.md`
   - `/Users/yutu/Projects/YuanXiao/ops/scripts/verify_release_candidate.py`
   - relevant Android/server tests under `/Users/yutu/Projects/YuanXiao`
   - memory quick pass when the request mentions prior behavior, `之前`, `上次`, 粽子/Zongzi, queues, files, updates, incidents, or durable process gaps.
4. Infer the user's likely intent from established YuanXiao rules:
   - YuanXiao/ChangE should become a reliable, auditable agent control room, not only a chat entrance.
   - The app should make status, evidence, risks, permissions, artifacts, files, queues, and next actions visible and recoverable.
   - Prefer async, idempotent, resumable, traceable flows over long blocking calls.
   - Default to executing supported changes; do not pause with a plan request. Use approval cards only for real owner decisions such as destructive deletion, credential changes, public exposure, paid/irreversible actions, or untrusted external sends.
   - `汤圆` means `元宵`; `煮汤圆` means `煮元宵`.
   - `煮元宵/煮汤圆` means optimization pass, tests, build when needed, release verification, ChangE self-update/downlink, Git commit/push, and Feishu/Yutu completion reminder. Quark upload is fallback/manual backup unless explicitly requested or self-update is not verified.
   - Keep repositories and docs sanitized: no real IPs, hosts, credentials, keys, cookies, Feishu ids, private email/contact details, APKs, logs, caches, or runtime state in public commits.
5. Add missing implementation details:
   - likely files/modules/APIs to inspect;
   - user-facing acceptance criteria;
   - regression tests, smoke tests, and release-candidate checks;
   - deployment/restart/update steps;
   - rollback, cleanup, and stale-task handling;
   - what should be reported through Feishu/Yutu or app-side messages.
6. For cross-agent or runner work, specify the control-plane contract explicitly:
   - which runner or agent owns the action;
   - how the request is queued, paused, resumed, reordered, or cancelled;
   - where handoff summaries, artifacts, logs, approvals, and failure reasons are recorded;
   - which session-local files, module records, memory hits, or git history should be consulted.
7. If critical information is missing and cannot be safely inferred, ask one short question. Otherwise make a conservative assumption and proceed.

## Quality Bar

The expanded command should be specific enough that another Codex session can execute it without reading the original chat. It should mention:

- the desired behavior or target symptom;
- the likely root-cause area or product surface;
- the user-facing acceptance criteria;
- reliability, security, privacy, and regression expectations;
- build/deploy/release verification requirements;
- any module, design guide, memory, or handoff update needed.

Keep it compact. The block is a working command, not a long essay.
