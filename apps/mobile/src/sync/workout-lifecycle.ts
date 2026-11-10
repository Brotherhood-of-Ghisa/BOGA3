import { and, eq, sql } from 'drizzle-orm';

import type { LocalDatabase } from '@/src/data/bootstrap';
import type { Transaction } from '@/src/data/clock';
import { deleteMergeLocal, listMergeLocal, readMergeLocal, writeMergeLocal } from '@/src/data/exercise-merge-store';
import { sessions } from '@/src/data/schema';
import type { MergeWireEntity } from '@/src/exercise-core/merge-types';

export type WorkoutLifecycleAction = { id: string; base_revision: number };
export type PendingWorkoutLifecycle = { action: WorkoutLifecycleAction; entity: MergeWireEntity };
const storageId = (sessionId: string) => 'lifecycle:' + sessionId;

export function sameWorkoutHeader(left: MergeWireEntity, right: MergeWireEntity): boolean {
  const keys = new Set([...Object.keys(left.fields), ...Object.keys(right.fields)]);
  keys.delete('updated_at');
  return left.id === right.id && [...keys].every(key => left.fields[key] === right.fields[key]);
}

// A protected parent already exists remotely. Drain its children before the
// final header fences the graph, including graphs larger than one push batch.
export function deferredWorkoutHeaders(tx: Transaction): string[] {
  return tx.select({ id: sessions.id }).from(sessions).where(and(
    eq(sessions.localDirty, true), sql`${sessions.mergeRevision} > 0`,
    sql`exists (select 1 from session_exercises b where b.session_id = ${sessions.id}
      and ((b.local_dirty = 1 and not exists (select 1 from sync_quarantine q
        where q.entity_type = 'session_exercises' and q.entity_id = b.id)) or exists (select 1 from exercise_sets e
        where e.session_exercise_id = b.id and e.local_dirty = 1 and not exists (select 1 from sync_quarantine q
          where q.entity_type = 'exercise_sets' and q.entity_id = e.id))
        or exists (select 1 from session_exercise_tags t
          where t.session_exercise_id = b.id and t.local_dirty = 1 and not exists (select 1 from sync_quarantine q
            where q.entity_type = 'session_exercise_tags' and q.entity_id = t.id))))`,
  )).all().map(row => row.id);
}

export function attachWorkoutLifecycle(tx: Transaction, owner: string | null, entity: MergeWireEntity): void {
  const revision = Number(entity.fields.merge_revision ?? 0);
  if (!owner || entity.type !== 'sessions' || revision <= 0) return;
  const previous = readMergeLocal<PendingWorkoutLifecycle>(tx, owner, storageId(entity.id));
  const action = previous && sameWorkoutHeader(previous.entity, entity) ? previous.action : {
    id: 'lifecycle:' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2), base_revision: revision,
  };
  entity.lifecycle_action = action;
  writeMergeLocal(tx, { ownerUserId: owner, id: storageId(entity.id), kind: 'state', payload: { action, entity } });
}

export function pendingWorkoutLifecycles(database: Pick<LocalDatabase, 'select'>, owner: string): PendingWorkoutLifecycle[] {
  return listMergeLocal(database, owner, 'state').filter(row => row.id.startsWith('lifecycle:'))
    .map(row => JSON.parse(row.payload) as PendingWorkoutLifecycle);
}

export function clearWorkoutLifecycle(tx: Transaction, owner: string, sessionId: string): void {
  deleteMergeLocal(tx, owner, storageId(sessionId));
}
