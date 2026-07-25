# M19 - Per-Side Muscle Volume and Load Semantics

## Milestone metadata

- Milestone ID: `M19`
- Title: Milestone: Per-Side Muscle Volume and Load Semantics
- Status: `completed`

## Parent references

- Project directives: `docs/specs/README.md`
- Product overview: `docs/specs/00-product.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Sync v2 server contract: `docs/specs/tech/sync-v2-server-contract.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`
- Project structure: `docs/specs/09-project-structure.md`

## Milestone objective

Implement per-side normalized muscle volume so each completed set contributes to
the trained muscle groups according to the exercise's load-entry semantics and
exercise-to-muscle mappings, without changing the existing per-exercise
entered-load volume displays.

## Product rules

1. Muscle volume is reported per side. For symmetric muscles, a muscle group
   value represents one pec, one bicep, one quad, and so on.
2. `loadInputMode` records load distribution semantics, not equipment type or
   implement count. The app must not infer this from words like dumbbell,
   cable, barbell, machine, or kettlebell.
3. `total_load` means the entered weight is a shared total load for a symmetric
   movement, so muscle analytics uses half of the entered load as the per-side
   base.
4. `per_side_load` means the entered weight already represents one side, hand,
   stack, or working limb, so muscle analytics uses the entered load directly as
   the per-side base.
5. One-arm and one-leg exercise rows imply both sides were performed equally in
   v1. There is no left/right side tracking in this milestone.
6. Existing completed history is recomputed from the current exercise metadata;
   no legacy snapshot field preserves old muscle-volume totals.
7. Existing per-exercise volume and record displays remain entered-load volume.

## Load-mode examples

1. Barbell bench press: `total_load`; `45 kg x 1` contributes `22.5` to each pec
   before the primary/secondary role factor.
2. Two-dumbbell bench press: `per_side_load`; `22 kg each x 1` contributes `22`
   to each pec before the primary/secondary role factor.
3. Single-dumbbell two-arm pullover: `total_load`; `22 kg x 1` contributes `11`
   to each side of the mapped symmetric muscle groups before the role factor.
4. One-arm dumbbell row: `per_side_load`; `22 kg x 1` contributes `22` to each
   side of the mapped muscle groups, because v1 treats both sides as performed.

## In scope

- Exercise-level load distribution semantics for `total_load` versus
  `per_side_load`.
- Local SQLite schema, Supabase mirror schema, and Sync v2 push/pull wire updates
  for the new exercise-definition metadata.
- Bundled seed metadata for resolving load-entry mode on starter exercise
  definitions.
- Muscle analytics updates that combine set volume, load-entry mode, and the
  mapping role factor (`primary = 1`, `secondary = 0.5`).
- Exercise editor affordance for custom exercise load-entry mode.
- Session recorder weight-input labels that reflect the selected exercise's
  load-entry mode.
- Focused unit, repository, sync contract, backend, and UI coverage for the new
  semantics.
- Source-of-truth docs updates for data model, sync contract, UI behavior, and
  testing expectations as implementation tasks make the behavior current.
- Stats / History muscle overlays exposing the resulting per-side `Volume`
  alongside `Near failure` in both daily and weekly heatmap views.

## Out of scope

- Left/right side logging or per-side imbalance analytics.
- Per-set overrides for load-entry mode.
- Changing per-exercise volume, highest-weight, estimated 1RM, or past-record
  panels away from entered-load semantics.
- Automatic inference from exercise names at runtime.
- Reworking muscle taxonomy granularity beyond the existing `muscle_groups`
  catalog.
- Adding a shared/global exercise catalogue or group-scoped exercise semantics.

## Deliverables

1. Local and backend schema support for exercise load-entry mode, including Sync
   v2 serialization, pull projection, drift checks, and docs.
2. Bundled starter-catalog load-mode metadata with validation that every seeded
   exercise has an explicit resolved mode.
3. Muscle analytics math that computes per-side muscle contribution from parsed
   set values, resolved exercise load mode, and primary/secondary role.
4. Exercise editor and recorder UI updates for visible load-entry selection and
   clear `kg total` / `kg per side` labeling.
5. Test coverage for analytics examples, repository projection, schema/wire
   round trips, backend sync contracts, and UI behavior.
6. Updated project-level data model, sync contract, testing, and UI docs where
   behavior becomes source of truth.
7. Muscle-history daily and weekly heatmaps with selectable `Volume` and
   `Near failure` metrics, defaulting to `Volume`.

## Acceptance criteria

1. Barbell bench `45 kg x 1` contributes `22.5` to chest per side when chest is
   the primary muscle mapping.
2. Dumbbell bench `22 kg each x 1` contributes `22` to chest per side when chest
   is the primary muscle mapping.
3. Combining those two sets reports `44.5` per-side chest volume.
4. Single-dumbbell two-arm pullover uses `total_load`, so `22 kg x 1`
   contributes `11` per side before the role factor.
5. One-arm dumbbell row uses `per_side_load`, and a logged set implies both
   sides were performed in v1.
6. Primary muscle contribution uses factor `1`; secondary contribution uses
   factor `0.5`. Persisted mapping weight does not change muscle volume, while
   null or stabilizer role mappings remain excluded from totals.
7. Existing completed history recomputes when an exercise's load-entry mode is
   changed.
8. Custom exercises can be saved with total-load or per-side load-entry mode.
9. Recorder set rows label weight entry according to the selected exercise's
   resolved load-entry mode.
10. Per-exercise history and current-session record panels continue to display
   entered-load volume.
11. Sync restore preserves load-entry mode across devices and after reinstall.
12. Required local gates for each implementation slice are green before that
    slice is marked complete.
13. Selecting a muscle or muscle family in Stats / History exposes `Volume` and
    `Near failure`; daily and weekly volume use the M19 per-side, role-weighted
    aggregation across the selected muscle IDs, while muscle-level 1RM and Top
    weight remain unavailable.

## Task breakdown

Completed task cards for this milestone:

1. `docs/tasks/complete/M19-T01-Audit_current_volume_and_load_semantics.md` - Audit current exercise, muscle, stats, and UI volume semantics (`completed`).
2. `docs/tasks/complete/M19-T02-Add_load_input_mode_schema_and_sync_contract.md` - Add exercise load-entry mode to local schema, Supabase mirror, sync wire, and drift docs/tests (`completed`).
3. `docs/tasks/complete/M19-T03-Add_seeded_exercise_load_mode_metadata.md` - Add and validate bundled load-mode defaults for every system exercise definition (`completed`).
4. `docs/tasks/complete/M19-T04-Update_per_side_muscle_analytics.md` - Update analytics aggregation to use per-side load mode and primary/secondary role factors (`completed`).
5. `docs/tasks/complete/M19-T05-Expose_load_mode_in_exercise_editor.md` - Add visible load-entry controls for custom exercises (`completed`).
6. `docs/tasks/complete/M19-T06-Label_recorder_weight_entry_by_load_mode.md` - Show recorder weight-entry labels derived from resolved exercise mode (`completed`).
7. `docs/tasks/complete/M19-T07-Update_stats_history_docs_and_ui_contracts.md` - Update source-of-truth docs for data, sync, stats, and UI behavior (`completed`).
8. `docs/tasks/complete/M19-T08-Add_backend_and_sync_contract_coverage.md` - Add backend/schema/wire tests proving load-mode round trip and restore behavior (`completed`).
9. `docs/tasks/complete/M19-T09-Run_full_feature_gates_and_close_milestone.md` - Run required fast, backend, and frontend gates and close the milestone (`completed`).
10. `docs/tasks/complete/M19-T10-Expose_per_side_volume_in_muscle_history.md` - Expose per-side Volume alongside Near failure in muscle-history daily and weekly views (`completed`).

## Risks / dependencies

- The current app stores one `exercise_sets.weight_value` scalar, so load-entry
  semantics must live on exercise metadata unless a later milestone introduces
  per-set overrides.
- Seeded exercise rows are user-owned synced entities; changing bundled metadata
  must preserve user edits while still resolving a deterministic default for
  starter exercises.
- Muscle mappings retain both role and legacy weight metadata; M19 muscle
  analytics intentionally derives its fixed factor from role and ignores the
  persisted weight value.
- Sync v2 mirrors typed columns exactly, so schema changes must update local
  Drizzle schema, generated migrations, Supabase migrations, RPC field lists,
  drift checks, and contract tests together.
- UI copy must make `kg total` versus `kg per side` clear without slowing normal
  set entry.

## Completion note (fill when milestone closes)

- What changed: added durable exercise load semantics, deterministic seed/backfill
  metadata, per-side muscle analytics, editor controls, recorder labels, Sync v2
  round trips, and source-of-truth documentation. Corrective task `M19-T10`
  exposes the resulting per-side Volume alongside Near failure in both daily and
  weekly muscle history.
- Verification summary: the original milestone's `./boga test fast`,
  `./boga test backend`, and `./boga test frontend` passed locally. The `M19-T10`
  corrective slice additionally passed focused analytics/screen Jest, the
  focused muscle-history Maestro flow, `./boga test fast`, and
  `./boga test frontend`, including the iOS sync round trip.
- What remains: nothing for M19; left/right tracking and per-set load-mode
  overrides remain out of scope for a future milestone.

## Status update checklist (mandatory during task closeout)

- Keep milestone `Status` current as tasks progress.
- Update task breakdown entries to reflect each task state (`planned | in_progress | completed | blocked | outdated`).
- If milestone remains open after a session, record why in the active task
  completion note and/or milestone completion note (status remains `in_progress`).
