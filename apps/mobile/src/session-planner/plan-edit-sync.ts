import { planQueries, type PlanDetailView } from './plan-queries';
import type { PlanFormState } from './plan-form-model';
import { planFormToDraft } from './plan-form-model';
import { validatePlanExerciseDraft } from './plan-validation';
import { planRepository, type PlanMutationResult } from './plan-repository';
import type { PlanExerciseDraft, PlanFieldError } from './types';

/**
 * An edit of one plan, composed from the repository's guarded operations —
 * never a whole-graph rewrite. Consumed blocks (attached or resolved) are
 * read-only snapshots: the diff is checked against the loaded detail first,
 * so touching one refuses the whole edit with `immutable-block` and writes
 * nothing. Meta (title, schedule, gym) is authored intent and always
 * editable.
 *
 * The form's blocks carry the plan block id they came from
 * (`sourceBlockId`); the diff is positional: removed blocks delete, added
 * blocks append, kept-and-changed blocks rewrite in place, and the kept
 * order is written as one reorder.
 */
export const savePlanEdits = async (
  planId: string,
  form: PlanFormState,
): Promise<PlanMutationResult> => {
  const prepared = planFormToDraft(form);
  if (prepared.draft === null) {
    return {
      status: 'validation-failed',
      errors: [{ path: 'scheduledFor', code: 'invalid_schedule', message: prepared.scheduleError }],
    };
  }
  const detail = await planQueries.loadPlanDetail(planId);
  if (detail === null) {
    return { status: 'not-found' };
  }

  // The write plan, checked against read-only state before anything writes.
  const plan = planBlockOperations(detail, form, prepared.draft.exercises);
  if (plan.kind === 'validation-failed') {
    return { status: 'validation-failed', errors: plan.errors };
  }
  if (plan.touchesConsumed) {
    return { status: 'immutable-block' };
  }

  const meta = await planRepository.updatePlanMeta(planId, {
    title: prepared.draft.title,
    gymId: prepared.draft.gymId,
    scheduledFor: prepared.draft.scheduledFor,
  });
  if (meta.status !== 'updated' && meta.status !== 'saved') {
    return meta;
  }

  for (const op of plan.operations) {
    const result =
      op.kind === 'add'
        ? await planRepository.addPlanBlock(planId, op.draft)
        : op.kind === 'update'
          ? await planRepository.updatePlanBlock(op.id, op.draft)
          : await planRepository.deletePlanBlock(op.id);
    if (result.status !== 'saved' && result.status !== 'updated') {
      return result;
    }
  }

  // Only a real order change reorders — and a plan with a consumed block
  // never reorders (its block sequence is a read-only snapshot too).
  const originalKeptOrder = detail.blocks.map((block) => block.id).filter((id) => plan.keptIds.includes(id));
  const orderChanged =
    plan.keptIds.length > 0 &&
    (plan.keptIds.length !== originalKeptOrder.length ||
      plan.keptIds.some((id, index) => id !== originalKeptOrder[index]));
  if (orderChanged) {
    const reordered = await planRepository.reorderPlanBlocks(planId, plan.keptIds);
    if (reordered.status !== 'saved' && reordered.status !== 'updated') {
      return reordered;
    }
  }
  return { status: 'updated' };
};

type BlockOp =
  | { kind: 'add'; draft: PlanExerciseDraft }
  | { kind: 'update'; id: string; draft: PlanExerciseDraft }
  | { kind: 'delete'; id: string };

type PlanBlockDiff =
  | {
      kind: 'planned';
      keptIds: string[];
      operations: BlockOp[];
      touchesConsumed: boolean;
    }
  | { kind: 'validation-failed'; errors: PlanFieldError[] };

/** The positional block diff of one edit, against the loaded detail. */
const planBlockOperations = (
  detail: PlanDetailView,
  form: PlanFormState,
  drafts: PlanExerciseDraft[],
): PlanBlockDiff => {
  const blocksById = new Map(detail.blocks.map((block) => [block.id, block]));
  const keptIds: string[] = [];
  const operations: BlockOp[] = [];
  for (let index = 0; index < form.blocks.length; index += 1) {
    const sourceId = form.blocks[index].sourceBlockId ?? null;
    const draft = drafts[index];
    const existing = sourceId !== null ? blocksById.get(sourceId) : undefined;
    if (existing === undefined) {
      operations.push({ kind: 'add', draft });
      continue;
    }
    const normalized = validatePlanExerciseDraft(draft);
    if (!normalized.ok) {
      return { kind: 'validation-failed', errors: normalized.errors };
    }
    if (blockDiffers(existing, normalized.value.exercise)) {
      operations.push({ kind: 'update', id: existing.id, draft });
    }
    keptIds.push(existing.id);
  }
  for (const block of detail.blocks) {
    if (!keptIds.includes(block.id)) {
      operations.push({ kind: 'delete', id: block.id });
    }
  }
  const touchesConsumed = operations.some(
    (op) =>
      (op.kind === 'update' || op.kind === 'delete') &&
      blocksById.get(op.id)?.status !== 'pending',
  );
  return { kind: 'planned', keptIds, operations, touchesConsumed };
};

const blockDiffers = (
  existing: PlanDetailView['blocks'][number],
  draft: { name: string; machineName: string | null; exerciseDefinitionId: string | null; sets: { targetWeightValue: string | null; targetReps: number; targetSetType: unknown }[] },
): boolean =>
  existing.name !== draft.name ||
  (existing.machineName ?? '') !== (draft.machineName ?? '') ||
  existing.exerciseDefinitionId !== draft.exerciseDefinitionId ||
  existing.targets.length !== draft.sets.length ||
  existing.targets.some(
    (target, index) =>
      target.targetWeightValue !== draft.sets[index].targetWeightValue ||
      target.targetReps !== draft.sets[index].targetReps ||
      target.targetSetType !== draft.sets[index].targetSetType,
  );
