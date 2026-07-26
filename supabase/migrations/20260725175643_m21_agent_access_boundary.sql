-- M21: read-only OAuth agent boundary and minimal access audit.
--
-- Supabase OAuth access tokens are ordinary authenticated JWTs with an
-- additional `client_id` claim. Existing application RLS policies therefore
-- need a restrictive companion policy: normal app sessions (no client_id)
-- retain their existing owner-scoped CRUD access, while OAuth sessions cannot
-- reach the domain tables or sync RPC data paths directly. The dedicated
-- BoGa3 agent API uses the service role only after live Auth/grant validation
-- and always adds its own validated owner predicate.

alter table app_public.user_profiles
  add column if not exists training_unit text not null default 'kg',
  add column if not exists time_zone text not null default 'UTC';

alter table app_public.user_profiles
  drop constraint if exists user_profiles_training_unit_valid,
  add constraint user_profiles_training_unit_valid
    check (training_unit = 'kg'),
  drop constraint if exists user_profiles_time_zone_non_empty,
  add constraint user_profiles_time_zone_non_empty
    check (length(btrim(time_zone)) between 1 and 100);

comment on column app_public.user_profiles.training_unit is
  'Training load unit exposed by the read-only agent profile. M21 supports kg only.';
comment on column app_public.user_profiles.time_zone is
  'IANA timezone used for training timestamps; defaults to UTC until explicitly configured.';

do $m21$
declare
  table_name text;
begin
  foreach table_name in array array[
    'gyms',
    'exercise_definitions',
    'muscle_groups',
    'exercise_tag_definitions',
    'sessions',
    'exercise_muscle_mappings',
    'session_exercises',
    'exercise_sets',
    'session_exercise_tags'
  ]
  loop
    execute format(
      'drop policy if exists %I on app_public.%I',
      table_name || '_direct_app_only',
      table_name
    );
    execute format(
      'create policy %I on app_public.%I as restrictive for all to authenticated using (((select auth.jwt()) ->> ''client_id'') is null) with check (((select auth.jwt()) ->> ''client_id'') is null)',
      table_name || '_direct_app_only',
      table_name
    );
  end loop;
end
$m21$;

drop policy if exists user_profiles_direct_app_only on app_public.user_profiles;
create policy user_profiles_direct_app_only
on app_public.user_profiles
as restrictive
for all
to authenticated
using (((select auth.jwt()) ->> 'client_id') is null)
with check (((select auth.jwt()) ->> 'client_id') is null);

drop policy if exists app_logs_direct_app_only on public.app_logs;
create policy app_logs_direct_app_only
on public.app_logs
as restrictive
for all
to authenticated
using (((select auth.jwt()) ->> 'client_id') is null)
with check (((select auth.jwt()) ->> 'client_id') is null);

create table if not exists public.agent_access_audit (
  id bigint generated always as identity primary key,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  oauth_client_id text not null,
  tool_name text not null,
  occurred_at timestamptz not null default timezone('utc', now()),
  http_status integer not null,
  request_id text not null,
  duration_ms integer not null,
  constraint agent_access_audit_client_non_empty
    check (length(btrim(oauth_client_id)) between 1 and 200),
  constraint agent_access_audit_tool_non_empty
    check (length(btrim(tool_name)) between 1 and 100),
  constraint agent_access_audit_http_status_valid
    check (http_status between 100 and 599),
  constraint agent_access_audit_request_id_non_empty
    check (length(btrim(request_id)) between 1 and 200),
  constraint agent_access_audit_duration_non_negative
    check (duration_ms >= 0)
);

comment on table public.agent_access_audit is
  'Minimal M21 metadata-only audit for authenticated BoGa agent API access. Never stores credentials or training payloads.';

alter table public.agent_access_audit enable row level security;

revoke all on table public.agent_access_audit from public;
revoke all on table public.agent_access_audit from anon;
revoke all on table public.agent_access_audit from authenticated;
grant select on table public.agent_access_audit to authenticated;
grant select, insert, update, delete on table public.agent_access_audit to service_role;
grant usage, select on sequence public.agent_access_audit_id_seq to service_role;

drop policy if exists agent_access_audit_owner_app_select on public.agent_access_audit;
create policy agent_access_audit_owner_app_select
on public.agent_access_audit
for select
to authenticated
using (
  owner_user_id = (select auth.uid())
  and ((select auth.jwt()) ->> 'client_id') is null
);

create index if not exists agent_access_audit_owner_client_occurred_idx
  on public.agent_access_audit (owner_user_id, oauth_client_id, occurred_at desc);

create index if not exists agent_access_audit_occurred_at_idx
  on public.agent_access_audit (occurred_at desc);
