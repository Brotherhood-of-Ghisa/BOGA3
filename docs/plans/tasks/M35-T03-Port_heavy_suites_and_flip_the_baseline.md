# M35-T03-Port_heavy_suites_and_flip_the_baseline — Port the heavy suites and flip the baseline

- Status: `planned`
- Depends on: `M35-T02-Port_light_suites_to_V4`
- Milestone: `docs/plans/milestones/M35-retire-pre-v4-group-competitions.md`
- Areas: backend tests + test infrastructure; UI impact: no

## Objective

Every local gate runs on a V4-active stack, as production does, and every
groups test asserts V4 behaviour. No server code changes in this task.

## Scope

- In:
  - Port `groups-boards.sh` (map §6: nearly a full rewrite, 153 ports),
    `groups-certification.sh` and `groups-bodyweight.sh` (map §7).
  - Activate after reset and seed in the local baseline.
  - Retire T02's interim activation step, the reset rule and the wrappers.
  - Shrink groups-protocol4 to the cutover chapters.
- Out: migrations and server functions (T04); app code (T05).

## Decided

- M35 D4, D5. The T01 doc (`docs/plans/M35-pre-v4-inventory-and-test-map.md`)
  is the authority for every keep, port and delete; the operator approved
  every delete (O1).
- Map facts that drive the boards and certification ports:
  - Active comparisons are never legacy, so the direct
    `group_eval_apply_legacy` calls (`groups-boards.sh:819, 869`) test
    unreachable code.
  - The lock check at `groups-boards.sh:1137` becomes a check on
    `group_metric_eval_publish`.
  - Metrics are volume and e1rm only, so four fixtures need re-picking
    (`groups-boards.sh:384, 400, 818, 1054`).
  - The certification-suite helpers (`centry`, `csince`, `cert_col`,
    `active_certs`) must read the V4 `group_metric_*` tables.
- The baseline full path activates after seeding, and the activation state
  joins the baseline stamp's state hash
  (`supabase/scripts/ensure-local-runtime-baseline.sh`).
- `sync-drift` resets the stack itself (`reset-local.sh`), which leaves it
  pending. The active state must survive it: either activation moves into
  `reset-local.sh`, or the next preflight re-activates.
- `stack_reset_reason` stops treating "protocol 4 active" as a reset reason;
  the one-way marker stays for the old-migration reset.
- `ios-groups-e2e` (`apps/mobile/scripts/maestro-run-lane.sh`) and
  `groups-competition-live.sh` stop wrapping in
  `with-local-group-competitions.sh`. Update what pins the wrapper too:
  `apps/mobile/__tests__/groups-runtime-fixture.test.ts`,
  `apps/mobile/README-maestro.md`, `scripts/triggers.tsv`. Drop the "groups
  gates expect it pending" note in `ensure-dev-baseline.sh`.
- groups-protocol4 shrinks to the cutover chapters (map §8.1 B, C, D, K and
  the cutover rows of A and E). It retires in T04.

## Deliverables and acceptance

1. `boga test backend` green on an active baseline.
2. No default-lane assertion calls a pre-V4 RPC.
3. Before/after timings for every changed lane (`./boga timings`).

## Specs to update

- `docs/specs/02-quality-and-test-gates.md`, `docs/specs/06-testing-strategy.md`:
  the lane matrix and the groups-protocol4 description.
- `docs/specs/01-worktree-and-environment.md` /
  `docs/specs/12-worktree-config-and-isolation.md`, if they describe the reset rule.

## Gates

`fast` + `backend` + `groups-protocol4` + `ios-groups-e2e` + the three quality
targets; confirm with `./boga test for`.
