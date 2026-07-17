# Agent Harness 研究案例

## 2026-07-14 · 小核心、硬边界、证据闭环

- 来源:
  - Anthropic `Building effective agents` 与多智能体研究系统工程文。
  - OpenAI `A practical guide to building agents`、Agents SDK orchestration 文档、`openai/codex` 源码快照 `b24aa20`。
  - ReAct、Reflexion、SWE-bench 原论文。
  - `earendil-works/pi` 源码快照 `0e6909f`、`SWE-agent/mini-swe-agent` 源码快照 `e187bcb`。
- 场景:玉兔6需要从外部 agent harness 吸收经验,但既要全面,又不能因堆角色、堆提示词和堆 hooks 放大 token、延迟与故障面。
- 现象:成熟方案在框架形态上差异很大,但反复出现同一组底层约束:简单工具循环、环境反馈、明确终止条件、逐步持久化、可观测事件、独立评估和权限边界。
- 根因/判断:可复用价值主要在协议和失败防线,不在照搬某个框架。README 的性能结论不能直接变成玉兔6改造依据,必须回到源码、测试和本机基线。
- 改法:洞察员用 `open-source-teardown -> source-audit -> 质量运营复核 -> 监管挑刺 -> 主人公告板拍板` 流程;深研最多 50 条有证据候选,按主题打包。
- 验证:研究报告必须记录官方来源、仓库 commit/license、检查过的源码路径、每条建议的收益/测试/回退;公告卡保持 `todo` 直到主人启用。
- 可复用原则:agent 系统优先优化“循环、工具、证据、终止、权限”五个接口;只有单 agent 明确不够时才加角色,只有外部验证过的失败教训才可升级为全局 skill/hook。
