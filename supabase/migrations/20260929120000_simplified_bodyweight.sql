-- Clean optional-bodyweight cutover. The only durable calculation inputs are
-- kg Weight, reps, load distribution, contribution and the applicable policy.

create function app_public.require_sync_protocol()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  protocol text := coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-boga-sync-protocol','');
begin
  if protocol !~ '^[0-9]{1,6}$' or protocol::integer <> 3 then
    raise exception 'UPDATE_REQUIRED: Update BoGa to continue syncing.' using errcode='P0001';
  end if;
end;
$$;
revoke all on function app_public.require_sync_protocol() from public;
grant execute on function app_public.require_sync_protocol() to authenticated,service_role;

create table app_public.user_settings (
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null default 'settings',
  bodyweight_calculations_enabled boolean not null default false,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  client_updated_at_ms bigint not null,
  server_received_at timestamptz not null default now(),
  primary key (owner_user_id,id)
);
create index user_settings_owner_received_idx on app_public.user_settings(owner_user_id,server_received_at);
create index user_settings_deleted_at_idx on app_public.user_settings(deleted_at);
create trigger user_settings_touch_server_received_at before update on app_public.user_settings
  for each row when (new is distinct from old) execute function app_public.touch_server_received_at();
create trigger user_settings_owner_user_id_immutable before update on app_public.user_settings
  for each row execute function app_public.enforce_owner_user_id_immutable();
alter table app_public.user_settings enable row level security;
create policy user_settings_owner_select on app_public.user_settings for select to authenticated
  using (owner_user_id=auth.uid());
create policy user_settings_owner_insert on app_public.user_settings for insert to authenticated
  with check (owner_user_id=auth.uid());
create policy user_settings_owner_update on app_public.user_settings for update to authenticated
  using (owner_user_id=auth.uid()) with check (owner_user_id=auth.uid());
create policy user_settings_owner_delete on app_public.user_settings for delete to authenticated
  using (owner_user_id=auth.uid());
create policy user_settings_direct_app_only on app_public.user_settings as restrictive for all to authenticated
  using (((select auth.jwt())->>'client_id') is null)
  with check (((select auth.jwt())->>'client_id') is null);
grant select,insert,update,delete on app_public.user_settings to authenticated,service_role;

insert into app_public.user_settings(
  owner_user_id,id,bodyweight_calculations_enabled,created_at,updated_at,deleted_at,
  client_updated_at_ms,server_received_at)
select id,'settings',false,
  floor(extract(epoch from now())*1000)::bigint,
  floor(extract(epoch from now())*1000)::bigint,null,0,now()
from auth.users
on conflict (owner_user_id,id) do nothing;

-- The developer wipe owns every synced owner-private entity. Keep the helper
-- complete when the settings singleton joins that domain.
do $migration$
declare definition text; revised text;
begin
  select pg_get_functiondef('app_public.dev_wipe_my_data()'::regprocedure) into definition;
  revised:=replace(definition,
    $anchor$  delete from app_public.body_weight_measurements where owner_user_id = _uid;$anchor$,
    $patch$  delete from app_public.user_settings where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from app_public.body_weight_measurements where owner_user_id = _uid;$patch$);
  if revised=definition then raise exception 'bodyweight cutover failed to add settings to dev_wipe_my_data'; end if;
  execute revised;
end
$migration$;

alter table app_public.exercise_definitions
  add column bodyweight_contribution double precision not null default 0;
alter table app_public.exercise_definitions
  disable trigger exercise_definitions_owner_user_id_immutable;
update app_public.exercise_definitions
set bodyweight_contribution=bodyweight_coefficient;
alter table app_public.exercise_definitions
  enable trigger exercise_definitions_owner_user_id_immutable;
alter table app_public.group_exercises
  add column bodyweight_contribution double precision not null default 0;
update app_public.group_exercises
set bodyweight_contribution=bodyweight_coefficient;
alter table app_public.groups
  add column bodyweight_calculations_enabled boolean not null default false;
update app_public.group_exercises
set default_metric='e1rm'
where default_metric not in ('weight','e1rm');
alter table app_public.group_exercises
  drop constraint group_exercises_coefficient_valid,
  drop constraint group_exercises_standard_valid,
  drop constraint group_exercises_method_valid,
  drop constraint group_exercises_bodyweight_identity,
  drop constraint group_exercises_default_metric_valid,
  add constraint group_exercises_bodyweight_contribution_valid
    check (bodyweight_contribution between 0 and 1),
  add constraint group_exercises_default_metric_valid
    check (default_metric in ('weight','e1rm'));

create function app_public.group_metric_names()
returns text[] language sql immutable set search_path=app_public,pg_temp as $$
  select array['weight','e1rm'];
$$;

create or replace function app_public.group_metric_unit(p_metric text)
returns text language sql immutable set search_path=app_public,pg_temp as $$
  select case when p_metric in ('weight','e1rm') then 'kg' end;
$$;

-- Convert retained numeric lb values before their unit columns disappear.
alter table app_public.exercise_sets
  disable trigger exercise_sets_owner_user_id_immutable;
update app_public.exercise_sets
set weight_value = case
      when weight_unit='lb' and btrim(weight_value) ~ '^[+]?(?:[0-9]+(?:[.][0-9]*)?|[.][0-9]+)$'
        and btrim(weight_value)::numeric <= 1.7976931348623157e308::numeric
      then (btrim(weight_value)::numeric * 0.45359237::numeric)::text
      else weight_value end,
    planned_weight_value = case
      when planned_weight_unit='lb' and btrim(planned_weight_value) ~ '^[+]?(?:[0-9]+(?:[.][0-9]*)?|[.][0-9]+)$'
        and btrim(planned_weight_value)::numeric <= 1.7976931348623157e308::numeric
      then (btrim(planned_weight_value)::numeric * 0.45359237::numeric)::text
      else planned_weight_value end;
alter table app_public.exercise_sets
  enable trigger exercise_sets_owner_user_id_immutable;

