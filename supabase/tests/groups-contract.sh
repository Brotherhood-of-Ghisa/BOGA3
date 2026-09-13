#!/usr/bin/env bash

# groups-contract.sh — M22 group domain contract.
#
# Contract: docs/specs/tech/groups-contract.md §2–§5, §8. Proves, against the
# real local Supabase stack through PostgREST:
#
#   - catalog ground rules: RLS on + no policies + no direct grants, no
#     `owner_user_id` column, no FK into the Sync v2 tables, helpers not
#     client-executable, every function SECURITY DEFINER with a pinned
#     search_path, the share trigger's shape and posture;
#   - every membership/invite RPC success path and every error token;
#   - the role matrix (member / admin / owner), leave / rejoin periods,
#     removal, ownership transfer;
#   - invite normalization and regeneration;
#   - non-member ≡ nonexistent (byte-identical NOT_FOUND bodies);
#   - (M22-T02) the share rule, flow-through, the raw-set card and
#     friend-session detail payloads, and stream order/dedupe/pagination/scope
#     — all driven by real `sync_push` calls; share trigger failure isolation
#     and self-heal;
#   - AUTH_REQUIRED (anon) and AGENT_FORBIDDEN (client_id token) on every RPC;
#   - direct PostgREST select/insert/update/delete denial on every group table;
#   - (M25-T02) the persistent stream `group_events`: catalog posture, one item
#     per membership edge and per share, no duplicates on re-push, event
#     trigger failure isolation and self-heal, and a backfill that rebuilds
#     every user's stream byte-identical.
#   - (M25-T01) group exercises: the shared ExerciseCore vectors
#     (apps/mobile/src/exercise-core/exercise-core-vectors.json) through
#     group_exercise_create and the table CHECKs, the role matrix, targets,
#     update, and the archive round trip.
#
# Hermetic: every run provisions its own seven users (owner, admin, member,
# outsider, joiner, athlete, viewer) with a per-run tag, never reads fixture
# users, and deletes its users, groups, and diagnostics rows on exit. Repeated
# runs in one slot pass without a reset.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"

STATUS=""
BODY=""

fail() {
  echo "[groups-contract] FAIL: $*" >&2
  if [[ -n "${BODY}" ]]; then
    echo "[groups-contract] last response (HTTP ${STATUS}): ${BODY}" >&2
  fi
  exit 1
}

pass() {
  echo "[groups-contract] ok: $*"
}

for cmd in curl docker jq node; do
  command -v "${cmd}" >/dev/null 2>&1 || fail "${cmd} is required"
done

load_supabase_status_env
[[ -n "${API_URL:-}" && -n "${ANON_KEY:-}" && -n "${SERVICE_ROLE_KEY:-}" ]] ||
  fail "local Supabase status env is incomplete (API_URL/ANON_KEY/SERVICE_ROLE_KEY)"
[[ -n "${JWT_SECRET:-}" ]] ||
  fail "JWT_SECRET missing from 'supabase status'; it is required to mint the client_id probe token"
DB_CONTAINER="$(resolve_db_container)" || exit 1

run_psql() {
  docker exec -i "${DB_CONTAINER}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atq <<<"$1"
}

RUN_TAG="${GROUPS_CONTRACT_RUN_TAG:-$(date +%s)-$$-${RANDOM}}"
RUN_TAG="$(printf '%s' "${RUN_TAG}" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9-' '-')"
PASSWORD="GroupsContract!${RUN_TAG}"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
CODE_RE='^[0-9A-HJKMNP-TV-Z]{8}$'
MISSING_GROUP="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"

RUN_USER_IDS=()
FORCE_FAIL_CONSTRAINT="groups_contract_force_share_failure"
FORCE_EVENT_FAIL_CONSTRAINT="groups_contract_force_event_failure"

