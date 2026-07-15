import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { SyncStatusPanel } from '@/components/sync-status/sync-status-panel';
import { UiButton, UiSurface, UiText, uiBorder, uiColors, uiRadius, uiSpace } from '@/components/ui';
import { useAuth } from '@/src/auth';
import { resetLocalDataAndReseed } from '@/src/data';
import {
  wipeLocalAndReBootstrap,
  wipeRemoteForCurrentUser,
} from '@/src/sync/dev-affordances';
import { useExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import { isDevMode } from '@/src/utils/isDevMode';

type DevFeedback = { tone: 'success' | 'error'; message: string } | null;

export default function SettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [listPreferences, setListPreferences] = useExerciseListPreferences();

  const [isResetting, setIsResetting] = useState(false);
  const [resetFeedback, setResetFeedback] = useState<DevFeedback>(null);

  const [isWipingLocal, setIsWipingLocal] = useState(false);
  const [wipeLocalFeedback, setWipeLocalFeedback] = useState<DevFeedback>(null);

  const [isWipingRemote, setIsWipingRemote] = useState(false);
  const [wipeRemoteFeedback, setWipeRemoteFeedback] = useState<DevFeedback>(null);

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
      <Pressable
        accessibilityHint="Opens your profile account screen"
        accessibilityLabel="Open Account Profile"
        onPress={() => router.push('/profile')}
        style={({ pressed }) => [styles.cardPressable, pressed ? styles.cardPressed : null]}
        testID="settings-profile-row">
        <UiSurface style={styles.profileCard}>
          <View style={styles.profileRow}>
            <View style={styles.iconBadge}>
              <UiText selectable={false} style={styles.iconGlyph} variant="labelStrong">
                👤
              </UiText>
            </View>
            <View style={styles.profileCopy}>
              <UiText selectable variant="labelStrong">
                Profile
              </UiText>
              <UiText selectable variant="bodyMuted">
                Sign in, review your account email, and sign out.
              </UiText>
            </View>
          </View>
        </UiSurface>
      </Pressable>

      <UiSurface style={styles.preferencesCard} testID="settings-preferences-card">
        <UiText selectable variant="labelStrong">
          Preferences
        </UiText>
        <UiText selectable variant="bodyMuted">
          Configure how dates and other details are displayed throughout BOGA.
        </UiText>
        <View style={styles.preferenceGroup}>
          <UiText selectable variant="labelStrong" style={styles.preferenceLabel}>
            Date Format
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
                  <UiText style={[styles.prefButtonText, selected && styles.prefButtonTextSelected]}>
                    {format}
                  </UiText>
                </Pressable>
              );
            })}
          </View>
        </View>
      </UiSurface>

      {user ? <SyncStatusPanel /> : null}

      {isDevMode() ? (
        <UiSurface style={styles.devCard} testID="settings-dev-tools-card">
          <UiText selectable variant="labelStrong">
            Developer tools
          </UiText>
          <UiText selectable variant="bodyMuted">
            View the in-app logs captured this session (all levels). Errors and warnings also sync
            to the backend once signed in.
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
              style={resetFeedback.tone === 'success' ? styles.devSuccessText : styles.devErrorText}
              testID="settings-dev-reset-feedback"
              variant="bodyMuted">
              {resetFeedback.message}
            </UiText>
          ) : null}

          <UiText selectable variant="bodyMuted">
            Drop the local database and re-bootstrap. Sync re-pulls your server state into a clean
            local store.
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
                wipeLocalFeedback.tone === 'success' ? styles.devSuccessText : styles.devErrorText
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
                wipeRemoteFeedback.tone === 'success' ? styles.devSuccessText : styles.devErrorText
              }
              testID="settings-dev-wipe-remote-feedback"
              variant="bodyMuted">
              {wipeRemoteFeedback.message}
            </UiText>
          ) : null}
        </UiSurface>
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
    padding: uiSpace.screen,
    gap: uiSpace.xxl,
  },
  cardPressable: {
    width: '100%',
  },
  cardPressed: {
    opacity: 0.94,
  },
  profileCard: {
    padding: uiSpace.xxl,
    gap: uiSpace.lg,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: uiSpace.lg,
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
  iconGlyph: {
    fontSize: 20,
    lineHeight: 20,
  },
  profileCopy: {
    flex: 1,
    gap: uiSpace.sm,
  },
  devCard: {
    padding: uiSpace.xxl,
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
  preferencesCard: {
    padding: uiSpace.xxl,
    gap: uiSpace.md,
  },
  preferenceGroup: {
    gap: uiSpace.sm,
    marginTop: uiSpace.sm,
  },
  preferenceLabel: {
    fontSize: 13,
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
    paddingHorizontal: uiSpace.lg,
    paddingVertical: uiSpace.sm,
  },
  prefButtonSelected: {
    backgroundColor: uiColors.actionPrimarySubtleBg,
    borderColor: uiColors.actionPrimary,
  },
  prefButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: uiColors.textPrimary,
  },
  prefButtonTextSelected: {
    color: uiColors.actionPrimary,
    fontWeight: '700',
  },
});
