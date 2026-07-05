#!/usr/bin/env bash
# 玉兔6 密钥防泄:克隆后一次性启用本地钩子(L1 pre-commit / L3 pre-push)。
# 钩子路径是本地 git 配置,不随仓库自动生效,每台机器需跑一次本脚本。
# CI(L4) 无需本地配置,克隆即随仓库在 GitHub 上生效。
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
git -C "$ROOT" config core.hooksPath .githooks
chmod +x "$ROOT/.githooks/pre-commit" "$ROOT/.githooks/pre-push" "$ROOT/security/secret-scan.js" 2>/dev/null || true
echo "✅ 已启用 core.hooksPath=.githooks(pre-commit / pre-push 密钥扫描已生效)"
echo "   自检: node security/secret-scan.js --tracked"
