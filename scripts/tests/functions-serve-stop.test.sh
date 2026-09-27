#!/usr/bin/env bash
#
# functions-serve-stop.test.sh — no `supabase functions serve` process for a
# slot survives local-runtime-down.sh, and local-runtime-up.sh sweeps orphans an
# earlier run left behind (boga_functions_serve_* in scripts/worktree-lib.sh).
#
# Runs the real up/down scripts in a temp worktree with a temp slot lease. A stub
# `npx` rebuilds the real process tree — npm wrapper -> node shim -> CLI ->
# `docker logs -f` in its own process group — and, like `npm exec`, does not
# forward SIGTERM, so killing only the wrapper orphans the rest (the old bug).
# A second worktree's server must survive every stop.
#
# Infra-free (stub npx / curl; no Docker, no network). Part of the `meta-tests`
# lane and CI.

set -euo pipefail

THIS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SRC_ROOT="$(cd -- "$THIS_DIR/../.." && pwd)"

PASS=0
FAIL=0
pass() { echo "  [pass] $*"; PASS=$((PASS + 1)); }
fail() { echo "  [FAIL] $*" >&2; FAIL=$((FAIL + 1)); }

WORK="$(mktemp -d)"
WORK="$(cd "$WORK" && pwd -P)"
STUB_BIN="$WORK/bin"
ROOT="$WORK/wt"          # the worktree under test (slot 7)
OTHER="$WORK/other"      # another worktree's server, which must be left alone

# All stub processes carry $STUB_BIN in argv; kill whatever is left on any exit.
cleanup() {
  local pids
  pids="$(ps -e -o pid= -o args= | BIN="$STUB_BIN/" awk 'index($0, ENVIRON["BIN"]) { print $1 }')"
  [[ -z "$pids" ]] || kill -KILL $pids 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# ---------- stubs ----------
mkdir -p "$STUB_BIN"
export PATH="$STUB_BIN:$PATH"

# The npx cache, laid out like the real one: argv of each layer matches production.
SHIM="$STUB_BIN/_npx/node_modules/.bin/supabase"
CLI="$STUB_BIN/_npx/node_modules/@supabase/cli-stub/bin/supabase"
mkdir -p "$(dirname "$SHIM")" "$(dirname "$CLI")"

# npx -y supabase@<v> <args>: `functions serve` runs the shim as a foreground
# child (no signal forwarding, like npm exec); `status -o env` prints the env
# local-runtime-up.sh reads; everything else (start, stop) is a no-op.
cat >"$STUB_BIN/npx" <<EOF
#!/usr/bin/env bash
shift 2
case "\$1 \${2:-}" in
  "functions serve") "$SHIM" "\$@" ;;
  "status -o") printf 'API_URL="http://127.0.0.1:9"\\nANON_KEY="stub-anon"\\n' ;;
