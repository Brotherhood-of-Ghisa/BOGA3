#!/usr/bin/env bash
#
# Hermetic test for the agent-owned worktree lifecycle
# (docs/specs/12-worktree-config-and-isolation.md):
#   boga worktree start / create / release / ls, boga pr wait, and the
#   fail-hard slot-lease guard (boga_require_slot_lease via ./boga test).
#
# Infra-free: temp git repos (a bare "origin" + a main checkout), a temp
# BOGA_CONFIG_ROOT, and stub `gh` / `docker` binaries on PATH. Runs in the
# meta-tests lane and in CI.

set -euo pipefail

THIS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SRC_ROOT="$(cd -- "$THIS_DIR/../.." && pwd)"

PASS=0
FAIL=0
pass() { echo "  [pass] $*"; PASS=$((PASS + 1)); }
fail() { echo "  [FAIL] $*" >&2; FAIL=$((FAIL + 1)); }
assert_contains() { if grep -qF -- "$2" <<<"$1"; then pass "$3"; else fail "$3 (missing: '$2')"; echo "$1" | sed 's/^/      | /' >&2; fi; }
assert_eq() { if [[ "$1" == "$2" ]]; then pass "$3"; else fail "$3 (got '$1', want '$2')"; fi; }
assert_file() { if [[ -e "$1" ]]; then pass "$2"; else fail "$2 (missing $1)"; fi; }
assert_no_file() { if [[ -e "$1" ]]; then fail "$2 (unexpected $1)"; else pass "$2"; fi; }
# run <var> <cmd...>: capture combined output in $var and exit code in RC.
run() { local __out; set +e; __out="$("${@:2}" 2>&1)"; RC=$?; set -e; printf -v "$1" '%s' "$__out"; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
WORK="$(cd "$WORK" && pwd -P)"

export BOGA_CONFIG_ROOT="$WORK/config"
export BOGA_WORKTREE_ROOT="$WORK/wts"
export BOGA_DOCKER_TIMEOUT_SECONDS=5
REG="$BOGA_CONFIG_ROOT/worktrees/slots"

# ---------- stub gh / docker ----------
STUB_BIN="$WORK/bin"
mkdir -p "$STUB_BIN" "$WORK/docker"
export PATH="$STUB_BIN:$PATH"
export STUB_WORK="$WORK"

# gh: prints $STUB_WORK/gh.states ("<number> <STATE>" lines). If gh.after
# exists, calls after the first print gh.after instead. gh.fail -> exit 1.
cat >"$STUB_BIN/gh" <<'EOF'
#!/usr/bin/env bash
[[ -f "$STUB_WORK/gh.fail" ]] && exit 1
if [[ -f "$STUB_WORK/gh.after" && -f "$STUB_WORK/gh.called" ]]; then
  cat "$STUB_WORK/gh.after"
else
  touch "$STUB_WORK/gh.called"
  cat "$STUB_WORK/gh.states" 2>/dev/null || true
fi
EOF
# docker: labels are files $STUB_WORK/docker/<project_id> holding container ids.
# docker.down -> `info` fails. Every rm is appended to docker.log.
cat >"$STUB_BIN/docker" <<'EOF'
#!/usr/bin/env bash
D="$STUB_WORK/docker"
label_of() { for a in "$@"; do [[ "$a" == label=com.supabase.cli.project=* ]] && echo "${a#label=com.supabase.cli.project=}"; done; }
case "$1" in
  info) [[ -f "$STUB_WORK/docker.down" ]] && exit 1; exit 0 ;;
  ps|volume|network)
    [[ "$1" == ps ]] || shift
    lbl="$(label_of "$@")"
    if [[ -n "$lbl" ]]; then
      [[ -f "$D/$lbl" ]] && cat "$D/$lbl"
    elif [[ "$*" == *"--format"* ]]; then
      ls "$D"
    fi
    if [[ "$1" == rm ]]; then shift; [[ "$1" == -f ]] && shift; echo "rm $*" >>"$STUB_WORK/docker.log"; fi
    ;;
  rm) shift; [[ "$1" == -f ]] && shift; echo "rm $*" >>"$STUB_WORK/docker.log"
      for id in "$@"; do for f in "$D"/*; do [[ -f "$f" ]] && grep -vx "$id" "$f" >"$f.tmp" || true; mv "$f.tmp" "$f" 2>/dev/null || true; done; done ;;
esac
exit 0
EOF
chmod +x "$STUB_BIN/gh" "$STUB_BIN/docker"

# ---------- scaffold: bare origin + main checkout ----------
git init -q --bare -b main "$WORK/origin.git"
MAIN="$WORK/main"
mkdir -p "$MAIN"
git -C "$MAIN" init -q -b main
git -C "$MAIN" config user.email test@example.com
git -C "$MAIN" config user.name Test
mkdir -p "$MAIN/docs/specs" "$MAIN/apps/mobile/.maestro" "$MAIN/supabase/functions" "$MAIN/scripts"
: >"$MAIN/AGENTS.md"
: >"$MAIN/docs/specs/README.md"
: >"$MAIN/apps/mobile/.maestro/maestro.env.sample"
: >"$MAIN/supabase/.env.hosted.example"
: >"$MAIN/supabase/.env.local.example"
: >"$MAIN/supabase/functions/.env.local.example"
cat >"$MAIN/supabase/config.toml.template" <<'EOF'
project_id = "{{PROJECT_ID}}"
[api]
port = {{API_PORT}}
[db]
port = {{DB_PORT}}
EOF
printf '.worktree-slot\nsupabase/config.toml\nsupabase/.env.local\nsupabase/.env.hosted\nsupabase/functions/.env.local\napps/mobile/.maestro/maestro.env.local\n' >"$MAIN/.gitignore"
cp "$SRC_ROOT/boga" "$MAIN/"
for f in worktree-lib.sh worktree-start.sh worktree-create.sh worktree-release.sh worktree-ls.sh \
  worktree-doctor.sh pr-wait.sh boga-config-init.sh lanes.tsv lane-timing.sh java-env.sh; do
  cp "$SRC_ROOT/scripts/$f" "$MAIN/scripts/"
done
git -C "$MAIN" add -A
git -C "$MAIN" commit -qm scaffold
git -C "$MAIN" remote add origin "$WORK/origin.git"
git -C "$MAIN" push -q origin main
BASE_COMMIT="$(git -C "$MAIN" rev-parse HEAD)"

advance_origin_main() { # a new commit on origin/main, pushed from the main checkout
  echo "$1" >>"$MAIN/AGENTS.md"
  git -C "$MAIN" commit -qam "$1"
  git -C "$MAIN" push -q origin main
}

echo "== project_id generation: capped, collision-safe, deterministic"
# Sourced from the source tree: worktree-lib.sh is side-effect free and needs no
# lease, so this runs as-is in CI's leaseless meta-tests lane.
# shellcheck disable=SC1091
source "$SRC_ROOT/scripts/worktree-lib.sh"
LONG_A="exercise-session-redesign-step3-set-logging-a1b2c3"
LONG_B="exercise-session-redesign-step3-set-logging-d4e5f6"
LONG_C="exercise-session-redesign-step4-history-view-a1b2c3"
# The shape that motivated the cap: uncapped, these two agree in their first 40
# characters, so the CLI would run both as one Docker project.
assert_eq "$(cut -c1-40 <<<"BOGA-$LONG_A-wt3")" "$(cut -c1-40 <<<"BOGA-$LONG_B-wt4")" \
  "fixture: uncapped ids of LONG_A/LONG_B collide under the CLI's cut"
ids=()
over=0 tail_lost=0 unstable=0
for name in "$LONG_A" "$LONG_B" "$LONG_C" exercise-session-redesign-f34616 \
  "$(printf 'x%.0s' {1..120})" feat-a; do
  for slot in 1 3 9 42 99; do
    id="$(boga_project_id_for_name "$slot" "$name")"
    (( ${#id} <= SUPABASE_CLI_PROJECT_ID_LIMIT )) || { over=1; echo "      | ${#id}: $id" >&2; }
    [[ "$id" == *"-wt$slot" ]] || { tail_lost=1; echo "      | no -wt$slot: $id" >&2; }
    [[ "$id" == "$(boga_project_id_for_name "$slot" "$name")" ]] || unstable=1
    ids+=("$id")
  done
done
assert_eq "$over" "0" "no id exceeds SUPABASE_CLI_PROJECT_ID_LIMIT ($SUPABASE_CLI_PROJECT_ID_LIMIT)"
assert_eq "$tail_lost" "0" "every id keeps its whole -wt<slot> suffix"
assert_eq "$unstable" "0" "repeated calls return the same id"
assert_eq "$(printf '%s\n' "${ids[@]}" | sort -u | wc -l | tr -d ' ')" "${#ids[@]}" \
  "names sharing a long prefix get distinct ids, on one slot and across slots"
# Pinned so a platform whose cksum differed (CI Linux vs macOS) fails here
# instead of making doctor disagree with config.toml across machines.
assert_eq "$(boga_project_id_for_name 3 exercise-session-redesign-f34616)" "BOGA-exercise-session-redes-cfeeb0d1-wt3" \
  "a capped id is pinned (the #313 worktree, slot 3)"
assert_eq "$(boga_project_id_for_name 1 feat-a)" "BOGA-feat-a-wt1" "an id that fits is unchanged"

echo "== fail hard without a lease"
run out "$MAIN/boga" test lint --dry-run
assert_eq "$RC" "1" "boga test (dry-run) refuses without a lease"
assert_contains "$out" "Run: ./boga worktree start" "names the fix"
run out "$MAIN/boga" test --list
assert_eq "$RC" "0" "boga test --list needs no lease"

echo "== main checkout takes slot 0"
run out "$MAIN/scripts/worktree-start.sh"
assert_eq "$RC" "0" "start in main checkout"
assert_eq "$(cat "$MAIN/.worktree-slot")" "0" "main checkout slot file = 0"
assert_contains "$(cat "$REG/0")" "path=$MAIN" "slot 0 lease names the main checkout"
assert_contains "$(cat "$MAIN/supabase/config.toml")" "port = 55431" "config uses slot-0 API port"
run out "$MAIN/boga" test lint --dry-run
assert_eq "$RC" "0" "boga test (dry-run) runs with a lease"

echo "== create: new worktrees from origin/main, lowest free slot"
run out "$MAIN/scripts/worktree-create.sh" feat-a
assert_eq "$RC" "0" "create feat-a"
WA="$BOGA_WORKTREE_ROOT/feat-a"
assert_eq "$(cat "$WA/.worktree-slot")" "1" "feat-a leases slot 1"
assert_contains "$(cat "$REG/1")" "project_id=BOGA-feat-a-wt1" "lease records the project id"
assert_contains "$(cat "$WA/supabase/config.toml")" "port = 55531" "feat-a config uses slot-1 API port"
run out "$MAIN/scripts/worktree-create.sh" feat-b
WB="$BOGA_WORKTREE_ROOT/feat-b"
assert_eq "$(cat "$WB/.worktree-slot")" "2" "feat-b leases slot 2"

echo "== base check applies only to a new lease"
advance_origin_main "moved on"
git -C "$MAIN" worktree add -q -b stale "$BOGA_WORKTREE_ROOT/stale" "$BASE_COMMIT"
WS="$BOGA_WORKTREE_ROOT/stale"
run out "$WS/scripts/worktree-start.sh"
assert_eq "$RC" "1" "stale worktree refused"
assert_contains "$out" "git rebase origin/main" "prints the rebase fix"
assert_no_file "$WS/.worktree-slot" "no slot taken on refusal"
run out "$WS/scripts/worktree-start.sh" --base HEAD
assert_eq "$RC" "0" "--base override accepted"
assert_eq "$(cat "$WS/.worktree-slot")" "3" "stale worktree leases slot 3"
run out "$WA/scripts/worktree-start.sh"
assert_eq "$RC" "0" "re-running start in a behind-main worktree keeps its lease"
assert_contains "$out" "kept slot 1" "re-run keeps slot 1"

echo "== lost or conflicting lease"
rm "$REG/1"
run out "$WA/boga" test lint --dry-run
assert_eq "$RC" "1" "missing registry file fails hard"
assert_contains "$out" "has no registry file" "names the missing lease"
run out "$WA/scripts/worktree-start.sh"
assert_eq "$(cat "$WA/.worktree-slot")" "1" "start re-creates the lease for the same slot"
assert_file "$REG/1" "slot 1 lease restored"
cp "$REG/2" "$WORK/reg2.bak"
sed -i.bak "s|^path=.*|path=$WORK/elsewhere|" "$REG/2"
run out "$WB/boga" test lint --dry-run
assert_eq "$RC" "1" "lease held by another path fails hard"
assert_contains "$out" "leased to another path" "names the conflict"
run out "$WB/scripts/worktree-start.sh"
assert_eq "$RC" "1" "start refuses to steal a leased slot"
cp "$WORK/reg2.bak" "$REG/2"

echo "== release: PR gate, Docker, lease, worktree"
printf 'c1\nc2\n' >"$WORK/docker/BOGA-feat-a-wt1"
echo "7 OPEN" >"$WORK/gh.states"
run out "$WA/scripts/worktree-release.sh"
assert_eq "$RC" "1" "open PR refused"
assert_contains "$out" "still OPEN" "names the open PR"
assert_file "$REG/1" "lease kept on refusal"
echo "7 MERGED" >"$WORK/gh.states"
touch "$WORK/docker.down"
run out "$WA/scripts/worktree-release.sh"
assert_eq "$RC" "1" "Docker down fails hard"
assert_file "$REG/1" "lease kept when Docker is down"
rm "$WORK/docker.down"
run out "$WA/scripts/worktree-release.sh"
assert_eq "$RC" "0" "merged PR released"
assert_contains "$(cat "$WORK/docker.log")" "rm c1 c2" "removed the labelled containers"
assert_no_file "$REG/1" "lease deleted"
assert_no_file "$WA" "worktree removed"
git -C "$MAIN" show-ref --verify --quiet refs/heads/feat-a && pass "branch kept" || fail "branch kept"
assert_file "$REG/2" "other leases untouched"

echo "== release guards"
run out "$MAIN/scripts/worktree-release.sh" --slot 0 --force
assert_eq "$RC" "1" "slot 0 is never released"
echo "x1" >"$WORK/docker/BOGA-ghost-wt9"
run out "$MAIN/scripts/worktree-release.sh" --project-id BOGA-ghost-wt9
assert_eq "$RC" "1" "--project-id needs --force"
run out "$MAIN/scripts/worktree-release.sh" --project-id BOGA-feat-b-wt2 --force
assert_eq "$RC" "1" "--project-id refuses a leased stack"
assert_contains "$out" "use --slot 2" "points at --slot"

echo "== ls: leases, unleased stacks, worktrees without a lease"
echo "x1" >"$WORK/docker/BOGA-dev"
git -C "$MAIN" worktree add -q -b harness "$BOGA_WORKTREE_ROOT/harness" main
echo "9 OPEN" >"$WORK/gh.states"
run out "$MAIN/scripts/worktree-ls.sh"
assert_eq "$RC" "0" "ls exits 0"
assert_contains "$out" "BOGA-feat-b-wt2" "lists a lease"
assert_contains "$out" "BOGA-ghost-wt9" "lists an unleased stack"
assert_contains "$out" "dev stack (main checkout) - keep" "marks the dev stack keep"
assert_contains "$out" "no lease" "lists a worktree without a lease"

echo "== release --project-id --force removes an unleased stack"
run out "$MAIN/scripts/worktree-release.sh" --project-id BOGA-ghost-wt9 --force
assert_eq "$RC" "0" "unleased stack released"
assert_contains "$(cat "$WORK/docker.log")" "rm x1" "removed its containers"

echo "== long worktree name: capped id in config, lease, and doctor"
LONG_NAME="exercise-session-redesign-step3-set-logging"
run out "$MAIN/scripts/worktree-create.sh" "$LONG_NAME"
assert_eq "$RC" "0" "create a long-named worktree"
WL="$BOGA_WORKTREE_ROOT/$LONG_NAME"
WL_SLOT="$(cat "$WL/.worktree-slot")"
WL_ID="$(awk -F\" '/^project_id =/ { print $2; exit }' "$WL/supabase/config.toml")"
if (( ${#WL_ID} <= SUPABASE_CLI_PROJECT_ID_LIMIT )); then pass "config.toml project_id fits the CLI limit ($WL_ID)"; else fail "config.toml project_id too long: $WL_ID"; fi
assert_contains "$(cat "$REG/$WL_SLOT")" "project_id=$WL_ID" "lease records the same capped id"
run out "$WL/scripts/worktree-doctor.sh"
assert_contains "$out" "[ok] supabase project_id matches slot" "doctor accepts the capped id"

echo "== migration: a config.toml written before the cap"
OLD_ID="BOGA-$LONG_NAME-wt$WL_SLOT"
sed -i.bak "s|^project_id = .*|project_id = \"$OLD_ID\"|" "$WL/supabase/config.toml"
run out "$WL/scripts/worktree-doctor.sh"
assert_eq "$RC" "1" "doctor fails on the stale over-length id"
assert_contains "$out" "does not match '$WL_ID' (slot $WL_SLOT); run ./boga worktree start" "names the expected id and the command"
assert_contains "$out" "supabase/config.toml is stale" "warns that an over-length id means a stale config"
run out "$WL/scripts/worktree-start.sh"
assert_eq "$RC" "0" "re-running start migrates it"
assert_contains "$out" "project_id changed: $OLD_ID -> $WL_ID" "start reports the rename"
assert_contains "$out" "labels '${OLD_ID:0:SUPABASE_CLI_PROJECT_ID_LIMIT}' is now unleased" "names the orphaned stack's Docker label"
assert_contains "$out" "worktree-cleanup.md" "points at the cleanup procedure"
assert_contains "$(cat "$WL/supabase/config.toml")" "project_id = \"$WL_ID\"" "config rewritten with the capped id"
run out "$WL/scripts/worktree-start.sh"
if grep -qF "project_id changed" <<<"$out"; then fail "an unchanged re-run warns about a rename"; else pass "an unchanged re-run does not warn"; fi

echo "== pr wait"
rm -f "$WORK/gh.called" "$WORK/gh.after"
echo "3 MERGED" >"$WORK/gh.states"
run out "$WB/scripts/pr-wait.sh" --interval 0
assert_eq "$RC" "0" "MERGED exits 0"
assert_contains "$out" "./boga worktree release" "tells the agent to release"
echo "3 CLOSED" >"$WORK/gh.states"
run out "$WB/scripts/pr-wait.sh" --interval 0
assert_eq "$RC" "3" "CLOSED exits 3"
: >"$WORK/gh.states"
run out "$WB/scripts/pr-wait.sh" --interval 0
assert_eq "$RC" "2" "no PR exits 2"
rm -f "$WORK/gh.called"
echo "3 OPEN" >"$WORK/gh.states"
echo "3 MERGED" >"$WORK/gh.after"
run out "$WB/scripts/pr-wait.sh" --interval 0
assert_eq "$RC" "0" "waits through OPEN until MERGED"

echo
echo "[worktree-lifecycle.test] $PASS passed, $FAIL failed"
[[ "$FAIL" == "0" ]]
