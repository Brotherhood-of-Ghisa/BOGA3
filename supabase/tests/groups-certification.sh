#!/usr/bin/env bash

# groups-certification.sh — M25 certification contract (the third body of the
# groups-leaderboards lane; groups-boards.sh proves the All boards).
#
# Contract: docs/specs/tech/groups-contract.md §2.11–§2.12, §4.2, §4.5, §4.6.
# Proves, against the real local stack (sync_push, group-eval, PostgREST):
#
#   - posture of group_certifications and the certification RPCs;
#   - every rejection: auth, agent, non-member, removed, self-certify, input,
#     another group's exercise, archived, non-record set, former lifter,
#     CONFLICT on a set edited ahead of the evaluator;
#   - certify (idempotent), withdraw, admin cancel, re-certify after cancel;
#   - voids on edit (completed and active sessions) and on delete (set and
#     session tombstones), no revival on undelete; unlink, load mode and a
#     rules recompute void nothing;
#   - Certified entries, lead_change{certification}, BoardRow / podium / stream
#     `certified` and `certification`, history `related`;
#   - frozen boards drop an ended certification from the reads at once;
#   - enqueue failure isolation and repair.
#
# Direct-drain mode as groups-boards.sh: the kick URL is unset and the sweep
# paused for the run; the lane POSTs group-eval itself. Hermetic: per-run
# users, deleted on exit with everything they own.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"

LANE_LABEL="groups-certification"
FIXTURE_EMAIL_PREFIX="groups-ct"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/tests/lib/groups-fixtures.sh"

for cmd in curl docker jq node; do
  command -v "${cmd}" >/dev/null 2>&1 || fail "${cmd} is required"
done

load_supabase_status_env
[[ -n "${API_URL:-}" && -n "${ANON_KEY:-}" && -n "${JWT_SECRET:-}" ]] ||
  fail "local Supabase status env is incomplete (API_URL/ANON_KEY/JWT_SECRET)"
DB_CONTAINER="$(resolve_db_container)" || exit 1

RUN_TAG="${GROUPS_CERTIFICATION_RUN_TAG:-$(date +%s)-$$-${RANDOM}}"
RUN_TAG="$(printf '%s' "${RUN_TAG}" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9-' '-')"
PASSWORD="GroupsCert!${RUN_TAG}"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
FORCE_ENQUEUE_CONSTRAINT="groups_ct_force_enqueue_failure"

RUN_USER_IDS=()
ORIGINAL_KICK_URL="$(run_psql "select coalesce(app_public.group_eval_config('group_eval_url'), '');")"
ORIGINAL_SWEEP_ACTIVE="$(run_psql "select active from cron.job where jobname = 'group-eval-sweep';")"
EVAL_SECRET="$(run_psql "select app_public.group_eval_config('group_eval_secret');")"
[[ -n "${EVAL_SECRET}" ]] || fail "no group_eval_secret in Vault"

set_kick_url() { run_psql "select app_public.group_eval_set_url('$1');" >/dev/null; }
set_sweep_active() {
  run_psql "select cron.alter_job(jobid, active := $1) from cron.job where jobname = 'group-eval-sweep';" >/dev/null
}

