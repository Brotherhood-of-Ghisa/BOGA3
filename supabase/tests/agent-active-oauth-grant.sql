-- Runs against a migrated local Supabase database; all fixtures roll back.
\set ON_ERROR_STOP on
begin;
create temp table grant_check_fixture as
select gen_random_uuid() as owner, gen_random_uuid() as other_owner,
  gen_random_uuid() as client, gen_random_uuid() as other_client,
  '2026-01-01 00:00:00.123456+00'::timestamptz as stamp;
insert into auth.users(id) select owner from grant_check_fixture
union all select other_owner from grant_check_fixture;
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,token_endpoint_auth_method)
select client,'dynamic'::auth.oauth_registration_type,'https://example.invalid/callback','authorization_code,refresh_token','none' from grant_check_fixture
union all select other_client,'dynamic','https://example.invalid/callback','authorization_code,refresh_token','none' from grant_check_fixture;
insert into auth.oauth_consents(id,user_id,client_id,scopes,granted_at)
select gen_random_uuid(),owner,client,'openid profile',stamp from grant_check_fixture;

-- ACLs deny anonymous users, app users and OAuth users before any table read.
do $$
begin
  if has_function_privilege('anon','public.agent_active_oauth_grant(uuid,text)','execute') or
    has_function_privilege('authenticated','public.agent_active_oauth_grant(uuid,text)','execute') or
    not has_function_privilege('service_role','public.agent_active_oauth_grant(uuid,text)','execute') then
    raise exception 'service-only grant check ACL regression';
  end if;
end $$;
set local role anon;
do $$ begin
  perform public.agent_active_oauth_grant(null,null);
  raise exception 'anonymous grant lookup unexpectedly allowed';
exception when insufficient_privilege then null; end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
do $$ begin
  perform public.agent_active_oauth_grant(null,null);
  raise exception 'app grant lookup unexpectedly allowed';
exception when insufficient_privilege then null; end $$;
select set_config('request.jwt.claims','{"role":"authenticated","client_id":"oauth-client"}',true);
do $$ begin
  perform public.agent_active_oauth_grant(null,null);
  raise exception 'OAuth grant lookup unexpectedly allowed';
exception when insufficient_privilege then null; end $$;
reset role;

-- Defense in depth even if a privileged caller forwards OAuth claims.
select set_config('request.jwt.claims','{"role":"service_role","client_id":"oauth-client"}',true);
do $$ begin
  perform public.agent_active_oauth_grant(null,null);
  raise exception 'OAuth claims unexpectedly accepted';
exception when insufficient_privilege then null; end $$;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
do $$ begin
  perform public.agent_active_oauth_grant(null,null);
  raise exception 'non-service claims unexpectedly accepted';
exception when insufficient_privilege then null; end $$;

select set_config('request.jwt.claims','{"role":"service_role"}',true);
grant select on grant_check_fixture to service_role;
set local role service_role;
do $$
declare f record; observed timestamptz;
begin
  select * into f from grant_check_fixture;
  observed := public.agent_active_oauth_grant(f.owner,f.client::text);
  if observed is distinct from f.stamp then raise exception 'active timestamp not preserved'; end if;
  if public.agent_active_oauth_grant(f.other_owner,f.client::text) is not null then raise exception 'cross-owner grant leaked'; end if;
  if public.agent_active_oauth_grant(f.owner,f.other_client::text) is not null then raise exception 'cross-client grant leaked'; end if;
  if public.agent_active_oauth_grant(f.owner,'not-a-client-id') is not null then raise exception 'malformed client matched'; end if;
end $$;
reset role;
update auth.oauth_consents set revoked_at = granted_at + interval '1 day'
where user_id = (select owner from grant_check_fixture);
do $$ begin
  if public.agent_active_oauth_grant((select owner from grant_check_fixture),(select client::text from grant_check_fixture)) is not null then
    raise exception 'revoked consent accepted'; end if;
end $$;
update auth.oauth_consents set revoked_at = null, granted_at = granted_at + interval '2 days'
where user_id = (select owner from grant_check_fixture);
do $$ begin
  if public.agent_active_oauth_grant((select owner from grant_check_fixture),(select client::text from grant_check_fixture))
    is distinct from (select stamp + interval '2 days' from grant_check_fixture) then
    raise exception 'new consent reused old timestamp'; end if;
end $$;
update auth.oauth_clients set deleted_at = now() where id = (select client from grant_check_fixture);
do $$ begin
  if public.agent_active_oauth_grant((select owner from grant_check_fixture),(select client::text from grant_check_fixture)) is not null then
    raise exception 'deleted client accepted'; end if;
end $$;
rollback;
\echo 'agent-active-oauth-grant SQL checks passed'
