-- Migration: 20261024140000_agent_plan_programme_mutation_rpcs.sql
-- Service-role-only atomic RPCs for connected coaching agent plan and programme mutations.

-- -----------------------------------------------------------------------------
-- 1. Receipt claim and store helpers for plan operations
-- -----------------------------------------------------------------------------

create or replace function app_public.agent_plan_claim_receipt(
  p_owner uuid,
  p_client_id text,
  p_operation text,
  p_idempotency_key text,
  p_payload_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _existing_hash text;
  _existing      jsonb;
begin
  perform set_config('request.jwt.claim.sub', p_owner::text, true);

  if p_idempotency_key is null
     or length(btrim(p_idempotency_key)) < 1
     or length(p_idempotency_key) > 128 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
  end if;

  insert into public.agent_plan_write_receipts (
    owner_user_id, client_id, operation, idempotency_key, payload_sha256, result_ids
  ) values (
    p_owner, p_client_id, p_operation, p_idempotency_key, p_payload_sha256, '{}'::jsonb
  )
  on conflict (owner_user_id, client_id, operation, idempotency_key) do nothing;

  if found then
    return null;
  end if;

  select r.payload_sha256, r.result_ids
    into _existing_hash, _existing
    from public.agent_plan_write_receipts r
   where r.owner_user_id = p_owner
     and r.client_id = p_client_id
     and r.operation = p_operation
     and r.idempotency_key = p_idempotency_key;

  if _existing_hash is distinct from p_payload_sha256 then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
  end if;

  return _existing || jsonb_build_object('idempotent_replay', true);
end;
$func$;

create or replace function app_public.agent_plan_store_receipt(
  p_owner uuid,
  p_client_id text,
  p_operation text,
  p_idempotency_key text,
  p_result jsonb
)
returns void
language sql
security definer
set search_path = ''
as $func$
  update public.agent_plan_write_receipts
     set result_ids = p_result
   where owner_user_id = p_owner
     and client_id = p_client_id
     and operation = p_operation
     and idempotency_key = p_idempotency_key;
$func$;

-- -----------------------------------------------------------------------------
-- 2. Graph version calculation and optimistic concurrency checks
-- -----------------------------------------------------------------------------

create or replace function app_public.agent_plan_graph_version(p_owner uuid, p_plan_id text)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $func$
  select max(server_received_at)
    from (
      select sp.server_received_at
        from app_public.session_plans sp
       where sp.owner_user_id = p_owner
         and sp.id = p_plan_id
      union all
      select spe.server_received_at
        from app_public.session_plan_exercises spe
       where spe.owner_user_id = p_owner
         and spe.session_plan_id = p_plan_id
      union all
      select sps.server_received_at
        from app_public.session_plan_sets sps
        join app_public.session_plan_exercises spe
          on spe.id = sps.session_plan_exercise_id
         and spe.owner_user_id = p_owner
       where sps.owner_user_id = p_owner
         and spe.session_plan_id = p_plan_id
    ) versions;
$func$;

create or replace function app_public.agent_programme_graph_version(p_owner uuid, p_programme_id text)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $func$
  select max(server_received_at)
    from (
      select tp.server_received_at
        from app_public.training_programmes tp
       where tp.owner_user_id = p_owner
         and tp.id = p_programme_id
      union all
      select sp.server_received_at
        from app_public.session_plans sp
       where sp.owner_user_id = p_owner
         and sp.programme_id = p_programme_id
      union all
      select spe.server_received_at
        from app_public.session_plan_exercises spe
        join app_public.session_plans sp
          on sp.id = spe.session_plan_id
         and sp.owner_user_id = p_owner
       where spe.owner_user_id = p_owner
         and sp.programme_id = p_programme_id
      union all
      select sps.server_received_at
        from app_public.session_plan_sets sps
        join app_public.session_plan_exercises spe
          on spe.id = sps.session_plan_exercise_id
         and spe.owner_user_id = p_owner
        join app_public.session_plans sp
          on sp.id = spe.session_plan_id
         and sp.owner_user_id = p_owner
       where sps.owner_user_id = p_owner
         and sp.programme_id = p_programme_id
    ) versions;
$func$;

create or replace function app_public.agent_check_plan_version(p_owner uuid, p_plan_id text, p_base_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _live_tstz     timestamptz;
  _base_tstz     timestamptz;
  _is_deleted    boolean;
  _programme_id  text;
begin
  if p_base_version is null or length(btrim(p_base_version)) = 0 then
    raise exception 'PLAN_CONCURRENT_MODIFICATION' using errcode = 'P0001';
  end if;

  -- Finding 3: lock parent programme first if present to preserve consistent hierarchy order
  select sp.programme_id
    into _programme_id
    from app_public.session_plans sp
   where sp.owner_user_id = p_owner and sp.id = p_plan_id;

  if _programme_id is not null then
    perform 1
      from app_public.training_programmes tp
     where tp.owner_user_id = p_owner and tp.id = _programme_id
       for update;
  end if;

  -- Lock target plan row for update
  select (sp.deleted_at is not null)
    into _is_deleted
    from app_public.session_plans sp
   where sp.owner_user_id = p_owner and sp.id = p_plan_id
     for update;

  if _is_deleted is null or _is_deleted = true then
    raise exception 'PLAN_CONCURRENT_MODIFICATION' using errcode = 'P0001';
  end if;

  begin
    _base_tstz := p_base_version::timestamptz;
  exception when others then
    raise exception 'PLAN_CONCURRENT_MODIFICATION' using errcode = 'P0001';
  end;

  _live_tstz := app_public.agent_plan_graph_version(p_owner, p_plan_id);
  if _live_tstz is null or _live_tstz is distinct from _base_tstz then
    raise exception 'PLAN_CONCURRENT_MODIFICATION' using errcode = 'P0001';
  end if;
end;
$func$;

create or replace function app_public.agent_check_programme_version(p_owner uuid, p_programme_id text, p_base_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _live_tstz  timestamptz;
  _base_tstz  timestamptz;
  _is_deleted boolean;
begin
  if p_base_version is null or length(btrim(p_base_version)) = 0 then
    raise exception 'PLAN_CONCURRENT_MODIFICATION' using errcode = 'P0001';
  end if;

  -- Finding 3: lock programme row for update
  select (tp.deleted_at is not null)
    into _is_deleted
    from app_public.training_programmes tp
   where tp.owner_user_id = p_owner and tp.id = p_programme_id
     for update;

  if _is_deleted is null or _is_deleted = true then
    raise exception 'PLAN_CONCURRENT_MODIFICATION' using errcode = 'P0001';
  end if;

  -- Lock child plans in consistent id order
  perform 1
    from app_public.session_plans sp
   where sp.owner_user_id = p_owner and sp.programme_id = p_programme_id
   order by sp.id
     for update;

  begin
    _base_tstz := p_base_version::timestamptz;
  exception when others then
    raise exception 'PLAN_CONCURRENT_MODIFICATION' using errcode = 'P0001';
  end;

  _live_tstz := app_public.agent_programme_graph_version(p_owner, p_programme_id);
  if _live_tstz is null or _live_tstz is distinct from _base_tstz then
    raise exception 'PLAN_CONCURRENT_MODIFICATION' using errcode = 'P0001';
  end if;
end;
$func$;

-- -----------------------------------------------------------------------------
-- 3. Block immutability check
-- -----------------------------------------------------------------------------

create or replace function app_public.agent_block_is_immutable(p_owner uuid, p_exercise_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $func$
  select exists (
    select 1
      from app_public.session_plan_exercises spe
     where spe.owner_user_id = p_owner
       and spe.id = p_exercise_id
       and (
         spe.progress_status is distinct from 'pending'
         or exists (
           select 1
             from app_public.session_exercises sx
             join app_public.sessions s
               on s.id = sx.session_id
              and s.owner_user_id = p_owner
              and s.deleted_at is null
            where sx.owner_user_id = p_owner
              and sx.source_plan_exercise_id = spe.id
              and sx.deleted_at is null
         )
       )
  );
$func$;

-- -----------------------------------------------------------------------------
-- 4. RPC: agent_update_plan_meta
-- -----------------------------------------------------------------------------

create or replace function app_public.agent_update_plan_meta(
  p_owner uuid,
  p_client_id text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_plan_id text,
  p_base_version text,
  p_patch jsonb,
  p_now_ms bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _operation   text := 'update_plan_meta';
  _now_ms      bigint;
  _replay      jsonb;
  _title       text;
  _gym_id      text;
  _scheduled   bigint;
  _new_version text;
  _result      jsonb;
begin
  _replay := app_public.agent_plan_claim_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256
  );
  if _replay is not null then
    return _replay;
  end if;

  perform app_public.agent_check_plan_version(p_owner, p_plan_id, p_base_version);

  if p_patch ? 'title' then
    _title := btrim(p_patch ->> 'title');
    if length(_title) < 1 or length(_title) > 100 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
    end if;
  end if;

  if p_patch ? 'gym_id' then
    _gym_id := nullif(btrim(p_patch ->> 'gym_id'), '');
    if _gym_id is not null and not exists (
      select 1 from app_public.gyms g
       where g.owner_user_id = p_owner and g.id = _gym_id and g.deleted_at is null
    ) then
      raise exception 'FOREIGN_RESOURCE_REFERENCE' using errcode = 'P0001';
    end if;
  end if;

  if p_patch ? 'scheduled_for' then
    _scheduled := nullif(btrim(p_patch ->> 'scheduled_for'), '')::bigint;
  end if;

  _now_ms := coalesce(p_now_ms, (extract(epoch from clock_timestamp()) * 1000)::bigint);

  update app_public.session_plans sp
     set title = case when p_patch ? 'title' then _title else sp.title end,
         gym_id = case when p_patch ? 'gym_id' then _gym_id else sp.gym_id end,
         scheduled_for = case when p_patch ? 'scheduled_for' then _scheduled else sp.scheduled_for end,
         updated_at = greatest(sp.updated_at + 1, _now_ms),
         client_updated_at_ms = greatest(sp.client_updated_at_ms + 1, _now_ms),
         last_modified_by = 'agent'
   where sp.owner_user_id = p_owner and sp.id = p_plan_id;

  _new_version := to_char(app_public.agent_plan_graph_version(p_owner, p_plan_id) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  _result := jsonb_build_object(
    'plan_id', p_plan_id,
    'version', _new_version,
    'idempotent_replay', false
  );

  perform app_public.agent_plan_store_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, _result
  );
  return _result;
end;
$func$;

-- -----------------------------------------------------------------------------
-- 5. RPC: agent_update_programme_meta
-- -----------------------------------------------------------------------------

create or replace function app_public.agent_update_programme_meta(
  p_owner uuid,
  p_client_id text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_programme_id text,
  p_base_version text,
  p_patch jsonb,
  p_now_ms bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _operation   text := 'update_programme_meta';
  _now_ms      bigint;
  _replay      jsonb;
  _name        text;
  _description text;
  _new_version text;
  _result      jsonb;
begin
  _replay := app_public.agent_plan_claim_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256
  );
  if _replay is not null then
    return _replay;
  end if;

  perform app_public.agent_check_programme_version(p_owner, p_programme_id, p_base_version);

  if p_patch ? 'name' then
    _name := btrim(p_patch ->> 'name');
    if length(_name) < 1 or length(_name) > 100 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
    end if;
  end if;

  if p_patch ? 'description' then
    _description := p_patch ->> 'description';
    if _description is not null and length(_description) > 500 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
    end if;
  end if;

  _now_ms := coalesce(p_now_ms, (extract(epoch from clock_timestamp()) * 1000)::bigint);

  update app_public.training_programmes tp
     set name = case when p_patch ? 'name' then _name else tp.name end,
         description = case when p_patch ? 'description' then _description else tp.description end,
         updated_at = greatest(tp.updated_at + 1, _now_ms),
         client_updated_at_ms = greatest(tp.client_updated_at_ms + 1, _now_ms),
         last_modified_by = 'agent'
   where tp.owner_user_id = p_owner and tp.id = p_programme_id;

  _new_version := to_char(app_public.agent_programme_graph_version(p_owner, p_programme_id) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  _result := jsonb_build_object(
    'programme_id', p_programme_id,
    'version', _new_version,
    'idempotent_replay', false
  );

  perform app_public.agent_plan_store_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, _result
  );
  return _result;
end;
$func$;

-- -----------------------------------------------------------------------------
-- 6. RPC: agent_insert_plan_block
-- -----------------------------------------------------------------------------

create or replace function app_public.agent_insert_plan_block(
  p_owner uuid,
  p_client_id text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_plan_id text,
  p_base_version text,
  p_block jsonb,
  p_now_ms bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _operation     text := 'insert_plan_block';
  _now_ms        bigint;
  _replay        jsonb;
  _block_count   integer;
  _next_order    integer;
  _ex_def_id     text;
  _name          text;
  _set_count     integer;
  _exercise_id   text;
  _set_ids       jsonb := '[]'::jsonb;
  _set           jsonb;
  _set_id        text;
  _set_idx       integer := 0;
  _reps          integer;
  _new_version   text;
  _result        jsonb;
begin
  _replay := app_public.agent_plan_claim_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256
  );
  if _replay is not null then
    return _replay;
  end if;

  perform app_public.agent_check_plan_version(p_owner, p_plan_id, p_base_version);

  select count(*)
    into _block_count
    from app_public.session_plan_exercises spe
   where spe.owner_user_id = p_owner and spe.session_plan_id = p_plan_id and spe.deleted_at is null;

  if _block_count >= 30 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
  end if;

  if p_block -> 'sets' is null or jsonb_typeof(p_block -> 'sets') != 'array' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
  end if;

  _set_count := jsonb_array_length(p_block -> 'sets');
  if _set_count < 1 or _set_count > 30 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
  end if;

  _ex_def_id := nullif(btrim(p_block ->> 'exercise_definition_id'), '');
  if _ex_def_id is not null then
    select ed.name into _name
      from app_public.exercise_definitions ed
     where ed.owner_user_id = p_owner and ed.id = _ex_def_id and ed.deleted_at is null;
    if not found then
      raise exception 'FOREIGN_RESOURCE_REFERENCE' using errcode = 'P0001';
    end if;
  end if;

  if p_block ? 'name' and length(btrim(p_block ->> 'name')) > 0 then
    _name := btrim(p_block ->> 'name');
  end if;

  if _name is null or length(_name) < 1 or length(_name) > 100 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
  end if;

  _now_ms := coalesce(p_now_ms, (extract(epoch from clock_timestamp()) * 1000)::bigint);
  _next_order := coalesce((
    select max(order_index) + 1
      from app_public.session_plan_exercises
     where owner_user_id = p_owner and session_plan_id = p_plan_id and deleted_at is null
  ), 0);

  _exercise_id := gen_random_uuid()::text;

  insert into app_public.session_plan_exercises (
    owner_user_id, id, session_plan_id, exercise_definition_id, order_index, name,
    progress_status, resolved_at, last_modified_by,
    created_at, updated_at, deleted_at, client_updated_at_ms, server_received_at
  ) values (
    p_owner, _exercise_id, p_plan_id, _ex_def_id, _next_order, _name,
    'pending', null, 'agent',
    _now_ms, _now_ms, null, _now_ms, timezone('utc', now())
  );

  for _set in select value from jsonb_array_elements(p_block -> 'sets') loop
    _reps := (_set ->> 'target_reps')::integer;
    if _reps is null or _reps < 1 or _reps > 999 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
    end if;

    _set_id := coalesce(nullif(btrim(_set ->> 'id'), ''), gen_random_uuid()::text);
    insert into app_public.session_plan_sets (
      owner_user_id, id, session_plan_exercise_id, order_index,
      target_weight_value, target_reps, target_set_type, last_modified_by,
      created_at, updated_at, deleted_at, client_updated_at_ms, server_received_at
    ) values (
      p_owner, _set_id, _exercise_id, _set_idx,
      nullif(btrim(_set ->> 'target_weight_value'), ''),
      _reps,
      nullif(btrim(_set ->> 'target_set_type'), ''),
      'agent',
      _now_ms, _now_ms, null, _now_ms, timezone('utc', now())
    );
    _set_ids := _set_ids || to_jsonb(_set_id);
    _set_idx := _set_idx + 1;
  end loop;

  update app_public.session_plans sp
     set updated_at = greatest(sp.updated_at + 1, _now_ms),
         client_updated_at_ms = greatest(sp.client_updated_at_ms + 1, _now_ms),
         last_modified_by = 'agent'
   where sp.owner_user_id = p_owner and sp.id = p_plan_id;

  _new_version := to_char(app_public.agent_plan_graph_version(p_owner, p_plan_id) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  _result := jsonb_build_object(
    'plan_id', p_plan_id,
    'exercise_id', _exercise_id,
    'set_ids', _set_ids,
    'version', _new_version,
    'idempotent_replay', false
  );

  perform app_public.agent_plan_store_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, _result
  );
  return _result;
end;
$func$;

-- -----------------------------------------------------------------------------
-- 7. RPC: agent_update_plan_block
-- -----------------------------------------------------------------------------

create or replace function app_public.agent_update_plan_block(
  p_owner uuid,
  p_client_id text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_plan_id text,
  p_exercise_id text,
  p_base_version text,
  p_block jsonb,
  p_now_ms bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _operation   text := 'update_plan_block';
  _now_ms      bigint;
  _replay      jsonb;
  _block_row   app_public.session_plan_exercises;
  _ex_def_id   text;
  _name        text;
  _set_count   integer;
  _set         jsonb;
  _set_id      text;
  _set_idx     integer := 0;
  _reps        integer;
  _new_version text;
  _result      jsonb;
begin
  _replay := app_public.agent_plan_claim_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256
  );
  if _replay is not null then
    return _replay;
  end if;

  perform app_public.agent_check_plan_version(p_owner, p_plan_id, p_base_version);

  select *
    into _block_row
    from app_public.session_plan_exercises spe
   where spe.owner_user_id = p_owner
     and spe.id = p_exercise_id
     and spe.session_plan_id = p_plan_id
     and spe.deleted_at is null;

  if not found then
    raise exception 'FOREIGN_RESOURCE_REFERENCE' using errcode = 'P0001';
  end if;

  if app_public.agent_block_is_immutable(p_owner, p_exercise_id) then
    raise exception 'IMMUTABLE_BLOCK_MUTATION' using errcode = 'P0001';
  end if;

  if p_block ? 'sets' then
    if jsonb_typeof(p_block -> 'sets') != 'array' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
    end if;
    _set_count := jsonb_array_length(p_block -> 'sets');
    if _set_count < 1 or _set_count > 30 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
    end if;
  end if;

  if p_block ? 'exercise_definition_id' then
    _ex_def_id := nullif(btrim(p_block ->> 'exercise_definition_id'), '');
    if _ex_def_id is not null and not exists (
      select 1 from app_public.exercise_definitions ed
       where ed.owner_user_id = p_owner and ed.id = _ex_def_id and ed.deleted_at is null
    ) then
      raise exception 'FOREIGN_RESOURCE_REFERENCE' using errcode = 'P0001';
    end if;
  else
    _ex_def_id := _block_row.exercise_definition_id;
  end if;

  if p_block ? 'name' then
    _name := btrim(p_block ->> 'name');
    if length(_name) < 1 or length(_name) > 100 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
    end if;
  else
    _name := _block_row.name;
  end if;

  _now_ms := coalesce(p_now_ms, (extract(epoch from clock_timestamp()) * 1000)::bigint);

  update app_public.session_plan_exercises spe
     set name = _name,
         exercise_definition_id = _ex_def_id,
         updated_at = greatest(spe.updated_at + 1, _now_ms),
         client_updated_at_ms = greatest(spe.client_updated_at_ms + 1, _now_ms),
         last_modified_by = 'agent'
   where spe.owner_user_id = p_owner and spe.id = p_exercise_id;

  if p_block ? 'sets' then
    -- Finding 2: park tombstoned omitted sets at distinct slots >= 2000000
    with dead_sets as (
      select id, row_number() over (order by order_index, id) as seq
        from app_public.session_plan_sets
       where owner_user_id = p_owner
         and session_plan_exercise_id = p_exercise_id
         and deleted_at is null
         and id not in (
           select value ->> 'id'
             from jsonb_array_elements(p_block -> 'sets')
            where value ->> 'id' is not null
         )
    ),
    base_order as (
      select greatest(2000000, coalesce(max(order_index), 0) + 1) as start_idx
        from app_public.session_plan_sets
       where owner_user_id = p_owner
         and session_plan_exercise_id = p_exercise_id
    )
    update app_public.session_plan_sets sps
       set deleted_at = greatest(sps.client_updated_at_ms + 1, _now_ms),
           order_index = b.start_idx + d.seq - 1,
           updated_at = greatest(sps.updated_at + 1, _now_ms),
           client_updated_at_ms = greatest(sps.client_updated_at_ms + 1, _now_ms),
           last_modified_by = 'agent'
      from dead_sets d, base_order b
     where sps.owner_user_id = p_owner
       and sps.session_plan_exercise_id = p_exercise_id
       and sps.id = d.id;

    for _set in select value from jsonb_array_elements(p_block -> 'sets') loop
      _reps := (_set ->> 'target_reps')::integer;
      if _reps is null or _reps < 1 or _reps > 999 then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
      end if;

      _set_id := nullif(btrim(_set ->> 'id'), '');
      if _set_id is not null and exists (
        select 1 from app_public.session_plan_sets
         where owner_user_id = p_owner and session_plan_exercise_id = p_exercise_id and id = _set_id
      ) then
        update app_public.session_plan_sets sps
           set order_index = _set_idx,
               target_weight_value = nullif(btrim(_set ->> 'target_weight_value'), ''),
               target_reps = _reps,
               target_set_type = nullif(btrim(_set ->> 'target_set_type'), ''),
               deleted_at = null,
               updated_at = greatest(sps.updated_at + 1, _now_ms),
               client_updated_at_ms = greatest(sps.client_updated_at_ms + 1, _now_ms),
               last_modified_by = 'agent'
         where sps.owner_user_id = p_owner and sps.id = _set_id;
      else
        _set_id := coalesce(_set_id, gen_random_uuid()::text);
        insert into app_public.session_plan_sets (
          owner_user_id, id, session_plan_exercise_id, order_index,
          target_weight_value, target_reps, target_set_type, last_modified_by,
          created_at, updated_at, deleted_at, client_updated_at_ms, server_received_at
        ) values (
          p_owner, _set_id, p_exercise_id, _set_idx,
          nullif(btrim(_set ->> 'target_weight_value'), ''),
          _reps,
          nullif(btrim(_set ->> 'target_set_type'), ''),
          'agent',
          _now_ms, _now_ms, null, _now_ms, timezone('utc', now())
        );
      end if;
      _set_idx := _set_idx + 1;
    end loop;
  end if;

  update app_public.session_plans sp
     set updated_at = greatest(sp.updated_at + 1, _now_ms),
         client_updated_at_ms = greatest(sp.client_updated_at_ms + 1, _now_ms),
         last_modified_by = 'agent'
   where sp.owner_user_id = p_owner and sp.id = p_plan_id;

  _new_version := to_char(app_public.agent_plan_graph_version(p_owner, p_plan_id) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  _result := jsonb_build_object(
    'plan_id', p_plan_id,
    'exercise_id', p_exercise_id,
    'version', _new_version,
    'idempotent_replay', false
  );

  perform app_public.agent_plan_store_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, _result
  );
  return _result;
end;
$func$;

-- -----------------------------------------------------------------------------
-- 8. RPC: agent_reorder_plan_blocks
-- -----------------------------------------------------------------------------

create or replace function app_public.agent_reorder_plan_blocks(
  p_owner uuid,
  p_client_id text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_plan_id text,
  p_base_version text,
  p_exercise_ids jsonb,
  p_now_ms bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _operation   text := 'reorder_plan_blocks';
  _now_ms      bigint;
  _replay      jsonb;
  _live_ids    text[];
  _req_ids     text[];
  _new_version text;
  _result      jsonb;
begin
  _replay := app_public.agent_plan_claim_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256
  );
  if _replay is not null then
    return _replay;
  end if;

  perform app_public.agent_check_plan_version(p_owner, p_plan_id, p_base_version);

  -- Finding 4: reject reorder if any block in the plan is consumed/immutable
  if exists (
    select 1
      from app_public.session_plan_exercises spe
     where spe.owner_user_id = p_owner
       and spe.session_plan_id = p_plan_id
       and spe.deleted_at is null
       and app_public.agent_block_is_immutable(p_owner, spe.id)
  ) then
    raise exception 'IMMUTABLE_BLOCK_MUTATION' using errcode = 'P0001';
  end if;

  if p_exercise_ids is null or jsonb_typeof(p_exercise_ids) != 'array' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
  end if;

  select array_agg(id order by id)
    into _live_ids
    from app_public.session_plan_exercises
   where owner_user_id = p_owner and session_plan_id = p_plan_id and deleted_at is null;

  select array_agg(value order by value)
    into _req_ids
    from jsonb_array_elements_text(p_exercise_ids);

  if _live_ids is distinct from _req_ids then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
  end if;

  _now_ms := coalesce(p_now_ms, (extract(epoch from clock_timestamp()) * 1000)::bigint);

  update app_public.session_plan_exercises spe
     set order_index = ord.idx,
         updated_at = greatest(spe.updated_at + 1, _now_ms),
         client_updated_at_ms = greatest(spe.client_updated_at_ms + 1, _now_ms),
         last_modified_by = 'agent'
    from (
      select value as id, (ordinality - 1)::integer as idx
        from jsonb_array_elements_text(p_exercise_ids) with ordinality
    ) ord
   where spe.owner_user_id = p_owner
     and spe.session_plan_id = p_plan_id
     and spe.id = ord.id
     and spe.order_index is distinct from ord.idx;

  update app_public.session_plans sp
     set updated_at = greatest(sp.updated_at + 1, _now_ms),
         client_updated_at_ms = greatest(sp.client_updated_at_ms + 1, _now_ms),
         last_modified_by = 'agent'
   where sp.owner_user_id = p_owner and sp.id = p_plan_id;

  _new_version := to_char(app_public.agent_plan_graph_version(p_owner, p_plan_id) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  _result := jsonb_build_object(
    'plan_id', p_plan_id,
    'version', _new_version,
    'idempotent_replay', false
  );

  perform app_public.agent_plan_store_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, _result
  );
  return _result;
end;
$func$;

-- -----------------------------------------------------------------------------
-- 9. RPC: agent_reorder_programme_plans
-- -----------------------------------------------------------------------------

create or replace function app_public.agent_reorder_programme_plans(
  p_owner uuid,
  p_client_id text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_programme_id text,
  p_base_version text,
  p_plan_ids jsonb,
  p_now_ms bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _operation   text := 'reorder_programme_plans';
  _now_ms      bigint;
  _replay      jsonb;
  _live_ids    text[];
  _req_ids     text[];
  _new_version text;
  _result      jsonb;
begin
  _replay := app_public.agent_plan_claim_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256
  );
  if _replay is not null then
    return _replay;
  end if;

  perform app_public.agent_check_programme_version(p_owner, p_programme_id, p_base_version);

  if p_plan_ids is null or jsonb_typeof(p_plan_ids) != 'array' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
  end if;

  select array_agg(id order by id)
    into _live_ids
    from app_public.session_plans
   where owner_user_id = p_owner and programme_id = p_programme_id and deleted_at is null;

  select array_agg(value order by value)
    into _req_ids
    from jsonb_array_elements_text(p_plan_ids);

  if _live_ids is distinct from _req_ids then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
  end if;

  _now_ms := coalesce(p_now_ms, (extract(epoch from clock_timestamp()) * 1000)::bigint);

  update app_public.session_plans sp
     set programme_order_index = ord.idx,
         updated_at = greatest(sp.updated_at + 1, _now_ms),
         client_updated_at_ms = greatest(sp.client_updated_at_ms + 1, _now_ms),
         last_modified_by = 'agent'
    from (
      select value as id, (ordinality - 1)::integer as idx
        from jsonb_array_elements_text(p_plan_ids) with ordinality
    ) ord
   where sp.owner_user_id = p_owner
     and sp.programme_id = p_programme_id
     and sp.id = ord.id
     and sp.programme_order_index is distinct from ord.idx;

  update app_public.training_programmes tp
     set updated_at = greatest(tp.updated_at + 1, _now_ms),
         client_updated_at_ms = greatest(tp.client_updated_at_ms + 1, _now_ms),
         last_modified_by = 'agent'
   where tp.owner_user_id = p_owner and tp.id = p_programme_id;

  _new_version := to_char(app_public.agent_programme_graph_version(p_owner, p_programme_id) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  _result := jsonb_build_object(
    'programme_id', p_programme_id,
    'version', _new_version,
    'idempotent_replay', false
  );

  perform app_public.agent_plan_store_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, _result
  );
  return _result;
end;
$func$;

-- -----------------------------------------------------------------------------
-- 10. RPC: agent_reorder_block_sets
-- -----------------------------------------------------------------------------

create or replace function app_public.agent_reorder_block_sets(
  p_owner uuid,
  p_client_id text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_plan_id text,
  p_exercise_id text,
  p_base_version text,
  p_set_ids jsonb,
  p_now_ms bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _operation   text := 'reorder_block_sets';
  _now_ms      bigint;
  _replay      jsonb;
  _live_ids    text[];
  _req_ids     text[];
  _new_version text;
  _result      jsonb;
begin
  _replay := app_public.agent_plan_claim_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256
  );
  if _replay is not null then
    return _replay;
  end if;

  perform app_public.agent_check_plan_version(p_owner, p_plan_id, p_base_version);

  if not exists (
    select 1 from app_public.session_plan_exercises
     where owner_user_id = p_owner and id = p_exercise_id and session_plan_id = p_plan_id and deleted_at is null
  ) then
    raise exception 'FOREIGN_RESOURCE_REFERENCE' using errcode = 'P0001';
  end if;

  if app_public.agent_block_is_immutable(p_owner, p_exercise_id) then
    raise exception 'IMMUTABLE_BLOCK_MUTATION' using errcode = 'P0001';
  end if;

  if p_set_ids is null or jsonb_typeof(p_set_ids) != 'array' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
  end if;

  select array_agg(id order by id)
    into _live_ids
    from app_public.session_plan_sets
   where owner_user_id = p_owner and session_plan_exercise_id = p_exercise_id and deleted_at is null;

  select array_agg(value order by value)
    into _req_ids
    from jsonb_array_elements_text(p_set_ids);

  if _live_ids is distinct from _req_ids then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
  end if;

  _now_ms := coalesce(p_now_ms, (extract(epoch from clock_timestamp()) * 1000)::bigint);

  update app_public.session_plan_sets sps
     set order_index = ord.idx,
         updated_at = greatest(sps.updated_at + 1, _now_ms),
         client_updated_at_ms = greatest(sps.client_updated_at_ms + 1, _now_ms),
         last_modified_by = 'agent'
    from (
      select value as id, (ordinality - 1)::integer as idx
        from jsonb_array_elements_text(p_set_ids) with ordinality
    ) ord
   where sps.owner_user_id = p_owner
     and sps.session_plan_exercise_id = p_exercise_id
     and sps.id = ord.id
     and sps.order_index is distinct from ord.idx;

  update app_public.session_plan_exercises spe
     set updated_at = greatest(spe.updated_at + 1, _now_ms),
         client_updated_at_ms = greatest(spe.client_updated_at_ms + 1, _now_ms),
         last_modified_by = 'agent'
   where spe.owner_user_id = p_owner and spe.id = p_exercise_id;

  update app_public.session_plans sp
     set updated_at = greatest(sp.updated_at + 1, _now_ms),
         client_updated_at_ms = greatest(sp.client_updated_at_ms + 1, _now_ms),
         last_modified_by = 'agent'
   where sp.owner_user_id = p_owner and sp.id = p_plan_id;

  _new_version := to_char(app_public.agent_plan_graph_version(p_owner, p_plan_id) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  _result := jsonb_build_object(
    'plan_id', p_plan_id,
    'exercise_id', p_exercise_id,
    'version', _new_version,
    'idempotent_replay', false
  );

  perform app_public.agent_plan_store_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, _result
  );
  return _result;
end;
$func$;

-- -----------------------------------------------------------------------------
-- 11. RPC: agent_tombstone_plan_block
-- -----------------------------------------------------------------------------

create or replace function app_public.agent_tombstone_plan_block(
  p_owner uuid,
  p_client_id text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_plan_id text,
  p_exercise_id text,
  p_base_version text,
  p_now_ms bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _operation             text := 'tombstone_plan_block';
  _now_ms                bigint;
  _replay                jsonb;
  _count                 integer;
  _target_order          integer;
  _tombstone_block_order integer;
  _new_version           text;
  _result                jsonb;
begin
  _replay := app_public.agent_plan_claim_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256
  );
  if _replay is not null then
    return _replay;
  end if;

  perform app_public.agent_check_plan_version(p_owner, p_plan_id, p_base_version);

  select spe.order_index
    into _target_order
    from app_public.session_plan_exercises spe
   where spe.owner_user_id = p_owner and spe.id = p_exercise_id and spe.session_plan_id = p_plan_id and spe.deleted_at is null;

  if _target_order is null then
    raise exception 'FOREIGN_RESOURCE_REFERENCE' using errcode = 'P0001';
  end if;

  if app_public.agent_block_is_immutable(p_owner, p_exercise_id) then
    raise exception 'IMMUTABLE_BLOCK_MUTATION' using errcode = 'P0001';
  end if;

  -- Finding 4: if any surviving block that would be renumbered is consumed/immutable, reject
  if exists (
    select 1
      from app_public.session_plan_exercises spe
     where spe.owner_user_id = p_owner
       and spe.session_plan_id = p_plan_id
       and spe.deleted_at is null
       and spe.order_index > _target_order
       and app_public.agent_block_is_immutable(p_owner, spe.id)
  ) then
    raise exception 'IMMUTABLE_BLOCK_MUTATION' using errcode = 'P0001';
  end if;

  select count(*)
    into _count
    from app_public.session_plan_exercises
   where owner_user_id = p_owner and session_plan_id = p_plan_id and deleted_at is null;

  if _count <= 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
  end if;

  _now_ms := coalesce(p_now_ms, (extract(epoch from clock_timestamp()) * 1000)::bigint);

  -- Finding 2: park tombstoned block at distinct slot >= 2000000
  select greatest(2000000, coalesce(max(order_index), 0) + 1)
    into _tombstone_block_order
    from app_public.session_plan_exercises
   where owner_user_id = p_owner and session_plan_id = p_plan_id;

  update app_public.session_plan_exercises spe
     set deleted_at = greatest(spe.client_updated_at_ms + 1, _now_ms),
         order_index = _tombstone_block_order,
         updated_at = greatest(spe.updated_at + 1, _now_ms),
         client_updated_at_ms = greatest(spe.client_updated_at_ms + 1, _now_ms),
         last_modified_by = 'agent'
   where spe.owner_user_id = p_owner and spe.session_plan_id = p_plan_id and spe.id = p_exercise_id;

  -- Finding 2: park tombstoned sets at distinct slots >= 2000000
  with dead_sets as (
    select id, row_number() over (order by order_index, id) as seq
      from app_public.session_plan_sets
     where owner_user_id = p_owner
       and session_plan_exercise_id = p_exercise_id
       and deleted_at is null
  ),
  base_order as (
    select greatest(2000000, coalesce(max(order_index), 0) + 1) as start_idx
      from app_public.session_plan_sets
     where owner_user_id = p_owner
       and session_plan_exercise_id = p_exercise_id
  )
  update app_public.session_plan_sets sps
     set deleted_at = greatest(sps.client_updated_at_ms + 1, _now_ms),
         order_index = b.start_idx + d.seq - 1,
         updated_at = greatest(sps.updated_at + 1, _now_ms),
         client_updated_at_ms = greatest(sps.client_updated_at_ms + 1, _now_ms),
         last_modified_by = 'agent'
    from dead_sets d, base_order b
   where sps.owner_user_id = p_owner
     and sps.session_plan_exercise_id = p_exercise_id
     and sps.id = d.id;

  -- Finding 1: renumber surviving sibling blocks with owner and plan predicates
  with numbered as (
    select id, row_number() over (order by order_index, id) - 1 as new_order
      from app_public.session_plan_exercises
     where owner_user_id = p_owner and session_plan_id = p_plan_id and deleted_at is null
  )
  update app_public.session_plan_exercises spe
     set order_index = n.new_order,
         updated_at = greatest(spe.updated_at + 1, _now_ms),
         client_updated_at_ms = greatest(spe.client_updated_at_ms + 1, _now_ms),
         last_modified_by = 'agent'
    from numbered n
   where spe.owner_user_id = p_owner
     and spe.session_plan_id = p_plan_id
     and spe.id = n.id
     and spe.order_index is distinct from n.new_order;

  update app_public.session_plans sp
     set updated_at = greatest(sp.updated_at + 1, _now_ms),
         client_updated_at_ms = greatest(sp.client_updated_at_ms + 1, _now_ms),
         last_modified_by = 'agent'
   where sp.owner_user_id = p_owner and sp.id = p_plan_id;

  _new_version := to_char(app_public.agent_plan_graph_version(p_owner, p_plan_id) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  _result := jsonb_build_object(
    'plan_id', p_plan_id,
    'exercise_id', p_exercise_id,
    'deleted', true,
    'version', _new_version,
    'idempotent_replay', false
  );

  perform app_public.agent_plan_store_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, _result
  );
  return _result;
end;
$func$;

-- -----------------------------------------------------------------------------
-- 12. RPC: agent_detach_programme_plan
-- -----------------------------------------------------------------------------

create or replace function app_public.agent_detach_programme_plan(
  p_owner uuid,
  p_client_id text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_programme_id text,
  p_plan_id text,
  p_base_version text,
  p_now_ms bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _operation   text := 'detach_programme_plan';
  _now_ms      bigint;
  _replay      jsonb;
  _count       integer;
  _new_version text;
  _result      jsonb;
begin
  _replay := app_public.agent_plan_claim_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256
  );
  if _replay is not null then
    return _replay;
  end if;

  perform app_public.agent_check_programme_version(p_owner, p_programme_id, p_base_version);

  if not exists (
    select 1 from app_public.session_plans
     where owner_user_id = p_owner and id = p_plan_id and programme_id = p_programme_id and deleted_at is null
  ) then
    raise exception 'FOREIGN_RESOURCE_REFERENCE' using errcode = 'P0001';
  end if;

  select count(*)
    into _count
    from app_public.session_plans
   where owner_user_id = p_owner and programme_id = p_programme_id and deleted_at is null;

  if _count - 1 < 2 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
  end if;

  _now_ms := coalesce(p_now_ms, (extract(epoch from clock_timestamp()) * 1000)::bigint);

  update app_public.session_plans sp
     set programme_id = null,
         programme_order_index = null,
         updated_at = greatest(sp.updated_at + 1, _now_ms),
         client_updated_at_ms = greatest(sp.client_updated_at_ms + 1, _now_ms),
         last_modified_by = 'agent'
   where sp.owner_user_id = p_owner and sp.id = p_plan_id;

  with numbered as (
    select id, row_number() over (order by programme_order_index, id) - 1 as new_order
      from app_public.session_plans
     where owner_user_id = p_owner and programme_id = p_programme_id and deleted_at is null
  )
  update app_public.session_plans sp
     set programme_order_index = n.new_order,
         updated_at = greatest(sp.updated_at + 1, _now_ms),
         client_updated_at_ms = greatest(sp.client_updated_at_ms + 1, _now_ms),
         last_modified_by = 'agent'
    from numbered n
   where sp.owner_user_id = p_owner
     and sp.programme_id = p_programme_id
     and sp.id = n.id
     and sp.programme_order_index is distinct from n.new_order;

  update app_public.training_programmes tp
     set updated_at = greatest(tp.updated_at + 1, _now_ms),
         client_updated_at_ms = greatest(tp.client_updated_at_ms + 1, _now_ms),
         last_modified_by = 'agent'
   where tp.owner_user_id = p_owner and tp.id = p_programme_id;

  _new_version := to_char(app_public.agent_programme_graph_version(p_owner, p_programme_id) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  _result := jsonb_build_object(
    'programme_id', p_programme_id,
    'plan_id', p_plan_id,
    'detached', true,
    'version', _new_version,
    'idempotent_replay', false
  );

  perform app_public.agent_plan_store_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, _result
  );
  return _result;
end;
$func$;

-- -----------------------------------------------------------------------------
-- 13. RPC: agent_tombstone_plan
-- -----------------------------------------------------------------------------

create or replace function app_public.agent_tombstone_plan(
  p_owner uuid,
  p_client_id text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_plan_id text,
  p_base_version text,
  p_now_ms bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _operation        text := 'tombstone_plan';
  _now_ms           bigint;
  _replay           jsonb;
  _prog_id          text;
  _prog_plan_count  integer;
  _new_version      text;
  _result           jsonb;
begin
  _replay := app_public.agent_plan_claim_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256
  );
  if _replay is not null then
    return _replay;
  end if;

  perform app_public.agent_check_plan_version(p_owner, p_plan_id, p_base_version);

  if exists (
    select 1
      from app_public.session_plan_exercises spe
     where spe.owner_user_id = p_owner
       and spe.session_plan_id = p_plan_id
       and spe.deleted_at is null
       and app_public.agent_block_is_immutable(p_owner, spe.id)
  ) then
    raise exception 'IMMUTABLE_BLOCK_MUTATION' using errcode = 'P0001';
  end if;

  select sp.programme_id
    into _prog_id
    from app_public.session_plans sp
   where sp.owner_user_id = p_owner and sp.id = p_plan_id;

  -- Finding 5: if plan belongs to a programme, enforce >=2 remaining live plans
  if _prog_id is not null then
    select count(*)
      into _prog_plan_count
      from app_public.session_plans
     where owner_user_id = p_owner and programme_id = _prog_id and deleted_at is null;

    if _prog_plan_count - 1 < 2 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
    end if;
  end if;

  _now_ms := coalesce(p_now_ms, (extract(epoch from clock_timestamp()) * 1000)::bigint);

  update app_public.session_plans sp
     set deleted_at = greatest(sp.client_updated_at_ms + 1, _now_ms),
         updated_at = greatest(sp.updated_at + 1, _now_ms),
         client_updated_at_ms = greatest(sp.client_updated_at_ms + 1, _now_ms),
         last_modified_by = 'agent'
   where sp.owner_user_id = p_owner and sp.id = p_plan_id;

  -- Finding 2: park tombstoned exercises at distinct slots >= 2000000
  with dead_exercises as (
    select id, row_number() over (order by order_index, id) as seq
      from app_public.session_plan_exercises
     where owner_user_id = p_owner and session_plan_id = p_plan_id and deleted_at is null
  ),
  base_order as (
    select greatest(2000000, coalesce(max(order_index), 0) + 1) as start_idx
      from app_public.session_plan_exercises
     where owner_user_id = p_owner and session_plan_id = p_plan_id
  )
  update app_public.session_plan_exercises spe
     set deleted_at = greatest(spe.client_updated_at_ms + 1, _now_ms),
         order_index = b.start_idx + d.seq - 1,
         updated_at = greatest(spe.updated_at + 1, _now_ms),
         client_updated_at_ms = greatest(spe.client_updated_at_ms + 1, _now_ms),
         last_modified_by = 'agent'
    from dead_exercises d, base_order b
   where spe.owner_user_id = p_owner and spe.session_plan_id = p_plan_id and spe.id = d.id;

  -- Finding 2: park tombstoned child sets at distinct slots >= 2000000
  with dead_sets as (
    select sps.id, row_number() over (partition by sps.session_plan_exercise_id order by sps.order_index, sps.id) as seq
      from app_public.session_plan_sets sps
      join app_public.session_plan_exercises spe
        on spe.id = sps.session_plan_exercise_id
       and spe.owner_user_id = p_owner
       and spe.session_plan_id = p_plan_id
     where sps.owner_user_id = p_owner and sps.deleted_at is null
  ),
  base_order as (
    select sps.session_plan_exercise_id, greatest(2000000, coalesce(max(sps.order_index), 0) + 1) as start_idx
      from app_public.session_plan_sets sps
      join app_public.session_plan_exercises spe
        on spe.id = sps.session_plan_exercise_id
       and spe.owner_user_id = p_owner
       and spe.session_plan_id = p_plan_id
      where sps.owner_user_id = p_owner
      group by sps.session_plan_exercise_id
  )
  update app_public.session_plan_sets sps
     set deleted_at = greatest(sps.client_updated_at_ms + 1, _now_ms),
         order_index = b.start_idx + d.seq - 1,
         updated_at = greatest(sps.updated_at + 1, _now_ms),
         client_updated_at_ms = greatest(sps.client_updated_at_ms + 1, _now_ms),
         last_modified_by = 'agent'
    from dead_sets d, base_order b
   where sps.owner_user_id = p_owner
     and sps.session_plan_exercise_id = b.session_plan_exercise_id
     and sps.id = d.id;

  -- Finding 1: renumber surviving programme plans with composite owner and programme predicates
  if _prog_id is not null then
    with numbered as (
      select id, row_number() over (order by programme_order_index, id) - 1 as new_order
        from app_public.session_plans
       where owner_user_id = p_owner and programme_id = _prog_id and deleted_at is null
    )
    update app_public.session_plans sp
       set programme_order_index = n.new_order,
           updated_at = greatest(sp.updated_at + 1, _now_ms),
           client_updated_at_ms = greatest(sp.client_updated_at_ms + 1, _now_ms),
           last_modified_by = 'agent'
      from numbered n
     where sp.owner_user_id = p_owner
       and sp.programme_id = _prog_id
       and sp.id = n.id
       and sp.programme_order_index is distinct from n.new_order;
  end if;

  _new_version := to_char(app_public.agent_plan_graph_version(p_owner, p_plan_id) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  _result := jsonb_build_object(
    'plan_id', p_plan_id,
    'deleted', true,
    'version', _new_version,
    'idempotent_replay', false
  );

  perform app_public.agent_plan_store_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, _result
  );
  return _result;
end;
$func$;

-- -----------------------------------------------------------------------------
-- 14. RPC: agent_tombstone_programme
-- -----------------------------------------------------------------------------

create or replace function app_public.agent_tombstone_programme(
  p_owner uuid,
  p_client_id text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_programme_id text,
  p_base_version text,
  p_now_ms bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _operation   text := 'tombstone_programme';
  _now_ms      bigint;
  _replay      jsonb;
  _new_version text;
  _result      jsonb;
begin
  _replay := app_public.agent_plan_claim_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256
  );
  if _replay is not null then
    return _replay;
  end if;

  perform app_public.agent_check_programme_version(p_owner, p_programme_id, p_base_version);

  _now_ms := coalesce(p_now_ms, (extract(epoch from clock_timestamp()) * 1000)::bigint);

  -- Detach live child plans without deleting them
  update app_public.session_plans sp
     set programme_id = null,
         programme_order_index = null,
         updated_at = greatest(sp.updated_at + 1, _now_ms),
         client_updated_at_ms = greatest(sp.client_updated_at_ms + 1, _now_ms),
         last_modified_by = 'agent'
   where sp.owner_user_id = p_owner and sp.programme_id = p_programme_id and sp.deleted_at is null;

  update app_public.training_programmes tp
     set deleted_at = greatest(tp.client_updated_at_ms + 1, _now_ms),
         updated_at = greatest(tp.updated_at + 1, _now_ms),
         client_updated_at_ms = greatest(tp.client_updated_at_ms + 1, _now_ms),
         last_modified_by = 'agent'
   where tp.owner_user_id = p_owner and tp.id = p_programme_id;

  _new_version := to_char(app_public.agent_programme_graph_version(p_owner, p_programme_id) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  _result := jsonb_build_object(
    'programme_id', p_programme_id,
    'deleted', true,
    'version', _new_version,
    'idempotent_replay', false
  );

  perform app_public.agent_plan_store_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, _result
  );
  return _result;
end;
$func$;

-- -----------------------------------------------------------------------------
-- 15. Role grants and permissions (service_role only)
-- -----------------------------------------------------------------------------

revoke all on function app_public.agent_plan_claim_receipt(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function app_public.agent_plan_claim_receipt(uuid, text, text, text, text) to service_role;

revoke all on function app_public.agent_plan_store_receipt(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function app_public.agent_plan_store_receipt(uuid, text, text, text, jsonb) to service_role;

revoke all on function app_public.agent_plan_graph_version(uuid, text) from public, anon, authenticated;
grant execute on function app_public.agent_plan_graph_version(uuid, text) to service_role;

revoke all on function app_public.agent_programme_graph_version(uuid, text) from public, anon, authenticated;
grant execute on function app_public.agent_programme_graph_version(uuid, text) to service_role;

revoke all on function app_public.agent_check_plan_version(uuid, text, text) from public, anon, authenticated;
grant execute on function app_public.agent_check_plan_version(uuid, text, text) to service_role;

revoke all on function app_public.agent_check_programme_version(uuid, text, text) from public, anon, authenticated;
grant execute on function app_public.agent_check_programme_version(uuid, text, text) to service_role;

revoke all on function app_public.agent_block_is_immutable(uuid, text) from public, anon, authenticated;
grant execute on function app_public.agent_block_is_immutable(uuid, text) to service_role;

revoke all on function app_public.agent_update_plan_meta(uuid, text, text, text, text, text, jsonb, bigint) from public, anon, authenticated;
grant execute on function app_public.agent_update_plan_meta(uuid, text, text, text, text, text, jsonb, bigint) to service_role;

revoke all on function app_public.agent_update_programme_meta(uuid, text, text, text, text, text, jsonb, bigint) from public, anon, authenticated;
grant execute on function app_public.agent_update_programme_meta(uuid, text, text, text, text, text, jsonb, bigint) to service_role;

revoke all on function app_public.agent_insert_plan_block(uuid, text, text, text, text, text, jsonb, bigint) from public, anon, authenticated;
grant execute on function app_public.agent_insert_plan_block(uuid, text, text, text, text, text, jsonb, bigint) to service_role;

revoke all on function app_public.agent_update_plan_block(uuid, text, text, text, text, text, text, jsonb, bigint) from public, anon, authenticated;
grant execute on function app_public.agent_update_plan_block(uuid, text, text, text, text, text, text, jsonb, bigint) to service_role;

revoke all on function app_public.agent_reorder_plan_blocks(uuid, text, text, text, text, text, jsonb, bigint) from public, anon, authenticated;
grant execute on function app_public.agent_reorder_plan_blocks(uuid, text, text, text, text, text, jsonb, bigint) to service_role;

revoke all on function app_public.agent_reorder_programme_plans(uuid, text, text, text, text, text, jsonb, bigint) from public, anon, authenticated;
grant execute on function app_public.agent_reorder_programme_plans(uuid, text, text, text, text, text, jsonb, bigint) to service_role;

revoke all on function app_public.agent_reorder_block_sets(uuid, text, text, text, text, text, text, jsonb, bigint) from public, anon, authenticated;
grant execute on function app_public.agent_reorder_block_sets(uuid, text, text, text, text, text, text, jsonb, bigint) to service_role;

revoke all on function app_public.agent_tombstone_plan_block(uuid, text, text, text, text, text, text, bigint) from public, anon, authenticated;
grant execute on function app_public.agent_tombstone_plan_block(uuid, text, text, text, text, text, text, bigint) to service_role;

revoke all on function app_public.agent_detach_programme_plan(uuid, text, text, text, text, text, text, bigint) from public, anon, authenticated;
grant execute on function app_public.agent_detach_programme_plan(uuid, text, text, text, text, text, text, bigint) to service_role;

revoke all on function app_public.agent_tombstone_plan(uuid, text, text, text, text, text, bigint) from public, anon, authenticated;
grant execute on function app_public.agent_tombstone_plan(uuid, text, text, text, text, text, bigint) to service_role;

revoke all on function app_public.agent_tombstone_programme(uuid, text, text, text, text, text, bigint) from public, anon, authenticated;
grant execute on function app_public.agent_tombstone_programme(uuid, text, text, text, text, text, bigint) to service_role;
