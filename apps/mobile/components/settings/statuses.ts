import {
  DEFAULT_DISPLAY_EFFORTS,
  DEFAULT_PERSONAL_EFFORT_POLICY,
  type EffortChoice,
} from '@/src/exercise-calculations/effort-policy';
import type { AccountLocalPreferences } from '@/src/preferences/model';
import type { SyncStatusSnapshot } from '@/src/sync/sync-status';

// The value at the end of each Settings home row: what is set now, in the
// words its page uses.

export const restTimerStatus = (values: AccountLocalPreferences): string =>
  `${values.restTimerDurationSec} s · Auto-start ${values.restTimerAutoStart ? 'on' : 'off'}`;

export const progressStatus = (values: AccountLocalPreferences): string =>
  `${values.progressMuscleLayout === '3d' ? '3D' : 'List'} · ${values.targetWindowWeeks}-week period`;

const sameChoices = (a: readonly EffortChoice[], b: readonly EffortChoice[]) =>
  a.length === b.length && a.every((choice) => b.includes(choice));

export const effortStatus = (values: AccountLocalPreferences): string =>
  sameChoices(values.displayEfforts, DEFAULT_DISPLAY_EFFORTS) &&
  sameChoices(values.workingSetEfforts, DEFAULT_PERSONAL_EFFORT_POLICY.workingSetEfforts) &&
  sameChoices(values.volumeEfforts, DEFAULT_PERSONAL_EFFORT_POLICY.volumeEfforts)
    ? 'Default'
    : 'Custom';

export const bodyweightStatus = (enabled: boolean, currentKg: number | null): string =>
  [enabled ? 'On' : 'Off', currentKg === null ? null : String(Math.round(currentKg * 100) / 100)]
    .filter(Boolean)
    .join(' · ');

/**
 * Data & sync's status: an error first (preference storage or the latest
 * cycle), then offline, then unpushed changes, else up to date. `null` status
 * is a snapshot not read yet.
 */
export const syncStatus = (
  status: SyncStatusSnapshot | null,
  { isSignedIn, preferenceError }: { isSignedIn: boolean; preferenceError: string | null },
): string => {
  if (preferenceError) return 'Error';
  if (!isSignedIn) return 'Signed out';
  if (status === null) return 'Checking…';
  if (status.authRequired || status.errorMessage !== null) return 'Error';
  if (status.networkState === 'offline') return 'Offline';
  if (status.dirtyCount > 0) return `${status.dirtyCount} pending`;
  return status.lastSuccessAtMs === null ? 'Not synced yet' : 'Up to date';
};
