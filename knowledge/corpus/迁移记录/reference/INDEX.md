# Codex Local Module Registry

This is the persistent index for local custom modules on this Mac mini.

Future Codex conversations should consult this registry before scanning broad code trees when the user refers to a previous setup, local automation, Hermes/Yutu, Feishu, Codex handoff, voice, ASR, multi-agent collaboration, capability contracts, or other persistent custom integration.

## Lookup Flow

1. Read this file.
2. Read `registry.json`.
3. Use `scripts/module_lookup.py "<user request>"` when keyword routing is helpful.
4. Open only the matched module's `INDEX.md`.
5. Load only the specific reference files recommended by that module.
6. Inspect implementation files only after the module docs narrow the target.

## Active Modules

### multi-agent-collaboration-contract

Path:

`/Users/yutu/.codex/modules/multi-agent-collaboration-contract`

Index:

`/Users/yutu/.codex/modules/multi-agent-collaboration-contract/INDEX.md`

Purpose:

Persistent shared capability map and handoff contract for Hermes/Yutu, Codex, and future local agents.

Primary keywords:

`multi-agent`, `多 agent`, `多智能体`, `协作`, `能力目录`, `接口契约`, `handoff`, `Hermes`, `玉兔`, `Codex`, `飞书确认`, `发邮件`, `Gmail`, `Unity`, `APK`.

### hermes-yutu-voice-bridge

Path:

`/Users/yutu/.codex/modules/hermes-yutu-voice-bridge`

Index:

`/Users/yutu/.codex/modules/hermes-yutu-voice-bridge/INDEX.md`

Purpose:

Local Hermes/Yutu voice wake, Feishu voice records, confirmation cards, Codex handoff, ASR hotwords/corrections, and Brave Search integration.

Primary keywords:

`玉兔`, `Hermes`, `语音唤醒`, `飞书`, `确认卡片`, `Codex handoff`, `ASR`, `热词`, `纠错`, `Brave Search`, `APK`, `Unity`.

## Add A New Module

Create:

```text
/Users/yutu/.codex/modules/<module-id>/
├── README.md
├── INDEX.md
├── module.json
├── quick-context.md
├── feature-map.md
├── io-contracts.md
├── file-map.md
├── operations.md
└── troubleshooting.md
```

Then update:

- `/Users/yutu/.codex/modules/registry.json`
- this `INDEX.md`
- optionally create a dedicated skill under `/Users/yutu/.codex/skills/<module-id>/SKILL.md`

Minimum registry fields:

- `id`
- `name`
- `status`
- `path`
- `index`
- `summary`
- `keywords`
- `read_order`
- `primary_files`

Do not store secrets in module docs.

Every direct child directory under `/Users/yutu/.codex/modules` should have a `README.md` for human developers. `INDEX.md` is for Codex routing; `README.md` is for humans.
