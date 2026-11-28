-- Meet start and end pushes on the durable notification pipeline, and the
-- per-group Meets preference. Rules: docs/product/notifications.md
-- ([[notifications.meets]]); boundary: docs/specs/tech/group-meet-contract.md
-- "Notifications". Meet intents carry no lifter or session: the meet is the
-- subject and `session_id` repeats its id for the intent's existing NOT NULL.

-- 1. Preference: one column beside the per-group mute. No row means on.
alter table app_public.notification_group_preferences
  add column meets boolean not null default true;

-- 2. Intents: a meet kind, its meet, and a nullable lifter.
alter table app_public.notification_intents
  add column meet_id uuid references app_public.group_meets(id) on delete cascade,
  alter column lifter_user_id drop not null,
  drop constraint notification_intents_kind_check,
  add constraint notification_intents_kind_check check (kind in ('start','completion','meet_start','meet_end')),
  add constraint notification_intents_subject check (
    (kind in ('start','completion') and lifter_user_id is not null and meet_id is null)
    or (kind in ('meet_start','meet_end') and lifter_user_id is null and meet_id is not null
      and session_id = meet_id::text));
-- One intent per recipient x meet x moment: a retry returns the same intent.
create unique index notification_intents_meet_key on app_public.notification_intents(recipient_user_id, meet_id, kind)
  where meet_id is not null;

-- 3. Preference RPCs. `meets` is per group, so the global read reports the default.
create or replace function app_public.notification_preferences_get(p_group_id uuid default null) returns jsonb
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid := app_public.notification_app_user(); p notification_preferences; muted boolean := false; meets boolean := true;
begin
  if p_group_id is not null then
    perform app_public.group_require_member(p_group_id,u,false);
    select g.muted,g.meets into muted,meets from notification_group_preferences g where g.user_id=u and g.group_id=p_group_id;
  end if;
  select * into p from notification_preferences where user_id=u;
  return jsonb_build_object('activity',coalesce(p.activity,true),'bests',coalesce(p.bests,true),
    'ranks',coalesce(p.ranks,true),'muted',coalesce(muted,false),'meets',coalesce(meets,true));
end $$;

create function app_public.notification_group_meets_set(p_group_id uuid,p_meets boolean) returns jsonb
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare u uuid := app_public.notification_app_user();
begin
  perform app_public.group_require_member(p_group_id,u,true);
  if p_meets is null then raise exception 'VALIDATION: invalid meets preference'; end if;
  insert into notification_group_preferences(user_id,group_id,meets) values(u,p_group_id,p_meets)
    on conflict(user_id,group_id) do update set meets=excluded.meets;
  return app_public.notification_preferences_get(p_group_id);
end $$;

-- 4. Producer seam: one intent per recipient x meet x moment, like
-- notification_enqueue (same lock order) but with no generation or contributions.
create function app_public.notification_meet_enqueue(p_meet uuid,p_recipient uuid,p_kind text,p_event_at timestamptz)
returns bigint
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare k bigint;
begin
  if p_meet is null or p_recipient is null or p_kind is null or p_kind not in ('meet_start','meet_end') or
     p_event_at is null or p_event_at>now()+interval '5 minutes' then
    raise exception 'VALIDATION: invalid notification intent';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_recipient::text||':meet:'||p_meet::text||':'||p_kind,0));
  perform pg_advisory_xact_lock(hashtextextended('notification-registration',0));
  select id into k from notification_intents where recipient_user_id=p_recipient and meet_id=p_meet and kind=p_kind;
  if found then return k; end if;
  insert into notification_intents(recipient_user_id,lifter_user_id,session_id,kind,meet_id,event_at,expires_at)
    values(p_recipient,null,p_meet::text,p_kind,p_meet,p_event_at,p_event_at+interval '24 hours') returning id into k;
  insert into notification_deliveries(intent_id,installation_id,binding_id,generation)
    select k,i.id,i.binding_id,1 from notification_installations i
    where i.user_id=p_recipient and i.active and i.permission and i.opted_in and p_event_at+interval '24 hours'>now();
  return k;
end $$;

-- Fires one meet moment for the group's current members, from the meet's own
-- timed transition (group_meet_advance_meet), in its transaction. Sends
-- nothing for a cancelled meet, a moment older than the freshness window
-- ([[notifications.freshness]]), a start the meet's end has already passed,
-- or a member whose Meets preference is off or whose group is muted. A failure
-- is logged and never blocks the transition's stream item or its snapshot.
create function app_public.notification_meet_publish(p_meet app_public.group_meets,p_kind text,p_now timestamptz)
returns integer
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare _at timestamptz := case p_kind when 'meet_start' then p_meet.starts_at else p_meet.ends_at end;
  _recipient uuid; _count integer := 0;
