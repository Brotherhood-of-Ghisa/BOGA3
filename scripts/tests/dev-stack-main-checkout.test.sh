#!/usr/bin/env bash
#
# Hermetic test for the dev stack's main-checkout-only rule
# (docs/specs/12-worktree-config-and-isolation.md, "Dedicated dev stack"):
#   - engage_dev_stack (every `boga db dev*` script and the dev env-halves)
#     refuses in a linked worktree and writes no .supabase-dev there;
#   - dev-lan.sh / dev-remote.sh target BOGA-dev from the main checkout and the
#     worktree's own slot stack (ensure-dev-baseline.sh --slot-stack) from a
#     linked worktree.
#
# Infra-free: a temp main checkout + `git worktree add`, the launchers' child
# scripts stubbed, stub npx/tailscale on PATH. Runs in the meta-tests lane.

set -euo pipefail

THIS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SRC_ROOT="$(cd -- "$THIS_DIR/../.." && pwd)"

PASS=0
FAIL=0
pass() { echo "  [pass] $*"; PASS=$((PASS + 1)); }
fail() { echo "  [FAIL] $*" >&2; FAIL=$((FAIL + 1)); }
assert_contains() { if grep -qF -- "$2" <<<"$1"; then pass "$3"; else fail "$3 (missing: '$2')"; echo "$1" | sed 's/^/      | /' >&2; fi; }
assert_not_contains() { if grep -qF -- "$2" <<<"$1"; then fail "$3 (unexpected: '$2')"; echo "$1" | sed 's/^/      | /' >&2; else pass "$3"; fi; }
assert_eq() { if [[ "$1" == "$2" ]]; then pass "$3"; else fail "$3 (got '$1', want '$2')"; fi; }
assert_file() { if [[ -e "$1" ]]; then pass "$2"; else fail "$2 (missing $1)"; fi; }
assert_no_file() { if [[ -e "$1" ]]; then fail "$2 (unexpected $1)"; else pass "$2"; fi; }
# run <var> <cmd...>: capture combined output in $var and exit code in RC.
out="" RC=0
run() { local __out; set +e; __out="$("${@:2}" 2>&1)"; RC=$?; set -e; printf -v "$1" '%s' "$__out"; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
WORK="$(cd "$WORK" && pwd -P)"

# ---------- stub npx / tailscale ----------
STUB_BIN="$WORK/bin"
mkdir -p "$STUB_BIN"
printf '#!/usr/bin/env bash\necho "npx $*"\n' >"$STUB_BIN/npx"
printf '#!/usr/bin/env bash\nexit 0\n' >"$STUB_BIN/tailscale"
chmod +x "$STUB_BIN/npx" "$STUB_BIN/tailscale"
export PATH="$STUB_BIN:$PATH"
export BOGA_MOBILE_TS_HOST=test-mac.example.ts.net

# ---------- scaffold: main checkout + linked worktree ----------
MAIN="$WORK/main"
LINKED="$WORK/linked"
mkdir -p "$MAIN/scripts/dev" "$MAIN/supabase/scripts" "$MAIN/supabase/functions"
git -C "$MAIN" init -q -b main
git -C "$MAIN" config user.email test@example.com
git -C "$MAIN" config user.name Test
cat >"$MAIN/supabase/config.toml.template" <<'EOF'
project_id = "{{PROJECT_ID}}"
[api]
port = {{API_PORT}}
EOF
: >"$MAIN/supabase/seed.sql"
# The launchers' own lease guard is covered by worktree-lifecycle.test.sh; here
# the real worktree-lib.sh is used with only that check stubbed out.
cat >"$MAIN/scripts/worktree-lib.sh" <<EOF
source "$SRC_ROOT/scripts/worktree-lib.sh"
boga_require_slot_lease() { return 0; }
EOF
cp "$SRC_ROOT/scripts/dev/dev-lan.sh" "$SRC_ROOT/scripts/dev/dev-remote.sh" "$MAIN/scripts/dev/"
# shellcheck disable=SC2016 # the stub expands the var when it runs, not here
for half in use-local-mobile-lan-env.sh use-local-mobile-tailscale-env.sh; do
  printf '#!/usr/bin/env bash\necho "env-half BOGA_MOBILE_DEV_DB=[${BOGA_MOBILE_DEV_DB:-}]"\n' >"$MAIN/scripts/dev/$half"
  chmod +x "$MAIN/scripts/dev/$half"
done
: >"$MAIN/scripts/dev/export-mobile-supabase-env.sh"
printf '#!/usr/bin/env bash\necho "baseline args=[$*]"\n' >"$MAIN/supabase/scripts/ensure-dev-baseline.sh"
chmod +x "$MAIN/supabase/scripts/ensure-dev-baseline.sh"
printf '.supabase-dev/\napps/mobile/node_modules/\n' >"$MAIN/.gitignore"
git -C "$MAIN" add -A
git -C "$MAIN" commit -qm scaffold
git -C "$MAIN" worktree add -q -b linked "$LINKED"
mkdir -p "$MAIN/apps/mobile/node_modules" "$LINKED/apps/mobile/node_modules"

# engage <root>: source the real libs as a dev-stack script would, engage, and
# report where the Supabase helpers now point.
engage() {
  bash -c '
    set -euo pipefail
    REPO_ROOT="$1"; SUPABASE_DIR="$1/supabase"
    source "$2/scripts/worktree-lib.sh"
    source "$2/supabase/scripts/dev-stack-lib.sh"
    engage_dev_stack
    echo "workdir=${BOGA_SUPABASE_WORKDIR}"
  ' engage "$1" "$SRC_ROOT"
}

echo "== engage_dev_stack: main checkout engages BOGA-dev"
run out engage "$MAIN"
assert_eq "$RC" "0" "main checkout: engage succeeds"
assert_contains "$out" "workdir=$MAIN/.supabase-dev" "main checkout: helpers point at main's .supabase-dev"
assert_contains "$(cat "$MAIN/.supabase-dev/supabase/config.toml" 2>/dev/null)" 'project_id = "BOGA-dev"' \
  "main checkout: dev config rendered with project_id BOGA-dev"

echo "== engage_dev_stack: linked worktree is refused (boga db dev*, env-halves)"
run out engage "$LINKED"
assert_eq "$RC" "1" "linked worktree: engage exits 1"
assert_contains "$out" "main-checkout-only" "linked worktree: names the rule"
assert_contains "$out" "./boga db up" "linked worktree: points at the slot stack"
assert_contains "$out" "run from the main checkout: $MAIN" "linked worktree: names the main checkout"
assert_not_contains "$out" "workdir=" "linked worktree: BOGA_SUPABASE_WORKDIR never exported"
assert_no_file "$LINKED/.supabase-dev" "linked worktree: no .supabase-dev written (no Edge mounts to strand)"

echo "== dev launchers route by checkout"
for launcher in dev-lan dev-remote; do
  run out "$MAIN/scripts/dev/$launcher.sh"
  assert_eq "$RC" "0" "$launcher (main): runs"
  assert_contains "$out" "env-half BOGA_MOBILE_DEV_DB=[1]" "$launcher (main): env-half targets BOGA-dev"
  assert_contains "$out" "baseline args=[]" "$launcher (main): dev baseline on BOGA-dev"

  # An inherited BOGA_MOBILE_DEV_DB must not drag a linked worktree onto BOGA-dev.
  run out env BOGA_MOBILE_DEV_DB=1 "$LINKED/scripts/dev/$launcher.sh"
  assert_eq "$RC" "0" "$launcher (linked): runs"
  assert_contains "$out" "using this worktree's slot stack" "$launcher (linked): says it uses the slot stack"
  assert_contains "$out" "env-half BOGA_MOBILE_DEV_DB=[]" "$launcher (linked): env-half targets the slot stack"
  assert_contains "$out" "baseline args=[--slot-stack]" "$launcher (linked): baseline on the slot stack"
done

echo
echo "[dev-stack-main-checkout] ${PASS} passed, ${FAIL} failed"
[[ "$FAIL" == "0" ]]
