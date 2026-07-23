# yutu6-model-fabric

玉兔6统一模型与智能体中枢。它是模型调用的 OpenAI 兼容前门，也是本机
Agent、共享能力和外部 A2A 平台的发现目录；任务真完成仍由玉兔6队列、复审和
done gate 判定。

- 服务：`shared/model-fabric/server.js`
- 配置：`projects/控制台/config/model-fabric.json`
- 本机入口：`http://127.0.0.1:3020`
- 模型入口：`http://127.0.0.1:3020/v1`
- 健康：`http://127.0.0.1:3020/health`
- 运行数据：`projects/控制台/artifacts/model-fabric/`

先读 `operations.md` 使用，再读 `architecture.md` 理解替换边界。
