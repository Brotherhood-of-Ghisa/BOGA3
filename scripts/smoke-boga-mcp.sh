#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${REPO_ROOT}/supabase/scripts/_common.sh"
# shellcheck disable=SC1091
source "${REPO_ROOT}/supabase/scripts/auth-fixture-constants.sh"

fail() {
  echo "[boga-mcp-smoke] FAIL: $*" >&2
  if [[ -n "${MCP_LOG_FILE:-}" && -f "${MCP_LOG_FILE}" ]]; then
    tail -n 40 "${MCP_LOG_FILE}" >&2 || true
  fi
  exit 1
}

run_psql() {
  docker exec -i "${DB_CONTAINER}" psql -U postgres -v ON_ERROR_STOP=1 -Atq <<<"$1"
}

cleanup() {
  local status="$?"
  if [[ -n "${MCP_PID:-}" ]] && kill -0 "${MCP_PID}" 2>/dev/null; then
    kill "${MCP_PID}" 2>/dev/null || true
    wait "${MCP_PID}" 2>/dev/null || true
  fi
  if [[ -n "${APP_ACCESS_TOKEN:-}" && -n "${AGENT_CLIENT_ID:-}" ]]; then
    curl --silent --show-error \
      -X DELETE \
      -H "apikey: ${ANON_KEY}" \
      -H "Authorization: Bearer ${APP_ACCESS_TOKEN}" \
      "${API_URL}/auth/v1/user/oauth/grants?client_id=${AGENT_CLIENT_ID}" \
      >/dev/null 2>&1 || true
  fi
  if [[ -n "${RUN_TAG:-}" && -n "${USER_UUID:-}" ]]; then
    run_psql "
      begin;
        set constraints all deferred;
        delete from public.agent_access_audit
          where owner_user_id = '${USER_UUID}'::uuid
            and oauth_client_id = '${AGENT_CLIENT_ID}';
        delete from app_public.exercise_sets
          where owner_user_id = '${USER_UUID}'::uuid and id like 'mcp-smoke-${RUN_TAG}-%';
        delete from app_public.session_exercises
          where owner_user_id = '${USER_UUID}'::uuid and id like 'mcp-smoke-${RUN_TAG}-%';
        delete from app_public.sessions
          where owner_user_id = '${USER_UUID}'::uuid and id like 'mcp-smoke-${RUN_TAG}-%';
        delete from app_public.exercise_definitions
          where owner_user_id = '${USER_UUID}'::uuid and id like 'mcp-smoke-${RUN_TAG}-%';
        delete from app_public.gyms
          where owner_user_id = '${USER_UUID}'::uuid and id like 'mcp-smoke-${RUN_TAG}-%';
      commit;
    " >/dev/null 2>&1 || true
  fi
  [[ -n "${TOKEN_FILE:-}" ]] && rm -f "${TOKEN_FILE}"
  [[ -n "${MCP_LOG_FILE:-}" ]] && rm -f "${MCP_LOG_FILE}"
  exit "${status}"
}
trap cleanup EXIT

echo "[boga-mcp-smoke] preparing local Supabase and service dependencies"
"${REPO_ROOT}/supabase/scripts/ensure-local-runtime-baseline.sh" >/dev/null
load_supabase_status_env
DB_CONTAINER="$(resolve_db_container)"

if [[ ! -d "${REPO_ROOT}/services/boga-mcp/node_modules" ]]; then
  (cd "${REPO_ROOT}/services/boga-mcp" && npm install)
fi
if [[ ! -d "${REPO_ROOT}/apps/agent-auth-web/node_modules" ]]; then
  (cd "${REPO_ROOT}/apps/agent-auth-web" && npm install)
fi

RUN_TAG="${BOGA_MCP_SMOKE_RUN_TAG:-$(date +%s)-$$-$RANDOM}"
RUN_TAG="$(printf '%s' "${RUN_TAG}" | tr -c 'a-zA-Z0-9-' '-')"
MCP_PORT="${BOGA_MCP_SMOKE_PORT:-$((58787 + WORKTREE_SLOT))}"
MCP_URL="http://127.0.0.1:${MCP_PORT}/mcp"
MCP_LOG_FILE="$(mktemp)"
TOKEN_FILE="$(mktemp)"
chmod 600 "${TOKEN_FILE}"
MCP_PID=""
APP_ACCESS_TOKEN=""
AGENT_CLIENT_ID=""

if [[ -n "${BOGA_MCP_SMOKE_ACCESS_TOKEN:-}" ]]; then
  ACCESS_TOKEN="${BOGA_MCP_SMOKE_ACCESS_TOKEN}"
  EXERCISE_ID="${BOGA_MCP_SMOKE_EXERCISE_ID:-}"
  SESSION_ID="${BOGA_MCP_SMOKE_SESSION_ID:-}"
  EXERCISE_QUERY="${BOGA_MCP_SMOKE_EXERCISE_QUERY:-}"
  [[ -n "${EXERCISE_ID}" && -n "${SESSION_ID}" && -n "${EXERCISE_QUERY}" ]] ||
    fail "provided tokens require BOGA_MCP_SMOKE_EXERCISE_ID, SESSION_ID, and EXERCISE_QUERY"
  USER_UUID=""
