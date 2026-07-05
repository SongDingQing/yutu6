#!/usr/bin/env bash
# 玉兔6 · 四智能体自优化 · 生产者(优化师 Codex + Peekaboo)
#   按次数跑 MAX_ITER 轮(默认10),每轮跑到完成;问题入队,开发(dev-worker)异步消化、不阻塞。
#   架构详见同目录 自优化循环架构.md。只动 UI 层,不碰业务/密钥,Starlaid 不涉及。
# 后台:nohup bash loop.sh > /tmp/ui-opt.log 2>&1 &
set -uo pipefail

WS=~/玉兔6工作区
OUT="$WS/projects/控制台/artifacts/ui-optimize"
SHOTS="$OUT/shots"; REPORTS="$OUT/reports"; Q="$OUT/queue"; STOP="$OUT/STOP"; SEEN="$OUT/seen.hashes"
CASE_DIR="$WS/board/learning-cases"; CASE_FILE="$CASE_DIR/ui-optimization-cases.md"
SELF_REFLECTION_TRIGGER="$WS/projects/控制台/tools/self-reflection-trigger.js"
EVENTS="$WS/projects/控制台/artifacts/engine-events.jsonl"
LEARNING_CASE_EVENT_WRITER="$WS/shared/agents/ui-optimizer/append-learning-case-event.js"
SELF_REFLECTION_TRIGGER_COOLDOWN="$OUT/self-reflection-trigger-cooldown.tsv"
SELF_REFLECTION_TRIGGER_COOLDOWN_SECONDS="${SELF_REFLECTION_TRIGGER_COOLDOWN_SECONDS:-86400}"
UI_OPT_TASK_ID="${UI_OPT_TASK_ID:-${TASK_ID:-}}"
UI_OPT_QUEUE_AGENT="${UI_OPT_QUEUE_AGENT:-${QUEUE_AGENT:-ui-optimizer}}"
UI_OPT_QUEUE_ID="${UI_OPT_QUEUE_ID:-${QUEUE_ID:-}}"
UI_OPT_ROOT_QUEUE_AGENT="${UI_OPT_ROOT_QUEUE_AGENT:-${ROOT_QUEUE_AGENT:-}}"
UI_OPT_ROOT_QUEUE_ID="${UI_OPT_ROOT_QUEUE_ID:-${ROOT_QUEUE_ID:-}}"
UI_OPT_ROOT_TASK_ID="${UI_OPT_ROOT_TASK_ID:-${ROOT_TASK_ID:-}}"
mkdir -p "$SHOTS" "$REPORTS" "$Q" "$CASE_DIR"; : > "$SEEN" 2>/dev/null || true; rm -f "$STOP"
PAGES=( "http://localhost:41218/workspace" "http://localhost:41218/control-room" )
PEEKABOO="${PEEKABOO:-$HOME/.local/bin/peekaboo}"
OPEN_VALIDATION_TAB="${OPEN_VALIDATION_TAB:-$WS/shared/agents/ui-optimizer/open-validation-tab.sh}"
MAX_ITER="${MAX_ITER:-10}"; QUEUE_CAP="${QUEUE_CAP:-12}"; DRAIN_DEADLINE="${DRAIN_DEADLINE:-300}"
CODEX_TO="${CODEX_TO:-${CLAUDE_TO:-120}}"; PEEKABOO_TO="${PEEKABOO_TO:-60}"

