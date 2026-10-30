#!/usr/bin/env bash
# Sourced by groups-contract.sh after its existing assertions. Uses its users,
# psql session and cleanup; proves lifecycle/auth and real transaction receipts.
run_cow_contract_cases() {
  local cg ce ci other first create_body next_week calendar_rev code invite token call name args result probe context_count source_id early_sid early_se early_set early_started old_header race_a race_b race_a_pid race_b_pid winner overlap_group overlap_exercise overlap_week overlap_id
  local started completed def sid se set cuam_before before_count snapshot fail_constraint
  local holder writer holder_pid writer_pid holder_file writer_file deadline edge
  echo "[groups-contract] CoW lifecycle and intake"
  rpc "${OWNER_TOKEN}" group_create "$(b_create "CoW ${RUN_TAG}" "")"
  expect_ok "legacy two-argument group creation remains compatible"
  cg="$(jq -r '.group_id' <<<"${BODY}")"
  rpc "${OWNER_TOKEN}" group_cow_calendar_get "$(jq -nc --arg g "${cg}" '{p_group_id:$g}')"
  check "legacy calendar requires an explicit choice" '.time_zone == null and .revision == 1 and .next_week_start == null'
  rpc "${OWNER_TOKEN}" group_cow_calendar_set "$(jq -nc --arg g "${cg}" '{p_group_id:$g,p_expected_revision:1,p_time_zone:"Europe/London"}')"
  expect_ok "owner sets calendar"
  next_week="$(jq -r '.next_week_start' <<<"${BODY}")"
  calendar_rev="$(jq -r '.revision' <<<"${BODY}")"
  rpc "${OWNER_TOKEN}" group_cow_calendar_set "$(jq -nc --arg g "${cg}" '{p_group_id:$g,p_expected_revision:1,p_time_zone:"Europe/London"}')"
  check "calendar retry retains revision" '.revision == 2'
  rpc "${OWNER_TOKEN}" group_cow_calendar_set "$(jq -nc --arg g "${cg}" '{p_group_id:$g,p_expected_revision:1,p_time_zone:"UTC"}')"
  expect_error CONFLICT "stale calendar change"
  for code in 'GMT+3' 'EST' 'Area/Invented'; do
    rpc "${OWNER_TOKEN}" group_cow_calendar_set "$(jq -nc --arg g "${cg}" --arg z "${code}" '{p_group_id:$g,p_expected_revision:2,p_time_zone:$z}')"
    expect_error VALIDATION "IANA zone validation ${code}"
  done
  [[ "$(run_psql "select extract(epoch from upper(app_public.group_cow_bounds('Europe/London','2026-03-23'))-lower(app_public.group_cow_bounds('Europe/London','2026-03-23')))::bigint,
      extract(epoch from upper(app_public.group_cow_bounds('Europe/London','2026-10-19'))-lower(app_public.group_cow_bounds('Europe/London','2026-10-19')))::bigint;")" == '601200|608400' ]] || fail "CoW bounds must preserve both DST transitions"
  rpc "${OWNER_TOKEN}" group_invite_get "$(jq -nc --arg g "${cg}" '{p_group_id:$g}')"
  code="$(jq -r '.code' <<<"${BODY}")"
  invite="${code}"
  rpc "${ADMIN_TOKEN}" group_join "$(jq -nc --arg c "${invite}" '{p_code:$c}')"
  expect_ok "CoW admin joins"
  rpc "${MEMBER_TOKEN}" group_join "$(jq -nc --arg c "${invite}" '{p_code:$c}')"
  expect_ok "CoW member joins"
  rpc "${OWNER_TOKEN}" group_set_role "$(jq -nc --arg g "${cg}" --arg u "${ADMIN_UID}" '{p_group_id:$g,p_user_id:$u,p_role:"admin"}')"
  expect_ok "CoW admin role"
  rpc "${OWNER_TOKEN}" group_competition_exercise_create "$(b_gx_create "${cg}" 'CoW Bench' total_load)"
  expect_ok "CoW target"
  ce="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
  ci="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
  create_body="$(jq -nc --arg g "${cg}" --arg c "${ci}" --arg e "${ce}" --arg w "${next_week}" --argjson r "${calendar_rev}" \
    '{p_group_id:$g,p_cow_id:$c,p_group_exercise_id:$e,p_metrics:["e1rm","improvement","volume"],p_calendar_revision:$r,p_week_start:$w}')"
  rpc "${MEMBER_TOKEN}" group_cow_create "${create_body}"
  expect_error FORBIDDEN "member cannot schedule"
  for call in \
    "group_cow_calendar_get|$(jq -nc --arg g "${cg}" '{p_group_id:$g}')" \
    "group_cow_calendar_set|$(jq -nc --arg g "${cg}" '{p_group_id:$g,p_expected_revision:2,p_time_zone:"UTC"}')" \
    "group_cow_create|${create_body}" \
    "group_cow_update|$(jq -nc --arg g "${cg}" --arg c "${ci}" --arg e "${ce}" '{p_group_id:$g,p_cow_id:$c,p_expected_revision:1,p_group_exercise_id:$e,p_metrics:["volume"]}')" \
    "group_cow_cancel|$(jq -nc --arg g "${cg}" --arg c "${ci}" '{p_group_id:$g,p_cow_id:$c,p_expected_revision:1}')" \
    "group_cow_get|$(jq -nc --arg g "${cg}" --arg c "${ci}" '{p_group_id:$g,p_cow_id:$c}')" \
    "group_cow_list|$(jq -nc --arg g "${cg}" '{p_group_id:$g}')"; do
    name="${call%%|*}"; args="${call#*|}"
    old_header="${GROUP_CONTRACT_HEADER}"; GROUP_CONTRACT_HEADER='x-boga-group-contract: 3'
    rpc "${OWNER_TOKEN}" "${name}" "${args}"; expect_error UPDATE_REQUIRED "old protocol ${name}"
    GROUP_CONTRACT_HEADER="${old_header}"
    rpc "${ANON_KEY}" "${name}" "${args}"; expect_error AUTH_REQUIRED "anonymous ${name}"
    token="$(mint_token "${OWNER_TOKEN}" cow-probe)"
    rpc "${token}" "${name}" "${args}"; expect_error AGENT_FORBIDDEN "OAuth ${name}"
    rpc "${OUTSIDER_TOKEN}" "${name}" "${args}"; expect_error NOT_FOUND "outsider ${name}"
    result="${BODY}"
    rpc "${OUTSIDER_TOKEN}" "${name}" "$(jq --arg g "${MISSING_GROUP}" '.p_group_id=$g' <<<"${args}")"
    [[ "${BODY}" == "${result}" ]] || fail "outsider/nonexistent ${name} differ"
  done
  for code in '[]' '["e1rm","e1rm"]' '["weight"]' 'null'; do
    rpc "${OWNER_TOKEN}" group_cow_create "$(jq --argjson m "${code}" '.p_metrics=$m' <<<"${create_body}")"
    expect_error VALIDATION "invalid CoW metric ${code}"
  done
  rpc "${OWNER_TOKEN}" group_cow_create "$(jq '.p_week_start=null' <<<"${create_body}")"
  expect_error VALIDATION "missing/wrong next week"
  rpc "${OWNER_TOKEN}" group_cow_create "$(jq --arg e "${MISSING_GROUP}" '.p_group_exercise_id=$e' <<<"${create_body}")"
  expect_error VALIDATION "foreign comparison"
  rpc "${ADMIN_TOKEN}" group_cow_create "${create_body}"
  expect_ok "admin schedules next week"
  check "exact definition shape" '(.cow|keys|sort)==(["cow_id","group_id","group_exercise_id","week_start","time_zone","starts_at_us","ends_at_us","metrics","revision","state"]|sort) and .cow.state=="scheduled"'
  first="${BODY}"
  rpc "${OWNER_TOKEN}" group_cow_create "${create_body}"
  [[ "${BODY}" == "${first}" ]] || fail "create retry changed definition"
  [[ "$(run_psql "select count(*) from app_public.group_cow_admissions where cow_id='${ci}';")" == 3 ]] || fail "scheduling must capture candidate membership receipts"
  [[ "$(run_psql "select count(*) from app_public.group_cow_intake_failures where cow_id='${ci}';")" == 0 ]] || fail "initial intake failed"
  other="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
  rpc "${OWNER_TOKEN}" group_cow_create "$(jq --arg c "${other}" '.p_cow_id=$c' <<<"${create_body}")"
  expect_error CONFLICT "duplicate group/week"
  rpc "${MEMBER_TOKEN}" group_cow_get "$(jq -nc --arg g "${cg}" --arg c "${ci}" '{p_group_id:$g,p_cow_id:$c}')"
  expect_ok "member reads definition"
  rpc "${OWNER_TOKEN}" group_cow_list "$(jq -nc --arg g "${cg}" '{p_group_id:$g,p_before:"bad"}')"
  expect_error VALIDATION "malformed cursor"
  rpc "${OWNER_TOKEN}" group_cow_update "$(jq -nc --arg g "${cg}" --arg c "${ci}" --arg e "${ce}" '{p_group_id:$g,p_cow_id:$c,p_expected_revision:1,p_group_exercise_id:$e,p_metrics:["volume"]}')"
  expect_ok "pre-start edit"
  check "revision advances" '.cow.revision==2 and .cow.metrics==["volume"]'
  rpc "${OWNER_TOKEN}" group_cow_update "$(jq -nc --arg g "${cg}" --arg c "${ci}" --arg e "${ce}" '{p_group_id:$g,p_cow_id:$c,p_expected_revision:1,p_group_exercise_id:$e,p_metrics:["volume"]}')"
  check "edit retry is idempotent" '.cow.revision==2'
  rpc "${OWNER_TOKEN}" group_cow_cancel "$(jq -nc --arg g "${cg}" --arg c "${ci}" '{p_group_id:$g,p_cow_id:$c,p_expected_revision:1}')"
  expect_error CONFLICT "stale cancellation"
  rpc "${OWNER_TOKEN}" group_cow_cancel "$(jq -nc --arg g "${cg}" --arg c "${ci}" '{p_group_id:$g,p_cow_id:$c,p_expected_revision:2}')"
  check "cancel preserves audit" '.cow.state=="cancelled" and .cow.revision==3'
  rpc "${OWNER_TOKEN}" group_cow_cancel "$(jq -nc --arg g "${cg}" --arg c "${ci}" '{p_group_id:$g,p_cow_id:$c,p_expected_revision:2}')"
  check "cancel retry retains revision" '.cow.revision==3'
  ci="${other}"; create_body="$(jq --arg c "${ci}" '.p_cow_id=$c' <<<"${create_body}")"
  other="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
  COW_TEST_LOG_DIR="$(mktemp -d)"; race_a="${COW_TEST_LOG_DIR}/owner"; race_b="${COW_TEST_LOG_DIR}/admin"
  (rpc "${OWNER_TOKEN}" group_cow_create "${create_body}"; printf '%s\n%s\n' "${STATUS}" "${BODY}") >"${race_a}" & race_a_pid=$!
  (rpc "${ADMIN_TOKEN}" group_cow_create "$(jq --arg c "${other}" '.p_cow_id=$c' <<<"${create_body}")"; printf '%s\n%s\n' "${STATUS}" "${BODY}") >"${race_b}" & race_b_pid=$!
  wait "${race_a_pid}"; wait "${race_b_pid}"
  result="$(head -n1 "${race_a}"):$(head -n1 "${race_b}")"
  [[ "${result}" == '200:400' || "${result}" == '400:200' ]] || fail "concurrent schedules did not serialize: ${result}"
  if [[ "${result}" == '200:400' ]]; then
    winner="${race_a}"; [[ "$(tail -n1 "${race_b}" | jq -r '.message')" == CONFLICT:* ]] || fail "losing schedule must conflict"
  else
    winner="${race_b}"; ci="${other}"; create_body="$(jq --arg c "${ci}" '.p_cow_id=$c' <<<"${create_body}")"
    [[ "$(tail -n1 "${race_a}" | jq -r '.message')" == CONFLICT:* ]] || fail "losing schedule must conflict"
  fi
  BODY="$(tail -n1 "${winner}")"; STATUS=200
  expect_ok "cancel releases slot and concurrent managers publish exactly once"
  [[ "$(run_psql "select count(*) from app_public.group_cows where group_id='${cg}' and cancelled_at is null;")" == 1 ]] || fail "concurrent schedules created duplicates"
  rm -rf "${COW_TEST_LOG_DIR}"; COW_TEST_LOG_DIR=""
  snapshot="$(run_psql "select starts_at::text||':'||ends_at::text||':'||time_zone from app_public.group_cows where id='${ci}';")"
  rpc "${OWNER_TOKEN}" group_cow_calendar_set "$(jq -nc --arg g "${cg}" '{p_group_id:$g,p_expected_revision:2,p_time_zone:"Pacific/Kiritimati"}')"
  expect_ok "group zone can change"
  [[ "$(run_psql "select starts_at::text||':'||ends_at::text||':'||time_zone from app_public.group_cows where id='${ci}';")" == "${snapshot}" ]] || fail "published window moved after zone change"

  # An earlier Honolulu week overlaps next week in Kiritimati, despite
  # different local Monday keys. Simulate an already published current Cow.
  rpc "${OWNER_TOKEN}" group_create "$(jq -nc --arg n "Overlap ${RUN_TAG}" '{p_name:$n,p_description:null,p_time_zone:"Pacific/Honolulu"}')"
  expect_ok "creator zone supplied compatibly"
  overlap_group="$(jq -r '.group_id' <<<"${BODY}")"
  rpc "${OWNER_TOKEN}" group_competition_exercise_create "$(b_gx_create "${overlap_group}" Overlap total_load)"
  overlap_exercise="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
  overlap_week="$(run_psql "select app_public.group_cow_week('Pacific/Kiritimati',clock_timestamp())+7;")"
  overlap_id="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
  run_psql "insert into app_public.group_cows(id,group_id,group_exercise_id,week_start,time_zone,starts_at,ends_at,metrics,create_key,created_by,available_at,definition_xid)
    values('${overlap_id}','${overlap_group}','${overlap_exercise}',date '${overlap_week}'-7,'Pacific/Honolulu',
      lower(app_public.group_cow_bounds('Pacific/Honolulu',date '${overlap_week}'-7)),upper(app_public.group_cow_bounds('Pacific/Honolulu',date '${overlap_week}'-7)),
      array['e1rm'],'existing-earlier-week','${OWNER_UID}',clock_timestamp(),0);" >/dev/null
  rpc "${OWNER_TOKEN}" group_cow_calendar_set "$(jq -nc --arg g "${overlap_group}" '{p_group_id:$g,p_expected_revision:1,p_time_zone:"Pacific/Kiritimati"}')"
  overlap_week="$(jq -r '.next_week_start' <<<"${BODY}")"
  rpc "${OWNER_TOKEN}" group_cow_create "$(jq -nc --arg g "${overlap_group}" --arg e "${overlap_exercise}" --arg w "${overlap_week}" --arg c "${MISSING_GROUP}" \
    '{p_group_id:$g,p_cow_id:$c,p_group_exercise_id:$e,p_week_start:$w,p_metrics:["volume"],p_calendar_revision:2}')"
  expect_error CONFLICT "zone change cannot overlap an earlier immutable week"
  # The private group schema must stay invisible to clients and sync drift.
  [[ "$(run_psql "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='app_public' and (c.relname='group_cows' or c.relname like 'group_cow_%') and c.relkind='r' and not c.relrowsecurity;")" == 0 ]] || fail "CoW table without RLS"
  [[ "$(run_psql "select count(*) from information_schema.columns where table_schema='app_public'
    and (table_name='group_cows' or table_name like 'group_cow_%') and column_name='owner_user_id';")" == 0 ]] || fail "CoW entered sync scope"
  [[ "$(run_psql "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join unnest(array['anon','authenticated']) r
    where n.nspname='app_public' and p.proname in ('group_cow_capture','group_cow_mark','group_cow_source_snapshot','group_cow_context')
      and has_function_privilege(r,p.oid,'EXECUTE');")" == 0 ]] || fail "private CoW helper is executable"
  [[ "$(run_psql "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join unnest(array['anon','authenticated']) r
    where n.nspname='app_public' and (c.relname='group_cows' or c.relname like 'group_cow_%') and c.relkind='r'
      and has_table_privilege(r,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');")" == 0 ]] || fail "direct CoW privilege granted"
  [[ "$(run_psql "select count(*) from pg_policies where schemaname='app_public' and (tablename='group_cows' or tablename like 'group_cow_%');")" == 0 ]] || fail "CoW table has a permissive policy"
  for name in group_cows group_cow_sources group_cow_contexts group_cow_admissions group_cow_participants group_cow_pending group_cow_intake_failures; do
    rest GET "${OWNER_TOKEN}" "${name}" 'select=*'; [[ "${STATUS}" != 200 ]] || fail "direct select ${name}"
    rest POST "${OWNER_TOKEN}" "${name}" '' '{}'; [[ "${STATUS}" != 201 ]] || fail "direct insert ${name}"
    rest PATCH "${OWNER_TOKEN}" "${name}" 'id=eq.00000000-0000-0000-0000-000000000000' '{}'; [[ "${STATUS}" != 200 ]] || fail "direct update ${name}"
    rest DELETE "${OWNER_TOKEN}" "${name}" 'id=eq.00000000-0000-0000-0000-000000000000'; [[ "${STATUS}" != 200 && "${STATUS}" != 204 ]] || fail "direct delete ${name}"
  done

  # Real sync captures a minimal pre-start scorer envelope. No parsing or SQL math.
  started="$(run_psql "select floor(extract(epoch from clock_timestamp())*1000)::bigint;")"
  completed=$((started + 1000)); def="cow-def-${RUN_TAG}"; sid="cow-session-${RUN_TAG}"; se="cow-block-${RUN_TAG}"; set="cow-set-${RUN_TAG}"
  next_cuam
  push "${OWNER_TOKEN}" 'CoW initial sources' "$(e_def "${def}" Cow "${CUAM}")" \
    "$(e_session "${sid}" "${started}" completed "${completed}" 1 null "${CUAM}")" \
    "$(e_se "${se}" "${sid}" "${def}" 0 Cow "${CUAM}" null)" \
    "$(e_set "${set}" "${se}" 0 100 5 "" "${CUAM}" null)" \
    "$(e_link "${def}" "${cg}" "${ce}" "${CUAM}")"
  [[ "$(run_psql "select count(*) from app_public.group_cow_sources where cow_id='${ci}' and set_id='${set}';")" == 1 ]] || fail "coherent sync must capture exactly one source version"
  [[ "$(run_psql "select input->>'weight_value'||':'||(input->>'completed')||':'||(input->>'eligible') from app_public.group_cow_sources where cow_id='${ci}' and set_id='${set}';")" == '100:true:true' ]] || fail "sealed source is incomplete"
  before_count="$(run_psql "select count(*) from app_public.group_cow_sources where cow_id='${ci}';")"
  next_cuam
  push "${OWNER_TOKEN}" 'identical score inputs' "$(e_set "${set}" "${se}" 0 100 5 "" "${CUAM}" null)"
  [[ "$(run_psql "select count(*) from app_public.group_cow_sources where cow_id='${ci}';")" == "${before_count}" ]] || fail "retry reset intake priority"
  run_psql "begin;
    select set_config('request.jwt.claims',jsonb_build_object('sub','${OWNER_UID}','role','authenticated')::text,true);
    update app_public.exercise_sets set weight_value='101' where owner_user_id='${OWNER_UID}' and id='${set}';
    set constraints all immediate;
    update app_public.exercise_sets set weight_value='102' where owner_user_id='${OWNER_UID}' and id='${set}';
    commit;" >/dev/null
  [[ "$(run_psql "select count(*) from app_public.group_cow_sources where cow_id='${ci}' and set_id='${set}';")" == 2 ]] || fail "early seal retained an intermediate same-transaction version"
  [[ "$(run_psql "select input->>'weight_value' from app_public.group_cow_sources where cow_id='${ci}' and set_id='${set}' order by id desc limit 1;")" == 102 ]] || fail "final transaction source not sealed"
  run_psql "begin; select set_config('request.jwt.claims',jsonb_build_object('sub','${OWNER_UID}','role','authenticated')::text,true); update app_public.exercise_sets set weight_value='103' where owner_user_id='${OWNER_UID}' and id='${set}'; rollback;" >/dev/null
  [[ "$(run_psql "select count(*) from app_public.group_cow_sources where cow_id='${ci}' and set_id='${set}';")" == 2 ]] || fail "rollback left a receipt"
  run_cow_creation_race "${def}"
  # The share trigger can self-heal on a session's unrelated duration edit;
  # that ledger insertion itself, not the later rescan, supplies the receipt.
  run_psql "delete from app_public.group_session_shares where group_id='${cg}' and member_user_id='${OWNER_UID}' and session_id='${sid}';" >/dev/null
  [[ "$(run_psql "select input->>'shared' from app_public.group_cow_sources where cow_id='${ci}' and set_id='${set}' order by id desc limit 1;")" == false ]] || fail "share removal was not captured"
  next_cuam
  push "${OWNER_TOKEN}" 'share repair through duration-only edit' "$(e_session "${sid}" "${started}" completed "${completed}" 2 null "${CUAM}")"
  [[ "$(run_psql "select input->>'shared' from app_public.group_cow_sources where cow_id='${ci}' and set_id='${set}' order by id desc limit 1;")" == true ]] || fail "repaired share missed intake"
  fail_constraint="cow_intake_force_failure"
  run_psql "alter table app_public.group_cow_sources add constraint ${fail_constraint} check(false) not valid;" >/dev/null
  next_cuam
  push "${OWNER_TOKEN}" 'isolated failed CoW capture' "$(e_set "${set}" "${se}" 0 104 5 "" "${CUAM}" null)"
  probe="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
  if result="$(run_psql_once "insert into app_public.group_cows(id,group_id,group_exercise_id,week_start,time_zone,starts_at,ends_at,metrics,create_key,created_by,available_at)
    values('${probe}','${cg}','${ce}',date '${next_week}'+14,'UTC',
      lower(app_public.group_cow_bounds('UTC',date '${next_week}'+14)),upper(app_public.group_cow_bounds('UTC',date '${next_week}'+14)),
      array['e1rm'],'capture-error-probe','${OWNER_UID}',clock_timestamp());" 2>&1)"; then fail "definition accepted failed private intake"; fi
  [[ "${result}" == *'INTERNAL: CoW intake could not be validated'* && "${result}" != *'Failing row contains'* && "${result}" != *'weight_value'* ]] ||
    fail "definition error exposed private failing-row detail"
  [[ "$(run_psql "select count(*) from app_public.group_cows where id='${probe}';")" == 0 ]] || fail "failed definition intake committed"
  run_psql "alter table app_public.group_cow_sources drop constraint ${fail_constraint};" >/dev/null
  [[ "$(run_psql "select count(*) from app_public.group_cow_intake_failures where cow_id='${ci}' and sqlstate='23514';")" -gt 0 ]] || fail "failed capture lost durable uncertainty"
  # Restore and retain the failure marker: later intake cannot manufacture lost priority.
  next_cuam
  push "${OWNER_TOKEN}" 'CoW capture recovers' "$(e_set "${set}" "${se}" 0 105 5 "" "${CUAM}" null)"
  [[ "$(run_psql "select count(*) from app_public.group_cow_intake_failures where cow_id='${ci}';")" -gt 0 ]] || fail "uncertainty silently cleared"
  run_psql "alter table app_public.group_cow_pending add constraint cow_intake_pending_failure check(false) not valid;" >/dev/null
  next_cuam
  push "${OWNER_TOKEN}" 'isolated failed group intake mark' "$(e_set "${set}" "${se}" 0 106 5 "" "${CUAM}" null)"
  run_psql "alter table app_public.group_cow_pending drop constraint cow_intake_pending_failure;" >/dev/null
  [[ "$(run_psql "select count(*) from app_public.group_cow_intake_failures where cow_id is null and group_id='${cg}' and sqlstate='23514';")" -gt 0 ]] || fail "failed intake mark lost its known group scope"
  next_cuam
  push "${OWNER_TOKEN}" 'group intake mark recovers' "$(e_set "${set}" "${se}" 0 105 5 "" "${CUAM}" null)"
  # Initial intake is part of publishing a definition: it must finish before start.
  probe="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
  if result="$(run_psql_once "begin;
    insert into app_public.group_cows(id,group_id,group_exercise_id,week_start,time_zone,starts_at,ends_at,metrics,create_key,created_by,available_at)
      select '${probe}','${cg}','${ce}',date '${next_week}'+7,'UTC',edge,edge+interval '7 days',array['e1rm'],'deadline-probe','${OWNER_UID}',edge
      from (select clock_timestamp()+interval '100 milliseconds' as edge) x;
    do \$probe\$ begin while clock_timestamp()<(select starts_at from app_public.group_cows where id='${probe}') loop perform pg_sleep(0.01); end loop; end \$probe\$;
    commit;" 2>&1)"; then fail "definition intake crossed its start without rejecting"; fi
  [[ "${result}" == *'VALIDATION:'* ]] || fail "late initial seal did not fail with VALIDATION"
  [[ "$(run_psql "select count(*) from app_public.group_cows where id='${probe}';")" == 0 ]] || fail "rejected definition left a published row"
  if result="$(run_psql_once "begin; set constraints all immediate;
    insert into app_public.group_cows(id,group_id,group_exercise_id,week_start,time_zone,starts_at,ends_at,metrics,create_key,created_by,available_at)
      values('${probe}','${cg}','${ce}',date '${next_week}'+7,'UTC',clock_timestamp()-interval '1 second',clock_timestamp()+interval '7 days',array['e1rm'],'immediate-probe','${OWNER_UID}',clock_timestamp());
    commit;" 2>&1)"; then fail "immediate constraint mode swallowed the definition deadline"; fi
  [[ "${result}" == *'VALIDATION:'* ]] || fail "immediate initial seal did not fail with VALIDATION"
  run_psql "insert into app_public.group_cows(id,group_id,group_exercise_id,week_start,time_zone,starts_at,ends_at,metrics,create_key,created_by,available_at)
    values('${probe}','${cg}','${ce}',date '${next_week}'+7,'UTC',clock_timestamp()+interval '1 day',clock_timestamp()+interval '8 days',array['e1rm'],'cancel-deadline-probe','${OWNER_UID}',clock_timestamp());
    update app_public.group_cows set starts_at=clock_timestamp()+interval '100 milliseconds' where id='${probe}';" >/dev/null
  if result="$(run_psql_once "begin;
    select set_config('request.jwt.claims',jsonb_build_object('sub','${OWNER_UID}','role','authenticated')::text,true);
    select set_config('request.headers','{\"x-boga-group-contract\":\"4\"}',true);
    select app_public.group_cow_cancel('${cg}','${probe}',1);
    do \$probe\$ begin while clock_timestamp()<(select starts_at from app_public.group_cows where id='${probe}') loop perform pg_sleep(0.01); end loop; end \$probe\$;
    commit;" 2>&1)"; then fail "cancellation committed after crossing start"; fi
  [[ "${result}" == *'VALIDATION:'* ]] || fail "late cancellation seal did not fail with VALIDATION"
  [[ "$(run_psql "select cancelled_at is null from app_public.group_cows where id='${probe}';")" == t ]] || fail "late cancellation escaped rollback"
  context_count="$(run_psql "select count(*) from app_public.group_cow_contexts where cow_id='${ci}';")"
  rpc "${OWNER_TOKEN}" group_update "$(jq -nc --arg g "${cg}" --arg n "CoW ${RUN_TAG}" '{p_group_id:$g,p_name:$n,p_description:null,p_bodyweight_calculations_enabled:true}')"
  expect_ok "enable group bodyweight at zero contribution"
  [[ "$(run_psql "select count(*) from app_public.group_cow_contexts where cow_id='${ci}';")" == "${context_count}" ]] || fail "irrelevant zero-contribution toggle changed CoW context"
  run_psql "begin;
    select set_config('request.jwt.claims',jsonb_build_object('sub','${OWNER_UID}','role','authenticated')::text,true);
    insert into app_public.body_weight_measurements(owner_user_id,id,weight_kg,measured_at,created_at,updated_at,client_updated_at_ms)
      values('${OWNER_UID}','cow-reading-${RUN_TAG}',80,${started}-1,${started},${started},${started});
    commit;" >/dev/null
  rpc "${OWNER_TOKEN}" group_competition_exercise_update "$(jq -nc --arg g "${cg}" --arg e "${ce}" '{p_group_id:$g,p_exercise_id:$e,p_expected_revision:1,p_name:"CoW Bench",p_load_input_mode:"total_load",p_bodyweight_contribution:1,p_default_metric:"e1rm"}')"
  expect_ok "a real comparison context change is captured"
  [[ "$(run_psql "select input->'body_weight_context'->>'body_weight_kg' from app_public.group_cow_sources where cow_id='${ci}' and set_id='${set}' order by id desc limit 1;")" == 80 ]] || fail "normalized intake did not capture its timely reading"
  source_id="$(run_psql "select max(id) from app_public.group_cow_sources where cow_id='${ci}' and set_id='${set}';")"
  run_psql "update app_public.group_cows set starts_at=clock_timestamp()+interval '100 milliseconds',ends_at=clock_timestamp()+interval '7 days' where id='${ci}';
    do \$start\$ begin while clock_timestamp()<(select starts_at from app_public.group_cows where id='${ci}') loop perform pg_sleep(0.01); end loop; end \$start\$;" >/dev/null
  rpc "${OWNER_TOKEN}" group_cow_cancel "$(jq -nc --arg g "${cg}" --arg c "${ci}" '{p_group_id:$g,p_cow_id:$c,p_expected_revision:1}')"
  expect_error VALIDATION "active CoW cannot be cancelled"
  rpc "${OWNER_TOKEN}" group_cow_update "$(jq -nc --arg g "${cg}" --arg c "${ci}" --arg e "${ce}" '{p_group_id:$g,p_cow_id:$c,p_expected_revision:1,p_group_exercise_id:$e,p_metrics:["e1rm"]}')"
  expect_error VALIDATION "active CoW cannot be edited"
  rpc "${MEMBER_TOKEN}" group_leave "$(jq -nc --arg g "${cg}" '{p_group_id:$g}')"
  expect_ok "membership end admitted"
  [[ "$(run_psql "select count(*) from app_public.group_cow_admissions where cow_id='${ci}' and member_user_id='${MEMBER_UID}' and ended_at is not null;")" == 1 ]] || fail "leave receipt missing"
  rpc "${MEMBER_TOKEN}" group_join "$(jq -nc --arg c "${invite}" '{p_code:$c}')"
  expect_ok "rejoin is a distinct admitted period"
  [[ "$(run_psql "select count(*) from app_public.group_cow_admissions where cow_id='${ci}' and member_user_id='${MEMBER_UID}';")" == 2 ]] || fail "rejoin reopened the old period"
  # First eligible weekly intake binds B before a delayed ordinary evaluator.
  started="$(run_psql "select floor(extract(epoch from clock_timestamp())*1000)::bigint;")"
  completed=$((started+1)); sid="cow-weekly-session-${RUN_TAG}"; se="cow-weekly-block-${RUN_TAG}"; set="cow-weekly-set-${RUN_TAG}"
  next_cuam
  push "${OWNER_TOKEN}" 'timely normalized weekly source' "$(e_session "${sid}" "${started}" completed "${completed}" 1 null "${CUAM}")" \
    "$(e_se "${se}" "${sid}" "${def}" 0 Cow "${CUAM}" null)" "$(e_set "${set}" "${se}" 0 105 5 "" "${CUAM}" null)"
  source_id="$(run_psql "select max(id) from app_public.group_cow_sources where cow_id='${ci}' and set_id='${set}';")"
  [[ "$(run_psql "select input->'body_weight_context'->>'body_weight_kg' from app_public.group_cow_sources where id=${source_id};")" == 80 ]] || fail "weekly source did not bind B at its receipt"
  run_psql "begin;
    select set_config('request.jwt.claims',jsonb_build_object('sub','${OWNER_UID}','role','authenticated')::text,true);
    update app_public.body_weight_measurements set weight_kg=90,measured_at=${started}-1 where owner_user_id='${OWNER_UID}' and id='cow-reading-${RUN_TAG}';
    insert into app_public.group_set_body_weight_bindings(member_user_id,set_id,source_key,context)
      select '${OWNER_UID}','${set}',app_public.group_set_body_weight_key(es,s.started_at),jsonb_build_object(
        'body_weight_kg',90,'body_weight_source','reading','body_weight_measurement_id','cow-reading-${RUN_TAG}','body_weight_measured_at',${started}-1)
      from app_public.exercise_sets es join app_public.session_exercises se on se.owner_user_id=es.owner_user_id and se.id=es.session_exercise_id
      join app_public.sessions s on s.owner_user_id=se.owner_user_id and s.id=se.session_id where es.owner_user_id='${OWNER_UID}' and es.id='${set}'
      on conflict(member_user_id,set_id) do update set context=excluded.context,source_key=excluded.source_key;
    commit;" >/dev/null
  next_cuam
  push "${OWNER_TOKEN}" 'unrelated write after delayed evaluator binding' "$(e_def "cow-unrelated-${RUN_TAG}" Unrelated "${CUAM}")"
  [[ "$(run_psql "select max(id) from app_public.group_cow_sources where cow_id='${ci}' and set_id='${set}';")" == "${source_id}" ]] || fail "later worker binding revised an unchanged CoW source/priority"

  early_started="$(run_psql "select app_public.group_cow_us(starts_at)/1000+1 from app_public.group_cows where id='${ci}';")"
  early_sid="cow-missing-session-${RUN_TAG}"; early_se="cow-missing-block-${RUN_TAG}"; early_set="cow-missing-set-${RUN_TAG}"
  next_cuam
  push "${OWNER_TOKEN}" 'weekly source initially missing B' "$(e_session "${early_sid}" "${early_started}" completed "$((early_started+1))" 1 null "${CUAM}")" \
    "$(e_se "${early_se}" "${early_sid}" "${def}" 0 Cow "${CUAM}" null)" "$(e_set "${early_set}" "${early_se}" 0 50 5 "" "${CUAM}" null)"
  source_id="$(run_psql "select max(id) from app_public.group_cow_sources where cow_id='${ci}' and set_id='${early_set}';")"
  [[ "$(run_psql "select input->'body_weight_context'->'body_weight_kg'='null'::jsonb from app_public.group_cow_sources where id=${source_id};")" == t ]] || fail "missing reading was not retained explicitly"
  run_psql "begin;
    select set_config('request.jwt.claims',jsonb_build_object('sub','${OWNER_UID}','role','authenticated')::text,true);
    insert into app_public.body_weight_measurements(owner_user_id,id,weight_kg,measured_at,created_at,updated_at,client_updated_at_ms)
      values('${OWNER_UID}','cow-late-reading-${RUN_TAG}',90,${early_started}-1,${started},${started},${started});
    insert into app_public.group_set_body_weight_bindings(member_user_id,set_id,source_key,context)
      select '${OWNER_UID}','${early_set}',app_public.group_set_body_weight_key(es,s.started_at),jsonb_build_object(
        'body_weight_kg',90,'body_weight_source','reading','body_weight_measurement_id','cow-late-reading-${RUN_TAG}','body_weight_measured_at',${early_started}-1)
      from app_public.exercise_sets es join app_public.session_exercises se on se.owner_user_id=es.owner_user_id and se.id=es.session_exercise_id
      join app_public.sessions s on s.owner_user_id=se.owner_user_id and s.id=se.session_id where es.owner_user_id='${OWNER_UID}' and es.id='${early_set}'
      on conflict(member_user_id,set_id) do update set context=excluded.context,source_key=excluded.source_key;
    commit;" >/dev/null
  next_cuam
  push "${OWNER_TOKEN}" 'unrelated write after late missing-B binding' "$(e_def "cow-another-unrelated-${RUN_TAG}" Unrelated "${CUAM}")"
  [[ "$(run_psql "select max(id) from app_public.group_cow_sources where cow_id='${ci}' and set_id='${early_set}';")" == "${source_id}" ]] || fail "late reading or worker binding filled an unchanged CoW's missing context"

  # A forced early seal cannot survive another relevant write after end.
  run_psql "begin;
    select set_config('request.jwt.claims',jsonb_build_object('sub','${OWNER_UID}','role','authenticated')::text,true);
    update app_public.exercise_sets set weight_value='106' where owner_user_id='${OWNER_UID}' and id='${set}';
    set constraints all immediate;
    update app_public.group_cows set ends_at=clock_timestamp()+interval '100 milliseconds' where id='${ci}';
    do \$edge\$ begin while clock_timestamp()<(select ends_at from app_public.group_cows where id='${ci}') loop perform pg_sleep(0.01); end loop; end \$edge\$;
    update app_public.exercise_sets set weight_value='107' where owner_user_id='${OWNER_UID}' and id='${set}';
    commit;" >/dev/null
  [[ "$(run_psql "select count(*)||':'||bool_and(s.received_at>=c.ends_at) from app_public.group_cow_sources s
    join app_public.group_cows c on c.id=s.cow_id where c.id='${ci}' and s.set_id='${set}' and s.input->>'weight_value' in ('106','107');")" == '1:true' ]] || fail "post-end write retained its transaction's earlier timely receipt"
  # Only the backend fixture moves bounds; public writes cannot do this.
  run_psql "update app_public.group_cows set ends_at=clock_timestamp()+interval '7 days' where id='${ci}';" >/dev/null
  # Hold the actual deferred FK parent; the writer's final dependency check
  # must finish before the CoW receipt is stamped.
  holder="cow_fk_holder_${RUN_TAG}"; writer="cow_fk_writer_${RUN_TAG}"
  COW_TEST_LOG_DIR="$(mktemp -d)"
  holder_file="${COW_TEST_LOG_DIR}/holder.log"; writer_file="${COW_TEST_LOG_DIR}/writer.log"
  run_psql_once "begin; set application_name='${holder}';
    select id from app_public.exercise_definitions where owner_user_id='${OWNER_UID}' and id='${def}' for update;
    select pg_sleep(60); rollback;" >"${holder_file}" 2>&1 &
  holder_pid=$!
  deadline=$((SECONDS + 15))
  until [[ "$(run_psql "select count(*) from pg_stat_activity where application_name='${holder}' and wait_event='PgSleep';")" == 1 ]]; do
    [[ ${SECONDS} -lt ${deadline} ]] || fail "FK holder did not acquire its parent lock"
    sleep 0.05
  done
  run_psql_once "begin; set application_name='${writer}'; set constraints all deferred;
    select set_config('request.jwt.claims',jsonb_build_object('sub','${OWNER_UID}','role','authenticated')::text,true);
    insert into app_public.session_exercises(owner_user_id,id,session_id,exercise_definition_id,name,order_index,created_at,updated_at,client_updated_at_ms)
      values('${OWNER_UID}','fk-${se}','${sid}','${def}','FK probe',1,${started},${started},${started});
    insert into app_public.exercise_sets(owner_user_id,id,session_exercise_id,order_index,weight_value,reps_value,set_type,created_at,updated_at,client_updated_at_ms)
      values('${OWNER_UID}','fk-${set}','fk-${se}',0,'120','5','working',${started},${started},${started});
    set constraints all immediate; commit;" >"${writer_file}" 2>&1 &
  writer_pid=$!
  deadline=$((SECONDS + 15))
  until [[ "$(run_psql "select count(*) from pg_stat_activity w where w.application_name='${writer}'
      and exists(select 1 from pg_stat_activity h where h.application_name='${holder}' and h.pid=any(pg_blocking_pids(w.pid)));")" == 1 ]]; do
    kill -0 "${writer_pid}" 2>/dev/null || { cat "${writer_file}" >&2; fail "FK writer exited before its deferred check"; }
    [[ ${SECONDS} -lt ${deadline} ]] || fail "writer never reached the deferred FK dependency"
    sleep 0.05
  done
  run_psql "update app_public.group_cows set ends_at=clock_timestamp()+interval '1 second' where id='${ci}';" >/dev/null
  deadline=$((SECONDS + 15))
  until [[ "$(run_psql "select clock_timestamp()>=ends_at from app_public.group_cows where id='${ci}';")" == t ]]; do
    [[ ${SECONDS} -lt ${deadline} ]] || fail "CoW cutoff did not arrive"
    sleep 0.05
  done
  run_psql "select pg_cancel_backend(pid) from pg_stat_activity where application_name='${holder}';" >/dev/null
  wait "${holder_pid}" || true
  wait "${writer_pid}" || { cat "${writer_file}" >&2; fail "deferred FK writer failed"; }
  [[ "$(run_psql "select count(*)||':'||bool_and(s.received_at>=c.ends_at) from app_public.group_cow_sources s
    join app_public.group_cows c on c.id=s.cow_id where c.id='${ci}' and s.set_id='fk-${set}';")" == '1:true' ]] || fail "transaction-start receipt accepted a dependency that crossed cutoff"
  # The clock passed end; create retry must resolve its durable identity first.
  rpc "${OWNER_TOKEN}" group_cow_create "${create_body}"
  expect_ok "create retry survives a later week/state"
  check "ended definition is finalizing, never an invented final" '.cow.state=="finalizing"'
  rm -rf "${COW_TEST_LOG_DIR}"; COW_TEST_LOG_DIR=""
  pass "CoW calendars, roles, idempotent lifecycle, exact definitions, retained receipts, real deferred-FK cutoff and isolated uncertainty"
}

# Scheduling and an existing-source correction can overlap without either
# transaction seeing the other's uncommitted row. Discovery must follow the lock.
run_cow_creation_race() {
  local def="$1" g e c sid se set started gate holder writer gate_pid holder_pid writer_pid deadline
  rpc "${OWNER_TOKEN}" group_create "$(jq -nc --arg n "Create race ${RUN_TAG}" '{p_name:$n,p_description:null,p_time_zone:"UTC"}')"
  expect_ok "creation race group"
  g="$(jq -r '.group_id' <<<"${BODY}")"
  rpc "${OWNER_TOKEN}" group_competition_exercise_create "$(b_gx_create "${g}" Race total_load)"
  expect_ok "creation race target"
  e="$(jq -r '.exercise.group_exercise_id' <<<"${BODY}")"
  started="$(run_psql "select floor(extract(epoch from clock_timestamp())*1000)::bigint;")"
  sid="cow-race-session-${RUN_TAG}"; se="cow-race-block-${RUN_TAG}"; set="cow-race-set-${RUN_TAG}"
  next_cuam
  push "${OWNER_TOKEN}" 'share source before first CoW' "$(e_link "${def}" "${g}" "${e}" "${CUAM}")" \
    "$(e_session "${sid}" "${started}" completed "$((started+1))" 1 null "${CUAM}")" \
    "$(e_se "${se}" "${sid}" "${def}" 0 Cow "${CUAM}" null)" "$(e_set "${set}" "${se}" 0 100 5 "" "${CUAM}" null)"
  [[ "$(run_psql "select count(*) from app_public.group_session_shares where group_id='${g}' and member_user_id='${OWNER_UID}' and session_id='${sid}';")" == 1 ]] || fail "creation race source was not legitimately shared"
  c="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
  gate="cow_create_gate_${RUN_TAG}"; holder="cow_create_holder_${RUN_TAG}"; writer="cow_create_writer_${RUN_TAG}"
  COW_TEST_LOG_DIR="$(mktemp -d)"
  run_psql_once "set application_name='${gate}'; select pg_advisory_lock(hashtextextended('${holder}',0)); select pg_sleep(60);" >"${COW_TEST_LOG_DIR}/gate" 2>&1 &
  gate_pid=$!
  deadline=$((SECONDS+15))
  until [[ "$(run_psql "select count(*) from pg_stat_activity where application_name='${gate}' and wait_event='PgSleep';")" == 1 ]]; do
    [[ ${SECONDS} -lt ${deadline} ]] || fail "creation race gate did not acquire its advisory lock"
    sleep 0.05
  done
  run_psql_once "begin; set application_name='${holder}';
    select set_config('request.jwt.claims',jsonb_build_object('sub','${OWNER_UID}','role','authenticated')::text,true);
    select set_config('request.headers','{\"x-boga-group-contract\":\"4\"}',true);
    select app_public.group_cow_create('${g}','${c}','${e}',array['volume'],1,app_public.group_cow_week('UTC',clock_timestamp())+7);
    set constraints all immediate;
    select pg_advisory_xact_lock(hashtextextended('${holder}',0)); commit;" >"${COW_TEST_LOG_DIR}/holder" 2>&1 &
  holder_pid=$!
  deadline=$((SECONDS+15))
  until [[ "$(run_psql "select count(*) from pg_stat_activity where application_name='${holder}' and wait_event='advisory';")" == 1 ]]; do
    kill -0 "${holder_pid}" 2>/dev/null || { cat "${COW_TEST_LOG_DIR}/holder" >&2; fail "creation race scheduler exited before sealing"; }
    [[ ${SECONDS} -lt ${deadline} ]] || fail "creation race scheduler never sealed"
    sleep 0.05
  done
  run_psql_once "begin; set application_name='${writer}';
    select set_config('request.jwt.claims',jsonb_build_object('sub','${OWNER_UID}','role','authenticated')::text,true);
    update app_public.exercise_sets set weight_value='101' where owner_user_id='${OWNER_UID}' and id='${set}';
    set constraints all immediate; commit;" >"${COW_TEST_LOG_DIR}/writer" 2>&1 &
  writer_pid=$!
  deadline=$((SECONDS+15))
  while kill -0 "${writer_pid}" 2>/dev/null; do
    [[ "$(run_psql "select count(*) from pg_stat_activity where application_name='${writer}' and wait_event_type='Lock';")" == 1 ]] && break
    [[ ${SECONDS} -lt ${deadline} ]] || fail "creation race writer did not finish or reach the group lock"
    sleep 0.05
  done
  run_psql "select pg_cancel_backend(pid) from pg_stat_activity where application_name='${gate}';" >/dev/null
  wait "${gate_pid}" || true
  wait "${holder_pid}" || { cat "${COW_TEST_LOG_DIR}/holder" >&2; fail "creation race schedule failed"; }
  wait "${writer_pid}" || { cat "${COW_TEST_LOG_DIR}/writer" >&2; fail "creation race correction failed"; }
  [[ "$(run_psql "select input->>'weight_value' from app_public.group_cow_sources where cow_id='${c}' and set_id='${set}' order by id desc limit 1;")" == 101 ]] || fail "concurrent first CoW missed an accepted existing-source correction"
  rm -rf "${COW_TEST_LOG_DIR}"; COW_TEST_LOG_DIR=""
  pass "concurrent first CoW and existing-source correction serialize at the final seal"
}
