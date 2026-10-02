// The group comparison form's derived state, as plain data: inline errors,
// whether the calculation changed (and so needs a reviewed new revision), the
// stale-revision warning, the preview copy and the submit label.
import type { GroupExerciseRules, GroupRulesValidation } from './metric-contract';
import type { GroupMetricExerciseWire } from './metric-wire';

/** The rules the edit started from, and the revision they belong to (null when creating). */
export type ComparisonBaseline = { rules: GroupExerciseRules; revision: number | null; legacy: boolean };

export const baselineFrom = (rules: GroupExerciseRules, existing: GroupMetricExerciseWire | undefined): ComparisonBaseline => ({
  rules,
  revision: existing?.rules_revision ?? null,
  legacy: existing?.legacy ?? false,
});

/** The contribution field as a number; blank is NaN (invalid), a decimal comma is accepted. */
export const parseContributionPercent = (text: string): number =>
  text.trim() === '' ? NaN : Number(text.replace(',', '.'));

const sameCalculation = (left: GroupExerciseRules, right: GroupExerciseRules) =>
  left.loadInputMode === right.loadInputMode &&
  left.bodyweightCalculationsEnabled === right.bodyweightCalculationsEnabled &&
  left.bodyweightContribution === right.bodyweightContribution;

export type ComparisonPreview = { summary: string; attestationNote: string };

const describeRulesChange = (baseline: ComparisonBaseline, next: GroupExerciseRules): ComparisonPreview => ({
  summary: `Apply rules revision ${(baseline.revision ?? 0) + 1}: ${baseline.rules.bodyweightContribution * 100}% → ${next.bodyweightContribution * 100}% bodyweight contribution, ${next.loadInputMode === 'per_side_load' ? 'per-side' : 'total'} Weight. The whole board will rebuild together. Previous scores stay in their original rules history; this is not a new performed record.`,
  attestationNote: baseline.legacy
    ? 'Existing certifications keep their original coverage. Recalculated comparisons need new metric-specific attestations.'
    : 'Attestations of unchanged performance inputs stay valid. Personal exercise settings stay unchanged.',
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
    stale: Boolean(dirty && existing && existing.rules_revision !== baseline.revision),
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
