---
task_id: M26-T03-Build_Train_surface_and_session_entry
milestone_id: "M26"
status: planned
ui_impact: "yes"
areas: "docs|frontend"
runtimes: "docs|node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/screen-map.md, docs/specs/ui/navigation-contract.md, docs/specs/ui/ux-rules.md"
---

# M26-T03 — Build Train and session entry

## Task metadata

- Status: `planned`
- Session interaction mode: `interactive`
- Parent milestone: `docs/plans/milestones/M26-four-tab-navigation.md`
- Depends on: M26-T01 and a stable planning materialization/management interface
- UI Impact: `yes`

## Context freshness at task start

- Run the task bootstrap helper and record branch/HEAD.
- Reread required specs and the recorder test README before edits.
- Confirm the planning milestone's shipped route and materialization API at
  task start; do not encode a guessed route from this card.
- Inventory current active-draft guard, session-recorder params, history-plan
  append behavior, and catalog picker return behavior.

## Objective

Make Train the single place to start or manage personal training while keeping
the recorder focused and preventing conflicting active sessions.

## Figma guidance

- [Primary prototype](https://www.figma.com/proto/mrItXBs0wGf0mHEJy8fPqQ/BOGA-%C2%B7-Scalable-navigation-proposals?node-id=0-1&p=f&t=semh9yQSkSY6O3h6-0&scaling=min-zoom&content-scaling=fixed&starting-point-node-id=8%3A737&show-proto-sidebar=1)
- [Active-session prototype](https://www.figma.com/proto/mrItXBs0wGf0mHEJy8fPqQ/BOGA-%C2%B7-Scalable-navigation-proposals?node-id=0-1&p=f&t=semh9yQSkSY6O3h6-0&scaling=min-zoom&content-scaling=fixed&starting-point-node-id=8%3A1044&show-proto-sidebar=1)
- Frames: `02 Train · Start`, `05 Session · Planned active`,
  `07 Session · Empty active`, `08 Train · Planning`.

## UX contract

### Start empty training

- Trigger: press `Start empty workout` with no active draft.
- Steps: create one empty draft through the existing recorder repository and
  open the focused recorder.
- Success outcome: recorder is ready for exercise selection; persistent tabs
  are hidden.
- Failure/edge outcome: creation failure is inline/retryable and no duplicate
  draft is persisted.

### Start planned training

- Trigger: press the next planned-session row.
- Steps: materialize the plan once, then open its active draft.
- Success outcome: prescribed rows and source semantics match the planning
  contract.
- Failure/edge outcome: missing/stale/already-used plan resolves safely and the
  user is not placed in an incorrect empty session.

### Manage planning or resume

- Trigger: choose Planning, or open Train with an active draft.
- Steps: navigate to the canonical planner; when a draft exists, show Resume
  instead of competing start actions.
- Success outcome: one clear action matches current state.
- Failure/edge outcome: planning unavailable/empty state still permits valid
  empty training and explains the limitation.

## Scope

- Train hub and Start/Planning state.
- Shared, idempotent start/resume guard used by Today and Train.
- Recorder navigation visibility and explicit return behavior.
- Planner entry adapter to the interface that actually ships.

Out of scope: planner data/schema/programme implementation or recorder redesign.

## Acceptance criteria

1. Empty and planned launch create at most one active session.
2. An active session replaces/guards all new-session actions with Resume.
3. Planned session materialization preserves existing planned/performed
   semantics and failure cleanup.
4. Planner entry uses the canonical planning route/API and has a useful empty
   or unavailable state.
5. Recorder hides persistent tabs while active and restores navigation on the
   defined exit/submit path.
6. Contextual exercise selection remains in the recorder; exercise-database
   administration is not moved into Train.
7. Happy paths plus duplicate/stale/failure paths have tests and captures.

## Implementation notes

- Prefer a shared `startOrResume` domain helper/hook over two screen-specific
  sequences.
- Preserve completed-edit and append-historical-block entry modes.
- Do not change sync cadence merely because the route or tab label changes.

## Verification

- Unit/integration: empty launch, planned launch, existing draft, stale plan,
  persistence failure, completed-edit compatibility.
- Maestro: Train -> empty recorder; Train -> planned recorder; Train -> planner;
  active Today/Train -> recorder -> submit/exit.
- Gates: `./boga test fast`, `./boga test frontend`, plus path-triggered lanes.

## Completion note

- What changed:
- What tests ran:
- Visual evidence:
- What remains:
