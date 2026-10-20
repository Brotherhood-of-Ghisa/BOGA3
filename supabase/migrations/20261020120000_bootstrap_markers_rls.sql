-- public.local_runtime_bootstrap_markers is an internal bootstrap stamp table
-- written and read only through psql (postgres) by the seed and the baseline
-- script. It shipped with RLS off and full default grants for anon and
-- authenticated, so anyone holding the project URL and anon key could read,
-- edit and truncate it over PostgREST (Supabase lint rls_disabled_in_public).
--
-- Enable RLS with no policy and drop the API roles' access: the table is no
-- longer reachable or discoverable through the Data API. postgres and
-- service_role keep their access (service_role bypasses RLS).

alter table public.local_runtime_bootstrap_markers enable row level security;

revoke all on table public.local_runtime_bootstrap_markers from anon, authenticated;
