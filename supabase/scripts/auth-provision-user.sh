#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"

require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "jq is required for auth provisioning scripts." >&2
    exit 1
  fi
}

normalize_supabase_admin_env() {
  API_URL="${API_URL:-${SUPABASE_URL:-}}"
  SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}"
}

require_legacy_service_role_jwt() {
  if [[ "${SERVICE_ROLE_KEY}" != *.*.* ]]; then
    echo "SUPABASE_SERVICE_ROLE_KEY/SERVICE_ROLE_KEY must be the legacy JWT service_role key for Supabase Auth Admin API calls." >&2
    echo "The configured value is not JWT-shaped; use the Dashboard API Keys legacy service_role key, not an sb_secret_... key." >&2
    exit 1
  fi
}

request_json() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  local response_file
  response_file="$(mktemp)"

  local status
  if [[ -n "${body}" ]]; then
    status="$(curl --silent --show-error \
      -X "${method}" \
      -H "apikey: ${SERVICE_ROLE_KEY}" \
      -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
      -H "Content-Type: application/json" \
      -o "${response_file}" \
      -w "%{http_code}" \
      --data "${body}" \
      "${url}")"
  else
    status="$(curl --silent --show-error \
      -X "${method}" \
      -H "apikey: ${SERVICE_ROLE_KEY}" \
      -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
      -o "${response_file}" \
      -w "%{http_code}" \
      "${url}")"
  fi

  REQUEST_STATUS="${status}"
  REQUEST_BODY="$(cat "${response_file}")"
  rm -f "${response_file}"
}

EMAIL=""
PASSWORD=""
FIXTURE_KEY=""
EMAIL_CONFIRM="true"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --email)
      EMAIL="$2"
      shift 2
      ;;
    --password)
      PASSWORD="$2"
      shift 2
      ;;
    --fixture-key)
      FIXTURE_KEY="$2"
      shift 2
      ;;
    --email-confirm)
      EMAIL_CONFIRM="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 --email <email> --password <password> [--fixture-key <key>] [--email-confirm true|false]" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${EMAIL}" || -z "${PASSWORD}" ]]; then
  echo "--email and --password are required." >&2
  exit 1
fi

require_jq

normalize_supabase_admin_env

if [[ -z "${API_URL:-}" || -z "${SERVICE_ROLE_KEY:-}" ]]; then
  load_supabase_status_env
  normalize_supabase_admin_env
fi

if [[ -z "${API_URL:-}" || -z "${SERVICE_ROLE_KEY:-}" ]]; then
  echo "Missing Supabase admin credentials. Start local Supabase or export API_URL + SERVICE_ROLE_KEY / SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY." >&2
  exit 1
fi

require_legacy_service_role_jwt

EMAIL_LOWER="$(printf '%s' "${EMAIL}" | tr '[:upper:]' '[:lower:]')"
ADMIN_USERS_URL="${API_URL}/auth/v1/admin/users?page=1&per_page=200"

request_json GET "${ADMIN_USERS_URL}"
if [[ "${REQUEST_STATUS}" != "200" ]]; then
  echo "Failed to list auth users (status ${REQUEST_STATUS})." >&2
  echo "${REQUEST_BODY}" >&2
  exit 1
fi

EXISTING_USER_ID="$(printf '%s' "${REQUEST_BODY}" | jq -r --arg email "${EMAIL_LOWER}" '
  .users[]? | select((.email // "" | ascii_downcase) == $email) | .id
' | head -n1)"

USER_ID=""
if [[ -n "${EXISTING_USER_ID}" ]]; then
  UPDATE_PAYLOAD="$(jq -nc \
    --arg password "${PASSWORD}" \
    --argjson email_confirm "$( [[ "${EMAIL_CONFIRM}" == "true" ]] && echo true || echo false )" \
    '{password: $password, email_confirm: $email_confirm}')"
  request_json PUT "${API_URL}/auth/v1/admin/users/${EXISTING_USER_ID}" "${UPDATE_PAYLOAD}"
  if [[ "${REQUEST_STATUS}" != "200" ]]; then
    echo "Failed to update auth user ${EMAIL} (status ${REQUEST_STATUS})." >&2
    echo "${REQUEST_BODY}" >&2
    exit 1
  fi
  USER_ID="$(printf '%s' "${REQUEST_BODY}" | jq -r '.id')"
  ACTION="updated"
else
  CREATE_PAYLOAD="$(jq -nc \
    --arg email "${EMAIL}" \
    --arg password "${PASSWORD}" \
    --argjson email_confirm "$( [[ "${EMAIL_CONFIRM}" == "true" ]] && echo true || echo false )" \
    '{email: $email, password: $password, email_confirm: $email_confirm}')"
  request_json POST "${API_URL}/auth/v1/admin/users" "${CREATE_PAYLOAD}"
  if [[ "${REQUEST_STATUS}" != "200" && "${REQUEST_STATUS}" != "201" ]]; then
    echo "Failed to create auth user ${EMAIL} (status ${REQUEST_STATUS})." >&2
    echo "${REQUEST_BODY}" >&2
    exit 1
  fi
  USER_ID="$(printf '%s' "${REQUEST_BODY}" | jq -r '.id')"
  ACTION="created"
fi

if [[ -z "${USER_ID}" || "${USER_ID}" == "null" ]]; then
  echo "Provisioning response did not include a user id for ${EMAIL}." >&2
  echo "${REQUEST_BODY}" >&2
  exit 1
fi

if [[ -n "${FIXTURE_KEY}" ]]; then
  FIXTURE_PATCH_PAYLOAD="$(jq -nc \
    --arg uuid "${USER_ID}" \
    --arg email "${EMAIL}" \
    '{subject_uuid: $uuid, subject_kind: "user", email: $email}')"

  local_response_file="$(mktemp)"
  fixture_status="$(curl --silent --show-error \
    -X PATCH \
    -H "apikey: ${SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    -o "${local_response_file}" \
    -w "%{http_code}" \
    --data "${FIXTURE_PATCH_PAYLOAD}" \
    "${API_URL}/rest/v1/dev_fixture_principals?fixture_key=eq.${FIXTURE_KEY}")"
  fixture_body="$(cat "${local_response_file}")"
  rm -f "${local_response_file}"

  if [[ "${fixture_status}" != "200" ]]; then
    echo "Failed to update dev fixture principal ${FIXTURE_KEY} (status ${fixture_status})." >&2
    echo "${fixture_body}" >&2
    exit 1
  fi
fi

echo "[supabase] auth user ${ACTION}: ${EMAIL} (${USER_ID})"
if [[ -n "${FIXTURE_KEY}" ]]; then
  echo "[supabase] fixture alias synced: ${FIXTURE_KEY}"
fi