cleanup() {
  run_psql "set client_min_messages = warning;
            alter table app_public.group_eval_queue drop constraint if exists ${FORCE_ENQUEUE_CONSTRAINT};" >/dev/null
  set_kick_url "${ORIGINAL_KICK_URL}"
  if [[ "${ORIGINAL_SWEEP_ACTIVE}" == "t" ]]; then set_sweep_active true; else set_sweep_active false; fi
  [[ ${#RUN_USER_IDS[@]} -gt 0 ]] || return 0
  local ids
  ids="$(printf "'%s'::uuid," "${RUN_USER_IDS[@]}")"
  ids="${ids%,}"
  run_psql "
    begin;
      delete from public.app_logs
       where event like 'group.%' and user_id in (${ids});
      delete from app_public.group_eval_queue where member_user_id in (${ids});
      delete from app_public.groups
       where created_by in (${ids})
          or id in (select group_id from app_public.group_memberships where user_id in (${ids}));
      delete from auth.users where id in (${ids});
    commit;
  " >/dev/null
}

# Bash 3.2 hands the EXIT trap status 0 after an unbound-variable abort, so a
# run that never reached its last line fails here instead of passing.
COMPLETED=0
cleanup_on_exit() {
  local status=$?
  trap - EXIT
  if [[ ${status} -eq 0 && ${COMPLETED} -ne 1 ]]; then
    echo "[${LANE_LABEL}] FAIL: the run stopped before completing" >&2
    status=1
  fi
  if ! cleanup; then
    echo "[${LANE_LABEL}] FAIL: cleanup of run ${RUN_TAG} failed" >&2
    [[ ${status} -ne 0 ]] || status=1
  fi
  exit "${status}"
}
trap cleanup_on_exit EXIT

# --- lane helpers --------------------------------------------------------------

now_ms() { run_psql "select floor(extract(epoch from clock_timestamp()) * 1000)::bigint;"; }

check_args() {
  local context="$1"
  shift
  local -a args=()
  while [[ "${1:-}" == "--arg" ]]; do args+=("$1" "$2" "$3"); shift 3; done
  check "${context}" "$1" ${args[@]+"${args[@]}"}
}

expect_sql() {
  local actual
  actual="$(run_psql "$2")"
  [[ "${actual}" == "$3" ]] || fail "$1: expected '$3', got '${actual}'"
}

# expect_message <exact message> <context>
expect_message() {
  [[ ! "${STATUS}" =~ ^2 ]] || fail "$2: expected '$1', got HTTP ${STATUS}"
  [[ "$(jq -r '.message // empty' <<<"${BODY}")" == "$1" ]] || fail "$2: expected '$1'"
}

drain() {
  local out
  out="$(mktemp)"
  STATUS="$(curl --silent --show-error -X POST \
    -H "Content-Type: application/json" -H "x-group-eval-secret: ${EVAL_SECRET}" \
    -o "${out}" -w "%{http_code}" --data '{}' "${API_URL}/functions/v1/group-eval")"
  BODY="$(cat "${out}")"
  rm -f "${out}"
  expect_ok "group-eval drain: $1"
  check "group-eval drain: $1: no failed job" '.failed == 0'
}

WHO_SQL() { # a SQL case expression mapping member uuids in column $1 to A/R
  echo "case $1 when '${ATHLETE_UID}' then 'A' when '${RIVAL_UID}' then 'R' else '?' end"
}

# centry <member-label> <metric>: the Certified entry as `value@set`, or empty.
centry() {
  local uid
  case "$1" in A) uid="${ATHLETE_UID}" ;; R) uid="${RIVAL_UID}" ;; esac
  run_psql "select value_kg || '@' || replace(set_id, '${T}-', '') from app_public.group_board_entries
             where group_exercise_id = '${GX}' and member_user_id = '${uid}' and metric = '$2' and certified;"
}
expect_centry() {
  local actual
  actual="$(centry "$1" "$2")"
  [[ "${actual}" == "$3" ]] || fail "$4: Certified entry $1/$2 expected '$3', got '${actual}'"
}

# mark: remember the newest event; csince: Certified lead changes written
# after it, as `reason:metric@who`, in write order.
MARK=0
mark() { MARK="$(run_psql "select coalesce(max(seq), 0) from app_public.group_events;")"; }
csince() {
  run_psql "select coalesce(string_agg(reason || ':' || metric || '@' || $(WHO_SQL member_user_id), ',' order by seq), '')
              from app_public.group_events
             where seq > ${MARK} and group_exercise_id = '${GX}' and kind = 'lead_change' and certified;"
}
expect_csince() {
  local actual
  actual="$(csince)"
  [[ "${actual}" == "$1" ]] || fail "$2: Certified lead changes expected '$1', got '${actual}'"
}
# The latest Certified lead change's payload certification_id.
last_lc_cert() {
  run_psql "select coalesce(payload ->> 'certification_id', '') from app_public.group_events
             where group_exercise_id = '${GX}' and kind = 'lead_change' and certified order by seq desc limit 1;"
}

# cert_col <certification-id> <column-sql>
cert_col() { run_psql "select $2 from app_public.group_certifications where id = '$1';"; }
active_certs() { # active_certs <set-suffix>
  run_psql "select count(*) from app_public.group_certifications
             where group_exercise_id = '${GX}' and set_id = '${T}-$1' and ended_at is null;"
}

# --- builders ----------------------------------------------------------------------

SESSION_AT=0
next_session_at() { SESSION_AT=$(( SESSION_AT + 60000 )); }

# sess <token> <session> <active|completed> <definition> <set-suffix>:<weight>:<reps>...
sess() {
  local token="$1" sid="$2" status="$3" def="$4"
  shift 4
  next_cuam
  local done=null dur=null
  if [[ "${status}" == "completed" ]]; then done=$(( SESSION_AT + 3600000 )); dur=3600; fi
  local -a rows=("$(e_session "${sid}" "${SESSION_AT}" "${status}" "${done}" "${dur}" null "${CUAM}")"
                 "$(e_se "${sid}-se" "${sid}" "${def}" 0 "Lift" "${CUAM}")")
  local order=0 spec id w r
  for spec in "$@"; do
    IFS=: read -r id w r <<<"${spec}"
    rows+=("$(e_set "${T}-${id}" "${sid}-se" "${order}" "${w}" "${r}" "" "${CUAM}")")
    order=$(( order + 1 ))
  done
  push "${token}" "session ${sid}" "${rows[@]}"
}

# set_edit <token> <session> <set-suffix> <order> <weight> <reps> [deleted]
set_edit() {
  next_cuam
  push "$1" "edit $3" "$(e_set "${T}-$3" "$2-se" "$4" "$5" "$6" "" "${CUAM}" "${7:-null}")"
}

# session_row <token> <session> <started> <completed> [deleted]
session_row() {
  next_cuam
  push "$1" "session $2" "$(e_session "$2" "$3" completed $(( $3 + 3600000 )) 3600 "${5:-null}" "${CUAM}")"
}

def() { next_cuam; push "$1" "definition $2" "$(e_def "$2" "Lift $2" "${CUAM}" "$3")"; }
link() { # link <token> <definition> [deleted]
  next_cuam
  local del=null
  [[ -z "${3:-}" ]] || del="${CUAM}"
  push "$1" "link $2" "$(e_link "$2" "${GID}" "${GX}" "${CUAM}" "${del}")"
}

gx() { # gx <token> <group> <name>: echoes a new total_load group exercise id
  rpc "$1" group_exercise_create \
    "$(jq -nc --arg g "$2" --arg n "$3" '{p_group_id: $g, p_name: $n, p_load_input_mode: "total_load", p_source_exercise_id: null}')"
  expect_ok "group_exercise_create $3"
  jq -er '.exercise.group_exercise_id' <<<"${BODY}"
}

# certify <token> <member-uid> <set-suffix> [group-exercise] [group]
certify() {
  rpc "$1" group_certify "$(jq -nc --arg g "${5:-${GID}}" --arg x "${4:-${GX}}" --arg m "$2" --arg s "${T}-$3" \
      '{p_group_id: $g, p_group_exercise_id: $x, p_member_user_id: $m, p_set_id: $s}')"
}
withdraw() { # withdraw <token> <certification-id|null>
  rpc "$1" group_certification_withdraw "$(jq -nc --arg g "${GID}" --argjson c "$2" '{p_group_id: $g, p_certification_id: $c}')"
}
cancel() {
  rpc "$1" group_certification_cancel "$(jq -nc --arg g "${GID}" --argjson c "$2" '{p_group_id: $g, p_certification_id: $c}')"
}
q() { printf '"%s"' "$1"; } # a JSON string

# board <token> <metric> <certified>: group_board into BODY.
board() {
  rpc "$1" group_board "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg m "$2" --argjson c "$3" \
      '{p_group_id: $g, p_group_exercise_id: $x, p_metric: $m, p_certified: $c}')"
  expect_ok "group_board $2 certified=$3"
}
history() {
  rpc "$1" group_board_history "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg m "$2" --argjson c "$3" \
      '{p_group_id: $g, p_group_exercise_id: $x, p_metric: $m, p_certified: $c}')"
  expect_ok "group_board_history $2 certified=$3"
}
podiums() {
  rpc "$1" group_board_podiums "$(jq -nc --arg g "${GID}" '{p_group_id: $g}')"
  expect_ok "group_board_podiums"
}
stream() {
  rpc "$1" group_stream "$(jq -nc --arg g "${GID}" '{p_group_id: $g, p_before: null, p_limit: 50}')"
  expect_ok "group_stream"
}

# =============================================================================
echo "[${LANE_LABEL}] run ${RUN_TAG}: setup"
# =============================================================================

provision OWNER owner
provision ADMIN admin
provision ATHLETE athlete
provision RIVAL rival
provision CERTIFIER certifier
provision REMOVED removed
provision OUTSIDER outsider
for pair in "OWNER:owner" "ADMIN:admin" "ATHLETE:athlete" "RIVAL:rival" "CERTIFIER:certifier" \
            "REMOVED:removed" "OUTSIDER:outsider"; do
  uid_var="${pair%%:*}_UID"
  set_username "${!uid_var}" "ct_${pair##*:}_${RUN_TAG//-/_}"
done

set_kick_url ""
set_sweep_active false

rpc "${OWNER_TOKEN}" group_create "$(jq -nc --arg n "CT ${RUN_TAG}" '{p_name: $n, p_description: null}')"
expect_ok "group_create G"
GID="$(jq -er '.group_id' <<<"${BODY}")"
rpc "${OUTSIDER_TOKEN}" group_create "$(jq -nc --arg n "CT other ${RUN_TAG}" '{p_name: $n, p_description: null}')"
expect_ok "group_create H"
HID="$(jq -er '.group_id' <<<"${BODY}")"
rpc "${OWNER_TOKEN}" group_invite_get "$(jq -nc --arg g "${GID}" '{p_group_id: $g}')"
expect_ok "group_invite_get"
INVITE_CODE="$(jq -er '.code' <<<"${BODY}")"
for token in "${ADMIN_TOKEN}" "${ATHLETE_TOKEN}" "${RIVAL_TOKEN}" "${CERTIFIER_TOKEN}" "${REMOVED_TOKEN}"; do
  rpc "${token}" group_join "$(jq -nc --arg c "${INVITE_CODE}" '{p_code: $c}')"
  expect_ok "join G"
done
rpc "${OWNER_TOKEN}" group_set_role "$(jq -nc --arg g "${GID}" --arg u "${ADMIN_UID}" '{p_group_id: $g, p_user_id: $u, p_role: "admin"}')"
expect_ok "promote admin"
rpc "${OWNER_TOKEN}" group_remove_member "$(jq -nc --arg g "${GID}" --arg u "${REMOVED_UID}" '{p_group_id: $g, p_user_id: $u}')"
expect_ok "remove member"

T="ct-${RUN_TAG}"
CUAM="$(now_ms)"
SESSION_AT=$(( CUAM + 1000 ))

GX="$(gx "${OWNER_TOKEN}" "${GID}" "Bench")"
GXA="$(gx "${OWNER_TOKEN}" "${GID}" "Archived")"
GXH="$(gx "${OUTSIDER_TOKEN}" "${HID}" "Other group")"
rpc "${OWNER_TOKEN}" group_exercise_archive "$(jq -nc --arg g "${GID}" --arg e "${GXA}" '{p_group_id: $g, p_exercise_id: $e}')"
expect_ok "archive GXA"

DA="${T}-dA"; DR="${T}-dR"
def "${ATHLETE_TOKEN}" "${DA}" total_load
link "${ATHLETE_TOKEN}" "${DA}"
def "${RIVAL_TOKEN}" "${DR}" total_load
link "${RIVAL_TOKEN}" "${DR}"

# A: a1 90×1, then a2 100×1 (records) with a3 50×1 (not a record); R: r1 95×1.
next_session_at
sess "${ATHLETE_TOKEN}" "${T}-s1" completed "${DA}" "a1:90:1"
drain "a1"
next_session_at
S2_AT="${SESSION_AT}"
sess "${ATHLETE_TOKEN}" "${T}-s2" completed "${DA}" "a2:100:1" "a3:50:1"
next_session_at
sess "${RIVAL_TOKEN}" "${T}-r1s" completed "${DR}" "r1:95:1"
drain "setup sessions"
expect_sql "setup: records for a1, a2, r1 only" \
  "select string_agg(replace(set_id, '${T}-', ''), ',' order by set_id) from app_public.group_events
    where group_exercise_id = '${GX}' and kind = 'record';" "a1,a2,r1"
pass "users (owner, admin, athlete A, rival R, certifier C, removed, outsider), group G, All boards A 100 · R 95"

# =============================================================================
echo "[${LANE_LABEL}] posture"
# =============================================================================

TABLE=group_certifications
expect_sql "${TABLE}: RLS on" "select relrowsecurity from pg_class where oid = 'app_public.${TABLE}'::regclass;" "t"
expect_sql "${TABLE}: no policies" \
  "select count(*) from pg_policies where schemaname = 'app_public' and tablename = '${TABLE}';" "0"
expect_sql "${TABLE}: no anon/authenticated privileges" \
  "select count(*) from information_schema.role_table_grants
    where table_schema = 'app_public' and table_name = '${TABLE}' and grantee in ('anon', 'authenticated', 'public');" "0"
expect_sql "${TABLE}: no owner_user_id column" \
  "select count(*) from information_schema.columns
    where table_schema = 'app_public' and table_name = '${TABLE}' and column_name = 'owner_user_id';" "0"
expect_sql "${TABLE}: no FK into a Sync v2 table" \
  "select count(*) from pg_constraint c join pg_class t on t.oid = c.confrelid
    where c.conrelid = 'app_public.${TABLE}'::regclass and c.contype = 'f'
      and exists (select 1 from information_schema.columns col
                   where col.table_schema = 'app_public' and col.table_name = t.relname
                     and col.column_name = 'owner_user_id');" "0"
expect_sql "${TABLE}: no trigger on any Sync v2 table calls a certification function" \
  "select count(*) from pg_trigger tg join pg_proc p on p.oid = tg.tgfoid
    where not tg.tgisinternal and p.proname like 'group\\_certif%';" "0"
for bearer in "${ATHLETE_TOKEN}" "${ANON_KEY}"; do
  rest GET "${bearer}" "${TABLE}" "select=*"
  if [[ "${STATUS}" =~ ^2 ]]; then
    check "direct select ${TABLE} must return nothing" 'length == 0'
  else
    check "direct select ${TABLE} must be a 42501 denial (HTTP ${STATUS})" '.code == "42501"'
  fi
done
rest POST "${CERTIFIER_TOKEN}" "${TABLE}" "" "$(jq -nc --arg g "${GID}" '{group_id: $g}')"
[[ ! "${STATUS}" =~ ^2 ]] || fail "direct insert into ${TABLE} must be denied"

CERT_FNS="p.proname like 'group\\_certif%'"
expect_sql "every certification function pins search_path" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and (${CERT_FNS})
      and not coalesce(p.proconfig @> array['search_path=app_public, pg_temp'], false);" "0"
expect_sql "clients execute exactly the three certification RPCs" \
  "select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and (${CERT_FNS})
      and has_function_privilege('anon', p.oid, 'execute')
      and has_function_privilege('authenticated', p.oid, 'execute');" \
  "group_certification_cancel,group_certification_withdraw,group_certify"
expect_sql "service_role executes no certification internal" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and (${CERT_FNS})
      and p.proname not in ('group_certify', 'group_certification_withdraw', 'group_certification_cancel')
      and has_function_privilege('service_role', p.oid, 'execute');" "0"
expect_sql "the three RPCs are security definer" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and p.prosecdef
      and p.proname in ('group_certify', 'group_certification_withdraw', 'group_certification_cancel');" "3"
expect_sql "service_role executes neither the apply nor the Certified compute" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and p.proname in ('group_eval_apply', 'group_board_compute')
      and has_function_privilege('service_role', p.oid, 'execute');" "0"
expect_sql "the queue accepts the certification cause" \
  "select pg_get_constraintdef(oid) like '%certification%' from pg_constraint
    where conname = 'group_eval_queue_causes_valid';" "t"
pass "table, grants, direct-access denial, no Sync v2 trigger, RPC posture"

# =============================================================================
echo "[${LANE_LABEL}] rejections: auth, membership, input, target, record set"
# =============================================================================

certify "${ANON_KEY}" "${RIVAL_UID}" r1
expect_error AUTH_REQUIRED "certify without a user"
AGENT_TOKEN="$(mint_token "${CERTIFIER_TOKEN}" "ct-agent-client")"
certify "${AGENT_TOKEN}" "${RIVAL_UID}" r1
expect_error AGENT_FORBIDDEN "certify with an agent token"
withdraw "${AGENT_TOKEN}" "$(q "$(run_psql "select gen_random_uuid();")")"
expect_error AGENT_FORBIDDEN "withdraw with an agent token"
cancel "${ANON_KEY}" "$(q "$(run_psql "select gen_random_uuid();")")"
expect_error AUTH_REQUIRED "cancel without a user"

RANDOM_ID="$(q "$(run_psql "select gen_random_uuid();")")"
for who in OUTSIDER REMOVED; do
  token_var="${who}_TOKEN"
  certify "${!token_var}" "${RIVAL_UID}" r1
  expect_message "NOT_FOUND: group not found" "certify by ${who}"
  withdraw "${!token_var}" "${RANDOM_ID}"
  expect_message "NOT_FOUND: group not found" "withdraw by ${who}"
  cancel "${!token_var}" "${RANDOM_ID}"
  expect_message "NOT_FOUND: group not found" "cancel by ${who}"
done

certify "${ATHLETE_TOKEN}" "${ATHLETE_UID}" a2
expect_message "VALIDATION: you cannot certify your own set" "self-certify"
rpc "${CERTIFIER_TOKEN}" group_certify "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg m "${RIVAL_UID}" \
    '{p_group_id: $g, p_group_exercise_id: $x, p_member_user_id: $m, p_set_id: null}')"
expect_error VALIDATION "certify without a set id"
certify "${CERTIFIER_TOKEN}" "${RIVAL_UID}" r1 "${GXH}"
expect_message "NOT_FOUND: group exercise not found" "another group's exercise"
certify "${CERTIFIER_TOKEN}" "${RIVAL_UID}" r1 "${GXA}"
expect_message "VALIDATION: an archived group exercise is read-only; unarchive it first" "archived exercise"
certify "${CERTIFIER_TOKEN}" "${ATHLETE_UID}" a3
expect_message "NOT_FOUND: record set not found" "a performed set that is not a record set"
certify "${CERTIFIER_TOKEN}" "${ATHLETE_UID}" nope
expect_message "NOT_FOUND: record set not found" "an unknown set id"
certify "${CERTIFIER_TOKEN}" "${ATHLETE_UID}" r1
expect_message "NOT_FOUND: record set not found" "another member's set id"
certify "${CERTIFIER_TOKEN}" "${OUTSIDER_UID}" r1
expect_message "NOT_FOUND: member not found" "a lifter who is not a member"
withdraw "${CERTIFIER_TOKEN}" null
expect_error VALIDATION "withdraw without an id"
withdraw "${CERTIFIER_TOKEN}" "${RANDOM_ID}"
expect_message "NOT_FOUND: certification not found" "withdraw an unknown certification"
expect_sql "no certification was written" \
  "select count(*) from app_public.group_certifications where group_id = '${GID}';" "0"
pass "AUTH_REQUIRED, AGENT_FORBIDDEN, non-member and removed NOT_FOUND, self, input, targets, non-record sets"

# =============================================================================
echo "[${LANE_LABEL}] certify: pinned row, Certified entries, reads, lead_change{certification}"
# =============================================================================

mark
certify "${CERTIFIER_TOKEN}" "${RIVAL_UID}" r1
expect_ok "C certifies R's r1"
check_args "certify returns the pinned certification" --arg c "${CERTIFIER_UID}" --arg r "${RIVAL_UID}" --arg s "${T}-r1" \
  '.created == true
   and (.certification | keys) == ["certification_id","certified_at_ms","certified_by","end_reason","ended_at_ms","ended_by",
                                   "group_exercise_id","group_id","member","pinned","session_id","set_id"]
   and .certification.member.user_id == $r and .certification.certified_by.user_id == $c
   and .certification.set_id == $s and .certification.end_reason == null and .certification.ended_by == null
   and .certification.pinned == {weight_value: "95", reps_value: "1", performance_status: null,
                                 weight_kg: 95, reps: 1, e1rm_kg: .certification.pinned.e1rm_kg}
   and (.certification.pinned.e1rm_kg | type) == "number"'
R1_CERT="$(jq -er '.certification.certification_id' <<<"${BODY}")"
expect_sql "the pin is the live row's fingerprint" \
  "select c.pinned_fingerprint = app_public.group_set_fingerprint(es.weight_value, es.reps_value, es.performance_status, es.deleted_at)
     from app_public.group_certifications c
     join app_public.exercise_sets es on es.owner_user_id = c.member_user_id and es.id = c.set_id
    where c.id = '${R1_CERT}';" "t"
expect_centry R weight "" "no Certified entry before the evaluator runs"
board "${ATHLETE_TOKEN}" weight false
check_args "the All row reads certified at once" --arg r "${RIVAL_UID}" --arg id "${R1_CERT}" --arg c "${CERTIFIER_UID}" \
  '[.rows[] | select(.member.user_id == $r)][0]
   | .certified == true and .certification.certification_id == $id and .certification.certified_by.user_id == $c
     and (.certification | keys) == ["certification_id","certified_at_ms","certified_by"]'
check_args "an uncertified All row" --arg a "${ATHLETE_UID}" \
  '[.rows[] | select(.member.user_id == $a)][0] | .certified == false and .certification == null'

certify "${CERTIFIER_TOKEN}" "${RIVAL_UID}" r1
expect_ok "a repeat certify"
check_args "a repeat certify is idempotent" --arg id "${R1_CERT}" '.created == false and .certification.certification_id == $id'
certify "${ADMIN_TOKEN}" "${RIVAL_UID}" r1
expect_ok "a second member certifies the same set"
check_args "one certification is enough" --arg id "${R1_CERT}" \
  '.created == false and .certification.certification_id == $id'
[[ "$(active_certs r1)" == "1" ]] || fail "one active certification of r1"

drain "certify r1"
expect_centry R weight "95@r1" "the certified set makes a Certified entry"
expect_centry R e1rm "$(run_psql "select value_kg from app_public.group_board_entries
  where group_exercise_id = '${GX}' and member_user_id = '${RIVAL_UID}' and metric = 'e1rm' and not certified;")@r1" \
  "Certified e1RM"
expect_csince "certification:weight@R,certification:e1rm@R" "R takes #1 on both Certified boards"
[[ "$(last_lc_cert)" == "${R1_CERT}" ]] || fail "the lead change names the certification"
expect_sql "Certified lead changes point at no event" \
  "select count(*) from app_public.group_events
    where group_exercise_id = '${GX}' and kind = 'lead_change' and certified and related_event_id is not null;" "0"
history "${ATHLETE_TOKEN}" weight true
check_args "history: related is the certification" --arg id "${R1_CERT}" --arg c "${CERTIFIER_UID}" --arg r "${RIVAL_UID}" --arg s "${T}-r1" \
  '.items | length == 1 and .[0].reason == "certification" and .[0].leader.member.user_id == $r and .[0].previous == null
   and .[0].related == {kind: "certification", key: $id, event: "certified",
                        certified_by: .[0].related.certified_by, ended_by: null, set_id: $s,
                        weight_kg: 95, reps: 1, e1rm_kg: .[0].related.e1rm_kg}
   and .[0].related.certified_by.user_id == $c'
podiums "${ATHLETE_TOKEN}"
check_args "the Certified · e1RM podium" --arg x "${GX}" --arg r "${RIVAL_UID}" --arg id "${R1_CERT}" \
  '.certified == true and ([.exercises[] | select(.exercise.group_exercise_id == $x)][0]
   | [.podium[].member.user_id] == [$r] and .podium[0].certified == true
     and .podium[0].certification.certification_id == $id and .entry_count == 1 and .all_entry_count == 2
     and .me == null)'
