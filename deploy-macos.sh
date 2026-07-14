#!/usr/bin/env bash
# Safely prepare the yutu6 workspace on a new macOS machine.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_REPO="git@github.com:SongDingQing/yutu6.git"
DEFAULT_REF="main"
MIN_NODE_MAJOR=20

DRY_RUN=0
TARGET=""
REPO="$DEFAULT_REPO"
REF="$DEFAULT_REF"
TARGET_KIND=""
NODE_BIN=""
NODE_PLANNED=0
STAGING_DIR=""
START_CONSOLE=1
OPEN_BROWSER=1

usage() {
  cat <<'EOF'
用法: ./deploy-macos.sh [选项]

在 macOS 上安全部署玉兔6工作区。默认在已有仓库内完成配置；如果脚本在
仓库外运行，则原子克隆到 ~/玉兔6工作区。

选项:
  --target PATH   目标目录（默认: 当前仓库或 ~/玉兔6工作区）
  --repo REPO     克隆来源（默认: GitHub SSH 仓库）
  --ref REF       克隆分支或标签（默认: main）
  --dry-run       只做预检并显示计划，不写文件、不安装软件
  --no-start      只部署文件，不启动本地控制台
  --no-open       启动控制台，但不自动打开浏览器
  -h, --help      显示帮助

安全约束:
  - 不读取、复制或输出 .env、密钥、token、cookie、私钥。
  - 已有目标必须是本仓库的干净工作树；否则立即退出，不覆盖任何内容。
  - 新克隆先落到同级临时目录，校验通过后再原子移动到目标位置。
EOF
}

info() {
  printf '[yutu6-deploy] %s\n' "$*"
}

die() {
  printf '[yutu6-deploy] 错误: %s\n' "$*" >&2
  exit 1
}

need_value() {
  [[ $# -ge 2 && -n "${2:-}" ]] || die "选项 $1 缺少参数"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      need_value "$@"
      TARGET="$2"
      shift 2
      ;;
    --repo)
      need_value "$@"
      REPO="$2"
      shift 2
      ;;
    --ref)
      need_value "$@"
      REF="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --no-start)
      START_CONSOLE=0
      OPEN_BROWSER=0
      shift
      ;;
    --no-open)
      OPEN_BROWSER=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "未知选项（参数值不回显；使用 --help 查看用法）"
      ;;
  esac
done

