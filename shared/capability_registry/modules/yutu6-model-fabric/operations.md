# Operations

## 检查与启动

```bash
cd /Users/yutu6/玉兔6工作区
node shared/model-fabric/server.js
curl -fsS http://127.0.0.1:3020/health
curl -fsS http://127.0.0.1:3020/api/fabric/overview
```

登录启动由 `com.yutu6.model-fabric` 管理：

```bash
bash start-all.sh install
launchctl print gui/$(id -u)/com.yutu6.model-fabric
```

## 模型与路由

```bash
curl -fsS http://127.0.0.1:3020/v1/models
curl -fsS 'http://127.0.0.1:3020/api/fabric/routes/plan?model=glm-5.2'
curl -fsS -X POST http://127.0.0.1:3020/api/fabric/health/run
```

客户端把 OpenAI-compatible `base_url` 指向：

```text
http://127.0.0.1:3020/v1
```

中枢不接受命令行裸 key。上游凭据只通过配置中的 `credential.file + key`
或环境变量名解析，概览只返回来源类型和 KEY 名。

## Agent 与 A2A

```bash
curl -fsS http://127.0.0.1:3020/api/fabric/agents
curl -fsS http://127.0.0.1:3020/api/fabric/capabilities
curl -fsS http://127.0.0.1:3020/a2a/agents/orchestrator/.well-known/agent-card.json
```

普通 Agent 可以经 `/api/fabric/agents/<id>/run` 或 A2A
`/a2a/agents/<id>/message:send` 进入玉兔6控制面。维修、桌面控制等特权 Agent
默认禁止从该通用入口直接拉起。

## 计量与隐私

```bash
curl -fsS 'http://127.0.0.1:3020/api/fabric/usage?days=7'
```

账本位于 `projects/控制台/artifacts/model-fabric/ledger/`，只记录模型、provider、
状态、耗时、token 数和关联 ID；不记录 prompt、回复正文、工具参数或密钥。

## 回滚

1. 客户端或 runner 的 `base_url` 改回 `http://127.0.0.1:3000/v1`。
2. `launchctl bootout gui/$(id -u)/com.yutu6.model-fabric`。
3. 保留 new-api 容器和数据卷即可立即恢复旧链路。

当前阶段不删除、不迁移、不改写 new-api 的数据库。
