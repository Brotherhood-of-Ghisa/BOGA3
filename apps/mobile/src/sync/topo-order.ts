// Synced FK parents always drain before children. No intra-layer FK is allowed.
// Routine uses sit between authored plans and performed sessions; protocol 6
// resets all cursors when moving the performed chain down one layer.
// A type added to a layer re-pulls only that layer once (pull-layer-types.ts).
export const TOPO_LAYERS: readonly (readonly string[])[] = [
  ['gyms', 'exercise_definitions', 'muscle_groups', 'user_settings', 'training_programmes'], // Layer 0
  ['session_plans', 'exercise_muscle_mappings', 'exercise_tag_definitions', 'exercise_group_links'], // Layer 1
  ['session_plan_exercises', 'session_plan_uses'], // Layer 2
  ['sessions', 'session_plan_sets'], // Layer 3
  ['session_exercises'], // Layer 4
  ['exercise_sets', 'session_exercise_tags', 'body_weight_measurements'], // Layer 5
] as const;

export type EntityTableName = (typeof TOPO_LAYERS)[number][number];

const ENTITY_TABLE_NAMES: ReadonlySet<string> = new Set(TOPO_LAYERS.flat());

/** Whether this build knows `type`. Rows of other types, from any RPC, are skipped, never thrown on. */
export const isEntityTableName = (type: string): type is EntityTableName => ENTITY_TABLE_NAMES.has(type);
