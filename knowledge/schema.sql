-- 玉兔6 本地知识库 · 表结构
-- 需加载 sqlite-vec 扩展(向量);FTS5 为 SQLite 内置
PRAGMA foreign_keys = ON;

-- 原文档(对应 wiki/ 下的 markdown)
CREATE TABLE IF NOT EXISTS documents (
  id    INTEGER PRIMARY KEY,
  path  TEXT UNIQUE NOT NULL,          -- 相对 wiki/ 的路径
  title TEXT,
  hash  TEXT,                          -- 内容哈希,增量更新用
  mtime REAL
);

-- 切块
CREATE TABLE IF NOT EXISTS chunks (
  id     INTEGER PRIMARY KEY,
  doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ord    INTEGER,
  text   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);

-- 全文索引(FTS5,external content 关联 chunks)
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text, content='chunks', content_rowid='id', tokenize='unicode61'
);
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
END;

-- 向量索引 vec_chunks 由 ingest.py 按 EMBED_DIM 动态建(需 sqlite-vec 扩展)。
-- 无扩展时自动降级为 FTS5 纯全文模式(不建 vec_chunks),库仍可用。

-- 图谱:实体 / 关系 / 事件
CREATE TABLE IF NOT EXISTS entities (
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL,
  type    TEXT,
  summary TEXT,
  UNIQUE(name, type)
);
CREATE TABLE IF NOT EXISTS relations (
  id       INTEGER PRIMARY KEY,
  src      INTEGER NOT NULL REFERENCES entities(id),
  dst      INTEGER NOT NULL REFERENCES entities(id),
  type     TEXT,
  weight   REAL DEFAULT 1.0,
  status   TEXT DEFAULT 'active',      -- active / deprecated(被用户否决)
  evidence INTEGER REFERENCES chunks(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_rel_src ON relations(src);
CREATE INDEX IF NOT EXISTS idx_rel_dst ON relations(dst);
-- 规范边唯一;同一根因→做法允许挂多条 relation_provenance,不重复造有效边。
CREATE UNIQUE INDEX IF NOT EXISTS uq_relations_canonical ON relations(src,dst,type);

-- relations.evidence 继续服务 wiki/chunks 图谱。memory/ 灰度教训的来源与任务链
-- 单独旁挂,避免伪造 chunks 外键,也允许同一规范边保留多次独立来源。
CREATE TABLE IF NOT EXISTS relation_provenance (
  id               INTEGER PRIMARY KEY,
  relation_id      INTEGER NOT NULL REFERENCES relations(id) ON DELETE CASCADE,
  project_id       TEXT NOT NULL,
  source_path      TEXT NOT NULL,
  source_anchor    TEXT,
  source_hash      TEXT NOT NULL,
  task_id          TEXT,
  queue_id         TEXT,
  root_task_id     TEXT,
  root_queue_id    TEXT,
  idempotency_key  TEXT NOT NULL,
  evidence_excerpt TEXT NOT NULL,
  review_status    TEXT NOT NULL DEFAULT 'pending',
  reviewed_at      TEXT,
  review_note      TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_relation_provenance_idempotency
  ON relation_provenance(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_relation_provenance_relation
  ON relation_provenance(relation_id);
CREATE INDEX IF NOT EXISTS idx_relation_provenance_project_created
  ON relation_provenance(project_id,created_at);

CREATE TABLE IF NOT EXISTS events (
  id       INTEGER PRIMARY KEY,
  summary  TEXT,
  ts       REAL,
  evidence INTEGER REFERENCES chunks(id) ON DELETE SET NULL
);

-- 实体↔块 提及(连接图谱与原文)
CREATE TABLE IF NOT EXISTS mentions (
  entity_id INTEGER REFERENCES entities(id),
  chunk_id  INTEGER REFERENCES chunks(id) ON DELETE CASCADE,
  PRIMARY KEY(entity_id, chunk_id)
);

-- 用户反馈修正(璇玑式)
CREATE TABLE IF NOT EXISTS corrections (
  id              INTEGER PRIMARY KEY,
  target_relation INTEGER REFERENCES relations(id),
  note            TEXT,
  created_at      REAL DEFAULT (julianday('now'))
);
