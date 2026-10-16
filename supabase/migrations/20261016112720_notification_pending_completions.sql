create index notification_completion_time_idx
  on app_public.notification_workout_moments(member_user_id,event_at,session_id)
  where kind='completion' and event_at is not null;

-- Client clocks may move; only the original server-captured deadline selects proof candidates.
create function app_public.notification_pending_completions(p_after_session_id text default null) returns jsonb
language plpgsql stable security definer set search_path=app_public,pg_temp as $$
declare u uuid:=notification_app_user(); result jsonb;
begin
  if p_after_session_id is not null and (length(p_after_session_id)=0 or length(p_after_session_id)>160) then
    raise exception 'VALIDATION: invalid completion cursor' using errcode='P0001';
  end if;
  with candidates as (
    select s.id from notification_workout_moments m
    join sessions s on s.owner_user_id=m.member_user_id and s.id=m.session_id
    left join notification_workouts w on w.member_user_id=m.member_user_id and w.session_id=m.session_id
    where m.member_user_id=u and m.kind='completion' and m.event_at is not null
      and m.event_at>=(select started_at from notification_workout_epoch)
      and m.event_at>now()-interval '24 hours' and m.event_at<=now()+interval '5 minutes'
      and coalesce(w.completion_at,m.event_at)>now()-interval '24 hours'
      and coalesce(w.completion_at,m.event_at)<=now()+interval '5 minutes'
      and coalesce(w.eligible,true) and s.status='completed' and s.completed_at is not null and s.deleted_at is null
      and (p_after_session_id is null or s.id collate "C">p_after_session_id collate "C")
    order by s.id collate "C" limit 11
  ), batch as (select id from candidates order by id collate "C" limit 10)
  select jsonb_build_object(
    'session_ids',(select coalesce(jsonb_agg(id order by id collate "C"),'[]'::jsonb) from batch),
    'next_session_id',case when (select count(*) from candidates)>10
      then (select id from batch order by id collate "C" desc limit 1) else null end
  ) into result;
  return result;
end $$;
revoke all on function app_public.notification_pending_completions(text) from public,anon,authenticated;
grant execute on function app_public.notification_pending_completions(text) to authenticated;
