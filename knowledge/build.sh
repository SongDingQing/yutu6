#!/usr/bin/env bash
# 玉兔6 知识库 · 一键部署/构建。依据蓝图 §15。
# 三种模式自适应(优雅降级,绝不卡死):
#   - 向量+全文(GraphRAG):有 sqlite-vec + 可达 embedding 端点(ollama/openai)。
#   - 纯全文(FTS5):无扩展/无 embedding 时自动降级,仍可用,只缺语义召回。
# 幂等:可重复跑;ingest 按 path+hash 增量,只处理变更文件。
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"

echo "==> 1/4 Python"
command -v python3 >/dev/null || { echo "✗ 缺 python3"; exit 1; }

echo "==> 2/4 向量扩展 sqlite-vec(可选,缺则降级 FTS5)"
HAS_VEC=0
python3 -c "import sqlite_vec" 2>/dev/null && HAS_VEC=1 || {
  pip3 install --break-system-packages -q sqlite-vec 2>/dev/null && HAS_VEC=1 || true
}
[ "$HAS_VEC" = 1 ] && echo "   ✓ sqlite-vec 可用(启向量层)" || echo "   ⚠ 无 sqlite-vec → 纯全文模式(向量层留待补)"

echo "==> 3/4 embedding provider"
PROV="${EMBED_PROVIDER:-ollama}"
if [ "$HAS_VEC" = 1 ] && [ "$PROV" = "ollama" ]; then
  OLLAMA="${OLLAMA_HOST:-http://localhost:11434}"
  if curl -fsS "$OLLAMA/api/tags" >/dev/null 2>&1; then
    EMBED="${XJ_EMBED_MODEL:-nomic-embed-text}"
    curl -fsS "$OLLAMA/api/tags" | grep -q "$EMBED" || { echo "   拉取 $EMBED…"; ollama pull "$EMBED" || true; }
    echo "   ✓ ollama @ $OLLAMA · $EMBED"
  else
    echo "   ⚠ Ollama($OLLAMA)不可达 → 本轮降级纯全文(要向量:设 OLLAMA_HOST 指向那台电脑,或 EMBED_PROVIDER=openai + EMBED_BASE_URL)"
    HAS_VEC=0
  fi
elif [ "$HAS_VEC" = 1 ] && [ "$PROV" = "openai" ]; then
  echo "   ✓ openai 兼容端点 @ ${EMBED_BASE_URL:-未设!}"
elif [ "$HAS_VEC" = 1 ] && [ "$PROV" = "local" ]; then
  echo "   ✓ 本地哈希兜底(弱语义,仅验证/离线)"
fi

echo "==> 4/4 写入知识库(扫 ../wiki → 切块 → 入库)"
# 想同时建图谱:设 XJ_CHAT_MODEL=qwen2.5(需 Ollama chat 模型)再跑
[ "$HAS_VEC" = 0 ] && export EMBED_PROVIDER=local   # 降级时 ingest 也不会调 embed
python3 ingest.py

echo ""; echo "==> 冒烟检索"
python3 query.py "玉兔6 的四层组织是什么" || true
echo ""; echo "✅ 完成。kb.sqlite 已就绪($HERE/kb.sqlite)。"
echo "   检索:python3 query.py \"你的问题\" [--answer]"
echo "   升级向量层:在 Mac 装 sqlite-vec + 让 OLLAMA_HOST 指向那台电脑的 Ollama(或 EMBED_PROVIDER=openai + EMBED_BASE_URL),删 kb.sqlite 重跑本脚本。"
echo "   kb.sqlite 不进 git,纳入快照+冷备到玉兔2;wiki/ 进 git。"
