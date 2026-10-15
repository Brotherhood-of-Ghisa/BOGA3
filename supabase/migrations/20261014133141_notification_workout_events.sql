-- Source proof and competition snapshots are operational, never private Sync v2 entities.
create table app_public.notification_workout_epoch (
  singleton boolean primary key default true check(singleton),
  started_at timestamptz not null default now()
);
insert into app_public.notification_workout_epoch default values;
create table app_public.notification_workout_moments (
  member_user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  kind text not null check(kind in ('start','completion')),
  event_at timestamptz, -- null is an immutable forfeited-capture tombstone
  primary key(member_user_id,session_id,kind)
);
create table app_public.notification_workouts (
  member_user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  start_at timestamptz,
  completion_at timestamptz,
  can_start boolean not null default true,
  cutover_active boolean not null default false,
  eligible boolean not null default true,
  generation bigint not null default 1,
  manifest_digest text,
  context_digest text,
  confirmed_at timestamptz,
  enqueued_generation bigint not null default 0,
  contributions jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key(member_user_id,session_id)
);
create table app_public.notification_workout_targets (
  member_user_id uuid not null,
  session_id text not null,
  group_id uuid not null references app_public.groups(id) on delete cascade,
  group_exercise_id uuid not null references app_public.group_exercises(id) on delete cascade,
  rules_revision bigint not null,
  baseline_known boolean not null default true,
  before_ranks jsonb not null default '[]'::jsonb,
  final_ranks jsonb not null default '[]'::jsonb,
  without_workout jsonb not null default '[]'::jsonb, -- current board with this source's original contribution restored
  best_metrics jsonb not null default '[]'::jsonb,
  baseline_scores jsonb not null default '[]'::jsonb check(jsonb_typeof(baseline_scores)='array' and jsonb_array_length(baseline_scores)<=4),
  admission_scores jsonb not null default '[]'::jsonb check(jsonb_typeof(admission_scores)='array' and jsonb_array_length(admission_scores)<=4),
  source_controls jsonb not null default '{}'::jsonb,
  evaluated boolean not null default false,
  primary key(member_user_id,session_id,group_exercise_id),
  foreign key(member_user_id,session_id) references app_public.notification_workouts on delete cascade
);
create table app_public.notification_comparison_publications (
  group_exercise_id uuid primary key references app_public.group_exercises(id) on delete cascade,
  source_digest text not null,
  published_at timestamptz not null default now()
);
alter table app_public.notification_intents add column workout_generation bigint;
create index notification_workout_pending_idx on app_public.notification_workouts(updated_at,member_user_id,session_id)
  where eligible;
do $$ declare t text; begin
  foreach t in array array['notification_workout_epoch','notification_workout_moments','notification_workouts','notification_workout_targets','notification_comparison_publications'] loop
    execute format('alter table app_public.%I enable row level security',t);
    execute format('revoke all on app_public.%I from public,anon,authenticated',t);
    execute format('grant all on app_public.%I to service_role',t);
  end loop;
end $$;

-- Existing completed history remains a minimal no-replay tombstone. Active workouts may finish freshly.
insert into app_public.notification_workouts(member_user_id,session_id,start_at,can_start,cutover_active,eligible)
  select owner_user_id,id,null::timestamptz,
    false,status='active',status='active' and deleted_at is null from app_public.sessions;

create function app_public.notification_source_lock(p_member uuid,p_session text) returns void
language sql volatile set search_path=app_public,pg_temp as $$
  select pg_advisory_xact_lock(hashtextextended('notification-source:'||p_member::text||':'||p_session,0));
$$;
create function app_public.notification_source_manifest(p_member uuid,p_session text) returns jsonb
language sql stable security definer set search_path=app_public,pg_temp as $$
  with s as (select * from sessions where owner_user_id=p_member and id=p_session),
  se as (select * from session_exercises where owner_user_id=p_member and session_id=p_session),
  sources as (
    select 'sessions'::text as type,id,to_jsonb(s)-array['id','owner_user_id','client_updated_at_ms','server_received_at'] as fields from s
    union all select 'session_exercises',id,to_jsonb(se)-array['id','owner_user_id','client_updated_at_ms','server_received_at'] from se
    union all select 'exercise_sets',es.id,to_jsonb(es)-array['id','owner_user_id','client_updated_at_ms','server_received_at']
      from exercise_sets es where es.owner_user_id=p_member and es.session_exercise_id in(select id from se)
    union all select 'exercise_definitions',ed.id,to_jsonb(ed)-array['id','owner_user_id','client_updated_at_ms','server_received_at']
      from exercise_definitions ed where ed.owner_user_id=p_member and ed.id in(select exercise_definition_id from se)
    union all select 'exercise_group_links',l.id,to_jsonb(l)-array['id','owner_user_id','client_updated_at_ms','server_received_at']
      from exercise_group_links l where l.owner_user_id=p_member and l.exercise_definition_id in(select exercise_definition_id from se)
  ) select coalesce(jsonb_agg(jsonb_build_object('type',type,'id',id,'fields',fields)
      order by type collate "C",id collate "C"),'[]'::jsonb) from sources;
$$;
create function app_public.notification_manifest_digest(p_member uuid,p_session text) returns text
language sql stable security definer set search_path=app_public,pg_temp as $$
  select encode(extensions.digest(notification_source_manifest(p_member,p_session)::text,'sha256'),'hex');
$$;
create function app_public.notification_session_targets(p_member uuid,p_session text) returns jsonb
language sql stable security definer set search_path=app_public,pg_temp as $$
  select coalesce(jsonb_agg(t order by t->>'group_id',t->>'group_exercise_id'),'[]'::jsonb)
  from jsonb_array_elements(app_public.group_eval_session_targets(p_member,p_session,
    coalesce((select array_agg(distinct exercise_definition_id) from session_exercises
      where owner_user_id=p_member and session_id=p_session),array[]::text[]))) t
  where exists(select 1 from session_exercises se join exercise_group_links l
    on l.owner_user_id=se.owner_user_id and l.exercise_definition_id=se.exercise_definition_id
    where se.owner_user_id=p_member and se.session_id=p_session and l.deleted_at is null
      and group_eval_try_uuid(l.group_id)=(t->>'group_id')::uuid
      and group_eval_try_uuid(l.group_exercise_id)=(t->>'group_exercise_id')::uuid)
    or exists(select 1 from notification_workout_targets captured where captured.member_user_id=p_member
      and captured.session_id=p_session and captured.group_exercise_id=(t->>'group_exercise_id')::uuid);
$$;
create function app_public.notification_context_digest(p_member uuid,p_session text) returns text
language plpgsql stable security definer set search_path=app_public,pg_temp as $$
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
end $$;
create function app_public.notification_comparison_digest(p_graph jsonb) returns text
language sql immutable set search_path=app_public,pg_temp as $$
  select encode(extensions.digest(((p_graph-array['source_token','ordinary_baselines','name'])||
    jsonb_build_object('rules',(p_graph->'rules')-array['name','default_metric','description']))::text,'sha256'),'hex');
$$;
create function app_public.notification_comparison_digest(p_group uuid,p_exercise uuid) returns text
language sql stable security definer set search_path=app_public,pg_temp as $$
  select notification_comparison_digest(group_metric_eval_source_graph(p_group,p_exercise));
$$;

create function app_public.notification_track_workout(p_member uuid,p_session text) returns void
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
    values(p_member,p_session,start_moment,completion_moment,not completion_known and start_moment is not null,
      case when completion_known then coalesce(completion_moment>=(select started_at from notification_workout_epoch),false)
        else s.status='active' end)
    on conflict(member_user_id,session_id) do update set completion_at=coalesce(notification_workouts.completion_at,excluded.completion_at),
      eligible=notification_workouts.eligible and (not completion_known or completion_moment is not null)
        and (s.status<>'completed' or completion_moment is not null)
      where notification_workouts.eligible;