[[ "$(uname -s)" == "Darwin" ]] || die "仅支持 macOS（检测到: $(uname -s)）"
[[ -n "${HOME:-}" && "$HOME" == /* ]] || die "HOME 必须是有效的绝对路径"
command -v git >/dev/null 2>&1 || die "缺少 Git；请先运行 xcode-select --install，完成后重试"

case "$REPO" in
  http://*@*|https://*@*)
    die "拒绝包含凭据的仓库 URL；请使用 GitHub SSH 或无凭据 URL"
    ;;
esac
case "$REF" in
  ""|-*|*[!A-Za-z0-9._/-]*)
    die "--ref 只能包含字母、数字、点、下划线、斜杠和连字符"
    ;;
esac

workspace_shape_ok() {
  local dir="$1"
  [[ -d "$dir" ]] || return 1
  git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1
  git -C "$dir" ls-files --error-unmatch -- \
    VERSION.json \
    deploy-macos.sh \
    'projects/控制台/start.sh' \
    'projects/控制台/server.js' >/dev/null 2>&1 || return 1
  [[ -f "$dir/VERSION.json" \
    && -f "$dir/deploy-macos.sh" \
    && -f "$dir/projects/控制台/start.sh" \
    && -f "$dir/projects/控制台/server.js" ]]
}

repo_is_dirty() {
  local dir="$1"
  [[ -n "$(git -C "$dir" status --porcelain --untracked-files=normal 2>/dev/null)" ]]
}

dir_is_empty() {
  local dir="$1"
  [[ -d "$dir" && -z "$(find "$dir" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]
}

if [[ -z "$TARGET" ]]; then
  CURRENT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
  if [[ -n "$CURRENT_ROOT" ]] && workspace_shape_ok "$CURRENT_ROOT"; then
    TARGET="$CURRENT_ROOT"
  else
    TARGET="$HOME/玉兔6工作区"
  fi
fi
case "$TARGET" in
  \~)
    TARGET="$HOME"
    ;;
  \~/*)
    TARGET="$HOME/${TARGET#\~/}"
    ;;
esac
if [[ "$TARGET" != /* ]]; then
  TARGET="$PWD/$TARGET"
fi

inspect_target() {
  if [[ ! -e "$TARGET" ]]; then
    TARGET_KIND="missing"
    return
  fi
  [[ -d "$TARGET" ]] || die "目标已存在但不是目录；未做任何改动"
  if dir_is_empty "$TARGET"; then
    TARGET_KIND="empty"
    return
  fi
  workspace_shape_ok "$TARGET" || die "目标是非空目录且不是可识别的玉兔6仓库；拒绝覆盖"
  repo_is_dirty "$TARGET" && die "目标工作树有未提交或未跟踪改动；为避免覆盖已停止（未输出文件名）"
  TARGET_KIND="workspace"
}

ensure_node() {
  local major=""
  if command -v node >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
    major="$("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || true)"
    [[ "$major" =~ ^[0-9]+$ ]] || die "无法读取 Node.js 版本"
    (( major >= MIN_NODE_MAJOR )) || die "Node.js 版本过旧（需要 ${MIN_NODE_MAJOR}+）；请升级后重试"
    info "Node.js 预检通过（主版本 ${major}）"
    return
  fi

  command -v brew >/dev/null 2>&1 || die "缺少 Node.js ${MIN_NODE_MAJOR}+ 且未找到 Homebrew；请先安装其中之一"
  if (( DRY_RUN )); then
    NODE_PLANNED=1
    info "[dry-run] 将通过 Homebrew 安装 Node.js"
    return
  fi

  info "未找到 Node.js，正在通过 Homebrew 安装"
  brew install node
  command -v node >/dev/null 2>&1 || die "Homebrew 已执行，但仍找不到 node；请检查 Homebrew PATH"
  NODE_BIN="$(command -v node)"
  major="$("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || true)"
  [[ "$major" =~ ^[0-9]+$ ]] || die "无法读取安装后的 Node.js 版本"
  (( major >= MIN_NODE_MAJOR )) || die "安装后的 Node.js 仍低于 ${MIN_NODE_MAJOR}"
}

cleanup_staging() {
  if [[ -n "$STAGING_DIR" && -d "$STAGING_DIR" ]]; then
    rm -rf -- "$STAGING_DIR"
  fi
}

clone_workspace() {
  local parent candidate
  parent="$(dirname "$TARGET")"
  mkdir -p -- "$parent"
  STAGING_DIR="$(mktemp -d "$parent/.yutu6-deploy.XXXXXX")"
  candidate="$STAGING_DIR/workspace"
  trap cleanup_staging EXIT HUP INT TERM

  info "正在从 GitHub 克隆到临时目录（仓库地址不回显）"
  if ! GIT_TERMINAL_PROMPT=0 git clone --quiet --single-branch --branch "$REF" "$REPO" "$candidate" \
    >/dev/null 2>&1; then
    die "克隆失败；请确认网络、GitHub SSH 授权和 --ref 后重试"
  fi
  workspace_shape_ok "$candidate" || die "克隆内容不是预期的玉兔6仓库；目标目录保持不变"
  repo_is_dirty "$candidate" && die "新克隆意外出现脏状态；目标目录保持不变"

  if [[ -e "$TARGET" ]]; then
    dir_is_empty "$TARGET" || die "部署期间目标目录被占用；未覆盖现有内容"
    rmdir -- "$TARGET" || die "无法安全移除空目标目录"
  fi
  mv -- "$candidate" "$TARGET"
  rmdir -- "$STAGING_DIR" 2>/dev/null || true
  STAGING_DIR=""
  trap - EXIT HUP INT TERM
}

console_probe() {
  local url="$1"
  "$NODE_BIN" -e '
const url = process.argv[1];
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 1800);
fetch(url + "/api/setup/status", { signal: controller.signal })
  .then(r => { clearTimeout(timer); process.exit(r.ok ? 0 : 1); })
  .catch(() => { clearTimeout(timer); process.exit(1); });
' "$url" >/dev/null 2>&1
}

start_console() {
  local private_dir log_file pid_file port url pid ready=0
  private_dir="${YUTU6_CONFIG_DIR:-$HOME/.config/yutu6}"
  mkdir -p -- "$private_dir"
  chmod 700 "$private_dir"
  log_file="$private_dir/console.log"
  pid_file="$private_dir/console.pid"
  port="$("$NODE_BIN" -e 'const c=require(process.argv[1]);process.stdout.write(String(c.port||41218))' "$TARGET/projects/控制台/config.json")"
  url="http://127.0.0.1:$port"

  if console_probe "$url"; then
    info "控制台已在运行: $url"
  else
    info "正在启动本地控制台"
    nohup env PORT="$port" YUTU6_CONFIG_DIR="$private_dir" \
      "$NODE_BIN" "$TARGET/projects/控制台/server.js" >>"$log_file" 2>&1 &
    pid=$!
    printf '%s\n' "$pid" > "$pid_file"
    chmod 600 "$pid_file" "$log_file" 2>/dev/null || true
    for _ in {1..45}; do
      if console_probe "$url"; then ready=1; break; fi
      if ! kill -0 "$pid" 2>/dev/null; then break; fi
      sleep 1
    done
    if (( ready == 0 )); then
      if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null || true; fi
      die "控制台未在 45 秒内就绪；请查看 $log_file"
    fi
    info "控制台已就绪: $url"
  fi

  if (( OPEN_BROWSER )) && command -v open >/dev/null 2>&1; then
    open "$url/setup" >/dev/null 2>&1 || true
    info "已打开首次配置向导"
  else
    info "首次配置向导: $url/setup"
  fi
}

inspect_target
ensure_node

info "目标: $TARGET"
if (( DRY_RUN )); then
  case "$TARGET_KIND" in
    workspace)
      info "[dry-run] 已有干净工作区；将保留全部文件并配置本地 Git hooks"
      ;;
    missing|empty)
      info "[dry-run] 将所选版本克隆到同级临时目录，校验后原子移动到目标"
      ;;
  esac
  if (( NODE_PLANNED == 0 )); then
    "$NODE_BIN" --check "$SCRIPT_DIR/projects/控制台/server.js" >/dev/null 2>&1 || \
      info "[dry-run] 当前脚本不在完整工作区内，部署后再做 server.js 语法检查"
  fi
  if (( START_CONSOLE )); then
    info "[dry-run] 部署后将启动本地控制台并打开首次配置向导"
  fi
  info "dry-run 完成：没有写文件、安装软件或修改 Git 配置"
  exit 0
fi

case "$TARGET_KIND" in
  missing|empty)
    clone_workspace
    ;;
  workspace)
    info "检测到干净的现有工作区；安全重复执行，不拉取、不覆盖"
    ;;
esac

git -C "$TARGET" config --local core.hooksPath .githooks
"$NODE_BIN" --check "$TARGET/projects/控制台/server.js" >/dev/null

info "部署完成；仓库工作树保持干净，本地 Git hooks 已启用"
if (( START_CONSOLE )); then
  start_console
else
  printf '[yutu6-deploy] 启动控制台: cd %q && bash %q\n' \
    "$TARGET" "projects/控制台/start.sh"
fi
