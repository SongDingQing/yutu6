#!/usr/bin/env python3
"""
玉兔6 本地知识库 · 检索(最小原型 · GraphRAG)
向量召回 + 全文召回 → 融合 → 沿知识图谱扩展 → 带出处输出(可选本地模型作答)

依赖:pip install sqlite-vec ;本地 ollama
用法:python3 query.py "你的问题"  [--answer]
"""
import os, sys, json, re, sqlite3, urllib.request
from pathlib import Path

HERE   = Path(__file__).resolve().parent
DB     = HERE / "kb.sqlite"
OLLAMA = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
EMBED_MODEL = os.environ.get("XJ_EMBED_MODEL", "nomic-embed-text")
CHAT_MODEL  = os.environ.get("XJ_CHAT_MODEL", "qwen2.5")
TOPK = 6
sys.path.insert(0, str(HERE))
from embed_provider import embed   # 可配置 provider(与 ingest 一致:ollama/openai/local)


def die(m):
    print(f"✗ {m}")
    sys.exit(1)


def connect():
    """返回 (db, has_vec)。无 sqlite-vec 则降级:只用 FTS5 全文召回。"""
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
    return db, has_vec


def fts_query(q):
    """把问题拆词用 OR 连接,避开 FTS5 语法字符。"""
    terms = re.findall(r"\w+", q, flags=re.UNICODE)
    return " OR ".join(terms) if terms else q


def graph_expand(db, seed):
    return db.execute("""
        WITH RECURSIVE g(eid, depth) AS (
          SELECT ?, 0
          UNION
          SELECT CASE WHEN r.src = g.eid THEN r.dst ELSE r.src END, g.depth + 1
          FROM relations r JOIN g ON (r.src = g.eid OR r.dst = g.eid)
          WHERE g.depth < 2 AND r.status = 'active'
        )
        SELECT DISTINCT e.name, e.type FROM g JOIN entities e ON e.id = g.eid
        WHERE g.eid != ?
    """, (seed, seed)).fetchall()


def emit_json(payload):
    print(json.dumps(payload, ensure_ascii=False))


def main():
    # 稳健取 query:第一个非 --flag 参数(支持 query.py --json "问题" 或 query.py "问题" --json)
    args = sys.argv[1:]
    want_answer = "--answer" in args
    want_json = "--json" in args
    positional = [a for a in args if not a.startswith("--")]
    if not positional:
        if want_json:
            emit_json({"ok": False, "query": "", "hits": [], "mode": "none", "error": "缺少问题参数"})
            return
        die('用法: python3 query.py "问题" [--answer] [--json]')
    q = positional[0]
    if not DB.exists():
        if want_json:
            emit_json({"ok": False, "query": q, "hits": [], "mode": "none", "error": "还没有 kb.sqlite,先跑 ingest.py"})
            return
        die("还没有 kb.sqlite,先跑 ingest.py")

    db, has_vec = connect()

    # ① 向量召回(仅当有 sqlite-vec;否则降级为纯 FTS5)
    vec_hits = []
    if has_vec:
        from sqlite_vec import serialize_float32
        qv = serialize_float32(embed(q))
        vec_hits = db.execute(
            "SELECT chunk_id, distance FROM vec_chunks "
            "WHERE embedding MATCH ? AND k = ? ORDER BY distance", (qv, TOPK)).fetchall()

    # ② 全文召回
    try:
        fts_hits = db.execute(
            "SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ? LIMIT ?",
            (fts_query(q), TOPK)).fetchall()
    except sqlite3.OperationalError:
        fts_hits = []

    # 融合(保序去重)
    ids = []
    for cid, _ in vec_hits:
        ids.append(cid)
    for (cid,) in fts_hits:
        if cid not in ids:
            ids.append(cid)
    ids = ids[:TOPK]
    mode = "vec" if vec_hits else "fts"
    if not ids:
        if want_json:
            emit_json({"ok": True, "query": q, "hits": [], "mode": mode})
            return
        die("没检索到内容(库是空的?先 ingest)")

    ph = ",".join("?" * len(ids))
    rows = db.execute(
        f"SELECT c.id, d.path, c.text FROM chunks c JOIN documents d ON d.id = c.doc_id "
        f"WHERE c.id IN ({ph})", ids).fetchall()

    # ③ 种子实体 → ④ 图谱扩展
    seeds = [r[0] for r in db.execute(
        f"SELECT DISTINCT entity_id FROM mentions WHERE chunk_id IN ({ph})", ids).fetchall()]
    graph = []
    for s in seeds:
        graph += graph_expand(db, s)

    # JSON 模式:机器可读输出(给 node/envelope 注入用),不打人看的文本
    if want_json:
        hits = [{"path": path, "text": text} for _cid, path, text in rows]
        entities = [{"name": name, "type": type_} for name, type_ in dict.fromkeys(graph)]
        emit_json({"ok": True, "query": q, "hits": hits, "entities": entities, "mode": mode})
        return

    # 输出
    print(f"\n=== 检索结果(问:{q})===")
    ctx = []
    for _cid, path, text in rows:
        print(f"\n— 出处 {path} —\n{text[:300]}")
        ctx.append(f"[{path}] {text}")
    if graph:
        print("\n=== 相关实体(图谱)===")
        for name, type_ in dict.fromkeys(graph):   # 去重保序
            print(f"  · {name} ({type_})")

    if want_answer:
        prompt = "根据下面资料回答问题,并标注出处([路径])。\n资料:\n" + "\n".join(ctx) + f"\n\n问题:{q}"
        body = json.dumps({"model": CHAT_MODEL, "prompt": prompt, "stream": False}).encode()
        req = urllib.request.Request(f"{OLLAMA}/api/generate", body,
                                     {"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=180) as r:
            print("\n=== 回答 ===\n" + json.loads(r.read())["response"])


if __name__ == "__main__":
    main()
