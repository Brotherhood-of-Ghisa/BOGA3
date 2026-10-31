/* eslint-disable import/first */

// The production controls, lifecycle store and RPC decoder run together. Only
// the native adapter and remote transport are replaced; no UI state is faked.
jest.mock('@/src/notifications/native-adapter', () => {
  let adapter: unknown = { supported: false };
  return {
    getNotificationNativeAdapter: () => adapter,
    __setNotificationNativeAdapterForTests: (next: unknown) => { adapter = next; },
    setAppliedNotificationTheme: jest.fn(),
  };
});
const mockRpc = jest.fn();
jest.mock('@/src/auth/supabase', () => ({
  getMobileAuthRuntimeConfig: () => ({ isConfigured: false }),
  getRequiredSupabaseMobileClient: () => ({ schema: () => ({ rpc: (...args: unknown[]) => mockRpc(...args) }) }),
}));
const mockPush = jest.fn();
let mockUserId: string | null = '11111111-1111-4111-8111-111111111111';
jest.mock('expo-router', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- resolve after mock hoisting.
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback]),
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => ({}),
}));
jest.mock('@/src/auth', () => ({ useAuth: () => ({ user: mockUserId ? { id: mockUserId } : null }) }));
jest.mock('@/components/bodyweight/settings-row', () => ({ BodyWeightSettingsRow: () => null }));
jest.mock('@/components/sync-status/use-sync-status', () => ({ useSyncStatusSnapshot: () => null }));
jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- shared native database boundary.
  require('./helpers/local-data').localDataBootstrapModule());

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { GroupNotificationMuteRow } from '@/components/notifications/group-mute-row';
import { NotificationSettingsScreen } from '@/components/notifications/notification-settings-screen';
import { NotificationSettingsRow } from '@/components/notifications/settings-row';
import { __resetNotificationsForTests, refreshNotificationStatus, startNotificationLifecycle } from '@/src/notifications';
import { setNotificationAccount } from '@/src/notifications/auth-boundary';
import { __setNotificationNativeAdapterForTests } from '@/src/notifications/native-adapter';
import type { NotificationNativeAdapter, NotificationPreferences } from '@/src/notifications/types';
import { uiFonts, uiTypography } from '@/components/ui/tokens';
import { SIGN_IN_ROUTE } from '@/src/navigation/routes';
import { ensurePreferencesLoaded } from '@/src/preferences/hooks';
import SettingsNotificationsRoute from '../app/settings-notifications';
import { closeLocalData, resetLocalData } from './helpers/local-data';
import { fakeNotificationNative } from './helpers/notification-native';
import { waitForGone } from './helpers/wait-for-gone';

const USER = '11111111-1111-4111-8111-111111111111';
const GROUP = '22222222-2222-4222-8222-222222222222';
const BINDING = '33333333-3333-4333-8333-333333333333';
let native: NotificationNativeAdapter;
let preferences: NotificationPreferences;
let failRpc: { name: string; message: string; status: number } | null;

const response = (data: unknown, error: { message: string } | null = null, status = 200) => {
  const result = Promise.resolve(data).then(value => ({ data: value, error, status }));
  const request = { abortSignal: () => request, setHeader: () => request, then: result.then.bind(result) };
  return request;
};

beforeEach(async () => {
  mockUserId = USER;
  preferences = { activity: true, bests: true, ranks: true, muted: false };
  failRpc = null;
  mockPush.mockReset();
  native = fakeNotificationNative();
  (native.getPermission as jest.Mock).mockResolvedValue('undetermined');
  __setNotificationNativeAdapterForTests(native);
  __resetNotificationsForTests();
  mockRpc.mockReset().mockImplementation((name: string, args: Record<string, unknown>) => {
    if (failRpc?.name === name) {
      const failure = failRpc;
      failRpc = null;
      return response(null, { message: failure.message }, failure.status);
    }
    switch (name) {
      case 'notification_preferences_get': return response({ ...preferences });
      case 'notification_preferences_set':
        preferences = { ...preferences, activity: args.p_activity as boolean, bests: args.p_bests as boolean, ranks: args.p_ranks as boolean };
        return response({ ...preferences });
      case 'notification_group_mute':
        preferences = { ...preferences, muted: args.p_muted as boolean };
        return response({ ...preferences });
      case 'notification_register': return response({ binding_id: BINDING, permission: true, opted_in: true, payload_version: 1 });
      case 'notification_unregister': return response({ ok: true });
      default: throw new Error(`Unexpected notification RPC: ${name}`);
    }
  });
  setNotificationAccount({ userId: USER, authSessionId: 'auth-session' }, 'test-bearer-a');
  await refreshNotificationStatus();
});

