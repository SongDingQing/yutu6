#!/usr/bin/env bash
# 检查 Gitee 上改版 Hermes 仓库是否含玉兔自定义的关键文件(在 Mac mini 本机跑)
# 用法:bash check-hermes-gitee.sh [仓库SSH地址]
set -uo pipefail
REPO="${1:-git@gitee.com:songdingqing/lunar-forest-hermes.git}"

# 把全部输出同时写到工作区报告文件(总管能直接读,免去复制粘贴)
REPORT="$(cd "$(dirname "$0")/.." && pwd)/artifacts/hermes-gitee-check.txt"
mkdir -p "$(dirname "$REPORT")"
exec > >(tee "$REPORT") 2>&1
echo "(结果同时写到:$REPORT)"

# 选钥匙:优先已放置的 ~/.ssh,否则用工作区暂存的那把
K1="$HOME/.ssh/id_ed25519_gitee_yutu6"
K2="$HOME/玉兔6工作区/projects/_迁移/.ssh-stage/id_ed25519_gitee_yutu6"
if   [ -f "$K1" ]; then KEY="$K1"
elif [ -f "$K2" ]; then KEY="$K2"
else echo "✗ 找不到 gitee 私钥(先跑 place-gitee-key.sh,或确认暂存还在)"; exit 1; fi
chmod 600 "$KEY" 2>/dev/null || true   # ssh 对私钥权限很挑,兜底
export GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
echo "==> 浅 clone $REPO"
git clone --depth 1 "$REPO" "$TMP/repo" 2>&1 || { echo "✗ clone 失败:确认①公钥已加 Gitee ②地址对 ③ssh -T git@gitee.com 通"; exit 1; }
cd "$TMP/repo"

echo ""; echo "==> 默认分支:$(git rev-parse --abbrev-ref HEAD) · 文件总数:$(git ls-files | wc -l)"
echo ""; echo "==> 玉兔改版的 5 个关键文件:"
miss=0
for f in gateway/platforms/feishu.py gateway/run.py hermes_cli/plugins.py tools/transcription_tools.py tests/gateway/test_busy_session_ack.py; do
  if [ -f "$f" ]; then echo "  ✓ 有  $f"; else echo "  ✗ 缺  $f"; miss=$((miss+1)); fi
done
echo ""; echo "==> 顺带看 plugins / voice-wake 有没有一起带:"
for d in plugins voice-wake; do
  if find . -maxdepth 3 -iname "$d" -type d 2>/dev/null | head -1 | grep -q .; then echo "  ✓ 仓库里有 $d 目录"; else echo "  – 仓库里没看到 $d(可能本就在 ~/.hermes,不在代码仓)"; fi
done
echo ""; echo "==> 顶层结构:"; ls -1
echo ""
[ "$miss" -eq 0 ] && echo "✅ 5 个文件齐全 —— 这个 Gitee 仓库就能当玉兔6 的 Hermes 源,直接 clone 到 ~/.hermes/hermes-agent。" \
                  || echo "⚠ 缺 $miss 个 —— 让旧机把缺的补传,或改走 official+patch。"
