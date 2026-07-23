#!/usr/bin/env bash
# Push every successful local commit to the same branch on the configured remote.
# This script never stages or commits files. pre-commit/pre-push remain the safety gates.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
GIT_DIR="$(git -C "$ROOT" rev-parse --git-dir 2>/dev/null)" || exit 0
case "$GIT_DIR" in
  /*) ;;
  *) GIT_DIR="$ROOT/$GIT_DIR" ;;
esac

enabled="$(git -C "$ROOT" config --bool --get yutu6.autoPush 2>/dev/null || printf 'false')"
[ "$enabled" = "true" ] || exit 0
[ "${YUTU6_AUTO_PUSH_SKIP:-0}" != "1" ] || exit 0

branch="$(git -C "$ROOT" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
[ -n "$branch" ] || exit 0
remote="$(git -C "$ROOT" config --get yutu6.autoPushRemote 2>/dev/null || printf 'github')"
log_file="$GIT_DIR/yutu6-auto-push.log"
lock_dir="$GIT_DIR/yutu6-auto-push.lock"

log() {
  printf '%s\t%s\n' "$(date -u +%FT%TZ)" "$*" >> "$log_file" 2>/dev/null || true
}

if ! git -C "$ROOT" remote get-url "$remote" >/dev/null 2>&1; then
  log "skip missing_remote=$remote branch=$branch"
  printf 'warning: Yutu6 auto-push skipped: remote %s is not configured\n' "$remote" >&2
  exit 0
fi

if ! mkdir "$lock_dir" 2>/dev/null; then
  # A stale lock must not disable future publishing forever.
  if [ -d "$lock_dir" ] && find "$lock_dir" -maxdepth 0 -mmin +10 -print -quit 2>/dev/null | grep -q .; then
    rm -rf "$lock_dir" 2>/dev/null || true
    mkdir "$lock_dir" 2>/dev/null || exit 0
  else
    log "skip busy branch=$branch"
    exit 0
  fi
fi
trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT INT TERM

sha="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || printf unknown)"
if GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes -o ConnectTimeout=10 -o ConnectionAttempts=1}" \
  git -C "$ROOT" push "$remote" "HEAD:refs/heads/$branch"; then
  log "ok remote=$remote branch=$branch sha=$sha"
  printf 'Yutu6 auto-push: %s/%s updated to %s\n' "$remote" "$branch" "$sha" >&2
  exit 0
fi

# A network or non-fast-forward failure must not invalidate the local commit.
log "failed remote=$remote branch=$branch sha=$sha"
printf 'warning: Yutu6 auto-push failed; local commit %s is preserved for retry\n' "$sha" >&2
exit 0
