#!/usr/bin/env bash
# 玉兔6 · 密钥还原(在 Mac mini 本机跑;不打印任何密钥值)
# 从统一保险库 ~/.config/yutu6-secrets 的 secrets.env,按每项 "# Source:" 注解
# 精确还原回各自来源文件(/Users/yutu/... → 本机 $HOME/...)。
# (2026-06-18:保险库已从桌面 MacMini-Secrets-PRIVATE 迁到 ~/.config/yutu6-secrets。)
#
# 前置:目标主要是 ~/.hermes/.env 与 ~/Projects/YuanXiao/ops/config/yuanxiao.env。
#       建议先 clone 好 Hermes 与 YuanXiao(见 clone-repos.sh),再跑本脚本。
# 用法:bash restore-secrets.sh [SECRETS_DIR]
set -euo pipefail

SECRETS_DIR="${1:-$HOME/.config/yutu6-secrets}"
SRC="$SECRETS_DIR/secrets.env"
[ -f "$SRC" ] || { echo "✗ 找不到 $SRC(确认保险库在 ~/.config/yutu6-secrets,或把路径作参数传入)"; exit 1; }

echo "==> 解析 $SRC(按 # Source 分发,不显示任何值)"

# 第 1 趟:收集去重的目标文件,建好父目录
DESTS_FILE="$(mktemp)"
awk -v home="$HOME" '
  function destfile(s,  rel){ rel=s; sub(/^\/Users\/[^\/]+\//,"",rel); return home "/" rel }
  /^# Source: / { s=$3; sub(/:[0-9]+$/,"",s); print destfile(s) }
' "$SRC" | sort -u > "$DESTS_FILE"
while IFS= read -r d; do mkdir -p "$(dirname "$d")"; done < "$DESTS_FILE"

# 第 2 趟:把每条 KEY=VALUE 写到其目标的 .restore-tmp(awk 首次 > 截断,其后追加)
awk -v home="$HOME" '
  function destfile(s,  rel){ rel=s; sub(/^\/Users\/[^\/]+\//,"",rel); return home "/" rel }
  /^# Source: / { s=$3; sub(/:[0-9]+$/,"",s); dest=destfile(s) ".restore-tmp"; next }
  /^[A-Za-z_][A-Za-z0-9_]*=/ { if(dest!=""){ print > dest; dest="" } }
' "$SRC"

# 落地:备份旧文件 → 覆盖 → chmod 600;只报条数,不报内容
while IFS= read -r d; do
  tmp="$d.restore-tmp"; [ -f "$tmp" ] || continue
  if [ -f "$d" ]; then cp -p "$d" "$d.bak.$(date +%Y%m%d%H%M%S)"; echo "   备份旧 $d → *.bak.*"; fi
  mv "$tmp" "$d"; chmod 600 "$d"
  echo "   ✓ 还原 $(grep -c '=' "$d") 项 → $d  (chmod 600)"
done < "$DESTS_FILE"
rm -f "$DESTS_FILE"

echo "✅ 完成。终端未显示任何密钥值。"
echo "   提醒:SSH 私钥不在 secrets.env 里;运行位统一使用 ~/.ssh/ 下的固定身份文件并 chmod 600。"