log(){ printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
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
feishu(){ bash "$WS/shared/agents/ui-optimizer/notify-feishu.sh" "$1" "$2" >/dev/null 2>&1 || log "飞书未发出"; }
optimizer(){ to "$CODEX_TO" codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -C "$WS" "$1" 2>/dev/null; }
qcount(){ ls -1 "$Q"/*.task 2>/dev/null | wc -l | tr -d ' '; }
emit_learning_case_event(){
  mkdir -p "$(dirname "$EVENTS")"
  CASE_FILE_REL="${CASE_FILE#$WS/}" SUMMARY_REL="${summary#$WS/}" \
  UI_OPT_TASK_ID="$UI_OPT_TASK_ID" UI_OPT_QUEUE_AGENT="$UI_OPT_QUEUE_AGENT" UI_OPT_QUEUE_ID="$UI_OPT_QUEUE_ID" \
  UI_OPT_ROOT_QUEUE_AGENT="$UI_OPT_ROOT_QUEUE_AGENT" UI_OPT_ROOT_QUEUE_ID="$UI_OPT_ROOT_QUEUE_ID" UI_OPT_ROOT_TASK_ID="$UI_OPT_ROOT_TASK_ID" \
  node "$LEARNING_CASE_EVENT_WRITER" --events "$EVENTS" --iter "$iter" --max-iter "$MAX_ITER" --enq "$enq" --left "$left"
}
append_learning_case(){
  local stamp title recent issues trace
  stamp="$(date '+%F %T %Z')"
  title="UI自优化运行案例"
  recent="$(find "$REPORTS" -maxdepth 1 -name 'round-*.md' -print 2>/dev/null | sort | tail -5)"
  issues="$(printf '%s\n' "$recent" | while IFS= read -r f; do [ -f "$f" ] && rg -n "区域:|问题:|改法:" "$f" 2>/dev/null | head -4 | sed "s#^#  - ${f#$WS/}:#"; done | head -12)"
  trace=""
  [ -n "$UI_OPT_TASK_ID" ] && trace="${trace} taskId=${UI_OPT_TASK_ID}"
  [ -n "$UI_OPT_QUEUE_AGENT" ] && trace="${trace} queueAgent=${UI_OPT_QUEUE_AGENT}"
  [ -n "$UI_OPT_QUEUE_ID" ] && trace="${trace} queueId=${UI_OPT_QUEUE_ID}"
  [ -n "$UI_OPT_ROOT_QUEUE_AGENT" ] && trace="${trace} rootQueueAgent=${UI_OPT_ROOT_QUEUE_AGENT}"
  [ -n "$UI_OPT_ROOT_QUEUE_ID" ] && trace="${trace} rootQueueId=${UI_OPT_ROOT_QUEUE_ID}"
  [ -n "$UI_OPT_ROOT_TASK_ID" ] && trace="${trace} rootTaskId=${UI_OPT_ROOT_TASK_ID}"
  [ -f "$CASE_FILE" ] || {
    printf '# UI 自动优化案例\n\n> 自动优化循环会把每次运行的关键报告追加到这里。\n\n' > "$CASE_FILE"
  }
  {
    echo
    echo "## $stamp · $title"
    echo "- 来源: projects/控制台/artifacts/ui-optimize/reports/SUMMARY.md"
    echo "- 事件日志: projects/控制台/artifacts/engine-events.jsonl type=learning_case.appended source=ui-optimizer${trace}"
    echo "- 场景:自动优化循环完成 ${iter}/${MAX_ITER} 轮,入队 ${enq},未消化 ${left}。"
    echo "- 现象:本轮发现/确认的 UI 交互、易读性、一致性或可发现性问题来自 round 报告。"
    echo "- 根因/判断:单轮 artifacts 只能说明一次修改,必须沉淀为案例原则,否则秘书、CEO、董事会下次无法复用。"
    echo "- 改法:保留本轮报告路径,把关键现象压缩进案例库;后续任务先读案例再决策。"
    echo "- 验证:SUMMARY 与 round 报告已落盘;下一轮自动优化继续回归。"
    echo "- 可复用原则:自动优化不只修页面,还要把反复出现的设计问题上升为架构/评审原则。"
    if [ -n "${issues//[[:space:]]/}" ]; then
      echo "- 本轮问题摘录:"
      printf '%s\n' "$issues"
    fi
  } >> "$CASE_FILE"
}
trigger_self_reflection_from_case(){
  local reason cooldown_key now last_ts
  reason="UI 自动优化追加优秀案例"
  [ -n "$UI_OPT_TASK_ID" ] && reason="${reason}; taskId=${UI_OPT_TASK_ID}"
  [ -n "$UI_OPT_QUEUE_ID" ] && reason="${reason}; queueId=${UI_OPT_QUEUE_ID}"
  [ -n "$UI_OPT_ROOT_QUEUE_ID" ] && reason="${reason}; rootQueueId=${UI_OPT_ROOT_QUEUE_ID}"
  [ -f "$SELF_REFLECTION_TRIGGER" ] || { log "自省优化触发器不存在,跳过"; return 0; }
  cooldown_key=""
  if [ -n "$UI_OPT_SOURCE_CASE_ANCHOR" ] && [ -n "$UI_OPT_SOURCE_CASE_HASH" ]; then
    cooldown_key="${UI_OPT_SOURCE_CASE_ANCHOR}|${UI_OPT_SOURCE_CASE_HASH}"
    now="$(date +%s)"
    last_ts="$(awk -F '\t' -v key="$cooldown_key" '$1 == key { ts = $2 } END { print ts }' "$SELF_REFLECTION_TRIGGER_COOLDOWN" 2>/dev/null || true)"
    if [ -n "$last_ts" ] && [ "$last_ts" -eq "$last_ts" ] 2>/dev/null && [ $((now - last_ts)) -lt "$SELF_REFLECTION_TRIGGER_COOLDOWN_SECONDS" ]; then
      log "同一 source case/hash 在 24 小时冷却期内已触发,跳过自省入队"
      return 0
    fi
  fi
  local trigger_cmd=(node "$SELF_REFLECTION_TRIGGER" --source "$CASE_FILE" --module "ui-optimizer" --reason "$reason")
  [ -n "$UI_OPT_SOURCE_CASE_TITLE" ] && trigger_cmd+=(--case-title "$UI_OPT_SOURCE_CASE_TITLE")
  if "${trigger_cmd[@]}" >/dev/null 2>&1; then
    [ -n "$cooldown_key" ] && printf '%s\t%s\n' "$cooldown_key" "$now" >> "$SELF_REFLECTION_TRIGGER_COOLDOWN"
  else
    log "自省优化触发失败(不阻断 UI 收尾)"
  fi
}
open_validation_page(){
  local url="$1"
  if [ -x "$OPEN_VALIDATION_TAB" ]; then
    to "$PEEKABOO_TO" "$OPEN_VALIDATION_TAB" "$url" --wait 1 >/dev/null 2>&1 && return 0
    log "验证标签复用失败,为避免堆标签跳过打开: $url"
    return 1
  fi
  log "缺少 open-validation-tab.sh,为避免堆标签跳过打开: $url"
  return 1
}
fingerprint(){
  sed -E '
    s#https?://[^ ]+##g
    s/[0-9]{4}[-/][0-9]{2}[-/][0-9]{2}//g
    s/[0-9]{2}:[0-9]{2}(:[0-9]{2})?//g
    s/^[[:space:]]*([-*+]|[0-9]+[.)、])?[[:space:]]*//g
    s/[[:space:]]+/ /g
  ' |
  awk '
    /【测试路线】/ { exit }
    /^【/ || /^#/ { next }
    length($0) < 8 { next }
    { gsub(/[0-9]+/, "#"); print tolower($0) }
  ' |
  sort -u | head -20 | shasum | awk '{print $1}'
}

# 边缘条件⑨:互斥旧实例(不双开)。进程表不可读时跳过,不要阻断启动。
self_pid=$$
loop_pids="$(pgrep -f "ui-optimizer/loop.sh" 2>/dev/null || true)"
if [ -n "$loop_pids" ] && printf '%s\n' "$loop_pids" | grep -v "^${self_pid}$" | grep -q .; then
  log "⚠ 已有 loop 在跑(本次仍继续,如需独占请先 pkill)"
fi
pkill -f "bash .*ui-optimizer/dev-worker\\.sh" 2>/dev/null || true; sleep 1

# 拉起开发消费者(异步)
nohup bash "$WS/shared/agents/ui-optimizer/dev-worker.sh" >> "$OUT/dev.log" 2>&1 &
DEV=$!; log "开发消费者 pid=$DEV"

# 洞察员协同(老板 2026-06-25):默认只沉淀洞察,不在每次启动时额外调用模型筛选。
# 自动采纳会显著放大 token 消耗,需要显式 UI_OPTIMIZER_AUTO_ADOPT_INSIGHTS=1 才开启。
INSIGHTS="$WS/board/insights/insights.md"
if [ "${UI_OPTIMIZER_AUTO_ADOPT_INSIGHTS:-0}" = "1" ] && [ -s "$INSIGHTS" ]; then
  log "评估洞察员洞察 → 筛 UI 可落地项"
  ieval="$REPORTS/insight-eval-$(date +%Y%m%d-%H%M%S).md"
  optimizer "你是玉兔6 UI 自优化师。用 Read 读洞察员洞察 $INSIGHTS。逐条评估对玉兔6 WebUI 体验是否有益:
- 有益 且 属 UI 呈现/交互层 且 低风险可落地 → 列为【采纳】,写成给 Codex 的具体改法(到元素/CSS,只动 projects/控制台/public/)。
- 需人定方向/跨业务/高风险 → 列为【不采纳】并一句话说明理由。
每条都要有判断依据,不照单全收也不一概忽略。输出两段:【采纳】(每条: - 现象/来源: ...; 改法: ...)与【不采纳】(每条: - 洞察: ...; 理由: ...)。" > "$ieval" 2>/dev/null || true
  # 把【采纳】部分入队执行(去重)
  adopt="$(awk '/【采纳】/{f=1;next} /【不采纳】/{f=0} f' "$ieval" 2>/dev/null)"
  if [ -n "${adopt//[[:space:]]/}" ]; then
    ih=$(printf '%s' "$adopt" | fingerprint)
    if ! grep -qx "$ih" "$SEEN" 2>/dev/null; then
      { echo "# 来源:洞察员评估(自动采纳)"; echo "$adopt"; } > "$Q/$(date +%s%N)-insight.task"
      echo "$ih" >> "$SEEN"; log "洞察采纳项已入队"
      feishu "💡 洞察→UI优化(自动采纳)" "$(printf '%s' "$adopt" | grep -vE '^\s*$|【' | head -5)"
    else log "洞察采纳项与历史重复,跳过"; fi
  else log "本次洞察无 UI 可落地采纳项"; fi
else
  log "洞察自动采纳默认关闭(UI_OPTIMIZER_AUTO_ADOPT_INSIGHTS=1 可开启)"
fi

iter=0; noissue=0; enq=0
while [ "$iter" -lt "$MAX_ITER" ]; do
  iter=$((iter+1)); ts=$(date +%Y%m%d-%H%M%S); newthis=0
  log "=== 第 $iter/$MAX_ITER 轮 ==="
  rep="$REPORTS/round-$iter-$ts.md"; echo "# 自优化 第 $iter 轮 · $ts" > "$rep"

  for url in "${PAGES[@]}"; do
    name=$(basename "$url"); base="$REPORTS/round-$iter-$name-$ts"
    sb="$SHOTS/$name-$ts-before.png"; sa="$SHOTS/$name-$ts-aftertest.png"
    echo -e "\n## $url" >> "$rep"
    # URL → 页面源码文件(锁屏截图为空时以源码审查为准,绝不因此说"没问题")
    case "$name" in
      workspace) src="$WS/projects/控制台/public/workspace.html" ;;
      control-room) src="$WS/projects/控制台/public/control-room.html" ;;
      *) src="" ;;
    esac

    # ① Peekaboo 截图(只读,可能因锁屏失败→以源码为准)
    open_validation_page "$url"
    to "$PEEKABOO_TO" "$PEEKABOO" image --mode frontmost --path "$sb" >/dev/null 2>&1 || true
    shotnote="截图 $sb(若打不开/空白,可能锁屏,忽略截图、以源码为准)"
    [ -s "$sb" ] || shotnote="(本轮截图缺失/空白——很可能锁屏;严格以源码审查为准,绝不因截图缺失就说没问题)"

    # ② 优化师读图+读源码:强制挑错(禁"没问题",≥3 条)
    optimizer "你是玉兔6 UI 自优化师。审查页面 $url。
$shotnote
$( [ -n "$src" ] && echo "页面源码(权威):用 Read 读 $src —— 直接从 HTML/CSS/JS 看对比度色值、字号、硬编码间距、缺失的 hover/空状态/加载态、长文本溢出、重复样式。" )
铁律:① 绝不允许'没问题/一切正常/无需优化'这类结论;② 本页至少挑出 3 条具体可落地问题(到元素/CSS,带源码 文件:行 或截图位置证据);③ 挑不满就继续深挖源码。
严格两段输出:
【挑错】每条固定格式: - 区域: ...; 问题: ...(带证据); 改法: ...(到元素/CSS)。
【测试路线】要 Peekaboo 实测的交互,≤4 条;每条: - 操作: ...; 预期: ...。
不客套,不提密钥。" > "$base.analysis.md" 2>/dev/null || true
    awk '/【测试路线】/{f=1} !f{print}' "$base.analysis.md" > "$base.issues.md" 2>/dev/null || cp "$base.analysis.md" "$base.issues.md" 2>/dev/null
    awk '/【测试路线】/{f=1} f{print}' "$base.analysis.md" > "$base.testplan.md" 2>/dev/null || true
    issues=$(cat "$base.issues.md" 2>/dev/null); testplan=$(cat "$base.testplan.md" 2>/dev/null)
    cat "$base.analysis.md" >> "$rep" 2>/dev/null || true
    if printf '%s\n%s\n' "$issues" "$testplan" | grep -qiE 'not logged in|please run /login|login required'; then
      log "$name Codex 未登录,跳过入队"
      echo "Codex 未登录,跳过入队: 请主人手动完成 Codex 登录后重启循环。" >> "$rep"
      continue
    fi
    [ -z "${issues//[[:space:]]/}" ] && { log "$name 无挑错"; continue; }

    # 边缘条件④:去重(同一问题不重复入队)
    h=$(printf '%s' "$issues" | fingerprint)
    grep -qx "$h" "$SEEN" 2>/dev/null && { log "$name 问题与历史重复,跳过入队"; continue; }

    # ③ Peekaboo 测试点击(只读,不改文件)
    [ -n "${testplan//[[:space:]]/}" ] && to "$PEEKABOO_TO" "$PEEKABOO" agent "在前台浏览器对 $url 执行下列测试并简述每步结果,不要改任何文件:
