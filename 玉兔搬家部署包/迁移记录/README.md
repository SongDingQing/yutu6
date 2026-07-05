# Hermes / 玉兔迁移资料包

创建时间：2026-04-26

这个文件夹是给未来的人类开发者或更强的新 agent 用的迁移入口。它记录了目前 Mac mini 上 Hermes / 玉兔 的本地改造、Hermes 和 Codex 的协作契约、能力边界、关键文件、输入输出规则、运行命令和迁移清单。

## 先读哪些文件

1. `00-handoff-prompt.md`  
   给未来 agent 的直接交接提示词。

2. `01-system-overview.md`  
   目前 Hermes / 玉兔 的整体架构。

3. `02-capabilities-and-flows.md`  
   语音、飞书卡片、Codex handoff、热词纠错、Brave Search 的输入输出流程。

4. `03-migration-checklist.md`  
   如果换新 agent，要逐项检查什么。

5. `04-operations.md`  
   常用重启、验证和日志命令。

6. `05-conversation-timeline.md`  
   我们这次配置过程的摘要时间线。

7. `06-known-risks.md`  
   已知风险和后续改进方向。

8. `07-live-paths-and-data.md`  
   当前真实运行文件、日志、插件、敏感数据位置。

9. `08-knowledge-architecture-skills-and-project-todos.md`  
   新 Mac mini 知识架构、skills、项目仓库、优秀外部代码库、过往失败案例和自动安装待办。

10. 模块快照 `module-snapshot/multi-agent-collaboration-contract/`  
   Hermes、Codex 和未来 agent 的共享能力目录与接口契约。

## 目录说明

- `module-snapshot/`  
  当前 Codex 模块文档快照，包含 `hermes-yutu-voice-bridge` 和 `multi-agent-collaboration-contract`。

- `reference/`  
  轻量参考资料，比如模块注册表快照。

## 敏感信息

这个资料包不保存 API key、token、密码或 `.env` 原文。迁移时只记录敏感文件的位置，例如：

- `/Users/yutu/.hermes/.env`
- `/Users/yutu/.codex/auth.json`
- `/Users/yutu/.codex/memories/contacts.json`

迁移时由主人决定是否复制这些文件。
