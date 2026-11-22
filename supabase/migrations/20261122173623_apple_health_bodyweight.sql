-- Read-only source identity and a reversible exclusion marker. Ignored rows
-- carry deleted_at, retaining every existing calculation's eligibility rule.
alter table app_public.body_weight_measurements
  add column source text default 'manual',
  add column external_id text,
  add column ignored boolean default false;

do $migration$
declare definition text; revised text; old_branch text; new_branch text;
begin
  definition := pg_get_functiondef('app_public.sync_push(jsonb)'::regprocedure);
  old_branch := substring(definition from '    elsif _type = ''body_weight_measurements'' then[\s\S]*?where excluded.client_updated_at_ms>app_public.body_weight_measurements.client_updated_at_ms;');
  if old_branch is null then raise exception 'Bodyweight push branch missing'; end if;
  new_branch := $branch$
    elsif _type = 'body_weight_measurements' then
      insert into app_public.body_weight_measurements (
        owner_user_id,id,weight_kg,measured_at,source,external_id,ignored,
        created_at,updated_at,deleted_at,client_updated_at_ms,server_received_at
      ) values (
        _uid,_id,(_fields->>'weight_kg')::double precision,(_fields->>'measured_at')::bigint,
        coalesce(_fields->>'source','manual'),_fields->>'external_id',coalesce((_fields->>'ignored')::boolean,false),
        (_fields->>'created_at')::bigint,(_fields->>'updated_at')::bigint,
        (_fields->>'deleted_at')::bigint,_cuam,_now_tstz
      ) on conflict (owner_user_id,id) do update set
        weight_kg=excluded.weight_kg,measured_at=excluded.measured_at,
        source=coalesce(_fields->>'source',app_public.body_weight_measurements.source),
        external_id=case when _fields ? 'external_id' then excluded.external_id else app_public.body_weight_measurements.external_id end,
        ignored=coalesce((_fields->>'ignored')::boolean,app_public.body_weight_measurements.ignored),
        created_at=excluded.created_at,updated_at=excluded.updated_at,
        deleted_at=case when app_public.body_weight_measurements.source='apple_health' and (_fields->>'ignored') is null
          then app_public.body_weight_measurements.deleted_at else excluded.deleted_at end,
        client_updated_at_ms=excluded.client_updated_at_ms,server_received_at=excluded.server_received_at
      where excluded.client_updated_at_ms>app_public.body_weight_measurements.client_updated_at_ms;
$branch$;
  revised := replace(definition,old_branch,new_branch);
  if revised=definition then raise exception 'Bodyweight push patch failed'; end if;
  execute revised;
end $migration$;

do $migration$
declare definition text; revised text;
begin
  definition := pg_get_functiondef('app_public.sync_pull(jsonb)'::regprocedure);
  revised := replace(definition,
    $anchor$'measured_at', bw.measured_at,$anchor$,
    $replacement$'measured_at', bw.measured_at,
             'source', bw.source,
             'external_id', bw.external_id,
             'ignored', bw.ignored,$replacement$);
  if revised=definition then raise exception 'Bodyweight pull projection missing'; end if;
  execute revised;
end $migration$;
