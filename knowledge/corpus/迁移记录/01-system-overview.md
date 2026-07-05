# System Overview

## 目标

让 Hermes 在 Mac mini 上作为“玉兔”运行，支持语音唤醒、语音回复、飞书留痕、飞书确认卡片、Codex 本地编码交接、ASR 热词纠错、联网搜索和后续迁移。

## 主要组件

### 1. Voice Wake Bridge

路径：

`/Users/yutu/.hermes/voice-wake/hermes_voice_wake.py`

职责：

- 监听麦克风。
- 检测唤醒词。
- 调用本地 STT。
- 应用 ASR 纠错。
- 做简单本地快速回复。
- 调用 Hermes API。
- 播放 TTS。
- 把语音记录或任务卡片发到飞书。

### 2. Hermes Gateway

LaunchAgent：

`ai.hermes.gateway`

职责：

- 连接飞书 WebSocket。
- 提供 Hermes API server。
- 接收飞书消息和卡片按钮回调。
- 加载本地插件。

### 3. Feishu Integration

用途：

- 展示语音回复记录。
- 发送 `Command Required: Voice Task` 卡片。
- 发送 `Command Required: Codex Handoff` 卡片。
- 确认/取消后替换卡片状态。

### 4. Codex Handoff

插件：

`/Users/yutu/.hermes/plugins/codex-handoff`

职责：

- 判断本地编码任务。
- 发 Codex 交接确认卡片。
- 用户确认后运行本地 Codex CLI。
- 可尝试发送生成的 APK 回飞书。

### 5. ASR Context

插件：

`/Users/yutu/.hermes/plugins/voice-asr-context`

数据：

- `/Users/yutu/.hermes/voice-wake/asr-context.json`
- `/Users/yutu/.hermes/voice-wake/asr-learning.json`

职责：

- 保存热词。
- 保存纠错映射。
- 支持飞书回复 `纠错：错词=>正确词`。
- 支持飞书回复 `热词：词1、词2`。
- 重复出现的高价值词自动进入热词库。

### 6. Brave Search

插件：

`/Users/yutu/.hermes/plugins/brave-search`

职责：

- 注册 `brave_search` 工具。
- 让 Hermes 遇到最新消息/联网/搜索类问题时先搜索。
- 避免错误回复“我没有联网能力”。

## 模块文档

长期索引在：

`/Users/yutu/.codex/modules`

当前核心模块：

`/Users/yutu/.codex/modules/hermes-yutu-voice-bridge`
