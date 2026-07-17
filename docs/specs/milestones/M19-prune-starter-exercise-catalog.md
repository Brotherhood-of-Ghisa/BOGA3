# M19 - Prune Starter Exercise Catalog

## Milestone metadata

- Milestone ID: `M19`
- Title: Milestone: Prune Starter Exercise Catalog
- Status: `planned`

## Parent references

- Project directives: `docs/specs/README.md`
- Product overview: `docs/specs/00-product.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Sync v2 server contract: `docs/specs/tech/sync-v2-server-contract.md`
- Project structure: `docs/specs/09-project-structure.md`

## Milestone objective

Reduce the built-in starter exercise catalog to a compact, equipment-specific,
singular-named set while preserving user-added exercises and ensuring synced
remote state does not re-populate suppressed bundled rows.

## In scope

- Prune the bundled `seed_*` starter exercise definitions to a curated keep set
  finalized by task `M19-T01`; the originally proposed 70-row target is not
  authoritative.
- Prefer singular, equipment-specific names for kept seeds.
- Preserve incline variants as distinct exercises. Incline movements are not
  duplicates of flat/non-incline movements, and current `Incline` seed rows must
  stay active unless a future task records an explicit user-approved exception.
- Remove suppressed bundled exercises from new-user seeding by pruning the seed
  definition, mapping, documentation, and rationale rows.
- Preserve user-added exercises and user-renamed seed exercises.
- Tombstone suppressed bundled seed rows and their mappings for existing synced
  users instead of physically deleting them.
- Add bundle-migration coverage so existing clients push seed renames and
  tombstones through normal Sync v2 LWW flow.
- Add a Supabase cleanup migration for already-synced remote rows.
- Update regression coverage for seed counts, duplicate suppression, bootstrap,
  and sync non-repopulation behavior.

## Out of scope

- Implementing a shared/global exercise catalog.
- Auto-merging historical `session_exercises.exercise_definition_id` references
  from suppressed seed IDs into kept seed IDs.
- Deleting or modifying non-`seed_*` user-created exercises.
- Changing Sync v2 wire shape, table schema, RLS policy shape, or ownership
  model.
- Building new UI for catalog merge decisions.
- Implementing any M18 group exercise catalog behavior.

## Keep-set policy

Task `M19-T01` owns the final keep/suppress table and must update this milestone
with the exact active exercise and mapping counts before implementation closes.
It must treat each modifier that changes the performed movement as a candidate
for preservation rather than a duplicate. That includes at least:

- incline / decline / flat angle,
- equipment (`barbell`, `dumbbell`, `cable`, `machine`, `Smith machine`,
  `kettlebell`, bodyweight),
- body position (`seated`, `standing`, `lying`),
- grip or stance (`close-grip`, `wide-grip`, `sumo`, `front`, `back`),
- unilateral or alternating variants where the movement pattern meaningfully
  differs.

Current seed rows containing `Incline` must remain distinct active exercises
unless a future task records an explicit user-approved exception:

1. `seed_incline_dumbbell_press` - Incline Dumbbell Press
2. `seed_incline_dumbbell_flys` - Incline Dumbbell Flys
3. `seed_incline_machine_bench_presses` - Incline Machine Bench Presses
4. `seed_incline_barbell_bench_presses` - Incline Barbell Bench Presses
5. `seed_incline_cable_bench_presses` - Incline Cable Bench Presses
6. `seed_incline_dumbbell_bench_presses` - Incline Dumbbell Bench Presses
7. `seed_incline_smith_machine_bench_presses` - Incline Smith Machine Bench Presses
8. `seed_ball_incline_push-ups` - Ball Incline Push-Ups
9. `seed_incline_push-ups` - Incline Push-Ups
10. `seed_incline_dumbbell_pullover` - Incline Dumbbell Pullover
11. `seed_incline_barbell_rows` - Incline Barbell Rows
12. `seed_incline_dumbbell_rows` - Incline Dumbbell Rows
13. `seed_reverse_incline_barbell_rows` - Reverse Incline Barbell Rows
14. `seed_close-grip_incline_dumbbell_bench_presses` - Close-Grip Incline Dumbbell Bench Presses
15. `seed_close-grip_incline_push-ups` - Close-Grip Incline Push-Ups
16. `seed_incline_low_cable_triceps_extensions` - Incline Low Cable Triceps Extensions
17. `seed_alternating_incline_dumbbell_curls` - Alternating Incline Dumbbell Curls
18. `seed_alternating_incline_hammer_curls` - Alternating Incline Hammer Curls
19. `seed_incline_dumbbell_curls` - Incline Dumbbell Curls
20. `seed_incline_hammer_curls` - Incline Hammer Curls
21. `seed_alternating_incline_dumbbell_twist_curls` - Alternating Incline Dumbbell Twist Curls
22. `seed_incline_dumbbell_twist_curls` - Incline Dumbbell Twist Curls
23. `seed_incline_leg_raises` - Incline Leg Raises
24. `seed_incline_sit-ups` - Incline Sit-Ups
25. `seed_incline_twist_sit-ups` - Incline Twist Sit-Ups

## Duplicate suppression rules

- Suppress plural variants where a singular seed remains, for example
  `Barbell Bench Presses` -> `Barbell Bench Press`, `Leg Presses` -> `Leg Press`,
  and `Standing Calf Raises` -> `Standing Calf Raise`.
- Do not suppress an incline exercise in favor of a flat/non-incline exercise.
  `Incline Dumbbell Press` and `Dumbbell Bench Press` are different exercises,
  and machine/cable/Smith/barbell/dumbbell incline variants remain distinct by
  default.
- Prefer explicit equipment names over generic names, for example keep
  `Barbell Squat` over generic squat variants and keep machine/cable variants
  only when they represent common distinct equipment.
- Tombstone suppressed bundled rows instead of hard-deleting them so pulls
  convey the suppression to existing clients and wiped devices.
- Preserve non-`seed_*` exercise IDs and seed rows whose name no longer matches
  the prior bundle value, treating them as user-authored or user-renamed.

## Deliverables

1. Pruned seed bundle with validation still passing.
2. Client bundle migration for kept-row renames and suppressed-row tombstones.
3. Supabase remote cleanup migration for existing synced rows.
4. Regression coverage for seed shape, duplicate suppression, sync push/pull,
   and frontend catalog visibility.
5. Final rollout/closeout notes documenting old-client caveats and verification.

## Acceptance criteria

1. A fresh local seed contains the finalized M19 active exercise and mapping
   counts recorded by `M19-T01`.
2. Every remaining seeded exercise has at least one active mapping and valid
   seed documentation.
3. All current `Incline` seed rows remain active unless this milestone records
   an explicit user-approved exception.
4. Default exercise catalog and recorder picker views hide suppressed exercises.
5. User-created exercises remain visible and untouched.
6. User-renamed seed rows are not overwritten or tombstoned by the bundle
   migration.
7. Existing clients push tombstones for suppressed seed rows and remote state
   does not re-populate them on a subsequent pull.
8. Hosted cleanup is idempotent and operates only on exact known `seed_*` IDs.
9. Required local gates are green before the milestone closes.

## Task breakdown

1. `docs/tasks/M19-T01-Prune_starter_catalog_seed_bundle.md` - Prune starter catalog seed bundle (`planned`).
2. `docs/tasks/M19-T02-Add_catalog_bundle_migration_for_existing_clients.md` - Add catalog bundle migration for existing clients (`planned`).
3. `docs/tasks/M19-T03-Add_remote_catalog_cleanup_migration.md` - Add remote catalog cleanup migration (`planned`).
4. `docs/tasks/M19-T04-Add_catalog_prune_regression_tests.md` - Add catalog prune regression tests (`planned`).
5. `docs/tasks/M19-T05-Verify_frontend_catalog_and_picker_behaviour.md` - Verify frontend catalog and picker behaviour (`planned`).
6. `docs/tasks/M19-T06-Rollout_and_closeout_catalog_prune.md` - Rollout and closeout catalog prune (`planned`).

## Risks / dependencies

- An old app build can still seed the previous long bundle for a brand-new empty
  account until that build is retired; cleanup must be idempotent and may need
  to be rerun after rollout.
- Suppressed rows may still be referenced by historical `session_exercises`.
  History should continue to render from persisted session exercise display
  names rather than requiring active catalog rows.
- Data changes touch Sync v2 behavior even without schema changes; local backend
  and iOS sync gates are required for the implementation slices that dirty or
  pull tombstones.

## Completion note (fill when milestone closes)

- What changed:
- Verification summary:
- What remains:

## Status update checklist (mandatory during task closeout)

- Keep milestone `Status` current as tasks progress.
- Update task breakdown entries to reflect each task state (`planned | in_progress | completed | blocked | outdated`).
- If milestone remains open after a session, record why in the active task completion note and/or milestone completion note (status remains `in_progress`).
