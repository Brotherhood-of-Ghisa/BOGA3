-- Completed workouts may remain MCP-controlled while their history is entered.
-- Historical dates never serve as audit/sync clocks.
alter table public.agent_plan_write_receipts drop constraint agent_plan_write_receipts_operation_valid;
alter table public.agent_plan_write_receipts add constraint agent_plan_write_receipts_operation_valid check (operation in (
  'create_session_plan','create_training_programme','create_exercise','update_exercise','delete_exercise','restore_exercise',
  'update_plan_meta','update_programme_meta','insert_plan_block','update_plan_block',
  'reorder_plan_blocks','reorder_programme_plans','reorder_block_sets','tombstone_plan_block','detach_programme_plan',
  'tombstone_plan','tombstone_programme','set_muscle_targets',
  'create_workout','start_workout','log_sets','update_set','delete_set','finish_workout'
));

CREATE OR REPLACE FUNCTION app_public.agent_workout_mutate(p_owner uuid, p_client_id text, p_granted_at timestamp with time zone, p_operation text, p_idempotency_key text, p_payload_sha256 text, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s app_public.sessions; stamp bigint; began_at bigint; finished_at bigint; replay jsonb; result jsonb:='{}';
begin
  if p_operation not in ('create_workout','start_workout','log_sets','update_set','delete_set','finish_workout') then
    raise exception 'INVALID_ARGUMENT';
  end if;
  perform app_public.agent_workout_authorize(p_owner,p_client_id,p_granted_at);
  perform set_config('boga.workout_control_write','on',true);
  perform set_config('boga.exercise_merge_internal','on',true);
  replay:=app_public.agent_exercise_claim_receipt(p_owner,p_client_id,p_operation,p_idempotency_key,p_payload_sha256);
  if replay is not null then
    select * into s from app_public.sessions where owner_user_id=p_owner and id=replay->>'session_id';
    if (s.status='active' or (s.status='completed' and s.logging_client_id is not null)) and (s.logging_client_id is distinct from p_client_id
      or s.logging_granted_at::timestamptz is distinct from p_granted_at) then raise exception 'WORKOUT_CONTROL_REQUIRED'; end if;
    perform set_config('boga.workout_control_write','',true);
    perform set_config('boga.exercise_merge_internal','',true);
    return replay||jsonb_build_object('control',app_public.workout_control(p_owner,s.id,p_client_id,p_granted_at));
  end if;
  stamp:=(extract(epoch from clock_timestamp())*1000)::bigint;
  if p_operation in ('start_workout','create_workout') then
    if p_operation='start_workout' and exists(select 1 from app_public.sessions where owner_user_id=p_owner and status='active' and deleted_at is null) then
      raise exception 'ACTIVE_WORKOUT_CONFLICT';
    end if;
    if p_input->>'gym_id' is not null and not exists(select 1 from app_public.gyms
      where owner_user_id=p_owner and id=p_input->>'gym_id' and deleted_at is null) then
      raise exception 'FOREIGN_RESOURCE_REFERENCE';
    end if;
    began_at:=stamp;
    if p_operation='create_workout' then
      if jsonb_typeof(p_input->'started_at') is distinct from 'number'
        or jsonb_typeof(p_input->'completed_at') is distinct from 'number'
        or p_input->>'started_at' !~ '^-?[0-9]+$' or p_input->>'completed_at' !~ '^-?[0-9]+$' then
        raise exception 'INVALID_ARGUMENT';
      end if;
      if (p_input->>'started_at')::numeric < -8640000000000000
        or (p_input->>'completed_at')::numeric > stamp
        or (p_input->>'started_at')::numeric > (p_input->>'completed_at')::numeric
        or floor(((p_input->>'completed_at')::numeric-(p_input->>'started_at')::numeric)/1000)>2147483647 then
        raise exception 'INVALID_ARGUMENT';
      end if;
      began_at:=(p_input->>'started_at')::bigint; finished_at:=(p_input->>'completed_at')::bigint;
    end if;
    insert into app_public.sessions(owner_user_id,id,gym_id,status,started_at,completed_at,duration_sec,
      created_at,updated_at,client_updated_at_ms,logging_client_id,logging_granted_at)
      values(p_owner,gen_random_uuid()::text,p_input->>'gym_id',
        case when p_operation='create_workout' then 'completed' else 'active' end,began_at,finished_at,
        case when p_operation='create_workout' then floor((finished_at-began_at)/1000.0)::integer end,
        stamp,stamp,stamp,p_client_id,p_granted_at::text) returning * into s;
  else
    select * into s from app_public.sessions where owner_user_id=p_owner and id=p_input->>'session_id' for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if s.deleted_at is not null or (s.status<>'active' and (s.status<>'completed' or s.logging_client_id is null)) then raise exception 'WORKOUT_NOT_ACTIVE'; end if;
    if app_public.agent_workout_requires_app(p_owner,s.id) then raise exception 'WORKOUT_REQUIRES_APP'; end if;
    if s.logging_client_id is distinct from p_client_id or s.logging_granted_at::timestamptz is distinct from p_granted_at then
      raise exception 'WORKOUT_CONTROL_REQUIRED';
    end if;
    if app_public.agent_workout_revision(p_owner,s.id) is distinct from p_input->>'expected_revision' then
      raise exception 'REVISION_CONFLICT';
    end if;
    select greatest(stamp,coalesce(max(value),0)+1) into stamp from (
      select s.client_updated_at_ms value union all
      select b.client_updated_at_ms from app_public.session_exercises b where b.owner_user_id=p_owner and b.session_id=s.id
      union all select e.client_updated_at_ms from app_public.exercise_sets e join app_public.session_exercises b
        on b.owner_user_id=e.owner_user_id and b.id=e.session_exercise_id where b.owner_user_id=p_owner and b.session_id=s.id
    ) clocks;
    if p_operation='log_sets' then
      result:=app_public.agent_workout_log(p_owner,s.id,p_input,stamp);
    elsif p_operation in ('update_set','delete_set') then
      perform 1 from app_public.exercise_sets e join app_public.session_exercises b
        on b.owner_user_id=e.owner_user_id and b.id=e.session_exercise_id
        where e.owner_user_id=p_owner and e.id=p_input->>'set_id' and e.deleted_at is null
          and b.session_id=s.id and b.deleted_at is null;
      if not found then raise exception 'NOT_FOUND'; end if;
      update app_public.exercise_sets set
        weight_value=case when p_operation='update_set' then p_input->'set'->>'weight_kg' else weight_value end,
        reps_value=case when p_operation='update_set' then p_input->'set'->>'reps' else reps_value end,
        set_type=case when p_operation='update_set' then p_input->'set'->>'set_type' else set_type end,
        performance_status=case when p_operation='update_set' then null else performance_status end,
        deleted_at=case when p_operation='delete_set' then stamp else null end,updated_at=stamp,client_updated_at_ms=stamp
        where owner_user_id=p_owner and id=p_input->>'set_id';
      result:=jsonb_build_object('set_id',p_input->>'set_id');
    end if;
    finished_at:=greatest(s.started_at,(extract(epoch from clock_timestamp())*1000)::bigint);
    -- Complete last: group/notification triggers see the committed performed graph.
    update app_public.sessions set
      logging_client_id=case when p_operation='finish_workout' then null else logging_client_id end,
      logging_granted_at=case when p_operation='finish_workout' then null else logging_granted_at end,
      status=case when p_operation='finish_workout' then 'completed' else status end,
      completed_at=case when p_operation='finish_workout' and s.status='active' then finished_at else completed_at end,
      duration_sec=case when p_operation='finish_workout' and s.status='active' then greatest(0,floor((finished_at-started_at)/1000.0))::integer else duration_sec end,
      updated_at=stamp,client_updated_at_ms=stamp where owner_user_id=p_owner and id=s.id returning * into s;
  end if;
  perform app_public.workout_fence_graph(s.id);
  select * into s from app_public.sessions where owner_user_id=p_owner and id=s.id;
  result:=result||jsonb_build_object('control',app_public.workout_control(p_owner,s.id,p_client_id,p_granted_at),'session_id',s.id,'revision',app_public.agent_workout_revision(p_owner,s.id),
    'status',s.status,'started_at',s.started_at,'completed_at',s.completed_at,'duration_seconds',s.duration_sec,'idempotent_replay',false);
  perform app_public.agent_exercise_store_receipt(p_owner,p_client_id,p_operation,p_idempotency_key,result);
  perform set_config('boga.workout_control_write','',true);
  perform set_config('boga.exercise_merge_internal','',true);
  return result;
end $function$;

-- Keep the existing service-only entry point and the same graph fencing.
revoke all on function app_public.agent_workout_mutate(uuid,text,timestamptz,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function app_public.agent_workout_mutate(uuid,text,timestamptz,text,text,text,jsonb) to service_role;

do $migration$
declare original text; revised text; signature text;
begin
  original:=pg_get_functiondef('app_public.workout_control(uuid,text,text,timestamptz)'::regprocedure);
  revised:=replace(original,'s.status=''active'' and s.deleted_at','s.status in (''active'',''completed'') and s.deleted_at');
  if revised=original then raise exception 'Cannot expose completed workout control'; end if;
  execute revised;

  original:=pg_get_functiondef('app_public.workout_control_guard()'::regprocedure);
  revised:=replace(original,'and status=''active'' and logging_client_id is not null','and logging_client_id is not null');
  if revised=original then raise exception 'Cannot guard completed workout edits'; end if;
  execute revised;

  -- Completed AI-owned rows permit human takeover, not assignment of arbitrary history.
  original:=pg_get_functiondef('app_public.workout_set_control(text,text,bigint,text,timestamptz)'::regprocedure);
  revised:=replace(original,'if s.status<>''active'' or s.deleted_at is not null then',
    'if s.deleted_at is not null or (s.status<>''active'' and (s.status<>''completed'' or p_client_id is not null or s.logging_client_id is null)) then');
  if revised=original then raise exception 'Cannot allow completed workout takeover'; end if;
  execute revised;

  foreach signature in array array['app_public.exercise_merge_review_item(text)','app_public.workout_review_item(text)'] loop
    original:=pg_get_functiondef(signature::regprocedure);
    revised:=replace(original,'status=''active'' and logging_client_id is not null','logging_client_id is not null');
    revised:=replace(revised,'s.status=''active'' and s.logging_client_id is not null','s.logging_client_id is not null');
    if revised=original then raise exception 'Cannot lock completed recovery: %',signature; end if;
    execute revised;
  end loop;

  -- The phone cannot acknowledge a partial historical graph as final.
  -- This check remains under the existing notification source lock.
  original:=pg_get_functiondef('app_public.notification_confirm_completion(text,jsonb)'::regprocedure);
  revised:=replace(original,'if s.deleted_at is not null or s.status<>''completed'' or s.completed_at is null then',
    'if s.deleted_at is not null or s.status<>''completed'' or s.completed_at is null or s.logging_client_id is not null then');
  if revised=original then raise exception 'Cannot defer historical completion confirmation'; end if;
  execute revised;
end $migration$;
