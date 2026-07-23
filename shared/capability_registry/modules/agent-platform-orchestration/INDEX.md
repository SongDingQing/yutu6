# agent-platform-orchestration

玉兔6的外部智能体平台接入层。玉兔6原生文件队列仍是唯一主控制面；
Nexent 等平台是按需启动的 A2A sidecar，不拥有玉兔6任务的最终 `done`
判定权。

- 平台目录：`projects/控制台/config/agent-platforms.json`
- 平台入口：`/Users/yutu6/玉兔6工作区/agent-platforms.sh`
- A2A 客户端：`shared/tools/a2a/a2a-client.js`
- 现有模型池：`http://127.0.0.1:3000/v1`
- Nexent 适配端口：Web `3100`，A2A `5013`

先读 `operations.md` 使用命令，再读 `architecture.md` 理解信任边界与采用范围。
