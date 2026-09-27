// Unit-aware group rules, shared by the mobile client and the Deno evaluator.
// Personal coefficients are deliberately absent from the link/scoring context.
import { isLoadInputMode, validateExerciseCore, type ExerciseCore, type LoadInputMode } from '../exercise-core/index.ts';
import { validateExerciseLoadRules, type ExerciseLoadRules } from '../exercise-core/load-rules.ts';

export const GROUP_METRICS = ['weight', 'e1rm', 'bodyweight_reps', 'relative_strength', 'absolute_strength'] as const;
export type GroupMetric = typeof GROUP_METRICS[number];
export type ConventionalGroupMetric = 'weight' | 'e1rm';
export type BodyweightGroupMetric = 'bodyweight_reps' | 'relative_strength' | 'absolute_strength';
export type GroupMetricUnit = 'kg' | 'reps' | 'x_bw';
export type GroupMetricValue =
  | { metric: 'weight' | 'e1rm' | 'absolute_strength'; value: number; unit: 'kg' }
  | { metric: 'bodyweight_reps'; value: number; unit: 'reps' }
  | { metric: 'relative_strength'; value: number; unit: 'x_bw' };

export const GROUP_METRIC_UNITS: Readonly<Record<GroupMetric, GroupMetricUnit>> = {
  weight: 'kg', e1rm: 'kg', bodyweight_reps: 'reps', relative_strength: 'x_bw', absolute_strength: 'kg',
};
export const CONVENTIONAL_GROUP_METRICS: readonly ConventionalGroupMetric[] = ['weight', 'e1rm'];
export const BODYWEIGHT_GROUP_METRICS: readonly BodyweightGroupMetric[] = ['bodyweight_reps', 'relative_strength', 'absolute_strength'];
export const isGroupMetric = (value: unknown): value is GroupMetric =>
  typeof value === 'string' && (GROUP_METRICS as readonly string[]).includes(value);

/** Rules revision is server-owned; a client may send its expected revision for concurrency. */
export type GroupExerciseRules = ExerciseCore & ExerciseLoadRules & { defaultMetric: GroupMetric };
export type PublishedGroupExerciseRules = GroupExerciseRules & { rulesRevision: number; publishedRevision: number | null };
export type GroupRulesValidation =
  | { ok: true; value: GroupExerciseRules }
  | { ok: false; field: keyof GroupExerciseRules; message: string };

export function metricsForGroupRules(rules: Pick<ExerciseLoadRules, 'bodyweightCoefficient'>): readonly GroupMetric[] {
  return rules.bodyweightCoefficient > 0 ? BODYWEIGHT_GROUP_METRICS : CONVENTIONAL_GROUP_METRICS;
}

/** A bodyweight default is explicit; it is never inferred from a name or coefficient. */
export function validateGroupExerciseRules(input: Record<keyof GroupExerciseRules, unknown>): GroupRulesValidation {
  const core = validateExerciseCore(input);
  if (!core.ok) return { ok: false, field: core.issue === 'name_required' ? 'name' : 'loadInputMode', message: core.message };
  const load = validateExerciseLoadRules(input);
  if (!load.ok) return load;
  if (!isGroupMetric(input.defaultMetric) || !metricsForGroupRules(load.value).includes(input.defaultMetric)) {
    return { ok: false, field: 'defaultMetric', message: load.value.bodyweightCoefficient > 0
      ? 'Choose reps, relative strength or absolute strength for this bodyweight exercise.'
      : 'Choose Weight or 1RM for this conventional exercise.' };
  }
  return { ok: true, value: { ...core.value, ...load.value, defaultMetric: input.defaultMetric } };
}

export type GroupLinkSource = {
  loadInputMode: string;
  movementStandard: string | null;
  loadingMethod: string | null;
  metadataKnown?: boolean;
};
export type GroupLinkCompatibility =
  | { compatible: true; externalLoadFactor: 0.5 | 1 | 2 }
  | { compatible: false; reason: 'metadata_unknown' | 'load_input_mode_invalid' | 'movement_standard' | 'loading_method' };

/** A distribution conversion only changes the external amount; never the body contribution. */
export function groupExternalLoadFactor(source: LoadInputMode, target: LoadInputMode): 0.5 | 1 | 2 {
  return source === target ? 1 : source === 'per_side_load' ? 2 : 0.5;
}

/** Existing conventional links retain their explicit user-reviewed identity. */
export function checkGroupLinkCompatibility(source: GroupLinkSource, target: GroupExerciseRules): GroupLinkCompatibility {
  if (source.metadataKnown === false) return { compatible: false, reason: 'metadata_unknown' };
  if (!isLoadInputMode(source.loadInputMode) || !isLoadInputMode(target.loadInputMode)) {
    return { compatible: false, reason: 'load_input_mode_invalid' };
  }
  if (target.bodyweightCoefficient > 0) {
    if (!target.movementStandard || source.movementStandard?.trim() !== target.movementStandard.trim()) {
      return { compatible: false, reason: 'movement_standard' };
    }
    if (!target.loadingMethod || source.loadingMethod?.trim() !== target.loadingMethod.trim()) {
      return { compatible: false, reason: 'loading_method' };
    }
  }
  return { compatible: true, externalLoadFactor: groupExternalLoadFactor(source.loadInputMode, target.loadInputMode) };
}

/** Runtime wire guard also rejects an incorrectly labelled unit, nonfinite value or fractional reps. */
export function isGroupMetricValue(value: unknown): value is GroupMetricValue {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return isGroupMetric(row.metric) && row.unit === GROUP_METRIC_UNITS[row.metric] &&
    typeof row.value === 'number' && Number.isFinite(row.value) && row.value > 0 &&
    (row.metric !== 'bodyweight_reps' || (Number.isInteger(row.value) && row.value > 0));
}