end $$;

create index notification_failed_moment_idx on public.app_logs(user_id,(context->>'row_id'),(context->>'moment_kind'))
  where event='notification.intake_failed' and context->>'table'='sessions';
create function app_public.notification_append_moment(p_member uuid,p_session text,p_kind text,p_event_ms bigint) returns void
language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  if exists(select 1 from notification_workout_moments where member_user_id=p_member and session_id=p_session and kind=p_kind) then return; end if;
  -- Diagnostics are denial-only: a known failed admission can never be replaced by a newer authored timestamp.
  insert into notification_workout_moments(member_user_id,session_id,kind,event_at)
    values(p_member,p_session,p_kind,case when exists(select 1 from public.app_logs where user_id=p_member
      and event='notification.intake_failed' and context->>'table'='sessions' and context->>'row_id'=p_session
      and context->>'moment_kind'=p_kind) then null else to_timestamp(p_event_ms/1000.0) end) on conflict do nothing;
end $$;

create function app_public.notification_on_workout_row() returns trigger
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare code text; moment_kind text;
begin
  if tg_op='UPDATE' and to_jsonb(new)-array['client_updated_at_ms','server_received_at']=
      to_jsonb(old)-array['client_updated_at_ms','server_received_at'] then return null; end if;
  begin
    -- Only session writers append moments; child batches retain no source/workout/allocator locks.
    if tg_table_name='sessions' then
      -- Capture the value about to be erased before a reopen or completed_at edit.
      if tg_op='UPDATE' and old.completed_at is not null and abs(old.completed_at::numeric)<=8640000000000000 then
        moment_kind:='completion'; perform notification_append_moment(new.owner_user_id,new.id,moment_kind,old.completed_at);
      end if;
      if new.status='active' and new.deleted_at is null and abs(new.started_at::numeric)<=8640000000000000
        and not exists(select 1 from notification_workout_moments where member_user_id=new.owner_user_id and session_id=new.id and kind='completion')
        and not exists(select 1 from notification_workouts where member_user_id=new.owner_user_id and session_id=new.id and completion_at is not null) then
        moment_kind:='start'; perform notification_append_moment(new.owner_user_id,new.id,moment_kind,
          case when tg_op='UPDATE' then old.started_at else new.started_at end);
      elsif new.status='completed' and new.deleted_at is null and abs(new.completed_at::numeric)<=8640000000000000 then
        moment_kind:='completion'; perform notification_append_moment(new.owner_user_id,new.id,moment_kind,new.completed_at);
      end if;
    end if;
    perform notification_kick_once();
  exception when others then
    get stacked diagnostics code=returned_sqlstate;
    perform group_eval_log_failure('notification.intake_failed',new.owner_user_id,
      jsonb_build_object('table',tg_table_name,'row_id',new.id,'moment_kind',moment_kind,'sqlstate',code));
  end;
  return null;
end $$;
create trigger sessions_group_v_notification_intake after insert or update on app_public.sessions
  for each row execute function app_public.notification_on_workout_row();
create trigger session_exercises_notification_intake after insert or update on app_public.session_exercises
  for each row execute function app_public.notification_on_workout_row();
create trigger exercise_sets_notification_intake after insert or update on app_public.exercise_sets
  for each row execute function app_public.notification_on_workout_row();

create function app_public.notification_confirm_completion(p_session_id text,p_entities jsonb) returns jsonb
language plpgsql security definer set search_path=app_public,pg_temp as $$
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
  if s.deleted_at is not null or s.status<>'completed' or s.completed_at is null then
    return jsonb_build_object('confirmed',false); end if;
  select jsonb_agg(x order by x->>'type' collate "C",x->>'id' collate "C") into manifest from jsonb_array_elements(p_entities) x;
  if manifest is distinct from notification_source_manifest(u,p_session_id) then return jsonb_build_object('confirmed',false); end if;
  perform notification_track_workout(u,p_session_id);
  digest:=encode(extensions.digest(manifest::text,'sha256'),'hex'); context:=notification_context_digest(u,p_session_id);
  update notification_workouts set generation=generation+case when manifest_digest is not null and
      (manifest_digest<>digest or context_digest is distinct from context) then 1 else 0 end,
    manifest_digest=digest,context_digest=context,confirmed_at=now(),updated_at=now()
    where member_user_id=u and session_id=p_session_id and eligible returning generation into gen;
  if gen is not null then perform notification_kick_once(); end if;
  return jsonb_build_object('confirmed',gen is not null,'generation',gen);
end $$;


create function app_public.notification_source_controls(p_target app_public.notification_workout_targets,p_graph jsonb) returns jsonb
language sql stable security definer set search_path=app_public,pg_temp as $$
  with previous as (select case when coalesce((p_target).baseline_known,true) then coalesce((p_target).source_controls,'{}'::jsonb)
      else '{}'::jsonb end as controls),
  state as (select s.* from group_metric_board_state s where s.group_exercise_id=(p_target).group_exercise_id
    and s.rules_revision=(p_target).rules_revision and s.member_user_id=(p_target).member_user_id),
  member as (select m,gm.joined_at from jsonb_array_elements(p_graph->'members') m
    join group_memberships gm on gm.id=(m->>'membership_id')::uuid where m->>'member_user_id'=(p_target).member_user_id::text),
  sources as (
    select x,old,link_time,member.m,member.joined_at,state.membership_id,state.linked_definition_ids,state.certification_ids,
      previous.controls->(x->>'set_id') as prior
    from jsonb_array_elements(p_graph->'sets') x cross join previous cross join member left join state on true
    left join lateral(select s as old from group_metric_set_scores s where s.group_exercise_id=(p_target).group_exercise_id
      and s.rules_revision=(p_target).rules_revision and s.member_user_id=(p_target).member_user_id
      and s.session_id=(p_target).session_id and s.set_id=x->>'set_id' order by s.metric limit 1) published on true
    left join lateral(select max((l->>'updated_at_ms')::bigint) as link_time from jsonb_array_elements(member.m->'links') l
      where l->>'exercise_definition_id'=x->>'exercise_definition_id') binding on true
    where x->>'member_user_id'=(p_target).member_user_id::text and x->>'session_id'=(p_target).session_id
  ), entries as (
    select x->>'set_id' as set_id,coalesce(prior,jsonb_build_object(
      'context',case when (old).set_id is null then encode(extensions.digest(jsonb_build_array(x->'source_load_input_mode',
          x->'source_mode_generation',x->'reading_pin',x->'achieved_at_ms')::text,'sha256'),'hex')
        when (old).fingerprint=group_metric_graph_fingerprint(x||(old).performance,p_graph->'rules',(old).metric,
          (old).performance->>'source_load_input_mode') then encode(extensions.digest(jsonb_build_array(
            (old).performance->'source_load_input_mode',to_jsonb((old).source_mode_generation),x->'reading_pin',
            to_jsonb((old).achieved_at_ms))::text,'sha256'),'hex') end,
      'performed_pin',case when (old).set_id is null then x->>'observed_set_pin' else coalesce((
          select c.observed_set_pin from group_metric_certifications c where c.id=any(coalesce(certification_ids,'{}'::uuid[]))
            and c.set_id=x->>'set_id' order by c.certified_at,c.id limit 1),
          group_metric_observed_set_pin((p_target).member_user_id,(old).performance,x->>'set_type')) end,
      'certified_metrics',coalesce((select jsonb_agg(s.metric) from group_metric_set_scores s
        join group_exercises ge on ge.id=s.group_exercise_id join groups g on g.id=ge.group_id
        cross join lateral group_metric_certification_matching(s.group_exercise_id,s.member_user_id,s.set_id,s.metric,s.fingerprint) c
        where s.group_exercise_id=(p_target).group_exercise_id and s.rules_revision=(p_target).rules_revision
          and s.member_user_id=(p_target).member_user_id and s.session_id=(p_target).session_id
          and s.set_id=x->>'set_id' and s.counting and c.id is not null
          and s.unit=group_competition_unit(s.metric,g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0)
          and (g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0 or
            not group_competition_redacts_exercise(array[ge.group_id],s.member_user_id,s.exercise_definition_id))),'[]'::jsonb),
      'counted_metrics',coalesce((select jsonb_agg(s.metric) from group_metric_set_scores s
        where s.group_exercise_id=(p_target).group_exercise_id and s.rules_revision=(p_target).rules_revision
          and s.member_user_id=(p_target).member_user_id and s.set_id=x->>'set_id' and s.counting),'[]'::jsonb),
      'counted',coalesce((old).counting,false))) ||
      jsonb_build_object(
        'link_admission_pin',case when not coalesce((old).counting,false) and (x->>'counting')::boolean and not
          ((x->>'exercise_definition_id')=any(coalesce(linked_definition_ids,'{}'::text[]))) and
          (x->>'set_created_at_ms')::bigint<coalesce(link_time,9223372036854775807)
          then to_jsonb(x->>'observed_set_pin') else prior->'link_admission_pin' end,
        'member_admission_pin',case when not coalesce((old).counting,false) and
          membership_id is distinct from (m->>'membership_id')::uuid and
          (x->>'set_created_at_ms')::bigint<floor(extract(epoch from joined_at)*1000)
          then to_jsonb(x->>'observed_set_pin') else prior->'member_admission_pin' end) as control
    from sources
  ) select previous.controls||coalesce(jsonb_object_agg(set_id,control) filter(where set_id is not null),'{}'::jsonb)
    from previous left join entries on true group by previous.controls;
