#!/usr/bin/env bash

# groups-certification.sh — certification contract on protocol 4 (the third
# body of the groups-leaderboards lane; groups-boards.sh proves the All boards).
#
# Contract: docs/specs/tech/group-competition-contract.md
# Proves, against the real local stack (sync_push, group-eval, PostgREST):
#
#   - posture of group_certifications, group_metric_certifications and the
#     group_competition certification RPCs;
#   - every rejection: non-member and removed caller, self-certify, input,
#     another group's exercise, archived, non-record set, unknown or foreign
#     set (no score for the write token), former lifter;
#   - certify per metric (idempotent, write token from the All board, the
#     stream record_context or the set's score), withdraw, admin cancel,
#     re-certify after cancel;
#   - voids on edit (completed and active sessions) and on delete (set and
#     session tombstones), no revival on a session undelete; unlink and a rules
#     requeue void nothing;
#   - Certified Volume and e1RM entries (group_metric_board_entries at the
#     current rules revision), lead_change{certification}, board / podium /
#     stream record_context `certification`, history `reason`;
#   - frozen boards drop an ended certification from the reads at once;
#   - enqueue failure isolation and repair;
#   - a rules-revision rebuild republishes silently and keeps the certification.
#
# Direct-drain mode as groups-boards.sh: the kick URL is
# unset and the sweep paused for the run; the lane POSTs group-eval itself.
# Hermetic: per-run users, deleted on exit with everything they own (a group's
# comparison jobs cascade from it).

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
psql_session_start

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
            alter table app_public.group_metric_eval_queue drop constraint if exists ${FORCE_ENQUEUE_CONSTRAINT};" >/dev/null
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
  psql_session_stop
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

METRICS=(volume e1rm)

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
  eval_drain
  expect_ok "group-eval drain: $1"
  check "group-eval drain: $1: no failed job" '.failed == 0'
}

WHO_SQL() { # a SQL case expression mapping member uuids in column $1 to A/R
  echo "case $1 when '${ATHLETE_UID}' then 'A' when '${RIVAL_UID}' then 'R' else '?' end"
}

# The comparison's current rules revision: the only one its boards publish.
revision() { run_psql "select rules_revision from app_public.group_exercises where id = '${1:-${GX}}';"; }

# centry <member-label> <metric>: the Certified entry at the current rules
# revision as `value@set`, or empty.
centry() {
  local uid
  case "$1" in A) uid="${ATHLETE_UID}" ;; R) uid="${RIVAL_UID}" ;; esac
  run_psql "select e.value || '@' || replace(e.set_id, '${T}-', '')
              from app_public.group_metric_board_entries e
              join app_public.group_exercises ge on ge.id = e.group_exercise_id and ge.rules_revision = e.rules_revision
             where e.group_exercise_id = '${GX}' and e.member_user_id = '${uid}' and e.metric = '$2' and e.certified;"
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
# last_lc_cert <metric>: the latest Certified lead change's payload certification_id.
last_lc_cert() {
  run_psql "select coalesce(payload ->> 'certification_id', '') from app_public.group_events
             where group_exercise_id = '${GX}' and kind = 'lead_change' and certified and metric = '$1'
             order by seq desc limit 1;"
}

# A certified set holds one certification per metric; <prefix>_volume and
# <prefix>_e1rm name them. cert_id <prefix> <metric> echoes one.
cert_id() { local name="$1_$2"; printf '%s' "${!name}"; }
# expect_lc_certs <prefix> <context>: each metric's latest Certified lead change
# names that metric's certification of the set.
expect_lc_certs() {
  local metric
  for metric in "${METRICS[@]}"; do
    [[ "$(last_lc_cert "${metric}")" == "$(cert_id "$1" "${metric}")" ]] || fail "$2 (${metric})"
  done
}
# cert_col <certification-id> <column-sql>
cert_col() { run_psql "select $2 from app_public.group_metric_certifications where id = '$1';"; }
# certs_col <prefix> <column-sql>: the column for both metrics, as `volume,e1rm`.
certs_col() { echo "$(cert_col "$(cert_id "$1" volume)" "$2"),$(cert_col "$(cert_id "$1" e1rm)" "$2")"; }
active_certs() { # active_certs <set-suffix>: active certifications as `volume:e1rm`
  run_psql "select count(*) filter (where metric = 'volume') || ':' || count(*) filter (where metric = 'e1rm')
              from app_public.group_metric_certifications
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

gx() { # gx <token> <group> <name>: echoes a new ordinary total_load comparison id (default e1RM)
  rpc "$1" group_competition_exercise_create \
    "$(jq -nc --arg g "$2" --arg n "$3" '{p_group_id: $g, p_name: $n, p_load_input_mode: "total_load",
        p_source_exercise_id: null, p_bodyweight_contribution: 0, p_default_metric: "e1rm"}')"
  expect_ok "group_competition_exercise_create $3"
  jq -er '.exercise.group_exercise_id' <<<"${BODY}"
}

