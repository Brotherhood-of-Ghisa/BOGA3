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
- Depends on: `M23-T04`

## Parent references (required)

- Milestone: `docs/plans/milestones/M23-session-planning-and-programmes.md`
- **Contract:** `docs/specs/tech/session-planning-contract.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs: `docs/specs/ui/README.md`
- Testing: `docs/specs/02-quality-and-test-gates.md`,
  `docs/specs/06-testing-strategy.md`

## Objective

Let a person create and maintain an ordered multi-session programme—including a
programme they call a wave—and pull its next exercise block into an otherwise
freeform session. Progress follows explicit block completion/skip, without
introducing recurrence or automatic load/rep progression semantics.

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
  including partially consumed child plans.
- Programme summary/progress in `/sessions`, deterministic next unresolved
  block in programme-order then exercise-order, available-block selection, and
  navigation to programme and child-plan detail.
- Add one block to an active/new session, Complete after valid confirmed work,
  or explicitly Skip without performed work. Pulling alone never advances.
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
   - Steps: edit metadata, add/duplicate/remove/reorder eligible future
     children/blocks, or open a child plan.
   - Success outcome: stable programme order and child state across reload and
     sync.
   - Failure/edge outcome: concurrent attached/resolved/deleted block state is
     refreshed and preserved rather than overwritten.
3. **Use the next programme block in a freeform session**
   - Trigger: from programme detail or the recorder's From planner picker, tap
     Add to session on the next squat block.
   - Steps: attach to a selected or unambiguous compatible squat card in the
     active session (or create one), keep or add manual warm-ups on that card,
     reorder them around the source-derived target sets as needed, freely log
     unrelated exercises, and explicitly Complete block.
   - Success outcome: the recorder stays open, freeform work is unchanged, the
     card and planned sets retain their source identities, the completed block
     links to the session, and the programme exposes the next unresolved block.
   - Failure/edge outcome: attachment alone remains current; completion without
     a valid confirmed source-derived set is refused; multiple compatible cards
     require a choice; retry never creates a second live use.
4. **Skip rather than claim performance**
   - Trigger: choose Skip on an available block from programme detail.
   - Success outcome: progress advances with an explicit skipped state and no
     performed session/exercise/set row.
   - Failure/edge outcome: an already attached/resolved block cannot be skipped
     through stale UI and refreshes to its current state.

### Interaction + appearance notes

- Reuse the one-off planner's form, exercise/set editor, validation, schedule,
  gym, list-row, button, dialog, and status primitives.
- Reorder interactions use the lightweight playlist pattern established by
  T04: a subtle grab handle is the only persistent reorder chrome, with no
  separate reorder mode or permanent up/down buttons. Equivalent Move earlier/
  Move later accessibility actions remain available.
- The same accessible ordering pattern applies inside recorder exercise cards.
  Programme/session reordering and performed-set reordering are distinct: the
  latter changes only performed `exercise_sets.order_index` and never the
  programme, source block, source target, or source-plan order.
- Show sequence clearly without implying dates for unscheduled sessions.
- A "wave" is ordinary user-entered programme text, never a special badge or
  computation.
- Show pending/attached/completed/skipped with text and accessibility semantics;
  attachment and completion must not be represented by color alone.
- V1 presents one ordered block stream and does not infer independent tracks
  from exercise names. A squat-only wave naturally exposes the next squat
  block; another available block can still be selected explicitly.
- Keep nested editing comprehensible on small screens and under dynamic type;
  avoid rendering every child session as one unbounded mega-form.

## Acceptance criteria

1. Create requires valid metadata and at least two individually valid session
   plans; failure writes nothing.
2. Add, duplicate, remove, and accessible reorder preserve stable unique order
   indexes across reload, sync, and concurrent refresh.
3. Each child preserves its independent scheduled/unscheduled state, gym,
   exercise blocks, snapshots, targets, progress, and provenance.
4. Start all and Add block use the T03 materializers exactly once. Adding one
   block never consumes another, works in an active session, and preserves
   unrelated freeform work. It may share one compatible squat card with manual
   warm-ups, never overwrites another source block, and never guesses between
   multiple compatible cards.
5. Pulling leaves progress pending; Complete requires valid confirmed work but
   specifically from a source-derived set, accepts target deviations, and does
   not count manual-only warm-ups; Skip records no performed work; each exposes
   the deterministic next unresolved block.
6. Programme edit/delete follows the T01 lifecycle contract when some blocks
   are attached/resolved and never removes performed workout history.
7. Offline create/edit works through the same local repository and normal sync
   affordances as one-off plans.
8. RNTL/Jest covers success, validation, atomic failure, programme/session and
   performed-set reorder, every block state, both warm-up ordering scenarios,
   mixed block/freeform use, target deviation, retry, concurrent refresh, and
   empty/loading/error states.
9. Tokens/primitives/shared components are reused, no raw screen color is
   introduced, UI docs are current, and required visual evidence is captured.

## Docs touched (required)

- UI docs update required: **yes**.
  - `docs/specs/ui/screen-map.md`: programme create/detail and Sessions entry.
  - `docs/specs/ui/navigation-contract.md`: routes, params, child transitions,
    Add-block/Complete/Skip, and recorder transitions.
  - `docs/specs/ui/components-catalog.md`: programme list/editor components.
  - `docs/specs/ui/ux-rules.md`: programme and performed-set ordering, nested
    validation, compatible-card choice, block/set provenance and progress,
    freeform coexistence, and accessible reorder.
- `docs/specs/08-ux-delivery-standard.md`: consume and, if needed, refine the
  reusable accessible ordered-row pattern introduced by T04.
- `docs/specs/tech/session-planning-contract.md`: mobile programme as-built
  pointers and deviations.
- Tokens/primitives reuse: T04 planner primitives plus existing list/action and
  confirmation patterns; exceptions none planned.
- Screenshots required: create with two sessions; validation in a child;
  populated detail; lightweight reorder handles; next/attached/completed/
  skipped states;
  warm-ups-first attachment and planned-first warm-up reordering on one sourced
  card; ambiguous card choice; mixed sourced/freeform recorder; delete
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
