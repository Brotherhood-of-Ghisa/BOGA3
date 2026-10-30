import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { SubPage } from '@/components/settings/sub-page';
import { ActionRow, FormSection, Notice, SegmentRow, SwitchRow, uiSpace } from '@/components/ui';
import { setExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import { updatePreferences, useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import {
  resetAndReseedLocalData,
  wipeLocalAndReBootstrap,
  wipeRemoteForCurrentUser,
} from '@/src/sync/dev-affordances';
import { isDevMode } from '@/src/utils/isDevMode';

const DATE_FORMAT_OPTIONS = (['DD-MM-YYYY', 'MM-DD-YYYY', 'YYYY-MM-DD'] as const).map((format) => ({
  value: format,
  label: format,
  accessibilityLabel: `Set date format to ${format}`,
}));

const PAST_RECORDS_GYM_SCOPE_OPTIONS = [
  { value: 'all' as const, label: 'All gyms', accessibilityLabel: 'Set past records gym filter to All gyms' },
  {
    value: 'current-gym' as const,
    label: 'Current gym only',
    accessibilityLabel: 'Set past records gym filter to Current gym only',
  },
];

// Settings → Everything else: what fits no other page. Display and Records
// formats, the Experiments being tried, and Developer, whose tools show in dev
// builds only.
export function EverythingElseSettingsScreen() {
  const { values, pending } = useAccountLocalPreferenceState();
  const current = { ...values, ...pending };
  return (
    <SubPage testID="settings-everything-else-screen">
      <FormSection title="Display">
        <SegmentRow
          label="Date format"
          onChange={(format) => setExerciseListPreferences({ dateFormat: format })}
          options={DATE_FORMAT_OPTIONS}
          testIDPrefix="settings-date-format"
          value={values.dateFormat}
        />
      </FormSection>
      <FormSection title="Records">
        <SegmentRow
          label="Past records gym filter"
          onChange={(scope) => setExerciseListPreferences({ pastRecordsGymScope: scope })}
          options={PAST_RECORDS_GYM_SCOPE_OPTIONS}
          testIDPrefix="settings-records-gym"
          value={values.pastRecordsGymScope}
        />
      </FormSection>
      <FormSection footnote="Off by default while we try it" title="Experiments">
        <SwitchRow
          density="list"
          label="Timer in title bar"
          onValueChange={(timerInTitleBar) => updatePreferences({ timerInTitleBar })}
          testID="settings-timer-in-title-bar"
          value={current.timerInTitleBar}
        />
      </FormSection>
      <DeveloperSection developerMode={current.developerMode} />
    </SubPage>
  );
}

type DevOutcome = { tone: 'success' | 'error'; message: string } | null;

// One dev action: `run` resolves to its success message; a failure's own message
// (or `fallback`) becomes the error outcome.
function useDevAction(run: () => Promise<string>, fallback: string) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<DevOutcome>(null);
  const start = async () => {
    setBusy(true);
    setOutcome(null);
    try {
      setOutcome({ tone: 'success', message: await run() });
    } catch (error) {
      setOutcome({ tone: 'error', message: error instanceof Error ? error.message : fallback });
    } finally {
      setBusy(false);
    }
  };
  return { busy, outcome, start };
}

const resetLocal = async () => {
  await resetAndReseedLocalData();
  return 'Local data wiped and the exercise catalog re-seeded.';
};

const wipeLocal = async () => {
  await wipeLocalAndReBootstrap();
  return 'Local database wiped and re-bootstrapped. Sync will re-pull from the server.';
};

// Delete every server row owned by this account, then wipe local so the
// just-deleted rows are not re-pushed by the next sync cycle.
const wipeRemote = async () => {
  const { rowsDeleted } = await wipeRemoteForCurrentUser();
  await wipeLocalAndReBootstrap();
  return `Deleted ${rowsDeleted} server ${rowsDeleted === 1 ? 'row' : 'rows'} and wiped local data.`;
};

const confirm = (title: string, message: string, action: string, onConfirm: () => void) =>
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: action, style: 'destructive', onPress: onConfirm },
  ]);

// Developer mode in every build; the data tools in dev builds only, each
// outcome a `Notice` under the section.
function DeveloperSection({ developerMode }: { developerMode: boolean }) {
  const router = useRouter();
  const reset = useDevAction(resetLocal, 'Unknown error during dev reset.');
  const local = useDevAction(wipeLocal, 'Unknown error during local wipe.');
  const remote = useDevAction(wipeRemote, 'Unknown error during remote wipe.');
  const dev = isDevMode();
  return (
    <>
      <FormSection
        footnote={dev ? 'Wiping local data re-pulls from the server on the next sync' : undefined}
        title="Developer">
        <SwitchRow
          density="list"
          label="Developer mode"
          onValueChange={(next) => updatePreferences({ developerMode: next })}
          testID="settings-developer-mode-switch"
          value={developerMode}
        />
        {dev ? (
          <>
            <ActionRow
              divider
              kind="navigate"
              label="View logs"
              onPress={() => router.push('/dev-logs')}
              testID="settings-dev-logs-button"
            />
            <ActionRow
              disabled={reset.busy}
              divider
              kind="act"
              label={reset.busy ? 'Resetting…' : 'Reset local data'}
              onPress={() =>
                confirm(
                  'Reset local data?',
                  'Wipes every local table and re-seeds the exercise catalog; the next sync restores the rest from the server. Server data is untouched. Dev builds only.',
                  'Reset',
                  () => void reset.start(),
                )
              }
              testID="settings-dev-reset-button"
            />
            <ActionRow
              disabled={local.busy}
              divider
              kind="act"
              label={local.busy ? 'Wiping…' : 'Wipe local'}
              onPress={() => void local.start()}
              testID="settings-dev-wipe-local-button"
            />
            <ActionRow
              disabled={remote.busy}
              divider
              kind="danger"
              label={remote.busy ? 'Wiping…' : 'Wipe remote'}
              onPress={() =>
                confirm(
                  'Wipe remote data?',
                  'This deletes EVERY row on the server owned by your account. Are you sure?',
                  'Delete server data',
                  () => void remote.start(),
                )
              }
              testID="settings-dev-wipe-remote-button"
            />
          </>
        ) : null}
      </FormSection>
      {dev ? (
        <View style={styles.outcomes}>
          <DevOutcomeNotice outcome={reset.outcome} testID="settings-dev-reset-feedback" />
          <DevOutcomeNotice outcome={local.outcome} testID="settings-dev-wipe-local-feedback" />
          <DevOutcomeNotice outcome={remote.outcome} testID="settings-dev-wipe-remote-feedback" />
        </View>
      ) : null}
    </>
  );
}

// A dev action's outcome: words plus a glyph, `danger` only when it failed (G3).
function DevOutcomeNotice({ outcome, testID }: { outcome: DevOutcome; testID: string }) {
  if (!outcome) return null;
  return outcome.tone === 'success' ? (
    <Notice icon="success" live message={outcome.message} testID={testID} />
  ) : (
    <Notice icon="warning" live message={outcome.message} testID={testID} tone="danger" />
  );
}

const styles = StyleSheet.create({
  outcomes: {
    gap: uiSpace.sm,
  },
});
