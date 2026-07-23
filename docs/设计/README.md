# 玉兔6设计文档索引

本目录保存玉兔6的架构与产品设计。涉及 ModelEngine、Nexent、new-api、模型池或
外部智能体平台时，按下面顺序阅读，避免把历史方案误当成当前方案。

## ModelEngine / Nexent / 模型池

### 当前主设计

- [`玉兔6-模型与智能体中枢-架构与迁移.md`](./玉兔6-模型与智能体中枢-架构与迁移.md)
  - 产品名：玉兔6 Model Fabric（模型与智能体中枢）
  - 覆盖：模型网关、健康路由、用量账本、Agent 目录、A2A、能力目录、done gate、迁移与回滚
  - 当前状态：Phase 1 已落地，`3020` 影子前门运行；new-api 暂时保留为兼容上游
  - 这是后续实现、迁移和是否替换 new-api 的唯一主方案

### 研究依据

- [`../调研/ModelEngine-Group-项目评估-20260720.md`](../调研/ModelEngine-Group-项目评估-20260720.md)
  - 对 ModelEngine-Group 下 Nexent、DataMate、app-platform、FIT 等仓库的取舍评估
  - 记录吸收哪些协议、元数据与观测设计，以及哪些重型组件不应整仓引入

### 历史方案

- [`玉兔6-外部智能体平台与模型池接入.md`](./玉兔6-外部智能体平台与模型池接入.md)
  - 最初的 Nexent sidecar 接入方案
  - 仅作设计演进记录；与主设计冲突时，以“模型与智能体中枢”文档为准

## 当前实现入口

- 模型中枢：`shared/model-fabric/`
- 模型中枢配置：`projects/控制台/config/model-fabric.json`
- 本机控制命令：`model-fabric.sh`
- 外部 Agent 平台目录：`projects/控制台/config/agent-platforms.json`
- 外部平台控制命令：`agent-platforms.sh`
- 能力登记：`shared/capability_registry/modules/yutu6-model-fabric/`
- 外部平台能力：`shared/capability_registry/modules/agent-platform-orchestration/`
- 回归测试：`tests/model-fabric.test.js`、`tests/agent-platforms.test.js`

## 决策摘要

1. 不直接照搬 Nexent 的整套多容器控制面。
2. 吸收 A2A、Agent Card、渐进式 Skill、评测、租约和观测设计。
3. Model Fabric 作为统一稳定前门，调用方不再绑定具体网关。
4. new-api 在直连覆盖、连续健康、账本对账和回滚演练完成前不删除。
5. 外部平台的 `completed` 只能作为证据，最终完成仍由玉兔6 review 与 done gate 判定。
