---
task_id: T-20260726-01-History_set_and_failure_counts
milestone_id: "MVP"
status: planned
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo|maestro|supabase|docs"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend; ./boga test frontend"
docs_touched: "docs/specs/ui/ux-rules.md, docs/specs/ui/screen-map.md"
---

# Replace Per-Exercise and Per-Muscle Sessions with Set and Failure Counts

## Task metadata

- Task ID: `T-20260726-01-History_set_and_failure_counts`
- Title: Replace per-exercise and per-muscle sessions with set and failure counts
- Status: `planned`
- File location rule:
  - keep this active card at
    `docs/tasks/T-20260726-01-History_set_and_failure_counts.md`
  - move it to `docs/tasks/complete/` when completed or outdated
- Session date: 2026-07-26
- Session interaction mode: `interactive`

## Parent references (required)

- Project directives: `AGENTS.md`, `docs/specs/README.md`
- Milestone spec: N/A - user-requested Stats / History refinement.
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit:
  `codex/history-set-failure-task-card` at
  `91a7b8800f35a00294dd8e4470722cfefa12a4fc`.
- Start-of-session sync with `origin/main` completed?: `yes`; fetched
  `origin/main` and created the branch directly from the fetched ref.
- Parent refs opened in this session:
  - `AGENTS.md`
  - `docs/specs/01-worktree-and-environment.md`
  - `docs/specs/02-quality-and-test-gates.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/12-worktree-config-and-isolation.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/ui/screen-map.md`
  - `apps/mobile/app/__tests__/README.md`
- Code/docs inventory freshness checks run:
  - `apps/mobile/app/(tabs)/stats-history.tsx` inspected on 2026-07-26:
    exercise, muscle, and family rows currently render `Sessions`; muscle and
    family volume is labelled `Total weight`.
  - `apps/mobile/src/data/stats.ts` inspected on 2026-07-26: muscle/family
    aggregates expose session count and role-weighted volume but no set or
    near-failure count.
  - `apps/mobile/src/data/exercise-catalog-stats.ts` inspected on 2026-07-26:
    exercise aggregates expose session count, raw volume, and estimated 1RM but
    no set or near-failure count.
  - `apps/mobile/src/data/muscle-analytics.ts` inspected on 2026-07-26:
    the shared contribution path already implements the adopted BoGa3 per-side,
    role-weighted muscle-volume formula.
  - `./boga test for <planned paths>` run on 2026-07-26: required gate union is
    `fast`, `backend`, `frontend`, and `docs-check`.
