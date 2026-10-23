-- Both pg_cron backstops run hourly, in the same minute, so a hosted hour
-- holds one forced WAL archive for them instead of twelve. Fresh work never
-- waits for them: each enqueue kicks its worker after commit. What only a
-- sweep starts (lost kicks, retries after backoff, expired leases, rules
-- drains, receipts, admissions without a group, pruning) now waits up to an
-- hour.
--
-- A run a sweep starts says so in its request body and, when it did any work,
-- records how much in app_logs; an idle tick still writes no row.

select cron.schedule('group-eval-sweep', '0 * * * *', 'select app_public.group_eval_sweep()');
select cron.schedule('notification-delivery-sweep', '0 * * * *', 'select app_public.notification_sweep()');

-- Runs started by a sweep record their work through this one seam.
create function app_public.sweep_record_work(p_event text, p_work jsonb) returns void
language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
begin
  if p_event is null or p_event not in ('group.eval_sweep_work', 'notification.sweep_work')
    or jsonb_typeof(p_work) is distinct from 'object' or octet_length(p_work::text) > 2000 then
    raise exception 'VALIDATION: invalid sweep work record' using errcode = 'P0001';
  end if;
  insert into public.app_logs (level, source, event, message, context)
  values ('info', 'backend', p_event, 'a run started by the backstop sweep did work', p_work);
end;
$$;
revoke all on function app_public.sweep_record_work(text, jsonb) from public, anon, authenticated;
grant execute on function app_public.sweep_record_work(text, jsonb) to service_role;

-- A kick says who sent it; member kicks keep the empty body.
drop function app_public.group_eval_kick();
create function app_public.group_eval_kick(p_source text default null)
returns bigint
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _url    text := app_public.group_eval_config('group_eval_url');
  _secret text := app_public.group_eval_config('group_eval_secret');
begin
  if _url is null or _secret is null then
    return null;
  end if;
  return net.http_post(
    url := _url,
    body := case when p_source is null then '{}'::jsonb else jsonb_build_object('source', p_source) end,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-group-eval-secret', _secret),
    timeout_milliseconds := 5000
  );
end;
$$;
revoke all on function app_public.group_eval_kick(text) from public, anon, authenticated, service_role;

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
  perform app_public.group_eval_kick('sweep');
  return true;
end;
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
  return net.http_post(url:=endpoint,body:=jsonb_build_object('source','sweep'),
    headers:=jsonb_build_object('Content-Type','application/json','apikey',key),timeout_milliseconds:=10000);
exception when others then
  raise warning 'notification_worker_sweep_failed'; return null;
end $$;

-- Preparation reports how many queued sources it admitted, so a sweep's run
-- can record them; the admission RPC keeps its empty reply.
create function app_public.notification_admit_moments_counted(p_limit integer default 20) returns integer
language plpgsql security definer set search_path=app_public,pg_temp as $$
declare source record; code text; claimed bigint[]; candidates jsonb;
begin
  if p_limit not between 1 and 20 or p_limit is null then raise exception 'VALIDATION: invalid admission limit'; end if;
  select coalesce(array_agg(id),array[]::bigint[]) into claimed from (
    select id from notification_moment_queue where available_at<=now() order by id for update skip locked limit p_limit) picked;
  if cardinality(claimed)=0 then return 0; end if;
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
  return cardinality(claimed);
end $$;
revoke all on function app_public.notification_admit_moments_counted(integer) from public, anon, authenticated, service_role;

create or replace function app_public.notification_admit_moments(p_limit integer default 20) returns void
language plpgsql security definer set search_path=app_public,pg_temp as $$
begin
  perform notification_admit_moments_counted(p_limit);
end $$;

create or replace function app_public.notification_workout_prepare(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path=app_public,pg_temp as $$
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
end $$;
