---
task_id: M23-T05-Mobile_training_programmes
milestone_id: "M23"
status: planned
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/08-ux-delivery-standard.md, docs/specs/ui/screen-map.md, docs/specs/ui/navigation-contract.md, docs/specs/ui/components-catalog.md, docs/specs/ui/ux-rules.md, docs/specs/tech/session-planning-contract.md"
---

# M23-T05 — Mobile training programmes

## Task metadata

- Task ID: `M23-T05-Mobile_training_programmes`
- Status: `planned`
- Depends on: `M23-T03`
- Parallel with: `M23-T04`

## Parent references (required)

- Milestone: `docs/plans/milestones/M23-session-planning-and-programmes.md`
- **Contract:** `docs/specs/tech/session-planning-contract.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs: `docs/specs/ui/README.md`
- Testing: `docs/specs/02-quality-and-test-gates.md`,
  `docs/specs/06-testing-strategy.md`

## Objective

Let a person create and maintain an ordered multi-session programme—including a
programme they call a wave—without introducing recurrence or automatic
progression semantics.

## Scope

### In scope

- Add `/programme/new` and `/programme/[programmeId]`, including stack
  registration, params, titles, transitions, and deep-link-safe not-found
  behavior.
- Programme name and optional description.
- Add, duplicate, remove, and reorder two or more complete session plans;
  editing a child reuses the one-off plan fields/components.
- Per-child optional schedule and gym; order remains independent of date.
- Transactional Save, edit, and contract-defined programme deletion behavior,
  including the case where a child plan has already started.
- Programme summary/progress in `/sessions` and navigation to programme and
  child-plan detail.
- Offline-first authoring and later sync with no server-only draft state.

### Out of scope

Recurring schedules, week/calendar grids, auto-generated dates, automatic load
or rep progression, adherence analytics, reminders, shared programmes,
programme templates, and any special hard-coded "wave" formula.

## UX Contract

### Key user flows

1. **Create a programme**
   - Trigger: tap New programme from Sessions.
   - Steps: name it, optionally describe it, add at least two sessions, edit
     each session's schedule/gym/targets, reorder, and Save.
   - Success outcome: one programme and all child plans appear immediately and
     atomically, including offline.
   - Failure/edge outcome: errors point to the affected session/exercise/set;
     no partial programme is persisted.
2. **Maintain a programme**
   - Trigger: open programme detail.
   - Steps: edit metadata, add/duplicate/remove/reorder unstarted children, or
     open a child plan.
   - Success outcome: stable programme order and child state across reload and
     sync.
   - Failure/edge outcome: concurrent started/deleted child state is refreshed
     and preserved rather than overwritten.
3. **Progress through a programme**
   - Trigger: start one child through its plan detail.
   - Success outcome: that child becomes started/read-only while remaining
     children are unchanged; the programme summary reflects progress.
   - Failure/edge outcome: the normal active-session conflict routes to Resume.

### Interaction + appearance notes

- Reuse the one-off planner's form, exercise/set editor, validation, schedule,
  gym, list-row, button, dialog, and status primitives.
- Reorder controls must be accessible without requiring drag gestures; drag
  may be an enhancement only if Move up/down actions remain available.
- Show sequence clearly without implying dates for unscheduled sessions.
- A "wave" is ordinary user-entered programme text, never a special badge or
  computation.
- Keep nested editing comprehensible on small screens and under dynamic type;
  avoid rendering every child session as one unbounded mega-form.

## Acceptance criteria

1. Create requires valid metadata and at least two individually valid session
   plans; failure writes nothing.
2. Add, duplicate, remove, and accessible reorder preserve stable unique order
   indexes across reload, sync, and concurrent refresh.
3. Each child preserves its independent scheduled/unscheduled state, gym,
   exercises, snapshots, targets, lifecycle, and provenance.
4. Starting one child uses the T03 materializer exactly once and never changes
   another child. Started children cannot be edited through programme screens.
5. Programme edit/delete follows the T01 lifecycle contract when some children
   are started and never removes performed workout history.
6. Offline create/edit works through the same local repository and normal sync
   affordances as one-off plans.
7. RNTL/Jest covers success, validation, atomic failure, reorder, started-child,
   concurrent refresh, empty/loading/error, and active-conflict states.
8. Tokens/primitives/shared components are reused, no raw screen color is
   introduced, UI docs are current, and required visual evidence is captured.

## Docs touched (required)

- UI docs update required: **yes**.
  - `docs/specs/ui/screen-map.md`: programme create/detail and Sessions entry.
  - `docs/specs/ui/navigation-contract.md`: routes, params, child transitions,
    and recorder transition.
  - `docs/specs/ui/components-catalog.md`: programme list/editor components.
  - `docs/specs/ui/ux-rules.md`: ordering, nested validation, started children,
    and accessible reorder.
- `docs/specs/08-ux-delivery-standard.md`: update only if a reusable multi-item
  editor or reorder pattern is established.
- `docs/specs/tech/session-planning-contract.md`: mobile programme as-built
  pointers and deviations.
- Tokens/primitives reuse: T04 planner primitives plus existing list/action and
  confirmation patterns; exceptions none planned.
- Screenshots required: create with two sessions; validation in a child;
  populated detail; reorder controls; mixed started/upcoming state; delete
  confirmation; small-phone and dynamic-type layouts.

## Testing and verification approach

- Add focused component/route tests and extend planning Maestro coverage owned
  by T07.
- Before PR: `./boga test fast` and `./boga test frontend`.
- Run `./boga test for --diff origin/main`; report measured timings only from
  `./boga timings`.

## Evidence

## Completion note

- What changed:
- What tests ran:
- What remains:
