# 玉兔6 控制台(本地 Web · Codex CLI)

蓝图 §5/§6 的"统一控制台":本地小服务 + 聊天网页,后端按所选 runner 把消息喂给对应 CLI(无头),流式回显。**只监听 localhost,不对外**。

## 跑起来(在装了 codex 的那台 Mac 上)

```bash
bash ~/玉兔6工作区/projects/控制台/start.sh
# 浏览器开 http://localhost:41218,右上角切 runner
```

> 必须在**装了 codex 的同一台机器**上启动 —— 服务端要 spawn Codex CLI。

## 先自测(不依赖 CLI)
右上角选 **Mock(自测)** 发一句 → 能流式回显,就说明网页↔服务闭环通了。再切 Codex。

## 核心安全网
改队列、项目路由或 CEO 串行锁前,先在工作区根运行:

```bash
node tests/run.js
```

手动快照(队列/记忆/看板/配置/系统 agent):

```bash
node projects/控制台/tools/backup-snapshot.js --once --keep 10
```

定时快照(常驻进程,示例每 60 分钟一次):

```bash
node projects/控制台/tools/backup-snapshot.js --daemon --interval-minutes 60 --keep 24
```

长期维护巡检(不杀进程;默认只观察和清 stale 锁/临时文件):

```bash
node projects/控制台/tools/long-run-maintenance.js --json --skip-console --skip-http
node projects/控制台/tools/repair-memory-maintenance.js --json
```

如主人确认启用本机定时任务,模板在 `projects/控制台/launchd/`:长期维护每 15 分钟,旧维修维护每 12 小时。旧 `repair-memory-maintenance.js` 只保留为历史维修维护入口,不要用它验收本机 RAM 看管;专用 RAM 看管见下一节。

## 本机 RAM 看管(专用,不要和记忆维护混用)

`tools/ram-watchdog.js` 是专门看管**本机运行内存 RAM**的入口,和 `memory/`、知识库、维修经验、记忆文件维护不是一回事;也不再把旧 `repair-memory-maintenance.js` 当成本轮 RAM 看护验收依据。

```bash
node projects/控制台/tools/ram-watchdog.js --json
bash projects/控制台/tools/install-ram-watchdog-launchd.sh --write-only
```

运行记录:

- 当前状态:`projects/控制台/artifacts/ram-watchdog/status.json`
- 趋势:`projects/控制台/artifacts/ram-watchdog/ram_trend.jsonl`,每行一条时间戳+已用/总量/swap/自体 RSS,默认保留最近 1000 条并自动轮转
- 动作审计:`projects/控制台/artifacts/ram-watchdog/actions.jsonl`,默认保留最近 1000 条

安全边界:

- 仅支持 macOS/Darwin;其他平台会写明 `supportedPlatform=false` 后退出。
- 默认采样周期 60 秒,launchd 模板每 300 秒触发一次单次采样;采样用 lock 文件互斥,避免"连续 N 次超限"状态并发错乱。
- 默认自动动作只做采样、告警、dry-run 清单、before/after 观测和 JSONL 轮转;不会自动执行 `sudo purge`,只在高压时列出可回收缓存估算和给主人手动执行的 `sudo purge`。
- 默认不 kill 进程。进程处理采用反向白名单:默认不可杀,只有显式 `kill_allowlist` 且不在保护名单的进程才会进入候选清单。`enable_kill=true`、`kill_confirm=RAM_WATCHDOG_ENABLE_KILL`、`kill_supervisor_approved=true` 与 CLI `--execute-kill` 只作为后续单独验收的配置门;第一版仍固定 dry-run,不执行真杀。
- 预置保护至少包含 `kernel_task`、`launchd`、`WindowServer`、`loginwindow`、`Finder`、看护器自身 PID/父 PID、控制台队列 worker/running engine PID;能检测到前台 App 时会临时加入保护名单。
- 看护器自身 RSS 默认上限 256MB;超限会写入 `status.json`/事件日志,daemon 模式会退出交由 launchd 重启。

每日复盘 + 硬化定时(北京时间凌晨5点):

```bash
# 安装/加载(本机时区 = Asia/Shanghai,Hour=5 即北京凌晨5点 = UTC 21:00)
bash projects/控制台/tools/install-daily-governance-hardening-launchd.sh
# 只生成 plist 不加载 / 卸载
bash projects/控制台/tools/install-daily-governance-hardening-launchd.sh --write-only
bash projects/控制台/tools/install-daily-governance-hardening-launchd.sh --unload
# 手动补投一次(幂等,当天已投则跳过)
node projects/控制台/tools/daily-governance-hardening.js --json
```

到点由 `tools/daily-governance-hardening.js` 向队列投递两条任务:`governance`(监管/复盘:复盘当天问题+维修、经验沉淀到 `memory/`)与 `quality_ops`(质量运营/硬化:跑 smoke 测试 + 资源检查 + 可回退硬化建议)。**不重复**:用北京日期拼确定性 id(`gov-review-YYYYMMDD` / `qops-harden-YYYYMMDD`),投递前扫描该 agent 全部状态目录,命中即跳过,即使休眠唤醒多次触发也只入队一次。**时区**:launchd `StartCalendarInterval` 走本机本地时区;若本机改为 UTC,需把 `DGH_HOUR=21` 或改 plist 的 `Hour`。运行记录落 `artifacts/daily-governance-hardening/run-YYYYMMDD.jsonl`。Starlaid 一律排除。

## 主要 runner
| runner | 实际执行 | 备注 |
|---|---|---|
| Codex | `codex exec --sandbox danger-full-access --skip-git-repo-check "<消息>"` | 最终答案走 stdout、过程走 stderr(网页里折叠成"过程日志") |
| Codex(特权) | `codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check "<消息>"` | 维修主管/维修员/桌面控制等高权限通道;高危操作仍需主人确认 |
| Mock | 内置假回显 | 自测闭环 |

`config.json` 里仍保留 `claude*` runner 定义,仅供历史任务/手动回退兼容;新任务不再自动路由到 Claude。

点 runner 旁的 **检测**,会跑 `<cli> --version` 看是否就绪。

## 调整(`config.json`)
- 命令不对 / 版本不同 → 改对应 runner 的 `cmd` 数组即可(用 spawn 直接传参,无需转义)。
- Codex 只读不改:把 `danger-full-access` 换成 `read-only`。
- `workdir`(runner 执行目录)默认指向工作区根 `../..`;`includeHistory/historyMax` 控制是否把近几轮历史拼进 prompt。

## 排错
- 网页打不开 / 连接失败 → 多半是**服务没在跑**或**端口不对**。确认 `start.sh` 在跑;默认端口 41218,要换端口:`PORT=8888 bash start.sh`(同时浏览器也开同一个端口)。
- 选 Codex 报"不在 PATH" → 在**新开的终端**里确认 `which codex`;CLI 装好后 PATH 可能要重开终端。
- 卡住不回 → CLI 可能在等审批/权限;看"过程日志",或按上面调 `config.json` 的参数。

## 现状 / 下一步
- v1:纯聊天 + runner 切换闭环(无状态,每条调用把近几轮历史拼进 prompt)。
- 待接:四层路由(读 `shared/routing/`,按角色自动选 runner/模型)、看板/任务视图、真·多轮会话续接(codex 会话)。