afterEach(() => { cleanup(); __resetNotificationsForTests(); closeLocalData(); });

const status = (text: string) => screen.getByLabelText(`Notifications, ${text}`);
const toggle = () => screen.getByTestId('settings-notifications-enabled');
const category = (key: string) => screen.getByTestId(`settings-notifications-${key}`);
const retryButton = () => screen.getByRole('button', { name: 'Retry' });

// The page, once the status refresh on open has settled.
const openPage = async (userId: string | null = USER) => {
  render(<NotificationSettingsScreen userId={userId} />);
  if (userId) await waitFor(() => expect(status('Not enabled')).toBeTruthy());
};

// Switches on and waits for the Categories, which show only while on.
const switchOn = async () => {
  fireEvent.press(toggle());
  await waitFor(() => expect(category('activity')).toBeEnabled());
};

it('names the state on Settings home and pushes the Notifications page', () => {
  render(<NotificationSettingsRow userId={USER} />);
  fireEvent.press(screen.getByLabelText('Notifications, Not enabled'));
  expect(mockPush).toHaveBeenCalledWith('/settings-notifications');
});

it('asks permission only after the switch is turned on, then can switch it off', async () => {
  await openPage();
  expect(native.requestPermission).not.toHaveBeenCalled();
  expect(toggle().props.accessibilityState.checked).toBe(false);
  // Categories show only while on.
  expect(screen.queryByText('Categories')).toBeNull();

  await switchOn();
  await waitFor(() => expect(status('On')).toBeTruthy());
  expect(native.requestPermission).toHaveBeenCalledTimes(1);
  expect(native.readBinding()?.userId).toBe(USER);
  expect(screen.getByText('Categories')).toHaveStyle({ fontFamily: uiFonts.display.family, fontSize: uiTypography.size.xxs, textTransform: 'uppercase' });
  for (const key of ['activity', 'bests', 'ranks']) expect(category(key).props.accessibilityState.checked).toBe(true);
  // No primary or outline button remains on the page.
  expect(screen.queryByRole('button')).toBeNull();

  fireEvent.press(toggle());
  await waitFor(() => expect(status('Not enabled')).toBeTruthy());
  expect(native.readBinding()).toBeNull();
  expect(screen.queryByText('Categories')).toBeNull();
});

it('never shows the switch on before permission resolves', async () => {
  let answer!: (permission: 'granted') => void;
  (native.requestPermission as jest.Mock).mockReturnValue(new Promise(resolve => { answer = resolve; }));
  await openPage();

  fireEvent.press(toggle());

  await waitFor(() => expect(toggle()).toBeDisabled());
  expect(toggle().props.accessibilityState.checked).toBe(false);
  expect(status('Not enabled')).toBeTruthy();
  await act(async () => { answer('granted'); });
  await waitFor(() => expect(status('On')).toBeTruthy());
  expect(toggle().props.accessibilityState.checked).toBe(true);
});

it('turns the switch into Open iOS Settings when permission is refused, and reports an unsuccessful handoff', async () => {
  (native.getPermission as jest.Mock).mockResolvedValue('denied');
  await refreshNotificationStatus();
  render(<NotificationSettingsScreen userId={USER} />);
  // The status refresh on open must not land after the failure below.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const open = screen.getByTestId('settings-notifications-open-settings');
  expect(screen.getByText('Open iOS Settings')).toBeTruthy();
  expect(screen.queryByTestId('settings-notifications-enabled')).toBeNull();
  expect(screen.queryByText('Categories')).toBeNull();
  (native.openSettings as jest.Mock).mockRejectedValueOnce(new Error('native failure'));
  fireEvent.press(open);
  expect(await screen.findByTestId('settings-notifications-error')).toBeTruthy();
  expect(native.requestPermission).not.toHaveBeenCalled();
});

it('keeps confirmed categories after a failed write and retries the requested value', async () => {
  await openPage();
  await switchOn();
  failRpc = { name: 'notification_preferences_set', message: 'connection unavailable', status: 0 };
  fireEvent.press(category('bests'));
  expect(await screen.findByTestId('settings-notifications-error')).toBeTruthy();
  expect(category('bests').props.accessibilityState.checked).toBe(true);

  fireEvent.press(retryButton());
  await waitFor(() => expect(category('bests').props.accessibilityState.checked).toBe(false));
  expect(mockRpc).toHaveBeenLastCalledWith('notification_preferences_set', { p_activity: true, p_bests: false, p_ranks: true });
  expect(preferences).toEqual({ activity: true, bests: false, ranks: true, muted: false });
});

