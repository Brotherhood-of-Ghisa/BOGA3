/* eslint-disable import/first */

import type { NotificationMeetTarget, NotificationTarget } from '@/src/notifications/types';

type TapRequest = {
  userId: string | null; ready: boolean;
  onOpen: (target: NotificationTarget) => void;
  onOpenMeet: (target: NotificationMeetTarget) => void;
  onUnavailable: (reason: 'offline' | 'unavailable', subject?: 'session' | 'meet') => void;
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
// The recipient launched in a custom colour, so the shared theme must be theirs, not Warm's.
jest.mock('@/components/ui/theme-launch', () => ({
  ...jest.requireActual('@/components/ui/theme-launch'),
  launchTheme: jest.requireActual('@/components/ui/theme-presets').resolveThemePreset('hue:200'),
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
import { generateRoles } from '@/components/ui/theme';
import { customFromSeeds, generateCustomRoles } from '@/components/ui/theme-custom';
import { seedsFromHue } from '@/components/ui/theme-hue';
import { getThemePreset } from '@/components/ui/theme-presets';
import { logEvent } from '@/src/logging';
import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';
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

it("shares the recipient's applied app theme, custom colours included, for expanded notifications", () => {
  const roles = generateCustomRoles(customFromSeeds(seedsFromHue(200), 'light'));
  const view = render(<NotificationTapBridge />);
  expect(mockStart).toHaveBeenCalledTimes(1);
  expect(mockSetTheme).toHaveBeenCalledWith({
    paper: roles.paper, surface: roles.surface, rule: roles.rule,
    ink: roles.ink, inkMuted: roles.inkMuted, record: roles.record, recordWash: roles.recordWash,
  });
  // Warm-derived colours would mean the palette is fixed, not the recipient's.
  const warm = generateRoles(getThemePreset('warm').seeds);
  expect(mockSetTheme.mock.calls[0][0]).not.toEqual(expect.objectContaining({ paper: warm.paper, ink: warm.ink, record: warm.record }));
  view.unmount();
  expect(mockStop).toHaveBeenCalledTimes(1);
});

it('shares the theme again when a new appearance is saved, without restarting the lifecycle', async () => {
  renderWithTheme(<NotificationTapBridge />);
  expect(mockStart).toHaveBeenCalledTimes(1);

  const slateDark = { theme: 'slate', mode: 'dark', custom: null } as const;
  await switchTheme(slateDark);

  const roles = rolesFor(slateDark);
  expect(mockSetTheme).toHaveBeenLastCalledWith({
    paper: roles.paper, surface: roles.surface, rule: roles.rule,
    ink: roles.ink, inkMuted: roles.inkMuted, record: roles.record, recordWash: roles.recordWash,
  });
  // Native listeners live across a theme save: neither stopped nor started again.
  expect(mockStop).not.toHaveBeenCalled();
  expect(mockStart).toHaveBeenCalledTimes(1);
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

const meetTarget = { groupId: 'group', meetId: '88888888-8888-4888-8888-888888888888' };

it('opens a meet tap on the meet page and does not stack its current route', () => {
  const view = render(<NotificationTapBridge />);
  act(() => currentRequest().onOpenMeet(meetTarget));
  expect(mockPush).toHaveBeenCalledTimes(1);
  const href = mockPush.mock.calls[0][0];
  mockPathname = typeof href === 'string' ? href : href.pathname;
  view.rerender(<NotificationTapBridge />);
  act(() => currentRequest().onOpenMeet(meetTarget));
  expect(mockPush).toHaveBeenCalledTimes(1);
});

it('words an offline meet tap as a meet, and retries it', async () => {
  render(<NotificationTapBridge />);
  act(() => currentRequest().onUnavailable('offline', 'meet'));
  expect(screen.getByText('Connect to open this meet.')).toBeTruthy();
  expect(screen.queryByText('Connect to open this workout.')).toBeNull();
  const calls = mockProcess.mock.calls.length;
  fireEvent.press(screen.getByTestId('notification-retry'));
  await waitFor(() => expect(mockProcess.mock.calls.length).toBeGreaterThan(calls));
});

it('words an unavailable meet tap as a meet, and the next session failure goes back to the workout words', () => {
  render(<NotificationTapBridge />);
  act(() => currentRequest().onUnavailable('unavailable', 'meet'));
  expect(screen.getByText('This meet is no longer available')).toBeTruthy();
  expect(mockPush).not.toHaveBeenCalled();
  act(() => currentRequest().onUnavailable('unavailable'));
  expect(screen.getByText('This session is no longer available')).toBeTruthy();
});
