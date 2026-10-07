#!/usr/bin/env bash

# group-competitions-activate.sh — switch this stack to group-competition
# protocol 4, once.
#
# The migration installs the protocol pending, and the app reads groups only
# through it, so a pending stack shows every group as "Group comparisons
# unavailable". Activation is service-only and one-way (groups-contract §12):
# only a reset restores a pending schema. Idempotent: an active stack is left
# alone. Targets whichever stack the caller engaged (the dev baseline engages
# BOGA-dev); the gate lanes use with-local-group-competitions.sh instead, which
# marks the stack so the next baseline preflight resets it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"

load_supabase_status_env
container="$(resolve_db_container)" || exit 1

active="$(docker exec "${container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atqc \
  'select app_public.group_competition_active();')"
if [[ "${active}" == t ]]; then
  echo "[group-competitions] protocol 4 already active"
  exit 0
fi

body="$(mktemp)"
trap 'rm -f "${body}"' EXIT
status="$(curl --silent --show-error -X POST -H "apikey: ${ANON_KEY}" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" -H 'Content-Profile: app_public' \
  -H 'Content-Type: application/json' -H 'x-boga-group-contract: 4' \
  --data '{"p_expected_contract":4}' -o "${body}" -w '%{http_code}' \
  "${API_URL}/rest/v1/rpc/group_competition_activate")"
if [[ "${status}" != 200 ]] || ! jq -e '.contract_version==4' "${body}" >/dev/null; then
  echo "[group-competitions] activation failed: HTTP ${status}" >&2
  cat "${body}" >&2
  exit 1
fi
echo "[group-competitions] protocol 4 activated"
