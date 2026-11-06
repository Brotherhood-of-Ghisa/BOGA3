import { ActiveSessionConflictError, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import type { PlanGraph } from '@/src/data/session-plan-store';
import { createPlanUseId, skipRoutineUse } from '@/src/data/session-plan-use-store';
import { normalizeSessionSetType } from '@/src/data/set-types';
import type { StartSessionPlanResult } from './types';

/** Retain this action ID until an uncertain Skip has succeeded or been refused. */
export const createRoutineActionId = createPlanUseId;

export const skipSessionPlanUse = (planId: string, actionId: string, now = new Date()) =>
  skipRoutineUse(planId, actionId, now);

/** Reuse ordinary recorder rows; the use identity scopes copied provenance. */
export const startRoutineWorkout = async (graph: PlanGraph, now: Date): Promise<StartSessionPlanResult> => {
  if (graph.exercises.some(block => block.exerciseDefinitionId === null)) return { status: 'unmapped-blocks' };
  const blocks = graph.exercises;
  if (!blocks.length) return { status: 'no-pending-blocks' };
  const useId = createRoutineActionId();
  try {
    const result = await persistSessionDraftSnapshot({
      sessionId: `${useId}:start`,
      sourcePlanId: graph.plan.id,
      sourcePlanUseId: useId,
      gymId: graph.plan.gymId,
      startedAt: now,
      exercises: blocks.map(block => ({
        id: `${useId}:${block.id}:start`,
        exerciseDefinitionId: block.exerciseDefinitionId!,
        name: block.name,
        machineName: null,
        sourcePlanExerciseId: block.id,
        sourcePlanUseId: useId,
        sets: block.sets.map(target => ({
          id: `${useId}:${target.id}:start`,
          repsValue: '', weightValue: '', setType: null,
          plannedRepsValue: String(target.targetReps),
          plannedWeightValue: target.targetWeightValue,
          plannedSetType: normalizeSessionSetType(target.targetSetType),
          performanceStatus: 'planned',
          sourcePlanSetId: target.id,
          sourcePlanUseId: useId,
        })),
      })),
    }, { now, requireNoActiveSession: true, newPlanUse: { id: useId, planId: graph.plan.id } });
    return { status: 'started', sessionId: result.sessionId };
  } catch (error) {
    if (error instanceof ActiveSessionConflictError) {
      return { status: 'active-conflict', activeSessionId: error.activeSessionId };
    }
    throw error;
  }
};
