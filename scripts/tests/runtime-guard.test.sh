#!/usr/bin/env bash
# Deterministic process proof: a lane owns its database until its body and
# cleanup finish. Real dispatch/reset paths, fake CLI mutations, no Docker.
set -euo pipefail
SRC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
WORK="$(cd "$WORK" && pwd -P)"
HOLDER=""
cleanup() {
  touch "$WORK/release" "$WORK/cleanup-release" "$WORK/descendant-release"
  [[ -z "$HOLDER" ]] || { kill -TERM "$HOLDER" 2>/dev/null || true; wait "$HOLDER" 2>/dev/null || true; }
  rm -rf "$WORK"
}
trap cleanup EXIT
fail() { echo "[runtime-guard-test] FAIL: $*" >&2; exit 1; }
await_file() {
  local count=200
  until [[ -f "$1" ]]; do
    (( count-- > 0 )) || fail "did not observe $1"
    sleep 0.05
  done
}
export BOGA_CONFIG_ROOT="$WORK/config" BOGA_LANE_TIMING=0 SUPABASE_CLI_VERSION=99.0.0
export GUARD_EVENTS="$WORK"
mkdir -p "$WORK/bin" "$BOGA_CONFIG_ROOT/worktrees/slots"
export PATH="$WORK/bin:$PATH"
cat >"$WORK/bin/npx" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>"$GUARD_EVENTS/mutations"
EOF
chmod +x "$WORK/bin/npx"
scaffold() {
  local root="$1" slot="$2"
  mkdir -p "$root/scripts" "$root/supabase/scripts" "$root/supabase/tests" "$root/apps/mobile"
  cp "$SRC_ROOT/boga" "$root/"
  for script in worktree-lib.sh lane-timing.sh java-env.sh runtime-guard.sh worktree-release.sh; do
    [[ ! -f "$SRC_ROOT/scripts/$script" ]] || cp "$SRC_ROOT/scripts/$script" "$root/scripts/"
  done
  # Force EXIT cleanup to begin before a forwarded TERM returns, exposing any
  # duplicate TERM instead of depending on the machine's process scheduling.
  if [[ -f "$root/scripts/runtime-guard.sh" ]]; then
    cat >>"$root/scripts/runtime-guard.sh" <<'EOF'
kill() {
  local result=0 polls=200
  builtin kill "$@" || result=$?
  if [[ "${GUARD_DELAY_TERM:-0}" == 1 && "$1" == -TERM && "$result" == 0 ]]; then
    until [[ -f "$GUARD_EVENTS/cleanup" ]]; do
      (( polls-- > 0 )) || return 1
      sleep 0.01
    done
  fi
  return "$result"
}
EOF
  fi
  for script in _common.sh _containers.sh reset-local.sh local-runtime-down.sh run-suite.sh ensure-local-runtime-baseline.sh groups-fixture-reset.sh sync-e2e-fixture-reset.sh; do
    cp "$SRC_ROOT/supabase/scripts/$script" "$root/supabase/scripts/"
  done
  # Avoid proxy/health plumbing; the reset CLI invocation remains real.
  echo 'refresh_edge_proxy_after_reset() { :; }' >>"$root/supabase/scripts/_common.sh"
  cp "$SRC_ROOT/supabase/tests/local-runtime-smoke.sh" "$root/supabase/tests/"
  cp "$SRC_ROOT/supabase/scripts/local-runtime-up.sh" "$root/supabase/scripts/local-runtime-up-real.sh"
  for script in local-runtime-up.sh db-lint-local.sh smoke-health.sh smoke-seed.sh; do
    printf '#!/usr/bin/env bash\nexit 0\n' >"$root/supabase/scripts/$script"
    chmod +x "$root/supabase/scripts/$script"
  done
  echo 'stop_functions_serve_if_running() { :; }' >>"$root/supabase/scripts/_common.sh"
  echo "$slot" >"$root/.worktree-slot"
  printf 'slot=%s\nproject_id=BOGA-fixture-wt%s\npath=%s\n' "$slot" "$slot" "$root" >"$BOGA_CONFIG_ROOT/worktrees/slots/$slot"
  printf 'project_id = "BOGA-fixture-wt%s"\n' "$slot" >"$root/supabase/config.toml"
  printf 'holder\tslow-backend\tsupabase\tno\t.\tbash "$GUARD_EVENTS/hold.sh"\n' >"$root/scripts/lanes.tsv"
  printf 'backend-fast\tfast-backend\tsupabase\tno\t.\t./supabase/scripts/run-suite.sh --no-baseline local-runtime-smoke.sh\n' >>"$root/scripts/lanes.tsv"
  printf 'free\tfast-repo\tnone\tyes\t.\ttouch "$GUARD_EVENTS/free"\n' >>"$root/scripts/lanes.tsv"
  printf 'device-free\tslow-frontend\tios\tno\t.\ttouch "$GUARD_EVENTS/device-free"\n' >>"$root/scripts/lanes.tsv"
  printf 'android-free\tslow-frontend-android\tandroid\tno\t.\ttouch "$GUARD_EVENTS/android-free"\n' >>"$root/scripts/lanes.tsv"
  printf 'failure\tslow-backend\tsupabase\tno\t.\texit 17\n' >>"$root/scripts/lanes.tsv"
  printf 'ios-holder\tslow-frontend\tios+supabase\tno\t.\tbash "$GUARD_EVENTS/hold.sh"\n' >>"$root/scripts/lanes.tsv"
}
ROOT="$WORK/wt7"
scaffold "$ROOT" 7
scaffold "$WORK/wt8" 8
cat >"$WORK/hold.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
teardown() {
  touch "$GUARD_EVENTS/cleanup"
  while [[ ! -f "$GUARD_EVENTS/cleanup-release" ]]; do sleep 0.05; done
  touch "$GUARD_EVENTS/torn-down"
}
trap teardown EXIT
trap 'exit 143' TERM
if [[ "${GUARD_DESCENDANT:-0}" == 1 ]]; then bash "$GUARD_EVENTS/descendant.sh" & fi
touch "$GUARD_EVENTS/ready"
while [[ ! -f "$GUARD_EVENTS/release" ]]; do sleep 0.05; done
EOF
start_holder() {
  rm -f "$WORK/ready" "$WORK/release" "$WORK/cleanup" "$WORK/cleanup-release" "$WORK/torn-down"
  set -m
  "$ROOT/boga" test "${1:-holder}" >"$WORK/holder.log" 2>&1 &
  HOLDER=$!
  set +m
  await_file "$WORK/ready"
}
start_holder
refused() {
  if "$@" >"$WORK/refused.log" 2>&1; then fail "competing command succeeded: $*"; fi
  [[ ! -f "$WORK/mutations" ]] || fail "competing command reached mutation: $*"
  grep -q 'runtime.*busy' "$WORK/refused.log" || fail "no holder diagnostic: $(cat "$WORK/refused.log")"
}
refused "$ROOT/boga" test backend-fast
refused "$ROOT/boga" db reset
refused "$ROOT/supabase/scripts/reset-local.sh"
refused "$ROOT/boga" db down
refused "$ROOT/supabase/scripts/local-runtime-down.sh"
refused "$ROOT/supabase/scripts/local-runtime-up-real.sh"
refused "$ROOT/supabase/scripts/ensure-local-runtime-baseline.sh"
refused "$ROOT/supabase/scripts/groups-fixture-reset.sh"
refused "$ROOT/supabase/scripts/sync-e2e-fixture-reset.sh"
refused "$ROOT/boga" worktree release --force --keep-worktree
[[ -d "$ROOT" && -f "$BOGA_CONFIG_ROOT/worktrees/slots/7" ]] || fail 'busy release removed the checkout or lease'
refused "$ROOT/supabase/scripts/run-suite.sh" --no-baseline local-runtime-smoke.sh
LOCK="$BOGA_CONFIG_ROOT/worktrees/runtime-locks/BOGA-fixture-wt7.lock"
refused env BOGA_RUNTIME_GUARD_PROJECT=BOGA-fixture-wt7 \
  BOGA_RUNTIME_GUARD_OWNER="$(cat "$LOCK/owner.pid")" BOGA_RUNTIME_GUARD_TOKEN="$(cat "$LOCK/token")" \
  "$ROOT/boga" db reset