-- Invalid restored readings remain editable but are skipped. Selection may use
-- an older valid reading at or before the session's exact start instant.
create or replace function app_public.session_weight_as_of(p_owner uuid,p_started_at bigint)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce((
    select jsonb_build_object(
      'body_weight_kg',r.weight_kg,
      'body_weight_source','reading',
      'body_weight_measurement_id',r.id,
      'body_weight_measured_at',r.measured_at)
    from app_public.body_weight_measurements r
    where r.owner_user_id=p_owner and r.deleted_at is null
      and p_started_at is not null and abs(p_started_at::numeric)<=8640000000000000
      and r.measured_at<=p_started_at and abs(r.measured_at::numeric)<=8640000000000000
      -- Match JavaScript String.trim(), including non-ASCII whitespace in a
      -- restored reading ID; PostgreSQL's default btrim strips only U+0020.
      and btrim(r.id, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')<>''
      and r.weight_kg>0 and r.weight_kg<'Infinity'::double precision
    order by r.measured_at desc,r.id collate "C" asc limit 1
  ),jsonb_build_object('body_weight_kg',null,'body_weight_source',null,
    'body_weight_measurement_id',null,'body_weight_measured_at',null));
$$;

drop trigger if exists body_weight_readings_group_eval_update on app_public.body_weight_measurements;
create trigger body_weight_readings_group_eval_update after update on app_public.body_weight_measurements
  for each row when ((old.weight_kg,old.measured_at,old.deleted_at)
    is distinct from (new.weight_kg,new.measured_at,new.deleted_at))
  execute function app_public.group_eval_on_body_weight_reading();

-- Rewrite the two sync functions in place so historical migrations remain
-- immutable while the live protocol exposes only the clean v3 fields.
do $migration$
declare
  definition text;
  revised text;
begin
  select pg_get_functiondef('app_public.sync_push(jsonb)'::regprocedure) into definition;
  definition := replace(definition,
    'perform app_public.require_dated_weight_protocol();',
    'perform app_public.require_sync_protocol();');

  revised := replace(definition,$old$
    elsif _type = 'exercise_definitions' then
      insert into app_public.exercise_definitions (
        owner_user_id, id,
        name, load_input_mode, bodyweight_coefficient, movement_standard, loading_method, created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'name',
        coalesce(_fields ->> 'load_input_mode', 'total_load'),
        case when _fields ? 'bodyweight_coefficient' then (_fields ->> 'bodyweight_coefficient')::double precision else 0 end,
        _fields ->> 'movement_standard',
        _fields ->> 'loading_method',
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'updated_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      )
      on conflict (owner_user_id, id) do update
        set name                 = excluded.name,
            bodyweight_coefficient = case when _fields ? 'bodyweight_coefficient' then excluded.bodyweight_coefficient
              else app_public.exercise_definitions.bodyweight_coefficient end,
            movement_standard = case when _fields ? 'movement_standard' then excluded.movement_standard
              else app_public.exercise_definitions.movement_standard end,
            loading_method = case when _fields ? 'loading_method' then excluded.loading_method
              else app_public.exercise_definitions.loading_method end,
            load_input_mode      = case
              when _fields ? 'load_input_mode' then excluded.load_input_mode
              else app_public.exercise_definitions.load_input_mode
            end,
            created_at           = excluded.created_at,
            updated_at           = excluded.updated_at,
            deleted_at           = excluded.deleted_at,
            client_updated_at_ms = excluded.client_updated_at_ms,
            server_received_at   = excluded.server_received_at
        where excluded.client_updated_at_ms > app_public.exercise_definitions.client_updated_at_ms;
$old$,$new$
    elsif _type = 'exercise_definitions' then
      insert into app_public.exercise_definitions (
        owner_user_id,id,name,load_input_mode,bodyweight_contribution,
        created_at,updated_at,deleted_at,client_updated_at_ms,server_received_at
      ) values (
        _uid,_id,_fields->>'name',_fields->>'load_input_mode',
        (_fields->>'bodyweight_contribution')::double precision,
        (_fields->>'created_at')::bigint,(_fields->>'updated_at')::bigint,
        (_fields->>'deleted_at')::bigint,_cuam,_now_tstz
      ) on conflict (owner_user_id,id) do update set
        name=excluded.name,load_input_mode=excluded.load_input_mode,
        bodyweight_contribution=excluded.bodyweight_contribution,
        created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,
        client_updated_at_ms=excluded.client_updated_at_ms,server_received_at=excluded.server_received_at
      where excluded.client_updated_at_ms>app_public.exercise_definitions.client_updated_at_ms;
$new$);
  if revised=definition then raise exception 'bodyweight cutover failed to replace exercise definition sync'; end if;
  definition:=revised;

  revised := replace(definition,$old$
    elsif _type = 'exercise_sets' then
      insert into app_public.exercise_sets (
        owner_user_id, id,
        session_exercise_id, order_index, weight_value, reps_value, set_type,
        planned_weight_value, planned_reps_value, planned_set_type, performance_status,
        weight_unit, external_load_mode, planned_weight_unit, planned_external_load_mode,
        created_at, updated_at, deleted_at,
        client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'session_exercise_id',
        (_fields ->> 'order_index')::integer,
        coalesce(_fields ->> 'weight_value', ''),
        coalesce(_fields ->> 'reps_value', ''),
        _fields ->> 'set_type',
        _fields ->> 'planned_weight_value',
        _fields ->> 'planned_reps_value',
        _fields ->> 'planned_set_type',
        _fields ->> 'performance_status',
        case when _fields ? 'weight_unit' then _fields ->> 'weight_unit' else 'kg' end,
        _fields ->> 'external_load_mode',
        _fields ->> 'planned_weight_unit',
        _fields ->> 'planned_external_load_mode',
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'updated_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      )
      on conflict (owner_user_id, id) do update
        set session_exercise_id  = excluded.session_exercise_id,
            order_index          = excluded.order_index,
            weight_value         = excluded.weight_value,
            reps_value           = excluded.reps_value,
            set_type             = excluded.set_type,
            planned_weight_value = excluded.planned_weight_value,
            planned_reps_value   = excluded.planned_reps_value,
            planned_set_type     = excluded.planned_set_type,
            weight_unit = case when _fields ? 'weight_unit' then excluded.weight_unit
              else app_public.exercise_sets.weight_unit end,
            external_load_mode = case when _fields ? 'external_load_mode' then excluded.external_load_mode
              else app_public.exercise_sets.external_load_mode end,
            planned_weight_unit = case when _fields ? 'planned_weight_unit' then excluded.planned_weight_unit
              else app_public.exercise_sets.planned_weight_unit end,
            planned_external_load_mode = case when _fields ? 'planned_external_load_mode' then excluded.planned_external_load_mode
              else app_public.exercise_sets.planned_external_load_mode end,
            performance_status   = excluded.performance_status,
            created_at           = excluded.created_at,
            updated_at           = excluded.updated_at,
            deleted_at           = excluded.deleted_at,
            client_updated_at_ms = excluded.client_updated_at_ms,
            server_received_at   = excluded.server_received_at
        where excluded.client_updated_at_ms > app_public.exercise_sets.client_updated_at_ms;
$old$,$new$
    elsif _type = 'exercise_sets' then
      insert into app_public.exercise_sets (
        owner_user_id,id,session_exercise_id,order_index,weight_value,reps_value,set_type,
        planned_weight_value,planned_reps_value,planned_set_type,performance_status,
        created_at,updated_at,deleted_at,client_updated_at_ms,server_received_at
      ) values (
        _uid,_id,_fields->>'session_exercise_id',(_fields->>'order_index')::integer,
        coalesce(_fields->>'weight_value',''),coalesce(_fields->>'reps_value',''),_fields->>'set_type',
        _fields->>'planned_weight_value',_fields->>'planned_reps_value',_fields->>'planned_set_type',
        _fields->>'performance_status',(_fields->>'created_at')::bigint,(_fields->>'updated_at')::bigint,
        (_fields->>'deleted_at')::bigint,_cuam,_now_tstz
      ) on conflict (owner_user_id,id) do update set
        session_exercise_id=excluded.session_exercise_id,order_index=excluded.order_index,
        weight_value=excluded.weight_value,reps_value=excluded.reps_value,set_type=excluded.set_type,
        planned_weight_value=excluded.planned_weight_value,planned_reps_value=excluded.planned_reps_value,
        planned_set_type=excluded.planned_set_type,performance_status=excluded.performance_status,
        created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,
        client_updated_at_ms=excluded.client_updated_at_ms,server_received_at=excluded.server_received_at
      where excluded.client_updated_at_ms>app_public.exercise_sets.client_updated_at_ms;
$new$);
  if revised=definition then raise exception 'bodyweight cutover failed to replace exercise set sync'; end if;
  definition:=revised;

  revised := replace(definition,$old$
    elsif _type = 'body_weight_measurements' then
      insert into app_public.body_weight_measurements (
        owner_user_id, id, weight_value, weight_unit, weight_kg, measured_at,
        created_at, updated_at, deleted_at, client_updated_at_ms, server_received_at
      ) values (
        _uid, _id,
        _fields ->> 'weight_value',
        _fields ->> 'weight_unit',
        (_fields ->> 'weight_kg')::double precision,
        (_fields ->> 'measured_at')::bigint,
        (_fields ->> 'created_at')::bigint,
        (_fields ->> 'updated_at')::bigint,
        (_fields ->> 'deleted_at')::bigint,
        _cuam, _now_tstz
      ) on conflict (owner_user_id, id) do update
        set weight_value = excluded.weight_value,
            weight_unit = excluded.weight_unit,
            weight_kg = excluded.weight_kg,
            measured_at = excluded.measured_at,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at,
            client_updated_at_ms = excluded.client_updated_at_ms,
            server_received_at = excluded.server_received_at
        where excluded.client_updated_at_ms > app_public.body_weight_measurements.client_updated_at_ms;
$old$,$new$
    elsif _type = 'body_weight_measurements' then
      insert into app_public.body_weight_measurements (
        owner_user_id,id,weight_kg,measured_at,created_at,updated_at,deleted_at,
        client_updated_at_ms,server_received_at
      ) values (
        _uid,_id,(_fields->>'weight_kg')::double precision,(_fields->>'measured_at')::bigint,
        (_fields->>'created_at')::bigint,(_fields->>'updated_at')::bigint,
        (_fields->>'deleted_at')::bigint,_cuam,_now_tstz
      ) on conflict (owner_user_id,id) do update set
        weight_kg=excluded.weight_kg,measured_at=excluded.measured_at,
        created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,
        client_updated_at_ms=excluded.client_updated_at_ms,server_received_at=excluded.server_received_at
      where excluded.client_updated_at_ms>app_public.body_weight_measurements.client_updated_at_ms;
$new$);
  if revised=definition then raise exception 'bodyweight cutover failed to replace reading sync'; end if;
  definition:=revised;

  revised:=replace(definition,$anchor$
    elsif _type = 'body_weight_measurements' then
$anchor$,$patch$
    elsif _type = 'user_settings' then
      insert into app_public.user_settings(
        owner_user_id,id,bodyweight_calculations_enabled,created_at,updated_at,deleted_at,
        client_updated_at_ms,server_received_at
      ) values (
        _uid,_id,(_fields->>'bodyweight_calculations_enabled')::boolean,
        (_fields->>'created_at')::bigint,(_fields->>'updated_at')::bigint,
        (_fields->>'deleted_at')::bigint,_cuam,_now_tstz
      ) on conflict (owner_user_id,id) do update set
        bodyweight_calculations_enabled=excluded.bodyweight_calculations_enabled,
        created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,
        client_updated_at_ms=excluded.client_updated_at_ms,server_received_at=excluded.server_received_at
      where excluded.client_updated_at_ms>app_public.user_settings.client_updated_at_ms;

    elsif _type = 'body_weight_measurements' then
$patch$);
  if revised=definition then raise exception 'bodyweight cutover failed to add settings sync'; end if;
  execute revised;
end
$migration$;

-- Adapt the existing event engine to the clean rule keys. Event reconciliation
-- remains unchanged; only the metric family lookup changes.
do $migration$
declare definition text; revised text;
begin
  select pg_get_functiondef('app_public.group_metric_apply_member(uuid,uuid,uuid,bigint,jsonb,boolean)'::regprocedure)
    into definition;
  revised:=replace(definition,
    $old$_metrics := app_public.group_metric_names((p_graph -> 'rules' ->> 'bodyweight_coefficient')::double precision);$old$,
    $new$_metrics := app_public.group_metric_names();$new$);
  if revised=definition then raise exception 'bodyweight cutover failed to update group event metric family'; end if;
  execute revised;
end
$migration$;

create or replace function app_public.group_metric_eval_publish(
  p_job_id bigint,p_generation bigint,p_claim_id uuid,p_evaluation jsonb
)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare
  _job app_public.group_metric_eval_queue;
  _exercise app_public.group_exercises;
  _group_id uuid;
  _graph jsonb;
  _member jsonb;
  _revision bigint;
  _silent boolean;
  _count integer;
begin
  select group_id into _group_id from app_public.group_metric_eval_queue where id=p_job_id;
  if not found then return jsonb_build_object('completed',false); end if;
  perform 1 from app_public.groups where id=_group_id for update;
  perform pg_advisory_xact_lock(25005,hashtext(_group_id::text));
  select * into _job from app_public.group_metric_eval_queue where id=p_job_id for update;
  if not found or p_claim_id is null or _job.claim_id is distinct from p_claim_id then
    return jsonb_build_object('completed',false);
  end if;
  if _job.generation is distinct from p_generation then
    update app_public.group_metric_eval_queue set claim_id=null,claimed_until=null,available_at=now()
      where id=_job.id;
    return jsonb_build_object('completed',false);
  end if;
  _graph:=app_public.group_metric_eval_source_graph(_job.group_id,_job.group_exercise_id);
  if _graph is null then
    delete from app_public.group_metric_eval_queue where id=_job.id;
    return jsonb_build_object('completed',true,'frozen',true);
  end if;
  select * into strict _exercise from app_public.group_exercises where id=_job.group_exercise_id;
  _revision:=_exercise.rules_revision;
  if p_evaluation->>'source_token' is distinct from _graph->>'source_token'
    or p_evaluation->>'rules_revision' is distinct from _revision::text
    or p_evaluation->>'group_id' is distinct from _job.group_id::text
    or p_evaluation->>'group_exercise_id' is distinct from _job.group_exercise_id::text then
    update app_public.group_metric_eval_queue set claim_id=null,claimed_until=null,available_at=now()
      where id=_job.id;
    return jsonb_build_object('completed',false);
  end if;
  if jsonb_typeof(p_evaluation->'scores') is distinct from 'array' then
    raise exception 'VALIDATION: missing evaluation scores' using errcode='P0001';
  end if;
  if exists(select 1 from jsonb_array_elements(p_evaluation->'scores') x
    where not(x->>'metric'=any(app_public.group_metric_names()))
      or x->>'unit' is distinct from app_public.group_metric_unit(x->>'metric')
      or jsonb_typeof(x->'value') is distinct from 'number'
      or not((x->>'value')::double precision>0 and (x->>'value')::double precision<'Infinity'::double precision)
      or not exists(select 1 from jsonb_array_elements(_graph->'sets') r
        where r->>'member_user_id'=x->>'member_user_id' and r->>'set_id'=x->>'set_id'
          and (r->>'live')::boolean
          and r->'fingerprints'->>(x->>'metric')=x->>'fingerprint'
          and r->>'session_id'=x->>'session_id'
          and r->>'session_exercise_id'=x->>'session_exercise_id'
          and r->>'exercise_definition_id'=x->>'exercise_definition_id')) then
    raise exception 'VALIDATION: evaluation does not match source graph' using errcode='P0001';
  end if;
  delete from app_public.group_metric_set_scores s
    where s.group_exercise_id=_job.group_exercise_id and s.rules_revision=_revision
      and exists(select 1 from jsonb_array_elements(_graph->'members') m
        where m->>'member_user_id'=s.member_user_id::text);
  insert into app_public.group_metric_set_scores(
    group_id,group_exercise_id,rules_revision,member_user_id,membership_id,
    set_id,session_id,session_exercise_id,exercise_definition_id,metric,value,unit,counting,
    achieved_at_ms,exercise_order_index,set_order_index,set_created_at_ms,fingerprint,performance)
  select _job.group_id,_job.group_exercise_id,_revision,(x->>'member_user_id')::uuid,
    (m->>'membership_id')::uuid,x->>'set_id',r->>'session_id',r->>'session_exercise_id',
    r->>'exercise_definition_id',x->>'metric',
    app_public.group_metric_rank_value((x->>'value')::double precision),x->>'unit',
    (r->>'counting')::boolean,(r->>'achieved_at_ms')::bigint,
    (r->>'exercise_order_index')::integer,(r->>'set_order_index')::integer,
    (r->>'set_created_at_ms')::bigint,x->>'fingerprint',jsonb_build_object(
      'session_id',r->>'session_id','session_exercise_id',r->>'session_exercise_id',
      'exercise_definition_id',r->>'exercise_definition_id','set_id',r->>'set_id',
      'weight_value',r->>'weight_value','reps_value',r->>'reps_value',
      'reps',(r->>'reps_value')::integer,'performance_status',r->'performance_status',
      'source_load_input_mode',r->>'source_load_input_mode',
      'achieved_at_ms',(r->>'achieved_at_ms')::bigint,
      'exercise_order_index',(r->>'exercise_order_index')::integer,
      'set_order_index',(r->>'set_order_index')::integer)
  from jsonb_array_elements(p_evaluation->'scores') x
  join jsonb_array_elements(_graph->'sets') r on r->>'member_user_id'=x->>'member_user_id'
    and r->>'set_id'=x->>'set_id'
  join jsonb_array_elements(_graph->'members') m on m->>'member_user_id'=x->>'member_user_id'
  where app_public.group_metric_rank_value((x->>'value')::double precision) is not null;
  get diagnostics _count=row_count;
  _silent:=not exists(select 1 from app_public.group_rule_revisions r
    where r.group_exercise_id=_job.group_exercise_id and r.revision=_revision
      and r.published_at is not null);
  for _member in select m from jsonb_array_elements(_graph->'members') m
    order by m->>'member_user_id'
  loop
    perform app_public.group_metric_apply_member(_job.group_id,(_member->>'member_user_id')::uuid,
      _job.group_exercise_id,_revision,_graph,_silent);
  end loop;
  update app_public.group_exercises set published_rules_revision=_revision
    where id=_job.group_exercise_id;
  update app_public.group_rule_revisions set published_at=coalesce(published_at,now())
    where group_exercise_id=_job.group_exercise_id and revision=_revision;
  if _silent and _revision>1 then
    insert into app_public.group_events(contract_version,rules_revision,group_id,kind,
      group_exercise_id,sort_at_ms,payload)
    values(2,_revision,_job.group_id,'rules_change',_job.group_exercise_id,
      floor(extract(epoch from now())*1000)::bigint,
      jsonb_build_object('previous_revision',_revision-1,'rules',_graph->'rules'))
    on conflict(group_exercise_id,rules_revision) where kind='rules_change' do nothing;
  end if;
  delete from app_public.group_metric_eval_queue where id=_job.id;
  return jsonb_build_object('completed',true,'rules_revision',_revision,'scores',_count);
end;
$$;

create or replace function app_public.group_metric_certification_json(
  p_row app_public.group_metric_certifications
)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select jsonb_build_object(
    'certification_id',p_row.id,'metric',p_row.metric,
    'rules_revision',p_row.observed_rules_revision,'value',p_row.observed_value,'unit',p_row.unit,
    'certified_by',case when p_row.certified_by is null then null
      else app_public.group_member_ref_json(p_row.certified_by) end,
    'certified_at_ms',floor(extract(epoch from p_row.certified_at)*1000)::bigint,
    'performance',p_row.performance,
    'ended_at_ms',floor(extract(epoch from p_row.ended_at)*1000)::bigint,
    'end_reason',p_row.end_reason);
$$;

create or replace function app_public.group_metric_board_ranked(
  p_group uuid,p_exercise uuid,p_revision bigint,p_metric text,p_certified boolean
)
returns table(rank integer,member_user_id uuid,value numeric,achieved_at_ms bigint,row_json jsonb)
language sql stable set search_path=app_public,pg_temp as $$
  with visible as (
    select e.*,c.id as active_certification_id
    from app_public.group_metric_entries(p_exercise,p_revision,p_metric,p_certified) e
    left join app_public.group_metric_certifications c on c.group_exercise_id=e.group_exercise_id
      and c.member_user_id=e.member_user_id and c.set_id=e.set_id and c.metric=e.metric
      and c.ended_at is null and c.pinned_fingerprint=e.fingerprint
    where not p_certified or c.id is not null
  ), ranked as (
    select v.*,row_number() over(order by v.value desc,v.achieved_at_ms,v.member_user_id)::integer as rank
    from visible v
  ) select r.rank,r.member_user_id,r.value,r.achieved_at_ms,jsonb_build_object(
    'rank',r.rank,'member',app_public.group_member_ref_json(r.member_user_id),
    'former',not exists(select 1 from app_public.group_memberships m
      where m.group_id=p_group and m.user_id=r.member_user_id and m.ended_at is null),
    'metric',r.metric,'value',r.value,'unit',r.unit,'rules_revision',r.rules_revision,
    'achieved_at_ms',r.achieved_at_ms,'set_id',r.set_id,'performance',r.performance,
    'fingerprint',r.fingerprint,'certified',r.active_certification_id is not null,
    'certification_id',r.active_certification_id)
  from ranked r order by r.rank;
$$;

create or replace function app_public.group_metric_stream_record_context(p_event app_public.group_events)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select jsonb_build_object('exercise',app_public.group_exercise_json_v2(ge),
    'former',app_public.group_active_role(p_event.group_id,p_event.member_user_id) is null,
    'metrics',coalesce((select jsonb_agg(jsonb_build_object(
      'metric',b->>'metric','fingerprint',b->>'fingerprint',
      'eligible',s.set_id is not null and ge.archived_at is null
        and ge.rules_revision=p_event.rules_revision
        and ge.published_rules_revision=ge.rules_revision
        and app_public.group_active_role(p_event.group_id,p_event.member_user_id) is not null
        and not exists(select 1 from app_public.group_events v
          where v.kind='record_voided' and v.related_event_id=p_event.id),
      'certification',case when c.id is not null then app_public.group_metric_certification_json(c) end)
      order by b->>'metric')
      from jsonb_array_elements(p_event.payload->'boards') b
      left join app_public.group_metric_set_scores s on s.group_exercise_id=ge.id
        and s.rules_revision=p_event.rules_revision and s.member_user_id=p_event.member_user_id
        and s.set_id=p_event.set_id and s.metric=b->>'metric' and s.fingerprint=b->>'fingerprint'
      left join lateral app_public.group_metric_certification_matching(ge.id,p_event.member_user_id,
        p_event.set_id,b->>'metric',b->>'fingerprint') c on true),'[]'::jsonb))
  from app_public.group_exercises ge where ge.id=p_event.group_exercise_id;
$$;

-- Group calculation inputs are resolved inside the service boundary. The
-- returned performance snapshot remains raw and never contains a reading.
create or replace function app_public.group_metric_performance_pin(
  p_metric text,p_set app_public.exercise_sets,p_session_exercise app_public.session_exercises,
  p_session app_public.sessions,p_definition app_public.exercise_definitions
)
returns text language sql stable set search_path=app_public,pg_temp as $$
  select case when p_metric in ('weight','e1rm')
  then encode(extensions.digest(jsonb_build_object(
    'pin_version',3,
    'metric',p_metric,
    'source',jsonb_build_array(p_set.owner_user_id,p_set.id,p_session_exercise.id,p_session.id,p_definition.id),
    'performance',jsonb_build_array(p_set.weight_value,p_set.reps_value,p_set.performance_status),
    'presence',jsonb_build_array(p_set.deleted_at,p_session_exercise.deleted_at,p_session.deleted_at),
    'source_load_input_mode',p_definition.load_input_mode
  )::text,'sha256'),'hex') end;
$$;

create or replace function app_public.group_metric_eval_source_graph(
  p_group_id uuid,p_group_exercise_id uuid
)
returns jsonb language sql stable security definer set search_path=app_public,pg_temp as $$
  with target as (
    select ge.*,g.bodyweight_calculations_enabled
    from app_public.group_exercises ge join app_public.groups g on g.id=ge.group_id
    where ge.id=p_group_exercise_id and ge.group_id=p_group_id
      and g.deleted_at is null and ge.archived_at is null
      and not app_public.group_metric_is_legacy(ge.id)
  ), members as (
    select gm.user_id as member_user_id,gm.id as membership_id
    from app_public.group_memberships gm,target t
    where gm.group_id=t.group_id and gm.ended_at is null
  ), links as (
    select l.owner_user_id as member_user_id,l.exercise_definition_id,l.updated_at
    from app_public.exercise_group_links l,target t
    where l.deleted_at is null
      and app_public.group_eval_try_uuid(l.group_id)=t.group_id
      and app_public.group_eval_try_uuid(l.group_exercise_id)=t.id
      and exists(select 1 from members m where m.member_user_id=l.owner_user_id)
  ), source_sets as (
    select jsonb_build_object(
      'member_user_id',s.owner_user_id,'session_id',s.id,
      'session_exercise_id',se.id,'exercise_definition_id',se.exercise_definition_id,
      'set_id',es.id,'weight_value',es.weight_value,'reps_value',es.reps_value,
      'performance_status',es.performance_status,
      'live',s.deleted_at is null and se.deleted_at is null and es.deleted_at is null and ed.id is not null,
      'counting',exists(select 1 from links l where l.member_user_id=s.owner_user_id
        and l.exercise_definition_id=se.exercise_definition_id),
      'source_load_input_mode',ed.load_input_mode,
      'body_weight_kg',bw.context->'body_weight_kg',
      'body_weight_source',bw.context->'body_weight_source',
      'body_weight_measurement_id',bw.context->'body_weight_measurement_id',
      'body_weight_measured_at_ms',bw.context->'body_weight_measured_at',
      'achieved_at_ms',s.started_at,'exercise_order_index',se.order_index,
      'set_order_index',es.order_index,'set_created_at_ms',es.created_at,
      'session_status',s.status,
      'fingerprints',jsonb_build_object(
        'weight',encode(extensions.digest(jsonb_build_array(
          app_public.group_metric_performance_pin('weight',es,se,s,ed),
          t.rules_revision,t.load_input_mode
        )::text,'sha256'),'hex'),
        'e1rm',encode(extensions.digest(jsonb_build_array(
          app_public.group_metric_performance_pin('e1rm',es,se,s,ed),
          t.rules_revision,t.load_input_mode,
          case when t.bodyweight_calculations_enabled and t.bodyweight_contribution>0
            then t.bodyweight_contribution end,
          case when t.bodyweight_calculations_enabled and t.bodyweight_contribution>0
            then coalesce(bw.context,jsonb_build_object('body_weight_kg',null)) end
        )::text,'sha256'),'hex'))
    ) as row,s.owner_user_id as member_user_id,es.id as set_id
    from target t
    join app_public.group_session_shares sh on sh.group_id=t.group_id
    join members m on m.member_user_id=sh.member_user_id
    join app_public.sessions s on s.owner_user_id=sh.member_user_id and s.id=sh.session_id
    join app_public.session_exercises se on se.owner_user_id=s.owner_user_id and se.session_id=s.id
    join app_public.exercise_sets es on es.owner_user_id=se.owner_user_id and es.session_exercise_id=se.id
    left join app_public.exercise_definitions ed on ed.owner_user_id=se.owner_user_id
      and ed.id=se.exercise_definition_id
    left join lateral (
      select app_public.session_weight_as_of(s.owner_user_id,s.started_at) as context
      where t.bodyweight_calculations_enabled and t.bodyweight_contribution>0
    ) bw on true
  ), graph as (
    select jsonb_build_object(
      'group_id',t.group_id,'group_exercise_id',t.id,'name',t.name,
      'rules',app_public.group_exercise_rules_json((select ge from app_public.group_exercises ge where ge.id=t.id)),
      'members',coalesce((select jsonb_agg(jsonb_build_object(
        'member_user_id',m.member_user_id,'membership_id',m.membership_id,
        'links',coalesce((select jsonb_agg(jsonb_build_object(
          'exercise_definition_id',l.exercise_definition_id,'updated_at_ms',l.updated_at)
          order by l.exercise_definition_id) from links l
          where l.member_user_id=m.member_user_id),'[]'::jsonb))
        order by m.member_user_id) from members m),'[]'::jsonb),
      'sets',coalesce((select jsonb_agg(ss.row order by ss.member_user_id,ss.set_id)
        from source_sets ss),'[]'::jsonb)) as value
    from target t
  ) select value||jsonb_build_object('source_token',
      encode(extensions.digest(value::text,'sha256'),'hex')) from graph;
$$;

-- Shared session readers expose the same raw set shape as ordinary exercises.
create or replace function app_public.group_session_exercises_json(p_member uuid,p_session_id text)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'session_exercise_id',se.id,
    'exercise_definition_id',se.exercise_definition_id,
    'load_input_mode',ed.load_input_mode,
    'name',se.name,'machine_name',se.machine_name,'order_index',se.order_index,
    'sets',coalesce((select jsonb_agg(jsonb_build_object(
      'set_id',es.id,'order_index',es.order_index,'weight_value',es.weight_value,
      'reps_value',es.reps_value,'set_type',es.set_type,
      'performance_status',es.performance_status) order by es.order_index,es.id)
      from app_public.exercise_sets es where es.owner_user_id=se.owner_user_id
        and es.session_exercise_id=se.id and es.deleted_at is null),'[]'::jsonb)
    ) order by se.order_index,se.id),'[]'::jsonb)
  from app_public.session_exercises se
  left join app_public.exercise_definitions ed on ed.owner_user_id=se.owner_user_id
    and ed.id=se.exercise_definition_id
  where se.owner_user_id=p_member and se.session_id=p_session_id and se.deleted_at is null;
