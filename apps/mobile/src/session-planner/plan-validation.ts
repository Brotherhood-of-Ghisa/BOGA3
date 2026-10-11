import { isSessionSetType, type SessionSetTypeValue } from '@/src/data/set-types';
import {
  type NormalizedPlan,
  type NormalizedPlanExercise,
  type NormalizedPlanSet,
  type NormalizedProgramme,
  type PlanDraft,
  type PlanExerciseDraft,
  type PlanFieldError,
  type PlanSetDraft,
  type PlanValidationResult,
  type ProgrammeDraft,
} from './types';

/**
 * Pure plan validation/normalization (the session-planning contract limits, §7.1). No
 * database, no React — the planner screens call it per keystroke or on save,
 * and the repository refuses to write anything that does not pass, so a
 * rejected save leaves zero partial rows.
 *
 * Field errors carry a UI-addressable `path` (`title`, `exercises.0.name`,
 * `exercises.0.sets.1.targetReps`) so the editor can locate the offending
 * control exactly.
 */

export const PLAN_LIMITS = {
  /** `title` / programme `name` / exercise `name`: 1..100 or 0..100. */
  name: { min: 1, max: 100 },
  description: { max: 500 },
  /** Plans per programme: 2..50. */
  programmePlans: { min: 2, max: 50 },
  /** Blocks per plan: 1..30. */
  planExercises: { min: 1, max: 30 },
  /** Target sets per block: 1..30. */
  exerciseSets: { min: 1, max: 30 },
  /** target_reps: integer 1..999. */
  targetReps: { min: 1, max: 999 },
  /** target_weight_value: kg text 0..9999.99 with at most 2 decimals, or null. */
  targetWeight: { max: 9999.99, maxDecimals: 2 },
} as const;

const isValidDate = (value: Date): boolean => !Number.isNaN(value.getTime());

const error = (path: string, code: PlanFieldError['code'], message: string): PlanFieldError => ({
  path,
  code,
  message,
});

const REPS_PATTERN = /^\d+$/;
/** Decimal kg text: up to 4 integer digits and up to 2 fraction digits — no sign, no exponent. */
const WEIGHT_PATTERN = /^\d{1,4}(\.\d{1,2})?$/;

/**
 * Parses one target weight field. `''` normalizes to null ("choose during the
 * workout"); otherwise the text must be a plain decimal in 0..9999.99 and is
 * returned as canonical text with trailing zeros stripped.
 */
export const parseTargetWeight = (text: string): { ok: true; value: string | null } | { ok: false } => {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }
  if (!WEIGHT_PATTERN.test(trimmed)) {
    return { ok: false };
  }
  const value = Number(trimmed);
  if (value > PLAN_LIMITS.targetWeight.max) {
    return { ok: false };
  }
  return { ok: true, value: String(value) };
};

/** Parses one target reps field: a positive integer 1..999, or null when invalid. */
export const parseTargetReps = (text: string): number | null => {
  const trimmed = text.trim();
  if (!REPS_PATTERN.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return value >= PLAN_LIMITS.targetReps.min && value <= PLAN_LIMITS.targetReps.max ? value : null;
};

/**
 * Validates and normalizes one target set. Returns the normalized values or
 * the field errors under `path` (`targetReps`, `targetWeight`, `targetSetType`).
 */
export const validatePlanSetDraft = (
  path: string,
  draft: PlanSetDraft,
): PlanValidationResult<NormalizedPlanSet> => {
  const errors: PlanFieldError[] = [];

  const reps = parseTargetReps(draft.targetRepsText);
  if (reps === null) {
    errors.push(error(`${path}.targetReps`, 'invalid_reps', 'Reps must be a whole number from 1 to 999.'));
  }

  const weight = parseTargetWeight(draft.targetWeightText);
  if (!weight.ok) {
    errors.push(
      error(`${path}.targetWeight`, 'invalid_weight', 'Weight must be a kg amount from 0 to 9999.99, or blank.'),
    );
  }

  let setType: SessionSetTypeValue = null;
  if (draft.targetSetType !== null && !isSessionSetType(draft.targetSetType)) {
    errors.push(error(`${path}.targetSetType`, 'unknown_set_type', 'Choose a set type from the list.'));
  } else {
    setType = draft.targetSetType;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      targetWeightValue: weight.ok ? weight.value : null,
      targetReps: reps as number,
      targetSetType: setType,
    },
  };
};

/**
 * Validates and normalizes one plan exercise block, including the 1..30
 * target-set limit. `pathPrefix` addresses it inside the whole-plan errors
 * (use `exercises.0` for a plan, or `` for a single block).
 */
