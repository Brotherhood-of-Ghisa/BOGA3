import { useRouter } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { ActionButton, ChoiceRow, FormSection, Notice, ScreenScroll, SegmentRow, SwitchRow, ValueRow,
  uiSpace, uiText } from '@/components/ui';
import { buildSettingsMuscleSections, deriveMuscleReportPreset, setMuscleReportPreset, setMuscleTracked,
  type SettingsMuscleSection } from '@/src/data/muscle-report-settings';
import { SETTINGS_SUB_PAGES } from '@/src/navigation/routes';
import { useAccountLocalPreferenceState, updatePreferences } from '@/src/preferences/hooks';
import { DEFAULT_ACCOUNT_LOCAL_PREFERENCES } from '@/src/preferences/model';
import { withMuscleTarget, type MuscleTargetScope } from '@/src/preferences/muscle-targets';
import { getAccountLocalPreferenceAccountRevision, getAccountLocalPreferenceState } from '@/src/preferences/account-local';
import { MuscleTargetField } from './muscle-target-field';
import { useMuscleSetup } from './use-muscle-setup';

type Page = 'muscles' | 'targets' | 'enabled';
type Preferences = ReturnType<typeof useAccountLocalPreferenceState>;
type Setup = ReturnType<typeof useMuscleSetup>;
const TARGET_MODE_OPTIONS = [{ value: 'single', label: 'Single' }, { value: 'per-muscle', label: 'Per muscle' }] as const;
const PRESET_OPTIONS = [{ value: 'detailed', label: 'Detailed' }, { value: 'broad', label: 'Broad' }] as const;

/** Full stack pages; account changes remount drafts and invalidate setup reads. */
export function MuscleSettingsPage({ page }: { page: Page }) {
  const preferences = useAccountLocalPreferenceState();
  return <MusclePageBody key={preferences.accountRevision} page={page} preferences={preferences} />;
}

function MusclePageBody({ page, preferences }: { page: Page; preferences: Preferences }) {
  const setup = useMuscleSetup(preferences.accountRevision);
  const scope = setup.rows ? deriveMuscleReportPreset(setup.rows) : null;
  const sections = setup.rows ? buildSettingsMuscleSections(page === 'enabled'
    ? setup.rows.map(row => ({ ...row, reportGroup: null })) : setup.rows) : [];
  return <ScreenScroll automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content}
    contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled"
    testID={`settings-${page === 'muscles' ? 'muscles' : page === 'targets' ? 'muscle-targets' : 'enabled-muscles'}-screen`}>
    {preferences.error ? <Notice action={<ActionButton label="Retry" onPress={() => { void preferences.retry(); }} variant="text" />}
      icon="warning" live message={preferences.error} testID="settings-muscle-preferences-error" tone="danger" /> : null}
    {setup.error ? <Notice action={<ActionButton label="Retry" disabled={setup.busy} onPress={setup.retry} variant="text" />}
      icon="warning" live message={setup.error} testID="settings-muscles-error" tone="danger" /> : null}
    {page === 'muscles' ? <MuscleChoices preferences={preferences} scope={scope} setup={setup} sections={sections} /> : null}
    {!setup.rows && !setup.error ? <Text allowFontScaling={false} style={uiText.meta}>Loading muscles…</Text> : null}
    {page === 'targets' && scope ? <TargetSections preferences={preferences} scope={scope} sections={sections} /> : null}
    {page === 'enabled' ? sections.map(section => <FormSection key={section.family} testID={`settings-muscles-family-${section.family}`} title={section.showHeader ? section.family : undefined}>
      {section.muscles.map((muscle, index) => <SwitchRow key={muscle.id} density="list" disabled={setup.busy} divider={index > 0} label={muscle.label}
        testID={`settings-track-${muscle.id}`} value={muscle.tracked}
        onValueChange={tracked => { void setup.change(() => setMuscleTracked(muscle.entryIds, tracked)); }} />)}
    </FormSection>) : null}
  </ScreenScroll>;
}

function DefaultTarget({ preferences, divider = false }: { preferences: Preferences; divider?: boolean }) {
  const current = { ...preferences.values, ...preferences.pending };
  const standard = DEFAULT_ACCOUNT_LOCAL_PREFERENCES.weeklyWorkingSetTarget;
  return <MuscleTargetField blank={standard} divider={divider} label="Default target (sets / week)" placeholder={standard}
    testID="settings-weekly-working-set-target" value={current.weeklyWorkingSetTarget}
    onCommit={weeklyWorkingSetTarget => {
      if (preferences.accountRevision === getAccountLocalPreferenceAccountRevision() && weeklyWorkingSetTarget !== undefined)
        updatePreferences({ weeklyWorkingSetTarget });
    }} />;
}