cleanup() {
  # Always remove the failure-isolation probe constraints, even if the run died
  # between adding and dropping them.
  run_psql "set client_min_messages = warning;
            alter table app_public.group_session_shares drop constraint if exists ${FORCE_FAIL_CONSTRAINT};
            alter table app_public.group_events drop constraint if exists ${FORCE_EVENT_FAIL_CONSTRAINT};" >/dev/null
  [[ ${#RUN_USER_IDS[@]} -gt 0 ]] || return 0
  local ids
  ids="$(printf "'%s'::uuid," "${RUN_USER_IDS[@]}")"
  ids="${ids%,}"
  run_psql "
    begin;
      delete from public.app_logs
       where event in ('group.share_failed', 'group.event_failed') and user_id in (${ids});
      delete from app_public.groups
       where created_by in (${ids})
          or id in (select group_id from app_public.group_memberships where user_id in (${ids}));
      delete from auth.users where id in (${ids});
    commit;
  " >/dev/null
}

cleanup_on_exit() {
  local status=$?
  trap - EXIT
  if ! cleanup; then
    echo "[groups-contract] FAIL: cleanup of run ${RUN_TAG} users/groups failed" >&2
    [[ ${status} -ne 0 ]] || status=1
  fi
  exit "${status}"
}
trap cleanup_on_exit EXIT

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

# --- body builders -------------------------------------------------------------

b_group() { jq -nc --arg g "$1" '{p_group_id: $g}'; }
b_code() { jq -nc --arg c "$1" '{p_code: $c}'; }
b_target() { jq -nc --arg g "$1" --arg u "$2" '{p_group_id: $g, p_user_id: $u}'; }
b_role() { jq -nc --arg g "$1" --arg u "$2" --arg r "$3" '{p_group_id: $g, p_user_id: $u, p_role: $r}'; }
b_create() { jq -nc --arg n "$1" --arg d "$2" '{p_name: $n, p_description: $d}'; }
b_update() { jq -nc --arg g "$1" --arg n "$2" --arg d "$3" '{p_group_id: $g, p_name: $n, p_description: $d}'; }

repeat_char() { node -e 'process.stdout.write(process.argv[1].repeat(Number(process.argv[2])))' "$1" "$2"; }
lower() { printf '%s' "$1" | tr 'A-Z' 'a-z'; }

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
  email="groups-${label}-${RUN_TAG}@example.test"
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

# =============================================================================
echo "[groups-contract] run ${RUN_TAG}: catalog ground rules"
# =============================================================================

GROUP_TABLES="'groups','group_memberships','group_invites','group_session_shares','group_exercises'"
SYNC_TABLES="'gyms','exercise_definitions','muscle_groups','exercise_tag_definitions','sessions','exercise_muscle_mappings','session_exercises','exercise_sets','session_exercise_tags'"

[[ "$(run_psql "
  select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app_public' and c.relname in (${GROUP_TABLES})
     and c.relkind = 'r' and c.relrowsecurity;")" == "5" ]] ||
  fail "RLS is not enabled on all five group tables"
[[ "$(run_psql "select count(*) from pg_policies where schemaname = 'app_public' and tablename in (${GROUP_TABLES});")" == "0" ]] ||
  fail "group tables must have no RLS policies"
[[ "$(run_psql "
  select count(*) from unnest(array['anon','authenticated']) r(role)
   cross join unnest(array['groups','group_memberships','group_invites','group_session_shares','group_exercises']) t(name)
   where has_table_privilege(r.role, 'app_public.' || t.name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');")" == "0" ]] ||
  fail "anon/authenticated hold a direct privilege on a group table"
[[ "$(run_psql "select count(*) from information_schema.columns
   where table_schema = 'app_public' and table_name in (${GROUP_TABLES}) and column_name = 'owner_user_id';")" == "0" ]] ||
  fail "a group table carries an owner_user_id column (ground rule 1)"
[[ "$(run_psql "
  select count(*) from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_class r on r.oid = con.confrelid
    join pg_namespace n on n.oid = r.relnamespace
   where con.contype = 'f' and c.relname in (${GROUP_TABLES})
     and n.nspname = 'app_public' and r.relname in (${SYNC_TABLES});")" == "0" ]] ||
  fail "a group table has an FK into a Sync v2 table (ground rule 2)"

RPCS=(group_list_mine group_get group_invite_preview group_invite_get group_create group_update
  group_invite_regenerate group_join group_leave group_remove_member group_set_role group_transfer_ownership
  group_stream group_session_detail
  group_exercise_list group_exercise_create group_exercise_update group_exercise_archive group_exercise_unarchive)
HELPERS=(group_require_app_user group_active_role group_require_member group_require_username
  group_validate_name group_validate_description group_normalize_invite_code group_generate_invite_code
  group_write_invite_code group_summary_json group_members_json group_detail_json group_require_target
  group_share_session group_session_exercises_json group_member_ref_json group_session_card_json
  group_exercise_trim group_exercise_validate_name group_exercise_validate_load_input_mode
  group_exercise_validate_source_id group_exercise_require_manager group_exercise_require group_exercise_json)
rpc_list="$(printf "'%s'," "${RPCS[@]}")"
helper_list="$(printf "'%s'," "${HELPERS[@]}")"
[[ "$(run_psql "
  select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_public' and p.proname in (${rpc_list%,})
     and p.prosecdef and 'search_path=app_public, pg_temp' = any(p.proconfig)
     and has_function_privilege('anon', p.oid, 'EXECUTE')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE');")" == "${#RPCS[@]}" ]] ||
  fail "every group RPC must be SECURITY DEFINER, search_path-pinned, and executable by anon+authenticated"
[[ "$(run_psql "
  select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_public' and p.proname in (${helper_list%,})
     and 'search_path=app_public, pg_temp' = any(p.proconfig)
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE');")" == "${#HELPERS[@]}" ]] ||
  fail "every internal group helper must be search_path-pinned and not client-executable"
[[ "$(run_psql "
  select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_public' and p.prosecdef
     and p.proname in ('group_exercise_require_manager', 'group_exercise_require', 'group_exercise_json');")" == "0" ]] ||
  fail "the group-exercise helpers run only inside the definer RPCs and must not be SECURITY DEFINER"
# The share trigger: AFTER INSERT OR UPDATE, FOR EACH ROW (tgtype ROW=1 |
# INSERT=4 | UPDATE=16 = 21, no BEFORE bit), enabled, on app_public.sessions,
# calling the SECURITY DEFINER group_share_session.
[[ "$(run_psql "
  select count(*) from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'app_public.sessions'::regclass
     and t.tgname = 'sessions_group_share_session'
     and not t.tgisinternal and t.tgenabled = 'O' and t.tgtype = 21
     and p.proname = 'group_share_session' and p.prosecdef
     and 'search_path=app_public, pg_temp' = any(p.proconfig);")" == "1" ]] ||
  fail "sessions_group_share_session must be an enabled AFTER INSERT OR UPDATE row trigger calling SECURITY DEFINER group_share_session"
pass "RLS on, no policies, no grants, no owner_user_id, no Sync v2 FK, function and trigger posture"

[[ "$(run_psql "select app_public.group_normalize_invite_code(E' ab-cd\toil- ');")" == "ABCD011" ]] ||
  fail "invite normalizer must upper-case, strip whitespace/dashes, and map O→0, I/L→1"
[[ "$(run_psql "select count(*) from generate_series(1, 200) s
   where app_public.group_generate_invite_code() !~ '${CODE_RE}';")" == "0" ]] ||
  fail "invite generator produced a code outside the Crockford base32 alphabet"
pass "invite normalizer and generator"

if helper_out="$(run_psql "
  begin;
  select set_config('request.jwt.claims', '{\"sub\":\"${MISSING_GROUP}\",\"role\":\"authenticated\",\"client_id\":\"probe\"}', true);
  select app_public.group_active_role('${MISSING_GROUP}'::uuid, '${MISSING_GROUP}'::uuid);
  rollback;" 2>&1)"; then
  fail "group_active_role must reject a client_id claim (spec 10 rule 17)"
fi
[[ "${helper_out}" == *"AGENT_FORBIDDEN:"* ]] ||
  fail "group_active_role must fail with AGENT_FORBIDDEN for a client_id claim, got: ${helper_out}"
pass "group_active_role helper rejects OAuth client_id claims"

# =============================================================================
echo "[groups-contract] provisioning per-run users"
# =============================================================================

provision OWNER owner
provision ADMIN admin
provision MEMBER member
provision OUTSIDER outsider
provision JOINER joiner
provision ATHLETE athlete
provision VIEWER viewer
set_username "${OWNER_UID}" "owner-${RUN_TAG}"
set_username "${ADMIN_UID}" "admin-${RUN_TAG}"
set_username "${MEMBER_UID}" "Z-member-${RUN_TAG}"
set_username "${JOINER_UID}" ""   # profile row with a null username
set_username "${ATHLETE_UID}" "athlete-${RUN_TAG}"
set_username "${VIEWER_UID}" "viewer-${RUN_TAG}"
# OUTSIDER has no profile row at all.
pass "seven users provisioned (tag ${RUN_TAG})"

# =============================================================================
echo "[groups-contract] group_create"
# =============================================================================

rpc "${OUTSIDER_TOKEN}" group_create "$(b_create "Nope ${RUN_TAG}" "")"
expect_error USERNAME_REQUIRED "create without a profile row"
rpc "${JOINER_TOKEN}" group_create "$(b_create "Nope ${RUN_TAG}" "")"
expect_error USERNAME_REQUIRED "create with a null username"

rpc "${OWNER_TOKEN}" group_create "$(b_create "" "")"
expect_error VALIDATION "create with empty name"
rpc "${OWNER_TOKEN}" group_create "$(b_create "    " "")"
expect_error VALIDATION "create with blank name"
rpc "${OWNER_TOKEN}" group_create "$(jq -nc '{p_name: null, p_description: null}')"
expect_error VALIDATION "create with null name"
rpc "${OWNER_TOKEN}" group_create "$(b_create "$(repeat_char x 51)" "")"
expect_error VALIDATION "create with 51-char name"
rpc "${OWNER_TOKEN}" group_create "$(b_create "ok ${RUN_TAG}" "$(repeat_char d 281)")"
expect_error VALIDATION "create with 281-char description"

G_NAME="Groups ${RUN_TAG}"
rpc "${OWNER_TOKEN}" group_create "$(b_create "   ${G_NAME}   " "   ")"
expect_ok "owner creates group"
G="$(jq -r '.group_id' <<<"${BODY}")"
[[ "${G}" =~ ${UUID_RE} ]] || fail "group_create must return { group_id }"
check "group_create returns only group_id" 'keys == ["group_id"]'
[[ "$(run_psql "select name = '${G_NAME}' and description is null and created_by = '${OWNER_UID}'
                 from app_public.groups where id = '${G}';")" == "t" ]] ||
  fail "created group must store the trimmed name, a null description, and created_by"
[[ "$(run_psql "select string_agg(user_id::text || ':' || role, ',') from app_public.group_memberships
                 where group_id = '${G}' and ended_at is null;")" == "${OWNER_UID}:owner" ]] ||
  fail "creator must hold the single active owner period"

SOLO_NAME="$(printf 'alpha solo %s %s' "${RUN_TAG}" "$(repeat_char s 50)" | cut -c1-50)"
rpc "${OWNER_TOKEN}" group_create "$(b_create "${SOLO_NAME}" "A solo group")"
expect_ok "owner creates a 50-char-name group"
SOLO="$(jq -r '.group_id' <<<"${BODY}")"
pass "create: USERNAME_REQUIRED, VALIDATION bounds, trim, owner period"

# =============================================================================
echo "[groups-contract] group_list_mine / group_invite_get / normalization"
# =============================================================================

rpc "${OWNER_TOKEN}" group_list_mine '{}'
expect_ok "owner list_mine"
check "list_mine sorts by name case-insensitively and returns GroupSummary" \
  '.groups | map(.group_id) == [$solo, $g]
   and all(.[]; .my_role == "owner" and .member_count == 1)
   and (.[1] | keys == ["description","group_id","member_count","my_role","name"])
   and .[1].name == $name and .[1].description == null and .[0].description == "A solo group"' \
  --arg solo "${SOLO}" --arg g "${G}" --arg name "${G_NAME}"

rpc "${OUTSIDER_TOKEN}" group_list_mine '{}'
expect_ok "outsider list_mine"
check "outsider has no groups" '.groups == []'

rpc "${OWNER_TOKEN}" group_invite_get "$(b_group "${G}")"
expect_ok "owner invite_get"
RAW_CODE="$(jq -r '.code' <<<"${BODY}")"
[[ "${RAW_CODE}" =~ ${CODE_RE} ]] || fail "invite code '${RAW_CODE}' is not 8 Crockford base32 chars"
check "invite_get returns only code" 'keys == ["code"]'

# Pin the code to contain 0 and 1 so the O/I/L mapping is exercised end-to-end.
CODE="01${RAW_CODE:2}"
run_psql "update app_public.group_invites set code = '${CODE}' where group_id = '${G}';" >/dev/null
REST="${CODE:2}"
MANGLED_I=" oi$(lower "${REST:0:2}")-$(lower "${REST:2:2}") $(lower "${REST:4}")- "
MANGLED_L="OL-${REST}"

rpc "${ADMIN_TOKEN}" group_invite_preview "$(b_code "${MANGLED_I}")"
expect_ok "preview with lower-case, spaces, dashes, o/i"
check "preview shape for a non-member" \
  '. == {group_id: $g, name: $name, member_count: 1, already_member: false}' \
  --arg g "${G}" --arg name "${G_NAME}"
pass "list_mine ordering, invite_get format, preview normalization"

# =============================================================================
echo "[groups-contract] group_join"
# =============================================================================

rpc "${ADMIN_TOKEN}" group_join "$(b_code "${MANGLED_L}")"
expect_ok "admin joins with an O/L-mangled code"
check "first join returns joined:true" '. == {group_id: $g, joined: true}' --arg g "${G}"
rpc "${ADMIN_TOKEN}" group_join "$(b_code "${CODE}")"
expect_ok "admin joins again"
check "second join is a no-op returning joined:false" '. == {group_id: $g, joined: false}' --arg g "${G}"
[[ "$(run_psql "select count(*) from app_public.group_memberships where group_id = '${G}' and user_id = '${ADMIN_UID}';")" == "1" ]] ||
  fail "a repeat join must not insert a second period"

rpc "${OWNER_TOKEN}" group_invite_preview "$(b_code "${CODE}")"
expect_ok "owner preview"
check "preview reports already_member and active member_count" \
  '.already_member == true and .member_count == 2'

rpc "${MEMBER_TOKEN}" group_join "$(b_code "${CODE}")"
expect_ok "member joins"
rpc "${JOINER_TOKEN}" group_join "$(b_code "${CODE}")"
expect_error USERNAME_REQUIRED "join with a null username"
rpc "${OUTSIDER_TOKEN}" group_join "$(b_code "${CODE}")"
expect_error USERNAME_REQUIRED "join without a profile row"
set_username "${JOINER_UID}" "b-joiner-${RUN_TAG}"
rpc "${JOINER_TOKEN}" group_join "$(b_code "${CODE}")"
expect_ok "joiner joins after setting a username"
check "joiner joined" '.joined == true'
[[ "$(run_psql "select role from app_public.group_memberships
                 where group_id = '${G}' and user_id = '${JOINER_UID}' and ended_at is null;")" == "member" ]] ||
  fail "join must insert a member period"
pass "join: normalization, joined:false no-op, USERNAME_REQUIRED"

# =============================================================================
echo "[groups-contract] group_get and member ordering"
# =============================================================================

rpc "${OWNER_TOKEN}" group_set_role "$(b_role "${G}" "${ADMIN_UID}" admin)"
expect_ok "owner promotes admin"
check "set_role returns { group, members } with the new role" \
  '(keys == ["group","members"]) and .group.my_role == "owner"
   and (.members[] | select(.user_id == $a) | .role) == "admin"' --arg a "${ADMIN_UID}"

rpc "${MEMBER_TOKEN}" group_get "$(b_group "${G}")"
expect_ok "member group_get"
check "group_get: summary + members owner→admin→members, usernames case-insensitive" \
  '.group == {group_id: $g, name: $name, description: null, member_count: 4, my_role: "member"}
   and (.members | map(.user_id)) == [$o, $a, $j, $m]
   and (.members | map(.role)) == ["owner","admin","member","member"]
   and .members[3].username == $mname
   and (.members[0] | keys == ["role","user_id","username"])' \
  --arg g "${G}" --arg name "${G_NAME}" --arg o "${OWNER_UID}" --arg a "${ADMIN_UID}" \
  --arg j "${JOINER_UID}" --arg m "${MEMBER_UID}" --arg mname "Z-member-${RUN_TAG}"

set_username "${JOINER_UID}" ""
rpc "${MEMBER_TOKEN}" group_get "$(b_group "${G}")"
expect_ok "member group_get after joiner cleared username"
check "null usernames sort last and are returned as null" \
  '(.members | map(.user_id)) == [$o, $a, $m, $j] and .members[3].username == null' \
  --arg o "${OWNER_UID}" --arg a "${ADMIN_UID}" --arg j "${JOINER_UID}" --arg m "${MEMBER_UID}"
set_username "${JOINER_UID}" "b-joiner-${RUN_TAG}"
pass "group_get shape and ordering"

# =============================================================================
echo "[groups-contract] role matrix: member"
# =============================================================================

rpc "${MEMBER_TOKEN}" group_invite_get "$(b_group "${G}")"
expect_error FORBIDDEN "member invite_get"
rpc "${MEMBER_TOKEN}" group_invite_regenerate "$(b_group "${G}")"
expect_error FORBIDDEN "member invite_regenerate"
rpc "${MEMBER_TOKEN}" group_update "$(b_update "${G}" "Hijack" "")"
expect_error FORBIDDEN "member update"
rpc "${MEMBER_TOKEN}" group_remove_member "$(b_target "${G}" "${ADMIN_UID}")"
expect_error FORBIDDEN "member removes admin"
rpc "${MEMBER_TOKEN}" group_remove_member "$(b_target "${G}" "${JOINER_UID}")"
expect_error FORBIDDEN "member removes member"
rpc "${MEMBER_TOKEN}" group_set_role "$(b_role "${G}" "${JOINER_UID}" admin)"
expect_error FORBIDDEN "member set_role"
rpc "${MEMBER_TOKEN}" group_transfer_ownership "$(b_target "${G}" "${ADMIN_UID}")"
expect_error FORBIDDEN "member transfer"
[[ "$(run_psql "select name from app_public.groups where id = '${G}';")" == "${G_NAME}" ]] ||
  fail "a forbidden update changed the group"
pass "member gets FORBIDDEN on every privileged write"

# =============================================================================
echo "[groups-contract] role matrix: admin"
# =============================================================================

rpc "${ADMIN_TOKEN}" group_invite_get "$(b_group "${G}")"
expect_ok "admin invite_get"
check "admin sees the current code" '.code == $c' --arg c "${CODE}"

G_NAME="Groups edited ${RUN_TAG}"
DESC280="$(repeat_char e 280)"
rpc "${ADMIN_TOKEN}" group_update "$(b_update "${G}" "  ${G_NAME} " "${DESC280}")"
expect_ok "admin update with a 280-char description"
check "update returns { group: GroupSummary }" \
  '. == {group: {group_id: $g, name: $name, description: $d, member_count: 4, my_role: "admin"}}' \
  --arg g "${G}" --arg name "${G_NAME}" --arg d "${DESC280}"
rpc "${ADMIN_TOKEN}" group_update "$(b_update "${G}" "$(repeat_char n 51)" "")"
expect_error VALIDATION "update with 51-char name"
rpc "${ADMIN_TOKEN}" group_update "$(b_update "${G}" " " "")"
expect_error VALIDATION "update with blank name"
rpc "${ADMIN_TOKEN}" group_update "$(b_update "${G}" "${G_NAME}" "$(repeat_char e 281)")"
expect_error VALIDATION "update with 281-char description"

rpc "${ADMIN_TOKEN}" group_remove_member "$(b_target "${G}" "${OWNER_UID}")"
expect_error FORBIDDEN "admin removes owner"
rpc "${OWNER_TOKEN}" group_set_role "$(b_role "${G}" "${JOINER_UID}" admin)"
expect_ok "owner promotes joiner to a second admin"
rpc "${ADMIN_TOKEN}" group_remove_member "$(b_target "${G}" "${JOINER_UID}")"
expect_error FORBIDDEN "admin removes another admin"
rpc "${ADMIN_TOKEN}" group_set_role "$(b_role "${G}" "${MEMBER_UID}" admin)"
expect_error FORBIDDEN "admin set_role"
rpc "${ADMIN_TOKEN}" group_transfer_ownership "$(b_target "${G}" "${MEMBER_UID}")"
expect_error FORBIDDEN "admin transfer"
rpc "${ADMIN_TOKEN}" group_remove_member "$(b_target "${G}" "${ADMIN_UID}")"
expect_error VALIDATION "admin removes self"
rpc "${OWNER_TOKEN}" group_set_role "$(b_role "${G}" "${JOINER_UID}" member)"
expect_ok "owner demotes joiner"
check "demoted joiner is a member" '(.members[] | select(.user_id == $j) | .role) == "member"' --arg j "${JOINER_UID}"
pass "admin: invite/update allowed; cannot remove admin/owner, set_role, transfer"

# =============================================================================
echo "[groups-contract] role matrix: owner validation / target checks"
# =============================================================================

rpc "${OWNER_TOKEN}" group_set_role "$(b_role "${G}" "${JOINER_UID}" owner)"
expect_error VALIDATION "set_role to owner"
rpc "${OWNER_TOKEN}" group_set_role "$(b_role "${G}" "${JOINER_UID}" superuser)"
expect_error VALIDATION "set_role to an unknown role"
rpc "${OWNER_TOKEN}" group_set_role "$(b_role "${G}" "${OWNER_UID}" admin)"
expect_error VALIDATION "owner set_role on self"
rpc "${OWNER_TOKEN}" group_set_role "$(b_role "${G}" "${OUTSIDER_UID}" admin)"
expect_error NOT_FOUND "set_role on a non-member"
rpc "${OWNER_TOKEN}" group_remove_member "$(b_target "${G}" "${OWNER_UID}")"
expect_error VALIDATION "owner removes self"
rpc "${OWNER_TOKEN}" group_remove_member "$(b_target "${G}" "${MISSING_GROUP}")"
expect_error NOT_FOUND "remove a nonexistent user"
rpc "${OWNER_TOKEN}" group_transfer_ownership "$(b_target "${G}" "${OWNER_UID}")"
expect_error VALIDATION "owner transfers to self"
rpc "${OWNER_TOKEN}" group_transfer_ownership "$(b_target "${G}" "${OUTSIDER_UID}")"
expect_error NOT_FOUND "transfer to a non-member"
pass "owner writes: VALIDATION for self/role value, NOT_FOUND for non-member targets"

# =============================================================================
echo "[groups-contract] invite regeneration"
# =============================================================================

OLD_CODE="${CODE}"
rpc "${ADMIN_TOKEN}" group_invite_regenerate "$(b_group "${G}")"
expect_ok "admin regenerates the invite"
CODE="$(jq -r '.code' <<<"${BODY}")"
[[ "${CODE}" =~ ${CODE_RE} && "${CODE}" != "${OLD_CODE}" ]] || fail "regenerate must return a new valid code"
rpc "${OWNER_TOKEN}" group_invite_get "$(b_group "${G}")"
expect_ok "owner invite_get after regenerate"
check "invite_get returns the regenerated code" '.code == $c' --arg c "${CODE}"
rpc "${OUTSIDER_TOKEN}" group_invite_preview "$(b_code "${OLD_CODE}")"
expect_error INVITE_INVALID "preview with the regenerated-away code"
rpc "${MEMBER_TOKEN}" group_join "$(b_code "${OLD_CODE}")"
expect_error INVITE_INVALID "join with the regenerated-away code"
rpc "${OUTSIDER_TOKEN}" group_invite_preview "$(b_code "UUUUUUUU")"
expect_error INVITE_INVALID "preview with a code outside the alphabet"
rpc "${OUTSIDER_TOKEN}" group_invite_preview "$(b_code "")"
expect_error INVITE_INVALID "preview with an empty code"
rpc "${OUTSIDER_TOKEN}" group_invite_preview "$(b_code "$(lower "${CODE}")")"
expect_ok "outsider (no username) may preview"
check "outsider preview" '.group_id == $g and .already_member == false and .member_count == 4' --arg g "${G}"
pass "regenerate invalidates the old code; INVITE_INVALID for unknown codes"

# =============================================================================
echo "[groups-contract] non-member ≡ nonexistent"
# =============================================================================

rpc "${OUTSIDER_TOKEN}" group_get "$(b_group "${G}")"
expect_error NOT_FOUND "outsider group_get"
NM_STATUS="${STATUS}"
NM_BODY="${BODY}"
rpc "${OUTSIDER_TOKEN}" group_get "$(b_group "${MISSING_GROUP}")"
expect_error NOT_FOUND "group_get of a nonexistent id"
[[ "${STATUS}" == "${NM_STATUS}" && "${BODY}" == "${NM_BODY}" ]] ||
  fail "group_get: non-member and nonexistent responses differ (${NM_STATUS} ${NM_BODY} vs ${STATUS} ${BODY})"

rpc "${OUTSIDER_TOKEN}" group_invite_get "$(b_group "${G}")"
expect_error NOT_FOUND "outsider invite_get"
NM_STATUS="${STATUS}"
NM_BODY="${BODY}"
rpc "${OUTSIDER_TOKEN}" group_invite_get "$(b_group "${MISSING_GROUP}")"
expect_error NOT_FOUND "invite_get of a nonexistent id"
[[ "${STATUS}" == "${NM_STATUS}" && "${BODY}" == "${NM_BODY}" ]] ||
  fail "invite_get: non-member and nonexistent responses differ"

rpc "${OUTSIDER_TOKEN}" group_update "$(b_update "${G}" "Hijack" "")"
expect_error NOT_FOUND "outsider update"
rpc "${OUTSIDER_TOKEN}" group_invite_regenerate "$(b_group "${G}")"
expect_error NOT_FOUND "outsider regenerate"
rpc "${OUTSIDER_TOKEN}" group_leave "$(b_group "${G}")"
expect_error NOT_FOUND "outsider leave"
rpc "${OUTSIDER_TOKEN}" group_remove_member "$(b_target "${G}" "${MEMBER_UID}")"
expect_error NOT_FOUND "outsider remove"
rpc "${OUTSIDER_TOKEN}" group_set_role "$(b_role "${G}" "${MEMBER_UID}" admin)"
expect_error NOT_FOUND "outsider set_role"
rpc "${OUTSIDER_TOKEN}" group_transfer_ownership "$(b_target "${G}" "${MEMBER_UID}")"
expect_error NOT_FOUND "outsider transfer"
pass "non-member gets NOT_FOUND, byte-identical to a nonexistent group"

# =============================================================================
echo "[groups-contract] leave and rejoin"
# =============================================================================

rpc "${ADMIN_TOKEN}" group_leave "$(b_group "${G}")"
expect_ok "admin leaves"
check "leave returns { group_id }" '. == {group_id: $g}' --arg g "${G}"
rpc "${ADMIN_TOKEN}" group_get "$(b_group "${G}")"
expect_error NOT_FOUND "former member group_get"
rpc "${ADMIN_TOKEN}" group_list_mine '{}'
expect_ok "former member list_mine"
check "former member no longer lists the group" '.groups == []'
[[ "$(run_psql "select role || ':' || end_reason || ':' || coalesce(ended_by::text, 'null')
                 from app_public.group_memberships
                where group_id = '${G}' and user_id = '${ADMIN_UID}';")" == "admin:left:null" ]] ||
  fail "leave must end the period with 'left' and freeze the role"

rpc "${ADMIN_TOKEN}" group_join "$(b_code "${CODE}")"
expect_ok "former admin rejoins"
check "rejoin inserts a period" '.joined == true'
[[ "$(run_psql "select string_agg(role || ':' || coalesce(end_reason, 'active'), ',' order by joined_at)
                 from app_public.group_memberships
                where group_id = '${G}' and user_id = '${ADMIN_UID}';")" == "admin:left,member:active" ]] ||
  fail "rejoin must add a new member period and keep the ended one"
rpc "${ADMIN_TOKEN}" group_get "$(b_group "${G}")"
expect_ok "rejoined member group_get"
check "rejoined as member" '.group.my_role == "member"'
rpc "${OWNER_TOKEN}" group_set_role "$(b_role "${G}" "${ADMIN_UID}" admin)"
expect_ok "owner re-promotes admin"
pass "leave ends the period; rejoin starts a new member period"

# =============================================================================
echo "[groups-contract] removal"
# =============================================================================

rpc "${OWNER_TOKEN}" group_remove_member "$(b_target "${G}" "${JOINER_UID}")"
expect_ok "owner removes joiner"
check "remove returns members without the removed user" \
  '(.members | map(.user_id) | index($j)) == null and .group.member_count == 3' --arg j "${JOINER_UID}"
[[ "$(run_psql "select end_reason || ':' || ended_by from app_public.group_memberships
                where group_id = '${G}' and user_id = '${JOINER_UID}';")" == "removed:${OWNER_UID}" ]] ||
  fail "remove must end the period with 'removed' and ended_by = caller"
rpc "${JOINER_TOKEN}" group_get "$(b_group "${G}")"
expect_error NOT_FOUND "removed member's next group_get"
rpc "${JOINER_TOKEN}" group_list_mine '{}'
expect_ok "removed member list_mine"
check "removed member no longer lists the group" '.groups == []'

rpc "${ADMIN_TOKEN}" group_remove_member "$(b_target "${G}" "${MEMBER_UID}")"
expect_ok "admin removes a member"
[[ "$(run_psql "select end_reason || ':' || ended_by from app_public.group_memberships
                where group_id = '${G}' and user_id = '${MEMBER_UID}';")" == "removed:${ADMIN_UID}" ]] ||
  fail "admin removal must record ended_by = admin"
rpc "${ADMIN_TOKEN}" group_remove_member "$(b_target "${G}" "${MEMBER_UID}")"
expect_error NOT_FOUND "removing an already-removed member"
pass "remove ends the period; removed member gets NOT_FOUND"

# =============================================================================
echo "[groups-contract] owner leave and ownership transfer"
# =============================================================================

rpc "${OWNER_TOKEN}" group_leave "$(b_group "${G}")"
expect_error OWNER_MUST_TRANSFER "owner leaves"
rpc "${OWNER_TOKEN}" group_leave "$(b_group "${SOLO}")"
expect_error OWNER_MUST_TRANSFER "sole owner leaves"

rpc "${OWNER_TOKEN}" group_transfer_ownership "$(b_target "${G}" "${ADMIN_UID}")"
expect_ok "owner transfers to admin"
check "transfer: caller becomes admin, target becomes owner" \
  '.group.my_role == "admin"
   and (.members | map(.user_id)) == [$a, $o]
   and (.members | map(.role)) == ["owner","admin"]' \
  --arg a "${ADMIN_UID}" --arg o "${OWNER_UID}"
[[ "$(run_psql "select string_agg(user_id::text, ',') from app_public.group_memberships
                where group_id = '${G}' and role = 'owner' and ended_at is null;")" == "${ADMIN_UID}" ]] ||
  fail "exactly one active owner after transfer"
rpc "${OWNER_TOKEN}" group_set_role "$(b_role "${G}" "${ADMIN_UID}" member)"
expect_error FORBIDDEN "previous owner can no longer set_role"
rpc "${OWNER_TOKEN}" group_invite_get "$(b_group "${G}")"
expect_ok "previous owner (now admin) invite_get"
rpc "${ADMIN_TOKEN}" group_leave "$(b_group "${G}")"
expect_error OWNER_MUST_TRANSFER "new owner leaves"
rpc "${OWNER_TOKEN}" group_leave "$(b_group "${G}")"
expect_ok "previous owner (now admin) leaves"
pass "OWNER_MUST_TRANSFER (incl. sole owner); transfer demotes the previous owner to admin"

# =============================================================================
echo "[groups-contract] soft-deleted group"
# =============================================================================

rpc "${OWNER_TOKEN}" group_invite_get "$(b_group "${SOLO}")"
expect_ok "solo invite_get"
SOLO_CODE="$(jq -r '.code' <<<"${BODY}")"
run_psql "update app_public.groups set deleted_at = now() where id = '${SOLO}';" >/dev/null
rpc "${OWNER_TOKEN}" group_get "$(b_group "${SOLO}")"
expect_error NOT_FOUND "group_get of a soft-deleted group"
rpc "${OUTSIDER_TOKEN}" group_invite_preview "$(b_code "${SOLO_CODE}")"
expect_error INVITE_INVALID "preview of a soft-deleted group's code"
rpc "${OWNER_TOKEN}" group_list_mine '{}'
expect_ok "owner list_mine after soft delete"
check "soft-deleted group is not listed" '.groups == []'
pass "soft-deleted groups are invisible"

# =============================================================================
# M22-T02: the group record (contract §2.4–§2.5, §4.2, §5)
# =============================================================================

# --- sync_push fixtures ----------------------------------------------------------

CUAM="$(run_psql "select floor(extract(epoch from clock_timestamp()) * 1000)::bigint;")"
next_cuam() { CUAM=$((CUAM + 1)); }

# e_def <id> <name> <cuam>
e_def() {
  jq -nc --arg id "$1" --arg name "$2" --argjson c "$3" \
    '{type: "exercise_definitions", id: $id, client_updated_at_ms: $c,
      fields: {name: $name, created_at: $c, updated_at: $c, deleted_at: null}}'
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
# push <token> <context> <entity-json>...
push() {
  local token="$1" context="$2"
  shift 2
  rpc "${token}" sync_push "$(printf '%s\n' "$@" | jq -sc '{entities: .}')"
  expect_ok "sync_push: ${context}"
  check "sync_push ack: ${context}" '.ok == true'
}
# stream <token> <group|""> [before-json] [limit]
stream() {
  rpc "$1" group_stream "$(jq -nc --arg g "$2" --argjson b "${3:-null}" --argjson l "${4:-null}" \
    '{p_group_id: (if $g == "" then null else $g end), p_before: $b, p_limit: $l}')"
}
# detail <token> <member> <session>
detail() {
  rpc "$1" group_session_detail "$(jq -nc --arg m "$2" --arg s "$3" '{p_member_user_id: $m, p_session_id: $s}')"
}
# shares_of <session>: comma-joined group ids holding a share of the athlete's session, in G_A,G_B order.
shares_of() {
  run_psql "select coalesce(string_agg(t.tag, ',' order by t.tag), '')
              from (select case group_id when '${GA}' then 'A' when '${GB}' then 'B' else group_id::text end as tag
                      from app_public.group_session_shares
                     where member_user_id = '${ATHLETE_UID}' and session_id = '$1') t;"
}
# period_ms <group> <user> <joined_at|ended_at> <floor|ceil>: latest period's boundary in epoch ms.
period_ms() {
  run_psql "select $4(extract(epoch from $3) * 1000)::bigint from app_public.group_memberships
             where group_id = '$1' and user_id = '$2' order by joined_at desc limit 1;"
}
now_floor_ms() { run_psql "select floor(extract(epoch from clock_timestamp()) * 1000)::bigint;"; }

T="t02-${RUN_TAG}"
HOUR=3600000
DAY=86400000
DEF_A="${T}-def-bench"
DEF_B="${T}-def-row"
DEF_C="${T}-def-squat"
GYM="${T}-gym"
GYM_NAME="Athlete Gym ${RUN_TAG}"

# --- groups and memberships --------------------------------------------------------
echo "[groups-contract] share rule (real sync_push; §2.5)"

rpc "${OWNER_TOKEN}" group_create "$(b_create "Record A ${RUN_TAG}" "")"
expect_ok "owner creates record group A"
GA="$(jq -r '.group_id' <<<"${BODY}")"
rpc "${OWNER_TOKEN}" group_create "$(b_create "Record B ${RUN_TAG}" "")"
expect_ok "owner creates record group B"
GB="$(jq -r '.group_id' <<<"${BODY}")"
rpc "${OWNER_TOKEN}" group_invite_get "$(b_group "${GA}")"
expect_ok "invite A"
CODE_A="$(jq -r '.code' <<<"${BODY}")"
rpc "${OWNER_TOKEN}" group_invite_get "$(b_group "${GB}")"
expect_ok "invite B"
CODE_B="$(jq -r '.code' <<<"${BODY}")"
rpc "${VIEWER_TOKEN}" group_join "$(b_code "${CODE_A}")"
expect_ok "viewer joins A"
rpc "${VIEWER_TOKEN}" group_join "$(b_code "${CODE_B}")"
expect_ok "viewer joins B"

# Personal history, started long before any membership: never shared.
next_cuam
push "${ATHLETE_TOKEN}" "catalog + history" \
  "$(e_def "${DEF_A}" "Bench ${RUN_TAG}" "${CUAM}")" \
  "$(e_def "${DEF_B}" "Row ${RUN_TAG}" "${CUAM}")" \
  "$(e_def "${DEF_C}" "Squat ${RUN_TAG}" "${CUAM}")" \
  "$(e_gym "${GYM}" "${GYM_NAME}" "${CUAM}")"
HIST_BASE="$(( $(now_floor_ms) - 30 * DAY ))"
next_cuam
push "${ATHLETE_TOKEN}" "history sessions" \
  "$(e_session "${T}-h1" "${HIST_BASE}" completed "$((HIST_BASE + HOUR))" 3600 null "${CUAM}")" \
  "$(e_se "${T}-h1-a" "${T}-h1" "${DEF_A}" 0 "Bench" "${CUAM}")" \
  "$(e_set "${T}-h1-a1" "${T}-h1-a" 0 100 5 "" "${CUAM}")"

rpc "${ATHLETE_TOKEN}" group_join "$(b_code "${CODE_B}")"
expect_ok "athlete joins B"
T_B_ONLY="$(period_ms "${GB}" "${ATHLETE_UID}" joined_at ceil)"
rpc "${ATHLETE_TOKEN}" group_join "$(b_code "${CODE_A}")"
expect_ok "athlete joins A"
JOIN_A_MS="$(period_ms "${GA}" "${ATHLETE_UID}" joined_at ceil)"
JOIN_B_MS="$(period_ms "${GB}" "${ATHLETE_UID}" joined_at floor)"
[[ "${JOIN_A_MS}" -gt "$((T_B_ONLY + 1))" ]] ||
  fail "join A (${JOIN_A_MS}) must be later than the B-only instant (${T_B_ONLY}); clock gap too small"

# Offline-late: started before joining either group, first pushed after both joins.
next_cuam
push "${ATHLETE_TOKEN}" "pre-join session" \
  "$(e_session "${T}-pre" "$((JOIN_B_MS - 60000))" completed "$((JOIN_B_MS - 1000))" 59 null "${CUAM}")"
[[ "$(shares_of "${T}-pre")" == "" ]] || fail "a session started before joining must never be shared"
# Started while a member of B only, pushed after joining A: shared into B only.
push "${ATHLETE_TOKEN}" "B-only session" \
  "$(e_session "${T}-bonly" "${T_B_ONLY}" completed "$((T_B_ONLY + 1))" 0 null "${CUAM}")"
[[ "$(shares_of "${T}-bonly")" == "B" ]] ||
  fail "a session started before joining A must not be shared into A, got '$(shares_of "${T}-bonly")'"
pass "offline-late sessions are shared only into groups the athlete was in at started_at"

# --- flow-through (#17, #18) --------------------------------------------------------
echo "[groups-contract] flow-through: active → sets → completed → edit → tombstone → undelete"

S1="${T}-s1"
S1_START="$((JOIN_A_MS + 1))"
next_cuam
push "${ATHLETE_TOKEN}" "S1 active with one set" \
  "$(e_session "${S1}" "${S1_START}" active null null null "${CUAM}" "${GYM}")" \
  "$(e_se "${S1}-a" "${S1}" "${DEF_A}" 0 "Athlete Bench ${RUN_TAG}" "${CUAM}")" \
  "$(e_set "${S1}-a1" "${S1}-a" 0 100 5 "" "${CUAM}")"
[[ "$(shares_of "${S1}")" == "A,B" ]] || fail "S1 must be shared into both groups, got '$(shares_of "${S1}")'"
S1_KEY="${ATHLETE_UID}:${S1}"

# card <context> <jq-filter> [args]: asserts on VIEWER's All-stream card for S1.
card() {
  local context="$1" filter="$2"
  shift 2
  stream "${VIEWER_TOKEN}" "" null 50
  expect_ok "viewer stream (${context})"
  check "${context}" "[.items[] | select(.key == \$k)] | length == 1 and (.[0] | ${filter})" --arg k "${S1_KEY}" "$@"
}

card "active card: training now, its one live set as raw synced text" \
  '.status == "active" and .completed_at_ms == null and .duration_sec == null
   and .started_at_ms == $s and .sort_at_ms == $s and .session_id == $sid
   and .member == {user_id: $u, username: $un} and .gym_name == $gym
   and .exercises == [{session_exercise_id: ($sid + "-a"), name: $bench, machine_name: ("Machine " + $bench),
                       order_index: 0,
                       sets: [{set_id: ($sid + "-a1"), order_index: 0, weight_value: "100", reps_value: "5",
                               set_type: "working", performance_status: null}]}]' \
  --argjson s "${S1_START}" --arg sid "${S1}" --arg u "${ATHLETE_UID}" \
  --arg un "athlete-${RUN_TAG}" --arg gym "${GYM_NAME}" --arg bench "Athlete Bench ${RUN_TAG}"

next_cuam
push "${ATHLETE_TOKEN}" "S1 more sets" \
  "$(e_set "${S1}-a2" "${S1}-a" 1 110 5 planned "${CUAM}")" \
  "$(e_set "${S1}-a3" "${S1}-a" 2 110 "" "" "${CUAM}")" \
  "$(e_set "${S1}-a4" "${S1}-a" 3 200 5 "" "${CUAM}" "${CUAM}")" \
  "$(e_se "${S1}-b" "${S1}" "${DEF_B}" 1 "Athlete Row" "${CUAM}")" \
  "$(e_set "${S1}-b1" "${S1}-b" 0 80 5 "" "${CUAM}" null warm_up)" \
  "$(e_se "${S1}-c" "${S1}" "${DEF_C}" 2 "Athlete Squat" "${CUAM}")" \
  "$(e_set "${S1}-c1" "${S1}-c" 0 60 5 "" "${CUAM}")" \
  "$(e_se "${S1}-n" "${S1}" "" 3 "Athlete Freeform" "${CUAM}")" \
  "$(e_set "${S1}-n1" "${S1}-n" 0 40 10 "" "${CUAM}")" \
  "$(e_se "${S1}-e" "${S1}" "${DEF_B}" 4 "Athlete Planned Only" "${CUAM}")" \
  "$(e_set "${S1}-e1" "${S1}-e" 0 50 5 unperformed "${CUAM}")" \
  "$(e_se "${S1}-t" "${S1}" "${DEF_B}" 5 "Athlete Removed" "${CUAM}" "${CUAM}")" \
  "$(e_set "${S1}-t1" "${S1}-t" 0 300 5 "" "${CUAM}")"
card "more sets: every live set raw (planned/blank/unperformed kept; tombstoned set and exercise omitted)" \
  '.status == "active"
   and (.exercises | map(.session_exercise_id)) == [$sid + "-a", $sid + "-b", $sid + "-c", $sid + "-n", $sid + "-e"]
   and (.exercises | map(.sets | map(.set_id))) ==
       [[$sid + "-a1", $sid + "-a2", $sid + "-a3"], [$sid + "-b1"], [$sid + "-c1"], [$sid + "-n1"], [$sid + "-e1"]]
   and (.exercises[0].sets | map([.weight_value, .reps_value, .performance_status]))
       == [["100", "5", null], ["110", "5", "planned"], ["110", "", null]]
   and .exercises[1].sets[0].set_type == "warm_up"
   and .exercises[4].sets[0].performance_status == "unperformed"' \
  --arg sid "${S1}"

next_cuam
push "${ATHLETE_TOKEN}" "S1 completed" \
  "$(e_session "${S1}" "${S1_START}" completed "$((S1_START + HOUR))" 3600 null "${CUAM}" "${GYM}")"
card "completed card" \
  '.status == "completed" and .completed_at_ms == $done and .duration_sec == 3600
   and (.exercises | length) == 5' \
  --argjson done "$((S1_START + HOUR))"

next_cuam
push "${ATHLETE_TOKEN}" "S1 edit bench 100 → 102.5" \
  "$(e_set "${S1}-a1" "${S1}-a" 0 102.5 5 "" "${CUAM}")"
card "an edit flows through: the set's new raw value" \
  '.exercises[0].sets[0] | .set_id == $id and .weight_value == "102.5" and .reps_value == "5"' \
  --arg id "${S1}-a1"

next_cuam
push "${ATHLETE_TOKEN}" "S1 tombstone" \
  "$(e_session "${S1}" "${S1_START}" completed "$((S1_START + HOUR))" 3600 "${CUAM}" "${CUAM}" "${GYM}")"
stream "${VIEWER_TOKEN}" "" null 50
expect_ok "viewer stream after tombstone"
check "a tombstoned session's card is hidden" '[.items[] | select(.key == $k)] == []' --arg k "${S1_KEY}"
detail "${VIEWER_TOKEN}" "${ATHLETE_UID}" "${S1}"
expect_error NOT_FOUND "detail of a tombstoned session"
TOMB_BODY="${BODY}"
[[ "$(shares_of "${S1}")" == "A,B" ]] || fail "a tombstone must keep the share rows"

next_cuam
push "${ATHLETE_TOKEN}" "S1 undelete" \
  "$(e_session "${S1}" "${S1_START}" completed "$((S1_START + HOUR))" 3600 null "${CUAM}" "${GYM}")"
card "undelete restores the card" \
  '.status == "completed" and .exercises[0].sets[0].weight_value == "102.5"'
detail "${VIEWER_TOKEN}" "${ATHLETE_UID}" "${S1}"
expect_ok "detail after undelete"
pass "active/sets/completed/edit/tombstone/undelete all flow through"

# --- detail (§4.2) -------------------------------------------------------------------
echo "[groups-contract] group_session_detail"

detail "${VIEWER_TOKEN}" "${ATHLETE_UID}" "${S1}"
expect_ok "viewer detail of S1"
check "detail: every live set as raw synced text, tombstoned sets and exercises omitted, member's own names" \
  '.session | .session_id == $sid and .member == {user_id: $u, username: $un}
   and .gym_name == $gym and .status == "completed" and .duration_sec == 3600
   and .started_at_ms == $s and .completed_at_ms == ($s + 3600000)
   and (.exercises | map(.name)) == [$bench, "Athlete Row", "Athlete Squat", "Athlete Freeform", "Athlete Planned Only"]
   and (.exercises | map(.order_index)) == [0, 1, 2, 3, 4]
   and .exercises[0] == {session_exercise_id: ($sid + "-a"), name: $bench, machine_name: ("Machine " + $bench),
                         order_index: 0,
                         sets: [{set_id: ($sid + "-a1"), order_index: 0, weight_value: "102.5", reps_value: "5",
                                 set_type: "working", performance_status: null},
                                {set_id: ($sid + "-a2"), order_index: 1, weight_value: "110", reps_value: "5",
                                 set_type: "working", performance_status: "planned"},
                                {set_id: ($sid + "-a3"), order_index: 2, weight_value: "110", reps_value: "",
                                 set_type: "working", performance_status: null}]}
   and .exercises[1].sets == [{set_id: ($sid + "-b1"), order_index: 0, weight_value: "80", reps_value: "5",
                               set_type: "warm_up", performance_status: null}]
   and (.exercises | map(.sets | length)) == [3, 1, 1, 1, 1]' \
  --arg sid "${S1}" --arg u "${ATHLETE_UID}" --arg un "athlete-${RUN_TAG}" --arg gym "${GYM_NAME}" \
  --argjson s "${S1_START}" --arg bench "Athlete Bench ${RUN_TAG}"
check "detail carries no GPS field at any depth" \
  '[.. | objects | keys[]] | map(select(test("lat|lon|coordinate|accuracy"))) == []'
check "detail keys are exactly the contract shape" \
  '(.session | keys) == ["completed_at_ms","duration_sec","exercises","gym_name","member","session_id","started_at_ms","status"]
   and (.session.exercises[0] | keys) == ["machine_name","name","order_index","session_exercise_id","sets"]
   and (.session.exercises[0].sets[0] | keys) == ["order_index","performance_status","reps_value","set_id","set_type","weight_value"]'
stream "${VIEWER_TOKEN}" "" null 50
expect_ok "viewer stream for the GPS check"
check "stream carries no GPS field at any depth" \
  '[.. | objects | keys[]] | map(select(test("lat|lon|coordinate|accuracy"))) == []'

detail "${ATHLETE_TOKEN}" "${ATHLETE_UID}" "${S1}"
expect_ok "the athlete may open their own shared session"
detail "${OUTSIDER_TOKEN}" "${ATHLETE_UID}" "${S1}"
expect_error NOT_FOUND "non-member detail"
NM_BODY="${BODY}"
NM_STATUS="${STATUS}"
detail "${VIEWER_TOKEN}" "${ATHLETE_UID}" "${T}-does-not-exist"
expect_error NOT_FOUND "detail of a nonexistent session"
[[ "${STATUS}" == "${NM_STATUS}" && "${BODY}" == "${NM_BODY}" && "${TOMB_BODY}" == "${NM_BODY}" ]] ||
  fail "detail: non-member, nonexistent, and tombstoned responses differ"
detail "${VIEWER_TOKEN}" "${ATHLETE_UID}" "${T}-pre"
expect_error NOT_FOUND "detail of an existing but unshared session"
[[ "${BODY}" == "${NM_BODY}" ]] || fail "detail: an unshared session must look nonexistent"
detail "${VIEWER_TOKEN}" "${MISSING_GROUP}" "${S1}"
expect_error NOT_FOUND "detail with a nonexistent member"
pass "detail: shape, raw live sets, no GPS, non-member ≡ nonexistent ≡ tombstoned ≡ unshared"

# --- leave / push-after-leave / post-leave / rejoin (§2.5) ----------------------------
echo "[groups-contract] share rule across leave and rejoin"

LATE="${T}-late"
LATE_START="$(now_floor_ms)"
[[ "${LATE_START}" -gt "${JOIN_A_MS}" ]] || fail "late session start must fall inside the membership"
rpc "${ATHLETE_TOKEN}" group_leave "$(b_group "${GB}")"
expect_ok "athlete leaves B"
LEAVE_B_CEIL="$(period_ms "${GB}" "${ATHLETE_UID}" ended_at ceil)"
[[ "$(period_ms "${GB}" "${ATHLETE_UID}" ended_at floor)" -gt "${LATE_START}" ]] ||
  fail "leave (${LEAVE_B_CEIL}) must be later than the late session start (${LATE_START})"
next_cuam
push "${ATHLETE_TOKEN}" "session started as a member, pushed after leaving B" \
  "$(e_session "${LATE}" "${LATE_START}" active null null null "${CUAM}")"
[[ "$(shares_of "${LATE}")" == "A,B" ]] ||
  fail "a session started while a member but pushed after leaving is shared, got '$(shares_of "${LATE}")'"
AFTER="${T}-after"
AFTER_START="$((LEAVE_B_CEIL + 1))"
push "${ATHLETE_TOKEN}" "session started after leaving B" \
  "$(e_session "${AFTER}" "${AFTER_START}" active null null null "${CUAM}")"
[[ "$(shares_of "${AFTER}")" == "A" ]] ||
  fail "a session started after leaving B must not be shared into B, got '$(shares_of "${AFTER}")'"
stream "${VIEWER_TOKEN}" "${GB}" null 50
expect_ok "viewer B stream after the athlete left"
check "shares made before leaving stay visible; post-leave sessions are absent" \
  '(.items | map(select(.kind == "session") | .session_id)) as $ids
   | ($ids | index($s1)) != null and ($ids | index($late)) != null
     and ($ids | index($after)) == null and ($ids | index($bonly)) != null' \
  --arg s1 "${S1}" --arg late "${LATE}" --arg after "${AFTER}" --arg bonly "${T}-bonly"

rpc "${ATHLETE_TOKEN}" group_join "$(b_code "${CODE_B}")"
expect_ok "athlete rejoins B"
REJOIN_B_MS="$(period_ms "${GB}" "${ATHLETE_UID}" joined_at ceil)"
[[ "$(period_ms "${GB}" "${ATHLETE_UID}" joined_at floor)" -gt "${AFTER_START}" ]] ||
  fail "rejoin must be later than the gap session start (${AFTER_START}); clock gap too small"
REJOIN="${T}-rejoin"
next_cuam
push "${ATHLETE_TOKEN}" "session after rejoining, plus a re-push of the gap session" \
  "$(e_session "${REJOIN}" "$((REJOIN_B_MS + 1))" active null null null "${CUAM}")" \
  "$(e_session "${AFTER}" "${AFTER_START}" completed "$((AFTER_START + 1000))" 1 null "${CUAM}")"
[[ "$(shares_of "${REJOIN}")" == "A,B" ]] || fail "rejoining shares new sessions again"
[[ "$(shares_of "${AFTER}")" == "A" ]] || fail "a session started between periods stays unshared on its next write"
pass "push-after-leave shared, post-leave not shared, earlier shares kept, rejoin shares again"

# --- failure isolation + self-heal (§2.5) -----------------------------------------------
echo "[groups-contract] share trigger failure isolation"

FAILS="${T}-fail"
run_psql "alter table app_public.group_session_shares add constraint ${FORCE_FAIL_CONSTRAINT} check (false) not valid;" >/dev/null
next_cuam
push "${ATHLETE_TOKEN}" "push while the share insert is forced to fail" \
  "$(e_session "${FAILS}" "$(now_floor_ms)" active null null null "${CUAM}")" \
  "$(e_se "${FAILS}-a" "${FAILS}" "${DEF_A}" 0 "Bench" "${CUAM}")" \
  "$(e_set "${FAILS}-a1" "${FAILS}-a" 0 60 5 "" "${CUAM}")"
FAIL_CUAM="${CUAM}"
rest GET "${ATHLETE_TOKEN}" sessions "select=id,status,client_updated_at_ms&id=eq.${FAILS}"
expect_ok "owner reads the session written during the failure"
check "sync_push committed the session despite the trigger failure" \
  '. == [{id: $id, status: "active", client_updated_at_ms: $c}]' --arg id "${FAILS}" --argjson c "${FAIL_CUAM}"
[[ "$(shares_of "${FAILS}")" == "" ]] || fail "the forced failure must have prevented the share"
[[ "$(run_psql "select count(*) from public.app_logs
                 where event = 'group.share_failed' and user_id = '${ATHLETE_UID}'
                   and level = 'error' and source = 'database'
                   and context = jsonb_build_object('session_id', '${FAILS}', 'sqlstate', '23514')
                   and message = 'group share trigger failed; the session write committed';")" == "1" ]] ||
  fail "expected exactly one sanitized group.share_failed row (session_id + sqlstate only)"
run_psql "alter table app_public.group_session_shares drop constraint ${FORCE_FAIL_CONSTRAINT};" >/dev/null
next_cuam
push "${ATHLETE_TOKEN}" "next autosave after the fault is removed" \
  "$(e_session "${FAILS}" "$(run_psql "select started_at from app_public.sessions where owner_user_id = '${ATHLETE_UID}' and id = '${FAILS}';")" active null null null "${CUAM}")"
[[ "$(shares_of "${FAILS}")" == "A,B" ]] || fail "the next write must self-heal the missed share, got '$(shares_of "${FAILS}")'"
pass "forced trigger failure: sync_push commits, owner reads the row, share_failed logged, next push self-heals"

# --- stream: order, dedupe, pagination, scope, membership items, removal ----------------
echo "[groups-contract] group_stream"

# The viewer logs a session with the same started_at as S1: a sort_at_ms tie
# the keyset must break by kind then key.
next_cuam
push "${VIEWER_TOKEN}" "viewer session tied with S1" \
  "$(e_session "${T}-v1" "${S1_START}" active null null null "${CUAM}")"

stream "${VIEWER_TOKEN}" "" null 50
expect_ok "viewer All stream (one page)"
FULL="${BODY}"
check "All: has_more false, next_cursor null on the last page" '.has_more == false and .next_cursor == null'
check "All: ordered by sort_at_ms desc, kind asc, key desc" '
  def before($a; $b): ($a.sort_at_ms > $b.sort_at_ms)
    or ($a.sort_at_ms == $b.sort_at_ms and (($a.kind < $b.kind) or ($a.kind == $b.kind and $a.key > $b.key)));
  .items as $xs | ($xs | length) > 10 and all(range(0; ($xs | length) - 1); before($xs[.]; $xs[. + 1]))'
check "All: S1 appears once, listing both groups (dedupe, AC14)" \
  '[.items[] | select(.key == $k)] | length == 1
   and (.[0].groups == [{group_id: $a, name: $an}, {group_id: $b, name: $bn}])' \
  --arg k "${S1_KEY}" --arg a "${GA}" --arg an "Record A ${RUN_TAG}" --arg b "${GB}" --arg bn "Record B ${RUN_TAG}"
check "All: the S1 / viewer-session tie is present and adjacent" \
  '[.items[] | select(.sort_at_ms == $s) | .key] | length == 2' --argjson s "${S1_START}"
check "All: unshared sessions never appear" \
  '[.items[] | select(.kind == "session") | .session_id] as $ids
   | all([$pre, $h1]; . as $x | ($ids | index($x)) == null)' \
  --arg pre "${T}-pre" --arg h1 "${T}-h1"
check "All: membership items for joined and left, keyed <membership_id>:joined|ended" '
  [.items[] | select(.kind == "membership")] as $ms
  | ($ms | all(.key | test("^[0-9a-f-]{36}:(joined|ended)$")))
    and ($ms | all((.event == "joined") == (.key | endswith(":joined"))))
    and ([$ms[] | select(.member.user_id == $ath and .group.group_id == $b) | .event] | sort) == ["joined","joined","left"]
    and ([$ms[] | select(.member.user_id == $ath and .group.group_id == $a) | .event]) == ["joined"]
    and ($ms[0] | keys) == ["event","group","key","kind","member","sort_at_ms"]' \
  --arg ath "${ATHLETE_UID}" --arg a "${GA}" --arg b "${GB}"
check "session card keys are exactly the contract shape" '
  [.items[] | select(.kind == "session")][0] | keys == ["completed_at_ms","duration_sec","exercises","groups",
    "gym_name","key","kind","member","session_id","sort_at_ms","started_at_ms","status"]'

rpc "${VIEWER_TOKEN}" group_stream '{}'
expect_ok "viewer stream with every argument defaulted"
check "defaults: All scope and p_limit 20" \
  '(.items | map(.key)) == ($full.items[:20] | map(.key)) and .has_more == (($full.items | length) > 20)' \
  --argjson full "${FULL}"

# paginate <limit>: walks every page with next_cursor; prints the concatenated keys.
paginate() {
  local limit="$1" cursor="null" pages=0 keys="[]"
  while :; do
    stream "${VIEWER_TOKEN}" "" "${cursor}" "${limit}"
    expect_ok "viewer All page (limit ${limit}, page ${pages})"
    check "page size <= limit" '(.items | length) <= $l' --argjson l "${limit}"
    keys="$(jq -c --argjson acc "${keys}" '$acc + (.items | map(.key))' <<<"${BODY}")"
    pages=$((pages + 1))
    [[ "${pages}" -le 200 ]] || fail "pagination did not terminate"
    if [[ "$(jq -r '.has_more' <<<"${BODY}")" == "true" ]]; then
      check "has_more implies a full page and a cursor" \
        '(.items | length) == $l and .next_cursor == (.items[-1] | {sort_at_ms, kind, key})' --argjson l "${limit}"
      cursor="$(jq -c '.next_cursor' <<<"${BODY}")"
    else
      check "the last page has no cursor" '.next_cursor == null'
      break
    fi
  done
  [[ "${pages}" -gt 1 ]] || fail "limit ${limit} must need more than one page"
  printf '%s' "${keys}"
}
FULL_KEYS="$(jq -c '.items | map(.key)' <<<"${FULL}")"
for limit in 1 3; do
  PAGED_KEYS="$(paginate "${limit}")"
  [[ "${PAGED_KEYS}" == "${FULL_KEYS}" ]] ||
    fail "keyset pagination (limit ${limit}) repeated or skipped items: ${PAGED_KEYS} vs ${FULL_KEYS}"
done
pass "stream order, dedupe, and keyset pagination (limits 1 and 3) with no repeats or gaps"

stream "${VIEWER_TOKEN}" "${GA}" null 50
expect_ok "viewer A-scope stream"
check "per-group scope: only group A's cards and membership items" '
  all(.items[]; if .kind == "session" then .groups == [{group_id: $a, name: $an}] else .group.group_id == $a end)
  and ([.items[] | select(.kind == "session") | .session_id] | index($bonly)) == null
  and ([.items[] | select(.kind == "session") | .session_id] | index($after)) != null' \
  --arg a "${GA}" --arg an "Record A ${RUN_TAG}" --arg bonly "${T}-bonly" --arg after "${AFTER}"

# Cursor and limit validation (VALIDATION after the membership check).
for bad in '"x"' '[]' '{}' '{"sort_at_ms":"1","kind":"session","key":"k"}' '{"sort_at_ms":1.5,"kind":"session","key":"k"}' \
  '{"sort_at_ms":1,"kind":"other","key":"k"}' '{"sort_at_ms":1,"kind":"session","key":""}' \
  '{"sort_at_ms":1,"kind":"session","key":7}' '{"sort_at_ms":1,"kind":"session","key":"k","extra":1}'; do
  stream "${VIEWER_TOKEN}" "" "${bad}" 5
  expect_error VALIDATION "cursor ${bad}"
done
for bad in 0 51 -1; do
  stream "${VIEWER_TOKEN}" "" null "${bad}"
  expect_error VALIDATION "p_limit ${bad}"
done
stream "${OUTSIDER_TOKEN}" "${GA}" null 0
expect_error NOT_FOUND "a non-member's bad p_limit reports NOT_FOUND first"
stream "${OUTSIDER_TOKEN}" "${GA}" null 5
expect_error NOT_FOUND "non-member A-scope stream"
NM_BODY="${BODY}"
stream "${OUTSIDER_TOKEN}" "${MISSING_GROUP}" null 5
expect_error NOT_FOUND "nonexistent group stream"
[[ "${BODY}" == "${NM_BODY}" ]] || fail "stream: non-member and nonexistent group responses differ"
stream "${OUTSIDER_TOKEN}" "" null 5
expect_ok "a user with no groups streams All"
check "no groups → empty stream" '. == {items: [], next_cursor: null, has_more: false}'
pass "scope, VALIDATION for bad cursors/limits, NOT_FOUND for non-members"

# Removal (AC11): the viewer loses B.
rpc "${OWNER_TOKEN}" group_remove_member "$(b_target "${GB}" "${VIEWER_UID}")"
expect_ok "owner removes the viewer from B"
stream "${VIEWER_TOKEN}" "${GB}" null 5
expect_error NOT_FOUND "removed member's B-scope stream"
[[ "${BODY}" == "${NM_BODY}" ]] || fail "removed member's NOT_FOUND must match a nonexistent group"
stream "${VIEWER_TOKEN}" "" null 50
expect_ok "removed member's All stream"
check "All excludes the group the caller was removed from" '
  all(.items[]; if .kind == "session" then (.groups | map(.group_id) | index($b)) == null else .group.group_id != $b end)
  and ([.items[] | select(.key == $k)][0].groups | map(.group_id)) == [$a]
  and ([.items[] | select(.kind == "session") | .session_id] | index($bonly)) == null' \
  --arg a "${GA}" --arg b "${GB}" --arg k "${S1_KEY}" --arg bonly "${T}-bonly"
detail "${VIEWER_TOKEN}" "${ATHLETE_UID}" "${T}-bonly"
expect_error NOT_FOUND "removed member's detail of a B-only session"
detail "${VIEWER_TOKEN}" "${ATHLETE_UID}" "${S1}"
expect_ok "removed member still sees S1 through group A"
stream "${OWNER_TOKEN}" "${GB}" null 50
expect_ok "owner B-scope stream"
check "the owner sees the removal as a membership item" \
  '[.items[] | select(.kind == "membership" and .member.user_id == $v) | .event] | sort == ["joined","removed"]' \
  --arg v "${VIEWER_UID}"
pass "removed caller: NOT_FOUND for the group, All excludes it (AC11); removal item recorded"

# =============================================================================
# M25-T01: group exercises (contract §2.6, §4.4)
# =============================================================================
echo "[groups-contract] group exercises: shared ExerciseCore vectors (RPC and CHECKs)"

VECTORS_FILE="${SUPABASE_DIR}/../apps/mobile/src/exercise-core/exercise-core-vectors.json"
[[ -f "${VECTORS_FILE}" ]] || fail "shared ExerciseCore vectors missing: ${VECTORS_FILE}"
# The server message per validator issue; an exact match also proves "name first".
ISSUE_MESSAGES='{"name_required":"VALIDATION: exercise name is required",
  "load_input_mode_invalid":"VALIDATION: load_input_mode must be total_load or per_side_load"}'

# b_gx_create <group> <name> <mode> [source] — an empty source sends null.
b_gx_create() {
  jq -nc --arg g "$1" --arg n "$2" --arg m "$3" --arg s "${4:-}" \
    '{p_group_id: $g, p_name: $n, p_load_input_mode: $m, p_source_exercise_id: (if $s == "" then null else $s end)}'
}
b_gx_update() {
  jq -nc --arg g "$1" --arg e "$2" --arg n "$3" --arg m "$4" \
    '{p_group_id: $g, p_exercise_id: $e, p_name: $n, p_load_input_mode: $m}'
}
b_gx() { jq -nc --arg g "$1" --arg e "$2" '{p_group_id: $g, p_exercise_id: $e}'; }

rpc "${OWNER_TOKEN}" group_create "$(b_create "Vectors ${RUN_TAG}" "")"
expect_ok "owner creates the vectors group"
GV="$(jq -r '.group_id' <<<"${BODY}")"

VECTOR_COUNT=0
while IFS= read -r vector; do
  label="$(jq -r '.label' <<<"${vector}")"
  rpc "${OWNER_TOKEN}" group_exercise_create \
    "$(jq -c --arg g "${GV}" '{p_group_id: $g, p_name: .name, p_load_input_mode: .loadInputMode, p_source_exercise_id: null}' <<<"${vector}")"
  if jq -e '.expect | has("name")' <<<"${vector}" >/dev/null; then
    expect_ok "vector '${label}'"
    check "vector '${label}': stored as validateExerciseCore normalizes it" \
      '.exercise.name == $v.expect.name and .exercise.load_input_mode == $v.loadInputMode' --argjson v "${vector}"
  else
    expect_error VALIDATION "vector '${label}'"
    check "vector '${label}': the validator's issue" \
      '.message == $m[$v.expect.issue]' --argjson v "${vector}" --argjson m "${ISSUE_MESSAGES}"
  fi
  VECTOR_COUNT=$((VECTOR_COUNT + 1))
done < <(jq -c '.cases[]' "${VECTORS_FILE}")
[[ "${VECTOR_COUNT}" -gt 10 ]] || fail "expected more than 10 shared vectors, got ${VECTOR_COUNT}"

# The CHECKs, per vector (rolled back): the raw input is storable iff it is
# already what the validator would store, and the validator's output always is.
VECTORS_JSON="$(jq -c '.cases' "${VECTORS_FILE}")"
if ! check_out="$(run_psql "
  begin;
  do \$do\$
  declare
    _c jsonb;
    _accepted boolean;
    _bad text[] := '{}';
  begin
    for _c in select value from jsonb_array_elements(\$vec\$${VECTORS_JSON}\$vec\$::jsonb) loop
      begin
        insert into app_public.group_exercises (group_id, name, load_input_mode)
        values ('${GV}', _c ->> 'name', _c ->> 'loadInputMode');
        _accepted := true;
      exception when check_violation or not_null_violation then
        _accepted := false;
      end;
      if _accepted is distinct from
         (((_c -> 'expect') ? 'name') and (_c ->> 'name') = (_c -> 'expect' ->> 'name')) then
        _bad := _bad || (_c ->> 'label');
      end if;
      if (_c -> 'expect') ? 'name' then
        insert into app_public.group_exercises (group_id, name, load_input_mode)
        values ('${GV}', _c -> 'expect' ->> 'name', _c ->> 'loadInputMode');
      end if;
    end loop;
    if cardinality(_bad) > 0 then
      raise exception 'CHECK parity broken for: %', array_to_string(_bad, '; ');
    end if;
  end
  \$do\$;
  rollback;" 2>&1)"; then
  fail "group_exercises CHECKs disagree with the shared vectors: ${check_out}"
fi

# expect_check_violation <context> <values for (group_id, name, load_input_mode, source_exercise_id)>
expect_check_violation() {
  local out
  if out="$(run_psql "begin;
      insert into app_public.group_exercises (group_id, name, load_input_mode, source_exercise_id) values ($2);
      rollback;" 2>&1)"; then
    fail "$1: the CHECK must reject it"
  fi
  [[ "${out}" == *"violates check constraint"* ]] || fail "$1: expected a CHECK violation, got: ${out}"
}
expect_check_violation "empty source_exercise_id" "'${GV}', 'Bench', 'total_load', ''"
expect_check_violation "untrimmed source_exercise_id" "'${GV}', 'Bench', 'total_load', E'seed_x\\t'"
expect_check_violation "101-char source_exercise_id" "'${GV}', 'Bench', 'total_load', repeat('s', 101)"
[[ "$(run_psql "begin;
    insert into app_public.group_exercises (group_id, name, load_input_mode, source_exercise_id)
    values ('${GV}', 'Bench', 'total_load', repeat('s', 100)) returning 'stored';
    rollback;")" == "stored" ]] || fail "a 100-char source_exercise_id must be storable"

# NBSP as octal UTF-8 bytes: macOS bash 3.2 has no $'\u…'.
rpc "${OWNER_TOKEN}" group_exercise_create \
  "$(b_gx_create "${GV}" "Copy" total_load "$(printf '\302\240 seed_barbell_bench_press\t')")"
expect_ok "create with a padded source id"
check "the source id is JS-trimmed" '.exercise.source_exercise_id == "seed_barbell_bench_press"'
rpc "${OWNER_TOKEN}" group_exercise_create "$(b_gx_create "${GV}" "Copy" total_load "   ")"
expect_error VALIDATION "create with a blank source id"
check "blank source id message" '.message | startswith("VALIDATION: source_exercise_id must be")'
rpc "${OWNER_TOKEN}" group_exercise_create "$(b_gx_create "${GV}" "Copy" total_load "$(repeat_char s 101)")"
expect_error VALIDATION "create with a 101-char source id"
pass "shared vectors: RPC normalization and issues and the CHECKs agree with validateExerciseCore; source id bounds"

echo "[groups-contract] group exercises: roles, list, targets, update, archive"

rpc "${OWNER_TOKEN}" group_create "$(b_create "Exercises ${RUN_TAG}" "")"
expect_ok "owner creates the exercises group"
GX="$(jq -r '.group_id' <<<"${BODY}")"
rpc "${OWNER_TOKEN}" group_invite_get "$(b_group "${GX}")"
expect_ok "exercises group invite"
CODE_X="$(jq -r '.code' <<<"${BODY}")"
for label in ADMIN MEMBER JOINER; do
  token_var="${label}_TOKEN"
  rpc "${!token_var}" group_join "$(b_code "${CODE_X}")"
  expect_ok "$(lower "${label}") joins the exercises group"
  check "$(lower "${label}") joined" '.joined == true'
done
rpc "${OWNER_TOKEN}" group_set_role "$(b_role "${GX}" "${ADMIN_UID}" admin)"
expect_ok "owner promotes admin in the exercises group"

rpc "${MEMBER_TOKEN}" group_exercise_list "$(b_group "${GX}")"
expect_ok "member lists an empty catalogue"
check "an empty catalogue" '. == {exercises: []}'

rpc "${OWNER_TOKEN}" group_exercise_create "$(b_gx_create "${GX}" "  Bench ${RUN_TAG}  " total_load)"
expect_ok "owner creates a custom exercise"
check "create returns { exercise: GroupExercise }: trimmed, custom, active" \
  '(keys == ["exercise"])
   and (.exercise | keys == ["archived_at_ms","group_exercise_id","load_input_mode","name","source_exercise_id"])
   and .exercise.name == $n and .exercise.load_input_mode == "total_load"
   and .exercise.source_exercise_id == null and .exercise.archived_at_ms == null' --arg n "Bench ${RUN_TAG}"
GX_BENCH="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
[[ "${GX_BENCH}" =~ ${UUID_RE} ]] || fail "group_exercise_id must be a uuid"
[[ "$(run_psql "select group_id = '${GX}' and created_by = '${OWNER_UID}'
                 from app_public.group_exercises where id = '${GX_BENCH}';")" == "t" ]] ||
  fail "a created exercise must belong to its group and record created_by"

rpc "${ADMIN_TOKEN}" group_exercise_create \
  "$(b_gx_create "${GX}" "Barbell Back Squat" per_side_load seed_barbell_back_squat)"
expect_ok "admin copies a standard exercise"
check "a copy keeps the standard id, name, and load mode" \
  '.exercise | .name == "Barbell Back Squat" and .load_input_mode == "per_side_load"
   and .source_exercise_id == "seed_barbell_back_squat" and .archived_at_ms == null'
GX_SQUAT="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
rpc "${ADMIN_TOKEN}" group_exercise_create "$(b_gx_create "${GX}" "alpha Row" total_load)"
expect_ok "admin creates a custom exercise"
GX_ROW="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"

rpc "${MEMBER_TOKEN}" group_exercise_create "$(b_gx_create "${GX}" "Member ${RUN_TAG}" total_load)"
expect_error FORBIDDEN "member creates"
rpc "${MEMBER_TOKEN}" group_exercise_create "$(b_gx_create "${GX}" "" kg)"
expect_error FORBIDDEN "member creates with bad input (role before VALIDATION)"
rpc "${MEMBER_TOKEN}" group_exercise_update "$(b_gx_update "${GX}" "${GX_BENCH}" "Hijack" total_load)"
expect_error FORBIDDEN "member updates"
rpc "${MEMBER_TOKEN}" group_exercise_update "$(b_gx_update "${GX}" "${MISSING_GROUP}" "Hijack" total_load)"
expect_error FORBIDDEN "member updates a nonexistent exercise (role before target)"
rpc "${MEMBER_TOKEN}" group_exercise_archive "$(b_gx "${GX}" "${GX_BENCH}")"
expect_error FORBIDDEN "member archives"
rpc "${MEMBER_TOKEN}" group_exercise_unarchive "$(b_gx "${GX}" "${GX_BENCH}")"
expect_error FORBIDDEN "member unarchives"
[[ "$(run_psql "select count(*) || ':' || bool_and(archived_at is null) || ':' || bool_and(name not like 'Hijack%')
                 from app_public.group_exercises where group_id = '${GX}';")" == "3:true:true" ]] ||
  fail "a forbidden write changed the catalogue"

rpc "${MEMBER_TOKEN}" group_exercise_list "$(b_group "${GX}")"
expect_ok "member lists the catalogue"
check "list: every exercise, by name case-insensitively" \
  '(.exercises | map(.group_exercise_id)) == [$row, $squat, $bench] and all(.exercises[]; .archived_at_ms == null)' \
  --arg row "${GX_ROW}" --arg squat "${GX_SQUAT}" --arg bench "${GX_BENCH}"
pass "owner and admin create and copy; a member reads the catalogue and gets FORBIDDEN on every write"

rpc "${OUTSIDER_TOKEN}" group_exercise_list "$(b_group "${GX}")"
expect_error NOT_FOUND "outsider lists"
NM_BODY="${BODY}"
rpc "${OUTSIDER_TOKEN}" group_exercise_list "$(b_group "${MISSING_GROUP}")"
expect_error NOT_FOUND "list of a nonexistent group"
[[ "${BODY}" == "${NM_BODY}" ]] || fail "group_exercise_list: non-member and nonexistent responses differ"
for entry in \
  "group_exercise_create|$(b_gx_create "${GX}" "Outsider" total_load)" \
  "group_exercise_update|$(b_gx_update "${GX}" "${GX_BENCH}" "Outsider" total_load)" \
  "group_exercise_archive|$(b_gx "${GX}" "${GX_BENCH}")" \
  "group_exercise_unarchive|$(b_gx "${GX}" "${GX_BENCH}")"; do
  rpc "${OUTSIDER_TOKEN}" "${entry%%|*}" "${entry#*|}"
  expect_error NOT_FOUND "outsider ${entry%%|*}"
  [[ "${BODY}" == "${NM_BODY}" ]] || fail "outsider ${entry%%|*}: NOT_FOUND must match a nonexistent group"
done
rpc "${OWNER_TOKEN}" group_remove_member "$(b_target "${GX}" "${JOINER_UID}")"
expect_ok "owner removes the joiner from the exercises group"
rpc "${JOINER_TOKEN}" group_exercise_list "$(b_group "${GX}")"
expect_error NOT_FOUND "removed member lists"
[[ "${BODY}" == "${NM_BODY}" ]] || fail "removed member's NOT_FOUND must match a nonexistent group"
pass "non-member ≡ nonexistent ≡ removed member: byte-identical NOT_FOUND on every group-exercise RPC"

rpc "${ADMIN_TOKEN}" group_exercise_update "$(b_gx_update "${GX}" "${MISSING_GROUP}" "Nope" total_load)"
expect_error NOT_FOUND "update a nonexistent exercise"
check "a missing exercise has its own NOT_FOUND" '.message == "NOT_FOUND: group exercise not found"'
TARGET_BODY="${BODY}"
GV_EXERCISE="$(run_psql "select id from app_public.group_exercises where group_id = '${GV}' order by id limit 1;")"
[[ "${GV_EXERCISE}" =~ ${UUID_RE} ]] || fail "the vectors group must hold an exercise"
for entry in \
  "group_exercise_update|$(b_gx_update "${GX}" "${GV_EXERCISE}" "Nope" total_load)" \
  "group_exercise_archive|$(b_gx "${GX}" "${GV_EXERCISE}")" \
  "group_exercise_unarchive|$(b_gx "${GX}" "${GV_EXERCISE}")"; do
  rpc "${ADMIN_TOKEN}" "${entry%%|*}" "${entry#*|}"
  expect_error NOT_FOUND "${entry%%|*} of another group's exercise"
  [[ "${BODY}" == "${TARGET_BODY}" ]] || fail "${entry%%|*}: another group's exercise must look nonexistent"
done
rpc "${ADMIN_TOKEN}" group_exercise_update "$(b_gx_update "${GX}" "${MISSING_GROUP}" "" total_load)"
expect_error VALIDATION "input is validated before the target"
pass "targets: another group's exercise ≡ nonexistent (NOT_FOUND: group exercise not found)"

rpc "${ADMIN_TOKEN}" group_exercise_update "$(b_gx_update "${GX}" "${GX_BENCH}" " Bench (comp) ${RUN_TAG} " per_side_load)"
expect_ok "admin renames and changes the load mode"
check "update replaces the trimmed name and the load mode, keeping id and source" \
  '.exercise == {group_exercise_id: $id, name: $n, load_input_mode: "per_side_load",
                 source_exercise_id: null, archived_at_ms: null}' \
  --arg id "${GX_BENCH}" --arg n "Bench (comp) ${RUN_TAG}"
rpc "${OWNER_TOKEN}" group_exercise_update "$(b_gx_update "${GX}" "${GX_SQUAT}" "Barbell Back Squat" total_load)"
expect_ok "owner changes the copy's load mode"
check "a copy keeps its standard id through an update" \
  '.exercise.source_exercise_id == "seed_barbell_back_squat" and .exercise.load_input_mode == "total_load"'
rpc "${ADMIN_TOKEN}" group_exercise_update "$(b_gx_update "${GX}" "${GX_BENCH}" $' \t' total_load)"
expect_error VALIDATION "update with a blank name"
rpc "${ADMIN_TOKEN}" group_exercise_update "$(b_gx_update "${GX}" "${GX_BENCH}" "Bench" per_side)"
expect_error VALIDATION "update with an unknown load mode"
pass "update: rename and load-mode change by owner and admin; VALIDATION for bad input"

rpc "${ADMIN_TOKEN}" group_exercise_archive "$(b_gx "${GX}" "${GX_ROW}")"
expect_ok "admin archives"
ARCHIVED_MS="$(jq -r '.exercise.archived_at_ms' <<<"${BODY}")"
[[ "${ARCHIVED_MS}" =~ ^[0-9]{13}$ ]] || fail "archive must set archived_at_ms, got ${ARCHIVED_MS}"
check "archive keeps the rest of the exercise" \
  '.exercise | .group_exercise_id == $id and .name == "alpha Row" and .load_input_mode == "total_load"' \
  --arg id "${GX_ROW}"
rpc "${OWNER_TOKEN}" group_exercise_archive "$(b_gx "${GX}" "${GX_ROW}")"
expect_ok "archive again"
check "archive is idempotent (the first archived_at is kept)" '.exercise.archived_at_ms == $ms' --argjson ms "${ARCHIVED_MS}"
rpc "${MEMBER_TOKEN}" group_exercise_list "$(b_group "${GX}")"
expect_ok "member lists after the archive"
check "an archived exercise stays listed, flagged, after the active ones" \
  '(.exercises | map(.group_exercise_id)) == [$squat, $bench, $row]
   and (.exercises | map(.archived_at_ms != null)) == [false, false, true]
   and .exercises[2].archived_at_ms == $ms' \
  --arg row "${GX_ROW}" --arg squat "${GX_SQUAT}" --arg bench "${GX_BENCH}" --argjson ms "${ARCHIVED_MS}"
rpc "${ADMIN_TOKEN}" group_exercise_update "$(b_gx_update "${GX}" "${GX_ROW}" "Row" total_load)"
expect_error VALIDATION "update an archived exercise"
check "an archived exercise is read-only" '.message | startswith("VALIDATION: an archived group exercise is read-only")'
rpc "${OWNER_TOKEN}" group_exercise_unarchive "$(b_gx "${GX}" "${GX_ROW}")"
expect_ok "owner unarchives"
check "unarchive clears archived_at_ms and keeps the exercise" \
  '.exercise == {group_exercise_id: $id, name: "alpha Row", load_input_mode: "total_load",
                 source_exercise_id: null, archived_at_ms: null}' --arg id "${GX_ROW}"
rpc "${ADMIN_TOKEN}" group_exercise_unarchive "$(b_gx "${GX}" "${GX_ROW}")"
expect_ok "unarchive again"
check "unarchive is idempotent" '.exercise.archived_at_ms == null'
rpc "${MEMBER_TOKEN}" group_exercise_list "$(b_group "${GX}")"
expect_ok "member lists after the unarchive"
check "the round trip restores the active list" \
  '(.exercises | map(.group_exercise_id)) == [$row, $squat, $bench] and all(.exercises[]; .archived_at_ms == null)' \
  --arg row "${GX_ROW}" --arg squat "${GX_SQUAT}" --arg bench "${GX_BENCH}"
pass "archive/unarchive round trip: flagged in the list, read-only while archived, both idempotent"

# =============================================================================
echo "[groups-contract] AUTH_REQUIRED and AGENT_FORBIDDEN on every RPC"
# =============================================================================

CONTROL_TOKEN="$(mint_token "${ADMIN_TOKEN}")"
AGENT_TOKEN="$(mint_token "${ADMIN_TOKEN}" "groups-contract-agent-${RUN_TAG}")"
rpc "${CONTROL_TOKEN}" group_get "$(b_group "${G}")"
expect_ok "positive control: a locally minted token without client_id is accepted"

RPC_BODIES=(
  "group_list_mine|{}"
  "group_get|$(b_group "${G}")"
  "group_invite_preview|$(b_code "${CODE}")"
  "group_invite_get|$(b_group "${G}")"
  "group_create|$(b_create "Agent ${RUN_TAG}" "")"
  "group_update|$(b_update "${G}" "Agent ${RUN_TAG}" "")"
  "group_invite_regenerate|$(b_group "${G}")"
  "group_join|$(b_code "${CODE}")"
  "group_leave|$(b_group "${G}")"
  "group_remove_member|$(b_target "${G}" "${OWNER_UID}")"
  "group_set_role|$(b_role "${G}" "${OWNER_UID}" admin)"
  "group_transfer_ownership|$(b_target "${G}" "${OWNER_UID}")"
  "group_stream|$(jq -nc '{p_group_id: null, p_before: null, p_limit: null}')"
  "group_session_detail|$(jq -nc --arg m "${ATHLETE_UID}" --arg s "${S1}" '{p_member_user_id: $m, p_session_id: $s}')"
  "group_exercise_list|$(b_group "${GX}")"
  "group_exercise_create|$(b_gx_create "${GX}" "Agent ${RUN_TAG}" total_load)"
  "group_exercise_update|$(b_gx_update "${GX}" "${GX_BENCH}" "Agent ${RUN_TAG}" total_load)"
  "group_exercise_archive|$(b_gx "${GX}" "${GX_BENCH}")"
  "group_exercise_unarchive|$(b_gx "${GX}" "${GX_BENCH}")"
)
[[ ${#RPC_BODIES[@]} -eq ${#RPCS[@]} ]] || fail "RPC_BODIES must cover every RPC"
for entry in "${RPC_BODIES[@]}"; do
  name="${entry%%|*}"
  body="${entry#*|}"
  rpc "${AGENT_TOKEN}" "${name}" "${body}"
  expect_error AGENT_FORBIDDEN "${name} with a client_id token"
  rpc "${ANON_KEY}" "${name}" "${body}"
  expect_error AUTH_REQUIRED "${name} as anon"
done
[[ "$(run_psql "select name from app_public.groups where id = '${G}';")" == "${G_NAME}" ]] ||
  fail "a rejected agent/anon call changed the group"
[[ "$(run_psql "select count(*) from app_public.groups where name = 'Agent ${RUN_TAG}';")" == "0" ]] ||
  fail "a rejected agent/anon group_create wrote a row"
[[ "$(run_psql "select count(*) from app_public.group_exercises
                 where name = 'Agent ${RUN_TAG}' or (id = '${GX_BENCH}' and archived_at is not null);")" == "0" ]] ||
  fail "a rejected agent/anon group-exercise call wrote or archived a row"
pass "every RPC: AGENT_FORBIDDEN for client_id tokens, AUTH_REQUIRED for anon"

rpc "${ADMIN_TOKEN}" group_active_role "$(jq -nc --arg g "${G}" --arg u "${ADMIN_UID}" '{p_group_id: $g, p_user_id: $u}')"
[[ ! "${STATUS}" =~ ^2 ]] || fail "internal helper group_active_role must not be callable by clients"
check "internal helper call must be a permission denial (42501)" '.code == "42501"'
rpc "${VIEWER_TOKEN}" group_session_card_json "$(jq -nc --arg m "${ATHLETE_UID}" --arg s "${S1}" '{p_member: $m, p_session_id: $s, p_groups: []}')"
[[ ! "${STATUS}" =~ ^2 ]] || fail "internal helper group_session_card_json must not be callable by clients"
check "card helper call must be a permission denial (42501)" '.code == "42501"'
pass "internal helpers are not reachable through PostgREST"

# =============================================================================
echo "[groups-contract] direct PostgREST table access is denied"
# =============================================================================

# A non-2xx response must be a privilege denial (42501), not an incidental
# error (unknown column, bad filter) that would pass without proving anything.
expect_denied_or_empty() {
  local context="$1"
  if [[ "${STATUS}" =~ ^2 ]]; then
    check "${context} must be denied or affect nothing" 'length == 0'
  else
    check "${context} must be denied with 42501 (HTTP ${STATUS})" '.code == "42501"'
  fi
}

MEMBERSHIP_ROWS_BEFORE="$(run_psql "select count(*) from app_public.group_memberships where group_id = '${G}';")"
SHARE_ROWS_BEFORE="$(run_psql "select count(*) || ':' || sum(session_started_at) from app_public.group_session_shares where group_id = '${GA}';")"
exercise_rows() {
  run_psql "select string_agg(id || ':' || name || ':' || load_input_mode || ':' || coalesce(archived_at::text, '-'), ',' order by id)
              from app_public.group_exercises where group_id = '${GX}';"
}
EXERCISE_ROWS_BEFORE="$(exercise_rows)"
for bearer_label in authenticated anon; do
  if [[ "${bearer_label}" == "authenticated" ]]; then bearer="${ATHLETE_TOKEN}"; else bearer="${ANON_KEY}"; fi
  for table in groups group_memberships group_invites group_session_shares group_exercises; do
    rest GET "${bearer}" "${table}" "select=*"
    expect_denied_or_empty "${bearer_label} select ${table}"
    # Every insert/update payload names real columns, so only a privilege
    # check can reject it.
    case "${table}" in
      groups)
        row="$(jq -nc --arg n "Direct ${RUN_TAG}" '{name: $n}')"
        patch="$(jq -nc --arg n "Hijack ${RUN_TAG}" '{name: $n}')"
        filter="id=eq.${G}" ;;
      group_memberships)
        row="$(jq -nc --arg g "${G}" --arg u "${OUTSIDER_UID}" '{group_id: $g, user_id: $u, role: "owner"}')"
        patch='{"role":"owner"}'
        filter="group_id=eq.${G}" ;;
      group_invites)
        row="$(jq -nc --arg g "${SOLO}" '{group_id: $g, code: "ZZZZZZZZ"}')"
        patch='{"code":"ZZZZZZZZ"}'
        filter="group_id=eq.${G}" ;;
      group_session_shares)
        row="$(jq -nc --arg g "${GA}" --arg u "${ATHLETE_UID}" --arg s "${T}-pre" \
          '{group_id: $g, member_user_id: $u, session_id: $s, session_started_at: 0}')"
        patch='{"session_started_at":0}'
        filter="group_id=eq.${GA}" ;;
      group_exercises)
        row="$(jq -nc --arg g "${GX}" --arg n "Direct ${RUN_TAG}" '{group_id: $g, name: $n, load_input_mode: "total_load"}')"
        patch="$(jq -nc --arg n "Hijack ${RUN_TAG}" '{name: $n}')"
        filter="group_id=eq.${GX}" ;;
    esac
    rest POST "${bearer}" "${table}" "" "${row}"
    [[ ! "${STATUS}" =~ ^2 ]] || fail "${bearer_label} insert into ${table} must be denied"
    check "${bearer_label} insert into ${table} must be denied with 42501 (HTTP ${STATUS})" '.code == "42501"'
    rest PATCH "${bearer}" "${table}" "${filter}" "${patch}"
    expect_denied_or_empty "${bearer_label} update ${table}"
    rest DELETE "${bearer}" "${table}" "${filter}"
    expect_denied_or_empty "${bearer_label} delete ${table}"
  done
done
BODY=""
[[ "$(run_psql "select name from app_public.groups where id = '${G}';")" == "${G_NAME}" ]] ||
  fail "direct PostgREST update/delete changed or removed the groups row"
[[ "$(run_psql "select count(*) from app_public.groups where name in ('Direct ${RUN_TAG}', 'Hijack ${RUN_TAG}');")" == "0" ]] ||
  fail "direct PostgREST insert/update wrote a groups row"
[[ "$(run_psql "select count(*) from app_public.group_memberships where group_id = '${G}';")" == "${MEMBERSHIP_ROWS_BEFORE}" ]] ||
  fail "direct PostgREST insert/delete changed the membership row count"
[[ "$(run_psql "select string_agg(user_id::text, ',') from app_public.group_memberships
                where group_id = '${G}' and role = 'owner';")" == "${ADMIN_UID}" ]] ||
  fail "direct PostgREST update changed membership roles"
[[ "$(run_psql "select code from app_public.group_invites where group_id = '${G}';")" == "${CODE}" ]] ||
  fail "direct PostgREST update/delete changed or removed the invite"
[[ "$(run_psql "select count(*) from app_public.group_invites where code = 'ZZZZZZZZ';")" == "0" ]] ||
  fail "direct PostgREST insert/update wrote an invite code"
[[ "$(run_psql "select count(*) || ':' || sum(session_started_at) from app_public.group_session_shares where group_id = '${GA}';")" == "${SHARE_ROWS_BEFORE}" ]] ||
  fail "direct PostgREST insert/update/delete changed the share ledger"
[[ "$(exercise_rows)" == "${EXERCISE_ROWS_BEFORE}" ]] ||
  fail "direct PostgREST insert/update/delete changed the group exercises"
pass "select/insert/update/delete denied (42501) for authenticated and anon on all five tables"

# =============================================================================
echo "[groups-contract] persistent stream: group_events (M25-T02)"
# =============================================================================

RUN_IDS_SQL="$(printf "'%s'::uuid," "${RUN_USER_IDS[@]}")"
RUN_IDS_SQL="${RUN_IDS_SQL%,}"
RUN_GROUPS_SQL="select id from app_public.groups
                 where created_by in (${RUN_IDS_SQL})
                    or id in (select group_id from app_public.group_memberships where user_id in (${RUN_IDS_SQL}))"

[[ "$(run_psql "select relrowsecurity from pg_class where oid = 'app_public.group_events'::regclass;")" == "t" ]] ||
  fail "RLS is not enabled on group_events"
[[ "$(run_psql "select count(*) from pg_policies where schemaname = 'app_public' and tablename = 'group_events';")" == "0" ]] ||
  fail "group_events must have no RLS policies"
[[ "$(run_psql "
  select count(*) from unnest(array['anon','authenticated']) r(role)
   where has_table_privilege(r.role, 'app_public.group_events', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');")" == "0" ]] ||
  fail "anon/authenticated hold a direct privilege on group_events"
[[ "$(run_psql "select count(*) from information_schema.columns
   where table_schema = 'app_public' and table_name = 'group_events' and column_name = 'owner_user_id';")" == "0" ]] ||
  fail "group_events carries an owner_user_id column (ground rule 1)"
[[ "$(run_psql "
  select count(*) from pg_constraint con
    join pg_class r on r.oid = con.confrelid
    join pg_namespace n on n.oid = r.relnamespace
   where con.contype = 'f' and con.conrelid = 'app_public.group_events'::regclass
     and n.nspname = 'app_public' and r.relname in (${SYNC_TABLES});")" == "0" ]] ||
  fail "group_events has an FK into a Sync v2 table (ground rule 2)"
[[ "$(run_psql "
  select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_public'
     and p.proname in ('group_event_session', 'group_event_membership', 'group_events_backfill')
     and p.prosecdef and 'search_path=app_public, pg_temp' = any(p.proconfig)
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE');")" == "3" ]] ||
  fail "the group_events writers must be SECURITY DEFINER, search_path-pinned, and not client-executable"
# Both triggers are enabled AFTER INSERT OR UPDATE row triggers (tgtype 21).
# The session one must sort after the share trigger (same-event triggers fire
# in name order) so it sees the shares the same write created; the membership
# one fires on INSERT and on UPDATE OF ended_at only.
[[ "$(run_psql "
  select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'app_public.sessions'::regclass
     and t.tgname = 'sessions_group_stream_event'
     and not t.tgisinternal and t.tgenabled = 'O' and t.tgtype = 21
     and p.proname = 'group_event_session'
     and t.tgname collate \"C\" > 'sessions_group_share_session';")" == "1" ]] ||
  fail "sessions_group_stream_event must be an enabled AFTER INSERT OR UPDATE row trigger firing after the share trigger"
[[ "$(run_psql "
  select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'app_public.group_memberships'::regclass
     and t.tgname = 'group_memberships_stream_event'
     and not t.tgisinternal and t.tgenabled = 'O' and t.tgtype = 21
     and p.proname = 'group_event_membership'
     and t.tgattr::text = (select attnum::text from pg_attribute
                            where attrelid = 'app_public.group_memberships'::regclass and attname = 'ended_at');")" == "1" ]] ||
  fail "group_memberships_stream_event must be an enabled AFTER INSERT OR UPDATE OF ended_at row trigger"
# The kind CHECK: the reserved M25-T05 kinds are accepted, anything else is not.
for reserved in record record_voided link unlink lead_change; do
  run_psql "begin;
            insert into app_public.group_events (group_id, kind, member_user_id, sort_at_ms)
            values ('${GA}', '${reserved}', '${ATHLETE_UID}', 0);
            rollback;" >/dev/null || fail "the kind CHECK must accept the reserved kind ${reserved}"
done
if run_psql "insert into app_public.group_events (group_id, kind, member_user_id, sort_at_ms)
             values ('${GA}', 'bogus', '${ATHLETE_UID}', 0);" >/dev/null 2>&1; then
  fail "the kind CHECK must reject an unknown kind"
fi
EVENT_ROWS_BEFORE="$(run_psql "select count(*) from app_public.group_events where group_id in (${RUN_GROUPS_SQL});")"
for bearer_label in authenticated anon; do
  if [[ "${bearer_label}" == "authenticated" ]]; then bearer="${ATHLETE_TOKEN}"; else bearer="${ANON_KEY}"; fi
  rest GET "${bearer}" group_events "select=*"
  expect_denied_or_empty "${bearer_label} select group_events"
  rest POST "${bearer}" group_events "" \
    "$(jq -nc --arg g "${GA}" --arg u "${ATHLETE_UID}" '{group_id: $g, kind: "joined", member_user_id: $u, sort_at_ms: 0}')"
  [[ ! "${STATUS}" =~ ^2 ]] || fail "${bearer_label} insert into group_events must be denied"
  check "${bearer_label} insert into group_events must be denied with 42501 (HTTP ${STATUS})" '.code == "42501"'
  rest PATCH "${bearer}" group_events "group_id=eq.${GA}" '{"sort_at_ms":0}'
  expect_denied_or_empty "${bearer_label} update group_events"
  rest DELETE "${bearer}" group_events "group_id=eq.${GA}"
  expect_denied_or_empty "${bearer_label} delete group_events"
done
BODY=""
[[ "$(run_psql "select count(*) from app_public.group_events where group_id in (${RUN_GROUPS_SQL});")" == "${EVENT_ROWS_BEFORE}" ]] ||
  fail "direct PostgREST access changed group_events"
pass "group_events: RLS on, no policies, no grants, no owner_user_id, no Sync v2 FK, writer/trigger posture, kind CHECK"

# --- session writer: one item per group, no duplicates on re-push -------------------------
# session_events <session>: "<item count>:<distinct sort_at_ms>" for the athlete's session.
session_events() {
  run_psql "select count(*) || ':' || coalesce(string_agg(distinct sort_at_ms::text, ','), '')
              from app_public.group_events
             where kind = 'session' and member_user_id = '${ATHLETE_UID}' and session_id = '$1';"
}
S_EV="${T}-ev"
S_EV_START="$(now_floor_ms)"
next_cuam
S_EV_ROW="$(e_session "${S_EV}" "${S_EV_START}" active null null null "${CUAM}")"
push "${ATHLETE_TOKEN}" "newly shared session" "${S_EV_ROW}"
[[ "$(shares_of "${S_EV}")" == "A,B" ]] || fail "the new session must be shared into A and B"
[[ "$(session_events "${S_EV}")" == "2:${S_EV_START}" ]] ||
  fail "a newly shared session writes one session item per group, got '$(session_events "${S_EV}")'"
push "${ATHLETE_TOKEN}" "identical re-push (LWW no-op)" "${S_EV_ROW}"
next_cuam
push "${ATHLETE_TOKEN}" "newer re-push of the same session" \
  "$(e_session "${S_EV}" "${S_EV_START}" active null null null "${CUAM}")"
[[ "$(session_events "${S_EV}")" == "2:${S_EV_START}" ]] ||
  fail "a re-push must not duplicate session items, got '$(session_events "${S_EV}")'"
S_EV_MOVED="$((S_EV_START + 5000))"
next_cuam
push "${ATHLETE_TOKEN}" "started_at edited" \
  "$(e_session "${S_EV}" "${S_EV_MOVED}" active null null null "${CUAM}")"
[[ "$(session_events "${S_EV}")" == "2:${S_EV_MOVED}" ]] ||
  fail "a started_at edit keeps one item per group and moves their stored position, got '$(session_events "${S_EV}")'"
stream "${OWNER_TOKEN}" "${GA}" null 50
expect_ok "owner A stream after the started_at edit"
check "the card sorts at the live started_at" \
  '[.items[] | select(.key == $k)] | length == 1 and .[0].sort_at_ms == $s' \
  --arg k "${ATHLETE_UID}:${S_EV}" --argjson s "${S_EV_MOVED}"
pass "a newly shared session writes one item per group; re-pushes never duplicate; started_at edits move it"

# --- event trigger failure isolation + self-heal (§2.5 pattern) ---------------------------
echo "[groups-contract] stream event trigger failure isolation"

S_EVF="${T}-evfail"
run_psql "alter table app_public.group_events add constraint ${FORCE_EVENT_FAIL_CONSTRAINT} check (false) not valid;" >/dev/null
next_cuam
push "${ATHLETE_TOKEN}" "push while the stream event insert is forced to fail" \
  "$(e_session "${S_EVF}" "$(now_floor_ms)" active null null null "${CUAM}")"
EVF_CUAM="${CUAM}"
rest GET "${ATHLETE_TOKEN}" sessions "select=id,status,client_updated_at_ms&id=eq.${S_EVF}"
expect_ok "owner reads the session written during the event failure"
check "sync_push committed the session despite the event trigger failure" \
  '. == [{id: $id, status: "active", client_updated_at_ms: $c}]' --arg id "${S_EVF}" --argjson c "${EVF_CUAM}"
[[ "$(shares_of "${S_EVF}")" == "A,B" ]] || fail "an event failure must not roll back the share"
[[ "$(session_events "${S_EVF}")" == "0:" ]] || fail "the forced failure must have prevented the session items"
[[ "$(run_psql "select count(*) from public.app_logs
                 where event = 'group.event_failed' and user_id = '${ATHLETE_UID}'
                   and level = 'error' and source = 'database'
                   and context = jsonb_build_object('session_id', '${S_EVF}', 'sqlstate', '23514')
                   and message = 'group stream event trigger failed; the session write committed';")" == "1" ]] ||
  fail "expected exactly one sanitized group.event_failed row (session_id + sqlstate only)"
[[ "$(run_psql "select count(*) from public.app_logs
                 where event = 'group.share_failed' and context ->> 'session_id' = '${S_EVF}';")" == "0" ]] ||
  fail "an event failure must not be logged as a share failure"
stream "${OWNER_TOKEN}" "${GA}" null 50
expect_ok "owner A stream during the event failure"
check "a session with no item is not in the stream" '[.items[] | select(.key == $k)] == []' \
  --arg k "${ATHLETE_UID}:${S_EVF}"
run_psql "alter table app_public.group_events drop constraint ${FORCE_EVENT_FAIL_CONSTRAINT};" >/dev/null
next_cuam
push "${ATHLETE_TOKEN}" "next autosave after the event fault is removed" \
  "$(e_session "${S_EVF}" "$(run_psql "select started_at from app_public.sessions where owner_user_id = '${ATHLETE_UID}' and id = '${S_EVF}';")" active null null null "${CUAM}")"
[[ "$(session_events "${S_EVF}" | cut -d: -f1)" == "2" ]] ||
  fail "the next write must self-heal the missed items, got '$(session_events "${S_EVF}")'"
stream "${OWNER_TOKEN}" "${GA}" null 50
expect_ok "owner A stream after self-heal"
check "the self-healed session appears" '[.items[] | select(.key == $k)] | length == 1' \
  --arg k "${ATHLETE_UID}:${S_EVF}"
pass "forced event failure: sync_push commits, share kept, event_failed logged, next push self-heals the item"

# --- membership writers: one item per edge ----------------------------------------------
# membership_events <group>: the group's membership items in write order, as
# kind:member-tag[:actor-tag].
membership_events() {
  run_psql "
    select coalesce(string_agg(
             e.kind || ':' || case e.member_user_id when '${OWNER_UID}' then 'owner'
                                                   when '${OUTSIDER_UID}' then 'outsider'
                                                   when '${ATHLETE_UID}' then 'athlete' else '?' end
               || case when e.actor_user_id is null then ''
                       when e.actor_user_id = '${OWNER_UID}' then ':owner' else ':?' end,
             ',' order by e.occurred_at, e.kind), '')
      from app_public.group_events e
     where e.group_id = '$1' and e.kind in ('joined', 'left', 'removed');"
}
rpc "${OWNER_TOKEN}" group_create "$(b_create "Events ${RUN_TAG}" "")"
expect_ok "owner creates the events group"
GE="$(jq -r '.group_id' <<<"${BODY}")"
[[ "$(membership_events "${GE}")" == "joined:owner" ]] || fail "group_create must write exactly the owner's joined item"
rpc "${OWNER_TOKEN}" group_invite_get "$(b_group "${GE}")"
expect_ok "events group invite"
CODE_E="$(jq -r '.code' <<<"${BODY}")"
set_username "${OUTSIDER_UID}" "outsider-${RUN_TAG}"
rpc "${OUTSIDER_TOKEN}" group_join "$(b_code "${CODE_E}")"
expect_ok "outsider joins the events group"
rpc "${OUTSIDER_TOKEN}" group_join "$(b_code "${CODE_E}")"
expect_ok "outsider re-joins while active (no-op)"
check "a join while active is a no-op" '.joined == false'
rpc "${OWNER_TOKEN}" group_set_role "$(b_role "${GE}" "${OUTSIDER_UID}" admin)"
expect_ok "owner promotes the outsider"
rpc "${OWNER_TOKEN}" group_set_role "$(b_role "${GE}" "${OUTSIDER_UID}" member)"
expect_ok "owner demotes the outsider"
[[ "$(membership_events "${GE}")" == "joined:owner,joined:outsider" ]] ||
  fail "join writes one item; a no-op join and role changes write none, got '$(membership_events "${GE}")'"
rpc "${OUTSIDER_TOKEN}" group_leave "$(b_group "${GE}")"
expect_ok "outsider leaves the events group"
rpc "${OUTSIDER_TOKEN}" group_join "$(b_code "${CODE_E}")"
expect_ok "outsider rejoins the events group"
rpc "${OWNER_TOKEN}" group_remove_member "$(b_target "${GE}" "${OUTSIDER_UID}")"
expect_ok "owner removes the outsider"
rpc "${ATHLETE_TOKEN}" group_join "$(b_code "${CODE_E}")"
expect_ok "athlete joins the events group"
rpc "${OWNER_TOKEN}" group_transfer_ownership "$(b_target "${GE}" "${ATHLETE_UID}")"
expect_ok "owner transfers the events group to the athlete"
[[ "$(membership_events "${GE}")" == \
   "joined:owner,joined:outsider,left:outsider,joined:outsider,removed:outsider:owner,joined:athlete" ]] ||
  fail "leave/rejoin/remove/join write one item each (removed carries the remover); transfer writes none, got '$(membership_events "${GE}")'"
[[ "$(run_psql "
  select count(*) from app_public.group_events e
    join app_public.group_memberships m on m.id = e.membership_id
   where e.group_id = '${GE}'
     and e.sort_at_ms <> floor(extract(epoch from case when e.kind = 'joined' then m.joined_at else m.ended_at end) * 1000)::bigint;")" == "0" ]] ||
  fail "membership items must sit at floor(epoch ms) of their period's joined_at / ended_at"
pass "membership RPCs write exactly one item per edge (joined/left/removed); no-op join, set_role, transfer write none"

# --- backfill: one item per share and per membership edge; streams rebuild byte-identical -
echo "[groups-contract] group_events backfill"

# events_vs_sources: "<expected>:<actual>:<missing>:<extra>" over the run's
# groups, where expected is one session item per share row and one joined plus
# (when ended) one left/removed item per membership period, with their
# positions and actors.
events_vs_sources() {
  run_psql "
    with rg as (${RUN_GROUPS_SQL}),
    expected as (
      select sh.group_id, 'session'::text as kind, sh.member_user_id, sh.session_id,
             null::uuid as membership_id, null::uuid as actor_user_id,
             coalesce(s.started_at, sh.session_started_at) as sort_at_ms
        from app_public.group_session_shares sh
        left join app_public.sessions s on s.owner_user_id = sh.member_user_id and s.id = sh.session_id
       where sh.group_id in (select id from rg)
      union all
      select m.group_id, 'joined', m.user_id, null, m.id, null,
             floor(extract(epoch from m.joined_at) * 1000)::bigint
        from app_public.group_memberships m where m.group_id in (select id from rg)
      union all
      select m.group_id, m.end_reason, m.user_id, null, m.id,
             case when m.end_reason = 'removed' then m.ended_by end,
             floor(extract(epoch from m.ended_at) * 1000)::bigint
        from app_public.group_memberships m where m.group_id in (select id from rg) and m.ended_at is not null
    ),
    actual as (
      select e.group_id, e.kind, e.member_user_id, e.session_id, e.membership_id, e.actor_user_id, e.sort_at_ms
        from app_public.group_events e where e.group_id in (select id from rg)
    )
    select (select count(*) from expected) || ':' || (select count(*) from actual) || ':'
        || (select count(*) from (select * from expected except all select * from actual) x) || ':'
        || (select count(*) from (select * from actual except all select * from expected) y);"
}
# stream_all <token>: every All item, walked with next_cursor at limit 50.
stream_all() {
  local token="$1" cursor="null" items="[]" pages=0
  while :; do
    stream "${token}" "" "${cursor}" 50
    expect_ok "All stream walk"
    items="$(jq -c --argjson acc "${items}" '$acc + .items' <<<"${BODY}")"
    pages=$((pages + 1))
    [[ "${pages}" -le 50 ]] || fail "stream walk did not terminate"
    [[ "$(jq -r '.has_more' <<<"${BODY}")" == "true" ]] || break
    cursor="$(jq -c '.next_cursor' <<<"${BODY}")"
  done
  printf '%s' "${items}"
}

LIVE_COUNTS="$(events_vs_sources)"
LIVE_N="${LIVE_COUNTS%%:*}"
[[ "${LIVE_N}" -gt 20 && "${LIVE_COUNTS}" == "${LIVE_N}:${LIVE_N}:0:0" ]] ||
  fail "the live writers must have produced exactly one item per share and per membership edge, got ${LIVE_COUNTS}"
SNAP_OWNER="$(stream_all "${OWNER_TOKEN}")"
SNAP_ATHLETE="$(stream_all "${ATHLETE_TOKEN}")"
SNAP_VIEWER="$(stream_all "${VIEWER_TOKEN}")"
[[ "$(jq 'length' <<<"${SNAP_OWNER}")" -gt 20 ]] || fail "the owner's All stream should hold the run's items"

run_psql "delete from app_public.group_events where group_id in (${RUN_GROUPS_SQL});" >/dev/null
[[ "$(stream_all "${OWNER_TOKEN}")" == "[]" ]] || fail "group_stream must read only group_events"
BACKFILLED="$(run_psql "select app_public.group_events_backfill();")"
[[ "${BACKFILLED}" == "${LIVE_N}" ]] ||
  fail "the backfill must insert exactly one item per share and membership edge (${LIVE_N}), inserted ${BACKFILLED}"
[[ "$(events_vs_sources)" == "${LIVE_N}:${LIVE_N}:0:0" ]] ||
  fail "backfilled items must match the ledger and membership periods, got $(events_vs_sources)"
[[ "$(run_psql "select app_public.group_events_backfill();")" == "0" ]] || fail "the backfill must be idempotent"
[[ "$(stream_all "${OWNER_TOKEN}")" == "${SNAP_OWNER}" ]] || fail "owner's All stream differs after the backfill"
[[ "$(stream_all "${ATHLETE_TOKEN}")" == "${SNAP_ATHLETE}" ]] || fail "athlete's All stream differs after the backfill"
[[ "$(stream_all "${VIEWER_TOKEN}")" == "${SNAP_VIEWER}" ]] || fail "viewer's All stream differs after the backfill"
pass "backfill: one item per share and per membership edge, idempotent; three users' streams rebuild byte-identical"

echo "[groups-contract] PASS (run ${RUN_TAG})"
