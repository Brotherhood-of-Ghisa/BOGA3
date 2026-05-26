// Topological FK layering for the eight v2 user-owned entity tables.
//
// Each layer must satisfy two properties (asserted by the drift checker per
// designs/t1.md §7.7):
//
//   1. No intra-layer FK — tables in the same layer never reference each other.
//   2. Every FK points to a strictly earlier layer or is a self-edge.
//
// The push batch builder (designs/t2.md §3.4.1) walks layers in order and
// relies on those properties to guarantee an FK-safe send order without
// per-row sorting. Self-edges are tolerated (deferred FKs handle them inside
// a single batch).
//
// Consumers in this PR: `apps/mobile/scripts/check-sync-schema-drift.ts`.
// The sync engine that uses this layering ships in plan 2 (sync-v2-client).
//
// To add a new entity table, add it to its correct layer here AND add the
// matching `app_public.<entity>` migration; the drift checker fails the slow
// gate if the two diverge.
//
// NOTE — deviation from t1 §7.7 sketch: the design's example layering placed
// `exercise_tag_definitions` in Layer 0, but t1 §2.7 declares a FK
// `exercise_tag_definitions(owner_user_id, exercise_definition_id) →
// exercise_definitions(owner_user_id, id)`. The §7.7 rule itself ("every FK
// points to a strictly earlier layer or is a self-edge") forbids that
// placement. The Layer 0/1 split below puts `exercise_tag_definitions` next
// to `exercise_muscle_mappings` and `sessions` in Layer 1, which is the only
// placement that satisfies §7.7's invariant against the live FK graph.
export const TOPO_LAYERS: readonly (readonly string[])[] = [
  ['gyms', 'exercise_definitions'], // Layer 0
  ['sessions', 'exercise_muscle_mappings', 'exercise_tag_definitions'], // Layer 1
  ['session_exercises'], // Layer 2
  ['exercise_sets', 'session_exercise_tags'], // Layer 3
] as const;

export type EntityTableName = (typeof TOPO_LAYERS)[number][number];
