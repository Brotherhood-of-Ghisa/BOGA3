import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { ActionButton, ChoiceRow, FormSection, Notice, ScreenScroll, SegmentRow, uiSpace, useUiText } from '@/components/ui';
import { buildSettingsMuscleSections, type MuscleSetupChange, type SettingsMuscleSection } from '@/src/data/muscle-report-settings';
import { SETTINGS_SUB_PAGES } from '@/src/navigation/routes';
import { useAccountLocalPreferenceState, updatePreferences } from '@/src/preferences/hooks';
import { DEFAULT_ACCOUNT_LOCAL_PREFERENCES } from '@/src/preferences/model';
import { withMuscleTarget } from '@/src/preferences/muscle-targets';
import { musclesOnStatus } from '@/src/preferences/muscle-setup-view';
import { getAccountLocalPreferenceAccountRevision, getAccountLocalPreferenceState } from '@/src/preferences/account-local';
import { MuscleTargetField } from './muscle-target-field';
import { useMuscleSetup } from './use-muscle-setup';

type Preferences = ReturnType<typeof useAccountLocalPreferenceState>;
export type MuscleSetupState = ReturnType<typeof useMuscleSetup>;
const TARGET_MODE_OPTIONS = [{ value: 'single', label: 'Single' }, { value: 'per-muscle', label: 'Per muscle' }] as const;

type ShellContent = (props: { preferences: Preferences; setup: MuscleSetupState; loaded: MuscleSetupChange | null }) => ReactNode;

/**
 * Every Muscles settings page ([[muscle.report-groups]], [[muscle.weekly-targets]]):
 * a full stack page whose body remounts on an account change, so drafts and
 * setup reads never cross accounts. It shows the load and save errors with
 * Retry, and `Loading muscles…` until the setup is read.
 */
export function MuscleSetupShell({ testID, children }: { testID: string; children: ShellContent }) {
  const preferences = useAccountLocalPreferenceState();
  return <ShellBody key={preferences.accountRevision} preferences={preferences} testID={testID}>{children}</ShellBody>;
}

function ShellBody({ preferences, testID, children }: { preferences: Preferences; testID: string; children: ShellContent }) {
  const setup = useMuscleSetup(preferences.accountRevision);
  const text = useUiText();
  const loaded = setup.rows && setup.definitions ? { rows: setup.rows, definitions: setup.definitions } : null;
  return <ScreenScroll automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content}
    contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" testID={testID}>
    {preferences.error ? <Notice action={<ActionButton label="Retry" onPress={() => { void preferences.retry(); }} variant="text" />}
      icon="warning" live message={preferences.error} testID="settings-muscle-preferences-error" tone="danger" /> : null}
    {setup.error ? <Notice action={<ActionButton label="Retry" disabled={setup.busy} onPress={setup.retry} variant="text" />}
      icon="warning" live message={setup.error} testID="settings-muscles-error" tone="danger" /> : null}
    {!loaded && !setup.error ? <Text allowFontScaling={false} style={text.meta}>Loading muscles…</Text> : null}
    {children({ preferences, setup, loaded })}
  </ScreenScroll>;
}

/** Settings → Muscles: weekly targets, then the muscle setup's two pages. */
export function MusclesSettingsPage() {
  return <MuscleSetupShell testID="settings-muscles-screen">
    {({ preferences, loaded }) => <MuscleChoices loaded={loaded} preferences={preferences} />}
  </MuscleSetupShell>;
}