$$;

create or replace function app_public.group_session_card_json(p_member uuid,p_session_id text,p_groups jsonb)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select jsonb_build_object(
    'kind','session','key',p_member::text||':'||p_session_id,'sort_at_ms',s.started_at,
    'member',app_public.group_member_ref_json(p_member),'session_id',p_session_id,'groups',p_groups,
    'gym_name',(select g.name from app_public.gyms g where g.owner_user_id=p_member
      and g.id=s.gym_id and g.deleted_at is null),
    'status',s.status,'started_at_ms',s.started_at,'completed_at_ms',s.completed_at,
    'duration_sec',s.duration_sec,'exercises',app_public.group_session_exercises_json(p_member,p_session_id))
  from app_public.sessions s where s.owner_user_id=p_member and s.id=p_session_id;
$$;

create or replace function app_public.group_session_detail(p_member_user_id uuid,p_session_id text)
returns jsonb language plpgsql stable security definer set search_path=app_public,pg_temp as $$
declare _uid uuid:=app_public.group_require_app_user(); _s record;
begin
  if not exists(select 1 from app_public.group_session_shares sh
    join app_public.sessions s on s.owner_user_id=sh.member_user_id and s.id=sh.session_id
      and s.deleted_at is null
    where sh.member_user_id=p_member_user_id and sh.session_id=p_session_id
      and app_public.group_active_role(sh.group_id,_uid) is not null) then
    raise exception 'NOT_FOUND: session not found' using errcode='P0001';
  end if;
  select x.gym_id,x.status,x.started_at,x.completed_at,x.duration_sec into _s
    from app_public.sessions x where x.owner_user_id=p_member_user_id and x.id=p_session_id;
  return jsonb_build_object('session',jsonb_build_object(
    'member',app_public.group_member_ref_json(p_member_user_id),'session_id',p_session_id,
    'gym_name',(select g.name from app_public.gyms g where g.owner_user_id=p_member_user_id
      and g.id=_s.gym_id and g.deleted_at is null),
    'status',_s.status,'started_at_ms',_s.started_at,'completed_at_ms',_s.completed_at,
    'duration_sec',_s.duration_sec,
    'exercises',app_public.group_session_exercises_json(p_member_user_id,p_session_id)));
