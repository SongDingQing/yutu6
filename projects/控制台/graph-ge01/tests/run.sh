#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../../../.." && pwd)
GE="$ROOT/projects/控制台/graph-ge01"
BIN="$GE/build/yutu-graph"
FLOW="$ROOT/shared/routing/flows/review-loop.yaml"
SNAPSHOT="$GE/snapshots/project-route-20260716T092650889Z.json"
FROZEN_EVENTS="$ROOT/projects/控制台/artifacts/engine-events.2026-07-16-0926-50889.jsonl"
ARTIFACT_REL="projects/控制台/artifacts/graph-ge01-cr-1784715913317-d7f047c7"
TEST_TMP=$(mktemp -d /tmp/yutu-ge01-tests.XXXXXX)
LOG_TMP_REL=$(cd "$ROOT" && mktemp -d "$ARTIFACT_REL/shadow-logs-test.XXXXXX")
LOG_TMP="$ROOT/$LOG_TMP_REL"
COUNT=0

cleanup() {
  rm -rf -- "$TEST_TMP" "$LOG_TMP"
}
trap cleanup EXIT INT TERM

pass() {
  COUNT=$((COUNT + 1))
  printf 'ok %02d - %s\n' "$COUNT" "$1"
}

expect_fail_code() {
  label=$1
  code=$2
  shift 2
  if "$@" >"$TEST_TMP/fail.out" 2>"$TEST_TMP/fail.err"; then
    printf 'not ok - %s unexpectedly succeeded\n' "$label" >&2
    exit 1
  fi
  if ! grep -q "\"error_code\":\"$code\"\|^$code:" "$TEST_TMP/fail.out" "$TEST_TMP/fail.err"; then
    printf 'not ok - %s did not return %s\n' "$label" "$code" >&2
    sed -n '1,4p' "$TEST_TMP/fail.out" "$TEST_TMP/fail.err" >&2
    exit 1
  fi
  pass "$label -> $code"
}

"$BIN" compile "$FLOW" "$TEST_TMP/manifest-a.json" >"$TEST_TMP/compile-a.out"
"$BIN" compile "$FLOW" "$TEST_TMP/manifest-b.json" >"$TEST_TMP/compile-b.out"
cmp "$TEST_TMP/manifest-a.json" "$TEST_TMP/manifest-b.json"
cmp "$TEST_TMP/manifest-a.json" "$GE/golden/review-loop.manifest.json"
pass 'review-loop canonical manifest is byte-stable and equals locked golden'

"$BIN" validate "$GE/golden/review-loop.manifest.json" >"$TEST_TMP/validate.out"
grep -q '"ok":true' "$TEST_TMP/validate.out"
pass 'validator accepts the legal yutu-graph@1 fixture'

sed 's/}$/,"unexpectedRootField":true}/' "$GE/golden/review-loop.manifest.json" >"$TEST_TMP/extra-root.json"
sed 's/"timeoutMs":0}/"timeoutMs":0,"unexpectedNodeField":true}/' "$GE/golden/review-loop.manifest.json" >"$TEST_TMP/extra-node.json"
sed 's/"delivery":"single"}/"delivery":"single","unexpectedEdgeField":true}/' "$GE/golden/review-loop.manifest.json" >"$TEST_TMP/extra-edge.json"
sed 's/"maxMemoryBytes":8388608}/"maxMemoryBytes":8388608,"unexpectedBudgetField":true}/' "$GE/golden/review-loop.manifest.json" >"$TEST_TMP/extra-budget.json"
sed 's/"unsupportedRuntimeTypes":\["fanout","join","subgraph"\]}/"unsupportedRuntimeTypes":["fanout","join","subgraph"],"unexpectedPolicyField":true}/' "$GE/golden/review-loop.manifest.json" >"$TEST_TMP/extra-policy.json"
for scope in root node edge budget policy
do
  expect_fail_code "validator enforces additionalProperties=false for $scope" schema_additional_property \
    "$BIN" validate "$TEST_TMP/extra-$scope.json"
done

sed 's/"projectId":"控制台",//' "$GE/golden/review-loop.manifest.json" >"$TEST_TMP/missing-required.json"
expect_fail_code 'validator enforces required root fields' missing_required_field \
  "$BIN" validate "$TEST_TMP/missing-required.json"
