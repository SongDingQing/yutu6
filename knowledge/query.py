#!/usr/bin/env python3
"""
玉兔6 本地知识库 · 检索(最小原型 · GraphRAG)
向量召回 + 全文召回 → 融合 → 沿知识图谱扩展 → 带出处输出(可选本地模型作答)

依赖:pip install sqlite-vec ;本地 ollama
用法:python3 query.py "你的问题"  [--answer]
"""
import os, sys, json, re, sqlite3, urllib.request, time
from pathlib import Path

HERE   = Path(__file__).resolve().parent
DB     = Path(os.environ.get("XJ_KB_PATH", str(HERE / "kb.sqlite"))).expanduser().resolve()
OLLAMA = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
EMBED_MODEL = os.environ.get("XJ_EMBED_MODEL", "nomic-embed-text")
CHAT_MODEL  = os.environ.get("XJ_CHAT_MODEL", "qwen2.5")
TOPK = 6
MAX_GRAPH_NODES = 64
MAX_GRAPH_EDGES = 128
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
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA busy_timeout=5000")
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


def table_exists(db, name):
    return db.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone() is not None


def option_value(args, name, default=None):
    """读取 --name value / --name=value,不改变旧的布尔 flag 语义。"""
    for i, arg in enumerate(args):
        if arg == name and i + 1 < len(args) and not args[i + 1].startswith("--"):
            return args[i + 1]
        if arg.startswith(name + "="):
            return arg.split("=", 1)[1]
    return default


def positional_args(args):
    values = []
    options_with_values = {"--hops", "--max-nodes", "--max-edges"}
    skip = False
    for arg in args:
        if skip:
            skip = False
            continue
        if arg in options_with_values:
            skip = True
            continue
        if any(arg.startswith(name + "=") for name in options_with_values):
            continue
        if not arg.startswith("--"):
            values.append(arg)
    return values


def graph_seed_entities(db, query, limit=8):
    exact = db.execute(
        "SELECT id,name,type FROM entities WHERE name=? COLLATE NOCASE ORDER BY id LIMIT ?",
        (query, limit),
    ).fetchall()
    if exact:
        return exact
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return db.execute(
        "SELECT id,name,type FROM entities "
        "WHERE name LIKE ? ESCAPE '\\' OR instr(?,name)>0 "
        "ORDER BY length(name) DESC,id LIMIT ?",
        (f"%{escaped}%", query, limit),
    ).fetchall()


def relation_evidence(db, relation_id, chunk_id):
    evidence = []
    if table_exists(db, "relation_provenance"):
        rows = db.execute(
            "SELECT project_id,source_path,source_anchor,source_hash,task_id,queue_id,"
            "root_task_id,root_queue_id,evidence_excerpt,review_status,created_at "
            "FROM relation_provenance WHERE relation_id=? ORDER BY created_at,id LIMIT 8",
            (relation_id,),
        ).fetchall()
        for row in rows:
            evidence.append({
                "kind": "memory_provenance",
                "projectId": row[0],
                "sourcePath": row[1],
                "sourceAnchor": row[2],
                "sourceHash": row[3],
                "taskId": row[4],
                "queueId": row[5],
                "rootTaskId": row[6],
                "rootQueueId": row[7],
                "excerpt": row[8],
                "reviewStatus": row[9],
                "createdAt": row[10],
            })
    if chunk_id is not None:
        row = db.execute(
            "SELECT d.path,c.text FROM chunks c JOIN documents d ON d.id=c.doc_id WHERE c.id=?",
            (chunk_id,),
        ).fetchone()
        if row:
            evidence.append({"kind": "chunk", "sourcePath": row[0], "chunkId": chunk_id, "excerpt": row[1]})
    return evidence


