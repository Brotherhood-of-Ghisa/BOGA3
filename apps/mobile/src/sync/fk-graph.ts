// Push-side FK closure preflight for the client sync cycle.
//
// `selectPushBatch` walks entity tables in topological order so a batch never
// *intentionally* contains a child whose parent is neither clean-on-server nor
// in the same batch (see `topo-order.ts`). That ordering is correct for healthy
// local state, but it assumes FK closure rather than enforcing it: if the local
// store ever holds an orphan dirty child — a `session_exercises` row whose
// `sessions` parent was lost to a migration bug, partial data loss, or pre-FK
// corruption — the batch is sent anyway and the server rejects the WHOLE push
// with a `FK_VIOLATION`, wedging the entire dirty backlog behind one bad row.
//
// This module is defense in depth: before a batch is sent, it verifies that
// every dirty child's required parent reference resolves to a row that is either
// (a) in the same batch — deferred FKs let a child land before its parent inside
// one server transaction — or (b) physically present in the local SQLite store,
// which (given the topological selector) implies the parent is clean and already
// on the server. A non-null parent reference that resolves to neither is a local
// orphan the server would predictably reject; the caller turns that into a
// structured `LOCAL_FK_VIOLATION` instead of a blind, doomed `sync_push`.
//
// Scope: this only models FK edges whose parent is itself a *syncable* entity.
// `exercise_muscle_mappings.muscle_group_id -> muscle_groups` is deliberately
// omitted: `muscle_groups` is a locally-bundled, server-seeded catalog table
// that is never pushed, so it is always present on both ends and is not a sync
// orphan concern.

import { eq } from 'drizzle-orm';

import type { Transaction } from '@/src/data/clock';
import * as schema from '@/src/data/schema';
import type { EntityTableName } from '@/src/sync/topo-order';

/** One FK edge from a syncable child column to a syncable parent table. */
export interface SyncFkEdge {
  /** snake_case wire/server column on the child carrying the parent id. */
  readonly parentIdField: string;
  /** The syncable parent entity table this column references. */
  readonly parentType: EntityTableName;
  /**
   * Whether the column is declared NOT NULL in the local schema. Carried for
   * diagnostics only — the preflight checks any non-null reference regardless,
   * since a populated nullable FK (e.g. `sessions.gym_id`) the server cannot
   * resolve fails the push just the same.
   */
  readonly required: boolean;
}

/**
 * The local FK dependency graph for the eight syncable entities, keyed by child
 * type. Mirrors the `.references(...)` declarations in `src/data/schema/*` for
 * every edge whose parent is itself syncable. Entities with no syncable-parent
 * FK (`gyms`, `exercise_definitions`) are simply absent.
 *
 * Kept in sync with the schema by the same review discipline as
 * `topo-order.ts`: a new cross-entity FK must be added here as well as to its
 * layer.
 */
export const SYNCABLE_FK_GRAPH: Partial<Record<EntityTableName, readonly SyncFkEdge[]>> = {
  sessions: [{ parentIdField: 'gym_id', parentType: 'gyms', required: false }],
  exercise_tag_definitions: [
    { parentIdField: 'exercise_definition_id', parentType: 'exercise_definitions', required: true },
  ],
  exercise_muscle_mappings: [
    { parentIdField: 'exercise_definition_id', parentType: 'exercise_definitions', required: true },
  ],
  session_exercises: [
    { parentIdField: 'session_id', parentType: 'sessions', required: true },
    { parentIdField: 'exercise_definition_id', parentType: 'exercise_definitions', required: false },
  ],
  exercise_sets: [
    { parentIdField: 'session_exercise_id', parentType: 'session_exercises', required: true },
  ],
  session_exercise_tags: [
    { parentIdField: 'session_exercise_id', parentType: 'session_exercises', required: true },
    {
      parentIdField: 'exercise_tag_definition_id',
      parentType: 'exercise_tag_definitions',
      required: true,
    },
  ],
};

