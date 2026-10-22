-- Workout notifications are admitted from the moments that produced them, not
-- from a periodic rescan of every session of the last 24 hours.
--
-- A fresh moment queues its source once; the worker admits only queued sources,
-- then forgets them. A failed trigger loses that alert and
-- is logged; nothing repairs it later. The sweep calls the worker only when
-- something is due, so an idle hour writes no application rows.

create table app_public.notification_moment_queue (
  id bigint generated always as identity primary key,
  member_user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  queued_at timestamptz not null default now(),
  -- A start more than 5 minutes ahead of server time is admitted once it is not.
  available_at timestamptz not null default now()
);
alter table app_public.notification_moment_queue enable row level security;
revoke all on app_public.notification_moment_queue from public,anon,authenticated;
grant all on app_public.notification_moment_queue to service_role;

-- Only confirmed, unexpired, not yet enqueued completions can become ready.
create index notification_workout_ready_idx on app_public.notification_workouts(updated_at,member_user_id,session_id)
  where eligible and confirmed_at is not null and enqueued_generation<generation;
-- The due checks read only rows a prune pass would still change, so their cost
-- does not grow with every workout, intent and delivery ever recorded.
create index notification_workout_prunable_idx on app_public.notification_workouts(completion_at)
  where eligible or manifest_digest is not null or context_digest is not null or confirmed_at is not null or contributions<>'[]'::jsonb;
create index notification_workout_moment_age_idx on app_public.notification_workout_moments(event_at);
create index notification_intent_prunable_idx on app_public.notification_intents(expires_at) where contributions<>'[]';
create index notification_delivery_prunable_idx on app_public.notification_deliveries(intent_id)
  where ticket_id is not null or error_code is not null;

-- A moment is appended once per source and kind, so a source is queued at most
-- once per kind. Returns whether this call queued it.
drop function app_public.notification_append_moment(uuid,text,text,bigint);
create function app_public.notification_append_moment(p_member uuid,p_session text,p_kind text,p_event_ms bigint) returns boolean
language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  if exists(select 1 from notification_workout_moments where member_user_id=p_member and session_id=p_session and kind=p_kind) then return false; end if;
  -- Diagnostics are denial-only: a known failed admission can never be replaced by a newer authored timestamp.
  insert into notification_workout_moments(member_user_id,session_id,kind,event_at)
    values(p_member,p_session,p_kind,case when exists(select 1 from public.app_logs where user_id=p_member
      and event='notification.intake_failed' and context->>'table'='sessions' and context->>'row_id'=p_session
      and context->>'moment_kind'=p_kind) then null else to_timestamp(p_event_ms/1000.0) end) on conflict do nothing;
  if not found then return false; end if;
  insert into notification_moment_queue(member_user_id,session_id,available_at)
    select p_member,p_session,greatest(now(),event_at-interval '5 minutes') from notification_workout_moments
    where member_user_id=p_member and session_id=p_session and kind=p_kind
      and event_at+interval '24 hours'>now();
  return found;
end $$;

-- Only session rows carry moments; a write kicks the worker only when it queued one.
create or replace function app_public.notification_on_workout_row() returns trigger
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare code text; moment_kind text; queued boolean:=false;
begin
  if tg_op='UPDATE' and to_jsonb(new)-array['client_updated_at_ms','server_received_at']=
      to_jsonb(old)-array['client_updated_at_ms','server_received_at'] then return null; end if;
  begin
    -- Capture the value about to be erased before a reopen or completed_at edit.
    if tg_op='UPDATE' and old.completed_at is not null and abs(old.completed_at::numeric)<=8640000000000000 then
      moment_kind:='completion';
      queued:=notification_append_moment(new.owner_user_id,new.id,moment_kind,old.completed_at) or queued;
    end if;
    if new.status='active' and new.deleted_at is null and abs(new.started_at::numeric)<=8640000000000000
      and not exists(select 1 from notification_workout_moments where member_user_id=new.owner_user_id and session_id=new.id and kind='completion')
      and not exists(select 1 from notification_workouts where member_user_id=new.owner_user_id and session_id=new.id and completion_at is not null) then
      moment_kind:='start';
      queued:=notification_append_moment(new.owner_user_id,new.id,moment_kind,
        case when tg_op='UPDATE' then old.started_at else new.started_at end) or queued;
    elsif new.status='completed' and new.deleted_at is null and abs(new.completed_at::numeric)<=8640000000000000 then
      moment_kind:='completion';
      queued:=notification_append_moment(new.owner_user_id,new.id,moment_kind,new.completed_at) or queued;
    end if;
    if queued and exists(select 1 from group_session_shares sh join groups g on g.id=sh.group_id
      where sh.member_user_id=new.owner_user_id and sh.session_id=new.id and g.deleted_at is null) then
      perform notification_kick_once();
    end if;
  exception when others then
    get stacked diagnostics code=returned_sqlstate;
    perform group_eval_log_failure('notification.intake_failed',new.owner_user_id,
      jsonb_build_object('table',tg_table_name,'row_id',new.id,'moment_kind',moment_kind,'sqlstate',code));
  end;
  return null;
