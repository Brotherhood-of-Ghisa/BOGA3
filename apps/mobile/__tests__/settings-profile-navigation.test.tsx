/* eslint-disable import/first */

/**
 * Settings and Profile navigation, preferences and account flows. The data
 * these screens own is not local: the profile (`@/src/auth/profile`) and the
 * auth session are server reads and writes, faked here at that boundary as
 * the groups suites fake theirs. The local database is the in-memory SQLite
 * fixture (helpers/local-data.ts), and preferences use their real store.
 */

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockSearchParams: Record<string, string> = {};
const mockUseAuth = jest.fn();
const mockLoadUserProfile = jest.fn();
const mockSaveUsername = jest.fn();
const mockAlert = jest.fn();

// Reading entry/navigation is covered by bodyweight-screen.test.tsx.
jest.mock('@/components/bodyweight/settings-row', () => ({ BodyWeightSettingsRow: () => null }));

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- resolve after mock hoisting.
  const { useEffect } = require('react');
  return {
  useFocusEffect: (callback: () => void | (() => void)) => useEffect(callback, [callback]),
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
  };
});

jest.mock('@/src/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/src/auth/profile', () => ({
  loadUserProfile: (...args: unknown[]) => mockLoadUserProfile(...args),
  saveUsername: (...args: unknown[]) => mockSaveUsername(...args),
}));

// The local database is the in-memory SQLite fixture; the dev reset that
// writes to it is covered over real data in settings-dev-wipe.test.tsx.
jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { Storage } from 'expo-sqlite/kv-store';

import {
  __resetExerciseListPreferencesForTests,
  ensureExerciseListPreferencesLoaded,
  getExerciseListPreferencesSnapshot,
} from '@/src/exercise-catalog/list-preferences';
import * as syncStatusSource from '@/src/sync/sync-status';
import ProfileRoute from '../app/profile';
import { closeLocalData, resetLocalData } from './helpers/local-data';
import SettingsRoute from '../app/(tabs)/settings';

type MockUseAuthValue = {
  clearAuthError: jest.Mock;
  disabledReason: string | null;
  isConfigured: boolean;
  lastError: string | null;
  session: null;
  signInWithPassword: jest.Mock;
  signOut: jest.Mock;
  status: 'idle' | 'restoring' | 'ready';
  updateUserEmail: jest.Mock;
  updateUserPassword: jest.Mock;
  user: { email?: string | null; id: string } | null;
};

const createAuthValue = (overrides: Partial<MockUseAuthValue> = {}): MockUseAuthValue => ({
  clearAuthError: jest.fn(),
  disabledReason: null,
  isConfigured: true,
  lastError: null,
  session: null,
  signInWithPassword: jest.fn().mockResolvedValue({}),
  signOut: jest.fn().mockResolvedValue(undefined),
  status: 'ready',
  updateUserEmail: jest.fn().mockResolvedValue({
    emailChangePending: false,
    user: {
      id: 'user-1',
      email: 'member@example.test',
    },
  }),
  updateUserPassword: jest.fn().mockResolvedValue({
    user: {
      id: 'user-1',
      email: 'member@example.test',
    },
  }),
  user: null,
  ...overrides,
});

const createProfileRecord = (overrides: Partial<{ createdAt: string; id: string; updatedAt: string; username: string | null }> = {}) => ({
  createdAt: '2026-03-04T12:00:00.000Z',
  id: 'user-1',
  updatedAt: '2026-03-04T12:05:00.000Z',
  username: 'member-lifter',
  ...overrides,
});

