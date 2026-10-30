-- Migration: 20261028190000_plan_graph_version_trigger_identity.sql
-- Plan graph_version triggers never set the request identity.
--
-- 20261024140000 bumped graph_version from BEFORE INSERT/UPDATE/DELETE
-- triggers on session_plan_exercises and session_plan_sets through
-- advance_plan_graph_version(), which set request.jwt.claim.sub to the row's
-- owner_user_id when it was empty. PostgREST sends identity only in
-- request.jwt.claims, and auth.uid() reads claim.sub first, so the row's
-- claimed owner became auth.uid() for the rest of the transaction and the RLS
-- WITH CHECK (evaluated after BEFORE triggers) accepted a row claiming another
-- owner.
--
-- Rules from here on:
--   * A trigger never writes request.jwt.claim.* (or any request identity).
--   * Graph/provenance trigger functions are SECURITY INVOKER, so their parent
--     reads, locks and bumps run under the caller's RLS. An app user's bump can
--     only reach their own rows; agent RPCs (SECURITY DEFINER, service-role
--     only) keep bypassing RLS under the owner context they set from their
--     validated p_owner argument.
--   * With no identity at all (auth.uid() is null: RLS-bypassing maintenance
--     such as the auth.users delete cascade) the parent bump is skipped. The
--     owner guard refuses every UPDATE without an identity, so bumping would
--     abort the whole write; the token only orders agent edits against app and
--     agent writes, which always carry an identity.

-- The two helpers existed only to serve the triggers below and were the code
-- that set the identity. Nothing else calls them.
drop function if exists app_public.advance_plan_graph_version(uuid, text);
drop function if exists app_public.advance_programme_graph_version(uuid, text);

-- Bumps the plan's graph_version and its programme's. Both plan-child
-- triggers run this same body (inlined rather than shared through a helper, so
-- app_public gains no callable RPC).
create or replace function app_public.coordinate_session_plan_exercise_sync_lock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $func$
declare
  _plan_id text;
  _owner   uuid;
  _prog_id text;
begin
  _plan_id := coalesce(new.session_plan_id, old.session_plan_id);
  _owner   := coalesce(new.owner_user_id, old.owner_user_id);

  if _plan_id is not null and _owner is not null and auth.uid() is not null then
    select sp.programme_id
      into _prog_id
      from app_public.session_plans sp
     where sp.owner_user_id = _owner
       and sp.id = _plan_id;

    if _prog_id is not null then
      update app_public.training_programmes tp
         set graph_version = greatest(clock_timestamp(), coalesce(tp.graph_version, clock_timestamp()) + interval '1 microsecond')
       where tp.owner_user_id = _owner
         and tp.id = _prog_id;
    end if;

    update app_public.session_plans sp
       set graph_version = greatest(clock_timestamp(), coalesce(sp.graph_version, clock_timestamp()) + interval '1 microsecond')
     where sp.owner_user_id = _owner
       and sp.id = _plan_id;
  end if;
  return coalesce(new, old);
end;
$func$;

create or replace function app_public.coordinate_session_plan_set_sync_lock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $func$
declare
  _block_id text;
  _plan_id  text;
  _owner    uuid;
  _prog_id  text;
begin
  _block_id := coalesce(new.session_plan_exercise_id, old.session_plan_exercise_id);
  _owner    := coalesce(new.owner_user_id, old.owner_user_id);

  if _block_id is not null and _owner is not null and auth.uid() is not null then
    select spe.session_plan_id, sp.programme_id
      into _plan_id, _prog_id
      from app_public.session_plan_exercises spe
      join app_public.session_plans sp
        on sp.owner_user_id = spe.owner_user_id
       and sp.id = spe.session_plan_id
     where spe.owner_user_id = _owner
       and spe.id = _block_id;

    if _prog_id is not null then
      update app_public.training_programmes tp
         set graph_version = greatest(clock_timestamp(), coalesce(tp.graph_version, clock_timestamp()) + interval '1 microsecond')
       where tp.owner_user_id = _owner
         and tp.id = _prog_id;
    end if;

    if _plan_id is not null then
      update app_public.session_plans sp
         set graph_version = greatest(clock_timestamp(), coalesce(sp.graph_version, clock_timestamp()) + interval '1 microsecond')
       where sp.owner_user_id = _owner
         and sp.id = _plan_id;
    end if;
  end if;
  return coalesce(new, old);
end;
$func$;

create or replace function app_public.coordinate_session_plan_delete_graph_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $func$
begin
  if old.programme_id is not null and old.owner_user_id is not null and auth.uid() is not null then
    update app_public.training_programmes tp
       set graph_version = greatest(clock_timestamp(), coalesce(tp.graph_version, clock_timestamp()) + interval '1 microsecond')
     where tp.owner_user_id = old.owner_user_id
       and tp.id = old.programme_id;
  end if;
  return old;
end;
$func$;

-- The remaining graph and provenance trigger functions keep their bodies; they
-- only lose SECURITY DEFINER so their reads and row locks obey the caller's RLS.
alter function app_public.touch_session_plan_graph_version() security invoker;
alter function app_public.touch_training_programme_graph_version() security invoker;
alter function app_public.coordinate_session_exercise_provenance_lock() security invoker;
alter function app_public.coordinate_exercise_set_provenance_lock() security invoker;
