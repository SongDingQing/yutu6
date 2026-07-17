# 维修工单 repair-20260713-privileged-runner-singleflight · repair-lead→repair 特权 runner 单飞互锁

- status: todo
- created_at: 2026-07-13T10:51:26.261Z
- source: 秘书
- priority: normal

## 问题
维修主管在严重工单内按协议派给 repair 后，repair-lead 与 repair 共用 codex-privileged singleflight；主管占槽等待维修员，维修员已 claim 但等待同一槽，形成结构性自锁。该模式已在 auto-20260713093810-8e1f550782c2d691/repair-1888e352 与 auto-20260713103533-5d8f47806172d340/repair-fc4c9318 连续出现。

## 事件证据 / 路径
- projects/控制台/artifacts/engine-events.jsonl:38871-38877,38964；board/repair-tickets/auto-20260713103533-5d8f47806172d340.md；repair/fc4c9318 engine.slot.wait reason=runner-singleflight；前一单 queue.steered seq 234871。

## 期望结果
全局评估维修主管到维修员的调度契约：避免父任务持有写码 runner 时同步等待子 repair；优先设计显式让槽/独立执行池/异步复核状态机，并补两张连续工单的无死锁回归。不得取消 fail-closed、不得伪造队列完成；高危进程或服务变更先给主人确认。

## 红线
- 高危/不可逆操作必须先给主人确认
- 密钥/token/cookie/私钥不回显、不写日志
- 不破现有功能; 能验证就写验证结果

## 维修部门消费方式(v3 主管先行)
`repair-lead` 是维修主管队列(Codex 特权),所有工单默认先进主管:链路核查、根因分析、严重度分级、必要时分派 `repair` Codex 维修员执行。紧急时仍可由独立 Codex 特权会话手动接管。推荐手动命令:

```bash
codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -C /Users/yutu6/玉兔6工作区 "$(cat /Users/yutu6/玉兔6工作区/board/repair-tickets/repair-20260713-privileged-runner-singleflight.md)"
```

## 处理结果
- status: todo

## 结案协议
- 本维修请求单独建单,不同故障不得混入本单。
- 完成记录必须包含:链路证据、需求传递判断、严重度、根因、处理过程、复核验证、架构判断、知识沉淀候选、剩余风险 / 下一步。
- 使用 `repair-ticket-complete` 结案;系统生成固定 HTML,飞书发送摘要卡 + 附件,元宵同步报告文档。
