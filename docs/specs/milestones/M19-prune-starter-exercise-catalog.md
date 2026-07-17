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

- Prune the bundled `seed_*` starter exercise definitions to the approved
  curated 70-exercise keep set.
- Prefer singular, equipment-specific names for kept seeds.
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

## Approved keep set

The final starter seed bundle should keep these 70 exercise definition IDs:

1. `seed_barbell_bench_press`
2. `seed_dumbbell_bench_press`
3. `seed_incline_dumbbell_press`
4. `seed_incline_barbell_bench_presses`
5. `seed_machine_bench_presses`
6. `seed_smith_machine_bench_presses`
7. `seed_push_up`
8. `seed_parallel_bar_dips`
9. `seed_cable_flys`
10. `seed_dumbbell_fly`
11. `seed_seated_dumbbell_overhead_press`
12. `seed_standing_barbell_overhead_press`
13. `seed_dumbbell_lateral_raise`
14. `seed_machine_lateral_raises`
15. `seed_face_pull`
16. `seed_reverse_machine_flys`
17. `seed_barbell_upright_rows`
18. `seed_lat_pulldown`
19. `seed_pull_up`
20. `seed_chin-ups`
21. `seed_seated_cable_row`
22. `seed_barbell_bent_over_row`
23. `seed_dumbbell_row`
24. `seed_t-bar_rows`
25. `seed_seated_machine_rows`
26. `seed_machine_pullovers`
27. `seed_machine_back_extensions`
28. `seed_barbell_shrugs`
29. `seed_barbell_back_squat`
30. `seed_barbell_front_squats`
31. `seed_dumbbell_goblet_squats`
32. `seed_leg_press`
33. `seed_machine_hack_squats`
34. `seed_bulgarian_split_squat`
35. `seed_dumbbell_lunges`
36. `seed_leg_extension`
37. `seed_seated_leg_curl`
38. `seed_lying_leg_curls`
39. `seed_nordic_leg_curls`
40. `seed_conventional_deadlift`
41. `seed_romanian_deadlift`
42. `seed_trap_bar_deadlifts`
43. `seed_barbell_hip_thrust`
44. `seed_seated_machine_hip_abductions`
45. `seed_machine_adductions`
46. `seed_standing_calf_raise`
47. `seed_seated_machine_calf_raises`
48. `seed_close_grip_bench_press`
49. `seed_push-downs`
50. `seed_overhead_tricep_extension`
51. `seed_lying_ez-bar_triceps_extensions`
52. `seed_barbell_curl`
53. `seed_dumbbell_biceps_curl`
54. `seed_hammer_curl`
55. `seed_ez-bar_preacher_curls`
56. `seed_reverse_barbell_curls`
57. `seed_barbell_wrist_curls`
58. `seed_plank`
59. `seed_side_planks`
60. `seed_cable_crunch`
61. `seed_hanging_leg_raises`
62. `seed_ab-wheel_rollouts`
63. `seed_russian_twists`
64. `seed_rowing`
65. `seed_stationary_cycling`
66. `seed_elliptical_trainer`
67. `seed_treadmill_jogging`
68. `seed_treadmill_walking`
69. `seed_jumping_rope`
70. `seed_swimming`

## Duplicate suppression rules

- Suppress plural variants where a singular seed remains, for example
  `Barbell Bench Presses` -> `Barbell Bench Press`, `Leg Presses` -> `Leg Press`,
  and `Standing Calf Raises` -> `Standing Calf Raise`.
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

1. A fresh local seed contains exactly 70 exercise definitions and 232 active
   exercise-muscle mappings.
2. Every remaining seeded exercise has at least one active mapping and valid
   seed documentation.
3. Default exercise catalog and recorder picker views hide suppressed exercises.
4. User-created exercises remain visible and untouched.
5. User-renamed seed rows are not overwritten or tombstoned by the bundle
   migration.
6. Existing clients push tombstones for suppressed seed rows and remote state
   does not re-populate them on a subsequent pull.
7. Hosted cleanup is idempotent and operates only on exact known `seed_*` IDs.
8. Required local gates are green before the milestone closes.

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
