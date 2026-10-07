import {
  loadSessionSnapshotById,
  persistSessionDraftSnapshot,
  reviveSessionRow,
  type SessionDraftExerciseInput,
  type SessionDraftExerciseSnapshot,
} from '@/src/data/session-drafts';
import { normalizeSessionSetType } from '@/src/data/set-types';
import {
  createDrizzleSessionPlanStore,
  type PlanGraph,
  type SessionPlanStore,
} from '@/src/data/session-plan-store';
import { planAttachedSetId, planStartCardId, planStartSessionId, planStartSetId, readPlanMaterializationOwnerId } from './deterministic-ids';
import type { AddPlanBlockResult, StartSessionPlanResult } from './types';

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
  const deterministicSessionId = planStartSessionId(ownerId, planId);
  const existingSession = await loadSessionSnapshotById(deterministicSessionId);
  const isCompleted = existingSession?.status === 'completed';
  const targetSessionId = isCompleted ? undefined : deterministicSessionId;
  if (!isCompleted) {
    // A discarded earlier start leaves the deterministic session row
    // tombstoned; the retry upserts the same rows, so the row must come back —
    // otherwise the graph revives under a session no query can ever show.
    await reviveSessionRow(deterministicSessionId, now);
  }
  await planStore.releaseDiscardedBlockClaims(blocks.map((b) => b.id), now);
  const result = await persistSessionDraftSnapshot(
    {
      ...(targetSessionId ? { sessionId: targetSessionId } : {}),
      gymId: graph.plan.gymId,
      startedAt: now,
      sourcePlanId: isCompleted ? null : planId,
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

  return { status: 'started', sessionId: result.sessionId };
};

/** Maps one loaded exercise card back to a persistence input, provenance included. */
const toDraftExerciseInput = (exercise: SessionDraftExerciseSnapshot): SessionDraftExerciseInput => ({
  id: exercise.id,
  exerciseDefinitionId: exercise.exerciseDefinitionId,
  name: exercise.name,
  machineName: exercise.machineName,
  sourcePlanExerciseId: exercise.sourcePlanExerciseId ?? null,
  sets: exercise.sets.map((set) => ({
    id: set.id,
    repsValue: set.repsValue,
    weightValue: set.weightValue,
    setType: set.setType,
    plannedRepsValue: set.plannedRepsValue ?? null,
    plannedWeightValue: set.plannedWeightValue ?? null,
    plannedSetType: set.plannedSetType ?? null,
    performanceStatus: set.performanceStatus ?? null,
    sourcePlanSetId: set.sourcePlanSetId ?? null,
  })),
});

const plannedSetInput = (
  cardId: string,
  target: { id: string; targetWeightValue: string | null; targetReps: number; targetSetType: string | null },
): SessionDraftExerciseInput['sets'][number] => ({
  id: planAttachedSetId(cardId, target.id),
  repsValue: '',
  weightValue: '',
  // The working default in the recorder's set vocabulary; the target's own
  // type stays in planned_set_type.
  setType: null,
  plannedRepsValue: String(target.targetReps),
  plannedWeightValue: target.targetWeightValue,
  plannedSetType: normalizeSessionSetType(target.targetSetType),
  performanceStatus: 'planned',
  sourcePlanSetId: target.id,
});

/** A compatible unsourced card: same owned definition, no source block yet. */
const isCompatibleUnsourcedCard = (
  card: SessionDraftExerciseSnapshot,
  exerciseDefinitionId: string,
): boolean =>
  card.exerciseDefinitionId === exerciseDefinitionId &&
  (card.sourcePlanExerciseId ?? null) === null;

/**
 * Appends one planned block to the active session, or starts one from the
 * source plan when none exists (`addPlanBlockToSession`):
 *
 * - **Explicit target** — a supplied card wins when it is live, in the active
 *   session, references the same non-null exercise definition, and is not
 *   already sourced from another plan block; anything else is a typed
 *   `target-invalid` and nothing is written.
 * - **Automatic matching** — exactly one compatible unsourced card attaches;
 *   two or more return `ambiguous` with the candidate ids and write nothing;
 *   none creates a sourced card at the end of the session.
 * - **No active session** — one transaction creates the active session with
 *   the plan's gym (individual-block starts leave `source_plan_id` null) and
 *   the block's card.
 *
 * Copied targets take the next dense positions after the card's existing live
 * sets (manual warm-ups stay above them by default), each carrying its
 * `source_plan_set_id`, with actuals blank and `performance_status = 'planned'`.
 * Repeating the call returns the existing attachment — the deterministic card
 * and set ids plus the source-block uniqueness guard keep a retry or a
 * competing device at one live attachment.
 */
export const addPlanBlockToSession = async (
  planExerciseId: string,
  targetSessionExerciseId?: string,
  now: Date = new Date(),
): Promise<AddPlanBlockResult> => {
  const block = await planStore.loadPlanBlock(planExerciseId);
  if (!block) {
    return { status: 'block-not-found' };
  }
  if (block.exercise.progressStatus !== 'pending' || block.exercise.exerciseDefinitionId === null) {
    return { status: 'block-not-available' };
  }
  const exerciseDefinitionId = block.exercise.exerciseDefinitionId;

  await planStore.releaseDiscardedBlockClaims([planExerciseId], now);

  const existingCard = await planStore.findLiveSourcedCardForBlock(planExerciseId);
  if (existingCard) {
    // Same-block retry: the materialized rows already exist wherever the
    // block was claimed (active or completed session, this device or pulled).
    return { status: 'attached', sessionId: existingCard.sessionId, sessionExerciseId: existingCard.id };
  }

  const activeSessionId = await planStore.findActiveSessionId();
  const ownerId = await readPlanMaterializationOwnerId();

  if (activeSessionId !== null) {
    const graph = await loadSessionSnapshotById(activeSessionId);
    if (!graph || graph.status !== 'active') {
      return { status: 'session-not-found' };
    }

    let targetCard: SessionDraftExerciseSnapshot;
    if (targetSessionExerciseId !== undefined) {
      const target = graph.exercises.find((exercise) => exercise.id === targetSessionExerciseId);
      const compatible =
        target !== undefined &&
        target.exerciseDefinitionId === exerciseDefinitionId &&
        (target.sourcePlanExerciseId ?? null) === null;
      if (!compatible || !target) {
        return { status: 'target-invalid' };
      }
      targetCard = target;
    } else {
      const candidates = graph.exercises.filter((exercise) =>
        isCompatibleUnsourcedCard(exercise, exerciseDefinitionId),
      );
      if (candidates.length > 1) {
        return { status: 'ambiguous', candidateSessionExerciseIds: candidates.map((card) => card.id) };
      }
      if (candidates.length === 1) {
        targetCard = candidates[0];
      } else {
        targetCard = {
          id: planStartCardId(ownerId, planExerciseId),
          exerciseDefinitionId,
          name: block.exercise.name,
          machineName: block.exercise.machineName,
          sourcePlanExerciseId: planExerciseId,
          sets: [],
        };
      }
    }

    const targetInput: SessionDraftExerciseInput = {
      id: targetCard.id,
      exerciseDefinitionId: targetCard.exerciseDefinitionId,
      name: targetCard.name,
      machineName: targetCard.machineName,
      // The card claims this block; its existing sets keep their own links.
      sourcePlanExerciseId: planExerciseId,
      sets: [
        ...toDraftExerciseInput(targetCard).sets,
        // Manual sets already on the card stay above the copied targets; the
        // graph rewrite re-densifies to 0..n-1 in array order.
        ...block.sets.map((target) => plannedSetInput(targetCard.id, target)),
      ],
    };
    const exercises = graph.exercises.map((exercise) =>
      exercise.id === targetCard.id ? targetInput : toDraftExerciseInput(exercise),
    );
    if (!graph.exercises.some((exercise) => exercise.id === targetCard.id)) {
      exercises.push(targetInput);
    }

    await persistSessionDraftSnapshot(
      {
        sessionId: graph.sessionId,
        gymId: graph.gymId,
        startedAt: graph.startedAt,
        sourcePlanId: graph.sourcePlanId ?? null,
        exercises,
      },
      { now },
    );
    return { status: 'attached', sessionId: graph.sessionId, sessionExerciseId: targetCard.id };
  }

  // No active session: create one from the source plan with exactly this
  // block, in one transaction.
  const cardId = planStartCardId(ownerId, planExerciseId);
  const result = await persistSessionDraftSnapshot(
    {
      gymId: block.plan.gymId,
      startedAt: now,
      exercises: [
        {
          id: cardId,
          exerciseDefinitionId,
          name: block.exercise.name,
          machineName: block.exercise.machineName,
          sourcePlanExerciseId: planExerciseId,
          sets: block.sets.map((target) => plannedSetInput(cardId, target)),
        },
      ],
    },
    { now },
  );
  const createdCard = await planStore.findLiveSourcedCardForBlock(planExerciseId);
  return { status: 'attached', sessionId: result.sessionId, sessionExerciseId: createdCard?.id ?? cardId };
};
