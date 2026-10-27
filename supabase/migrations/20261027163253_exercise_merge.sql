-- Owner-private, one-time history merges. The protected revision precedes LWW.
alter table app_public.session_exercises add column merge_revision bigint not null default 0;
alter table app_public.exercise_sets add column merge_revision bigint not null default 0;
alter table app_public.session_exercise_tags add column merge_revision bigint not null default 0;

create table public.exercise_merge_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  sequence bigint not null,
  source_id text,
  destination_id text,
  input_hash text not null,
  set_count bigint not null,
  created_at timestamptz not null default now(),
  primary key(user_id,id),
  unique(user_id,sequence)
);
create table public.exercise_merge_contexts (
  user_id uuid not null references auth.users(id) on delete cascade,
  block_id text not null,
  revision bigint not null,
  operation_id text not null,
  source_id text,
  destination_id text,
  factor numeric not null,
  primary key(user_id,block_id,revision),
  foreign key(user_id,operation_id) references public.exercise_merge_operations(user_id,id)
);
create table public.exercise_merge_conflicts (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  block_id text not null,
  entity_type text not null,
  entity_id text not null,
  revision bigint not null,
  saved jsonb not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_hash text,
  primary key(user_id,id)
);
alter table public.exercise_merge_operations enable row level security;
alter table public.exercise_merge_contexts enable row level security;
alter table public.exercise_merge_conflicts enable row level security;
revoke all on public.exercise_merge_operations,public.exercise_merge_contexts,public.exercise_merge_conflicts
  from public,anon,authenticated,service_role;

create function app_public.exercise_merge_user()
returns uuid language plpgsql stable set search_path=app_public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if auth.jwt()->>'client_id' is not null then raise exception 'AGENT_FORBIDDEN'; end if;
  return auth.uid();
end $$;
revoke all on function app_public.exercise_merge_user() from public;
grant execute on function app_public.exercise_merge_user() to authenticated,service_role;

create function app_public.exercise_merge_lock()
returns trigger language plpgsql set search_path=app_public,pg_temp as $$
begin
  if auth.uid() is not null then
    perform pg_advisory_xact_lock(hashtextextended('exercise-merge:'||auth.uid()::text,0));
  end if;
  return null;
end $$;
revoke all on function app_public.exercise_merge_lock() from public,anon,authenticated;

