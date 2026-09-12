---
task_id: M22-T07-Milestone_closeout
milestone_id: "M22"
status: completed
ui_impact: "no"
areas: "docs"
runtimes: "docs"
gates_fast: "./boga test fast; ./boga test handles"
gates_slow: "./boga test backend; ./boga test frontend"
docs_touched: "docs/specs/00-product.md, docs/specs/03-technical-architecture.md, docs/specs/05-data-model.md, docs/specs/10-api-authn-authz-guidelines.md, docs/specs/tech/groups-contract.md, docs/specs/milestones/**, docs/specs/README.md"
---

# M22-T07 — Milestone closeout

## Task metadata

- Task ID: `M22-T07-Milestone_closeout`
- Status: `completed` (on merge; filed in `complete/` with the milestone archive)
- Depends on: `M22-T01` … `M22-T06` merged

## Parent references (required)

- Milestone spec: `docs/specs/milestones/archive/M22-groups-and-foundations.md`
- Contract: `docs/specs/tech/groups-contract.md`
- Milestone archive rule: `docs/specs/milestones/README.md`

## Objective

Verify every acceptance criterion on merged `main`, make the specs "true now",
and archive the milestone.

## Scope / acceptance criteria

1. **A full gate run on `main`** at the closeout commit, recorded:
   `./boga test fast`, `./boga test handles`, `./boga test backend`, and
   `./boga test frontend` (which includes `ios-sync-e2e` and
   `ios-groups-e2e`). Report `./boga timings`.
2. **Acceptance matrix.** Map AC1–AC15 to the test or evidence that proves
   each, in the milestone completion note. Any gap becomes a follow-up card,
   not a silent pass.
3. **Specs:**
   - `00-product.md` gains the group product decisions (2, 4, 5, 9–11, 13,
     15–20, C7);
   - `03` flips the group-record decision from `Planned` to `Adopted`, with
     as-built sources;
   - `05` and `10` drop the "planned" wording;
   - `groups-contract.md` status becomes as-built;
   - no remaining "planned" text contradicts the code.
4. **Archive.** `git mv` the M22 spec and the outdated M18 spec to
   `docs/specs/milestones/archive/`, then update `docs/specs/README.md` and the
   inbound links. `docs-check` must be green.
5. **Tasks.** Move the M22 task cards to `docs/tasks/complete/`, and the M18
   cards T03–T15 to `docs/tasks/complete/` with status `outdated`.
6. **Brainstorm.** Set the brainstorm's status to "adopted — M22 shipped;
   phases 2–5 pending".

## Evidence

Every gate ran on `c9121e7`, directly on top of `origin/main` `27c2c7e` (T06
merged). They ran in the foreground, one at a time, in slot 4 on this machine.
The commit that follows adds only this evidence text and the milestone
completion note (docs only), and `docs-check` was re-run on it. Artifact roots
are local, under `apps/mobile/artifacts/maestro/ad-hoc/`.

| Gate | Result | Evidence |
| --- | --- | --- |
| `./boga test fast` | ✅ jest 122 suites / 1220 tests; lint, typecheck, docs-check, meta-tests, backend-fast, agent-auth-web, and mcp-unit all exit 0 | timing records `docs/testing/timings/records/*slot4*` |
| `./boga test handles` | ✅ 1220 tests, no open handles | — |
| `./boga test backend` | ✅ exit 0, including `groups-contract` PASS (trigger failure isolation `ok`), sync-v2 e2e 10/10, `sync-drift`, `mcp-smoke` | — |
| `./boga test ios-smoke` | ✅ | `20260912-155047-69632/` |
| `./boga test ios-data-smoke` | ✅ first attempt | `20260912-155145-71042/` |
| `./boga test ios-auth-profile` | ✅ | `20260912-155309-73437/` |
| `./boga test ios-sync-e2e` | ✅ | `20260912-155429-75414/` |
| `./boga test ios-groups-e2e` | ✅ | `20260912-155704-78681/`; `GROUPS_E2E_LATENCY` active 2122 ms, completed-edited 2013 ms (observed) |

- **Timings** (`./boga timings`, median, this machine): ios-smoke 58s,
  ios-data-smoke 1.1m, ios-auth-profile 1.3m, ios-sync-e2e 2.3m,
  ios-groups-e2e 1.5m, handles 51s, groups-contract 17s, backend-fast 44s.
- **`./boga test for --diff origin/main`** requires only `docs-check`, since
  this is a docs-only diff. The full run above is this card's AC1.
- **Acceptance matrix**: the completion note of
  `docs/specs/milestones/archive/M22-groups-and-foundations.md`. One gap:
  AC13 on mobile, filed as
  `docs/tasks/T-20260912-01-Groups_mobile_sync_isolation_test.md`.

## Completion note

- What changed:
  - Specs: `00-product` (group decisions); `03` (both group rows `Adopted`,
    with as-built sources); `10`, `tech/README`, and `groups-contract` (status
    as-built; product ownership moves to `00`); `06` (the `groups-contract`
    lane description now covers the record half); `README` and the `AGENTS`
    routing row.
  - Archive: the M22 and M18 specs moved to `milestones/archive/`.
  - Task cards: M22 T01–T07 and M18 T03–T15 (`outdated`) moved to
    `docs/tasks/complete/`.
  - The brainstorm is marked adopted.
  - `05` needed no edit: its group section was already as-built.
- What tests ran: see Evidence.
- What remains: `T-20260912-01` (the mobile AC13 proof).