stream "${ATHLETE_TOKEN}"
check_args "the stream record item reads certified" --arg s "${T}-r1" --arg id "${R1_CERT}" \
  '[.items[] | select(.kind == "record" and .set_id == $s)][0]
   | .certified == true and .certification.certification_id == $id'
pass "certify: pinned values, idempotent, Certified entries, BoardRow/podium/stream certified, history related"

# =============================================================================
echo "[${LANE_LABEL}] certifying A's sets; withdraw"
# =============================================================================

mark
certify "${RIVAL_TOKEN}" "${ATHLETE_UID}" a1
expect_ok "R certifies A's a1 (a non-voided record, not the All entry)"
A1_CERT="$(jq -er '.certification.certification_id' <<<"${BODY}")"
certify "${CERTIFIER_TOKEN}" "${ATHLETE_UID}" a2
expect_ok "C certifies A's a2"
A2_CERT="$(jq -er '.certification.certification_id' <<<"${BODY}")"
drain "certify a1, a2"
expect_centry A weight "100@a2" "A's best certified set"
expect_csince "certification:weight@A,certification:e1rm@A" "A takes #1 on the Certified boards"
[[ "$(last_lc_cert)" == "${A2_CERT}" ]] || fail "the lead change names a2's certification"

for who in ADMIN RIVAL ATHLETE; do
  token_var="${who}_TOKEN"
  withdraw "${!token_var}" "$(q "${A2_CERT}")"
  expect_message "FORBIDDEN: only the certifier can withdraw a certification" "withdraw by ${who}"
