#!/usr/bin/env bash
# Activate protocol 4 on this leased local stack for UI/client proof, then run
# the command. Activation is one-way: an initially pending stack is marked first
# and the next baseline preflight resets it (ensure-local-runtime-baseline.sh).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/_common.sh"
[[ $# -gt 0 ]] || { echo "usage: with-local-group-competitions.sh <command> [args...]" >&2; exit 2; }
load_supabase_status_env
db_container="$(resolve_db_container)"
was_active="$(docker exec "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atqc 'select app_public.group_competition_active();')"
activation_body="$(mktemp)"
trap 'rm -f "${activation_body}"' EXIT
[[ "${was_active}" == t ]] || mark_stack_needs_reset 'with-local-group-competitions.sh activated protocol 4'
activation_status="$(curl --silent --show-error -X POST -H "apikey: ${ANON_KEY}" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" -H 'Content-Profile: app_public' \
  -H 'Content-Type: application/json' -H 'x-boga-group-contract: 4' \
  --data '{"p_expected_contract":4}' -o "${activation_body}" -w '%{http_code}' \
  "${API_URL}/rest/v1/rpc/group_competition_activate")"
[[ "${activation_status}" == 200 ]] && jq -e '.contract_version==4' "${activation_body}" >/dev/null || {
  echo "[group-competitions] local activation failed: HTTP ${activation_status}" >&2; cat "${activation_body}" >&2; exit 1;
}
echo '[group-competitions] safe local protocol 4 active'
"$@"
