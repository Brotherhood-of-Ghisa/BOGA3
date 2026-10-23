/* eslint-disable import/first */

import type { NotificationTarget } from '@/src/notifications/types';

type TapRequest = {
  userId: string | null; ready: boolean;
  onOpen: (target: NotificationTarget) => void;
  onUnavailable: (reason: 'offline' | 'unavailable') => void;
};
const mockProcess = jest.fn<Promise<void>, [TapRequest]>(() => Promise.resolve());
const mockStop = jest.fn();
const mockStart = jest.fn(() => mockStop);
const mockDiscard = jest.fn();
const mockSetTheme = jest.fn();
const mockPush = jest.fn();
const mockRouter = { push: mockPush };
const mockAuth = { status: 'ready', user: { id: 'recipient' } as { id: string } | null };
let mockAccess = 'app';
let mockNavigatorKey: string | undefined = 'mounted';
let mockPathname = '/today';
let mockGroup: string | undefined;

// This suite owns root/UI wiring. Native crypto, live authorization and tap
// generation races are exercised through the production lifecycle separately.
jest.mock('@/src/notifications', () => ({
  discardPendingNotificationTap: () => mockDiscard(),
  getPendingNotificationTapRevision: () => 0,
  processPendingNotificationTap: (request: TapRequest) => mockProcess(request),
  setAppliedNotificationTheme: (theme: unknown) => mockSetTheme(theme),
  startNotificationLifecycle: () => mockStart(),
  subscribePendingNotificationTap: () => () => undefined,
}));
jest.mock('@/src/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('@/src/navigation/root-route-access', () => ({ useRootRouteAccess: () => mockAccess }));
jest.mock('@/src/logging', () => ({ logEvent: jest.fn() }));
jest.mock('expo-router', () => ({
  useGlobalSearchParams: () => ({ groupId: mockGroup }),
  usePathname: () => mockPathname,
  useRootNavigationState: () => ({ key: mockNavigatorKey }),
  useRouter: () => mockRouter,
}));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NotificationTapBridge } from '@/components/navigation/notification-tap-bridge';
import { uiRoles } from '@/components/ui/tokens';
import { logEvent } from '@/src/logging';
import { waitForGone } from './helpers/wait-for-gone';

const currentRequest = () => mockProcess.mock.calls.at(-1)![0];
const target = { groupId: 'group', memberId: 'member', sessionId: 'session' };

beforeEach(() => {
  jest.clearAllMocks();
  mockProcess.mockResolvedValue(undefined);
  mockAuth.status = 'ready';
  mockAuth.user = { id: 'recipient' };
  mockAccess = 'app';
  mockNavigatorKey = 'mounted';
  mockPathname = '/today';
  mockGroup = undefined;
});

it('shares the applied theme and stops its native listener lifecycle on unmount', () => {
  const view = render(<NotificationTapBridge />);
  expect(mockStart).toHaveBeenCalledTimes(1);
  expect(mockSetTheme).toHaveBeenCalledWith({
    paper: uiRoles.paper, surface: uiRoles.surface, rule: uiRoles.rule,
    ink: uiRoles.ink, inkMuted: uiRoles.inkMuted, record: uiRoles.record, recordWash: uiRoles.recordWash,
  });
  view.unmount();
  expect(mockStop).toHaveBeenCalledTimes(1);
});

it.each(['sign-in', 'sync-setup'])('keeps taps pending while protected route access is %s', access => {
  mockAccess = access;
  const view = render(<NotificationTapBridge />);
  expect(currentRequest()).toMatchObject({ ready: false, userId: 'recipient' });
  expect(mockPush).not.toHaveBeenCalled();
  mockAccess = 'app';
  view.rerender(<NotificationTapBridge />);
  expect(currentRequest().ready).toBe(true);
});

it('waits for the navigator and restored account before allowing tap processing', () => {
  mockNavigatorKey = undefined;
  mockAuth.status = 'restoring';
  mockAuth.user = null;
  const view = render(<NotificationTapBridge />);
  expect(currentRequest()).toMatchObject({ ready: false, userId: null });
  mockNavigatorKey = 'mounted';
  mockAuth.status = 'ready';
  mockAuth.user = { id: 'recipient' };
  view.rerender(<NotificationTapBridge />);
  expect(currentRequest()).toMatchObject({ ready: true, userId: 'recipient' });
});

it('opens the existing authorized target using ids and does not stack its current route', () => {
  const view = render(<NotificationTapBridge />);
  act(() => currentRequest().onOpen(target));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/group-session/[memberId]/[sessionId]', params: target });
  mockPathname = '/group-session/member/session';
  mockGroup = 'group';
  view.rerender(<NotificationTapBridge />);
  act(() => currentRequest().onOpen(target));
  expect(mockPush).toHaveBeenCalledTimes(1);
});

it('offers an offline retry and discards the original pending intent when dismissed', async () => {
  render(<NotificationTapBridge />);
  act(() => currentRequest().onUnavailable('offline'));
  expect(screen.getByTestId('notification-offline')).toBeTruthy();
  const calls = mockProcess.mock.calls.length;
  fireEvent.press(screen.getByTestId('notification-retry'));
  await waitFor(() => expect(mockProcess.mock.calls.length).toBeGreaterThan(calls));
  fireEvent.press(screen.getByTestId('notification-unavailable-sheet-backdrop', { includeHiddenElements: true }));
  await waitForGone(() => screen.queryByTestId('notification-offline'));
  expect(mockDiscard).toHaveBeenCalledTimes(1);
  expect(mockPush).not.toHaveBeenCalled();
});

it('uses the existing unavailable words without navigating to cached workout content', () => {
  render(<NotificationTapBridge />);
  act(() => currentRequest().onUnavailable('unavailable'));
  expect(screen.getByText('This session is no longer available')).toBeTruthy();
  expect(mockPush).not.toHaveBeenCalled();
});

it('clears the prior account failure and ignores its late callback after an account switch', async () => {
  const view = render(<NotificationTapBridge />);
  const oldFailure = currentRequest().onUnavailable;
  act(() => oldFailure('unavailable'));
  expect(screen.getByTestId('notification-unavailable')).toBeTruthy();
  mockAuth.user = { id: 'another-recipient' };
  view.rerender(<NotificationTapBridge />);
  await waitForGone(() => screen.queryByTestId('notification-unavailable'));
  act(() => oldFailure('offline'));
  expect(screen.queryByTestId('notification-offline')).toBeNull();
  mockAuth.user = { id: 'recipient' };
  view.rerender(<NotificationTapBridge />);
  expect(screen.queryByTestId('notification-unavailable')).toBeNull();
});

it('logs unhandled error and shows unavailable when processing rejects', async () => {
  mockProcess.mockRejectedValueOnce(new Error('crash in tap'));
  render(<NotificationTapBridge />);
  await waitFor(() => expect(screen.getByText('This session is no longer available')).toBeTruthy());
  expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({
    level: 'error',
    event: 'notifications.tap_unhandled_error',
    message: 'crash in tap',
  }));
});