export const validatePlanExerciseDraft = (
  draft: PlanExerciseDraft,
  pathPrefix = '',
): PlanValidationResult<{ exercise: NormalizedPlanExercise }> => {
  const errors: PlanFieldError[] = [];
  const base = (suffix: string) => (pathPrefix.length > 0 ? `${pathPrefix}.${suffix}` : suffix);

  const name = draft.name.trim();
  if (name.length === 0) {
    errors.push(error(base('name'), 'required', 'Name the exercise.'));
  } else if (name.length > PLAN_LIMITS.name.max) {
    errors.push(error(base('name'), 'too_long', `Use at most ${PLAN_LIMITS.name.max} characters.`));
  }

  if (draft.sets.length < PLAN_LIMITS.exerciseSets.min) {
    errors.push(error(base('sets'), 'too_few', 'Add at least one target set.'));
  } else if (draft.sets.length > PLAN_LIMITS.exerciseSets.max) {
    errors.push(error(base('sets'), 'too_many', `Use at most ${PLAN_LIMITS.exerciseSets.max} target sets.`));
  }

  const sets: NormalizedPlanExercise['sets'] = [];
  draft.sets.forEach((set, index) => {
    const result = validatePlanSetDraft(base(`sets.${index}`), set);
    if (result.ok) {
      sets.push(result.value);
    } else {
      errors.push(...result.errors);
    }
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      exercise: {
        exerciseDefinitionId: draft.exerciseDefinitionId,
        name,
        sets,
      },
    },
  };
};

/**
 * Validates and normalizes one plan (one-off or programme child), including
 * the 1..30 block limit. `scheduledFor` may be null (unscheduled).
 */
export const validatePlanDraft = (draft: PlanDraft, pathPrefix = ''): PlanValidationResult<{ plan: NormalizedPlan }> => {
  const errors: PlanFieldError[] = [];
  const base = (suffix: string) => (pathPrefix.length > 0 ? `${pathPrefix}.${suffix}` : suffix);

  const title = draft.title.trim();
  if (title.length === 0) {
    errors.push(error(base('title'), 'required', 'Give the plan a title.'));
  } else if (title.length > PLAN_LIMITS.name.max) {
    errors.push(error(base('title'), 'too_long', `Use at most ${PLAN_LIMITS.name.max} characters.`));
  }

  if (draft.scheduledFor !== null && !isValidDate(draft.scheduledFor)) {
    errors.push(error(base('scheduledFor'), 'invalid_schedule', 'Pick a valid date and time.'));
  }

  if (draft.exercises.length < PLAN_LIMITS.planExercises.min) {
    errors.push(error(base('exercises'), 'too_few', 'Add at least one exercise.'));
  } else if (draft.exercises.length > PLAN_LIMITS.planExercises.max) {
    errors.push(error(base('exercises'), 'too_many', `Use at most ${PLAN_LIMITS.planExercises.max} exercises.`));
  }

  const exercises: NormalizedPlanExercise[] = [];
  draft.exercises.forEach((exercise, index) => {
    const result = validatePlanExerciseDraft(exercise, base(`exercises.${index}`));
    if (result.ok) {
      exercises.push(result.value.exercise);
    } else {
      errors.push(...result.errors);
    }
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      plan: {
        title,
        gymId: draft.gymId,
        scheduledFor: draft.scheduledFor,
        exercises,
      },
    },
  };
};

/**
 * Validates and normalizes a programme and all of its child plans, including
 * the 2..50 plan limit. Child order is the array order; the store assigns
 * dense `programme_order_index` values 0..n-1.
 */
export const validateProgrammeDraft = (draft: ProgrammeDraft): PlanValidationResult<{ programme: NormalizedProgramme }> => {
  const errors: PlanFieldError[] = [];

  const meta = validateProgrammeMeta(draft.name, draft.description);
  if (!meta.ok) {
    errors.push(...meta.errors);
  }

  if (draft.plans.length < PLAN_LIMITS.programmePlans.min) {
    errors.push(error('plans', 'too_few', 'A programme needs at least two sessions.'));
  } else if (draft.plans.length > PLAN_LIMITS.programmePlans.max) {
    errors.push(error('plans', 'too_many', `Use at most ${PLAN_LIMITS.programmePlans.max} sessions.`));
  }

  const plans: NormalizedPlan[] = [];
  draft.plans.forEach((plan, index) => {
    const result = validatePlanDraft(plan, `plans.${index}`);
    if (result.ok) {
      plans.push(result.value.plan);
    } else {
      errors.push(...result.errors);
    }
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      programme: {
        name: meta.ok ? meta.value.name : '',
        description: meta.ok ? meta.value.description : null,
        plans,
      },
    },
  };
};

/** Validates a programme's name (1..100) and description (0..500) fields. */
export const validateProgrammeMeta = (
  rawName: string,
  rawDescription: string,
): PlanValidationResult<{ name: string; description: string | null }> => {
  const errors: PlanFieldError[] = [];

  const name = rawName.trim();
  if (name.length === 0) {
    errors.push(error('name', 'required', 'Name the programme.'));
  } else if (name.length > PLAN_LIMITS.name.max) {
    errors.push(error('name', 'too_long', `Use at most ${PLAN_LIMITS.name.max} characters.`));
  }

  const description = rawDescription.trim();
  if (description.length > PLAN_LIMITS.description.max) {
    errors.push(error('description', 'too_long', `Use at most ${PLAN_LIMITS.description.max} characters.`));
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: { name, description: description.length === 0 ? null : description },
  };
};

/**
 * True when `orderedIds` is an exact permutation of the rows' ids: same
 * length, every id present, no duplicates. Reorder callers run this before
 * any write so an invalid list fails without touching a row.
 */
export const isExactIdPermutation = (rows: { id: string }[], orderedIds: string[]): boolean => {
  if (orderedIds.length !== rows.length) {
    return false;
  }
  const rowIds = new Set(rows.map((row) => row.id));
  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (!rowIds.has(id) || seen.has(id)) {
      return false;
    }
    seen.add(id);
  }
  return true;
};
