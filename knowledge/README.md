# 玉兔6 本地知识库

`wiki/`(原文,人可读可编辑)→ `kb.sqlite`(全文 + 可选向量 + 图谱)→ 检索。嵌入式单文件、零常驻服务。

## 部署(一键,三模式自适应)
```bash
bash build.sh      # 自动选最佳可用模式;不会卡死
python3 query.py "你的问题" [--answer]
python3 query.py "根因实体" --graph --hops 2 --json
```
- **纯全文(FTS5)**:无 sqlite-vec / 无 embedding 端点时**自动降级**——零外部依赖,**现在就能用**(关键词召回 + 出处)。已验证可跑。
- **向量+全文(GraphRAG)**:有 sqlite-vec + 可达 embedding 端点时自动启用,加语义召回 + 图谱扩展。

## embedding provider(可配置,生产指向另一台电脑)
| 变量 | 取值 | 说明 |
|---|---|---|
| `EMBED_PROVIDER` | `ollama`(默认)/ `openai` / `local` | 切 provider 必须删 kb.sqlite 重建 |
| `EMBED_DIM` | 默认 768 | 须与向量表维度一致 |
| `OLLAMA_HOST` | `http://localhost:11434` | **指另一台电脑:`http://<ip>:11434`** |
| `XJ_EMBED_MODEL` | `nomic-embed-text` | ollama 的 embedding 模型(768) |
| `EMBED_BASE_URL` / `EMBED_MODEL` / `EMBED_API_KEY` | — | openai 兼容端点(那台电脑的 vLLM/Ollama 兼容口,或云) |
| `local` | — | 离线哈希兜底,弱语义,仅验证/无网时用 |

> **升级到向量层**:在 Mac 装 `sqlite-vec`(`pip3 install --break-system-packages sqlite-vec`),让 `OLLAMA_HOST` 指向那台电脑的 Ollama(或用 `EMBED_PROVIDER=openai`),删 `kb.sqlite` 重跑 `build.sh`。

## 文件
| 文件 | 作用 |
|---|---|
| `embed_provider.py` | 可配置 embedding(ollama/openai/local),ingest 与 query 共用 |
| `schema.sql` | 表结构(documents/chunks/FTS5/图谱);vec_chunks 由 ingest 按维度动态建 |
| `ingest.py` | 扫 `../wiki/*.md` → 切块 → (可选 embedding) → kb.sqlite,按 path+hash 增量 |
| `query.py` | 向量(若有)+ FTS5 召回 → 融合 → 图谱扩展 → 带出处;`--answer` 让模型作答 |
| `build.sh` | 一键部署/构建,三模式自适应 |
| `corpus/` | 冷档(迁移记录、旧 Codex 41 技能归档等) |

## 知识迁移(待主人指令)
当前 `wiki/` 是提炼笔记示例;**正式把工作区知识归纳整理迁进来**这步等主人发话再做(届时:抽取 board/shared/projects/corpus 等的长期知识 → 结构化进 wiki/ → 重建)。

## 说明
- 换 embedding 模型/provider → 删 `kb.sqlite` 重建(维度也要对齐)。
- 图谱抽取靠 chat 模型(设 `XJ_CHAT_MODEL`),有噪声;改 wiki 原文重跑即可修正(被否决关系置 `status='deprecated'`)。
- 显式 `--graph` 是独立的有向查询模式:`--hops` 夹取为 2/3 跳,只沿 active 的 src→dst,JSON 返回节点、边和 provenance/chunk 证据;不带 `--graph` 时保留原 vec/FTS + 双向扩展行为。
- 控制台内测教训先运行 `node projects/控制台/tools/migrate-lesson-graph.js`(默认在 `projects/控制台/artifacts/canary/lesson-graph-migration/` 做迁移前快照)。迁移只旁挂 `relation_provenance`,不扩大记忆官写权限。
- `CONSOLE_LESSON_GRAPH_CANARY=0` 可立即停止新增。开关开启时也只处理成功的 `memory-officer` 控制台任务在本轮追加到 `memory/experience.md` 的“根因→做法”,不回填历史、不处理非追加改写;失败只写 canary 审计,不回滚 memory。
- `kb.sqlite` 不进 git;纳入快照 + 冷备到玉兔2;`wiki/` 进 git。
- 多端共享:库留 mini,由 bridge 包成 API(§9);别让手机直接持库。
