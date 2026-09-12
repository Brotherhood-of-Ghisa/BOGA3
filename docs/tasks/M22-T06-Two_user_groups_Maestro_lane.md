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

Gates ran on `efcf89a` (rebased on `origin/main` `366e4b8`), foreground, one at
a time, on this machine. Artifact roots are local, under `apps/mobile/artifacts/maestro/ad-hoc/`.

| Gate | Result | Evidence |
| --- | --- | --- |
| `./boga test ios-groups-e2e` run A | ✅ flow 53s | `apps/mobile/artifacts/maestro/ad-hoc/20260911-194701-34563/` |
| `./boga test ios-groups-e2e` run B (right after A, no Supabase reset) | ✅ flow 52s | `apps/mobile/artifacts/maestro/ad-hoc/20260911-194827-36774/`; its reset deleted run A's 1 group + 577 sync rows |
| `./boga test fast` | ✅ jest 122 suites / 1220 tests; meta-tests 5/5 | — |
| `./boga test handles` | ✅ 1220 tests | — |
| `./boga test backend` | ✅ every lane incl. `groups-contract`, `sync-drift --strict`, `mcp-smoke` | — |
| `./boga test ios-smoke` | ✅ | `apps/mobile/artifacts/maestro/ad-hoc/20260911-194142-25481/` |
| `./boga test ios-data-smoke` | ✅ first attempt | `apps/mobile/artifacts/maestro/ad-hoc/20260911-194224-27062/` |
| `./boga test ios-auth-profile` | ✅ | `apps/mobile/artifacts/maestro/ad-hoc/20260911-194340-29370/` |
| `./boga test ios-sync-e2e` | ✅ | `apps/mobile/artifacts/maestro/ad-hoc/20260911-194504-31766/` |

- **AC1 screenshots** (each run, `maestro-output/*/groups-two-user-stream/takeScreenshot/`):
  `groups-01-username-prompt`, `-02-group-created`, `-03-invite-code`,
  `-04-counterparty-joined`, `-05-training-now-card`,
  `-06-completed-edited-card`, `-07-friend-view-read-only`,
  `-08-counterparty-removed`, `-09-removed-member-not-found`. Step 9's
  assertion is the script's: `group_stream` → `HTTP 400 NOT_FOUND: group not
  found` (logged in `maestro-debug/**/maestro.log`).
- **AC2.** Runs A and B above passed back to back in slot 2; the baseline
  reported "reusing existing instance without reset" both times.
- **AC3.** `meta-tests` green; `maestro-fixture-users.test.sh` self-tests the
  counterparty rule on 5 synthetic trees, then checks the repo: 3 sign-in flows
  + 1 scripted counterparty, each on a unique fixture.
- **AC4, measured latency** (`GROUPS_E2E_LATENCY`: last `sync_push` returned →
  the card's wait succeeded after one pull-to-refresh; includes the 800 ms
  swipe and Maestro's polling). Observed, not promised:

  | Run | Active card | Completed + edited card |
  | --- | --- | --- |
  | A | 2114 ms | 1986 ms |
  | B | 1966 ms | 1973 ms |

- **AC5.** Maestro `runScript` HTTP worked; the split-flow fallback was not used.
- **Durations** (`./boga timings`, this machine): `ios-groups-e2e` median 1.4m
  over 4 green runs (1.4m–1.5m).
- **Triggers decision.** Added `supabase/migrations/*group*` and
  `apps/mobile/src/groups/**` → `ios-groups-e2e`, plus the fixture reset
  script. Group routes and components already require `frontend`, which now
  includes the lane. A group migration whose name lacks "group" would not match
  the glob; it still requires `backend`.

## Completion note

- What changed: fixtures `user_c`/`user_d`; `supabase/scripts/groups-fixture-reset.sh`;
  lane `ios-groups-e2e` (runner case, `lanes.tsv` row, npm `test:e2e:ios:groups`,
  env allowlist, and a flow copy that mirrors `.maestro/` so `runScript` paths
  resolve); flow `groups-two-user-stream.yaml` + `.maestro/scripts/groups-counterparty.js`;
  the fixture-user meta-test counts scripted counterparties; docs 02 (regenerated),
  06, 09, 11, README-maestro, AGENTS, `triggers.tsv`, groups-contract §8 as-built.
  No app code changed.
- What tests ran: see Evidence.
- What remains: review and merge; M22-T07 closeout.
