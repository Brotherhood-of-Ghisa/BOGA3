# Rule upgrade

Load when a change alters a figure the app or server stores or publishes (a
calculation, eligibility or record rule), or the sync protocol.

## Bump

- Personal stored figures (session facts, PR flags):
  `EXERCISE_SESSION_FACTS_RULES_VERSION`. One rebuild per device on first read.
- Group set facts (`apps/mobile/src/groups/set-facts.ts` or the kernel it
  calls): `GROUP_EVAL_RULES_VERSION`. Ships with `group-eval`.
- Group comparisons and competition boards: not stamped by the rules version.
  Add a migration that enqueues a `rules` evaluation of every live comparison
  (pattern: `supabase/migrations/20261004204709_group_certification_observations.sql`).
- Coaching figures: `METRIC_REVISION` in
  `supabase/functions/agent-api/training-metrics.ts`, and its pins
  (`git grep` the old value).
- Re-check `main` right before merge: two PRs have claimed the same revision.
- Forward-only (no bump) is the operator's call, never the default.

## Roll out

- Order: migrations → `group-eval` and `agent-api` redeployed in the same
  sitting → app release. A stale `group-eval` against newer SQL failed group
  jobs for ~21 h (#507).
- Exception: a migration that only enqueues recomputes goes after the new
  `group-eval` is live, or the old function does the work with the old rule.
- Verify each deployed function's files byte-match the merge commit, and
  record every hosted migration in `supabase_migrations.schema_migrations`.
- Every environment: hosted, BOGA-dev, dev-lan. Skipped activation and kick
  config left dev-lan groups returning `UPDATE_REQUIRED` (#544).
- Hosted steps: `docs/runbook-hosted-operations.md`.

## Sync protocol

- The server accepts exactly one protocol version: whichever of app or
  backend ships first, the other stops syncing (#370, #408, #518).
- Plan it as a cutover with the operator; allow for TestFlight review lag.
  Contract: `docs/specs/tech/sync-v2-server-contract.md`.

## Verify

- `group_eval_queue` and `group_metric_eval_queue` drain to empty; no
  parked jobs.
- `agent-api` returns the new `metric_revision`.
- On a device: history, records and PR markers show the new figures.

## Local gates

- Never stop a Supabase lane mid-run and then `./boga db down`: the backup
  saves a half-reset database. Fix:
  `bash -lc 'source supabase/scripts/_common.sh && run_supabase stop --no-backup'`.