end;
$$;

-- Group policy and rules have the same small vocabulary as the calculation
-- kernel. Private preferences and personal contributions never enter here.
create or replace function app_public.group_summary_json(p_group_id uuid,p_my_role text)
returns jsonb language sql stable security definer set search_path=app_public,pg_temp as $$
  select jsonb_build_object(
    'group_id',g.id,'name',g.name,'description',g.description,
    'member_count',(select count(*) from app_public.group_memberships m
      where m.group_id=g.id and m.ended_at is null),
    'my_role',p_my_role,
    'bodyweight_calculations_enabled',g.bodyweight_calculations_enabled)
  from app_public.groups g where g.id=p_group_id;
$$;

create or replace function app_public.group_exercise_rules_json(p_row app_public.group_exercises)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select jsonb_build_object(
    'name',p_row.name,
    'load_input_mode',p_row.load_input_mode,
    'bodyweight_calculations_enabled',g.bodyweight_calculations_enabled,
    'bodyweight_contribution',p_row.bodyweight_contribution,
    'default_metric',case when p_row.default_metric in ('weight','e1rm')
      then p_row.default_metric else 'e1rm' end,
    'rules_revision',p_row.rules_revision)
  from app_public.groups g where g.id=p_row.group_id;
$$;

create or replace function app_public.group_exercise_json_v2(p_row app_public.group_exercises)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select app_public.group_exercise_json(p_row)||app_public.group_exercise_rules_json(p_row)||
    jsonb_build_object('published_revision',p_row.published_rules_revision,
      'rebuilding',p_row.published_rules_revision is distinct from p_row.rules_revision,
      'legacy',exists(select 1 from app_public.group_rule_revisions r
        where r.group_exercise_id=p_row.id and r.revision=p_row.rules_revision and r.legacy));
