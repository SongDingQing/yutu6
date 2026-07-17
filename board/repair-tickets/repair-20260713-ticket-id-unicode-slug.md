# 维修工单 repair-20260713-ticket-id-unicode-slug · repair-ticket-add 中文标题自动 ID 与安全约束冲突

- status: todo
- created_at: 2026-07-13T10:51:45.534Z
- source: 秘书
- priority: normal

## 问题
不传 --id 且标题含中文时，slugText 保留 Unicode，但 safeTicketId/repairTicketPath 仅接受 ASCII，导致 repair-ticket-add 在创建文件前报 bad repair ticket id。当前工单新建架构评估单时已真实复现；显式 ASCII --id 可绕过。

## 事件证据 / 路径
- projects/控制台/secretary-tools.js:376-383,1264-1271；本次命令 repair-ticket-add --title 含中文且无 --id exit 1: bad repair ticket id。

## 期望结果
最小统一 ID 契约：自动 ID 必须始终满足 safeTicketId，可采用稳定 ASCII slug/hash；补中文、英文、符号和空标题回归。保持现有显式合法 ID、路径穿越拒绝和幂等语义。

## 红线
- 高危/不可逆操作必须先给主人确认
- 密钥/token/cookie/私钥不回显、不写日志
- 不破现有功能; 能验证就写验证结果

## 维修部门消费方式(v3 主管先行)
`repair-lead` 是维修主管队列(Codex 特权),所有工单默认先进主管:链路核查、根因分析、严重度分级、必要时分派 `repair` Codex 维修员执行。紧急时仍可由独立 Codex 特权会话手动接管。推荐手动命令:

```bash
codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -C /Users/yutu6/玉兔6工作区 "$(cat /Users/yutu6/玉兔6工作区/board/repair-tickets/repair-20260713-ticket-id-unicode-slug.md)"
```

## 处理结果
- status: todo

## 结案协议
- 本维修请求单独建单,不同故障不得混入本单。
- 完成记录必须包含:链路证据、需求传递判断、严重度、根因、处理过程、复核验证、架构判断、知识沉淀候选、剩余风险 / 下一步。
- 使用 `repair-ticket-complete` 结案;系统生成固定 HTML,飞书发送摘要卡 + 附件,元宵同步报告文档。