# score_token <member-uid> <set-suffix> <metric>: the set's write token at the
# current revision (what a client reads for a record that holds no entry).
score_token() {
  run_psql "select write_token from app_public.group_metric_set_scores
             where group_exercise_id = '${GX}' and rules_revision = $(revision)
               and member_user_id = '$1' and set_id = '${T}-$2' and metric = '$3';"
}
# board_token <member-uid> <set-suffix>: the write token of that board entry in BODY.
board_token() {
  jq -er --arg u "$1" --arg s "${T}-$2" '.entries[] | select(.member.user_id == $u and .performance.set_id == $s) | .write_token' <<<"${BODY}"
}
# certify <token> <member-uid> <set-suffix> <metric> <write-token|""> [group-exercise]
# The expected revision is the comparison's current one.
certify() {
  local x="${6:-${GX}}"
  rpc "$1" group_competition_certify "$(jq -nc --arg g "${GID}" --arg x "${x}" --arg m "$2" --arg s "${T}-$3" \
      --arg metric "$4" --arg t "$5" --argjson r "$(revision "${x}")" \
      '{p_group_id: $g, p_group_exercise_id: $x, p_member_user_id: $m, p_set_id: $s, p_metric: $metric,
        p_expected_revision: $r, p_write_token: (if $t == "" then null else $t end)}')"
}
# certify_set <token> <member-uid> <set-suffix> <prefix>: certifies the set on
# both metrics with its score tokens; sets <prefix>_volume and <prefix>_e1rm.
certify_set() {
  local metric
  for metric in "${METRICS[@]}"; do
    certify "$1" "$2" "$3" "${metric}" "$(score_token "$2" "$3" "${metric}")"
    expect_ok "certify $3 (${metric})"
    printf -v "$4_${metric}" '%s' "$(jq -er '.certification.certification_id' <<<"${BODY}")"
  done
}
# end_cert <token> <action-json> <metric-json> <certification-id-json>
end_cert() {
  rpc "$1" group_competition_certification_end "$(jq -nc --arg g "${GID}" --argjson a "$2" --argjson m "$3" --argjson c "$4" \
      '{p_group_id: $g, p_certification_id: $c, p_metric: $m, p_action: $a}')"
}
# end_set <token> <withdraw|cancel> <prefix>: ends both metrics' certifications.
end_set() {
  local metric
  for metric in "${METRICS[@]}"; do
    end_cert "$1" "$(q "$2")" "$(q "${metric}")" "$(q "$(cert_id "$3" "${metric}")")"
    expect_ok "$2 $3 (${metric})"
  done
}
q() { printf '"%s"' "$1"; } # a JSON string

# board <token> <metric> <certified>: group_competition_board into BODY.
board() {
  rpc "$1" group_competition_board "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg m "$2" --argjson c "$3" \
      '{p_group_id: $g, p_group_exercise_id: $x, p_metric: $m, p_certified: $c}')"
  expect_ok "group_competition_board $2 certified=$3"
}
history() {
  rpc "$1" group_competition_history "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg m "$2" --argjson c "$3" \
      '{p_group_id: $g, p_group_exercise_id: $x, p_metric: $m, p_certified: $c}')"
  expect_ok "group_competition_history $2 certified=$3"
}
podiums() {
  rpc "$1" group_competition_podiums "$(jq -nc --arg g "${GID}" '{p_group_id: $g, p_certified: true}')"
  expect_ok "group_competition_podiums"
}
stream() {
  rpc "$1" group_competition_stream "$(jq -nc --arg g "${GID}" '{p_group_id: $g, p_before: null, p_limit: 50}')"
  expect_ok "group_competition_stream"
}
# jq: the stream's record items for set $s.
RECORDS='[.items[] | select(.kind == "competition" and .event.kind == "record" and .event.set_id == $s)]'

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
rpc "${OWNER_TOKEN}" group_competition_exercise_archive "$(jq -nc --arg g "${GID}" --arg e "${GXA}" \
    '{p_group_id: $g, p_exercise_id: $e, p_archived: true}')"
expect_ok "archive GXA"

DA="${T}-dA"; DR="${T}-dR"
def "${ATHLETE_TOKEN}" "${DA}" total_load
link "${ATHLETE_TOKEN}" "${DA}"
def "${RIVAL_TOKEN}" "${DR}" total_load
link "${RIVAL_TOKEN}" "${DR}"

# A: a1 90×1, then a2 100×1 (records) with a3 50×1 (not a record); R: r1 95×1.
# Volume is kg × reps, so every value below reads as its weight.
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

for TABLE in group_certifications group_metric_certifications; do
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
  expect_sql "${TABLE}: no trigger on a Sync v2 table touches certifications" \
    "select count(*) from pg_trigger tg join pg_proc p on p.oid = tg.tgfoid
      where not tg.tgisinternal
        and (p.proname like 'group\\_certif%' or p.prosrc like '%group_certif%' or p.prosrc like '%${TABLE}%')
        and exists (select 1 from information_schema.columns col join pg_class c on c.oid = tg.tgrelid
                     where col.table_schema = 'app_public' and col.table_name = c.relname
                       and col.column_name = 'owner_user_id');" "0"
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
  check "direct insert into ${TABLE} must be a 42501 denial (HTTP ${STATUS})" '.code == "42501"'
done

