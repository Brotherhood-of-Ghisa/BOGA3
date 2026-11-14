# Groups performance measurement

> **Owns:** what the groups performance harness measures, how its counters are
> defined, and how to run and read it. **Not here:** the group rules it
> exercises → `groups-contract.md`; lane registry → `scripts/lanes.tsv`;
> thresholds, matrices and knobs → the code in `apps/mobile/scripts/perf/groups/`.
> **Load when:** measuring or changing the server cost of group evaluation,
> publication, notification capture, the pg_cron sweeps or any group or
> notification RPC, rewriting one of those RPCs, or running lane
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
   them into failures. The exception is the read-path set below, which is
   strict always: its failures exit 1 whatever `GROUPS_PERF_STRICT` says.
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
- the sweeps' fixture has no notification installations, so no delivery is
  sent there;
- calls run one at a time on the one connection, even where a worker fans
  out;
- `now()` is the transaction's start, so a delivery's lease is renewed at
  clock time before its send, as a claim made moments earlier holds.

## Read path — strict per-call page budgets

The last part of `./boga test groups-perf` (alone: `cli.ts read-path`,
`apps/mobile/scripts/perf/groups/read-path.ts`). It measures the group read,
evaluator write and notification RPCs listed in `READ_PATH_RPCS`, and only
those: shared pages, temp bytes and sequential scans per call, at M=5 and
H=90 and H=180 days.

Each point starts from a full vacuum: rolled-back runs leave pages behind
that a plain vacuum frees but does not compact, and page counts would grow
with them. Then it builds the Tier 1 fixture, in one rolled-back
transaction, plus planted cases the reads must handle:

- a bodyweight-redacted member exercise: one member also links an ordinary
  exercise to the bodyweight-aware one, so it is redacted for that member
  only;
- a voided record: a member's best set edited down after evaluation, inside
  the weeks parity compares;
- last week's finished CoW and this week's live one, their sources
  backdated to when each set was logged;
- a local notification installation per member, so the cascade sends.

The point fails if a planted case is missing after steady state. Reads run
first, as the owner calls them through PostgREST. Week and period arguments
are rolling 7-day windows ending at the fixture's clock, so a run's cost does
not depend on the weekday. Then the owner's workout runs as the app syncs
it: its start, a logged set, its finish and the confirmation of its graph
(a member call). The cascades of the start, the set and the confirmation
are measured, and the write RPCs inside them run with the service role, as
their Edge callers run them; the costliest call counts. The report adds WAL
per logged set (headline a).

**Budgets** sit beside each scenario in `READ_PATH_RPCS`. A budget is the
costliest call measured at either point plus about 25%. There are two kinds:

- `baseline` records today's cost so a regression fails. It may sit over
  the 5,000-page ceiling, and its slope is reported, not asserted.
- `budgeted` must stay at or under the ceiling unless the entry carries a
  written justification. For a week-, period-, page- or single-item-scoped
  RPC its growth per doubling of history must stay at or under 1.2×.

The set fails when a call exceeds its budget, a call fails, or a budgeted
scoped RPC grows too fast. A slope is asserted only above 100 pages per
call, where a few pages of noise cannot move it. The lane lists the entries
still `baseline`. A change that moves an RPC's cost re-measures it and
updates its entry in the same PR, and a rewrite that meets the ceiling turns
its entry `budgeted`.

**Parity** (`parity.ts`) proves a rewritten RPC returns the same JSON as the
definition it replaces. Before the rewrite, add a case to `PARITY_CASES`
naming the migration that holds the old definition, plus argument sets that
cover the fixture. The set copies that definition verbatim, installs it as
`pg_temp.<fn>__legacy` and calls old and new for every member as viewer and
every argument set, on the H=90 point. It fails on any JSON difference, by
path. A rewrite that also changes a helper installs the helper's old
definition too (`helpers`). Some definitions were patched in place by a
later migration (`pg_get_functiondef` and replace) and have no verbatim copy
in any one migration. For those, save the live `pg_get_functiondef` text,
before the rewrite, as `apps/mobile/scripts/perf/groups/parity-definitions/<migration>.sql`
(named after the migration whose result it captures) and name it as
`parity-definitions/<migration>.sql`; it is never applied. The
`group_competition_week_summary` case also proves the helper itself: a
planted one-field change must be caught.

Internal helpers readers share (redaction, session counts) are compared the
same way in `HELPER_PARITY_CASES`, old against new, as the table owner, for
every argument row the fixture holds; a cache is compared with the live
function it caches. Before parity, after every measured call,
`PARITY_PLANT_STATEMENTS` plants retained CoW refs that redact through each
branch, un-shares the group's latest completed session, and leaves facts the
evaluator has not caught up with (a deleted set, a deleted exercise, a moved
set), so both kinds of case cover them.

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
the WAL position, sampled every 2 s. While pg_cron logs every run, every tick
writes WAL: `cron.log_run` is a server-start setting outside Supabase's
configurable Postgres settings.

## Reading a report

Each run writes `apps/mobile/artifacts/perf/groups/<run>/report.json` and
`summary.md`, and prints the summary. Compare counters, not durations; record
which `main` commit a baseline ran on, since a migration moves every number.
Rows and WAL repeat closely run to run; pages can move by a tenth as the
planner's statistics shift, so read a slope, not a single page count.
