create table if not exists public.app_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  level text not null check (level in ('debug', 'info', 'warn', 'error')),
  source text not null check (source in ('app', 'backend', 'database', 'sync', 'auth')),
  event text not null,
  message text null,
  user_id uuid null,
  client_platform text null,
  client_app_version text null,
  client_build_number text null,
  client_runtime_version text null,
  client_update_id text null,
  client_channel text null,
  client_variant text null,
  context jsonb null
);

comment on table public.app_logs is
  'Minimal authenticated client app diagnostics for manual inspection.';

alter table public.app_logs enable row level security;

revoke all on table public.app_logs from public;
revoke all on table public.app_logs from anon;
revoke all on table public.app_logs from authenticated;
grant insert on table public.app_logs to authenticated;
grant select, insert, update, delete on table public.app_logs to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'app_logs'
      and policyname = 'app_logs_authenticated_insert'
  ) then
    create policy app_logs_authenticated_insert
    on public.app_logs
    for insert
    to authenticated
    with check (
      auth.uid() is not null
      and (user_id is null or user_id = auth.uid())
    );
  end if;
end
$$;

create index if not exists app_logs_created_at_idx
  on public.app_logs (created_at desc);

create index if not exists app_logs_level_created_at_idx
  on public.app_logs (level, created_at desc);

create index if not exists app_logs_event_created_at_idx
  on public.app_logs (event, created_at desc);

create index if not exists app_logs_user_id_created_at_idx
  on public.app_logs (user_id, created_at desc);
