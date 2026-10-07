import {
  createDrizzleSessionPlanStore,
  type PlanGraph,
  type SavePlanExerciseGraphInput,
  type SaveSessionPlanGraphInput,
  type SessionPlanStore,
} from '@/src/data/session-plan-store';
import { normalizeSessionSetType } from '@/src/data/set-types';
import {
  isExactIdPermutation,
  PLAN_LIMITS,
  validatePlanDraft,
  validatePlanExerciseDraft,
  validateProgrammeDraft,
  validateProgrammeMeta,
} from './plan-validation';
import type {
  NormalizedPlan,
  PlanDraft,
  PlanExerciseDraft,
  PlanFieldError,
  PlanValidationResult,
  ProgrammeDraft,
} from './types';

/**
 * The plan/programme repository: the mutation boundary for planner screens.
 * Every write validates first and then runs as one store transaction, so a
 * rejected save leaves no partial rows, and lifecycle rules decide what is
 * still editable:
 *
 * - A block is *consumed* once a live performed card claims it (attachment) or
 *   it is explicitly resolved (completed/skipped). Consumed blocks are
 *   read-only snapshots; future unattached pending blocks stay fully editable.
 * - Plan meta (title, gym, schedule) is authored intent, not block state, and
 *   stays editable at any time.
 * - A plan whose blocks are all unconsumed can be deleted; a consumed block
 *   pins its plan against deletion. Deleting a programme detaches its plans
 *   (they become standalone) and destroys nothing.
 *
 * Screens never touch the store or the tables directly.
 */

export type PlanMutationResult =
  | { status: 'saved'; id: string }
  | { status: 'updated' }
  | { status: 'not-found' }
  | { status: 'immutable-block' }
  | { status: 'limit-exceeded' }
  | { status: 'invalid-order' }
  | { status: 'validation-failed'; errors: PlanFieldError[] };

export type PlanRepository = {
  createPlan(draft: PlanDraft, now?: Date): Promise<PlanMutationResult>;
  createProgramme(draft: ProgrammeDraft, now?: Date): Promise<PlanMutationResult>;
  updatePlanMeta(
    planId: string,
    patch: { title?: string; gymId?: string | null; scheduledFor?: Date | null },
    now?: Date,
  ): Promise<PlanMutationResult>;
  updatePlanBlock(planExerciseId: string, draft: PlanExerciseDraft, now?: Date): Promise<PlanMutationResult>;
  addPlanBlock(planId: string, draft: PlanExerciseDraft, now?: Date): Promise<PlanMutationResult>;
  deletePlan(planId: string, now?: Date): Promise<PlanMutationResult>;
  deletePlanBlock(planExerciseId: string, now?: Date): Promise<PlanMutationResult>;
  duplicatePlan(
    planId: string,
    patch?: { title?: string; scheduledFor?: Date | null },
    now?: Date,
  ): Promise<PlanMutationResult>;
  updateProgramme(
    programmeId: string,
    patch: { name: string; description: string },
    now?: Date,
  ): Promise<PlanMutationResult>;
  reorderProgrammePlans(programmeId: string, orderedPlanIds: string[], now?: Date): Promise<PlanMutationResult>;
  reorderPlanBlocks(planId: string, orderedExerciseIds: string[], now?: Date): Promise<PlanMutationResult>;
  reorderPlanSets(planExerciseId: string, orderedSetIds: string[], now?: Date): Promise<PlanMutationResult>;
  deleteProgramme(programmeId: string, now?: Date): Promise<PlanMutationResult>;
};

const planStore: SessionPlanStore = createDrizzleSessionPlanStore();

const toStoreExercise = (exercise: NormalizedPlan['exercises'][number]): SavePlanExerciseGraphInput => ({
  exerciseDefinitionId: exercise.exerciseDefinitionId,
  name: exercise.name,
  machineName: exercise.machineName,
  sets: exercise.sets.map((set) => ({
    targetWeightValue: set.targetWeightValue,
    targetReps: set.targetReps,
    targetSetType: set.targetSetType,
  })),
});

const toStorePlanInput = (plan: NormalizedPlan, options: { planId?: string } = {}): SaveSessionPlanGraphInput => ({
  planId: options.planId,
  gymId: plan.gymId,
  title: plan.title,
  scheduledFor: plan.scheduledFor,
  exercises: plan.exercises.map((exercise) => toStoreExercise(exercise)),
});

const validatePlanMetaFields = (
  title: string,
  scheduledFor: Date | null,
): PlanValidationResult<{ title: string; scheduledFor: Date | null }> => {
  const errors: PlanFieldError[] = [];
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    errors.push({ path: 'title', code: 'required', message: 'Give the plan a title.' });
  } else if (trimmed.length > PLAN_LIMITS.name.max) {
    errors.push({ path: 'title', code: 'too_long', message: `Use at most ${PLAN_LIMITS.name.max} characters.` });
  }
  if (scheduledFor !== null && Number.isNaN(scheduledFor.getTime())) {
    errors.push({ path: 'scheduledFor', code: 'invalid_schedule', message: 'Pick a valid date and time.' });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: { title: trimmed, scheduledFor } };
};

