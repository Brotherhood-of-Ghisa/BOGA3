-- Agent injury tools: stored procedures and write receipts operation extension.

alter table public.agent_plan_write_receipts drop constraint agent_plan_write_receipts_operation_valid;
alter table public.agent_plan_write_receipts add constraint agent_plan_write_receipts_operation_valid check (operation in (
  'create_session_plan','create_training_programme','create_exercise','update_exercise','delete_exercise','restore_exercise',
  'update_plan_meta','update_programme_meta','insert_plan_block','update_plan_block',
  'reorder_plan_blocks','reorder_programme_plans','reorder_block_sets','tombstone_plan_block','detach_programme_plan',
  'tombstone_plan','tombstone_programme','set_muscle_targets',
  'create_workout','start_workout','log_sets','update_set','delete_set','finish_workout',
  'add_note','remove_note',
  'log_injury','update_injury_status'
));

create function app_public.agent_injury_json(p_injury app_public.injuries)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $func$
  select jsonb_build_object(
    'id', p_injury.id,
    'muscle_group_id', p_injury.muscle_group_id,
    'muscle_group_name', (
      select m.display_name
      from app_public.muscle_groups m
      where m.owner_user_id = p_injury.owner_user_id and m.id = p_injury.muscle_group_id
    ),
    'side', p_injury.side,
    'status', p_injury.status,
    'pain_score', p_injury.pain_score,
    'label', p_injury.label,
    'notes', p_injury.notes,
    'contraindications', p_injury.contraindications,
    'started_at', p_injury.started_at,
    'resolved_at', p_injury.resolved_at,
    'created_at', p_injury.created_at,
    'updated_at', p_injury.updated_at
  );
$func$;

create function app_public.agent_log_injury(
  p_owner uuid,
  p_client_id text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_injury jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _operation text := 'log_injury';
  _replay    jsonb;
  _muscle    text := p_injury ->> 'muscle_group_id';
  _status    text := coalesce(p_injury ->> 'status', 'acute');
  _side      text := p_injury ->> 'side';
  _pain      integer;
  _stamp     bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  _started   bigint;
  _row       app_public.injuries;
  _result    jsonb;
begin
  perform set_config('request.jwt.claim.sub', p_owner::text, true);

  _replay := app_public.agent_exercise_claim_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256
  );
  if _replay is not null then
    return _replay;
  end if;

  if coalesce(length(trim(p_injury ->> 'label')), 0) < 1 or length(p_injury ->> 'label') > 100 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
  end if;

  if _status not in ('acute', 'managing', 'monitoring') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
  end if;

  if _side is not null and _side not in ('left', 'right', 'bilateral') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
  end if;

  if p_injury ? 'pain_score' and p_injury ->> 'pain_score' is not null then
    _pain := (p_injury ->> 'pain_score')::integer;
    if _pain < 0 or _pain > 10 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
    end if;
  else
    _pain := null;
  end if;

  if p_injury ? 'started_at' and p_injury ->> 'started_at' is not null then
    _started := (p_injury ->> 'started_at')::bigint;
  else
    _started := _stamp;
  end if;

  if _muscle is not null then
    perform 1 from app_public.muscle_groups m
     where m.owner_user_id = p_owner and m.id = _muscle and m.deleted_at is null;
    if not found then
      raise exception 'INVALID_ANATOMY_REFERENCE' using errcode = 'P0001';
    end if;
  end if;

  insert into app_public.injuries (
    owner_user_id, id, muscle_group_id, side, status, pain_score,
    label, notes, contraindications, started_at, resolved_at,
    created_at, updated_at, deleted_at, client_updated_at_ms, server_received_at
  ) values (
    p_owner, 'injury_' || replace(gen_random_uuid()::text, '-', ''),
    _muscle, _side, _status, _pain,
    trim(p_injury ->> 'label'), p_injury ->> 'notes', p_injury ->> 'contraindications',
    _started, null,
    _stamp, _stamp, null, _stamp, now()
  ) returning * into _row;

  _result := jsonb_build_object('injury', app_public.agent_injury_json(_row), 'idempotent_replay', false);
  perform app_public.agent_exercise_store_receipt(p_owner, p_client_id, _operation, p_idempotency_key, _result);
  return _result;
