-- Shared graph fences cover active sessions as well as merged history.
alter table app_public.sessions add column merge_revision bigint not null default 0;
alter table public.exercise_merge_operations add column session_id text;
alter table public.exercise_merge_operations add column workout_revision bigint;
alter table public.exercise_merge_conflicts add column session_id text;
create index exercise_merge_conflicts_parent_idx on public.exercise_merge_conflicts(user_id,entity_type,entity_id);

-- Resolve an unsent child's parent from this batch or an earlier preserved
-- block, so arbitrarily ordered and split batches cannot bypass a session fence.
create function app_public.workout_row_context(p_type text,p_row jsonb,p_entities jsonb default '[]')
returns table(session_id text,block_id text,revision bigint)
language plpgsql stable security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.exercise_merge_user(); sid text; bid text; epoch bigint;
begin
  if p_type='sessions' then sid:=p_row->>'id';
  elsif p_type='session_exercises' then bid:=p_row->>'id'; sid:=p_row->>'session_id';
  elsif p_type in('exercise_sets','session_exercise_tags') then
    bid:=p_row->>'session_exercise_id';
    select b.session_id into sid from app_public.session_exercises b where b.owner_user_id=u and b.id=bid;
    if sid is null then
      select e->'fields'->>'session_id' into sid from jsonb_array_elements(p_entities) e
        where e->>'type'='session_exercises' and e->>'id'=bid limit 1;
    end if;
    if sid is null then
      select c.session_id into sid from public.exercise_merge_conflicts c
        where c.user_id=u and c.entity_type='session_exercises' and c.entity_id=bid
        order by c.created_at desc,c.id limit 1;
    end if;
  end if;
  select greatest(coalesce((select s.merge_revision from app_public.sessions s
      where s.owner_user_id=u and s.id=sid),0),coalesce((select max(c.revision)
      from public.exercise_merge_contexts c where c.user_id=u and c.block_id=bid),0)) into epoch;
  return query select sid,bid,epoch;
end $$;
revoke all on function app_public.workout_row_context(text,jsonb,jsonb) from public,anon,authenticated;

create or replace function app_public.exercise_merge_save_conflict(p_type text,p_row jsonb)
returns text language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.exercise_merge_user(); scope record; r bigint; k text; existing_parent text;
begin
  if p_type not in ('sessions','session_exercises','exercise_sets','session_exercise_tags') then
    raise exception 'VALIDATION: invalid conflict entity';
  end if;
  if p_row ? 'owner_user_id' and p_row->>'owner_user_id' is distinct from u::text then raise exception 'NOT_FOUND'; end if;
  p_row:=p_row-'owner_user_id'-'server_received_at';
  if current_setting('boga.exercise_merge_sync',true)='on'
    and nullif(current_setting('boga.exercise_merge_client_clock',true),'') is not null then
    p_row:=p_row||jsonb_build_object('client_updated_at_ms',current_setting('boga.exercise_merge_client_clock')::bigint);
  end if;
  select * into scope from app_public.workout_row_context(p_type,p_row);
  r:=coalesce((p_row->>'merge_revision')::bigint,0);
  if scope.revision<=r then raise exception 'VALIDATION: history context has not changed'; end if;
  if r<0 or jsonb_typeof(p_row)<>'object' or coalesce(p_row->>'id','')='' then raise exception 'VALIDATION'; end if;
  if p_type in('exercise_sets','session_exercise_tags') then
    execute format('select session_exercise_id from app_public.%I where owner_user_id=$1 and id=$2',p_type)
      into existing_parent using u,p_row->>'id';
    if existing_parent is not null and existing_parent<>scope.block_id then
      p_row:=p_row||jsonb_build_object('merge_original_id',p_row->>'id','id','merge_review_'||md5(p_type||p_row::text));
    end if;
  end if;
  k:=md5(p_type||':'||p_row::text);
  insert into public.exercise_merge_conflicts(user_id,id,block_id,session_id,entity_type,entity_id,revision,saved)
    values(u,k,coalesce(scope.block_id,scope.session_id),scope.session_id,p_type,p_row->>'id',r,p_row) on conflict do nothing;
  return k;
end $$;