$testplan" > "$base.testrun.md" 2>&1 || true
    to "$PEEKABOO_TO" "$PEEKABOO" image --mode frontmost --path "$sa" >/dev/null 2>&1 || true

    # ④ 优化师评测试 → 合并最终清单
    optimizer "测试路线:
$testplan
Peekaboo 实测:$(head -40 "$base.testrun.md" 2>/dev/null)
用 Read 看测试后截图 $sa,判断各项是否通过,把挑错与测试发现合并成最终要修清单(≤6 条,现象+改法)。" > "$base.final.md" 2>/dev/null || cp "$base.issues.md" "$base.final.md" 2>/dev/null
    final=$(cat "$base.final.md" 2>/dev/null); [ -z "${final//[[:space:]]/}" ] && final="$issues"

    # ⑤ Hermes 改前预告卡
    feishu "🔧 UI优化·第${iter}轮·${name}" "**页面**：$url"$'\n'"**拟改**："$'\n'"$(printf '%s' "$issues" | grep -vE '^\s*$|【' | head -6)"

    # ⑥ 入队(不等开发)+ 背压(边缘条件⑤)
    while [ "$(qcount)" -ge "$QUEUE_CAP" ]; do log "队列满($QUEUE_CAP),等开发消化…"; sleep 8; done
    cp "$base.final.md" "$Q/$(date +%s%N)-$name.task"; echo "$h" >> "$SEEN"
    enq=$((enq+1)); newthis=$((newthis+1)); log "$name 已入队(累计 $enq)"
  done

  # 边缘条件③:连续 2 轮无新问题 → 收敛提前停
  [ "$newthis" -eq 0 ] && noissue=$((noissue+1)) || noissue=0
  [ "$noissue" -ge 2 ] && { log "连续2轮无新问题,收敛,提前结束"; break; }
