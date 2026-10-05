import { useState } from 'react';

import type { BodyweightContributionFieldValue } from '@/components/exercise-core/exercise-core-fields';
import type { LoadInputMode } from '@/src/exercise-core';
import { formatContributionPercent } from '@/src/groups/competition-view-model';
import { baselineFrom, parseContributionPercent } from '@/src/groups/comparison-form-model';
import type { CompetitionRules as GroupExerciseRules, CompetitionMetric as GroupMetric } from '@/src/groups/competition-contract';
import type { CompetitionExerciseWire as GroupMetricExerciseWire } from '@/src/groups/competition-wire';

const contributionFieldFromRules = (rules: GroupExerciseRules): BodyweightContributionFieldValue => ({
  percentage: formatContributionPercent(rules.bodyweightContribution),
});

/**
 * The editable rules of a group comparison. Until the user edits (or after
 * Reload) the draft follows the prefill, adjusted in the render that sees it
 * change; once edited, a refreshed prefill no longer replaces the values.
 */
export function useComparisonDraft(prefill: GroupExerciseRules, existing: GroupMetricExerciseWire | undefined) {
  const [baseline, setBaseline] = useState(baselineFrom(prefill, existing));
  const [name, setName] = useState(prefill.name);
  const [loadInputMode, setLoadInputMode] = useState<LoadInputMode>(prefill.loadInputMode);
  const [contributionField, setContributionField] = useState(contributionFieldFromRules(prefill));
  const [defaultMetric, setDefaultMetric] = useState<GroupMetric>(prefill.defaultMetric);
  const [dirty, setDirty] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const prefillKey = JSON.stringify([prefill, existing?.rules.rules_revision]);
  const [followedKey, setFollowedKey] = useState<string | null>(prefillKey);
  if (!dirty && followedKey !== prefillKey) {
    setFollowedKey(prefillKey);
    setBaseline(baselineFrom(prefill, existing));
    setName(prefill.name);
    setLoadInputMode(prefill.loadInputMode);
    setContributionField(contributionFieldFromRules(prefill));
    setDefaultMetric(prefill.defaultMetric);
  }
  /** Any edit stops following the prefill and voids a review. */
  const edit = <T,>(set: (value: T) => void) => (value: T) => { setDirty(true); setReviewed(false); set(value); };

  return {
    baseline, name, loadInputMode, contributionField, defaultMetric, dirty, showErrors, reviewed,
    // Preserve the exact server number while the percentage field is unchanged.
    contribution: contributionField.percentage === contributionFieldFromRules(baseline.rules).percentage
      ? baseline.rules.bodyweightContribution : parseContributionPercent(contributionField.percentage) / 100,
    changeName: edit(setName),
    changeLoadInputMode: edit(setLoadInputMode),
    changeContribution: edit(setContributionField),
    changeDefaultMetric: edit(setDefaultMetric),
    revealErrors: () => setShowErrors(true),
    markReviewed: () => setReviewed(true),
    /** Drop the edits and follow the current prefill again. */
    reload: () => { setDirty(false); setFollowedKey(null); setReviewed(false); setShowErrors(false); },
  };
}
