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