$$;

create function app_public.group_exercise_validate_rules(
  p_enabled boolean,p_contribution double precision,p_default_metric text
)
returns jsonb language plpgsql immutable set search_path=app_public,pg_temp as $$
begin
  if p_enabled is null then
    raise exception 'VALIDATION: bodyweight calculations state is required' using errcode='P0001';
  end if;
  if p_contribution is null or not(p_contribution between 0 and 1) then
    raise exception 'VALIDATION: bodyweight contribution must be between 0 and 1' using errcode='P0001';
  end if;
  if p_default_metric is null or p_default_metric not in ('weight','e1rm') then
    raise exception 'VALIDATION: default metric must be Weight or 1RM' using errcode='P0001';
  end if;
  return jsonb_build_object('bodyweight_calculations_enabled',p_enabled,
    'bodyweight_contribution',p_contribution,'default_metric',p_default_metric);
end;
$$;

drop function app_public.group_exercise_validate_rules(double precision,text,text,text);
drop function app_public.group_exercise_create_v2(uuid,text,text,text,double precision,text,text,text);
drop function app_public.group_exercise_update_v2(uuid,uuid,bigint,text,text,double precision,text,text,text);

-- Freeze the current revision before a calculation-rule change. Original
-- conventional boards remain available as typed kg-only history.
create function app_public.group_retire_current_revision(p_exercise app_public.group_exercises)
returns void language sql volatile security definer set search_path=app_public,pg_temp as $$
  update app_public.group_rule_revisions r set
    retired_at=now(),
    legacy_entries=case when r.legacy then coalesce((
      select jsonb_agg(to_jsonb(e)||jsonb_build_object(
        'member',app_public.group_member_ref_json(e.member_user_id),
        'unit','kg','rules_revision',p_exercise.rules_revision)
        order by e.member_user_id,e.metric,e.certified)
      from app_public.group_board_entries e
      where e.group_exercise_id=p_exercise.id),'[]'::jsonb)
    else r.legacy_entries end
  where r.group_exercise_id=p_exercise.id and r.revision=p_exercise.rules_revision;
$$;
revoke all on function app_public.group_retire_current_revision(app_public.group_exercises)
  from public,anon,authenticated,service_role;

create function app_public.group_exercise_create_v2(
  p_group_id uuid,p_name text,p_load_input_mode text,p_source_exercise_id text,
  p_bodyweight_contribution double precision,p_default_metric text
)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare
  _uid uuid:=app_public.group_require_app_user();
  _role text:=app_public.group_exercise_require_manager(p_group_id,_uid);
  _name text:=app_public.group_exercise_validate_name(p_name);
  _mode text:=app_public.group_exercise_validate_load_input_mode(p_load_input_mode);
  _source text:=app_public.group_exercise_validate_source_id(p_source_exercise_id);
  _enabled boolean;
  _row app_public.group_exercises;
begin
  perform pg_advisory_xact_lock(25005,hashtext(p_group_id::text));
  select bodyweight_calculations_enabled into strict _enabled
    from app_public.groups where id=p_group_id;
  perform app_public.group_exercise_validate_rules(_enabled,p_bodyweight_contribution,p_default_metric);
  insert into app_public.group_exercises(group_id,name,load_input_mode,source_exercise_id,
    bodyweight_contribution,default_metric,created_by)
  values(p_group_id,_name,_mode,_source,p_bodyweight_contribution,p_default_metric,_uid)
  returning * into _row;
  insert into app_public.group_rule_revisions(group_id,group_exercise_id,revision,rules,
    reason,legacy,created_by,published_at)
  values(p_group_id,_row.id,1,app_public.group_exercise_rules_json(_row),'initial',false,_uid,now())
  on conflict(group_exercise_id,revision) do update
    set legacy=false,rules=excluded.rules,published_at=excluded.published_at;
  return jsonb_build_object('contract_version',3,'exercise',app_public.group_exercise_json_v2(_row));
