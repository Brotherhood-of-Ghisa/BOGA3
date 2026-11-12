// Per-layer pull cursors remember which entity types the build that advanced
// them could apply. A build skips pulled rows of types it does not know but
// still moves the layer's cursor past them, so a later build that knows a new
// type must re-pull that layer from the start to receive the rows written
// before it was installed. Replay is last-write-wins, so rows already held are
// no-ops; only the newly known type's rows insert.
import { TOPO_LAYERS } from './topo-order';

/** Key in `sync_runtime_state.pull_cursor`, beside the per-layer cursors. */
export const LAYER_TYPES_KEY = 'layer_types';

/**
 * The types every build before per-layer type lists knew. A cursor stored
 * without a list was drained with these. Frozen: never edit it when
 * `TOPO_LAYERS` changes.
 */
export const LEGACY_LAYER_TYPES: readonly (readonly string[])[] = [
  ['gyms', 'exercise_definitions', 'muscle_groups', 'user_settings', 'training_programmes'],
  ['session_plans', 'exercise_muscle_mappings', 'exercise_tag_definitions', 'exercise_group_links'],
  ['session_plan_exercises', 'session_plan_uses'],
  ['sessions', 'session_plan_sets'],
  ['session_exercises'],
  ['exercise_sets', 'session_exercise_tags', 'body_weight_measurements'],
];

type Layers = readonly (readonly string[])[];
type CursorState = Record<string, unknown>;

const sortedTypes = (types: readonly string[]): string[] => [...types].sort();

const readTypeLists = (state: CursorState): Record<string, unknown> => {
  const lists = state[LAYER_TYPES_KEY];
  return lists && typeof lists === 'object' && !Array.isArray(lists) ? { ...(lists as Record<string, unknown>) } : {};
};

const writeTypeLists = (state: CursorState, lists: Record<string, unknown>): void => {
  if (Object.keys(lists).length > 0) {
    state[LAYER_TYPES_KEY] = lists;
  } else {
    delete state[LAYER_TYPES_KEY];
  }
};

// True when every type this build applies was applied when the cursor moved.
// A build that applies fewer types (a downgrade) would skip what it re-pulled.
const coversTypes = (stored: unknown, current: readonly string[]): boolean =>
  Array.isArray(stored) && current.every((type) => stored.includes(type));

/** Records, beside a layer's cursor, the types this build applies on that layer. Mutates `state`. */
export const recordLayerTypes = (state: CursorState, layer: number, layers: Layers = TOPO_LAYERS): void => {
  const lists = readTypeLists(state);
  lists[String(layer)] = sortedTypes(layers[layer] ?? []);
  writeTypeLists(state, lists);
};

/**
 * Drops every stored cursor whose layer was drained without a type this build
 * applies there (per its stored list, else the legacy one), so that layer
 * re-pulls from the start. Layers with no stored cursor already pull from the
 * start. Mutates `state` and returns the layers it reset, ascending.
 */
export const resetLayersMissingTypes = (state: CursorState, layers: Layers = TOPO_LAYERS): number[] => {
  const lists = readTypeLists(state);
  const reset: number[] = [];
  for (const key of Object.keys(state).filter((k) => /^\d+$/.test(k))) {
    const layer = Number(key);
    const stored = key in lists ? lists[key] : LEGACY_LAYER_TYPES[layer] ?? [];
    if (!coversTypes(stored, layers[layer] ?? [])) {
      delete state[key];
      delete lists[key];
      reset.push(layer);
    }
  }
  writeTypeLists(state, lists);
  return reset.sort((a, b) => a - b);
};
