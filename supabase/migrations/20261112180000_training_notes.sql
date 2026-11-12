-- Training notes: short dated notes, general or about one exercise, as the
-- eighteenth Sync v2 entity (layer 1). Additive and server-first: builds that
-- do not know the type skip its rows, and the first build that does re-pulls
-- layer 1. It stays out of exercise_merge_snapshot; a merge that repoints a
-- note raises its clock so the ordinary pull applies it.

create table app_public.training_notes (
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  exercise_definition_id text,
  body text,
  noted_on text,
  source text,
  created_at bigint,
  updated_at bigint,
  deleted_at bigint,
  client_updated_at_ms bigint not null,
  server_received_at timestamptz not null default now(),
  primary key (owner_user_id, id),
  constraint training_notes_exercise_definition_fk foreign key (owner_user_id, exercise_definition_id)
    references app_public.exercise_definitions(owner_user_id, id) on delete cascade deferrable initially deferred
);
create index training_notes_owner_received_idx on app_public.training_notes(owner_user_id, server_received_at);
create index training_notes_exercise_definition_id_idx on app_public.training_notes(exercise_definition_id);
create index training_notes_deleted_at_idx on app_public.training_notes(deleted_at);
create trigger training_notes_touch_server_received_at before update on app_public.training_notes
  for each row when (new is distinct from old) execute function app_public.touch_server_received_at();
create trigger training_notes_owner_user_id_immutable before update on app_public.training_notes
  for each row execute function app_public.enforce_owner_user_id_immutable();
alter table app_public.training_notes enable row level security;
create policy training_notes_owner_select on app_public.training_notes
  for select to authenticated using (owner_user_id=auth.uid());
create policy training_notes_owner_insert on app_public.training_notes
  for insert to authenticated with check (owner_user_id=auth.uid());
create policy training_notes_owner_update on app_public.training_notes
  for update to authenticated using (owner_user_id=auth.uid()) with check (owner_user_id=auth.uid());
create policy training_notes_owner_delete on app_public.training_notes
  for delete to authenticated using (owner_user_id=auth.uid());
create policy training_notes_direct_app_only on app_public.training_notes
  as restrictive for all to authenticated
  using (((select auth.jwt())->>'client_id') is null)
  with check (((select auth.jwt())->>'client_id') is null);
grant select,insert,update,delete on app_public.training_notes to authenticated,service_role;

-- Guarded in-place patches retain the existing sync, merge and wipe boundaries.
do $migration$
declare definition text; revised text; anchor text; replacement text;
begin
  definition:=pg_get_functiondef('app_public.sync_push(jsonb)'::regprocedure);
  for anchor,replacement in select * from (values
    ($anchor$    else
      raise exception
        'INTERNAL: sync_push unknown entity type %'$anchor$, $replacement$    elsif _type = 'training_notes' then
      insert into app_public.training_notes (
        owner_user_id,id,exercise_definition_id,body,noted_on,source,
        created_at,updated_at,deleted_at,client_updated_at_ms,server_received_at
      ) values (
        _uid,_id,_fields->>'exercise_definition_id',_fields->>'body',_fields->>'noted_on',_fields->>'source',
        (_fields->>'created_at')::bigint,(_fields->>'updated_at')::bigint,
        (_fields->>'deleted_at')::bigint,_cuam,_now_tstz
      ) on conflict (owner_user_id,id) do update set
        exercise_definition_id=excluded.exercise_definition_id,body=excluded.body,noted_on=excluded.noted_on,
        source=excluded.source,created_at=excluded.created_at,updated_at=excluded.updated_at,
        deleted_at=excluded.deleted_at,client_updated_at_ms=excluded.client_updated_at_ms,
        server_received_at=excluded.server_received_at
      where excluded.client_updated_at_ms > app_public.training_notes.client_updated_at_ms;

    else
      raise exception
        'INTERNAL: sync_push unknown entity type %'$replacement$)
  ) patches(anchor,replacement) loop
    revised:=replace(definition,anchor,replacement);
    if revised=definition then raise exception 'Training notes push patch anchor missing: %',anchor; end if;
    definition:=revised;
  end loop;
  execute definition;
end $migration$;

