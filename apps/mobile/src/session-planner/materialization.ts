import { persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { normalizeSessionSetType } from '@/src/data/set-types';
import {
  createDrizzleSessionPlanStore,
  type PlanGraph,
  type SessionPlanStore,
} from '@/src/data/session-plan-store';
import { planStartCardId, planStartSessionId, planStartSetId, readPlanMaterializationOwnerId } from './deterministic-ids';
import type { StartSessionPlanResult } from './types';

/**
 * Whole-plan materialization (`startSessionPlan`): one local transaction turns
 * every available block of a plan into ordinary active-session rows that the
 * recorder already understands, with the plan's targets copied into the
 * `planned_*` fields and per-row source links. It never resolves a block —
 * attachment alone leaves it pending — and never touches performed history.
 *
 * Retry convergence: the started session and every created card/set carry a
 * deterministic owner-composed id, so a same-plan retry upserts the same rows
 * (and an active session started from this plan — local or pulled from a
 * competing device — returns as `already-active` instead of duplicating).
 */

const planStore: SessionPlanStore = createDrizzleSessionPlanStore();

/**
 * A block is available when it is pending, references an exercise definition
 * (the performed card and card matching both require the owned reference), and
 * no live performed card claims it. Attached and resolved blocks are never
 * re-materialized — that would violate source-block uniqueness and
 * re-materialize resolved work.
 */
type AvailableBlock = PlanGraph['exercises'][number] & { exerciseDefinitionId: string };

const availableBlocks = async (graph: PlanGraph): Promise<AvailableBlock[]> => {
  const cards = await planStore.listSourcedCardsForBlocks(graph.exercises.map((block) => block.id));
  const attached = new Set(cards.map((card) => card.sourcePlanExerciseId));
  return graph.exercises.filter(
    (block): block is AvailableBlock =>
      block.progressStatus === 'pending' && block.exerciseDefinitionId !== null && !attached.has(block.id),
  );
};

export const startSessionPlan = async (planId: string, now: Date = new Date()): Promise<StartSessionPlanResult> => {
  const graph = await planStore.loadPlanGraph(planId);
  if (!graph) {
    return { status: 'plan-not-found' };
  }

  // Same-plan retry first: the active session from this plan — local or
  // pulled from a competing device — is the answer, not a conflict.
  const samePlanSession = await planStore.findActiveSessionIdBySourcePlan(planId);
  if (samePlanSession) {
    return { status: 'already-active', sessionId: samePlanSession };
  }

  const activeSession = await planStore.findActiveSessionId();
  if (activeSession) {
    return { status: 'active-conflict', activeSessionId: activeSession };
  }

  const blocks = await availableBlocks(graph);
  if (blocks.length === 0) {
    return { status: 'no-pending-blocks' };
  }

  const ownerId = await readPlanMaterializationOwnerId();
  const sessionId = planStartSessionId(ownerId, planId);
  await persistSessionDraftSnapshot(
    {
      sessionId,
      gymId: graph.plan.gymId,
      startedAt: now,
      sourcePlanId: planId,
      exercises: blocks.map((block) => ({
        id: planStartCardId(ownerId, block.id),
        exerciseDefinitionId: block.exerciseDefinitionId,
        name: block.name,
        machineName: block.machineName,
        sourcePlanExerciseId: block.id,
        sets: block.sets.map((target) => ({
          id: planStartSetId(ownerId, target.id),
          repsValue: '',
          weightValue: '',
          // The working default in the recorder's set vocabulary; the target's
          // own type stays in planned_set_type.
          setType: null,
          plannedRepsValue: String(target.targetReps),
          plannedWeightValue: target.targetWeightValue,
          plannedSetType: normalizeSessionSetType(target.targetSetType),
          performanceStatus: 'planned',
          sourcePlanSetId: target.id,
        })),
      })),
    },
    { now },
  );

  return { status: 'started', sessionId };
};
