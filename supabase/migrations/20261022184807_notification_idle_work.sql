-- Operational due-work checks never replace the exact proof at a provider handoff.
create function app_public.notification_recovery_candidates()
returns table(member uuid,session text,sort_at timestamptz)
language sql stable security definer set search_path=app_public,pg_temp as $$
  select s.owner_user_id,s.id,coalesce(w.updated_at,s.server_received_at)
  from sessions s left join notification_workouts w on w.member_user_id=s.owner_user_id and w.session_id=s.id
  where s.deleted_at is null and (w.member_user_id is null or w.eligible) and
    (s.started_at>=floor(extract(epoch from now()-interval '24 hours')*1000) or
     s.completed_at>=floor(extract(epoch from now()-interval '24 hours')*1000) or
     w.start_at+interval '24 hours'>now() or w.completion_at+interval '24 hours'>now() or
     exists(select 1 from notification_workout_moments m where m.member_user_id=s.owner_user_id
       and m.session_id=s.id and m.event_at+interval '24 hours'>now())) and (
    (w.member_user_id is null and (
      exists(select 1 from group_session_shares sh where sh.member_user_id=s.owner_user_id and sh.session_id=s.id) or
      exists(select 1 from group_memberships m join groups g on g.id=m.group_id and g.deleted_at is null
        where m.user_id=s.owner_user_id and extract(epoch from m.joined_at)*1000<=s.started_at
          and (m.ended_at is null or s.started_at<extract(epoch from m.ended_at)*1000)))) or
    (w.member_user_id is not null and w.completion_at is null and (s.status='completed' or exists(
      select 1 from notification_workout_moments m where m.member_user_id=s.owner_user_id and m.session_id=s.id and m.kind='completion'))) or
    exists(select 1 from group_memberships m join groups g on g.id=m.group_id and g.deleted_at is null
      where m.user_id=s.owner_user_id and extract(epoch from m.joined_at)*1000<=s.started_at
        and (m.ended_at is null or s.started_at<extract(epoch from m.ended_at)*1000) and not exists(
          select 1 from group_session_shares sh where sh.member_user_id=s.owner_user_id and sh.session_id=s.id and sh.group_id=m.group_id)) or
    (notification_start_ready(s.owner_user_id,s.id,w.start_at) and exists(
      select 1 from group_session_shares sh join group_memberships m on m.group_id=sh.group_id
      join groups g on g.id=sh.group_id and g.deleted_at is null
      where sh.member_user_id=s.owner_user_id and sh.session_id=s.id and m.ended_at is null and m.user_id<>s.owner_user_id
        and not exists(select 1 from notification_intents n where n.recipient_user_id=m.user_id
          and n.lifter_user_id=s.owner_user_id and n.session_id=s.id and n.kind='start'))) or
    (w.confirmed_at is not null and (w.enqueued_generation<w.generation or exists(
      select 1 from notification_intents n join notification_deliveries d on d.intent_id=n.id
      where n.lifter_user_id=s.owner_user_id and n.session_id=s.id and n.kind='completion' and
        ((d.state in ('pending','retry','disabled') and d.available_at<=now() and exists(
          select 1 from notification_config where singleton and sending_enabled and provider<>'disabled')) or
         (d.state='leased' and d.lease_until<=now()))))))
$$;

