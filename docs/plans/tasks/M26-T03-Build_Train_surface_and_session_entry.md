---
task_id: M26-T03-Build_Train_surface_and_session_entry
milestone_id: "M26"
status: completed
ui_impact: "yes"
areas: "docs|frontend"
runtimes: "docs|node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/screen-map.md, docs/specs/ui/navigation-contract.md, docs/specs/ui/ux-rules.md"
---

# M26-T03 — Build Train and session entry

## Task metadata

- Status: `completed`
- Session interaction mode: `interactive`
- Parent milestone: `docs/plans/milestones/M26-four-tab-navigation.md`
- Depends on: M26-T01; M23 replaces the approved placeholder through the typed
  planning seam when its stable materialization/management interface ships
- UI Impact: `yes`

## Context freshness at task start

- Branch: `m26-option-c-navigation`; starting HEAD: `157a6e71`.
- Required project, UI, design-policy, gate, architecture, and structure specs
  were reread before implementation.
- The planning milestone has not shipped a route, read model, or
  materialization API. Train therefore exposes a typed integration seam and an
  honest unavailable state; it does not encode a guessed planner route or
  synthesize plan data.
- Existing active-draft discovery, recorder persistence, recorder route
  parameters, completed-edit behavior, and catalog return behavior were
  inventoried before the shared entry coordinator was added.

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

### Planned training before M23

- Trigger: review Train before the planning dependency ships.
- Steps: use empty training now or review the planning placeholder.
- Success outcome: Train reads `Watch this space 👀`, keeps empty start
  functional, and exposes no dead plan-management control.
- Failure/edge outcome: no plan or route is guessed; the typed ready-state path
  remains available for M23's future materializer.

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

1. Empty and future planned launch create at most one active session.
2. An active session replaces/guards all new-session actions with Resume.
3. Future planned session materialization is accepted only through the typed
   coordinator seam; M26 does not synthesize it.
4. Before M23, planning has the approved useful unavailable placeholder and no
   dead or guessed management route.
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

## Docs touched

- UI docs update required?: yes — `docs/specs/ui/screen-map.md`,
  `navigation-contract.md`, and `ux-rules.md` describe Train ownership,
  guarded entry, focused recorder behavior, and the approved placeholder.
- Tokens/primitives compliance statement: reused existing UI tokens, buttons,
  surfaces, text, recorder repository, and session-list primitives; no raw
  color exception.
- UI artifacts/screenshots expectation: required standard and 375 pt Train and
  recorder captures are recorded by M26 verification.

## Verification

- Unit/integration: empty launch, typed planned-launch seam, existing draft,
  unavailable placeholder,
  persistence failure, completed-edit compatibility.
- Maestro: Train -> empty recorder; active Today/Train -> recorder -> submit/exit;
  visual coverage for the planning placeholder.
- Gates: `./boga test fast`, `./boga test frontend`, plus path-triggered lanes.

## Completion note

- What changed: Train now has real loading/error, empty-start, active-resume,
  and typed planning states. Today and Train share one serializing
  active-draft recheck before empty or planned materialization, and the default
  empty path persists through the existing recorder repository.
- What tests ran: UI guardrails and mobile typecheck; 20 focused
  coordinator/Train/Today tests; `./boga test fast` (141 mobile suites / 1,458
  tests plus backend-fast, docs/meta, auth-web, and MCP lanes); and
  `./boga test frontend` (iOS smoke, data smoke, auth/profile, sync round trip,
  two-user group stream, and group exercise linking) are green.
- Visual evidence: standard Train start, recorder, and active-resume captures
  are under
  `apps/mobile/artifacts/maestro/M26-T03-visual/20260916-141511-34834/`;
  corresponding 375 pt captures are under
  `apps/mobile/artifacts/maestro/M26-T03-visual-small/20260916-142040-37748/`.
- Manual verification summary (required when CI is absent/partial): inspected
  standard and 375 pt Train/recorder captures; empty start remains usable and
  the recorder has no persistent tabs.
- What remains: M23 must provide the canonical plan query, materializer, and
  management route before planned-start/management production wiring can be
  completed. The user approved the `Watch this space 👀` placeholder as the
  honest interim state, so it does not block the four-tab cutover.
