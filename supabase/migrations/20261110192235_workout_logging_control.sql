-- Session control is server-owned. Sync can read these columns but never sets them.
alter table app_public.sessions add column logging_client_id text;
alter table app_public.sessions add column logging_granted_at text;

create function app_public.workout_control(p_owner uuid,p_session_id text,p_client_id text,p_granted_at timestamptz)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('owner',case when s.logging_client_id is null then 'human' else 'mcp' end,
    'client_id',s.logging_client_id,'can_edit',coalesce(s.status='active' and s.deleted_at is null
      and s.logging_client_id=p_client_id and s.logging_granted_at::timestamptz=p_granted_at
      and not app_public.agent_workout_requires_app(p_owner,s.id),false))
    from app_public.sessions s where s.owner_user_id=p_owner and s.id=p_session_id;
$$;
revoke all on function app_public.workout_control(uuid,text,text,timestamptz) from public,anon,authenticated;

-- This guard also covers privileged recovery/merge writers that bypass the
-- ordinary revision trigger. Only the two control-aware paths set this flag.
create function app_public.workout_control_guard()
returns trigger language plpgsql security definer set search_path=app_public,pg_temp as $$
declare scope record; old_scope record; row_value jsonb; sid text; ids text[]:='{}';
begin
  if auth.uid() is null or current_setting('boga.workout_control_write',true)='on' then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  perform app_public.exercise_merge_user();
  row_value:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_table_name='sessions' and tg_op<>'DELETE' then
    if (tg_op='INSERT' and (new.logging_client_id is not null or new.logging_granted_at is not null))
      or (tg_op='UPDATE' and (new.logging_client_id is distinct from old.logging_client_id
        or new.logging_granted_at is distinct from old.logging_granted_at)) then
      raise exception 'WORKOUT_CONTROL_REQUIRED: use the session control action';
    end if;
  end if;
  select * into scope from app_public.workout_row_context(tg_table_name,row_value);
  ids:=array_append(ids,scope.session_id);
  if tg_op='UPDATE' then
    select * into old_scope from app_public.workout_row_context(tg_table_name,to_jsonb(old));
    ids:=array_append(ids,old_scope.session_id);
  end if;
  foreach sid in array ids loop
    if exists(select 1 from app_public.sessions where owner_user_id=auth.uid() and id=sid
      and status='active' and logging_client_id is not null) then
      raise exception 'WORKOUT_AI_OWNED: take over logging before editing this session';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function app_public.workout_control_guard() from public,anon,authenticated;
create trigger a_workout_control_guard before insert or update or delete on app_public.sessions
  for each row execute function app_public.workout_control_guard();
create trigger a_workout_control_guard before insert or update or delete on app_public.session_exercises
  for each row execute function app_public.workout_control_guard();
create trigger a_workout_control_guard before insert or update or delete on app_public.exercise_sets
  for each row execute function app_public.workout_control_guard();
create trigger a_workout_control_guard before insert or update or delete on app_public.session_exercise_tags
  for each row execute function app_public.workout_control_guard();

