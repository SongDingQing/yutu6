# 洞察员 · insights/

洞察员(`insight-scout`)每 4 小时自动研究「玉兔多智能体架构 + 各项目」相关的优秀开源仓库,**去重**后写入待办公告板,来源标注「洞察员」。

## 渐进披露读取契约

默认只读两份热区文件:

- `insights.md` — 最近 4 个 insight-scout 运行批次的热区分析,文件头含冷区导航。
- `seen-repos.json` — 去重热库,仅保留 `repos` URL 列表、`updated_at` 与说明字段。

需要历史上下文时再按需读取 `references/`:

- `references/archive-index.md` — 冷区索引、读取顺序、备份收敛说明。
- `references/archive-YYYYMM.md` — 旧批次原文归档;先按仓库名/URL/批次标题检索,只读命中的小节。
- `references/borrowed-watch.json` — 从 `seen-repos.json` 外移的 watch 配置与 `borrowed_libraries` 元数据;仅复看上游更新或审计借鉴库时读取。
- `references/backups/` — 旧 `.bak/.pre` 快照;根目录每个基准文件只保留最近 3 份。

- `borrowed-libs.md` — 已借鉴/已分析外部库清单,给老板/CEO 回看用。
- **执行体**:由控制台 server 内置定时器 `insight-scout-repos` 驱动(每 4 小时,实现见 `projects/控制台/insight-scout-repos.js` 与 `projects/控制台/server.js#checkInsightScoutRepos`),派单到 `artifacts/queues/insight-scout/`。洞察员输出 `insight_scout` JSON 后,`projects/控制台/engine-runner.js` 自动去重 → 追加 `insights.md` → 写公告板。系统里的「洞察员」角色/工位是名分 + 来源标识。
- **输出**:`projects/控制台/artifacts/bulletin/cards.json` 追加 todo 卡(`source="洞察员"`,`target="ceo"`)。
- **选题轮换**:多智能体编排 / 任务队列引擎 / AI agent 工具与 skills / Unity(Simulaid)/ 像素素材生成 / LLM 网关 / GUI grounding 等,每次轮换避免重复。

## 热区维护

- 一批 = 一个 `<!-- insight-scout-run:... -->` marker 开始的洞察员单次运行输出。
- 热区策略:默认保留最近 4 批;若热区超过 100KB,继续下沉最旧热批,但至少保留 1 批。
- 执行脚本:`scripts/maintain-insights.js`;归档、热区、索引和 JSON 写入均先写临时文件再 rename。
- 并发保护:脚本使用 `.archive.lock` 目录锁;若读取 `insights.md` 失败则直接退出,不删除也不移动批次。
- 验证命令:`node board/insights/scripts/maintain-insights.js --workspace . --verify`。

## 后续关注更新机制

- 去重与关注分离:`seen-repos.json.repos` 只表示「不要重复推荐」;`references/borrowed-watch.json.borrowed_libraries` 表示「已经借鉴过,后续要看上游是否更新」。
- 轮询口径:洞察员每 4 小时运行时可顺手检查 `watch.enabled=true` 的条目,但同一仓库建议按 `default_check_interval_hours` 节流(默认每日一次)。
- 判断更新:对 GitHub 仓库用 `git ls-remote --symref <url>.git HEAD` 读取默认分支与 HEAD commit,与 `last_known_commit` 比较。
- 有更新时:先读 release/changelog/README diff,再在 `insights.md` 追加「更新复看」小节;确认不值得复看时只更新 `last_checked` 并记录一句原因。
- 边界:不登录、不拉私有仓库、不回显密钥;需要授权/扫码/Token 的更新源交主人手动。
