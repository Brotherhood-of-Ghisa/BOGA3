# Exercise session facts contract

> **Owns:** the local-only, derived `exercise_session_facts*` tables: grain, bucket,
> record-reading order, staleness triggers and the rules version.
> **Not here:** the metric rules the flags encode (`training-metrics-contract.md`),
> the table scope classification (`../05-data-model.md`). **Load when:** changing
> those tables, their triggers, or any rule that feeds them.

## Rules

One row per completed, non-deleted session and linked exercise definition with
at least one working- or volume-included set, holding that session's bests and
its personal-record flags (`apps/mobile/src/data/schema/exercise-session-facts.ts`;
rebuild, drain and reads in `apps/mobile/src/data/exercise-session-facts.ts`).
Eligibility, 1RM and the record rules the flags encode are
[`training-metrics-contract.md`](training-metrics-contract.md) §1–§3.
Each device derives its own rows, so devices on different rules versions never
mix values.

- **Grain.** Repeated blocks of one definition in a session fold into one row;
  unlinked legacy session exercises, active sessions and deleted sessions have
  none. A row with zero working sets may still hold a Volume record;
  `volume_kg` is the training-metrics §4 Volume, null only when its sum is
  not finite.
- **Bucket.** `pr_*` flag records against the whole exercise; `own_pr_*`
  against `gym_bucket`, the session's own book (training-metrics §3).
- **Records are always read from strictly earlier sessions** — those before the
  viewed session's `completed_at`, or before now while it is active — so a
  session never counts toward its own markers and later sessions never count.
  Every reader obeys this, so an old session's live marker matches its stored
  `pr_e1rm` / `pr_weight` flags; without an earlier record there is no marker.
- **Staleness.** SQLite triggers on the raw tables and on the policy inputs
  (load mode, contribution, the bodyweight toggle, readings, the split flag, a
  session's gym) queue affected definition ids in
  `exercise_session_facts_stale` whatever path wrote the row,
  sync pull-apply and imports included; writes inside an active session queue
  nothing, and completing it queues its definitions. Every facts read drains
  the queue first in one transaction, rebuilding each queued definition's whole
  history, so no read returns stale rows. `exercise_session_facts_state` holds
  the rules version and effort-policy key the table was fully built under; a
  missing row, another version, or a different active-account policy forces a
  full rebuild.
- **Changing any rule that feeds the derivation — including one in the shared
  calculation kernel or the working-set rule (`isWorkingSet`) — must bump
  `EXERCISE_SESSION_FACTS_RULES_VERSION`**, or rows built under the old rule
  survive the change. A Jest fixture pins the current version's values and
  fails when a rule moves under it.
- **Oracle.** A full rebuild from the raw rows is the truth; Jest asserts the
  incremental drain equals it after each kind of write.
