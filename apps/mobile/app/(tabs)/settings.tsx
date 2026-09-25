import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { SyncStatusPanel } from '@/components/sync-status/sync-status-panel';
import { MoreHubBackButton } from '@/components/navigation/more-hub-back-button';
import {
  ActionButton,
  Card,
  Icon,
  ListRow,
  Notice,
  PageHeader,
  ScreenScroll,
  SegmentedControl,
  StatePanel,
  uiFonts,
  uiGeometry,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import { useAuth } from '@/src/auth';
import { resetLocalDataAndReseed } from '@/src/data';
import {
  wipeLocalAndReBootstrap,
  wipeRemoteForCurrentUser,
} from '@/src/sync/dev-affordances';
import { useExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import { getAgentConnectUrl } from '@/src/utils/agent-connect';
import { isDevMode } from '@/src/utils/isDevMode';
import { formatVersionBuild, readAppRuntimeMetadata } from '@/src/utils/runtime-metadata';

type DevFeedback = { tone: 'success' | 'error'; message: string } | null;

export default function SettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [listPreferences, setListPreferences] = useExerciseListPreferences();
  const [connectError, setConnectError] = useState<string | null>(null);
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
    <ScreenScroll
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      testID="settings-screen">
      <MoreHubBackButton />
      <PageHeader title="Settings" />

      <View style={styles.section} testID="settings-section-account">
        <SectionLabel title="Account" />
        <Card>
          <ListRow
            accessibilityHint="Opens your account screen"
            accessibilityLabel="Open Account"
            density="list"
            description={user?.email?.trim() || 'Sign in and manage your account.'}
            divider={false}
            label="Account"
            leading={<Icon color={uiRoles.inkMuted} name="user" />}
            onPress={() => router.push('/profile')}
            testID="settings-profile-row"
            trailing={<RowChevron />}
          />
        </Card>
      </View>

      <View style={styles.section} testID="settings-section-ai-coaching">
        <SectionLabel title="AI coaching" />
        <Text style={styles.sectionIntro}>
          Coaches get read-only training access that you can revoke at any time.
        </Text>
        <Card>
          <ListRow
            accessibilityHint="Opens setup instructions in your system browser"
            accessibilityLabel="Connect an AI coach, opens in browser"
            accessibilityRole="link"
            density="list"
            description="See setup instructions for your MCP-compatible client."
            divider={false}
            label="Connect an AI coach"
            leading={<Icon color={uiRoles.inkMuted} name="sparkles" />}
            onPress={() => {
              void handleConnectAgent();
            }}
            testID="settings-connect-agent-row"
            trailing={<RowChevron external />}
          />
          {connectError ? (
            <Text
              accessibilityLiveRegion="polite"
              style={styles.inlineError}
              testID="settings-connect-agent-error">
              {connectError}
            </Text>
          ) : null}
          {user ? (
            <ListRow
              accessibilityHint="Opens the list of authorized coaching agents"
              accessibilityLabel="Open Connected Agents"
              density="list"
              description="Review access and revoke existing connections."
              label="Connected agents"
              leading={<Icon color={uiRoles.inkMuted} name="shield-check" />}
              onPress={() => router.push('/connected-agents')}
              testID="settings-connected-agents-row"
              trailing={<RowChevron />}
            />
          ) : null}
        </Card>
      </View>

      <View style={styles.section} testID="settings-section-preferences">
        <SectionLabel title="Preferences" />
        <Card style={styles.cardBody} testID="settings-preferences-card">
          <Text style={styles.bodyMuted}>
            Configure how dates and other details are displayed throughout BoGa.
          </Text>
          <View style={styles.preference}>
            <Text style={styles.fieldLabel}>Date format</Text>
            <SegmentedControl
              accessibilityLabel="Date format"
              onChange={(format) => setListPreferences({ dateFormat: format })}
              options={DATE_FORMAT_OPTIONS}
              testIDPrefix="settings-date-format"
              value={listPreferences.dateFormat}
            />
          </View>
        </Card>
      </View>

      <View style={styles.section} testID="settings-section-data-sync">
        <SectionLabel title="Data & sync" />
        {user ? (
          <SyncStatusPanel />
        ) : (
          <Card testID="settings-sync-signed-out-card">
            <StatePanel body="Sign in through Account to sync your training data." fill={false} />
          </Card>
        )}
      </View>

      <View style={styles.section} testID="settings-section-about">
        <SectionLabel title="About" />
        <Card testID="settings-about-card">
          {aboutLines.length > 0 ? (
            aboutLines.map((line, index) => (
              <ListRow density="list" divider={index > 0} key={line.testID}>
                <Text style={styles.body} testID={line.testID}>
                  {line.text}
                </Text>
              </ListRow>
            ))
          ) : (
            <ListRow density="list" divider={false}>
              <Text style={styles.bodyMuted}>Release information unavailable</Text>
            </ListRow>
          )}
        </Card>
      </View>

      {isDevMode() ? (
        <View style={styles.section} testID="settings-section-developer-tools">
          {/* Dev-only (plan G8): a mechanical restyle. The warning is the glyph, not a hue. */}
          <Card style={styles.cardBody} testID="settings-dev-tools-card">
            <View style={styles.devHeader}>
              <Icon color={uiRoles.inkMuted} name="warning" size="sm" />
              <Text accessibilityRole="header" style={styles.microLabel}>
                Developer tools
              </Text>
            </View>

            <Text style={styles.bodyMuted}>
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

            <Text style={styles.bodyMuted}>
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

            <Text style={styles.bodyMuted}>
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

            <Text style={styles.bodyMuted}>
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
        </View>
      ) : null}
    </ScreenScroll>
  );
}

const DATE_FORMAT_OPTIONS = (['DD-MM-YYYY', 'MM-DD-YYYY', 'YYYY-MM-DD'] as const).map((format) => ({
  value: format,
  label: format,
  accessibilityLabel: `Set date format to ${format}`,
}));

// A section's name: a micro-label over its card, as on More.
function SectionLabel({ title }: { title: string }) {
  return (
    <Text accessibilityRole="header" style={styles.microLabel}>
      {title}
    </Text>
  );
}

function RowChevron({ external = false }: { external?: boolean }) {
  return <Icon color={uiRoles.inkFaint} name={external ? 'arrow-up-right' : 'chevron-right'} size="sm" />;
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
  // Sections sit a step further apart than a label and its card.
  content: {
    gap: uiSpace.xl,
  },
  section: {
    gap: uiSpace.sm,
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
  sectionIntro: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  // A card holding prose and controls rather than rows.
  cardBody: {
    padding: uiSpace.md,
    gap: uiSpace.md,
  },
  body: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  bodyMuted: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  preference: {
    gap: uiSpace.sm,
  },
  fieldLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  // Under the row it belongs to, inset to the row's text.
  inlineError: {
    paddingHorizontal: uiSpace.md,
    paddingBottom: uiSpace.md,
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.danger,
  },
  devHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
});