done
mark
withdraw "${CERTIFIER_TOKEN}" "$(q "${A2_CERT}")"
expect_ok "the certifier withdraws"
check_args "withdrawn by the certifier" --arg c "${CERTIFIER_UID}" \
  '.certification.end_reason == "withdrawn" and .certification.ended_by.user_id == $c and .certification.ended_at_ms != null'
ENDED_AT="$(jq -er '.certification.ended_at_ms' <<<"${BODY}")"
board "${ATHLETE_TOKEN}" e1rm true
check_args "the withdrawn entry leaves the Certified reads before any apply" --arg r "${RIVAL_UID}" \
  '[.rows[].member.user_id] == [$r] and .rows[0].rank == 1'
drain "withdraw a2"
expect_centry A weight "90@a1" "the next-best certified set takes the entry"
expect_csince "certification:weight@A,certification:e1rm@A" "A loses #1 to R"
[[ "$(last_lc_cert)" == "${A2_CERT}" ]] || fail "the lead change names the withdrawn certification"
history "${ATHLETE_TOKEN}" e1rm true
check "history: withdrawn" '.items[0].related.event == "withdrawn" and .items[0].reason == "certification"'
withdraw "${CERTIFIER_TOKEN}" "$(q "${A2_CERT}")"
expect_ok "a repeat withdraw"
check_args "a repeat withdraw is idempotent" --arg t "${ENDED_AT}" \
  '.certification.end_reason == "withdrawn" and (.certification.ended_at_ms | tostring) == $t'
