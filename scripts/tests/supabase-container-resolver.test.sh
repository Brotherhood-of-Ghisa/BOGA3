#!/usr/bin/env bash

# Tests for resolve_worktree_container / container_publishes_host_port in
# supabase/scripts/_common.sh. Infra-free: a stub `docker` on PATH, no daemon.
#
# What this guards: a worktree whose project_id exceeds
# SUPABASE_CLI_PROJECT_ID_LIMIT runs containers named for a PREFIX of that id,
# and the prefix drops the trailing slot number. Two sibling worktrees therefore
# truncate to the same container name, so the resolver must refuse a truncated
# match that does not publish this slot's port — otherwise a lane silently binds
# another worktree's Postgres and passes against its data.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

fail() { echo "  ASSERT FAILED: $*" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

STUB_BIN="${TMP}/bin"
mkdir -p "${STUB_BIN}"
export STUB_WORK="${TMP}"
export PATH="${STUB_BIN}:${PATH}"

# docker stub: $STUB_WORK/containers holds "<name> <hostport>" lines.
#   docker ps --format '{{.Names}}'  -> the names
#   docker inspect <name> --format ... -> that name's host port
cat >"${STUB_BIN}/docker" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  ps) awk '{print $1}' "$STUB_WORK/containers" 2>/dev/null ;;
  inspect)
    name="$2"
    awk -v n="$name" '$1 == n { print $2 }' "$STUB_WORK/containers" 2>/dev/null
    ;;
esac
exit 0
EOF
chmod +x "${STUB_BIN}/docker"

# _common.sh expects a repo layout; point it at a temp worktree with a config.
export BOGA_SUPABASE_WORKDIR="${TMP}/wt"
mkdir -p "${BOGA_SUPABASE_WORKDIR}/supabase"

# shellcheck disable=SC1091
source "${REPO_ROOT}/supabase/scripts/_common.sh"

set_containers() { printf '%s\n' "$@" > "${STUB_WORK}/containers"; }

expect_resolves() {
  local label="$1" service="$2" pid="$3" port="$4" want="$5" got
  if ! got="$(resolve_worktree_container "${service}" "${pid}" "${port}" 2>/dev/null)"; then
    fail "${label}: expected '${want}', got a refusal"
  fi
  [[ "${got}" == "${want}" ]] || fail "${label}: expected '${want}', got '${got}'"
  echo "  ok: ${label}"
}

expect_refuses() {
  local label="$1" service="$2" pid="$3" port="$4" got
  if got="$(resolve_worktree_container "${service}" "${pid}" "${port}" 2>/dev/null)"; then
    fail "${label}: expected a refusal, got '${got}'"
  fi
  echo "  ok: ${label}"
}

SHORT="BOGA-short-wt1"
# 41 chars: one over the cap, so the trailing slot digit is what gets cut.
LONG="BOGA-exercise-session-redesign-f34616-wt3"
LONG_TRUNC="${LONG:0:SUPABASE_CLI_PROJECT_ID_LIMIT}"
# A sibling worktree on a DIFFERENT slot that truncates to the SAME name.
SIBLING="BOGA-exercise-session-redesign-f34616-wt7"

[[ ${#LONG} -gt ${SUPABASE_CLI_PROJECT_ID_LIMIT} ]] || fail "fixture LONG is not over the cap"
[[ "${LONG_TRUNC}" == "${SIBLING:0:SUPABASE_CLI_PROJECT_ID_LIMIT}" ]] \
  || fail "fixture sibling does not collide on truncation — the test would prove nothing"

# 1. Exact name present: resolved, no port proof required.
set_containers "supabase_db_${SHORT} 55122"
expect_resolves "exact name resolves" db "${SHORT}" "55122" "supabase_db_${SHORT}"

# 2. Exact name present but port differs: still resolved. The full project_id
#    cannot belong to another worktree, so it needs no corroboration.
set_containers "supabase_db_${SHORT} 60000"
expect_resolves "exact name wins over a port mismatch" db "${SHORT}" "55122" "supabase_db_${SHORT}"

# 3. Only the truncated name is running, publishing THIS slot's port: resolved.
set_containers "supabase_db_${LONG_TRUNC} 55722"
expect_resolves "truncated name with matching port resolves" db "${LONG}" "55722" "supabase_db_${LONG_TRUNC}"

# 4. THE REGRESSION: the truncated name is running but publishes another slot's
#    port — it is the SIBLING worktree's container. Must refuse, not bind.
set_containers "supabase_db_${LONG_TRUNC} 55762"
expect_refuses "truncated name publishing a foreign port is refused" db "${LONG}" "55722"

# 5. Same, from the sibling's point of view: slot 7 must not take slot 3's stack.
set_containers "supabase_db_${LONG_TRUNC} 55722"
expect_refuses "sibling worktree does not steal this slot's container" db "${SIBLING}" "55762"

# 6. No port known: a truncated match cannot be corroborated, so refuse.
set_containers "supabase_db_${LONG_TRUNC} 55722"
expect_refuses "truncated name with no expected port is refused" db "${LONG}" ""

# 7. Nothing running.
set_containers ""
expect_refuses "no containers at all" db "${LONG}" "55722"

# 8. A genuinely foreign project id never matches.
set_containers "supabase_db_BOGA-someone-else 55722"
expect_refuses "foreign project id" db "${LONG}" "55722"

# 9. The service name is part of the match: kong is not db.
set_containers "supabase_kong_${SHORT} 55131"
expect_refuses "wrong service does not match" db "${SHORT}" "55122"
expect_resolves "right service matches" kong "${SHORT}" "55131" "supabase_kong_${SHORT}"

echo "[supabase-container-resolver.test] 10 assertions passed"
