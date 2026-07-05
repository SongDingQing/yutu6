#!/bin/bash
# ============================================================
#  玉兔6 · 新 Mac mini 一键部署
#  作用:在全新的 Mac 上安装 Homebrew、Node、Git、Python、
#        Claude Code、Codex,并在主目录铺好「玉兔6工作区」。
#  用法:见同目录《使用说明.md》。
#        最稳的方式:打开「终端」,输入  bash  和一个空格,
#        把本文件拖进窗口,回车。
#  本脚本可以重复运行,已完成的步骤会自动跳过。
# ============================================================

# 以脚本所在目录为基准(支持从 U盘 / 任意位置运行)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# ---- 彩色输出(无终端能力时自动降级) ----
BOLD="$(tput bold 2>/dev/null || true)"
DIM="$(tput dim 2>/dev/null || true)"
RED="$(tput setaf 1 2>/dev/null || true)"
GREEN="$(tput setaf 2 2>/dev/null || true)"
YELLOW="$(tput setaf 3 2>/dev/null || true)"
RESET="$(tput sgr0 2>/dev/null || true)"

step() { printf "\n${BOLD}▶ %s${RESET}\n" "$1"; }
ok()   { printf "  ${GREEN}✓ %s${RESET}\n" "$1"; }
warn() { printf "  ${YELLOW}⚠ %s${RESET}\n" "$1"; }
fail() { printf "  ${RED}✗ %s${RESET}\n" "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

SUMMARY=()
record() { SUMMARY+=("$1"); }

printf "${BOLD}================================================${RESET}\n"
printf "${BOLD}  玉兔6 · 新 Mac mini 一键部署${RESET}\n"
printf "${BOLD}================================================${RESET}\n"
printf "${DIM}将安装:Homebrew、Node、Git、Python、Claude Code、Codex,\n并在主目录建立「玉兔6工作区」。可重复运行。${RESET}\n"

# 芯片架构 → Homebrew 路径
if [[ "$(uname -m)" == "arm64" ]]; then
  BREW_PREFIX="/opt/homebrew"
else
  BREW_PREFIX="/usr/local"
fi

# ---------------------------------------------------------
# 1/6  Xcode 命令行工具(Homebrew / Git 依赖)
# ---------------------------------------------------------
step "1/6 检查 Xcode 命令行工具"
if xcode-select -p >/dev/null 2>&1; then
  ok "已安装"
else
  warn "未安装,正在弹出安装窗口……请点『安装』,装完后回到这里。"
  xcode-select --install >/dev/null 2>&1 || true
  printf "  等待安装完成(可能要几分钟)"
  until xcode-select -p >/dev/null 2>&1; do printf "."; sleep 5; done
  printf "\n"; ok "已安装"
fi
record "Xcode 命令行工具"

# ---------------------------------------------------------
# 2/6  Homebrew
# ---------------------------------------------------------
step "2/6 检查 Homebrew(软件包管理器)"
if have brew; then
  ok "已安装"
else
  warn "开始安装 Homebrew(可能要几分钟,会要求输入开机密码)"
  warn "输入密码时屏幕不显示字符,这是正常的,输完直接回车。"
  NONINTERACTIVE=1 /bin/bash -c \
    "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
    || warn "Homebrew 安装脚本返回异常,稍后再检测一次"
fi
# 让 brew 在当前会话与今后的终端都可用
if [[ -x "$BREW_PREFIX/bin/brew" ]]; then
  eval "$("$BREW_PREFIX/bin/brew" shellenv)"
  if ! grep -q 'brew shellenv' "$HOME/.zprofile" 2>/dev/null; then
    echo "eval \"\$($BREW_PREFIX/bin/brew shellenv)\"" >> "$HOME/.zprofile"
  fi
  ok "Homebrew 就绪"
  record "Homebrew"
else
  fail "没找到 Homebrew —— node/git 可能装不上,但 Claude Code / Codex 仍会用官方脚本安装"
fi

# ---------------------------------------------------------
# 3/6  基础工具:git / node / python
# ---------------------------------------------------------
step "3/6 安装基础工具(Git / Node / Python)"
if have brew; then
  for pkg in git node python; do
    if brew list --versions "$pkg" >/dev/null 2>&1; then
      ok "$pkg 已安装"
    else
      warn "安装 $pkg ……"
      brew install "$pkg" && ok "$pkg 安装完成" || fail "$pkg 安装失败(可稍后重跑本脚本)"
    fi
  done
  record "Git / Node / Python"
else
  warn "跳过(没有 Homebrew)"
fi

# 官方安装脚本常把程序装到 ~/.local/bin,确保它在 PATH 里
export PATH="$HOME/.local/bin:$PATH"
if ! grep -q '.local/bin' "$HOME/.zprofile" 2>/dev/null; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zprofile"
fi

# ---------------------------------------------------------
# 4/6  Claude Code
# ---------------------------------------------------------
step "4/6 安装 Claude Code"
if have claude; then
  ok "已安装($(claude --version 2>/dev/null | head -n1))"
else
  warn "用官方脚本安装 Claude Code……"
  if curl -fsSL https://claude.ai/install.sh | bash; then
    ok "安装完成"
  elif have brew && brew install --cask claude-code; then
    ok "安装完成(Homebrew)"
  elif have npm && npm install -g @anthropic-ai/claude-code; then
    ok "安装完成(npm)"
  else
    fail "Claude Code 安装失败,请把上面的红色信息截图发我"
  fi
fi
export PATH="$HOME/.local/bin:$PATH"
have claude && record "Claude Code"

# ---------------------------------------------------------
# 5/6  Codex
# ---------------------------------------------------------
step "5/6 安装 Codex"
if have codex; then
  ok "已安装($(codex --version 2>/dev/null | head -n1))"
else
  warn "用官方脚本安装 Codex……"
  if curl -fsSL https://chatgpt.com/codex/install.sh | sh; then
    ok "安装完成"
  elif have brew && brew install --cask codex; then
    ok "安装完成(Homebrew)"
  elif have npm && npm install -g @openai/codex; then
    ok "安装完成(npm)"
  else
    fail "Codex 安装失败,请把上面的红色信息截图发我"
  fi
fi
export PATH="$HOME/.local/bin:$PATH"
have codex && record "Codex"

# ---------------------------------------------------------
# 6/6  铺设「玉兔6工作区」(多智能体目录)
# ---------------------------------------------------------
step "6/6 建立玉兔6工作区"
WORKSPACE="$HOME/玉兔6工作区"
TEMPLATE="$SCRIPT_DIR/workspace-模板"
if [[ -d "$WORKSPACE" ]]; then
  ok "已存在,保持不变:$WORKSPACE"
elif [[ -d "$TEMPLATE" ]]; then
  cp -R "$TEMPLATE" "$WORKSPACE" && ok "已创建:$WORKSPACE"
  # 把设计文档放进工作区,供所有 agent 当蓝图参考
  if [[ -f "$SCRIPT_DIR/docs/多智能体架构设计.md" ]]; then
    cp "$SCRIPT_DIR/docs/多智能体架构设计.md" "$WORKSPACE/shared/reference/" \
      && ok "设计文档已放入 shared/reference/"
  fi
  if have git; then
    ( cd "$WORKSPACE" && git init -q && git add -A \
      && git -c user.name='玉兔6' -c user.email='xiaohai@local' commit -q -m '初始化玉兔6工作区' ) \
      && ok "已用 git 初始化(后续改动可回滚)"
  fi
else
  fail "没找到 workspace-模板 文件夹,跳过(请确认是整个文件夹拷过来的)"
fi
record "玉兔6工作区:$WORKSPACE"

# ---------------------------------------------------------
# 可选 · 代理(v2rayN)
# ---------------------------------------------------------
step "可选 · 代理配置(v2rayN)"
PROXY_DIR="$SCRIPT_DIR/代理"
V2APP="$PROXY_DIR/v2rayN.app"
V2CFG="$PROXY_DIR/v2rayN-config"
if [[ -d "$V2APP" || -d "$V2CFG" ]]; then
  printf "  检测到代理文件。是否启用代理配置(安装 v2rayN + 导入你的节点)?[y/N] "
  read -r ans
  if [[ "$ans" == "y" || "$ans" == "Y" ]]; then
    # 1) 安装 v2rayN.app
    if [[ -d "$V2APP" ]]; then
      mkdir -p "$HOME/Applications"
      rm -rf "$HOME/Applications/v2rayN.app" 2>/dev/null
      cp -R "$V2APP" "$HOME/Applications/" && ok "v2rayN 已装到 ~/Applications"
      xattr -rd com.apple.quarantine "$HOME/Applications/v2rayN.app" 2>/dev/null \
        && ok "已解除 macOS 隔离(可直接双击打开)"
    fi
    # 2) 导入节点配置(macOS 上 v2rayN 配置在这里,不在 app 旁边)
    if [[ -d "$V2CFG" ]]; then
      DEST="$HOME/Library/Application Support/v2rayN"
      mkdir -p "$HOME/Library/Application Support"
      if [[ -d "$DEST" ]]; then
        mv "$DEST" "$DEST.bak.$(date +%s)" 2>/dev/null && warn "原有配置已备份"
      fi
      cp -R "$V2CFG" "$DEST" && ok "节点配置已导入(VLESS / TUIC 等)"
    fi
    ok "代理就位 —— 去启动台打开 v2rayN,右下角开启即可"
    record "代理 v2rayN"
  else
    warn "已跳过代理配置"
  fi
else
  printf "  ${DIM}未放入代理文件(代理/ 为空),跳过。需要时见《使用说明》。${RESET}\n"
fi

# ---------------------------------------------------------
# 可选 · 开发软件(Android Studio + Unity Hub)
# ---------------------------------------------------------
step "可选 · 开发软件(Android Studio / Unity Hub)"
if have brew; then
  printf "  是否自动安装 Android Studio + Unity Hub?(各约几 GB,可能十几分钟)[y/N] "
  read -r ans2
  if [[ "$ans2" == "y" || "$ans2" == "Y" ]]; then
    for app in android-studio unity-hub; do
      if brew list --cask "$app" >/dev/null 2>&1; then
        ok "$app 已安装"
      else
        warn "安装 $app ……"
        brew install --cask "$app" && ok "$app 安装完成" || fail "$app 安装失败(可稍后重跑)"
      fi
    done
    record "Android Studio / Unity Hub"
    printf "  ${DIM}团结引擎(Tuanjie)无 Homebrew 包,请自行到 unity.cn 下载;QQ developer 已跳过。${RESET}\n"
  else
    warn "已跳过开发软件"
  fi
else
  warn "跳过(没有 Homebrew)"
fi

# ---------------------------------------------------------
# 收尾
# ---------------------------------------------------------
printf "\n${BOLD}================ 安装小结 ================${RESET}\n"
for item in "${SUMMARY[@]}"; do printf "  ${GREEN}✓${RESET} %s\n" "$item"; done

printf "\n${BOLD}接下来手动做两件事(各一次,需要联网登录):${RESET}\n"
printf "  1) 在终端输入  ${BOLD}claude${RESET}  回车 → 按提示登录 Anthropic 账号(需付费套餐)。\n"
printf "  2) 在终端输入  ${BOLD}codex${RESET}   回车 → 按提示用 ChatGPT 账号或 API Key 登录。\n"
printf "${DIM}若提示 command not found,关掉终端窗口重开一个再试(PATH 需要重新加载)。${RESET}\n"

printf "\n${GREEN}${BOLD}全部完成 🎉${RESET}\n\n"
printf "${DIM}(按回车键关闭本窗口)${RESET}"
read -r _
