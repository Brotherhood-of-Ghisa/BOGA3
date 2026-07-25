---
task_id: T-20260725-03-Preserve_active_sets_and_default_blank_weight
milestone_id: "MVP"
status: completed
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo|maestro|docs"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/05-data-model.md, docs/specs/ui/ux-rules.md, docs/specs/ui/screen-map.md, docs/specs/ui/navigation-contract.md"
---

# Preserve Active Sets and Default Blank Weight

## Task metadata

- Task ID: `T-20260725-03-Preserve_active_sets_and_default_blank_weight`
- Title: Preserve active sets and default blank weight
- Status: `completed`
- Session date: 2026-07-25
- Session interaction mode: `interactive`

## Parent references

- Project directives: `AGENTS.md`, `docs/specs/README.md`
- Milestone spec: N/A - user-requested recorder integrity correction.
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`

## Context Freshness

- Verified current branch + HEAD commit: `codex/recorder-ux-integrity-fixes` at `8119a62`.
- Start-of-session sync with `origin/main` completed?: `yes`.
- Parent refs opened in this session:
  - `docs/specs/02-quality-and-test-gates.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/navigation-contract.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/ux-rules.md`
- Code/docs inventory freshness checks run:
  - `/sessions` and Log-tab navigation paths compared on 2026-07-25.
  - Draft serialization, graph replacement, hydration, lifecycle flush, and
    incomplete-set cleanup inspected on 2026-07-25.
  - `apps/mobile/app/__tests__/README.md` read before planning test edits.
- Known stale references or assumptions:
  - `/sessions` is registered in source but omitted from the canonical UI screen
    and navigation maps; this task must correct that documentation drift.

## Objective

Guarantee that navigation never loses blank or partially entered active sets, and
make a blank weight with valid positive reps canonically mean `0kg`.

## Scope

### In scope

- Preserve every active-draft set, including fully blank and partial rows, across
  Log, History, Sessions, Resume, blur, remount, and hydration.
- Normalize blank weight to `"0"` when reps are a valid positive integer and the
  row is committed/persisted/submitted.
- Treat that normalized row as performed and complete.
- Keep blank/invalid reps incomplete at completion and require explicit cleanup.
- Make `/sessions` Resume return to the existing Log tab rather than pushing a
  fresh recorder instance.
- Prevent `/sessions` quick completion from bypassing recorder cleanup semantics.
- Wire active-mode blur/input commit persistence so pending text does not rely
  only on unmount.

### Out of scope

- Database schema or Sync v2 wire changes.
- Treating missing reps as performed.
- Silent removal of active-draft rows.
- Weight-field layout and card autoscroll owned by the other cards.

## UI Impact

- UI Impact?: `yes`
- Existing recorder/session-list components and UI tokens must be reused. No raw
  colors or new navigation route are planned.

## UX Contract

### Key user flows

1. Flow name: Resume a partial active session
   - Trigger: user enters partial set data, opens History, opens Sessions, and
     taps the active session.
   - Steps: navigation returns to the existing Log recorder.
   - Success outcome: every set ID, order, blank field, and entered value remains.
   - Failure/edge outcome: an in-flight debounce must not expose an older snapshot.
2. Flow name: Log bodyweight/zero-load set
   - Trigger: user enters positive reps and leaves weight blank.
   - Steps: row commits or session is submitted.
   - Success outcome: weight becomes `0`, the set is retained, and no incomplete
     cleanup prompt is shown for that row.
   - Failure/edge outcome: zero/blank/invalid reps remain incomplete.
3. Flow name: Preserve unfinished work
   - Trigger: user leaves a fully blank set or a weight-only set in an active session.
   - Steps: user navigates away and resumes.
   - Success outcome: the unfinished row remains available for later editing.
   - Failure/edge outcome: completion requires explicit cleanup confirmation;
     no navigation action silently deletes it.

### Interaction + appearance notes

- Do not inject `0` while the user is actively replacing a weight.
- Canonicalize at row commit/persistence/completion boundaries.
- Recorder remains the single authoritative completion/cleanup surface.
- Resume should unwind to the existing Log tab, not create a parallel recorder.

## Acceptance criteria

1. Active-draft persistence never filters blank or partial sets.
2. History → Sessions → active Resume preserves all current recorder rows/values.
3. Blank weight + positive reps persists/submits as `"0"` and is performed.
4. Explicit `0` remains valid.
5. Blank/invalid reps remain incomplete and are removed only after confirmation.
6. Fully blank active rows survive navigation and hydration.
7. `/sessions` completion cannot bypass the recorder cleanup rules.
8. No schema, migration, backend, or sync-envelope change is introduced.
9. Unit, component, repository, and navigation regression tests cover the contract.

## Docs touched

- `docs/specs/05-data-model.md` - record canonical zero-load value semantics and
  explicit no-schema/no-wire sync impact.
- `docs/specs/ui/ux-rules.md` - update active-set preservation, zero default, and
  completion cleanup behavior.
- `docs/specs/ui/screen-map.md` - add the currently omitted `/sessions` route and
  active-session behavior.
- `docs/specs/ui/navigation-contract.md` - add `/sessions` and its Resume transition.
- UI docs update required?: `yes`.
- Tokens/primitives compliance: reuse existing recorder, `ActiveSessionRow`, and
  session-list components; no exceptions planned.
- UI artifacts/screenshots expectation:
  - Required?: `yes`.
  - Evidence: user-run iPhone dev-build confirmation of partial-set Resume and
    blank-weight-to-zero behavior.

## Testing and verification approach

- Pure set-normalization tests.
- Recorder persistence and submit interaction tests.
- Session-list/navigation test proving Resume does not `push` a fresh recorder.
- Data-layer round-trip test for fully blank/partial active sets.
- `./boga test fast`.
- `./boga test frontend`.
- Human iPhone UX confirmation; no new Maestro UX flow is requested.

## Implementation notes

- Expected code:
  - `apps/mobile/app/(tabs)/session-recorder.tsx`
  - `apps/mobile/app/sessions.tsx`
  - `apps/mobile/components/session-list/**`
  - a focused helper under `apps/mobile/src/session-recorder/**`
  - targeted tests under `apps/mobile/app/__tests__/`
- Project structure impact: one focused helper/test file is permitted within
  existing canonical directories; no new top-level path.
- Sync impact decision: value normalization is in sync scope through the existing
  `exercise_sets.weight_value` string. No schema/wire change is needed; `"0"`
  already round-trips.
- Coordinate by avoiding the weight-layout and card-scroll regions owned by tasks
  01 and 02.

## Mandatory verify gates

- `./boga test fast`
- `./boga test frontend`
- `./scripts/task-closeout-check.sh <task-card-path>`

## Evidence

- Implemented shared set semantics in
  `apps/mobile/src/session-recorder/set-semantics.ts`: positive reps plus blank
  weight canonicalizes to `"0"` and is performed; missing/invalid reps remain
  incomplete.
- Recorder persistence now retains all draft rows, canonicalizes at
  input-commit/persistence/submit boundaries, flushes pending input text on row
  commit and active-screen blur, and leaves blank weight unchanged while focus
  moves within the row.
- `/sessions` Resume and review/complete both dismiss to the existing Log
  recorder; the Sessions screen no longer calls direct active-session completion.
- Focused Jest command:
  `cd apps/mobile && npm test -- --runInBand app/__tests__/session-set-semantics.test.ts app/__tests__/draft-autosave-controller.test.ts app/__tests__/session-recorder-persistence.test.tsx app/__tests__/session-recorder-submit.test.tsx app/__tests__/session-drafts-repository.test.ts app/__tests__/sessions-screen.test.tsx`
  — PASS, 6 suites / 62 tests.
- `./boga test typecheck` — PASS.
- `./boga test lint` — PASS with 0 errors and 15 pre-existing warnings outside
  the files introduced/edited for this task.
- `./boga test docs-check` — PASS.
- `git diff --check` — PASS.
- Integrated verification:
  - ✅ `./boga test fast` (`951` Jest tests passed; lint/typecheck/backend
    smoke/docs/meta lanes passed).
  - ✅ `./boga test frontend` (iOS smoke, data-smoke, auth-profile, and sync-e2e
    lanes passed).
- Human iPhone UX confirmation: ✅ passed on 2026-07-25 for active-row
  preservation, blank-weight zero semantics, and Sessions-to-Log navigation.
- A pre-existing clean-parent/remote-catalog FK mismatch was diagnosed during
  the device run and explicitly excluded from this card and PR.

## Completion note

- What changed: active drafts preserve blank/partial rows; positive reps with
  blank weight commit as `0kg`; input/screen blur flush pending edits; Sessions
  Resume and completion return to the authoritative recorder cleanup flow; data
  and canonical UI/navigation docs now record the contract.
- What tests ran: focused set-semantics, autosave, recorder persistence/submit,
  repository round-trip, and Sessions navigation suites (`62` passing tests),
  integrated fast/frontend gates, typecheck, lint, docs-check, diff whitespace
  validation, and human iPhone UX verification.
- What remains: none.

## Status update checklist

- Fill evidence/completion notes and mark completed only after integrated review.
- Move to `docs/tasks/complete/` when completed.
- Update data-model and canonical UI docs.
