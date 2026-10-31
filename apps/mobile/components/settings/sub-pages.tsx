import { BackupPanel } from '@/components/settings/backup-panel';
import { EffortSettings } from '@/components/preferences/effort-settings';
import { ProgressSettings } from '@/components/preferences/progress-settings';
import { RestTimerSettings } from '@/components/preferences/rest-timer-settings';
import { SubPage } from '@/components/settings/sub-page';
import { SyncStatusPanel } from '@/components/sync-status/sync-status-panel';
import { useAuth } from '@/src/auth';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';

// Settings' sub pages, each pushed over the tabs with a native header that
// carries its title. Each holds what its Settings row summarises.

export function RestTimerSettingsScreen() {
  const preferences = useAccountLocalPreferenceState();
  return (
    <SubPage testID="settings-rest-timer-screen">
      <RestTimerSettings state={preferences} />
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
      <EffortSettings values={{ ...values, ...pending }} />
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
