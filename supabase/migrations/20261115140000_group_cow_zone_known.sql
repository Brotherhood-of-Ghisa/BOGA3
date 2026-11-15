-- The CoW calendar reads a group's zone through group_cow_week and
-- group_cow_bounds, which validate it on every call. The validation looked the
-- zone up in pg_timezone_names, a view that reads every zone file (~800 ms per
-- call), so group_cow_calendar_get, the summaries and every CoW window paid it.
--
-- Now a zone the server already lists is recognised from a list taken once, here,
-- from this database's own pg_timezone_names (the same names, minus posix/ and
-- right/, so the set is this database's whatever its tz data). A name outside
-- that list still goes to the view, so a zone a later tz update adds is still
-- accepted, and one that was never a zone is still rejected, as before. The
-- shape checks are unchanged and run first.
do $zones$
declare listed text[];
begin
  select array_agg(name order by name) into listed
    from pg_catalog.pg_timezone_names where name !~ '^(posix|right)/';
  execute format($def$
    create function app_public.group_cow_zone_known(p_zone text) returns boolean
    language sql immutable set search_path=app_public,pg_temp as $body$
      select p_zone = any(%L::text[]);
    $body$
  $def$, listed);
end $zones$;
revoke all on function app_public.group_cow_zone_known(text) from public,anon,authenticated,service_role;

create or replace function app_public.group_cow_zone(p_zone text) returns text
language plpgsql stable set search_path=app_public,pg_temp as $$
begin
  if p_zone is null or p_zone<>btrim(p_zone) or
    (p_zone<>'UTC' and p_zone !~ '^[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+$') or
    not (app_public.group_cow_zone_known(p_zone) or
      exists(select 1 from pg_catalog.pg_timezone_names where name=p_zone and name !~ '^(posix|right)/')) then
    raise exception 'VALIDATION: choose a valid IANA time zone' using errcode='P0001';
  end if;
  return p_zone;
end $$;
revoke all on function app_public.group_cow_zone(text) from public,anon,authenticated,service_role;
