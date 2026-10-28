import { and, eq } from 'drizzle-orm';

import type { LocalDatabase } from './bootstrap';
import { PRIMARY_RUNTIME_STATE_ID, type Transaction } from './clock';
import { exerciseMergeLocal, exerciseSets, sessionExercises, syncRuntimeState } from './schema';
import type { MergeWireEntity } from '@/src/exercise-core/merge-types';

type MergeLocalKind = typeof exerciseMergeLocal.$inferSelect.kind;
type MergeLocalWrite = { ownerUserId: string; id: string; kind: MergeLocalKind; payload: unknown };

export function writeMergeLocal(tx: Transaction, input: MergeLocalWrite): void {
  const values = { ...input, payload: JSON.stringify(input.payload), updatedAtMs: Date.now() };
  tx.insert(exerciseMergeLocal).values(values).onConflictDoUpdate({
    target: [exerciseMergeLocal.ownerUserId, exerciseMergeLocal.id], set: values,
  }).run();
}
export function readMergeLocal<T>(database: Pick<LocalDatabase, 'select'>, owner: string, id: string): T | null {
  const row = database.select().from(exerciseMergeLocal).where(and(
    eq(exerciseMergeLocal.ownerUserId, owner), eq(exerciseMergeLocal.id, id),
  )).get();
  return row ? JSON.parse(row.payload) as T : null;
}
export function listMergeLocal(database: Pick<LocalDatabase, 'select'>, owner: string, kind: MergeLocalKind) {
  return database.select().from(exerciseMergeLocal).where(and(
    eq(exerciseMergeLocal.ownerUserId, owner), eq(exerciseMergeLocal.kind, kind),
  )).all();
}
export function deleteMergeLocal(tx: Transaction, owner: string, id: string): void {
  tx.delete(exerciseMergeLocal).where(and(eq(exerciseMergeLocal.ownerUserId, owner), eq(exerciseMergeLocal.id, id))).run();
}
export function preserveMergeEntity(tx: Transaction, owner: string, entity: MergeWireEntity): void {
  writeMergeLocal(tx, {
    ownerUserId: owner, id: 'pending:' + entity.type + ':' + entity.id + ':' + entity.client_updated_at_ms,
    kind: 'pending', payload: entity,
  });
}

type SavedSet = {
  id?: string; weightValue: string; repsValue: string; setType?: string | null;
  plannedWeightValue?: string | null; plannedRepsValue?: string | null;
  plannedSetType?: string | null; performanceStatus?: string | null; sourcePlanSetId?: string | null;
};
type SavedBlock = {
  id?: string; exerciseDefinitionId: string; name: string; machineName?: string | null;
  mergeRevision?: number; sourcePlanExerciseId?: string | null; sets: SavedSet[];
};
type EditGraph = { sessionId?: string; exercises: SavedBlock[]; mergeRevisions?: Record<string, number> };

function blockEnvelope(row: typeof sessionExercises.$inferSelect, input: SavedBlock | undefined, revision: number, index: number): MergeWireEntity {
  const now = Date.now();
  return { type: 'session_exercises', id: row.id, client_updated_at_ms: now, fields: {
    session_id: row.sessionId, exercise_definition_id: input?.exerciseDefinitionId ?? row.exerciseDefinitionId,
    name: input?.name ?? row.name, machine_name: input?.machineName === undefined ? row.machineName : input.machineName,
    source_plan_exercise_id: input?.sourcePlanExerciseId ?? row.sourcePlanExerciseId,
    merge_revision: revision, order_index: input ? index : row.orderIndex, created_at: row.createdAt.getTime(),
    updated_at: now, deleted_at: input ? null : now,
  }};
}

function savedSetEnvelope(row: typeof exerciseSets.$inferSelect | undefined, input: SavedSet, block: string, revision: number, index: number): MergeWireEntity {
  const now = Date.now();
  return { type: 'exercise_sets', id: input.id ?? 'set-' + now + '-' + Math.random().toString(36).slice(2),
    client_updated_at_ms: now, fields: {
      session_exercise_id: block, source_plan_set_id: input.sourcePlanSetId ?? row?.sourcePlanSetId ?? null,
      merge_revision: revision, order_index: index, weight_value: input.weightValue, reps_value: input.repsValue,
      set_type: input.setType ?? null, planned_weight_value: input.plannedWeightValue ?? null,
      planned_reps_value: input.plannedRepsValue ?? null, planned_set_type: input.plannedSetType ?? null,
      performance_status: input.performanceStatus ?? null, created_at: row?.createdAt.getTime() ?? now,
      updated_at: now, deleted_at: null,
    }};
}

// This transaction commits the saved draft before the caller reports its stale editor.
export function guardSessionMergeEdit(database: LocalDatabase, input: EditGraph): boolean {
  if (!input.sessionId) return false;
  const blocks = database.select().from(sessionExercises).where(eq(sessionExercises.sessionId, input.sessionId)).all();
  const stale = blocks.filter(row => {
    const incoming = input.exercises.find(block => block.id === row.id);
    if (row.deletedAt && !incoming) return false;
    const expected = input.mergeRevisions?.[row.id] ?? incoming?.mergeRevision ?? 0;
    return row.mergeRevision > expected;
  });
  if (!stale.length) return false;
  database.transaction(tx => {
    const owner = tx.select().from(syncRuntimeState).where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID)).get()?.accountUserId;
    if (!owner) throw new Error('Refresh this session before saving.');
    for (const row of stale) {
      const incoming = input.exercises.find(block => block.id === row.id);
      const revision = input.mergeRevisions?.[row.id] ?? incoming?.mergeRevision ?? 0;
      preserveMergeEntity(tx, owner, blockEnvelope(row, incoming, revision, incoming ? input.exercises.indexOf(incoming) : row.orderIndex));
      if (!incoming) continue;
      const sets = tx.select().from(exerciseSets).where(eq(exerciseSets.sessionExerciseId, row.id)).all();
      incoming.sets.forEach((set, index) => preserveMergeEntity(tx, owner,
        savedSetEnvelope(sets.find(current => current.id === set.id), set, row.id, revision, index)));
      for (const removed of sets.filter(set => !set.deletedAt && !incoming.sets.some(candidate => candidate.id === set.id))) {
        const entity = savedSetEnvelope(removed, removed, row.id, revision, removed.orderIndex);
        entity.fields.deleted_at = Date.now();
        entity.fields.merge_weight_revision = row.mergeRevision;
        preserveMergeEntity(tx, owner, entity);
      }
    }
  });
  return true;
}
