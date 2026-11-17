-- The user grant-management endpoint rejects OAuth client access tokens.
-- Only the Edge Function service role may inspect this one validated identity.
create function public.agent_active_oauth_grant(p_owner uuid, p_client_id text)
returns timestamptz
language plpgsql stable security definer
set search_path = ''
as $$
declare
  granted timestamptz;
begin
  -- Defense in depth: privileged RPCs must independently reject agent callers.
  if (select auth.jwt()->>'client_id') is not null then
    raise exception 'AGENT_FORBIDDEN' using errcode = '42501';
  end if;
  if (select auth.jwt()->>'role') is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;

  select consent.granted_at into granted
  from auth.oauth_consents as consent
  join auth.oauth_clients as client on client.id = consent.client_id
  where consent.user_id = p_owner
    and consent.client_id::text = p_client_id
    and consent.revoked_at is null
    and client.deleted_at is null;
  return granted;
end;
$$;

revoke all on function public.agent_active_oauth_grant(uuid, text) from public, anon, authenticated;
grant execute on function public.agent_active_oauth_grant(uuid, text) to service_role;
comment on function public.agent_active_oauth_grant(uuid, text) is
  'Server-only active OAuth consent timestamp for an Auth-validated owner/client pair. No caller token, grant mutation, or Auth table access is exposed.';
