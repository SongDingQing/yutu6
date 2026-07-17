#!/usr/bin/env bash
# 玉兔6 · 克隆项目仓库(在 Mac mini 本机跑;需先配好 GitHub 授权)
# Hermes(官方,公有 HTTPS)+ YuanXiao + Simulaid(私有 SSH)。
# 用法:bash clone-repos.sh
set -uo pipefail

HERMES_DIR="$HOME/.hermes/hermes-agent"
HERMES_BASE_COMMIT="0e235947b95d48decd1f378fdb111aff62155894"
PROJ_DIR="$HOME/Projects"
ok(){ echo "   ✓ $*"; }; warn(){ echo "   ⚠ $*"; }; skip(){ echo "   ⏭ $*"; }

echo "==> 0 前置检查"
command -v git >/dev/null || { echo "✗ 缺 git"; exit 1; }
if ssh -T git@github.com 2>&1 | grep -qi "successfully authenticated"; then ok "GitHub SSH 已通"; SSH_OK=1
else warn "GitHub SSH 未通——私有仓库(YuanXiao/Simulaid)会失败。先 'gh auth login' 或配 SSH key 再跑。"; SSH_OK=0; fi

echo "==> 1 Hermes(改版全量,来自 Gitee)→ $HERMES_DIR"
HERMES_GITEE="git@gitee.com:songdingqing/lunar-forest-hermes.git"   # master, 含 5 个核心改动,无需再打 patch
if [ -d "$HERMES_DIR/.git" ]; then skip "已存在,跳过 clone"; else
  mkdir -p "$(dirname "$HERMES_DIR")"
  git clone -b master "$HERMES_GITEE" "$HERMES_DIR" && ok "改版 Hermes 已 clone(5 个核心文件已在根路径)"
fi
echo "      ⮑ 仓库内 yutu6-hermes-migration/ 含 plugins/ voice-wake/ → 复制到 ~/.hermes/{plugins,voice-wake}(Hermes 期望它们是 hermes-agent 的兄弟目录)"
echo "      ⮑ 密钥用 restore-secrets.sh;依赖按仓库 README 装。"

echo "==> 2 YuanXiao(私有)→ $PROJ_DIR/YuanXiao"
if [ "$SSH_OK" = 1 ]; then
  mkdir -p "$PROJ_DIR"
  [ -d "$PROJ_DIR/YuanXiao/.git" ] && skip "已存在" || git clone git@github.com:SongDingQing/YuanXiao.git "$PROJ_DIR/YuanXiao" && ok "YuanXiao 已 clone"
else skip "跳过(SSH 未通)"; fi

echo "==> 3 Simulaid(私有)→ $HOME/Simulaid"
if [ "$SSH_OK" = 1 ]; then
  [ -d "$HOME/Simulaid/.git" ] && skip "已存在" || git clone git@github.com:SongDingQing/Simulaid.git "$HOME/Simulaid" && ok "Simulaid 已 clone"
else skip "跳过(SSH 未通)"; fi

echo ""
echo "✅ clone 阶段完成。后续:① 应用 Hermes patch ② bash restore-secrets.sh ③ 配 Android/JDK/Gradle、Unity/团结 ④ 见《机器侧清单.md》验证。"
