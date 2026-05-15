# Milestone Spec

## Milestone metadata

- Milestone ID: `M1`
- Title: UI session recorder (no persistence)
- Status: `planned`
- Owner: `AI + human reviewer`
- Target window: `2026-02`

## Parent references

- Project directives: `docs/specs/README.md`
- Product overview: `docs/specs/00-product.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`

## Milestone objective

Ship the first usable gym logging interface where a user can compose a full session (`Session -> Exercise -> Set`) with location and `Gym -> Machine` context entirely in UI state, with no local or remote persistence.

## In scope

- New mobile UI flow for creating a gym session.
- Session-level fields (date/time and gym context).
- Location picker pre-seeded with mock location options.
- Mock location seed list: `Downtown Iron Temple`, `Westside Barbell Club`, `North End Strength Lab`.
- Exercise list UI with per-exercise machine context.
- Pre-seeded exercise options from a small static list.
- Static exercise seed list: `Barbell Squat`, `Bench Press`, `Deadlift`, `Overhead Press`, `Lat Pulldown`, `Leg Press`.
- Set-entry UI for reps and weight.
- In-memory state only (screen state lifecycle only).
- Client-side validation and a non-persistent submit confirmation.
- Automated UI tests for key behavior paths.

## Out of scope

- SQLite/Drizzle schema changes or persistence.
- Sync/outbox logic.
- Backend/auth integration.
- Analytics/social/group features.

## Deliverables

1. Session recorder screen shell with typed in-memory state and mock location picker.
2. Location list management UI to add, select, and delete locations in local UI state.
3. Dynamic exercise/set builder interactions (add/edit/remove) with static exercise presets.
4. Validation + submit UX and test coverage for success/error paths, including location/exercise preset flows.

## Acceptance criteria

1. A user can open the session recorder screen and enter session metadata including location and gym context.
2. A user can add a new location, select a location, and delete a location from the in-memory location list.
3. A user can choose a location from the seeded mock list.
4. A user can add exercises from the seeded static list and also edit/remove exercises; each exercise supports machine context.
5. A user can add, edit, and remove sets per exercise with reps and weight fields.
6. Submit action validates required fields and shows a confirmation without writing data anywhere.
7. `npm run lint`, `npm run typecheck`, and `npm run test` pass in `apps/mobile`.

## Task breakdown

1. `docs/tasks/complete/T-20260219-01-m1-session-recorder-screen-shell.md` - route + UI shell + in-memory state + location add/select/delete.
2. `docs/tasks/complete/T-20260219-02-m1-exercise-set-builder-ui.md` - dynamic exercise/set interactions + static exercise presets.
3. `docs/tasks/complete/T-20260219-03-m1-validation-submit-and-tests.md` - validation UX, submit confirmation, and final test coverage.
4. `docs/tasks/complete/T-20260515-01-session-recorder-set-entry-ergonomics.md` - zero-weight set logging plus repeated-set defaulting ergonomics. (`completed`)

## Risks / dependencies

- Dynamic nested form state may create update/removal bugs if identity keys are unstable.
- Static mock lists may drift from future domain naming if not versioned and centralized.
- Mobile layout density can reduce usability for set entry if spacing and hit targets are not tuned.
- No-persistence behavior may confuse users unless explicitly communicated in submit/confirmation UI.

## Decision log

- Date: 2026-02-19
- Decision: Keep M1 strictly UI-only and defer all persistence/sync/backend while using mock location and exercise seed data.
- Reason: Validate interaction model before locking storage contracts.
- Impact: Faster iteration on UX, with follow-up milestone required for data durability.
