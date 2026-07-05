# 能力与 Runner(提炼)

> 提炼自 `shared/capability_registry/modules/`(2 个核心模块全文)与迁移记录 08 §2/§5。

## Hermes / 玉兔 —— 默认对话 runner
- 角色:**前门路由 + 语音/飞书 agent**。轻量路由、确认、提醒、工具编排。
- 能做:收发飞书消息与交互卡片、唤醒词后语音收发、语音回复同步飞书、Brave Search、维护 ASR 热词纠错、确认后把编码任务 handoff 给 Codex、Hermes cron 定时任务。
- 不直接做:改本地项目代码(归 Codex)、未确认就发邮件、猜路径/收件人。
- 源码:`NousResearch/hermes-agent`(MIT,main),本机 5 文件 patch(feishu.py/run.py/plugins.py/transcription_tools.py/测试)。新机需 clone+patch 进 `~/.hermes`。

## Codex —— 最强推理 + 本地工程执行
- 角色:**当前最强推理脑 + 首席架构/规划 + 本地工程 agent**。复杂架构、风险评估、任务拆解、复盘综合、代码/构建/测试/Unity/APK、代码评审默认评审者。
- 接口:codex_cli(Hermes handoff 调用)、codex_desktop、gmail_connector。
- 约束:发邮件/发文件/高危改动需确认;**子 agent 仅会话内短助手,不作长期 worker/回调目标**;以 bridge I/O 为权威,内部历史仅参考。

## 路由原则(handoff)
- Hermes 是前门,Codex 是执行脑。复杂推理/架构/本地改文件/精确验证 → Codex;对话/飞书语音状态/简单提醒搜索 → Hermes。
- handoff 走**飞书确认卡片** + 串行队列(一次一个),带 queue id / task id / 回执。
- 已知联系人(发邮件路由):主人邮箱、姐姐邮箱(见模块 handoff-contracts)。

## Runner 注册表(`shared/routing/runners.yaml`)
Hermes(一等,默认对话)· Codex(一等,推理执行)· Claude Code(一等,总管/控制平面)· 本地脚本(硬化骨头)。

## 相关实体
Hermes · 玉兔 · Codex · Claude Code · 飞书 · 语音唤醒 · ASR 热词 · Brave Search · handoff · 确认卡片 · runner