pass "withdraw: certifier only, immediate on reads, refill and lead_change after the apply, idempotent"

# =============================================================================
echo "[${LANE_LABEL}] admin cancel; re-certify after cancel (D4)"
# =============================================================================

cancel "${CERTIFIER_TOKEN}" "$(q "${R1_CERT}")"
expect_message "FORBIDDEN: only the owner or an admin can cancel a certification" "cancel by a member"
mark
cancel "${ADMIN_TOKEN}" "$(q "${R1_CERT}")"
expect_ok "an admin cancels a certification they did not give"
check_args "cancelled by the admin" --arg a "${ADMIN_UID}" \
  '.certification.end_reason == "cancelled" and .certification.ended_by.user_id == $a'
ENDED_AT="$(jq -er '.certification.ended_at_ms' <<<"${BODY}")"
cancel "${OWNER_TOKEN}" "$(q "${R1_CERT}")"
expect_ok "a repeat cancel"
check_args "a repeat cancel keeps the first end" --arg t "${ENDED_AT}" --arg a "${ADMIN_UID}" \
  '(.certification.ended_at_ms | tostring) == $t and .certification.ended_by.user_id == $a'
drain "cancel r1"
expect_centry R weight "" "the cancelled set leaves the Certified board"
expect_csince "certification:weight@R,certification:e1rm@R" "R loses #1"
cancel "${OWNER_TOKEN}" "$(q "${A1_CERT}")"
expect_ok "the owner cancels"
mark
drain "cancel a1"
expect_centry A weight "" "A has no certified set left"
expect_csince "certification:weight@A,certification:e1rm@A" "the Certified board empties"
expect_sql "an emptied board's lead change has a null leader" \
  "select jsonb_typeof(payload -> 'leader') from app_public.group_events
    where group_exercise_id = '${GX}' and kind = 'lead_change' and certified order by seq desc limit 1;" "null"

