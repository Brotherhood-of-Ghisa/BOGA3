# Milestone Spec

## Milestone metadata

- Milestone ID: `M7`
- Title: Completed session detail, reopen, and edit
- Status: `completed`
- Owner: `AI + human reviewer`
- Target window: `2026-02` / `2026-03`

## Parent references

- Project directives: `docs/specs/README.md`
- Milestone index: `docs/specs/milestones/README.md` (the retired `00-mvp-deliverables.md` index)
- Architecture: `docs/specs/03-technical-architecture.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- Prior milestones:
  - `docs/specs/milestones/M1-ui-session-recorder.md`
  - `docs/specs/milestones/M3-session-domain-local-autosave.md`
  - `docs/specs/milestones/M4-session-list-screen-and-data-wiring.md`

## Milestone objective

Ship a completed-session detail flow that lets a user open a completed session from the session list, view it in a recorder-like read-only screen, reopen it as the single active session (only when no active session already exists), or edit the completed session in place with continuous autosave and explicit support for changing start and end times.

## In scope

- Enable completed-session row navigation from the session list history.
- Add completed-session detail screen with recorder-like layout in read-only mode.
- Add `Edit session` action from completed-session detail.
- Add completed-session edit mode that reuses recorder interaction patterns and supports:
  - exercise/set editing
  - gym changes
  - start time editing
  - end time editing
- Keep completed-session edit local-first and resilient with continuous autosave (same data-loss posture as active recorder flows).
- Add `Reopen session` action from completed-session detail that mutates the same session record back to active status.
- Enforce single-active-session invariant for reopen at both UI and repository layers.
- Recompute and persist `durationSec` whenever completed-session times are edited and saved/autosaved.
- Return user to session list after saving/completing a completed-session edit session.
- Add automated tests for list -> detail -> edit/reopen happy paths and edge conditions.

## Out of scope

- Creating a new session copy from a completed session (duplicate/clone flow).
- Multi-session merge/split workflows.
- Version history or audit trail of completed-session edits.
- Cloud sync conflict resolution for local completed-session edits/reopens.
- Bulk history actions beyond current delete/undelete behavior.
- Editing active-session end time or changing active-session completion semantics.

## Deliverables

1. Completed-session detail route/UI (read-only) that mirrors session recorder structure closely enough to preserve familiarity.
2. Mode-aware session recorder/detail implementation supporting:
   - completed read-only view
   - completed edit with continuous autosave
   - existing active recorder flows without regression
3. Local data/repository contracts for:
   - loading a full session graph by session ID (including completed sessions)
   - updating an existing completed session (including start/end time changes)
   - reopening a completed session in place
   - validating/rejecting reopen when another active session exists
4. Session-list integration updates (completed row tap opens detail; reopen-disabled explanation states reflected when relevant).
5. Test coverage for behavior, invariants, and regression-sensitive recorder/list interactions.

## UX behavior notes (milestone-level)

- Completed history rows become two-action surfaces:
  - row body tap opens detail
  - kebab menu contains secondary actions (`Edit`, `Reopen`, `Delete`/`Undelete`)
- Completed-session detail screen should visually reuse the recorder information hierarchy:
  - session metadata at top
  - exercise cards and set rows beneath
  - same naming/structure where possible
- Detail mode is explicitly read-only:
  - visible `Completed` / `Read-only` status treatment
  - no inline editable text inputs in default view mode
- Detail actions:
  - `Edit session`
  - `Reopen session` (disabled when an active session exists, with clear explanation text)
- No reopen confirmation modal (user decision).
- Completed-session edit mode should prioritize low error rates for time editing:
  - use dedicated start/end controls (not a single overloaded field)
  - mobile-friendly entry with explicit format guidance and validation feedback
  - native pickers may be used if implementation fit is good; otherwise structured text inputs are acceptable for this milestone
- Save path after completed-session edit returns to the session list (not back into detail).

## Acceptance criteria

1. A user can tap a completed session row in the session list and open a completed-session detail screen.
2. Completed-session detail uses a recorder-like layout and renders session metadata plus all logged exercises/sets in read-only form.
3. The completed-session kebab menu in the session list still performs delete/undelete actions and does not conflict with row-tap navigation.
4. Completed-session detail provides `Edit session` and `Reopen session` actions.
5. If any active session already exists, `Reopen session` is disabled and the UI explains why (single-active-session constraint).
6. If no active session exists, `Reopen session` mutates the same completed session record to active status (no clone/new record) and the session appears as the active session in the list.
7. Repository/data-layer logic prevents a reopen from creating a second active session even if UI gating is bypassed or stale.
8. Entering completed-session edit loads the selected completed session by ID (not the latest active session).
9. Completed-session edit supports modifying exercises/sets/gym and editing both start and end times.
10. Completed-session edit uses continuous autosave semantics so in-progress edits are not lost on app lifecycle transitions/navigation interruptions.
11. Saving/finishing completed-session edits keeps the session status as `completed` and does not reopen the session.
12. Editing completed-session start/end times updates persisted `completedAt` and recomputes persisted `durationSec`, and list ordering/duration display reflect the change after returning to session list.
13. Invalid time combinations (including end before start) are blocked with clear user feedback.
14. Cleanup behavior for incomplete sets / empty exercises remains consistent with current recorder submit flow during completed-session edit save.
15. `npm run lint`, `npm run typecheck`, and `npm run test` pass in `apps/mobile`.

## Task breakdown

1. `docs/tasks/complete/T-20260225-01-m7-completed-session-detail-route-and-read-only-ui.md` - add completed-row navigation, detail route shell, recorder-like read-only rendering, and UX contract. (`completed`)
2. `docs/tasks/complete/T-20260225-02-m7-completed-session-data-contracts-edit-and-reopen.md` - implement load-by-id session graph, completed-session edit persistence, reopen mutation, and single-active invariant tests. (`completed`)
3. `docs/tasks/complete/T-20260225-03-m7-mode-aware-recorder-completed-edit-flow.md` - add recorder/detail mode support, completed edit autosave, start/end time editing, validation, and save-return-to-list UX. (`completed`)
4. `docs/tasks/complete/T-20260225-04-m7-integration-tests-and-ux-evidence.md` - end-to-end/integration flow tests, regressions, and UX evidence closeout. (`completed`)
5. `docs/tasks/complete/T-20260226-01-m7-remove-draft-status-and-migrate-to-active-completed-lifecycle.md` - remove persisted `draft` status, migrate legacy rows to `active`, and align repository lifecycle contracts/tests to `active|completed`. (`completed`)

## Risks / dependencies

- Current recorder screen is coupled to `loadLatestSessionDraftSnapshot()` and active-session assumptions; mode isolation is required to avoid loading the wrong session during completed edit/view.
- Current draft store rejects writes to completed sessions, so new completed-session update APIs must be explicit and must not weaken active/completed invariants.
- Reopen mutates the same record by product decision; this affects ordering/history visibility and future sync semantics and should be documented in repository behavior/tests.
- Continuous autosave for completed-session edit increases accidental partial-write risk unless read-only vs edit mode boundaries are unambiguous and reversible enough for users.
- Time editing UX can be error-prone on mobile if controls are too free-form; validation and format guidance are mandatory.
- Navigation return behavior (save -> session list) must preserve list refresh correctness after reopen/edit to prevent stale UI states.

## Decision log

- Date: 2026-02-25
- Decision: Reopen a completed session by mutating the same session record back to active status (no clone).
- Reason: Matches user mental model and avoids duplicate-history records for the same session.
- Impact: Repository and UI must enforce one-active-session constraints during reopen and refresh list buckets correctly.

- Date: 2026-02-25
- Decision: Completed-session edit uses continuous autosave rather than explicit save-only buffering.
- Reason: Product priority is to avoid losing user input across interruptions.
- Impact: Completed edit requires a distinct autosave-capable persistence path that can safely write completed records and preserve completion fields.

- Date: 2026-02-25
- Decision: When an active session exists, `Reopen session` remains visible but disabled with explanation.
- Reason: Keeps the capability discoverable while clearly communicating the single-active-session rule.
- Impact: Detail UI must render active-conflict state and repository must still reject invalid reopen attempts.

## Completion note (fill when milestone closes)

- What changed:
  - Delivered completed-session detail navigation, read-only recorder-like rendering, reopen-in-place behavior with single-active-session enforcement, and mode-aware completed-session editing with start/end time validation and autosave.
  - Closed M7 integration/verification work with cross-screen Jest journeys plus regression coverage for list/detail/recorder paths, including reopen/delete error feedback and completed-edit edge paths.
  - Captured M7 UX evidence screenshots for happy and edge flows via local iOS Maestro artifacts under `apps/mobile/artifacts/maestro/T-20260225-04/20260227-100755-94690`.
- Verification summary:
  - `npm run lint` (apps/mobile) ✅ (warnings only in unrelated `app/__tests__/ui-guardrails-script.test.ts`)
  - `npm run typecheck` (apps/mobile) ✅
  - `npm run test -- --runInBand` (apps/mobile) ✅
  - `npm run test:e2e:ios:smoke` ✅
  - `npm run test:e2e:ios:data-smoke` ✅
- What remains:
  - None for M7 scope.

## Status update checklist (mandatory during task closeout)

- Keep milestone `Status` current as tasks progress.
- Update task breakdown entries to reflect each task state (`planned | in_progress | completed | blocked`).
- If milestone remains open after a session, record why in the active task completion note.