end $$;
drop trigger session_exercises_notification_intake on app_public.session_exercises;
drop trigger exercise_sets_notification_intake on app_public.exercise_sets;

-- Admits each queued source once: track its moments, then send its start.
-- Lock order matches publication: groups, then sources, then workouts.
create function app_public.notification_admit_moments(p_limit integer default 20) returns void
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare source record; code text; claimed bigint[]; candidates jsonb;
begin
  if p_limit not between 1 and 20 or p_limit is null then raise exception 'VALIDATION: invalid admission limit'; end if;
  select coalesce(array_agg(id),array[]::bigint[]) into claimed from (
    select id from notification_moment_queue where available_at<=now() order by id for update skip locked limit p_limit) picked;
  if cardinality(claimed)=0 then return; end if;
  select coalesce(jsonb_agg(distinct jsonb_build_object('member',member_user_id,'session',session_id)),'[]'::jsonb)
    into candidates from notification_moment_queue where id=any(claimed);
  perform 1 from groups g where exists(select 1 from jsonb_to_recordset(candidates) as c(member uuid,session text)
    join group_session_shares sh on sh.member_user_id=c.member and sh.session_id=c.session where sh.group_id=g.id)
    order by g.id for share;
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
      perform notification_start_workout(source.member,source.session);
    exception when others then
      get stacked diagnostics code=returned_sqlstate;
      perform group_eval_log_failure('notification.admission_failed',source.member,jsonb_build_object('session_id',source.session,'sqlstate',code));
    end;
  end loop;
  delete from notification_moment_queue where id=any(claimed);
end $$;

