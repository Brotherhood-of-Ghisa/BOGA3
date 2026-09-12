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
  pr-wait.sh boga-config-init.sh lanes.tsv lane-timing.sh java-env.sh; do
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