create function app_public.notification_work_pending() returns boolean
language sql stable security definer set search_path=app_public,pg_temp as $$
  select exists(select 1 from notification_recovery_candidates()) or
    exists(select 1 from notification_deliveries d join notification_intents n on n.id=d.intent_id where
      (d.state='sending' and d.lease_until<=now()) or
      (d.state in ('pending','retry','disabled','leased') and n.expires_at<=now()) or
      (d.state in ('pending','retry','disabled') and d.available_at<=now() and exists(
        select 1 from notification_config where singleton and sending_enabled and provider<>'disabled')) or
      (d.state='leased' and d.lease_until<=now()) or
      (d.state in ('pending','retry') and not exists(
        select 1 from notification_config where singleton and sending_enabled and provider<>'disabled')) or
      (d.state='ticket' and (d.receipt_lease_until is null or d.receipt_lease_until<=now()) and
        (d.receipt_available_at<=now() or d.ticket_at+interval '24 hours'<=now() or d.receipt_attempts>=20))) or
    exists(select 1 from notification_workouts w where
      ((not w.eligible or w.completion_at+interval '24 hours'<=now()) and exists(
        select 1 from notification_workout_targets t where t.member_user_id=w.member_user_id and t.session_id=w.session_id)) or
      (w.completion_at+interval '24 hours'<=now() and (w.eligible or w.manifest_digest is not null or
        w.context_digest is not null or w.confirmed_at is not null or w.contributions<>'[]'::jsonb or exists(
          select 1 from notification_workout_moments m where m.member_user_id=w.member_user_id and m.session_id=w.session_id)))) or
    exists(select 1 from notification_intents n where n.expires_at<now()-interval '30 days' and
      (n.contributions<>'[]'::jsonb or exists(select 1 from notification_deliveries d where d.intent_id=n.id
        and (d.ticket_id is not null or d.error_code is not null)))) or
    exists(select 1 from notification_installations i where not i.active and i.updated_at<now()-interval '30 days'
      and (i.encryption_key<>'' or i.token<>'retired:'||i.id::text));
$$;
revoke all on function app_public.notification_recovery_candidates(), app_public.notification_work_pending() from public,anon,authenticated;
grant execute on function app_public.notification_recovery_candidates(), app_public.notification_work_pending() to service_role;

-- Retain the established recovery fences, fair batch order and failure isolation.
do $$ declare definition text; old_query text; begin
  definition:=pg_get_functiondef('app_public.notification_recover_workouts(integer)'::regprocedure);
  old_query:=substring(definition from 'select s.owner_user_id as member,s.id as session from sessions s[\s\S]*?limit p_limit');
  if old_query is null then raise exception 'notification recovery selection anchor changed'; end if;
  execute replace(definition,old_query,
    'select member,session from notification_recovery_candidates() order by sort_at,member,session limit p_limit');

  definition:=pg_get_functiondef('app_public.notification_track_workout(uuid,text)'::regprocedure);
  if strpos(definition,'where notification_workouts.eligible;')=0 then raise exception 'notification tracking anchor changed'; end if;
  execute replace(definition,'where notification_workouts.eligible;',
    $new$where notification_workouts.eligible and
      (notification_workouts.completion_at,notification_workouts.can_start,notification_workouts.eligible) is distinct from
      (coalesce(notification_workouts.completion_at,excluded.completion_at),
       notification_workouts.can_start or (not notification_workouts.cutover_active
         and notification_workouts.start_at is not distinct from excluded.start_at and excluded.can_start),
       notification_workouts.eligible and (not completion_known or completion_moment is not null)
         and (s.status<>'completed' or completion_moment is not null));$new$);

  definition:=pg_get_functiondef('app_public.notification_start_workout(uuid,text)'::regprocedure);
  if strpos(definition,'where id=intent and generation=w.generation;')=0 then raise exception 'notification start update anchor changed'; end if;
  execute replace(definition,'where id=intent and generation=w.generation;',
    'where id=intent and generation=w.generation and workout_generation is distinct from w.generation;');

  definition:=pg_get_functiondef('app_public.notification_confirm_completion(text,jsonb)'::regprocedure);
  if strpos(definition,'  perform notification_track_workout(u,p_session_id);')=0 then raise exception 'notification confirmation tracking anchor changed'; end if;
  definition:=replace(definition,'  perform notification_track_workout(u,p_session_id);',
    $new$  if not exists(select 1 from notification_workouts w where w.member_user_id=u and w.session_id=p_session_id and
      (not w.eligible or (exists(select 1 from notification_workout_moments m where m.member_user_id=u
        and m.session_id=p_session_id and m.kind='completion' and m.event_at=w.completion_at) and
        (w.can_start or w.cutover_active or not exists(select 1 from notification_workout_moments m
          where m.member_user_id=u and m.session_id=p_session_id and m.kind='start' and m.event_at=w.start_at))))) then
    perform notification_track_workout(u,p_session_id);
  end if;$new$);
  if strpos(definition,'where member_user_id=u and session_id=p_session_id and eligible returning generation into gen;')=0 then
    raise exception 'notification confirmation update anchor changed'; end if;
  execute replace(definition,'where member_user_id=u and session_id=p_session_id and eligible returning generation into gen;',
    $new$where member_user_id=u and session_id=p_session_id and eligible and
      (manifest_digest is distinct from digest or context_digest is distinct from context or confirmed_at is null)
      returning generation into gen;
  if gen is null then select generation into gen from notification_workouts
    where member_user_id=u and session_id=p_session_id and eligible; end if;$new$);

  definition:=pg_get_functiondef('app_public.notification_sweep()'::regprocedure);
  if strpos(definition,'if endpoint is null or key is null then return null; end if;')=0 then raise exception 'notification sweep anchor changed'; end if;
  execute replace(definition,'if endpoint is null or key is null then return null; end if;',
    'if endpoint is null or key is null or not notification_work_pending() then return null; end if;');