end;
$$;

create function app_public.group_exercise_update_v2(
  p_group_id uuid,p_exercise_id uuid,p_expected_revision bigint,
  p_name text,p_load_input_mode text,p_bodyweight_contribution double precision,p_default_metric text
)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare
  _uid uuid:=app_public.group_require_app_user();
  _role text:=app_public.group_exercise_require_manager(p_group_id,_uid);
  _name text:=app_public.group_exercise_validate_name(p_name);
  _mode text:=app_public.group_exercise_validate_load_input_mode(p_load_input_mode);
  _enabled boolean;
  _old app_public.group_exercises;
  _row app_public.group_exercises;
  _rebuild boolean;
begin
  perform pg_advisory_xact_lock(25005,hashtext(p_group_id::text));
  select bodyweight_calculations_enabled into strict _enabled
    from app_public.groups where id=p_group_id for update;
  perform app_public.group_exercise_validate_rules(_enabled,p_bodyweight_contribution,p_default_metric);
  select * into _old from app_public.group_exercises
    where id=p_exercise_id and group_id=p_group_id for update;
  if not found then raise exception 'NOT_FOUND: group exercise not found' using errcode='P0001'; end if;
  if _old.archived_at is not null then
    raise exception 'VALIDATION: unarchive the group exercise before editing its rules' using errcode='P0001';
  end if;
  if p_expected_revision is distinct from _old.rules_revision then
    raise exception 'CONFLICT: group exercise rules changed; reload before saving' using errcode='P0001';
  end if;
  _rebuild:=row(_old.load_input_mode,_old.bodyweight_contribution)
    is distinct from row(_mode,p_bodyweight_contribution);
  if _rebuild then
    perform app_public.group_retire_current_revision(_old);
  end if;
  update app_public.group_exercises set name=_name,load_input_mode=_mode,
    bodyweight_contribution=p_bodyweight_contribution,default_metric=p_default_metric,
    rules_revision=_old.rules_revision+case when _rebuild then 1 else 0 end,
    published_rules_revision=case when _rebuild then null else _old.published_rules_revision end,
    updated_at=now() where id=_old.id returning * into _row;
  if _rebuild then
    insert into app_public.group_rule_revisions(group_id,group_exercise_id,revision,rules,
      reason,legacy,created_by)
    values(p_group_id,_row.id,_row.rules_revision,app_public.group_exercise_rules_json(_row),
      case when _old.bodyweight_contribution=0 and p_bodyweight_contribution>0
        then 'activation' else 'rules_change' end,false,_uid);
    perform app_public.group_metric_eval_enqueue(p_group_id,_row.id,'rules');
    perform app_public.group_eval_kick_once(_uid);
  else
    update app_public.group_rule_revisions set rules=app_public.group_exercise_rules_json(_row)
      where group_exercise_id=_row.id and revision=_row.rules_revision;
  end if;
  return jsonb_build_object('contract_version',3,'exercise',app_public.group_exercise_json_v2(_row));
end;
$$;

drop function app_public.group_update(uuid,text,text);
create function app_public.group_update(
  p_group_id uuid,p_name text,p_description text,p_bodyweight_calculations_enabled boolean
)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare
  _uid uuid:=app_public.group_require_app_user();
  _role text:=app_public.group_require_member(p_group_id,_uid,true);
  _name text;
  _description text;
  _prior boolean;
  _exercise app_public.group_exercises;
begin
  if _role not in ('owner','admin') then
    raise exception 'FORBIDDEN: only the owner or an admin can edit the group' using errcode='P0001';
  end if;
  if p_bodyweight_calculations_enabled is null then
    raise exception 'VALIDATION: bodyweight calculations state is required' using errcode='P0001';
  end if;
  _name:=app_public.group_validate_name(p_name);
  _description:=app_public.group_validate_description(p_description);
  perform pg_advisory_xact_lock(25005,hashtext(p_group_id::text));
  select bodyweight_calculations_enabled into strict _prior
    from app_public.groups where id=p_group_id for update;
  update app_public.groups set name=_name,description=_description,
    bodyweight_calculations_enabled=p_bodyweight_calculations_enabled,updated_at=now()
    where id=p_group_id;
  if _prior is distinct from p_bodyweight_calculations_enabled then
    for _exercise in select * from app_public.group_exercises
      where group_id=p_group_id and archived_at is null for update
    loop
      perform app_public.group_retire_current_revision(_exercise);
      update app_public.group_exercises set rules_revision=rules_revision+1,
        published_rules_revision=null,updated_at=now()
        where id=_exercise.id returning * into _exercise;
      insert into app_public.group_rule_revisions(group_id,group_exercise_id,revision,rules,
        reason,legacy,created_by)
      values(p_group_id,_exercise.id,_exercise.rules_revision,
        app_public.group_exercise_rules_json(_exercise),'rules_change',false,_uid);
      perform app_public.group_metric_eval_enqueue(p_group_id,_exercise.id,'rules');
    end loop;
    perform app_public.group_eval_kick_once(_uid);
  end if;
  return jsonb_build_object('group',app_public.group_summary_json(p_group_id,_role));
end;
$$;

revoke all on function app_public.group_exercise_validate_rules(boolean,double precision,text)
  from public,anon,authenticated,service_role;
revoke all on function app_public.group_metric_names()
  from public,anon,authenticated,service_role;
revoke all on function app_public.group_exercise_create_v2(uuid,text,text,text,double precision,text),
  app_public.group_exercise_update_v2(uuid,uuid,bigint,text,text,double precision,text),
  app_public.group_update(uuid,text,text,boolean) from public;
grant execute on function app_public.group_exercise_create_v2(uuid,text,text,text,double precision,text),
  app_public.group_exercise_update_v2(uuid,uuid,bigint,text,text,double precision,text),
  app_public.group_update(uuid,text,text,boolean) to anon,authenticated,service_role;

create or replace function app_public.group_eval_on_body_weight_reading()
returns trigger language plpgsql security definer set search_path=app_public,pg_temp as $$
declare
  owner_id uuid;
  from_at bigint;
  target record;
  queued boolean:=false;
  failure_code text;
begin
  owner_id:=case when tg_op='DELETE' then old.owner_user_id else new.owner_user_id end;
  from_at:=case when tg_op='INSERT' then new.measured_at when tg_op='DELETE' then old.measured_at
    else least(old.measured_at,new.measured_at) end;
  begin
    for target in
      select distinct ge.group_id,ge.id
      from app_public.sessions s
      join app_public.group_session_shares sh on sh.member_user_id=s.owner_user_id and sh.session_id=s.id
      join app_public.groups g on g.id=sh.group_id and g.deleted_at is null
        and g.bodyweight_calculations_enabled
      join app_public.group_exercises ge on ge.group_id=g.id and ge.archived_at is null
        and ge.bodyweight_contribution>0
      join app_public.exercise_group_links l on l.owner_user_id=s.owner_user_id and l.deleted_at is null
        and app_public.group_eval_try_uuid(l.group_id)=ge.group_id
        and app_public.group_eval_try_uuid(l.group_exercise_id)=ge.id
      join app_public.session_exercises se on se.owner_user_id=s.owner_user_id and se.session_id=s.id
        and se.exercise_definition_id=l.exercise_definition_id and se.deleted_at is null
      where s.owner_user_id=owner_id and s.started_at>=from_at
    loop
      queued:=app_public.group_metric_eval_enqueue(target.group_id,target.id,'set') or queued;
    end loop;
  exception when others then
    get stacked diagnostics failure_code=returned_sqlstate;
    perform app_public.group_eval_log_failure('group.eval_enqueue_failed',owner_id,
      jsonb_build_object('table','body_weight_measurements','sqlstate',failure_code));
  end;
  if queued then perform app_public.group_eval_kick_once(owner_id); end if;
  return null;
end;
$$;

do $migration$
declare
  definition text;
  revised text;