else
  USER_UUID="$(run_psql "
    select subject_uuid from public.dev_fixture_principals
    where fixture_key = '${USER_A_FIXTURE_KEY}';
  ")"
  [[ -n "${USER_UUID}" ]] || fail "local user A fixture is missing"
  GYM_ID="mcp-smoke-${RUN_TAG}-gym"
  EXERCISE_ID="mcp-smoke-${RUN_TAG}-exercise"
  SESSION_ID="mcp-smoke-${RUN_TAG}-session"
  BLOCK_ID="mcp-smoke-${RUN_TAG}-block"
  SET_ID="mcp-smoke-${RUN_TAG}-set"
  EXERCISE_QUERY="MCP Smoke ${RUN_TAG}"
  NOW_MS="$(($(date +%s) * 1000))"

  run_psql "
    begin;
      set constraints all deferred;
      insert into app_public.gyms
        (owner_user_id,id,name,created_at,updated_at,client_updated_at_ms)
      values
        ('${USER_UUID}'::uuid,'${GYM_ID}','MCP Smoke Gym',${NOW_MS},${NOW_MS},${NOW_MS});
      insert into app_public.exercise_definitions
        (owner_user_id,id,name,load_input_mode,created_at,updated_at,client_updated_at_ms)
      values
        ('${USER_UUID}'::uuid,'${EXERCISE_ID}','${EXERCISE_QUERY}','total_load',
         ${NOW_MS},${NOW_MS},${NOW_MS});
      insert into app_public.sessions
        (owner_user_id,id,gym_id,status,started_at,completed_at,duration_sec,
         created_at,updated_at,client_updated_at_ms)
      values
        ('${USER_UUID}'::uuid,'${SESSION_ID}','${GYM_ID}','completed',
         $((NOW_MS - 900000)),$((NOW_MS - 600000)),300,${NOW_MS},${NOW_MS},${NOW_MS});
      insert into app_public.session_exercises
        (owner_user_id,id,session_id,exercise_definition_id,order_index,name,
         created_at,updated_at,client_updated_at_ms)
      values
        ('${USER_UUID}'::uuid,'${BLOCK_ID}','${SESSION_ID}','${EXERCISE_ID}',0,
         '${EXERCISE_QUERY}',${NOW_MS},${NOW_MS},${NOW_MS});
      insert into app_public.exercise_sets
        (owner_user_id,id,session_exercise_id,order_index,weight_value,reps_value,
         created_at,updated_at,client_updated_at_ms)
      values
        ('${USER_UUID}'::uuid,'${SET_ID}','${BLOCK_ID}',0,'50','10',
         ${NOW_MS},${NOW_MS},${NOW_MS});
    commit;
  " >/dev/null

  (
    cd "${REPO_ROOT}/apps/agent-auth-web"
    BOGA_LOCAL_SUPABASE_URL="${API_URL}" \
    BOGA_LOCAL_SUPABASE_PUBLISHABLE_KEY="${PUBLISHABLE_KEY:-${ANON_KEY}}" \
    BOGA_LOCAL_OAUTH_EMAIL="${USER_A_EMAIL}" \
    BOGA_LOCAL_OAUTH_PASSWORD="${USER_A_PASSWORD}" \
    BOGA_LOCAL_OAUTH_CLIENT_NAME="BoGa MCP smoke ${RUN_TAG}" \
      npx tsx scripts/mint-local-oauth.ts
  ) >"${TOKEN_FILE}"
  ACCESS_TOKEN="$(jq -er '.accessToken' "${TOKEN_FILE}")"
  APP_ACCESS_TOKEN="$(jq -er '.appAccessToken' "${TOKEN_FILE}")"
  AGENT_CLIENT_ID="$(jq -er '.clientId' "${TOKEN_FILE}")"
fi

echo "[boga-mcp-smoke] building and starting the local MCP service"
npm --prefix "${REPO_ROOT}/services/boga-mcp" run build >/dev/null
BOGA_MCP_PUBLIC_URL="http://127.0.0.1:${MCP_PORT}" \
BOGA_AGENT_API_BASE_URL="${API_URL}/functions/v1/agent-api" \
BOGA_OAUTH_ISSUER="${API_URL}/auth/v1" \
PORT="${MCP_PORT}" \
HOST="127.0.0.1" \
  node "${REPO_ROOT}/services/boga-mcp/dist/src/index.js" \
  >"${MCP_LOG_FILE}" 2>&1 &
MCP_PID="$!"

for _attempt in $(seq 1 30); do
  if curl --silent --show-error --fail \
    "http://127.0.0.1:${MCP_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "${MCP_PID}" 2>/dev/null; then
    fail "MCP service exited before becoming ready"
  fi
  sleep 1
done
curl --silent --show-error --fail \
  "http://127.0.0.1:${MCP_PORT}/health" >/dev/null ||
  fail "MCP service did not become ready"

echo "[boga-mcp-smoke] discovering and calling all four tools"
BOGA_MCP_SMOKE_URL="${MCP_URL}" \
BOGA_MCP_SMOKE_ACCESS_TOKEN="${ACCESS_TOKEN}" \
BOGA_MCP_SMOKE_EXERCISE_ID="${EXERCISE_ID}" \
BOGA_MCP_SMOKE_SESSION_ID="${SESSION_ID}" \
BOGA_MCP_SMOKE_EXERCISE_QUERY="${EXERCISE_QUERY}" \
  npm --prefix "${REPO_ROOT}/services/boga-mcp" run smoke-client