"$ROOT/boga" test free >/dev/null
"$ROOT/boga" test android-free >/dev/null
[[ -f "$WORK/free" && -f "$WORK/android-free" ]] || fail 'database-free lanes blocked'
if [[ "$(uname -s)" == Darwin ]]; then
  "$ROOT/boga" test device-free >/dev/null
  [[ -f "$WORK/device-free" ]] || fail 'database-free iOS blocked'
fi
"$WORK/wt8/boga" db reset >/dev/null
[[ -f "$WORK/mutations" && ! -f "$WORK/release" ]] || fail 'separate runtime blocked'
rm "$WORK/mutations"
mkdir -p "$ROOT/dev-runtime/supabase"
printf 'project_id = "BOGA-dev-fixture"\n' >"$ROOT/dev-runtime/supabase/config.toml"
BOGA_SUPABASE_WORKDIR="$ROOT/dev-runtime" "$ROOT/supabase/scripts/reset-local.sh" >/dev/null
[[ -f "$WORK/mutations" && -d "$LOCK" ]] || fail 'effective dev workdir shared gate ownership'
rm "$WORK/mutations"
touch "$WORK/release"
await_file "$WORK/cleanup"
refused "$ROOT/boga" db reset
touch "$WORK/cleanup-release"
wait "$HOLDER" || fail "holder failed: $(cat "$WORK/holder.log")"
HOLDER=""
"$ROOT/boga" test backend-fast >"$WORK/nested.log" 2>&1 || fail "nested smoke/reset failed: $(cat "$WORK/nested.log")"
[[ -f "$WORK/mutations" ]] || fail 'reset never ran after release'
rm "$WORK/mutations"

