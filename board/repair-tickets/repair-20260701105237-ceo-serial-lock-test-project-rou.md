# 维修工单 repair-20260701105237-ceo-serial-lock-test-project-rou · ceo-serial-lock test project-route wake failure

- status: done
- created_at: 2026-07-01T10:52:37.081Z
- source: repair-lead:auto-20260701104406
- priority: high

## 问题
维修工单 auto-20260701104406-e485207314349a23 修复后跑 node tests/run.js 时, unrelated tests/ceo-serial-lock.test.js 失败; 单独复跑该用例曾悬挂超过 2 分钟,结束后断言 'failed' !== 'done'。

## 事件证据 / 路径
- node tests/run.js: ceo-serial-lock.test.js line 513 AssertionError project-route downstream wait should wake before the 1200ms fallback poll; node tests/ceo-serial-lock.test.js: line 511 AssertionError 'failed' !== 'done'. 本单定向 done-gate/queue-organizer/ceo-queue-control/hardening-hooks 均 PASS。

## 期望结果
维修主管另行核查 ceo-serial-lock/project-route wait 链路,判断是否为测试时序 flake、事件唤醒机制回归或队列状态污染; 修复或明确隔离后补回归。

## 红线
- Starlaid 排除; 密钥不回显; 不杀生产 worker; 高危/不可逆操作先确认。

## 维修部门消费方式(v3 主管先行)
`repair-lead` 是维修主管队列(Codex 特权),所有工单默认先进主管:链路核查、根因分析、严重度分级、必要时分派 `repair` Codex 维修员执行。紧急时仍可由独立 Codex 特权会话手动接管。推荐手动命令:

```bash
codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -C /Users/yutu6/玉兔6工作区 "$(cat /Users/yutu6/玉兔6工作区/board/repair-tickets/repair-20260701105237-ceo-serial-lock-test-project-rou.md)"
```

## 处理结果
- status: done

### 完成记录 2026-07-10T14:16:36.392Z
- status: done

【链路证据】原工单来自 auto-20260701104406 的全量回归：CEO project-route 父任务等待 supervisor 子任务完成，旧测试曾在 line 511 得到 failed 或在 line 513 超过1200ms fallback，brief 与验收传递完整，无交接遗漏。严重度：严重系统性，因 CEO 串行锁会被下游等待阻塞。根因：历史等待链在下游状态变化后依赖固定 fallback/状态轮询，事件到达不能稳定即时唤醒，导致时序失败或长挂。当前处理状态：现有 ceo-worker.js 已实现 PROJECT_ROUTE_WAKE_EVENT_TYPES、engine-events 增量游标、fs.watch + 25-100ms stat poll、800ms active fallback，并在 project.route.wait.summary 记录 eventWakeCount；该修复已进入当前基线，无需重复改生产代码。验证：node tests/ceo-serial-lock.test.js 首次 PASS，随后连续5次全部 PASS（约4.6-4.8s/次）；node tests/ceo-queue-control.test.js PASS；node tests/crash-recovery-idempotency.test.js PASS；node tests/queue.test.js PASS。未重启或杀生产 worker。架构判断：可泛化模式。问题模式=父任务等待下游只依赖固定轮询，导致串行槽延迟释放与时序 flake；解法=权威事件增量唤醒 + 文件变化监听 + 有界 fallback + wait summary 指标。项目技术映射：玉兔6控制台 → project-route event wake → projects/控制台/ceo-worker.js:131-269,1130-1217；回归 → tests/ceo-serial-lock.test.js:446-520。