def directed_graph(db, seeds, hops=2, max_nodes=MAX_GRAPH_NODES, max_edges=MAX_GRAPH_EDGES):
    """独立的有向 BFS;旧 graph_expand 保持不动,默认 RAG 查询继续用旧语义。"""
    nodes = {}
    queue = []
    for entity_id, name, type_ in seeds:
        if entity_id in nodes or len(nodes) >= max_nodes:
            continue
        nodes[entity_id] = {"id": entity_id, "name": name, "type": type_, "depth": 0, "seed": True}
        queue.append((entity_id, 0))
    edges = []
    seen_edges = set()
    cursor = 0
    truncated = len(seeds) > len(nodes)
    while cursor < len(queue):
        entity_id, depth = queue[cursor]
        cursor += 1
        if depth >= hops:
            continue
        rows = db.execute(
            "SELECT r.id,r.src,r.dst,r.type,r.weight,r.status,r.evidence,e.name,e.type "
            "FROM relations r JOIN entities e ON e.id=r.dst "
            "WHERE r.src=? AND r.status='active' ORDER BY r.id",
            (entity_id,),
        ).fetchall()
        for row in rows:
            relation_id, src, dst, type_, weight, status, chunk_id, dst_name, dst_type = row
            if relation_id in seen_edges:
                continue
            if len(edges) >= max_edges:
                truncated = True
                break
            if dst not in nodes and len(nodes) >= max_nodes:
                truncated = True
                continue
            seen_edges.add(relation_id)
            edges.append({
                "id": relation_id,
                "src": src,
                "dst": dst,
                "type": type_,
                "weight": weight,
                "status": status,
                "depth": depth + 1,
                "evidence": relation_evidence(db, relation_id, chunk_id),
            })
            if dst not in nodes:
                nodes[dst] = {"id": dst, "name": dst_name, "type": dst_type, "depth": depth + 1, "seed": False}
                queue.append((dst, depth + 1))
        if len(edges) >= max_edges:
            truncated = True
            break
    return {"nodes": list(nodes.values()), "edges": edges, "truncated": truncated}


def graph_mode(db, query, args, want_json):
    started = time.perf_counter()
    try:
        raw_hops = int(option_value(args, "--hops", "2"))
        raw_nodes = int(option_value(args, "--max-nodes", str(MAX_GRAPH_NODES)))
        raw_edges = int(option_value(args, "--max-edges", str(MAX_GRAPH_EDGES)))
    except ValueError:
        payload = {"ok": False, "query": query, "error": "--hops/--max-nodes/--max-edges 必须为整数"}
        if want_json:
            emit_json(payload)
            return
        die(payload["error"])
    hops = 2 if raw_hops <= 2 else 3
    max_nodes = max(1, min(raw_nodes, MAX_GRAPH_NODES))
    max_edges = max(1, min(raw_edges, MAX_GRAPH_EDGES))
    seeds = graph_seed_entities(db, query)
    graph = directed_graph(db, seeds, hops=hops, max_nodes=max_nodes, max_edges=max_edges)
    graph.update({
        "hops": hops,
        "maxNodes": max_nodes,
        "maxEdges": max_edges,
        "latencyMs": round((time.perf_counter() - started) * 1000, 3),
    })
    if want_json:
        emit_json({"ok": True, "query": query, "mode": "graph", "graph": graph})
        return
    print(f"\n=== 有向教训图谱(查询:{query}, {hops} 跳)===" )
    if not graph["nodes"]:
        print("未找到匹配实体。")
        return
    node_by_id = {node["id"]: node for node in graph["nodes"]}
    for edge in graph["edges"]:
        src = node_by_id[edge["src"]]["name"]
        dst = node_by_id[edge["dst"]]["name"]
        print(f"  {src} --[{edge['type']}]→ {dst}")
        for evidence in edge["evidence"]:
            anchor = evidence.get("sourceAnchor") or evidence.get("sourcePath") or "未知来源"
            excerpt = re.sub(r"\s+", " ", evidence.get("excerpt") or "")[:180]
            print(f"    证据:{anchor} · {excerpt}")
    if graph["truncated"]:
        print(f"  … 已触达上限(nodes={max_nodes}, edges={max_edges})")


def emit_json(payload):
    print(json.dumps(payload, ensure_ascii=False))


def main():
    # 稳健取 query:第一个非 --flag 参数(支持 query.py --json "问题" 或 query.py "问题" --json)
    args = sys.argv[1:]
    want_answer = "--answer" in args
    want_json = "--json" in args
    want_graph = "--graph" in args
    positional = positional_args(args)
    if not positional:
        if want_json:
            emit_json({"ok": False, "query": "", "hits": [], "mode": "none", "error": "缺少问题参数"})
            return
        die('用法: python3 query.py "问题" [--answer] [--json] [--graph --hops 2|3]')
    q = positional[0]
    if not DB.exists():
        if want_json:
            emit_json({"ok": False, "query": q, "hits": [], "mode": "none", "error": "还没有 kb.sqlite,先跑 ingest.py"})
            return
        die("还没有 kb.sqlite,先跑 ingest.py")

    db, has_vec = connect()

    # 教训图谱是独立显式模式。默认检索仍走下面的 vec/FTS + 旧 graph_expand。
    if want_graph:
        graph_mode(db, q, args, want_json)
        return

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