CERT_FNS="p.proname like 'group\\_certif%' or p.proname like 'group\\_competition\\_certif%'"
CERT_RPCS="'group_competition_certification_end', 'group_competition_certification_get', 'group_competition_certify'"
expect_sql "every certification function pins search_path" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and (${CERT_FNS})
      and not coalesce(p.proconfig @> array['search_path=app_public, pg_temp'], false);" "0"
expect_sql "authenticated executes exactly the three competition certification RPCs" \
  "select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and p.proname like 'group\\_competition\\_certif%'
      and has_function_privilege('authenticated', p.oid, 'execute');" \
  "group_competition_certification_end,group_competition_certification_get,group_competition_certify"
expect_sql "anon executes no competition certification function" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and p.proname like 'group\\_competition\\_certif%'
      and has_function_privilege('anon', p.oid, 'execute');" "0"
expect_sql "service_role executes no certification internal" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and (${CERT_FNS})
      and has_function_privilege('service_role', p.oid, 'execute');" "0"
expect_sql "the three RPCs are security definer" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public' and p.prosecdef and p.proname in (${CERT_RPCS});" "3"
expect_sql "service_role executes neither an apply nor a Certified compute" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_public'
      and p.proname in ('group_eval_apply', 'group_metric_apply_member', 'group_metric_compute')
      and has_function_privilege('service_role', p.oid, 'execute');" "0"
expect_sql "both queues accept the certification cause" \
  "select count(*) || ':' || bool_and(pg_get_constraintdef(oid) like '%certification%') from pg_constraint
    where conname in ('group_eval_queue_causes_valid', 'group_metric_eval_queue_causes_check');" "2:true"
pass "tables, grants, direct-access denial, no Sync v2 trigger, RPC posture"

# =============================================================================
echo "[${LANE_LABEL}] rejections: membership, input, target, record set, token"
# =============================================================================

# Anonymous and agent callers are denied by groups-competitions.sh for every
# group_competition_* RPC.
RANDOM_ID="$(q "$(run_psql "select gen_random_uuid();")")"
R1_SCORE="$(score_token "${RIVAL_UID}" r1 volume)"
[[ "${R1_SCORE}" =~ ${UUID_RE} ]] || fail "r1 has a Volume score"
for who in OUTSIDER REMOVED; do
  token_var="${who}_TOKEN"
  certify "${!token_var}" "${RIVAL_UID}" r1 volume "${R1_SCORE}"
  expect_message "NOT_FOUND: group not found" "certify by ${who}"
  for action in withdraw cancel; do
    end_cert "${!token_var}" "$(q "${action}")" '"volume"' "${RANDOM_ID}"
    expect_message "NOT_FOUND: group not found" "${action} by ${who}"
  done
done

certify "${ATHLETE_TOKEN}" "${ATHLETE_UID}" a2 volume "$(score_token "${ATHLETE_UID}" a2 volume)"
expect_message "VALIDATION: a different member and set are required" "self-certify"
rpc "${CERTIFIER_TOKEN}" group_competition_certify "$(jq -nc --arg g "${GID}" --arg x "${GX}" --arg m "${RIVAL_UID}" \
    --arg t "${R1_SCORE}" --argjson r "$(revision)" \
    '{p_group_id: $g, p_group_exercise_id: $x, p_member_user_id: $m, p_set_id: null, p_metric: "volume",
      p_expected_revision: $r, p_write_token: $t}')"
expect_error VALIDATION "certify without a set id"
certify "${CERTIFIER_TOKEN}" "${RIVAL_UID}" r1 volume "${R1_SCORE}" "${GXH}"
expect_message "NOT_FOUND: group exercise not found" "another group's exercise"
certify "${CERTIFIER_TOKEN}" "${RIVAL_UID}" r1 volume "${R1_SCORE}" "${GXA}"
expect_message "VALIDATION: archived comparisons are read-only" "archived exercise"
A3_SCORE="$(score_token "${ATHLETE_UID}" a3 volume)"
[[ "${A3_SCORE}" =~ ${UUID_RE} ]] || fail "a3 has a Volume score"
certify "${CERTIFIER_TOKEN}" "${ATHLETE_UID}" a3 volume "${A3_SCORE}"
expect_message "NOT_FOUND: record set not found for this metric" "a performed set that is not a record set"
certify "${CERTIFIER_TOKEN}" "${ATHLETE_UID}" nope volume "$(run_psql "select gen_random_uuid();")"
expect_message "CONFLICT: performance changed; refresh before certifying" "an unknown set id (no score)"
certify "${CERTIFIER_TOKEN}" "${ATHLETE_UID}" r1 volume "${R1_SCORE}"
expect_message "CONFLICT: performance changed; refresh before certifying" "another member's set id"
certify "${CERTIFIER_TOKEN}" "${OUTSIDER_UID}" r1 volume "${R1_SCORE}"
expect_message "NOT_FOUND: member not found" "a lifter who is not a member"
end_cert "${CERTIFIER_TOKEN}" '"withdraw"' '"volume"' null
expect_message "NOT_FOUND: certification not found" "withdraw without an id"
end_cert "${CERTIFIER_TOKEN}" null '"volume"' "${RANDOM_ID}"
expect_error VALIDATION "end without an action"
end_cert "${CERTIFIER_TOKEN}" '"withdraw"' null "${RANDOM_ID}"
expect_error VALIDATION "end without a metric"
end_cert "${CERTIFIER_TOKEN}" '"withdraw"' '"volume"' "${RANDOM_ID}"
expect_message "NOT_FOUND: certification not found" "withdraw an unknown certification"
expect_sql "no certification was written" \
  "select count(*) from app_public.group_metric_certifications where group_id = '${GID}';" "0"