-- Statement locks precede tuple locks, including direct app table writes.
do $$
declare t text;
begin
  foreach t in array array['exercise_definitions','exercise_muscle_mappings','exercise_group_links',
    'exercise_tag_definitions','sessions','session_exercises','exercise_sets','session_exercise_tags'] loop
    execute format('create trigger exercise_merge_writer_lock before insert or update or delete on app_public.%I
      for each statement execute function app_public.exercise_merge_lock()',t);
  end loop;
end $$;

create function app_public.exercise_merge_save_conflict(p_type text,p_row jsonb)
returns text language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.exercise_merge_user(); b text; r bigint; k text; existing_parent text;
begin
  if p_type not in ('session_exercises','exercise_sets','session_exercise_tags') then
    raise exception 'VALIDATION: invalid conflict entity';
  end if;
  if p_row ? 'owner_user_id' and p_row->>'owner_user_id' is distinct from u::text then
    raise exception 'NOT_FOUND';
  end if;
  b:=case when p_type='session_exercises' then p_row->>'id' else p_row->>'session_exercise_id' end;
  r:=coalesce((p_row->>'merge_revision')::bigint,0);
  if not exists(select 1 from public.exercise_merge_contexts
    where user_id=u and block_id=b and revision>r) then
    raise exception 'VALIDATION: history context has not changed';
  end if;
  if r<0 or jsonb_typeof(p_row)<>'object' or coalesce(p_row->>'id','')='' then raise exception 'VALIDATION'; end if;
  if p_type<>'session_exercises' then
    execute format('select session_exercise_id from app_public.%I where owner_user_id=$1 and id=$2',p_type)
      into existing_parent using u,p_row->>'id';
    if existing_parent is not null and existing_parent<>b then
      p_row:=p_row||jsonb_build_object('merge_original_id',p_row->>'id','id','merge_review_'||md5(p_type||p_row::text));
    end if;
  end if;
  p_row:=p_row-'owner_user_id'-'server_received_at';
  k:=md5(p_type||':'||p_row::text);
  insert into public.exercise_merge_conflicts(user_id,id,block_id,entity_type,entity_id,revision,saved)
    values(u,k,b,p_type,p_row->>'id',r,p_row) on conflict do nothing;
  return k;
end $$;
revoke all on function app_public.exercise_merge_save_conflict(text,jsonb) from public,anon;
grant execute on function app_public.exercise_merge_save_conflict(text,jsonb) to authenticated;

create function app_public.exercise_merge_guard()
returns trigger language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=auth.uid(); b text; expected bigint; supplied bigint; row_value jsonb; old_block text; old_revision bigint;
begin
  -- Trusted migrations, fixture setup and account wipe retain their existing access.
  if u is null or current_setting('boga.exercise_merge_internal',true)='on' then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  perform app_public.exercise_merge_user();
  row_value:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  b:=case when tg_table_name='session_exercises' then row_value->>'id'
    else row_value->>'session_exercise_id' end;
  select coalesce(max(revision),0) into expected from public.exercise_merge_contexts
    where user_id=u and block_id=b;
  supplied:=coalesce((row_value->>'merge_revision')::bigint,0);
  if tg_op='UPDATE' then
    old_block:=case when tg_table_name='session_exercises' then old.id else to_jsonb(old)->>'session_exercise_id' end;
    select coalesce(max(revision),0) into old_revision from public.exercise_merge_contexts
      where user_id=u and block_id=old_block;
    if old_revision>0 and (old_block is distinct from b or old.id is distinct from new.id
      or (tg_table_name='session_exercises' and to_jsonb(old)->>'session_id' is distinct from to_jsonb(new)->>'session_id')) then
      raise exception 'MERGE_REVIEW_REQUIRED: protected rows cannot be reparented';
    end if;
  end if;
  if expected>0 and current_setting('boga.exercise_merge_sync',true) is distinct from 'on' then
    raise exception 'MERGE_REVIEW_REQUIRED: use revision-aware sync for protected history';
  end if;

  if tg_op='DELETE' and expected>0 then
    raise exception 'MERGE_REVIEW_REQUIRED: refresh history before removing it';
  end if;
  if tg_op='DELETE' then return old; end if;
  if supplied<expected then
    perform app_public.exercise_merge_save_conflict(tg_table_name,row_value);
    return null;
  end if;
  if supplied<>expected then raise exception 'VALIDATION: invalid merge revision'; end if;
  return new;
end $$;
revoke all on function app_public.exercise_merge_guard() from public,anon,authenticated;

do $$
declare t text;
begin
  foreach t in array array['session_exercises','exercise_sets','session_exercise_tags'] loop
    execute format('create trigger exercise_merge_context_guard before insert or update or delete on app_public.%I
      for each row execute function app_public.exercise_merge_guard()',t);
  end loop;
end $$;

-- A parent hard delete must not cascade through revision guards without a context.
create function app_public.exercise_merge_parent_delete_guard()
returns trigger language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  if auth.uid() is not null and current_setting('boga.exercise_merge_internal',true) is distinct from 'on'
    and exists(select 1 from app_public.session_exercises b join public.exercise_merge_contexts c
      on c.user_id=b.owner_user_id and c.block_id=b.id where b.owner_user_id=auth.uid()
      and (tg_table_name='sessions' and b.session_id=old.id
        or tg_table_name='exercise_definitions' and b.exercise_definition_id=old.id)) then
    raise exception 'MERGE_REVIEW_REQUIRED: protected history cannot be hard deleted';
  end if;
  return old;
end $$;
revoke all on function app_public.exercise_merge_parent_delete_guard() from public,anon,authenticated;
create trigger exercise_merge_parent_guard before delete on app_public.sessions
  for each row execute function app_public.exercise_merge_parent_delete_guard();
create trigger exercise_merge_parent_guard before delete on app_public.exercise_definitions
  for each row execute function app_public.exercise_merge_parent_delete_guard();

create function app_public.exercise_merge_weight(p_value text,p_factor numeric)
returns text language plpgsql immutable set search_path=app_public,pg_temp as $$
declare n numeric; result text;
begin
  if p_factor=1 or p_value is null or btrim(p_value)='' then return p_value; end if;
  if btrim(p_value)!~'^[0-9]*\.?[0-9]*$' or btrim(p_value)!~'[0-9]' then
    raise exception 'VALIDATION: a stored weight is invalid';
  end if;
  n:=btrim(p_value)::numeric*p_factor;
  if n>1.7976931348623157e308::numeric then raise exception 'VALIDATION: a converted weight is too large'; end if;
  result:=n::text;
  if position('.' in result)>0 then result:=rtrim(rtrim(result,'0'),'.'); end if;
  return result;
end $$;
revoke all on function app_public.exercise_merge_weight(text,numeric) from public,anon,authenticated;

create function app_public.exercise_merge_preview(p_source text,p_destination text)
returns jsonb language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.exercise_merge_user(); a app_public.exercise_definitions;
  b app_public.exercise_definitions; graph jsonb; token text; n bigint; factor numeric; invalid_session text; weight_row jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('exercise-merge:'||u::text,0));
  select * into a from app_public.exercise_definitions where owner_user_id=u and id=p_source and deleted_at is null;
  select * into b from app_public.exercise_definitions where owner_user_id=u and id=p_destination and deleted_at is null;
  if a.id is null or b.id is null then raise exception 'NOT_FOUND'; end if;
  if a.id=b.id then raise exception 'VALIDATION: choose another exercise'; end if;
  factor:=case when a.load_input_mode=b.load_input_mode then 1 when a.load_input_mode='total_load' then 0.5 else 2 end;
  with selected as (
    select se.* from app_public.session_exercises se join app_public.sessions s
      on s.owner_user_id=se.owner_user_id and s.id=se.session_id
    where se.owner_user_id=u and se.exercise_definition_id=a.id and se.deleted_at is null
      and s.status='completed' and s.deleted_at is null
  ), all_blocks as (
    select * from app_public.session_exercises where owner_user_id=u and session_id in(select session_id from selected)
  ), rows as (
    select 'session_exercises' t,to_jsonb(x) j from all_blocks x
    union all select 'exercise_sets',to_jsonb(x) from app_public.exercise_sets x join all_blocks s on s.id=x.session_exercise_id where x.owner_user_id=u
    union all select 'session_exercise_tags',to_jsonb(x) from app_public.session_exercise_tags x join all_blocks s on s.id=x.session_exercise_id where x.owner_user_id=u
    union all select 'sessions',to_jsonb(x) from app_public.sessions x where x.owner_user_id=u and x.id in(select session_id from selected)
    union all select 'exercise_tag_definitions',to_jsonb(x) from app_public.exercise_tag_definitions x where x.owner_user_id=u and x.exercise_definition_id in(a.id,b.id)
    union all select 'exercise_muscle_mappings',to_jsonb(x) from app_public.exercise_muscle_mappings x where x.owner_user_id=u and x.exercise_definition_id in(a.id,b.id)
    union all select 'exercise_group_links',to_jsonb(x) from app_public.exercise_group_links x where x.owner_user_id=u and x.exercise_definition_id in(a.id,b.id)
  )
  select coalesce(jsonb_agg(jsonb_build_array(t,j) order by t,j->>'id'),'[]') into graph from rows;
  token:=md5(to_jsonb(a)::text||to_jsonb(b)::text||graph::text);
  select count(*) into n from jsonb_array_elements(graph) e
    where e->>0='exercise_sets' and e->1->>'deleted_at' is null
      and e->1->>'session_exercise_id' in(
        select se.id from app_public.session_exercises se join app_public.sessions ss
          on ss.owner_user_id=se.owner_user_id and ss.id=se.session_id
        where se.owner_user_id=u and se.exercise_definition_id=a.id and se.deleted_at is null
          and ss.status='completed' and ss.deleted_at is null);
  if factor<>1 then
    -- Validation runs before any mutation, including values of tombstoned child sets.
    for weight_row in select e->1 from jsonb_array_elements(graph) e where e->>0='exercise_sets'
      and e->1->>'session_exercise_id' in(select id from app_public.session_exercises
        where owner_user_id=u and exercise_definition_id=a.id and deleted_at is null)
    loop
      begin
        perform app_public.exercise_merge_weight(weight_row->>'weight_value',factor),
          app_public.exercise_merge_weight(weight_row->>'planned_weight_value',factor);
      exception when others then
        select session_id into invalid_session from app_public.session_exercises
          where owner_user_id=u and id=weight_row->>'session_exercise_id';
        raise exception 'VALIDATION: correct stored weights in session %',invalid_session;
      end;
    end loop;
  end if;
  return jsonb_build_object('sourceId',a.id,'destinationId',b.id,'sourceName',a.name,
    'destinationName',b.name,'setCount',n,'factor',factor,'token',token);
end $$;
revoke all on function app_public.exercise_merge_preview(text,text) from public,anon;
grant execute on function app_public.exercise_merge_preview(text,text) to authenticated;

create function app_public.exercise_merge_execute(p_id text,p_source text,p_destination text,p_token text)
returns jsonb language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.exercise_merge_user(); preview jsonb; receipt public.exercise_merge_operations;
  input_hash text:=md5(jsonb_build_array(p_source,p_destination,p_token)::text);
  seq bigint; stamp bigint; clock_now bigint:=(extract(epoch from clock_timestamp())*1000)::bigint;
  b record; tag record; target_tag text; factor numeric; moved text[]:='{}'::text[]; moving boolean; block_factor numeric;
begin
  if p_id is null or length(p_id)>100 or length(p_id)<10 then raise exception 'VALIDATION: invalid operation id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('exercise-merge:'||u::text,0));
  select * into receipt from public.exercise_merge_operations where user_id=u and id=p_id;
  if found then
    if receipt.input_hash<>input_hash then raise exception 'CONFLICT: operation id already used'; end if;
    return jsonb_build_object('id',receipt.id,'sequence',receipt.sequence,'setCount',receipt.set_count);
  end if;
  perform 1 from app_public.exercise_definitions where owner_user_id=u and id=p_source for update;
  preview:=app_public.exercise_merge_preview(p_source,p_destination);
  if preview->>'token' is distinct from p_token then raise exception 'MERGE_STALE: history changed; review again'; end if;
  factor:=(preview->>'factor')::numeric;
  select coalesce(max(sequence),0)+1 into seq from public.exercise_merge_operations where user_id=u;
  -- Stay ahead of all observed client clocks, including server-clamped future clocks.
  select greatest(clock_now,coalesce(max(v),0)+1) into stamp from (
    select client_updated_at_ms v from app_public.exercise_definitions where owner_user_id=u and id in(p_source,p_destination)
    union all select client_updated_at_ms from app_public.session_exercises where owner_user_id=u
    union all select client_updated_at_ms from app_public.exercise_sets where owner_user_id=u
    union all select client_updated_at_ms from app_public.session_exercise_tags where owner_user_id=u
    union all select client_updated_at_ms from app_public.exercise_tag_definitions where owner_user_id=u
  ) clocks;
  insert into public.exercise_merge_operations(user_id,id,sequence,source_id,destination_id,input_hash,set_count)
    values(u,p_id,seq,p_source,p_destination,input_hash,(preview->>'setCount')::bigint);
  perform set_config('boga.exercise_merge_internal','on',true);
  for b in select se.* from app_public.session_exercises se join app_public.sessions s
    on s.owner_user_id=se.owner_user_id and s.id=se.session_id
    where se.owner_user_id=u and s.status='completed' and s.deleted_at is null
      and se.session_id in(select session_id from app_public.session_exercises
        where owner_user_id=u and exercise_definition_id=p_source and deleted_at is null)
      order by se.id
  loop
    moving:=b.exercise_definition_id=p_source and b.deleted_at is null;
    block_factor:=case when moving then factor else 1 end;
    if moving then moved:=array_append(moved,b.id); end if;
    insert into public.exercise_merge_contexts(user_id,block_id,revision,operation_id,source_id,destination_id,factor)
      values(u,b.id,b.merge_revision+1,p_id,b.exercise_definition_id,
        case when moving then p_destination else b.exercise_definition_id end,block_factor);
    if moving then
    for tag in select distinct td.* from app_public.session_exercise_tags st
      join app_public.exercise_tag_definitions td on td.owner_user_id=st.owner_user_id and td.id=st.exercise_tag_definition_id
      where st.owner_user_id=u and st.session_exercise_id=b.id
    loop
      select id into target_tag from app_public.exercise_tag_definitions
        where owner_user_id=u and exercise_definition_id=p_destination and normalized_name=tag.normalized_name order by id limit 1;
      if target_tag is null then
        target_tag:='merge_tag_'||gen_random_uuid()::text;
        insert into app_public.exercise_tag_definitions(owner_user_id,id,exercise_definition_id,name,normalized_name,
          created_at,updated_at,deleted_at,client_updated_at_ms)
          values(u,target_tag,p_destination,tag.name,tag.normalized_name,clock_now,clock_now,tag.deleted_at,stamp);
      end if;
      update app_public.session_exercise_tags set exercise_tag_definition_id=target_tag,merge_revision=b.merge_revision+1,
        client_updated_at_ms=stamp where owner_user_id=u and session_exercise_id=b.id and exercise_tag_definition_id=tag.id;
    end loop;
    end if;
    update app_public.session_exercises set
      exercise_definition_id=case when moving then p_destination else b.exercise_definition_id end,
      name=case when moving then preview->>'destinationName' else b.name end,
      merge_revision=b.merge_revision+1,updated_at=clock_now,client_updated_at_ms=stamp where owner_user_id=u and id=b.id;
    update app_public.exercise_sets set weight_value=app_public.exercise_merge_weight(weight_value,block_factor),
      planned_weight_value=app_public.exercise_merge_weight(planned_weight_value,block_factor),merge_revision=b.merge_revision+1,
      updated_at=clock_now,client_updated_at_ms=stamp where owner_user_id=u and session_exercise_id=b.id;
    -- Tags without definitions still receive their context, without being revived.
    update app_public.session_exercise_tags set merge_revision=b.merge_revision+1,client_updated_at_ms=stamp
      where owner_user_id=u and session_exercise_id=b.id;
  end loop;
  update public.exercise_merge_operations set created_at=clock_timestamp() where user_id=u and id=p_id;
  if factor<>1 then
    begin
    update app_public.group_metric_certifications c set ended_at=greatest(clock_timestamp(),c.certified_at),end_reason='voided'
      where c.member_user_id=u and c.ended_at is null and c.set_id in(
        select id from app_public.exercise_sets where owner_user_id=u and session_exercise_id=any(moved));
    update app_public.group_certifications c set ended_at=greatest(clock_timestamp(),c.certified_at),end_reason='voided'
      where c.member_user_id=u and c.ended_at is null and c.set_id in(
        select id from app_public.exercise_sets where owner_user_id=u and session_exercise_id=any(moved));
    exception when others then
      begin
        perform app_public.group_eval_log_failure('group.merge_certification_correction_failed',u,
          jsonb_build_object('sqlstate',SQLSTATE));
      exception when others then null; end;
    end;
  end if;
  update app_public.exercise_definitions set deleted_at=clock_now,updated_at=clock_now,client_updated_at_ms=stamp
    where owner_user_id=u and id=p_source;
  perform set_config('boga.exercise_merge_internal','',true);
  return jsonb_build_object('id',p_id,'sequence',seq,'setCount',(preview->>'setCount')::bigint);
end $$;
revoke all on function app_public.exercise_merge_execute(text,text,text,text) from public,anon;
grant execute on function app_public.exercise_merge_execute(text,text,text,text) to authenticated;

create function app_public.exercise_merge_status(p_id text)
returns jsonb language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.exercise_merge_user(); result jsonb;
begin
  select jsonb_build_object('id',id,'sequence',sequence,'setCount',set_count)
    into result from public.exercise_merge_operations where user_id=u and id=p_id;
  return result;
end $$;
revoke all on function app_public.exercise_merge_status(text) from public,anon;
grant execute on function app_public.exercise_merge_status(text) to authenticated;

-- Keep the existing invoker/RLS dispatcher; extend its typed columns and ack.
do $migration$
declare definition text; section text; revised text; t text; marker text; start_at int; end_at int;
begin
  definition:=pg_get_functiondef('app_public.sync_push(jsonb)'::regprocedure);
  foreach t in array array['session_exercises','exercise_sets','session_exercise_tags'] loop
    marker:='elsif _type = '''||t||''' then';
    start_at:=strpos(definition,marker);
    if start_at=0 then raise exception 'Cannot patch sync_push: %',t; end if;
    end_at:=strpos(substr(definition,start_at+length(marker)),E'\n    elsif ');
    if end_at=0 then end_at:=strpos(substr(definition,start_at+length(marker)),E'\n    else'); end if;
    if end_at=0 then raise exception 'Cannot bound sync branch: %',t; end if;
    section:=substr(definition,start_at,length(marker)+end_at-1);
    revised:=regexp_replace(section,'(owner_user_id,[[:space:]]*id,)','\1 merge_revision,');
    revised:=regexp_replace(revised,'(_uid,[[:space:]]*_id,)','\1 coalesce((_fields ->> ''merge_revision'')::bigint,0),');
    revised:=regexp_replace(revised,'(do update[[:space:]]+set[[:space:]]+)','\1merge_revision = excluded.merge_revision, ');
    if (length(revised)-length(replace(revised,'merge_revision','')))/length('merge_revision')<>4 then
      raise exception 'Cannot patch merge columns exactly once: %',t; end if;
    definition:=replace(definition,section,revised);
  end loop;
  definition:=replace(definition,'for _idx in 0 .. _len - 1 loop',
    E'perform pg_advisory_xact_lock(hashtextextended(''exercise-merge:''||auth.uid()::text,0));\n  perform set_config(''boga.exercise_merge_sync'',''on'',true);\n  for _idx in 0 .. _len - 1 loop');
  definition:=replace(definition,'return _ok_payload;',
    E'perform set_config(''boga.exercise_merge_sync'','''',true);\n  return _ok_payload || app_public.exercise_merge_push_outcomes(_entities);');
  execute definition;
