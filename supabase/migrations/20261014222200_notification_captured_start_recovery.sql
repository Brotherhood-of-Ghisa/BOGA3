-- Start admission belongs to the first active upload, not the source's state at recovery.
create or replace function app_public.notification_track_workout(p_member uuid,p_session text) returns void
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare s sessions; start_moment timestamptz; completion_moment timestamptz; completion_known boolean;
begin
  perform notification_source_lock(p_member,p_session);
  select * into s from sessions where owner_user_id=p_member and id=p_session;
  if not found then return; end if;
  select event_at into start_moment from notification_workout_moments
    where member_user_id=p_member and session_id=p_session and kind='start';
  select event_at into completion_moment from notification_workout_moments
    where member_user_id=p_member and session_id=p_session and kind='completion';
  completion_known:=found;
  insert into notification_workouts(member_user_id,session_id,start_at,completion_at,can_start,eligible)
    values(p_member,p_session,start_moment,completion_moment,start_moment is not null,
      case when completion_known then coalesce(completion_moment>=(select started_at from notification_workout_epoch),false)
        else s.status='active' end)
    on conflict(member_user_id,session_id) do update set completion_at=coalesce(notification_workouts.completion_at,excluded.completion_at),
      can_start=notification_workouts.can_start or (not notification_workouts.cutover_active
        and notification_workouts.start_at is not distinct from excluded.start_at and excluded.can_start),
      eligible=notification_workouts.eligible and (not completion_known or completion_moment is not null)
        and (s.status<>'completed' or completion_moment is not null)
      where notification_workouts.eligible;
end $$;

create function app_public.notification_start_ready(p_member uuid,p_session text,p_event_at timestamptz) returns boolean
language sql stable security definer set search_path=app_public,pg_temp as $$
  select exists(select 1 from notification_workouts w join sessions s
      on s.owner_user_id=w.member_user_id and s.id=w.session_id
    join notification_workout_moments m on m.member_user_id=w.member_user_id and m.session_id=w.session_id and m.kind='start'
    where w.member_user_id=p_member and w.session_id=p_session and w.eligible and w.can_start and not w.cutover_active
      and w.start_at=p_event_at and m.event_at=w.start_at and w.start_at>=(select started_at from notification_workout_epoch)
      and w.start_at+interval '24 hours'>now() and w.start_at<=now()+interval '5 minutes'
      and s.deleted_at is null and s.status in ('active','completed'));
$$;
revoke all on function app_public.notification_start_ready(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function app_public.notification_start_ready(uuid,text,timestamptz) to service_role;

-- Patch the shared producer/projection/handoff without resetting applied migration history or delivery identities.
do $$ declare definition text; anchor text; begin
  definition:=pg_get_functiondef('app_public.notification_start_workout(uuid,text)'::regprocedure);
  anchor:=$old$if not w.eligible or not w.can_start or w.completion_at is not null or w.start_at is null or w.start_at<(select started_at from notification_workout_epoch)
    or w.start_at+interval '24 hours'<=now() or w.start_at>now()+interval '5 minutes' or
    not exists(select 1 from sessions where owner_user_id=p_member and id=p_session and status='active' and deleted_at is null)$old$;
  if strpos(definition,anchor)=0 then raise exception 'notification start admission anchor changed'; end if;
  execute replace(definition,anchor,'if not notification_start_ready(p_member,p_session,w.start_at)');

  definition:=pg_get_functiondef('app_public.notification_projection(bigint)'::regprocedure);
  anchor:=$old$if n.kind='start' and (not activity or exists(select 1 from sessions s where s.owner_user_id=n.lifter_user_id
      and s.id=n.session_id and s.status<>'active'))$old$;
  if strpos(definition,anchor)=0 then raise exception 'notification start projection anchor changed'; end if;
  execute replace(definition,anchor,$new$if n.kind='start' and (not activity or
      (n.workout_generation is not null and not notification_start_ready(n.lifter_user_id,n.session_id,n.event_at)) or
      (n.workout_generation is null and exists(select 1 from sessions s where s.owner_user_id=n.lifter_user_id
        and s.id=n.session_id and s.status<>'active')))$new$);

  definition:=pg_get_functiondef('app_public.notification_begin_send(bigint,uuid,bigint)'::regprocedure);
  anchor:=$old$  if n.kind='completion' then$old$;
  if strpos(definition,anchor)=0 then raise exception 'notification start ordering anchor changed'; end if;
  execute replace(definition,anchor,$new$  if n.kind='completion' then
    -- A completion claimed concurrently must not cancel a live installation's admitted start before handoff.
    if exists(select 1 from app_public.notification_deliveries sd join app_public.notification_intents sn on sn.id=sd.intent_id
        join app_public.notification_installations si on si.id=sd.installation_id and si.binding_id=sd.binding_id
        where sn.recipient_user_id=n.recipient_user_id and sn.lifter_user_id=n.lifter_user_id and sn.session_id=n.session_id
          and sn.kind='start' and sn.workout_generation is not null and sn.expires_at>clock_timestamp()
          and si.user_id=n.recipient_user_id and si.active and si.permission and si.opted_in
          and si.environment=c.environment and si.project_id=c.project_id and si.bundle_id=c.bundle_id
          and exists(select 1 from auth.sessions auth_session where auth_session.id=si.auth_session_id
            and auth_session.user_id=si.user_id and (auth_session.not_after is null or auth_session.not_after>clock_timestamp()))
          and sd.state in ('pending','retry','leased','disabled') and app_public.notification_projection(sn.id) is not null) then
      update app_public.notification_deliveries set state='retry',available_at=clock_timestamp()+interval '10 seconds',claim_id=null,lease_until=null
        where id=d.id; return null;
    end if;$new$);
end $$;