sed 's/"timeoutMs":0/"timeoutMs":"0"/' "$GE/golden/review-loop.manifest.json" >"$TEST_TMP/wrong-type.json"
expect_fail_code 'validator enforces schema value types' schema_type_mismatch \
  "$BIN" validate "$TEST_TMP/wrong-type.json"
sed 's/"graphVersion":"1.0.0"/"graphVersion":"1.0"/' "$GE/golden/review-loop.manifest.json" >"$TEST_TMP/bad-pattern.json"
expect_fail_code 'validator enforces schema patterns and ranges' schema_constraint_violation \
  "$BIN" validate "$TEST_TMP/bad-pattern.json"
sed 's/"unsupportedRuntimeTypes":\["fanout","join","subgraph"\]/"unsupportedRuntimeTypes":["join","fanout","subgraph"]/' "$GE/golden/review-loop.manifest.json" >"$TEST_TMP/bad-const.json"
expect_fail_code 'validator enforces schema const arrays' schema_constraint_violation \
  "$BIN" validate "$TEST_TMP/bad-const.json"
sed 's/"graphId":"review-loop"/"graphId":"review-loop","graphId":"review-loop"/' "$GE/golden/review-loop.manifest.json" >"$TEST_TMP/duplicate-property.json"
expect_fail_code 'validator rejects duplicate contract properties' schema_duplicate_property \
  "$BIN" validate "$TEST_TMP/duplicate-property.json"

"$BIN" compile "$GE/fixtures/valid/agent-tool-human-end.yaml" "$TEST_TMP/node-vocabulary.json" >"$TEST_TMP/node-vocabulary.out"
"$BIN" validate "$TEST_TMP/node-vocabulary.json" >"$TEST_TMP/node-vocabulary-validate.out"
grep -q '"ok":true' "$TEST_TMP/node-vocabulary-validate.out"
pass 'agent/tool/human_gate/end node vocabulary compiles and validates'

for pair in \
  'duplicate-node.yaml duplicate_node' \
  'dangling-edge.yaml dangling_edge' \
  'unreachable-node.yaml unreachable_node' \
  'no-terminal.yaml missing_terminal' \
  'illegal-condition.yaml invalid_condition' \
  'unknown-node-type.yaml unknown_node_type' \
  'unsupported-fanout.yaml unsupported_in_ge01' \
  'unsupported-join.yaml unsupported_in_ge01' \
  'unsupported-subgraph.yaml unsupported_in_ge01'
do
  set -- $pair
  expect_fail_code "invalid fixture $1" "$2" "$BIN" compile "$GE/fixtures/invalid/$1" "$TEST_TMP/invalid.json"
done

expect_fail_code 'validator rejects an illegal manifest deterministically' unknown_node_type \
  "$BIN" validate "$GE/fixtures/invalid/unknown-node-type.manifest.json"

"$BIN" review-loop "$GE/fixtures/review-revisions" "$TEST_TMP/review-a.json"
"$BIN" review-loop "$GE/fixtures/review-revisions" "$TEST_TMP/review-b.json"
cmp "$TEST_TMP/review-a.json" "$TEST_TMP/review-b.json"
grep -q '"trigger":"filesystem_poll_500ms"' "$TEST_TMP/review-a.json"
grep -q '"external_agent_required":false' "$TEST_TMP/review-a.json"
grep -q '"human_gate_required":false' "$TEST_TMP/review-a.json"
grep -q '"iteration_count":2' "$TEST_TMP/review-a.json"
test "$(grep -o '"manifest_hash":"[0-9a-f]*"' "$TEST_TMP/review-a.json" | sort -u | wc -l | tr -d ' ')" = 2
pass 'offline review-loop recompiles a review change deterministically without agent/human gate'

mkdir "$TEST_TMP/delayed-review"
cp "$GE/fixtures/review-revisions/000-initial.yaml" "$TEST_TMP/delayed-review/000-initial.yaml"
"$BIN" review-loop "$TEST_TMP/delayed-review" "$TEST_TMP/delayed-review.json" >"$TEST_TMP/delayed-review.out" 2>"$TEST_TMP/delayed-review.err" &
review_pid=$!
sleep 1
cp "$GE/fixtures/review-revisions/001-review-change.yaml" "$TEST_TMP/delayed-review/001-review-change.yaml"
cp "$GE/fixtures/review-revisions/DONE" "$TEST_TMP/delayed-review/DONE"
wait "$review_pid"
grep -q '"iteration_count":2' "$TEST_TMP/delayed-review.json"
pass '500ms filesystem polling observes a later immutable review revision'

