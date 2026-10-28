import { Text, View } from 'react-native';

import { ExerciseNameField, ExerciseWeightSection } from '@/components/exercise-core/exercise-core-fields';
import { ActionButton, FigureText, FormSection, ListRow, SegmentedControl, uiSpace, uiText, uiTextTone } from '@/components/ui';
import { deriveComparisonFormStatus, validateCompetitionFormRules } from '@/src/groups/comparison-form-model';
import { GROUP_COMPETITION_METRICS as GROUP_METRICS, type CompetitionRules as GroupExerciseRules, type CompetitionMetric as GroupMetric } from '@/src/groups/competition-contract';
import type { CompetitionExerciseWire as GroupMetricExerciseWire } from '@/src/groups/competition-wire';

import { useComparisonDraft } from './use-comparison-draft';
import { GroupWriteNotice } from './write-notice';

type Props = {
  bodyweightCalculationsEnabled: boolean;
  initialRules?: GroupExerciseRules;
  /** Preserve the version seen when editing begins, even if a refresh lands. */
  existing?: GroupMetricExerciseWire;
  submitLabel: string;
  pendingLabel: string;
  pending: boolean;
  errorMessage: string | null;
  onSubmit: (rules: GroupExerciseRules, expectedRevision: number | null) => void;
};
export const emptyComparisonRules: GroupExerciseRules = { name: '', loadInputMode: 'total_load', bodyweightCalculationsEnabled: false,
  bodyweightContribution: 0,
  defaultMetric: 'e1rm' };
export const comparisonRulesFromWire = (exercise: GroupMetricExerciseWire): GroupExerciseRules => ({
  name: exercise.name, loadInputMode: exercise.rules.load_input_mode,
  bodyweightCalculationsEnabled: exercise.rules.bodyweight_calculations_enabled,
  bodyweightContribution: exercise.rules.bodyweight_contribution,
  defaultMetric: exercise.rules.default_metric,
});
const metricLabels: Record<GroupMetric, string> = {
  volume: 'Volume', e1rm: '1RM',
};
const METRIC_OPTIONS = GROUP_METRICS.map(metric => ({
  value: metric, label: metricLabels[metric], accessibilityLabel: metricLabels[metric],
}));

/** Shared field recipe; edits submit against the revision they started from. */
export function GroupComparisonForm({ bodyweightCalculationsEnabled, initialRules = emptyComparisonRules, existing,
  submitLabel, pendingLabel, pending, errorMessage, onSubmit }: Props) {
  const prefill = existing ? comparisonRulesFromWire(existing) : { ...initialRules, bodyweightCalculationsEnabled };
  const draft = useComparisonDraft(prefill, existing);
  return <GroupComparisonFormFields bodyweightCalculationsEnabled={bodyweightCalculationsEnabled} existing={existing}
    submitLabel={submitLabel} pendingLabel={pendingLabel} pending={pending} errorMessage={errorMessage} onSubmit={onSubmit} draft={draft} />;
}

export function GroupComparisonFormFields({ bodyweightCalculationsEnabled,existing,submitLabel,pendingLabel,pending,errorMessage,onSubmit,draft }:
  Props & { draft: ReturnType<typeof useComparisonDraft> }) {
  const validation = validateCompetitionFormRules({ name: draft.name, loadInputMode: draft.loadInputMode,
    bodyweightCalculationsEnabled, bodyweightContribution: draft.contribution,
    defaultMetric: draft.defaultMetric });
  const status = deriveComparisonFormStatus({ validation, baseline: draft.baseline, existing,
    dirty: draft.dirty, showErrors: draft.showErrors });
  const submit = () => {
    draft.revealErrors();
    if (!validation.ok || pending) return;
    onSubmit(validation.value, draft.baseline.revision);
  };
  return (
    <View style={{ gap: uiSpace.lg }} testID="group-exercise-form">
      {draft.baseline.revision !== null ? <Text allowFontScaling={false} style={[uiText.body, uiTextTone.muted]} testID="group-rules-revision">Rules revision <FigureText>{String(draft.baseline.revision)}</FigureText></Text> : null}
      <ExerciseNameField editable={!pending} name={draft.name} nameError={status.nameError}
        onChangeName={draft.changeName} testIDPrefix="group-exercise-form" />
      <ExerciseWeightSection editable={!pending} loadInputMode={draft.loadInputMode}
        onChangeLoadInputMode={draft.changeLoadInputMode}
        testIDPrefix="group-exercise-form"
        bodyweightContribution={bodyweightCalculationsEnabled ? {
          value: draft.contributionField,
          onChange: draft.changeContribution,
          error: status.rulesError,
        } : undefined} />
      <FormSection title="Leaderboards">
        <ListRow density="list" divider={false} label="Default ranking" meta={
          <SegmentedControl accessibilityLabel="Default ranking" disabled={pending} value={draft.defaultMetric} layout="fit"
            options={METRIC_OPTIONS} onChange={draft.changeDefaultMetric} testIDPrefix="group-exercise-default-metric" />} />
      </FormSection>
      {status.stale ? <StaleRulesNotice onReload={draft.reload} pending={pending} /> : null}
      {errorMessage ? <GroupWriteNotice message={errorMessage} testID="group-exercise-form-error" tone="error" /> : null}
      <ActionButton variant="primary" disabled={pending || status.stale}
        label={pending ? pendingLabel : submitLabel}
        onPress={submit} testID="group-exercise-form-submit" />
    </View>
  );
}

function StaleRulesNotice({ pending, onReload }: { pending: boolean; onReload: () => void }) {
  return <>
    <GroupWriteNotice tone="error" testID="group-rules-stale"
      message="The group rules changed while you were editing. Your values are kept. Reload group rules to replace them with the current settings before editing again." />
    <ActionButton variant="outline" label="Reload group rules" disabled={pending} testID="group-rules-reload" onPress={onReload} />
  </>;
}