$$;

create function app_public.notification_baseline_scores(p_member uuid,p_session text,p_exercise uuid,p_revision bigint,p_graph jsonb) returns jsonb
language sql stable security definer set search_path=app_public,pg_temp as $$
  with dimensions as (select m as metric,c as certified from unnest(array['volume','e1rm']) m cross join unnest(array[false,true]) c),
  winners as (
    select d.metric,d.certified,w.value,w.unit,w.achieved_at_ms,w.exercise_order_index,w.set_order_index,w.set_created_at_ms,
      w.set_id,w.exercise_definition_id,w.fingerprint,w.certification_id,w.source_mode_generation,
      w.performance->>'source_load_input_mode' as source_load_input_mode,w.source->>'reading_pin' as reading_pin,
      coalesce((select c.observed_set_pin from group_metric_certifications c where c.id=w.certification_id),
        group_metric_observed_set_pin(p_member,w.performance,w.source->>'set_type')) as observed_set_pin,
      w.fingerprint=group_metric_graph_fingerprint(w.source||w.performance,p_graph->'rules',w.metric,
        w.performance->>'source_load_input_mode') and
        w.source_mode_generation=(w.source->>'source_mode_generation')::bigint as projection_known
    from dimensions d cross join lateral (
      select s.*,c.id as certification_id,r.x as source from group_metric_set_scores s
      join lateral(select x from jsonb_array_elements(p_graph->'sets') x where x->>'member_user_id'=p_member::text and x->>'set_id'=s.set_id) r on true
      join group_exercises ge on ge.id=s.group_exercise_id join groups g on g.id=ge.group_id
      left join lateral group_metric_certification_matching(ge.id,s.member_user_id,s.set_id,s.metric,s.fingerprint) c on true
      where s.member_user_id=p_member and s.session_id=p_session and s.group_exercise_id=p_exercise
        and s.rules_revision=p_revision and s.metric=d.metric and s.counting and (not d.certified or c.id is not null)
        and s.unit=group_competition_unit(d.metric,g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0)
        and (g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0 or
          not group_competition_redacts_exercise(array[ge.group_id],p_member,s.exercise_definition_id))
      order by s.value desc,s.achieved_at_ms,s.exercise_order_index,s.set_order_index,s.set_created_at_ms,s.set_id collate "C" limit 1
    ) w
  ) select coalesce(jsonb_agg(to_jsonb(winners) order by metric,certified),'[]'::jsonb) from winners;
$$;

create function app_public.notification_ranks(p_group uuid,p_exercise uuid,p_revision bigint,
  p_target app_public.notification_workout_targets default null) returns jsonb
