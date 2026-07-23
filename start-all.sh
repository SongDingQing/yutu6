#!/usr/bin/env bash
# Unified entry point for the local Yutu6 runtime.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANAGER="${ROOT}/projects/控制台/tools/yutu6-startup.js"
NODE_BIN="${YUTU6_NODE_BIN:-}"

if [[ -z "${NODE_BIN}" ]]; then
  for candidate in \
    "${HOME}/.local/node-v24.16.0-darwin-arm64/bin/node" \
    "${HOME}/.local/bin/node" \
    "/opt/homebrew/bin/node" \
    "/usr/local/bin/node"; do
    if [[ -x "${candidate}" ]]; then
      NODE_BIN="${candidate}"
      break
    fi
  done
fi

if [[ -z "${NODE_BIN}" ]] && command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
fi

if [[ -z "${NODE_BIN}" || ! -x "${NODE_BIN}" ]]; then
  echo "[yutu6-startup] Node.js not found; expected Node 20+." >&2
  exit 1
fi

exec "${NODE_BIN}" "${MANAGER}" "${1:-start}" "${@:2}"
