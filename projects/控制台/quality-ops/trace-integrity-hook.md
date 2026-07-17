# Trace 完整性 hook 与审计门

状态：运行时已启用。拥有点为 `shared/engine/interaction-trace.js`，质量审计消费者为 `shared/engine/quality-ops-audit.js`。

## 统一过程/命令回执候选（v2，尚未启用）

`projects/控制台/process-receipt-hook.js` 在旧 v1 trace 之外定义独立的 `process-summary.contract.redacted.json` sidecar；不覆盖旧 `process-summary.redacted.log`，因此现有 trace 完整性检查与质量审计门保持不变。获批启用后，同步 runner、异步 runner、董事会直连与 failover 尝试都经过同一出口；缺少可核 trace、白名单动作名、整数退出码或证据时只写 `availability=unavailable`，不猜测过程。

v2 仅允许记录白名单动作名、整数退出码、仓库内受影响文件和证据引用；证据基础文件必须真实存在，`:行号`/`#L行号` 还必须能定位到文件内真实行。禁止命令参数、原始输出、隐藏思维链和敏感路径；process-summary 与 critical receipt 都在压缩后执行完整合同校验，并按 writer 最终 pretty JSON（含末尾换行）计算单份 8192 字符上限，每个列表最多 32 项。available 压缩结果至少保留一条证据，否则转为 `unavailable/summary_length_limit`。质量运营 `schedule`、`ingest`、`weekly` 使用同一 writer 写独立 `yutu6-critical-action-receipt@1`。配置单一入口为 `projects/控制台/config/process-receipts.json`；当前 `enabled=false`、`supervisorReviewed=false`、`ownerApproved=false`，环境变量只能执行 kill switch，不能绕过主人批准启用。

## 完成时检查

每次 interaction 完成都检查同目录四件套：

1. `task.redacted.md`：存在、可读、非空且不是整值占位词。
2. `result.redacted.md`：存在、可读、非空且不是整值占位词。
3. `process-summary.redacted.log`：必须是 `yutu6-process-summary-redacted@1` JSON，hook 直接读取并执行 `schemas/process-summary.redacted.schema.json`，校验 `required/const/type/format/additionalProperties/$ref/if-then-else/not`、长度和数组唯一性约束，不再只检查手写字段子集。`date-time` 按 RFC3339 结构、真实日历日期和时区范围校验，2 月 30 日、非闰年 2 月 29 日和 `+24:00` 不能通过。
4. `interaction-trace.json` manifest：`schema` 必须精确等于 `yutu6-interaction-trace@1`，且至少包含有效 `trace_id`、`task_id`、`agent_id` 与 `runner_id`。当 handoff meta 已有任务协议指纹时，manifest 必须携带相同 `spec_fingerprint`；缺失或不一致均降级为 observability warning。

“略、声明、n/a、na、none、null、待补、稍后补、见上、同上”只按去空白和外围标点后的完整字段值判占位，不作任意子串匹配；例如“声明文件已更新”是有效目标摘要。该规则对 `read_or_analysis`、`write` 和 `publish` 全部分类生效。结构化目标项会先逐项过滤占位值，再拼接“目标文件:”前缀，避免前缀掩盖占位内容。

handoff 指纹分工：`meta.spec_fingerprint` 只存任务协议指纹，与执行信封/receipt/manifest 一致；`meta.task_document_fingerprint` 只存 `task.md` 内容哈希，用于 handoff 指针完整性校验。旧 meta 仅有 `spec_fingerprint` 时仍可按旧文档指纹语义读取，但新写入不得再混用。

## 写操作与发布任务的双因子口径

只有两个因子同时命中才标为 `write` 或 `publish`：

- 标签因子：节点 id 为 `implement/execute/repair/release/deploy/publish/build`，或角色为 `worker_code/frontend_designer/it_engineer/repair`，或结构化 task tag 为 `write/mutation/mutating/publish/release/deploy/build/repair`。
- 命令或能力因子：runner 为 `openai_http_tool_harness`，或安全命令元数据的 executable 位于写能力清单（shell、git、npm/node、Codex、Claude、Python、rsync/scp）。

双因子判断及命中来源写入 `classification`。写/发布摘要必须有安全的 `command` 元数据、整数 `exit_code`、非占位 `target_summary` 与 `completed/failed` 终态。命令参数一律不记录；目标优先使用结构化 `changed_files`，没有时使用已脱敏、截断的任务目标。

## 脱敏、长度和降级

- 命令只记录 operation、runner id/kind 与 executable，不记录 argv、prompt 或环境变量。
- 脱敏覆盖 Bearer/Basic authorization（包含 4 字符的最短合法 Base64 凭据）、URL userinfo 凭据、查询参数/环境变量/JSON 密钥字段，以及 GitHub/GitLab 等常见 token 形态；回归只使用构造凭据。
- stderr 不超过 32768 字符时整体脱敏；超限时取末尾 32768 字符并先丢弃截断点所在的不完整首行，再脱敏完整行，避免凭据被切断后仅剩无前缀片段。最终安全摘要上限 2400 字符，截断标记也计入该总预算；目标摘要上限 900 字符。
- 缺件或内容无效不阻断 runner 结果：manifest 写 `observability_status=warning` 和可合并的 `observability_warning[]`，同时以单行原子追加方式写 `observability-warnings.jsonl`。
- manifest 合并使用同目录独占锁和原子 rename；告警按稳定 id 去重。并发写入不会以最后写覆盖前一条告警。
- hook 自身异常只追加 `trace-hook-errors.jsonl`、写 manifest `hook_error[]` 并发出 `interaction.trace.hook_error`；同时派生稳定 `trace_integrity_hook_error` observability warning，调用方仍按原业务结果继续。

## audit-gate 消费规则

interaction finished 索引携带 `observability_warning` 和 `hook_error`，质量审计 plan 将它们放入 `trace_refs`。`validateFindings` 在 ingest 和 review ledger 落盘前执行独立 audit-gate：任一 planned chain 含 observability warning 或 hook error 时，`verdict=pass` 必须拒绝，只有 `warning/fail` 可继续。即使 warning 写入本身也失败，audit-gate 仍会将 `hook_error` 独立转为 no-pass 信号。该检查不读取一般 done-gate 结果，因此不会被任务完成状态、其他 warning 或结果自述覆盖。
