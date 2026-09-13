#!/usr/bin/env bash

# groups-fixtures.sh — shared helpers for the group backend lanes
# (groups-contract.sh, groups-leaderboards.sh). Source it; it runs nothing.
#
# The sourcing lane sets, before calling the helpers:
#   LANE_LABEL            log prefix, e.g. "groups-contract"
#   FIXTURE_EMAIL_PREFIX  per-lane email prefix for provisioned users
#   RUN_TAG, PASSWORD     per-run tag and password (hermetic users)
#   UUID_RE               uuid pattern
#   DB_CONTAINER          this worktree's Postgres container
#   RUN_USER_IDS          array; provision() appends every user it creates
#   API_URL, ANON_KEY, JWT_SECRET  from load_supabase_status_env
#   CUAM                  before any e_* builder (client_updated_at_ms clock)

STATUS=""
BODY=""

fail() {
  echo "[${LANE_LABEL}] FAIL: $*" >&2
  if [[ -n "${BODY}" ]]; then
    echo "[${LANE_LABEL}] last response (HTTP ${STATUS}): ${BODY}" >&2
  fi
  exit 1
}

pass() {
  echo "[${LANE_LABEL}] ok: $*"
}

run_psql() {
  docker exec -i "${DB_CONTAINER}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atq <<<"$1"
}

# --- HTTP helpers --------------------------------------------------------------

# rpc <bearer> <function> <json-body>
rpc() {
  local bearer="$1" name="$2" body="$3" out
  out="$(mktemp)"
  STATUS="$(curl --silent --show-error -X POST \
    -H "apikey: ${ANON_KEY}" \
    -H "Authorization: Bearer ${bearer}" \
    -H "Content-Type: application/json" \
    -H "Content-Profile: app_public" \
    -o "${out}" -w "%{http_code}" \
    --data "${body}" \
    "${API_URL}/rest/v1/rpc/${name}")"
  BODY="$(cat "${out}")"
  rm -f "${out}"
}

# rest <method> <bearer> <table> <query> [json-body]
rest() {
  local method="$1" bearer="$2" table="$3" query="$4" body="${5:-}" out
  out="$(mktemp)"
  local -a args=(--silent --show-error -X "${method}"
    -H "apikey: ${ANON_KEY}"
    -H "Authorization: Bearer ${bearer}"
    -H "Accept-Profile: app_public"
    -H "Content-Profile: app_public"
    -H "Prefer: return=representation"
    -o "${out}" -w "%{http_code}")
  if [[ -n "${body}" ]]; then
    args+=(-H "Content-Type: application/json" --data "${body}")
  fi
  STATUS="$(curl "${args[@]}" "${API_URL}/rest/v1/${table}?${query}")"
  BODY="$(cat "${out}")"
  rm -f "${out}"
}

expect_ok() {
  [[ "${STATUS}" == "200" ]] || fail "$1: expected HTTP 200, got ${STATUS}"
}

# expect_error <TOKEN> <context>
expect_error() {
  local token="$1" context="$2" message
  [[ ! "${STATUS}" =~ ^2 ]] || fail "${context}: expected ${token}, got HTTP ${STATUS}"
  message="$(jq -r '.message // empty' <<<"${BODY}" 2>/dev/null || true)"
  [[ "${message}" == "${token}:"* ]] || fail "${context}: expected ${token}, got '${message}'"
}

# check <context> <jq-filter> [jq args...]
check() {
  local context="$1" filter="$2"
  shift 2
  jq -e "$@" "${filter}" <<<"${BODY}" >/dev/null || fail "${context}"
}

# --- users ---------------------------------------------------------------------

sign_in() {
  local email="$1" out
  out="$(mktemp)"
  STATUS="$(curl --silent --show-error -X POST \
    -H "apikey: ${ANON_KEY}" -H "Content-Type: application/json" \
    -o "${out}" -w "%{http_code}" \
    --data "$(jq -nc --arg e "${email}" --arg p "${PASSWORD}" '{email: $e, password: $p}')" \
    "${API_URL}/auth/v1/token?grant_type=password")"
  BODY="$(cat "${out}")"
  rm -f "${out}"
  [[ "${STATUS}" == "200" ]] || fail "password sign-in for ${email}"
  jq -er '.access_token' <<<"${BODY}"
}

# provision <var-prefix> <label>: sets <prefix>_UID and <prefix>_TOKEN.
provision() {
  local prefix="$1" label="$2" email uid token
  email="${FIXTURE_EMAIL_PREFIX}-${label}-${RUN_TAG}@example.test"
  "${SUPABASE_DIR}/scripts/auth-provision-user.sh" --email "${email}" --password "${PASSWORD}" >/dev/null ||
    fail "provisioning ${email}"
  uid="$(run_psql "select id from auth.users where email = '${email}';")"
  [[ "${uid}" =~ ${UUID_RE} ]] || fail "no auth user id for ${email}"
  RUN_USER_IDS+=("${uid}")
  token="$(sign_in "${email}")"
  printf -v "${prefix}_UID" '%s' "${uid}"
  printf -v "${prefix}_TOKEN" '%s' "${token}"
}

