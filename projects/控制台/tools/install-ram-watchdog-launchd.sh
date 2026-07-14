#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="${RAM_WATCHDOG_LAUNCHD_LABEL:-com.yutu6.ram-watchdog}"
UID_VALUE="$(id -u)"
DOMAIN="gui/${UID_VALUE}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
[[ -n "${NODE_BIN}" && -x "${NODE_BIN}" ]] || { echo "node executable not found" >&2; exit 1; }
PATH_VALUE="$(dirname "${NODE_BIN}"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
ARTIFACTS="${ROOT}/artifacts"
LOG_DIR="${ARTIFACTS}/ram-watchdog"
PLIST_DST="${ARTIFACTS}/${LABEL}.plist"
INTERVAL="${RAM_WATCHDOG_INTERVAL_SECONDS:-300}"

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
		<string>${ROOT}/tools/ram-watchdog.js</string>
		<string>--json</string>
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
	</dict>
	<key>StartInterval</key>
	<integer>${INTERVAL}</integer>
	<key>RunAtLoad</key>
	<true/>
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
launchctl kickstart -k "${DOMAIN}/${LABEL}"
launchctl print "${DOMAIN}/${LABEL}" | sed -n '1,80p'
