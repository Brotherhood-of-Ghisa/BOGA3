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
export const TOPO_LAYERS: readonly (readonly string[])[] = [
  ['gyms', 'exercise_definitions', 'exercise_tag_definitions'], // Layer 0
  ['sessions', 'exercise_muscle_mappings'], // Layer 1
  ['session_exercises'], // Layer 2
  ['exercise_sets', 'session_exercise_tags'], // Layer 3
] as const;

export type EntityTableName = (typeof TOPO_LAYERS)[number][number];