esac
EOF
cat >"$SHIM" <<EOF
#!/usr/bin/env bash
"$CLI" "\$@"
EOF
# The CLI tails its edge-runtime container with `docker logs -f` in a separate
# process group, named after the worktree dir so each tree is identifiable.
cat >"$CLI" <<EOF
#!/usr/bin/env bash
perl -e 'setpgrp; exec @ARGV' "$STUB_BIN/docker" logs -f --timestamps "supabase_edge_runtime_\$(basename "\$PWD")" &
while :; do sleep 1; done
EOF
cat >"$STUB_BIN/docker" <<'EOF'
#!/usr/bin/env bash
while :; do sleep 1; done
EOF
printf '#!/usr/bin/env bash\nexit 0\n' >"$STUB_BIN/curl"
chmod +x "$STUB_BIN"/* "$SHIM" "$CLI"

# ---------- scaffold: a leased worktree holding the real runtime scripts ----------
mkdir -p "$ROOT/scripts" "$ROOT/supabase/scripts" "$ROOT/supabase/functions" "$ROOT/apps/mobile" "$OTHER"
cp "$SRC_ROOT/scripts/worktree-lib.sh" "$ROOT/scripts/"
for f in _common.sh _containers.sh local-runtime-up.sh local-runtime-down.sh; do
  cp "$SRC_ROOT/supabase/scripts/$f" "$ROOT/supabase/scripts/"
done
: >"$ROOT/supabase/config.toml"
: >"$ROOT/supabase/functions/.env.local"
echo 7 >"$ROOT/.worktree-slot"
export BOGA_CONFIG_ROOT="$WORK/config"
mkdir -p "$BOGA_CONFIG_ROOT/worktrees/slots"
printf 'slot=7\nproject_id=BOGA-wt-wt7\npath=%s\n' "$ROOT" >"$BOGA_CONFIG_ROOT/worktrees/slots/7"
export SUPABASE_CLI_VERSION=99.0.0
export BOGA_FUNCTIONS_SERVE_STOP_SECONDS=5

# serve_pids <dir>: PIDs of the stub server tree launched from <dir>, found
# independently of the code under test (by argv, not by cwd). The patterns go
# through the environment so this awk's own argv never matches them.
serve_pids() {
  ps -e -o pid= -o args= | BIN="$STUB_BIN/" DIR="$1/" TAIL="supabase_edge_runtime_$(basename "$1")" \
    awk 'index($0, ENVIRON["BIN"]) && (index($0, ENVIRON["DIR"]) || index($0, ENVIRON["TAIL"])) { print $1 }'
}
count() { serve_pids "$1" | awk 'END { print NR }'; }
# wait_for_count <dir> <n>: the tree is up once all its processes exist.
wait_for_count() {
  local i
  for i in $(seq 1 50); do
    [[ "$(count "$1")" == "$2" ]] && return 0
    sleep 0.1
  done
  return 1
}
launch_serve() { # launch_serve <dir>: the way local-runtime-up.sh did before this fix
  (
    cd "$1"
    nohup npx -y supabase@99.0.0 functions serve --no-verify-jwt --env-file "$1/supabase/functions/.env.local" \
      >/dev/null 2>&1 </dev/null &
    echo $! >"$WORK/wrapper.pid"
  ) 2>/dev/null
}

echo "== stub reproduces the leak: killing the npx wrapper orphans the server"
launch_serve "$ROOT"
wait_for_count "$ROOT" 4 && pass "stub tree up: wrapper, shim, CLI, docker logs" || fail "stub tree has $(count "$ROOT") processes, want 4"
kill "$(cat "$WORK/wrapper.pid")"
sleep 0.5
orphans="$(serve_pids "$ROOT" | tr '\n' ' ')"
[[ "$(count "$ROOT")" == 3 ]] && pass "old stop (kill \$!) leaves 3 orphans: $orphans" || fail "expected 3 orphans after killing the wrapper, found $(count "$ROOT")"

launch_serve "$OTHER"
wait_for_count "$OTHER" 4 && pass "other worktree's server up" || fail "other tree has $(count "$OTHER") processes, want 4"
other_before="$(serve_pids "$OTHER" | sort | tr '\n' ' ')"

echo "== local-runtime-up.sh sweeps the orphans and starts one server"
if out="$("$ROOT/supabase/scripts/local-runtime-up.sh" 2>&1)"; then pass "local-runtime-up.sh exit 0"; else fail "local-runtime-up.sh failed"; echo "$out" | sed 's/^/      | /' >&2; fi
for pid in $orphans; do
  if ps -p "$pid" >/dev/null 2>&1; then fail "orphan $pid survived local-runtime-up.sh"; else pass "orphan $pid gone"; fi
done
wait_for_count "$ROOT" 4 && pass "fresh server tree up (4 processes)" || fail "server tree has $(count "$ROOT") processes, want 4"
[[ ! -e "$ROOT/supabase/.temp/health-functions-serve.pid" ]] && pass "no PID file written" || fail "PID file written"

echo "== local-runtime-down.sh leaves no functions serve process for the slot"
if out="$("$ROOT/supabase/scripts/local-runtime-down.sh" 2>&1)"; then pass "local-runtime-down.sh exit 0"; else fail "local-runtime-down.sh failed"; echo "$out" | sed 's/^/      | /' >&2; fi
[[ "$(count "$ROOT")" == 0 ]] && pass "no server process survives" || fail "survivors: $(serve_pids "$ROOT" | tr '\n' ' ')"
[[ "$(serve_pids "$OTHER" | sort | tr '\n' ' ')" == "$other_before" ]] && pass "other worktree's server untouched" || fail "other worktree's server changed"

echo "== a server that ignores SIGTERM is SIGKILLed"
cat >"$CLI" <<'EOF'
#!/usr/bin/env bash
trap '' TERM
while :; do sleep 1; done
EOF
launch_serve "$ROOT"
wait_for_count "$ROOT" 3 && pass "TERM-ignoring tree up" || fail "tree has $(count "$ROOT") processes, want 3"
if out="$(BOGA_FUNCTIONS_SERVE_STOP_SECONDS=1 "$ROOT/supabase/scripts/local-runtime-down.sh" 2>&1)"; then pass "local-runtime-down.sh exit 0"; else fail "local-runtime-down.sh failed"; echo "$out" | sed 's/^/      | /' >&2; fi
grep -qF "sending SIGKILL" <<<"$out" && pass "escalated to SIGKILL" || fail "no SIGKILL escalation logged"
[[ "$(count "$ROOT")" == 0 ]] && pass "no server process survives" || fail "survivors: $(serve_pids "$ROOT" | tr '\n' ' ')"

echo "== a caller whose own command line mentions functions serve is not a match"
launch_serve "$ROOT"
wait_for_count "$ROOT" 3 && pass "server tree up" || fail "tree has $(count "$ROOT") processes, want 3"
out="$(cd "$ROOT" && BOGA_FUNCTIONS_SERVE_STOP_SECONDS=1 bash -c ': npx -y supabase@99.0.0 functions serve; "$0"; echo CALLER-SURVIVED' "$ROOT/supabase/scripts/local-runtime-down.sh" 2>&1)" || true
grep -qF CALLER-SURVIVED <<<"$out" && pass "calling shell survived local-runtime-down.sh" || { fail "calling shell was killed"; echo "$out" | sed 's/^/      | /' >&2; }
[[ "$(count "$ROOT")" == 0 ]] && pass "no server process survives" || fail "survivors: $(serve_pids "$ROOT" | tr '\n' ' ')"

echo
echo "functions-serve-stop: ${PASS} passed, ${FAIL} failed"
[[ "$FAIL" == 0 ]]