do $migration$
declare definition text; revised text; anchor text; replacement text;
begin
  definition:=pg_get_functiondef('app_public.sync_pull(jsonb)'::regprocedure);
  for anchor,replacement in select * from (values
    ($anchor$'session_plan_sets', 'session_plan_uses'
    ) then$anchor$, $replacement$'session_plan_sets', 'session_plan_uses', 'training_notes'
    ) then$replacement$),
    ($anchor$    when 1 then v_types := array['session_plans', 'exercise_muscle_mappings', 'exercise_tag_definitions', 'exercise_group_links'];$anchor$,
     $replacement$    when 1 then v_types := array['session_plans', 'exercise_muscle_mappings', 'exercise_tag_definitions', 'exercise_group_links', 'training_notes'];$replacement$),
    ($anchor$    union all
    select 'session_plan_uses'::text$anchor$, $replacement$    union all
    select 'training_notes'::text, tn.id, tn.client_updated_at_ms,
           tn.server_received_at, tn.owner_user_id,
           jsonb_build_object(
             'exercise_definition_id',tn.exercise_definition_id,'body',tn.body,'noted_on',tn.noted_on,
             'source',tn.source,'created_at',tn.created_at,'updated_at',tn.updated_at,'deleted_at',tn.deleted_at)
      from app_public.training_notes tn
      where tn.owner_user_id=auth.uid() and 'training_notes'=any(v_types)
    union all
    select 'session_plan_uses'::text$replacement$)
  ) patches(anchor,replacement) loop
    revised:=replace(definition,anchor,replacement);
    if revised=definition then raise exception 'Training notes pull patch anchor missing: %',anchor; end if;
    definition:=revised;
  end loop;
  execute definition;
end $migration$;

do $migration$
declare definition text; revised text;
begin
  definition:=pg_get_functiondef('app_public.dev_wipe_my_data()'::regprocedure);
  revised:=replace(definition,
    $anchor$  delete from app_public.body_weight_measurements where owner_user_id = _uid;$anchor$,
    $replacement$  delete from app_public.training_notes where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from app_public.body_weight_measurements where owner_user_id = _uid;$replacement$);
  if revised=definition then raise exception 'Training notes wipe patch anchor missing'; end if;
  execute revised;
end $migration$;

-- A merge moves the source exercise's notes to the destination. Notes are not
-- in the merge snapshot, so the merge stamp also outruns every note clock.
do $migration$
declare definition text; revised text; anchor text; replacement text;
begin
  definition:=pg_get_functiondef('app_public.exercise_merge_execute(text,text,text,text)'::regprocedure);
  for anchor,replacement in select * from (values
    ($anchor$    union all select client_updated_at_ms from app_public.exercise_tag_definitions where owner_user_id=u
  ) clocks;$anchor$, $replacement$    union all select client_updated_at_ms from app_public.exercise_tag_definitions where owner_user_id=u
    union all select client_updated_at_ms from app_public.training_notes where owner_user_id=u and exercise_definition_id=p_source
  ) clocks;$replacement$),
    ($anchor$  update app_public.exercise_definitions set deleted_at=clock_now,updated_at=clock_now,client_updated_at_ms=stamp
    where owner_user_id=u and id=p_source;$anchor$, $replacement$  update app_public.training_notes set exercise_definition_id=p_destination,updated_at=clock_now,client_updated_at_ms=stamp
    where owner_user_id=u and exercise_definition_id=p_source;
  update app_public.exercise_definitions set deleted_at=clock_now,updated_at=clock_now,client_updated_at_ms=stamp
    where owner_user_id=u and id=p_source;$replacement$)
  ) patches(anchor,replacement) loop
    revised:=replace(definition,anchor,replacement);
    if revised=definition then raise exception 'Training notes merge patch anchor missing: %',anchor; end if;
    definition:=revised;
  end loop;
  execute definition;
end $migration$;

-- -----------------------------------------------------------------------------
-- Agent note writes, behind the "Make changes" switch the Edge Function checks,
-- idempotent through write receipts. The Edge Function validates the body,
-- date and ids; these re-check only what needs the database.
-- -----------------------------------------------------------------------------

alter table public.agent_plan_write_receipts drop constraint agent_plan_write_receipts_operation_valid;
alter table public.agent_plan_write_receipts add constraint agent_plan_write_receipts_operation_valid check (operation in (
  'create_session_plan','create_training_programme','create_exercise','update_exercise','delete_exercise','restore_exercise',
  'update_plan_meta','update_programme_meta','insert_plan_block','update_plan_block',
  'reorder_plan_blocks','reorder_programme_plans','reorder_block_sets','tombstone_plan_block','detach_programme_plan',
  'tombstone_plan','tombstone_programme','set_muscle_targets',
  'create_workout','start_workout','log_sets','update_set','delete_set','finish_workout',
  'add_note','remove_note'
));

