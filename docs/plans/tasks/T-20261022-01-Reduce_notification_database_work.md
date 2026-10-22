# T-20261022-01 — Reduce repeated notification database work

- Status: `planned`
- Depends on: none
- Milestone: none
- Areas: backend, notification completion client if needed; UI impact: no

## Objective

Make notification processing proportional to new or unfinished work. Remove
repeated recovery, proof evaluation, writes and worker invocations for unchanged,
settled workouts while preserving the existing delivery and recovery contracts.
One implementation PR; no product change is requested.

## Review evidence

Read-only inspection on 22 October 2026 of hosted `BOGA_DEV`
(`onluhhnvvmknqzdxgntl`), with one active group and three current members:

| Measurement | Observed |
| --- | --- |
| Previous 24 hours: notification-worker calls | 408 |
| Same window: new notification intents | 8 |
| Same window: deliveries receiving provider tickets | 6 |
| Database / notification tables including indexes | 98 MB / 872 kB |
| Since statistics reset at 07:06 UTC: preparation calls | 173 |
| Preparation mean / total database execution | 1.48 seconds / 256.7 seconds |
| Notification workout / intent tuple updates since reset | 847 / 621 |
| Recent completed workouts at inspection | 2; both confirmed and enqueued |

The operator's 21 October Supabase email concerns **Disk I/O Budget**. These
measurements establish repeated work, not the exact cause or share of that
earlier spike: database counters reset afterward. Provider tickets do not prove
device display. Revalidate the implementation against current main; these
figures are a historical baseline, not acceptance thresholds or a free-tier
capacity guarantee. Review attribution: Codex, AI-assisted investigation.

## Load and inspect

Follow the always-load and area-specific instructions in `AGENTS.md`. For this
task, load `docs/product/notifications.md`,
`docs/specs/tech/notification-delivery-contract.md`,
`docs/specs/tech/groups-contract.md`,
`docs/specs/10-api-authn-authz-guidelines.md` and `supabase/README.md` before
designing the change. If adding operational columns or indexes, also load
`docs/specs/05-data-model.md`; if touching sync orchestration, load its server
contract and the sync test README. Before editing tests, read the owning test
directory's README when present and `docs/specs/writing-tests.md`.

Trace all callers and later migration replacements of:

- `notification_recover_workouts`, `notification_track_workout`,
  `notification_start_workout` and `notification_workout_prepare` in
  `supabase/migrations/20261014133141_notification_workout_events.sql`.
  Recovery currently revisits recent eligible workouts regardless of settled
  delivery, rechecks readiness, and writes timestamps or unchanged state.
- The captured-start and captured-time patches in
  `supabase/migrations/20261014222200_notification_captured_start_recovery.sql`
  and `supabase/migrations/20261014225007_notification_recovery_captured_time.sql`.
- `notification_on_workout_row`, `notification_confirm_completion` and
  `notification_kick_once` in the workout migration; `notification_sweep` in
  `supabase/migrations/20261014115352_notification_delivery.sql`.
  Intake kicks on ordinary row changes; confirmation kicks even for an
  unchanged proof; the sweep invokes the worker without a due-work check.
- The drain order in `supabase/functions/notification-worker/handler.ts`,
  completion polling in `apps/mobile/src/notifications/completion.ts`, and
  `supabase/migrations/20261016112720_notification_pending_completions.sql`.

## Scope and design

Use the existing tables, state machine and worker. Choose the smallest design
that makes unchanged work a true no-op, suppresses irrelevant kicks and lets a
cheap due-work decision avoid an unnecessary HTTP invocation. Add durable
invalidation only if needed to prove recovery and concurrency remain correct.
Apply SQL changes through a forward migration; do not edit applied migrations.

Distinguish **enqueued** from **settled**: pending installations, receipts,
retry availability, disabled sending, expired leases and source/context changes
can still require work. Treat an identical completion confirmation as a no-op
only when existing confirmation and recovery obligations are already satisfied.
Do not rely solely on a client-memory cache or the sending-enabled switch.

