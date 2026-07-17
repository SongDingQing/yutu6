---
name: module-registry
description: Use when the user refers to any persistent local module, previous setup, prior configuration, Mac mini automation, Hermes/Yutu, Feishu, Codex handoff, voice workflow, ASR correction, Brave Search, or asks whether Codex should remember/check module directories. Always consult the module registry before broad codebase searches.
---

# Module Registry

This skill is the durable entry point for local module documentation.

Root registry:

`/Users/yutu/.codex/modules/INDEX.md`

Machine-readable registry:

`/Users/yutu/.codex/modules/registry.json`

Lookup script:

`/Users/yutu/.codex/modules/scripts/module_lookup.py`

## Workflow

1. Read `/Users/yutu/.codex/modules/INDEX.md`.
2. If the request has keywords, run:

```bash
/Users/yutu/.codex/modules/scripts/module_lookup.py "<user request>"
```

3. Open the top matched module's `INDEX.md`.
4. Read only the specific reference files indicated by that module's `read_order` and the user's task.
5. Inspect implementation files only after the module docs identify the owning files.

## Rules

- Prefer the module registry before broad `rg` searches under `/Users/yutu/.hermes`, `/Users/yutu/Documents`, or other large trees.
- If the local module request affects YuanXiao/元宵/汤圆, ChangE/嫦娥, Yutu/玉兔, Hermes, Legend/传奇, mobile control-plane behavior, reminders, queues, sessions, files, notifications, or their `.codex` skills/modules/helper scripts/workflow memory, invoke `yuanxiao-command-expander` first and produce `元宵指令补齐稿` before implementation.
- Do not store or print secrets from `.env`, `auth.json`, tokens, or credentials.
- Address the user as `主人`.
- When asking Yutu/Hermes to send a Codex-triggered Feishu reminder, prefer `/Users/yutu/.codex/modules/hermes-yutu-voice-bridge/scripts/send_yutu_reminder.py --context "<short context>" "<result>"`; the helper applies the persistent `主人，前情提要：...` prefix automatically. Fall back to the raw text rule only if the helper is unavailable.
- When adding a new persistent customization, create or update a module directory and register it in `registry.json`.
- Keep module docs small, structured, and searchable.

## Existing Important Module

- `multi-agent-collaboration-contract`: Hermes/Codex/future-agent capability map, handoff contracts, and shared interface rules.
- `hermes-yutu-voice-bridge`: 玉兔/Hermes voice wake, Feishu records/cards, Codex handoff, ASR hotwords/corrections, Brave Search.
- `simulaid-optimize-build-deliver`: Simulaid UI regression review, resource/performance acceptance, future-agent code navigation, Android `玉龙` APK build/Quark upload, iOS `玉灵` TestFlight delivery, combined `玉玲珑` Android+iOS delivery, Yutu/Feishu reminders, and voice workflows. QQ delivery is disabled by default. Trigger phrases include `Simulaid`, `玉龙`, `玉灵`, `玉玲珑`, `优化打包一条龙`, `UI审查`, `bug整理`, `性能优化`, `打包发送`, `图鉴拖拽`, `天赋拖拽`, and `动画渲染`.
