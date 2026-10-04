-- A failing evaluator job stops retrying at a cap (groups-contract.md §2.8,
-- §2.10). Both queues backed off to 5 minutes and then retried forever, so a
-- deterministic failure (an evaluator older than the SQL it feeds) re-ran its
-- whole prepare/publish every 5 minutes until someone noticed.
--
-- The failure that reaches group_eval_max_attempts() parks the job instead:
-- available_at = 'infinity', so neither claim nor the sweep sees it, and it
-- writes one group.eval_parked row instead of group.eval_failed. Nothing is
-- dropped. A re-enqueue makes a parked job available again (least(available_at,
-- now()) for sessions and targets, available_at = now() for comparisons), and
-- group_eval_retry_parked() revives every parked job once a fix ships.

create function app_public.group_eval_max_attempts()
returns integer
language sql
immutable
set search_path = app_public, pg_temp
as $$ select 10 $$;

comment on function app_public.group_eval_max_attempts() is
  'Failures before an evaluator job parks. With the 2 s .. 5 min backoff, the 10th failure comes about 13.5 minutes after the first.';

create or replace function app_public.group_eval_log_failure(p_event text, p_user_id uuid, p_context jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
begin
  begin
    insert into public.app_logs (level, source, event, message, user_id, context)
    values (
      'error', 'database', p_event,
      case p_event
        when 'group.eval_enqueue_failed' then 'group evaluator enqueue failed; the sync write committed'
        when 'group.eval_kick_failed' then 'group evaluator kick failed; the sync write committed and the sweep will retry'
        when 'group.eval_parked' then 'group evaluator job failed too often and is parked; it waits for a re-enqueue or group_eval_retry_parked()'
        else 'group evaluator job failed; it stays queued and retries'
      end,
      p_user_id, p_context
    );
  exception when others then
    raise warning '% (app_logs unavailable): %', p_event, p_context;
  end;
end;
$$;

-- Release a failed job with exponential backoff (2 s, 4 s, … capped at 5 min)
-- and one sanitized row; the failure that reaches the cap parks it.
create or replace function app_public.group_eval_fail(p_job_id bigint, p_sqlstate text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _job app_public.group_eval_queue;
  _code text := case when p_sqlstate ~ '^[0-9A-Z]{5}$' then p_sqlstate else 'EVALX' end;
  _parked boolean;
begin
  update app_public.group_eval_queue q
     set attempts      = q.attempts + 1,
         claimed_until = null,
         available_at  = case
           when q.attempts + 1 >= app_public.group_eval_max_attempts() then 'infinity'::timestamptz
           else now() + make_interval(secs => least(300, power(2, least(q.attempts + 1, 9))))
         end,
         last_sqlstate = _code
   where q.id = p_job_id
  returning q.* into _job;
  if not found then
    return jsonb_build_object('job_id', p_job_id, 'found', false);
  end if;

  _parked := _job.available_at = 'infinity'::timestamptz;
  perform app_public.group_eval_log_failure(
    case when _parked then 'group.eval_parked' else 'group.eval_failed' end, _job.member_user_id,
    jsonb_build_object('job_id', _job.id, 'kind', _job.kind, 'sqlstate', _code)
      || case when _parked then jsonb_build_object('attempts', _job.attempts) else '{}'::jsonb end);
  return jsonb_build_object('job_id', _job.id, 'found', true, 'attempts', _job.attempts, 'parked', _parked);
end;
$$;

-- Fenced failures cannot reset a newer worker's lease. A source change since
-- this claim deserves an immediate fresh snapshot, not an old error's backoff.
create or replace function app_public.group_metric_eval_fail(
  p_job_id bigint, p_generation bigint, p_claim_id uuid, p_sqlstate text
)
returns jsonb language plpgsql volatile security definer set search_path = app_public, pg_temp as $$
declare
  _job app_public.group_metric_eval_queue;
  _code text := case when p_sqlstate ~ '^[0-9A-Z]{5}$' then p_sqlstate else 'EVALX' end;
  _parked boolean;
begin
  select * into _job from app_public.group_metric_eval_queue where id = p_job_id for update;
  if not found or _job.claim_id is distinct from p_claim_id or p_claim_id is null then
    return jsonb_build_object('job_id', p_job_id, 'accepted', false);
  end if;
  if _job.generation is distinct from p_generation then
    update app_public.group_metric_eval_queue set claimed_until = null, claim_id = null,
      available_at = now() where id = _job.id;
    return jsonb_build_object('job_id', p_job_id, 'accepted', true, 'requeued', true);
  end if;
  _parked := _job.attempts + 1 >= app_public.group_eval_max_attempts();
  update app_public.group_metric_eval_queue set attempts = attempts + 1,
    claimed_until = null, claim_id = null,
    available_at = case when _parked then 'infinity'::timestamptz
      else now() + make_interval(secs => least(300, power(2, least(attempts + 1, 9)))) end,
    last_sqlstate = _code where id = _job.id;
  perform app_public.group_eval_log_failure(
    case when _parked then 'group.eval_parked' else 'group.eval_failed' end, null,
    jsonb_build_object('job_id', _job.id, 'kind', 'exercise', 'group_id', _job.group_id,
      'group_exercise_id', _job.group_exercise_id, 'sqlstate', _code)
      || case when _parked then jsonb_build_object('attempts', _job.attempts + 1) else '{}'::jsonb end);
  return jsonb_build_object('job_id', p_job_id, 'accepted', true, 'requeued', false,
    'attempts', _job.attempts + 1, 'parked', _parked);
end;
$$;

-- Operator repair after a fix ships: every parked job in both queues gets a
-- fresh attempt budget and is claimable now. The sweep picks them up within
-- 30 s; `select app_public.group_eval_kick();` drains at once.
create function app_public.group_eval_retry_parked()
returns integer
language plpgsql
volatile
security definer
set search_path = app_public, pg_temp
as $$
declare
  _sessions integer;
  _exercises integer;
begin
  update app_public.group_eval_queue set attempts = 0, available_at = now()
   where available_at = 'infinity'::timestamptz;
  get diagnostics _sessions = row_count;
  update app_public.group_metric_eval_queue set attempts = 0, available_at = now()
   where available_at = 'infinity'::timestamptz;
  get diagnostics _exercises = row_count;
  return _sessions + _exercises;
end;
$$;

revoke all on function app_public.group_eval_max_attempts() from public, anon, authenticated, service_role;
revoke all on function app_public.group_eval_retry_parked() from public, anon, authenticated, service_role;