language sql stable security definer set search_path=app_public,pg_temp as $$
  with dimensions as (select m as metric,c as certified from unnest(array['volume','e1rm']) m cross join unnest(array[false,true]) c),
  source as materialized(select group_metric_eval_source_graph(p_group,p_exercise) as graph),
  saved_sources as (select b,false as admitted from jsonb_array_elements((p_target).baseline_scores) b
    union all select b,true from jsonb_array_elements((p_target).admission_scores) b),
  saved as (select b,admitted,(b->>'certified')::boolean as bound_certified from saved_sources
    union all select b||jsonb_build_object('certified',true),admitted,false from saved_sources where not (b->>'certified')::boolean
    union all select b||jsonb_build_object('certified',false),admitted,true from saved_sources where (b->>'certified')::boolean),
  qualified_saved as (
    select saved.* from saved join group_exercises ge on ge.id=p_exercise join groups g on g.id=ge.group_id
    where (p_target).rules_revision=p_revision
      and exists(select 1 from exercise_group_links l where l.owner_user_id=(p_target).member_user_id
        and l.exercise_definition_id=b->>'exercise_definition_id' and l.deleted_at is null
        and group_eval_try_uuid(l.group_id)=p_group and group_eval_try_uuid(l.group_exercise_id)=p_exercise)
      and b->>'unit'=group_competition_unit(b->>'metric',g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0)
      and (not (b->>'certified')::boolean or exists(select 1 from group_metric_certifications c
        where c.group_exercise_id=p_exercise and c.member_user_id=(p_target).member_user_id
          and c.set_id=b->>'set_id' and c.metric=b->>'metric' and c.observed_set_pin=b->>'observed_set_pin'
          and group_metric_certification_mode_matches(c)
          and (c.pinned_fingerprint=b->>'fingerprint' or c.current_fingerprint=b->>'fingerprint')
          and (c.ended_at is null or (c.end_reason='voided' and exists(
            select 1 from source,jsonb_array_elements(source.graph->'sets') x where x->>'member_user_id'=(p_target).member_user_id::text
              and x->>'set_id'=b->>'set_id' and (x->>'observed_set_pin' is distinct from b->>'observed_set_pin' or not (x->>'live')::boolean))))))
      and (g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0 or
        not group_competition_redacts_exercise(array[p_group],(p_target).member_user_id,b->>'exercise_definition_id'))
  ), compatible_saved as (
    select q.* from qualified_saved q cross join source where coalesce((b->>'projection_known')::boolean,false) and exists(
      select 1 from jsonb_array_elements(source.graph->'sets') x where x->>'member_user_id'=(p_target).member_user_id::text
        and x->>'set_id'=b->>'set_id' and x->>'source_load_input_mode' is not distinct from b->>'source_load_input_mode'
        and x->>'reading_pin' is not distinct from b->>'reading_pin'
        and (x->>'source_mode_generation')::bigint=(b->>'source_mode_generation')::bigint
        and (x->>'achieved_at_ms')::bigint=(b->>'achieved_at_ms')::bigint)
  ), incompatible_baseline as (select b->>'metric' as metric,(b->>'certified')::boolean as certified
    from qualified_saved q cross join source where not exists(select 1 from compatible_saved k where k.b=q.b)
      and not exists(
      select 1 from jsonb_array_elements(source.graph->'sets') x where x->>'member_user_id'=(p_target).member_user_id::text
        and x->>'set_id'=b->>'set_id' and x->>'observed_set_pin'=coalesce(
          (p_target).source_controls->(b->>'set_id')->>'admission_pin',(p_target).source_controls->(b->>'set_id')->>'performed_pin'))),
  incompatible_final as (
    select e.metric,e.certified from group_metric_board_entries e cross join source
    left join lateral(select x from jsonb_array_elements(source.graph->'sets') x
      where x->>'member_user_id'=(p_target).member_user_id::text and x->>'set_id'=e.set_id) live on true
    cross join lateral(select (p_target).source_controls->e.set_id as origin) frozen
    where e.group_exercise_id=p_exercise and e.rules_revision=p_revision and e.member_user_id=(p_target).member_user_id
      and e.session_id=(p_target).session_id and (
        (coalesce(origin->>'admission_context',origin->>'context') is distinct from encode(extensions.digest(jsonb_build_array(x->'source_load_input_mode',
          x->'source_mode_generation',x->'reading_pin',x->'achieved_at_ms')::text,'sha256'),'hex') and
          not ((coalesce(origin->'counted_metrics','[]'::jsonb) ? e.metric or coalesce(origin->'admission_metrics','[]'::jsonb) ? e.metric) and
            x->>'observed_set_pin'=coalesce(origin->>'admission_pin',origin->>'performed_pin'))) or
        ((origin->>'link_admission_pin' is not null or origin->>'member_admission_pin' is not null) and origin->>'admission_pin' is null))
  ), incompatible_changed_controls as (
    -- A lower original source can become relevant under changed metadata too; no old numeric score is reinterpreted.
    select s.metric,d.certified from group_metric_set_scores s cross join source
    join dimensions d on d.metric=s.metric
    join lateral(select x from jsonb_array_elements(source.graph->'sets') x where x->>'member_user_id'=s.member_user_id::text
      and x->>'set_id'=s.set_id) live on true
    cross join lateral(select (p_target).source_controls->s.set_id as origin) frozen
    left join lateral group_metric_certification_matching(p_exercise,s.member_user_id,s.set_id,s.metric,s.fingerprint) c on true
    where s.group_exercise_id=p_exercise and s.rules_revision=p_revision and s.member_user_id=(p_target).member_user_id
      and s.session_id=(p_target).session_id and s.counting and (not d.certified or c.id is not null)
      and (coalesce(origin->'counted_metrics','[]'::jsonb) ? d.metric or coalesce(origin->'admission_metrics','[]'::jsonb) ? d.metric)
      and x->>'observed_set_pin' is distinct from coalesce(origin->>'admission_pin',origin->>'performed_pin')
      and coalesce(origin->>'admission_context',origin->>'context') is distinct from encode(extensions.digest(jsonb_build_array(
        x->'source_load_input_mode',x->'source_mode_generation',x->'reading_pin',x->'achieved_at_ms')::text,'sha256'),'hex')
  ), incompatible_reselection as (
    -- If a changed lower original becomes relevant after its frozen winner loses control eligibility, its old scalar is unproved.
    select d.metric,d.certified from dimensions d cross join source
    cross join lateral jsonb_each((p_target).source_controls) origin
    join lateral(select x from jsonb_array_elements(source.graph->'sets') x where x->>'member_user_id'=(p_target).member_user_id::text
      and x->>'set_id'=origin.key) live on true
    where (x->>'counting')::boolean and (x->>'observed_set_pin' is distinct from
      coalesce(origin.value->>'admission_pin',origin.value->>'performed_pin') or not (x->>'live')::boolean or
      (coalesce(origin.value->'counted_metrics','[]'::jsonb) ? d.metric and not exists(
        select 1 from group_metric_set_scores s where s.group_exercise_id=p_exercise and s.rules_revision=p_revision
          and s.member_user_id=(p_target).member_user_id and s.set_id=origin.key and s.metric=d.metric and s.counting)))
      and (coalesce(origin.value->'counted_metrics','[]'::jsonb) ? d.metric or coalesce(origin.value->'admission_metrics','[]'::jsonb) ? d.metric)
      and (not d.certified or exists(select 1 from group_metric_certifications c
        where c.group_exercise_id=p_exercise and c.member_user_id=(p_target).member_user_id and c.set_id=origin.key and c.metric=d.metric
          and c.observed_set_pin=coalesce(origin.value->>'admission_pin',origin.value->>'performed_pin')
          and group_metric_certification_mode_matches(c)
          and (c.ended_at is null or (c.end_reason='voided' and
            (not (x->>'live')::boolean or x->>'observed_set_pin' is distinct from c.observed_set_pin)))))
      and not exists(select 1 from compatible_saved where b->>'metric'=d.metric and (b->>'certified')::boolean=d.certified and b->>'set_id'=origin.key)
      and not exists(select 1 from compatible_saved where b->>'metric'=d.metric and (b->>'certified')::boolean=d.certified
        and admitted=(coalesce(origin.value->'admission_metrics','[]'::jsonb) ? d.metric)
        and (not bound_certified or (case when admitted then coalesce(origin.value->'admission_certified_metrics','[]'::jsonb)
          else coalesce(origin.value->'certified_metrics','[]'::jsonb) end) ? d.metric))
  ), incompatible as (select * from incompatible_baseline union select * from incompatible_final
    union select * from incompatible_changed_controls union select * from incompatible_reselection),
  actual as (
    select d.metric,d.certified,r.member_user_id,(r.row_json->>'value')::numeric as value,
      (r.row_json->'performance'->>'achieved_at_ms')::bigint as achieved_at_ms
    from dimensions d cross join lateral group_competition_board_rows(p_group,p_exercise,p_revision,d.metric,d.certified) r
    where (p_target).member_user_id is null or r.member_user_id<>(p_target).member_user_id or
      exists(select 1 from incompatible i where i.metric=d.metric and i.certified=d.certified)
  ), eligible as (
    select s.metric,d.certified,s.value,s.achieved_at_ms,s.exercise_order_index,s.set_order_index,s.set_created_at_ms,s.set_id
    from dimensions d join group_metric_set_scores s on s.metric=d.metric
    join group_exercises ge on ge.id=s.group_exercise_id join groups g on g.id=ge.group_id
    left join lateral group_metric_certification_matching(ge.id,s.member_user_id,s.set_id,s.metric,s.fingerprint) c on true
    where (p_target).member_user_id is not null and s.member_user_id=(p_target).member_user_id and s.session_id<>(p_target).session_id
      and s.group_exercise_id=p_exercise and s.rules_revision=p_revision and s.counting and (not d.certified or c.id is not null)
      and s.unit=group_competition_unit(d.metric,g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0)
      and (g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0 or
        not group_competition_redacts_exercise(array[p_group],(p_target).member_user_id,s.exercise_definition_id))
    union all
    -- Unchanged original/admitted performances use current control and witness eligibility, including metadata-rescored lower sources.
    select s.metric,d.certified,s.value,s.achieved_at_ms,s.exercise_order_index,s.set_order_index,s.set_created_at_ms,s.set_id
    from dimensions d join group_metric_set_scores s on s.metric=d.metric cross join source
    join group_exercises ge on ge.id=s.group_exercise_id join groups g on g.id=ge.group_id
    left join lateral group_metric_certification_matching(ge.id,s.member_user_id,s.set_id,s.metric,s.fingerprint) c on true
    join lateral(select x from jsonb_array_elements(source.graph->'sets') x where x->>'member_user_id'=s.member_user_id::text
      and x->>'set_id'=s.set_id) live on true
    cross join lateral(select (p_target).source_controls->s.set_id as origin) frozen
    where s.member_user_id=(p_target).member_user_id and s.session_id=(p_target).session_id and s.group_exercise_id=p_exercise
      and s.rules_revision=p_revision and s.counting and (not d.certified or c.id is not null)
      and s.unit=group_competition_unit(d.metric,g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0)
      and (g.bodyweight_calculations_enabled and ge.bodyweight_contribution>0 or
        not group_competition_redacts_exercise(array[p_group],(p_target).member_user_id,s.exercise_definition_id))
      and (coalesce(origin->'counted_metrics','[]'::jsonb) ? s.metric or coalesce(origin->'admission_metrics','[]'::jsonb) ? s.metric)
      and coalesce(origin->>'admission_pin',origin->>'performed_pin')=x->>'observed_set_pin'
    union all
    -- Restoring the original published contribution avoids attributing someone else's movement to an unchanged old workout.
    select b->>'metric',(b->>'certified')::boolean,(b->>'value')::numeric,(b->>'achieved_at_ms')::bigint,
      (b->>'exercise_order_index')::int,(b->>'set_order_index')::int,(b->>'set_created_at_ms')::bigint,b->>'set_id'
    from compatible_saved
  ), replacement as (
    select d.metric,d.certified,(p_target).member_user_id as member_user_id,w.value,w.achieved_at_ms
    from dimensions d cross join lateral (
      select * from eligible s where s.metric=d.metric and s.certified=d.certified and group_active_role(p_group,(p_target).member_user_id) is not null
      order by s.value desc,s.achieved_at_ms,s.exercise_order_index,s.set_order_index,s.set_created_at_ms,s.set_id collate "C" limit 1
    ) w where not exists(select 1 from incompatible i where i.metric=d.metric and i.certified=d.certified)
  ), ordered as (
    select metric,certified,member_user_id,row_number() over(partition by metric,certified order by value desc,achieved_at_ms,member_user_id)::int as rank
    from (select * from actual union all select * from replacement) rows
  ) select coalesce(jsonb_agg(to_jsonb(ordered) order by metric,certified,rank),'[]'::jsonb) from ordered;