end $migration$;

create function app_public.exercise_merge_push_outcomes(p_entities jsonb)
returns jsonb language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.exercise_merge_user(); outcomes jsonb:='[]'::jsonb; e jsonb; b text; r bigint; expected bigint;
begin
  for e in select value from jsonb_array_elements(p_entities) loop
    b:=case when e->>'type'='session_exercises' then e->>'id' else e->'fields'->>'session_exercise_id' end;
    r:=coalesce((e->'fields'->>'merge_revision')::bigint,0);
    select coalesce(max(revision),0) into expected from public.exercise_merge_contexts where user_id=u and block_id=b;
    outcomes:=outcomes||jsonb_build_array(jsonb_build_object('type',e->>'type','id',e->>'id',
      'outcome',case when e->>'type' in('session_exercises','exercise_sets','session_exercise_tags') and r<expected
        then 'preserved' else 'accepted' end));
  end loop;
  return jsonb_build_object('outcomes',outcomes);
end $$;
revoke all on function app_public.exercise_merge_push_outcomes(jsonb) from public,anon;
grant execute on function app_public.exercise_merge_push_outcomes(jsonb) to authenticated,service_role;

do $$
declare definition text; revised text;
begin
  definition:=pg_get_functiondef('app_public.sync_pull(jsonb)'::regprocedure);
  revised:=replace(definition,'''session_id'', sx.session_id,','''merge_revision'', sx.merge_revision, ''session_id'', sx.session_id,');
  revised:=replace(revised,'''session_exercise_id'', es.session_exercise_id,','''merge_revision'', es.merge_revision, ''session_exercise_id'', es.session_exercise_id,');
  revised:=replace(revised,'''session_exercise_id'', st.session_exercise_id,','''merge_revision'', st.merge_revision, ''session_exercise_id'', st.session_exercise_id,');
  -- The historical tag projection uses the alias setg.
  revised:=replace(revised,'''session_exercise_id'', setg.session_exercise_id,','''merge_revision'', setg.merge_revision, ''session_exercise_id'', setg.session_exercise_id,');
  if revised=definition then raise exception 'Cannot patch merge pull columns'; end if;
  execute revised;
end $$;

-- Every context-aware client/importer must upgrade together.
create or replace function app_public.require_sync_protocol()
returns void language plpgsql stable set search_path=app_public,pg_temp as $$
declare headers jsonb:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
begin
  if headers->>'x-boga-sync-protocol' is distinct from '5' then
    raise exception 'UPDATE_REQUIRED: sync protocol 5 is required' using errcode='P0001';
  end if;
end $$;

create function app_public.exercise_merge_wire(p_type text,p_row jsonb)
returns jsonb language sql immutable set search_path=app_public,pg_temp as $$
  select jsonb_build_object('type',p_type,'id',p_row->>'id','client_updated_at_ms',
    (p_row->>'client_updated_at_ms')::bigint,'fields',
    p_row-'id'-'owner_user_id'-'client_updated_at_ms'-'server_received_at');
$$;
revoke all on function app_public.exercise_merge_wire(text,jsonb) from public,anon,authenticated;

-- A fenced snapshot includes FK ancestors and complete affected session graphs.
create function app_public.exercise_merge_snapshot(p_after bigint default 0,p_offset integer default 0,p_token text default null)
returns jsonb language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.exercise_merge_user(); seq bigint; rows jsonb; token text; page jsonb;
begin
  if p_after<0 or p_offset<0 then raise exception 'VALIDATION: invalid snapshot cursor'; end if;
  perform pg_advisory_xact_lock(hashtextextended('exercise-merge:'||u::text,0));
  select coalesce(max(sequence),0) into seq from public.exercise_merge_operations where user_id=u;
  with changed as (
    select distinct c.block_id from public.exercise_merge_contexts c join public.exercise_merge_operations o
      on o.user_id=c.user_id and o.id=c.operation_id where c.user_id=u and o.sequence>p_after
  ), session_ids as (
    select distinct session_id id from app_public.session_exercises where owner_user_id=u and id in(select block_id from changed)
  ), blocks as (
    select * from app_public.session_exercises where owner_user_id=u and session_id in(select id from session_ids)
  ), sets as (
    select * from app_public.exercise_sets where owner_user_id=u and session_exercise_id in(select id from blocks)
  ), plan_block_ids as (
    select source_plan_exercise_id id from blocks where source_plan_exercise_id is not null
    union select p.session_plan_exercise_id from app_public.session_plan_sets p join sets s on s.source_plan_set_id=p.id where p.owner_user_id=u
  ), plan_blocks as (
    select * from app_public.session_plan_exercises where owner_user_id=u and id in(select id from plan_block_ids)
  ), plan_ids as (
    select session_plan_id id from plan_blocks union
    select source_plan_id from app_public.sessions where owner_user_id=u and id in(select id from session_ids) and source_plan_id is not null
  ), plans as (
    select * from app_public.session_plans where owner_user_id=u and id in(select id from plan_ids)
  ), definition_ids as (
    select exercise_definition_id id from blocks union select exercise_definition_id from plan_blocks union
    select source_id from public.exercise_merge_operations where user_id=u and sequence>p_after union
    select destination_id from public.exercise_merge_operations where user_id=u and sequence>p_after
  ), mappings as (
    select * from app_public.exercise_muscle_mappings where owner_user_id=u and exercise_definition_id in(select id from definition_ids)
  ), assignments as (
    select * from app_public.session_exercise_tags where owner_user_id=u and session_exercise_id in(select id from blocks)
  ), all_rows as (
    select 0 layer,'exercise_definitions' t,to_jsonb(x) j from app_public.exercise_definitions x where x.owner_user_id=u and x.id in(select id from definition_ids)
    union all select 0,'muscle_groups',to_jsonb(x) from app_public.muscle_groups x where x.owner_user_id=u and x.id in(select muscle_group_id from mappings)
    union all select 0,'gyms',to_jsonb(x) from app_public.gyms x where x.owner_user_id=u and x.id in(
      select gym_id from app_public.sessions where owner_user_id=u and id in(select id from session_ids) union select gym_id from plans)
    union all select 0,'training_programmes',to_jsonb(x) from app_public.training_programmes x where x.owner_user_id=u and x.id in(select programme_id from plans)
    union all select 1,'session_plans',to_jsonb(x) from plans x
    union all select 1,'exercise_muscle_mappings',to_jsonb(x) from mappings x
    union all select 1,'exercise_tag_definitions',to_jsonb(x) from app_public.exercise_tag_definitions x where x.owner_user_id=u and x.id in(select exercise_tag_definition_id from assignments)
    union all select 2,'sessions',to_jsonb(x) from app_public.sessions x where x.owner_user_id=u and x.id in(select id from session_ids)
    union all select 2,'session_plan_exercises',to_jsonb(x) from plan_blocks x
    union all select 3,'session_plan_sets',to_jsonb(x) from app_public.session_plan_sets x where x.owner_user_id=u and x.id in(select source_plan_set_id from sets)
    union all select 3,'session_exercises',to_jsonb(x) from blocks x
    union all select 4,'exercise_sets',to_jsonb(x) from sets x
    union all select 4,'session_exercise_tags',to_jsonb(x) from assignments x
  )
  select coalesce(jsonb_agg(app_public.exercise_merge_wire(t,j) order by layer,t,j->>'id'),'[]')
    into rows from all_rows;
  token:=md5(seq::text||rows::text);
  if p_token is not null and p_token<>token then raise exception 'MERGE_STALE: snapshot changed'; end if;
  select coalesce(jsonb_agg(e.value order by e.ordinality),'[]') into page
    from jsonb_array_elements(rows) with ordinality e where e.ordinality>p_offset and e.ordinality<=p_offset+200;
  return jsonb_build_object('sequence',seq,'token',token,'rows',page,
    'nextOffset',p_offset+jsonb_array_length(page),'hasMore',p_offset+jsonb_array_length(page)<jsonb_array_length(rows));
end $$;
revoke all on function app_public.exercise_merge_snapshot(bigint,integer,text) from public,anon;
grant execute on function app_public.exercise_merge_snapshot(bigint,integer,text) to authenticated;

create function app_public.exercise_merge_review_item(p_id text)
returns jsonb language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.exercise_merge_user(); c public.exercise_merge_conflicts; current_row jsonb;
  saved_row jsonb; b app_public.session_exercises; factor numeric:=1; conversion_context record; token text; invalid boolean:=false; source_tag app_public.exercise_tag_definitions; target_tag text;
begin
  perform pg_advisory_xact_lock(hashtextextended('exercise-merge:'||u::text,0));
  select * into c from public.exercise_merge_conflicts where user_id=u and id=p_id and resolved_at is null;
  if not found then return null; end if;
  select * into b from app_public.session_exercises where owner_user_id=u and id=c.block_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  execute format('select to_jsonb(x) from app_public.%I x where owner_user_id=$1 and id=$2',c.entity_type)
    into current_row using u,c.entity_id;
  saved_row:=c.saved;
  for conversion_context in select context.factor f from public.exercise_merge_contexts context where user_id=u and block_id=c.block_id
    and revision>coalesce((c.saved->>'merge_weight_revision')::bigint,c.revision) order by revision loop factor:=factor*conversion_context.f; end loop;
  saved_row:=saved_row||jsonb_build_object('merge_revision',b.merge_revision);
  if c.entity_type='exercise_sets' then
    begin
      saved_row:=saved_row||jsonb_build_object(
        'weight_value',app_public.exercise_merge_weight(saved_row->>'weight_value',factor),
        'planned_weight_value',app_public.exercise_merge_weight(saved_row->>'planned_weight_value',factor));
    exception when others then invalid:=true; end;
  elsif c.entity_type='session_exercises' then
    -- Applying an old edit never reverses the transfer's identity.
    saved_row:=saved_row||jsonb_build_object('exercise_definition_id',b.exercise_definition_id,'name',b.name,'session_id',b.session_id);
  elsif c.entity_type='session_exercise_tags' then
    select * into source_tag from app_public.exercise_tag_definitions
      where owner_user_id=u and id=c.saved->>'exercise_tag_definition_id';
    select id into target_tag from app_public.exercise_tag_definitions where owner_user_id=u
      and exercise_definition_id=b.exercise_definition_id and normalized_name=source_tag.normalized_name order by id limit 1;
    saved_row:=saved_row||jsonb_build_object('exercise_tag_definition_id',coalesce(target_tag,source_tag.id),
      'tag_name',source_tag.name);
    current_row:=current_row||jsonb_build_object('tag_name',(select name from app_public.exercise_tag_definitions
      where owner_user_id=u and id=current_row->>'exercise_tag_definition_id'));
    invalid:=source_tag.id is null;
  end if;
  token:=md5(coalesce((select to_jsonb(d)::text from app_public.exercise_definitions d
      where d.owner_user_id=u and d.id=b.exercise_definition_id),'null')||
    coalesce(current_row::text,'null')||coalesce(saved_row::text,'null')||to_jsonb(b)::text||
    coalesce((select to_jsonb(x)::text from app_public.sessions x where x.owner_user_id=u and x.id=b.session_id),'null')||
    coalesce((select jsonb_agg(to_jsonb(x) order by x.id)::text from app_public.session_exercises x
      where x.owner_user_id=u and x.session_id=b.session_id),'[]')||
    coalesce((select jsonb_agg(to_jsonb(x) order by x.id)::text from app_public.exercise_sets x
      where x.owner_user_id=u and x.session_exercise_id in(select id from app_public.session_exercises
        where owner_user_id=u and session_id=b.session_id)),'[]'));
  return jsonb_build_object('id',c.id,'type',c.entity_type,'entityId',c.entity_id,'blockId',b.id,
    'sessionId',b.session_id,'exerciseName',coalesce((select name from app_public.exercise_definitions where owner_user_id=u and id=b.exercise_definition_id),b.name),'sessionStartedAt',(select started_at from app_public.sessions where owner_user_id=u and id=b.session_id),'current',current_row-'owner_user_id'-'server_received_at',
    'saved',saved_row,'token',token,'invalid',invalid or saved_row is null);
end $$;
revoke all on function app_public.exercise_merge_review_item(text) from public,anon;
grant execute on function app_public.exercise_merge_review_item(text) to authenticated;

create function app_public.exercise_merge_review(p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.exercise_merge_user(); items jsonb; n integer;
begin
  if p_offset<0 then raise exception 'VALIDATION'; end if;
  select count(*) into n from public.exercise_merge_conflicts where user_id=u and resolved_at is null;
  select coalesce(jsonb_agg(app_public.exercise_merge_review_item(x.id) order by x.created_at,x.id),'[]')
    into items from(select * from public.exercise_merge_conflicts where user_id=u and resolved_at is null
      order by created_at,id offset p_offset limit 100) x;
  return jsonb_build_object('items',items,'hasMore',p_offset+jsonb_array_length(items)<n);
end $$;
revoke all on function app_public.exercise_merge_review(integer) from public,anon;
grant execute on function app_public.exercise_merge_review(integer) to authenticated;

-- Reinsert/reorder a reviewed live row without discarding newer siblings.
create function app_public.exercise_merge_place_row(p_type text,p_row jsonb,p_stamp bigint)
returns jsonb language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.exercise_merge_user(); parent_key text; siblings text[]; requested integer;
  position integer; child text; slot integer:=0;
begin
  if p_type not in('session_exercises','exercise_sets') then return p_row; end if;
  parent_key:=case when p_type='session_exercises' then 'session_id' else 'session_exercise_id' end;

  requested:=greatest(0,coalesce((p_row->>'order_index')::integer,0));
  execute format('select coalesce(array_agg(id order by order_index,id),''{}'') from app_public.%I
    where owner_user_id=$1 and %I=$2 and id<>$3 and deleted_at is null',p_type,parent_key)
    into siblings using u,p_row->>parent_key,p_row->>'id';
  position:=least(requested,cardinality(siblings));
  if p_row->>'deleted_at' is null then
    siblings:=siblings[1:position]||array[p_row->>'id']||siblings[position+1:cardinality(siblings)];
  end if;
  foreach child in array siblings loop
    if child<>p_row->>'id' then
      execute format('update app_public.%I set order_index=$1,client_updated_at_ms=$2 where owner_user_id=$3 and id=$4',p_type)
        using slot,p_stamp,u,child;
    end if;
    slot:=slot+1;
  end loop;

  for child in execute format('select id from app_public.%I where owner_user_id=$1 and %I=$2
    and id<>$3 and deleted_at is not null order by order_index,id',p_type,parent_key)
    using u,p_row->>parent_key,p_row->>'id'
  loop
    execute format('update app_public.%I set order_index=$1,client_updated_at_ms=$2 where owner_user_id=$3 and id=$4',p_type)
      using slot,p_stamp,u,child;
    slot:=slot+1;
  end loop;
  if p_row->>'deleted_at' is not null then position:=slot; end if;
  return p_row||jsonb_build_object('order_index',position);
end $$;
revoke all on function app_public.exercise_merge_place_row(text,jsonb,bigint) from public,anon,authenticated;

create function app_public.exercise_merge_resolve(p_id text,p_keep boolean,p_token text)
returns void language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.exercise_merge_user(); item jsonb; c public.exercise_merge_conflicts;
  candidate jsonb; columns text; updates text; stamp bigint; seq bigint; op text:='resolve:'||p_id;
  b app_public.session_exercises; sibling record;
begin
  perform pg_advisory_xact_lock(hashtextextended('exercise-merge:'||u::text,0));
  if p_keep is null then raise exception 'VALIDATION: choose a resolution'; end if;
  select * into c from public.exercise_merge_conflicts where user_id=u and id=p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if c.resolved_at is not null then
    if c.resolution_hash=md5(jsonb_build_array(p_keep,p_token)::text) then return; end if;
    raise exception 'MERGE_STALE: this change was resolved on another device';
  end if;
  item:=app_public.exercise_merge_review_item(p_id);
  if item->>'token' is distinct from p_token then raise exception 'MERGE_STALE: review changed'; end if;
  if not p_keep then
    if (item->>'invalid')::boolean then raise exception 'VALIDATION: saved values need correction'; end if;
    if c.entity_type<>'session_exercises' and item->'current' is distinct from 'null'::jsonb
      and item->'current'->>'session_exercise_id' is distinct from c.block_id then
      raise exception 'MERGE_STALE: the saved row belongs to another exercise';
    end if;
    select * into b from app_public.session_exercises where owner_user_id=u and id=c.block_id;
    select greatest((extract(epoch from clock_timestamp())*1000)::bigint,coalesce(max(v),0)+1) into stamp from(
      select client_updated_at_ms v from app_public.session_exercises where owner_user_id=u and session_id=b.session_id
      union all select s.client_updated_at_ms from app_public.exercise_sets s join app_public.session_exercises x
        on x.owner_user_id=s.owner_user_id and x.id=s.session_exercise_id where x.owner_user_id=u and x.session_id=b.session_id
    ) clocks;
    select coalesce(max(sequence),0)+1 into seq from public.exercise_merge_operations where user_id=u;
    insert into public.exercise_merge_operations(user_id,id,sequence,source_id,destination_id,input_hash,set_count)
      values(u,op,seq,b.exercise_definition_id,b.exercise_definition_id,md5(p_token),0);
    -- A review commit fences the complete affected session before changing its order.
    perform set_config('boga.exercise_merge_internal','on',true);
    for sibling in select * from app_public.session_exercises where owner_user_id=u and session_id=b.session_id loop
      insert into public.exercise_merge_contexts(user_id,block_id,revision,operation_id,source_id,destination_id,factor)
        values(u,sibling.id,sibling.merge_revision+1,op,sibling.exercise_definition_id,sibling.exercise_definition_id,1);
      update app_public.session_exercises set merge_revision=sibling.merge_revision+1,client_updated_at_ms=stamp
        where owner_user_id=u and id=sibling.id;
      update app_public.exercise_sets set merge_revision=sibling.merge_revision+1,client_updated_at_ms=stamp
        where owner_user_id=u and session_exercise_id=sibling.id;
      update app_public.session_exercise_tags set merge_revision=sibling.merge_revision+1,client_updated_at_ms=stamp
        where owner_user_id=u and session_exercise_id=sibling.id;
    end loop;
    select * into b from app_public.session_exercises where owner_user_id=u and id=c.block_id;
    candidate:=coalesce(nullif(item->'current','null'::jsonb),item->'saved')||coalesce((
      select jsonb_object_agg(key,value) from jsonb_each(item->'saved') where key=any(case c.entity_type
        when 'session_exercises' then array['machine_name','order_index','deleted_at']
        when 'exercise_sets' then array['weight_value','reps_value','planned_weight_value','planned_reps_value',
          'planned_set_type','set_type','performance_status','order_index','deleted_at']
        else array['exercise_tag_definition_id','deleted_at'] end)),'{}'::jsonb)||
      jsonb_build_object('id',c.entity_id,'owner_user_id',u,'client_updated_at_ms',stamp,
        'server_received_at',now(),'merge_revision',b.merge_revision);
    if c.entity_type='session_exercises' then
      candidate:=candidate||jsonb_build_object('session_id',b.session_id,'exercise_definition_id',b.exercise_definition_id,'name',b.name);
    else candidate:=candidate||jsonb_build_object('session_exercise_id',b.id); end if;
    if c.entity_type<>'session_exercise_tags' then
      candidate:=candidate||jsonb_build_object('updated_at',(extract(epoch from now())*1000)::bigint);
    end if;
    if c.entity_type='session_exercise_tags' then
      candidate:=candidate||jsonb_build_object('exercise_tag_definition_id',
        app_public.exercise_merge_destination_tag(c.saved->>'exercise_tag_definition_id',b.exercise_definition_id,stamp));
    end if;
    if c.entity_type='session_exercises' and item->'current' is distinct from 'null'::jsonb then
      candidate:=candidate||jsonb_build_object('source_plan_exercise_id',item->'current'->'source_plan_exercise_id');
    elsif c.entity_type='exercise_sets' and item->'current' is distinct from 'null'::jsonb then
      candidate:=candidate||jsonb_build_object('source_plan_set_id',item->'current'->'source_plan_set_id');
    end if;
    candidate:=app_public.exercise_merge_place_row(c.entity_type,candidate,stamp);
    select string_agg(quote_ident(attname),',' order by attnum),
      string_agg(format('%I=excluded.%I',attname,attname),',' order by attnum) filter(where attname not in('owner_user_id','id'))
      into columns,updates from pg_attribute where attrelid=format('app_public.%I',c.entity_type)::regclass
        and attnum>0 and not attisdropped;
    execute format('insert into app_public.%1$I(%2$s) select %2$s from jsonb_populate_record(null::app_public.%1$I,$1)
      on conflict(owner_user_id,id) do update set %3$s',c.entity_type,columns,updates) using candidate;
    perform set_config('boga.exercise_merge_internal','',true);
  end if;
  update public.exercise_merge_conflicts set resolved_at=now(),saved='{}',
    resolution_hash=md5(jsonb_build_array(p_keep,p_token)::text) where user_id=u and id=p_id;
end $$;
revoke all on function app_public.exercise_merge_resolve(text,boolean,text) from public,anon;
grant execute on function app_public.exercise_merge_resolve(text,boolean,text) to authenticated;

-- Agent/server exercise writers take the same owner lock before locking a row.
do $$
declare p record; definition text; revised text;
begin
  for p in select oid from pg_proc where pronamespace='app_public'::regnamespace
    and proname in('agent_create_exercise','agent_update_exercise','agent_set_exercise_deleted','agent_exercise_lock') loop
    definition:=pg_get_functiondef(p.oid);
    revised:=regexp_replace(definition,E'\\mbegin\\M',E'begin\n  perform pg_advisory_xact_lock(hashtextextended(''exercise-merge:''||p_owner::text,0));','i');
    if revised=definition then raise exception 'Cannot lock agent exercise writer'; end if;
    execute revised;
  end loop;
  definition:=pg_get_functiondef('app_public.dev_wipe_my_data()'::regprocedure);
  revised:=regexp_replace(definition,E'\\mbegin\\M',E'begin\n  perform pg_advisory_xact_lock(hashtextextended(''exercise-merge:''||auth.uid()::text,0));\n  perform set_config(''boga.exercise_merge_internal'',''on'',true);\n  delete from public.exercise_merge_conflicts where user_id=auth.uid();\n  delete from public.exercise_merge_contexts where user_id=auth.uid();\n  delete from public.exercise_merge_operations where user_id=auth.uid();','i');
  if revised=definition then raise exception 'Cannot extend account wipe'; end if;
  execute revised;
end $$;


create function app_public.exercise_merge_sync_state()
returns jsonb language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.exercise_merge_user(); seq bigint; pending bigint;
begin
  select coalesce(max(sequence),0) into seq from public.exercise_merge_operations where user_id=u;
  select count(*) into pending from public.exercise_merge_conflicts where user_id=u and resolved_at is null;
  return jsonb_build_object('merge_sequence',seq,'merge_conflict_count',pending);
end $$;
revoke all on function app_public.exercise_merge_sync_state() from public,anon;
grant execute on function app_public.exercise_merge_sync_state() to authenticated,service_role;
do $$
declare definition text; revised text;
begin
  definition:=pg_get_functiondef('app_public.sync_pull(jsonb)'::regprocedure);
  revised:=replace(definition,E'''has_more'', v_has_more\n  );',
    E'''has_more'', v_has_more\n  ) || app_public.exercise_merge_sync_state();');
  if revised=definition then raise exception 'Cannot add merge sequence to sync pull'; end if;
  execute revised;
end $$;

-- An immutable merge boundary also fences a witness if eager group correction fails.
create function app_public.exercise_merge_witness_ended_at(p_member uuid,p_set text,p_certified timestamptz)
returns timestamptz language sql stable security definer set search_path=app_public,pg_temp as $$
  select min(o.created_at)
    from app_public.exercise_sets s join public.exercise_merge_contexts c
      on c.user_id=s.owner_user_id and c.block_id=s.session_exercise_id
      join public.exercise_merge_operations o on o.user_id=c.user_id and o.id=c.operation_id
    where s.owner_user_id=p_member and s.id=p_set and c.factor<>1 and o.created_at>=p_certified;
$$;
revoke all on function app_public.exercise_merge_witness_ended_at(uuid,text,timestamptz)
  from public,anon,authenticated,service_role;
create function app_public.exercise_merge_witness_ended(p_member uuid,p_set text,p_certified timestamptz)
returns boolean language sql stable security definer set search_path=app_public,pg_temp as $$
  select app_public.exercise_merge_witness_ended_at(p_member,p_set,p_certified) is not null;
$$;
revoke all on function app_public.exercise_merge_witness_ended(uuid,text,timestamptz)
  from public,anon,authenticated,service_role;
do $$
declare p record; definition text; revised text;
begin
  for p in select oid from pg_proc where pronamespace='app_public'::regnamespace and proname in(
    'group_metric_certification_mode_matches','group_legacy_certification_mode_matches') loop
    definition:=pg_get_functiondef(p.oid);
    revised:=replace(definition,'select p_row.source_mode_generation=',
      'select not app_public.exercise_merge_witness_ended(p_row.member_user_id,p_row.set_id,p_row.certified_at) and p_row.source_mode_generation=');
    if revised=definition then raise exception 'Cannot extend witness merge boundary'; end if;
    execute revised;
  end loop;
end $$;

create function app_public.exercise_merge_destination_tag(p_source text,p_destination text,p_stamp bigint)
returns text language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.exercise_merge_user(); source app_public.exercise_tag_definitions; target text;
begin
  select * into source from app_public.exercise_tag_definitions where owner_user_id=u and id=p_source;
  if source.id is null then raise exception 'NOT_FOUND'; end if;
  select id into target from app_public.exercise_tag_definitions where owner_user_id=u
    and exercise_definition_id=p_destination and normalized_name=source.normalized_name order by id limit 1;
  if target is null then
    target:='merge_tag_'||gen_random_uuid()::text;
    insert into app_public.exercise_tag_definitions(owner_user_id,id,exercise_definition_id,name,normalized_name,
      created_at,updated_at,deleted_at,client_updated_at_ms) values(u,target,p_destination,source.name,source.normalized_name,
      (extract(epoch from now())*1000)::bigint,(extract(epoch from now())*1000)::bigint,source.deleted_at,p_stamp);
  end if;
  return target;
end $$;
revoke all on function app_public.exercise_merge_destination_tag(text,text,bigint) from public,anon,authenticated;

-- Root witnesses are observed after locking, even if their request began before a merge.
-- Inherited witnesses keep their explicitly supplied original certification instant.
alter table app_public.group_certifications alter column certified_at set default clock_timestamp();
alter table app_public.group_metric_certifications alter column certified_at set default clock_timestamp();

-- Failed eager group correction still exposes the actual terminal observation time.
do $$
declare p record; definition text; revised text;
begin
  for p in select oid from pg_proc where pronamespace='app_public'::regnamespace and proname in(
    'group_competition_certification_json','group_competition_legacy_certification_json') loop
    definition:=pg_get_functiondef(p.oid);
    revised:=replace(definition,'greatest(p_row.certified_at,',
      'greatest(p_row.certified_at,app_public.exercise_merge_witness_ended_at(p_row.member_user_id,p_row.set_id,p_row.certified_at),');
    if revised=definition then raise exception 'Cannot extend witness merge end time'; end if;
    execute revised;
  end loop;
end $$;