mkdir "$TEST_TMP/late-earlier-review"
cp "$GE/fixtures/review-revisions/001-review-change.yaml" "$TEST_TMP/late-earlier-review/100-late.yaml"
"$BIN" review-loop "$TEST_TMP/late-earlier-review" "$TEST_TMP/late-earlier-review.json" >"$TEST_TMP/late-earlier-review.out" 2>"$TEST_TMP/late-earlier-review.err" &
review_pid=$!
sleep 1
cp "$GE/fixtures/review-revisions/000-initial.yaml" "$TEST_TMP/late-earlier-review/000-earlier.yaml"
cp "$GE/fixtures/review-revisions/DONE" "$TEST_TMP/late-earlier-review/DONE"
wait "$review_pid"
grep -q '"iteration_count":2' "$TEST_TMP/late-earlier-review.json"
grep -q '"file":"000-earlier.yaml".*"file":"100-late.yaml"' "$TEST_TMP/late-earlier-review.json"
test "$(grep -o '"file":"100-late.yaml"' "$TEST_TMP/late-earlier-review.json" | wc -l | tr -d ' ')" = 1
test "$(grep -o '"manifest_hash":"[0-9a-f]*"' "$TEST_TMP/late-earlier-review.json" | sort -u | wc -l | tr -d ' ')" = 2
pass 'late lexicographically earlier revision is compiled exactly once and receipt stays sorted'

mkdir "$TEST_TMP/mutated-review"
cp "$GE/fixtures/review-revisions/000-initial.yaml" "$TEST_TMP/mutated-review/000.yaml"
"$BIN" review-loop "$TEST_TMP/mutated-review" "$TEST_TMP/mutated-review.json" >"$TEST_TMP/mutated-review.out" 2>"$TEST_TMP/mutated-review.err" &
review_pid=$!
sleep 1
cp "$GE/fixtures/review-revisions/001-review-change.yaml" "$TEST_TMP/mutated-review/000.yaml"
cp "$GE/fixtures/review-revisions/DONE" "$TEST_TMP/mutated-review/DONE"
if wait "$review_pid"; then
  printf 'not ok - mutated immutable revision unexpectedly succeeded\n' >&2
  exit 1
fi
grep -q '"error_code":"revision_mutated"' "$TEST_TMP/mutated-review.json"
pass 'review-loop fails closed when a compiled immutable revision changes'

mkdir "$TEST_TMP/removed-review"
cp "$GE/fixtures/review-revisions/000-initial.yaml" "$TEST_TMP/removed-review/000.yaml"
"$BIN" review-loop "$TEST_TMP/removed-review" "$TEST_TMP/removed-review.json" >"$TEST_TMP/removed-review.out" 2>"$TEST_TMP/removed-review.err" &
review_pid=$!
sleep 1
rm -f -- "$TEST_TMP/removed-review/000.yaml"
cp "$GE/fixtures/review-revisions/DONE" "$TEST_TMP/removed-review/DONE"
if wait "$review_pid"; then
  printf 'not ok - removed immutable revision unexpectedly succeeded\n' >&2
  exit 1
fi
grep -q '"error_code":"revision_removed"' "$TEST_TMP/removed-review.json"
pass 'review-loop fails closed when a compiled immutable revision disappears'

mkdir "$TEST_TMP/too-many"
cp "$GE/fixtures/review-revisions/000-initial.yaml" "$TEST_TMP/too-many/000.yaml"
cp "$GE/fixtures/review-revisions/000-initial.yaml" "$TEST_TMP/too-many/001.yaml"
cp "$GE/fixtures/review-revisions/000-initial.yaml" "$TEST_TMP/too-many/002.yaml"
cp "$GE/fixtures/review-revisions/000-initial.yaml" "$TEST_TMP/too-many/003.yaml"
cp "$GE/fixtures/review-revisions/DONE" "$TEST_TMP/too-many/DONE"
expect_fail_code 'review-loop enforces max iterations' max_iterations_exceeded \
  "$BIN" review-loop "$TEST_TMP/too-many" "$TEST_TMP/too-many-receipt.json"

mkdir "$TEST_TMP/no-done"
cp "$GE/fixtures/review-revisions/000-initial.yaml" "$TEST_TMP/no-done/000.yaml"
expect_fail_code 'review-loop enforces wall timeout' review_timeout \
  "$BIN" review-loop "$TEST_TMP/no-done" "$TEST_TMP/timeout-receipt.json"