$$;

create function app_public.notification_best_evidence(p_member uuid,p_session text,p_exercise uuid,p_revision bigint,
  p_initial boolean) returns jsonb
language sql stable security definer set search_path=app_public,pg_temp as $$
  with evidence as (
    select distinct b->>'metric' as metric,e.set_id,e.id::text||':'||coalesce(b->>'fingerprint','') as identity from group_events e
    cross join lateral jsonb_array_elements(e.payload->'boards') b
    where e.kind='record' and e.member_user_id=p_member and e.session_id=p_session and e.group_exercise_id=p_exercise
      and not exists(select 1 from group_events v where v.kind='record_voided' and v.related_event_id=e.id)
      and exists(select 1 from group_metric_set_scores s where s.group_exercise_id=p_exercise and s.rules_revision=p_revision
        and s.member_user_id=p_member and s.session_id=p_session and s.set_id=e.set_id and s.metric=b->>'metric'
        and s.fingerprint=b->>'fingerprint' and s.counting)
    union
    -- A first comparison publication is silent, but its first qualifying own best is real.
    select s.metric,s.set_id,'initial:'||s.set_id||':'||s.fingerprint as identity from group_metric_board_entries s
    where p_initial and not s.certified and s.member_user_id=p_member and s.session_id=p_session
      and s.group_exercise_id=p_exercise and s.rules_revision=p_revision
      and not exists(select 1 from group_metric_set_scores old where old.group_exercise_id=p_exercise and old.rules_revision=p_revision
        and old.member_user_id=p_member and old.session_id<>p_session and old.metric=s.metric and old.counting and old.value>=s.value)
      and exists(select 1 from exercise_group_links l join exercise_sets es on es.owner_user_id=l.owner_user_id and es.id=s.set_id
        where l.owner_user_id=p_member and l.exercise_definition_id=s.performance->>'exercise_definition_id' and l.deleted_at is null
          and group_eval_try_uuid(l.group_exercise_id)=p_exercise and es.created_at>=l.updated_at)
  ) select coalesce(jsonb_agg(jsonb_build_object('metric',metric,'set_id',set_id,'identity',identity) order by metric,identity),'[]'::jsonb)
    from evidence where metric in ('volume','e1rm');
$$;
create function app_public.notification_performance_inputs(p_member uuid,p_session text,p_graph jsonb) returns jsonb
language sql immutable set search_path=app_public,pg_temp as $$
  select coalesce(jsonb_object_agg(x->>'set_id',encode(extensions.digest(
    jsonb_build_array(x->'observed_set_pin',x->'live')::text,'sha256'),'hex')),'{}'::jsonb)
  from jsonb_array_elements(p_graph->'sets') x where x->>'member_user_id'=p_member::text and x->>'session_id'=p_session;
$$;
alter table app_public.notification_workout_targets add column initial_publication boolean not null default false;
alter table app_public.notification_workout_targets add column performance_inputs jsonb not null default '{}'::jsonb;
alter table app_public.notification_workout_targets add column best_evidence jsonb not null default '[]'::jsonb;

-- All live disclosure/evidence readers share this one calling-query snapshot.
create function app_public.notification_target_capture(p_target app_public.notification_workout_targets,p_graph jsonb,p_after boolean default false) returns jsonb
language plpgsql stable security definer set search_path=app_public,pg_temp as $$
declare target notification_workout_targets:=p_target; baseline jsonb; admitted_graph jsonb; admission jsonb;
begin
  if notification_comparison_digest(p_graph) is distinct from
    notification_comparison_digest(p_target.group_id,p_target.group_exercise_id) then return null; end if;
  baseline:=notification_baseline_scores(target.member_user_id,target.session_id,target.group_exercise_id,target.rules_revision,p_graph);
  target.source_controls:=notification_source_controls(target,p_graph);
  if not coalesce(target.baseline_known,false) then target.baseline_scores:=baseline; target.admission_scores:='[]'::jsonb; end if;
  if p_after then
    -- Freeze only newly control-admitted performances after their first coherent scorer publication.
    select jsonb_set(p_graph,'{sets}',coalesce(jsonb_agg(x),'[]'::jsonb)) into admitted_graph
      from jsonb_array_elements(p_graph->'sets') x where x->>'member_user_id'=target.member_user_id::text
        and x->>'session_id'=target.session_id and target.source_controls->(x->>'set_id')->>'admission_pin' is null
        and (target.source_controls->(x->>'set_id')->>'link_admission_pin' is not null or
          target.source_controls->(x->>'set_id')->>'member_admission_pin' is not null);
    admission:=notification_baseline_scores(target.member_user_id,target.session_id,target.group_exercise_id,target.rules_revision,admitted_graph);
    select coalesce(jsonb_agg(b order by b->>'metric',b->>'certified'),'[]'::jsonb) into target.admission_scores from (
      select distinct on(b->>'metric',b->>'certified') b from jsonb_array_elements(coalesce(target.admission_scores,'[]'::jsonb)||admission) b
      order by b->>'metric',b->>'certified',(b->>'value')::numeric desc,(b->>'achieved_at_ms')::bigint,
        (b->>'exercise_order_index')::int,(b->>'set_order_index')::int,(b->>'set_created_at_ms')::bigint,b->>'set_id' collate "C"
    ) winners;
    select target.source_controls||coalesce(jsonb_object_agg(x->>'set_id',target.source_controls->(x->>'set_id')||jsonb_build_object(
      'admission_pin',x->>'observed_set_pin','admission_metrics',coalesce((select jsonb_agg(s.metric) from group_metric_set_scores s
        where s.group_exercise_id=target.group_exercise_id and s.rules_revision=target.rules_revision
          and s.member_user_id=target.member_user_id and s.set_id=x->>'set_id' and s.counting),'[]'::jsonb),
      'admission_certified_metrics',coalesce((
        select jsonb_agg(distinct s.metric) from group_metric_set_scores s
          cross join lateral group_metric_certification_matching(s.group_exercise_id,s.member_user_id,s.set_id,s.metric,s.fingerprint) c
          where s.group_exercise_id=target.group_exercise_id and s.rules_revision=target.rules_revision
            and s.member_user_id=target.member_user_id and s.session_id=target.session_id and s.set_id=x->>'set_id' and s.counting
            and c.id is not null),'[]'::jsonb),
      'admission_context',encode(extensions.digest(jsonb_build_array(
        x->'source_load_input_mode',x->'source_mode_generation',x->'reading_pin',x->'achieved_at_ms')::text,'sha256'),'hex'))),'{}'::jsonb)
      into target.source_controls from jsonb_array_elements(admitted_graph->'sets') x;
  end if;
  return jsonb_build_object('actual',notification_ranks(target.group_id,target.group_exercise_id,target.rules_revision),
    'without',notification_ranks(target.group_id,target.group_exercise_id,target.rules_revision,target),
    'evidence',notification_best_evidence(p_target.member_user_id,p_target.session_id,p_target.group_exercise_id,p_target.rules_revision,p_target.initial_publication),
    'inputs',notification_performance_inputs(p_target.member_user_id,p_target.session_id,p_graph),
    'baseline_scores',baseline,'admission_scores',coalesce(target.admission_scores,'[]'::jsonb),'source_controls',target.source_controls);
