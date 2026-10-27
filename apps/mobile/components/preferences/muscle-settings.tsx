import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ActionButton, Card, FormSection, Icon, ListRow, Notice, ScreenScroll, SegmentedControl, SwitchRow,
  uiFonts, uiRoles, uiSpace, uiText, uiTypography } from '@/components/ui';
import { buildSettingsMuscleSections, deriveMuscleReportPreset, setMuscleReportPreset, setMuscleTracked,
  type SettingsMuscleSection } from '@/src/data/muscle-report-settings';
import { SETTINGS_SUB_PAGES } from '@/src/navigation/routes';
import { useAccountLocalPreferenceState, updatePreferences } from '@/src/preferences/hooks';
import { withMuscleTarget, type MuscleTargetScope } from '@/src/preferences/muscle-targets';
import { getAccountLocalPreferenceAccountRevision, getAccountLocalPreferenceState } from '@/src/preferences/account-local';
import { MuscleTargetField } from './muscle-target-field';
import { useMuscleSetup } from './use-muscle-setup';

type Page = 'muscles' | 'targets' | 'enabled';
type Preferences = ReturnType<typeof useAccountLocalPreferenceState>;
type Setup = ReturnType<typeof useMuscleSetup>;
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
    {!setup.rows && !setup.error ? <Text allowFontScaling={false} style={styles.body}>Loading muscles…</Text> : null}
    {page === 'targets' && scope ? <TargetSections preferences={preferences} scope={scope} sections={sections} /> : null}
    {page === 'enabled' ? sections.map(section => <MuscleSection key={section.family} section={section}>
      {section.muscles.map((muscle, index) => <SwitchRow key={muscle.id} density="list" disabled={setup.busy} divider={index > 0} label={muscle.label}
        testID={`settings-track-${muscle.id}`} value={muscle.tracked}
        onValueChange={tracked => { void setup.change(() => setMuscleTracked(muscle.entryIds, tracked)); }} />)}
    </MuscleSection>) : null}
  </ScreenScroll>;
}

function DefaultTarget({ preferences }: { preferences: Preferences }) {
  const current = { ...preferences.values, ...preferences.pending };
  return <MuscleTargetField label="Default target (sets / week)" testID="settings-weekly-working-set-target"
    value={current.weeklyWorkingSetTarget} onCommit={weeklyWorkingSetTarget => {
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
  return <>
    <FormSection title="Weekly targets">
        <View style={styles.choice}>
          <Text allowFontScaling={false} style={styles.label}>Target mode</Text>
          <SegmentedControl accessibilityLabel="Target mode" options={[{ value: 'single', label: 'Single' }, { value: 'per-muscle', label: 'Per muscle' }]}
            value={current.muscleTargetMode} testIDPrefix="settings-muscle-target-mode"
            onChange={muscleTargetMode => updatePreferences({ muscleTargetMode })} />
        </View>
        <DefaultTarget preferences={preferences} />
        {current.muscleTargetMode === 'per-muscle' ? <Destination label="Per muscle targets"
          status={`${custom} custom`} testID="settings-muscle-targets-row" onPress={() => router.push(SETTINGS_SUB_PAGES.muscleTargets)} /> : null}
    </FormSection>
    <FormSection title="Muscle breakdown">
        <View style={styles.choice}>
          <SegmentedControl<MuscleTargetScope> accessibilityLabel="Muscle breakdown" disabled={!scope || setup.busy}
            options={PRESET_OPTIONS} value={scope ?? 'detailed'} testIDPrefix="settings-muscle-preset"
            onChange={next => { if (next !== 'custom') void setup.change(() => setMuscleReportPreset(next)); }} />
          {scope === 'custom' ? <Text allowFontScaling={false} style={styles.label} testID="settings-muscle-custom">Custom</Text> : null}
        </View>
        <Destination label="Enabled muscles" status={setup.rows ? `${trackedEntries.length} / ${entries.length}` : 'Loading…'}
          testID="settings-enabled-muscles-row" onPress={() => router.push(SETTINGS_SUB_PAGES.enabledMuscles)} />
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
    <Card><DefaultTarget preferences={preferences} /></Card>
    <View style={styles.listHead}><SectionLabel title={scope === 'custom' ? 'Custom' : scope === 'broad' ? 'Broad' : 'Detailed'} />
      <SectionLabel title="Sets / week" /></View>
    {enabled.map(section => <MuscleSection key={section.family} section={section}>
      {section.muscles.map(muscle => <MuscleTargetField key={`${scope}:${muscle.id}`} label={muscle.label}
        testID={`settings-muscle-target-${muscle.id}`} defaultTarget={current.weeklyWorkingSetTarget}
        value={Object.hasOwn(current.muscleTargetOverrides[scope] ?? {}, muscle.id) ? current.muscleTargetOverrides[scope]![muscle.id] : undefined}
        onCommit={target => save(muscle.id, target)} />)}
    </MuscleSection>)}
    {enabled.length === 0 ? <Text allowFontScaling={false} style={styles.body} testID="settings-muscle-targets-empty">No muscles enabled.</Text> : null}
  </>;
}

function MuscleSection({ section, children }: { section: SettingsMuscleSection; children: ReactNode }) {
  return <View style={styles.section} testID={`settings-muscles-family-${section.family}`}>
    {section.showHeader ? <SectionLabel title={section.family} /> : null}
    <Card>{children}</Card>
  </View>;
}
function SectionLabel({ title }: { title: string }) {
  return <Text accessibilityRole="header" allowFontScaling={false} style={uiText.label}>{title}</Text>;
}
function Destination({ label, status, testID, onPress }: { label: string; status: string; testID: string; onPress: () => void }) {
  return <ListRow label={label} density="list" onPress={onPress} testID={testID}
    accessibilityLabel={`${label}, ${status}`} meta={<Text allowFontScaling={false} style={styles.meta}>{status}</Text>}
    trailing={<Icon color={uiRoles.inkFaint} name="chevron-right" size="sm" />} />;
}

const styles = StyleSheet.create({
  content: { gap: uiSpace.xl },
  section: { gap: uiSpace.sm },
  choice: { padding: uiSpace.md, gap: uiSpace.sm },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: uiSpace.md },
  label: { fontFamily: uiFonts.display.family, fontWeight: '600', fontSize: uiTypography.size.base, lineHeight: uiTypography.lineHeight.base, color: uiRoles.ink },
  body: { fontFamily: uiFonts.body.family, fontSize: uiTypography.size.base, lineHeight: uiTypography.lineHeight.base, color: uiRoles.inkMuted },
  meta: { fontFamily: uiFonts.figure.family, fontWeight: '500', fontSize: uiTypography.size.sm, lineHeight: uiTypography.lineHeight.sm, color: uiRoles.inkMuted },
});
