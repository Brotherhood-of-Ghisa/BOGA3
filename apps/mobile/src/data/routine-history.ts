import { and, eq, inArray, isNull } from 'drizzle-orm';

import { bootstrapLocalDataLayer } from './bootstrap';
import { exerciseSets, sessionExercises, sessionPlanExercises, sessionPlanSets, sessionPlanUses, sessions } from './schema';
import { isConfirmedPerformedSet, type SessionSetPerformanceStatus } from '@/src/exercise-calculations/set-semantics';

export type RoutineWorkout = {
  planId: string;
  sessionId: string;
  status: 'active' | 'completed';
  completedAt: Date | null;
  updatedAt: Date;
  hasConfirmedSourceWork: boolean;
};

/** Includes tombstoned authored sources: editing future intent cannot erase history. */
export const readRoutineHistory = async (planIds: string[]) => {
  if (!planIds.length) return { knownPlanIds: [] as string[], workouts: [] as RoutineWorkout[], uses: [] as (typeof sessionPlanUses.$inferSelect)[] };
  const database = await bootstrapLocalDataLayer();
  return database.transaction(tx => {
    const roots = tx.select().from(sessions)
      .where(inArray(sessions.sourcePlanId, planIds)).all();
    const cards = tx.select({ planId: sessionPlanExercises.sessionPlanId, cardId: sessionExercises.id,
      sessionId: sessions.id, status: sessions.status, completedAt: sessions.completedAt, updatedAt: sessions.updatedAt,
      sessionDeletedAt: sessions.deletedAt, cardDeletedAt: sessionExercises.deletedAt })
      .from(sessionExercises).innerJoin(sessions, eq(sessions.id, sessionExercises.sessionId))
      .innerJoin(sessionPlanExercises, eq(sessionPlanExercises.id, sessionExercises.sourcePlanExerciseId))
      .where(inArray(sessionPlanExercises.sessionPlanId, planIds)).all();
    const liveCards = cards.filter(card => !card.sessionDeletedAt && !card.cardDeletedAt);
    const workouts = new Map<string, RoutineWorkout>();
    const key = (planId: string, sessionId: string) => JSON.stringify([planId, sessionId]);
    for (const row of roots) {
      if (row.deletedAt) continue;
      workouts.set(key(row.sourcePlanId!, row.id), { planId: row.sourcePlanId!, sessionId: row.id,
        status: row.status, completedAt: row.completedAt, updatedAt: row.updatedAt, hasConfirmedSourceWork: false });
    }
    for (const row of liveCards) {
      const id = key(row.planId, row.sessionId);
      if (!workouts.has(id)) workouts.set(id, { ...row, hasConfirmedSourceWork: false });
    }
    const sets = liveCards.length ? tx.select({ cardId: exerciseSets.sessionExerciseId,
      reps: exerciseSets.repsValue, weight: exerciseSets.weightValue, performanceStatus: exerciseSets.performanceStatus })
      .from(exerciseSets).innerJoin(sessionPlanSets, eq(sessionPlanSets.id, exerciseSets.sourcePlanSetId))
      .innerJoin(sessionExercises, and(eq(sessionExercises.id, exerciseSets.sessionExerciseId),
        eq(sessionExercises.sourcePlanExerciseId, sessionPlanSets.sessionPlanExerciseId)))
      .where(and(inArray(exerciseSets.sessionExerciseId, liveCards.map(card => card.cardId)), isNull(exerciseSets.deletedAt))).all() : [];
    const confirmedCards = new Set(sets.filter(set => isConfirmedPerformedSet({
      reps: set.reps, weight: set.weight, performanceStatus: set.performanceStatus as SessionSetPerformanceStatus,
    })).map(set => set.cardId));
    for (const card of liveCards) {
      if (confirmedCards.has(card.cardId)) workouts.get(key(card.planId, card.sessionId))!.hasConfirmedSourceWork = true;
    }
    const uses = tx.select().from(sessionPlanUses).where(and(
      inArray(sessionPlanUses.sessionPlanId, planIds), isNull(sessionPlanUses.deletedAt),
    )).all();
    return { knownPlanIds: [...new Set([...roots.map(row => row.sourcePlanId!), ...cards.map(row => row.planId)])],
      workouts: [...workouts.values()], uses };
  });
};
