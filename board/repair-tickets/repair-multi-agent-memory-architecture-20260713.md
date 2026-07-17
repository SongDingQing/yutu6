# 维修工单 repair-multi-agent-memory-architecture-20260713 · 多智能体架构内存占用治理

- status: done
- created_at: 2026-07-13T12:36:15.024Z
- source: 主人直接交办
- priority: high

## 问题
多智能体运行时有时内存占用过高，需要从 server、worker、engine、runner、守护进程、轮询与缓存生命周期做整体审视并降低常驻和峰值内存。

## 事件证据 / 路径
- 当前正式 console PID 65777 RSS 约 225MiB，另有 3 个空闲 ceo-worker 常驻；需结合真实进程树、队列与代码路径定位。

## 期望结果
建立可复现基线，落地低风险减内存改动，保持队列可靠性和合法任务不被误杀，并以回归测试和修改前后数据验收。

## 红线
- 密钥/token/cookie/私钥不回显、不写日志
- 不误杀合法任务或改变既有队列/API语义
- 涉及并发、模型路由、功能降级的高风险方案需主人拍板
- 不提交或回退工作区无关改动

## 维修部门消费方式(v3 主管先行)
`repair-lead` 是维修主管队列(Codex 特权),所有工单默认先进主管:链路核查、根因分析、严重度分级、必要时分派 `repair` Codex 维修员执行。紧急时仍可由独立 Codex 特权会话手动接管。推荐手动命令:

```bash
codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -C /Users/yutu6/玉兔6工作区 "$(cat /Users/yutu6/玉兔6工作区/board/repair-tickets/repair-multi-agent-memory-architecture-20260713.md)"
```

## 处理结果
- status: done

## 结案协议
- 本维修请求单独建单,不同故障不得混入本单。
- 完成记录必须包含:链路证据、需求传递判断、严重度、根因、处理过程、复核验证、架构判断、知识沉淀候选、剩余风险 / 下一步。
- 使用 `repair-ticket-complete` 结案;系统生成固定 HTML,飞书发送摘要卡 + 附件,元宵同步报告文档。

### 完成记录 2026-07-13T12:53:45.712Z
- status: done
- report: projects/控制台/artifacts/repair-reports/repair-multi-agent-memory-architecture-20260713.html
- report_sha256: b783ea492e08c69e62ae7713ddfb06d9468187f08515073403349bb09a834e63

## 链路证据
主人直接在当前 Codex 维修主管会话提出“审视整体架构并减少多智能体内存占用”。工单为 board/repair-tickets/repair-multi-agent-memory-architecture-20260713.md。实际证据来自 ps/vmmap、artifacts 目录规模、queue running 文件、server/worker 源码、浏览器页面与 API 实测；没有依赖系统内部 done 声明。

## 需求传递判断
本次由维修主管直接接单，没有秘书→CEO→主管交接层，因此不存在 brief 被中间环节遗漏。需求边界完整保留为：降低常驻和峰值内存、不得误杀合法任务、不得破坏队列/API/事件语义、吞吐取舍交给主人拍板。

## 严重度
严重但非停机：属于长期运行的系统性资源治理问题。空闲 worker 累积、全历史扫描和前端高频轮询会随使用时间与 agent 数增加；不是单一页面的小问题，因此做控制面全链路排查。

## 根因
1. 非持久 queue worker 排空后不退出，用过的 agent 会逐步留下 Node/V8 常驻进程。
2. ensureWorkersForBacklog 每 10 秒用 Q.list 扫描 queued/running/done/failed/canceled 全历史，只为判断是否有活。
3. workspace 每 1.5 秒对约 28 个 agent 各发一个队列请求，并拉事件、任务板、公告板；页面隐藏时仍跑且没有防重入。
4. /api/events 重读并解析事件尾部，任务板反复枚举近千个终态任务文件，持续制造短命对象并促使 V8 扩堆。
5. ENGINE_MAX_CONCURRENCY=3 会在真实任务高峰同时驻留三个重型 CLI，是剩余峰值内存的最大可调旋钮。

## 处理过程
- ceo-worker.js：非持久 worker 连续空闲默认 5 分钟后退出；有 queued/running 或活动句柄时不退出；repair/repair-lead 显式持久。
- shared/engine/queue.js：新增只检查 queued/running 的 Q.hasWork。
- server.js：监督器改轻探测；增加 /api/queues/overview、队列/agent/终态缓存与写入失效；事件改增量游标；/api/health 增加内存指标。
- workspace.html：28 路队列请求合并为一个，保留旧 API 回退；隐藏标签暂停轮询；请求防重入；核心轮询 2.5 秒、公告板 10 秒、状态探测 60 秒。
- README 和 tests/memory-architecture.test.js 补充运行边界与回归。
- 未删除任何审计产物，未改并发上限；已把“3→2 低内存模式”作为公告板待拍板卡 bb-mrj83h5n-c4617c。

## 复核验证
- node --check 相关 JS 全通过，git diff --check 通过。
- node tests/run.js 输出 All tests passed。
- 临时队列 smoke 证明非持久 worker 在 803ms 测试阈值后发 queue.worker.idle_exit 并 code 0 退出。
- launchd 真重启：server PID 65777→89124；41218/8799 均有 IPv4/IPv6 监听。
- 工作区实际刷新后 23 个工位与任务板正常，浏览器 console 无 warn/error。
- 旧 server RSS 230928 KiB、物理 183.3M、峰值 198.7M；空闲观察约 2 分钟后为 RSS 84528 KiB、物理 32.9M、峰值 56.1M，分别下降约 63.4%、82.1%、71.8%。
- server + worker 聚合：最早约 430 MiB（server+3 个空闲 worker），现在约 203 MiB（server+2 个必要持久维修 worker），约下降 53%。
- 热接口：queue overview 1.0-1.9ms、task board 1.1-2.3ms、events 1.4ms。

## 架构判断
文件队列本身已承担持久性，不需要所有 agent worker 永久常驻。正确边界是：少数系统角色持久，普通角色按需拉起并在连续空闲后退出；监督层只看可执行状态；审计历史用游标/目录签名缓存；UI 只在可见时观察。并发数决定峰值内存与吞吐，不能在无主人确认时静默下调。

## 知识沉淀候选
已写 projects/控制台/artifacts/self-reflection-optimizer/multi-agent-memory-architecture-20260713.md，并追加 board/learning-cases/self-reflection-optimizer-cases.md。可泛化原则：不要让审计历史规模直接决定每轮扫描成本；worker 生命周期、监督轻探测、历史缓存、页面可见性和模型并发必须独立配置。

## 剩余风险 / 下一步
1. ENGINE_MAX_CONCURRENCY 仍为 3；若主人接受吞吐下降，可启用并发 2 的低内存模式。
2. artifacts 已约 2.0G；它主要是磁盘/扫描风险，不是当前 RSS 主因。需先确定审计保留期和归档索引，不能直接删除。
3. 本次空闲观测已证明控制面稳定；真实三个重型 CLI 同时执行时的峰值仍取决于各模型进程，应后续做一次受控负载基准。