-- Classify before writes, preserving parents before children. A dropped new
-- parent must not make its stale child fail the transaction's deferred FK.
create function app_public.workout_prepare_push(p_entities jsonb)
returns jsonb language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.exercise_merge_user(); e jsonb; row_value jsonb; scope record; action_result jsonb;
  stale jsonb:='[]'; handled jsonb:='[]'; kept jsonb:='[]'; outcomes jsonb:='[]'; supplied bigint; key jsonb;
begin
  perform app_public.require_sync_protocol();
  perform pg_advisory_xact_lock(hashtextextended('exercise-merge:'||u::text,0));
  for e in select value from jsonb_array_elements(p_entities) order by case value->>'type'
    when 'sessions' then 0 when 'session_exercises' then 1 else 2 end loop
    if e->>'type' not in ('sessions','session_exercises','exercise_sets','session_exercise_tags') then continue; end if;
    row_value:=(e->'fields')||jsonb_build_object('id',e->>'id','client_updated_at_ms',e->'client_updated_at_ms');
    key:=jsonb_build_array(jsonb_build_object('type',e->>'type','id',e->>'id'));
    perform set_config('boga.exercise_merge_client_clock',e->>'client_updated_at_ms',true);
    if e->>'type'='sessions' and e ? 'lifecycle_action' then
      action_result:=app_public.workout_commit_lifecycle(e->'lifecycle_action'->>'id',
        (e->'lifecycle_action'->>'base_revision')::bigint,row_value,(e->>'client_updated_at_ms')::bigint);
      if (action_result->>'accepted')::boolean then handled:=handled||key; else stale:=stale||key; end if;
      continue;
    end if;
    select * into scope from app_public.workout_row_context(e->>'type',row_value,p_entities);
    supplied:=coalesce((row_value->>'merge_revision')::bigint,0);
    if supplied<scope.revision then
      perform app_public.exercise_merge_save_conflict(e->>'type',row_value);
      stale:=stale||key;
    elsif supplied<>scope.revision then raise exception 'VALIDATION: invalid merge revision'; end if;
    if e->>'type'='sessions' and scope.revision>0 and exists(select 1 from app_public.sessions s
      where s.owner_user_id=u and s.id=e->>'id' and (s.status is distinct from row_value->>'status'
        or s.deleted_at is distinct from (row_value->>'deleted_at')::bigint
        or s.completed_at is distinct from (row_value->>'completed_at')::bigint)) and not(stale @> key) then
      raise exception 'VALIDATION: lifecycle action required';
    end if;
  end loop;
  for e in select value from jsonb_array_elements(p_entities) loop
    if stale @> jsonb_build_array(jsonb_build_object('type',e->>'type','id',e->>'id')) then
      outcomes:=outcomes||jsonb_build_array(jsonb_build_object('type',e->>'type','id',e->>'id','outcome','preserved'));
    else
      if not (handled @> jsonb_build_array(jsonb_build_object('type',e->>'type','id',e->>'id'))) then
        kept:=kept||jsonb_build_array(e);
      end if;
      outcomes:=outcomes||jsonb_build_array(jsonb_build_object('type',e->>'type','id',e->>'id','outcome','accepted'));
    end if;
  end loop;
  perform set_config('boga.exercise_merge_client_clock','',true);
  return jsonb_build_object('entities',kept,'outcomes',outcomes);
end $$;
revoke all on function app_public.workout_prepare_push(jsonb) from public,anon;
grant execute on function app_public.workout_prepare_push(jsonb) to authenticated;

create or replace function app_public.exercise_merge_guard()
returns trigger language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=auth.uid(); scope record; old_scope record; supplied bigint; row_value jsonb;
begin
  if u is null or current_setting('boga.exercise_merge_internal',true)='on' then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  perform app_public.exercise_merge_user();
  row_value:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  select * into scope from app_public.workout_row_context(tg_table_name,row_value);
  supplied:=coalesce((row_value->>'merge_revision')::bigint,0);
  if tg_op='UPDATE' then
    select * into old_scope from app_public.workout_row_context(tg_table_name,to_jsonb(old));
    if old_scope.revision>0 and (old_scope.block_id is distinct from scope.block_id
      or old_scope.session_id is distinct from scope.session_id or old.id is distinct from new.id) then
      raise exception 'MERGE_REVIEW_REQUIRED: protected rows cannot be reparented';
    end if;
  end if;
  if scope.revision>0 and current_setting('boga.exercise_merge_sync',true) is distinct from 'on' then
    raise exception 'MERGE_REVIEW_REQUIRED: use revision-aware sync for protected history';
  end if;
  if tg_op='DELETE' then
    if scope.revision>0 then raise exception 'MERGE_REVIEW_REQUIRED: refresh history before removing it'; end if;
    return old;
  end if;
  if supplied<scope.revision then
    perform app_public.exercise_merge_save_conflict(tg_table_name,row_value);
    return null;
  end if;
  if supplied<>scope.revision then raise exception 'VALIDATION: invalid merge revision'; end if;
  return new;