function MuscleChoices({ preferences, scope, setup, sections }: {
  preferences: Preferences; scope: MuscleTargetScope | null; setup: Setup; sections: SettingsMuscleSection[];
}) {
  const router = useRouter();
  const current = { ...preferences.values, ...preferences.pending };
  const muscles = sections.flatMap(section => section.muscles);
  const enabled = muscles.filter(muscle => muscle.tracked);
  const overrides = scope ? current.muscleTargetOverrides[scope] : undefined;
  const entries = setup.rows ?? [];
  const trackedEntries = entries.filter(row => row.tracked === true || row.tracked === 1);
  const custom = enabled.filter(muscle => overrides && Object.hasOwn(overrides, muscle.id)).length;
  const enabledStatus = setup.rows ? `${trackedEntries.length} / ${entries.length}` : 'Loading…';
  return <>
    <FormSection title="Weekly targets">
      <SegmentRow label="Target mode" options={TARGET_MODE_OPTIONS} value={current.muscleTargetMode}
        testIDPrefix="settings-muscle-target-mode" onChange={muscleTargetMode => updatePreferences({ muscleTargetMode })} />
      <DefaultTarget divider preferences={preferences} />
      {current.muscleTargetMode === 'per-muscle' ? <ChoiceRow accessibilityLabel={`Per muscle targets, ${custom} custom`} divider
        label="Per muscle targets" onPress={() => router.push(SETTINGS_SUB_PAGES.muscleTargets)}
        testID="settings-muscle-targets-row" value={`${custom} custom`} /> : null}
    </FormSection>
    <FormSection title="Muscle breakdown">
      <SegmentRow<MuscleTargetScope> disabled={!scope || setup.busy} label="Breakdown"
        onChange={next => { if (next !== 'custom') void setup.change(() => setMuscleReportPreset(next)); }}
        options={PRESET_OPTIONS} testIDPrefix="settings-muscle-preset" value={scope ?? 'detailed'} />
      {scope === 'custom' ? <ValueRow divider label="Grouping" testID="settings-muscle-custom" value="Custom" /> : null}
      <ChoiceRow accessibilityLabel={`Enabled muscles, ${enabledStatus}`} divider label="Enabled muscles"
        onPress={() => router.push(SETTINGS_SUB_PAGES.enabledMuscles)} testID="settings-enabled-muscles-row" value={enabledStatus} />
    </FormSection>
  </>;
}

function TargetSections({ preferences, scope, sections }: { preferences: Preferences; scope: MuscleTargetScope; sections: SettingsMuscleSection[] }) {
  const current = { ...preferences.values, ...preferences.pending };
  const enabled = sections.map(section => {
    const muscles = section.muscles.filter(muscle => muscle.tracked);
    return { ...section, muscles, showHeader: muscles.length >= 2 };
  }).filter(section => section.muscles.length > 0);
  const save = (id: string, target: number | undefined) => {
    if (preferences.accountRevision !== getAccountLocalPreferenceAccountRevision()) return;
    // Read pending edits too, so adjacent commits never lose an earlier change.
    const latest = getAccountLocalPreferenceState();
    updatePreferences({ muscleTargetOverrides: withMuscleTarget(
      latest.pending.muscleTargetOverrides ?? latest.values.muscleTargetOverrides, scope, id, target) });
  };
  return <>
    <FormSection footnote={`Per-muscle targets apply to the ${scope} breakdown`} title="Default">
      <DefaultTarget preferences={preferences} />
    </FormSection>
    {enabled.map(section => <FormSection key={section.family} testID={`settings-muscles-family-${section.family}`} title={section.showHeader ? section.family : undefined}>
      {section.muscles.map((muscle, index) => <MuscleTargetField key={`${scope}:${muscle.id}`} blank={undefined}
        divider={index > 0} label={muscle.label} placeholder={current.weeklyWorkingSetTarget}
        testID={`settings-muscle-target-${muscle.id}`}
        value={Object.hasOwn(current.muscleTargetOverrides[scope] ?? {}, muscle.id) ? current.muscleTargetOverrides[scope]![muscle.id] : undefined}
        onCommit={target => save(muscle.id, target)} />)}
    </FormSection>)}
    {enabled.length === 0 ? <Text allowFontScaling={false} style={uiText.meta} testID="settings-muscle-targets-empty">No muscles enabled.</Text> : null}
  </>;
}

const styles = StyleSheet.create({
  content: { gap: uiSpace.md },
});