end $$;

-- Relevant source writes still recover a missed share, without waking on private-only edits.
do $$ declare definition text; begin
  definition:=pg_get_functiondef('app_public.notification_on_workout_row()'::regprocedure);
  definition:=replace(definition,'moment_kind text;','moment_kind text; source_session text;');
  if strpos(definition,'    perform notification_kick_once();')=0 then raise exception 'notification intake kick anchor changed'; end if;
  execute replace(definition,'    perform notification_kick_once();',
    $new$    if tg_table_name='sessions' then source_session:=new.id;
    elsif tg_table_name='session_exercises' then source_session:=new.session_id;
    else select session_id into source_session from session_exercises where owner_user_id=new.owner_user_id and id=new.session_exercise_id; end if;
    if exists(select 1 from group_session_shares sh join groups g on g.id=sh.group_id and g.deleted_at is null
        where sh.member_user_id=new.owner_user_id and sh.session_id=source_session) or exists(
      select 1 from sessions s join group_memberships m on m.user_id=s.owner_user_id
      join groups g on g.id=m.group_id and g.deleted_at is null
      where s.owner_user_id=new.owner_user_id and s.id=source_session and extract(epoch from m.joined_at)*1000<=s.started_at
        and (m.ended_at is null or s.started_at<extract(epoch from m.ended_at)*1000)) then
      perform notification_kick_once();
    end if;$new$);
end $$;

-- A settled summary is immutable; only unfinished delivery still needs repeated context confirmation.
do $$ declare definition text; anchor text:='and coalesce(w.eligible,true) and s.status=''completed'''; begin
  definition:=pg_get_functiondef('app_public.notification_pending_completions(text)'::regprocedure);
  if strpos(definition,anchor)=0 then raise exception 'notification completion reader anchor changed'; end if;
  execute replace(definition,anchor,$new$and coalesce(w.eligible,true) and
      (w.confirmed_at is null or w.enqueued_generation<w.generation or exists(
        select 1 from notification_intents n join notification_deliveries d on d.intent_id=n.id
        where n.lifter_user_id=u and n.session_id=s.id and n.kind='completion'
          and d.state in ('pending','retry','disabled','leased','sending')))
      and s.status='completed'$new$);
end $$;

-- Readiness cannot succeed without confirmation; don't invoke its proof helper for those rows.
do $$ declare definition text; anchor text:='where w.eligible and w.enqueued_generation<w.generation'; begin
  definition:=pg_get_functiondef('app_public.notification_workout_prepare(integer)'::regprocedure);
  if strpos(definition,anchor)=0 then raise exception 'notification preparation confirmation anchor changed'; end if;
  execute replace(definition,anchor,anchor||' and w.confirmed_at is not null');
end $$;

-- An idle early row must not consume the transaction's kick before a later row creates work.
create or replace function app_public.notification_kick_once() returns void
language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  if current_setting('boga.notification_kicked',true)='true' then return; end if;
  if notification_sweep() is not null then perform set_config('boga.notification_kicked','true',true); end if;
end $$;