end $$;
create trigger exercise_merge_context_guard before insert or update or delete on app_public.sessions
  for each row execute function app_public.exercise_merge_guard();

-- One canonical epoch for the complete workout, including empty/deleted rows.
create function app_public.workout_fence_graph(p_session_id text,p_operation_id text default null,p_input_hash text default null)
returns void language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.exercise_merge_user(); epoch bigint; stamp bigint; seq bigint;
  op text:=coalesce(p_operation_id,'workout:'||gen_random_uuid()::text); previous text:=current_setting('boga.exercise_merge_internal',true);
begin
  perform pg_advisory_xact_lock(hashtextextended('exercise-merge:'||u::text,0));
  if not exists(select 1 from app_public.sessions where owner_user_id=u and id=p_session_id) then raise exception 'NOT_FOUND'; end if;
  select coalesce(max(r),0)+1,greatest((extract(epoch from clock_timestamp())*1000)::bigint,coalesce(max(t),0)+1)
    into epoch,stamp from (
      select merge_revision r,client_updated_at_ms t from app_public.sessions where owner_user_id=u and id=p_session_id
      union all select merge_revision,client_updated_at_ms from app_public.session_exercises where owner_user_id=u and session_id=p_session_id
      union all select e.merge_revision,e.client_updated_at_ms from app_public.exercise_sets e join app_public.session_exercises b
        on b.owner_user_id=e.owner_user_id and b.id=e.session_exercise_id where b.owner_user_id=u and b.session_id=p_session_id
      union all select t.merge_revision,t.client_updated_at_ms from app_public.session_exercise_tags t join app_public.session_exercises b
        on b.owner_user_id=t.owner_user_id and b.id=t.session_exercise_id where b.owner_user_id=u and b.session_id=p_session_id
    ) clocks;
  select coalesce(max(sequence),0)+1 into seq from public.exercise_merge_operations where user_id=u;
  insert into public.exercise_merge_operations(user_id,id,sequence,session_id,workout_revision,input_hash,set_count)
    values(u,op,seq,p_session_id,epoch,coalesce(p_input_hash,md5(op)),0);
  insert into public.exercise_merge_contexts(user_id,block_id,revision,operation_id,source_id,destination_id,factor)
    select u,id,epoch,op,exercise_definition_id,exercise_definition_id,1 from app_public.session_exercises
      where owner_user_id=u and session_id=p_session_id;
  perform set_config('boga.exercise_merge_internal','on',true);
  update app_public.session_exercises set merge_revision=epoch,client_updated_at_ms=stamp where owner_user_id=u and session_id=p_session_id;
  update app_public.exercise_sets set merge_revision=epoch,client_updated_at_ms=stamp where owner_user_id=u
    and session_exercise_id in(select id from app_public.session_exercises where owner_user_id=u and session_id=p_session_id);
  update app_public.session_exercise_tags set merge_revision=epoch,client_updated_at_ms=stamp where owner_user_id=u
    and session_exercise_id in(select id from app_public.session_exercises where owner_user_id=u and session_id=p_session_id);
  update app_public.sessions set merge_revision=epoch,client_updated_at_ms=stamp where owner_user_id=u and id=p_session_id;
  perform set_config('boga.exercise_merge_internal',coalesce(previous,''),true);
end $$;
revoke all on function app_public.workout_fence_graph(text,text,text) from public,anon,authenticated,service_role;