Out of scope: changing notification categories, recipients, achievement rules,
freshness, scoring or sync protocol; UI/native changes; new providers,
dependencies or an observability system; paid-plan changes; hosted migrations,
worker deployment, configuration changes or enabling real sends. Keep the
current backstop cadence unless a separate change is agreed with the operator.

## Deliverables and acceptance

1. **Idle work stops.** With unchanged, fully settled fixtures, repeated
   recovery/preparation passes do not update workout or intent tuples, rebuild
   readiness graphs/ranks, or enqueue evaluation. A sweep with no due delivery,
   recovery, receipt or maintenance work makes no worker HTTP request. Cheap
   checks and normal cron bookkeeping are allowed.
2. **Unchanged and irrelevant inputs stay cheap.** Repeated identical
   confirmations and writes unrelated to a deliverable group workout do not
   cause a full notification drain. A relevant new source or context change
   still invalidates or schedules the required work.
3. **Recovery remains durable and fair.** Missed intake, missed kicks, missing
   shares, captured starts recovered after completion, evaluator lag, changed
   proof/context and worker death still recover within the original deadline.
   Bounded recovery cannot starve later candidates or lose work racing an
   idle decision. Enqueued-but-unsent work remains recoverable.
4. **Delivery remains safe.** Preserve the accepted notification product facts,
   exact completion proof, live authorization and disclosure checks, account
   binding, generation/claim fencing, retry/backoff, uncertain-handoff policy,
   expiry and deduplication. Turning sending off must still permit due receipt
   processing, expiry handling and secret/payload pruning. Re-registration must
   not replay historical alerts.
5. **Regression proof measures operations.** Extend existing Jest and local
   Supabase tests for the changed behavior. Reuse
   `supabase/tests/notification-delivery.sh`,
   `supabase/tests/notification-workout-events.sh`,
   `supabase/functions/notification-worker/handler.test.ts` and the applicable
   notification Jest suites. Prove zero unchanged tuple writes using row
   versions or operation counters, not just equal returned values. Count heavy
   proof calls and HTTP kicks rather than asserting wall-clock speed.
6. **Show the reduction.** On the same local fixture with one group, three
   members, representative history and settled workouts, record before/after
   operation counts over repeated idle passes, plus a new-work/recovery case.
   Include SQL execution/buffer/WAL measurements where useful; distinguish
   cached buffer access from physical disk I/O. Put evidence in the PR, with no
   unmeasured timing estimates or claim that local results prove hosted I/O
   budget recovery.

## Specs to update

- When the operational behavior changes, update
  `docs/specs/tech/notification-delivery-contract.md` with the idle, invalidation
  and recovery guarantees. Keep durable rules out of this ephemeral card.
- If schema changes, update the relevant ownership/model contract; change the
  groups contract only if its evaluator boundary actually changes. No product
  fact changes are planned.

## Gates and handoff

The slower lanes are **proposed, not yet agreed**. At implementation start,
run `./boga test for` and agree the lane set with the operator before running
anything beyond `fast`:

- Always: `./boga test fast`, including added/updated Jest coverage.
- Proposed backend set: `./boga test backend` plus
  `./boga test groups-leaderboards`, which owns the workout-notification
  contracts. Add `groups-competitions` if comparison publication/scoring changes.
- If sync orchestration changes, propose `./boga test ios-sync-e2e` on macOS.
  No new Maestro flow is proposed; database invariants belong in local contracts.
- Before the implementation PR, agree and run the required quality targets:
  `./boga test jest-coverage`, `./boga test complexity`,
  `./boga test dependencies`. Meet existing thresholds and budgets.

Offer the repository task protocol in `docs/plans/README.md`: land this planning
card through a docs-only PR before implementation branches from main; execute
one task in its own leased worktree, review, then open the implementation PR.
Run the repository product review alongside code review and the applicable
security review; record gate agreement, results, evidence and skipped defaults
in the PR template. Delete this card in the implementing PR, stop its stack
after opening, and release the worktree after merge. Do not deploy or merge
without the operator's authorization.