pass "non-member and removed NOT_FOUND, self, input, targets, non-record set, token CONFLICT, end input"

# =============================================================================
echo "[${LANE_LABEL}] certify: pinned rows, Certified entries, reads, lead_change{certification}"
# =============================================================================

# The tokens come from R's All board entries, as the app certifies a board row.
mark
for metric in "${METRICS[@]}"; do
  board "${CERTIFIER_TOKEN}" "${metric}" false
  token="$(board_token "${RIVAL_UID}" r1)"
  certify "${CERTIFIER_TOKEN}" "${RIVAL_UID}" r1 "${metric}" "${token}"
  expect_ok "C certifies R's r1 (${metric})"
  check_args "certify returns the new certification (${metric})" --arg c "${CERTIFIER_UID}" --arg m "${metric}" \
      --arg rev "$(revision)" \
    '.created == true
     and (.certification | keys) == ["certification_id","certified_at_ms","certified_by","end_reason","ended_at_ms",
                                     "metric","observed_rules_revision"]
     and .certification.metric == $m and .certification.certified_by.user_id == $c
     and (.certification.observed_rules_revision | tostring) == $rev
     and .certification.end_reason == null and .certification.ended_at_ms == null'
  printf -v "R1_${metric}" '%s' "$(jq -er '.certification.certification_id' <<<"${BODY}")"
done
expect_sql "each pin is the live set's observed pin" \
  "select count(*) || ':' || bool_and(c.observed_set_pin = r ->> 'observed_set_pin')
     from app_public.group_metric_certifications c
     cross join lateral jsonb_array_elements(app_public.group_metric_eval_source_graph('${GID}', '${GX}') -> 'sets') r
    where c.id in ('${R1_volume}', '${R1_e1rm}')
      and r ->> 'member_user_id' = c.member_user_id::text and r ->> 'set_id' = c.set_id;" "2:true"
expect_centry R volume "" "no Certified entry before the evaluator runs"
board "${ATHLETE_TOKEN}" volume false
check_args "the All row reads certified at once" --arg r "${RIVAL_UID}" --arg id "${R1_volume}" --arg c "${CERTIFIER_UID}" \
  '[.entries[] | select(.member.user_id == $r)][0]
   | .certification.certification_id == $id and .certification.certified_by.user_id == $c
     and .certification.metric == "volume" and .certification.end_reason == null'
check_args "an uncertified All row" --arg a "${ATHLETE_UID}" \
  '[.entries[] | select(.member.user_id == $a)][0] | .certification == null'

for metric in "${METRICS[@]}"; do
  certify "${CERTIFIER_TOKEN}" "${RIVAL_UID}" r1 "${metric}" "$(score_token "${RIVAL_UID}" r1 "${metric}")"
  expect_ok "a repeat certify (${metric})"
  check_args "a repeat certify is idempotent (${metric})" --arg id "$(cert_id R1 "${metric}")" \
    '.created == false and .certification.certification_id == $id'
  certify "${ADMIN_TOKEN}" "${RIVAL_UID}" r1 "${metric}" "$(score_token "${RIVAL_UID}" r1 "${metric}")"
  expect_ok "a second member certifies the same set (${metric})"
  check_args "one certification is enough (${metric})" --arg id "$(cert_id R1 "${metric}")" \
    '.created == false and .certification.certification_id == $id'
done
[[ "$(active_certs r1)" == "1:1" ]] || fail "one active certification of r1 per metric"

drain "certify r1"
expect_centry R volume "95@r1" "the certified set makes a Certified entry"
expect_centry R e1rm "$(run_psql "select value from app_public.group_metric_board_entries
  where group_exercise_id = '${GX}' and rules_revision = $(revision) and member_user_id = '${RIVAL_UID}'
    and metric = 'e1rm' and not certified;")@r1" \
  "Certified e1RM"
expect_csince "certification:volume@R,certification:e1rm@R" "R takes #1 on both Certified boards"
expect_lc_certs R1 "the lead change names the certification"
expect_sql "Certified lead changes point at no event" \
  "select count(*) from app_public.group_events
    where group_exercise_id = '${GX}' and kind = 'lead_change' and certified and related_event_id is not null;" "0"
history "${ATHLETE_TOKEN}" volume true
check_args "history: a certification lead change to R" --arg r "${RIVAL_UID}" \
  '.events | length == 1 and .[0].kind == "lead_change" and .[0].reason == "certification" and .[0].certified == true
   and .[0].related_event_id == null and .[0].member.user_id == $r
   and ([.[0].values[] | select(.role == "leader") | {member: .member.user_id, value, unit}]
        == [{member: $r, value: 95, unit: "kg_reps"}])
   and ([.[0].values[] | select(.role == "previous")] == [])'