-- A stable operation receipt distinguishes a lost acknowledgement from a new
-- stale lifecycle action; clients never guess an epoch as operation identity.
create function app_public.workout_commit_lifecycle(p_id text,p_base_revision bigint,p_row jsonb,p_clock bigint)
returns jsonb language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.exercise_merge_user(); s app_public.sessions; candidate app_public.sessions;
  receipt public.exercise_merge_operations; input_hash text; stamp bigint;
  previous text:=current_setting('boga.exercise_merge_internal',true);
begin
  if p_id is null or p_id!~'^lifecycle:[a-zA-Z0-9:-]+$' or length(p_id)>128 or p_base_revision is null or p_base_revision<1
    or coalesce((p_row->>'merge_revision')::bigint,-1)<>p_base_revision then raise exception 'VALIDATION: invalid lifecycle action'; end if;
  if p_row ? 'owner_user_id' and p_row->>'owner_user_id' is distinct from u::text then raise exception 'NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('exercise-merge:'||u::text,0));
  input_hash:=md5((p_row-'owner_user_id'-'server_received_at'-'client_updated_at_ms'-'updated_at')::text);
  select * into receipt from public.exercise_merge_operations where user_id=u and id=p_id;
  if found then
    if receipt.session_id is distinct from p_row->>'id' or receipt.input_hash<>input_hash or receipt.workout_revision is null then
      raise exception 'IDEMPOTENCY_CONFLICT: lifecycle action changed';
    end if;
    return jsonb_build_object('accepted',true,'revision',receipt.workout_revision);
  end if;
  select * into s from app_public.sessions where owner_user_id=u and id=p_row->>'id' for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_base_revision<s.merge_revision then
    perform app_public.exercise_merge_save_conflict('sessions',p_row);
    return jsonb_build_object('accepted',false);
  end if;
  if p_base_revision<>s.merge_revision then raise exception 'VALIDATION: invalid lifecycle revision'; end if;
  candidate:=jsonb_populate_record(s,p_row);
  stamp:=greatest(s.client_updated_at_ms+1,(extract(epoch from clock_timestamp())*1000)::bigint,
    least(p_clock,(extract(epoch from clock_timestamp())*1000)::bigint+300000));
  perform set_config('boga.exercise_merge_internal','on',true);
  update app_public.sessions set gym_id=candidate.gym_id,source_plan_id=candidate.source_plan_id,
    source_plan_use_id=candidate.source_plan_use_id,status=candidate.status,started_at=candidate.started_at,
    completed_at=candidate.completed_at,duration_sec=candidate.duration_sec,deleted_at=candidate.deleted_at,
    created_at=candidate.created_at,updated_at=candidate.updated_at,client_updated_at_ms=stamp where owner_user_id=u and id=s.id;
  perform app_public.workout_fence_graph(s.id,p_id,input_hash);
  perform set_config('boga.exercise_merge_internal',coalesce(previous,''),true);
  return jsonb_build_object('accepted',true);
end $$;
revoke all on function app_public.workout_commit_lifecycle(text,bigint,jsonb,bigint) from public,anon,authenticated,service_role;

create function app_public.exercise_merge_status(p_id text,p_row jsonb)
returns jsonb language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.exercise_merge_user(); result jsonb;
begin
  select jsonb_build_object('id',id,'sequence',sequence,'sessionId',session_id,
    'workoutRevision',workout_revision,'matchesInput',
    input_hash=md5((p_row-'owner_user_id'-'server_received_at'-'client_updated_at_ms'-'updated_at')::text))
    into result from public.exercise_merge_operations where user_id=u and id=p_id and workout_revision is not null;
  return result;
end $$;
revoke all on function app_public.exercise_merge_status(text,jsonb) from public,anon;
grant execute on function app_public.exercise_merge_status(text,jsonb) to authenticated;

