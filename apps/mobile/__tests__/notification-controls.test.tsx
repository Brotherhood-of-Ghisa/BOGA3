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

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Modal } from 'react-native';

import { GroupNotificationMuteRow } from '@/components/notifications/group-mute-row';
import { NotificationSettingsRow } from '@/components/notifications/settings-row';
import { __resetNotificationsForTests, refreshNotificationStatus, startNotificationLifecycle } from '@/src/notifications';
import { setNotificationAccount } from '@/src/notifications/auth-boundary';
import { __setNotificationNativeAdapterForTests } from '@/src/notifications/native-adapter';
import type { NotificationNativeAdapter, NotificationPreferences } from '@/src/notifications/types';
import { uiFonts, uiTypography } from '@/components/ui/tokens';
import { SIGN_IN_ROUTE } from '@/src/navigation/routes';
import { ensurePreferencesLoaded } from '@/src/preferences/hooks';
import SettingsRoute from '../app/settings';
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

const openControls = async () => {
  fireEvent.press(screen.getByTestId('settings-notifications-row'));
  await waitFor(() => expect(screen.getByTestId('settings-notifications-activity')).toBeEnabled());
  return within(screen.getByTestId('settings-notifications-sheet'));
};

it('opens a scrolling sheet and asks permission only after Enable, then can disable the installation', async () => {
  render(<NotificationSettingsRow userId={USER} />);
  expect(native.requestPermission).not.toHaveBeenCalled();
  const sheet = await openControls();
  expect(screen.getByTestId('settings-notifications-scroll')).toHaveStyle({ flexShrink: 1 });
  expect(native.requestPermission).not.toHaveBeenCalled();

  fireEvent.press(sheet.getByTestId('settings-notifications-enable'));
  await waitFor(() => expect(screen.getByLabelText('Notifications, On')).toBeTruthy());
  expect(native.requestPermission).toHaveBeenCalledTimes(1);
  expect(native.readBinding()?.userId).toBe(USER);
  expect(sheet.getByText('Categories')).toHaveStyle({ fontFamily: uiFonts.display.family, fontSize: uiTypography.size.xxs, textTransform: 'uppercase' });
  for (const category of ['activity', 'bests', 'ranks']) {
    expect(sheet.getByTestId(`settings-notifications-${category}`).props.accessibilityState.checked).toBe(true);
  }

  fireEvent(sheet.getByTestId('settings-notifications-enabled'), 'valueChange', false);
  await waitFor(() => expect(screen.getByLabelText('Notifications, Not enabled')).toBeTruthy());
  expect(native.readBinding()).toBeNull();
});

it('shows denied permission with iOS Settings and reports an unsuccessful Settings handoff', async () => {
  (native.getPermission as jest.Mock).mockResolvedValue('denied');
  await refreshNotificationStatus();
  render(<NotificationSettingsRow userId={USER} />);
  const sheet = await openControls();
  expect(screen.getByLabelText('Notifications, Off in iOS Settings')).toBeTruthy();
  expect(sheet.queryByTestId('settings-notifications-enable')).toBeNull();
  (native.openSettings as jest.Mock).mockRejectedValueOnce(new Error('native failure'));
  fireEvent.press(sheet.getByTestId('settings-notifications-open-settings'));
  expect(await sheet.findByTestId('settings-notifications-error')).toBeTruthy();
  expect(native.requestPermission).not.toHaveBeenCalled();
});

it('keeps confirmed categories after a failed write and retries the requested value', async () => {
  render(<NotificationSettingsRow userId={USER} />);
  const sheet = await openControls();
  failRpc = { name: 'notification_preferences_set', message: 'connection unavailable', status: 0 };
  fireEvent.press(sheet.getByTestId('settings-notifications-bests'));
  expect(await sheet.findByTestId('settings-notifications-error')).toBeTruthy();
  expect(sheet.getByTestId('settings-notifications-bests').props.accessibilityState.checked).toBe(true);

  fireEvent.press(sheet.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(sheet.getByTestId('settings-notifications-bests').props.accessibilityState.checked).toBe(false));
  expect(mockRpc).toHaveBeenLastCalledWith('notification_preferences_set', { p_activity: true, p_bests: false, p_ranks: true });
  expect(preferences).toEqual({ activity: true, bests: false, ranks: true, muted: false });
});

it('does not claim registration succeeded after failure and retries the native opt-in', async () => {
  render(<NotificationSettingsRow userId={USER} />);
  const sheet = await openControls();
  failRpc = { name: 'notification_register', message: 'unavailable', status: 503 };
  fireEvent.press(sheet.getByTestId('settings-notifications-enable'));
  expect(await sheet.findByTestId('settings-notifications-error')).toBeTruthy();
  expect(screen.getByLabelText('Notifications, Not registered')).toBeTruthy();
  expect(native.readBinding()).toBeNull();

  fireEvent.press(sheet.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.getByLabelText('Notifications, On')).toBeTruthy());
  expect(native.readBinding()?.bindingId).toBe(BINDING);
});

