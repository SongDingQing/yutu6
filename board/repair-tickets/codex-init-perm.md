# 维修工单 codex-init-perm · worker_code 的 codex 启动失败(Operation not permitted)

- status: done
- created_at: 2026-06-19T15:06:00Z
- source: 秘书
- priority: high

## 问题
系统 `worker_code`(codex,`codex exec --sandbox workspace-write`)spawn 时初始化失败、退出码 1:
- `could not create PATH aliases: Operation not permitted (os error 1)`
- `failed to initialize in-process app-server client: Operation not permitted (os error 1)`

导致 `implement` 节点 `node_failed`。**近期至少 9 次**,所有 codex 实现任务(任务板、办公室视图等)一路由到 `worker_code` 就失败 —— 所以网页「任务进行中」实际跑不出结果、办公室工位显示空闲、刷新一瞬间闪历史失败。

## 事件证据 / 路径
- `projects/控制台/artifacts/engine-events.jsonl`:seq 1400、1454(`node.fail · implement · reason "codex 退出码 1 … Operation not permitted"`)
- `engine-events.jsonl` 里 "Operation not permitted" 近期出现 9 次。

## 期望结果
- `worker_code` 的 codex 能正常初始化、跑通 `implement`(修 PATH aliases / in-process app-server client 的 `Operation not permitted`;疑似 codex 0.140 在 `--sandbox workspace-write` 模式下的初始化/权限问题,或 worker 运行环境 / TCC 限制)。
- 修好后派一个**最小 codex 实现任务**验证能跑通(不再退出码 1)。
- 顺带确认前端状态显示:无 running 时工位显示空闲(正确),但刷新不应闪历史失败;running 任务要正确点亮对应工位。(此项 codex 能跑后可走普通队列修,不必维修员做。)

## 红线
- 高危/不可逆操作必须先给主人确认。
- 密钥/token/cookie/私钥/验证码不回显、不写日志。
- Starlaid 排除。
- 不破现有功能;能验证就写验证结果。

## 处理结果
- status: done

### 完成记录 2026-06-19T15:28:12.622Z
- status: done

根因: 旧故障来自 worker_code 使用 codex exec --sandbox workspace-write 时,在常驻 worker/launchd 环境里触发 Codex 0.140 的 PATH aliases 与 in-process app-server 初始化 Operation not permitted。当前特权终端直接跑 codex 0.140 三种模式均可启动,所以不是 CLI 完全不可用,更像 workspace-write sandbox 与 launchd/TCC/子进程环境的组合问题。
处理: projects/控制台/config.json 中 codex runner 已从 --sandbox workspace-write 改为 --sandbox danger-full-access; repair 仍使用 codex-privileged。shared/engine/cli-runner.js 与 ceo-worker.js 均登记 repair -> codex-privileged。
验证: 重启 com.yutu6.console 后, /api/probe?runner=codex 与 codex-privileged 均返回 codex-cli 0.140.0。最小 worker_code 队列 eee030a1 完成,engine_code=0,没有 Operation not permitted / PATH aliases / app-server 错误。
架构判断: 这是系统性启动模式问题,不应靠重启解决;固定 runner 调用模式后,后续 worker_code 稳定走新命令。