create function app_public.workout_set_control(p_id text,p_session_id text,p_base_revision bigint,
  p_client_id text default null,p_granted_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.exercise_merge_user(); s app_public.sessions; receipt public.exercise_merge_operations;
  input_hash text; previous text:=current_setting('boga.workout_control_write',true);
begin
  perform app_public.require_sync_protocol();
  if p_id is null or p_id!~'^control:[a-zA-Z0-9:-]+$' or length(p_id)>128
    or p_base_revision is null or p_base_revision<0 or (p_client_id is null)<>(p_granted_at is null) then
    raise exception 'VALIDATION: invalid control action';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('exercise-merge:'||u::text,0));
  input_hash:=md5(jsonb_build_array(p_session_id,p_base_revision,p_client_id,p_granted_at)::text);
  select * into s from app_public.sessions where owner_user_id=u and id=p_session_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into receipt from public.exercise_merge_operations where user_id=u and id=p_id;
  if found then
    if receipt.session_id is distinct from p_session_id or receipt.input_hash<>input_hash then
      raise exception 'IDEMPOTENCY_CONFLICT: control action changed';
    end if;
    -- A delayed retry reports current control, never re-applies an old transfer.
    return jsonb_build_object('session_id',s.id,'revision',s.merge_revision,'logging_client_id',s.logging_client_id,
      'idempotent_replay',true);
  end if;
  if s.status<>'active' or s.deleted_at is not null then raise exception 'WORKOUT_NOT_ACTIVE'; end if;
  if s.merge_revision<>p_base_revision then raise exception 'REVISION_CONFLICT'; end if;
  if p_client_id is not null then
    if app_public.agent_workout_requires_app(u,s.id) then raise exception 'WORKOUT_REQUIRES_APP'; end if;
    if s.logging_client_id is not null then raise exception 'WORKOUT_AI_OWNED'; end if;
    perform 1 from auth.oauth_consents c join auth.oauth_clients client on client.id=c.client_id
      where c.user_id=u and c.client_id::text=p_client_id and c.granted_at=p_granted_at
        and c.revoked_at is null and client.deleted_at is null for share of c,client;
    if not found then raise exception 'WORKOUT_PERMISSION_REQUIRED'; end if;
    perform 1 from public.agent_workout_permissions where owner_user_id=u and client_id=p_client_id
      and workout_logging_enabled and granted_at=p_granted_at for share;
    if not found then raise exception 'WORKOUT_PERMISSION_REQUIRED'; end if;
    if exists(select 1 from public.exercise_merge_conflicts c left join app_public.session_exercises b
      on b.owner_user_id=u and b.id=c.block_id where c.user_id=u and c.resolved_at is null
        and coalesce(c.session_id,b.session_id)=s.id) then raise exception 'WORKOUT_REVIEW_REQUIRED'; end if;
  end if;
  perform set_config('boga.workout_control_write','on',true);
  perform set_config('boga.exercise_merge_internal','on',true);
  update app_public.sessions set logging_client_id=p_client_id,logging_granted_at=p_granted_at::text
    where owner_user_id=u and id=s.id;
  perform app_public.workout_fence_graph(s.id,p_id,input_hash);
  perform set_config('boga.exercise_merge_internal','',true);
  perform set_config('boga.workout_control_write',coalesce(previous,''),true);
  select * into s from app_public.sessions where owner_user_id=u and id=p_session_id;
  return jsonb_build_object('session_id',s.id,'revision',s.merge_revision,'logging_client_id',s.logging_client_id,
    'idempotent_replay',false);
end $$;
revoke all on function app_public.workout_set_control(text,text,bigint,text,timestamptz) from public,anon;
grant execute on function app_public.workout_set_control(text,text,bigint,text,timestamptz) to authenticated;

do $migration$
declare original text; revised text;
begin
  original:=pg_get_functiondef('app_public.sync_pull(jsonb)'::regprocedure);
  revised:=replace(original,'''gym_id'', s.gym_id,',
    '''logging_client_id'', s.logging_client_id, ''logging_granted_at'', s.logging_granted_at, ''gym_id'', s.gym_id,');
  if revised=original then raise exception 'Cannot project workout control'; end if;
  execute revised;

  original:=pg_get_functiondef('app_public.agent_workout_read(uuid,text,timestamptz,text,text,integer,text)'::regprocedure);
  revised:=replace(original,'''status'',x.status)',
    '''status'',x.status,''control'',app_public.workout_control(p_owner,x.id,p_client_id,p_granted_at))');
  if revised=original then raise exception 'Cannot project active workout control'; end if;
  original:=revised;
  revised:=replace(original,'''requires_app'',app_public.agent_workout_requires_app(p_owner,s.id))',
    '''requires_app'',app_public.agent_workout_requires_app(p_owner,s.id),''control'',app_public.workout_control(p_owner,s.id,p_client_id,p_granted_at))');
  if revised=original then raise exception 'Cannot project selected workout control'; end if;
  execute revised;

  original:=pg_get_functiondef('app_public.agent_workout_mutate(uuid,text,timestamptz,text,text,text,jsonb)'::regprocedure);
  revised:=replace(original,'perform app_public.agent_workout_authorize(p_owner,p_client_id,p_granted_at);',
    E'perform app_public.agent_workout_authorize(p_owner,p_client_id,p_granted_at);\n  perform set_config(''boga.workout_control_write'',''on'',true);');
  if revised=original then raise exception 'Cannot authorize control-aware writes'; end if;
  original:=revised;
  revised:=replace(original,'if replay is not null then return replay; end if;',E'if replay is not null then\n    select * into s from app_public.sessions where owner_user_id=p_owner and id=replay->>''session_id'';\n    if s.status=''active'' and (s.logging_client_id is distinct from p_client_id\n      or s.logging_granted_at::timestamptz is distinct from p_granted_at) then raise exception ''WORKOUT_CONTROL_REQUIRED''; end if;\n    perform set_config(''boga.workout_control_write'','''',true);\n    return replay||jsonb_build_object(''control'',app_public.workout_control(p_owner,s.id,p_client_id,p_granted_at));\n  end if;');
  if revised=original then raise exception 'Cannot protect replay after takeover'; end if;
  original:=revised;
  revised:=replace(original,'insert into app_public.sessions(owner_user_id,id,gym_id,status,started_at,created_at,updated_at,client_updated_at_ms)',
    'insert into app_public.sessions(owner_user_id,id,gym_id,status,started_at,created_at,updated_at,client_updated_at_ms,logging_client_id,logging_granted_at)');
  if revised=original then raise exception 'Cannot add initial workout controller'; end if;
  original:=revised;
  revised:=replace(original,'''active'',stamp,stamp,stamp,stamp) returning * into s;',
    '''active'',stamp,stamp,stamp,stamp,p_client_id,p_granted_at::text) returning * into s;');
  if revised=original then raise exception 'Cannot bind initial workout grant'; end if;
  original:=revised;
  revised:=replace(original,'if app_public.agent_workout_revision(p_owner,s.id) is distinct from',
    E'if s.logging_client_id is distinct from p_client_id or s.logging_granted_at::timestamptz is distinct from p_granted_at then\n      raise exception ''WORKOUT_CONTROL_REQUIRED'';\n    end if;\n    if app_public.agent_workout_revision(p_owner,s.id) is distinct from');
  if revised=original then raise exception 'Cannot enforce workout controller'; end if;
  original:=revised;
  revised:=replace(original,'update app_public.sessions set status=case',
    E'update app_public.sessions set\n      logging_client_id=case when p_operation=''finish_workout'' then null else logging_client_id end,\n      logging_granted_at=case when p_operation=''finish_workout'' then null else logging_granted_at end,\n      status=case');
  if revised=original then raise exception 'Cannot release completed workout control'; end if;
  original:=revised;
  revised:=replace(original,'''session_id'',s.id,''revision'',app_public.agent_workout_revision',
    '''control'',app_public.workout_control(p_owner,s.id,p_client_id,p_granted_at),''session_id'',s.id,''revision'',app_public.agent_workout_revision');
  if revised=original then raise exception 'Cannot report workout controller'; end if;
  original:=revised;
  revised:=replace(original,'perform set_config(''boga.exercise_merge_internal'','''',true);',
    E'perform set_config(''boga.workout_control_write'','''',true);\n  perform set_config(''boga.exercise_merge_internal'','''',true);');
  if revised=original then raise exception 'Cannot restore workout write scope'; end if;
  execute revised;