it('keeps registration retryable after a successful category write clears its error', async () => {
  render(<NotificationSettingsRow userId={USER} />);
  const sheet = await openControls();
  failRpc = { name: 'notification_register', message: 'unavailable', status: 503 };
  fireEvent.press(sheet.getByTestId('settings-notifications-enable'));
  expect(await sheet.findByTestId('settings-notifications-error')).toBeTruthy();
  expect(native.readBinding()).toBeNull();

  fireEvent.press(sheet.getByTestId('settings-notifications-bests'));
  await waitFor(() => expect(sheet.getByTestId('settings-notifications-bests').props.accessibilityState.checked).toBe(false));
  await waitForGone(() => sheet.queryByTestId('settings-notifications-error'));
  expect(screen.getByLabelText('Notifications, Not registered')).toBeTruthy();
  fireEvent.press(sheet.getByRole('button', { name: 'Retry' }));

  await waitFor(() => expect(screen.getByLabelText('Notifications, On')).toBeTruthy());
  expect(native.readBinding()?.bindingId).toBe(BINDING);
  expect(sheet.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(sheet.getByTestId('settings-notifications-bests').props.accessibilityState.checked).toBe(false);
});

it('distinguishes provisional quiet delivery from fully granted notifications', async () => {
  (native.requestPermission as jest.Mock).mockResolvedValue('provisional');
  render(<NotificationSettingsRow userId={USER} />);
  const sheet = await openControls();
  fireEvent.press(sheet.getByTestId('settings-notifications-enable'));
  await waitFor(() => expect(screen.getByLabelText('Notifications, Quiet delivery')).toBeTruthy());
  expect(native.readBinding()?.bindingId).toBe(BINDING);
});

it('keeps unsupported builds usable without offering registration or showing active defaults', async () => {
  native.supported = false;
  await refreshNotificationStatus();
  render(<NotificationSettingsRow userId={USER} />);
  fireEvent.press(screen.getByTestId('settings-notifications-row'));
  const sheet = within(screen.getByTestId('settings-notifications-sheet'));
  expect(screen.getByLabelText('Notifications, Unavailable')).toBeTruthy();
  expect(sheet.queryByTestId('settings-notifications-enable')).toBeNull();
  expect(sheet.queryByTestId('settings-notifications-activity')).toBeNull();
  expect(native.requestPermission).not.toHaveBeenCalled();
});

it('does not invent category defaults before a successful server read', async () => {
  __resetNotificationsForTests();
  setNotificationAccount({ userId: USER, authSessionId: 'auth-session' }, 'test-bearer-a');
  failRpc = { name: 'notification_preferences_get', message: 'offline', status: 0 };
  render(<NotificationSettingsRow userId={USER} />);
  fireEvent.press(screen.getByTestId('settings-notifications-row'));
  const sheet = within(screen.getByTestId('settings-notifications-sheet'));
  expect(await sheet.findByTestId('settings-notifications-error')).toBeTruthy();
  expect(sheet.queryByTestId('settings-notifications-activity')).toBeNull();

  fireEvent.press(sheet.getByRole('button', { name: 'Retry' }));
  expect(await sheet.findByTestId('settings-notifications-activity')).toBeTruthy();
});

it('offers sign in after dismissing the modal and never requests permission while signed out', () => {
  setNotificationAccount(null);
  render(<NotificationSettingsRow userId={null} />);
  fireEvent.press(screen.getByTestId('settings-notifications-row'));
  fireEvent.press(screen.getByTestId('settings-notifications-sign-in'));
  expect(mockPush).not.toHaveBeenCalled();
  act(() => screen.UNSAFE_getAllByType(Modal).find(modal => modal.props.testID === 'settings-notifications-sheet-modal')!.props.onDismiss());
  expect(mockPush).toHaveBeenCalledWith(SIGN_IN_ROUTE);
  expect(native.requestPermission).not.toHaveBeenCalled();
});

it('drops account A’s open sheet and failed-save retry when the persistent Settings route switches to B', async () => {
  resetLocalData();
  await ensurePreferencesLoaded();
  startNotificationLifecycle();
  const { rerender } = render(<SettingsRoute />);
  const sheet = await openControls();
  failRpc = { name: 'notification_preferences_set', message: 'offline', status: 0 };
  fireEvent.press(sheet.getByTestId('settings-notifications-bests'));
  expect(await sheet.findByTestId('settings-notifications-error')).toBeTruthy();

  act(() => {
    mockUserId = '88888888-8888-4888-8888-888888888888';
    setNotificationAccount({ userId: mockUserId, authSessionId: 'auth-session-b' }, 'test-bearer-b');
  });
  rerender(<SettingsRoute />);
  expect(screen.queryByTestId('settings-notifications-sheet')).toBeNull();
  await openControls();
  fireEvent.press(screen.getByTestId('settings-notifications-sheet-backdrop', { includeHiddenElements: true }));
  failRpc = { name: 'notification_preferences_get', message: 'offline', status: 0 };
  fireEvent.press(screen.getByTestId('settings-notifications-row'));
  expect(await screen.findByTestId('settings-notifications-error')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  await waitForGone(() => screen.queryByTestId('settings-notifications-error'));
  expect(mockRpc).toHaveBeenLastCalledWith('notification_preferences_get', { p_group_id: null });
  expect(screen.getByTestId('settings-notifications-bests').props.accessibilityState.checked).toBe(true);
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