create function app_public.agent_note_json(p_note app_public.training_notes)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $func$
  select jsonb_build_object(
    'id', p_note.id,
    'body', p_note.body,
    'noted_on', p_note.noted_on,
    'source', p_note.source,
    'exercise_id', p_note.exercise_definition_id,
    'exercise_name', (select d.name from app_public.exercise_definitions d
                       where d.owner_user_id = p_note.owner_user_id and d.id = p_note.exercise_definition_id),
    'created_at', p_note.created_at
  );
$func$;

-- p_note: {body, noted_on (YYYY-MM-DD), exercise_id (text or null)}.
create function app_public.agent_add_note(
  p_owner uuid,
  p_client_id text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_note jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _operation text := 'add_note';
  _replay    jsonb;
  _exercise  text := p_note ->> 'exercise_id';
  _deleted   bigint;
  _stamp     bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  _row       app_public.training_notes;
  _result    jsonb;
begin
  _replay := app_public.agent_exercise_claim_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256
  );
  if _replay is not null then
    return _replay;
  end if;
  if coalesce(length(p_note ->> 'body'), 0) < 1 or length(p_note ->> 'body') > 1000
     or coalesce(p_note ->> 'noted_on', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
  end if;
  perform app_public.agent_exercise_act_as_owner(p_owner);
  -- Serialised with exercise merges, which repoint notes.
  perform pg_advisory_xact_lock(hashtextextended('exercise-merge:' || p_owner::text, 0));
  if _exercise is not null then
    select d.deleted_at into _deleted
      from app_public.exercise_definitions d
     where d.owner_user_id = p_owner and d.id = _exercise;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
    if _deleted is not null then
      raise exception 'EXERCISE_DELETED' using errcode = 'P0001';
    end if;
  end if;
  insert into app_public.training_notes (
    owner_user_id, id, exercise_definition_id, body, noted_on, source,
    created_at, updated_at, deleted_at, client_updated_at_ms, server_received_at
  ) values (
    p_owner, 'note_' || replace(gen_random_uuid()::text, '-', ''), _exercise,
    p_note ->> 'body', p_note ->> 'noted_on', 'agent',
    _stamp, _stamp, null, _stamp, now()
  ) returning * into _row;
  _result := jsonb_build_object('note', app_public.agent_note_json(_row), 'idempotent_replay', false);
  perform app_public.agent_exercise_store_receipt(p_owner, p_client_id, _operation, p_idempotency_key, _result);
  return _result;
end;
$func$;

-- Soft-deletes one live note; a missing, foreign or already removed id is NOT_FOUND.
create function app_public.agent_remove_note(
  p_owner uuid,
  p_client_id text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_note_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  _operation text := 'remove_note';
  _replay    jsonb;
  _row       app_public.training_notes;
  _stamp     bigint;
  _result    jsonb;
begin
  _replay := app_public.agent_exercise_claim_receipt(
    p_owner, p_client_id, _operation, p_idempotency_key, p_payload_sha256
  );
  if _replay is not null then
    return _replay;
  end if;
  perform app_public.agent_exercise_act_as_owner(p_owner);
  perform pg_advisory_xact_lock(hashtextextended('exercise-merge:' || p_owner::text, 0));
  select * into _row
    from app_public.training_notes n
   where n.owner_user_id = p_owner and n.id = p_note_id
   for update;
  if not found or _row.deleted_at is not null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  _stamp := greatest((extract(epoch from clock_timestamp()) * 1000)::bigint, _row.client_updated_at_ms + 1);
  update app_public.training_notes
     set deleted_at = _stamp, updated_at = _stamp, client_updated_at_ms = _stamp
   where owner_user_id = p_owner and id = p_note_id;
  _result := jsonb_build_object('removed', true, 'note_id', p_note_id, 'idempotent_replay', false);
  perform app_public.agent_exercise_store_receipt(p_owner, p_client_id, _operation, p_idempotency_key, _result);
  return _result;
end;
$func$;

revoke all on function app_public.agent_note_json(app_public.training_notes) from public, anon, authenticated;
revoke all on function app_public.agent_add_note(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function app_public.agent_remove_note(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function app_public.agent_note_json(app_public.training_notes) to service_role;
grant execute on function app_public.agent_add_note(uuid, text, text, text, jsonb) to service_role;
grant execute on function app_public.agent_remove_note(uuid, text, text, text, text) to service_role;
