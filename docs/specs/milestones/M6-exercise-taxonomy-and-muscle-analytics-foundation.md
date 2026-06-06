# Milestone Spec

## Milestone metadata

- Milestone ID: `M6`
- Title: Exercise taxonomy and muscle-target weighting foundation
- Status: `completed`
- Owner: `AI + human reviewer`
- Target window: `post-MVP (TBD)`

## Parent references

- Project directives: `docs/specs/README.md`
- Milestone index: `docs/specs/milestones/README.md` (the retired `00-mvp-deliverables.md` index)
- Architecture: `docs/specs/03-technical-architecture.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Future features backlog: `docs/specs/07-future-features.md`

## Milestone objective

Define a practical, data-driven exercise metadata model that associates exercises to one or more muscle groups with weighted contributions, ships an initial set of system exercises with mappings, and supports user exercise editing of muscle links.

## In scope

- Define a v1 taxonomy of supported muscle groups (stable IDs + display names).
- Define exercise-to-muscle association model (many-to-many).
- Lock weighting semantics for v1 (`non-normalized` relative weights).
- Define a non-editable system taxonomy for this milestone.
- Define and seed an initial set of system exercises linked to muscle groups.
- Implement/support exercise editing flows that allow linking muscle groups.
- Record unresolved decisions and iteration points (for example: historical versioning behavior).

## Out of scope

- Implementing historical mapping behavior for completed sessions (policy can be documented; schema/runtime implementation is deferred).
- Analytics rollups/dashboards or effort-adjusted stimulus scoring (RPE/RIR proximity-to-failure models).
- Exhaustive exercise catalog seeding.
- Backend sync/API changes for exercise definitions and muscle mappings.

## Deliverables

1. Non-editable taxonomy of muscle groups (stable IDs + display names).
2. Initial set of system exercises linked to muscle groups with weights.
3. Exercise editing support that allows linking muscle groups (including weights) for user-editable exercises.

## Acceptance criteria

1. A v1 muscle-group taxonomy exists with stable IDs and user-facing display names.
2. The muscle-group taxonomy is system-defined and non-editable in this milestone.
3. Weighting semantics are explicitly defined as `non-normalized` and interpreted consistently.
4. An initial set of system exercises exists and each included exercise is linked to one or more muscle groups with weights.
5. Exercise editing supports linking one or more muscle groups with weights for user-editable exercises.
6. Historical behavior policy for completed-session analytics was narrowed/locked during M6 and is now superseded by the later retroactive metadata direction (see decision log entry dated `2026-02-27`).
7. The spec is precise enough to support follow-on task cards for schema design, seed data, and UI/editor work.

## Locked decisions (current)

- Exercise-to-muscle weights are `non-normalized`.
  - Interpretation: `1.0` represents a full primary-reference contribution for that exercise; multiple muscles may receive meaningful weights without forcing a shared total.
- The muscle-group taxonomy is `system-defined` and `non-editable` in this milestone.
  - Users may link muscles to exercises where editing is supported, but they may not create/edit muscle-group definitions in M6.
- For M6 v1 taxonomy, chest is represented as a single group (`chest`) rather than sub-regions.
  - Reason: avoid false precision in default exercise mappings when sub-region emphasis varies meaningfully by individual and setup.
- Historical behavior direction from M6 (`snapshot/reproducible canonical`) is superseded by the later planning decision dated `2026-02-27`.
  - Current canonical direction is retroactive metadata semantics (latest mappings/metadata apply), with future analytics cache invalidation/recompute handling.

## Proposed exercise-to-muscle association model (v1)

Each exercise can map to one or more muscle groups via weighted associations.

Recommended fields (conceptual; schema to be designed in a later task):

- `exercise_id`
- `muscle_group_id`
- `weight` (decimal, non-normalized)
- `role` (`primary | secondary | stabilizer`) - optional; M6 system seed data currently uses `primary | secondary` only

Notes:

- Weighting should be applied to leaf muscle groups only (not parent rollups).
- Parent groups (for example, `Shoulders`, `Back`, `Legs`) should be computed rollups for future reporting, not directly weighted.
- Stable IDs must not change after release; display labels can evolve if needed.

## Initial muscle group taxonomy (v1 draft)

This is the proposed initial set to balance useful coverage with manageable custom exercise setup.

| Family | Muscle Group (display) | Suggested ID |
| --- | --- | --- |
| Chest | Chest | `chest` |
| Shoulders | Front Delts | `delts_front` |
| Shoulders | Lateral Delts | `delts_lateral` |
| Shoulders | Rear Delts | `delts_rear` |
| Back | Lats | `back_lats` |
| Back | Upper Back (Rhomboids + Mid Traps) | `back_upper` |
| Back | Upper Traps | `traps_upper` |
| Back | Spinal Erectors | `spinal_erectors` |
| Arms | Biceps | `biceps` |
| Arms | Triceps | `triceps` |
| Arms | Forearms / Grip | `forearms_grip` |
| Core | Abs (Rectus Abdominis) | `abs_rectus` |
| Core | Obliques | `abs_obliques` |
| Legs | Quads | `quads` |
| Legs | Hamstrings | `hamstrings` |
| Legs | Glute Max | `glutes_max` |
| Legs | Hip Abductors (Glute Med/Min) | `hip_abductors` |
| Legs | Adductors | `adductors` |
| Lower Legs | Calves | `calves` |

## Example weighting semantics (illustrative)

Example: chest press / bench press style movement

- `chest`: `1.0`
- `delts_front`: `0.5`
- `triceps`: `0.4`

This illustrates the intended `non-normalized` interpretation: contributions are relative and do not need to sum to `1.0`.

## User-created exercise mapping guidance (v1 draft)

- Users can create custom exercises and assign one or more muscle-group weights.
- At least one muscle association should be required.

## Open decisions / iteration backlog

- Exact implementation shape for retroactive analytics recomputation in the analytics milestone:
  - invalidation scope for aggregates affected by mapping edits
  - recomputation strategy/timing for affected entities
  - performance guardrails for large-scale metadata changes
- Whether to lock a standard preset ladder for weights (for example, `1.0`, `0.66`, `0.5`, `0.33`, `0.15`) vs free-form decimals only.
- Whether to include additional v1 muscle groups such as `tibialis_anterior`, `hip_flexors`, `serratus_anterior`, or `rotator_cuff`.
- Exercise origin/source model (for example `system`, `user`, imported providers) and whether it needs explicit local schema fields in M6 vs a later milestone.
- Whether exercise editability needs an explicit flag in the local schema (deferred per fix-sync plan: there is no shared/global catalog of exercises on the backend, so all exercise rows are per-user and editable; any future "do not overwrite seeded rows" guarantee is a local-only seeder behavior — see `docs/tasks/fix-sync/plan.md` task T8).

## Task breakdown

Planned task cards for M6 are listed below.

1. `docs/tasks/complete/T-20260224-01-m6-local-schema-for-muscle-taxonomy-and-exercise-mappings.md` - design local schema for exercise definitions, muscle groups, and weighted associations. (`completed`)
2. `docs/tasks/complete/T-20260224-02-m6-seed-muscle-taxonomy-and-system-exercises.md` - define and seed the non-editable muscle taxonomy plus the initial system exercise mapping set. (`completed`)
3. `docs/tasks/complete/T-20260224-03-m6-exercise-editing-muscle-linking-ui.md` - implement exercise editing support for linking muscle groups and weights on user-editable exercises. (`completed`)
4. `docs/tasks/complete/T-20260224-04-m6-session-recorder-exercise-management-integration.md` - connect session recorder exercise manage/add flows to the persistent exercise catalog editor and refresh recorder selection behavior after return. (`completed`)
5. `docs/tasks/complete/T-20260224-05-m6-historical-mapping-behavior-options.md` - define and narrow/lock the historical mapping behavior policy path before analytics implementation. (`completed`)
6. `docs/tasks/complete/T-20260426-01-refined-exercise-search.md` - refine shared exercise search to match exercise names plus primary muscle display/family terms only, with all query words required. (`completed`)
7. `docs/tasks/complete/T-20260516-02-exercise-editor-keyboard-muscle-selector.md` - post-completion UI fix for iOS keyboard overlap in the shared exercise editor muscle selector. (`completed`)

## Risks / dependencies

- Overly granular taxonomy can increase user friction and reduce mapping consistency.
- Under-granular taxonomy can weaken analytics usefulness and future extensibility.
- Historical mapping behavior has downstream impact on schema design, analytics correctness, and sync behavior.
- Seeding too many system exercises initially may slow delivery; seeding too few may limit immediate usefulness.

## Decision log

- Date: 2026-02-24
- Decision: Use `non-normalized` exercise-to-muscle weights.
- Reason: Better matches current research/coaching practice for compound movements where multiple muscles receive meaningful stimulus.
- Impact: Mapping rules and future analytics formulas must treat weights as relative contributions, not percentage splits.

- Date: 2026-02-24
- Decision: Keep M6 focused on taxonomy + system exercise mappings + exercise editing support; exclude analytics implementation.
- Reason: This milestone should establish the exercise/muscle data model and editing workflows before building analytics on top.
- Impact: Analytics rollups and metric design will be handled in a later milestone after mappings are in place.

- Date: 2026-02-24
- Decision: Defer historical mapping behavior for edited exercise muscle profiles (`TBD`).
- Reason: This requires a broader tradeoff across data model complexity, user expectations, and analytics reproducibility.
- Impact: Schema and follow-on analytics tasks must explicitly revisit versioning/snapshot strategy before implementation is finalized.

- Date: 2026-02-24
- Decision: Treat the muscle-group taxonomy as system-defined and non-editable in M6.
- Reason: Reduces scope and preserves consistency while exercise-level mapping UX is being established.
- Impact: M6 editing work should allow linking existing muscle groups only; taxonomy administration is deferred.

- Date: 2026-02-25
- Decision: Collapse chest taxonomy from `chest_sternal` + `chest_upper` to a single `chest` group for M6 v1.
- Reason: Exercise-level chest sub-region defaults create false precision and are not strong enough for a stable starter taxonomy.
- Impact: Seed data/examples/editor defaults should use `chest`; chest sub-region granularity can be revisited later if justified.

- Date: 2026-02-25
- Decision: Lock canonical historical analytics behavior for exercise-mapping edits to a reproducible model (no drift from later edits), with `snapshot at session completion` as the default implementation target and `versioned mappings` as an escalation path.
- Reason: Preserves user trust and analytics reproducibility while avoiding premature versioning complexity in the local-first + future sync architecture.
- Impact: Superseded by the later decision dated `2026-02-27`; retained here as historical record of M6 direction.

- Date: 2026-02-27
- Decision: Supersede M6 snapshot/reproducible historical-mapping direction with retroactive metadata semantics.
- Reason: Product direction changed to “edit once, apply everywhere,” including history/analytics interpretation semantics for exercise metadata.
- Impact: Follow-on analytics milestones should plan invalidation/recompute behavior for edited mappings instead of snapshot/versioned historical mapping semantics.

## Completion note

- What changed:
  - Completed `T-20260224-01` with the local schema foundation for muscle taxonomy, exercise definitions, and exercise-to-muscle weighted mappings.
  - Deferred exercise origin/source modeling and explicit exercise editability flags to a later M6 follow-on decision; current schema assumes exercises are editable.
  - Completed `T-20260224-02` with seed fixtures, validation, and bootstrap seeding for a non-editable system taxonomy plus an initial system exercise catalog with non-normalized weights.
  - Simplified v1 defaults to reduce false precision: single `chest` taxonomy group, `primary|secondary` roles only in seeds, and default weight ladder (`1.0` / `0.5`) only.
  - Completed `T-20260224-03` with a local exercise-catalog editing route + repository that supports linking seeded/system muscle groups to exercises with non-normalized weights, including add/edit/remove flows and editor validation for missing links, duplicate links, and invalid weights.
  - Completed `T-20260224-04` with recorder-to-catalog integration for exercise `Manage` flow, shared inline add-new exercise editing inside `session-recorder`, soft-delete/undelete support in exercise catalog, and recorder picker behavior aligned to active catalog exercises.
  - Completed `T-20260224-05` (docs-only) by comparing historical mapping behavior options and initially locking a snapshot-oriented direction; this historical direction was later superseded (`2026-02-27`) by retroactive metadata semantics.
- Verification summary:
  - `apps/mobile` lint/typecheck/test passed, including targeted schema/migration coverage and the previously failing session-list test after timer assertion fix.
  - Added targeted seed validation tests and bootstrap seed integration tests; full `apps/mobile` Jest suite remains green after seed integration.
  - Added targeted repository + UI interaction tests for exercise muscle-link editing (`exercise-catalog-repository`, `exercise-catalog-screen`) and re-ran full `apps/mobile` Jest suite successfully after the new route/repository work.
- What remains:
  - No M6 task-specific follow-up remains. Post-completion task `T-20260516-02` captured native iOS selector evidence for catalog primary/secondary and recorder inline create after the exercise-name keyboard opened.

## Status update checklist (mandatory during task closeout)

- Keep milestone `Status` current as tasks progress.
- Update task breakdown entries to reflect each task state (`planned | in_progress | completed | blocked`).
- If milestone remains open after a session, record why in the active task completion note.