do $migration$
declare original text; revised text; section text; marker text:='elsif _type = ''sessions'' then'; start_at integer; end_at integer;
begin
  original:=pg_get_functiondef('app_public.sync_push(jsonb)'::regprocedure);
  start_at:=strpos(original,marker);
  if start_at=0 then raise exception 'Cannot locate session sync branch'; end if;
  end_at:=strpos(substr(original,start_at+length(marker)),E'\n    elsif ');
  if end_at=0 then raise exception 'Cannot bound session sync branch'; end if;
  section:=substr(original,start_at,length(marker)+end_at-1);
  revised:=regexp_replace(section,'(owner_user_id,[[:space:]]*id,)','\1 merge_revision,');
  revised:=regexp_replace(revised,'(_uid,[[:space:]]*_id,)','\1 coalesce((_fields ->> ''merge_revision'')::bigint,0),');
  revised:=regexp_replace(revised,'(do update[[:space:]]+set[[:space:]]+)','\1merge_revision = excluded.merge_revision, ');
  if (length(revised)-length(replace(revised,'merge_revision','')))/length('merge_revision')<>4 then
    raise exception 'Cannot patch session revision columns'; end if;
  original:=replace(original,section,revised);
  revised:=replace(original,'_ok_payload       jsonb;',E'_ok_payload       jsonb;\n  _workout_prepared jsonb;');
  if revised=original then raise exception 'Cannot declare prepared workout batch'; end if;
  original:=revised;
  revised:=replace(original,'for _idx in 0 .. _len - 1 loop',
    E'_workout_prepared := app_public.workout_prepare_push(_entities);\n  _entities := _workout_prepared->''entities'';\n  _len := jsonb_array_length(_entities);\n  for _idx in 0 .. _len - 1 loop');
  if revised=original then raise exception 'Cannot prepare workout batch'; end if;
  original:=revised;
  revised:=replace(original,'app_public.exercise_merge_push_outcomes(_entities)',E'(_workout_prepared-''entities'')');
  if revised=original then raise exception 'Cannot return workout outcomes'; end if;
  execute revised;

  original:=pg_get_functiondef('app_public.sync_pull(jsonb)'::regprocedure);
  revised:=replace(original,'''gym_id'', s.gym_id,','''merge_revision'', s.merge_revision, ''gym_id'', s.gym_id,');
  if revised=original then raise exception 'Cannot project session revision'; end if;
  execute revised;

  original:=pg_get_functiondef('app_public.agent_workout_mutate(uuid,text,timestamptz,text,text,text,jsonb)'::regprocedure);
  revised:=replace(original,'result:=result||jsonb_build_object(',
    E'perform app_public.workout_fence_graph(s.id);\n  select * into s from app_public.sessions where owner_user_id=p_owner and id=s.id;\n  result:=result||jsonb_build_object(');
  if revised=original then raise exception 'Cannot fence agent workout'; end if;
  execute revised;

  original:=pg_get_functiondef('app_public.exercise_merge_snapshot(bigint,integer,text)'::regprocedure);
  revised:=replace(original,'select distinct session_id id from app_public.session_exercises where owner_user_id=u and id in(select block_id from changed)',
    E'select distinct session_id id from app_public.session_exercises where owner_user_id=u and id in(select block_id from changed)\n    union select o.session_id from public.exercise_merge_operations o where o.user_id=u and o.sequence>p_after and o.session_id is not null');
  if revised=original then raise exception 'Cannot snapshot empty workouts'; end if;
  execute revised;
end $migration$;

-- Missing offline parents and session metadata use the same review UI and
-- durable payloads as merged history; children remain blocked until a parent exists.
create function app_public.workout_review_item(p_id text)
returns jsonb language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.exercise_merge_user(); c public.exercise_merge_conflicts; s app_public.sessions;
  saved jsonb; current_row jsonb; parent jsonb; name text; token text; invalid boolean:=false; notice text;
begin
  select * into c from public.exercise_merge_conflicts where user_id=u and id=p_id and resolved_at is null;
  if not found then return null; end if;
  select * into s from app_public.sessions where owner_user_id=u and id=c.session_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  saved:=c.saved||jsonb_build_object('merge_revision',s.merge_revision);
  if c.entity_type='sessions' then
    current_row:=to_jsonb(s)-'owner_user_id'-'server_received_at'; name:='Workout';
    current_row:=current_row||jsonb_build_object('gym_name',(select g.name from app_public.gyms g where g.owner_user_id=u and g.id=s.gym_id));
    saved:=saved||jsonb_build_object('gym_name',(select g.name from app_public.gyms g where g.owner_user_id=u and g.id=c.saved->>'gym_id'));
    if saved->>'status' is distinct from s.status or (saved->>'deleted_at')::bigint is distinct from s.deleted_at then
      notice:='Applying saved metadata keeps the workout in its current lifecycle. Reopen or restore it explicitly in the app.';
    end if;
    saved:=saved||jsonb_build_object('status',s.status,'deleted_at',s.deleted_at,
      'completed_at',case when c.saved->>'status'='completed'
        then coalesce((c.saved->>'completed_at')::bigint,s.completed_at) else s.completed_at end);
    if c.saved->>'status'='completed' and s.status='active' then
      invalid:=true;
      notice:='Finish this workout in the app before applying its saved Start and End.';
    end if;
    if s.status='completed' then
      invalid:=(saved->>'completed_at')::bigint<(saved->>'started_at')::bigint;
      saved:=saved||jsonb_build_object('duration_sec',greatest(0,floor(((saved->>'completed_at')::bigint-
        (saved->>'started_at')::bigint)/1000.0))::integer);
    else saved:=saved||jsonb_build_object('duration_sec',s.duration_sec); end if;
  elsif c.entity_type='session_exercises' then
    select d.name into name from app_public.exercise_definitions d
      where d.owner_user_id=u and d.id=c.saved->>'exercise_definition_id';
    invalid:=name is null or s.deleted_at is not null;
    notice:=case when s.deleted_at is not null then 'Restore this workout in the app before applying saved exercises.'
      else 'This exercise was added offline. Applying it adds the exercise to the current workout.' end;
  else
    select p.saved into parent from public.exercise_merge_conflicts p where p.user_id=u
      and p.entity_type='session_exercises' and p.entity_id=c.block_id and p.resolved_at is null
      order by p.created_at desc,p.id limit 1;
    name:=coalesce(parent->>'name','Saved exercise'); invalid:=true;
    notice:='Apply the saved exercise before applying its sets or tags.';
  end if;
  token:=md5(to_jsonb(s)::text||coalesce(current_row::text,'null')||saved::text||coalesce(parent::text,'null')||
    app_public.agent_workout_revision(u,s.id));
  return jsonb_build_object('id',c.id,'type',c.entity_type,'entityId',c.entity_id,'blockId',c.block_id,
    'sessionId',s.id,'exerciseName',coalesce(name,c.saved->>'name','Saved exercise'),
    'sessionStartedAt',s.started_at,'current',current_row,'saved',saved,'token',token,'invalid',invalid,'notice',notice);
end $$;
revoke all on function app_public.workout_review_item(text) from public,anon,authenticated,service_role;

create function app_public.workout_resolve_missing(p_id text,p_keep boolean,p_token text)
returns void language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.exercise_merge_user(); c public.exercise_merge_conflicts; item jsonb;
  s app_public.sessions; candidate jsonb; stamp bigint; previous text:=current_setting('boga.exercise_merge_internal',true);
begin
  perform pg_advisory_xact_lock(hashtextextended('exercise-merge:'||u::text,0));
  select * into c from public.exercise_merge_conflicts where user_id=u and id=p_id;
  item:=app_public.workout_review_item(p_id);
  if item->>'token' is distinct from p_token then raise exception 'MERGE_STALE: review changed'; end if;
  if not p_keep then
    if (item->>'invalid')::boolean then raise exception 'VALIDATION: apply the parent exercise first or correct saved values'; end if;
    perform app_public.workout_fence_graph(c.session_id);
    select * into s from app_public.sessions where owner_user_id=u and id=c.session_id;
    stamp:=s.client_updated_at_ms;
    perform set_config('boga.exercise_merge_internal','on',true);
    if c.entity_type='sessions' then
      update app_public.sessions set gym_id=item->'saved'->>'gym_id',
        started_at=(item->'saved'->>'started_at')::bigint,
        completed_at=(item->'saved'->>'completed_at')::bigint,
        duration_sec=(item->'saved'->>'duration_sec')::integer,
        updated_at=stamp where owner_user_id=u and id=s.id;
    else
      candidate:=item->'saved'||jsonb_build_object('owner_user_id',u,'session_id',s.id,
        'merge_revision',s.merge_revision,'client_updated_at_ms',stamp,'server_received_at',now(),
        'created_at',coalesce((item->'saved'->>'created_at')::bigint,stamp),'updated_at',stamp);
      candidate:=app_public.exercise_merge_place_row('session_exercises',candidate,stamp);
      insert into app_public.session_exercises select (jsonb_populate_record(null::app_public.session_exercises,candidate)).*;
    end if;
    perform set_config('boga.exercise_merge_internal',coalesce(previous,''),true);
  elsif c.entity_type='session_exercises' then
    -- Keeping an absent parent also declines the dependent graph explicitly.
    update public.exercise_merge_conflicts set resolved_at=now(),saved='{}',
      resolution_hash=md5(jsonb_build_array(true,p_token)::text)
      where user_id=u and block_id=c.entity_id and entity_type in('exercise_sets','session_exercise_tags') and resolved_at is null;
  end if;
  update public.exercise_merge_conflicts set resolved_at=now(),saved='{}',
    resolution_hash=md5(jsonb_build_array(p_keep,p_token)::text) where user_id=u and id=p_id;
end $$;
revoke all on function app_public.workout_resolve_missing(text,boolean,text) from public,anon,authenticated,service_role;

-- Legacy history transfers keep their factors/receipts. Once a workout has
-- been protected, their existing fence also invalidates old lifecycle input.
do $migration$
declare original text; revised text; epoch_query text:=E'\n  select coalesce(jsonb_object_agg(id,epoch),''{}''::jsonb) into workout_epochs from (\n    select s.id,greatest(s.merge_revision,coalesce((select max(epoch_block.merge_revision) from app_public.session_exercises epoch_block\n      where epoch_block.owner_user_id=u and epoch_block.session_id=s.id),0))+1 epoch\n    from app_public.sessions s where s.owner_user_id=u and s.merge_revision>0) epochs;\n';
begin
  original:=pg_get_functiondef('app_public.exercise_merge_execute(text,text,text,text)'::regprocedure);
  revised:=replace(original,'seq bigint; stamp bigint;','workout_epochs jsonb; seq bigint; stamp bigint;');
  if revised=original then raise exception 'Cannot declare merge workout epochs'; end if;
  original:=revised;
  revised:=replace(original,'for b in select se.*',epoch_query||'  for b in select se.*');
  if revised=original then raise exception 'Cannot snapshot merge workout epochs'; end if;
  original:=revised;
  revised:=replace(original,'b.merge_revision+1','coalesce((workout_epochs->>b.session_id)::bigint,b.merge_revision+1)');
  if revised=original then raise exception 'Cannot share merge workout epoch'; end if;
  original:=revised;
  revised:=replace(original,'update public.exercise_merge_operations set created_at=clock_timestamp()',
    E'update app_public.sessions s set merge_revision=(workout_epochs->>s.id)::bigint,\n    client_updated_at_ms=greatest(s.client_updated_at_ms+1,stamp) where s.owner_user_id=u and workout_epochs ? s.id\n    and s.id in(select session_id from app_public.session_exercises where owner_user_id=u and id=any(moved));\n  update public.exercise_merge_operations set created_at=clock_timestamp()');
  if revised=original then raise exception 'Cannot fence merged session'; end if;
  execute revised;

  original:=pg_get_functiondef('app_public.exercise_merge_resolve(text,boolean,text)'::regprocedure);
  revised:=replace(original,'candidate jsonb; columns text;','workout_epochs jsonb; candidate jsonb; columns text;');
  if revised=original then raise exception 'Cannot declare review workout epochs'; end if;
  original:=revised;
  revised:=replace(original,'for sibling in select *',epoch_query||'    for sibling in select *');
  if revised=original then raise exception 'Cannot snapshot review workout epochs'; end if;
  original:=revised;
  revised:=replace(original,'sibling.merge_revision+1',
    'coalesce((workout_epochs->>sibling.session_id)::bigint,sibling.merge_revision+1)');
  if revised=original then raise exception 'Cannot share review workout epoch'; end if;
  original:=revised;
  revised:=replace(original,'candidate:=coalesce(nullif(item->''current''',
    E'update app_public.sessions s set merge_revision=(workout_epochs->>s.id)::bigint,\n      client_updated_at_ms=greatest(s.client_updated_at_ms+1,stamp) where s.owner_user_id=u and s.id=b.session_id and workout_epochs ? s.id;\n    candidate:=coalesce(nullif(item->''current''');
  if revised=original then raise exception 'Cannot fence reviewed session'; end if;
  execute revised;

  original:=pg_get_functiondef('app_public.exercise_merge_review_item(text)'::regprocedure);
  revised:=replace(original,'''invalid'',invalid or saved_row is null)',
    E'''invalid'',invalid or saved_row is null or exists(select 1 from app_public.sessions where owner_user_id=u and id=b.session_id and deleted_at is not null)\n      or (c.entity_type<>''session_exercises'' and b.deleted_at is not null),\n    ''notice'',case when exists(select 1 from app_public.sessions where owner_user_id=u and id=b.session_id and deleted_at is not null)\n      then ''Restore this workout before applying saved changes.'' when c.entity_type<>''session_exercises'' and b.deleted_at is not null\n      then ''Restore the exercise before applying its saved sets or tags.'' else null end)');
  if revised=original then raise exception 'Cannot review removed workout parents'; end if;
  execute revised;
end $migration$;

create or replace function app_public.exercise_merge_review(p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.exercise_merge_user(); items jsonb; n integer;
begin
  if p_offset<0 then raise exception 'VALIDATION'; end if;
  select count(*) into n from public.exercise_merge_conflicts where user_id=u and resolved_at is null;
  select coalesce(jsonb_agg(app_public.exercise_merge_review_item(x.id) order by x.rank,x.created_at,x.id),'[]')
    into items from(select c.*,case entity_type when 'sessions' then 0 when 'session_exercises' then 1
      when 'exercise_sets' then 2 else 3 end rank from public.exercise_merge_conflicts c
      where user_id=u and resolved_at is null order by rank,created_at,id offset p_offset limit 100) x;
  return jsonb_build_object('items',items,'hasMore',p_offset+jsonb_array_length(items)<n);
end $$;

do $$
declare original text; revised text;
begin
  original:=pg_get_functiondef('app_public.exercise_merge_review_item(text)'::regprocedure);
  revised:=replace(original,'select * into b from app_public.session_exercises where owner_user_id=u and id=c.block_id;',
    E'if c.entity_type=''sessions'' then return app_public.workout_review_item(p_id); end if;\n  select * into b from app_public.session_exercises where owner_user_id=u and id=c.block_id;');
  if revised=original then raise exception 'Cannot review session metadata'; end if;
  original:=revised;
  revised:=replace(original,'if not found then raise exception ''NOT_FOUND''; end if;',
    'if not found then return app_public.workout_review_item(p_id); end if;');
  if revised=original then raise exception 'Cannot review missing parent'; end if;
  execute revised;

  original:=pg_get_functiondef('app_public.exercise_merge_resolve(text,boolean,text)'::regprocedure);
  revised:=replace(original,'item:=app_public.exercise_merge_review_item(p_id);',
    E'if c.entity_type=''sessions'' or not exists(select 1 from app_public.session_exercises where owner_user_id=u and id=c.block_id) then\n    perform app_public.workout_resolve_missing(p_id,p_keep,p_token); return;\n  end if;\n  item:=app_public.exercise_merge_review_item(p_id);');
  if revised=original then raise exception 'Cannot resolve missing parent'; end if;
  execute revised;
end $$;

create or replace function app_public.require_sync_protocol()
returns void language plpgsql stable set search_path=app_public,pg_temp as $$
declare headers jsonb:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
begin
  if headers->>'x-boga-sync-protocol' is distinct from '7' then
    raise exception 'UPDATE_REQUIRED: sync protocol 7 is required' using errcode='P0001';
  end if;
end $$;

-- Only the owner app manages this independent, grant-bound authorization.
grant select,insert,update,delete on public.agent_workout_permissions to authenticated;
create policy agent_workout_permissions_owner on public.agent_workout_permissions
  for all to authenticated using(owner_user_id=(select auth.uid())) with check(owner_user_id=(select auth.uid()));
create policy agent_workout_permissions_direct_app_only on public.agent_workout_permissions
  as restrictive for all to authenticated using(((select auth.jwt())->>'client_id') is null)
  with check(((select auth.jwt())->>'client_id') is null);
