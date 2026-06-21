#!/usr/bin/env bash
#
# ensure-dev-baseline.sh — DB setup for a human development session.
#
# Targets the dedicated DEV Supabase stack (project_id BOGA-dev), NOT the slot-0
# stack the gates use — so a gate run never wipes a dev session's data (see
# dev-stack-lib.sh / docs/specs/12). The dev-flavored sibling of
# ensure-local-runtime-baseline.sh: that one is for the gates and seeds the
# integration-TEST fixtures (user_a/user_b); this seeds the human sign-in
# accounts (a@dev.local / b@dev.local). Wired into dev-lan.sh and dev-remote.sh
# and exposed as `boga db dev`.
#
# Contract (the two properties dev wants):
#   (1) SEED THE USERS — provisions the human dev accounts idempotently.
#   (2) DON'T RESET UNLESS NECESSARY — your dev data survives a normal start:
#       - running stack       -> reuse it, no reset
#       - absent stack        -> `supabase start` (a fresh volume applies
#                                migrations + seed.sql itself; still no reset)
#       - pending migrations  -> applied IN PLACE via `db push` (no reset)
#       - schema drift        -> FAIL LOUD with instructions; never auto-wipe
#
# This script NEVER runs `db reset` and NEVER seeds the test fixtures. Rebuilding
# the dev stack from scratch (which DROPS ALL DEV DATA) stays explicit, separate:
#     boga db dev-reset      # ./supabase/scripts/dev-reset.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/dev-stack-lib.sh"

# Point every Supabase helper below (and the auth-provisioning child) at the dev
# stack. From here on, run_supabase / load_supabase_status_env target BOGA-dev.
engage_dev_stack

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
  echo "[dev-baseline] applying pending migrations to the dev stack (in place — no reset)"
  if ! run_supabase db push --local --include-all --yes >/dev/null; then
    cat >&2 <<'MSG'
[dev-baseline] FAILED to apply pending migrations to the dev stack.
[dev-baseline] Its schema has likely drifted from supabase/migrations.
[dev-baseline] Your dev data was NOT touched. To rebuild the dev stack — this
[dev-baseline] DROPS ALL DEV DATA, including your dev accounts and logged data:
[dev-baseline]     boga db dev-reset
[dev-baseline] then re-run your dev launcher (it will re-seed the dev accounts).
MSG
    exit 1
  fi
}

dev_stack_assert_engaged

if load_supabase_status_env_if_available && runtime_rest_api_reachable; then
  echo "[dev-baseline] dev runtime already running — reusing without reset"
else
  echo "[dev-baseline] dev runtime unavailable — starting it (no reset; a fresh start applies migrations + seed)"
  "${SCRIPT_DIR}/dev-runtime-up.sh"
  load_supabase_status_env
fi

apply_pending_local_migrations

echo "[dev-baseline] seeding human development accounts (idempotent)"
"${SCRIPT_DIR}/auth-provision-dev-accounts.sh"

echo "[dev-baseline] dev baseline ready — dev data preserved, no reset performed"