/**
 * A block is consumed when it is explicitly resolved (`progress_status` no
 * longer pending) or a live performed card claims it (attachment). Consumed
 * blocks are immutable snapshots; pending unattached blocks stay editable.
 */
const blockIsConsumed = async (planExerciseId: string, progressStatus: string): Promise<boolean> =>
  progressStatus !== 'pending' || (await planStore.findLiveSourcedCardForBlock(planExerciseId)) !== null;

const consumedBlockIdsInGraph = async (graph: PlanGraph): Promise<Set<string>> => {
  const consumed = new Set<string>();
  for (const exercise of graph.exercises) {
    if (await blockIsConsumed(exercise.id, exercise.progressStatus)) {
      consumed.add(exercise.id);
    }
  }
  return consumed;
};

/**
 * Duplicates are authored plans: fresh pending blocks, unscheduled unless the
 * caller says otherwise, with the authored gym carried over. The default title
 * appends " (copy)", truncating the original so the result fits the name limit.
 */
const toDuplicatePlanInput = (
  graph: PlanGraph,
  patch: Parameters<PlanRepository['duplicatePlan']>[1],
): SaveSessionPlanGraphInput => {
  const copySuffix = ' (copy)';
  const maxBaseLength = PLAN_LIMITS.name.max - copySuffix.length;
  const defaultTitle =
    graph.plan.title.length > maxBaseLength
      ? `${graph.plan.title.slice(0, maxBaseLength)}${copySuffix}`
      : `${graph.plan.title}${copySuffix}`;
  return {
    gymId: graph.plan.gymId,
    title: patch?.title ?? defaultTitle,
    scheduledFor: patch?.scheduledFor === undefined ? null : patch.scheduledFor,
    exercises: graph.exercises.map((exercise) => ({
      exerciseDefinitionId: exercise.exerciseDefinitionId,
      name: exercise.name,
      machineName: exercise.machineName,
      sets: exercise.sets.map((set) => ({
        targetWeightValue: set.targetWeightValue,
        targetReps: set.targetReps,
        targetSetType: normalizeSessionSetType(set.targetSetType),
      })),
    })),
  };
};

