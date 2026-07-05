#!/usr/bin/env bash
set -euo pipefail

# 安装/卸载「每日复盘+硬化」定时(北京时间凌晨5点 = 本机 Asia/Shanghai 05:00)。
# 用法:
#   bash tools/install-daily-governance-hardening-launchd.sh            # 安装并立即加载
#   bash tools/install-daily-governance-hardening-launchd.sh --write-only # 只生成 plist 不加载
#   bash tools/install-daily-governance-hardening-launchd.sh --unload    # 卸载

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="${DGH_LAUNCHD_LABEL:-com.yutu6.daily-governance-hardening}"
UID_VALUE="$(id -u)"
DOMAIN="gui/${UID_VALUE}"
NODE_BIN="${NODE_BIN:-/Users/yutu6/.local/node-v24.16.0-darwin-arm64/bin/node}"
ARTIFACTS="${ROOT}/artifacts"
PLIST_DST="${ARTIFACTS}/${LABEL}.plist"
LOG_DIR="${ARTIFACTS}/daily-governance-hardening"
HOUR="${DGH_HOUR:-5}"     # 本机本地时区的小时;Asia/Shanghai 下 5 = 北京凌晨5点。UTC 机器用 21。
MINUTE="${DGH_MINUTE:-0}"

if [[ "${1:-}" == "--unload" ]]; then
  launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
  echo "unloaded ${DOMAIN}/${LABEL}"
  exit 0
fi

mkdir -p "${ARTIFACTS}" "${LOG_DIR}"

# 时区健全性提示(不阻断):本机非 Asia/Shanghai 且 HOUR=5 时,5 点可能不是北京时间。
TZ_NAME="$(readlink /etc/localtime 2>/dev/null | sed 's#.*/zoneinfo/##')"
if [[ "${TZ_NAME}" != "Asia/Shanghai" && "${HOUR}" == "5" ]]; then
  echo "⚠️  本机时区为 '${TZ_NAME}',Hour=5 未必等于北京时间凌晨5点。北京5点=UTC 21:00,请按需设 DGH_HOUR。" >&2
fi

cat > "${PLIST_DST}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${ROOT}/tools/daily-governance-hardening.js</string>
    <string>--json</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/Users/yutu6/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>YUTU6_NODE_BIN</key>
    <string>${NODE_BIN}</string>
    <key>CONSOLE_NODE_BIN</key>
    <string>${NODE_BIN}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${HOUR}</integer>
    <key>Minute</key>
    <integer>${MINUTE}</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/launchd.err.log</string>
</dict>
</plist>
PLIST

plutil -lint "${PLIST_DST}" >/dev/null

if [[ "${1:-}" == "--write-only" ]]; then
  echo "${PLIST_DST}"
  exit 0
fi

launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
launchctl bootstrap "${DOMAIN}" "${PLIST_DST}"
launchctl enable "${DOMAIN}/${LABEL}" 2>/dev/null || true
echo "installed ${DOMAIN}/${LABEL} (Hour=${HOUR} Minute=${MINUTE}, TZ=${TZ_NAME:-unknown})"
launchctl print "${DOMAIN}/${LABEL}" | grep -iE 'state|next|calendar|run' | sed -n '1,30p' || true
