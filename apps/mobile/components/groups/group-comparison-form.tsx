import { useState } from 'react';
import { Text } from 'react-native';

import { ExerciseCoreFields, type BodyweightContributionFieldValue } from '@/components/exercise-core/exercise-core-fields';
import { ActionButton, Card, SegmentedControl, uiSpace } from '@/components/ui';
import type { LoadInputMode } from '@/src/exercise-core';
import { GROUP_METRICS, validateGroupExerciseRules, type GroupExerciseRules, type GroupMetric } from '@/src/groups/metric-contract';
import type { GroupMetricExerciseWire } from '@/src/groups/metric-wire';

import { GroupWriteNotice } from './write-notice';
import { groupMetricTextStyles as textStyles } from './screen-styles';

type Props = {
  bodyweightCalculationsEnabled: boolean;
  initialRules?: GroupExerciseRules;
  /** Preserve the version seen when editing begins, even if a refresh lands. */
  existing?: GroupMetricExerciseWire;
  note?: string | null;
  submitLabel: string;
  pendingLabel: string;
  pending: boolean;
  errorMessage: string | null;
  onSubmit: (rules: GroupExerciseRules, expectedRevision: number | null) => void;
};
const empty: GroupExerciseRules = { name: '', loadInputMode: 'total_load', bodyweightCalculationsEnabled: false,
  bodyweightContribution: 0,
  defaultMetric: 'e1rm' };
const rulesFromWire = (exercise: GroupMetricExerciseWire): GroupExerciseRules => ({
  name: exercise.name, loadInputMode: exercise.load_input_mode,
  bodyweightCalculationsEnabled: exercise.bodyweight_calculations_enabled,
  bodyweightContribution: exercise.bodyweight_contribution,
  defaultMetric: exercise.default_metric,
});
const contributionFieldFromRules = (rules: GroupExerciseRules): BodyweightContributionFieldValue => ({
  percentage: String(rules.bodyweightContribution * 100),
});
const metricLabels: Record<GroupMetric, string> = {
  weight: 'Weight kg', e1rm: '1RM kg',
};
const sameCalculation = (left: GroupExerciseRules, right: GroupExerciseRules) =>
  left.loadInputMode === right.loadInputMode &&
  left.bodyweightCalculationsEnabled === right.bodyweightCalculationsEnabled &&
  left.bodyweightContribution === right.bodyweightContribution;