if "$ROOT/boga" test failure >"$WORK/failure.log" 2>&1; then fail 'failing lane passed'; else status=$?; fi
[[ "$status" == 17 && ! -e "$LOCK" ]] || fail 'failure lost its status or ownership leaked'

# TERM only the public command; the supervising shell must stop its whole job.
cat >"$WORK/descendant.sh" <<'EOF'
#!/usr/bin/env bash
teardown() {
  touch "$GUARD_EVENTS/descendant-cleanup"
  while [[ ! -f "$GUARD_EVENTS/descendant-release" ]]; do sleep 0.05; done
  touch "$GUARD_EVENTS/descendant-stopped"
  exit 0
}
trap teardown TERM
touch "$GUARD_EVENTS/descendant-ready"
while :; do sleep 0.05; done
EOF
export GUARD_DESCENDANT=1 GUARD_DELAY_TERM=1
start_holder
await_file "$WORK/descendant-ready"
kill -TERM "$HOLDER"
await_file "$WORK/cleanup"
await_file "$WORK/descendant-cleanup"
touch "$WORK/cleanup-release"
await_file "$WORK/torn-down"
refused "$ROOT/boga" db reset
touch "$WORK/descendant-release"
if wait "$HOLDER"; then fail 'interrupted lane passed'; else status=$?; fi
HOLDER=""
[[ "$status" == 143 && ! -e "$LOCK" && -f "$WORK/descendant-stopped" ]] || fail 'signal released before descendants stopped or lost its status'
unset GUARD_DESCENDANT GUARD_DELAY_TERM

# Exercise the ios+supabase registry arm even on Linux CI, without a device.
mkdir "$WORK/darwin"
printf '#!/usr/bin/env bash\necho Darwin\n' >"$WORK/darwin/uname"
chmod +x "$WORK/darwin/uname"
original_path="$PATH"
export PATH="$WORK/darwin:$PATH"
start_holder ios-holder
refused "$ROOT/boga" db reset
touch "$WORK/release" "$WORK/cleanup-release"
wait "$HOLDER" || fail 'ios+supabase holder failed'
HOLDER=""
export PATH="$original_path"

mkdir "$LOCK"
refused "$ROOT/boga" db reset
[[ -d "$LOCK" ]] || fail 'half-written lock was stolen'
printf '99999999\n' >"$LOCK/owner.pid"
refused "$ROOT/boga" db reset
[[ -d "$LOCK" ]] || fail 'abandoned lock was stolen'
rm -rf "$LOCK"

"$ROOT/boga" db reset >/dev/null
echo '[runtime-guard-test] passed: whole lane, direct paths, nesting, independence, errors, signals and abandoned ownership'
