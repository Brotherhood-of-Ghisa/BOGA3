import { useRouter, type Href } from 'expo-router';
import { StyleSheet } from 'react-native';

import { AppearanceSettingsRow } from '@/components/appearance/appearance-settings';
import { BodyWeightSettingsRow } from '@/components/bodyweight/settings-row';
import { TabOwnedPage } from '@/components/navigation/tab-owned-page';
import { NotificationSettingsRow } from '@/components/notifications/settings-row';
import { effortStatus, progressStatus, restTimerStatus, syncStatus } from '@/components/settings/statuses';
import { useSyncStatusSnapshot } from '@/components/sync-status/use-sync-status';
import { ChoiceRow, FormSection, ScreenScroll, ValueRow, uiSpace, type IconName } from '@/components/ui';
import { useAuth } from '@/src/auth';
import { SETTINGS_SUB_PAGES } from '@/src/navigation/routes';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import { readAppRuntimeMetadata } from '@/src/utils/runtime-metadata';

// A root-stack page under the native header, keeping the tab bar (More).
export default function SettingsRoute() {
  return (
    <TabOwnedPage>
      <SettingsScreen />
    </TabOwnedPage>
  );
}

// One grouped list: Account, Training, App, About. Every row but About's names
// a destination — an icon, a label, what is set now and a chevron — and every
// setting lives on its page.
function SettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const preferences = useAccountLocalPreferenceState();
  const values = { ...preferences.values, ...preferences.pending };
  const syncSnapshot = useSyncStatusSnapshot(Boolean(user));

  const destination = (
    testID: string,
    label: string,
    icon: IconName,
    route: Href,
    value: string | undefined,
    divider = true,
  ) => (
    <ChoiceRow
      accessibilityLabel={value ? `${label}, ${value}` : label}
      divider={divider}
      icon={icon}
      label={label}
      onPress={() => router.push(route)}
      testID={testID}
      value={value}
    />
  );

  return (
    <ScreenScroll
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      testID="settings-screen">
      <FormSection title="Account">
        {destination('settings-profile-row', 'Account', 'user', '/profile', user ? user.email?.trim() || undefined : 'Signed out', false)}
      </FormSection>
      <FormSection title="Training">
        {destination('settings-rest-timer-row', 'Rest timer', 'timer', SETTINGS_SUB_PAGES.restTimer, restTimerStatus(values), false)}
        <BodyWeightSettingsRow divider />
        {destination(
          'settings-muscles-row', 'Muscles', 'sliders', SETTINGS_SUB_PAGES.muscles,
          values.muscleTargetMode === 'per-muscle' ? 'Per muscle targets' : 'Single target',
        )}
        {destination('settings-effort-row', 'Effort', 'gauge', SETTINGS_SUB_PAGES.effort, effortStatus(values))}
        {destination('settings-progress-row', 'Progress', 'progress', SETTINGS_SUB_PAGES.progress, progressStatus(values))}
      </FormSection>
      <FormSection title="App">
        <AppearanceSettingsRow />
        <NotificationSettingsRow divider key={user?.id ?? 'signed-out'} userId={user?.id ?? null} />
        {destination(
          'settings-data-sync-row', 'Data & sync', 'refresh', SETTINGS_SUB_PAGES.dataSync,
          syncStatus(syncSnapshot, { isSignedIn: Boolean(user), preferenceError: preferences.error }),
        )}
        {destination('settings-everything-else-row', 'Everything else', 'settings', SETTINGS_SUB_PAGES.everythingElse, values.dateFormat)}
      </FormSection>
      <AboutSection />
    </ScreenScroll>
  );
}

// The build's identity, read and never pressed: the list's last section.
function AboutSection() {
  const runtimeMetadata = readAppRuntimeMetadata();
  const { buildNumber, version } = runtimeMetadata;
  const rows = [
    version
      ? { testID: 'settings-about-version', label: 'Version', value: buildNumber ? `${version} (build ${buildNumber})` : version }
      : buildNumber ? { testID: 'settings-about-version', label: 'Build', value: buildNumber } : null,
    runtimeMetadata.releaseCodename
      ? { testID: 'settings-about-release', label: 'Release', value: runtimeMetadata.releaseCodename }
      : null,
    runtimeMetadata.displayFlavor
      ? { testID: 'settings-about-flavor', label: 'Flavor', value: runtimeMetadata.displayFlavor === 'preview' ? 'Preview' : 'Local' }
      : null,
  ].filter((row): row is { testID: string; label: string; value: string } => row !== null);

  return (
    <FormSection testID="settings-about-card" title="About">
      {rows.length > 0 ? (
        rows.map((row, index) => <ValueRow divider={index > 0} key={row.testID} {...row} />)
      ) : (
        <ValueRow label="Release information" value="Unavailable" />
      )}
    </FormSection>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: uiSpace.md,
  },
});