end $$;

create function app_public.notification_capture_comparison(p_group uuid,p_exercise uuid,p_revision bigint,p_after boolean,p_graph jsonb default null) returns void
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare g jsonb; source record; w notification_workouts; t notification_workout_targets; actual jsonb; without_ranks jsonb; bests jsonb; known boolean; evidence jsonb; inputs jsonb; capture jsonb; probe notification_workout_targets; target_exists boolean; common_actual jsonb;
begin
  g:=coalesce(p_graph,group_metric_eval_source_graph(p_group,p_exercise));
  if g is null then return; end if;
  common_actual:=notification_ranks(p_group,p_exercise,p_revision);
  for source in select distinct candidates.member,candidates.session collate "C" as session from (
      select (x->>'member_user_id')::uuid as member,x->>'session_id' as session from jsonb_array_elements(g->'sets') x
        join sessions raw on raw.owner_user_id=(x->>'member_user_id')::uuid and raw.id=x->>'session_id'
        left join notification_workouts nw on nw.member_user_id=raw.owner_user_id and nw.session_id=raw.id
        where nw.eligible or (nw.member_user_id is null and (raw.status='active' or
          raw.completed_at>=floor(extract(epoch from (select started_at from notification_workout_epoch))*1000)))
      union all select nw.member_user_id,nw.session_id from notification_workouts nw
        join session_exercises se on se.owner_user_id=nw.member_user_id and se.session_id=nw.session_id
        join exercise_group_links l on l.owner_user_id=se.owner_user_id and l.exercise_definition_id=se.exercise_definition_id
        join group_session_shares sh on sh.member_user_id=nw.member_user_id and sh.session_id=nw.session_id and sh.group_id=p_group
        where nw.eligible and l.deleted_at is null and group_eval_try_uuid(l.group_exercise_id)=p_exercise
          and group_active_role(p_group,nw.member_user_id) is not null
      union all select member_user_id,session_id from notification_workout_targets where group_exercise_id=p_exercise
    ) candidates left join notification_workouts present on present.member_user_id=candidates.member and present.session_id=candidates.session
    where present.member_user_id is null or (present.eligible and (present.completion_at is null or present.completion_at+interval '24 hours'>now()))
    order by candidates.member,candidates.session collate "C" loop
    perform notification_track_workout(source.member,source.session);
    select * into w from notification_workouts where member_user_id=source.member and session_id=source.session for update;
    if not w.eligible then continue; end if;
    select * into t from notification_workout_targets where member_user_id=source.member and session_id=source.session
      and group_exercise_id=p_exercise for update;
    target_exists:=found;
    probe:=t; probe.member_user_id:=source.member; probe.session_id:=source.session;
    probe.group_id:=p_group; probe.group_exercise_id:=p_exercise; probe.rules_revision:=p_revision;
    if p_after and t.rules_revision<>p_revision then probe.baseline_known:=false; end if;
    capture:=notification_target_capture(probe,g,p_after);
    if capture is null then raise exception 'notification capture source moved' using errcode='P0001'; end if;
    if capture->'actual' is distinct from common_actual then
      raise exception 'notification capture disclosure moved' using errcode='P0001'; end if;
    actual:=common_actual;
    if not p_after then
      if not target_exists then
        select (published_rules_revision=rules_revision and (not w.cutover_active or (
          not exists(select 1 from group_metric_eval_queue where group_exercise_id=p_exercise) and
          not exists(select 1 from group_eval_queue q where q.group_exercise_id=p_exercise or exists(
            select 1 from group_session_shares sh where sh.group_id=p_group and sh.member_user_id=q.member_user_id
              and sh.session_id=q.session_id))))) or (not w.cutover_active and not exists(select 1 from group_rule_revisions r
          where r.group_exercise_id=p_exercise and r.revision=p_revision and r.published_at is not null)) into known from group_exercises where id=p_exercise;
        if w.cutover_active and exists(select 1 from jsonb_array_elements(capture->'baseline_scores') b
          where not coalesce((b->>'projection_known')::boolean,false)) then known:=false; end if;
        insert into notification_workout_targets(member_user_id,session_id,group_id,group_exercise_id,rules_revision,
          baseline_known,before_ranks,initial_publication,performance_inputs,best_evidence,baseline_scores,source_controls)
          values(source.member,source.session,p_group,p_exercise,p_revision,coalesce(known,false),
            case when known then actual else '[]'::jsonb end,
            not exists(select 1 from group_rule_revisions r where r.group_exercise_id=p_exercise and r.revision=p_revision and r.published_at is not null),
            case when w.cutover_active then notification_performance_inputs(source.member,source.session,g) else '{}'::jsonb end,
            case when w.cutover_active then notification_best_evidence(source.member,source.session,p_exercise,p_revision,false) else '[]'::jsonb end,
            capture->'baseline_scores',capture->'source_controls');
      elsif t.rules_revision<>p_revision then
        update notification_workout_targets set initial_publication=not exists(select 1 from group_rule_revisions r
          where r.group_exercise_id=p_exercise and r.revision=p_revision and r.published_at is not null)
          where member_user_id=source.member and session_id=source.session and group_exercise_id=p_exercise;
      else
        update notification_workout_targets set source_controls=capture->'source_controls'
          where member_user_id=source.member and session_id=source.session and group_exercise_id=p_exercise;
      end if;
      continue;
    end if;
    if not target_exists then raise exception 'notification baseline unavailable' using errcode='P0001'; end if;
    without_ranks:=capture->'without'; evidence:=capture->'evidence'; inputs:=capture->'inputs';
    if t.evaluated or w.cutover_active then
      -- A change to another set cannot authorize a recompute-created best on this unchanged evidence set.
      select coalesce(jsonb_agg(x),'[]'::jsonb) into evidence from jsonb_array_elements(evidence) x
        where t.best_evidence@>jsonb_build_array(x) or
          t.performance_inputs->>(x->>'set_id') is distinct from inputs->>(x->>'set_id');
    end if;
    select coalesce(jsonb_agg(metric order by metric),'[]'::jsonb) into bests from
      (select distinct x->>'metric' as metric from jsonb_array_elements(evidence) x) metrics;
    if t.final_ranks is distinct from actual or t.without_workout is distinct from without_ranks or t.best_metrics is distinct from bests or not t.evaluated then
      update notification_workouts set generation=generation+1,updated_at=now()
        where member_user_id=source.member and session_id=source.session;
    end if;
    update notification_workout_targets set
      before_ranks=case when not baseline_known or rules_revision<>p_revision then actual else before_ranks end,
      baseline_scores=case when not baseline_known or rules_revision<>p_revision then capture->'baseline_scores' else baseline_scores end,
      admission_scores=capture->'admission_scores',
      source_controls=capture->'source_controls',
      baseline_known=true,rules_revision=p_revision,final_ranks=actual,without_workout=without_ranks,best_metrics=bests,evaluated=true,performance_inputs=inputs,best_evidence=evidence
      where member_user_id=source.member and session_id=source.session and group_exercise_id=p_exercise;
  end loop;
  if p_after then
    insert into notification_comparison_publications(group_exercise_id,source_digest,published_at)
      values(p_exercise,notification_comparison_digest(g),now())
      on conflict(group_exercise_id) do update set source_digest=excluded.source_digest,published_at=excluded.published_at;
    perform notification_kick_once();
  end if;
