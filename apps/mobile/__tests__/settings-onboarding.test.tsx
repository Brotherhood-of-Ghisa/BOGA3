/* eslint-disable import/first */

/**
 * The Settings home: its sections and rows in order, the page each row pushes,
 * the value at each row's end, release metadata and the signed-out state.
 * Nothing here reads or writes app data; the screen runs over the in-memory
 * SQLite fixture (helpers/local-data.ts) with its real preferences store.
 * Replaced: the router, the auth hook, dev mode, build metadata, the sync
 * status read and the native navigation focus lifecycle. Connecting an AI
 * coach lives on More (more-screen.test.tsx), not here.
 */

const mockPush = jest.fn();
const mockUseAuth = jest.fn();
const mockGetSyncStatus = jest.fn();

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- resolve after mock hoisting.
  const { useEffect } = require('react');
  return {
  useFocusEffect: (callback: () => void | (() => void)) => useEffect(callback, [callback]),
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: mockPush }),
  };
});

jest.mock('@/src/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

jest.mock('@/src/sync/sync-status', () => ({
  getSyncStatus: () => mockGetSyncStatus(),
}));

jest.mock('@/src/utils/isDevMode', () => ({
  isDevMode: () => true,
}));

jest.mock('@/src/utils/runtime-metadata', () => ({
  readAppRuntimeMetadata: () => ({
    buildNumber: '45',
    displayFlavor: 'preview',
    releaseCodename: 'Ziocleziano',
    version: '1.2.3',
  }),
}));

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import SettingsRoute from '../app/settings';
import { DataSyncSettingsScreen } from '@/components/settings/sub-pages';
import {
  __resetExerciseListPreferencesForTests,
  ensureExerciseListPreferencesLoaded,
} from '@/src/exercise-catalog/list-preferences';
import { updatePreferences } from '@/src/preferences/hooks';
import type { SyncStatusSnapshot } from '@/src/sync/sync-status';
import { closeLocalData, resetLocalData } from './helpers/local-data';

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

// The preferences store is read on mount; load it first so the read lands in
// the test.
const renderSettings = async () => {
  await ensureExerciseListPreferencesLoaded();
  const result = render(<SettingsRoute />);
  // The sync status and bodyweight reads resolve after mount; land them in act.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return result;
};

const statusOf = (testID: string) => screen.getByTestId(testID).props.accessibilityLabel as string;

const SECTIONS = ['Account', 'Training', 'App', 'About'];

const ROW_ORDER = [
  'settings-profile-row',
  'settings-rest-timer-row',
  'settings-body-weight-row',
  'settings-muscles-row',
  'settings-effort-row',
  'settings-progress-row',
  'settings-appearance-row',
  'settings-notifications-row',
  'settings-data-sync-row',
  'settings-everything-else-row',
  'settings-about-version',
  'settings-about-release',
  'settings-about-flavor',
];

describe('the Settings home', () => {
  afterEach(() => {
    closeLocalData();
  });

  beforeEach(() => {
    resetLocalData();
    __resetExerciseListPreferencesForTests();
    mockPush.mockReset();
    mockGetSyncStatus.mockReset().mockResolvedValue(snapshot());
    mockUseAuth.mockReset().mockReturnValue({
      user: { email: 'member@example.test', id: 'user-1' },
    });
  });

  it('groups the rows into Account, Training, App and About, in the agreed order, under the native header', async () => {
    const result = await renderSettings();
    const tree = JSON.stringify(result.toJSON());
    const rowAt = ROW_ORDER.map((id) => tree.indexOf(`"testID":"${id}"`));

    // The root stack's native header titles the page; the list draws no title.
    expect(screen.queryByText('Settings')).toBeNull();
    expect(screen.getAllByRole('header').map((header) => header.props.children)).toEqual(SECTIONS);
    expect(rowAt.every((at) => at >= 0)).toBe(true);
    expect([...rowAt].sort((a, b) => a - b)).toEqual(rowAt);
    expect(screen.getByText('member@example.test')).toBeTruthy();
    // The three retired destinations have no row; Everything else replaces them.
    ['settings-other-row', 'settings-experiments-row', 'settings-developer-tools-row'].forEach((id) =>
      expect(screen.queryByTestId(id)).toBeNull());
    // Connecting an AI coach moved to More.
    expect(screen.queryByTestId('settings-connect-agent-row')).toBeNull();
    expect(screen.queryByTestId('settings-connected-agents-row')).toBeNull();
    await waitFor(() => expect(statusOf('settings-data-sync-row')).toBe('Data & sync, Up to date'));
  });

  it('reads the version, release and flavor as About rows', async () => {
    await renderSettings();
    const about = within(screen.getByTestId('settings-about-card'));
    expect(about.getByText('About')).toBeTruthy();
    expect(statusOf('settings-about-version')).toBe('Version: 1.2.3 (build 45)');
    expect(statusOf('settings-about-release')).toBe('Release: Ziocleziano');
    expect(statusOf('settings-about-flavor')).toBe('Flavor: Preview');
  });

  it.each([
    ['settings-profile-row', '/profile'],
    ['settings-body-weight-row', '/body-weight'],
    ['settings-rest-timer-row', '/settings-rest-timer'],
    ['settings-progress-row', '/settings-progress'],
    ['settings-muscles-row', '/settings-muscles'],
    ['settings-effort-row', '/settings-effort'],
    ['settings-data-sync-row', '/settings-data-sync'],
    ['settings-everything-else-row', '/settings-everything-else'],
  ])('%s opens %s', async (testID, route) => {
    await renderSettings();
    fireEvent.press(screen.getByTestId(testID));
    expect(mockPush).toHaveBeenCalledWith(route);
  });

  it('presses nothing from the About rows', async () => {
    await renderSettings();
    ['settings-about-version', 'settings-about-release', 'settings-about-flavor'].forEach((id) =>
      fireEvent.press(screen.getByTestId(id)));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('summarises what each page has set at the end of its row', async () => {
    await renderSettings();

    expect(statusOf('settings-rest-timer-row')).toBe('Rest timer, 90 s · Auto-start on');
    expect(statusOf('settings-progress-row')).toBe('Progress, List · 4-week period');
    expect(statusOf('settings-muscles-row')).toBe('Muscles, Single target');
    expect(statusOf('settings-effort-row')).toBe('Effort, Default');
    expect(statusOf('settings-everything-else-row')).toBe('Everything else, DD-MM-YYYY');

    await waitFor(() => {
      updatePreferences({
        restTimerDurationSec: 120,
        restTimerAutoStart: false,
        progressMuscleLayout: '3d',
        targetWindowWeeks: 6,
        displayEfforts: ['rir_0'],
        dateFormat: 'YYYY-MM-DD',
      });
      expect(statusOf('settings-rest-timer-row')).toBe('Rest timer, 120 s · Auto-start off');
    });
    expect(statusOf('settings-progress-row')).toBe('Progress, 3D · 6-week period');
    expect(statusOf('settings-effort-row')).toBe('Effort, Custom');
    expect(statusOf('settings-everything-else-row')).toBe('Everything else, YYYY-MM-DD');
  });

  it('keeps the Developer mode switch off the home', async () => {
    await renderSettings();
    expect(screen.queryByTestId('settings-developer-mode-switch')).toBeNull();
  });

  it.each<[string, Partial<SyncStatusSnapshot>, string]>([
    ['an error from the latest cycle', { errorMessage: 'boom' }, 'Error'],
    ['a sign-in the cycle needs', { authRequired: true }, 'Error'],
    ['no network', { networkState: 'offline', dirtyCount: 3 }, 'Offline'],
    ['unpushed changes', { dirtyCount: 3 }, '3 pending'],
    ['no cycle yet', { lastSuccessAtMs: null }, 'Not synced yet'],
  ])('reads Data & sync status for %s', async (_case, overrides, status) => {
    mockGetSyncStatus.mockResolvedValue(snapshot(overrides));
    await renderSettings();
    await waitFor(() => expect(statusOf('settings-data-sync-row')).toBe(`Data & sync, ${status}`));
  });

  it('shows the signed-out home and sync guidance', async () => {
    mockUseAuth.mockReturnValue({ user: null });
    await renderSettings();

    expect(statusOf('settings-profile-row')).toBe('Account, Signed out');
    expect(statusOf('settings-data-sync-row')).toBe('Data & sync, Signed out');
    expect(statusOf('settings-notifications-row')).toBe('Notifications, Sign in');
    expect(mockGetSyncStatus).not.toHaveBeenCalled();
    expect(screen.queryByText('Sign in and manage your account.')).toBeNull();
    expect(screen.queryByTestId('settings-connect-agent-row')).toBeNull();
    screen.unmount();

    render(<DataSyncSettingsScreen />);
    expect(screen.getByTestId('settings-sync-signed-out-card')).toBeTruthy();
  });
});
