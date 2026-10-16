-- Workout location is disclosed only within the authorized encrypted activity preview.
create or replace function app_public.notification_projection(p_intent_id bigint) returns jsonb
language plpgsql stable security definer set search_path=app_public,pg_temp as $$
declare n notification_intents; pref notification_preferences; parts jsonb; count_groups int; bests int; ranks int;
  first_group uuid; group_name text; lifter_name text; gym_name text; activity boolean;
begin
  select * into n from notification_intents where id=p_intent_id;
  if not found or n.expires_at<=now() then return null; end if;
  if not exists(select 1 from sessions s where s.owner_user_id=n.lifter_user_id and s.id=n.session_id and s.deleted_at is null)
    then return null; end if;
  if n.kind='completion' and not exists(select 1 from sessions s where s.owner_user_id=n.lifter_user_id
      and s.id=n.session_id and s.status='completed' and s.completed_at is not null) then return null; end if;
  select * into pref from notification_preferences where user_id=n.recipient_user_id;
  activity:=coalesce(pref.activity,true);
  if n.kind='start' and (not activity or
      (n.workout_generation is not null and not notification_start_ready(n.lifter_user_id,n.session_id,n.event_at)) or
      (n.workout_generation is null and exists(select 1 from sessions s where s.owner_user_id=n.lifter_user_id
        and s.id=n.session_id and s.status<>'active'))) then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',left(g.name,100),
      'bests',case when coalesce(pref.bests,true) then (x->>'best_count')::int else 0 end,
      'ranks',case when coalesce(pref.ranks,true) then (x->>'rank_count')::int else 0 end) order by g.id),'[]'::jsonb)
    into parts from jsonb_array_elements(app_public.notification_intent_contributions(n)) x
    join groups g on g.id=(x->>'group_id')::uuid and g.deleted_at is null
    where exists(select 1 from group_memberships m where m.group_id=g.id and m.user_id=n.recipient_user_id and m.ended_at is null)
      and exists(select 1 from group_session_shares sh where sh.group_id=g.id and sh.member_user_id=n.lifter_user_id and sh.session_id=n.session_id)
      and not exists(select 1 from notification_group_preferences p where p.user_id=n.recipient_user_id and p.group_id=g.id and p.muted)
      and (activity or (coalesce(pref.bests,true) and (x->>'best_count')::int>0)
        or (coalesce(pref.ranks,true) and (x->>'rank_count')::int>0));
  count_groups:=jsonb_array_length(parts);
  if count_groups=0 then return null; end if;
  first_group:=(parts->0->>'id')::uuid; group_name:=parts->0->>'name';
  select coalesce(sum((x->>'bests')::int),0),coalesce(sum((x->>'ranks')::int),0) into bests,ranks from jsonb_array_elements(parts) x;
  if n.kind='start' then bests:=0; ranks:=0; end if;
  if not activity and bests=0 and ranks=0 then return null; end if;
  select coalesce(nullif(left(username,100),''),'Group member') into lifter_name from user_profiles where id=n.lifter_user_id;
  if activity then
    select nullif(left(btrim(regexp_replace(g.name,'[[:space:][:cntrl:]]+',' ','g')),100),'') into gym_name
      from sessions s join gyms g on g.owner_user_id=s.owner_user_id and g.id=s.gym_id and g.deleted_at is null
      where s.owner_user_id=n.lifter_user_id and s.id=n.session_id and s.deleted_at is null;
  end if;
  return jsonb_build_object('v',1,'recipientUserId',n.recipient_user_id,'expiresAt',floor(extract(epoch from n.expires_at)*1000),
    'notificationId',n.id::text,'kind',n.kind,'identity',coalesce(lifter_name,'Group member')||' · '||
      case when count_groups=1 then group_name else count_groups||' groups' end,
    'heading',case when activity then (case when n.kind='start' then 'Started a workout' else 'Finished a workout' end)||
      ' at '||coalesce(gym_name,'a secret location')
      when bests>0 and ranks>0 then 'Workout achievements' when bests>0 then 'Group exercise bests' else 'Leaderboard changes' end,
    'bestCount',bests,'rankCount',ranks,'route',jsonb_build_object('groupId',first_group,'memberId',n.lifter_user_id,'sessionId',n.session_id));
end $$;
