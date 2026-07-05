#!/usr/bin/env python3
"""
玉兔6 知识库 · 可配置 embedding provider
被 ingest.py / query.py 共用。一处定义,处处一致(切 provider 必须重建向量索引)。

环境变量:
  EMBED_PROVIDER  ollama(默认) | openai | local
  EMBED_DIM       向量维度,默认 768(须与 schema.sql 的 FLOAT[N] 一致)
  -- ollama(本机或另一台电脑的 Ollama)--
  OLLAMA_HOST     默认 http://localhost:11434(指另一台电脑:http://<ip>:11434)
  XJ_EMBED_MODEL  默认 nomic-embed-text(768 维)
  -- openai(另一台电脑的 vLLM/Ollama OpenAI 兼容端点,或云)--
  EMBED_BASE_URL  形如 http://<ip>:8000/v1
  EMBED_MODEL     模型名
  EMBED_API_KEY   可选
  -- local:确定性哈希嵌入,离线兜底(无语义模型,弱但能跑通管线;生产请切 ollama/openai)--
"""
import os, json, hashlib, math, urllib.request

PROVIDER    = os.environ.get("EMBED_PROVIDER", "ollama").lower()
DIM         = int(os.environ.get("EMBED_DIM", "768"))
OLLAMA      = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL= os.environ.get("XJ_EMBED_MODEL", "nomic-embed-text")
BASE_URL    = os.environ.get("EMBED_BASE_URL", "")
OPENAI_MODEL= os.environ.get("EMBED_MODEL", "nomic-embed-text")
API_KEY     = os.environ.get("EMBED_API_KEY", "")


def _ollama(text):
    body = json.dumps({"model": OLLAMA_MODEL, "prompt": text}).encode()
    req = urllib.request.Request(f"{OLLAMA}/api/embeddings", body, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())["embedding"]


def _openai(text):
    url = BASE_URL.rstrip("/") + "/embeddings"
    body = json.dumps({"model": OPENAI_MODEL, "input": text}).encode()
    headers = {"Content-Type": "application/json"}
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"
    req = urllib.request.Request(url, body, headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())["data"][0]["embedding"]


def _local(text):
    """离线确定性哈希嵌入:字符 2/3/4-gram 哈希进 DIM 桶 + L2 归一。弱语义,仅兜底/验证管线。"""
    v = [0.0] * DIM
    t = (text or "").lower()
    for n in (2, 3, 4):
        for i in range(len(t) - n + 1):
            h = int.from_bytes(hashlib.md5(t[i:i+n].encode("utf-8")).digest()[:4], "little")
            v[h % DIM] += 1.0
    norm = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / norm for x in v]


def embed(text):
    if PROVIDER == "local":
        return _local(text)
    if PROVIDER == "openai":
        return _openai(text)
    return _ollama(text)


def info():
    if PROVIDER == "local":
        return f"local-hash(dim={DIM})"
    if PROVIDER == "openai":
        return f"openai({OPENAI_MODEL} @ {BASE_URL})"
    return f"ollama({OLLAMA_MODEL} @ {OLLAMA})"
