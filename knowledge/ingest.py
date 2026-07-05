#!/usr/bin/env python3
"""
玉兔6 本地知识库 · 写入管道(最小原型)
扫 ../wiki/*.md → 切块 → Ollama embedding → 存入 kb.sqlite(向量 + 全文 + 可选图谱)

依赖:pip install sqlite-vec ;本地 ollama + `ollama pull nomic-embed-text`
用法:python3 ingest.py
"""
import os, sys, json, re, hashlib, sqlite3, urllib.request
from pathlib import Path

HERE   = Path(__file__).resolve().parent
WIKI   = HERE.parent / "wiki"
DB     = HERE / "kb.sqlite"
SCHEMA = HERE / "schema.sql"
OLLAMA = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
EMBED_MODEL = os.environ.get("XJ_EMBED_MODEL", "nomic-embed-text")
CHAT_MODEL  = os.environ.get("XJ_CHAT_MODEL", "")   # 留空 = 跳过图谱抽取(仅建 RAG)
sys.path.insert(0, str(HERE))
from embed_provider import embed as embed_text, info as embed_info   # 可配置 provider(ollama/openai/local)


def die(msg):
    print(f"✗ {msg}")
    sys.exit(1)


def connect():
    """返回 (db, has_vec)。有 sqlite-vec 则启向量层;没有则降级为 FTS5 纯全文。"""
    db = sqlite3.connect(DB)
    has_vec = False
    try:
        import sqlite_vec
        db.enable_load_extension(True)
        sqlite_vec.load(db)
        db.enable_load_extension(False)
        has_vec = True
    except Exception:
        has_vec = False
    db.execute("PRAGMA foreign_keys=ON")
    return db, has_vec


def init_schema(db, has_vec):
    has = db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='documents'").fetchone()
    if not has:
        db.executescript(SCHEMA.read_text(encoding="utf-8"))
        print("✓ 已初始化表结构")
    if has_vec:
        from embed_provider import DIM
        db.execute(f"CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0("
                   f"chunk_id INTEGER PRIMARY KEY, embedding FLOAT[{DIM}])")


def ollama_embed(text):
    body = json.dumps({"model": EMBED_MODEL, "prompt": text}).encode()
    req = urllib.request.Request(f"{OLLAMA}/api/embeddings", body,
                                 {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())["embedding"]
    except Exception as e:
        die(f"调 Ollama embedding 失败({e})。先 `ollama serve` 并 `ollama pull {EMBED_MODEL}`")


def chunk_md(text, target=600):
    """按段落切,合并到约 target 字符。"""
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks, buf = [], ""
    for p in paras:
        if buf and len(buf) + len(p) + 1 > target:
            chunks.append(buf); buf = p
        else:
            buf = (buf + "\n" + p) if buf else p
    if buf:
        chunks.append(buf)
    return chunks


def extract_graph(text):
    """可选:用 chat 模型抽实体/关系。CHAT_MODEL 为空则跳过。失败不影响 RAG。"""
    if not CHAT_MODEL:
        return None
    prompt = ('从下面文本抽取实体和关系,只输出 JSON,格式:'
              '{"entities":[{"name":"","type":""}],'
              '"relations":[{"src":"","dst":"","type":""}]}\n\n' + text)
    body = json.dumps({"model": CHAT_MODEL, "prompt": prompt,
                       "stream": False, "format": "json"}).encode()
    req = urllib.request.Request(f"{OLLAMA}/api/generate", body,
                                 {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(json.loads(r.read())["response"])
    except Exception as e:
        print(f"  ⚠ 图谱抽取跳过({e})")
        return None


def upsert_entity(db, name, type_):
    db.execute("INSERT OR IGNORE INTO entities(name,type) VALUES(?,?)", (name, type_ or ""))
    return db.execute("SELECT id FROM entities WHERE name=? AND type=?",
                      (name, type_ or "")).fetchone()[0]


def ingest_file(db, path, has_vec):
    rel = str(path.relative_to(WIKI))
    raw = path.read_text(encoding="utf-8", errors="ignore")
    h = hashlib.sha256(raw.encode()).hexdigest()
    row = db.execute("SELECT id,hash FROM documents WHERE path=?", (rel,)).fetchone()
    if row and row[1] == h:
        return 0                                  # 未变,跳过
    if row:
        db.execute("DELETE FROM documents WHERE id=?", (row[0],))  # 删旧(级联清块)
    title = (raw.splitlines()[0].lstrip("# ").strip() if raw.strip() else rel)
    doc_id = db.execute("INSERT INTO documents(path,title,hash,mtime) VALUES(?,?,?,?)",
                        (rel, title, h, path.stat().st_mtime)).lastrowid
    n = 0
    for i, ck in enumerate(chunk_md(raw)):
        cid = db.execute("INSERT INTO chunks(doc_id,ord,text) VALUES(?,?,?)",
                         (doc_id, i, ck)).lastrowid
        if has_vec:
            from sqlite_vec import serialize_float32
            db.execute("INSERT INTO vec_chunks(chunk_id,embedding) VALUES(?,?)",
                       (cid, serialize_float32(embed_text(ck))))
        g = extract_graph(ck)
        if g:
            ids = {}
            for e in g.get("entities", []):
                if e.get("name"):
                    eid = upsert_entity(db, e["name"], e.get("type"))
                    ids[e["name"]] = eid
                    db.execute("INSERT OR IGNORE INTO mentions(entity_id,chunk_id) VALUES(?,?)",
                               (eid, cid))
            for r in g.get("relations", []):
                s, d = ids.get(r.get("src")), ids.get(r.get("dst"))
                if s and d:
                    db.execute("INSERT INTO relations(src,dst,type,evidence) VALUES(?,?,?,?)",
                               (s, d, r.get("type", ""), cid))
        n += 1
    print(f"  ✓ {rel}: {n} 块")
    return n


def main():
    if not WIKI.exists():
        die(f"找不到 wiki 目录:{WIKI}")
    db, has_vec = connect()
    init_schema(db, has_vec)
    mode = embed_info() if has_vec else "FTS5-only(无 sqlite-vec → 纯全文降级,向量层留待 Mac 上接扩展+embedding)"
    print(f"  模式: {'向量+全文' if has_vec else '纯全文(降级)'} · {mode}")
    total = 0
    for p in sorted(WIKI.rglob("*.md")):
        total += ingest_file(db, p, has_vec)
        db.commit()
    print(f"✓ 完成,共处理 {total} 块。库:{DB}")


if __name__ == "__main__":
    main()
