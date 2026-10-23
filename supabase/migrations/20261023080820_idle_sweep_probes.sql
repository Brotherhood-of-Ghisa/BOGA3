-- With nobody training, both pg_cron sweeps read a bounded number of pages,
-- however much history exists.
--
-- group_eval_sweep called group_eval_rules_stale every run. Its body is a
-- non-inlined SQL function planned without its argument's value, so it read
-- every set fact to find none older than the recorded rules version. A fact
-- older than that version is a necessary condition for a stale session, and
-- the oldest version is one probe of group_set_facts_rules_version, so the
-- sweep now asks that first and calls the shared predicate only when it holds.
--
-- notification_prune_due found secrets to prune by joining every ticketed or
-- failed delivery of the last 30 days to its intent. A delivery now carries its
-- intent's expiry, kept equal by triggers, so the check is one index range.

create or replace function app_public.group_eval_sweep()
returns boolean language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
begin
  if not exists (select 1 from app_public.group_eval_queue q
    where q.available_at<=now() and (q.claimed_until is null or q.claimed_until<now()))
    and not exists (select 1 from app_public.group_metric_eval_queue q
    where q.available_at<=now() and (q.claimed_until is null or q.claimed_until<now()))
    and not exists (select 1 from app_public.group_eval_rules_state s
    where (select min(f.rules_version) from app_public.group_set_facts f) < s.rules_version
      and exists (select 1 from app_public.group_eval_rules_stale(s.rules_version, 1))) then return false; end if;
  perform app_public.group_eval_kick();
  return true;
end;
$$;

alter table app_public.notification_deliveries add column intent_expires_at timestamptz;
update app_public.notification_deliveries d set intent_expires_at=n.expires_at
  from app_public.notification_intents n where n.id=d.intent_id;
alter table app_public.notification_deliveries alter column intent_expires_at set not null;
comment on column app_public.notification_deliveries.intent_expires_at is
  'Copy of the intent''s expires_at, kept equal by triggers, so the prune check reads one index range. Server-only.';

create function app_public.notification_delivery_intent_expiry() returns trigger
language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  select expires_at into strict new.intent_expires_at from notification_intents where id=new.intent_id;
  return new;
end $$;
create trigger notification_deliveries_intent_expiry before insert or update of intent_id,intent_expires_at
  on app_public.notification_deliveries for each row execute function app_public.notification_delivery_intent_expiry();

-- The RPCs never move an intent's event time; only direct maintenance does.
create function app_public.notification_intent_expiry_to_deliveries() returns trigger
language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  update notification_deliveries set intent_expires_at=new.expires_at where intent_id=new.id;
  return null;
end $$;
create trigger notification_intents_expiry_to_deliveries after update of expires_at on app_public.notification_intents
  for each row when (old.expires_at is distinct from new.expires_at)
  execute function app_public.notification_intent_expiry_to_deliveries();

drop index app_public.notification_delivery_prunable_idx;
create index notification_delivery_prunable_idx on app_public.notification_deliveries(intent_expires_at)
  where ticket_id is not null or error_code is not null;

-- Mirrors notification_prune's predicates: true while a prune pass would change something.
create or replace function app_public.notification_prune_due() returns boolean
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
    or exists(select 1 from notification_deliveries d
      where (d.ticket_id is not null or d.error_code is not null) and d.intent_expires_at<now()-interval '30 days');
$$;

do $$ declare f record; begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app_public' and p.proname in ('notification_delivery_intent_expiry','notification_intent_expiry_to_deliveries') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.oid::regprocedure);
  end loop;
end $$;