end $$;

create function app_public.notification_kick_once() returns void
language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  if current_setting('boga.notification_kicked',true)='true' then return; end if;
  perform set_config('boga.notification_kicked','true',true);
  perform notification_sweep();
end $$;

create function app_public.notification_start_workout(p_member uuid,p_session text) returns void
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare w notification_workouts; recipient uuid; intent bigint;
begin
  select * into w from notification_workouts where member_user_id=p_member and session_id=p_session;
  if not w.eligible or not w.can_start or w.completion_at is not null or w.start_at is null or w.start_at<(select started_at from notification_workout_epoch)
    or w.start_at+interval '24 hours'<=now() or w.start_at>now()+interval '5 minutes' or
    not exists(select 1 from sessions where owner_user_id=p_member and id=p_session and status='active' and deleted_at is null) then return; end if;
  for recipient in select distinct m.user_id from group_session_shares sh join group_memberships m on m.group_id=sh.group_id
      join groups g on g.id=sh.group_id and g.deleted_at is null
      where sh.member_user_id=p_member and sh.session_id=p_session and m.ended_at is null and m.user_id<>p_member order by m.user_id loop
    intent:=notification_enqueue(recipient,p_member,p_session,'start',w.start_at,w.generation,'[]'::jsonb);
    update notification_intents set workout_generation=w.generation where id=intent and generation=w.generation;
  end loop;
end $$;

create function app_public.notification_recover_workouts(p_limit integer default 20) returns void
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare source record; code text; candidates jsonb; admitted jsonb:='[]'::jsonb; repair_groups uuid[];
begin
  if p_limit not between 1 and 20 or p_limit is null then raise exception 'VALIDATION: invalid recovery limit'; end if;
  -- Fair admission first; lock the selected batch globally before any allocator/installation writes.
  select coalesce(jsonb_agg(to_jsonb(selected)),'[]'::jsonb) into candidates from (
    select s.owner_user_id as member,s.id as session from sessions s
    left join notification_workouts w on w.member_user_id=s.owner_user_id and w.session_id=s.id
    where s.deleted_at is null and (w.member_user_id is null or w.eligible) and
      (s.started_at>=floor(extract(epoch from now()-interval '24 hours')*1000) or
       s.completed_at>=floor(extract(epoch from now()-interval '24 hours')*1000))
    order by coalesce(w.updated_at,s.server_received_at),s.owner_user_id,s.id limit p_limit) selected;
  select coalesce(array_agg(distinct destinations.group_id),array[]::uuid[]) into repair_groups from (
    select sh.group_id from jsonb_to_recordset(candidates) as c(member uuid,session text)
      join group_session_shares sh on sh.member_user_id=c.member and sh.session_id=c.session
    union select m.group_id from jsonb_to_recordset(candidates) as c(member uuid,session text)
      join sessions s on s.owner_user_id=c.member and s.id=c.session
      join group_memberships m on m.user_id=c.member and extract(epoch from m.joined_at)*1000<=s.started_at
        and (m.ended_at is null or s.started_at<extract(epoch from m.ended_at)*1000)) destinations;
  perform 1 from groups where id=any(repair_groups) order by id for share;
  for source in select * from jsonb_to_recordset(candidates) as c(member uuid,session text)
      order by member,session collate "C" loop
    perform notification_source_lock(source.member,source.session);
  end loop;
  perform 1 from notification_workouts w join jsonb_to_recordset(candidates) as c(member uuid,session text)
    on w.member_user_id=c.member and w.session_id=c.session order by w.member_user_id,w.session_id collate "C" for update of w;
  for source in select * from jsonb_to_recordset(candidates) as c(member uuid,session text)
      order by member,session collate "C" loop
    begin
      perform notification_track_workout(source.member,source.session);
      admitted:=admitted||jsonb_build_array(to_jsonb(source));
    exception when others then
      get stacked diagnostics code=returned_sqlstate;
      perform group_eval_log_failure('notification.recovery_failed',source.member,jsonb_build_object('session_id',source.session,'sqlstate',code));
    end;
  end loop;
  for source in select * from jsonb_to_recordset(admitted) as c(member uuid,session text)
      order by member,session collate "C" loop
    begin
      -- Repair only the destinations admitted under the batch's group fence; later membership waits for the next pass.
      insert into group_session_shares(group_id,member_user_id,session_id,session_started_at)
        select m.group_id,s.owner_user_id,s.id,s.started_at from sessions s
        join group_memberships m on m.user_id=s.owner_user_id and extract(epoch from m.joined_at)*1000<=s.started_at
          and (m.ended_at is null or s.started_at<extract(epoch from m.ended_at)*1000)
        join groups g on g.id=m.group_id and g.deleted_at is null and g.id=any(repair_groups)
        where s.owner_user_id=source.member and s.id=source.session
        on conflict(group_id,member_user_id,session_id) do nothing;
      perform notification_start_workout(source.member,source.session);
      if exists(select 1 from notification_workouts where member_user_id=source.member and session_id=source.session and confirmed_at is not null)
        and not notification_workout_ready(source.member,source.session) and not exists(
          select 1 from group_eval_queue where kind='session' and member_user_id=source.member and session_id=source.session)
        and not exists(select 1 from group_metric_eval_queue q where exists(
          select 1 from jsonb_array_elements(notification_session_targets(source.member,source.session)) t
          where t->>'group_exercise_id'=q.group_exercise_id::text)) then
        perform group_eval_enqueue_session(source.member,source.session,'set');
        perform group_eval_kick_once(source.member);
      end if;
      update notification_workouts set updated_at=now() where member_user_id=source.member and session_id=source.session;
    exception when others then
      get stacked diagnostics code=returned_sqlstate;
      perform group_eval_log_failure('notification.recovery_failed',source.member,jsonb_build_object('session_id',source.session,'sqlstate',code));
    end;
  end loop;
end $$;