- Known stale references or assumptions:
  - The user's word `failures` means the app's existing `Near failure` metric:
    valid performed `rir_0`, `rir_1`, or `rir_2` sets. It does not mean strict
    `rir_0` only.
  - The top-level Sessions summary card and `/sessions` drill-down are not
    per-exercise/per-muscle metrics and remain unchanged.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260726-01-History_set_and_failure_counts.md`

## Objective

Replace the per-row Sessions metric in the Stats / History exercise and muscle
views with a compact set count whose parenthesized value is the number of
near-failure sets, while preserving exercise metrics and guaranteeing that
muscle volume continues to use the adopted BoGa3 calculation.

The intended row value is:

```text
Sets
12 (3)
```

where `12` is the valid performed-set count and `3` is the subset marked
`rir_0`, `rir_1`, or `rir_2`.

## Scope

### In scope

- Add valid performed-set and near-failure counts to the derived exercise,
  muscle, and muscle-family aggregates used by `stats-history`.
- Replace per-exercise, per-muscle, and per-family `Sessions` metrics with
  `Sets`, displayed as `<set count> (<near-failure count>)`.
- Rename the muscle/family UI metric from `Total weight` to `Volume`.
- Keep exercise-row raw volume and estimated 1RM.
- Rank the exercise list by set count descending, with exercise name as a
  deterministic tie-breaker, instead of sorting by a hidden session count.
- Replace the muscle/family previous-period Sessions delta with a set-count
  delta. The parenthesized near-failure value is the current-period count; it
  does not need its own delta.
- Preserve the existing empty, loading, error, search, row-press, and overlay
  behavior.
- Update focused aggregation/UI tests and the canonical UI docs.

### Out of scope

- Removing or changing the top-level Sessions summary card.
- Changing `/sessions`, completed-session detail, recorder Past Records, or the
  exercise/muscle heatmap overlays.
- Changing set-type storage or introducing a new strict-failure field.
- Changing the BoGa3 muscle-volume formula.
- Changing exercise-level volume, highest-weight, or estimated-1RM semantics.
- Schema, migration, Supabase, RLS, sync-envelope, or backend-table changes.
- Introducing a new reusable UI primitive.

## UI Impact (required checkpoint)

- UI Impact?: `yes`
- This changes the information hierarchy of existing Stats / History rows but
  introduces no new route, modal, navigation transition, or interaction pattern.
- Reuse the route-local `Metric` presentation, existing row/card layout, and
  existing UI tokens. No raw color literal or new global primitive is planned.

## UX Contract

### Key user flows

1. Flow name: Review exercise history at a glance
   - Trigger: user opens Stats / History in the per-exercise view.
   - Steps: user scans an exercise row and may tap it to open the existing
     exercise-history overlay.
   - Success outcome: the row shows `Sets` as `<count> (<near-failure count>)`,
     followed by raw exercise `Volume` and `1RM`; no per-exercise Sessions
     metric is visible, and exercises are ranked by set count.
   - Failure/edge outcome: an exercise with historical rows but no valid
     performed sets displays `0 (0)` without crashing, while the existing empty,
     error, and overlay behavior remains available.
2. Flow name: Review muscle history at a glance
   - Trigger: user switches to the per-muscle view for the selected period.
   - Steps: user scans family and muscle rows and may tap an actionable row to
     open the existing muscle-history overlay.
   - Success outcome: each row shows `Sets` as
     `<count> (<near-failure count>)` and `Volume`; the volume is the BoGa3
     per-side, role-weighted value and the previous-period set/volume deltas
     remain readable.
   - Failure/edge outcome: untrained rows show `0 (0)` and zero volume with the
     existing muted treatment; one physical set mapped to multiple muscles in
     the same family is not duplicated in the family set/failure count.

### Interaction + appearance notes

- Use the exact compact numeric format `<sets> (<near failure>)`.
- Keep labels short: `Sets`, `Volume`, and `1RM`.
- Preserve the current card density, alignment, typography, and press targets.
- Make accessibility copy explicit, for example
  `12 sets, 3 near-failure sets`; parentheses must not be the only explanation.
- Reuse `uiColors` and existing styles; no new raw literals.

## Counting and calculation contract

### Valid set and failure counts

- A counted set must be a completed-history, non-deleted performed set with a
  valid non-negative parsed weight and positive integer parsed reps.
- `0kg` with positive integer reps is valid.
- Valid `warm_up` rows count toward set count and volume, but never toward
  near-failure count.
- A valid `rir_0`, `rir_1`, or `rir_2` row increments both set count and
  near-failure count.
- Null/unknown set types increment set count only.
- Blank/invalid rows and unperformed/skipped planned rows do not contribute.
- A valid set contributes once to each primary or secondary mapped muscle.
  Stabilizer and null-role mappings do not contribute.
- A family count is the union of physical set identities across its contributing
  member muscles, so one source set mapped to two muscles in the same family
  counts once for the family. Family volume remains the aggregate of the member
  muscle contributions.

### BoGa3 muscle volume

All muscle and family volume must continue to derive from the shared contribution
path in `apps/mobile/src/data/muscle-analytics.ts`:

1. Parse entered volume as `weight × reps`.
2. Divide by two when `load_input_mode = total_load`.
3. Preserve entered volume when `load_input_mode = per_side_load`.
4. Apply the mapping role factor after normalization:
   - primary: `1`
   - secondary: `0.5`
   - stabilizer or null role: `0`
5. Ignore persisted `exercise_muscle_mappings.weight`.

Exercise history volume remains entered-scalar `weight × reps`; it must not use
per-side normalization or muscle-role factors.

## Acceptance criteria

1. No exercise, muscle, or muscle-family row in Stats / History displays a
   Sessions metric.
2. Every such row displays `Sets` with the exact value format
   `<set count> (<near-failure count>)`.
3. The top-level Sessions summary card and `/sessions` navigation remain
   unchanged.
4. Exercise rows retain raw Volume and 1RM and sort by set count descending,
   then exercise name.
5. Muscle and family rows display `Volume`, not `Total weight`, and their
   previous-period deltas use set count plus volume.
6. Set/failure counts follow the valid-set, warm-up, near-failure, mapping-role,
   and family-deduplication rules above.
7. Muscle volume follows the BoGa3 per-side/role formula above for both the
   current and previous periods.
8. Tests prove `total_load`, `per_side_load`, primary, secondary, stabilizer,
   legacy mapping weight, warm-up, zero-load, invalid-set, and family
   deduplication behavior.
9. Screen tests cover the exact row copy/value format, removal of per-row
   Sessions, accessibility wording, zero/empty behavior, and unchanged row
   navigation.
10. Existing loading/error/search/overlay tests remain green.
11. No raw color literals are introduced, and existing tokens/styles are reused.
12. Canonical UI documentation describes the new row metrics and exercise-list
   ordering.

## Docs touched (required)

- Planned docs/spec files to update:
  - `docs/specs/ui/ux-rules.md` - replace the current exercise-list
    session-count contract with set/near-failure display and document muscle-row
    metric semantics.
  - `docs/specs/ui/screen-map.md` - update the `/stats-history` summary so the
    exercise and muscle views describe Sets, parenthesized near-failure count,
    and Volume.
- UI docs update required?: `yes`; this is an app-specific row-semantics change
  covered by trigger 4 in `docs/specs/ui/README.md`.
- `docs/specs/ui/navigation-contract.md`: no update; routes, params, redirects,
  and transitions do not change.
- `docs/specs/ui/components-catalog.md`: no update; no reusable component or
  primitive API changes.
- `docs/specs/08-ux-delivery-standard.md`: no update; no new cross-task UX
  pattern is introduced.
- `docs/specs/03-technical-architecture.md`: no update expected; the adopted
  muscle-volume calculation is preserved.
- `docs/specs/05-data-model.md`: no update expected; its valid-set, warm-up,
  exercise-volume, and muscle-volume contracts remain authoritative.
- Tokens/primitives compliance statement:
  - Reuse plan: existing `Metric`, Stats / History row/card styles, `uiColors`,
    typography, spacing, and press targets.
  - Exceptions: none planned; no raw literals or screen-local one-off pattern is
    needed.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md`?: `yes`.
  - Planned captures: one populated per-exercise view and one populated
    per-muscle view showing the new set/failure and Volume metrics; include an
    untrained/zero row if it fits the populated muscle capture, otherwise capture
    it separately.

