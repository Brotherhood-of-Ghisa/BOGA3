// Topological FK layering for the sixteen user-owned entity tables.
//
// Each layer must satisfy two properties (asserted by the schema drift checker):
//
//   1. No intra-layer FK — tables in the same layer never reference each other.
//   2. Every FK points to a strictly earlier layer or is a self-edge.
//
// The push batch builder walks layers in order and relies on those properties
// to guarantee an FK-safe send order without per-row sorting. Self-edges are
// tolerated (deferred FKs handle them inside a single batch).
//
// Consumer: `apps/mobile/scripts/check-sync-schema-drift.ts`. The client sync
// engine that consumes this layering relies on the same invariants.
//
// To add a new entity table, add it to its correct layer here AND add the
// matching `app_public.<entity>` migration; the drift checker fails the slow
// gate if the two diverge.
//
// Session planning moved three performed tables down and added four plan
// tables, keeping five layers:
//   - `training_programmes` joins Layer 0 (no outbound entity FK).
//   - `session_plans` joins Layer 1 (FKs gyms, training_programmes — both L0).
//   - `sessions` moves L1 -> L2 because it now FKs `session_plans` (L1);
//     `session_plan_exercises` joins it there (FKs session_plans L1,
//     exercise_definitions L0).
//   - `session_exercises` moves L2 -> L3 because it now FKs
//     `session_plan_exercises` (L2); `session_plan_sets` joins it there
//     (FKs session_plan_exercises L2).
//   - `exercise_sets` moves L3 -> L4 because it now FKs `session_plan_sets`
//     (L3), alongside `session_exercise_tags` and the independently cursorable
//     `body_weight_measurements` private root.
//
// NOTE: `exercise_tag_definitions` belongs in Layer 1, not Layer 0, because it
// declares a FK
// `exercise_tag_definitions(owner_user_id, exercise_definition_id) →
// exercise_definitions(owner_user_id, id)`. Property 2 above ("every FK points
// to a strictly earlier layer or is a self-edge") forbids placing it in Layer 0
// alongside `exercise_definitions`. The Layer 0/1 split below puts
// `exercise_tag_definitions` next to `exercise_muscle_mappings` and
// `exercise_group_links` in Layer 1, the only placement that satisfies that
// invariant against the live FK graph.
//
// NOTE: `muscle_groups` belongs in Layer 0: it declares no FK to any other
// entity and is itself the parent of `exercise_muscle_mappings` (which holds
// `(owner_user_id, muscle_group_id) → muscle_groups(owner_user_id, id)` in
// Layer 1). Placing it in Layer 0 keeps property 2 ("every FK points to a
// strictly earlier layer") satisfied for that child edge.
//
// NOTE: `exercise_group_links` belongs in Layer 1: its only FK is
// `exercise_definition_id → exercise_definitions` (Layer 0). Its `group_id` /
// `group_exercise_id` columns are plain text with no FK (group tables are not
// synced parents), so they impose no layering.
export const TOPO_LAYERS: readonly (readonly string[])[] = [
  ['gyms', 'exercise_definitions', 'muscle_groups', 'user_settings', 'training_programmes'], // Layer 0
  ['session_plans', 'exercise_muscle_mappings', 'exercise_tag_definitions', 'exercise_group_links'], // Layer 1
  ['sessions', 'session_plan_exercises'], // Layer 2
  ['session_exercises', 'session_plan_sets'], // Layer 3
  ['exercise_sets', 'session_exercise_tags', 'body_weight_measurements'], // Layer 4
] as const;

export type EntityTableName = (typeof TOPO_LAYERS)[number][number];
