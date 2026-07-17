#!/usr/bin/env python3
"""Resolve a knowledge stub's exact path or stable fragment id without broadening FTS."""

import argparse
import hashlib
import json
import re
import sqlite3
import sys
from pathlib import Path


def normalized_text(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def fragment_id(source_path, text):
    body = f"{source_path}\0{normalized_text(text)}".encode("utf-8")
    return "kb_" + hashlib.sha256(body).hexdigest()[:16]


def normalized_ref(value):
    return str(value or "").strip().replace("\\", "/").removeprefix("./")


def display_path(value):
    return re.sub(r"[\r\n]", " ", str(value or ""))[:240]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    try:
        request = json.loads(sys.stdin.read() or "{}")
        refs = [normalized_ref(item) for item in request.get("refs", [])]
        refs = [item for item in refs if item][:20]
        max_hits = max(1, min(int(request.get("maxHitsPerRef", 6)), 12))
        db_path = Path(args.db).expanduser().resolve()
        if not db_path.is_file():
            raise FileNotFoundError("knowledge db not found")
        db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        rows = db.execute(
            "SELECT d.path,c.text FROM chunks c "
            "JOIN documents d ON d.id=c.doc_id ORDER BY d.id,c.ord,c.id"
        ).fetchall()
        by_path = {}
        by_id = {}
        for source_path, text in rows:
            shown_path = display_path(source_path)
            item = {
                "path": shown_path,
                "text": text,
                "fragment_id": fragment_id(shown_path, text),
                "confidence": 1.0,
                "reference_match": True,
            }
            for path_key in {normalized_ref(source_path).lower(), normalized_ref(shown_path).lower()}:
                by_path.setdefault(path_key, []).append(item)
            by_id[item["fragment_id"].lower()] = item

        hits = []
        seen = set()
        resolved = []
        unresolved = []
        for ref in refs:
            key = ref.lower()
            matches = [by_id[key]] if key in by_id else by_path.get(key, [])[:max_hits]
            if not matches:
                unresolved.append(ref)
                continue
            resolved.append(ref)
            for item in matches:
                if item["fragment_id"] in seen:
                    continue
                seen.add(item["fragment_id"])
                hits.append(item)
        payload = {
            "ok": True,
            "hits": hits,
            "resolvedRefs": resolved,
            "unresolvedRefs": unresolved,
        }
    except Exception as error:
        payload = {"ok": False, "hits": [], "resolvedRefs": [], "unresolvedRefs": [], "error": str(error)[:300]}
    print(json.dumps(payload, ensure_ascii=False))
    if not payload["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
