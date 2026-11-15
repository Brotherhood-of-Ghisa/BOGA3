-- Retained note targets deliberately have no FK: a target may be removed,
-- and imported activities are outside private sync. Existing coach authors
-- remain unknown; no migration guesses who supplied their text.
alter table app_public.training_notes
  add column author text,
  add column client_id text,
  add column session_id text,
  add column set_id text,
  add column activity_source text,
  add column activity_external_id text,
  add column target_label text,
  add column target_started_at bigint;

create index training_notes_owner_session_id_idx on app_public.training_notes(owner_user_id,session_id);
create index training_notes_owner_set_id_idx on app_public.training_notes(owner_user_id,set_id);
create index training_notes_owner_activity_idx on app_public.training_notes(owner_user_id,activity_source,activity_external_id);

do $migration$
declare definition text; branch text; revised text; anchor text;
begin
  definition := pg_get_functiondef('app_public.sync_push(jsonb)'::regprocedure);
  branch := split_part(split_part(definition, 'elsif _type = ''training_notes'' then', 2), '
    else
', 1);
  if branch = '' then raise exception 'Scoped notes push branch missing'; end if;
  revised := replace(branch, 'owner_user_id,id,exercise_definition_id,body,noted_on,source,',
    'owner_user_id,id,exercise_definition_id,body,noted_on,source,author,client_id,session_id,set_id,activity_source,activity_external_id,target_label,target_started_at,');
  revised := replace(revised, '_fields->>''noted_on'',_fields->>''source'',',
    '_fields->>''noted_on'',_fields->>''source'',_fields->>''author'',_fields->>''client_id'',_fields->>''session_id'',_fields->>''set_id'',_fields->>''activity_source'',_fields->>''activity_external_id'',_fields->>''target_label'',(_fields->>''target_started_at'')::bigint,');
  revised := replace(revised, 'source=excluded.source,created_at=excluded.created_at,',
    'source=excluded.source,author=coalesce(app_public.training_notes.author,excluded.author),client_id=coalesce(app_public.training_notes.client_id,excluded.client_id),session_id=coalesce(app_public.training_notes.session_id,excluded.session_id),set_id=coalesce(app_public.training_notes.set_id,excluded.set_id),activity_source=coalesce(app_public.training_notes.activity_source,excluded.activity_source),activity_external_id=coalesce(app_public.training_notes.activity_external_id,excluded.activity_external_id),target_label=coalesce(app_public.training_notes.target_label,excluded.target_label),target_started_at=coalesce(app_public.training_notes.target_started_at,excluded.target_started_at),created_at=excluded.created_at,');
  if revised = branch then raise exception 'Scoped notes push patch missing'; end if;
  execute replace(definition,branch,revised);

  definition := pg_get_functiondef('app_public.sync_pull(jsonb)'::regprocedure);
  anchor := '''source'',tn.source,';
  revised := replace(definition, anchor, anchor || $columns$'author',tn.author,'client_id',tn.client_id,'session_id',tn.session_id,'set_id',tn.set_id,'activity_source',tn.activity_source,'activity_external_id',tn.activity_external_id,'target_label',tn.target_label,'target_started_at',tn.target_started_at,$columns$);
  if revised = definition then raise exception 'Scoped notes pull patch missing'; end if;
  execute revised;
end $migration$;

create or replace function app_public.agent_note_json(p_note app_public.training_notes)
returns jsonb language sql stable security definer set search_path = ''
as $func$
  select jsonb_build_object(
    'id',p_note.id,'body',p_note.body,'noted_on',p_note.noted_on,'source',p_note.source,
    'author',coalesce(p_note.author,case when p_note.source is distinct from 'agent' then 'user' end),
    'client_id',p_note.client_id,'session_id',p_note.session_id,'set_id',p_note.set_id,
    'activity_source',p_note.activity_source,'activity_external_id',p_note.activity_external_id,
    'target_label',p_note.target_label,'target_started_at',p_note.target_started_at,'exercise_id',p_note.exercise_definition_id,
    'exercise_name',(select d.name from app_public.exercise_definitions d
      where d.owner_user_id=p_note.owner_user_id and d.id=p_note.exercise_definition_id),
    'created_at',p_note.created_at
  );
$func$;

create or replace function app_public.agent_add_note(
  p_owner uuid,p_client_id text,p_idempotency_key text,p_payload_sha256 text,p_note jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $func$
declare
  _replay jsonb;
  _exercise text := p_note->>'exercise_id';
  _session text := p_note->>'session_id';
  _set text := p_note->>'set_id';
  _source text := p_note->>'activity_source';
  _external text := p_note->>'activity_external_id';
  _label text;
  _target_started bigint;
  _deleted bigint;
  _stamp bigint := (extract(epoch from clock_timestamp())*1000)::bigint;
  _row app_public.training_notes;
  _result jsonb;
begin
  _replay := app_public.agent_exercise_claim_receipt(p_owner,p_client_id,'add_note',p_idempotency_key,p_payload_sha256);
  if _replay is not null then return _replay; end if;
  if coalesce(length(p_note->>'body'),0)<1 or length(p_note->>'body')>1000
     or coalesce(p_note->>'noted_on','') !~ '^\d{4}-\d{2}-\d{2}$'
     or coalesce(p_note->>'author','') not in ('user','agent')
     or num_nonnulls(_exercise,_session,_set,_source)>1
     or (_source is null) <> (_external is null) then
    raise exception 'INVALID_ARGUMENT' using errcode='P0001';
  end if;
  perform app_public.agent_exercise_act_as_owner(p_owner);
  perform pg_advisory_xact_lock(hashtextextended('exercise-merge:'||p_owner::text,0));
  if _exercise is not null then
    select d.deleted_at into _deleted from app_public.exercise_definitions d
      where d.owner_user_id=p_owner and d.id=_exercise for share;
    if not found then raise exception 'NOT_FOUND' using errcode='P0001'; end if;
    if _deleted is not null then raise exception 'EXERCISE_DELETED' using errcode='P0001'; end if;
  elsif _session is not null then
    select 'Workout',s.started_at
      into _label,_target_started from app_public.sessions s
      where s.owner_user_id=p_owner and s.id=_session and s.deleted_at is null for share;
    if not found then raise exception 'NOT_FOUND' using errcode='P0001'; end if;
  elsif _set is not null then
    select e.name||' · Set '||(x.order_index+1)::text,s.started_at into _label,_target_started
      from app_public.exercise_sets x
      join app_public.session_exercises e on e.owner_user_id=x.owner_user_id and e.id=x.session_exercise_id
      join app_public.sessions s on s.owner_user_id=e.owner_user_id and s.id=e.session_id
      where x.owner_user_id=p_owner and x.id=_set
        and x.deleted_at is null and e.deleted_at is null and s.deleted_at is null for share of x,e,s;
    if not found then raise exception 'NOT_FOUND' using errcode='P0001'; end if;
  elsif _source is not null then
    select replace(a.activity_type,'_',' '),(extract(epoch from a.started_at)*1000)::bigint
      into _label,_target_started from app_public.health_activities a
      where a.user_id=p_owner and a.source=_source and a.external_id=_external for share;
    if not found then raise exception 'NOT_FOUND' using errcode='P0001'; end if;
  end if;
  insert into app_public.training_notes(
    owner_user_id,id,exercise_definition_id,body,noted_on,source,author,client_id,
    session_id,set_id,activity_source,activity_external_id,target_label,target_started_at,
    created_at,updated_at,deleted_at,client_updated_at_ms,server_received_at
  ) values (
    p_owner,'note_'||replace(gen_random_uuid()::text,'-',''),_exercise,p_note->>'body',p_note->>'noted_on',
    'agent',p_note->>'author',p_client_id,_session,_set,_source,_external,_label,_target_started,
    _stamp,_stamp,null,_stamp,now()
  ) returning * into _row;
  _result := jsonb_build_object('note',app_public.agent_note_json(_row),'idempotent_replay',false);
  perform app_public.agent_exercise_store_receipt(p_owner,p_client_id,'add_note',p_idempotency_key,_result);
  return _result;
end;
$func$;
