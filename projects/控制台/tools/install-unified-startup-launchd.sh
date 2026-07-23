#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKSPACE="$(cd "${ROOT}/../.." && pwd)"
LABEL="com.yutu6.startup"
DOMAIN="gui/$(id -u)"
SOURCE="${ROOT}/launchd/${LABEL}.plist"
TARGET="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="${ROOT}/artifacts/startup"

if [[ "${1:-}" == "--unload" ]]; then
  launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
  echo "unloaded ${DOMAIN}/${LABEL}; component LaunchAgents were left intact"
  exit 0
fi

mkdir -p "${HOME}/Library/LaunchAgents" "${LOG_DIR}" \
  "${HOME}/.hermes/voice-wake/logs"
plutil -lint "${SOURCE}" >/dev/null

if [[ "${1:-}" == "--write-only" ]]; then
  install -m 0644 "${SOURCE}" "${TARGET}"
  echo "${TARGET}"
  exit 0
fi

bash "${WORKSPACE}/start-all.sh" install
install -m 0644 "${SOURCE}" "${TARGET}"
launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
launchctl bootstrap "${DOMAIN}" "${TARGET}"
launchctl enable "${DOMAIN}/${LABEL}" 2>/dev/null || true
launchctl kickstart "${DOMAIN}/${LABEL}"
sleep 1
launchctl print "${DOMAIN}/${LABEL}" | sed -n '1,70p'
