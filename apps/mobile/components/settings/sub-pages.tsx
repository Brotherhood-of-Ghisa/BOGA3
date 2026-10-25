import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BackupPanel } from '@/components/settings/backup-panel';
import { EffortSettings } from '@/components/preferences/effort-settings';
import { ProgressSettings } from '@/components/preferences/progress-settings';
import { RestTimerSettings } from '@/components/preferences/rest-timer-settings';
import { SyncStatusPanel } from '@/components/sync-status/sync-status-panel';
import {
  Card,
  ScreenScroll,
  SegmentedControl,
  SwitchRow,
  uiFonts,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import { useAuth } from '@/src/auth';
import { setExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import { useAccountLocalPreferenceState, updatePreferences } from '@/src/preferences/hooks';

// Settings' sub pages, each pushed over the tabs with a native header that
// carries its title. Each holds what its Settings card summarises.

export function RestTimerSettingsScreen() {
  const preferences = useAccountLocalPreferenceState();
  return (
    <SubPage testID="settings-rest-timer-screen">
      <Card style={styles.cardBody}>
        <RestTimerSettings state={preferences} />
      </Card>
    </SubPage>
  );
}

export function ProgressSettingsScreen() {
  const { user } = useAuth();
  const preferences = useAccountLocalPreferenceState();
  return (
    <SubPage testID="settings-progress-screen">
      <ProgressSettings key={user ? `account:${user.id}` : 'local'} state={preferences} />
    </SubPage>
  );
}

export function EffortSettingsScreen() {
  const { values, pending } = useAccountLocalPreferenceState();
  return (
    <SubPage testID="settings-effort-screen">
      <Card style={styles.cardBody}>
        <EffortSettings values={{ ...values, ...pending }} />
      </Card>
    </SubPage>
  );
}

export function OtherSettingsScreen() {
  const { values } = useAccountLocalPreferenceState();
  return (
    <SubPage testID="settings-other-screen">
      <Card style={styles.cardBody} testID="settings-preferences-card">
        <View style={styles.preference}>
          <Text allowFontScaling={false} style={styles.fieldLabel}>Date format</Text>
          <SegmentedControl
            accessibilityLabel="Date format"
            onChange={(format) => setExerciseListPreferences({ dateFormat: format })}
            options={DATE_FORMAT_OPTIONS}
            testIDPrefix="settings-date-format"
            value={values.dateFormat}
          />
        </View>
        <View style={styles.preference}>
          <Text allowFontScaling={false} style={styles.fieldLabel}>Past records gym filter</Text>
          <SegmentedControl
            accessibilityLabel="Past records gym filter"
            onChange={(scope) => setExerciseListPreferences({ pastRecordsGymScope: scope })}
            options={PAST_RECORDS_GYM_SCOPE_OPTIONS}
            testIDPrefix="settings-records-gym"
            value={values.pastRecordsGymScope}
          />
        </View>
      </Card>
    </SubPage>
  );
}

// Features being tried out, each off by default.
export function ExperimentsSettingsScreen() {
  const { values, pending } = useAccountLocalPreferenceState();
  const current = { ...values, ...pending };
  return (
    <SubPage testID="settings-experiments-screen">
      {/* List keeps Today one scrolling page; Cards gives Progress and the
          group a full-height card each, swiped between. */}
      <Card style={styles.cardBody}>
        <View style={styles.preference}>
          <Text allowFontScaling={false} style={styles.fieldLabel}>Today layout</Text>
          <SegmentedControl
            accessibilityLabel="Today layout"
            onChange={(todayLayout) => updatePreferences({ todayLayout })}
            options={TODAY_LAYOUT_OPTIONS}
            testIDPrefix="settings-today-layout"
            value={current.todayLayout}
          />
        </View>
      </Card>
      <Card>
        <SwitchRow
          label="Timer in title bar"
          onValueChange={(timerInTitleBar) => updatePreferences({ timerInTitleBar })}
          testID="settings-timer-in-title-bar"
          value={current.timerInTitleBar}
        />
      </Card>
    </SubPage>
  );
}

export function DataSyncSettingsScreen() {
  const { user } = useAuth();
  const { error, retry } = useAccountLocalPreferenceState();
  return (
    <SubPage testID="settings-data-sync-screen">
      <SyncStatusPanel
        key={user ? `account:${user.id}` : 'local'}
        isSignedIn={Boolean(user)}
        onRefreshPreferences={retry}
        preferenceError={error}
      />
      <BackupPanel />
    </SubPage>
  );
}

function SubPage({ children, testID }: { children: ReactNode; testID: string }) {
  return (
    <ScreenScroll
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      testID={testID}>
      {children}
    </ScreenScroll>
  );
}

const DATE_FORMAT_OPTIONS = (['DD-MM-YYYY', 'MM-DD-YYYY', 'YYYY-MM-DD'] as const).map((format) => ({
  value: format,
  label: format,
  accessibilityLabel: `Set date format to ${format}`,
}));

const TODAY_LAYOUT_OPTIONS = [
  { value: 'list' as const, label: 'List', accessibilityLabel: 'Show Today as a list' },
  { value: 'cards' as const, label: 'Cards', accessibilityLabel: 'Show Today as cards' },
];

const PAST_RECORDS_GYM_SCOPE_OPTIONS = [
  {
    value: 'all' as const,
    label: 'All gyms',
    accessibilityLabel: 'Set past records gym filter to All gyms',
  },
  {
    value: 'current-gym' as const,
    label: 'Current gym only',
    accessibilityLabel: 'Set past records gym filter to Current gym only',
  },
];

const styles = StyleSheet.create({
  content: {
    gap: uiSpace.md,
  },
  // A card holding controls rather than rows.
  cardBody: {
    padding: uiSpace.md,
    gap: uiSpace.md,
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
});
