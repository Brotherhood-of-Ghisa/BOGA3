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
  const { user } = useAuth();
  const preferences = useAccountLocalPreferenceState();
  const values = { ...preferences.values, ...preferences.pending };
  const syncSnapshot = useSyncStatusSnapshot(Boolean(user));

  return (
    <ScreenScroll
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      testID="settings-screen">
      <FormSection title="Account">
        <DestinationRow
          icon="user" label="Account" route="/profile" testID="settings-profile-row"
          value={user ? user.email?.trim() || undefined : 'Signed out'}
        />
      </FormSection>
      <FormSection title="Training">
        <DestinationRow
          icon="timer" label="Rest timer" route={SETTINGS_SUB_PAGES.restTimer} testID="settings-rest-timer-row"
          value={restTimerStatus(values)}
        />
        <BodyWeightSettingsRow divider />
        <DestinationRow
          divider icon="sliders" label="Muscles" route={SETTINGS_SUB_PAGES.muscles} testID="settings-muscles-row"
          value={values.muscleTargetMode === 'per-muscle' ? 'Per muscle targets' : 'Single target'}
        />
        <DestinationRow
          divider icon="gauge" label="Effort" route={SETTINGS_SUB_PAGES.effort} testID="settings-effort-row"
          value={effortStatus(values)}
        />
        <DestinationRow
          divider icon="progress" label="Progress" route={SETTINGS_SUB_PAGES.progress} testID="settings-progress-row"
          value={progressStatus(values)}
        />
      </FormSection>
      <FormSection title="App">
        <AppearanceSettingsRow />
        <NotificationSettingsRow divider key={user?.id ?? 'signed-out'} userId={user?.id ?? null} />
        <DestinationRow
          divider icon="refresh" label="Data & sync" route={SETTINGS_SUB_PAGES.dataSync} testID="settings-data-sync-row"
          value={syncStatus(syncSnapshot, { isSignedIn: Boolean(user), preferenceError: preferences.error })}
        />
        <DestinationRow
          divider icon="settings" label="Everything else" route={SETTINGS_SUB_PAGES.everythingElse}
          testID="settings-everything-else-row" value={values.dateFormat}
        />
      </FormSection>
      <AboutSection />
    </ScreenScroll>
  );
}

// One destination: an icon, a label, what is set now and a chevron.
function DestinationRow({ divider = false, icon, label, route, testID, value }: {
  divider?: boolean;
  icon: IconName;
  label: string;
  route: Href;
  testID: string;
  value: string | undefined;
}) {
  const router = useRouter();
  return (
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