dd if=/dev/zero of="$TEST_TMP/oversized.yaml" bs=1048577 count=1 >/dev/null 2>&1
expect_fail_code 'oversized abnormal input terminates at the input bound' input_too_large \
  "$BIN" compile "$TEST_TMP/oversized.yaml" "$TEST_TMP/oversized.json"

peak=$(sed -n 's/.*"tracked_peak_bytes":\([0-9][0-9]*\).*/\1/p' "$TEST_TMP/review-a.json")
test -n "$peak"
test "$peak" -le 8388608
pass 'review-loop measured tracked memory stays under the declared 8MiB bound'

chmod a-w "$SNAPSHOT"
snapshot_before=$(shasum -a 256 "$SNAPSHOT" | awk '{print $1}')
snapshot_stat_before=$(stat -f '%z:%m:%p' "$SNAPSHOT")
events_before=$(shasum -a 256 "$FROZEN_EVENTS" | awk '{print $1}')
events_stat_before=$(stat -f '%z:%m:%p' "$FROZEN_EVENTS")
test_workdir=$PWD
cd "$ROOT"
"$BIN" shadow "${SNAPSHOT#$ROOT/}" "${LOG_TMP#$ROOT/}" >"$TEST_TMP/shadow.out"
cd "$test_workdir"
grep -q '"temporary_data_cleaned":true' "$TEST_TMP/shadow.out"
shadow_pid=$(sed -n 's|.*shadow-logs-test[^/]*/[^-]*-\([0-9][0-9]*\)/report.json.*|\1|p' "$TEST_TMP/shadow.out")
test -n "$shadow_pid"
for shadow_temp in "${TMPDIR:-/tmp}/yutu-shadow-$shadow_pid-"*
do
  if test -e "$shadow_temp"; then
    printf 'not ok - shadow temporary namespace was not cleaned\n' >&2
    exit 1
  fi
done
set -- "$LOG_TMP"/*/report.json
report=$1
test -f "$report"
cmp "$report" "$GE/golden/project-route-shadow.report.json"
snapshot_after=$(shasum -a 256 "$SNAPSHOT" | awk '{print $1}')
snapshot_stat_after=$(stat -f '%z:%m:%p' "$SNAPSHOT")
events_after=$(shasum -a 256 "$FROZEN_EVENTS" | awk '{print $1}')
events_stat_after=$(stat -f '%z:%m:%p' "$FROZEN_EVENTS")
test "$snapshot_before" = "$snapshot_after"
test "$snapshot_stat_before" = "$snapshot_stat_after"
test "$events_before" = "$events_after"
test "$events_stat_before" = "$events_stat_after"
pass 'versioned real project-route shadow equals golden and source/snapshot remain unchanged'

expect_fail_code 'shadow write barrier rejects an untrusted output root' write_barrier_violation \
  "$BIN" shadow "$SNAPSHOT" /tmp/not-an-isolated-shadow-log

"$BIN" bench "$FLOW" 1001 >"$TEST_TMP/bench.json"
bench_peak=$(sed -n 's/.*"tracked_peak_bytes":\([0-9][0-9]*\).*/\1/p' "$TEST_TMP/bench.json")
test -n "$bench_peak"
test "$bench_peak" -le 8388608
pass 'in-process compiler benchmark completes inside the memory budget'

otool -L "$BIN" >"$TEST_TMP/otool.txt"
grep -q '/usr/lib/libSystem.B.dylib' "$TEST_TMP/otool.txt"
if grep -Eiq 'node|python|langgraph|temporal|adk' "$TEST_TMP/otool.txt"; then
  printf 'not ok - forbidden runtime linkage detected\n' >&2
  exit 1
fi
pass 'compiled validator/compiler links only the system C library'

if rg -n 'graph-ge01|yutu-graph@1' \
  "$ROOT/projects/控制台/ceo-worker.js" \
  "$ROOT/projects/控制台/engine-runner.js" \
  "$ROOT/projects/控制台/server.js" \
  "$ROOT/projects/控制台/config.json" \
  "$ROOT/projects/控制台/public" >"$TEST_TMP/production-reference.txt"; then
  printf 'not ok - GE-01 unexpectedly wired into production files\n' >&2
  sed -n '1,20p' "$TEST_TMP/production-reference.txt" >&2
  exit 1
fi
pass 'production queue/runner/gates/UI contain no GE-01 runtime reference'

printf 'PASS %d GE-01 checks\n' "$COUNT"
