import type { ProgrammeDetailView } from './plan-queries';
import {
  emptyPlanFormBlock,
  errorMap,
  planFormFromDetail,
  planFormToDraft,
  type LoadInputModeLookup,
  type PlanFormState,
} from './plan-form-model';
import { validateProgrammeDraft } from './plan-validation';
import type { PlanDraft, PlanFieldError, ProgrammeDraft } from './types';

/**
 * The programme form's pure state and rules: what `/programme/new` edits,
 * prefilling from a loaded programme detail (edit or duplicate), and mapping
 * to a `ProgrammeDraft` with field-addressable error paths across the programme
 * and its child sessions. Pure — no database, no React.
 */

export type ProgrammeChildPlanForm = PlanFormState & {
  id: string;
  sourcePlanId: string | null;
};

export type ProgrammeFormState = {
  name: string;
  description: string;
  plans: ProgrammeChildPlanForm[];
};

let programmeKey = 0;
const nextKey = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${programmeKey++}`;

export const emptyProgrammeChildPlan = (index: number): ProgrammeChildPlanForm => ({
  id: nextKey('plan'),
  sourcePlanId: null,
  title: `Session ${index + 1}`,
  scheduleText: '',
  gymId: null,
  blocks: [emptyPlanFormBlock()],
});

export const emptyProgrammeForm = (): ProgrammeFormState => ({
  name: '',
  description: '',
  plans: [emptyProgrammeChildPlan(0), emptyProgrammeChildPlan(1)],
});

export const programmeFormFromDetail = (
  detail: ProgrammeDetailView,
  catalogExercises?: LoadInputModeLookup | null,
): ProgrammeFormState => ({
  name: detail.name,
  description: detail.description ?? '',
  plans: detail.plans.map((planDetail, index) => {
    const planForm = planFormFromDetail(planDetail, catalogExercises);
    return {
      ...planForm,
      id: nextKey('plan'),
      sourcePlanId: planDetail.id,
      title: planForm.title || `Session ${index + 1}`,
    };
  }),
});

export const programmeFormToDraft = (
  state: ProgrammeFormState,
): { draft: ProgrammeDraft; scheduleErrors: PlanFieldError[] } | { draft: null; errors: PlanFieldError[] } => {
  const scheduleErrors: PlanFieldError[] = [];
  const planDrafts: PlanDraft[] = [];

  state.plans.forEach((plan, planIndex) => {
    const result = planFormToDraft(plan);
    if (result.draft === null) {
      scheduleErrors.push({
        path: `plans.${planIndex}.scheduledFor`,
        code: 'invalid_schedule',
        message: result.scheduleError,
      });
    } else {
      planDrafts.push(result.draft);
    }
  });

  if (scheduleErrors.length > 0) {
    return { draft: null, errors: scheduleErrors };
  }

  return {
    draft: {
      name: state.name,
      description: state.description,
      plans: planDrafts,
    },
    scheduleErrors: [],
  };
};

export const programmeFormErrors = (state: ProgrammeFormState): Map<string, string> => {
  const result = programmeFormToDraft(state);
  if (result.draft === null) {
    return errorMap(result.errors);
  }
  const validation = validateProgrammeDraft(result.draft);
  if (validation.ok) {
    return new Map();
  }
  return errorMap(validation.errors);
};