mark
certify "${CERTIFIER_TOKEN}" "${RIVAL_UID}" r1
expect_ok "re-certify a cancelled set"
check_args "re-certifying creates a new row" --arg old "${R1_CERT}" '.created == true and .certification.certification_id != $old'
R1_CERT2="$(jq -er '.certification.certification_id' <<<"${BODY}")"
[[ "$(cert_col "${R1_CERT}" end_reason)" == "cancelled" ]] || fail "the cancelled row stays cancelled"
drain "re-certify r1"
expect_centry R weight "95@r1" "the Certified entry returns"
expect_csince "certification:weight@R,certification:e1rm@R" "R takes #1 again"
pass "cancel: owner/admin only, idempotent; re-certify inserts a new certification"

# =============================================================================
echo "[${LANE_LABEL}] void on edit (completed and active sessions); CONFLICT"
# =============================================================================

set_edit "${ATHLETE_TOKEN}" "${T}-s1" a1 0 91 1
certify "${CERTIFIER_TOKEN}" "${ATHLETE_UID}" a1
expect_message "CONFLICT: the set changed; refresh and try again" "certify a set edited ahead of the evaluator"
drain "a1 edit"

mark
set_edit "${RIVAL_TOKEN}" "${T}-r1s" r1 0 96 1
drain "r1 edit"
[[ "$(cert_col "${R1_CERT2}" "end_reason || ':' || coalesce(ended_by::text, 'null')")" == "voided:null" ]] ||
  fail "an edit voids the certification, with no actor"
