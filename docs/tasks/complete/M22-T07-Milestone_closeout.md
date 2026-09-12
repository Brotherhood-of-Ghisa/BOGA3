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

## Completion note

- What changed:
- What tests ran:
- What remains:
