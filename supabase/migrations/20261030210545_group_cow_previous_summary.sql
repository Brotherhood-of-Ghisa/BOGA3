-- Today reads both weeks independently; legacy previews retain their current-or-final fallback.
create function app_public.group_cow_previous_summary(p_group_id uuid) returns jsonb
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid:=app_public.group_require_app_user(); c app_public.group_cows; g app_public.groups;
  observed timestamptz; deadline timestamptz; week date; result jsonb; selection text:='none';
begin
  perform app_public.group_cow_reject_agent();
  perform app_public.group_competition_require_member(p_group_id,u);
  select * into strict g from app_public.groups where id=p_group_id;
  observed:=clock_timestamp();
  if g.cow_time_zone is not null then
    week:=app_public.group_cow_week(g.cow_time_zone,observed);
    deadline:=upper(app_public.group_cow_bounds(g.cow_time_zone,week));
    select * into c from app_public.group_cows where group_id=p_group_id and cancelled_at is null
      and week_start=week-7 and ends_at<=observed order by starts_at desc,id desc limit 1;
    if found then
      selection:='previous';
      result:=app_public.group_cow_public_result(c,c.metrics,null,3,true);
    end if;
  else deadline:=observed; end if;
  return jsonb_build_object('group_id',g.id,'week_start',week,'calendar_revision',g.cow_calendar_revision,
    'observed_at_us',app_public.group_cow_us(observed),'valid_until_us',app_public.group_cow_us(deadline),
    'selection',selection,'result',result);
end $$;
revoke all on function app_public.group_cow_previous_summary(uuid) from public,anon,authenticated,service_role;
grant execute on function app_public.group_cow_previous_summary(uuid) to anon,authenticated;
