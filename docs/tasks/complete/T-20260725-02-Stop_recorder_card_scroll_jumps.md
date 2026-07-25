---
task_id: T-20260725-02-Stop_recorder_card_scroll_jumps
milestone_id: "MVP"
status: completed
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo|maestro|docs"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/ux-rules.md, docs/specs/ui/screen-map.md"
---

# Stop Recorder Card Scroll Jumps

## Task metadata

- Task ID: `T-20260725-02-Stop_recorder_card_scroll_jumps`
- Title: Stop recorder card scroll jumps
- Status: `completed`
- Session date: 2026-07-25
- Session interaction mode: `interactive`

## Parent references

- Project directives: `AGENTS.md`, `docs/specs/README.md`
- Milestone spec: N/A - user-requested UX correction.
- Architecture: `docs/specs/03-technical-architecture.md`
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
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/ux-rules.md`
- Code/docs inventory freshness checks run:
  - `focusedExerciseCardId`, `scrollToExerciseCard`, and every caller inspected
    on 2026-07-25.
  - Commit `c52a780e` inspected to establish the append-plan scroll intent.
- Known stale references or assumptions: none.

## Objective

Keep the useful initial reveal after appending an exercise plan while preventing
later row/layout changes from repeatedly scrolling a tall exercise card back to
its header.

## Scope

### In scope

- Replace persistent layout-triggered scrolling with a one-shot pending request.
- Keep visual card selection/highlighting independent from scroll state.
- Ensure row expansion/collapse, editing, and keyboard layout changes do not
  trigger a card-header jump.
- Add deterministic tests around scroll request consumption.

### Out of scope

- Weight input layout; `T-20260725-01` owns it.
- Active draft persistence and blank-weight semantics; `T-20260725-03` owns them.
- A general virtualized recorder list rewrite.

## UI Impact

- UI Impact?: `yes`
- No new visual primitives or raw color literals are planned; this corrects
  interaction stability inside the existing recorder layout.

## UX Contract

### Key user flows

1. Flow name: Reveal appended plan
   - Trigger: user appends a historical plan to an exercise.
   - Steps: the modal closes and the recorder reveals the target exercise once.
   - Success outcome: the correct card is visible and may retain its selected styling.
   - Failure/edge outcome: a delayed first layout still consumes exactly one scroll request.
2. Flow name: Edit a tall exercise
   - Trigger: user expands or edits a set deep inside an exercise with many sets.
   - Steps: row height and keyboard layout change.
   - Success outcome: the user remains at the edited set.
   - Failure/edge outcome: later card layouts never return the viewport to the card header.

### Interaction + appearance notes

- Initial plan reveal may remain animated.
- Subsequent layouts are passive measurements only.
- Highlight lifetime must not control scrolling.

## Acceptance criteria

1. Appending a plan requests at most one automatic card scroll.
2. The request is cleared after it is successfully consumed.
3. Later `onLayout` calls for the selected card do not scroll.
4. Row expansion/collapse in a tall card preserves the user's viewport.
5. Targeted tests prove one-shot consumption and no repeat scroll.

## Docs touched

- `docs/specs/ui/ux-rules.md` - document stable tall-card editing if needed.
- `docs/specs/ui/screen-map.md` - update only if its recorder behavior summary
  needs the one-shot reveal detail.
- UI docs update required?: `yes` if the behavior is described; otherwise record
  the explicit no-update rationale during closeout.
- Tokens/primitives compliance: existing recorder primitives/styles only.
- UI artifacts/screenshots expectation:
  - Required?: `yes`.
  - Evidence: user-run iPhone test with a roughly 20-set exercise after automated gates.

## Testing and verification approach

- Targeted recorder interaction Jest tests with a mocked `ScrollView.scrollTo`.
- `./boga test fast`.
- `./boga test frontend`.
- Human iPhone UX confirmation; no new Maestro UX flow is requested.

## Implementation notes

- Primary code: `apps/mobile/app/(tabs)/session-recorder.tsx`.
- Targeted tests: `apps/mobile/app/__tests__/session-recorder-interactions.test.tsx`.
- Project structure impact: none.
- Restrict edits to focus/scroll refs, append-plan handling, card layout props,
  and task-owned tests/docs to avoid overlap with the other cards.

## Mandatory verify gates

- `./boga test fast`
- `./boga test frontend`
- `./scripts/task-closeout-check.sh <task-card-path>`

## Evidence

- Implemented a one-shot pending exercise-card scroll request in
  `apps/mobile/app/(tabs)/session-recorder.tsx`: append-plan focus still
  highlights the target card, but the pending request is cleared immediately
  after the first successful `ScrollView.scrollTo`.
- Added deterministic delayed-layout coverage in
  `apps/mobile/app/__tests__/session-recorder-interactions.test.tsx`; the test
  proves the first target layout scrolls to the expected offset and a later
  changed layout does not scroll again.
- Focused Jest:
  `npm test -- --runInBand --silent app/__tests__/session-recorder-interactions.test.tsx`
  (from `apps/mobile`) — PASS, 1 suite / 28 tests / 0 snapshots before
  concurrent task-01 edits landed.
- Final task-isolated Jest after concurrent edits:
  `npm test -- --runInBand --silent app/__tests__/session-recorder-interactions.test.tsx -t 'scrolls to an appended plan once after layout and ignores later card layouts'`
  — PASS, 1 passed / 27 skipped. The transient concurrent task-01 assertion
  failure was resolved before the integrated suite ran.
- Canonical behavior updated in `docs/specs/ui/ux-rules.md` and
  `docs/specs/ui/screen-map.md`.
- Integrated verification:
  - ✅ `./boga test fast` (`951` Jest tests passed; lint/typecheck/backend
    smoke/docs/meta lanes passed).
  - ✅ `./boga test frontend` (iOS smoke, data-smoke, auth-profile, and sync-e2e
    lanes passed).
- Human iPhone UX confirmation: ✅ passed on 2026-07-25 with a tall exercise
  card; later row and keyboard layouts did not jump back to the card header.

## Completion note

- What changed: decoupled the persistent selected-card highlight from a
  ref-backed, one-shot scroll request; delayed layout can consume the request,
  while later layout changes are passive measurements.
- What tests ran: focused recorder interaction Jest suite (`28/28`), the
  task-isolated scroll regression (`1/1`), integrated fast/frontend gates, and
  human iPhone UX verification.
- What remains: none.

## Status update checklist

- Fill evidence/completion notes and mark completed only after integrated review.
- Move to `docs/tasks/complete/` when completed.
- Update relevant canonical UI docs or record the no-update rationale.
