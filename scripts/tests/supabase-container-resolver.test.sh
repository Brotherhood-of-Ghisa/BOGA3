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

# docker stub: $STUB_WORK/containers holds "<name> <hostport>[,<hostport>...]".
#
#   docker ps --format '{{.Names}}'          -> the names
#   docker inspect <name> --format <tmpl>    -> renders <tmpl> over a fake
#                                               .NetworkSettings.Ports map
#
# `inspect` renders the template rather than printing a canned port, because the
# thing most likely to break `container_publishes_host_port` is its Go template,
# and a stub that ignores --format would stay green while production refused
# every container. Ports are emitted the way the real daemon does: one token per
# published binding, plus an empty token for each unpublished container port
# (which is what makes the empty-want_port guard necessary).
cat >"${STUB_BIN}/docker" <<'EOF'
#!/usr/bin/env bash
ports_of() { awk -v n="$1" '$1 == n { print $2 }' "$STUB_WORK/containers" 2>/dev/null; }
case "$1" in
  ps) awk '{print $1}' "$STUB_WORK/containers" 2>/dev/null ;;
  inspect)
    name="$2"
    tmpl=""
    shift 2
    while [[ $# -gt 0 ]]; do
      [[ "$1" == "--format" ]] && tmpl="$2"
      shift
    done
    raw="$(ports_of "$name")"
    [[ -z "$raw" ]] && exit 1
    # Only the host-port template is understood; anything else is a template the
    # code under test changed to, and the stub must not silently satisfy it.
    if [[ "$tmpl" != *".HostPort"* ]]; then
      echo "stub docker: unsupported inspect --format: $tmpl" >&2
      exit 1
    fi
    out=""
    IFS=',' read -r -a bindings <<< "$raw"
    for b in "${bindings[@]}"; do
      # "-" marks an exposed-but-unpublished port: the real daemon renders it as
      # an empty token.
      [[ "$b" == "-" ]] && { out+=" "; continue; }
      out+="$b "
    done
    printf '%s' "$out"
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

# 10. Real containers publish several ports and expose others unpublished —
#     Kong publishes 8000 and leaves 8001/8443/8444 unbound. The wanted port
#     must be found among them, and the empty tokens must not match anything.
set_containers "supabase_kong_${LONG_TRUNC} 55731,-,-,-"
expect_resolves "finds the port among several bindings" kong "${LONG}" "55731" "supabase_kong_${LONG_TRUNC}"
expect_refuses "an unpublished (empty) binding does not match" kong "${LONG}" ""

# 11. A host port must match whole, not as a substring of a longer one.
set_containers "supabase_db_${LONG_TRUNC} 55722"
expect_refuses "5572 does not match 55722" db "${LONG}" "5572"

# 12. container_publishes_host_port directly. The resolver guards the empty case
#     before calling it, so these assertions are the only thing holding the
#     function safe for a future second caller.
set_containers "supabase_db_${LONG_TRUNC} 55722,-"
container_publishes_host_port "supabase_db_${LONG_TRUNC}" "55722" \
  || fail "container_publishes_host_port: expected a match for a published port"
echo "  ok: publishes_host_port matches a published port"

if container_publishes_host_port "supabase_db_${LONG_TRUNC}" ""; then
  fail "container_publishes_host_port: an empty port must never match, but did"
fi
echo "  ok: publishes_host_port rejects an empty port"

if container_publishes_host_port "supabase_db_does-not-exist" "55722"; then
  fail "container_publishes_host_port: a missing container must not match"
fi
echo "  ok: publishes_host_port rejects a missing container"

echo "[supabase-container-resolver.test] 16 assertions passed"