it('does not claim registration succeeded after failure and retries the native opt-in', async () => {
  await openPage();
  failRpc = { name: 'notification_register', message: 'unavailable', status: 503 };
  fireEvent.press(toggle());
  expect(await screen.findByTestId('settings-notifications-error')).toBeTruthy();
  expect(status('Not registered')).toBeTruthy();
  expect(native.readBinding()).toBeNull();

  fireEvent.press(retryButton());
  await waitFor(() => expect(status('On')).toBeTruthy());
  expect(native.readBinding()?.bindingId).toBe(BINDING);
  expect(screen.queryByTestId('settings-notifications-error')).toBeNull();
});

it('shows no failure while switching on is still registering the device', async () => {
  await openPage();
  let register!: (value: unknown) => void;
  mockRpc.mockImplementationOnce(() => response(new Promise(resolve => { register = resolve; })));
  fireEvent.press(toggle());
  await waitFor(() => expect(toggle()).toBeDisabled());
  expect(screen.queryByTestId('settings-notifications-error')).toBeNull();

  await act(async () => { register({ binding_id: BINDING, permission: true, opted_in: true, payload_version: 1 }); });
  await waitFor(() => expect(status('On')).toBeTruthy());
  expect(screen.queryByTestId('settings-notifications-error')).toBeNull();
});

it('keeps registration retryable after a successful category write clears its error', async () => {
  await openPage();
  failRpc = { name: 'notification_register', message: 'unavailable', status: 503 };
  fireEvent.press(toggle());
  expect(await screen.findByTestId('settings-notifications-error')).toBeTruthy();
  expect(native.readBinding()).toBeNull();

  fireEvent.press(category('bests'));
  await waitFor(() => expect(category('bests').props.accessibilityState.checked).toBe(false));
  // The write's success clears the error; the failed registration is still one Notice with Retry.
  expect(await screen.findByText('This device isn’t registered for notifications.')).toBeTruthy();
  expect(screen.getAllByTestId('settings-notifications-error')).toHaveLength(1);
  expect(status('Not registered')).toBeTruthy();
  fireEvent.press(retryButton());

  await waitFor(() => expect(status('On')).toBeTruthy());
  expect(native.readBinding()?.bindingId).toBe(BINDING);
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(category('bests').props.accessibilityState.checked).toBe(false);
});

it('distinguishes provisional quiet delivery from fully granted notifications', async () => {
  (native.requestPermission as jest.Mock).mockResolvedValue('provisional');
  await openPage();
  await switchOn();
  await waitFor(() => expect(status('Quiet delivery')).toBeTruthy());
  expect(toggle().props.accessibilityState.checked).toBe(true);
  expect(native.readBinding()?.bindingId).toBe(BINDING);
});

it('keeps unsupported builds usable without offering registration or showing active defaults', async () => {
  native.supported = false;
  await refreshNotificationStatus();
  render(<NotificationSettingsScreen userId={USER} />);
  expect(screen.getByLabelText('Notifications: Unavailable')).toBeTruthy();
  expect(screen.queryByTestId('settings-notifications-enabled')).toBeNull();
  expect(screen.queryByText('Categories')).toBeNull();
  expect(native.requestPermission).not.toHaveBeenCalled();
});

it('does not invent category defaults before a successful server read', async () => {
  __resetNotificationsForTests();
  setNotificationAccount({ userId: USER, authSessionId: 'auth-session' }, 'test-bearer-a');
  failRpc = { name: 'notification_preferences_get', message: 'offline', status: 0 };
  render(<NotificationSettingsScreen userId={USER} />);
  expect(await screen.findByTestId('settings-notifications-error')).toBeTruthy();
  expect(screen.queryByText('Categories')).toBeNull();

  fireEvent.press(retryButton());
  await waitForGone(() => screen.queryByTestId('settings-notifications-error'));
  expect(status('Not enabled')).toBeTruthy();
  expect(screen.queryByText('Categories')).toBeNull();
});

it('offers Sign in as a navigate row and never requests permission while signed out', () => {
  setNotificationAccount(null);
  render(<NotificationSettingsScreen userId={null} />);
  expect(screen.queryByTestId('settings-notifications-enabled')).toBeNull();
  fireEvent.press(screen.getByTestId('settings-notifications-sign-in'));
  expect(mockPush).toHaveBeenCalledWith(SIGN_IN_ROUTE);
  expect(native.requestPermission).not.toHaveBeenCalled();
});

