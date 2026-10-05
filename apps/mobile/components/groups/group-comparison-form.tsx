import { Text } from 'react-native';

import { ExerciseCoreFields } from '@/components/exercise-core/exercise-core-fields';
import { ActionButton, Card, SegmentedControl, uiSpace } from '@/components/ui';
import {
  comparisonSubmitLabel,
  deriveComparisonFormStatus,
  validateCompetitionFormRules,
  type ComparisonPreview,
} from '@/src/groups/comparison-form-model';
import { GROUP_COMPETITION_METRICS as GROUP_METRICS, type CompetitionRules as GroupExerciseRules, type CompetitionMetric as GroupMetric } from '@/src/groups/competition-contract';
import type { CompetitionExerciseWire as GroupMetricExerciseWire } from '@/src/groups/competition-wire';

import { useComparisonDraft } from './use-comparison-draft';
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

/** Shared field recipe, with a version-bound preview for group-wide changes. */
export function GroupComparisonForm({ bodyweightCalculationsEnabled, initialRules = emptyComparisonRules, existing, note,
  submitLabel, pendingLabel, pending, errorMessage, onSubmit }: Props) {
  const prefill = existing ? comparisonRulesFromWire(existing) : { ...initialRules, bodyweightCalculationsEnabled };
  const draft = useComparisonDraft(prefill, existing);
  return <GroupComparisonFormFields bodyweightCalculationsEnabled={bodyweightCalculationsEnabled} existing={existing}
    note={note} submitLabel={submitLabel} pendingLabel={pendingLabel} pending={pending} errorMessage={errorMessage} onSubmit={onSubmit} draft={draft} />;
}

export function GroupComparisonFormFields({ bodyweightCalculationsEnabled,existing,note,submitLabel,pendingLabel,pending,errorMessage,onSubmit,draft }:
  Props & { draft: ReturnType<typeof useComparisonDraft> }) {
  const validation = validateCompetitionFormRules({ name: draft.name, loadInputMode: draft.loadInputMode,
    bodyweightCalculationsEnabled, bodyweightContribution: draft.contribution,
    defaultMetric: draft.defaultMetric });
  const status = deriveComparisonFormStatus({ validation, baseline: draft.baseline, existing,
    dirty: draft.dirty, showErrors: draft.showErrors, reviewed: draft.reviewed });
  const submit = () => {
    draft.revealErrors();
    if (!validation.ok || pending) return;
    if (status.calculationChanged && !draft.reviewed) { draft.markReviewed(); return; }
    onSubmit(validation.value, draft.baseline.revision);
  };
  return (
    <Card style={{ padding: uiSpace.md, gap: uiSpace.md }} testID="group-exercise-form">
      {note ? <Text allowFontScaling={false} style={textStyles.muted} testID="group-exercise-form-note">{note}</Text> : null}
      {draft.baseline.revision !== null ? <Text allowFontScaling={false} style={textStyles.muted} testID="group-rules-revision">Rules revision {draft.baseline.revision}</Text> : null}
      <ExerciseCoreFields editable={!pending} name={draft.name} loadInputMode={draft.loadInputMode}
        nameError={status.nameError}
        onChangeName={draft.changeName}
        onChangeLoadInputMode={draft.changeLoadInputMode}
        testIDPrefix="group-exercise-form"
        bodyweightContribution={bodyweightCalculationsEnabled ? {
          value: draft.contributionField,
          scope: 'group',
          onChange: draft.changeContribution,
          error: status.rulesError,
        } : undefined} />
      <Text allowFontScaling={false} style={textStyles.muted}>Default ranking</Text>
      <SegmentedControl accessibilityLabel="Default ranking" disabled={pending} value={draft.defaultMetric} layout="fit"
        options={METRIC_OPTIONS} onChange={draft.changeDefaultMetric} testIDPrefix="group-exercise-default-metric" />
      <Text allowFontScaling={false} style={textStyles.muted}>Members can switch ranking views. This choice only sets the opening view.</Text>
      {status.stale ? <StaleRulesNotice onReload={draft.reload} pending={pending} /> : null}
      {status.preview ? <RulesChangePreview preview={status.preview} /> : null}
      {errorMessage ? <GroupWriteNotice message={errorMessage} testID="group-exercise-form-error" tone="error" /> : null}
      <ActionButton variant="primary" disabled={pending || status.stale}
        label={comparisonSubmitLabel({ pending, calculationChanged: status.calculationChanged, reviewed: draft.reviewed, pendingLabel, submitLabel })}
        onPress={submit} testID="group-exercise-form-submit" />
    </Card>
  );
}

function StaleRulesNotice({ pending, onReload }: { pending: boolean; onReload: () => void }) {
  return <>
    <GroupWriteNotice tone="error" testID="group-rules-stale"
      message="The group rules changed while you were editing. Your values are kept. Reload group rules to replace them with the current settings before editing again." />
    <ActionButton variant="outline" label="Reload group rules" disabled={pending} testID="group-rules-reload" onPress={onReload} />
  </>;
}

function RulesChangePreview({ preview }: { preview: ComparisonPreview }) {
  return <>
    <Text allowFontScaling={false} style={textStyles.muted} testID="group-rules-preview">{preview.summary}</Text>
    <Text allowFontScaling={false} style={textStyles.muted}>{preview.attestationNote}</Text>
  </>;
}
