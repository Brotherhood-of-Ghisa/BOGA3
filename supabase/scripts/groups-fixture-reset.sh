#!/usr/bin/env bash

# groups-fixture-reset.sh — returns the ios-groups-e2e fixture users (user_c,
# the device user; user_d, the scripted counterparty) to a known server state,
# so the lane is hermetic across repeated runs in one slot without a reset:
#
#   1. hard-deletes, with the service role, every group either user created or
#      has any membership period in (memberships, invites, and share-ledger
#      rows go with it by `on delete cascade`);
#   2. hard-deletes both users' Sync v2 rows (the tables `dev_wipe_my_data`
#      covers, child-first because each REST call is its own transaction), so
#      each run starts from an empty server: the device takes the first-sign-in
#      seed path and the counterparty has no session history from an earlier
#      run. `dev_wipe_my_data` itself is not usable here: it
#      refuses unless `app.env` is set, which the local stack's REST path does
#      not set;
#   3. clears user_c's profile row (the create screen's username gate must
#      prompt) and sets user_d's username (group_join requires one).
#
# Contract: docs/specs/tech/groups-contract.md §8 (Maestro lane);
# docs/specs/11-maestro-runtime-and-testing-conventions.md (fixture users).
# Called by apps/mobile/scripts/maestro-run-lane.sh (lane groups-e2e) after the
# local runtime baseline (which provisions the users) is ensured.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/auth-fixture-constants.sh"

fail() {
  echo "[groups-fixture-reset] FAIL: $*" >&2
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

# user_id_of <email> <password>: a password sign-in proves the fixture exists
# and resolves its id without paging the admin user list.
user_id_of() {
  http POST "${API_URL}/auth/v1/token?grant_type=password" "${ANON_KEY}" \
    "$(jq -nc --arg e "$1" --arg p "$2" '{email: $e, password: $p}')"
  expect_2xx "password sign-in for $1 (is the lane baseline provisioned?)"
  jq -er '.user.id' <<<"${BODY}"
}

C_UID="$(user_id_of "${USER_C_EMAIL}" "${USER_C_PASSWORD}")"
D_UID="$(user_id_of "${USER_D_EMAIL}" "${USER_D_PASSWORD}")"
USERS="${C_UID},${D_UID}"
REST="${API_URL}/rest/v1"

# 1. Groups (service role; no client can touch these tables directly).
http GET "${REST}/group_memberships?select=group_id&user_id=in.(${USERS})" "${SERVICE_ROLE_KEY}"
expect_2xx "list fixture memberships"
member_groups="$(jq -r '.[].group_id' <<<"${BODY}")"
http GET "${REST}/groups?select=id&created_by=in.(${USERS})" "${SERVICE_ROLE_KEY}"
expect_2xx "list fixture-created groups"
created_groups="$(jq -r '.[].id' <<<"${BODY}")"
group_ids="$(printf '%s\n%s\n' "${member_groups}" "${created_groups}" | grep . | sort -u | paste -sd, - || true)"
group_count=0
if [[ -n "${group_ids}" ]]; then
  http DELETE "${REST}/groups?id=in.(${group_ids})" "${SERVICE_ROLE_KEY}" "" "Prefer: return=representation"
  expect_2xx "delete fixture groups"
  group_count="$(jq 'length' <<<"${BODY}")"
fi
http GET "${REST}/group_memberships?select=id&user_id=in.(${USERS})" "${SERVICE_ROLE_KEY}"
expect_2xx "verify fixture memberships are gone"
[[ "$(jq 'length' <<<"${BODY}")" == "0" ]] || fail "fixture memberships remain after the group delete: ${BODY}"

# 2. Sync v2 rows (service role), children before the rows they reference.
sync_rows=0
for table in session_exercise_tags exercise_sets session_exercises exercise_muscle_mappings \
  exercise_tag_definitions sessions exercise_group_links exercise_definitions muscle_groups gyms; do
  http DELETE "${REST}/${table}?owner_user_id=in.(${USERS})" "${SERVICE_ROLE_KEY}" "" \
    "Prefer: return=representation"
  expect_2xx "delete fixture ${table}"
  sync_rows=$((sync_rows + $(jq 'length' <<<"${BODY}")))
done

# 3. Usernames: user_c has none (gate prompts); user_d has one (join needs it).
http DELETE "${REST}/user_profiles?id=eq.${C_UID}" "${SERVICE_ROLE_KEY}"
expect_2xx "clear user_c profile"
http POST "${REST}/user_profiles?on_conflict=id" "${SERVICE_ROLE_KEY}" \
  "$(jq -nc --arg id "${D_UID}" --arg u "${USER_D_USERNAME}" '{id: $id, username: $u}')" \
  "Prefer: resolution=merge-duplicates,return=minimal"
expect_2xx "set user_d username"

echo "[groups-fixture-reset] user_c=${C_UID} user_d=${D_UID}: deleted ${group_count} group(s);" \
  "deleted ${sync_rows} sync row(s); user_c username cleared, user_d username=${USER_D_USERNAME}"