## Testing and verification approach

- Planned targeted checks:
  - `apps/mobile/app/__tests__/exercise-catalog-stats.test.ts`
    - exercise set/failure counts, valid/invalid/zero-load/warm-up semantics.
  - `apps/mobile/app/__tests__/stats-repository.test.ts`
    - muscle and family set/failure counts, family physical-set deduplication,
      and BoGa3 volume through the Stats summary path.
  - `apps/mobile/app/__tests__/muscle-analytics.test.ts`
    - retain or strengthen direct total-load/per-side and role-factor regression
      coverage where the Stats repository cases do not already prove it.
  - `apps/mobile/app/__tests__/stats-screen.test.tsx`
    - exact labels/values, accessibility, exercise sorting, top-level Sessions
      preservation, and unchanged empty/error/row-press behavior.
- Targeted test command:
  - from `apps/mobile/`:
    `npm test -- --runInBand app/__tests__/exercise-catalog-stats.test.ts app/__tests__/stats-repository.test.ts app/__tests__/muscle-analytics.test.ts app/__tests__/stats-screen.test.tsx`
- Additional UI guardrail:
  - from `apps/mobile/`: `npm run lint:ui-guardrails`
- Test layers covered: pure calculation/aggregation unit tests, RNTL screen
  behavior tests, full mobile/repository regression, local backend contract
  gate required by path triggers, and iOS simulator UI evidence.