begin
  select pg_get_functiondef('app_public.sync_pull(jsonb)'::regprocedure) into definition;
  definition:=replace(definition,'perform app_public.require_dated_weight_protocol();',
    'perform app_public.require_sync_protocol();');
  definition:=replace(definition,$old$  -- New entity types must never reach a legacy reader or its existing cursor.
  if v_layer < 0 or v_layer > 4 or
     (v_layer = 4 and not coalesce(
       jsonb_typeof(payload->'capabilities') = 'array' and
       (payload->'capabilities') ? 'bodyweight_v1', false
     )) then$old$,$new$  if v_layer < 0 or v_layer > 4 then$new$);
  definition:=replace(definition,
    $$'exercise_group_links', 'body_weight_measurements'$$,
    $$'exercise_group_links', 'user_settings', 'body_weight_measurements'$$);
  definition:=replace(definition,
    $$when 0 then v_types := array['gyms', 'exercise_definitions', 'muscle_groups'];$$,
    $$when 0 then v_types := array['gyms', 'exercise_definitions', 'muscle_groups', 'user_settings'];$$);
  definition:=replace(definition,$old$             'bodyweight_coefficient', ed.bodyweight_coefficient,
             'movement_standard', ed.movement_standard,
             'loading_method', ed.loading_method,$old$,$new$             'bodyweight_contribution', ed.bodyweight_contribution,$new$);
  definition:=replace(definition,$old$             'performance_status', es.performance_status,
             'weight_unit', es.weight_unit,
             'external_load_mode', es.external_load_mode,
             'planned_weight_unit', es.planned_weight_unit,
             'planned_external_load_mode', es.planned_external_load_mode,$old$,$new$             'performance_status', es.performance_status,$new$);
  definition:=replace(definition,$old$             'weight_value', bw.weight_value,
             'weight_unit', bw.weight_unit,
             'weight_kg', bw.weight_kg,$old$,$new$             'weight_kg', bw.weight_kg,$new$);
  revised:=replace(definition,$anchor$    select 'body_weight_measurements'::text, bw.id, bw.client_updated_at_ms,$anchor$,$patch$    select 'user_settings'::text, us.id, us.client_updated_at_ms,
           us.server_received_at,us.owner_user_id,
           jsonb_build_object(
             'bodyweight_calculations_enabled',us.bodyweight_calculations_enabled,
             'created_at',us.created_at,'updated_at',us.updated_at,'deleted_at',us.deleted_at)
      from app_public.user_settings us
     where us.owner_user_id=auth.uid() and 'user_settings'=any(v_types)
    union all
    select 'body_weight_measurements'::text, bw.id, bw.client_updated_at_ms,$patch$);
  if revised=definition then raise exception 'bodyweight cutover failed to add settings pull'; end if;
  execute revised;
end
$migration$;

-- Current readers keep the established RPC names while publishing contract 3
-- and exposing only the normal Weight/1RM metric vocabulary.
do $migration$
declare definition text; revised text; signature text;
begin
  select pg_get_functiondef('app_public.group_metric_board(uuid,uuid,text,boolean,bigint,text,integer)'::regprocedure)
    into definition;
  revised:=replace(definition,
    $old$app_public.group_metric_names((_r.rules ->> 'bodyweight_coefficient')::double precision)$old$,
    $new$app_public.group_metric_names()$new$);
  if revised=definition then raise exception 'bodyweight cutover failed to update group board metric family'; end if;
  execute revised;

  select pg_get_functiondef('app_public.group_metric_history(uuid,uuid,text,boolean,bigint,text,integer)'::regprocedure)
    into definition;
  revised:=replace(definition,
    $old$app_public.group_metric_names((_r.rules ->> 'bodyweight_coefficient')::double precision)$old$,
    $new$app_public.group_metric_names()$new$);
  if revised=definition then raise exception 'bodyweight cutover failed to update group history metric family'; end if;
  execute revised;

  select pg_get_functiondef('app_public.group_metric_podiums(uuid,boolean)'::regprocedure)
    into definition;
  revised:=replace(definition,'_ge.default_metric',
    '(app_public.group_exercise_rules_json(_ge)->>''default_metric'')');
  if revised=definition then raise exception 'bodyweight cutover failed to update group podium default'; end if;
  execute revised;

  foreach signature in array array[
    'app_public.group_exercise_list_v2(uuid)',
    'app_public.group_exercise_archive_v2(uuid,uuid)',
    'app_public.group_exercise_unarchive_v2(uuid,uuid)',
    'app_public.group_metric_board(uuid,uuid,text,boolean,bigint,text,integer)',
    'app_public.group_metric_revisions(uuid,uuid)',
    'app_public.group_metric_history(uuid,uuid,text,boolean,bigint,text,integer)',
    'app_public.group_metric_podiums(uuid,boolean)',
    'app_public.group_metric_certify(uuid,uuid,uuid,text,text,bigint,text)',
    'app_public.group_metric_certification_end(uuid,uuid,text)',
    'app_public.group_metric_certification_get(uuid,uuid)',
    'app_public.group_stream_v2(uuid,jsonb,integer)'
  ] loop
    select pg_get_functiondef(signature::regprocedure) into definition;
    revised:=replace(replace(definition,'''contract_version'',2','''contract_version'',3'),
      '''contract_version'', 2','''contract_version'', 3');
    if revised=definition then
      raise exception 'bodyweight cutover failed to update contract version for %',signature;
    end if;
    execute revised;
  end loop;
end
$migration$;

-- Sanitize retained Weight/1RM certifications, then rebuild current metric
-- events and disposable projections from raw shared sets.
create function app_public.group_metric_clean_performance(p_performance jsonb)
returns jsonb language sql immutable set search_path=app_public,pg_temp as $$
  select case when jsonb_typeof(p_performance)='object' then jsonb_build_object(
    'session_id',p_performance->'session_id',
    'session_exercise_id',p_performance->'session_exercise_id',
    'exercise_definition_id',p_performance->'exercise_definition_id',
    'set_id',p_performance->'set_id',
    'weight_value',p_performance->'weight_value',
    'reps_value',p_performance->'reps_value',
    'reps',p_performance->'reps',
    'performance_status',p_performance->'performance_status',
    'source_load_input_mode',p_performance->'source_load_input_mode',
    'achieved_at_ms',p_performance->'achieved_at_ms',
    'exercise_order_index',p_performance->'exercise_order_index',
    'set_order_index',p_performance->'set_order_index') end;
$$;

revoke all on function app_public.group_metric_clean_performance(jsonb)
  from public,anon,authenticated,service_role;

update app_public.group_metric_certifications c set
  ended_at=coalesce(c.ended_at,greatest(now(),c.certified_at)),
  end_reason=coalesce(c.end_reason,'voided'),
  performance=app_public.group_metric_clean_performance(c.performance)
where exists(select 1 from app_public.group_rule_revisions r
  where r.group_exercise_id=c.group_exercise_id and not r.legacy);

delete from app_public.group_metric_certifications
where metric not in ('weight','e1rm');
delete from app_public.group_events
where contract_version=2 and group_exercise_id is not null;

delete from app_public.group_metric_board_entries;
delete from app_public.group_metric_board_state;
delete from app_public.group_metric_set_scores;

do $migration$
declare constraint_row record;
begin
  for constraint_row in
    select c.conrelid::regclass as relation_name,c.conname
    from pg_constraint c
    where c.contype='c'
      and c.conrelid in (
        'app_public.group_metric_set_scores'::regclass,
        'app_public.group_metric_certifications'::regclass,
        'app_public.group_metric_board_entries'::regclass)
      and (pg_get_constraintdef(c.oid) like '%metric = ANY%'
        or pg_get_constraintdef(c.oid) like '%unit = ANY%'
        or pg_get_constraintdef(c.oid) like '%trunc(%')
  loop
    execute format('alter table %s drop constraint %I',constraint_row.relation_name,constraint_row.conname);
  end loop;
end
$migration$;

alter table app_public.group_metric_set_scores
  add constraint group_metric_set_scores_current_metric check(metric in ('weight','e1rm')),
  add constraint group_metric_set_scores_current_unit check(unit='kg');
alter table app_public.group_metric_certifications
  add constraint group_metric_certifications_current_metric check(metric in ('weight','e1rm')),
  add constraint group_metric_certifications_current_unit check(unit='kg');
alter table app_public.group_metric_board_entries
  add constraint group_metric_board_entries_current_metric check(metric in ('weight','e1rm')),
  add constraint group_metric_board_entries_current_unit check(unit='kg');

update app_public.group_rule_revisions r set rules=jsonb_build_object(
  'name',coalesce(r.rules->>'name',ge.name),
  'load_input_mode',coalesce(r.rules->>'load_input_mode',ge.load_input_mode),
  'bodyweight_calculations_enabled',g.bodyweight_calculations_enabled,
  'bodyweight_contribution',coalesce(
    (r.rules->>'bodyweight_contribution')::double precision,
    (r.rules->>'bodyweight_coefficient')::double precision,
    ge.bodyweight_contribution),
  'default_metric',case when coalesce(r.rules->>'default_metric',ge.default_metric) in ('weight','e1rm')
    then coalesce(r.rules->>'default_metric',ge.default_metric) else 'e1rm' end,
  'rules_revision',r.revision)
from app_public.group_exercises ge join app_public.groups g on g.id=ge.group_id
where ge.id=r.group_exercise_id;

drop function app_public.group_metric_clean_performance(jsonb);

update app_public.group_exercises ge set published_rules_revision=null
where ge.archived_at is null and not app_public.group_metric_is_legacy(ge.id);
do $migration$
declare target record;
begin
  for target in select ge.group_id,ge.id from app_public.group_exercises ge
    where ge.archived_at is null and not app_public.group_metric_is_legacy(ge.id)
  loop
    perform app_public.group_metric_eval_enqueue(target.group_id,target.id,'rules');
  end loop;
end
$migration$;

-- Retained conventional group history is kg-only too. These legacy readers
-- keep their stable shape without retaining unit/mode columns in live tables.
drop trigger exercise_definitions_group_eval_enqueue on app_public.exercise_definitions;
create trigger exercise_definitions_group_eval_enqueue
  after update of load_input_mode on app_public.exercise_definitions
  for each row when(old.load_input_mode is distinct from new.load_input_mode)
  execute function app_public.group_eval_on_exercise_definition();

create or replace function app_public.group_legacy_set_fingerprint(p_set app_public.exercise_sets)
returns text language sql immutable set search_path=app_public,pg_temp as $$
  select app_public.group_set_fingerprint(
    p_set.weight_value,p_set.reps_value,p_set.performance_status,p_set.deleted_at);
$$;

create or replace function app_public.group_eval_session_rows(p_member_user_id uuid,p_session_id text)
returns jsonb language sql stable security definer set search_path=app_public,pg_temp as $$
  select jsonb_build_object(
    'session_id',p_session_id,'started_at_ms',s.started_at,
    'sets',case when s.id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'set_id',es.id,'session_exercise_id',se.id,
        'exercise_definition_id',se.exercise_definition_id,
        'exercise_order_index',se.order_index,'set_order_index',es.order_index,
        'weight_value',es.weight_value,'reps_value',es.reps_value,
        'performance_status',es.performance_status,
        'live',es.deleted_at is null and se.deleted_at is null and s.deleted_at is null,
        'fingerprint',app_public.group_legacy_set_fingerprint(es))
        order by se.order_index,se.id,es.order_index,es.id)
      from app_public.session_exercises se join app_public.exercise_sets es
        on es.owner_user_id=se.owner_user_id and es.session_exercise_id=se.id
      where se.owner_user_id=p_member_user_id and se.session_id=p_session_id),'[]'::jsonb) end)
  from(select 1) one left join app_public.sessions s
    on s.owner_user_id=p_member_user_id and s.id=p_session_id;