create function app_public.notification_workout_prepare(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare jobs jsonb;
begin
  if p_limit not between 1 and 20 or p_limit is null then raise exception 'VALIDATION: invalid preparation limit'; end if;
  perform notification_recover_workouts(p_limit);
  select coalesce(jsonb_agg(jsonb_build_object('member_user_id',w.member_user_id,'session_id',w.session_id,'generation',w.generation,
    'targets',coalesce((select jsonb_agg(jsonb_build_object('group_id',t.group_id,'group_exercise_id',t.group_exercise_id,
      'best_metrics',t.best_metrics,'before',t.before_ranks,'final',t.final_ranks,'without_workout',t.without_workout))
      from notification_workout_targets t where t.member_user_id=w.member_user_id and t.session_id=w.session_id
        and exists(select 1 from jsonb_array_elements(notification_session_targets(w.member_user_id,w.session_id)) x
          where x->>'group_exercise_id'=t.group_exercise_id::text)),'[]'::jsonb))), '[]'::jsonb) into jobs
  from (select * from notification_workouts w where w.eligible and w.enqueued_generation<w.generation
      and notification_workout_ready(w.member_user_id,w.session_id) order by updated_at,member_user_id,session_id limit p_limit) w;
  return jsonb_build_object('jobs',jobs);
end $$;

create function app_public.notification_workout_enqueue(p_member uuid,p_session text,p_generation bigint,p_contributions jsonb) returns boolean
language plpgsql security definer set search_path=app_public,pg_temp as $$
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
end $$;

create function app_public.notification_intent_contributions(p_intent app_public.notification_intents) returns jsonb
language sql stable security definer set search_path=app_public,pg_temp as $$
  select case when p_intent.workout_generation is null then p_intent.contributions else coalesce((
    select jsonb_agg(jsonb_build_object('group_id',sh.group_id,
      'best_count',case when p_intent.kind='start' then 0 else coalesce((c->>'best_count')::int,0) end,
      'rank_count',case when p_intent.kind='start' then 0 else coalesce((c->>'rank_count')::int,0) end) order by sh.group_id)
    from group_session_shares sh left join notification_workouts w on w.member_user_id=sh.member_user_id and w.session_id=sh.session_id
    left join lateral(select x as c from jsonb_array_elements(w.contributions) x where x->>'group_id'=sh.group_id::text) counts on true
    where sh.member_user_id=p_intent.lifter_user_id and sh.session_id=p_intent.session_id),'[]'::jsonb) end;
$$;

-- Current narrow counts replace operational queue hints; manual foundation fixtures retain their direct service seam.
alter function app_public.notification_projection(bigint) stable;
do $$ declare definition text; anchor text; begin
  definition:=pg_get_functiondef('app_public.notification_projection(bigint)'::regprocedure);
  anchor:='jsonb_array_elements(n.contributions)';
  if strpos(definition,anchor)=0 then raise exception 'notification projection anchor changed'; end if;
  execute replace(definition,anchor,'jsonb_array_elements(app_public.notification_intent_contributions(n))');
  definition:=pg_get_functiondef('app_public.notification_begin_send(bigint,uuid,bigint)'::regprocedure);
  -- The added group/source waits must not reuse transaction-start time for admission or handoff leases.
  definition:=replace(definition,'now()','clock_timestamp()');
  anchor:='  -- Enqueue''s FK check also touches installation: workout, installation, then delivery.';
  if strpos(definition,anchor)=0 then raise exception 'notification handoff lock anchor changed'; end if;
  definition:=replace(definition,anchor,$new$  -- Publication/authorization uses group -> source -> recipient -> installation -> delivery.
  perform 1 from app_public.groups g where exists(select 1 from app_public.group_session_shares sh
    where sh.group_id=g.id and sh.member_user_id=n.lifter_user_id and sh.session_id=n.session_id) order by g.id for share;
  perform app_public.notification_source_lock(n.lifter_user_id,n.session_id);$new$);
  anchor:='p jsonb;';
  if strpos(definition,anchor)=0 then raise exception 'notification preparation declaration anchor changed'; end if;
  definition:=replace(definition,anchor,'p jsonb; source_ready boolean;');
  anchor:='  p:=app_public.notification_projection(n.id);';
  if strpos(definition,anchor)=0 then raise exception 'notification preparation projection anchor changed'; end if;
  execute replace(definition,anchor,$new$  if n.kind='completion' and n.workout_generation is not null then
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
  else p:=app_public.notification_projection(n.id); end if;$new$);
end $$;

-- Keep source-row -> registration ordering, rather than taking the foundation allocator first.
alter function app_public.notification_prune() rename to notification_prune_without_workouts;
create function app_public.notification_prune() returns void
language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  perform 1 from notification_workouts w where
    ((not w.eligible or w.completion_at+interval '24 hours'<=now()) and exists(
      select 1 from notification_workout_targets t where t.member_user_id=w.member_user_id and t.session_id=w.session_id)) or
    (w.completion_at+interval '24 hours'<=now() and (w.eligible or w.manifest_digest is not null or
      w.context_digest is not null or w.confirmed_at is not null or w.contributions<>'[]'::jsonb or exists(
        select 1 from notification_workout_moments m where m.member_user_id=w.member_user_id and m.session_id=w.session_id)))
    order by w.member_user_id,w.session_id for update;
  delete from app_public.notification_workout_targets t using app_public.notification_workouts w
    where w.member_user_id=t.member_user_id and w.session_id=t.session_id and (
      not w.eligible or w.completion_at+interval '24 hours'<=now());
  delete from notification_workout_moments m using notification_workouts w
    where w.member_user_id=m.member_user_id and w.session_id=m.session_id and w.completion_at+interval '24 hours'<=now();
  update app_public.notification_workouts set manifest_digest=null,context_digest=null,confirmed_at=null,contributions='[]'::jsonb,eligible=false
    where completion_at+interval '24 hours'<=now() and (eligible or manifest_digest is not null or
      context_digest is not null or confirmed_at is not null or contributions<>'[]'::jsonb);
  perform notification_prune_without_workouts();
end $$;

alter function app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb) rename to group_metric_eval_publish_without_notifications;
revoke all on function app_public.group_metric_eval_publish_without_notifications(bigint,bigint,uuid,jsonb) from public,anon,authenticated,service_role;
create function app_public.group_metric_eval_publish(p_job_id bigint,p_generation bigint,p_claim_id uuid,p_evaluation jsonb) returns jsonb
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare q group_metric_eval_queue; g jsonb; result jsonb;
begin
  select * into q from group_metric_eval_queue where id=p_job_id;
  if not found then return jsonb_build_object('completed',false); end if;
  perform 1 from groups where id=q.group_id for update;
  perform pg_advisory_xact_lock(25005,hashtext(q.group_id::text));
  select * into q from group_metric_eval_queue where id=p_job_id for update;
  if q.claim_id is distinct from p_claim_id or q.generation is distinct from p_generation or p_claim_id is null then
    return group_metric_eval_publish_without_notifications(p_job_id,p_generation,p_claim_id,p_evaluation); end if;
  g:=group_metric_eval_source_graph(q.group_id,q.group_exercise_id);
  if g is not null and p_evaluation->>'source_token'=g->>'source_token' then
    perform notification_capture_comparison(q.group_id,q.group_exercise_id,(g->'rules'->>'rules_revision')::bigint,false,g);
  end if;
  result:=group_metric_eval_publish_without_notifications(p_job_id,p_generation,p_claim_id,p_evaluation);
  if (result->>'completed')::boolean and g is not null then
    perform notification_capture_comparison(q.group_id,q.group_exercise_id,(g->'rules'->>'rules_revision')::bigint,true,g);
  end if;
  return result;
end $$;
grant execute on function app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb) to service_role;

create function app_public.notification_workout_ready(p_member uuid,p_session text) returns boolean
language plpgsql stable security definer set search_path=app_public,pg_temp as $$
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
end $$;

-- Seed actual cutover baselines for active workouts; rebuilding boards stay explicitly unknown.
do $$ declare ge record; begin
  for ge in select group_id,id,rules_revision from app_public.group_exercises where archived_at is null loop
    perform app_public.notification_capture_comparison(ge.group_id,ge.id,ge.rules_revision,false);
  end loop;
end $$;

revoke all on function app_public.group_metric_eval_publish(bigint,bigint,uuid,jsonb) from public,anon,authenticated;
do $$ declare f record; begin
  for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app_public' and p.proname like 'notification_%' loop
    execute format('revoke all on function %s from public,anon,authenticated',f.oid::regprocedure);
    if f.proname in ('notification_register','notification_unregister','notification_preferences_get','notification_preferences_set',
        'notification_group_mute','notification_confirm_completion') then
      execute format('grant execute on function %s to anon,authenticated',f.oid::regprocedure);
    else execute format('grant execute on function %s to service_role',f.oid::regprocedure); end if;
  end loop;
end $$;