podiums "${ATHLETE_TOKEN}"
check_args "the Certified · e1RM podium" --arg x "${GX}" --arg r "${RIVAL_UID}" --arg id "${R1_e1rm}" \
  '.certified == true and ([.podiums[] | select(.exercise.group_exercise_id == $x)][0].board
   | .metric == "e1rm" and .certified == true and [.entries[].member.user_id] == [$r]
     and .entries[0].certification.certification_id == $id and .entry_count == 1 and .me == null)'
stream "${ATHLETE_TOKEN}"
check_args "the stream record item reads certified on both metrics" --arg s "${T}-r1" --arg v "${R1_volume}" --arg e "${R1_e1rm}" \
  "${RECORDS}"'[0].event.record_context.metrics
   | (map({key: .metric, value: .certification.certification_id}) | from_entries) == {volume: $v, e1rm: $e}'
pass "certify: pinned rows, idempotent, Certified entries, board/podium/stream certification, history reason"

# =============================================================================
echo "[${LANE_LABEL}] certifying A's sets; withdraw"
# =============================================================================

# a1 is a record that holds no entry: its tokens come from its stream record
# item, as the app certifies a record card.
mark
for metric in "${METRICS[@]}"; do
  stream "${RIVAL_TOKEN}"
  token="$(jq -er --arg s "${T}-a1" --arg m "${metric}" \
    "${RECORDS}"'[0].event.record_context.metrics[] | select(.metric == $m and .eligible) | .write_token' <<<"${BODY}")"
  certify "${RIVAL_TOKEN}" "${ATHLETE_UID}" a1 "${metric}" "${token}"
  expect_ok "R certifies A's a1 (a non-voided record, not the All entry; ${metric})"
  printf -v "A1_${metric}" '%s' "$(jq -er '.certification.certification_id' <<<"${BODY}")"
done
certify_set "${CERTIFIER_TOKEN}" "${ATHLETE_UID}" a2 A2
drain "certify a1, a2"
expect_centry A volume "100@a2" "A's best certified set"
expect_csince "certification:volume@A,certification:e1rm@A" "A takes #1 on the Certified boards"
expect_lc_certs A2 "the lead change names a2's certification"

for who in ADMIN RIVAL ATHLETE; do
  token_var="${who}_TOKEN"
  end_cert "${!token_var}" '"withdraw"' '"volume"' "$(q "${A2_volume}")"
  expect_message "FORBIDDEN: certification action is not allowed" "withdraw by ${who}"
done
mark
for metric in "${METRICS[@]}"; do
  end_cert "${CERTIFIER_TOKEN}" '"withdraw"' "$(q "${metric}")" "$(q "$(cert_id A2 "${metric}")")"
  expect_ok "the certifier withdraws (${metric})"
  check_args "withdrawn (${metric})" --arg id "$(cert_id A2 "${metric}")" \
    '.certification.certification_id == $id and .certification.end_reason == "withdrawn" and .certification.ended_at_ms != null'
  printf -v "ENDED_AT_${metric}" '%s' "$(jq -er '.certification.ended_at_ms' <<<"${BODY}")"
done
[[ "$(certs_col A2 "ended_by = '${CERTIFIER_UID}'")" == "t,t" ]] || fail "withdrawn by the certifier"
board "${ATHLETE_TOKEN}" e1rm true
check_args "the withdrawn entry leaves the Certified reads before any apply" --arg r "${RIVAL_UID}" \
  '[.entries[].member.user_id] == [$r] and .entries[0].rank == 1'
drain "withdraw a2"
expect_centry A volume "90@a1" "the next-best certified set takes the entry"
expect_csince "certification:volume@A,certification:e1rm@A" "A loses #1 to R"
expect_lc_certs A2 "the lead change names the withdrawn certification"
history "${ATHLETE_TOKEN}" e1rm true
check "history: the withdrawal" '.events[0].reason == "certification" and .events[0].certified == true'
for metric in "${METRICS[@]}"; do
  end_cert "${CERTIFIER_TOKEN}" '"withdraw"' "$(q "${metric}")" "$(q "$(cert_id A2 "${metric}")")"
  expect_ok "a repeat withdraw (${metric})"
  ended_var="ENDED_AT_${metric}"
  check_args "a repeat withdraw is idempotent (${metric})" --arg t "${!ended_var}" \
    '.certification.end_reason == "withdrawn" and (.certification.ended_at_ms | tostring) == $t'
done
pass "withdraw: certifier only, immediate on reads, refill and lead_change after the apply, idempotent"

# =============================================================================
echo "[${LANE_LABEL}] admin cancel; re-certify after cancel"
# =============================================================================

end_cert "${CERTIFIER_TOKEN}" '"cancel"' '"volume"' "$(q "${R1_volume}")"
expect_message "FORBIDDEN: certification action is not allowed" "cancel by a member"
mark
for metric in "${METRICS[@]}"; do
  end_cert "${ADMIN_TOKEN}" '"cancel"' "$(q "${metric}")" "$(q "$(cert_id R1 "${metric}")")"
  expect_ok "an admin cancels a certification they did not give (${metric})"
  check "cancelled (${metric})" '.certification.end_reason == "cancelled"'
  printf -v "ENDED_AT_${metric}" '%s' "$(jq -er '.certification.ended_at_ms' <<<"${BODY}")"
