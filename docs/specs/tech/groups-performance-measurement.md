# Groups performance measurement

> **Owns:** what the groups performance harness measures, how its counters are
> defined, and how to run and read it. **Not here:** the group rules it
> exercises → `groups-contract.md`; lane registry → `scripts/lanes.tsv`;
> thresholds, matrices and knobs → the code in `apps/mobile/scripts/perf/groups/`.
> **Load when:** measuring or changing the server cost of group evaluation,
> publication, notification capture or the pg_cron sweeps, or running lane
> `groups-perf` / `groups-perf-load`.

## Rules

1. **Portable counters only.** A counter means the same on a laptop and on
   hosted Supabase: shared buffer pages (hit + read), rows inserted, updated
   and deleted per table, WAL bytes, temp bytes, sequential vs index scans,
   write transactions, source-graph bytes and sets scored, Edge runs, claimed
   jobs and evaluations. Wall-clock is recorded and never asserted.
2. **Measure, never optimise, in the harness.** It runs today's SQL and the
   app's own TS (`set-facts.ts`, `competition-evaluation.ts`, the
   notification worker's handler); it changes no production code.
3. **Assertions are report-only** until the operator promotes one: a failed
   scaling assertion prints `WARN` and exits 0. `GROUPS_PERF_STRICT=1` turns
   them into failures.
4. **A lane leaves its stack as it found it.** Tier 1 rolls back. Tier 2
   restores the cron schedules, the notification cutover and the Vault
   entries it set, and deletes its fixture; a cleanup failure fails the lane.

## Headline metrics

- **(a) Work per logged set:** one `sync_push` of one linked working set, plus
  every Edge run its kicks start and every kick those start, summed.
- **(b) Idle cost per hour:** each pg_cron job's tick with nobody training,
  times its schedule's runs per hour.

The **slope** is the ratio per doubling between adjacent sweep points,
`(v2/v1)^(1/log2(x2/x1))`: 1.00× is flat, 2.00× is linear.

## Fixture

Generated in SQL with `generate_series`, every trigger on
(`apps/mobile/scripts/perf/groups/fixture.ts`): M members of one group, H
days of history each, all of it shared, about 3.5 sessions a week of 15–25
sets over eight exercises, three linked (one bodyweight-aware), a weekly
bodyweight reading, and a notification cutover a week old. Steady state is
reached by the real worker sequence before anything is measured.

## Tier 1 — `./boga test groups-perf`

Deterministic SQL counters, each scenario in one transaction that is rolled
back, after a `vacuum (analyze)` and an in-transaction `analyze`. Every RPC
runs as PostgREST would run it (role, claims, headers) inside a savepoint
standing for its own transaction, under a per-call budget that keeps the
run finite, wrapped in `EXPLAIN (ANALYZE, BUFFERS, WAL)` with
`pg_stat_xact_user_tables` diffed around it. pg_net never sends inside the
transaction, so each queued kick is replayed as one Edge run: group-eval
through `group-eval-mirror.ts`, which `__tests__/groups-perf-mirror.test.ts`
holds to `supabase/functions/group-eval/index.ts`.

It sweeps H with M fixed and M with H fixed. The default matrix is a doubling
series that today's code finishes in one gate run; `GROUPS_PERF_MATRIX=full`
runs the production-scale matrix. A scenario whose steady state or measured
call exceeds the budget is reported incomplete, and the larger points of its
sweep are skipped. The budget is wall-clock, so it is no hosted limit; calls
slower than PostgREST's 8 s statement timeout on the machine that ran them are
listed for information, never asserted.

Fidelity limits, by design:

- the fixture is uncommitted, so no visibility map or hint bits help reads;
- deferred constraint checks run unmeasured (a few index probes per row);
- no notification installations exist, so no delivery is sent.

## Tier 2 — `./boga test groups-perf-load`

A committed fixture, drained by the real `group-eval` Edge function. C
loggers (default 1, 5, 10) each push a set about every 90 s through the real
`sync_push`, so the real kick → group-eval → publish → notification-worker
path runs. Counters are `pg_stat_statements` deltas (the harness's own
statements tagged and excluded), `pg_stat_user_tables`, the WAL position,
pg_net responses and 250 ms `pg_stat_activity` lock-wait samples. It reports
enqueue → published latency (a set's `server_received_at` to its score row's
`evaluated_at`), wasted evaluations (requeued or failed), Edge responses that
outran pg_net's timeout, and retries.

Its idle window points the notification worker's Vault URL at the slot's
Kong, as hosted is configured, runs both sweeps on a 10-second schedule for a
few ticks, and scales them to their real schedules. The projected forced WAL
archives are the 2-minute windows of an hour holding a tick (one 16 MB segment
each under `archive_timeout = 2min`), times the share of ticks that advanced
the WAL position, sampled every 2 s. While pg_cron logs every run
(`cron.log_run`, which hosted projects cannot change), every tick writes WAL.

## Reading a report

Each run writes `apps/mobile/artifacts/perf/groups/<run>/report.json` and
`summary.md`, and prints the summary. Compare counters, not durations; record
which `main` commit a baseline ran on, since a migration moves every number.
Rows and WAL repeat closely run to run; pages can move by a tenth as the
planner's statistics shift, so read a slope, not a single page count.