set_username() {
  local uid="$1" username="$2"
  if [[ -z "${username}" ]]; then
    run_psql "insert into app_public.user_profiles (id, username) values ('${uid}', null)
              on conflict (id) do update set username = null;" >/dev/null
  else
    run_psql "insert into app_public.user_profiles (id, username) values ('${uid}', '${username}')
              on conflict (id) do update set username = excluded.username;" >/dev/null
  fi
}

# mint_token <base-access-token> [client_id]: re-signs the user's claims as
# HS256 with the local JWT secret, optionally adding an OAuth client_id.
mint_token() {
  node -e '
    const crypto = require("node:crypto");
    const [token, secret, clientId] = process.argv.slice(1);
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url"));
    if (clientId) claims.client_id = clientId;
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${enc({ alg: "HS256", typ: "JWT" })}.${enc(claims)}`;
    const sig = crypto.createHmac("sha256", secret).update(unsigned).digest("base64url");
    process.stdout.write(`${unsigned}.${sig}`);
  ' "$1" "${JWT_SECRET}" "${2:-}"
}

# --- sync_push envelope builders ---------------------------------------------------

next_cuam() { CUAM=$((CUAM + 1)); }

# e_def <id> <name> <cuam> [load_input_mode]
e_def() {
  jq -nc --arg id "$1" --arg name "$2" --argjson c "$3" --arg m "${4:-}" \
    '{type: "exercise_definitions", id: $id, client_updated_at_ms: $c,
      fields: ({name: $name, created_at: $c, updated_at: $c, deleted_at: null}
               + (if $m == "" then {} else {load_input_mode: $m} end))}'
}
# e_gym <id> <name> <cuam> — carries coordinates so the no-GPS assertions bite.
e_gym() {
  jq -nc --arg id "$1" --arg name "$2" --argjson c "$3" \
    '{type: "gyms", id: $id, client_updated_at_ms: $c,
      fields: {name: $name, latitude: 51.5007, longitude: -0.1246, coordinate_accuracy_m: 12.5,
               coordinates_updated_at: $c, created_at: $c, updated_at: $c, deleted_at: null}}'
}
# e_session <id> <started_ms> <status> <completed_ms|null> <duration|null> <deleted_ms|null> <cuam> [gym]
e_session() {
  jq -nc --arg id "$1" --argjson s "$2" --arg st "$3" --argjson done "$4" --argjson dur "$5" \
    --argjson del "$6" --argjson c "$7" --arg gym "${8:-}" \
    '{type: "sessions", id: $id, client_updated_at_ms: $c,
      fields: {gym_id: (if $gym == "" then null else $gym end), status: $st, started_at: $s,
               completed_at: $done, duration_sec: $dur, created_at: $s, updated_at: $c, deleted_at: $del}}'
}
# e_se <id> <session> <definition|""> <order> <name> <cuam> [deleted_ms]
e_se() {
  jq -nc --arg id "$1" --arg sess "$2" --arg def "$3" --argjson o "$4" --arg name "$5" \
    --argjson c "$6" --argjson del "${7:-null}" \
    '{type: "session_exercises", id: $id, client_updated_at_ms: $c,
      fields: {session_id: $sess, exercise_definition_id: (if $def == "" then null else $def end),
               order_index: $o, name: $name, machine_name: ("Machine " + $name),
               created_at: $c, updated_at: $c, deleted_at: $del}}'
}
# e_set <id> <session_exercise> <order> <weight> <reps> <status|""> <cuam> [deleted_ms] [set_type]
e_set() {
  jq -nc --arg id "$1" --arg se "$2" --argjson o "$3" --arg w "$4" --arg r "$5" --arg ps "$6" \
    --argjson c "$7" --argjson del "${8:-null}" --arg t "${9:-working}" \
    '{type: "exercise_sets", id: $id, client_updated_at_ms: $c,
      fields: {session_exercise_id: $se, order_index: $o, weight_value: $w, reps_value: $r,
               set_type: $t, planned_weight_value: null, planned_reps_value: null, planned_set_type: null,
               performance_status: (if $ps == "" then null else $ps end),
               created_at: $c, updated_at: $c, deleted_at: $del}}'
}
# e_link <definition> <group_id> <group_exercise_id> <cuam> [deleted_ms] [id]
# The id defaults to the client's deterministic `<group_id>:<exercise_definition_id>`.
e_link() {
  jq -nc --arg def "$1" --arg g "$2" --arg gx "$3" --argjson c "$4" --argjson del "${5:-null}" \
    --arg id "${6:-$2:$1}" \
    '{type: "exercise_group_links", id: $id, client_updated_at_ms: $c,
      fields: {exercise_definition_id: $def, group_id: $g, group_exercise_id: $gx,
               created_at: $c, updated_at: $c, deleted_at: $del}}'
}
# push <token> <context> <entity-json>...
push() {
  local token="$1" context="$2"
  shift 2
  rpc "${token}" sync_push "$(printf '%s\n' "$@" | jq -sc '{entities: .}')"
  expect_ok "sync_push: ${context}"
  check "sync_push ack: ${context}" '.ok == true'
}
