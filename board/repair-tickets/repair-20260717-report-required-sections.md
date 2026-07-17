# 维修工单 repair-20260717-report-required-sections · repair-ticket-complete 必需分段为空仍可假结案

- status: todo
- created_at: 2026-07-17T01:13:55.890Z
- source: repair-lead
- priority: high


## 问题
固定维修报告的八个必需分段 chainEvidence/handoffVerdict/severity/rootCause/actions/verification/architecture/knowledge 全部为空时，repair-ticket-complete 仍可把工单标 done 并发送通知，违反无结构化完成记录不得结案的合同。

## 事件证据 / 路径
- projects/控制台/artifacts/repair-reports/auto-20260717005914-6d59c9e5a1617372.report.json missing_sections 含八项
- board/repair-tickets/auto-20260717005914-6d59c9e5a1617372.md:50 首次完成记录已写 done
- projects/控制台/artifacts/repair-reports/delivery-state.json 已记录飞书 sent

## 期望结果
在任何结案副作用前校验 REQUIRED_SECTION_KEYS 全部非空；缺失时 fail closed，不写 done、不生成完成事件、不发送飞书/元宵，并补正反回归与既有不完整报告审计。

## 红线
- 高危/不可逆操作必须先给主人确认
- 密钥/token/cookie/私钥不回显、不写日志
- 不破现有功能; 能验证就写验证结果

## 维修部门消费方式(v3 主管先行)
`repair-lead` 是维修主管队列(Codex 特权),所有工单默认先进主管:链路核查、根因分析、严重度分级、必要时分派 `repair` Codex 维修员执行。紧急时仍可由独立 Codex 特权会话手动接管。推荐手动命令:

```bash
codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -C /Users/yutu6/玉兔6工作区 "$(cat /Users/yutu6/玉兔6工作区/board/repair-tickets/repair-20260717-report-required-sections.md)"
```

## 处理结果
- status: todo

## 结案协议
- 本维修请求单独建单,不同故障不得混入本单。
- 完成记录必须包含:链路证据、需求传递判断、严重度、根因、处理过程、复核验证、架构判断、知识沉淀候选、剩余风险 / 下一步。
- 使用 `repair-ticket-complete` 结案;系统生成固定 HTML,飞书发送摘要卡 + 附件,元宵同步报告文档。
- 收口握手启用后,`repair-ticket-complete` 遇到 running repair 子任务会返回 `closing_pending_child`;子任务进入终态后用 `repair-ticket-child-confirm --mode read-only-no-op-confirmed` 确认,再重试结案。
- TTL 超时只生成签名主人决策卡;`force-read-only` 必须消费持久化拍板回执,并保留 unconfirmed child warning。
