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
- Parallel with: `M23-T05`

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
duplicate, delete, and start a one-off session plan without turning the
recorder into a planning editor.

## Scope

### In scope

- Add **Active**, **Upcoming**, **Unscheduled**, and **Completed** sections to
  `/sessions`, with clear empty/loading/error/offline behavior.
- Add `/session-plan/new` and `/session-plan/[planId]`, register their stack
  titles, params, back behavior, and transitions.
- Compose the existing exercise and gym pickers, set rows/types, tokens,
  primitives, input validation, confirmations, and accessibility patterns.
- Human create/edit/reschedule/duplicate/delete for unstarted one-off plans.
- Start action, active-session conflict/Resume behavior, started read-only
  presentation, and navigation into the existing recorder.
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
2. **Manage an unstarted plan**
   - Trigger: tap a plan row.
   - Steps: view targets, edit/reschedule, duplicate, or confirm Delete.
   - Success outcome: list and detail update transactionally.
   - Failure/edge outcome: a remotely started/deleted plan refreshes to the
     current state without overwriting it.
3. **Start a plan**
   - Trigger: tap Start.
   - Success outcome: the plan materializes once and the route dismisses to the
     active recorder with planned targets visible.
   - Failure/edge outcome: if another active session exists, show one Resume
     action and no destructive replacement option.
4. **Review a started plan**
   - Trigger: open a plan whose status is started.
   - Success outcome: the source plan is read-only and links to the performed
     session; its targets do not change with recorder edits.

### Interaction + appearance notes

- Reuse `UiSurface`, `UiText`, `UiButton`, shared fields/list rows, picker
  components, spacing/color/type tokens, and established loading/error/empty
  states. No raw color literals or screen-local substitutes for primitives.
- Upcoming sorts by scheduled time, then stable ID; Unscheduled sorts by most
  recently updated. Completed workout ordering remains unchanged.
- Make schedule optional rather than disguising Unscheduled as "today".
- The plan form must remain usable with keyboard, VoiceOver, dynamic type, and
  the smallest supported phone.
- Destructive confirmation applies only to delete; starting is not described
  as completing or consuming the plan.

## Acceptance criteria

1. All four flows work and have RNTL/Jest happy, validation, loading, empty,
   offline, and failure-path coverage.
2. Plans are visibly separate from completed history and never affect its
   count, filters, row actions, or deleted-session toggle.
3. Start routes into the current recorder with targets intact; active conflict
   shows Resume and creates nothing.
4. Offline plan creation/edit/delete updates locally and advertises pending
   sync using existing global sync behavior rather than a custom online gate.
5. A server-restored plan renders with identical exercise snapshots, target
   order, schedule, gym, and provenance.
6. Started plans expose no edit or delete action.
7. Tokens/primitives/shared components are used, UI guardrails stay green, and
   no raw color literal is introduced in a screen file.
8. Screen map, navigation, components catalog, and UX rules describe the
   routes, params, transitions, planner components, states, and new patterns.

## Docs touched (required)

- UI docs update required: **yes**.
  - `docs/specs/ui/screen-map.md`: Sessions sections and both plan screens.
  - `docs/specs/ui/navigation-contract.md`: routes, params, Start/Resume and
    recorder transitions.
  - `docs/specs/ui/components-catalog.md`: reusable planner components.
  - `docs/specs/ui/ux-rules.md`: schedule/unscheduled, target validation,
    started state, and active-conflict behavior.
- `docs/specs/08-ux-delivery-standard.md`: update only if the implementation
  establishes a genuinely reusable planner pattern.
- `docs/specs/tech/session-planning-contract.md`: mobile as-built pointers.
- Tokens/primitives reuse: existing shared controls and tokens above;
  exceptions none planned.
- Screenshots required: Sessions with all relevant sections; Upcoming and
  Unscheduled empty states; populated plan detail; validation; active conflict;
  started detail; offline-created plan; keyboard and small-phone form layouts.

## Testing and verification approach

- Add focused component/route tests and extend the relevant Maestro flow; T07
  owns the final dedicated server-to-mobile planning lane.
- Before PR: `./boga test fast` and `./boga test frontend`.
- Run `./boga test for --diff origin/main` and record artifacts from the gate
  runner. Use `./boga timings` for measured times only.

## Evidence

## Completion note

- What changed:
- What tests ran:
- What remains:
