# M35-T05-Hosted_rollout — Hosted rollout

- Status: `planned`
- Depends on: `M35-T03-Remove_pre_V4_server_code`
- Milestone: `docs/plans/milestones/M35-retire-pre-v4-group-competitions.md`
- Areas: backend (hosted); UI impact: no

## Objective

Apply T03's migration and group-eval to the hosted projects with the
operator's explicit authority, and verify V4 is unchanged for users.

## Scope

- In: BOGA_DEV then production; migration apply (record the
  `schema_migrations` version), group-eval redeploy, verification.
- Out: app release (T04 ships in the normal release train).

## Decided

- No hosted change without the operator's explicit go for each project
  (group-competition contract §5).
- Repair forward on failure; never restore pre-V4 readers.

## Open — resolve with the user at session start

- Hosted access path (Supabase MCP authorised, or operator-run).

## Deliverables and acceptance

1. Pre-deploy: T01's hosted evidence re-checked (no protocol-3 work queued).
2. Post-deploy: no pre-V4 function in the catalog; queues drain; a current
   build shows boards, stream and week summary for a two-member group;
   advisors show no new findings.
3. Evidence in the PR body (docs-only PR deleting the milestone).

## Gates

`fast` (docs-check) for the closing PR.
