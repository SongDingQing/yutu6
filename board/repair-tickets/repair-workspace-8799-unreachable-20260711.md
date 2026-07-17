# 维修工单 repair-workspace-8799-unreachable-20260711 · 8799 workspace 页面无法打开

- status: done
- created_at: 2026-07-11T04:09:55.795Z
- source: 主人直接交办
- priority: high

## 问题
http://127.0.0.1:8799/workspace 无法打开。

## 事件证据 / 路径
- 主人现场反馈；需核对 8799 监听、服务进程、路由与日志。

## 期望结果
8799/workspace 返回 HTTP 200，页面可渲染，服务可持续运行。

## 红线
- 密钥/token/cookie/私钥不回显、不写日志
- 不误杀合法任务
- 只修改确认故障的服务或路由

## 维修部门消费方式(v3 主管先行)
`repair-lead` 是维修主管队列(Codex 特权),所有工单默认先进主管:链路核查、根因分析、严重度分级、必要时分派 `repair` Codex 维修员执行。紧急时仍可由独立 Codex 特权会话手动接管。推荐手动命令:

```bash
codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -C /Users/yutu6/玉兔6工作区 "$(cat /Users/yutu6/玉兔6工作区/board/repair-tickets/repair-workspace-8799-unreachable-20260711.md)"
```

## 处理结果
- status: done

## 结案协议
- 本维修请求单独建单,不同故障不得混入本单。
- 完成记录必须包含:链路证据、需求传递判断、严重度、根因、处理过程、复核验证、架构判断、知识沉淀候选、剩余风险 / 下一步。
- 使用 `repair-ticket-complete` 结案;系统生成固定 HTML,飞书发送摘要卡 + 附件,元宵同步报告文档。

### 完成记录 2026-07-11T04:15:03.242Z
- status: done
- report: projects/控制台/artifacts/repair-reports/repair-workspace-8799-unreachable-20260711.html
- report_sha256: 30811517c0452e409b53651f917005065bb067e3187e3ff54bda55924a49025d

链路证据: 主人报告 http://127.0.0.1:8799/workspace 无法打开；lsof 与 curl 证实 8799 无监听。engine-events.jsonl 中 cr-1783690617966-034079bb、cr-1783691591671-034079bb 显示昨日执行智能体仅以 PORT=8799 node server.js 临时启动用于视觉验收，任务退出时进程随会话结束；正式 launchd 服务始终只监听 41218。
需求传递判断: 无本次交接遗漏。历史报告把临时验收地址写成可继续访问的页面，却未标注生命周期或持久化入口，这是历史交接语义缺口。
严重度: 小问题但具有可复发性。只影响一个兼容书签，不影响 41218 正式服务和队列；若继续让智能体随意写临时端口，会重复出现。
根因: 8799 是任务会话内的临时 server.js 进程，不是 launchd 管理的正式端口；会话结束后必然停止。直接再起第二套完整 server 会重复队列监督器，因此不能作为长期修法。
处理过程: 在 config.json 登记 aliasPorts=[8799]；server.js 让同一正式进程共享 handler 同时监听主端口与兼容端口的 IPv4/IPv6，临时显式换端口时默认不继承生产别名；README 标明 8799 是兼容书签；新增 console-alias-port.test.js 并接入 tests/run.js；安全重启 com.yutu6.console。
复核验证: node --check server.js 通过；console-alias-port.test.js、server-async-unblock.test.js、workspace-task-status-truth.test.js、workspace-taskboard.test.js 均通过；git diff --check 与密钥扫描通过；curl 对 127.0.0.1:8799/workspace、[::1]:8799/workspace、127.0.0.1:41218/api/health 均返回 200；lsof 显示同一 node PID 同时监听 8799 IPv4/IPv6；Peekaboo 实拍 projects/控制台/artifacts/repair-workspace-8799-20260711/workspace-8799-after.png，Chrome 地址栏和工作区页面均正常。
架构判断: 可泛化模式。开发/验收临时端口不得在报告中冒充持久入口；需要兼容旧地址时，应由正式进程共享 handler 或由明确的轻量代理提供，不能再启动第二套控制平面。
知识沉淀候选: 问题模式 -> 报告引用任务生命周期内临时端口，任务结束后书签失效；根因 -> 临时验收服务与正式服务生命周期未区分；解法 -> 报告标注临时/正式入口，兼容地址由正式单实例配置化监听，并用重启后的双端口回归锁定。
剩余风险 / 下一步: 无需主人操作。若未来 8799 被其他本地程序占用，正式 41218 仍继续工作，日志会明确记录兼容监听失败；当前未发现端口冲突。
