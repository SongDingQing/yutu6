# 玉兔6 Model Fabric

Model Fabric 是玉兔6的本机模型与智能体控制面。它把模型目录、能力声明、健康探测、路由回退、A2A 派单和用量审计收在一个 localhost 服务里。

## 定位

Fabric 是统一入口，不是把 `new-api` 的数据和密钥迁走。当前采用可回滚的旁路策略：

```text
agent / runner -> Model Fabric :3020 -> 直连 provider（逐个启用）
                                  -> new-api :3000/v1（兼容回退）
```

因此任何模型都可以先挂到 `new-api-compat`，再逐个增加直连 deployment。直连失败时由同一逻辑模型自动回退；停止 `com.yutu6.model-fabric` 或把 runner base URL 改回 `http://127.0.0.1:3000/v1` 即可回滚。

## 控制面

- `GET /api/fabric/overview`：模型、provider、agent、能力与迁移覆盖面。
- `GET /api/fabric/ready`：适合 launchd/watchdog 的就绪探针。
- `GET /api/fabric/diagnostics`：路由策略、24 小时调用摘要和迁移建议，不含 prompt/response/key。
- `POST /api/fabric/health/run`：手动健康检查。
- `GET /api/fabric/routes/plan?model=...&capabilities=chat,vision`：查看实际候选与回退顺序。
- `POST /api/fabric/agents/:id/run`：通过现有控制台队列/引擎派发 agent。
- `GET /a2a/agents/:id/.well-known/agent-card.json`、`POST /a2a/agents/:id/message:send`：轻量 A2A 兼容入口。
- `/v1/*`：OpenAI 兼容请求入口，支持重试、健康熔断、用量账本和上下文关联头。

## 安全与边界

服务只监听 `127.0.0.1`。凭据只从本地 env 文件或环境变量读取，公共配置和诊断会剔除 secret 字段；账本只记录模型、provider、延迟、token usage 和 task/agent/project 关联，不记录 prompt、response、工具参数或 token 值。

## 演进顺序

1. 先保持 `new-api` 兼容回退，观察 `/api/fabric/diagnostics`。
2. 给稳定且已确认的模型增加直连 provider，并用 `/api/fabric/health/run` 和最小请求验证。
3. 当某逻辑模型的直连覆盖和健康稳定后，再提高 deployment priority；不以“一次性替换网关”作为上线条件。
4. 语义缓存、虚拟 key、复杂策略编排只在有真实用量证据后增加，避免引入重运行时和额外内存常驻。

## GLM Coding Plan 硬合同

`zhipu-glm` 只允许使用 `zhipu-coding-plan-v1` 合同，不得改走 new-api 通用计费路由。合同的唯一参数来源是 `shared/model-fabric/zhipu-coding-plan.js`：

- Base URL: `https://open.bigmodel.cn/api/coding/paas/v4`
- Model: `glm-5.2`
- Credential file: `~/.config/yutu6-secrets/secrets.env`
- Credential key: `ZHIPU_API_KEY`
- Health probe: 最小 `chat/completions` 真调用，不用 `/models` 代替可用性检查
- Transport: Node 原生 HTTPS，有界重试；不依赖本机 Node `fetch`/undici 的上游行为

唯一人工检查与冒烟入口：

```bash
node projects/控制台/tools/zhipu-coding-plan.js check
node projects/控制台/tools/zhipu-coding-plan.js smoke
```

两条命令只输出合同字段名、模型、endpoint 和结果，不输出凭据值。仅真实套餐/额度错误可进入 quota breaker；平台过载、速率限制、网络中断和鉴权错误必须分类处理，不得误标为“额度用完”。
