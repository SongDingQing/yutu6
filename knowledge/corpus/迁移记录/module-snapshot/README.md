# Hermes Yutu Voice Bridge

This module documents the local Hermes assistant that the user calls 玉兔.

It exists so a human developer or a future Codex session can understand the custom voice and Feishu workflow without scanning the full Hermes codebase.

## What This Module Does

The module covers:

- Local microphone wake listening.
- Wake phrases such as `玉兔玉兔` and `Hermes听令`.
- Local ASR correction and hotword persistence.
- TTS voice profile selection and spoken replies.
- Feishu voice reply records marked `语音回复记录`.
- Feishu confirmation cards for voice-originated tasks.
- Codex handoff cards for local coding work.
- Optional APK return flow after Codex completes Unity/Android builds.
- Brave Search integration for current web information.

## Main User-Facing Flows

Voice question:

```text
用户语音 -> 本地 ASR -> 快速回答或 Hermes API -> 语音播放 -> 飞书记录
```

Voice task:

```text
用户语音任务 -> Feishu Voice Task card -> 用户确认 -> Hermes 继续处理 -> 需要代码时 Codex Handoff
```

ASR correction:

```text
飞书回复 纠错：错词=>正确词 -> 持久写入 asr-context.json -> 下一次语音识别生效
```

Search:

```text
最新/联网/搜索类请求 -> brave_search tool -> Hermes 总结结果
```

## Where To Start

For Codex or debugging:

1. Read `INDEX.md`.
2. Read `quick-context.md`.
3. Use `feature-map.md` to pick the subsystem.
4. Use `file-map.md` before editing implementation files.
5. Use `operations.md` to validate and restart services.

For human review:

- `change-log.md` explains what has been customized so far.
- `troubleshooting.md` lists known symptoms and likely fixes.

## Important Safety Notes

- Do not print or commit `/Users/yutu/.hermes/.env`.
- Do not expose Feishu, Brave Search, Hermes API, Gmail, or OpenAI credentials.
- Persistent services are LaunchAgents; avoid duplicate manual background processes.
- The user prefers to be called `主人`.
