#!/usr/bin/env bash
# 玉兔6 控制台启动(在 Mac 本机跑)。在装了 codex 的同一台机器上启动,
# 这样服务端才能 spawn 到 Codex。仅监听 localhost。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
command -v node >/dev/null || { echo "✗ 缺 node(先装 Node)"; exit 1; }
PORT="${PORT:-41218}"
echo "→ http://localhost:$PORT  (Ctrl+C 退出)"
( sleep 1; command -v open >/dev/null && open "http://localhost:$PORT" >/dev/null 2>&1 || true ) &
PORT="$PORT" exec node server.js
