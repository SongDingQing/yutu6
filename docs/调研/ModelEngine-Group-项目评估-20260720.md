# ModelEngine-Group 项目评估

评估时间：2026-07-20。范围为组织内公开仓库；Nexent 单独做主线架构评估。

## 总结

没有 Nexent 之外的仓库值得整仓并入玉兔6。可复用的是协议、元数据和观测设计，
而不是再部署一套 Java/Ray/Kubernetes 控制面。

| 仓库 | 用途 | 玉兔6决策 | 可吸收内容 |
|---|---|---|---|
| `nexent` | 零代码 Agent 平台、A2A、MCP、Skill、记忆、知识库 | 可选 sidecar | A2A、Agent Card、渐进式 Skill、版本/评估 |
| `DataMate` | 数据清洗、合成、标注、评测和算子执行 | 借鉴，优先级高 | 能力元数据、文件任务契约、取消/重试/资源声明 |
| `domain-specific-operators` | Skill 包安全与规范审查算子 | 借鉴，不原样接入 | `score/overall/risk/sections` 评测结果和规则降级模式 |
| `app-platform` | 多模型低代码编排、工具 Store、调试和 trace | 借鉴 | 工具目录、执行图、`run_id/node_id/runner/model/tool` trace |
| `fit-framework` | Java AI 模型、工具、WaterFlow、MCP 框架 | 借鉴协议 | 模型/工具 manifest、暂停恢复、并行汇合、消息重放 |
| `unified-cache-management` | vLLM/MindIE KV Cache 和推理指标 | 条件式借鉴 | 模型/worker 标签、队列等待、后端等待、端到端延迟 |
| `AgentsHub` | Nexent Agent/Skill/MCP 样例 | 暂不接 | 与 Nexent 对象 ID 强耦合，不是独立运行时 |
| `flexai` | GPU/NPU 虚拟化和 K8s 调度 | 不接 | 属于算力集群层，不适合本机 API 模型池 |

## 应进入玉兔6能力元数据的字段

后续能力模块升级时，优先采用以下机器可读字段：

```text
id / version / language / modalities
inputs / outputs / accepted_files / output_artifacts
runner_kind / queue_contract
runtime.cpu / runtime.memory / runtime.gpu / runtime.storage
timeout / retry / idempotency
secret_refs / network_policy
health_probe / telemetry_labels
release / rollback
```

`secret_refs` 只记录 KEY 名或本地来源类型，绝不记录值。

## 观测字段

外部 Agent 与模型调用统一保留：

```text
run_id
task_id
node_id
agent_id
runner
provider
model
tool
queue_wait_ms
run_ms
failover
artifact_refs
final_state
```

这些字段应复用玉兔6已有事件日志，不另起第二个真相源。

## 风险边界

1. DataMate 允许上传压缩包、安装依赖和动态执行算子；若未来接入，必须使用
   无凭据、默认断网、资源受限的隔离 runner。
2. 部分 Skill 审查样例会明文保存 API Key；玉兔6只允许 new-api 或
   `secret_ref` 注入。
3. AppPlatform/FIT 会引入 Java、Maven、插件框架和额外数据库，当前不部署。
4. UCM/FlexAI 深度依赖 vLLM、GPU/NPU、Kubernetes 和驱动，本机 API 模型池
   暂无采用条件。
5. 任何外部 Agent 的完成声明都不能绕过玉兔6 review 与 done gate。

## 采用顺序

1. 已落地：外部平台目录、doctor、按需启停、A2A 发现和调用。
2. 下一步按真实需求落地：能力元数据 schema 和统一 trace 字段。
3. 有 Skill 压缩包评测需求时，再落地隔离的 `skill_review.v1` runner。
4. 只有部署自建 vLLM 后，才引入 UCM 风格的 KV Cache 指标。