/** Shared field recipe, with a version-bound preview for group-wide changes. */
export function GroupComparisonForm({ bodyweightCalculationsEnabled, initialRules = empty, existing, note,
  submitLabel, pendingLabel, pending, errorMessage, onSubmit }: Props) {
  const prefill = existing ? rulesFromWire(existing) : { ...initialRules, bodyweightCalculationsEnabled };
  const [baseline, setBaseline] = useState({ rules: prefill, revision: existing?.rules_revision ?? null, legacy: existing?.legacy ?? false });
  const [name, setName] = useState(prefill.name);
  const [loadInputMode, setLoadInputMode] = useState<LoadInputMode>(prefill.loadInputMode);
  const [contributionField, setContributionField] = useState(contributionFieldFromRules(prefill));
  const [defaultMetric, setDefaultMetric] = useState<GroupMetric>(prefill.defaultMetric);
  const [dirty, setDirty] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  // Until the user edits (or after Reload), follow the prefill, adjusted in the render that sees it change.
  const prefillKey = JSON.stringify([prefill, existing?.rules_revision, existing?.legacy]);
  const [followedKey, setFollowedKey] = useState<string | null>(prefillKey);
  if (!dirty && followedKey !== prefillKey) {
    setFollowedKey(prefillKey);
    setBaseline({ rules: prefill, revision: existing?.rules_revision ?? null, legacy: existing?.legacy ?? false });
    setName(prefill.name);
    setLoadInputMode(prefill.loadInputMode);
    setContributionField(contributionFieldFromRules(prefill));
    setDefaultMetric(prefill.defaultMetric);
  }
  const changed = () => { setDirty(true); setReviewed(false); };
  const percentage = contributionField.percentage.trim() === ''
    ? NaN
    : Number(contributionField.percentage.replace(',', '.'));
  const validation = validateGroupExerciseRules({ name, loadInputMode, bodyweightCalculationsEnabled,
    bodyweightContribution: percentage / 100, defaultMetric });
  const calculationChanged = baseline.revision !== null && validation.ok && !sameCalculation(baseline.rules, validation.value);
  const submit = () => {
    setShowErrors(true);
    if (!validation.ok || pending) return;
    if (calculationChanged && !reviewed) { setReviewed(true); return; }
    onSubmit(validation.value, baseline.revision);
  };
  const rulesError = showErrors && !validation.ok && validation.field !== 'name' ? validation.message : null;
  const stale = dirty && existing && existing.rules_revision !== baseline.revision;
  return (
    <Card style={{ padding: uiSpace.md, gap: uiSpace.md }} testID="group-exercise-form">
      {note ? <Text allowFontScaling={false} style={textStyles.muted} testID="group-exercise-form-note">{note}</Text> : null}
      {baseline.revision !== null ? <Text allowFontScaling={false} style={textStyles.muted} testID="group-rules-revision">Rules revision {baseline.revision}</Text> : null}
      <ExerciseCoreFields editable={!pending} name={name} loadInputMode={loadInputMode}
        nameError={showErrors && !validation.ok && validation.field === 'name' ? validation.message : null}
        onChangeName={value => { changed(); setName(value); }}
        onChangeLoadInputMode={value => { changed(); setLoadInputMode(value); }}
        testIDPrefix="group-exercise-form"
        bodyweightContribution={bodyweightCalculationsEnabled ? {
          value: contributionField,
          scope: 'group',
          onChange: value => { changed(); setContributionField(value); },
          error: rulesError,
        } : undefined} />
      <Text allowFontScaling={false} style={textStyles.muted}>Default ranking</Text>
      <SegmentedControl accessibilityLabel="Default ranking" disabled={pending} value={defaultMetric} layout="fit"
        options={GROUP_METRICS.map(metric => ({
          value: metric, label: metricLabels[metric], accessibilityLabel: metricLabels[metric],
        }))}
        onChange={value => { changed(); setDefaultMetric(value); }} testIDPrefix="group-exercise-default-metric" />
      <Text allowFontScaling={false} style={textStyles.muted}>Members can switch ranking views. This choice only sets the opening view.</Text>
      {stale ? <GroupWriteNotice tone="error" testID="group-rules-stale"
        message="The group rules changed while you were editing. Your values are kept. Reload group rules to replace them with the current settings before editing again." /> : null}
      {stale ? <ActionButton variant="outline" label="Reload group rules" disabled={pending} testID="group-rules-reload"
        onPress={() => { setDirty(false); setFollowedKey(null); setReviewed(false); setShowErrors(false); }} /> : null}
      {reviewed && calculationChanged && validation.ok ? <>
        <Text allowFontScaling={false} style={textStyles.muted} testID="group-rules-preview">
          {`Apply rules revision ${(baseline.revision ?? 0) + 1}: ${baseline.rules.bodyweightContribution * 100}% → ${validation.value.bodyweightContribution * 100}% bodyweight contribution, ${validation.value.loadInputMode === 'per_side_load' ? 'per-side' : 'total'} Weight. The whole board will rebuild together. Previous scores stay in their original rules history; this is not a new performed record.`}
        </Text>
        {baseline.legacy ? <Text allowFontScaling={false} style={textStyles.muted}>Existing certifications keep their original coverage. Recalculated comparisons need new metric-specific attestations.</Text> :
          <Text allowFontScaling={false} style={textStyles.muted}>Attestations of unchanged performance inputs stay valid. Personal exercise settings stay unchanged.</Text>}
      </> : null}
      {errorMessage ? <GroupWriteNotice message={errorMessage} testID="group-exercise-form-error" tone="error" /> : null}
      <ActionButton variant="primary" disabled={pending || Boolean(stale)} label={pending ? pendingLabel : calculationChanged ? reviewed ? 'Apply group rules' : 'Review rule changes' : submitLabel}
        onPress={submit} testID="group-exercise-form-submit" />
    </Card>
  );
}
