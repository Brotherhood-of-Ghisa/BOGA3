-- Dedicated grant: updating an older plan switch cannot revive workout access.
-- App enablement is intentionally withheld until revision-aware handoff ships.
create table public.agent_workout_permissions (
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null check (length(btrim(client_id)) between 1 and 200),
  workout_logging_enabled boolean not null default false,
  granted_at timestamptz not null,
  primary key (owner_user_id,client_id)
);
alter table public.agent_workout_permissions enable row level security;
revoke all on public.agent_workout_permissions from public,anon,authenticated;
grant all on public.agent_workout_permissions to service_role;

alter table public.agent_plan_write_receipts drop constraint agent_plan_write_receipts_operation_valid;
alter table public.agent_plan_write_receipts add constraint agent_plan_write_receipts_operation_valid check (operation in (
  'create_session_plan','create_training_programme','create_exercise','update_exercise','delete_exercise','restore_exercise',
  'update_plan_meta','update_programme_meta','insert_plan_block','update_plan_block',
  'reorder_plan_blocks','reorder_programme_plans','reorder_block_sets','tombstone_plan_block','detach_programme_plan',
  'tombstone_plan','tombstone_programme','set_muscle_targets',
  'start_workout','log_sets','update_set','delete_set','finish_workout'
));

create function app_public.agent_workout_authorize(p_owner uuid,p_client_id text,p_granted_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
  -- Match developer wipe and domain writers: owner lock always precedes tuple locks.
  perform pg_advisory_xact_lock(hashtextextended('exercise-merge:'||p_owner::text,0));
  -- Held until commit: revoking the permission cannot race a partially accepted write.
  perform 1 from public.agent_workout_permissions where owner_user_id=p_owner and client_id=p_client_id
    and workout_logging_enabled and granted_at=p_granted_at for share;
  if not found then raise exception 'WORKOUT_PERMISSION_REQUIRED'; end if;
  perform app_public.agent_exercise_act_as_owner(p_owner);
end $$;

create function app_public.agent_workout_requires_app(p_owner uuid,p_session_id text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from app_public.sessions where owner_user_id=p_owner and id=p_session_id
    and (source_plan_id is not null or source_plan_use_id is not null)) or
    exists(select 1 from app_public.session_exercises where owner_user_id=p_owner and session_id=p_session_id
      and deleted_at is null and (source_plan_exercise_id is not null or source_plan_use_id is not null));
$$;

-- A graph token detects set membership, same-count edits, lifecycle and tombstones.
create function app_public.agent_workout_revision(p_owner uuid,p_session_id text)
returns text language sql stable security definer set search_path='' as $$
  select md5(coalesce(string_agg(kind||':'||row_value::text,'|' order by kind,row_value->>'id'),'')) from (
    select 'session' kind,to_jsonb(s)-'server_received_at' row_value from app_public.sessions s
      where s.owner_user_id=p_owner and s.id=p_session_id
    union all select 'block',to_jsonb(b)-'server_received_at' from app_public.session_exercises b
      where b.owner_user_id=p_owner and b.session_id=p_session_id
    union all select 'set',to_jsonb(e)-'server_received_at' from app_public.exercise_sets e
      join app_public.session_exercises b on b.owner_user_id=e.owner_user_id and b.id=e.session_exercise_id
      where b.owner_user_id=p_owner and b.session_id=p_session_id
    union all select 'tag',to_jsonb(t)-'server_received_at' from app_public.session_exercise_tags t
      join app_public.session_exercises b on b.owner_user_id=t.owner_user_id and b.id=t.session_exercise_id
      where b.owner_user_id=p_owner and b.session_id=p_session_id
    union all select 'definition',to_jsonb(d)-'server_received_at' from app_public.exercise_definitions d
      where d.owner_user_id=p_owner and d.id in(select b.exercise_definition_id from app_public.session_exercises b
        where b.owner_user_id=p_owner and b.session_id=p_session_id)
  ) graph;
$$;

create function app_public.agent_workout_read(
  p_owner uuid,p_client_id text,p_granted_at timestamptz,
  p_session_id text default null,p_after text default null,p_limit integer default 50,p_revision text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s app_public.sessions; revision text; rows jsonb; more boolean; last_key text;
begin
  perform app_public.agent_workout_authorize(p_owner,p_client_id,p_granted_at);
  if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'INVALID_ARGUMENT'; end if;
  if p_session_id is null then
    select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'gym_id',x.gym_id,'started_at',x.started_at,
      'status',x.status) order by x.id),'[]'),count(*)>p_limit into rows,more from (
      select * from app_public.sessions where owner_user_id=p_owner and deleted_at is null and status='active'
        and (p_after is null or id>p_after) order by id limit p_limit+1
    ) x;
    more:=jsonb_array_length(rows)>p_limit;
    if more then rows:=rows-(jsonb_array_length(rows)-1); end if;
    return jsonb_build_object('workouts',rows,'next_cursor',case when more then rows->-1->>'id' end,
      'visibility','server_synced_only');
  end if;
  select * into s from app_public.sessions where owner_user_id=p_owner and id=p_session_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  revision:=app_public.agent_workout_revision(p_owner,p_session_id);
  if p_revision is not null and revision<>p_revision then raise exception 'REVISION_CONFLICT'; end if;
  if p_after is not null and p_revision is null then raise exception 'INVALID_ARGUMENT'; end if;
  select coalesce(jsonb_agg(x.row_value order by x.key),'[]') into rows from (
    select key,row_value from (
      select 'b:'||b.id key,jsonb_build_object('type','exercise','id',b.id,'exercise_id',b.exercise_definition_id,
        'name',b.name,'order_index',b.order_index,'load_input_mode',d.load_input_mode) row_value
      from app_public.session_exercises b left join app_public.exercise_definitions d
        on d.owner_user_id=b.owner_user_id and d.id=b.exercise_definition_id
      where b.owner_user_id=p_owner and b.session_id=p_session_id and b.deleted_at is null
      union all
      select 's:'||e.id,jsonb_build_object('type','set','id',e.id,'session_exercise_id',e.session_exercise_id,
        'order_index',e.order_index,'weight_kg',e.weight_value,'reps',e.reps_value,'set_type',e.set_type,
        'performance_status',e.performance_status)
      from app_public.exercise_sets e join app_public.session_exercises b
        on b.owner_user_id=e.owner_user_id and b.id=e.session_exercise_id
      where b.owner_user_id=p_owner and b.session_id=p_session_id and b.deleted_at is null and e.deleted_at is null
    ) graph where p_after is null or key>p_after order by key limit p_limit+1
  ) x;
  more:=jsonb_array_length(rows)>p_limit;
  if more then rows:=rows-(jsonb_array_length(rows)-1); end if;
  if more then last_key:=case when rows->-1->>'type'='exercise' then 'b:' else 's:' end||(rows->-1->>'id'); end if;
  return jsonb_build_object('workout',jsonb_build_object('id',s.id,'gym_id',s.gym_id,'status',s.status,
    'started_at',s.started_at,'completed_at',s.completed_at,'duration_seconds',s.duration_sec,
    'deleted_at',s.deleted_at,'revision',revision,'requires_app',app_public.agent_workout_requires_app(p_owner,s.id)),
    'rows',rows,'next_cursor',last_key,'visibility','server_synced_only');