done
for metric in "${METRICS[@]}"; do
  end_cert "${OWNER_TOKEN}" '"cancel"' "$(q "${metric}")" "$(q "$(cert_id R1 "${metric}")")"
  expect_ok "a repeat cancel (${metric})"
  ended_var="ENDED_AT_${metric}"
  check_args "a repeat cancel keeps the first end (${metric})" --arg t "${!ended_var}" \
    '.certification.end_reason == "cancelled" and (.certification.ended_at_ms | tostring) == $t'
done
[[ "$(certs_col R1 "ended_by = '${ADMIN_UID}'")" == "t,t" ]] || fail "cancelled by the admin, not the repeat"
drain "cancel r1"
expect_centry R volume "" "the cancelled set leaves the Certified board"
expect_csince "certification:volume@R,certification:e1rm@R" "R loses #1"
end_set "${OWNER_TOKEN}" cancel A1
mark
drain "cancel a1"
expect_centry A volume "" "A has no certified set left"
expect_csince "certification:volume@A,certification:e1rm@A" "the Certified board empties"
expect_sql "an emptied board's lead change has a null leader" \
  "select jsonb_typeof(payload -> 'leader') from app_public.group_events
    where group_exercise_id = '${GX}' and kind = 'lead_change' and certified order by seq desc limit 1;" "null"

mark
for metric in "${METRICS[@]}"; do
  certify "${CERTIFIER_TOKEN}" "${RIVAL_UID}" r1 "${metric}" "$(score_token "${RIVAL_UID}" r1 "${metric}")"
  expect_ok "re-certify a cancelled set (${metric})"
  check_args "re-certifying creates a new row (${metric})" --arg old "$(cert_id R1 "${metric}")" \
    '.created == true and .certification.certification_id != $old'
  printf -v "R1B_${metric}" '%s' "$(jq -er '.certification.certification_id' <<<"${BODY}")"
done
[[ "$(certs_col R1 end_reason)" == "cancelled,cancelled" ]] || fail "the cancelled rows stay cancelled"
drain "re-certify r1"
expect_centry R volume "95@r1" "the Certified entry returns"
expect_csince "certification:volume@R,certification:e1rm@R" "R takes #1 again"
pass "cancel: owner/admin only, idempotent; re-certify inserts a new certification"

# =============================================================================
echo "[${LANE_LABEL}] void on edit (completed and active sessions)"
# =============================================================================

# Certifying with a token the evaluator has not yet replaced is CONFLICT
# (groups-competitions.sh, the queued-correction token).
set_edit "${ATHLETE_TOKEN}" "${T}-s1" a1 0 91 1
drain "a1 edit"
expect_sql "a1's record is voided and a1 holds no entry" \
  "select count(*) filter (where kind = 'record_voided') || ':' ||
          (select count(*) from app_public.group_metric_board_entries
            where group_exercise_id = '${GX}' and rules_revision = $(revision) and set_id = '${T}-a1')
     from app_public.group_events where group_exercise_id = '${GX}' and set_id = '${T}-a1';" "1:0"
certify "${CERTIFIER_TOKEN}" "${ATHLETE_UID}" a1 volume "$(score_token "${ATHLETE_UID}" a1 volume)"
expect_message "NOT_FOUND: record set not found for this metric" "a voided record set that holds no entry"

mark
set_edit "${RIVAL_TOKEN}" "${T}-r1s" r1 0 96 1
drain "r1 edit"
[[ "$(certs_col R1B "end_reason || ':' || coalesce(ended_by::text, 'null')")" == "voided:null,voided:null" ]] ||
  fail "an edit voids the certification, with no actor"
expect_centry R volume "" "the voided set leaves the Certified board"
expect_csince "certification:volume@R,certification:e1rm@R" "the void moves #1"
expect_lc_certs R1B "the lead change names the voided certification"
history "${ATHLETE_TOKEN}" volume true
check "history: the void" '.events[0].reason == "certification" and .events[0].certified == true'
stream "${ATHLETE_TOKEN}"
check_args "every record item of r1 now reads uncertified" --arg s "${T}-r1" \
  "${RECORDS}"' | length == 2 and all(.[]; .event.record_context.metrics | length == 2 and all(.[]; .certification == null))'

next_session_at
S3_AT="${SESSION_AT}"
sess "${ATHLETE_TOKEN}" "${T}-s3" active "${DA}" "a4:110:1"
drain "a4 (active)"
certify_set "${CERTIFIER_TOKEN}" "${ATHLETE_UID}" a4 A4
drain "certify a4"
expect_centry A volume "110@a4" "a provisional record set can be certified"
mark
set_edit "${ATHLETE_TOKEN}" "${T}-s3" a4 0 111 1
drain "a4 edit (still active)"
[[ "$(certs_col A4 end_reason)" == "voided,voided" ]] || fail "an edit in an active session voids too"
expect_centry A volume "" "no Certified entry after the void"
expect_csince "certification:volume@A,certification:e1rm@A" "the active-session void moves #1"
stream "${ATHLETE_TOKEN}"
check_args "the provisional record reads uncertified after the void" --arg s "${T}-a4" \
  "${RECORDS}"' | length == 1 and all(.[]; .event.record_context.metrics | length == 2 and all(.[]; .certification == null))'
