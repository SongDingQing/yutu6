# 自省优化 · projects/控制台/insight-scout-repos.js(2026-07-03,Claude Code skill 验证运行)

- 执行体:Claude Code `.claude/skills/self-review-optimize`
- 约束:验证运行——不 git commit(改动留工作树待秘书复核);账本 ≤8 条;auto_execute 只执行 2 条。
- 证据源:模块本体(585 行)、`tests/insight-scout-repos.test.js`、`memory/experience.md`(JSON 截断宽松解析/seen-repos 脏条目/N4 network 门控 3 条同族教训)、`memory/decisions.md`(insights.md 冷热分离待决项)、调用方 `engine-runner.js:1187-1230`、`server.js:1428-1480`、`shared/engine/queue.js`(idem 仅存元数据)。

## 挑刺账本

### 1. githubUrlsFromText 吞掉带点的 repo 名【已执行】
- 证据: insight-scout-repos.js:389(旧)正则 repo 段字符类排除 `.`,`https://github.com/socketio/socket.io` 被记成 `.../socket`
- 影响: seen-repos 去重库写入错误 URL;带点仓名(socket.io/next.js 等很常见)去重失效、语料被污染
- 修法: 字符类改为 GitHub 合法名字符 `[A-Za-z0-9_.-]`(仍排除反斜杠,保留脏条目修复),句末英文句点单独 `replace(/\.+$/,'')` 剥离
- 风险: low——纯模块内提取函数,`normalizeRepoUrl` 二次把关
- 分级: auto_execute
- 验证: `node tests/insight-scout-repos.test.js`(新增 4 URL 断言:socket.io/next.js/bar.git./字面量\n)→ pass

### 2. 损坏 JSON 被静默清空重建【已执行】
- 证据: insight-scout-repos.js:71-74 `readJson` 吞所有异常回退空值;updateSeenRepos(:402)/appendBulletinCards(:476)随后 `writeJsonAtomic` 整体覆盖
- 影响: seen-repos.json 或 cards.json 一旦损坏(半写/手改错),历史去重库与公告卡无声丢失,且无任何痕迹
- 修法: 新增 `readJsonWithCorruptBackup`:文件不存在=正常初始化;存在但解析失败=先 copy 成 `<file>.corrupt-<ts>` 再自愈重建
- 风险: low——行为仍自愈,只多一份备份;失败分支 try/catch 兜底
- 分级: auto_execute
- 验证: `node tests/insight-scout-repos.test.js`(新增损坏 workspace 用例:apply ok + `.corrupt-*` 备份存在 + 新文件合法)→ pass;`node tests/run.js` 全量 → All tests passed

### 3. unescapeLooseJsonString 转义替换顺序错误
- 证据: insight-scout-repos.js:104-112,`\\n` 在 `\\\\` 之前替换:输入含转义反斜杠 `\\n`(应还原为字面 `\n` 两字符)会被先当换行处理
- 影响: 宽松解析兜底路径对含转义反斜杠的 analysis 还原出错(与 experience.md 里 seen-repos 脏条目同源族)
- 修法: 改单趟替换 `.replace(/\\(["\\/rnt])/g, (_, c) => ({r:'\r',n:'\n',t:'\t'}[c] || c))`
- 风险: low,但属兜底路径、现网触发率低
- 分级: auto_execute(本轮限额 2 条未执行,留给下轮)
- 验证: 新增单测:`unescapeLooseJsonString('a\\\\nb')` 应得 `a\nb` 字面两字符

