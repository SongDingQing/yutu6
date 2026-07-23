# Architecture

## 结论

Nexent 不是轻量“模型启动器”，而是一套完整的零代码 Agent 平台。官方
Docker 部署最低要求为 4 CPU、8 GiB 内存和 40 GiB 磁盘，包含 React/Next.js、
多个 FastAPI 服务、PostgreSQL、Elasticsearch、Redis、MinIO 等组件。它适合作为
按需运行的 Agent 设计与发布平台，不适合替代玉兔6，也不应默认随设备启动。

## 采用的能力

1. **A2A Agent Card**：通过标准发现端点读取 Agent 名称、技能、能力和调用地址。
2. **A2A 调用**：以 REST 或 JSON-RPC 把外部 Agent 当作受控执行节点。
3. **模型池复用**：Nexent 只连接玉兔6 new-api，不复制各供应商 key。
4. **渐进式 Skill 披露**：Agent 先看到能力目录，需要时再读详细操作文档。
5. **Agent 版本与评估思想**：外部版本可记录，但仍须经过玉兔6证据和 done gate。

## 暂不采用

1. 不把 Nexent 的数据库、队列或 completion 状态当作玉兔6事实源。
2. 不默认启动完整容器栈；只有明确需要可视化建 Agent/A2A 发布时才启动。
3. 不复制模型厂商 key，不让外部平台绕过玉兔6模型池计量与本地密钥策略。
4. 不把外部 Agent 返回的“已完成”直接转换为 `task.done`。

## ModelEngine-Group 其他项目

组织级审查未发现第二个适合整仓接入的控制面。按价值从高到低借鉴：

1. DataMate 的能力元数据、文件任务、取消/重试和资源声明。
2. AppPlatform 的工具目录、执行图和 trace。
3. FIT/WaterFlow 的暂停恢复、并行汇合、会话隔离和 MCP 消息重放。
4. domain-specific-operators 的结构化 Skill 评测结果。
5. UCM 的模型、worker、等待时间和端到端延迟指标。

完整记录见 `docs/调研/ModelEngine-Group-项目评估-20260720.md`。这些项目当前
全部为“借协议，不部署”，避免引入 Java、Ray、Milvus、Kubernetes 或第二套
凭据系统。

## 运行边界

```text
主人/秘书
   -> 玉兔6 CEO / 项目主管
      -> 玉兔6 runner 或 A2A adapter
         -> Nexent published agent
      <- 外部输出 + artifact refs
   <- 玉兔6 review + done gate
```

A2A 输出只是实现或分析证据。玉兔6必须继续验证改动文件、测试和 acceptance，
然后由自己的 done gate 决定是否完成。

## 资源策略

- `yutu6-native`：核心，允许登录启动。
- `nexent`：重型可选平台，`autostart=false`，显式 `--confirm-heavy` 才能启动。
- Nexent Web：本机 `3100`，避免与 new-api `3000` 冲突。
- Nexent A2A：本机 `5013`，只作为玉兔6外部执行入口。
- 停止 Nexent 默认保留数据，不自动删除容器卷。