/** Drizzle table object for each entity type that appears as an FK parent. */
const PARENT_TABLES: Record<EntityTableName, (typeof schema)[keyof typeof schema]> = {
  gyms: schema.gyms,
  exercise_definitions: schema.exerciseDefinitions,
  exercise_tag_definitions: schema.exerciseTagDefinitions,
  sessions: schema.sessions,
  exercise_muscle_mappings: schema.exerciseMuscleMappings,
  session_exercises: schema.sessionExercises,
  exercise_sets: schema.exerciseSets,
  session_exercise_tags: schema.sessionExerciseTags,
};

/** A single preflight failure: one dirty child whose parent is not provably safe. */
export interface PushFkViolation {
  readonly childType: EntityTableName;
  readonly childId: string;
  readonly parentType: EntityTableName;
  /** snake_case FK column on the child whose value could not be resolved. */
  readonly parentIdField: string;
  /** The unresolved parent id the child points at. */
  readonly parentId: string;
}

/** Stable identity key for a row across the batch membership check. */
const rowKey = (type: EntityTableName, id: string): string => `${type} ${id}`;

/**
 * Checks FK closure for an already-selected push batch and returns the orphan
 * violations, deepest-child-first follows naturally from batch order. An empty
 * result means the batch is FK-safe to send.
 *
 * For each dirty row in the batch, every modelled FK edge with a non-null parent
 * reference must resolve to a row that is either in the same batch or physically
 * present locally; a reference that resolves to neither is recorded as a
 * violation. The check is a pure read against the caller's transaction — it
 * never mutates and never sends anything.
 *
 * `quarantinedKeys` carries the `${type} ${id}` identities already quarantined
 * (orphans the caller has decided NOT to push). A parent that is physically
 * present locally but quarantined is treated as a violation just like an absent
 * one: it will not reach the server this cycle, so a child relying on it would
 * be rejected. This is what lets the caller cascade a quarantine down a chain of
 * orphans (a child of a quarantined orphan is itself quarantined) in one pass.
 */
export const findPushBatchFkViolations = (
  tx: Transaction,
  batch: readonly { type: EntityTableName; id: string; fields: Record<string, unknown> }[],
  quarantinedKeys: ReadonlySet<string> = new Set(),
): PushFkViolation[] => {
  const batchKeys = new Set(batch.map((entity) => rowKey(entity.type, entity.id)));
  const violations: PushFkViolation[] = [];

  for (const entity of batch) {
    const edges = SYNCABLE_FK_GRAPH[entity.type];
    if (!edges) {
      continue;
    }

    for (const edge of edges) {
      const raw = entity.fields[edge.parentIdField];
      if (raw === null || raw === undefined) {
        // A null reference is FK-safe (the column either has no parent or is a
        // self-clearing soft delete); only a populated reference can orphan.
        continue;
      }
      const parentId = String(raw);

      // (a) Parent rides in the same batch: deferred server FKs resolve it.
      // (Quarantined rows are excluded from the batch, so a batch-member parent
      // is never itself quarantined.)
      if (batchKeys.has(rowKey(edge.parentType, parentId))) {
        continue;
      }

      // (b) Parent is physically present locally and NOT quarantined. Given the
      // topological selector (parents in earlier layers are always selected
      // before their children), a present, non-quarantined, not-in-batch parent
      // is necessarily clean — and therefore already on the server. Absent — or
      // present but quarantined (so it will not be pushed this cycle) — means a
      // reference the server would reject.
      const parentTable = PARENT_TABLES[edge.parentType] as typeof schema.gyms;
      const exists = tx
        .select({ id: parentTable.id })
        .from(parentTable)
        .where(eq(parentTable.id, parentId))
        .get();

      if (!exists || quarantinedKeys.has(rowKey(edge.parentType, parentId))) {
        violations.push({
          childType: entity.type,
          childId: entity.id,
          parentType: edge.parentType,
          parentIdField: edge.parentIdField,
          parentId,
        });
      }
    }
  }

  return violations;
};
