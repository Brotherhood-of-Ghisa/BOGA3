/**
 * The one-line status under each Settings card (`components/settings/statuses.ts`):
 * pure functions over the preferences, the current body weight and the sync
 * snapshot. The screen wiring is in settings-onboarding.test.tsx.
 */

import {
  bodyweightStatus,
  effortStatus,
  progressStatus,
  restTimerStatus,
  syncStatus,
} from '@/components/settings/statuses';
import { DEFAULT_ACCOUNT_LOCAL_PREFERENCES } from '@/src/preferences/model';
import type { SyncStatusSnapshot } from '@/src/sync/sync-status';

const prefs = DEFAULT_ACCOUNT_LOCAL_PREFERENCES;

const snapshot = (overrides: Partial<SyncStatusSnapshot> = {}): SyncStatusSnapshot => ({
  lastSuccessAtMs: 1_700_000_000_000,
  dirtyCount: 0,
  errorMessage: null,
  authRequired: false,
  networkState: 'online',
  bootstrapCompleted: true,
  blockedRowCount: 0,
  ...overrides,
});

describe('restTimerStatus', () => {
  it('names the duration and whether the timer auto-starts', () => {
    expect(restTimerStatus(prefs)).toBe('90 s · Auto-start on');
    expect(restTimerStatus({ ...prefs, restTimerDurationSec: 45, restTimerAutoStart: false })).toBe(
      '45 s · Auto-start off',
    );
  });
});

describe('progressStatus', () => {
  it('names the muscle layout and the target period', () => {
    expect(progressStatus(prefs)).toBe('List · 4-week period');
    expect(progressStatus({ ...prefs, progressMuscleLayout: '3d', targetWindowWeeks: 8 })).toBe('3D · 8-week period');
  });
});

describe('effortStatus', () => {
  it('is Default for the default choices in any order', () => {
    expect(effortStatus(prefs)).toBe('Default');
    expect(
      effortStatus({
        ...prefs,
        displayEfforts: [...prefs.displayEfforts].reverse(),
        workingSetEfforts: [...prefs.workingSetEfforts].reverse(),
        volumeEfforts: [...prefs.volumeEfforts].reverse(),
      }),
    ).toBe('Default');
  });

  it.each([
    ['shown efforts', { displayEfforts: prefs.displayEfforts.slice(1) }],
    ['working-set efforts', { workingSetEfforts: prefs.workingSetEfforts.slice(1) }],
    ['volume efforts', { volumeEfforts: [...prefs.volumeEfforts.slice(1), 'warm_up' as const] }],
  ])('is Custom when the %s differ', (_label, patch) => {
    expect(effortStatus({ ...prefs, ...patch })).toBe('Custom');
  });
});

describe('bodyweightStatus', () => {
  it('names the switch and, when there is one, the current reading', () => {
    expect(bodyweightStatus(true, 82.5)).toBe('On · 82.5');
    expect(bodyweightStatus(false, 80.123456)).toBe('Off · 80.12');
    expect(bodyweightStatus(true, null)).toBe('On');
    expect(bodyweightStatus(false, null)).toBe('Off');
  });
});

describe('syncStatus', () => {
  const signedIn = { isSignedIn: true, preferenceError: null };

  it.each<[string, SyncStatusSnapshot | null, { isSignedIn: boolean; preferenceError: string | null }, string]>([
    ['a preference storage error, even signed out', null, { isSignedIn: false, preferenceError: 'disk' }, 'Error'],
    ['a preference storage error over a clean cycle', snapshot(), { isSignedIn: true, preferenceError: 'disk' }, 'Error'],
    ['signed out', snapshot(), { isSignedIn: false, preferenceError: null }, 'Signed out'],
    ['a snapshot not read yet', null, signedIn, 'Checking…'],
    ['a cycle that needs sign-in', snapshot({ authRequired: true }), signedIn, 'Error'],
    ['a failed cycle, before offline', snapshot({ errorMessage: 'boom', networkState: 'offline' }), signedIn, 'Error'],
    ['offline, before pending changes', snapshot({ networkState: 'offline', dirtyCount: 2 }), signedIn, 'Offline'],
    ['pending changes', snapshot({ dirtyCount: 7 }), signedIn, '7 pending'],
    ['no cycle yet', snapshot({ lastSuccessAtMs: null }), signedIn, 'Not synced yet'],
    ['a clean cycle', snapshot(), signedIn, 'Up to date'],
  ])('reads %s', (_label, status, context, expected) => {
    expect(syncStatus(status, context)).toBe(expected);
  });
});