- Execution triggers: targeted tests during implementation; all required gates
  at closeout.
- Slow-gate triggers:
  - `./boga test backend` is required by the current
    `apps/mobile/src/data/**` path trigger even though no schema or wire contract
    change is planned.
  - `./boga test frontend` is required because
    `apps/mobile/app/(tabs)/stats-history.tsx` is a user-facing route.
- Hosted/deployed smoke ownership: N/A; no hosted-only behavior changes.
- CI/manual posture note: CI covers infra-free mobile checks only. The
  implementing agent must run and record the local backend and frontend gates,
  including Maestro artifact paths, before closeout.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/app/(tabs)/stats-history.tsx`
  - `apps/mobile/src/data/stats.ts`
  - `apps/mobile/src/data/exercise-catalog-stats.ts`
  - `apps/mobile/src/data/muscle-analytics.ts` only if a small shared identity or
    valid-set helper is needed; do not fork the volume formula
  - `apps/mobile/app/__tests__/exercise-catalog-stats.test.ts`
  - `apps/mobile/app/__tests__/stats-repository.test.ts`
  - `apps/mobile/app/__tests__/muscle-analytics.test.ts`
  - `apps/mobile/app/__tests__/stats-screen.test.tsx`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/ui/screen-map.md`
- Prefer a shared pure formatter for `<sets> (<near failure>)` if both exercise
  and muscle rows need identical presentation/accessibility behavior; do not
  extract a global primitive for one screen.
- Rename ambiguous derived `totalWeight` fields to `totalVolume` within the
  touched Stats aggregation types if it keeps the patch coherent. This is an
  internal derived-data rename, not a stored-column change.
- Preserve physical set identity through aggregation so family counts can
  deduplicate without relying on weight/reps text equality.
- Keep muscle volume sourced from `collectMuscleSetContributions`; do not
  reimplement per-side or mapping-role arithmetic inside the screen.
- Project structure impact: none; all changes stay in established app/data/test
  and canonical UI-doc locations.
- Sync impact decision: out of sync scope. This task adds only transient derived
  aggregate fields and display copy; it does not change stored entities,
  relationships, ownership, schema, or the sync envelope.
- Constraints/assumptions:
  - `failures` means the existing near-failure set types
    `rir_0 | rir_1 | rir_2`.
  - The parenthesized count is a subset of the leading set count.
  - Warm-ups count in the leading number but not in parentheses.

## Mandatory verify gates

- Targeted Jest command listed above.
- `npm run lint:ui-guardrails` from `apps/mobile/`.
- `./boga test fast`.
- `./boga test backend`.
- `./boga test frontend`.
- `./boga test for` and record the final path-trigger explanation.
- `./scripts/task-closeout-check.sh docs/tasks/T-20260726-01-History_set_and_failure_counts.md`

## Evidence

- Targeted test results:
- `./boga test for` required-gate output:
- `./boga test fast` result:
- `./boga test backend` result:
- `./boga test frontend` result and Maestro artifact paths:
- UI/UX visual artifacts:
  - populated per-exercise Stats / History view:
  - populated per-muscle Stats / History view:
  - zero/untrained row if captured separately:
- UX Contract traceability:
- Manual verification summary (required when CI is absent/partial):
- Deferred/manual hosted checks summary: N/A - no hosted-only behavior.

## Completion note

- What changed:
- What tests ran:
- What remains:

## Status update checklist (mandatory at closeout)

- Update Status and frontmatter to `completed`, `blocked`, or `outdated`.
- If completed or outdated, move this card to `docs/tasks/complete/` and update
  affected references in the same session.
- Fill the Evidence and Completion note sections before handoff.
- Update `docs/specs/ui/ux-rules.md` and `docs/specs/ui/screen-map.md`.
- Re-check whether any actual implementation choice changes architecture or
  data-model contracts; update the owning specs if it does.
- Run the final path-trigger query and every required local gate.
- Run
  `./scripts/task-closeout-check.sh docs/tasks/T-20260726-01-History_set_and_failure_counts.md`.