end $$;

create function app_public.agent_workout_log(p_owner uuid,p_session_id text,p_input jsonb,p_stamp bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b app_public.session_exercises; d app_public.exercise_definitions; item jsonb; position integer;
  new_id text; ids jsonb:='[]'; matches integer;
begin
  if p_input ? 'session_exercise_id' then
    select * into b from app_public.session_exercises where owner_user_id=p_owner
      and id=p_input->>'session_exercise_id' and session_id=p_session_id and deleted_at is null;
    if not found then raise exception 'NOT_FOUND'; end if;
  else
    select count(*) into matches from app_public.session_exercises where owner_user_id=p_owner
      and session_id=p_session_id and exercise_definition_id=p_input->>'exercise_id' and deleted_at is null;
    if matches>1 then raise exception 'AMBIGUOUS_EXERCISE_BLOCK'; end if;
    select * into b from app_public.session_exercises where owner_user_id=p_owner
      and session_id=p_session_id and exercise_definition_id=p_input->>'exercise_id' and deleted_at is null;
  end if;
  select * into d from app_public.exercise_definitions where owner_user_id=p_owner
    and id=coalesce(b.exercise_definition_id,p_input->>'exercise_id') and deleted_at is null;
  if not found then raise exception 'FOREIGN_RESOURCE_REFERENCE'; end if;
  if b.id is null then
    select coalesce(max(order_index),-1)+1 into position from app_public.session_exercises
      where owner_user_id=p_owner and session_id=p_session_id;
    insert into app_public.session_exercises(owner_user_id,id,session_id,exercise_definition_id,order_index,name,
      created_at,updated_at,client_updated_at_ms) values(p_owner,gen_random_uuid()::text,p_session_id,d.id,
      position,d.name,p_stamp,p_stamp,p_stamp) returning * into b;
  end if;
  select coalesce(max(order_index),-1)+1 into position from app_public.exercise_sets
    where owner_user_id=p_owner and session_exercise_id=b.id;
  for item in select value from jsonb_array_elements(p_input->'sets') loop
    new_id:=gen_random_uuid()::text;
    insert into app_public.exercise_sets(owner_user_id,id,session_exercise_id,order_index,weight_value,reps_value,
      set_type,performance_status,merge_revision,created_at,updated_at,client_updated_at_ms)
      values(p_owner,new_id,b.id,position,item->>'weight_kg',item->>'reps',item->>'set_type',null,
        b.merge_revision,p_stamp,p_stamp,p_stamp);
    ids:=ids||jsonb_build_array(new_id); position:=position+1;
  end loop;
  return jsonb_build_object('session_exercise_id',b.id,'set_ids',ids);
end $$;

create function app_public.agent_workout_mutate(
  p_owner uuid,p_client_id text,p_granted_at timestamptz,p_operation text,
  p_idempotency_key text,p_payload_sha256 text,p_input jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s app_public.sessions; stamp bigint; finished_at bigint; replay jsonb; result jsonb:='{}';
begin
  if p_operation not in ('start_workout','log_sets','update_set','delete_set','finish_workout') then
    raise exception 'INVALID_ARGUMENT';
  end if;
  perform app_public.agent_workout_authorize(p_owner,p_client_id,p_granted_at);
  perform set_config('boga.exercise_merge_internal','on',true);
  replay:=app_public.agent_exercise_claim_receipt(p_owner,p_client_id,p_operation,p_idempotency_key,p_payload_sha256);
  if replay is not null then return replay; end if;
  stamp:=(extract(epoch from clock_timestamp())*1000)::bigint;
  if p_operation='start_workout' then
    if exists(select 1 from app_public.sessions where owner_user_id=p_owner and status='active' and deleted_at is null) then
      raise exception 'ACTIVE_WORKOUT_CONFLICT';
    end if;
    if p_input->>'gym_id' is not null and not exists(select 1 from app_public.gyms
      where owner_user_id=p_owner and id=p_input->>'gym_id' and deleted_at is null) then
      raise exception 'FOREIGN_RESOURCE_REFERENCE';
    end if;
    insert into app_public.sessions(owner_user_id,id,gym_id,status,started_at,created_at,updated_at,client_updated_at_ms)
      values(p_owner,gen_random_uuid()::text,p_input->>'gym_id','active',stamp,stamp,stamp,stamp) returning * into s;
  else
    select * into s from app_public.sessions where owner_user_id=p_owner and id=p_input->>'session_id' for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if s.deleted_at is not null or s.status<>'active' then raise exception 'WORKOUT_NOT_ACTIVE'; end if;
    if app_public.agent_workout_requires_app(p_owner,s.id) then raise exception 'WORKOUT_REQUIRES_APP'; end if;
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
    update app_public.sessions set status=case when p_operation='finish_workout' then 'completed' else status end,
      completed_at=case when p_operation='finish_workout' then finished_at else completed_at end,
      duration_sec=case when p_operation='finish_workout' then greatest(0,floor((finished_at-started_at)/1000.0))::integer else duration_sec end,
      updated_at=stamp,client_updated_at_ms=stamp where owner_user_id=p_owner and id=s.id returning * into s;
  end if;
  result:=result||jsonb_build_object('session_id',s.id,'revision',app_public.agent_workout_revision(p_owner,s.id),
    'status',s.status,'completed_at',s.completed_at,'duration_seconds',s.duration_sec,'idempotent_replay',false);
  perform app_public.agent_exercise_store_receipt(p_owner,p_client_id,p_operation,p_idempotency_key,result);
  perform set_config('boga.exercise_merge_internal','',true);
  return result;
end $$;

revoke all on function app_public.agent_workout_authorize(uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function app_public.agent_workout_requires_app(uuid,text) from public,anon,authenticated;
revoke all on function app_public.agent_workout_revision(uuid,text) from public,anon,authenticated;
revoke all on function app_public.agent_workout_log(uuid,text,jsonb,bigint) from public,anon,authenticated;
revoke all on function app_public.agent_workout_read(uuid,text,timestamptz,text,text,integer,text) from public,anon,authenticated;
revoke all on function app_public.agent_workout_mutate(uuid,text,timestamptz,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function app_public.agent_workout_read(uuid,text,timestamptz,text,text,integer,text) to service_role;
grant execute on function app_public.agent_workout_mutate(uuid,text,timestamptz,text,text,text,jsonb) to service_role;

-- Account reset revokes this authority as well as the existing agent switches.
do $$
declare original text; revised text;
begin
  original:=pg_get_functiondef('app_public.dev_wipe_my_data()'::regprocedure);
  revised:=replace(original,'delete from public.agent_plan_permissions where owner_user_id = _uid;',
    E'delete from public.agent_workout_permissions where owner_user_id = _uid;\n  get diagnostics _deleted = row_count;\n  _total := _total + _deleted;\n  delete from public.agent_plan_permissions where owner_user_id = _uid;');
  if revised=original then raise exception 'Cannot patch workout permission wipe'; end if;
  execute revised;
end $$;
