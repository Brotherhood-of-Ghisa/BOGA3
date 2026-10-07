// The group comparison form's derived state, as plain data: rule validation,
// inline errors and the stale-revision warning.
import { validateExerciseCore } from '@/src/exercise-core';
import { validateBodyweightContribution } from '@/src/exercise-core/bodyweight-contribution';
import { isCompetitionMetric, type CompetitionRules as GroupExerciseRules } from './competition-contract';
import type { CompetitionExerciseWire as GroupMetricExerciseWire } from './competition-wire';
type GroupRulesValidation = { ok: true; value: GroupExerciseRules } | { ok: false; field: keyof GroupExerciseRules; message: string };

export function validateCompetitionFormRules(input: Record<keyof GroupExerciseRules,unknown>): GroupRulesValidation {
  const core=validateExerciseCore(input);
  if (!core.ok) return { ok: false,field: core.issue === 'name_required' ? 'name' : 'loadInputMode',message: core.message };
  const contribution=validateBodyweightContribution(input.bodyweightContribution);
  if (!contribution.ok) return contribution;
  if (typeof input.bodyweightCalculationsEnabled !== 'boolean') return { ok: false,field: 'bodyweightCalculationsEnabled',message: 'Bodyweight calculations state is required.' };
  if (!isCompetitionMetric(input.defaultMetric)) return { ok: false,field: 'defaultMetric',message: 'Choose Volume or 1RM.' };
  return { ok: true,value: { ...core.value,bodyweightContribution: contribution.value,bodyweightCalculationsEnabled: input.bodyweightCalculationsEnabled,defaultMetric: input.defaultMetric } };
}

/** The rules the edit started from, and the revision they belong to (null when creating). */
export type ComparisonBaseline = { rules: GroupExerciseRules; revision: number | null };

export const baselineFrom = (rules: GroupExerciseRules, existing: GroupMetricExerciseWire | undefined): ComparisonBaseline => ({
  rules,
  revision: existing?.rules.rules_revision ?? null,
});

/** The contribution field as a number; blank is NaN (invalid), a decimal comma is accepted. */
export const parseContributionPercent = (text: string): number =>
  text.trim() === '' ? NaN : Number(text.replace(',', '.'));

export type ComparisonFormStatusInput = {
  validation: GroupRulesValidation;
  baseline: ComparisonBaseline;
  existing: GroupMetricExerciseWire | undefined;
  dirty: boolean;
  showErrors: boolean;
};

export type ComparisonFormStatus = {
  nameError: string | null;
  rulesError: string | null;
  /** Edits started on an older revision than the one now loaded. */
  stale: boolean;
};

export function deriveComparisonFormStatus({
  validation, baseline, existing, dirty, showErrors,
}: ComparisonFormStatusInput): ComparisonFormStatus {
  const shownError = showErrors && !validation.ok ? validation : null;
  return {
    nameError: shownError?.field === 'name' ? shownError.message : null,
    rulesError: shownError && shownError.field !== 'name' ? shownError.message : null,
    stale: Boolean(dirty && existing && existing.rules.rules_revision !== baseline.revision),
  };
}