expect_centry R weight "" "the voided set leaves the Certified board"
expect_csince "certification:weight@R,certification:e1rm@R" "the void moves #1"
[[ "$(last_lc_cert)" == "${R1_CERT2}" ]] || fail "the lead change names the voided certification"
history "${ATHLETE_TOKEN}" weight true
check "history: voided" '.items[0].related.event == "voided" and .items[0].related.ended_by == null'
stream "${ATHLETE_TOKEN}"
check_args "every record item of r1 now reads uncertified" --arg s "${T}-r1" \
  '[.items[] | select(.kind == "record" and .set_id == $s)] | length == 2 and all(.certified == false and .certification == null)'

next_session_at
sess "${ATHLETE_TOKEN}" "${T}-s3" active "${DA}" "a4:110:1"
drain "a4 (active)"
certify "${CERTIFIER_TOKEN}" "${ATHLETE_UID}" a4
expect_ok "certify a provisional record"
A4_CERT="$(jq -er '.certification.certification_id' <<<"${BODY}")"
drain "certify a4"
expect_centry A weight "110@a4" "a provisional record set can be certified"
set_edit "${ATHLETE_TOKEN}" "${T}-s3" a4 0 111 1
drain "a4 edit (still active)"
[[ "$(cert_col "${A4_CERT}" end_reason)" == "voided" ]] || fail "an edit in an active session voids too"
expect_centry A weight "" "no Certified entry after the void"
pass "void on edit: completed and active sessions, lead_change{certification}, reads; CONFLICT before the apply"

# =============================================================================
echo "[${LANE_LABEL}] void on delete: set tombstone, session tombstone, no revival"
# =============================================================================

certify "${CERTIFIER_TOKEN}" "${RIVAL_UID}" r1
expect_ok "certify r1 at 96"
R1_CERT3="$(jq -er '.certification.certification_id' <<<"${BODY}")"
drain "certify r1 at 96"
expect_centry R weight "96@r1" "certified r1"
mark
set_edit "${RIVAL_TOKEN}" "${T}-r1s" r1 0 96 1 "$(now_ms)"
drain "r1 tombstone"
[[ "$(cert_col "${R1_CERT3}" end_reason)" == "voided" ]] || fail "a set tombstone voids"
expect_centry R weight "" "no Certified entry after the delete"
expect_csince "certification:weight@R,certification:e1rm@R" "the delete moves #1"
set_edit "${RIVAL_TOKEN}" "${T}-r1s" r1 0 96 1
drain "r1 undelete"
[[ "$(active_certs r1)" == "0" ]] || fail "undelete does not revive a certification"
expect_centry R weight "" "no Certified entry after the undelete"

certify "${RIVAL_TOKEN}" "${ATHLETE_UID}" a2
expect_ok "certify a2 (a non-voided record, no longer the All entry)"
A2_CERT2="$(jq -er '.certification.certification_id' <<<"${BODY}")"
drain "certify a2"
expect_centry A weight "100@a2" "certified a2"
session_row "${ATHLETE_TOKEN}" "${T}-s2" "${S2_AT}" completed "$(now_ms)"
drain "s2 tombstone"
[[ "$(cert_col "${A2_CERT2}" end_reason)" == "voided" ]] || fail "a session tombstone voids"
expect_centry A weight "" "no Certified entry after the session delete"
session_row "${ATHLETE_TOKEN}" "${T}-s2" "${S2_AT}" completed
drain "s2 undelete"
[[ "$(active_certs a2)" == "0" ]] || fail "a session undelete does not revive a certification"
pass "void on delete: set and session tombstones void; undelete does not revive"

