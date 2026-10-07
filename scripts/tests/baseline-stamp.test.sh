#!/usr/bin/env bash
#
# baseline-stamp.test.sh — the shared baseline preflight
# (supabase/scripts/ensure-local-runtime-baseline.sh) pays its repairs once per
# gate run and never skips them on state it cannot vouch for:
#   - no BOGA_GATE_RUN_ID (a lane run by name) → always the full path;
#   - the gate's first lane runs the full path and stamps the database;
#   - a later lane of the same gate skips the repairs only while the stamp is
#     present and its inputs + state hashes still match;
#   - a missing stamp (db reset), another gate's stamp, changed state, a new
#     migration, an unreadable stamp or a down runtime → the full path again;
#   - a failing full path exits non-zero and leaves no stamp;
#   - a stack a one-way body marked, or with protocol 4 active, is reset first
#     (and says why); a failed reset fails the preflight and keeps the mark.
# And `boga` exports one fresh BOGA_GATE_RUN_ID per gate run, never one for a
# lane run by name.
#
# Runs the real preflight in a temp leased worktree. Its repair scripts are
# stubs that log their name; stub npx / curl / docker stand in for the stack,
# with the database reduced to two files: the stamp row and the state the
# stamp query hashes. Infra-free; part of the `meta-tests` lane and CI.

set -euo pipefail

THIS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SRC_ROOT="$(cd -- "$THIS_DIR/../.." && pwd)"

PASS=0
FAIL=0
pass() { echo "  [pass] $*"; PASS=$((PASS + 1)); }
fail() { echo "  [FAIL] $*" >&2; FAIL=$((FAIL + 1)); }

WORK="$(mktemp -d)"
WORK="$(cd "$WORK" && pwd -P)"
trap 'rm -rf "$WORK"' EXIT
STUB_BIN="$WORK/bin"
ROOT="$WORK/wt"
DB="$WORK/db"        # stamp = the baseline_ready row; state = what the query hashes
CALLS="$WORK/calls"  # one line per repair script / CLI repair that ran
mkdir -p "$STUB_BIN" "$DB"
export PATH="$STUB_BIN:$PATH" DB CALLS

# ---------- stubs: the stack ----------
# `supabase status` fails while $DB/down exists (runtime down); db push is a repair.
cat >"$STUB_BIN/npx" <<'EOF'
#!/usr/bin/env bash
shift 2
case "$1 ${2:-}" in
  "status -o")
    [[ -e "$DB/down" ]] && exit 1
    printf 'API_URL="http://127.0.0.1:9"\nANON_KEY="stub-anon"\n' ;;
  "db push") echo db-push >>"$CALLS" ;;
esac
EOF
printf '#!/usr/bin/env bash\n[[ ! -e "$DB/down" ]]\n' >"$STUB_BIN/curl"
# docker ps names this slot's db container; `docker exec … psql` is the
# protocol-4 activation query (prints $DB/active, default f), the stamp query
# (prints "<stamp>|<state>") or, given -v details=, the stamp write.
cat >"$STUB_BIN/docker" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  ps) echo "supabase_db_BOGA-wt-wt7" ;;
  exec)
    [[ -e "$DB/psql-broken" ]] && { echo "psql: connection refused" >&2; exit 2; }
    [[ "$(cat)" == *group_competition_active* ]] && { cat "$DB/active" 2>/dev/null || echo f; exit 0; }
    for arg in "$@"; do
      [[ "$arg" == emails=* ]] && printf '%s' "${arg#emails=}" >"$DB/emails"
      [[ "$arg" == details=* ]] && { printf '%s' "${arg#details=}" >"$DB/stamp"; exit 0; }
    done
    printf '%s|%s\n' "$(cat "$DB/stamp" 2>/dev/null)" "$(cat "$DB/state")" ;;
