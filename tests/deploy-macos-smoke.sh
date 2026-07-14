#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/yutu6-deploy-smoke.XXXXXX")"

cleanup() {
  rm -rf -- "$TMP_ROOT"
}
trap cleanup EXIT HUP INT TERM

fail() {
  printf '[deploy-smoke] FAIL: %s\n' "$*" >&2
  exit 1
}

SOURCE="$TMP_ROOT/source"
BARE="$TMP_ROOT/source.git"
FAKE_HOME="$TMP_ROOT/home"
TARGET="$FAKE_HOME/玉兔6工作区"
DRY_TARGET="$FAKE_HOME/dry-run-target"
mkdir -p "$SOURCE/projects/控制台" "$SOURCE/.githooks" "$FAKE_HOME"

cp "$ROOT/deploy-macos.sh" "$SOURCE/deploy-macos.sh"
chmod +x "$SOURCE/deploy-macos.sh"
printf '{"version":"0.0.0.0"}\n' > "$SOURCE/VERSION.json"
printf '#!/usr/bin/env bash\nexec node server.js\n' > "$SOURCE/projects/控制台/start.sh"
printf "'use strict';\nrequire('node:http');\n" > "$SOURCE/projects/控制台/server.js"
printf '#!/usr/bin/env bash\nexit 0\n' > "$SOURCE/.githooks/pre-commit"
chmod +x "$SOURCE/projects/控制台/start.sh" "$SOURCE/.githooks/pre-commit"

git -C "$SOURCE" init -q -b main
git -C "$SOURCE" add -- \
  deploy-macos.sh VERSION.json .githooks/pre-commit \
  'projects/控制台/start.sh' 'projects/控制台/server.js'
git -C "$SOURCE" -c user.name='deploy-smoke' -c user.email='deploy-smoke@invalid' \
  commit -q -m 'fixture'
git clone -q --bare "$SOURCE" "$BARE"

HOME="$FAKE_HOME" "$ROOT/deploy-macos.sh" \
  --dry-run --target "$DRY_TARGET" --repo "$BARE" --ref main \
  > "$TMP_ROOT/dry-run.log"
[[ ! -e "$DRY_TARGET" ]] || fail "dry-run 创建了目标目录"
grep -q '没有写文件' "$TMP_ROOT/dry-run.log" || fail "dry-run 缺少无写入回执"

HOME="$FAKE_HOME" "$ROOT/deploy-macos.sh" \
  --no-start --target "$TARGET" --repo "$BARE" --ref main \
  > "$TMP_ROOT/first-run.log"
[[ -x "$TARGET/deploy-macos.sh" ]] || fail "部署入口不可执行"
[[ -z "$(git -C "$TARGET" status --porcelain --untracked-files=normal)" ]] || \
  fail "首次部署后工作树不干净"
[[ "$(git -C "$TARGET" config --local --get core.hooksPath)" == '.githooks' ]] || \
  fail "Git hooks 未配置"

HOME="$FAKE_HOME" "$TARGET/deploy-macos.sh" --no-start --target "$TARGET" \
  > "$TMP_ROOT/second-run.log"
grep -q '安全重复执行' "$TMP_ROOT/second-run.log" || fail "重复执行未走安全分支"

printf 'must survive\n' > "$TARGET/local-only.txt"
BEFORE_HASH="$(shasum -a 256 "$TARGET/local-only.txt" | awk '{print $1}')"
if HOME="$FAKE_HOME" "$TARGET/deploy-macos.sh" --no-start --target "$TARGET" \
  > "$TMP_ROOT/dirty-run.log" 2>&1; then
  fail "脏工作树未被拒绝"
fi
AFTER_HASH="$(shasum -a 256 "$TARGET/local-only.txt" | awk '{print $1}')"
[[ "$BEFORE_HASH" == "$AFTER_HASH" ]] || fail "脏目录文件被改写"
grep -q '未提交或未跟踪改动' "$TMP_ROOT/dirty-run.log" || fail "脏目录失败提示不明确"

OCCUPIED="$TMP_ROOT/occupied"
mkdir -p "$OCCUPIED"
printf 'keep\n' > "$OCCUPIED/sentinel.txt"
if HOME="$FAKE_HOME" "$ROOT/deploy-macos.sh" \
  --no-start --target "$OCCUPIED" --repo "$BARE" --ref main \
  > "$TMP_ROOT/occupied-run.log" 2>&1; then
  fail "非仓库目录未被拒绝"
fi
[[ "$(<"$OCCUPIED/sentinel.txt")" == 'keep' ]] || fail "非仓库目录内容被改写"
grep -q '拒绝覆盖' "$TMP_ROOT/occupied-run.log" || fail "占用目录失败提示不明确"

printf '[deploy-smoke] PASS: dry-run 无写入\n'
printf '[deploy-smoke] PASS: 临时 HOME 首次部署与可执行位\n'
printf '[deploy-smoke] PASS: 干净工作区安全重复执行\n'
printf '[deploy-smoke] PASS: 脏工作树与非仓库目录拒绝覆盖\n'
