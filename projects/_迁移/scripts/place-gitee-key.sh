#!/usr/bin/env bash
# 玉兔6 · 放置 Gitee SSH 私钥(在 Mac mini 本机跑)
# 把工作区暂存的密钥对:① 装进 ~/.ssh ② 备份进桌面密钥库(和其他密钥一起)
# ③ 写 ~/.ssh/config 的 gitee 段 ④ 清掉工作区暂存。全程不打印私钥。
# 用法:bash place-gitee-key.sh [密钥库目录]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
STAGE="$(cd "$HERE/.." && pwd)/.ssh-stage"
KEYNAME="id_ed25519_gitee_yutu6"
SRC_KEY="$STAGE/$KEYNAME"
VAULT="${1:-$HOME/Desktop/MacMini-Secrets-PRIVATE-2026-06-18}"

[ -f "$SRC_KEY" ] || { echo "✗ 找不到暂存私钥 $SRC_KEY(可能已放置过)"; exit 1; }

# 1) 装进 ~/.ssh
mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
cp "$SRC_KEY" "$HOME/.ssh/$KEYNAME"; chmod 600 "$HOME/.ssh/$KEYNAME"
cp "$SRC_KEY.pub" "$HOME/.ssh/$KEYNAME.pub"; chmod 644 "$HOME/.ssh/$KEYNAME.pub"
echo "✓ 私钥 → ~/.ssh/$KEYNAME (600)"

# 2) 备份进密钥库(与其他密钥同处,作为玉兔6全局配置的一部分)
mkdir -p "$VAULT/ssh"
cp "$SRC_KEY" "$VAULT/ssh/$KEYNAME"; chmod 600 "$VAULT/ssh/$KEYNAME"
cp "$SRC_KEY.pub" "$VAULT/ssh/$KEYNAME.pub"
echo "✓ 备份 → $VAULT/ssh/"

# 3) ~/.ssh/config 追加 gitee 段(幂等)
CFG="$HOME/.ssh/config"; touch "$CFG"; chmod 600 "$CFG"
if grep -q "$KEYNAME" "$CFG" 2>/dev/null; then echo "→ ssh config 已含 gitee 段,跳过"; else
  cat >> "$CFG" <<EOF

Host gitee.com
  HostName gitee.com
  User git
  IdentityFile ~/.ssh/$KEYNAME
  IdentitiesOnly yes
EOF
  echo "✓ 已写 ~/.ssh/config 的 gitee.com 段"
fi

# 4) 清掉工作区暂存(私钥不留在 git 工作区)
rm -f "$SRC_KEY" "$SRC_KEY.pub"; rmdir "$STAGE" 2>/dev/null || true
echo "✓ 已清除工作区暂存私钥"

echo ""; echo "公钥(也在 ~/.ssh/$KEYNAME.pub):"; cat "$HOME/.ssh/$KEYNAME.pub"
echo ""; echo "下一步:① 公钥加到 Gitee→设置→SSH 公钥  ② 测试 ssh -T git@gitee.com"
