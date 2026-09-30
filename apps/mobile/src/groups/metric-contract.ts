// Group rules shared by the mobile client and the Deno evaluator. Personal
// contributions are deliberately absent from the link/scoring context.
import { isLoadInputMode, validateExerciseCore, type ExerciseCore, type LoadInputMode } from '../exercise-core/index.ts';
import { validateBodyweightContribution } from '../exercise-core/bodyweight-contribution.ts';

export const GROUP_METRICS = ['weight', 'e1rm'] as const;
export type GroupMetric = typeof GROUP_METRICS[number];
export type GroupMetricUnit = 'kg';
export type GroupMetricValue = { metric: GroupMetric; value: number; unit: GroupMetricUnit };

export const GROUP_METRIC_UNITS: Readonly<Record<GroupMetric, GroupMetricUnit>> = {
  weight: 'kg', e1rm: 'kg',
};
export const isGroupMetric = (value: unknown): value is GroupMetric =>
  typeof value === 'string' && (GROUP_METRICS as readonly string[]).includes(value);

/** Rules revision is server-owned; a client may send its expected revision for concurrency. */
export type GroupExerciseRules = ExerciseCore & {
  bodyweightCalculationsEnabled: boolean;
  bodyweightContribution: number;
  defaultMetric: GroupMetric;
};
export type PublishedGroupExerciseRules = GroupExerciseRules & { rulesRevision: number; publishedRevision: number | null };
export type GroupRulesValidation =
  | { ok: true; value: GroupExerciseRules }
  | { ok: false; field: keyof GroupExerciseRules; message: string };

/** Group boards always use the ordinary Weight/1RM vocabulary. */
export function validateGroupExerciseRules(input: Record<keyof GroupExerciseRules, unknown>): GroupRulesValidation {
  const core = validateExerciseCore(input);
  if (!core.ok) return { ok: false, field: core.issue === 'name_required' ? 'name' : 'loadInputMode', message: core.message };
  const contribution = validateBodyweightContribution(input.bodyweightContribution);
  if (!contribution.ok) return contribution;
  if (typeof input.bodyweightCalculationsEnabled !== 'boolean') {
    return { ok: false, field: 'bodyweightCalculationsEnabled', message: 'Bodyweight calculations state is required.' };
  }
  if (!isGroupMetric(input.defaultMetric)) {
    return { ok: false, field: 'defaultMetric', message: 'Choose Weight or 1RM.' };
  }
  return { ok: true, value: { ...core.value, bodyweightContribution: contribution.value,
    bodyweightCalculationsEnabled: input.bodyweightCalculationsEnabled, defaultMetric: input.defaultMetric } };
}

export type GroupLinkSource = {
  loadInputMode: string;
};
export type GroupLinkCompatibility =
  | { compatible: true; enteredWeightFactor: 0.5 | 1 | 2 }
  | { compatible: false; reason: 'load_input_mode_invalid' };

/** A distribution conversion changes entered Weight only, never bodyweight contribution. */
export function groupEnteredWeightFactor(source: LoadInputMode, target: LoadInputMode): 0.5 | 1 | 2 {
  return source === target ? 1 : source === 'per_side_load' ? 2 : 0.5;
}

/** Existing conventional links retain their explicit user-reviewed identity. */
export function checkGroupLinkCompatibility(source: GroupLinkSource, target: GroupExerciseRules): GroupLinkCompatibility {
  if (!isLoadInputMode(source.loadInputMode) || !isLoadInputMode(target.loadInputMode)) {
    return { compatible: false, reason: 'load_input_mode_invalid' };
  }
  return { compatible: true, enteredWeightFactor: groupEnteredWeightFactor(source.loadInputMode, target.loadInputMode) };
}

/** Runtime wire guard also rejects an incorrectly labelled unit, nonfinite value or fractional reps. */
export function isGroupMetricValue(value: unknown): value is GroupMetricValue {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return isGroupMetric(row.metric) && row.unit === GROUP_METRIC_UNITS[row.metric] &&
    typeof row.value === 'number' && Number.isFinite(row.value) && row.value > 0;
}