/** Per muscle targets: the default, then one field per enabled reported muscle. */
export function MuscleTargetsSettingsPage() {
  return <MuscleSetupShell testID="settings-muscle-targets-screen">
    {({ preferences, loaded }) => loaded
      ? <TargetSections preferences={preferences} sections={buildSettingsMuscleSections(loaded.rows, loaded.definitions)} />
      : null}
  </MuscleSetupShell>;
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

function MuscleChoices({ preferences, loaded }: { preferences: Preferences; loaded: MuscleSetupChange | null }) {
  const router = useRouter();
  const current = { ...preferences.values, ...preferences.pending };
  const enabled = loaded ? buildSettingsMuscleSections(loaded.rows, loaded.definitions)
    .flatMap(section => section.muscles).filter(muscle => muscle.tracked) : [];
  const custom = enabled.filter(muscle => Object.hasOwn(current.muscleTargetOverrides, muscle.id)).length;
  const musclesStatus = loaded ? musclesOnStatus(loaded.rows) : 'Loading…';
  const combinedStatus = loaded ? String(loaded.definitions.length) : 'Loading…';
  return <>
    <FormSection title="Weekly targets">
      <SegmentRow label="Target mode" options={TARGET_MODE_OPTIONS} value={current.muscleTargetMode}
        testIDPrefix="settings-muscle-target-mode" onChange={muscleTargetMode => updatePreferences({ muscleTargetMode })} />
      <DefaultTarget divider preferences={preferences} />
      {current.muscleTargetMode === 'per-muscle' ? <ChoiceRow accessibilityLabel={`Per muscle targets, ${custom} custom`} divider
        label="Per muscle targets" onPress={() => router.push(SETTINGS_SUB_PAGES.muscleTargets)}
        testID="settings-muscle-targets-row" value={`${custom} custom`} /> : null}
    </FormSection>
    <FormSection title="Muscle setup">
      <ChoiceRow accessibilityLabel={`Muscles, ${musclesStatus}`} label="Muscles"
        onPress={() => router.push(SETTINGS_SUB_PAGES.muscleList)} testID="settings-muscle-list-row" value={musclesStatus} />
      <ChoiceRow accessibilityLabel={`Combined muscles, ${combinedStatus}`} divider label="Combined muscles"
        onPress={() => router.push(SETTINGS_SUB_PAGES.combinedMuscles)} testID="settings-combined-muscles-row" value={combinedStatus} />
    </FormSection>
  </>;
}

function TargetSections({ preferences, sections }: { preferences: Preferences; sections: SettingsMuscleSection[] }) {
  const current = { ...preferences.values, ...preferences.pending };
  const text = useUiText();
  const enabled = sections.map(section => {
    const muscles = section.muscles.filter(muscle => muscle.tracked);
    return { ...section, muscles, showHeader: muscles.length >= 2 };
  }).filter(section => section.muscles.length > 0);
  const save = (id: string, target: number | undefined) => {
    if (preferences.accountRevision !== getAccountLocalPreferenceAccountRevision()) return;
    // Read pending edits too, so adjacent commits never lose an earlier change.
    const latest = getAccountLocalPreferenceState();
    updatePreferences({ muscleTargetOverrides: withMuscleTarget(
      latest.pending.muscleTargetOverrides ?? latest.values.muscleTargetOverrides, id, target) });
  };
  return <>
    <FormSection title="Default">
      <DefaultTarget preferences={preferences} />
    </FormSection>
    {enabled.map(section => <FormSection key={section.family} testID={`settings-muscles-family-${section.family}`} title={section.showHeader ? section.family : undefined}>
      {section.muscles.map((muscle, index) => <MuscleTargetField key={muscle.id} blank={undefined}
        divider={index > 0} label={muscle.label} placeholder={current.weeklyWorkingSetTarget}
        testID={`settings-muscle-target-${muscle.id}`}
        value={Object.hasOwn(current.muscleTargetOverrides, muscle.id) ? current.muscleTargetOverrides[muscle.id] : undefined}
        onCommit={target => save(muscle.id, target)} />)}
    </FormSection>)}
    {enabled.length === 0 ? <Text allowFontScaling={false} style={text.meta} testID="settings-muscle-targets-empty">No muscles enabled.</Text> : null}
  </>;
}

const styles = StyleSheet.create({
  content: { gap: uiSpace.md },
});
