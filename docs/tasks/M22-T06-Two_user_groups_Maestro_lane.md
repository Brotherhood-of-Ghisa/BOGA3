---
task_id: M22-T06-Two_user_groups_Maestro_lane
milestone_id: "M22"
status: in_progress
ui_impact: "no"
areas: "cross-stack"
runtimes: "maestro|supabase|node"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend; ./boga test ios-groups-e2e; ./boga test backend"
docs_touched: "docs/specs/06-testing-strategy.md, docs/specs/02-quality-and-test-gates.md, docs/specs/11-maestro-runtime-and-testing-conventions.md, scripts/lanes.tsv, docs/specs/tech/groups-contract.md"
---

# M22-T06 — Two-user groups end-to-end Maestro lane

## Task metadata

- Task ID: `M22-T06-Two_user_groups_Maestro_lane`
- Status: `in_progress`
- Depends on: `M22-T02`, `M22-T04`, `M22-T05`

## Parent references (required)

- Milestone spec: `docs/specs/milestones/M22-groups-and-foundations.md` (AC15)
- **Contract:** `docs/specs/tech/groups-contract.md` §8, the Maestro lane
  bullet
- Maestro contract: `docs/specs/11-maestro-runtime-and-testing-conventions.md`
  (fixture users, one per flow; lane config isolation); runbook
  `apps/mobile/README-maestro.md`
- Testing: `docs/specs/06-testing-strategy.md`,
  `docs/specs/02-quality-and-test-gates.md`

## Objective

Prove the milestone end to end on a real simulator against local Supabase,
with two users. The device user is `user_c`. `user_d` is a scripted
counterparty that joins, trains, edits, and is removed.

## Scope

### In scope

- **Fixture users** `user_c` and `user_d` in
  `supabase/scripts/auth-fixture-constants.sh`, provisioned by the baseline.
- **Lane `ios-groups-e2e`** in `apps/mobile/scripts/maestro-run-lane.sh`:
  - Supabase-configured, `full` reset, `user_c`;
  - exports `user_d` credentials and the Supabase URL/key into the flow;
  - a pre-run cleanup that hard-deletes all group rows of `user_c`/`user_d`
    with the service role (a new `supabase/scripts/groups-fixture-reset.sh`);
  - a `scripts/lanes.tsv` row (gate `slow-frontend`, infra `ios+supabase`),
    placed after `ios-sync-e2e`;
  - `./boga docs gen`.
- **Flow** `apps/mobile/.maestro/flows/groups-two-user-stream.yaml`, with
  `runScript` helpers under `apps/mobile/.maestro/scripts/` (GoTrue password
  sign-in, `group_join`, `sync_push` of a session graph, `group_stream`
  assertion).
- **The fixture-user meta-test**
  (`scripts/tests/maestro-fixture-users.test.sh`) is extended so that scripted
  counterparties count as dedicated fixtures.

### Out of scope

Offline toggling in the simulator; offline is proven in jest in `T03`–`T05`.

## Acceptance criteria

1. **The flow covers**, with screenshots at each step:
   1. the username prompt;
   2. creating a group;
   3. reading `group-invite-code`;
   4. the counterparty joining, and the device showing "joined" after a
      refresh;
   5. the counterparty pushing an active session, and the device showing one
      "Training now" card with its sets, kg, and exercises;
   6. the counterparty completing and then editing the session, and the same
      card showing completed, with its duration and the updated metrics;
   7. opening the friend view, with no owner actions;
   8. the device removing the counterparty and seeing "was removed";
   9. the script asserting the counterparty's `group_stream` is `NOT_FOUND`.

   This covers AC1, AC2, AC3, AC5, AC6, AC8, and AC11 end to end.
2. **Stability.** The lane passes twice in a row in one slot without a
   Supabase reset (hermetic via the cleanup).
3. **Meta-test.** `meta-tests` is green, including the fixture-user rule.
4. **Measured latency.** The measured time from the counterparty's `sync_push`
   to the card appearing after one refresh is recorded in the Evidence as
   observed data, not a promise.
5. **Fallback.** If Maestro `runScript` HTTP proves unworkable, split the flow
   into two halves with a lane-runner shell step between them, and record the
   deviation.

## Docs touched (required)

- `docs/specs/06-testing-strategy.md`: add the lane catalog row for
  `ios-groups-e2e` and a two-user e2e policy (a new test layer, per the
  milestone template rule).
- `docs/specs/11-maestro-runtime-and-testing-conventions.md`: add
  `user_c`/`user_d` to the fixture mapping and document the scripted
  counterparty pattern.
- `docs/specs/02-quality-and-test-gates.md`: regenerate the matrix; update the
  `boga test frontend` description.
- `scripts/triggers.tsv`: consider routing `supabase/migrations/**` group
  changes to this lane. This is a judgment call — record the decision.
- `docs/specs/tech/groups-contract.md` §8: add an **As-built** note.

## Testing and verification approach

- **Run** `./boga test ios-groups-e2e` twice, then `./boga test frontend`,
  `./boga test fast`, and `./boga test backend` (the fixture change touches
  `supabase/scripts/**`).
- **Evidence:** the artifact roots and `./boga timings`.

## Evidence

## Completion note

- What changed:
- What tests ran:
- What remains:
