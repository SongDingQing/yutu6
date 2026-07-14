#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="${WATCHDOG_LAUNCHD_LABEL:-com.yutu6.watchdog}"
UID_VALUE="$(id -u)"
DOMAIN="gui/${UID_VALUE}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
[[ -n "${NODE_BIN}" && -x "${NODE_BIN}" ]] || { echo "node executable not found" >&2; exit 1; }
PEEKABOO_BIN="${PEEKABOO_BIN:-$(command -v peekaboo || true)}"
PEEKABOO_BIN="${PEEKABOO_BIN:-/usr/bin/false}"
PATH_VALUE="$(dirname "${NODE_BIN}"):$(dirname "${PEEKABOO_BIN}"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
ARTIFACTS="${ROOT}/artifacts"
PLIST_DST="${ARTIFACTS}/${LABEL}.plist"
LOG_DIR="${ARTIFACTS}/watchdog"

if [[ "${1:-}" == "--unload" ]]; then
  launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
  echo "unloaded ${DOMAIN}/${LABEL}"
  exit 0
fi

mkdir -p "${ARTIFACTS}" "${LOG_DIR}"

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
		<string>${ROOT}/watchdog-daemon.js</string>
		<string>--daemon</string>
	</array>
	<key>WorkingDirectory</key>
	<string>${ROOT}</string>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key>
		<string>${PATH_VALUE}</string>
		<key>YUTU6_NODE_BIN</key>
		<string>${NODE_BIN}</string>
		<key>CONSOLE_NODE_BIN</key>
		<string>${NODE_BIN}</string>
		<key>YUTU6_PEEKABOO_BIN</key>
		<string>${PEEKABOO_BIN}</string>
		<key>CONSOLE_PEEKABOO_BIN</key>
		<string>${PEEKABOO_BIN}</string>
		<key>CONSOLE_PEEKABOO_IMAGE_BIN</key>
		<string>${PEEKABOO_BIN}</string>
		<key>WATCHDOG_INTERVAL_MS</key>
		<string>${WATCHDOG_INTERVAL_MS:-30000}</string>
		<key>WATCHDOG_WORKER_STALE_MS</key>
		<string>${WATCHDOG_WORKER_STALE_MS:-300000}</string>
		<key>WATCHDOG_RUNNING_STALE_MS</key>
		<string>${WATCHDOG_RUNNING_STALE_MS:-600000}</string>
		<key>WATCHDOG_NO_PROGRESS_STALE_MS</key>
		<string>${WATCHDOG_NO_PROGRESS_STALE_MS:-720000}</string>
		<key>WATCHDOG_RESTART_COOLDOWN_MS</key>
		<string>${WATCHDOG_RESTART_COOLDOWN_MS:-120000}</string>
		<key>WATCHDOG_RESTART_MAX_IN_WINDOW</key>
		<string>${WATCHDOG_RESTART_MAX_IN_WINDOW:-3}</string>
	</dict>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>${LOG_DIR}/watchdog-daemon.log</string>
	<key>StandardErrorPath</key>
	<string>${LOG_DIR}/watchdog-daemon.log</string>
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
launchctl kickstart -k "${DOMAIN}/${LABEL}"
launchctl print "${DOMAIN}/${LABEL}" | sed -n '1,80p'
