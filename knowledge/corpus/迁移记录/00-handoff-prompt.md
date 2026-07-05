# Handoff Prompt For A Future Agent

你正在接手 Mac mini 上的 Hermes / 玉兔 本地助手配置。

请先阅读：

`/Users/yutu/Desktop/Hermes-Yutu-Migration-Records/README.md`

然后阅读：

`/Users/yutu/.codex/modules/INDEX.md`

并用模块查询脚本定位相关模块：

```bash
/Users/yutu/.codex/modules/scripts/module_lookup.py "用户当前问题"
```

当前最重要模块是：

`/Users/yutu/.codex/modules/multi-agent-collaboration-contract/INDEX.md`

它定义 Hermes、Codex 和未来 agent 之间的能力目录、接口契约、确认边界和任务归属。

另一个重要模块是：

`/Users/yutu/.codex/modules/hermes-yutu-voice-bridge/INDEX.md`

## 接手原则

- 称呼用户为 `主人`。
- 不要打印、复制或泄露 API key、token、密码、`.env` 原文。
- 先读模块文档，再查实现代码。
- 多 agent 协作、能力边界、接口契约、谁该处理什么任务，先读 `multi-agent-collaboration-contract`。
- 改语音、飞书、Codex handoff、ASR、Brave Search 之前，先看 `file-map.md` 和 `operations.md`。
- 修改后要运行语法/JSON/YAML 检查，并按需重启 LaunchAgent。
- 飞书确认卡片和语音任务不能绕过用户确认。

## 当前能力

- 玉兔语音唤醒和本地麦克风监听。
- 语音回复通过 TTS 播放。
- 语音回复记录同步到飞书。
- 语音任务发飞书确认卡片。
- 确认后 Hermes 继续处理，必要时走 Codex handoff。
- Codex handoff 可本地改代码、做 Unity 游戏功能、可尝试返回 APK。
- ASR 支持热词、纠错和重复词自动学习。
- Brave Search 已接入 Hermes，用于最新/联网/搜索类问题。

## 当前核心服务

- Voice listener: `com.yutu.hermes.voicewake`
- Hermes gateway: `ai.hermes.gateway`
- Hermes API server: `http://127.0.0.1:8642/v1`
- Hermes dashboard: `http://127.0.0.1:9119`

## 不要从全局开始扫

先读：

- `/Users/yutu/.codex/modules/INDEX.md`
- `/Users/yutu/.codex/modules/multi-agent-collaboration-contract/INDEX.md`
- `/Users/yutu/.codex/modules/hermes-yutu-voice-bridge/INDEX.md`

只有模块文档指向实现文件后，再打开具体文件。
