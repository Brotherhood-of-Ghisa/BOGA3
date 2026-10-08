# M35-T06-Hosted_rollout — Hosted rollout

- Status: `planned`
- Depends on: `M35-T04-Remove_pre_V4_server_code`
- Milestone: `docs/plans/milestones/M35-retire-pre-v4-group-competitions.md`
- Areas: backend (hosted); UI impact: no

## Objective

Apply T04's migration and group-eval to the hosted project with the
operator's explicit authority, and verify V4 is unchanged for users.

## Scope

- In: BOGA_DEV (`onluhhnvvmknqzdxgntl`), the only hosted project and the
  one production serves; migration apply (record the `schema_migrations`
  version), group-eval redeploy, verification.
- Out: app release (T05 ships in the normal release train).

## Decided

- No hosted change without the operator's explicit go
  (group-competition contract §5).
- Hosted is behind `origin/main` as of 2026-10-07: the latest applied
  migration is `20261006220000`, and
  `20261007120000_group_eval_rules_drain.sql` is not applied. Apply the
  migrations in order; T04's migration lands after it.
- T02 added a production bug fix,
  `20261007180000_group_metric_publish_large_reps.sql`: a set above int4 reps
  parked its comparison's publication. If the operator has not applied it on
  hosted already, apply it in order here, before T04's.
- Repair forward on failure; never restore pre-V4 readers.
- T04's migration (`20261008120000_group_competition_v4_only.sql`) raises if
  the database is pending and holds groups (hosted is active), and drops
  `group_competition_activation`: run the "activation set" check before it.
  Redeploy group-eval with it; T04 removed the protocol-3 dispatch.

## Open — resolve with the user at session start

- Hosted access path. The Supabase MCP was authorised for BOGA_DEV in
  the T01 session; re-confirm.

## Deliverables and acceptance

1. Pre-deploy: re-run the T01 doc's hosted checks
   (`docs/plans/M35-pre-v4-inventory-and-test-map.md` §1): activation set,
   both queues empty, no legacy exercise, no pre-V4 RPC call since the last
   check.
2. Post-deploy: no pre-V4 function in the catalog; queues drain; a current
   build shows boards, stream and week summary for a two-member group;
   advisors show no new findings.
3. Evidence in the PR body (docs-only PR deleting the milestone).

## Gates

`fast` (docs-check) for the closing PR.
