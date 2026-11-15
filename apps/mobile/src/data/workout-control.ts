import { and, eq } from 'drizzle-orm';

import { bootstrapLocalDataLayer, type LocalDatabase } from './bootstrap';
import { PRIMARY_RUNTIME_STATE_ID } from './clock';
import { deleteMergeLocal, readMergeLocal } from './exercise-merge-store';
import { exerciseSets, sessionExercises, sessionExerciseTags, sessions, syncRuntimeState } from './schema';
import { assertHumanWorkoutControl } from '@/src/exercise-core/workout-control';

export type WorkoutControlAction = {
  p_id: string; p_session_id: string; p_base_revision: number;
  p_client_id: string | null; p_granted_at: string | null;
};
export const workoutControlStorageId = (sessionId: string) => 'control:' + sessionId;

export function pendingWorkoutControl(database: LocalDatabase, sessionId: string): WorkoutControlAction | null {
  const owner = database.select().from(syncRuntimeState).where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID)).get()?.accountUserId;
  return owner ? readMergeLocal<WorkoutControlAction>(database, owner, workoutControlStorageId(sessionId)) : null;
}

export function assertWorkoutWritable(database: LocalDatabase, sessionId: string): void {
  const row = database.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  assertHumanWorkoutControl(row);
  if (pendingWorkoutControl(database, sessionId)) {
    throw new Error('Session control is not confirmed. Retry the handoff in Session options before editing.');
  }
}

export async function loadPendingWorkoutControl(sessionId: string): Promise<WorkoutControlAction | null> {
  const database = await bootstrapLocalDataLayer();
  const pending = pendingWorkoutControl(database, sessionId);
  const row = database.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  // A clean terminal epoch is newer than this action; its delayed request can
  // no longer grant control. Do not strand history behind an unreachable retry.
  if (pending && row && !row.localDirty && row.mergeRevision > pending.p_base_revision
    && ((row.status === 'completed' && row.loggingClientId === null) || row.deletedAt !== null)) {
    const owner = database.select().from(syncRuntimeState).where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID)).get()?.accountUserId;
    if (owner) database.transaction(tx => deleteMergeLocal(tx, owner, workoutControlStorageId(sessionId)));
    return null;
  }
  return pending;
}

export async function loadWorkoutControlHeader(sessionId: string) {
  const database = await bootstrapLocalDataLayer();
  const header = database.select().from(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.localDirty, false))).get();
  const dirtyBlock = database.select({ id: sessionExercises.id }).from(sessionExercises)
    .where(and(eq(sessionExercises.sessionId, sessionId), eq(sessionExercises.localDirty, true))).get();
  const dirtySet = database.select({ id: exerciseSets.id }).from(exerciseSets)
    .innerJoin(sessionExercises, eq(exerciseSets.sessionExerciseId, sessionExercises.id))
    .where(and(eq(sessionExercises.sessionId, sessionId), eq(exerciseSets.localDirty, true))).get();
  const dirtyTag = database.select({ id: sessionExerciseTags.id }).from(sessionExerciseTags)
    .innerJoin(sessionExercises, eq(sessionExerciseTags.sessionExerciseId, sessionExercises.id))
    .where(and(eq(sessionExercises.sessionId, sessionId), eq(sessionExerciseTags.localDirty, true))).get();
  return dirtyBlock || dirtySet || dirtyTag ? undefined : header;
}
