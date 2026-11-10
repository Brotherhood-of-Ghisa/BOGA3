import { eq, getTableColumns, inArray } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

import type { LocalDatabase } from './bootstrap';
import { exerciseSets, sessionExercises, sessionExerciseTags, sessions } from './schema';
import type { MergeValue, MergeWireEntity } from '@/src/exercise-core/merge-types';
import type { SessionTimingBaseline } from './session-inputs';

function wireRow(table: SQLiteTable, type: string, row: Record<string, unknown>): MergeWireEntity {
  const fields: Record<string, MergeValue> = {};
  for (const [key, column] of Object.entries(getTableColumns(table))) {
    if (['id', 'localDirty', 'localUpdatedAtMs'].includes(key)) continue;
    const value = row[key];
    fields[column.name] = (value instanceof Date ? value.getTime() : value ?? null) as MergeValue;
  }
  return { type, id: String(row.id), client_updated_at_ms: Number(row.localUpdatedAtMs), fields };
}

export const sessionHeaderToWire = (row: typeof sessions.$inferSelect): MergeWireEntity => wireRow(sessions, 'sessions', row);

export function captureSessionEditBaseline(database: LocalDatabase, sessionId: string): MergeWireEntity[] {
  const session = database.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!session) return [];
  const blocks = database.select().from(sessionExercises).where(eq(sessionExercises.sessionId, sessionId)).all();
  const ids = blocks.map(row => row.id);
  const sets = ids.length ? database.select().from(exerciseSets).where(inArray(exerciseSets.sessionExerciseId, ids)).all() : [];
  const tags = ids.length ? database.select().from(sessionExerciseTags).where(inArray(sessionExerciseTags.sessionExerciseId, ids)).all() : [];
  return [wireRow(sessions, 'sessions', session), ...blocks.map(row => wireRow(sessionExercises, 'session_exercises', row)),
    ...sets.map(row => wireRow(exerciseSets, 'exercise_sets', row)),
    ...tags.map(row => wireRow(sessionExerciseTags, 'session_exercise_tags', row))];
}

export class WorkoutChangesSavedForReview extends Error {
  constructor(saved = true) {
    super(saved ? 'This workout changed elsewhere. Your changes are saved for review in Data & Sync.'
      : 'This workout changed elsewhere. The current workout has been refreshed.');
    this.name = 'WorkoutChangesSavedForReview';
  }
}

export class WorkoutLifecycleChanged extends Error {
  constructor() {
    super('This workout changed elsewhere. Review its current state before trying again.');
    this.name = 'WorkoutLifecycleChanged';
  }
}

export function rebaseWorkoutTimes(row: typeof sessions.$inferSelect,
  times: Pick<SessionTimingBaseline, 'startedAt' | 'completedAt'>, baseline?: SessionTimingBaseline) {
  if (!baseline || row.mergeRevision <= baseline.revision) return { times, conflict: false, changed: true };
  const localStart = times.startedAt.getTime() !== baseline.startedAt.getTime();
  const localEnd = times.completedAt.getTime() !== baseline.completedAt.getTime();
  const start = localStart ? times.startedAt : row.startedAt;
  const end = localEnd ? times.completedAt : row.completedAt ?? times.completedAt;
  const conflict = row.deletedAt !== null || row.status !== 'completed' || end < start ||
    (localStart && row.startedAt.getTime() !== baseline.startedAt.getTime() && row.startedAt.getTime() !== start.getTime()) ||
    (localEnd && row.completedAt?.getTime() !== baseline.completedAt.getTime() && row.completedAt?.getTime() !== end.getTime());
  return { times: { startedAt: start, completedAt: end }, conflict, changed: localStart || localEnd };
}
