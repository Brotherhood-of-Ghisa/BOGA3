import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { SyncStatusPanel } from '@/components/sync-status/sync-status-panel';
import { MoreHubBackButton } from '@/components/navigation/more-hub-back-button';
import { Icon, UiButton, UiSurface, UiText, uiBorder, uiColors, uiRadius, uiSpace, uiTypography } from '@/components/ui';
import { useAuth } from '@/src/auth';
import { resetLocalDataAndReseed } from '@/src/data';
import {
  wipeLocalAndReBootstrap,
  wipeRemoteForCurrentUser,
} from '@/src/sync/dev-affordances';
import { useExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import { useNewScreensEnabled } from '@/src/session-recorder/new-screens-preference';
import { getAgentConnectUrl } from '@/src/utils/agent-connect';
import { isDevMode } from '@/src/utils/isDevMode';
import { formatVersionBuild, readAppRuntimeMetadata } from '@/src/utils/runtime-metadata';

type DevFeedback = { tone: 'success' | 'error'; message: string } | null;

export default function SettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [listPreferences, setListPreferences] = useExerciseListPreferences();
  const [newScreensEnabled, setNewScreensEnabled] = useNewScreensEnabled();
  const [connectError, setConnectError] = useState<string | null>(null);
  const runtimeMetadata = readAppRuntimeMetadata();
  const versionBuild = formatVersionBuild(runtimeMetadata);

  const [isResetting, setIsResetting] = useState(false);
  const [resetFeedback, setResetFeedback] = useState<DevFeedback>(null);

  const [isWipingLocal, setIsWipingLocal] = useState(false);
  const [wipeLocalFeedback, setWipeLocalFeedback] = useState<DevFeedback>(null);

  const [isWipingRemote, setIsWipingRemote] = useState(false);
  const [wipeRemoteFeedback, setWipeRemoteFeedback] = useState<DevFeedback>(null);

  const handleConnectAgent = async () => {
    setConnectError(null);
    try {
      await Linking.openURL(getAgentConnectUrl());
    } catch {
      setConnectError('Couldn’t open the setup page. Try again.');
    }
  };

  const handleDevReset = async () => {
    setIsResetting(true);
    setResetFeedback(null);
    try {
      await resetLocalDataAndReseed();
      setResetFeedback({
        tone: 'success',
        message: 'Local data wiped and the exercise catalog re-seeded.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error during dev reset.';
      setResetFeedback({ tone: 'error', message });
    } finally {
      setIsResetting(false);
    }
  };

  const confirmDevReset = () => {
    Alert.alert(
      'Reset local data?',
      'Wipes every local table and re-seeds the exercise catalog. Server data is untouched. Dev builds only.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            void handleDevReset();
          },
        },
      ]
    );
  };

  const handleWipeLocal = async () => {
    setIsWipingLocal(true);
    setWipeLocalFeedback(null);
    try {
      await wipeLocalAndReBootstrap();
      setWipeLocalFeedback({
        tone: 'success',
        message: 'Local database wiped and re-bootstrapped. Sync will re-pull from the server.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error during local wipe.';
      setWipeLocalFeedback({ tone: 'error', message });
    } finally {
      setIsWipingLocal(false);
    }
  };

  // Delete every server row owned by this account, then wipe local so the
  // just-deleted rows are not re-pushed by the next sync cycle.
  const handleWipeRemote = async () => {
    setIsWipingRemote(true);
    setWipeRemoteFeedback(null);
    try {
      const { rowsDeleted } = await wipeRemoteForCurrentUser();
      await wipeLocalAndReBootstrap();
      setWipeRemoteFeedback({
        tone: 'success',
        message: `Deleted ${rowsDeleted} server ${
          rowsDeleted === 1 ? 'row' : 'rows'
        } and wiped local data.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error during remote wipe.';
      setWipeRemoteFeedback({ tone: 'error', message });
    } finally {
      setIsWipingRemote(false);
    }
  };

  const confirmWipeRemote = () => {
    Alert.alert(
      'Wipe remote data?',
      'This deletes EVERY row on the server owned by your account. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete server data',
          style: 'destructive',
          onPress: () => {
            void handleWipeRemote();
          },
        },
      ]
    );
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={styles.screen}
      testID="settings-screen">
      <MoreHubBackButton />
      <UiText accessibilityRole="header" selectable style={styles.screenTitle} variant="title">
        Settings
      </UiText>

      <View style={styles.section} testID="settings-section-account">
        <UiText accessibilityRole="header" selectable variant="title">
          Account
        </UiText>
        <Pressable
          accessibilityHint="Opens your account screen"
          accessibilityLabel="Open Account"
          accessibilityRole="button"
          onPress={() => router.push('/profile')}
          style={({ pressed }) => [styles.cardPressable, pressed ? styles.cardPressed : null]}
          testID="settings-profile-row">
          <UiSurface style={styles.destinationCard}>
            <View style={styles.destinationRow}>
              <View style={styles.iconBadge}>
                <Icon color={uiColors.actionPrimary} name="user" />
              </View>
              <View style={styles.destinationCopy}>
                <UiText selectable variant="labelStrong">
                  Account
                </UiText>
                <UiText selectable variant="bodyMuted">
                  {user?.email?.trim() || 'Sign in and manage your account.'}
                </UiText>
              </View>
            </View>
          </UiSurface>
        </Pressable>
      </View>

      <View style={styles.section} testID="settings-section-ai-coaching">
        <UiText accessibilityRole="header" selectable variant="title">
          AI coaching
        </UiText>
        <UiText selectable variant="bodyMuted">
          Coaches get read-only training access that you can revoke at any time.
        </UiText>
        <Pressable
          accessibilityHint="Opens setup instructions in your system browser"
          accessibilityLabel="Connect an AI coach, opens in browser"
          accessibilityRole="link"
          onPress={() => {
            void handleConnectAgent();
          }}
          style={({ pressed }) => [styles.cardPressable, pressed ? styles.cardPressed : null]}
          testID="settings-connect-agent-row">
          <UiSurface style={styles.destinationCard}>
            <View style={styles.destinationRow}>
              <View style={styles.iconBadge}>
                <Icon color={uiColors.actionPrimary} name="sparkles" />
              </View>
              <View style={styles.destinationCopy}>
                <UiText selectable variant="labelStrong">
                  Connect an AI coach
                </UiText>
                <UiText selectable variant="bodyMuted">
                  See setup instructions for your MCP-compatible client.
                </UiText>
              </View>
              <Icon
                color={uiColors.textSecondary}
                name="arrow-up-right"
                style={styles.externalIndicator}
              />
            </View>
          </UiSurface>
        </Pressable>
        {connectError ? (
          <UiText
            accessibilityLiveRegion="polite"
            selectable
            style={styles.inlineErrorText}
            testID="settings-connect-agent-error"
            variant="bodyMuted">
            {connectError}
          </UiText>
        ) : null}

        {user ? (
          <Pressable
            accessibilityHint="Opens the list of authorized coaching agents"
            accessibilityLabel="Open Connected Agents"
            accessibilityRole="button"
            onPress={() => router.push('/connected-agents')}
            style={({ pressed }) => [styles.cardPressable, pressed ? styles.cardPressed : null]}
            testID="settings-connected-agents-row">
            <UiSurface style={styles.destinationCard}>
              <View style={styles.destinationRow}>
                <View style={styles.iconBadge}>
                  <Icon color={uiColors.actionPrimary} name="shield-check" />
                </View>
                <View style={styles.destinationCopy}>
                  <UiText selectable variant="labelStrong">
                    Connected agents
                  </UiText>
                  <UiText selectable variant="bodyMuted">
                    Review access and revoke existing connections.
                  </UiText>
                </View>
              </View>
            </UiSurface>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.section} testID="settings-section-preferences">
        <UiText accessibilityRole="header" selectable variant="title">
          Preferences
        </UiText>
        <UiSurface style={styles.preferencesCard} testID="settings-preferences-card">
          <UiText selectable variant="bodyMuted">
            Configure how BoGa displays dates and which screens you use.
          </UiText>
          <View style={styles.preferenceGroup}>
            <UiText selectable variant="labelStrong" style={styles.preferenceLabel}>
              Date format
            </UiText>
            <View style={styles.preferenceRow}>
              {(['DD-MM-YYYY', 'MM-DD-YYYY', 'YYYY-MM-DD'] as const).map((format) => {
                const selected = listPreferences.dateFormat === format;
                return (
                  <Pressable
                    key={format}
                    accessibilityLabel={`Set date format to ${format}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={[styles.prefButton, selected && styles.prefButtonSelected]}
                    onPress={() => setListPreferences({ dateFormat: format })}
                    testID={`settings-date-format-${format}`}>
                    <UiText
                      style={[styles.prefButtonText, selected && styles.prefButtonTextSelected]}>
                      {format}
                    </UiText>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={styles.preferenceGroup} testID="settings-new-screens-group">
            <UiText selectable variant="labelStrong" style={styles.preferenceLabel}>
              New exercise &amp; session screens
            </UiText>
            <UiText selectable variant="bodyMuted">
              Try the redesigned exercise page and session view while they’re being built.
              Switch back any time.
            </UiText>
            <View style={styles.preferenceRow}>
              {([false, true] as const).map((enabled) => {
                const selected = newScreensEnabled === enabled;
                const label = enabled ? 'On' : 'Off';
                return (
                  <Pressable
                    key={label}
                    accessibilityLabel={`Turn new exercise and session screens ${label.toLowerCase()}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={[styles.prefButton, selected && styles.prefButtonSelected]}
                    onPress={() => setNewScreensEnabled(enabled)}
                    testID={`settings-new-screens-${label.toLowerCase()}`}>
                    <UiText
                      style={[styles.prefButtonText, selected && styles.prefButtonTextSelected]}>
                      {label}
                    </UiText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </UiSurface>
      </View>

      <View style={styles.section} testID="settings-section-data-sync">
        <UiText accessibilityRole="header" selectable variant="title">
          Data &amp; sync
        </UiText>
        {user ? (
          <SyncStatusPanel />
        ) : (
          <UiSurface style={styles.quietCard} testID="settings-sync-signed-out-card">
            <UiText selectable variant="bodyMuted">
              Sign in through Account to sync your training data.
            </UiText>
          </UiSurface>
        )}
      </View>

      <View style={styles.section} testID="settings-section-about">
        <UiText accessibilityRole="header" selectable variant="title">
          About
        </UiText>
        <UiSurface style={styles.aboutCard} testID="settings-about-card">
          {versionBuild ? (
            <UiText selectable testID="settings-about-version" variant="bodyMuted">
              {versionBuild}
            </UiText>
          ) : null}
          {runtimeMetadata.releaseCodename ? (
            <UiText selectable testID="settings-about-release" variant="bodyMuted">
              Release {runtimeMetadata.releaseCodename}
            </UiText>
          ) : null}
          {runtimeMetadata.displayFlavor ? (
            <UiText selectable testID="settings-about-flavor" variant="bodyMuted">
              Flavor {runtimeMetadata.displayFlavor === 'preview' ? 'Preview' : 'Local'}
            </UiText>
          ) : null}
          {!versionBuild && !runtimeMetadata.releaseCodename && !runtimeMetadata.displayFlavor ? (
            <UiText selectable variant="bodyMuted">
              Release information unavailable
            </UiText>
          ) : null}
        </UiSurface>
      </View>

      {isDevMode() ? (
        <View style={styles.section} testID="settings-section-developer-tools">
          <UiText accessibilityRole="header" selectable variant="title">
            Developer tools
          </UiText>
          <UiSurface style={styles.devCard} testID="settings-dev-tools-card">
            <UiText selectable variant="bodyMuted">
              View the in-app logs captured this session (all levels). Errors and warnings also
              sync to the backend once signed in.
            </UiText>
            <UiButton
              accessibilityLabel="Open the in-app log viewer"
              label="View logs"
              onPress={() => router.push('/dev-logs')}
              testID="settings-dev-logs-button"
              variant="secondary"
            />

            <UiText selectable variant="bodyMuted">
              Wipe every local table and re-run the exercise catalog seeder. Available only in
              development builds — does nothing in release.
            </UiText>
            <UiButton
              accessibilityLabel="Reset local data and re-seed exercise catalog"
              disabled={isResetting}
              label={isResetting ? 'Resetting…' : 'Reset local data and re-seed'}
              onPress={confirmDevReset}
              testID="settings-dev-reset-button"
              variant="secondary"
            />
            {resetFeedback ? (
              <UiText
                selectable
                style={
                  resetFeedback.tone === 'success' ? styles.devSuccessText : styles.devErrorText
                }
                testID="settings-dev-reset-feedback"
                variant="bodyMuted">
                {resetFeedback.message}
              </UiText>
            ) : null}

            <UiText selectable variant="bodyMuted">
              Drop the local database and re-bootstrap. Sync re-pulls your server state into a
              clean local store.
            </UiText>
            <UiButton
              accessibilityLabel="Wipe local database and re-bootstrap"
              disabled={isWipingLocal}
              label={isWipingLocal ? 'Wiping…' : 'Wipe local & re-bootstrap'}
              onPress={() => {
                void handleWipeLocal();
              }}
              testID="settings-dev-wipe-local-button"
              variant="secondary"
            />
            {wipeLocalFeedback ? (
              <UiText
                selectable
                style={
                  wipeLocalFeedback.tone === 'success'
                    ? styles.devSuccessText
                    : styles.devErrorText
                }
                testID="settings-dev-wipe-local-feedback"
                variant="bodyMuted">
                {wipeLocalFeedback.message}
              </UiText>
            ) : null}

            <UiText selectable variant="bodyMuted">
              Delete every row on the server owned by your account, then wipe local. Useful for
              testing the bootstrap flow against an empty server.
            </UiText>
            <UiButton
              accessibilityLabel="Wipe remote data owned by my account"
              disabled={isWipingRemote}
              label={isWipingRemote ? 'Wiping…' : 'Wipe remote (my data)'}
              onPress={confirmWipeRemote}
              testID="settings-dev-wipe-remote-button"
              variant="danger"
            />
            {wipeRemoteFeedback ? (
              <UiText
                selectable
                style={
                  wipeRemoteFeedback.tone === 'success'
                    ? styles.devSuccessText
                    : styles.devErrorText
                }
                testID="settings-dev-wipe-remote-feedback"
                variant="bodyMuted">
                {wipeRemoteFeedback.message}
              </UiText>
            ) : null}
          </UiSurface>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: uiColors.surfacePage,
  },
  content: {
    padding: uiSpace.xl,
    gap: uiSpace.lg,
  },
  screenTitle: {
    fontSize: uiTypography.size.xxl,
    lineHeight: 30,
  },
  section: {
    gap: uiSpace.md,
  },
  cardPressable: {
    width: '100%',
  },
  cardPressed: {
    opacity: 0.94,
  },
  destinationCard: {
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
  destinationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: uiSpace.md,
  },
  externalIndicator: {
    alignSelf: 'center',
  },
  iconBadge: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: uiBorder.width,
    borderColor: uiColors.actionPrimarySubtleBorder,
    borderRadius: uiRadius.full,
    backgroundColor: uiColors.surfaceInfo,
  },
  destinationCopy: {
    flex: 1,
    gap: uiSpace.sm,
  },
  devCard: {
    padding: uiSpace.lg,
    gap: uiSpace.md,
    borderColor: uiColors.borderWarning,
    backgroundColor: uiColors.surfaceWarning,
  },
  devSuccessText: {
    color: uiColors.textAccentMuted,
  },
  devErrorText: {
    color: uiColors.actionDangerText,
  },
  inlineErrorText: {
    color: uiColors.actionDangerText,
  },
  preferencesCard: {
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
  preferenceGroup: {
    gap: uiSpace.sm,
    marginTop: uiSpace.sm,
  },
  preferenceLabel: {
    fontSize: uiTypography.size.md,
  },
  preferenceRow: {
    flexDirection: 'row',
    gap: uiSpace.sm,
    flexWrap: 'wrap',
  },
  prefButton: {
    borderRadius: uiRadius.md,
    borderWidth: uiBorder.width,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
  },
  prefButtonSelected: {
    backgroundColor: uiColors.actionPrimarySubtleBg,
    borderColor: uiColors.actionPrimary,
  },
  prefButtonText: {
    fontSize: uiTypography.size.sm,
    fontWeight: '600',
    color: uiColors.textPrimary,
  },
  prefButtonTextSelected: {
    color: uiColors.actionPrimary,
    fontWeight: '700',
  },
  quietCard: {
    padding: uiSpace.lg,
  },
  aboutCard: {
    padding: uiSpace.lg,
    gap: uiSpace.sm,
    backgroundColor: uiColors.surfaceMuted,
  },
});
