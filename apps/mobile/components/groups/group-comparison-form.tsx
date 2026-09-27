import { useEffect, useState } from 'react';

import { ExerciseCoreFields, type ExerciseLoadFieldsValue } from '@/components/exercise-core/exercise-core-fields';
import { ActionButton, Card, SegmentedControl, UiText, uiSpace } from '@/components/ui';
import type { LoadInputMode } from '@/src/exercise-core';
import { metricsForGroupRules, validateGroupExerciseRules, type GroupExerciseRules, type GroupMetric } from '@/src/groups/metric-contract';
import type { GroupMetricExerciseWire } from '@/src/groups/metric-wire';

import { GroupWriteNotice } from './write-notice';

type Props = {
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
const empty: GroupExerciseRules = { name: '', loadInputMode: 'total_load', bodyweightCoefficient: 0,
  movementStandard: null, loadingMethod: null, defaultMetric: 'e1rm' };
const rulesFromWire = (exercise: GroupMetricExerciseWire): GroupExerciseRules => ({
  name: exercise.name, loadInputMode: exercise.load_input_mode, bodyweightCoefficient: exercise.bodyweight_coefficient,
  movementStandard: exercise.movement_standard, loadingMethod: exercise.loading_method, defaultMetric: exercise.default_metric,
});
const fieldsFromRules = (rules: GroupExerciseRules): ExerciseLoadFieldsValue => ({
  percentage: String(rules.bodyweightCoefficient * 100), movementStandard: rules.movementStandard ?? '', loadingMethod: rules.loadingMethod ?? '',
});
const metricLabels: Record<GroupMetric, string> = {
  weight: 'Weight kg', e1rm: '1RM kg', bodyweight_reps: 'Reps', relative_strength: 'Relative ×BW', absolute_strength: 'Absolute kg',
};
const sameCalculation = (left: GroupExerciseRules, right: GroupExerciseRules) =>
  left.loadInputMode === right.loadInputMode && left.bodyweightCoefficient === right.bodyweightCoefficient &&
  left.movementStandard === right.movementStandard && left.loadingMethod === right.loadingMethod;

/** Shared field recipe, with a version-bound preview for group-wide changes. */
export function GroupComparisonForm({ initialRules = empty, existing, note, submitLabel, pendingLabel, pending, errorMessage, onSubmit }: Props) {
  const prefill = existing ? rulesFromWire(existing) : initialRules;
  const [baseline, setBaseline] = useState({ rules: prefill, revision: existing?.rules_revision ?? null, legacy: existing?.legacy ?? false });
  const [name, setName] = useState(prefill.name);
  const [loadInputMode, setLoadInputMode] = useState<LoadInputMode>(prefill.loadInputMode);
  const [loadFields, setLoadFields] = useState(fieldsFromRules(prefill));
  const [defaultMetric, setDefaultMetric] = useState<GroupMetric>(prefill.defaultMetric);
  const [dirty, setDirty] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const prefillKey = JSON.stringify([prefill, existing?.rules_revision, existing?.legacy]);
  useEffect(() => {
    if (dirty) return;
    const [next, revision, legacy] = JSON.parse(prefillKey) as [GroupExerciseRules, number | null, boolean | null];
    setBaseline({ rules: next, revision: revision ?? null, legacy: legacy ?? false });
    setName(next.name); setLoadInputMode(next.loadInputMode); setLoadFields(fieldsFromRules(next)); setDefaultMetric(next.defaultMetric);
  }, [dirty, prefillKey]);
  const changed = () => { setDirty(true); setReviewed(false); };
  const percentage = loadFields.percentage.trim() === '' ? NaN : Number(loadFields.percentage.replace(',', '.'));
  const validation = validateGroupExerciseRules({ name, loadInputMode, bodyweightCoefficient: percentage / 100,
    movementStandard: loadFields.movementStandard || null, loadingMethod: loadFields.loadingMethod || null, defaultMetric });
  const movementChanged = baseline.rules.movementStandard !== null && validation.ok &&
    validation.value.movementStandard !== baseline.rules.movementStandard;
  const calculationChanged = baseline.revision !== null && validation.ok && !sameCalculation(baseline.rules, validation.value);
  const submit = () => {
    setShowErrors(true);
    if (!validation.ok || movementChanged || pending) return;
    if (calculationChanged && !reviewed) { setReviewed(true); return; }
    onSubmit(validation.value, baseline.revision);
  };
  const rulesError = showErrors && !validation.ok && validation.field !== 'name' ? validation.message : null;
  const stale = dirty && existing && existing.rules_revision !== baseline.revision;
  return (
    <Card style={{ padding: uiSpace.md, gap: uiSpace.md }} testID="group-exercise-form">
      {note ? <UiText testID="group-exercise-form-note" variant="bodyMuted">{note}</UiText> : null}
      {baseline.revision !== null ? <UiText variant="bodyMuted" testID="group-rules-revision">Rules revision {baseline.revision}</UiText> : null}
      <ExerciseCoreFields editable={!pending} name={name} loadInputMode={loadInputMode}
        nameError={showErrors && !validation.ok && validation.field === 'name' ? validation.message : null}
        onChangeName={value => { changed(); setName(value); }}
        onChangeLoadInputMode={value => { changed(); setLoadInputMode(value); }}
        testIDPrefix="group-exercise-form" loadRules={{ value: loadFields, scope: 'group',
          onChange: value => { changed(); setLoadFields(value); }, error: rulesError }} />
      {movementChanged ? <GroupWriteNotice tone="error" testID="group-rules-movement-error"
        message="A different movement needs a new group exercise. Keep this movement standard to preserve its history." /> : null}
      <UiText variant="bodyMuted">Default ranking</UiText>
      <SegmentedControl accessibilityLabel="Default ranking" disabled={pending} value={defaultMetric} layout="fit"
        options={metricsForGroupRules({ bodyweightCoefficient: percentage > 0 ? percentage / 100 : 0 }).map(metric => ({
          value: metric, label: metricLabels[metric], accessibilityLabel: metricLabels[metric],
        }))}
        onChange={value => { changed(); setDefaultMetric(value); }} testIDPrefix="group-exercise-default-metric" />
      <UiText variant="bodyMuted">Members can switch ranking views. This choice only sets the opening view.</UiText>
      {stale ? <GroupWriteNotice tone="error" testID="group-rules-stale"
        message="The group rules changed while you were editing. Your values are kept. Reload group rules to replace them with the current settings before editing again." /> : null}
      {stale ? <ActionButton variant="outline" label="Reload group rules" disabled={pending} testID="group-rules-reload"
        onPress={() => { setDirty(false); setReviewed(false); setShowErrors(false); }} /> : null}
      {reviewed && calculationChanged && validation.ok ? <>
        <UiText variant="bodyMuted" testID="group-rules-preview">
          {`Apply rules revision ${(baseline.revision ?? 0) + 1}: ${baseline.rules.bodyweightCoefficient * 100}% → ${validation.value.bodyweightCoefficient * 100}% bodyweight, ${validation.value.loadInputMode === 'per_side_load' ? 'per-side' : 'total'} external weight. The whole board will rebuild together. Previous scores stay in their original rules history; this is not a new performed record.`}
        </UiText>
        {baseline.legacy ? <UiText variant="bodyMuted">Existing certifications keep their original coverage. Recalculated comparisons need new metric-specific attestations.</UiText> :
          <UiText variant="bodyMuted">Attestations of unchanged performance inputs stay valid. Personal exercise settings and saved session weights stay unchanged.</UiText>}
      </> : null}
      {errorMessage ? <GroupWriteNotice message={errorMessage} testID="group-exercise-form-error" tone="error" /> : null}
      <ActionButton variant="primary" disabled={pending || Boolean(stale)} label={pending ? pendingLabel : calculationChanged ? reviewed ? 'Apply group rules' : 'Review rule changes' : submitLabel}
        onPress={submit} testID="group-exercise-form-submit" />
    </Card>
  );
}
