import { planQueries } from './plan-queries';
import { savePlanEdits } from './plan-edit-sync';
import { planFormToDraft } from './plan-form-model';
import { programmeFormToDraft, type ProgrammeFormState } from './programme-form-model';
import { validateProgrammeDraft } from './plan-validation';
import { planRepository, type PlanMutationResult } from './plan-repository';

/**
 * An edit of one programme, composed from the repository's guarded operations —
 * never a whole-graph rewrite, so consumed child blocks stay read-only snapshots.
 *
 * The form's child sessions carry the plan id they came from (`sourcePlanId`).
 * The diff is by membership: children removed from the form are deleted
 * (refused when a consumed block pins them), kept children persist through
 * `savePlanEdits` (which refuses on consumed blocks before writing), new children
 * are created attached to the programme, and the form's full order is written as
 * one programme reorder. Every mutation result is checked before reporting
 * success, so a refused write never navigates away as if it had saved.
 */
export const saveProgrammeEdits = async (
  programmeId: string,
  form: ProgrammeFormState,
): Promise<PlanMutationResult> => {
  const prepared = programmeFormToDraft(form);
  if (prepared.draft === null) {
    return { status: 'validation-failed', errors: prepared.errors };
  }
  const validation = validateProgrammeDraft(prepared.draft);
  if (!validation.ok) {
    return { status: 'validation-failed', errors: validation.errors };
  }

  const detail = await planQueries.loadProgrammeDetail(programmeId);
  if (detail === null) {
    return { status: 'not-found' };
  }

  const meta = await planRepository.updateProgramme(programmeId, {
    name: prepared.draft.name,
    description: prepared.draft.description,
  });
  if (meta.status !== 'updated' && meta.status !== 'saved') {
    return meta;
  }

  const keptSourceIds = new Set(
    form.plans.map((plan) => plan.sourcePlanId).filter((id): id is string => id !== null),
  );

  // Remove first: a deleted child detaches from the programme, so the final
  // reorder sees exactly the kept and created children. A consumed block refuses.
  for (const plan of detail.plans) {
    if (keptSourceIds.has(plan.id)) {
      continue;
    }
    const removed = await planRepository.deletePlan(plan.id);
    if (removed.status !== 'updated' && removed.status !== 'saved') {
      return removed;
    }
  }

  const orderedPlanIds: string[] = [];
  for (const child of form.plans) {
    if (child.sourcePlanId !== null) {
      const saved = await savePlanEdits(child.sourcePlanId, child);
      if (saved.status !== 'updated' && saved.status !== 'saved') {
        return saved;
      }
      orderedPlanIds.push(child.sourcePlanId);
      continue;
    }
    const childDraft = planFormToDraft(child);
    if (childDraft.draft === null) {
      return {
        status: 'validation-failed',
        errors: [{ path: 'scheduledFor', code: 'invalid_schedule', message: childDraft.scheduleError }],
      };
    }
    const created = await planRepository.createPlanInProgramme(programmeId, childDraft.draft);
    if (created.status !== 'saved') {
      return created;
    }
    orderedPlanIds.push(created.id);
  }

  const reordered = await planRepository.reorderProgrammePlans(programmeId, orderedPlanIds);
  if (reordered.status !== 'updated' && reordered.status !== 'saved') {
    return reordered;
  }
  return { status: 'updated' };
};