end;
$func$;

create function app_public.agent_update_injury_status(
  p_owner uuid,
  p_client_id text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_injury_id text,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _operation   text := 'update_injury_status';
  _replay      jsonb;
  _row         app_public.injuries;
  _stamp       bigint;
  _new_status  text;
  _resolved_at bigint;
  _pain        integer;
  _side        text;
  _muscle      text;
  _result      jsonb;
begin
  perform set_config('request.jwt.claim.sub', p_owner::text, true);

  _replay := app_public.agent_exercise_claim_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256
  );
  if _replay is not null then
    return _replay;
  end if;

  select * into _row
    from app_public.injuries inj
   where inj.owner_user_id = p_owner and inj.id = p_injury_id
   for update;
  if not found or _row.deleted_at is not null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  _stamp := greatest((extract(epoch from clock_timestamp()) * 1000)::bigint, _row.client_updated_at_ms + 1);

  if p_changes ? 'status' and p_changes ->> 'status' is not null then
    _new_status := p_changes ->> 'status';
    if _new_status not in ('acute', 'managing', 'monitoring', 'resolved') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
    end if;
    if _new_status = 'resolved' and _row.status != 'resolved' then
      _resolved_at := _stamp;
    elsif _new_status != 'resolved' and _row.status = 'resolved' then
      _resolved_at := null;
    else
      _resolved_at := _row.resolved_at;
    end if;
  else
    _new_status := _row.status;
    _resolved_at := _row.resolved_at;
  end if;

  if p_changes ? 'pain_score' then
    if p_changes ->> 'pain_score' is not null then
      _pain := (p_changes ->> 'pain_score')::integer;
      if _pain < 0 or _pain > 10 then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
      end if;
    else
      _pain := null;
    end if;
  else
    _pain := _row.pain_score;
  end if;

  if p_changes ? 'side' then
    _side := p_changes ->> 'side';
    if _side is not null and _side not in ('left', 'right', 'bilateral') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
    end if;
  else
    _side := _row.side;
  end if;

  if p_changes ? 'muscle_group_id' then
    _muscle := p_changes ->> 'muscle_group_id';
    if _muscle is not null then
      perform 1 from app_public.muscle_groups m
       where m.owner_user_id = p_owner and m.id = _muscle and m.deleted_at is null;
      if not found then
        raise exception 'INVALID_ANATOMY_REFERENCE' using errcode = 'P0001';
      end if;
    end if;
  else
    _muscle := _row.muscle_group_id;
  end if;

  update app_public.injuries
     set status = _new_status,
         resolved_at = _resolved_at,
         pain_score = _pain,
         notes = case when p_changes ? 'notes' then (p_changes ->> 'notes') else _row.notes end,
         contraindications = case when p_changes ? 'contraindications' then (p_changes ->> 'contraindications') else _row.contraindications end,
         label = case when p_changes ? 'label' and p_changes ->> 'label' is not null then trim(p_changes ->> 'label') else _row.label end,
         side = _side,
         muscle_group_id = _muscle,
         updated_at = _stamp,
         client_updated_at_ms = _stamp
   where owner_user_id = p_owner and id = p_injury_id
   returning * into _row;

  _result := jsonb_build_object('injury', app_public.agent_injury_json(_row), 'idempotent_replay', false);
  perform app_public.agent_exercise_store_receipt(p_owner, p_client_id, _operation, p_idempotency_key, _result);
  return _result;
end;
$func$;

revoke all on function app_public.agent_injury_json(app_public.injuries) from public, anon, authenticated;
revoke all on function app_public.agent_log_injury(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function app_public.agent_update_injury_status(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function app_public.agent_injury_json(app_public.injuries) to service_role;
grant execute on function app_public.agent_log_injury(uuid, text, text, text, jsonb) to service_role;
grant execute on function app_public.agent_update_injury_status(uuid, text, text, text, text, jsonb) to service_role;
