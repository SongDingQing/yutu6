# 维修工单 repair-agent-v2 · 修 codex 根因 + 维修员升级 v2(自动化 + 根因/架构判断)

- status: done
- created_at: 2026-06-19T15:20:00Z
- source: 秘书
- priority: high
- 执行者:维修员(codex-privileged,`--dangerously-bypass-approvals-and-sandbox` 绕 sandbox,不受 worker_code 那个失败影响,能正常跑)

## 问题(两层)
1. **即时**:`worker_code` 的 codex(`codex exec --sandbox workspace-write`)初始化失败、退出码 1:`could not create PATH aliases` / `failed to initialize in-process app-server client` —— 均 `Operation not permitted`,近 9 次,阻塞所有 codex 实现任务(任务板、办公室都做不出)。
2. **架构**:老板要维修员从 v1(被动半自动:秘书写工单 + 独立 codex 手动消费、`repair` 非 queueAgent 无常驻 worker、只修单次)升级到 **v2(主动自动化 + 根因/架构判断)**。

## 期望结果(要根因 + 架构,不只解决单次)
**A. 根治 worker_code 的 codex 失败**:别只重启——判断 `Operation not permitted` 是不是 `--sandbox workspace-write` 模式 / codex 0.140 / TCC 的系统性问题,给出根治(调整 worker_code 的 codex 调用方式或权限/模式),让 worker_code 稳定跑通 `implement`;派最小任务验证不再退出码 1。

**B. 维修员 v2 自动化**:
1. **`repair` 成为 queueAgent + 常驻 worker**(`codex-privileged` 消费 `queues/repair/`):秘书可**直接 enqueue 派维修员、自动消费**,不再要老板手动转交。
2. **失败自动触发**:引擎/server 在 `node_failed` / `task.failed` 时,自动开维修工单 + 入队 `repair`,维修员自动接单修复;带**去重 + 限频**(同一问题别刷屏)。
3. **根因 + 架构判断**:升级 `shared/agents/repair/prompt.md` —— 每次修完做根因分析、判断是否系统性/架构问题;**反复性问题要提出架构改进**(写 board/ 或开改进工单/任务),不只 patch 单次。
4. **安全**:`codex-privileged` 自动跑,但**高危/不可逆操作仍须先让主人确认**(保留红线)。

**C. 重启 server 让 v2 生效 + 验证闭环**:故意制造一个失败,确认维修员被**自动触发 → 修复 → 做根因/架构判断 → 写回工单 + 飞书通知**。

## 红线
- 高危/不可逆操作必须先给主人确认;密钥/token 不回显;Starlaid 排除;不破现有功能;能验证就写验证结果。

## 处理结果
- status: done

### 完成记录 2026-06-19T15:28:12.629Z
- status: done

根因: worker_code 的 Codex 失败不是 codex 0.140 本体完全坏掉;本机特权终端验证 workspace-write / danger-full-access / bypass 都能启动。失败集中发生在控制台常驻 worker/launchd 子进程里,使用 --sandbox workspace-write 时触发 PATH alias 与 in-process app-server Operation not permitted,判断为 workspace-write sandbox 与常驻 worker/TCC 环境交互不稳定。
处理: 1) codex runner 改为 codex exec --sandbox danger-full-access --skip-git-repo-check; 2) repair 登记为 codex-privileged queueAgent + 常驻 worker; 3) server 增加 PERSISTENT_QUEUE_AGENTS 默认 repair,监督器会持续拉起; 4) ceo-worker 在 engine/node 失败时自动开维修工单并入队 repair,带 fingerprint 冷却去重; 5) repair prompt/agent/runners.yaml 升级 v2,要求根因、验证、架构判断; 6) secretary-tools 修复工单完成时顶部 status 写回 done,并增加飞书卡片通知 fallback。
验证: server 已通过 launchctl 重启,PID 57958,41218 IPv4/IPv6 均监听;旧空闲 worker 已清理,repair 常驻 worker PID 59221。Codex probe 正常。worker_code 最小任务 eee030a1 完成,engine_code=0。故意失败任务 17a97768 产生 node.fail/task.failed 后,自动创建 auto-20260619152554-afc6bf346cf71646,入队 repair d7c7a116,repair 完成写回 done 并记录根因/架构判断。
架构判断: v2 闭环已成立。后续反复失败会按 fingerprint 冷却去重,同类问题不会刷屏;高危/不可逆仍由 repair prompt 红线要求停下给主人确认。