done

# 收尾:通知开发排空,带截止(边缘条件⑧)
log "生产 ${iter} 轮完成,入队 ${enq}。等开发排空(≤${DRAIN_DEADLINE}s)…"
touch "$STOP"; dl=$(( $(date +%s) + DRAIN_DEADLINE ))
while [ "$(qcount)" -gt 0 ] && [ "$(date +%s)" -lt "$dl" ]; do sleep 6; done
left=$(qcount); [ "$left" -gt 0 ] && log "⚠ 仍有 $left 个任务未消化(已记录,收尾)"
kill "$DEV" 2>/dev/null || true

summary="$REPORTS/SUMMARY.md"
{ echo "# 自优化 SUMMARY"; echo; echo "- 结束: $(date '+%F %T %Z')"; echo "- 轮数: ${iter} / ${MAX_ITER} · 入队: ${enq} · 未消化: ${left}";
  echo "- 早停: $([ "$noissue" -ge 2 ] && echo 收敛 || echo 否)"; echo; echo "## 四智能体";
  echo "- 优化师Codex:挑错+测试路线+评测;Peekaboo:截图+测试点击;开发Codex:异步队列改;Hermes:飞书预告/结果";
	  echo; echo "## 报告"; find "$REPORTS" -maxdepth 1 -name 'round-*.md' | sort | sed 's#^#- #'; } > "$summary"
append_learning_case
emit_learning_case_event
trigger_self_reflection_from_case
feishu "✅ UI自优化收尾" "轮数 ${iter}/${MAX_ITER} · 入队 ${enq} · 未消化 ${left}。详见 SUMMARY.md。"
log "✅ 结束。SUMMARY: $summary"
