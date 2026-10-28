import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AppearanceSettingsRow } from '@/components/appearance/appearance-settings';
import { BodyWeightSettingsRow } from '@/components/bodyweight/settings-row';
import { TabOwnedPage } from '@/components/navigation/tab-owned-page';
import { NotificationSettingsRow } from '@/components/notifications/settings-row';
import { SettingsCard } from '@/components/settings/settings-card';
import { effortStatus, experimentsStatus, progressStatus, restTimerStatus, syncStatus } from '@/components/settings/statuses';
import { useSyncStatusSnapshot } from '@/components/sync-status/use-sync-status';
import {
  Card,
  FigureText,
  Icon,
  ListRow,
  ScreenScroll,
  uiRoles,
  uiSpace,
  uiText,
  uiTextTone,
} from '@/components/ui';
import { useAuth } from '@/src/auth';
import { SETTINGS_SUB_PAGES } from '@/src/navigation/routes';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import { formatVersionBuild, readAppRuntimeMetadata } from '@/src/utils/runtime-metadata';

// A root-stack page under the native header, keeping the tab bar (More).
export default function SettingsRoute() {
  return (
    <TabOwnedPage>
      <SettingsScreen />
    </TabOwnedPage>
  );
}

// A list of cards, each an icon, a label and what is set now. Every setting
// lives on a sub page.
function SettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const preferences = useAccountLocalPreferenceState();
  const values = { ...preferences.values, ...preferences.pending };
  const syncSnapshot = useSyncStatusSnapshot(Boolean(user));

  return (
    <ScreenScroll
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      testID="settings-screen">
      <SettingsCard
        accessibilityHint="Opens your account screen"
        icon="user"
        label="Account"
        onPress={() => router.push('/profile')}
        status={user ? user.email?.trim() || undefined : 'Signed out'}
        testID="settings-profile-row"
      />
      <Card><AppearanceSettingsRow /></Card>
      <BodyWeightSettingsRow />
      <SettingsCard
        icon="timer"
        label="Rest timer"
        onPress={() => router.push(SETTINGS_SUB_PAGES.restTimer)}
        status={restTimerStatus(values)}
        testID="settings-rest-timer-row"
      />
      <Card><NotificationSettingsRow key={user?.id ?? 'signed-out'} userId={user?.id ?? null} /></Card>
      <SettingsCard
        icon="progress"
        label="Progress"
        onPress={() => router.push(SETTINGS_SUB_PAGES.progress)}
        status={progressStatus(values)}
        testID="settings-progress-row"
      />
      <SettingsCard
        icon="sliders"
        label="Muscles"
        onPress={() => router.push(SETTINGS_SUB_PAGES.muscles)}
        status={values.muscleTargetMode === 'per-muscle' ? 'Per muscle targets' : 'Single target'}
        testID="settings-muscles-row"
      />
      <SettingsCard
        icon="gauge"
        label="Effort"
        onPress={() => router.push(SETTINGS_SUB_PAGES.effort)}
        status={effortStatus(values)}
        testID="settings-effort-row"
      />
      <SettingsCard
        icon="code"
        label="Developer tools"
        onPress={() => router.push(SETTINGS_SUB_PAGES.developerTools)}
        status={`Developer mode ${values.developerMode ? 'on' : 'off'}`}
        testID="settings-developer-tools-row"
      />
      <SettingsCard
        icon="refresh"
        label="Data & sync"
        onPress={() => router.push(SETTINGS_SUB_PAGES.dataSync)}
        status={syncStatus(syncSnapshot, { isSignedIn: Boolean(user), preferenceError: preferences.error })}
        testID="settings-data-sync-row"
      />
      <SettingsCard
        icon="sliders"
        label="Other"
        onPress={() => router.push(SETTINGS_SUB_PAGES.other)}
        status={values.dateFormat}
        testID="settings-other-row"
      />
      <SettingsCard
        icon="sparkles"
        label="Experiments"
        onPress={() => router.push(SETTINGS_SUB_PAGES.experiments)}
        status={experimentsStatus(values)}
        testID="settings-experiments-row"
      />
      <AboutCard />
    </ScreenScroll>
  );
}

// The build's identity, read and never pressed: the list's last card.
function AboutCard() {
  const runtimeMetadata = readAppRuntimeMetadata();
  const versionBuild = formatVersionBuild(runtimeMetadata);
  const aboutLines = [
    versionBuild ? { testID: 'settings-about-version', text: versionBuild } : null,
    runtimeMetadata.releaseCodename
      ? { testID: 'settings-about-release', text: `Release ${runtimeMetadata.releaseCodename}` }
      : null,
    runtimeMetadata.displayFlavor
      ? {
          testID: 'settings-about-flavor',
          text: `Flavor ${runtimeMetadata.displayFlavor === 'preview' ? 'Preview' : 'Local'}`,
        }
      : null,
  ].filter((line): line is { testID: string; text: string } => line !== null);

  return (
    <Card testID="settings-about-card">
      <ListRow
        accessibilityLabel={['About', ...aboutLines.map((line) => line.text)].join(', ')}
        accessible
        density="list"
        divider={false}
        leading={<Icon color={uiRoles.inkMuted} name="info" />}>
        <View style={styles.about}>
          <Text allowFontScaling={false} style={uiText.title}>About</Text>
          {aboutLines.length > 0 ? (
            aboutLines.map((line) => (
              <Text allowFontScaling={false} key={line.testID} style={[uiText.body, uiTextTone.muted]} testID={line.testID}>
                <FigureText>{line.text}</FigureText>
              </Text>
            ))
          ) : (
            <Text allowFontScaling={false} style={[uiText.body, uiTextTone.muted]}>Release information unavailable</Text>
          )}
        </View>
      </ListRow>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: uiSpace.sm,
  },
  about: {
    flex: 1,
    paddingVertical: uiSpace.sm,
  },
});
