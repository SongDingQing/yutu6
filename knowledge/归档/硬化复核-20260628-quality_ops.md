# 硬化复核归档 · quality_ops · 2026-06-28

## 复核范围

- 复核对象:`knowledge/归档/硬化建议-20260628.md`
- 复核日期:2026-06-28
- 项目范围:`projects/控制台/` 与本任务明确输入
- 红线:Starlaid/星桥排除;密钥不回显;不做特权维修;不做不可逆操作;不直接改核心引擎;高危硬化交主人/维修员 human gate。

## 复核结论

- 文件系统与命令能力可用:已读取 `knowledge/归档/硬化建议-20260628.md`、`memory/decisions.md`、`templates/structured-acceptance-table.md`,并对 `projects/控制台/artifacts/engine-events.jsonl` 做只读聚合统计。
- `knowledge/归档/硬化建议-20260628.md` 存在,大小 2406 bytes,mtime 为 2026-06-28T05:00:08+0800。
- Smoke 表存在,记录 5 个用例;其中 `mechanisms-smoke` 为 `pass=false code=1`,其余 `resource-locks-smoke`、`project-guard-smoke`、`serial-smoke`、`long-run-maintenance` 为 `code=0`。本复核不执行 daily smoke,只复核归档内容和日志证据。
- 资源与队列检查存在,包含 `long-run-maintenance` 摘要和队列 queued/running/paused/failed 表;但未见 CPU/内存/磁盘字段,建议 daily 报告后续把资源检查口径显式化。
- 可回退硬化建议存在 1 条:`H-1 mechanisms-smoke 失败收口`,含风险和回退方式。
- 产物审计有缺口:`projects/控制台/artifacts/daily-governance-hardening/` 下未见 `run-20260628.jsonl` 或 `report-state-20260628.json`,且 `launchd.out.log` 未检索到 20260628/硬化建议-20260628 记录;因此只能确认硬化归档文件存在并可读,不能确认当天 daily-governance 的 JSONL 审计产物完整。
- 归档自检清单中“本机 smoke 有真实执行结果”和“硬化归档非空、非骨架”仍未勾选,与前文 smoke 表/文件存在事实不一致;应作为 report consistency 缺口处理,不能因此把任务说成“全绿”。

## 事件日志增量复核

数据源:`projects/控制台/artifacts/engine-events.jsonl`。窗口:`2026-06-26T21:00:00.000Z` 至 `2026-06-27T21:00:00.000Z`(北京时间 2026-06-27 05:00 至 2026-06-28 05:00)。统计时排除 Starlaid/星桥文本,并限定 `projectId=控制台` 或无跨项目污染的控制台事件。窗口内计入 1910 条事件。

| 模式 | 命中次数 | 形态 | 预计节省 | 风险 | 是否需 human gate | 可回退方案 |
|---|---:|---|---|---|---|---|
| `queue.running.keepalive` 且 `reason=engine pid alive` 高频写入 | 926 | 报告级 rollup 或读侧聚合,先不改事件写入 | 中:减少复盘/硬化时解析和展示噪声 | medium | 若改事件写入需;若只改报告聚合不需 | 保留原始 JSONL 不变;关闭 rollup 后恢复逐条展示 |
| `node.output -> node.output -> node.output` 连续输出序列 | 388 组三连 | daily 统计时只保留摘要、首尾和行数 | 中:降低复盘 token 与报告长度 | low | 否 | 报告字段回退到原始 tail;不影响原始日志 |
| `task.created -> node.start -> runner.tool_harness.upgrade` | 7 | 对声明可写的 `quality_ops`/`insight-scout` 预选 tools runner,保留现有升级兜底 | 小到中:减少升级事件和一次 runner 切换 | medium | 是,会影响 runner routing | 配置开关关闭预选,回到现有 `runner.tool_harness.upgrade` 兜底 |
| `mechanisms-smoke` 连续红灯且 H-1 只写“建议开单” | 06-24 至 06-28 连续多窗 | daily 只读校验“连续红 >=2 必有维修工单或显式豁免” | 高:避免同一 smoke 红灯每天重复消费复核 | medium | 是,涉及工单/维修 owner | 先 dry-run 只报缺口;误报时关闭校验或补豁免文件 |
| 20260628 硬化归档存在但 daily JSONL 审计产物缺失 | 1 | 增加 report artifact 完整性检查 | 中:避免“有 md 无审计”的半产物被当全链路完成 | low | 否 | `--skip-artifact-audit` 或删除新增检查,保留 md 原文 |

## 可回退补充建议

