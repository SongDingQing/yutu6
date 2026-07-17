# 维修工单 repair-202606230045-worker-reload · 空闲窗口滚动重载长驻 queue worker

- status: done
- created_at: 2026-06-23T00:43:33.541Z
- source: repair follow-up auto-20260623002806-e80cc9affe5d661d
- priority: normal

## 问题
多张 no-progress 维修工单已证实核心队列补丁落盘后,长驻 ceo-worker 进程不会自动加载新代码; 本单现场 supervisor-控制台 worker pid 52096 仍为 2026-06-21T19:27:20Z 启动的旧进程,但当前有 running c0703dbc/enginePid 37936,不能安全强杀。

## 事件证据 / 路径
- board/repair-tickets/auto-20260623002806-e80cc9affe5d661d.md
- projects/控制台/artifacts/queues/supervisor-控制台/.worker.pid pid=52096 heartbeat fresh
- projects/控制台/artifacts/queues/supervisor-控制台/running/c0703dbc.json active running
- projects/控制台/ceo-worker.js waitIfWorkerSuperseded 支持 replacement pid 后 drain-then-exit,但 server ensureQueueWorker 只处理 stale worker

## 期望结果
在 supervisor-控制台/ceo 等相关 queueAgent 无 running 时执行安全滚动重载或实现 worker 版本戳/代码变更后空闲自动 supersede; 不强杀 active engine; 写明验证和回滚。

## 红线
- 高危/不可逆操作必须先给主人确认
- 密钥/token/cookie/私钥不回显、不写日志
- Starlaid 排除
- 不破现有功能; 能验证就写验证结果

## 维修员消费方式(v2 自动队列)
`repair` 是常驻 queueAgent,可通过 `queues/repair/` 自动消费;紧急时也可由独立 Codex 特权会话手动接管。推荐手动命令:

```bash
codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -C /Users/yutu6/玉兔6工作区 "$(cat /Users/yutu6/玉兔6工作区/board/repair-tickets/repair-202606230045-worker-reload.md)"
```

## 处理结果
- status: done

### 追加证据 2026-06-23T01:20Z
- auto-20260623010935-f57293cd0b1c1f5c 复核时短暂发现 supervisor-控制台 queued=0/running=0,尝试在空闲窗口重载旧 worker pid=52096;执行前保护闸门再次检查到 `running/94bd938f.json` 已出现,因此未强杀旧 worker。
- 当前 active: `projects/控制台/artifacts/queues/supervisor-控制台/running/94bd938f.json`, owner_pid=52096, enginePid=15952, progress_task 与 taskId 均为 `cr-1782177278518-94bd938f`,进展新鲜。
- 仍需在 supervisor-控制台 无 running 时执行滚动重载或实现 worker 版本戳/空闲 supersede;禁止打断 active engine。

### 完成记录 2026-07-10T14:24:44.979Z
- status: done

【链路证据】旧 supervisor-控制台 worker pid 52096 在有 active engine 时无法安全强杀，补丁落盘后仍运行旧代码；需求与处理边界完整，无交接遗漏。严重度：严重系统性，长驻 worker 代码漂移会使修复不生效，但强杀会破坏合法任务。根因：旧 server 只在 worker 死亡时补拉，未比较当前源码 revision。当前处理：ceo-worker 启动时计算 sourceRevision，循环检测核心 JS 指纹变化，发 queue.worker.code_reload 后停止 claim、等待 active handles drain 并退出，由守护逻辑拉起新 PID；superseded/reaper 仍保护合法 running。验证：2026-07-10 engine-events 中 supervisor-控制台、ceo、repair、repair-lead、memory-officer、it_engineer 均出现 code_reload→新 queue.worker.start 且 revision 更新；node tests/worker-code-reload.test.js PASS；node tests/worker-reaper.test.js PASS。未强杀任何生产 worker。架构判断：可泛化模式。问题模式=常驻进程不感知代码版本→补丁落盘但运行态陈旧；解法=稳定源码指纹+空闲/优雅 drain 重载+守护补拉+事件审计。
