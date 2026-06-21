#!/usr/bin/env bash
#
# ensure-dev-baseline.sh — DB setup for a human development session.
#
# The dev-flavored sibling of ensure-local-runtime-baseline.sh. That script
# exists for the gates and seeds the integration-TEST fixtures (user_a/user_b);
# this one targets the day-to-day workflow and seeds the human sign-in accounts
# (a@dev.local / b@dev.local). It is wired into dev-lan.sh and dev-remote.sh and
# exposed as `boga db dev`.
#
# Contract (the two properties dev wants):
#   (1) SEED THE USERS — provisions the human dev accounts idempotently.
#   (2) DON'T RESET UNLESS NECESSARY — your local data survives a normal start:
#       - running stack       -> reuse it, no reset
#       - absent stack        -> `supabase start` (a fresh volume applies
#                                migrations + seed.sql itself; still no reset)
#       - pending migrations  -> applied IN PLACE via `db push` (no reset)
#       - schema drift        -> FAIL LOUD with instructions; never auto-wipe
#
# This script NEVER runs `db reset` and NEVER seeds the test fixtures. Rebuilding
# from scratch (which DROPS ALL LOCAL DATA) stays an explicit, separate action:
#     boga db reset      # ./supabase/scripts/reset-local.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"

# Best-effort load of `supabase status` env without failing when the stack is
# down (status exits non-zero then). Mirrors ensure-local-runtime-baseline.sh.
load_supabase_status_env_if_available() {
  local output line key value
  output="$(run_supabase status -o env 2>/dev/null)" || return 1
  while IFS= read -r line; do
    [[ -z "${line}" ]] && continue
    [[ "${line}" == *=* ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    [[ "${key}" =~ ^[A-Z0-9_]+$ ]] || continue
    if [[ "${value}" == \"*\" && "${value}" == *\" ]]; then
      value="${value#\"}"
      value="${value%\"}"
    fi
    export "${key}=${value}"
  done <<<"${output}"
  return 0
}

runtime_rest_api_reachable() {
  [[ -n "${API_URL:-}" ]] || return 1
  [[ -n "${ANON_KEY:-}" ]] || return 1
  curl --silent --show-error --fail \
    -H "apikey: ${ANON_KEY}" \
    -H "Authorization: Bearer ${ANON_KEY}" \
    "${API_URL}/rest/v1/dev_fixture_principals?select=fixture_key&limit=1" \
    >/dev/null 2>&1
}

apply_pending_local_migrations() {
  echo "[dev-baseline] applying pending local migrations (in place — no reset)"
  if ! run_supabase db push --local --include-all --yes >/dev/null; then
    cat >&2 <<'MSG'
[dev-baseline] FAILED to apply pending migrations to the running local stack.
[dev-baseline] The local schema has likely drifted from supabase/migrations.
[dev-baseline] Your data was NOT touched. To rebuild from scratch — this DROPS
[dev-baseline] ALL LOCAL DATA, including your dev accounts and any logged data:
[dev-baseline]     boga db reset
[dev-baseline] then re-run your dev launcher (it will re-seed the dev accounts).
MSG
    exit 1
  fi
}

if load_supabase_status_env_if_available && runtime_rest_api_reachable; then
  echo "[dev-baseline] local runtime already running — reusing without reset"
else
  echo "[dev-baseline] local runtime unavailable — starting it (no reset; a fresh start applies migrations + seed)"
  "${SCRIPT_DIR}/local-runtime-up.sh"
  load_supabase_status_env
fi

apply_pending_local_migrations

echo "[dev-baseline] seeding human development accounts (idempotent)"
"${SCRIPT_DIR}/auth-provision-dev-accounts.sh"

echo "[dev-baseline] development baseline ready — local data preserved, no reset performed"