1. `mechanisms-smoke` 失败应从“文本建议开单”升级为“只读检查是否已有工单/豁免”。证据显示失败断言为 `checkAutoOptimizer` 期望 `disabled` 但得到 `enqueued`,且历史维修票已把它列为残余测试债。本复核不直接维修,只建议 daily 报告在连续红灯时把“无工单/无豁免”标红。回退:该检查先 dry-run,误报时关闭检查或补充豁免文件。
2. daily 产物审计应把 `knowledge/归档/硬化建议-YYYYMMDD.md`、`run-YYYYMMDD.jsonl`、`report-state-YYYYMMDD.json` 视为同一产物组。当前 20260628 只有 md 可见,缺 JSONL/状态产物,后续应输出 `partial` 而非暗示全链路审计完成。回退:只影响报告判定,不改 smoke 和队列执行。
3. 高频 keepalive 与连续 `node.output` 属确定性日志噪声,适合先在 daily 报告读侧聚合,不建议直接改核心事件写入。回退:保留原始 JSONL,关闭读侧聚合即可恢复。
4. `runner.tool_harness.upgrade` 对可写任务重复出现,可做配置级预路由,但必须保留现有自动升级兜底并经 human gate。回退:关闭预路由,回到现有 runner 选择路径。

## 结构化验收表

| 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 |
|---|---|---|---|
| 设计对照 memory/decisions.md:25 任务:修引擎项目归属判断,确保记忆集成、修维修机制、Gitee 接入等系统级任务可路由。 边界:只处理 projects/控制台/ 与明确输入; Starlaid 一律排除; 密钥不回显; 登录/授权交主人手动。 CEO plan 红线复述: 如果涉及 Starlaid 或星桥,立即停止并不处理。 | 完成 | memory/decisions.md:25 | 已按控制台范围复核;未处理 Starlaid/星桥;未回显密钥;未触碰登录/授权。 |
| 设计对照 memory/decisions.md:33 任务:修引擎项目归属判断,确保记忆集成、修维修机制、Gitee 接入等系统级任务可路由。 边界:只处理 projects/控制台/ 与明确输入; Starlaid 一律排除; 密钥不回显; 登录/授权交主人手动。 CEO plan 红线复述: 如果涉及 Starlaid 或星桥,立即停止并不处理。 | 完成 | memory/decisions.md:33 | 同上。 |
| 设计对照 memory/decisions.md:77 任务:修引擎项目归属判断,确保记忆集成、修维修机制、Gitee 接入等系统级任务可路由。 边界:只处理 projects/控制台/ 与明确输入; Starlaid 一律排除; 密钥不回显; 登录/授权交主人手动。 CEO plan 红线复述: 如果涉及 Starlaid 或星桥,立即停止并不处理。 | 完成 | memory/decisions.md:77 | 同上。 |
| 设计对照 memory/decisions.md:385 任务:修引擎项目归属判断,确保记忆集成、修维修机制、Gitee 接入等系统级任务可路由。 边界:只处理 projects/控制台/ 与明确输入; Starlaid 一律排除; 密钥不回显; 登录/授权交主人手动。 CEO plan 红线复述: 如果涉及 Starlaid 或星桥,立即停止并不处理。 | 完成 | memory/decisions.md:385 | 同上。 |
| 设计对照 memory/decisions.md:420 任务:修引擎项目归属判断,确保记忆集成、修维修机制、Gitee 接入等系统级任务可路由。 边界:只处理 projects/控制台/ 与明确输入; Starlaid 一律排除; 密钥不回显; 登录/授权交主人手动。 CEO plan 红线复述: 如果涉及 Starlaid 或星桥,立即停止并不处理。 | 完成 | memory/decisions.md:420 | 同上。 |
| 设计对照 memory/decisions.md:532 任务:修引擎项目归属判断,确保记忆集成、修维修机制、Gitee 接入等系统级任务可路由。 边界:只处理 projects/控制台/ 与明确输入; Starlaid 一律排除; 密钥不回显; 登录/授权交主人手动。 CEO plan 红线复述: 如果涉及 Starlaid 或星桥,立即停止并不处理。 | 完成 | memory/decisions.md:532 | 同上。 |
| 任务验收: 复核 daily-governance-hardening 本机写出的 knowledge/归档/硬化建议-20260628.md | 完成 | knowledge/归档/硬化建议-20260628.md:6; knowledge/归档/硬化建议-20260628.md:18; knowledge/归档/硬化建议-20260628.md:45; knowledge/归档/硬化建议-20260628.md:55 | 已核对 smoke、资源队列、H-1 回退建议和自检清单;同时记录 20260628 JSONL 审计产物缺失与 smoke 红灯缺口。 |
| 任务验收: md;若当前 runner 无文件系统/命令能力,必须明确 done=false,不能把执行清单或骨架当作已硬化。 | 完成 | 命令:`stat knowledge/归档/硬化建议-20260628.md` exit 0; 命令:`node` 事件统计 exit 0; projects/控制台/artifacts/engine-events.jsonl | 当前 runner 有真实 FS/exec 能力并已读文件/跑只读统计;因此输出 done=true 表示复核完成,不是文本模型骨架;未声称执行 daily smoke。 |
