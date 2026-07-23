# Architecture

## 定位

Model Fabric 不是把 new-api 与 Nexent 代码混在一起，而是把二者最有价值的能力
收束到玉兔6自己的控制面：

1. new-api 的轻量 OpenAI 兼容入口、渠道聚合和调用计量。
2. Nexent 的 Agent Card、A2A、Skill/能力发现和可视化启动思想。
3. 玉兔6已有的文件队列、角色边界、能力注册表、证据链、done gate 与本机启动。

## 两个数据面

```text
模型数据面
客户端 -> Model Fabric /v1 -> 路由/熔断 -> 直连 provider 或 new-api 兼容上游

任务数据面
主人/外部 A2A -> Agent Card/任务入口 -> 玉兔6队列 -> Agent/工具 -> review/done gate
```

模型请求不能拥有任务完成权；A2A 返回“完成”也不能绕过玉兔6硬验收。

## 比现有方案多出的能力

- 一个目录同时描述模型、provider、Agent、共享能力和外部平台。
- 模型别名与具体 deployment 分离，调用方不绑定某家网关。
- provider 级健康、被动失败计数、熔断冷却和有界故障转移。
- OpenAI 兼容的 chat/responses/embedding/image/audio 入口。
- 所有本机 Agent 自动发布 Agent Card，不在外部平台重复创建一份。
- A2A 请求直接进入玉兔6队列/engine，保留证据链与 done gate。
- 默认 metadata-only 账本，prompt 和回复正文不落盘。
- new-api 可作为兼容上游，也可在直连覆盖完成后完全退出请求路径。

## 资源边界

中枢是一个零依赖 Node 进程，不自带 PostgreSQL、Redis、Elasticsearch 或 MinIO。
静态目录来自现有 JSON 文件，健康检查默认 30 分钟一次，避免为了“平台感”
长期占用多 GiB 内存。外部 Nexent 仍可按需作为 A2A 开发工具启动。
