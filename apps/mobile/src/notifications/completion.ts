import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getRequiredSupabaseMobileClient } from '@/src/auth/supabase';
import type { LocalDatabase } from '@/src/data/bootstrap';
import { exerciseDefinitions, exerciseGroupLinks, exerciseSets, sessionExercises, sessions } from '@/src/data/schema';
import type { EntityTableName } from '@/src/sync/topo-order';
import { confirmNotificationCompletion, getPendingNotificationCompletions } from './api';
import { buildCompletionManifest, type CompletionEntity } from './workout-events';

type Serialize = (row: Record<string, unknown>, type: EntityTableName) => CompletionEntity;
let cursorAccount: string | null = null;
let cursor: string | null = null;

/** Called only under the sync lock after a quiet round; tombstones belong to the proof. */
export const readCompletedNotificationGraphs = (database: LocalDatabase, serialize: Serialize, sessionIds: string[]): CompletionEntity[][] =>
  database.transaction(tx => {
    if (sessionIds.length === 0) return [];
    const completed = tx.select().from(sessions).where(and(eq(sessions.status, 'completed'), isNull(sessions.deletedAt),
      inArray(sessions.id, sessionIds))).all();
    return completed.flatMap(session => {
      const exercises = tx.select().from(sessionExercises).where(eq(sessionExercises.sessionId, session.id)).all();
      const exerciseIds = exercises.map(row => row.id);
      const definitionIds = [...new Set(exercises.map(row => row.exerciseDefinitionId).filter((id): id is string => id !== null))];
      const sets = exerciseIds.length ? tx.select().from(exerciseSets).where(inArray(exerciseSets.sessionExerciseId, exerciseIds)).all() : [];
      const definitions = definitionIds.length ? tx.select().from(exerciseDefinitions).where(inArray(exerciseDefinitions.id, definitionIds)).all() : [];
      const links = definitionIds.length ? tx.select().from(exerciseGroupLinks).where(inArray(exerciseGroupLinks.exerciseDefinitionId, definitionIds)).all() : [];
      const rows = [session, ...exercises, ...sets, ...definitions, ...links];
      if (rows.some(row => row.localDirty)) return [];
      const entities = [serialize(session, 'sessions'), ...exercises.map(row => serialize(row, 'session_exercises')),
        ...sets.map(row => serialize(row, 'exercise_sets')), ...definitions.map(row => serialize(row, 'exercise_definitions')),
        ...links.map(row => serialize(row, 'exercise_group_links'))];
      return [buildCompletionManifest(entities)];
    });
  });

/** This optional acknowledgement never changes a converged personal-sync outcome. */
export const confirmSyncedNotificationCompletions = async (database: LocalDatabase, serialize: Serialize, userId: string | null): Promise<void> => {
  if (!userId) return;
  try {
    const { data, error } = await getRequiredSupabaseMobileClient().auth.getSession();
    if (error || data.session?.user.id !== userId) return;
    const token = data.session.access_token;
    if (cursorAccount !== userId) { cursorAccount = userId; cursor = null; }
    const page = await getPendingNotificationCompletions(cursor, token);
    cursor = page.next_session_id;
    const graphs = readCompletedNotificationGraphs(database, serialize, page.session_ids);
    await Promise.allSettled(graphs.map(graph => {
      const session = graph.find(row => row.type === 'sessions')!;
      return confirmNotificationCompletion(session.id, graph, token);
    }));
  } catch { /* Personal sync remains converged when this optional notification proof fails. */ }
};

export const __resetNotificationCompletionCursorForTests = (): void => { cursorAccount = null; cursor = null; };