end $migration$;

-- Owner-authorized non-production reset can remove an active AI workout too.
do $migration$
declare original text; revised text;
begin
  original:=pg_get_functiondef('app_public.dev_wipe_my_data()'::regprocedure);
  revised:=regexp_replace(original,'(_deleted[[:space:]]+bigint;)',
    '\1 _previous_workout_control text:=current_setting(''boga.workout_control_write'',true);');
  if revised=original then raise exception 'Cannot declare wipe control scope'; end if;
  original:=revised;
  revised:=replace(original,'delete from app_public.session_exercise_tags where owner_user_id = _uid;',
    E'perform set_config(''boga.workout_control_write'',''on'',true);\n  delete from app_public.session_exercise_tags where owner_user_id = _uid;');
  if revised=original then raise exception 'Cannot authorize owned workout reset'; end if;
  original:=revised;
  revised:=replace(original,'return _total;',
    E'perform set_config(''boga.workout_control_write'',coalesce(_previous_workout_control,''''),true);\n  return _total;');
  if revised=original then raise exception 'Cannot restore wipe control scope'; end if;
  execute revised;
end $migration$;

do $migration$
declare original text; revised text;
begin
  original:=pg_get_functiondef('app_public.exercise_merge_review_item(text)'::regprocedure);
  revised:=replace(original,'''invalid'',invalid or saved_row is null or exists',
    E'''invalid'',invalid or saved_row is null or exists(select 1 from app_public.sessions where owner_user_id=u and id=b.session_id and status=''active'' and logging_client_id is not null) or exists');
  if revised=original then raise exception 'Cannot lock saved workout changes'; end if;
  original:=revised;
  revised:=replace(original,'''notice'',case when exists',
    E'''notice'',case when exists(select 1 from app_public.sessions where owner_user_id=u and id=b.session_id and status=''active'' and logging_client_id is not null)\n      then ''Take over logging in the session before applying saved changes.'' when exists');
  if revised=original then raise exception 'Cannot explain locked saved changes'; end if;
  execute revised;
  original:=pg_get_functiondef('app_public.workout_review_item(text)'::regprocedure);
  revised:=replace(original,'''invalid'',invalid,''notice'',notice)',
    E'''invalid'',invalid or (s.status=''active'' and s.logging_client_id is not null),''notice'',\n    case when s.status=''active'' and s.logging_client_id is not null then ''Take over logging in the session before applying saved changes.'' else notice end)');
  if revised=original then raise exception 'Cannot lock saved workout metadata'; end if;
  execute revised;
end $migration$;
