#!/usr/bin/env bash

# groups-contract.sh — M22 group membership / invites / authorization contract.
#
# Contract: docs/specs/tech/groups-contract.md §2.1–§2.3, §3, §4 (membership
# half; the share ledger and stream reads are M22-T02). Proves, against the
# real local Supabase stack through PostgREST:
#
#   - catalog ground rules: RLS on + no policies + no direct grants, no
#     `owner_user_id` column, no FK into the Sync v2 tables, helpers not
#     client-executable, every function SECURITY DEFINER with a pinned
#     search_path;
#   - every membership/invite RPC success path and every error token;
#   - the role matrix (member / admin / owner), leave / rejoin periods,
#     removal, ownership transfer;
#   - invite normalization and regeneration;
#   - non-member ≡ nonexistent (byte-identical NOT_FOUND bodies);
#   - AUTH_REQUIRED (anon) and AGENT_FORBIDDEN (client_id token) on every RPC;
#   - direct PostgREST select/insert/update/delete denial on all three tables.
#
# Hermetic: every run provisions its own five users (owner, admin, member,
# outsider, joiner) with a per-run tag, never reads fixture users, and deletes
# its users and groups on exit. Repeated runs in one slot pass without a reset.

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

cleanup() {
  [[ ${#RUN_USER_IDS[@]} -gt 0 ]] || return 0
  local ids
  ids="$(printf "'%s'::uuid," "${RUN_USER_IDS[@]}")"
  ids="${ids%,}"
  run_psql "
    begin;
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

GROUP_TABLES="'groups','group_memberships','group_invites'"
SYNC_TABLES="'gyms','exercise_definitions','muscle_groups','exercise_tag_definitions','sessions','exercise_muscle_mappings','session_exercises','exercise_sets','session_exercise_tags'"

[[ "$(run_psql "
  select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app_public' and c.relname in (${GROUP_TABLES})
     and c.relkind = 'r' and c.relrowsecurity;")" == "3" ]] ||
  fail "RLS is not enabled on all three group tables"
[[ "$(run_psql "select count(*) from pg_policies where schemaname = 'app_public' and tablename in (${GROUP_TABLES});")" == "0" ]] ||
  fail "group tables must have no RLS policies"
[[ "$(run_psql "
  select count(*) from unnest(array['anon','authenticated']) r(role)
   cross join unnest(array['groups','group_memberships','group_invites']) t(name)
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
  group_invite_regenerate group_join group_leave group_remove_member group_set_role group_transfer_ownership)
HELPERS=(group_require_app_user group_active_role group_require_member group_require_username
  group_validate_name group_validate_description group_normalize_invite_code group_generate_invite_code
  group_write_invite_code group_summary_json group_members_json group_detail_json group_require_target)
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
pass "RLS on, no policies, no grants, no owner_user_id, no Sync v2 FK, function posture"

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
set_username "${OWNER_UID}" "owner-${RUN_TAG}"
set_username "${ADMIN_UID}" "admin-${RUN_TAG}"
set_username "${MEMBER_UID}" "Z-member-${RUN_TAG}"
set_username "${JOINER_UID}" ""   # profile row with a null username
# OUTSIDER has no profile row at all.
pass "five users provisioned (tag ${RUN_TAG})"

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
pass "every RPC: AGENT_FORBIDDEN for client_id tokens, AUTH_REQUIRED for anon"

rpc "${ADMIN_TOKEN}" group_active_role "$(jq -nc --arg g "${G}" --arg u "${ADMIN_UID}" '{p_group_id: $g, p_user_id: $u}')"
[[ ! "${STATUS}" =~ ^2 ]] || fail "internal helper group_active_role must not be callable by clients"
check "internal helper call must be a permission denial (42501)" '.code == "42501"'
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
for bearer_label in authenticated anon; do
  if [[ "${bearer_label}" == "authenticated" ]]; then bearer="${ADMIN_TOKEN}"; else bearer="${ANON_KEY}"; fi
  for table in groups group_memberships group_invites; do
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
pass "select/insert/update/delete denied (42501) for authenticated and anon on all three tables"

echo "[groups-contract] PASS (run ${RUN_TAG})"
