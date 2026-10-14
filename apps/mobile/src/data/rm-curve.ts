import { and, eq, gte, isNull, lt } from 'drizzle-orm';
import { EMPTY_SESSION_WEIGHT, type ResolvedSessionWeight } from '@/src/bodyweight/as-of';
import { requireDate } from '@/src/bodyweight/weight-entry';
import { getPersonalEffortPolicy } from '@/src/config/personal-effort';
import { personalLoadContext } from '@/src/exercise-calculations/analytics';
import type { LoadContext, LoadInputMode } from '@/src/exercise-calculations/load-metrics';
import { bootstrapLocalDataLayer } from './bootstrap';
import { loadAsOfWeightResolver } from './bodyweight';
import { exerciseDefinitions, exerciseSets, gyms, sessionExercises, sessions, userSettings } from './schema';

export type RmCurveRow = ResolvedSessionWeight & {
  setId: string; sessionId: string; sessionExerciseId: string; blockOrder: number; setOrder: number;
  startedAt: Date; completedAt: Date; gymId: string | null; gymName: string | null;
  weightValue: string; repsValue: string; setType: string | null; performanceStatus: string | null;
  loadContext: LoadContext;
};
export type RmCurveGraph = {
  definition: { id: string; name: string; loadInputMode: LoadInputMode };
  rows: RmCurveRow[];
};
export type RmCurveRead = { exerciseDefinitionId: string; start: Date; end: Date };

/** One bounded graph snapshot; no IN-list limit, per-set reading query or derived writes. */
export async function loadRmCurveGraph(input: RmCurveRead): Promise<RmCurveGraph | null> {
  requireDate(input.start, 'start'); requireDate(input.end, 'end');
  if (input.end <= input.start) throw new Error('Invalid RM history window');
  if (!input.exerciseDefinitionId.trim()) return null;
  const db = await bootstrapLocalDataLayer();
  const effortPolicy = getPersonalEffortPolicy();
  return db.transaction(tx => {
    const definition = tx.select().from(exerciseDefinitions).where(and(
      eq(exerciseDefinitions.id, input.exerciseDefinitionId), isNull(exerciseDefinitions.deletedAt),
    )).get();
    if (!definition) return null;
    const enabled = tx.select().from(userSettings).where(eq(userSettings.id, 'settings')).get()?.bodyweightCalculationsEnabled ?? false;
    const resolveWeight = enabled && definition.bodyweightContribution > 0
      ? loadAsOfWeightResolver(tx) : () => EMPTY_SESSION_WEIGHT;
    const rows = tx.select({
      setId: exerciseSets.id, sessionId: sessions.id, sessionExerciseId: sessionExercises.id,
      blockOrder: sessionExercises.orderIndex, setOrder: exerciseSets.orderIndex,
      startedAt: sessions.startedAt, completedAt: sessions.completedAt,
      gymId: sessions.gymId, gymName: gyms.name,
      weightValue: exerciseSets.weightValue, repsValue: exerciseSets.repsValue,
      setType: exerciseSets.setType, performanceStatus: exerciseSets.performanceStatus,
    }).from(exerciseSets).innerJoin(sessionExercises, eq(exerciseSets.sessionExerciseId, sessionExercises.id))
      .innerJoin(sessions, eq(sessionExercises.sessionId, sessions.id)).leftJoin(gyms, eq(sessions.gymId, gyms.id))
      .where(and(eq(sessionExercises.exerciseDefinitionId, input.exerciseDefinitionId), eq(sessions.status, 'completed'),
        isNull(sessions.deletedAt), isNull(sessionExercises.deletedAt), isNull(exerciseSets.deletedAt),
        gte(sessions.completedAt, input.start), lt(sessions.completedAt, input.end))).all();
    return { definition: { id: definition.id, name: definition.name, loadInputMode: definition.loadInputMode },
      rows: rows.flatMap(row => {
        if (row.completedAt === null) return [];
        const weight = resolveWeight(row.startedAt);
        return [{ ...row, completedAt: row.completedAt, ...weight,
          loadContext: personalLoadContext(enabled, definition, weight, effortPolicy) }];
      }) };
  });
}
