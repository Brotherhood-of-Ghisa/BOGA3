# Milestone Spec

## Milestone metadata

- Milestone ID: `M3`
- Title: Session domain model and continuous local persistence
- Status: `completed`
- Owner: `AI + human reviewer`
- Target window: `2026-02`

## Parent references

- Project directives: `docs/specs/README.md`
- Milestone index: `docs/specs/milestones/README.md` (the retired `00-mvp-deliverables.md` index)
- Architecture: `docs/specs/03-technical-architecture.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`

## Milestone objective

Implement the first production-oriented local workout domain data model (`Gym`, `Session`, `Exercise`, `Set`) on top of the validated Drizzle/SQLite infrastructure, including continuous draft persistence and session completion duration materialization.

## In scope

- Replace smoke-only schema usage with domain schema for session recording.
- Add local data model for:
  - `gyms`
  - `sessions`
  - `session_exercises`
  - `exercise_sets`
- Persist sessions continuously in local DB through standalone domain/data-layer autosave primitives (UI wiring deferred to follow-up task).
- Define and implement autosave policy:
  - Debounced text-edit writes (`3s`).
  - Immediate transactional writes for structural changes.
  - Immediate flush on lifecycle triggers (blur/route/background) via helper adapters.
  - Dirty-state max flush interval (`10s`) while user remains on screen.
- Support draft-to-completed session lifecycle with persisted duration.

## Out of scope

- Backend sync/outbox or cloud conflict resolution.
- Group adoption UX flows and server fetch logic.
- Auth/RLS/backend schema implementation.
- Analytics dashboards and advanced reporting.

## Deliverables

1. Domain schema + migration artifacts for core recorder entities.
2. Continuous local autosave + draft lifecycle persistence for session recorder state.
3. Session completion flow that stores `durationSec` for sorting/analysis use cases.
4. Architecture spec update capturing new local persistence decisions.

## Acceptance criteria

1. Domain tables exist with enforced relational integrity (`Session -> Exercise -> Set`) and no uniqueness constraint on gym names.
2. Draft persistence primitives enforce the autosave SLA defined in this milestone.
3. A draft session can be resumed via draft load APIs, and lifecycle flush helper contracts exist for later UI integration.
4. Completing a session persists `completedAt` and materialized `durationSec`.
5. `docs/specs/03-technical-architecture.md` is updated with the milestone decisions.
6. Required quality gates pass in `apps/mobile`: `npm run lint`, `npm run typecheck`, `npm run test`.

## Task breakdown

1. `docs/tasks/complete/T-20260220-02-m3-domain-schema-and-migrations.md` - define and migrate domain schema and constraints. (`completed`)
2. `docs/tasks/complete/T-20260220-03-m3-continuous-autosave-and-draft-lifecycle.md` - implement recorder autosave SLA and lifecycle flush semantics. (`completed`)
3. `docs/tasks/complete/T-20260220-04-m3-session-completion-duration-and-architecture-update.md` - complete session finalization/duration persistence and update architecture spec. (`completed`)

## Risks / dependencies

- Autosave cadence must balance write-amplification vs. data-loss window on mobile lifecycle edges.
- Draft persistence can conflict with evolving UI state model unless identity/order semantics are stable.

## Decision log

- Date: 2026-02-20
- Decision: Adopt continuous local persistence with bounded autosave SLA (`3s` debounce, immediate structural writes, lifecycle flush, `10s` dirty cap).
- Reason: Reduce user-visible data loss risk without excessive write frequency.
- Impact: Enables resilient offline recording with predictable persistence behavior and lower write churn.

- Date: 2026-02-20
- Decision: Keep gym names non-unique.
- Reason: User-visible gym names should not be treated as globally unique identifiers.
- Impact: Reduces false conflicts and avoids naming-collision issues in local-first recording.

- Date: 2026-02-20
- Decision: Ship M3 as a UI-decoupled persistence foundation before recorder-screen wiring.
- Reason: Validate persistence/lifecycle semantics with standalone tests first, then perform UI integration with lower regression risk.
- Impact: M3 domain/data acceptance is complete; a follow-up task will connect these helpers to React Native screen events.

## Completion note

- What changed:
  - Delivered domain schema/migrations (`T-20260220-02`), standalone autosave + lifecycle helper contracts (`T-20260220-03`), and completion duration materialization + architecture update (`T-20260220-04`).
  - Architecture decisions were updated in `docs/specs/03-technical-architecture.md` to codify autosave SLA, completion duration materialization, and adapter-based lifecycle integration.
- Verification summary:
  - Lane 1 gates passed in `apps/mobile` after milestone implementation:
    - `npm run lint`
    - `npm run typecheck`
    - `npm run test` (`10` suites, `34` tests)
- Remaining work:
  - Integrate the new autosave/completion helper contracts with `apps/mobile/app/session-recorder.tsx` in a follow-up UI wiring task.
