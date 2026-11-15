-- Live definitions (pg_get_functiondef) before the migration of the same name, kept for parity runs; never applied.
CREATE OR REPLACE FUNCTION app_public.notification_context_digest(p_member uuid, p_session text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare t jsonb; g jsonb; contexts jsonb:='[]'::jsonb;
begin
  for t in select x from jsonb_array_elements(notification_session_targets(p_member,p_session)) x loop
    g:=group_metric_eval_source_graph((t->>'group_id')::uuid,(t->>'group_exercise_id')::uuid);
    contexts:=contexts||jsonb_build_array(jsonb_build_object('target',t,'rules',(g->'rules')-array['name','default_metric','description'],
      'sets',coalesce((select jsonb_agg(x order by x->>'set_id') from jsonb_array_elements(g->'sets') x
        where x->>'member_user_id'=p_member::text and x->>'session_id'=p_session),'[]'::jsonb),
      'member',coalesce((select x from jsonb_array_elements(g->'members') x where x->>'member_user_id'=p_member::text),'{}'::jsonb)));
  end loop;
  return encode(extensions.digest(contexts::text,'sha256'),'hex');
end $function$

;

CREATE OR REPLACE FUNCTION app_public.notification_workout_ready(p_member uuid, p_session text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare w notification_workouts; target jsonb;
begin
  select * into w from notification_workouts where member_user_id=p_member and session_id=p_session;
  if not found or not w.eligible or w.confirmed_at is null or w.completion_at is null or w.completion_at+interval '24 hours'<=now()
    or w.completion_at<(select started_at from notification_workout_epoch) or w.completion_at>now()+interval '5 minutes'
    or w.manifest_digest is distinct from notification_manifest_digest(p_member,p_session)
    or w.context_digest is distinct from notification_context_digest(p_member,p_session) then return false; end if;
  if not exists(select 1 from sessions where owner_user_id=p_member and id=p_session and status='completed' and deleted_at is null) or
    exists(select 1 from group_eval_queue where kind='session' and member_user_id=p_member and session_id=p_session) then return false; end if;
  for target in select x from jsonb_array_elements(notification_session_targets(p_member,p_session)) x loop
    if exists(select 1 from group_metric_eval_queue where group_exercise_id=(target->>'group_exercise_id')::uuid) or
      not exists(select 1 from notification_workout_targets t join notification_comparison_publications p using(group_exercise_id)
        join group_exercises ge on ge.id=t.group_exercise_id
        where t.member_user_id=p_member and t.session_id=p_session and t.group_exercise_id=(target->>'group_exercise_id')::uuid
          and t.evaluated and t.baseline_known and t.rules_revision=ge.rules_revision and ge.published_rules_revision=ge.rules_revision
          and t.final_ranks=notification_ranks(t.group_id,t.group_exercise_id,t.rules_revision)
          and t.without_workout=notification_ranks(t.group_id,t.group_exercise_id,t.rules_revision,t)
          and p.source_digest=notification_comparison_digest(t.group_id,t.group_exercise_id)) then return false; end if;
  end loop;
  return true;
end $function$

;

CREATE OR REPLACE FUNCTION app_public.notification_workout_enqueue(p_member uuid, p_session text, p_generation bigint, p_contributions jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare w notification_workouts; recipient uuid; intent bigint; settled boolean:=true;
begin
  if jsonb_typeof(p_contributions) is distinct from 'array' or jsonb_array_length(p_contributions)>10000 or
      octet_length(p_contributions::text)>1000000 or exists(select 1 from jsonb_array_elements(p_contributions) x where
        x-array['group_id','best_count','rank_count']<>'{}'::jsonb or not(x?&array['group_id','best_count','rank_count']) or
        jsonb_typeof(x->'best_count') is distinct from 'number' or jsonb_typeof(x->'rank_count') is distinct from 'number' or
        coalesce(x->>'best_count','')!~'^[0-9]{1,8}$' or coalesce(x->>'rank_count','')!~'^[0-9]{1,8}$' or
        coalesce(x->>'group_id','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'VALIDATION: invalid workout results' using errcode='P0001'; end if;
  if exists(select 1 from jsonb_array_elements(p_contributions) x group by x->>'group_id' having count(*)>1) then
    raise exception 'VALIDATION: duplicate workout group' using errcode='P0001'; end if;
  perform 1 from groups g where exists(select 1 from group_session_shares sh where sh.group_id=g.id
    and sh.member_user_id=p_member and sh.session_id=p_session) order by g.id for share;
  perform notification_source_lock(p_member,p_session);
  select * into w from notification_workouts where member_user_id=p_member and session_id=p_session for update;
  if w.generation is distinct from p_generation or not notification_workout_ready(p_member,p_session) then return false; end if;
  update notification_workouts set contributions=p_contributions
    where member_user_id=p_member and session_id=p_session;
  for recipient in select distinct m.user_id from group_session_shares sh join group_memberships m on m.group_id=sh.group_id
      join groups g on g.id=sh.group_id and g.deleted_at is null
      where sh.member_user_id=p_member and sh.session_id=p_session and m.ended_at is null and m.user_id<>p_member order by m.user_id loop
    intent:=notification_enqueue(recipient,p_member,p_session,'completion',w.completion_at,w.generation,'[]'::jsonb);
    if exists(select 1 from notification_intents where id=intent and generation=w.generation) then
      update notification_intents set workout_generation=w.generation where id=intent;
    elsif exists(select 1 from notification_deliveries where intent_id=intent and state in ('ticket','receipt_ok','uncertain')) then
      -- An accepted/uncertain logical summary freezes its content; stale unsent installations cannot publish newer content under it.
      update notification_deliveries set state='cancelled',claim_id=null,lease_until=null
        where intent_id=intent and state in ('pending','leased','retry','disabled');
    else settled:=false; end if; -- An unresolved sending handoff can still explicitly reject and adopt the latest generation.
  end loop;
  if settled then update notification_workouts set enqueued_generation=p_generation
    where member_user_id=p_member and session_id=p_session; end if;
  return settled;
end $function$

;

CREATE OR REPLACE FUNCTION app_public.notification_workout_prepare(p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare jobs jsonb; admitted integer;
begin
  if p_limit not between 1 and 20 or p_limit is null then raise exception 'VALIDATION: invalid preparation limit'; end if;
  admitted:=notification_admit_moments_counted(p_limit);
  select coalesce(jsonb_agg(jsonb_build_object('member_user_id',w.member_user_id,'session_id',w.session_id,'generation',w.generation,
    'targets',coalesce((select jsonb_agg(jsonb_build_object('group_id',t.group_id,'group_exercise_id',t.group_exercise_id,
      'best_metrics',t.best_metrics,'before',t.before_ranks,'final',t.final_ranks,'without_workout',t.without_workout))
      from notification_workout_targets t where t.member_user_id=w.member_user_id and t.session_id=w.session_id
        and exists(select 1 from jsonb_array_elements(notification_session_targets(w.member_user_id,w.session_id)) x
          where x->>'group_exercise_id'=t.group_exercise_id::text)),'[]'::jsonb))), '[]'::jsonb) into jobs
  -- The confirmed/unexpired filter is implied by readiness; it keeps abandoned workouts out of the scan.
  from (select * from notification_workouts w where w.eligible and w.confirmed_at is not null and w.enqueued_generation<w.generation
      and w.completion_at>now()-interval '24 hours'
      and notification_workout_ready(w.member_user_id,w.session_id) order by updated_at,member_user_id,session_id limit p_limit) w;
  return jsonb_build_object('jobs',jobs,'admitted',admitted);
end $function$

;

CREATE OR REPLACE FUNCTION app_public.notification_begin_send(p_delivery_id bigint, p_claim_id uuid, p_generation bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare d notification_deliveries; n notification_intents; i notification_installations; c notification_config; p jsonb; source_ready boolean;
begin
  select * into d from notification_deliveries where id=p_delivery_id;
  if not found then return null; end if;
  select * into n from notification_intents where id=d.intent_id;
  -- Publication/authorization uses group -> source -> recipient -> installation -> delivery.
  perform 1 from app_public.groups g where exists(select 1 from app_public.group_session_shares sh
    where sh.group_id=g.id and sh.member_user_id=n.lifter_user_id and sh.session_id=n.session_id) order by g.id for share;
  perform app_public.notification_source_lock(n.lifter_user_id,n.session_id);
  perform pg_advisory_xact_lock(hashtextextended(n.recipient_user_id::text||':'||n.lifter_user_id::text||':'||n.session_id,0));
  select * into i from notification_installations where id=d.installation_id for update;
  select * into d from notification_deliveries where id=p_delivery_id for update;
  select * into n from notification_intents where id=d.intent_id;
  if d.state<>'leased' or d.claim_id is distinct from p_claim_id or d.generation is distinct from p_generation or
      n.generation is distinct from p_generation or d.lease_until<=clock_timestamp() then return null; end if;
  select * into c from notification_config where singleton;
  if not i.active or not i.permission or not i.opted_in or i.binding_id<>d.binding_id or i.user_id<>n.recipient_user_id or
    i.environment is distinct from c.environment or i.project_id is distinct from c.project_id or
    i.bundle_id is distinct from c.bundle_id or not exists(select 1 from auth.sessions s where s.id=i.auth_session_id
      and s.user_id=i.user_id and (s.not_after is null or s.not_after>clock_timestamp())) then
    update notification_deliveries set state='cancelled',claim_id=null,lease_until=null where id=d.id; return null;
  end if;
  if not coalesce(c.sending_enabled,false) or c.provider='disabled' then
    update notification_deliveries set state='disabled',claim_id=null,lease_until=null where id=d.id; return null;
  end if;
  if n.expires_at<=clock_timestamp() then
    update notification_deliveries set state='expired',claim_id=null,lease_until=null where id=d.id; return null;
  end if;
  if n.kind='completion' then
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
    end if;
    if exists(select 1 from notification_deliveries sd join notification_intents sn on sn.id=sd.intent_id
        where sn.recipient_user_id=n.recipient_user_id and sn.lifter_user_id=n.lifter_user_id and sn.session_id=n.session_id
        and sn.kind='start' and sd.state='sending' and sd.lease_until>clock_timestamp()) then
      update notification_deliveries set state='retry',available_at=clock_timestamp()+interval '10 seconds',claim_id=null,lease_until=null
        where id=d.id; return null;
    end if;
    update notification_deliveries sd set state='cancelled',claim_id=null,lease_until=null from notification_intents sn
      where sn.id=sd.intent_id and sn.recipient_user_id=n.recipient_user_id and sn.lifter_user_id=n.lifter_user_id
      and sn.session_id=n.session_id and sn.kind='start' and sd.state in ('pending','retry','leased','disabled');
  elsif exists(select 1 from notification_deliveries cd join notification_intents cn on cn.id=cd.intent_id
      where cn.recipient_user_id=n.recipient_user_id and cn.lifter_user_id=n.lifter_user_id and cn.session_id=n.session_id
      and cn.kind='completion' and cd.state in ('sending','ticket','receipt_ok','uncertain')) then
    update notification_deliveries set state='cancelled',claim_id=null,lease_until=null where id=d.id; return null;
  end if;
  if n.kind='completion' and n.workout_generation is not null then
    -- Exact source proof and projection belong to one snapshot, so a late raw write cannot turn defer into terminal cancellation.
    with proof as materialized(select app_public.notification_workout_ready(n.lifter_user_id,n.session_id) and exists(
      select 1 from app_public.notification_workouts w where w.member_user_id=n.lifter_user_id and w.session_id=n.session_id
        and w.generation=n.generation and w.enqueued_generation=w.generation) as ready)
    select ready,case when ready then app_public.notification_projection(n.id) else null end into source_ready,p from proof;
    if not coalesce(source_ready,false) then
      update app_public.notification_deliveries set state=case when exists(
        select 1 from app_public.notification_deliveries peer where peer.intent_id=n.id and peer.state in ('ticket','receipt_ok','uncertain'))
        then 'cancelled' else 'retry' end,available_at=clock_timestamp()+interval '10 seconds',claim_id=null,lease_until=null where id=d.id;
      return null;
    end if;
  else p:=app_public.notification_projection(n.id); end if;
  if p is null then
    update notification_deliveries set state='cancelled',claim_id=null,lease_until=null where id=d.id; return null;
  end if;
  update notification_deliveries set state='sending',provider=c.provider,attempts=attempts+1,lease_until=clock_timestamp()+interval '60 seconds' where id=d.id;
  return jsonb_build_object('delivery_id',d.id,'claim_id',d.claim_id,'generation',d.generation,'binding_id',i.binding_id,
    'encryption_key',i.encryption_key,'token',i.token,'provider',c.provider,'expires_at',n.expires_at,
    'projection',p||jsonb_build_object('bindingId',i.binding_id));
end $function$

;

CREATE OR REPLACE FUNCTION app_public.notification_confirm_completion(p_session_id text, p_entities jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
declare u uuid:=notification_app_user(); s sessions; manifest jsonb; digest text; context text; gen bigint;
begin
  select * into s from sessions where owner_user_id=u and id=p_session_id;
  if not found then raise exception 'NOT_FOUND: workout unavailable' using errcode='P0001'; end if;
  if jsonb_typeof(p_entities) is distinct from 'array' or jsonb_array_length(p_entities)>10000 or
      octet_length(p_entities::text)>2000000 then raise exception 'VALIDATION: invalid completion graph' using errcode='P0001'; end if;
  if exists(select 1 from jsonb_array_elements(p_entities) x where jsonb_typeof(x)<>'object' or
      not(x?&array['type','id','fields']) or x-array['type','id','fields']<>'{}'::jsonb or
      jsonb_typeof(x->'type') is distinct from 'string' or jsonb_typeof(x->'id') is distinct from 'string' or
      jsonb_typeof(x->'fields') is distinct from 'object') or exists(
      select 1 from jsonb_array_elements(p_entities) x group by x->>'type',x->>'id' having count(*)>1) then
    raise exception 'VALIDATION: invalid completion graph' using errcode='P0001';
  end if;
  -- Group/policy fence precedes the source fence, matching asynchronous publication.
  perform 1 from groups g where exists(select 1 from group_session_shares sh where sh.group_id=g.id
    and sh.member_user_id=u and sh.session_id=p_session_id) order by g.id for share;
  perform notification_source_lock(u,p_session_id);
  select * into s from sessions where owner_user_id=u and id=p_session_id;
  if s.deleted_at is not null or s.status<>'completed' or s.completed_at is null or s.logging_client_id is not null then
    return jsonb_build_object('confirmed',false); end if;
  select jsonb_agg(x order by x->>'type' collate "C",x->>'id' collate "C") into manifest from jsonb_array_elements(p_entities) x;
  if manifest is distinct from notification_source_manifest(u,p_session_id) then return jsonb_build_object('confirmed',false); end if;
  if not exists(select 1 from notification_workouts w where w.member_user_id=u and w.session_id=p_session_id and
      (not w.eligible or (exists(select 1 from notification_workout_moments m where m.member_user_id=u
        and m.session_id=p_session_id and m.kind='completion' and m.event_at=w.completion_at) and
        (w.can_start or w.cutover_active or not exists(select 1 from notification_workout_moments m
          where m.member_user_id=u and m.session_id=p_session_id and m.kind='start' and m.event_at=w.start_at))))) then
    perform notification_track_workout(u,p_session_id);
  end if;
  digest:=encode(extensions.digest(manifest::text,'sha256'),'hex'); context:=notification_context_digest(u,p_session_id);
  update notification_workouts set generation=generation+case when manifest_digest is not null and
      (manifest_digest<>digest or context_digest is distinct from context) then 1 else 0 end,
    manifest_digest=digest,context_digest=context,confirmed_at=now(),updated_at=now()
    where member_user_id=u and session_id=p_session_id and eligible and
      (manifest_digest is distinct from digest or context_digest is distinct from context or confirmed_at is null)
      returning generation into gen;
  if gen is null then select generation into gen from notification_workouts
    where member_user_id=u and session_id=p_session_id and eligible; end if;
  if gen is not null then perform notification_kick_once(); end if;
  return jsonb_build_object('confirmed',gen is not null,'generation',gen);
end $function$

;

