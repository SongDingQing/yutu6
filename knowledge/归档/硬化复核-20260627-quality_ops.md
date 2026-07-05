# 硬化复核归档 · quality_ops · 2026-06-27

## 复核范围

- 复核对象:`knowledge/归档/硬化建议-20260627.md`
- 复核日期:2026-06-27
- 项目范围:`projects/控制台/` 与本任务明确输入
- 红线:Starlaid/星桥排除;密钥不回显;不做特权维修;不直接改核心引擎;高危改动交主人/维修员 human gate。

## 复核结论

- 文件系统与命令能力可用:`test -f knowledge/归档/硬化建议-20260627.md && test -f memory/decisions.md && test -f templates/structured-acceptance-table.md` 返回 `file_check_exit=0`。
- `knowledge/归档/硬化建议-20260627.md` 非空,共 58 行。
- Smoke 表存在,记录 5 个用例;其中 `mechanisms-smoke` 为 `pass=false`, code=1,其余 4 项通过。结论不是全绿,需要按既有决策进入维修归因,不能在 daily 脚本内特权修复。
- 资源与队列检查存在,包含 long-run-maintenance 摘要和队列 queued/running/paused/failed 表。
- 24h 事件概况存在,但本工作区未找到可复核的 `events*.jsonl`;未执行事件序列聚合,不声称已从原始事件日志得出新增高频序列。
- 可回退硬化建议存在 1 条:`H-1 mechanisms-smoke 失败收口`,含风险和回退方式。
- 产物自带验收清单中“本机 smoke 有真实执行结果”和“硬化归档非空、非骨架”仍为未勾选,这是报告一致性问题;不影响本次已完成复核,但应由 daily-governance-hardening 后续修正产物审计口径。

## 可回退补充建议

1. `mechanisms-smoke` 连续红灯应按 `memory/decisions.md:583` 强制进入维修工单归因,工单需附完整断言、失败定位、归因、修复或豁免和复跑绿证据。回退:若后续完整复跑证明为环境瞬时误报,撤销/关闭工单并保留本复核记录,不改引擎代码。
2. daily 产物审计增加“自检清单一致性”报告级门禁:当 Smoke 表、资源表、H 条目已经生成时,验收清单不得继续留空或未勾选;若有失败,应标注“部分通过/需维修”而不是空白。回退:该门禁只作为报告校验脚本或配置开关,误报时关闭门禁并保留原始报告。
3. daily 产物应记录事件日志来源路径、扫描窗口和行数;当前报告只有聚合计数,本复核无法从 `events*.jsonl` 复算高频确定序列。回退:只新增报告字段,不改变事件写入或队列执行逻辑;误报时删除字段或关闭事件来源审计。

## 结构化验收表

| 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 |
|---|---|---|---|
| 设计对照 memory/decisions.md:25 任务:修引擎项目归属判断,确保记忆集成、修维修机制、Gitee 接入等系统级任务可路由。 边界:只处理 projects/控制台/ 与明确输入; Starlaid 一律排除; 密钥不回显; 登录/授权交主人手动。 CEO plan 红线复述: 如果涉及 Starlaid 或星桥,立即停止并不处理。 | 完成 | memory/decisions.md:25 | 已按控制台范围复核;未处理 Starlaid/星桥;未回显密钥;未触碰登录/授权。 |
| 设计对照 memory/decisions.md:33 任务:修引擎项目归属判断,确保记忆集成、修维修机制、Gitee 接入等系统级任务可路由。 边界:只处理 projects/控制台/ 与明确输入; Starlaid 一律排除; 密钥不回显; 登录/授权交主人手动。 CEO plan 红线复述: 如果涉及 Starlaid 或星桥,立即停止并不处理。 | 完成 | memory/decisions.md:33 | 同上。 |
| 设计对照 memory/decisions.md:77 任务:修引擎项目归属判断,确保记忆集成、修维修机制、Gitee 接入等系统级任务可路由。 边界:只处理 projects/控制台/ 与明确输入; Starlaid 一律排除; 密钥不回显; 登录/授权交主人手动。 CEO plan 红线复述: 如果涉及 Starlaid 或星桥,立即停止并不处理。 | 完成 | memory/decisions.md:77 | 同上。 |
| 设计对照 memory/decisions.md:385 任务:修引擎项目归属判断,确保记忆集成、修维修机制、Gitee 接入等系统级任务可路由。 边界:只处理 projects/控制台/ 与明确输入; Starlaid 一律排除; 密钥不回显; 登录/授权交主人手动。 CEO plan 红线复述: 如果涉及 Starlaid 或星桥,立即停止并不处理。 | 完成 | memory/decisions.md:385 | 同上。 |
| 设计对照 memory/decisions.md:420 任务:修引擎项目归属判断,确保记忆集成、修维修机制、Gitee 接入等系统级任务可路由。 边界:只处理 projects/控制台/ 与明确输入; Starlaid 一律排除; 密钥不回显; 登录/授权交主人手动。 CEO plan 红线复述: 如果涉及 Starlaid 或星桥,立即停止并不处理。 | 完成 | memory/decisions.md:420 | 同上。 |
| 设计对照 memory/decisions.md:532 任务:修引擎项目归属判断,确保记忆集成、修维修机制、Gitee 接入等系统级任务可路由。 边界:只处理 projects/控制台/ 与明确输入; Starlaid 一律排除; 密钥不回显; 登录/授权交主人手动。 CEO plan 红线复述: 如果涉及 Starlaid 或星桥,立即停止并不处理。 | 完成 | memory/decisions.md:532 | 同上。 |
| 任务验收: 复核 daily-governance-hardening 本机写出的 knowledge/归档/硬化建议-20260627.md | 完成 | knowledge/归档/硬化建议-20260627.md:6; knowledge/归档/硬化建议-20260627.md:18; knowledge/归档/硬化建议-20260627.md:45; knowledge/归档/硬化建议-20260627.md:55 | 已核对 smoke、资源队列、H-1 回退建议和产物自检清单;发现 mechanisms-smoke 失败与自检清单未勾选风险。 |
| 任务验收: md;若当前 runner 无文件系统/命令能力,必须明确 done=false,不能把执行清单或骨架当作已硬化。 | 完成 | 命令:`test -f ...` 返回 `file_check_exit=0`; 命令:`find . -path '*Starlaid*' -prune -o -type f -name 'events*.jsonl' -print` 无输出 | 当前 runner 有文件系统/命令能力,因此输出 done=true 表示复核完成;未把失败 smoke 说成硬化完成,未声称执行 daily smoke。 |
