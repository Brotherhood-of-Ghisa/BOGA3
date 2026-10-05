#!/usr/bin/env bash
# Temporarily activate protocol 4 on this leased local stack for UI/client proof.
# Activation is one-way; restore an initially pending stack with a full reset.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/_common.sh"
[[ $# -gt 0 ]] || { echo "usage: with-local-group-competitions.sh <command> [args...]" >&2; exit 2; }
load_supabase_status_env
db_container="$(resolve_db_container)"
was_active="$(docker exec "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atqc 'select app_public.group_competition_active();')"
activation_body="$(mktemp)"
cleanup() {
  local status=$?
  trap - EXIT
  rm -f "${activation_body}"
  if [[ "${was_active}" == f ]]; then
    local reset_log
    reset_log="$(mktemp)"
    if ! "${REPO_ROOT}/boga" db reset >"${reset_log}" 2>&1; then cat "${reset_log}" >&2; status=1; fi
    rm -f "${reset_log}"
  fi
  exit "${status}"
}
trap cleanup EXIT
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
