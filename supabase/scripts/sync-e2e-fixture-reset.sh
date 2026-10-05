#!/usr/bin/env bash

# sync-e2e-fixture-reset.sh — empties the ios-sync-e2e fixture user's (user_b)
# server data, so every run of the lane starts from the same state without a
# Supabase reset:
#
#   1. hard-deletes, with the service role, user_b's Sync v2 rows (the tables
#      `dev_wipe_my_data` covers, child-first because each REST call is its own
#      transaction; `dev_wipe_my_data` itself refuses unless `app.env` is set,
#      which the local stack's REST path does not set);
#   2. signs in as user_b and pulls every layer from a null cursor, failing
#      unless each is empty, and fails if the server accepts a layer past the
#      last one checked. A sync table missing from step 1, or a new pull layer,
#      therefore fails the lane here instead of quietly sending the first
#      sign-in down the bootstrapper's pull branch.
#
# Why: the bootstrapper seeds the starter catalog only when the first full pull
# is empty. Without this reset only the first run in a slot takes that seed
# branch; every later run pulls the catalog an earlier run pushed.
#
# The backend contract suites also sign in as user_b, but they tag their rows
# per run and run apart from the iOS lanes, so this reset does not touch them.
#
# Contract: docs/specs/11-maestro-runtime-and-testing-conventions.md (fixture
# users). Called by apps/mobile/scripts/maestro-run-lane.sh (lane sync-e2e)
# after the local runtime baseline (which provisions the user) is ensured.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/auth-fixture-constants.sh"

fail() {
  echo "[sync-e2e-fixture-reset] FAIL: $*" >&2
  exit 1
}

command -v jq >/dev/null 2>&1 || fail "jq is required"

load_supabase_status_env
[[ -n "${API_URL:-}" && -n "${ANON_KEY:-}" && -n "${SERVICE_ROLE_KEY:-}" ]] ||
  fail "local Supabase status env is incomplete (API_URL/ANON_KEY/SERVICE_ROLE_KEY)"

STATUS=""
BODY=""

# http <method> <url> <bearer> [json-body] [extra-header...]
http() {
  local method="$1" url="$2" bearer="$3" body="${4:-}" out
  shift 4 || shift $#
  out="$(mktemp)"
  local -a args=(--silent --show-error -X "${method}"
    -H "apikey: ${ANON_KEY}"
    -H "Authorization: Bearer ${bearer}"
    -H "Accept-Profile: app_public"
    -H "Content-Profile: app_public"
    -o "${out}" -w "%{http_code}")
  local header
  for header in "$@"; do
    args+=(-H "${header}")
  done
  if [[ -n "${body}" ]]; then
    args+=(-H "Content-Type: application/json" --data "${body}")
  fi
  STATUS="$(curl "${args[@]}" "${url}")"
  BODY="$(cat "${out}")"
  rm -f "${out}"
}

expect_2xx() {
  [[ "${STATUS}" =~ ^2 ]] || fail "$1: HTTP ${STATUS}: ${BODY}"
}

# A password sign-in proves the fixture exists and yields its id and token.
http POST "${API_URL}/auth/v1/token?grant_type=password" "${ANON_KEY}" \
  "$(jq -nc --arg e "${USER_B_EMAIL}" --arg p "${USER_B_PASSWORD}" '{email: $e, password: $p}')"
expect_2xx "password sign-in for ${USER_B_EMAIL} (is the lane baseline provisioned?)"
B_UID="$(jq -er '.user.id' <<<"${BODY}")"
B_TOKEN="$(jq -er '.access_token' <<<"${BODY}")"
REST="${API_URL}/rest/v1"

# 1. Sync v2 rows (service role), children before the rows they reference.
sync_rows=0
# The performed rows that carry a source-plan link (exercise_sets,
# session_exercises, sessions) precede the plan rows they reference.
for table in session_exercise_tags exercise_sets session_exercises sessions \
  session_plan_sets session_plan_exercises session_plans training_programmes \
  exercise_muscle_mappings exercise_tag_definitions exercise_group_links exercise_definitions \
  muscle_groups gyms body_weight_measurements user_settings; do
  http DELETE "${REST}/${table}?owner_user_id=eq.${B_UID}" "${SERVICE_ROLE_KEY}" "" \
    "Prefer: return=representation"
  expect_2xx "delete user_b ${table}"
  sync_rows=$((sync_rows + $(jq 'length' <<<"${BODY}")))
done

# 2. What the app's first sign-in will see: every pull layer empty. The headers
#    match the app's client (src/auth/supabase.ts). sync_pull answers a
#    rejected payload with HTTP 200 and an `error` envelope, so read the body.
sync_pull() {
  http POST "${REST}/rpc/sync_pull" "${B_TOKEN}" \
    "$(jq -nc --argjson layer "$1" '{layer: $layer, cursor: null, limit: 1}')" \
    "x-boga-sync-protocol: 4" "Prefer: params=single-object"
  expect_2xx "sync_pull layer $1 as user_b"
}
LAST_LAYER=4
for ((layer = 0; layer <= LAST_LAYER; layer++)); do
  sync_pull "${layer}"
  jq -e '(.entities | type) == "array"' <<<"${BODY}" >/dev/null ||
    fail "sync_pull layer ${layer} as user_b returned no page: ${BODY}"
  [[ "$(jq '.entities | length' <<<"${BODY}")" == "0" ]] ||
    fail "user_b still has layer ${layer} rows after the reset (a sync table missing from this script?): ${BODY}"
done
sync_pull "$((LAST_LAYER + 1))"
jq -e '.error' <<<"${BODY}" >/dev/null ||
  fail "the server accepts pull layer $((LAST_LAYER + 1)); add its tables to this script and raise LAST_LAYER: ${BODY}"

echo "[sync-e2e-fixture-reset] user_b=${B_UID}: deleted ${sync_rows} sync row(s); pull layers 0..${LAST_LAYER} empty"
