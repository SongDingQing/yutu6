#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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
  echo "[model-fabric] Node.js not found" >&2
  exit 1
fi

exec "${NODE_BIN}" "${ROOT}/shared/model-fabric/server.js"
