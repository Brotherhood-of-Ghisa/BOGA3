-- The group-eval sweep runs every 5 minutes instead of every 30 seconds
-- (groups-contract.md §2.10). The pg_net kick after each enqueuing commit is
-- the primary trigger; the sweep only catches missed kicks, elapsed backoffs,
-- expired leases and revived parked jobs, so it can afford to be slow.
--
-- An idle run still writes cron.job_run_details, and that write alone forced
-- Postgres to close and archive a 16 MB WAL segment every archive_timeout
-- (2 minutes) on a hosted project with no real changes. Every 5 minutes, the
-- idle floor drops from 30 segments an hour to 12.

-- cron.schedule upserts by job name, so this replaces the 30-second schedule.
select cron.schedule('group-eval-sweep', '*/5 * * * *', 'select app_public.group_eval_sweep()');

comment on function app_public.group_eval_max_attempts() is
  'Failures before an evaluator job parks. A retry waits for its backoff (2 s .. 5 min) and then for a kick or the 5-minute sweep, so the 10th failure comes about 45 minutes after the first.';