pass "void on edit: completed and active sessions, lead_change{certification}, reads"

# =============================================================================
echo "[${LANE_LABEL}] void on delete: set tombstone, session tombstone, no revival"
# =============================================================================

# A set undelete never revives a certification (groups-competitions.sh, raw set
# restoration).
certify_set "${CERTIFIER_TOKEN}" "${RIVAL_UID}" r1 R1C
drain "certify r1 at 96"
expect_centry R volume "96@r1" "certified r1"
mark
set_edit "${RIVAL_TOKEN}" "${T}-r1s" r1 0 96 1 "$(now_ms)"
drain "r1 tombstone"
[[ "$(certs_col R1C end_reason)" == "voided,voided" ]] || fail "a set tombstone voids"
expect_centry R volume "" "no Certified entry after the delete"
expect_csince "certification:volume@R,certification:e1rm@R" "the delete moves #1"

certify_set "${RIVAL_TOKEN}" "${ATHLETE_UID}" a2 A2B
drain "certify a2"
expect_centry A volume "100@a2" "certified a2 (a non-voided record, no longer the All entry)"
session_row "${ATHLETE_TOKEN}" "${T}-s2" "${S2_AT}" completed "$(now_ms)"
drain "s2 tombstone"
[[ "$(certs_col A2B end_reason)" == "voided,voided" ]] || fail "a session tombstone voids"
expect_centry A volume "" "no Certified entry after the session delete"
session_row "${ATHLETE_TOKEN}" "${T}-s2" "${S2_AT}" completed
drain "s2 undelete"
[[ "$(active_certs a2)" == "0:0" ]] || fail "a session undelete does not revive a certification"
pass "void on delete: set and session tombstones void; a session undelete does not revive"

# =============================================================================
echo "[${LANE_LABEL}] non-voiding changes: unlink / relink, rules requeue"
# =============================================================================

next_session_at
sess "${RIVAL_TOKEN}" "${T}-r3s" completed "${DR}" "r3:98:1"
drain "r3"
set_edit "${RIVAL_TOKEN}" "${T}-r3s" r3 0 97 1
drain "r3 edited down (still R's best)"
expect_sql "r3's only record is voided, and r3 still holds R's entries" \
  "select (select count(*) from app_public.group_events r where r.group_exercise_id = '${GX}' and r.kind = 'record'
             and r.set_id = '${T}-r3'
             and not exists (select 1 from app_public.group_events v where v.related_event_id = r.id and v.kind = 'record_voided'))
          || ':' || (select count(*) from app_public.group_metric_board_entries
                      where group_exercise_id = '${GX}' and rules_revision = $(revision)
                        and set_id = '${T}-r3' and not certified);" "0:2"
certify_set "${CERTIFIER_TOKEN}" "${RIVAL_UID}" r3 R3
drain "certify r3"
expect_centry R volume "97@r3" "a voided record set that still holds an entry is certifiable"

mark
link "${RIVAL_TOKEN}" "${DR}" deleted
drain "unlink"
[[ "$(active_certs r3)" == "1:1" ]] || fail "unlink voids nothing"
expect_centry R volume "" "an unlinked set leaves the Certified board"
expect_csince "link:volume@R,link:e1rm@R" "unlink moves #1 with reason link"
expect_sql "the Certified lead change points at the unlink item" \
  "select count(*) from app_public.group_events lc join app_public.group_events u on u.id = lc.related_event_id
    where lc.group_exercise_id = '${GX}' and lc.kind = 'lead_change' and lc.certified and lc.seq > ${MARK}
      and u.kind = 'unlink';" "2"
mark
link "${RIVAL_TOKEN}" "${DR}"
drain "relink"
expect_centry R volume "97@r3" "relinking restores the certified entry"
expect_csince "link:volume@R,link:e1rm@R" "relink moves #1 with reason link"

expect_sql "a rules bump requeues evaluated sessions" "select app_public.group_eval_requeue_rules(7, 1000) >= 1;" "t"
drain "rules"
[[ "$(active_certs r3)" == "1:1" ]] || fail "a rules requeue voids nothing that still matches"
expect_centry R volume "97@r3" "a rules requeue keeps the Certified entry"
pass "unlink/relink (reason link) and a rules requeue keep the certification"

# =============================================================================
echo "[${LANE_LABEL}] frozen board: a former lifter"
# =============================================================================

rpc "${RIVAL_TOKEN}" group_leave "$(jq -nc --arg g "${GID}" '{p_group_id: $g}')"
expect_ok "R leaves"
drain "after leave"
certify "${CERTIFIER_TOKEN}" "${RIVAL_UID}" r3 volume "$(score_token "${RIVAL_UID}" r3 volume)"
expect_message "NOT_FOUND: member not found" "certify a former member's set"
end_set "${ADMIN_TOKEN}" cancel R3
board "${ATHLETE_TOKEN}" volume true
check_args "the ended certification leaves the frozen Certified board at once" --arg r "${RIVAL_UID}" \
  '[.entries[] | select(.member.user_id == $r)] == []'
