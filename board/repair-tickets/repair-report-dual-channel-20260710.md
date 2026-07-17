# 维修工单 repair-report-dual-channel-20260710 · 维修报告双通道与单工单闭环

- status: done
- created_at: 2026-07-10T15:57:03.311Z
- source: 主人直接交办
- priority: high

## 问题
维修主管需要直接通过飞书和元宵与主人沟通；每个维修请求必须独立建单，完成后以固定 HTML 汇报维修过程和成果。

## 事件证据 / 路径
- 现有 repair-ticket-complete 仅发简短飞书文本；notify-feishu 尚不支持文件附件；元宵已有 inbox/cards/file-exchange 接口。

## 期望结果
单维修请求单工单；结案自动生成脱敏固定 HTML；飞书发送摘要卡和 HTML 附件；元宵同步 report 卡与回执；重复结案不重复投递。

## 红线
- 密钥/token/cookie/私钥不回显、不写日志
- 高危不可逆操作先给主人确认
- 外部发送仅限主人已明确授权的本次验收与后续维修结案

## 维修部门消费方式(v3 主管先行)
`repair-lead` 是维修主管队列(Codex 特权),所有工单默认先进主管:链路核查、根因分析、严重度分级、必要时分派 `repair` Codex 维修员执行。紧急时仍可由独立 Codex 特权会话手动接管。推荐手动命令:

```bash
codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -C /Users/yutu6/玉兔6工作区 "$(cat /Users/yutu6/玉兔6工作区/board/repair-tickets/repair-report-dual-channel-20260710.md)"
```

## 处理结果
- status: done

### 完成记录 2026-07-10T16:07:48.348Z
- status: done
- report: projects/控制台/artifacts/repair-reports/repair-report-dual-channel-20260710.html
- report_sha256: 96c2bd380204f801856afdac59a756b8c29f3fb9bd508de1a2cb359e2977db98

链路证据: 主人直接向维修主管提出双通道沟通与固定 HTML 结案要求；维修主管核对了 secretary-tools.js、notify-feishu.sh、元宵 api-contracts.md、yuanxiao_server.py 与 Android 文档同步实现，再由本次外部 Codex 直接落盘并复核。
需求传递判断: 无遗漏。需求被固化为“维修请求一事一单、飞书卡片加 HTML 附件、元宵同步同一 HTML、分别保留幂等回执”；普通非维修任务仍保持秘书到 CEO 路由。
严重度: 重要流程能力。影响所有后续维修结案与主人可追溯沟通，但不涉及不可逆数据操作。
根因: 既有 repair-ticket-complete 只发送简短飞书消息；飞书脚本没有文件上传；元宵接口虽已有 inbox 与文档更新契约，但维修链路没有调用；维修主管定义仍残留 Claude runner。
处理过程: 新增 repair-report.js 固定九段式脱敏 HTML；新增 repair-report-delivery.js 通过元宵 inbox 同步 HTML 文档并按报告哈希去重；扩展 notify-feishu.sh 上传 stream 文件并发送附件；secretary-tools 结案自动生成报告、发送双通道并记录事件；维修主管改为 codex-privileged，并把一事一单与报告协议写入主管、维修员、模板和测试。
复核验证: node tests/repair-report.test.js、feishu-card-types.test.js、repair-ticket-bulletin.test.js、repair-department.test.js、agents-check.test.js、feishu-notify-rate.test.js、owner-auto-notify-test.js 均通过；node tests/run.js 中本次相关测试全绿，另有既有 office-experiment 40 格地板断言失败，与本改动无关。
架构判断: 这是可泛化的维修结案协议。报告生成与通道投递解耦，修复完成不因外部通道短暂失败而丢失；失败回执可重试，成功回执幂等。
知识沉淀候选: 问题模式 -> 维修完成只有自述消息、无固定证据载体；根因 -> 工单、报告与外部通道未形成机器协议；解法 -> 单工单单 HTML、结构字段固定、发送前脱敏、飞书和元宵分别幂等并保留回执。
剩余风险 / 下一步: 元宵通过 SSH 回环接口投递，依赖 VPS 与 SSH 可达；飞书附件依赖机器人 file 权限。两者失败时本地报告与失败状态会保留，可重跑同一结案命令。