describe('settings and profile routes', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    closeLocalData();
  });

  beforeEach(() => {
    resetLocalData();
    mockPush.mockReset();
    mockReplace.mockReset();
    mockSearchParams = {};
    // Default to a signed-out-but-ready auth snapshot so the Settings screen can
    // read `user` without crashing; profile tests override the return value.
    mockUseAuth.mockReset().mockReturnValue(createAuthValue());
    mockLoadUserProfile.mockReset();
    mockSaveUsername.mockReset();
    mockAlert.mockReset();
    __resetExerciseListPreferencesForTests();
    jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => mockAlert(...args));
  });

  it('opens the profile route from settings', async () => {
    // The preferences card reads its store on mount; load it first so the read lands in the test.
    await ensureExerciseListPreferencesLoaded();
    render(<SettingsRoute />);

    fireEvent.press(screen.getByTestId('settings-profile-row'));

    expect(mockPush).toHaveBeenCalledWith('/profile');
  });

  it('returns explicitly to More when settings was launched from the hub', async () => {
    mockSearchParams = { source: 'more' };
    // The preferences card reads its store on mount; load it first so the read lands in the test.
    await ensureExerciseListPreferencesLoaded();
    render(<SettingsRoute />);

    fireEvent.press(screen.getByTestId('back-to-more-button'));

    expect(mockReplace).toHaveBeenCalledWith('/more');
  });

  it('opens Connected agents for a signed-in user', async () => {
    mockUseAuth.mockReturnValue(
      createAuthValue({
        user: { email: 'member@example.test', id: 'user-1' },
      }),
    );
    // The preferences card reads its store on mount; load it first so the read lands in the test.
    await ensureExerciseListPreferencesLoaded();
    render(<SettingsRoute />);

    fireEvent.press(screen.getByTestId('settings-connected-agents-row'));

    expect(mockPush).toHaveBeenCalledWith('/connected-agents');
  });

  it('reports a failed date-format save only under Data & Sync and retries it through Refresh', async () => {
    await ensureExerciseListPreferencesLoaded();
    render(<SettingsRoute />);
    const save = jest.spyOn(Storage, 'setItemSync').mockImplementationOnce(() => { throw Error('disk full'); });
    fireEvent.press(screen.getByTestId('settings-date-format-YYYY-MM-DD'));
    const error = /Preferences could not be saved\./;
    expect(within(screen.getByTestId('settings-section-data-sync')).getByTestId('settings-sync-status-error'))
      .toHaveTextContent(error);
    expect(within(screen.getByTestId('settings-preferences-card')).queryByText(error)).toBeNull();
    expect(screen.queryByTestId('preferences-error')).toBeNull();
    expect(screen.queryByText('Retry')).toBeNull();
    expect(getExerciseListPreferencesSnapshot().dateFormat).toBe('DD-MM-YYYY');
    fireEvent.press(screen.getByTestId('settings-sync-status-refresh-button'));
    await waitFor(() => expect(getExerciseListPreferencesSnapshot().dateFormat).toBe('YYYY-MM-DD'));
    expect(screen.queryByTestId('settings-sync-status-error')).toBeNull();
    save.mockRestore();
  });

  it('clears account status on switching users and discards a delayed previous-account read', async () => {
    await ensureExerciseListPreferencesLoaded();
    const status = { lastSuccessAtMs: null, dirtyCount: 4, errorMessage: 'Account A error',
      authRequired: false, networkState: 'online' as const, bootstrapCompleted: true, blockedRowCount: 0 };
    let finishAccountBRead!: (value: typeof status) => void;
    const accountBRead = new Promise<typeof status>(resolve => { finishAccountBRead = resolve; });
    jest.spyOn(syncStatusSource, 'getSyncStatus').mockResolvedValueOnce(status)
      .mockReturnValueOnce(accountBRead).mockResolvedValue({ ...status, dirtyCount: 1, errorMessage: 'Account C error' });
    const switchAccount = (id: string) => mockUseAuth.mockReturnValue(createAuthValue({ user: { id } }));
    switchAccount('account-a');
    const { rerender } = render(<SettingsRoute />);
    await waitFor(() => expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent('Account A error'));
    switchAccount('account-b');
    rerender(<SettingsRoute />);
    expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent('None');
    expect(screen.getByTestId('settings-sync-status-dirty-count')).toHaveTextContent('0');
    switchAccount('account-c');
    rerender(<SettingsRoute />);
    await waitFor(() => expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent('Account C error'));
    await act(async () => { finishAccountBRead({ ...status, dirtyCount: 8, errorMessage: 'Account B error' }); });
    expect(screen.getByTestId('settings-sync-status-error')).toHaveTextContent('Account C error');
    expect(screen.getByTestId('settings-sync-status-dirty-count')).toHaveTextContent('1');
  });

  it('renders the Preferences card and allows changing the date format setting', async () => {
    await ensureExerciseListPreferencesLoaded();

    render(<SettingsRoute />);

    expect(screen.getByTestId('settings-preferences-card')).toBeTruthy();
    expect(screen.getByTestId('settings-date-format-DD-MM-YYYY')).toBeTruthy();
    expect(screen.getByTestId('settings-date-format-MM-DD-YYYY')).toBeTruthy();
    expect(screen.getByTestId('settings-date-format-YYYY-MM-DD')).toBeTruthy();
    expect(getExerciseListPreferencesSnapshot().dateFormat).toBe('DD-MM-YYYY');

    act(() => {
      fireEvent.press(screen.getByTestId('settings-date-format-YYYY-MM-DD'));
    });

    expect(getExerciseListPreferencesSnapshot().dateFormat).toBe('YYYY-MM-DD');

    expect(screen.getByTestId('settings-records-gym-all')).toBeTruthy();
    expect(screen.getByTestId('settings-records-gym-current-gym')).toBeTruthy();
    expect(getExerciseListPreferencesSnapshot().pastRecordsGymScope).toBe('all');

    act(() => {
      fireEvent.press(screen.getByTestId('settings-records-gym-current-gym'));
    });

    expect(getExerciseListPreferencesSnapshot().pastRecordsGymScope).toBe('current-gym');

    act(() => {
      fireEvent.press(screen.getByTestId('settings-records-gym-all'));
    });

    expect(getExerciseListPreferencesSnapshot().pastRecordsGymScope).toBe('all');
  });

  it('renders logged-out profile state and submits email/password sign in', async () => {
    const authValue = createAuthValue();
    mockUseAuth.mockReturnValue(authValue);

    render(<ProfileRoute />);
    expect(
      screen.queryByText(
        'Use your provisioned email and password to unlock account management without affecting local-only tracker flows.'
      )
    ).toBeNull();

    fireEvent.changeText(screen.getByTestId('profile-email-input'), ' user@example.test ');
    fireEvent.changeText(screen.getByTestId('profile-password-input'), 'secret-pass');
    fireEvent.press(screen.getByTestId('profile-sign-in-button'));

    await waitFor(() => {
      expect(authValue.signInWithPassword).toHaveBeenCalledWith({
        email: 'user@example.test',
        password: 'secret-pass',
      });
    });
    expect(screen.getByTestId('profile-signed-out-card')).toBeTruthy();
  });

  it('blocks sign in when the email address is not valid', () => {
    const authValue = createAuthValue();
    mockUseAuth.mockReturnValue(authValue);

    render(<ProfileRoute />);

    fireEvent.changeText(screen.getByTestId('profile-email-input'), 'not-an-email');
    fireEvent.changeText(screen.getByTestId('profile-password-input'), 'secret-pass');
    fireEvent.press(screen.getByTestId('profile-sign-in-button'));

    expect(authValue.signInWithPassword).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
  });

  it('surfaces inline auth failure feedback near the sign-in form and clears stale errors on input', () => {
    const authValue = createAuthValue({
      lastError: 'Invalid login credentials',
    });
    mockUseAuth.mockReturnValue(authValue);

    render(<ProfileRoute />);

    expect(screen.getByTestId('profile-inline-error')).toBeTruthy();
    expect(screen.getByText('Invalid login credentials')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('profile-email-input'), 'next@example.test');

    expect(authValue.clearAuthError).toHaveBeenCalledTimes(1);
  });

  it('shows submit-time sign-in failures inline without leaving the logged-out state', async () => {
    const authValue = createAuthValue({
      signInWithPassword: jest.fn().mockRejectedValue(new Error('Invalid login credentials')),
    });
    mockUseAuth.mockReturnValue(authValue);

    render(<ProfileRoute />);

    fireEvent.changeText(screen.getByTestId('profile-email-input'), 'user@example.test');
    fireEvent.changeText(screen.getByTestId('profile-password-input'), 'WrongPassword!999');
    fireEvent.press(screen.getByTestId('profile-sign-in-button'));

    await waitFor(() => {
      expect(screen.getByText('Invalid login credentials')).toBeTruthy();
    });
    expect(screen.getByTestId('profile-signed-out-card')).toBeTruthy();
  });

  it('renders logged-in profile state in view mode with edit and sign-out actions', async () => {
    const authValue = createAuthValue({
      user: {
        id: 'user-1',
        email: 'member@example.test',
      },
    });
    mockLoadUserProfile.mockResolvedValue({
      profile: createProfileRecord(),
      wasProvisioned: false,
    });
    mockUseAuth.mockReturnValue(authValue);

    render(<ProfileRoute />);

    await waitFor(() => {
      expect(mockLoadUserProfile).toHaveBeenCalledWith('user-1');
    });
    // The loaded username renders after the profile-load promise resolves, a
    // tick past the call asserted above. Wait for it before the synchronous
    // checks so they do not race the post-load render.
    await screen.findByText('member-lifter');
    expect(screen.getByTestId('profile-signed-in-card')).toBeTruthy();
    expect(screen.getByText('member@example.test')).toBeTruthy();
    expect(screen.getByText('member-lifter')).toBeTruthy();
    expect(screen.queryByTestId('profile-sync-card')).toBeNull();
    expect(screen.getByTestId('profile-edit-button')).toBeTruthy();
    expect(screen.getByTestId('profile-sign-out-button')).toBeTruthy();
    expect(screen.queryByTestId('profile-update-button')).toBeNull();
    expect(screen.queryByTestId('profile-username-input')).toBeNull();
    expect(screen.queryByText('Account')).toBeNull();
    expect(
      screen.queryByText(
        'Manage your app username plus authenticated email/password updates without affecting local-only tracker flows.'
      )
    ).toBeNull();

    fireEvent.press(screen.getByTestId('profile-sign-out-button'));

    await waitFor(() => {
      expect(authValue.signOut).toHaveBeenCalledTimes(1);
    });
  });

  it('updates username from edit mode with the single update action', async () => {
    const authValue = createAuthValue({
      user: {
        id: 'user-1',
        email: 'member@example.test',
      },
    });
    mockLoadUserProfile.mockResolvedValue({
      profile: createProfileRecord({
        username: 'old-name',
      }),
      wasProvisioned: false,
    });
    mockSaveUsername.mockResolvedValue(
      createProfileRecord({
        updatedAt: '2026-03-04T12:10:00.000Z',
        username: 'new-name',
      })
    );
    mockUseAuth.mockReturnValue(authValue);

    render(<ProfileRoute />);

    await waitFor(() => {
      expect(screen.getByText('old-name')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('profile-edit-button'));
    expect(screen.getByTestId('profile-cancel-edit-button')).toBeTruthy();
    expect(screen.getByTestId('profile-update-button')).toBeTruthy();
    expect(screen.queryByTestId('profile-sign-out-button')).toBeNull();
    expect(screen.queryByTestId('profile-edit-button')).toBeNull();
    fireEvent.changeText(screen.getByTestId('profile-username-input'), ' new-name ');
    fireEvent.press(screen.getByTestId('profile-update-button'));

    await waitFor(() => {
      expect(mockSaveUsername).toHaveBeenCalledWith('user-1', ' new-name ');
    });
    // The success feedback and the exit from edit mode both land after the save
    // promise resolves, a tick after the call above. Wait for the message to
    // render before asserting, then confirm the update control is gone.
    expect(await screen.findByText('Profile updated.')).toBeTruthy();
    expect(screen.queryByTestId('profile-update-button')).toBeNull();
  });

  it('shows inline username update failures while keeping the signed-in shell active', async () => {
    const authValue = createAuthValue({
      user: {
        id: 'user-1',
        email: 'member@example.test',
      },
    });
    mockLoadUserProfile.mockResolvedValue({
      profile: createProfileRecord({
        username: 'old-name',
      }),
      wasProvisioned: false,
    });
    mockSaveUsername.mockRejectedValue(new Error('Unable to save username right now.'));
    mockUseAuth.mockReturnValue(authValue);

    render(<ProfileRoute />);

    await waitFor(() => {
      expect(screen.getByText('old-name')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('profile-edit-button'));
    fireEvent.changeText(screen.getByTestId('profile-username-input'), 'new-name');
    fireEvent.press(screen.getByTestId('profile-update-button'));

    await waitFor(() => {
      expect(screen.getByText('Unable to save username right now.')).toBeTruthy();
    });
    expect(screen.getByTestId('profile-signed-in-card')).toBeTruthy();
    expect(screen.getByTestId('profile-update-button')).toBeTruthy();
  });

  it('shows inline profile load failures without dropping the signed-in account shell', async () => {
    const authValue = createAuthValue({
      user: {
        id: 'user-1',
        email: 'member@example.test',
      },
    });
    mockLoadUserProfile.mockRejectedValue(new Error('Unable to load profile right now.'));
    mockUseAuth.mockReturnValue(authValue);

    render(<ProfileRoute />);

    await waitFor(() => {
      expect(screen.getByText('Unable to load profile right now.')).toBeTruthy();
    });
    expect(screen.getByTestId('profile-signed-in-card')).toBeTruthy();
    expect(screen.getByText('member@example.test')).toBeTruthy();
  });

  it('submits authenticated email updates from edit mode and distinguishes pending confirmation messaging', async () => {
    const authValue = createAuthValue({
      updateUserEmail: jest.fn().mockResolvedValue({
        emailChangePending: true,
        user: {
          id: 'user-1',
          email: 'member@example.test',
          new_email: 'next@example.test',
        },
      }),
      user: {
        id: 'user-1',
        email: 'member@example.test',
      },
    });
    mockLoadUserProfile.mockResolvedValue({
      profile: createProfileRecord(),
      wasProvisioned: false,
    });
    mockUseAuth.mockReturnValue(authValue);

    render(<ProfileRoute />);

    await waitFor(() => {
      expect(screen.getByText('member-lifter')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('profile-edit-button'));
    fireEvent.changeText(screen.getByTestId('profile-email-update-input'), ' next@example.test ');
    fireEvent.press(screen.getByTestId('profile-update-button'));

    await waitFor(() => {
      expect(authValue.updateUserEmail).toHaveBeenCalledWith({
        email: 'next@example.test',
      });
    });
    // The success message mounts only after the submit promise resolves and the
    // resulting state update flushes, which trails the call above by a tick.
    // findBy* retries until the element renders, so the assertion stays
    // deterministic even when the render lags under load.
    expect(
      await screen.findByText(
        'Email change submitted. Confirm the change from your email inbox before it fully takes effect.'
      )
    ).toBeTruthy();
  });

  it('blocks profile updates when the edited email is invalid', async () => {
    const authValue = createAuthValue({
      user: {
        id: 'user-1',
        email: 'member@example.test',
      },
    });
    mockLoadUserProfile.mockResolvedValue({
      profile: createProfileRecord(),
      wasProvisioned: false,
    });
    mockUseAuth.mockReturnValue(authValue);

    render(<ProfileRoute />);

    await waitFor(() => {
      expect(screen.getByText('member-lifter')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('profile-edit-button'));
    fireEvent.changeText(screen.getByTestId('profile-email-update-input'), 'not-an-email');
    fireEvent.press(screen.getByTestId('profile-update-button'));

    expect(authValue.updateUserEmail).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
  });

  it('submits password updates from edit mode, clears the field, and shows success feedback', async () => {
    const authValue = createAuthValue({
      user: {
        id: 'user-1',
        email: 'member@example.test',
      },
    });
    mockLoadUserProfile.mockResolvedValue({
      profile: createProfileRecord(),
      wasProvisioned: false,
    });
    mockUseAuth.mockReturnValue(authValue);

    render(<ProfileRoute />);

    await waitFor(() => {
      expect(screen.getByText('member-lifter')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('profile-edit-button'));
    fireEvent.changeText(screen.getByTestId('profile-password-update-input'), 'StrongPassword!234');
    fireEvent.press(screen.getByTestId('profile-update-button'));

    await waitFor(() => {
      expect(authValue.updateUserPassword).toHaveBeenCalledWith({
        password: 'StrongPassword!234',
      });
    });
    // Success feedback and the return to view mode flush after the update
    // promise resolves, a tick past the call above. Wait for the message to
    // render before asserting the edit field has been torn down.
    expect(await screen.findByText('Profile updated.')).toBeTruthy();
    expect(screen.queryByTestId('profile-password-update-input')).toBeNull();
  });

  it('shows inline update failures and still clears the password field after submit', async () => {
    const authValue = createAuthValue({
      updateUserPassword: jest.fn().mockRejectedValue(new Error('Unable to update password right now.')),
      user: {
        id: 'user-1',
        email: 'member@example.test',
      },
    });
    mockLoadUserProfile.mockResolvedValue({
      profile: createProfileRecord(),
      wasProvisioned: false,
    });
    mockUseAuth.mockReturnValue(authValue);

    render(<ProfileRoute />);

    await waitFor(() => {
      expect(screen.getByText('member-lifter')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('profile-edit-button'));
    fireEvent.changeText(screen.getByTestId('profile-password-update-input'), 'StrongPassword!234');
    fireEvent.press(screen.getByTestId('profile-update-button'));

    await waitFor(() => {
      expect(screen.getByText('Unable to update password right now.')).toBeTruthy();
    });
    // The field clears in the same submit cycle that surfaces the failure; wait
    // for the cleared value so the assertion does not race the render flush.
    await waitFor(() => {
      expect(screen.getByTestId('profile-password-update-input').props.value).toBe('');
    });
  });
});
