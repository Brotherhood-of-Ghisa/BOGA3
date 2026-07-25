---
task_id: T-20260725-01-Fix_recorder_weight_input_hit_area
milestone_id: "MVP"
status: completed
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo|maestro|docs"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/ux-rules.md, docs/specs/ui/screen-map.md"
---

# Fix Recorder Weight Input Hit Area

## Task metadata

- Task ID: `T-20260725-01-Fix_recorder_weight_input_hit_area`
- Title: Fix recorder weight input hit area
- Status: `completed`
- Session date: 2026-07-25
- Session interaction mode: `interactive`

## Parent references

- Project directives: `AGENTS.md`, `docs/specs/README.md`
- Milestone spec: N/A - user-requested UX correction.
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`

## Context Freshness

- Verified current branch + HEAD commit: `codex/recorder-ux-integrity-fixes` at `8119a62`.
- Start-of-session sync with `origin/main` completed?: `yes`; branch created from current `main...origin/main`.
- Parent refs opened in this session:
  - `docs/specs/02-quality-and-test-gates.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/ux-rules.md`
- Code/docs inventory freshness checks run:
  - Recorder weight input, suffix, styles, and current tests inspected on 2026-07-25.
  - Commit `fd9bb6c9` inspected to confirm the long suffix replaced `kg` without a layout change.
- Known stale references or assumptions: none.

## Objective

Restore a visible, reliably tappable numeric weight field for total-load and
per-side exercises without repeating a long load-mode suffix inside every narrow
set-row input.

## Scope

### In scope

- Move `Total load` / `Per side` meaning to exercise-card metadata.
- Keep a compact `kg` suffix in each editable weight field.
- Make taps on the full weight shell focus its `TextInput`.
- Reserve a usable numeric-input width on supported phone layouts.
- Preserve existing keyboard, validation, and saved scalar behavior.

### Out of scope

- Blank-weight-to-zero semantics; `T-20260725-03` owns that behavior.
- Exercise-card autoscroll; `T-20260725-02` owns it.
- Exercise editor load-mode selection.

## UI Impact

- UI Impact?: `yes`
- Existing `uiColors`, spacing tokens, recorder row structure, and shared card
  primitives must be reused. No raw color literals or new global primitive are
  planned.

## UX Contract

### Key user flows

1. Flow name: Enter total-load weight
   - Trigger: user edits a set for a total-load exercise.
   - Steps: user taps anywhere within the weight field and types a decimal value.
   - Success outcome: digits remain visible, the decimal keyboard opens, and the
     exercise card clearly communicates `Total load`.
   - Failure/edge outcome: a narrow screen must not collapse the editable digits.
2. Flow name: Enter per-side weight
   - Trigger: user edits a set for a per-side exercise.
   - Steps: user taps the weight field, including its `kg` suffix area, and types.
   - Success outcome: the input receives focus and the card clearly communicates
     `Per side`.
   - Failure/edge outcome: tapping non-editable load-mode copy must not create a
     dead input region.

### Interaction + appearance notes

- Load mode is exercise-level information and should appear once per card.
- Set rows retain the compact `kg` suffix.
- The entire bordered weight shell is one focus target.
- Preserve current compact row density and quality/reps controls.

## Acceptance criteria

1. Weight digits have a non-zero usable width for both load modes.
2. Tapping the weight shell or suffix focuses the decimal `TextInput`.
3. Exercise-card metadata communicates `Total load` or `Per side`.
4. The per-set suffix is compact and does not repeat the long mode label.
5. Saved scalar values and input validation remain unchanged.
6. Targeted component tests cover total/per-side copy and shell focus behavior.
7. No raw color literals are introduced.

## Docs touched

- `docs/specs/ui/ux-rules.md` - update the recorder weight-label and focus semantics.
- `docs/specs/ui/screen-map.md` - keep the recorder set-row summary accurate.
- UI docs update required?: `yes`.
- Tokens/primitives compliance:
  - Reuse plan: existing recorder styles plus `uiColors`/spacing tokens.
  - Exceptions: none planned.
- UI artifacts/screenshots expectation:
  - Required?: `yes`.
  - Evidence: user-run iPhone dev-build confirmation for total-load and per-side
    entry after automated gates pass.

## Testing and verification approach

- Targeted recorder interaction Jest tests.
- `./boga test fast`.
- `./boga test frontend` because recorder UI changes require local iOS lanes.
- Human UX confirmation on the user's iPhone; no new Maestro UX flow is requested.

## Implementation notes

- Primary code: `apps/mobile/app/(tabs)/session-recorder.tsx`.
- Targeted tests: `apps/mobile/app/__tests__/session-recorder-interactions.test.tsx`.
- Project structure impact: none.
- Coordinate with the other two cards by editing only the weight-row/render/style
  regions and task-owned tests/docs.

## Mandatory verify gates

- `./boga test fast`
- `./boga test frontend`
- `./scripts/task-closeout-check.sh <task-card-path>`

## Evidence

- `apps/mobile/app/(tabs)/session-recorder.tsx`
  - Exercise metadata now shows `Weight entry: Total load` or
    `Weight entry: Per side`.
  - Editable set rows use the compact `kg` suffix.
  - The full bordered weight shell requests focus on its `TextInput`.
  - The shell/input reserve `82`/`44` points respectively so the editable digits
    cannot collapse to zero width.
- `apps/mobile/app/__tests__/session-recorder-interactions.test.tsx`
  - Total-load coverage asserts card-level mode copy, compact suffix, reserved
    digit width, and unchanged decimal entry.
  - Per-side coverage asserts card-level mode copy, compact suffix, focus
    requests from both suffix and shell presses, and unchanged scalar input.
- Focused verification:
  - ✅ `npm test -- --runInBand --silent app/__tests__/session-recorder-interactions.test.tsx`
    (`28` passed, `0` failed).
  - ✅ `./boga test typecheck`.
  - ✅ `./boga test lint` (`0` errors; `15` existing warnings outside this task's
    changed lines).
  - ✅ `./boga test docs-check`.
- Integrated verification:
  - ✅ `./boga test fast` (`951` Jest tests passed; lint/typecheck/backend
    smoke/docs/meta lanes passed).
  - ✅ `./boga test frontend` (iOS smoke, data-smoke, auth-profile, and sync-e2e
    lanes passed).
- Human iPhone UX confirmation: ✅ passed on 2026-07-25 for total-load and
  per-side entry, visible digits, suffix/shell taps, and numeric keyboard entry.

## Completion note

- What changed: load mode moved from the narrow set suffix to exercise metadata;
  the set suffix is now `kg`, the input has reserved width, and tapping the
  bordered shell/suffix focuses the weight input. Canonical UI docs match the
  new behavior.
- What tests ran: focused recorder interactions (`28/28`), integrated fast and
  frontend gates, typecheck, lint, docs-check, and human iPhone UX verification.
- What remains: none.

## Status update checklist

- Fill evidence/completion notes and mark completed only after integrated review.
- Move to `docs/tasks/complete/` when completed.
- Update canonical UI docs.