export const createPlanRepository = (): PlanRepository => ({
  async createPlan(draft, now = new Date()) {
    const validation = validatePlanDraft(draft);
    if (!validation.ok) {
      return { status: 'validation-failed', errors: validation.errors };
    }
    const planId = await planStore.savePlanGraph(toStorePlanInput(validation.value.plan), now);
    return { status: 'saved', id: planId };
  },

  async createProgramme(draft, now = new Date()) {
    const validation = validateProgrammeDraft(draft);
    if (!validation.ok) {
      return { status: 'validation-failed', errors: validation.errors };
    }
    const { programmeId } = await planStore.saveProgrammeGraph(
      {
        name: validation.value.programme.name,
        description: validation.value.programme.description,
        plans: validation.value.programme.plans.map((plan) => toStorePlanInput(plan)),
      },
      now,
    );
    return { status: 'saved', id: programmeId };
  },

  async updatePlanMeta(planId, patch, now = new Date()) {
    const graph = await planStore.loadPlanGraph(planId);
    if (!graph) {
      return { status: 'not-found' };
    }
    // Unpatched fields keep their stored values, so a schedule-only edit
    // never re-validates or touches block content.
    const title = patch.title ?? graph.plan.title;
    const gymId = patch.gymId === undefined ? graph.plan.gymId : patch.gymId;
    const scheduledFor = patch.scheduledFor === undefined ? graph.plan.scheduledFor : patch.scheduledFor;
    const validation = validatePlanMetaFields(title, scheduledFor);
    if (!validation.ok) {
      return { status: 'validation-failed', errors: validation.errors };
    }
    const wrote = await planStore.updatePlanMeta({
      planId,
      title: validation.value.title,
      gymId,
      scheduledFor,
      now,
    });
    return wrote ? { status: 'updated' } : { status: 'not-found' };
  },

  async updatePlanBlock(planExerciseId, draft, now = new Date()) {
    const block = await planStore.loadPlanBlock(planExerciseId);
    if (!block) {
      return { status: 'not-found' };
    }
    if (await blockIsConsumed(planExerciseId, block.exercise.progressStatus)) {
      return { status: 'immutable-block' };
    }
    const validation = validatePlanExerciseDraft(draft);
    if (!validation.ok) {
      return { status: 'validation-failed', errors: validation.errors };
    }
    const wrote = await planStore.savePlanExerciseGraph({
      planExerciseId,
      exerciseDefinitionId: validation.value.exercise.exerciseDefinitionId,
      name: validation.value.exercise.name,
      machineName: validation.value.exercise.machineName,
      sets: validation.value.exercise.sets,
      now,
    });
    return wrote ? { status: 'updated' } : { status: 'not-found' };
  },

  async addPlanBlock(planId, draft, now = new Date()) {
    const graph = await planStore.loadPlanGraph(planId);
    if (!graph) {
      return { status: 'not-found' };
    }
    if (graph.exercises.length >= PLAN_LIMITS.planExercises.max) {
      return { status: 'limit-exceeded' };
    }
    const validation = validatePlanExerciseDraft(draft);
    if (!validation.ok) {
      return { status: 'validation-failed', errors: validation.errors };
    }
    const planExerciseId = await planStore.insertPlanExercise({
      planId,
      exercise: toStoreExercise(validation.value.exercise),
      now,
    });
    return { status: 'saved', id: planExerciseId };
  },

  async deletePlan(planId, now = new Date()) {
    const graph = await planStore.loadPlanGraph(planId);
    if (!graph) {
      return { status: 'not-found' };
    }
    if ((await consumedBlockIdsInGraph(graph)).size > 0) {
      return { status: 'immutable-block' };
    }
    const tombstoned = await planStore.tombstonePlan({ planId, now });
    return tombstoned ? { status: 'updated' } : { status: 'not-found' };
  },

  async deletePlanBlock(planExerciseId, now = new Date()) {
    const block = await planStore.loadPlanBlock(planExerciseId);
    if (!block) {
      return { status: 'not-found' };
    }
    if (await blockIsConsumed(planExerciseId, block.exercise.progressStatus)) {
      return { status: 'immutable-block' };
    }
    const tombstoned = await planStore.tombstonePlanExercise({ planExerciseId, now });
    return tombstoned ? { status: 'updated' } : { status: 'not-found' };
  },

  async duplicatePlan(planId, patch, now = new Date()) {
    const graph = await planStore.loadPlanGraph(planId);
    if (!graph) {
      return { status: 'not-found' };
    }
    const duplicate = toDuplicatePlanInput(graph, patch);
    const validation = validatePlanMetaFields(duplicate.title, duplicate.scheduledFor);
    if (!validation.ok) {
      return { status: 'validation-failed', errors: validation.errors };
    }
    const newPlanId = await planStore.savePlanGraph(duplicate, now);
    return { status: 'saved', id: newPlanId };
  },

  async updateProgramme(programmeId, patch, now = new Date()) {
    const programme = await planStore.loadProgramme(programmeId);
    if (!programme) {
      return { status: 'not-found' };
    }
    const validation = validateProgrammeMeta(patch.name, patch.description);
    if (!validation.ok) {
      return { status: 'validation-failed', errors: validation.errors };
    }
    const wrote = await planStore.updateProgrammeMeta({
      programmeId,
      name: validation.value.name,
      description: validation.value.description,
      now,
    });
    return wrote ? { status: 'updated' } : { status: 'not-found' };
  },

  async reorderProgrammePlans(programmeId, orderedPlanIds, now = new Date()) {
    const graphs = await planStore.listPlanGraphsByProgramme(programmeId);
    if (graphs.length === 0) {
      return { status: 'not-found' };
    }
    if (!isExactIdPermutation(graphs.map((graph) => graph.plan), orderedPlanIds)) {
      return { status: 'invalid-order' };
    }
    await planStore.reorderProgrammePlans({ programmeId, orderedPlanIds, now });
    return { status: 'updated' };
  },

  async reorderPlanBlocks(planId, orderedExerciseIds, now = new Date()) {
    const graph = await planStore.loadPlanGraph(planId);
    if (!graph) {
      return { status: 'not-found' };
    }
    if (!isExactIdPermutation(graph.exercises, orderedExerciseIds)) {
      return { status: 'invalid-order' };
    }
    if ((await consumedBlockIdsInGraph(graph)).size > 0) {
      return { status: 'immutable-block' };
    }
    await planStore.reorderPlanExercises({ planId, orderedExerciseIds, now });
    return { status: 'updated' };
  },

  async reorderPlanSets(planExerciseId, orderedSetIds, now = new Date()) {
    const block = await planStore.loadPlanBlock(planExerciseId);
    if (!block) {
      return { status: 'not-found' };
    }
    if (!isExactIdPermutation(block.sets, orderedSetIds)) {
      return { status: 'invalid-order' };
    }
    if (await blockIsConsumed(planExerciseId, block.exercise.progressStatus)) {
      return { status: 'immutable-block' };
    }
    await planStore.reorderPlanSets({ planExerciseId, orderedSetIds, now });
    return { status: 'updated' };
  },

  async deleteProgramme(programmeId, now = new Date()) {
    const programme = await planStore.loadProgramme(programmeId);
    if (!programme) {
      return { status: 'not-found' };
    }
    const tombstoned = await planStore.tombstoneProgramme({ programmeId, now });
    return tombstoned ? { status: 'updated' } : { status: 'not-found' };
  },
});

export const planRepository = createPlanRepository();