# =============================================================================
echo "[${LANE_LABEL}] non-voiding changes: unlink / relink, load mode, rules recompute"
# =============================================================================

next_session_at
sess "${RIVAL_TOKEN}" "${T}-r3s" completed "${DR}" "r3:98:1"
drain "r3"
certify "${CERTIFIER_TOKEN}" "${RIVAL_UID}" r3
expect_ok "certify r3"
R3_CERT="$(jq -er '.certification.certification_id' <<<"${BODY}")"
drain "certify r3"
expect_centry R weight "98@r3" "certified r3"

mark
link "${RIVAL_TOKEN}" "${DR}" deleted
drain "unlink"
[[ "$(active_certs r3)" == "1" ]] || fail "unlink voids nothing"
expect_centry R weight "" "an unlinked set leaves the Certified board"
expect_csince "link:weight@R,link:e1rm@R" "unlink moves #1 with reason link"
expect_sql "the Certified lead change points at the unlink item" \
  "select count(*) from app_public.group_events lc join app_public.group_events u on u.id = lc.related_event_id
    where lc.group_exercise_id = '${GX}' and lc.kind = 'lead_change' and lc.certified and lc.seq > ${MARK}
      and u.kind = 'unlink';" "2"
mark
link "${RIVAL_TOKEN}" "${DR}"
drain "relink"
expect_centry R weight "98@r3" "relinking restores the certified entry"
expect_csince "link:weight@R,link:e1rm@R" "relink moves #1 with reason link"

def "${RIVAL_TOKEN}" "${DR}" per_side_load
drain "load mode"
[[ "$(active_certs r3)" == "1" ]] || fail "a load-mode change voids nothing"
expect_centry R weight "196@r3" "a load-mode change rescales the certified value (D6)"

run_psql "update app_public.group_board_entries set value_kg = 1
           where group_exercise_id = '${GX}' and member_user_id = '${RIVAL_UID}' and certified and metric = 'weight';" >/dev/null
mark
expect_sql "a rules bump requeues evaluated sessions" "select app_public.group_eval_requeue_rules(2, 1000) >= 1;" "t"
drain "rules"
expect_centry R weight "196@r3" "the rules recompute corrects Certified entries"
[[ "$(active_certs r3)" == "1" ]] || fail "a rules recompute voids nothing that still matches"
expect_sql "the rules recompute writes no event" \
  "select count(*) from app_public.group_events where group_id = '${GID}' and seq > ${MARK};" "0"
pass "unlink/relink (reason link), load mode, and rules recompute keep the certification"

# =============================================================================
echo "[${LANE_LABEL}] frozen board: a former lifter"
# =============================================================================

rpc "${RIVAL_TOKEN}" group_leave "$(jq -nc --arg g "${GID}" '{p_group_id: $g}')"
expect_ok "R leaves"
drain "after leave"
certify "${CERTIFIER_TOKEN}" "${RIVAL_UID}" r3
expect_message "NOT_FOUND: member not found" "certify a former member's set"
cancel "${ADMIN_TOKEN}" "$(q "${R3_CERT}")"
expect_ok "cancel a former member's certification"
board "${ATHLETE_TOKEN}" weight true
check_args "the ended certification leaves the frozen Certified board at once" --arg r "${RIVAL_UID}" \
  '[.rows[] | select(.member.user_id == $r)] == []'
podiums "${ATHLETE_TOKEN}"
check_args "the podium count ignores it" --arg x "${GX}" \
  '[.exercises[] | select(.exercise.group_exercise_id == $x)][0].entry_count == 0'
drain "after cancel (frozen: no apply)"
expect_centry R weight "196@r3" "the frozen stored entry stays until a catch-up"
pass "frozen: certify rejected, cancel immediate on the reads"

# =============================================================================
echo "[${LANE_LABEL}] failure isolation: a failed enqueue never fails the certification"
# =============================================================================

run_psql "alter table app_public.group_eval_queue add constraint ${FORCE_ENQUEUE_CONSTRAINT} check (false) not valid;" >/dev/null
certify "${CERTIFIER_TOKEN}" "${ATHLETE_UID}" a4
expect_ok "certify under a forced enqueue failure"
A4_CERT2="$(jq -er '.certification.certification_id' <<<"${BODY}")"
run_psql "alter table app_public.group_eval_queue drop constraint ${FORCE_ENQUEUE_CONSTRAINT};" >/dev/null
[[ "$(cert_col "${A4_CERT2}" "ended_at is null")" == "t" ]] || fail "the certification committed"
expect_sql "exactly one sanitized enqueue failure row" \
  "select count(*) || ':' || min(context ->> 'table') || ':' || min(context ->> 'row_id') || ':' || min(context ->> 'sqlstate')
          || ':' || bool_and(not (context ? 'message'))
     from public.app_logs where event = 'group.eval_enqueue_failed' and user_id = '${ATHLETE_UID}';" \
  "1:group_certifications:${A4_CERT2}:23514:true"
expect_sql "no job was queued" \
  "select count(*) from app_public.group_eval_queue where member_user_id = '${ATHLETE_UID}';" "0"
drain "nothing queued"
expect_centry A weight "" "no apply ran"
next_cuam
push "${ATHLETE_TOKEN}" "repair push" "$(e_set "${T}-a5" "${T}-s3-se" 1 20 1 "" "${CUAM}")"
drain "repair"
expect_centry A weight "111@a4" "the next job for the target repairs the Certified entry"
pass "a failed enqueue logs once and commits; the next job repairs"

COMPLETED=1
echo "[${LANE_LABEL}] passed (run ${RUN_TAG})"