$$;

create or replace function app_public.group_certification_json(p_row app_public.group_certifications)
returns jsonb language sql stable set search_path=app_public,pg_temp as $$
  select jsonb_build_object(
    'certification_id',p_row.id,'group_id',p_row.group_id,
    'group_exercise_id',p_row.group_exercise_id,
    'member',app_public.group_member_ref_json(p_row.member_user_id),
    'set_id',p_row.set_id,'session_id',p_row.session_id,
    'certified_by',case when p_row.certified_by is null then null
      else app_public.group_member_ref_json(p_row.certified_by) end,
    'certified_at_ms',floor(extract(epoch from p_row.certified_at)*1000)::bigint,
    'pinned',jsonb_build_object(
      'weight_value',p_row.pinned_weight_value,'reps_value',p_row.pinned_reps_value,
      'performance_status',p_row.pinned_performance_status,'weight_kg',p_row.weight_kg,
      'reps',p_row.reps,'e1rm_kg',p_row.e1rm_kg),
    'ended_at_ms',case when p_row.ended_at is null then null
      else floor(extract(epoch from p_row.ended_at)*1000)::bigint end,
    'end_reason',p_row.end_reason,
    'ended_by',case when p_row.ended_by is null then null
      else app_public.group_member_ref_json(p_row.ended_by) end);
$$;

create or replace function app_public.group_certify(
  p_group_id uuid,p_group_exercise_id uuid,p_member_user_id uuid,p_set_id text
)
returns jsonb language plpgsql volatile security definer set search_path=app_public,pg_temp as $$
declare
  _uid uuid:=app_public.group_require_app_user();
  _ge app_public.group_exercises;
  _entry app_public.group_board_entries;
  _record app_public.group_events;
  _row app_public.group_certifications;
  _set app_public.exercise_sets;
  _fp text; _session text; _weight numeric; _reps numeric; _e1rm numeric;
begin
  perform app_public.group_require_member(p_group_id,_uid,true);
  if p_member_user_id is null or p_set_id is null or p_set_id='' then
    raise exception 'VALIDATION: p_member_user_id and p_set_id are required' using errcode='P0001';
  end if;
  if p_member_user_id=_uid then
    raise exception 'VALIDATION: you cannot certify your own set' using errcode='P0001';
  end if;
  _ge:=app_public.group_metric_require_legacy(p_group_id,p_group_exercise_id);
  if _ge.archived_at is not null then
    raise exception 'VALIDATION: an archived group exercise is read-only; unarchive it first' using errcode='P0001';
  end if;
  if app_public.group_active_role(p_group_id,p_member_user_id) is null then
    raise exception 'NOT_FOUND: member not found' using errcode='P0001';
  end if;
  select e.* into _entry from app_public.group_board_entries e
    where e.group_exercise_id=p_group_exercise_id and e.member_user_id=p_member_user_id
      and e.set_id=p_set_id and not e.certified order by e.metric limit 1;
  if found then
    _fp:=_entry.fingerprint; _session:=_entry.session_id; _weight:=_entry.weight_kg;
    _reps:=_entry.reps; _e1rm:=_entry.e1rm_kg;
  else
    select e.* into _record from app_public.group_events e
      where e.kind='record' and e.group_id=p_group_id and e.group_exercise_id=p_group_exercise_id
        and e.member_user_id=p_member_user_id and e.set_id=p_set_id
        and not exists(select 1 from app_public.group_events v
          where v.kind='record_voided' and v.related_event_id=e.id)
      order by e.seq desc limit 1;
    if not found then raise exception 'NOT_FOUND: record set not found' using errcode='P0001'; end if;
    _fp:=_record.payload->>'fingerprint'; _session:=_record.session_id;
    _weight:=(_record.payload->>'weight_kg')::numeric;
    _reps:=(_record.payload->>'reps')::numeric; _e1rm:=(_record.payload->>'e1rm_kg')::numeric;
  end if;
  select c.* into _row from app_public.group_certifications c
    where c.group_exercise_id=p_group_exercise_id and c.member_user_id=p_member_user_id
      and c.set_id=p_set_id and c.ended_at is null;
  if found then return jsonb_build_object('certification',app_public.group_certification_json(_row),'created',false); end if;
  select es.* into _set from app_public.exercise_sets es
    where es.owner_user_id=p_member_user_id and es.id=p_set_id;
  if not found or _fp is null or app_public.group_legacy_set_fingerprint(_set)<>_fp then
    raise exception 'CONFLICT: the set changed; refresh and try again' using errcode='P0001';
  end if;
  insert into app_public.group_certifications(
    group_id,group_exercise_id,member_user_id,set_id,session_id,certified_by,pinned_fingerprint,
    pinned_weight_value,pinned_reps_value,pinned_performance_status,weight_kg,reps,e1rm_kg)
  values(p_group_id,p_group_exercise_id,p_member_user_id,p_set_id,_session,_uid,_fp,
    _set.weight_value,_set.reps_value,_set.performance_status,_weight,_reps,_e1rm)
  returning * into _row;
  perform app_public.group_certification_enqueue(_row);
  return jsonb_build_object('certification',app_public.group_certification_json(_row),'created',true);
end;
$$;

alter table app_public.group_metric_set_scores
  drop column effective_resistance_kg,
  drop column external_adjustment_kg,
  drop column added_percent_bodyweight;
alter table app_public.group_metric_board_entries
  drop column effective_resistance_kg,
  drop column external_adjustment_kg,
  drop column added_percent_bodyweight;
alter table app_public.group_certifications
  drop column pinned_weight_unit,
  drop column pinned_external_load_mode;

drop function app_public.group_metric_names(double precision);

alter table app_public.exercise_definitions
  drop column bodyweight_coefficient,
  drop column movement_standard,
  drop column loading_method;
alter table app_public.exercise_sets
  drop column weight_unit,
  drop column external_load_mode,
  drop column planned_weight_unit,
  drop column planned_external_load_mode;
alter table app_public.body_weight_measurements
  drop column weight_value,
  drop column weight_unit;
alter table app_public.group_exercises
  drop column bodyweight_coefficient,
  drop column movement_standard,
  drop column loading_method;

drop function app_public.require_dated_weight_protocol();

notify pgrst,'reload schema';
