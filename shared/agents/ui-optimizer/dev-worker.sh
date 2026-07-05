#!/usr/bin/env bash
# 玉兔6 · 自优化"开发"消费者(Codex)。异步从队列取修复任务、最小改 public/,单写、不汇报。
# 由 loop.sh 自动拉起;也可单独跑。文件系统队列 = 天然原子领取,单实例 = 天然单写。
set -uo pipefail
WS=~/玉兔6工作区
OUT="$WS/projects/控制台/artifacts/ui-optimize"
Q="$OUT/queue"; PROC="$OUT/queue.proc"; DONE="$OUT/queue.done"; STOP="$OUT/STOP"
mkdir -p "$Q" "$PROC" "$DONE"
CODEX_TO="${CODEX_TO:-300}"
log(){ printf '[dev %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
to(){
  local t=$1; shift
  if command -v timeout >/dev/null 2>&1; then timeout "$t" "$@"; return $?
  elif command -v gtimeout >/dev/null 2>&1; then gtimeout "$t" "$@"; return $?
  fi
  local mark="${TMPDIR:-/tmp}/ui-opt-timeout.$$.$RANDOM"
  "$@" &
  local pid=$!
  ( sleep "$t"; if kill -0 "$pid" 2>/dev/null; then : > "$mark"; kill "$pid" 2>/dev/null || true; sleep 2; kill -9 "$pid" 2>/dev/null || true; fi ) &
  local watcher=$!
  wait "$pid"; local rc=$?
  kill "$watcher" 2>/dev/null || true; wait "$watcher" 2>/dev/null || true
  [ -f "$mark" ] && { rm -f "$mark"; return 124; }
  return "$rc"
}

log "开发消费者启动"
while :; do
  # 取最旧任务(原子 mv 领取;失败说明被别人拿走/没了)
  task=$(ls -1 "$Q"/*.task 2>/dev/null | sort | head -1 || true)
  if [ -z "${task:-}" ]; then
    [ -f "$STOP" ] && { log "队列空 + 收到 STOP,退出"; break; }
    sleep 4; continue
  fi
  id=$(basename "$task"); claim="$PROC/$id"
  mv "$task" "$claim" 2>/dev/null || { sleep 1; continue; }
  log "改: $id"
  # 单写:本进程串行处理,天然单写;按任务里的问题清单最小改 public/
  to "$CODEX_TO" codex exec --cd "$WS" --sandbox workspace-write --skip-git-repo-check \
    "按以下 UI 问题清单,最小改动修 $WS/projects/控制台/public/ 对应页面(保功能、零依赖、不破路由、不碰业务/密钥/Starlaid)。改完即可,无需汇报。问题清单:
$(cat "$claim")" >> "$OUT/dev.log" 2>&1 || log "codex 非零/超时(已跳过): $id"
  mv "$claim" "$DONE/$id" 2>/dev/null || true
done
log "开发消费者结束"