create or replace function app_public.notification_workout_prepare(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare jobs jsonb;
begin
  if p_limit not between 1 and 20 or p_limit is null then raise exception 'VALIDATION: invalid preparation limit'; end if;
  perform notification_admit_moments(p_limit);
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
  return jsonb_build_object('jobs',jobs);
end $$;

drop function app_public.notification_recover_workouts(integer);

-- A member who leaves drops out of every comparison of the group, so those
-- comparisons are evaluated again rather than waiting for the next set.
create function app_public.group_metric_on_membership_end() returns trigger
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare exercise uuid;
begin
  for exercise in select id from group_exercises where group_id=new.group_id and archived_at is null order by id loop
    perform group_metric_enqueue_isolated(new.group_id,exercise,'membership',new.user_id);
  end loop;
  return null;
end $$;
create trigger group_memberships_metric_on_end after update of ended_at on app_public.group_memberships
  for each row when (old.ended_at is null and new.ended_at is not null)
  execute function app_public.group_metric_on_membership_end();
revoke all on function app_public.group_metric_on_membership_end() from public,anon,authenticated;

-- Mirrors notification_prune's predicates: true while a prune pass would change something.
create function app_public.notification_prune_due() returns boolean
language sql stable security definer set search_path=app_public,pg_temp as $$
  select exists(select 1 from notification_workouts w where w.completion_at<=now()-interval '24 hours' and (w.eligible or
      w.manifest_digest is not null or w.context_digest is not null or w.confirmed_at is not null or w.contributions<>'[]'::jsonb))
    or exists(select 1 from notification_workout_targets t join notification_workouts w using(member_user_id,session_id)
      where not w.eligible or w.completion_at<=now()-interval '24 hours')
    -- A workout's moments never postdate its completion, so only moments older than the window, or
    -- forfeited ones, can be pruned.
    or exists(select 1 from notification_workout_moments m join notification_workouts w using(member_user_id,session_id)
      where (m.event_at<=now()-interval '24 hours' or m.event_at is null) and w.completion_at<=now()-interval '24 hours')
    or exists(select 1 from notification_intents where expires_at<now()-interval '30 days' and contributions<>'[]')
    or exists(select 1 from notification_installations where not active and updated_at<now()-interval '30 days'
      and (encryption_key<>'' or token<>'retired:'||id::text))
    or exists(select 1 from notification_deliveries d join notification_intents n on n.id=d.intent_id
      where (d.ticket_id is not null or d.error_code is not null) and n.expires_at<now()-interval '30 days');
$$;

-- True while a worker run has something to do: admissions, ready completions,
-- sends, receipts, expiries or pruning. Mirrors the worker's claim predicates.
create or replace function app_public.notification_work_pending() returns boolean
language sql stable security definer set search_path=app_public,pg_temp as $$
  select exists(select 1 from notification_moment_queue where available_at<=now())
    or exists(select 1 from notification_workouts w where w.eligible and w.confirmed_at is not null
      and w.enqueued_generation<w.generation and w.completion_at>now()-interval '24 hours')
    or exists(select 1 from notification_deliveries d join notification_intents n on n.id=d.intent_id where
      (d.state='sending' and d.lease_until<=now()) or
      (d.state in ('pending','retry','disabled','leased') and n.expires_at<=now()) or
      (d.state in ('pending','retry','disabled') and d.available_at<=now() and exists(
        select 1 from notification_config where singleton and sending_enabled and provider<>'disabled')) or
      (d.state='leased' and d.lease_until<=now()) or
      (d.state in ('pending','retry') and not exists(
        select 1 from notification_config where singleton and sending_enabled and provider<>'disabled')) or
      (d.state='ticket' and (d.receipt_lease_until is null or d.receipt_lease_until<=now()) and
        (d.receipt_available_at<=now() or d.ticket_at+interval '24 hours'<=now() or d.receipt_attempts>=20)))
    or notification_prune_due();
$$;

create or replace function app_public.notification_sweep() returns bigint
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare endpoint text; key text;
begin
  -- An idle sweep reads and returns: no worker run, no pg_net rows.
  if not notification_work_pending() then return null; end if;
  -- Disabling new sends must not stop accepted-ticket receipts or secret pruning.
  select decrypted_secret into endpoint from vault.decrypted_secrets where name='notification_worker_url' order by created_at desc limit 1;
  select decrypted_secret into key from vault.decrypted_secrets where name='notification_worker_key' order by created_at desc limit 1;
  if endpoint is null or key is null then return null; end if;
  return net.http_post(url:=endpoint,body:='{}'::jsonb,
    headers:=jsonb_build_object('Content-Type','application/json','apikey',key),timeout_milliseconds:=10000);
exception when others then
  raise warning 'notification_worker_sweep_failed'; return null;
end $$;

drop function app_public.notification_recovery_candidates();

-- Sources whose moments are still inside their alert window are admitted once
-- by the new worker; admission is idempotent for any already sent.
insert into app_public.notification_moment_queue(member_user_id,session_id,available_at)
  select member_user_id,session_id,min(greatest(now(),event_at-interval '5 minutes')) from app_public.notification_workout_moments
  where event_at+interval '24 hours'>now() group by member_user_id,session_id;

do $$ declare f record; begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app_public' and p.proname in ('notification_append_moment','notification_admit_moments',
      'notification_prune_due','notification_work_pending') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.oid::regprocedure);
    execute format('grant execute on function %s to service_role',f.oid::regprocedure);
  end loop;
end $$;