### 4. containsExcludedProject 白名单过宽
- 证据: insight-scout-repos.js:376-379,只要全文任意位置出现"排除/不涉及/无关/不处理"四词之一,整段 Starlaid 提及即放行
- 影响: 一张实际分析 Starlaid 的卡,只要顺带写了"其余排除"就绕过红线过滤;红线防线形同软约束
- 修法: 改为按"Starlaid/星桥 出现行"就近窗口(同句/同行 ±40 字)内才认豁免词;或匹配到即降级人工复核
- 风险: medium——收紧可能误杀 goal/bounds 里的合法"Starlaid 一律排除"声明文案,需先对存量语料回放
- 分级: owner_decision(涉及红线语义,拿不准降级)
- 验证: 对 board/insights/insights.md 存量跑新旧过滤 diff,零误杀再上

### 5. insights.md 全量读入做 marker 查重,文件单调膨胀
- 证据: insight-scout-repos.js:421 `readFileSync` 整文件;decisions.md:551 记录 insights.md 已约 309KB、每批 +18KB,冷热分离已是待决任务
- 影响: 每次 apply 的 IO/内存随文件线性涨;更大的问题(语料膨胀)已有立项
- 修法: marker 查重改只扫尾部 N KB,或 marker 索引独立小文件;根治依赖冷热分离方案
- 风险: medium——与已立项的冷热分离改造重叠,单独动容易返工
- 分级: defer(挂靠既有决策项,避免双头改)
- 验证: 冷热分离落地后此条自动消解

### 6. marker 兜底键可退化为常量,误判 already-applied
- 证据: insight-scout-repos.js:504,`markerKey = taskId || `${slot}:${queueAgent}:${queueId||''}``;taskId/slot/queueId 全空时所有手动 apply 共享同一 marker
- 影响: 手动/脚本调用不带 id 时,第二次起永远 `already-applied`,内容丢弃
- 修法: 全空时退化为内容哈希(如 analysis 的 sha1 前 10 位)作 markerKey
- 风险: low,但仅影响非常规调用路径
- 分级: owner_decision(改 marker 语义影响幂等判定口径,值不值得动请拍板)
- 验证: 单测:两次不同 analysis、全空 id 的 apply 都应 appended=true;相同 analysis 第二次 already-applied

### 7. beijingSlot 对非整小时 interval 的 key/index 口径不一致
- 证据: insight-scout-repos.js:43-50,`key` 用取整小时桶(最小 1h),`index` 用原始 intervalMs 直除;`INSIGHT_SCOUT_REPOS_INTERVAL_MS` 若配成 30min,slot.key 每小时一变而 index 每 30min 一变
- 影响: 主题轮换与去重 id 口径漂移;当前默认 4h 无害,属埋雷
- 修法: index 也从取整后的 intervalHours 推导,或直接拒绝 <1h 配置并记事件
- 分级: defer(现网配置恒 4h,证据只到"埋雷"级)
- 风险: low
- 验证: 单测 intervalMs=30min 时 key/index 同步性断言

### 8. enqueueDue check-then-act 竞态,idem 无强制去重
- 证据: insight-scout-repos.js:326-339 先 queueEntryHit 再 Q.enqueue;shared/engine/queue.js:145 idem 仅作为元数据存储,不做唯一性约束
- 影响: 双 scheduler/并发 tick 可能同 slot 双入队(现网单进程 scheduler + 检查在前,概率低);另 experience.md 已记 05:00 惊群决策,双入队会放大
- 修法: Q.enqueue 内按 idem 做原子存在性检查(mkdir/link 原子原语),属队列公共语义改动
- 分级: owner_decision(改公共队列语义,超出本模块边界)
- 风险: medium
- 验证: 并发 enqueueDue 压测单测,同 idem 只落一个 entry

## 已执行改动

- `projects/控制台/insight-scout-repos.js`:账本 1、2(githubUrlsFromText 正则修复;readJsonWithCorruptBackup 及两处接入;`_test` 补导出)
- `tests/insight-scout-repos.test.js`:两段回归(URL 提取 4 断言;损坏 JSON 备份自愈用例)
- 验证:`node tests/insight-scout-repos.test.js` pass;`node tests/run.js` 全量 All tests passed
- 未 git commit(按验证运行约束,留工作树)
