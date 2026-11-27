#!/bin/sh
# Run all headless JS test suites using macOS's built-in JavaScriptCore.
# No Node dependency. Usage: sh tests/run.sh
#
# Each suite is concatenated from stubs + the real source files + asserts,
# then executed with jsc. Worker source runs in script mode by rewriting
# `export default {` -> `const worker = {`.
set -e
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
[ -x "$JSC" ] || { echo "JavaScriptCore not found (macOS only)"; exit 1; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAIL=0

run() { # name, then files to concatenate in order
  name="$1"; shift
  cat "$@" > "$TMP/t.js"
  out="$("$JSC" "$TMP/t.js" 2>&1)" || true
  if echo "$out" | grep -qE "FAIL|Exception|ERROR|ERR "; then
    echo "✗ $name"; echo "$out" | grep -E "FAIL|Exception|ERROR|ERR " | head -5; FAIL=1
  else
    n=$(echo "$out" | grep -cE "^PASS")
    echo "✓ $name ($n assertions)"
  fi
}

W="$TMP/worker.js"
sed 's/^export default {$/const worker = {/' "$ROOT/worker/survey-worker.js" > "$W"
RL="$TMP/results-lib.js"
sed 's/^main();$//' "$ROOT/docs/assets/results.js" > "$RL"

# --- worker suites ---
for s in core edit popularity popularity-correct count; do
  run "worker/$s" "$ROOT/tests/worker/harness.js" "$W" "$ROOT/tests/worker/suite-$s.js"
done

# --- frontend suites ---
D="$ROOT/docs/assets"
F="$ROOT/tests/frontend"
run "frontend/tz"        "$F/tz-el-stub.js" "$D/tz.js" "$F/suite-tz.js"
run "frontend/zonelist"  "$F/tz-stub.js" "$D/tz.js" "$F/suite-zonelist.js"
run "frontend/grid"      "$F/dom-stub.js" "$D/tz.js" "$D/timegrid.js" "$D/respond-grid.js" "$F/suite-grid.js"
run "frontend/shading"   "$F/dom-stub.js" "$D/tz.js" "$D/timegrid.js" "$D/respond-grid.js" "$F/suite-shading.js"
run "frontend/restore"   "$F/dom-stub.js" "$D/tz.js" "$D/timegrid.js" "$D/respond-grid.js" "$F/suite-restore.js"
run "frontend/view"      "$F/dom-stub.js" "$D/tz.js" "$D/timegrid.js" "$D/respond-grid.js" "$D/render.js" "$F/suite-view.js"
run "frontend/updates"   "$F/dom-stub.js" "$D/tz.js" "$D/timegrid.js" "$D/respond-grid.js" "$D/render.js" "$F/suite-updates.js"
run "frontend/charts"    "$F/dom-stub.js" "$D/charts.js" "$F/suite-charts.js"
run "frontend/results"   "$F/dom-stub.js" "$D/tz.js" "$D/timegrid.js" "$D/respond-grid.js" "$D/charts.js" "$F/suite-results.js" "$RL"
run "frontend/names"     "$F/dom-stub.js" "$D/tz.js" "$D/timegrid.js" "$D/respond-grid.js" "$D/charts.js" "$F/suite-names.js" "$RL"
run "frontend/newtypes"  "$F/dom-stub.js" "$D/charts.js" "$D/render.js" "$F/suite-newtypes.js" "$RL"
run "frontend/poll"      "$F/poll-stubs.js" "$F/suite-poll.js"
run "frontend/rpoll"     "$F/rpoll-stubs.js" "$F/suite-rpoll.js"

[ "$FAIL" = 0 ] && echo "ALL SUITES PASSED" || { echo "SOME SUITES FAILED"; exit 1; }