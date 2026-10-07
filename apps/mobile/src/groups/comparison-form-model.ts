// The group comparison form's derived state, as plain data: inline errors,
// whether the calculation changed (and so needs a reviewed new revision), the
// stale-revision warning, the preview copy and the submit label.
import { formatContributionPercent } from './competition-view-model';
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

const sameCalculation = (left: GroupExerciseRules, right: GroupExerciseRules) =>
  left.loadInputMode === right.loadInputMode &&
  (left.bodyweightCalculationsEnabled && left.bodyweightContribution > 0) ===
    (right.bodyweightCalculationsEnabled && right.bodyweightContribution > 0) &&
  left.bodyweightContribution === right.bodyweightContribution;

export type ComparisonPreview = { summary: string };

const describeRulesChange = (baseline: ComparisonBaseline, next: GroupExerciseRules): ComparisonPreview => ({
  summary: `Apply rules revision ${(baseline.revision ?? 0) + 1}: ${formatContributionPercent(baseline.rules.bodyweightContribution)}% → ${formatContributionPercent(next.bodyweightContribution)}% bodyweight contribution, ${next.loadInputMode === 'per_side_load' ? 'per-side' : 'total'} Weight.`,
});

export type ComparisonFormStatusInput = {
  validation: GroupRulesValidation;
  baseline: ComparisonBaseline;
  existing: GroupMetricExerciseWire | undefined;
  dirty: boolean;
  showErrors: boolean;
  reviewed: boolean;
};

export type ComparisonFormStatus = {
  /** An existing comparison's calculation changed: submitting first asks for a review. */
  calculationChanged: boolean;
  nameError: string | null;
  rulesError: string | null;
  /** Edits started on an older revision than the one now loaded. */
  stale: boolean;
  preview: ComparisonPreview | null;
};

export function deriveComparisonFormStatus({
  validation, baseline, existing, dirty, showErrors, reviewed,
}: ComparisonFormStatusInput): ComparisonFormStatus {
  const calculationChanged = baseline.revision !== null && validation.ok && !sameCalculation(baseline.rules, validation.value);
  const shownError = showErrors && !validation.ok ? validation : null;
  return {
    calculationChanged,
    nameError: shownError?.field === 'name' ? shownError.message : null,
    rulesError: shownError && shownError.field !== 'name' ? shownError.message : null,
    stale: Boolean(dirty && existing && existing.rules.rules_revision !== baseline.revision),
    preview: reviewed && calculationChanged && validation.ok ? describeRulesChange(baseline, validation.value) : null,
  };
}

export const comparisonSubmitLabel = ({ pending, calculationChanged, reviewed, pendingLabel, submitLabel }: {
  pending: boolean; calculationChanged: boolean; reviewed: boolean; pendingLabel: string; submitLabel: string;
}): string => {
  if (pending) return pendingLabel;
  if (!calculationChanged) return submitLabel;
  return reviewed ? 'Apply group rules' : 'Review rule changes';
};
