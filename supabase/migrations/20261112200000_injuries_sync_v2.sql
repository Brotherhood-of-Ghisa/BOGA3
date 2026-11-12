-- Injuries and discomfort Sync v2 schema, RLS, and RPC projections.

create table app_public.injuries (
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  muscle_group_id text,
  side text,
  status text not null,
  pain_score integer,
  label text not null,
  notes text,
  contraindications text,
  started_at bigint not null,
  resolved_at bigint,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  client_updated_at_ms bigint not null,
  server_received_at timestamptz not null default now(),
  primary key (owner_user_id, id),
  constraint injuries_muscle_group_fk foreign key (owner_user_id, muscle_group_id)
    references app_public.muscle_groups(owner_user_id, id) on delete set null (muscle_group_id)
    deferrable initially deferred
);

create index injuries_owner_received_idx on app_public.injuries(owner_user_id, server_received_at);
create index injuries_muscle_group_id_idx on app_public.injuries(muscle_group_id);
create index injuries_deleted_at_idx on app_public.injuries(deleted_at);
create index injuries_started_at_idx on app_public.injuries(started_at);

create trigger injuries_touch_server_received_at before update on app_public.injuries
  for each row when (new is distinct from old) execute function app_public.touch_server_received_at();
create trigger injuries_owner_user_id_immutable before update on app_public.injuries
  for each row execute function app_public.enforce_owner_user_id_immutable();

alter table app_public.injuries enable row level security;
create policy injuries_owner_select on app_public.injuries
  for select to authenticated using (owner_user_id = auth.uid());
create policy injuries_owner_insert on app_public.injuries
  for insert to authenticated with check (owner_user_id = auth.uid());
create policy injuries_owner_update on app_public.injuries
  for update to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy injuries_owner_delete on app_public.injuries
  for delete to authenticated using (owner_user_id = auth.uid());
create policy injuries_direct_app_only on app_public.injuries
  as restrictive for all to authenticated
  using (((select auth.jwt())->>'client_id') is null)
  with check (((select auth.jwt())->>'client_id') is null);

grant select, insert, update, delete on app_public.injuries to authenticated, service_role;

-- Patch sync_push RPC
do $migration$
declare
  definition text;
  revised text;
begin
  definition := pg_get_functiondef('app_public.sync_push(jsonb)'::regprocedure);
  revised := replace(definition,
    $anchor$    else
      raise exception
        'INTERNAL: sync_push unknown entity type %'$anchor$,
    $replacement$    elsif _type = 'injuries' then
      insert into app_public.injuries (
        owner_user_id, id, muscle_group_id, side, status, pain_score,
        label, notes, contraindications, started_at, resolved_at,
        created_at, updated_at, deleted_at, client_updated_at_ms, server_received_at
      ) values (
        _uid, _id, _fields->>'muscle_group_id', _fields->>'side', _fields->>'status',
        (_fields->>'pain_score')::integer, _fields->>'label', _fields->>'notes',
        _fields->>'contraindications', (_fields->>'started_at')::bigint,
        (_fields->>'resolved_at')::bigint, (_fields->>'created_at')::bigint,
        (_fields->>'updated_at')::bigint, (_fields->>'deleted_at')::bigint,
        _cuam, _now_tstz
      ) on conflict (owner_user_id, id) do update set
        muscle_group_id = excluded.muscle_group_id,
        side = excluded.side,
        status = excluded.status,
        pain_score = excluded.pain_score,
        label = excluded.label,
        notes = excluded.notes,
        contraindications = excluded.contraindications,
        started_at = excluded.started_at,
        resolved_at = excluded.resolved_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        client_updated_at_ms = excluded.client_updated_at_ms,
        server_received_at = excluded.server_received_at
      where excluded.client_updated_at_ms > app_public.injuries.client_updated_at_ms;

    else
      raise exception
        'INTERNAL: sync_push unknown entity type %'$replacement$);
  if revised = definition then
    raise exception 'Injuries sync_push patch anchor missing';
  end if;
  execute revised;
end $migration$;

-- Patch sync_pull RPC
do $migration$
declare
  definition text;
  revised text;
  anchor text;
  replacement text;
begin
  definition := pg_get_functiondef('app_public.sync_pull(jsonb)'::regprocedure);
  for anchor, replacement in select * from (values
    (
      $anchor$'session_plan_sets', 'session_plan_uses', 'training_notes'$anchor$,
      $replacement$'session_plan_sets', 'session_plan_uses', 'training_notes', 'injuries'$replacement$
    ),
    (
      $anchor$    when 1 then v_types := array['session_plans', 'exercise_muscle_mappings', 'exercise_tag_definitions', 'exercise_group_links', 'training_notes'];$anchor$,
      $replacement$    when 1 then v_types := array['session_plans', 'exercise_muscle_mappings', 'exercise_tag_definitions', 'exercise_group_links', 'training_notes', 'injuries'];$replacement$
    ),
    (
      $anchor$    union all
    select 'session_plans'::text$anchor$,
      $replacement$    union all
    select 'injuries'::text, inj.id, inj.client_updated_at_ms,
           inj.server_received_at, inj.owner_user_id,
           jsonb_build_object(
             'muscle_group_id', inj.muscle_group_id, 'side', inj.side,
             'status', inj.status, 'pain_score', inj.pain_score,
             'label', inj.label, 'notes', inj.notes,
             'contraindications', inj.contraindications,
             'started_at', inj.started_at, 'resolved_at', inj.resolved_at,
             'created_at', inj.created_at, 'updated_at', inj.updated_at,
             'deleted_at', inj.deleted_at)
      from app_public.injuries inj
      where inj.owner_user_id = auth.uid() and 'injuries' = any(v_types)
    union all
    select 'session_plans'::text$replacement$
    )
  ) patches(anchor, replacement) loop
    revised := replace(definition, anchor, replacement);
    if revised = definition then
      raise exception 'Injuries sync_pull patch anchor missing: %', anchor;
    end if;
    definition := revised;
  end loop;
  execute definition;
end $migration$;

-- Patch dev_wipe_my_data RPC
do $migration$
declare
  definition text;
  revised text;
begin
  definition := pg_get_functiondef('app_public.dev_wipe_my_data()'::regprocedure);
  revised := replace(
    definition,
    $anchor$  delete from app_public.exercise_group_links where owner_user_id = _uid;$anchor$,
    $patch$  delete from app_public.injuries where owner_user_id = _uid;
  get diagnostics _deleted = row_count;
  _total := _total + _deleted;

  delete from app_public.exercise_group_links where owner_user_id = _uid;$patch$
  );
  if revised = definition then
    raise exception 'Injuries dev_wipe_my_data patch anchor missing';
  end if;
  execute revised;
end $migration$;
