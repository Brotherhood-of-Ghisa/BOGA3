import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';

import { SettingsCard } from '@/components/settings/settings-card';
import {
  ActionButton,
  Card,
  Icon,
  Notice,
  ScreenScroll,
  uiFonts,
  uiGeometry,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import {
  resetAndReseedLocalData,
  wipeLocalAndReBootstrap,
  wipeRemoteForCurrentUser,
} from '@/src/sync/dev-affordances';
import { updatePreferences, useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import { isDevMode } from '@/src/utils/isDevMode';

type DevFeedback = { tone: 'success' | 'error'; message: string } | null;

// Settings → Developer tools: the Developer mode switch in every build, then
// the data tools in dev builds only.
export function DeveloperToolsScreen() {
  const { values, pending } = useAccountLocalPreferenceState();
  const developerMode = pending.developerMode ?? values.developerMode;
  return (
    <ScreenScroll
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      testID="settings-developer-tools-screen">
      <SettingsCard
        control={
          <Switch
            accessibilityLabel="Developer mode"
            onValueChange={(next) => updatePreferences({ developerMode: next })}
            testID="settings-developer-mode-switch"
            trackColor={{ false: uiRoles.rule, true: uiRoles.accent }}
            value={developerMode}
          />
        }
        icon="code"
        label="Developer mode"
        testID="settings-developer-mode-row"
      />
      {isDevMode() ? <DeveloperTools /> : null}
    </ScreenScroll>
  );
}

function DeveloperTools() {
  const router = useRouter();
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
      await resetAndReseedLocalData();
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
      'Wipes every local table and re-seeds the exercise catalog; the next sync restores the rest from the server. Server data is untouched. Dev builds only.',
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
    <Card style={styles.cardBody} testID="settings-dev-tools-card">
      <View style={styles.devHeader}>
        <Icon color={uiRoles.inkMuted} name="warning" size="sm" />
        <Text allowFontScaling={false} accessibilityRole="header" style={styles.microLabel}>
          Developer tools
        </Text>
      </View>

      <Text allowFontScaling={false} style={styles.bodyMuted}>
        View the in-app logs captured this session (all levels). Errors and warnings also
        sync to the backend once signed in.
      </Text>
      <ActionButton
        accessibilityLabel="Open the in-app log viewer"
        label="View logs"
        onPress={() => router.push('/dev-logs')}
        testID="settings-dev-logs-button"
        variant="outline"
      />

      <Text allowFontScaling={false} style={styles.bodyMuted}>
        Wipe every local table and re-run the exercise catalog seeder. Available only in
        development builds — does nothing in release.
      </Text>
      <ActionButton
        accessibilityLabel="Reset local data and re-seed exercise catalog"
        disabled={isResetting}
        label={isResetting ? 'Resetting…' : 'Reset local data and re-seed'}
        onPress={confirmDevReset}
        testID="settings-dev-reset-button"
        variant="outline"
      />
      <DevFeedbackNotice feedback={resetFeedback} testID="settings-dev-reset-feedback" />

      <Text allowFontScaling={false} style={styles.bodyMuted}>
        Drop the local database and re-bootstrap. Sync re-pulls your server state into a
        clean local store.
      </Text>
      <ActionButton
        accessibilityLabel="Wipe local database and re-bootstrap"
        disabled={isWipingLocal}
        label={isWipingLocal ? 'Wiping…' : 'Wipe local & re-bootstrap'}
        onPress={() => {
          void handleWipeLocal();
        }}
        testID="settings-dev-wipe-local-button"
        variant="outline"
      />
      <DevFeedbackNotice feedback={wipeLocalFeedback} testID="settings-dev-wipe-local-feedback" />

      <Text allowFontScaling={false} style={styles.bodyMuted}>
        Delete every row on the server owned by your account, then wipe local. Useful for
        testing the bootstrap flow against an empty server.
      </Text>
      <ActionButton
        accessibilityLabel="Wipe remote data owned by my account"
        disabled={isWipingRemote}
        label={isWipingRemote ? 'Wiping…' : 'Wipe remote (my data)'}
        onPress={confirmWipeRemote}
        testID="settings-dev-wipe-remote-button"
        tone="danger"
        variant="outline"
      />
      <DevFeedbackNotice feedback={wipeRemoteFeedback} testID="settings-dev-wipe-remote-feedback" />
    </Card>
  );
}

// A dev action's outcome: words plus a glyph, `danger` only when it failed (G3).
function DevFeedbackNotice({ feedback, testID }: { feedback: DevFeedback; testID: string }) {
  if (!feedback) {
    return null;
  }
  return feedback.tone === 'success' ? (
    <Notice icon="success" live message={feedback.message} testID={testID} />
  ) : (
    <Notice icon="warning" live message={feedback.message} testID={testID} tone="danger" />
  );
}

const styles = StyleSheet.create({
  content: {
    gap: uiSpace.md,
  },
  cardBody: {
    padding: uiSpace.md,
    gap: uiSpace.md,
  },
  microLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
  },
  bodyMuted: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  devHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
});
