import type { SessionSetTypeValue } from '@/src/data/set-types';
import { parseSessionDateTime } from '@/src/utils/local-time';
import { validatePlanDraft } from './plan-validation';
import type { PlanDetailView } from './plan-queries';
import type { PlanDraft, PlanFieldError } from './types';

/**
 * The plan form's pure state and rules: what the authoring screen edits, the
 * prefill from an existing plan (edit or duplicate), and the mapping to a
 * `PlanDraft` with field-addressable errors. No database, no React — the
 * screen composes this with the plan repository.
 */

export type PlanFormSet = {
  /** Client-side key only; the store assigns real ids on save. */
  id: string;
  targetWeightText: string;
  targetRepsText: string;
  targetSetType: SessionSetTypeValue;
};

export type PlanFormBlock = {
  id: string;
  /** The plan block this block edits, when the form prefilled from a plan. */
  sourceBlockId: string | null;
  exerciseDefinitionId: string | null;
  name: string;
  machineName: string;
  /** The picked exercise's load input mode; null until one is picked. */
  loadInputMode: 'total_load' | 'per_side_load' | null;
  sets: PlanFormSet[];
};

export type PlanFormState = {
  title: string;
  /** `YYYY-MM-DD HH:mm`, '' when unscheduled — the session times' format. */
  scheduleText: string;
  gymId: string | null;
  blocks: PlanFormBlock[];
};

let formKey = 0;
const nextKey = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${formKey++}`;

export const emptyPlanFormSet = (): PlanFormSet => ({
  id: nextKey('set'),
  targetWeightText: '',
  targetRepsText: '',
  targetSetType: null,
});

export const emptyPlanFormBlock = (): PlanFormBlock => ({
  id: nextKey('block'),
  sourceBlockId: null,
  exerciseDefinitionId: null,
  name: '',
  machineName: '',
  loadInputMode: null,
  sets: [emptyPlanFormSet()],
});

export const emptyPlanForm = (): PlanFormState => ({
  title: '',
  scheduleText: '',
  gymId: null,
  blocks: [emptyPlanFormBlock()],
});

export type LoadInputModeLookup =
  | { id: string; loadInputMode?: 'total_load' | 'per_side_load' | null }[]
  | ((exerciseDefinitionId: string | null) => 'total_load' | 'per_side_load' | null)
  | Map<string, 'total_load' | 'per_side_load'>
  | Record<string, 'total_load' | 'per_side_load'>;

const resolveBlockLoadInputMode = (
  definitionId: string | null,
  lookup?: LoadInputModeLookup | null,
): 'total_load' | 'per_side_load' | null => {
  if (!definitionId || !lookup) return null;
  if (typeof lookup === 'function') return lookup(definitionId);
  if (lookup instanceof Map) return lookup.get(definitionId) ?? null;
  if (Array.isArray(lookup)) {
    const matched = lookup.find((candidate) => candidate.id === definitionId);
    return matched?.loadInputMode ?? null;
  }
  return lookup[definitionId] ?? null;
};

/** The editor's prefill from a loaded plan (edit in place, or duplicate). */
export const planFormFromDetail = (
  detail: PlanDetailView,
  catalogExercises?: LoadInputModeLookup | null,
): PlanFormState => ({
  title: detail.title,
  scheduleText:
    detail.scheduledFor !== null ? formatScheduleText(detail.scheduledFor) : '',
  gymId: detail.gymId,
  blocks: detail.blocks.map((block) => ({
    id: nextKey('block'),
    sourceBlockId: block.id,
    exerciseDefinitionId: block.exerciseDefinitionId,
    name: block.name,
    machineName: block.machineName ?? '',
    loadInputMode: resolveBlockLoadInputMode(block.exerciseDefinitionId, catalogExercises),
    sets: block.targets.map((target) => ({
      id: nextKey('set'),
      targetWeightText: target.targetWeightValue ?? '',
      targetRepsText: String(target.targetReps),
      targetSetType: target.targetSetType,
    })),
  })),
});

export const formatScheduleText = (at: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
};

const SCHEDULE_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

/**
 * The draft the validation and repository take, or `null` with the
 * `scheduledFor` error when the schedule text is present but unparseable.
 */
export const planFormToDraft = (
  state: PlanFormState,
): { draft: PlanDraft } | { draft: null; scheduleError: string } => {
  let scheduledFor: Date | null = null;
  const text = state.scheduleText.trim();
  if (text.length > 0) {
    if (!SCHEDULE_PATTERN.test(text)) {
      return { draft: null, scheduleError: 'Enter a valid date and time in YYYY-MM-DD HH:mm format.' };
    }
    const parsed = parseSessionDateTime(text);
    if (!parsed) {
      return { draft: null, scheduleError: 'Enter a valid date and time in YYYY-MM-DD HH:mm format.' };
    }
    scheduledFor = parsed;
  }
  return {
    draft: {
      title: state.title,
      gymId: state.gymId,
      scheduledFor,
      exercises: state.blocks.map((block) => ({
        exerciseDefinitionId: block.exerciseDefinitionId,
        name: block.name,
        machineName: block.machineName,
        sets: block.sets.map((set) => ({
          targetWeightText: set.targetWeightText,
          targetRepsText: set.targetRepsText,
          targetSetType: set.targetSetType,
        })),
      })),
    },
  };
};

/** The field-addressable messages for the form as it stands right now. */
export const planFormErrors = (state: PlanFormState): Map<string, string> => {
  const result = planFormToDraft(state);
  if (result.draft === null) {
    return new Map([['scheduledFor', result.scheduleError]]);
  }
  const validation = validatePlanDraft(result.draft);
  if (validation.ok) {
    return new Map();
  }
  return errorMap(validation.errors);
};

export const errorMap = (errors: PlanFieldError[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const item of errors) {
    if (!map.has(item.path)) {
      map.set(item.path, item.message);
    }
  }
  return map;
};