esac
EOF
chmod +x "$STUB_BIN"/*

# ---------- scaffold: a leased worktree holding the real preflight ----------
mkdir -p "$ROOT/scripts" "$ROOT/supabase/scripts" "$ROOT/supabase/migrations" "$ROOT/apps/mobile"
cp "$SRC_ROOT/scripts/worktree-lib.sh" "$ROOT/scripts/"
for f in _common.sh _containers.sh ensure-local-runtime-baseline.sh auth-fixture-constants.sh; do
  cp "$SRC_ROOT/supabase/scripts/$f" "$ROOT/supabase/scripts/"
done
for f in local-runtime-up.sh reset-local.sh group-eval-configure.sh smoke-seed.sh auth-provision-local-fixtures.sh; do
  printf '#!/usr/bin/env bash\necho %s >>"$CALLS"\n' "${f%.sh}" >"$ROOT/supabase/scripts/$f"
done
# reset-local does what the real one does to the state the preflight reads: it
# truncates the stamp, deactivates protocol 4 and clears the mark; it fails
# (leaving all three) while $DB/reset-broken exists.
cat >"$ROOT/supabase/scripts/reset-local.sh" <<'EOF2'
#!/usr/bin/env bash
echo reset-local >>"$CALLS"
[[ ! -e "$DB/reset-broken" ]] || exit 1
rm -f "$DB/stamp" "$DB/active" "$(dirname "$0")/../.temp/stack-needs-reset"
EOF2
# smoke-seed fails while $DB/seed-broken exists (a baseline the repairs cannot fix).
printf '#!/usr/bin/env bash\necho smoke-seed >>"$CALLS"\n[[ ! -e "$DB/seed-broken" ]]\n' >"$ROOT/supabase/scripts/smoke-seed.sh"
chmod +x "$ROOT/supabase/scripts/"*.sh
printf 'project_id = "BOGA-wt-wt7"\n[db]\nport = 54322\n' >"$ROOT/supabase/config.toml"
echo "create table t ();" >"$ROOT/supabase/migrations/20260101000000_init.sql"
echo "-- seed" >"$ROOT/supabase/seed.sql"
echo 7 >"$ROOT/.worktree-slot"
export BOGA_CONFIG_ROOT="$WORK/config"
mkdir -p "$BOGA_CONFIG_ROOT/worktrees/slots"
printf 'slot=7\nproject_id=BOGA-wt-wt7\npath=%s\n' "$ROOT" >"$BOGA_CONFIG_ROOT/worktrees/slots/7"
export SUPABASE_CLI_VERSION=99.0.0
echo "state-1" >"$DB/state"

OUT="$WORK/out"
# preflight [gate-id]: run it; leaves its output in $OUT and the repairs in $CALLS.
preflight() {
  : >"$CALLS"
  if [[ -n "${1:-}" ]]; then
    BOGA_GATE_RUN_ID="$1" "$ROOT/supabase/scripts/ensure-local-runtime-baseline.sh" >"$OUT" 2>&1
  else
    env -u BOGA_GATE_RUN_ID "$ROOT/supabase/scripts/ensure-local-runtime-baseline.sh" >"$OUT" 2>&1
  fi
}
repairs() { tr '\n' ' ' <"$CALLS" | sed 's/ $//'; }
FULL="db-push group-eval-configure smoke-seed auth-provision-local-fixtures smoke-seed"
COLD="local-runtime-up reset-local $FULL"

# expect_full <label> <expected output fragment>
expect_full() {
  [[ "$(repairs)" == "$FULL" ]] && pass "$1: full path ($FULL)" || fail "$1: repairs were '$(repairs)', want '$FULL'"
  grep -Fq "$2" "$OUT" && pass "$1: says why ('$2')" || { fail "$1: output lacks '$2'"; sed 's/^/      | /' "$OUT" >&2; }
}
expect_fast() {
  [[ -z "$(repairs)" ]] && pass "$1: repairs skipped" || fail "$1: repairs ran: '$(repairs)'"
  grep -Fq "repairs skipped" "$OUT" && pass "$1: says so" || { fail "$1: no skip line"; sed 's/^/      | /' "$OUT" >&2; }
}

echo "== a lane run by name (no gate id) always takes the full path and stamps nothing"
preflight && pass "exit 0" || fail "exit non-zero"
[[ "$(repairs)" == "$FULL" ]] && pass "full path" || fail "repairs were '$(repairs)'"
[[ ! -e "$DB/stamp" ]] && pass "no stamp written" || fail "stamp written without a gate: $(cat "$DB/stamp")"

echo "== a gate's first lane runs the full path and stamps the gate"
preflight G1 && pass "exit 0" || fail "exit non-zero"
expect_full "first lane" "no baseline stamp"
grep -q '^gate=G1 inputs=[0-9a-f]\{16\} state=state-1$' "$DB/stamp" && pass "stamp: $(cat "$DB/stamp")" || fail "stamp is '$(cat "$DB/stamp" 2>/dev/null)'"

echo "== a later lane of the same gate skips the repairs"
preflight G1 && pass "exit 0" || fail "exit non-zero"
expect_fast "second lane"

echo "== a lane run by name after a gate still takes the full path"
preflight
[[ "$(repairs)" == "$FULL" ]] && pass "full path despite G1's stamp" || fail "repairs were '$(repairs)'"

echo "== another gate run does not trust G1's stamp"
preflight G2
expect_full "new gate" "another gate run"
preflight G2
expect_fast "new gate, second lane"

echo "== a body that changed the baseline state sends the next lane down the full path"
echo "state-2 (fixture user deleted)" >"$DB/state"
preflight G2
expect_full "state changed" "baseline changed since this gate stamped it"
preflight G2
expect_fast "re-stamped after repair"

echo "== a database reset (seed.sql truncates the stamp) invalidates it"
rm -f "$DB/stamp"
preflight G2
expect_full "after reset" "no baseline stamp"

echo "== a new migration file invalidates the stamp"
echo "alter table t add column c int;" >"$ROOT/supabase/migrations/20260102000000_next.sql"
preflight G2
expect_full "new migration" "baseline changed since this gate stamped it"

echo "== an unreadable stamp is a full path, not a skip — and the stamp write then fails loudly"
touch "$DB/psql-broken"
if preflight G2; then fail "exit 0 with an unreadable database"; else pass "exit non-zero"; fi
[[ "$(repairs)" == "$FULL" ]] && pass "full path while the stamp query fails" || fail "repairs were '$(repairs)'"
grep -Fq "stamp check failed" "$OUT" && pass "says the check failed" || fail "no check-failed line"
rm -f "$DB/psql-broken"

echo "== the state hash covers every fixture user and every field the repairs fix"
printf 'export USER_Z_EMAIL="user_z.local@example.test"\n' >>"$ROOT/supabase/scripts/auth-fixture-constants.sh"
preflight G2
missing=""
for email in $(grep -oE '^export USER_[A-Z]+_EMAIL="[^"]+"' "$ROOT/supabase/scripts/auth-fixture-constants.sh" | cut -d'"' -f2); do
  [[ ",$(cat "$DB/emails")," == *",$email,"* ]] || missing="$missing $email"
done
[[ -z "$missing" ]] && pass "hashed users = every *_EMAIL in auth-fixture-constants.sh, a new one included" || fail "fixture users missing from the hash:$missing"
# The stub cannot run SQL, so pin the real query to the state each repair fixes.
for term in supabase_migrations.schema_migrations public.dev_fixture_principals u.encrypted_password \
  u.email_confirmed_at u.banned_until "group_eval_config('group_eval_url')"; do
  grep -Fq "$term" "$SRC_ROOT/supabase/scripts/ensure-local-runtime-baseline.sh" \
    && pass "stamp query hashes $term" || fail "stamp query no longer hashes $term"
done

echo "== editing a repair script invalidates the stamp"
preflight G2
echo "# edited" >>"$ROOT/supabase/scripts/group-eval-configure.sh"
preflight G2
expect_full "repair script edited" "baseline changed since this gate stamped it"

echo "== a stack a one-way body marked is reset before the repairs, and says why"
MARK="$ROOT/supabase/.temp/stack-needs-reset"
preflight G4
mkdir -p "$(dirname "$MARK")"
printf 'body-a activated protocol 4\nbody-b reset to an old migration\n' >"$MARK"
preflight G4 && pass "exit 0" || fail "exit non-zero"
[[ "$(repairs)" == "reset-local $FULL" ]] && pass "reset, then the full path" || fail "repairs were '$(repairs)'"
grep -Fq "(body-a activated protocol 4;body-b reset to an old migration); resetting" "$OUT" \
  && pass "names every marking body" || { fail "no reset reason"; sed 's/^/      | /' "$OUT" >&2; }
[[ ! -e "$MARK" ]] && pass "the reset cleared the mark" || fail "mark survived the reset"
preflight G4
expect_fast "after the reset, re-stamped"

echo "== protocol 4 active without a mark is reset too"
echo t >"$DB/active"
preflight G4
[[ "$(repairs)" == "reset-local $FULL" ]] && pass "reset, then the full path" || fail "repairs were '$(repairs)'"
grep -Fq "protocol 4 is active); resetting" "$OUT" && pass "says why" || fail "no activation reason"

echo "== a failed reset fails the preflight and keeps the mark"
echo "body-c" >"$MARK"
touch "$DB/reset-broken"
if preflight G4; then fail "exit 0 after a failed reset"; else pass "exit non-zero"; fi
[[ "$(repairs)" == "reset-local" ]] && pass "no repairs after the failed reset" || fail "repairs were '$(repairs)'"
[[ -s "$MARK" ]] && pass "mark kept for the next preflight" || fail "mark lost"
rm -f "$DB/reset-broken"
preflight G4
[[ "$(repairs)" == "reset-local $FULL" && ! -e "$MARK" ]] && pass "next preflight resets and clears it" || fail "repairs were '$(repairs)'"
grep -Fq "clear_stack_reset_marker" "$SRC_ROOT/supabase/scripts/reset-local.sh" \
  && pass "the real reset-local.sh clears the mark" || fail "reset-local.sh no longer clears the mark"

echo "== a down runtime cold-starts and resets, then stamps"
touch "$DB/down"
rm -f "$DB/stamp"
# The stub status keeps failing while down; bring it 'up' once local-runtime-up runs.
printf '#!/usr/bin/env bash\necho local-runtime-up >>"$CALLS"\nrm -f "$DB/down"\n' >"$ROOT/supabase/scripts/local-runtime-up.sh"
preflight G2 && pass "exit 0" || { fail "exit non-zero"; sed 's/^/      | /' "$OUT" >&2; }
[[ "$(repairs)" == "$COLD" ]] && pass "cold path ($COLD)" || fail "repairs were '$(repairs)', want '$COLD'"
grep -q '^gate=G2 ' "$DB/stamp" && pass "stamped after the cold start" || fail "no stamp after the cold start"

echo "== a full path that fails exits non-zero and leaves no stamp"
rm -f "$DB/stamp"
touch "$DB/seed-broken"
if preflight G3; then fail "exit 0 on a broken baseline"; else pass "exit non-zero"; fi
[[ ! -e "$DB/stamp" ]] && pass "no stamp" || fail "stamp written on failure: $(cat "$DB/stamp")"
rm -f "$DB/seed-broken"

# ---------- boga: one fresh gate id per gate run, none for a lane by name ----------
echo "== boga exports one BOGA_GATE_RUN_ID per gate run and none for a lane run by name"
cp "$SRC_ROOT/boga" "$ROOT/"
for f in lane-timing.sh java-env.sh; do cp "$SRC_ROOT/scripts/$f" "$ROOT/scripts/"; done
SEEN="$WORK/seen"
printf 'one\tslow-backend\tnone\tno\t.\techo "one ${BOGA_GATE_RUN_ID:-}" >>%s\n' "$SEEN" >"$ROOT/scripts/lanes.tsv"
printf 'two\tslow-backend\tnone\tno\t.\techo "two ${BOGA_GATE_RUN_ID:-}" >>%s\n' "$SEEN" >>"$ROOT/scripts/lanes.tsv"
export BOGA_LANE_TIMING=0
BOGA_GATE_RUN_ID=leaked "$ROOT/boga" test backend >/dev/null
"$ROOT/boga" test backend >/dev/null
BOGA_GATE_RUN_ID=leaked "$ROOT/boga" test one >/dev/null
ids=()
while read -r _ id; do ids+=("${id:-<none>}"); done <"$SEEN"
[[ "${ids[0]}" != "<none>" && "${ids[0]}" != "leaked" ]] && pass "gate run 1 id: ${ids[0]}" || fail "gate run 1 id '${ids[0]}'"
[[ "${ids[1]}" == "${ids[0]}" ]] && pass "both lanes of a gate run share it" || fail "lane ids differ: ${ids[0]} vs ${ids[1]}"
[[ "${ids[2]}" != "<none>" && "${ids[2]}" != "${ids[0]}" && "${ids[3]}" == "${ids[2]}" ]] \
  && pass "gate run 2 gets a fresh id: ${ids[2]}" || fail "gate run 2 ids '${ids[2]}' '${ids[3]}'"
[[ "${ids[4]}" == "<none>" ]] && pass "a lane by name sees no gate id" || fail "lane by name saw '${ids[4]}'"

echo
echo "baseline-stamp: ${PASS} passed, ${FAIL} failed"
[[ "${FAIL}" == "0" ]]