podiums "${ATHLETE_TOKEN}"
check_args "the podium count ignores it" --arg x "${GX}" \
  '[.podiums[] | select(.exercise.group_exercise_id == $x)][0].board.entry_count == 0'
drain "after cancel (frozen: no apply)"
expect_centry R volume "97@r3" "the frozen stored entry stays until a catch-up"
pass "frozen: certify rejected, cancel immediate on the reads"

# =============================================================================
echo "[${LANE_LABEL}] a raw edit that changes no value"
# =============================================================================

session_row "${ATHLETE_TOKEN}" "${T}-s3" "${S3_AT}" completed
drain "s3 completed"
mark
set_edit "${ATHLETE_TOKEN}" "${T}-s3" a4 0 "111.0" 1
drain "a4 raw edit, same value"
expect_sql "a raw edit that changes no value writes no event, and a4's record stands" \
  "select (select count(*) from app_public.group_events where group_exercise_id = '${GX}' and seq > ${MARK})
          || ':' || (select count(*) from app_public.group_events r
                      where r.group_exercise_id = '${GX}' and r.rules_revision = $(revision) and r.kind = 'record'
                        and r.set_id = '${T}-a4'
                        and not exists (select 1 from app_public.group_events v
                                         where v.related_event_id = r.id and v.kind = 'record_voided'));" "0:1"
pass "a raw edit that changes no value writes nothing"

# =============================================================================
echo "[${LANE_LABEL}] failure isolation: a failed enqueue never fails the certification"
# =============================================================================

run_psql "alter table app_public.group_metric_eval_queue add constraint ${FORCE_ENQUEUE_CONSTRAINT} check (false) not valid;" >/dev/null
certify_set "${CERTIFIER_TOKEN}" "${ATHLETE_UID}" a4 A4B
run_psql "alter table app_public.group_metric_eval_queue drop constraint ${FORCE_ENQUEUE_CONSTRAINT};" >/dev/null
[[ "$(certs_col A4B "ended_at is null")" == "t,t" ]] || fail "the certifications committed"
expect_sql "one sanitized enqueue failure row per certification" \
  "select count(*) || ':' || bool_and(context = jsonb_build_object('group_id', '${GID}', 'group_exercise_id', '${GX}',
                                                                   'kind', 'exercise', 'sqlstate', '23514'))
     from public.app_logs where event = 'group.eval_enqueue_failed' and user_id = '${CERTIFIER_UID}';" \
  "2:true"
expect_sql "no job was queued" \
  "select count(*) from app_public.group_metric_eval_queue where group_exercise_id = '${GX}';" "0"
drain "nothing queued"
expect_centry A volume "" "no apply ran"
mark
next_cuam
push "${ATHLETE_TOKEN}" "repair push" "$(e_set "${T}-a5" "${T}-s3-se" 1 20 1 "" "${CUAM}")"
drain "repair"
expect_centry A volume "111@a4" "the next job for the target repairs the Certified entry"
expect_csince "certification:volume@A,certification:e1rm@A" \
  "A takes #1 although former member R's stale, cancelled entry is still stored"
stream "${ATHLETE_TOKEN}"
check_args "the raw-edited record reads certified" --arg s "${T}-a4" --arg v "${A4B_volume}" --arg e "${A4B_e1rm}" \
  "${RECORDS}"'[0].event.record_context.metrics
   | (map({key: .metric, value: .certification.certification_id}) | from_entries) == {volume: $v, e1rm: $e}'
pass "a failed enqueue logs once per certification and commits; the next job repairs; a frozen stale entry masks no lead change"

# =============================================================================
echo "[${LANE_LABEL}] a rules-revision rebuild republishes silently"
# =============================================================================

# A rules change (a contribution with bodyweight calculations off: the same
# values) opens a new, empty revision. A non-silent apply would then write
# records and lead changes for every member; the rebuild's silent publication
# writes only the rules_change, and the certification carries over.
mark
REV_BEFORE="$(revision)"
rpc "${OWNER_TOKEN}" group_competition_exercise_update "$(jq -nc --arg g "${GID}" --arg x "${GX}" --argjson r "${REV_BEFORE}" \
    '{p_group_id: $g, p_exercise_id: $x, p_expected_revision: $r, p_name: "Bench", p_load_input_mode: "total_load",
      p_bodyweight_contribution: 0.5, p_default_metric: "e1rm"}')"
expect_ok "a rules change rebuilds the comparison"
check_args "the rules change opens a new revision" --arg r "$(( REV_BEFORE + 1 ))" \
  '(.exercise.rules.rules_revision | tostring) == $r and .exercise.rebuilding == true'
drain "rules-revision rebuild"
expect_centry A volume "111@a4" "the rebuild restores the Certified entry at the new revision"
[[ "$(active_certs a4)" == "1:1" ]] || fail "a rebuild voids nothing that still matches"
expect_sql "the rebuild writes only the rules_change" \
  "select string_agg(kind, ',' order by seq) from app_public.group_events where group_id = '${GID}' and seq > ${MARK};" \
  "rules_change"
pass "a rules-revision rebuild keeps the certification and writes only the rules_change"

COMPLETED=1
echo "[${LANE_LABEL}] passed (run ${RUN_TAG})"
