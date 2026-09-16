---
task_id: M23-T04-Mobile_one_off_session_planner
milestone_id: "M23"
status: planned
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/08-ux-delivery-standard.md, docs/specs/ui/screen-map.md, docs/specs/ui/navigation-contract.md, docs/specs/ui/components-catalog.md, docs/specs/ui/ux-rules.md, docs/specs/tech/session-planning-contract.md"
---

# M23-T04 — Mobile one-off session planner

## Task metadata

- Task ID: `M23-T04-Mobile_one_off_session_planner`
- Status: `planned`
- Depends on: `M23-T03`
- Precedes: `M23-T05`

## Parent references (required)

- Milestone: `docs/plans/milestones/M23-session-planning-and-programmes.md`
- **Contract:** `docs/specs/tech/session-planning-contract.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs: `docs/specs/ui/README.md`
- Existing Sessions and recorder routes: `apps/mobile/app/sessions.tsx`,
  `apps/mobile/app/(tabs)/session-recorder.tsx`
- Testing: `docs/specs/02-quality-and-test-gates.md`,
  `docs/specs/06-testing-strategy.md`

## Objective

Let a person discover upcoming work from Sessions and create, review, edit,
duplicate, delete, Start all, or add one block from a one-off session plan
without turning the recorder into a planning editor or constraining its
freeform behavior.

## Scope

### In scope

- Add **Active**, **Upcoming**, **Unscheduled**, and **Completed** sections to
  `/sessions`, with clear empty/loading/error/offline behavior.
- Add `/session-plan/new` and `/session-plan/[planId]`, register their stack
  titles, params, back behavior, and transitions.
- Compose the existing exercise and gym pickers, set rows/types, tokens,
  primitives, input validation, confirmations, and accessibility patterns.
- Human create/edit/reschedule/duplicate/delete for eligible one-off plans and
  future unattached blocks.
- Start-all action with active-session conflict/Resume behavior, plus per-block
  Add to session that targets a selected/unambiguous compatible exercise card
  in an active session or creates a card/session when needed.
- Shared recorder integration for block and per-set source identity, explicit
  Complete block, the attached-but-unresolved state, and set reordering; the
  rest of the recorder stays freeform.
- Rename the completed-history picker action from **Append plan** to **Repeat
  last**, and add a distinct **From planner** entry for authored blocks.
- Derived plan progress and read-only presentation for attached/resolved blocks,
  with links to the performed session.
- Subtle human/agent provenance in plan detail.

### Out of scope

Programme creation/detail (`M23-T05`); agent permission/API/MCP; calendar,
recurrence, reminders, recommendations, and plan-versus-actual analytics.

## UX Contract

### Key user flows

1. **Plan one session**
   - Trigger: tap Plan session from `/sessions`.
   - Steps: enter title and optional schedule/gym, add ordered exercises, add
     target sets, review inline validation, and Save.
   - Success outcome: the plan appears in Upcoming or Unscheduled immediately,
     including offline.
   - Failure/edge outcome: invalid fields remain in place with accessible
     messages; an unexpected repository error preserves the draft for retry.
2. **Manage an unused or partially used plan**
   - Trigger: tap a plan row.
   - Steps: view targets, edit/reschedule eligible future blocks, duplicate, or
     confirm Delete when lifecycle permits.
   - Success outcome: list and detail update transactionally.
   - Failure/edge outcome: remotely attached/resolved/deleted state refreshes
     without overwriting it.
3. **Use planned work**
   - Trigger: tap Start all or Add to session on one block.
   - Success outcome: Start all materializes all available blocks once when no
     session is active; Add to session materializes only the selected block in
     the active session, attaching to the selected or only compatible unsourced
     same-exercise card or creating one when needed. Existing manual warm-ups
     remain on the card, planned targets are visible, and unrelated exercises
     remain fully editable.
   - Failure/edge outcome: if another active session exists, show one Resume
     action for Start all and no destructive replacement option; Add block uses
     the active session and is not a conflict. If several cards are compatible,
     show an accessible card choice and write nothing until one is selected.
4. **Resolve a sourced block**
   - Trigger: finish the sourced exercise card or submit a session containing
     an attached unresolved block.
   - Steps: confirm actual sets, optionally deviate from targets, then choose
     Complete block; or choose the distinct Skip action before attachment.
   - Success outcome: completion advances plan/programme progress without
     closing the recorder; Skip advances without recording performed work.
   - Failure/edge outcome: completion with no valid confirmed source-derived
     set is refused inline; manual warm-ups do not qualify, and session
     submission never auto-completes the block.
5. **Reorder manual and planned sets**
   - Trigger: touch and drag the set's compact grab handle, as in a music
     playlist; VoiceOver users invoke Move earlier/Move later custom actions.
   - Steps: add warm-ups before attaching a plan block, or add them after the
     planned sets and move them above or between those sets.
   - Success outcome: one exercise card retains its source block, each planned
     row retains its source target, manual rows remain manual, and the order
     survives autosave, reload, sync, completion, and completed-session edit.
   - Failure/edge outcome: first/last accessibility actions are unavailable,
     cancelling returns the row to its original position, and an atomic
     persistence failure restores the prior order with a lightweight error.
6. **Review a used plan**
   - Trigger: open a plan with attached or resolved blocks.
   - Success outcome: each consumed source block is read-only and links to its
     performed session; future blocks remain editable and source targets never
     change with recorder edits.
   - Failure/edge outcome: a missing/deleted performed session does not expose
     stale navigation or make the source target editable.

### Interaction + appearance notes

- Reuse `UiSurface`, `UiText`, `UiButton`, shared fields/list rows, picker
  components, spacing/color/type tokens, and established loading/error/empty
  states. No raw color literals or screen-local substitutes for primitives.
- Upcoming sorts by scheduled time, then stable ID; Unscheduled sorts by most
  recently updated. Completed workout ordering remains unchanged.
- Make schedule optional rather than disguising Unscheduled as "today".
- A compatible card is an unsourced card with the same owned exercise
  definition. Add block may convert that existing card into the sourced card;
  a card already sourced from another block is never overwritten. Show quiet
  source text such as `Wave · Block 3 of 6`, and distinguish source-derived
  targets from manual rows without relying on color.
- Reordering is a new recorder capability for all exercise cards, not a
  planner-only exception. Use lightweight playlist-style direct manipulation:
  a small trailing grab handle is the only persistent reorder chrome; dragging
  starts from the handle rather than editable row content, lifts the row, and
  exposes a clear insertion position. Do not require an Edit/reorder mode and
  do not render permanent up/down buttons beside every set.
- Keep the handle glyph visually quiet while its hit target meets the shared
  minimum touch size. Handle dragging must not steal taps from set fields or
  conflict with the row's existing removal gesture.
- VoiceOver exposes Move earlier/Move later as custom actions with an announced
  result; keyboard and switch-control users receive an equivalent focusable
  action or compact overflow fallback. Reduced-motion settings suppress
  nonessential lift/settle animation without changing the interaction.
- Complete is explicit and target equality is never required. Pulling or
  confirming individual planned sets alone does not advance programme state.
- The plan form must remain usable with keyboard, VoiceOver, dynamic type, and
  the smallest supported phone.
- Destructive confirmation applies to delete; Start/Add is not described as
  completion, and Skip uses explicit non-performance wording.

## Acceptance criteria

1. All six flows work and have RNTL/Jest happy, validation, loading, empty,
   offline, and failure-path coverage.
2. Plans are visibly separate from completed history and never affect its
   count, filters, row actions, or deleted-session toggle.
3. Start all routes into the current recorder with targets intact; active
   conflict shows Resume and creates nothing. Add block targets an explicitly
   selected or single compatible unsourced card, creates one when none exists,
   and prompts without writing when several cards are compatible.
4. Offline plan creation/edit/delete updates locally and advertises pending
   sync using existing global sync behavior rather than a custom online gate.
5. A server-restored plan renders with identical exercise snapshots, target
   order, schedule, gym, and provenance.
6. Attached/resolved blocks expose no target edit/delete action, future
   unattached blocks remain editable, and source targets remain unchanged by
   performed edits.
7. Complete/Skip are explicit, attachment alone never advances, target
   deviations on a confirmed source-derived set can complete, manual-only work
   cannot, and one sourced card can contain both planned and manual sets while
   coexisting with arbitrary freeform exercises.
8. The historical picker says Repeat last and remains separate from authored
   From planner blocks.
9. Tokens/primitives/shared components are used, UI guardrails stay green, and
   no raw color literal is introduced in a screen file.
10. Screen map, navigation, components catalog, and UX rules describe the
    routes, params, transitions, planner components, states, and new patterns.
11. Manual warm-ups added before attachment remain above the planned sets, and
    warm-ups added afterward can be moved above them through the compact drag
    handle or equivalent accessibility action. Reordering persists in active
    and completed-edit flows and never changes block/set provenance, targets,
    actuals, confirmation state, or source-plan order.

## Docs touched (required)

- UI docs update required: **yes**.
  - `docs/specs/ui/screen-map.md`: Sessions sections and both plan screens.
  - `docs/specs/ui/navigation-contract.md`: routes, params, Start-all/Resume,
    Add-block, Complete/Skip, and recorder transitions.
  - `docs/specs/ui/components-catalog.md`: reusable planner components and the
    compact reorder handle/ordered-set-row pattern.
  - `docs/specs/ui/ux-rules.md`: schedule/unscheduled, target validation,
    compatible-card choice, block/set provenance, set ordering/resolution,
    freeform coexistence, picker terminology, and active-session behavior.
- `docs/specs/08-ux-delivery-standard.md`: document the reusable accessible
  lightweight, playlist-style ordered-row interaction because M23 introduces
  recorder set reordering.
- `docs/specs/tech/session-planning-contract.md`: mobile as-built pointers.
- Tokens/primitives reuse: existing shared controls and tokens above;
  exceptions none planned.
- Screenshots required: Sessions with all relevant sections; Upcoming and
  Unscheduled empty states; populated plan detail; validation; active conflict;
  attached/completed/skipped blocks; ambiguous card selection; warm-ups first
  then planned sets on one card; planned sets first then warm-ups reordered
  above; resting grab handle and active insertion feedback; mixed sourced/
  freeform recorder; offline-created plan; keyboard and small-phone form
  layouts.

## Testing and verification approach

- Add focused component/route tests for card choice, handle-only drag initiation,
  insertion feedback, cancellation/rollback, Move earlier/later VoiceOver and
  keyboard semantics, reduced motion, boundary states, and both warm-up order
  scenarios. Extend the relevant Maestro flow; T07 owns the final dedicated
  server-to-mobile planning lane.
- Before PR: `./boga test fast` and `./boga test frontend`.
- Run `./boga test for --diff origin/main` and record artifacts from the gate
  runner. Use `./boga timings` for measured times only.

## Evidence

## Completion note

- What changed:
- What tests ran:
- What remains:
