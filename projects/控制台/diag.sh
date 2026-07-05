#!/usr/bin/env bash
# 玉兔6 控制台诊断(在 Mac 本机跑)。结果写到工作区文件,总管直接读,免复制粘贴。
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
REPORT="$HERE/artifacts/diag.txt"; mkdir -p "$HERE/artifacts"
exec > >(tee "$REPORT") 2>&1
PORT="${PORT:-41218}"
echo "===== 玉兔6 控制台诊断 $(date) ====="
echo "(结果已写到 $REPORT)"
echo ""; echo "--- node ---"; command -v node && node --version || echo "✗ 没有 node(先装 Node)"
echo ""; echo "--- 端口 $PORT 是否已被占用 ---"; lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || echo "(没占用,或没 lsof)"
echo ""; echo "--- 后台启动服务,等 2.5 秒 ---"
PORT="$PORT" node server.js > "$HERE/artifacts/server.log" 2>&1 & SRV=$!
sleep 2.5
echo "--- server.log ---"; cat "$HERE/artifacts/server.log"
echo ""; echo "--- 连通性测试 ---"
for U in "http://127.0.0.1:$PORT/api/runners" "http://localhost:$PORT/api/runners" "http://[::1]:$PORT/api/runners"; do
  printf '%s → ' "$U"; curl -s -m 5 "$U" >/dev/null 2>&1 && echo "OK 通" || echo "✗ 连不上"
done
kill $SRV 2>/dev/null
echo ""; echo "===== 诊断完。把这段(或 artifacts/diag.txt)发我 ====="