begin
  if p_meet.cancelled_at is not null or _at+interval '24 hours'<=p_now
     or (p_kind='meet_start' and p_meet.ends_at<=p_now) then
    return 0;
  end if;
  for _recipient in select m.user_id from group_memberships m join groups g on g.id=m.group_id and g.deleted_at is null
      where m.group_id=p_meet.group_id and m.ended_at is null
        and not exists(select 1 from notification_group_preferences p
          where p.user_id=m.user_id and p.group_id=m.group_id and (p.muted or not p.meets))
      order by m.user_id loop
    perform notification_meet_enqueue(p_meet.id,_recipient,p_kind,_at);
    _count := _count+1;
  end loop;
  -- Wake the delivery worker like the workout producers do; without it the
  -- push waits for the hourly sweep. A failed kick never discards the intents.
  if _count>0 then
    begin perform notification_kick_once(); exception when others then null; end;
  end if;
  return _count;
exception when others then
  perform app_public.group_eval_log_failure('group.meet_notification_failed',null,
    jsonb_build_object('meet_id',p_meet.id,'group_id',p_meet.group_id,'kind',p_kind,'sqlstate',sqlstate));
  return 0;
end $$;

do $migration$
declare definition text; revised text;
begin
  definition := pg_get_functiondef('app_public.group_eval_log_failure(text,uuid,jsonb)'::regprocedure);
  revised := replace(definition,
    $anchor$        else 'group evaluator job failed; it stays queued and retries'$anchor$,
    $patch$        when 'group.meet_notification_failed' then 'meet notification could not be queued; the meet transition committed'
        else 'group evaluator job failed; it stays queued and retries'$patch$);
  if revised = definition then raise exception 'group_eval_log_failure meet notification anchor missing'; end if;
  execute revised;

  definition := pg_get_functiondef('app_public.group_meet_advance_meet(app_public.group_meets,timestamptz,uuid)'::regprocedure);
  revised := replace(definition,
    $anchor$    update app_public.group_meets set on_at = p_now where id = p_meet.id;$anchor$,
    $patch$    update app_public.group_meets set on_at = p_now where id = p_meet.id;
    perform app_public.notification_meet_publish(p_meet, 'meet_start', p_now);$patch$);
  if revised = definition then raise exception 'group_meet_advance_meet start anchor missing'; end if;
  definition := revised;
  revised := replace(definition,
    $anchor$    update app_public.group_meets set results_at = p_now where id = p_meet.id;$anchor$,
    $patch$    update app_public.group_meets set results_at = p_now where id = p_meet.id;
    perform app_public.notification_meet_publish(p_meet, 'meet_end', p_now);$patch$);
  if revised = definition then raise exception 'group_meet_advance_meet end anchor missing'; end if;
  execute revised;
end $migration$;

-- 5. Projection: the workout projection keeps its body; meet intents get the
-- narrow public preview, composed from current names at handoff. Nothing but
-- names, places and the venue reaches the payload: no figures, so no kg rule
-- applies, and the route carries the recipient as `memberId` and the meet as
-- `sessionId` to keep the payload's closed shape.
alter function app_public.notification_projection(bigint) rename to notification_projection_workout;

create function app_public.notification_meet_standings(p_meet app_public.group_meets) returns text
language plpgsql stable security definer set search_path=app_public,pg_temp as $$
declare _final boolean := exists(select 1 from group_meet_snapshots s where s.meet_id=p_meet.id);
  _c record; _line text; _lines text[] := '{}'; _more integer := 0;
begin
  for _c in select c.id,c.metric,regexp_replace(coalesce(ge.name,'Exercise unavailable'),'[[:cntrl:]]+',' ','g') as exercise
      from group_meet_challenges c left join group_exercises ge on ge.id=c.group_exercise_id
      where c.meet_id=p_meet.id and c.removed_at is null order by c.created_at,c.id loop
    select left(_c.exercise,60)||' · '||case _c.metric when 'e1rm' then 'Best 1RM' when 'weight' then 'Best weight'
        when 'reps' then 'Max reps' when 'volume' then 'Volume' else 'Hold seconds' end||': '||
      string_agg(top.name,', ' order by top.place,top.name)||
      case when max(top.total)>3 then ' +'||(max(top.total)-3) else '' end into _line
    from (select r.place,left(regexp_replace(coalesce(nullif(btrim(p.username),''),'Member'),'[[:cntrl:]]+',' ','g'),40) as name,
        count(*) over () as total,row_number() over (order by r.place,coalesce(nullif(btrim(p.username),''),'Member') collate "C",r.member_user_id) as rn
      from group_meet_rankings(p_meet,clock_timestamp(),_final,_c.id) r
      left join user_profiles p on p.id=r.member_user_id where r.place<=3) top where top.rn<=3;
    if _line is null then continue; end if;
    if cardinality(_lines)<3 then _lines := _lines||_line; else _more := _more+1; end if;
  end loop;
  if cardinality(_lines)=0 then return 'No results yet'; end if;
  return left(array_to_string(_lines,E'\n')||case when _more>0 then E'\n+'||_more||' more' else '' end,400);
end $$;

create function app_public.notification_projection(p_intent_id bigint) returns jsonb
language plpgsql stable security definer set search_path=app_public,pg_temp as $$
declare n notification_intents; m group_meets; group_name text; label text; heading text;
begin
  select * into n from notification_intents where id=p_intent_id;
  if not found then return null; end if;
  if n.kind in ('start','completion') then return app_public.notification_projection_workout(p_intent_id); end if;
  if n.expires_at<=now() then return null; end if;
  select * into m from group_meets where id=n.meet_id and cancelled_at is null;
  if not found then return null; end if;
  select g.name into group_name from groups g where g.id=m.group_id and g.deleted_at is null;
  if group_name is null or nullif(btrim(group_name),'') is null then return null; end if;
  if not exists(select 1 from group_memberships gm where gm.group_id=m.group_id and gm.user_id=n.recipient_user_id and gm.ended_at is null)
    or exists(select 1 from notification_group_preferences p
      where p.user_id=n.recipient_user_id and p.group_id=m.group_id and (p.muted or not p.meets)) then return null; end if;
  label := left(regexp_replace(coalesce(m.title,'Meet'),'[[:cntrl:]]+',' ','g'),60);
  heading := case n.kind
    when 'meet_start' then label||' is on at '||left(regexp_replace(m.venue_name,'[[:cntrl:]]+',' ','g'),60)
    else label||': results so far' end;
  return jsonb_build_object('v',1,'recipientUserId',n.recipient_user_id,'expiresAt',floor(extract(epoch from n.expires_at)*1000),
    'notificationId',n.id::text,'kind',n.kind,'identity',left(group_name,100),'heading',heading,
    'detail',case when n.kind='meet_end' then app_public.notification_meet_standings(m) else '' end,
    'bestCount',0,'rankCount',0,
    'route',jsonb_build_object('groupId',m.group_id,'memberId',n.recipient_user_id,'sessionId',m.id::text));
end $$;

-- 6. Handoff: a meet intent skips the workout source and workout locks and
-- takes its own intent lock (the one notification_meet_enqueue takes).
do $migration$
declare definition text; revised text;
begin
  definition := pg_get_functiondef('app_public.notification_begin_send(bigint,uuid,bigint)'::regprocedure);
  revised := replace(definition,
    $anchor$  perform 1 from app_public.groups g where exists(select 1 from app_public.group_session_shares sh
    where sh.group_id=g.id and sh.member_user_id=n.lifter_user_id and sh.session_id=n.session_id) order by g.id for share;
  perform app_public.notification_source_lock(n.lifter_user_id,n.session_id);
  perform pg_advisory_xact_lock(hashtextextended(n.recipient_user_id::text||':'||n.lifter_user_id::text||':'||n.session_id,0));$anchor$,
    $patch$  if n.kind in ('meet_start','meet_end') then
    perform pg_advisory_xact_lock(hashtextextended(n.recipient_user_id::text||':meet:'||n.meet_id::text||':'||n.kind,0));
  else
  perform 1 from app_public.groups g where exists(select 1 from app_public.group_session_shares sh
    where sh.group_id=g.id and sh.member_user_id=n.lifter_user_id and sh.session_id=n.session_id) order by g.id for share;
  perform app_public.notification_source_lock(n.lifter_user_id,n.session_id);
  perform pg_advisory_xact_lock(hashtextextended(n.recipient_user_id::text||':'||n.lifter_user_id::text||':'||n.session_id,0));
  end if;$patch$);
  if revised = definition then raise exception 'notification_begin_send lock anchor missing'; end if;
  definition := revised;
  revised := replace(definition,
    $anchor$  elsif exists(select 1 from notification_deliveries cd join notification_intents cn on cn.id=cd.intent_id$anchor$,
    $patch$  elsif n.kind='start' and exists(select 1 from notification_deliveries cd join notification_intents cn on cn.id=cd.intent_id$patch$);
  if revised = definition then raise exception 'notification_begin_send start anchor missing'; end if;
  execute revised;
end $migration$;

-- Grants: the preference RPCs are app-callable; everything else is internal.
do $$ declare f record; begin
  for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='app_public' and p.proname in ('notification_group_meets_set','notification_meet_enqueue',
        'notification_meet_publish','notification_meet_standings','notification_projection','notification_projection_workout') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.oid::regprocedure);
    if f.proname='notification_group_meets_set' then
      execute format('grant execute on function %s to anon,authenticated',f.oid::regprocedure);
    elsif f.proname in ('notification_meet_enqueue','notification_projection','notification_projection_workout') then
      execute format('grant execute on function %s to service_role',f.oid::regprocedure);
    end if;
  end loop;
end $$;