it('drops account A’s failed-save retry when the persistent route switches to B', async () => {
  resetLocalData();
  await ensurePreferencesLoaded();
  startNotificationLifecycle();
  const { rerender } = render(<SettingsNotificationsRoute />);
  await waitFor(() => expect(status('Not enabled')).toBeTruthy());
  await switchOn();
  failRpc = { name: 'notification_preferences_set', message: 'offline', status: 0 };
  fireEvent.press(category('bests'));
  expect(await screen.findByTestId('settings-notifications-error')).toBeTruthy();

  act(() => {
    mockUserId = '88888888-8888-4888-8888-888888888888';
    setNotificationAccount({ userId: mockUserId, authSessionId: 'auth-session-b' }, 'test-bearer-b');
  });
  rerender(<SettingsNotificationsRoute />);
  await waitForGone(() => screen.queryByTestId('settings-notifications-error'));
  // B's own failure: Retry re-reads B's state, it does not re-save A's categories.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  failRpc = { name: 'notification_preferences_get', message: 'offline', status: 0 };
  await act(async () => { await refreshNotificationStatus(); });
  expect(await screen.findByTestId('settings-notifications-error')).toBeTruthy();
  fireEvent.press(retryButton());
  await waitForGone(() => screen.queryByTestId('settings-notifications-error'));
  expect(mockRpc).toHaveBeenLastCalledWith('notification_preferences_get', { p_group_id: null });
});

it('keeps a confirmed group mute after failure, retries it and disables changes offline', async () => {
  const { rerender } = render(<GroupNotificationMuteRow groupId={GROUP} offline={false} />);
  const toggle = await screen.findByRole('switch', { name: 'Mute notifications' });
  expect(toggle.props.accessibilityState.checked).toBe(false);
  failRpc = { name: 'notification_group_mute', message: 'offline', status: 0 };
  fireEvent.press(toggle);
  expect(await screen.findByTestId('group-notifications-error')).toBeTruthy();
  expect(screen.getByRole('switch', { name: 'Mute notifications' }).props.accessibilityState.checked).toBe(false);

  fireEvent.press(screen.getByTestId('group-notifications-retry'));
  await waitFor(() => expect(screen.getByRole('switch', { name: 'Mute notifications' }).props.accessibilityState.checked).toBe(true));
  expect(mockRpc).toHaveBeenLastCalledWith('notification_group_mute', { p_group_id: GROUP, p_muted: true });
  rerender(<GroupNotificationMuteRow groupId={GROUP} offline />);
  expect(screen.getByRole('switch', { name: 'Mute notifications' })).toBeDisabled();
});

it('removes the stale group control when the server reports lost membership', async () => {
  render(<GroupNotificationMuteRow groupId={GROUP} offline={false} />);
  const toggle = await screen.findByRole('switch', { name: 'Mute notifications' });
  failRpc = { name: 'notification_group_mute', message: 'NOT_FOUND: removed', status: 400 };
  fireEvent.press(toggle);
  expect(await screen.findByText('Notifications are unavailable for this group.')).toBeTruthy();
  await waitForGone(() => screen.queryByRole('switch', { name: 'Mute notifications' }));
  expect(screen.queryByTestId('group-notifications-retry')).toBeNull();
});

it.each(['success', 'failure'] as const)('preserves a pending mute %s across offline and reconnect', async outcome => {
  const { rerender } = render(<GroupNotificationMuteRow groupId={GROUP} offline={false} />);
  const toggle = await screen.findByRole('switch', { name: 'Mute notifications' });
  let resolve!: (value: NotificationPreferences) => void;
  let reject!: (reason: Error) => void;
  const pending = new Promise<NotificationPreferences>((accept, refuse) => { resolve = accept; reject = refuse; });
  mockRpc.mockImplementationOnce(() => response(pending));
  const readsBefore = mockRpc.mock.calls.filter(([name, args]) => name === 'notification_preferences_get' && args.p_group_id === GROUP).length;

  fireEvent.press(toggle);
  rerender(<GroupNotificationMuteRow groupId={GROUP} offline />);
  rerender(<GroupNotificationMuteRow groupId={GROUP} offline={false} />);
  expect(screen.getByRole('switch', { name: 'Mute notifications' })).toBeDisabled();
  await act(async () => {
    if (outcome === 'success') {
      preferences = { ...preferences, muted: true };
      resolve(preferences);
    } else reject(new Error('connection interrupted'));
  });

  expect(mockRpc.mock.calls.filter(([name, args]) => name === 'notification_preferences_get' && args.p_group_id === GROUP)).toHaveLength(readsBefore);
  if (outcome === 'success') {
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Mute notifications' }).props.accessibilityState.checked).toBe(true));
    expect(screen.queryByTestId('group-notifications-error')).toBeNull();
  } else {
    expect(await screen.findByTestId('group-notifications-error')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Mute notifications' }).props.accessibilityState.checked).toBe(false);
    fireEvent.press(screen.getByTestId('group-notifications-retry'));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Mute notifications' }).props.accessibilityState.checked).toBe(true));
  }
});
