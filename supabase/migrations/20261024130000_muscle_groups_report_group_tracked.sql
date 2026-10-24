-- Per-user muscle reporting: two synced, user-owned columns on each anatomy
-- entry. `report_group` names the muscle the entry reports under (null = the
-- entry is its own muscle); `tracked` (1/0) says whether that muscle counts.
-- No figure is stored, so existing rows need no backfill: null and 1 already
-- mean today's per-entry reporting.
--
-- The columns are additive, so the sync protocol does not move (see
-- docs/specs/05-data-model.md, "Client schema drift rule"). This migration
-- deploys before the app release that writes the fields.

alter table app_public.muscle_groups
  add column report_group text,
  add column tracked integer not null default 1;

-- Patch the installed sync functions in place so historical migrations stay
-- immutable. Each replacement must match exactly once, so a future baseline
-- edit fails this migration instead of silently leaving an asymmetric wire
-- contract.
create function pg_temp.replace_once(definition text, old text, new text, label text)
returns text
language plpgsql
as $fn$
begin
  if (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 then
    raise exception 'muscle report columns failed to patch %', label;
  end if;
  return replace(definition, old, new);
end
$fn$;

do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('app_public.sync_push(jsonb)'::regprocedure) into definition;

  definition := pg_temp.replace_once(definition,
    $old$        display_name, family_name, sort_order, is_editable,$old$,
    $new$        display_name, family_name, sort_order, is_editable,
        report_group, tracked,$new$,
    'sync_push: muscle_groups insert columns');

  -- A writer that omits a key inserts the stored default.
  definition := pg_temp.replace_once(definition,
    $old$        (_fields ->> 'is_editable')::integer,$old$,
    $new$        (_fields ->> 'is_editable')::integer,
        _fields ->> 'report_group',
        coalesce((_fields ->> 'tracked')::integer, 1),$new$,
    'sync_push: muscle_groups insert values');

  -- Omitted-field preservation: only a payload that carried the key may replace
  -- a stored value, so a writer predating the fields cannot reset a user's
  -- muscle setup.
  definition := pg_temp.replace_once(definition,
    $old$            is_editable          = excluded.is_editable,$old$,
    $new$            is_editable          = excluded.is_editable,
            report_group         = case when _fields ? 'report_group' then excluded.report_group
                                        else app_public.muscle_groups.report_group end,
            tracked              = case when _fields ? 'tracked' then excluded.tracked
                                        else app_public.muscle_groups.tracked end,$new$,
    'sync_push: muscle_groups omitted-field preservation');

  execute definition;
end
$migration$;

do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('app_public.sync_pull(jsonb)'::regprocedure) into definition;
  definition := pg_temp.replace_once(definition,
    $old$             'is_editable', mg.is_editable,$old$,
    $new$             'is_editable', mg.is_editable,
             'report_group', mg.report_group,
             'tracked', mg.tracked,$new$,
    'sync_pull: muscle_groups pull fields');
  execute definition;
end
$migration$;

drop function pg_temp.replace_once(text, text, text, text);
