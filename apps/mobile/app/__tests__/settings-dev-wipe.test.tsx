/* eslint-disable import/first */

/**
 * The developer-only data affordances on the Settings screen, over real data:
 * the dev-mode visibility gate, the catalog reset ("Reset local data"), the
 * local wipe, and the two-step "wipe remote then wipe local" flow that keeps
 * the just-deleted server rows from being re-pushed by the next sync cycle.
 *
 * The local database is the migrated in-memory SQLite fixture
 * (helpers/local-data.ts), seeded with the `session-view` Maestro fixture, so
 * every wipe and reseed is read back from it. Replaced: the dev-mode flag, the
 * auth hook, the router, the sync-status panel (its own spec), and the remote
 * wipe RPC (the server). A failed reset and a failed remote wipe are forced
 * once with `jest.spyOn`.
 */

const mockPush = jest.fn();
const mockIsDevMode = jest.fn();
const mockUseAuth = jest.fn();
const mockAlert = jest.fn();

// Reading entry/navigation is covered by bodyweight-screen.test.tsx.
jest.mock('@/components/bodyweight/settings-row', () => ({ BodyWeightSettingsRow: () => null }));

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: mockPush }),
  // The sync-status panel uses focus to refresh; in tests run the effect once.
  useFocusEffect: (callback: () => void | (() => void)) => {
    callback();
  },
}));

jest.mock('@/src/utils/isDevMode', () => ({
  isDevMode: () => mockIsDevMode(),
}));

