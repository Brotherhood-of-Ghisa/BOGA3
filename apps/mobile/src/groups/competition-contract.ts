// Protocol 4 competition representation. Activation is negotiated separately
// from the owner's private Sync v2 protocol and the current protocol-3 UI.
import { validateExerciseCore } from '../exercise-core/index.ts';
import { validateBodyweightContribution } from '../exercise-core/bodyweight-contribution.ts';
import type { GroupExerciseRules } from './metric-contract.ts';

export const GROUP_COMPETITION_VERSION = 4;
export const GROUP_COMPETITION_CACHE_VERSION = 5;
export const GROUP_COMPETITION_METRICS = ['volume', 'e1rm'] as const;
export type CompetitionMetric = typeof GROUP_COMPETITION_METRICS[number];
export type CompetitionRules = Omit<GroupExerciseRules, 'defaultMetric'> & { defaultMetric: CompetitionMetric };
export type CompetitionValue =
  | { metric: 'volume'; value: number; unit: 'kg_reps' | 'percent_bw_reps' }
  | { metric: 'e1rm'; value: number; unit: 'kg' | 'percent_bw' };

export const isCompetitionMetric = (value: unknown): value is CompetitionMetric =>
  value === 'volume' || value === 'e1rm';
export const isNormalizedCompetition = (rules: Pick<CompetitionRules,
  'bodyweightCalculationsEnabled' | 'bodyweightContribution'>): boolean =>
  rules.bodyweightCalculationsEnabled && rules.bodyweightContribution > 0;

export function competitionUnit(metric: CompetitionMetric, normalized: boolean): CompetitionValue['unit'] {
  if (metric === 'volume') return normalized ? 'percent_bw_reps' : 'kg_reps';
  return normalized ? 'percent_bw' : 'kg';
}

export function validateCompetitionRules(input: Record<keyof CompetitionRules, unknown>):
  { ok: true; value: CompetitionRules } | { ok: false } {
  const core = validateExerciseCore(input);
  const contribution = validateBodyweightContribution(input.bodyweightContribution);
  if (!core.ok || !contribution.ok || typeof input.bodyweightCalculationsEnabled !== 'boolean' ||
    !isCompetitionMetric(input.defaultMetric)) return { ok: false };
  return { ok: true, value: { ...core.value, bodyweightContribution: contribution.value,
    bodyweightCalculationsEnabled: input.bodyweightCalculationsEnabled, defaultMetric: input.defaultMetric } };
}

/** Exact allowlist: a score may never carry an absolute counterpart or dependency. */
export function isCompetitionValue(value: unknown, normalized: boolean): value is CompetitionValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === 3 && Object.keys(row).every(key => ['metric','value','unit'].includes(key)) && isCompetitionMetric(row.metric) &&
    row.unit === competitionUnit(row.metric, normalized) && typeof row.value === 'number' &&
    Number.isFinite(row.value) && row.value > 0;
}
