#!/usr/bin/env bash
# 玉兔6 · 统一密钥保险库整理(在 Mac mini 本机跑;全程不回显任何密钥值)
# 把桌面 MacMini-Secrets-PRIVATE-* 搬进统一保险库 ~/.config/yutu6-secrets,
# 加密备份(供上传夸克网盘),校验后再守卫式删除桌面原件。
#
# 分阶段调用(安全顺序,逐步确认):
#   bash consolidate-secrets.sh move                 # ① 建库 700 + 搬入 + chmod 600(不删桌面、不备份)
#   (Codex 此时把飞书配置的 FEISHU_* 合并进 ~/.config/yutu6-secrets/secrets.env,不回显)
#   bash consolidate-secrets.sh backup               # ② tar+AES256 加密 → 出加密包 + sha256
#   (你把加密包上传到夸克网盘)
#   bash consolidate-secrets.sh verify <加密包路径>   # ③ 解密到临时目录核对文件清单,核完即抹除
#   CONFIRM=YES bash consolidate-secrets.sh purge-desktop [额外要删的飞书文件...]  # ④ 删桌面原件
#
# 设计:openssl AES-256-CBC + PBKDF2,口令交互输入(read -s),口令不落盘、不进 git、不回显。
set -euo pipefail

VAULT="$HOME/.config/yutu6-secrets"
DESKTOP="$HOME/Desktop"
STAGE="$HOME"   # 加密包默认产出在家目录,避免落进任何 git 工作区

note(){ printf '   %s\n' "$*"; }

find_desktop_vault(){
  # 返回桌面上的密钥目录(MacMini-Secrets-PRIVATE-*),取最新一个
  ls -d "$DESKTOP"/MacMini-Secrets-PRIVATE-* 2>/dev/null | sort | tail -n1
}

cmd_move(){
  mkdir -p "$VAULT"; chmod 700 "$VAULT"
  local src; src="$(find_desktop_vault || true)"
  if [ -z "${src:-}" ] || [ ! -d "$src" ]; then
    note "✗ 桌面没找到 MacMini-Secrets-PRIVATE-*;若已手动放好保险库可跳过 move"; exit 1
  fi
  note "==> 从 $src 搬入 $VAULT(仅显示文件名,不显示内容)"
  # 用 cp 保留原件,稍后 purge 阶段再删,确保中途出错可回退
  ( cd "$src" && find . -type f -print0 ) | while IFS= read -r -d '' f; do
    mkdir -p "$VAULT/$(dirname "$f")"
    cp -p "$src/$f" "$VAULT/$f"
    note "搬入: $f"
  done
  # 收紧权限:目录 700,文件 600
  find "$VAULT" -type d -exec chmod 700 {} +
  find "$VAULT" -type f -exec chmod 600 {} +
  note "✅ 搬入完成(桌面原件暂留,待 backup+verify 通过后用 purge-desktop 删)。"
  note "下一步:Codex 把飞书 FEISHU_* 合并进 $VAULT/secrets.env(# Source: ~/.hermes/.env 块下),不回显。"
}

cmd_backup(){
  [ -d "$VAULT" ] || { note "✗ 保险库不存在:$VAULT"; exit 1; }
  local out="$STAGE/yutu6-secrets-backup-$(date +%Y%m%d%H%M%S).tar.gz.enc"
  note "==> 加密备份保险库 → $out"
  note "请输入加密口令(不回显;牢记它,夸克网盘的包只有它能解):"
  # openssl 会交互提示口令两次;口令不经过本脚本变量、不落盘
  tar -czf - -C "$(dirname "$VAULT")" "$(basename "$VAULT")" \
    | openssl enc -aes-256-cbc -pbkdf2 -salt -out "$out"
  chmod 600 "$out"
  local sum; sum="$(shasum -a 256 "$out" | awk '{print $1}')"
  note "✅ 加密包已生成:$out"
  note "   sha256: $sum"
  note "下一步:把该加密包上传到夸克网盘;再跑 verify 核对;最后 purge-desktop。"
}

cmd_verify(){
  local pkg="${1:-}"
  [ -f "$pkg" ] || { note "✗ 用法:verify <加密包路径>"; exit 1; }
  local tmp; tmp="$(mktemp -d)"
  note "==> 解密核对 $pkg(临时目录,核完抹除)"
  note "请输入该加密包的口令(不回显):"
  openssl enc -d -aes-256-cbc -pbkdf2 -in "$pkg" | tar -xzf - -C "$tmp"
  note "--- 加密包内文件清单(仅文件名)---"
  ( cd "$tmp" && find . -type f | sort | sed 's/^/   /' )
  note "--- 当前保险库文件清单(仅文件名)---"
  ( cd "$(dirname "$VAULT")" && find "$(basename "$VAULT")" -type f | sort | sed 's/^/   /' )
  # 抹除临时明文
  find "$tmp" -type f -exec rm -P {} + 2>/dev/null || find "$tmp" -type f -delete
  rm -rf "$tmp"
  note "✅ 核对完成,临时明文已抹除。请目视确认两份清单一致。"
}

cmd_purge_desktop(){
  [ "${CONFIRM:-}" = "YES" ] || { note "✗ 安全守卫:确认 backup+verify 都通过、加密包已上传夸克后,用 CONFIRM=YES 再跑。"; exit 1; }
  local src; src="$(find_desktop_vault || true)"
  if [ -n "${src:-}" ] && [ -d "$src" ]; then
    note "==> 删除桌面密钥目录:$src"
    find "$src" -type f -exec rm -P {} + 2>/dev/null || true
    rm -rf "$src"
    note "   ✓ 已删 $src"
  fi
  # 额外的飞书配置文件/目录(Codex 把具体路径作参数传入)
  for p in "$@"; do
    [ -e "$p" ] || continue
    note "==> 删除:$p"
    if [ -f "$p" ]; then rm -P "$p" 2>/dev/null || rm -f "$p"; else rm -rf "$p"; fi
    note "   ✓ 已删 $p"
  done
  note "✅ 桌面原件清理完成。保险库:$VAULT;加密备份在夸克网盘。"
}

case "${1:-}" in
  move)          cmd_move ;;
  backup)        cmd_backup ;;
  verify)        shift; cmd_verify "$@" ;;
  purge-desktop) shift; cmd_purge_desktop "$@" ;;
  *) echo "用法: $0 {move|backup|verify <加密包>|purge-desktop [飞书文件...]}"; exit 1 ;;
esac