jest.mock('@/src/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

// The sync-status panel is exercised by its own spec; here it would pull the
// real scheduler/sync-status modules into the dev-wipe render. Stub it to a
// marker so this suite stays focused on the dev affordances.
jest.mock('@/components/sync-status/sync-status-panel', () => ({
  SyncStatusPanel: () => null,
}));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import SettingsRoute from '../(tabs)/settings';
import * as devReset from '@/src/data/dev-reset';
import * as devAffordances from '@/src/sync/dev-affordances';
import { SESSION_VIEW_FIXTURE } from '@/src/maestro/session-view-fixture';
import { bootLocalApp, closeLocalData, loadMaestroFixture, localDataClient, resetLocalData } from './helpers/local-data';

const count = (table: string, where = '1 = 1') =>
  (localDataClient().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;

const STARTER_EXERCISE = "id = 'seed_barbell_bench_press' AND deleted_at IS NULL";

type AlertButtons = { text: string; style?: string; onPress?: () => void }[];
const lastAlert = () => mockAlert.mock.calls.at(-1) as [string, string, AlertButtons];

const openSettings = async () => {
  await loadMaestroFixture('session-view');
  // A custom exercise, as a lifter would add one.
  localDataClient()
    .prepare("INSERT INTO exercise_definitions (id, name) VALUES ('custom-press', 'Custom Press')")
    .run();
  await bootLocalApp();
  render(<SettingsRoute />);
  // The preferences card reads SecureStore after mount; let it land inside act.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe('settings developer data affordances', () => {
  beforeEach(() => {
    resetLocalData();
    mockPush.mockReset();
    mockIsDevMode.mockReset().mockReturnValue(true);
    // Signed-in user so the screen renders without crashing on `user`.
    mockUseAuth.mockReset().mockReturnValue({ user: { id: 'user-1', email: 'u@test' } });
    mockAlert.mockReset();
    jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => mockAlert(...args));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    closeLocalData();
  });

  it('renders no developer tools when not in dev mode', async () => {
    mockIsDevMode.mockReturnValue(false);

    await openSettings();

    expect(screen.queryByTestId('settings-dev-tools-card')).toBeNull();
    expect(screen.queryByTestId('settings-dev-reset-button')).toBeNull();
    expect(screen.queryByTestId('settings-dev-wipe-local-button')).toBeNull();
    expect(screen.queryByTestId('settings-dev-wipe-remote-button')).toBeNull();
  });

  it('resets local data after confirmation: history and custom exercises gone, the catalog re-seeded', async () => {
    await openSettings();
    expect(count('sessions')).toBeGreaterThan(0);

    expect(screen.getByTestId('settings-dev-tools-card')).toBeTruthy();
    fireEvent.press(screen.getByTestId('settings-dev-reset-button'));

    expect(mockAlert).toHaveBeenCalledTimes(1);
    const resetButton = lastAlert()[2].find((button) => button.text === 'Reset');
    expect(resetButton).toBeDefined();
    // Nothing is wiped until the user confirms.
    expect(count('sessions')).toBeGreaterThan(0);

    await act(async () => {
      resetButton?.onPress?.();
    });

    await waitFor(() => expect(screen.getByTestId('settings-dev-reset-feedback')).toBeTruthy());
    expect(screen.getByText('Local data wiped and the exercise catalog re-seeded.')).toBeTruthy();
    expect(count('sessions')).toBe(0);
    expect(count('gyms')).toBe(0);
    expect(count('exercise_definitions', "id = 'custom-press'")).toBe(0);
    expect(count('exercise_definitions', STARTER_EXERCISE)).toBe(1);
  });

  it('surfaces a failed reset inline without crashing the screen (a failed write)', async () => {
    jest
      .spyOn(devReset, 'resetLocalDataAndReseed')
      .mockRejectedValueOnce(new Error('Cannot wipe local data right now.'));
    await openSettings();

    fireEvent.press(screen.getByTestId('settings-dev-reset-button'));
    await act(async () => {
      lastAlert()[2].find((button) => button.text === 'Reset')?.onPress?.();
    });

    expect(await screen.findByText('Cannot wipe local data right now.')).toBeTruthy();
    expect(count('sessions')).toBeGreaterThan(0);
  });

  it('wipes local data and boots a fresh database when the local button is pressed', async () => {
    await openSettings();

    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-dev-wipe-local-button'));
    });

    expect(await screen.findByTestId('settings-dev-wipe-local-feedback')).toBeTruthy();
    expect(count('sessions')).toBe(0);
    expect(count('exercise_definitions', "id = 'custom-press'")).toBe(0);
  });

  it('confirms before the remote wipe and then wipes remote AND local, in that order', async () => {
    let sessionsWhenRemoteWiped: number | null = null;
    const wipeRemote = jest
      .spyOn(devAffordances, 'wipeRemoteForCurrentUser')
      .mockImplementation(async () => {
        sessionsWhenRemoteWiped = count('sessions');
        return { rowsDeleted: 5 };
      });
    await openSettings();
    const sessionsBefore = count('sessions');

    fireEvent.press(screen.getByTestId('settings-dev-wipe-remote-button'));

    // The destructive remote wipe is gated behind a confirmation modal.
    expect(mockAlert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = lastAlert();
    expect(title).toBe('Wipe remote data?');
    expect(message).toContain('EVERY row on the server owned by your account');
    const confirmButton = buttons.find((button) => button.style === 'destructive');
    expect(confirmButton).toBeDefined();

    // Nothing runs until the user confirms.
    expect(wipeRemote).not.toHaveBeenCalled();
    expect(count('sessions')).toBe(sessionsBefore);

    await act(async () => {
      confirmButton?.onPress?.();
    });

    expect(await screen.findByText(/Deleted 5 server rows/)).toBeTruthy();
    // Remote first, while the local rows were still there; then local, so they
    // cannot re-push the deleted server rows.
    expect(sessionsWhenRemoteWiped).toBe(sessionsBefore);
    expect(count('sessions')).toBe(0);
    expect(count('sessions', `id = '${SESSION_VIEW_FIXTURE.sessionId}'`)).toBe(0);
  });

  it('does not wipe local data if the remote wipe fails (a failed server call)', async () => {
    jest.spyOn(devAffordances, 'wipeRemoteForCurrentUser').mockRejectedValueOnce(new Error('FORBIDDEN_ENV: nope'));
    await openSettings();
    const sessionsBefore = count('sessions');

    fireEvent.press(screen.getByTestId('settings-dev-wipe-remote-button'));
    await act(async () => {
      lastAlert()[2].find((button) => button.style === 'destructive')?.onPress?.();
    });

    expect(await screen.findByText('FORBIDDEN_ENV: nope')).toBeTruthy();
    expect(count('sessions')).toBe(sessionsBefore);
  });
});
