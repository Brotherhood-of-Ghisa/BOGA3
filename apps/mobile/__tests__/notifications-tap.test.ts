/* eslint-disable import/first */
const mockSessionRead = jest.fn();
jest.mock('@/src/groups/api', () => ({
  ...jest.requireActual('@/src/groups/api'), getCompetitionSession: (...args: unknown[]) => mockSessionRead(...args),
}));
import { GroupApiError } from '@/src/groups/api';
import { clearRecentLogs, getRecentLogs } from '@/src/logging/buffer';
import { __setNotificationNativeAdapterForTests } from '@/src/notifications/native-adapter';
import { __resetNotificationsForTests, discardPendingNotificationTap, getPendingNotificationTapRevision,
  processPendingNotificationTap, subscribePendingNotificationTap } from '@/src/notifications';
import { notificationSessionIdentity, setNotificationAccount } from '@/src/notifications/auth-boundary';
import { isNotificationProjection, notificationEnvelope, receiveNotificationTap, watchNotificationTapAccount } from '@/src/notifications/tap';
import { fakeNotificationNative, notificationBinding, notificationEnvelopeFixture, notificationProjectionFixture,
  notificationSession, notificationUser } from './helpers/notification-native';

let native: ReturnType<typeof fakeNotificationNative>;
const onOpen = jest.fn(); const onUnavailable = jest.fn();
const process = (ready = true) => processPendingNotificationTap({ ready, userId: notificationUser, onOpen, onUnavailable });
beforeEach(() => {
  native = fakeNotificationNative(); __setNotificationNativeAdapterForTests(native); __resetNotificationsForTests();
  setNotificationAccount({ userId: notificationUser, authSessionId: notificationSession }, 'token');
  native.activateBinding({ installationId: '77777777-7777-4777-8777-777777777777', userId: notificationUser,
    authSessionId: notificationSession, bindingId: notificationBinding, environment: 'preview', encryptionKey: 'key' });
  mockSessionRead.mockReset(); mockSessionRead.mockResolvedValue({}); onOpen.mockReset(); onUnavailable.mockReset();
});
test.each([null, { ...notificationEnvelopeFixture, url: 'https://bad' }, { ...notificationEnvelopeFixture, v: 2 },
  { ...notificationEnvelopeFixture, nonce: 'bad' }, { route: notificationProjectionFixture().route }])('rejects malformed/clear routing input %j', value => {
  expect(notificationEnvelope(value)).toBeNull();
});
test('does not authorize or route before bootstrap and never treats a repeated tap as a second route', async () => {
  receiveNotificationTap(notificationEnvelopeFixture);
  await process(false); expect(mockSessionRead).not.toHaveBeenCalled();
  await process(); expect(onOpen).toHaveBeenCalledWith(notificationProjectionFixture().route);
  receiveNotificationTap(notificationEnvelopeFixture); await process();
  expect(onOpen).toHaveBeenCalledTimes(1); expect(mockSessionRead).toHaveBeenCalledTimes(1);
});
test('offline keeps the encrypted pending tap for retry; a lost member consumes it without routing', async () => {
  receiveNotificationTap(notificationEnvelopeFixture);
  mockSessionRead.mockRejectedValueOnce(new GroupApiError('NETWORK', 'offline'));
  await process(); expect(onUnavailable).toHaveBeenLastCalledWith('offline'); expect(onOpen).not.toHaveBeenCalled();
  mockSessionRead.mockRejectedValueOnce(new GroupApiError('NOT_FOUND', 'missing'));
  await process(); expect(onUnavailable).toHaveBeenLastCalledWith('unavailable');
  await process(); expect(mockSessionRead).toHaveBeenCalledTimes(2);
});
test('expiry, wrong recipient and arbitrary route fields fail closed before live access', async () => {
  for (const value of [ { ...notificationProjectionFixture(), expiresAt: Date.now() - 1 },
    { ...notificationProjectionFixture(), recipientUserId: '66666666-6666-4666-8666-666666666666' },
    { ...notificationProjectionFixture(), route: { ...notificationProjectionFixture().route, url: 'https://bad' } } ]) {
    native.decrypt = jest.fn(() => value); receiveNotificationTap(notificationEnvelopeFixture); await process();
  }
  expect(mockSessionRead).not.toHaveBeenCalled(); expect(onOpen).not.toHaveBeenCalled();
});
test('account or binding changes during live authorization cannot navigate', async () => {
  let finish!: () => void;
  mockSessionRead.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const stop = watchNotificationTapAccount();
  receiveNotificationTap(notificationEnvelopeFixture); const pending = process();
  setNotificationAccount(null); finish(); await pending;
  expect(onOpen).not.toHaveBeenCalled(); stop();
});
test('new taps arriving during a live read are scheduled once that read settles', async () => {
  let finish!: () => void;
  mockSessionRead.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  receiveNotificationTap(notificationEnvelopeFixture); const first = process();
  const newer = { ...notificationEnvelopeFixture, ciphertext: 'BBBBBB==' };
  receiveNotificationTap(newer); await process();
  const revision = getPendingNotificationTapRevision(); const changed = jest.fn();
  const stop = subscribePendingNotificationTap(changed);
  finish(); await first;
  expect(changed).toHaveBeenCalledTimes(1); expect(getPendingNotificationTapRevision()).toBeGreaterThan(revision);
  expect(onOpen).not.toHaveBeenCalled();
  await process(); expect(onOpen).toHaveBeenCalledTimes(1); stop();
});
test('dismissal clears the pending original envelope', async () => {
  receiveNotificationTap(notificationEnvelopeFixture); discardPendingNotificationTap(); await process();
  expect(mockSessionRead).not.toHaveBeenCalled();
});
test('invalid native projections cannot bypass route and count validation', () => {
  expect(isNotificationProjection({ ...notificationProjectionFixture(), bestCount: -1 })).toBe(false);
  expect(isNotificationProjection({ ...notificationProjectionFixture(), rankCount: 1.5 })).toBe(false);
  expect(isNotificationProjection({ ...notificationProjectionFixture(), heading: 'untrusted heading' })).toBe(false);
});

test('a matching persisted binding survives initial auth restoration and keeps a cold-launch tap', async () => {
  __resetNotificationsForTests();
  const stop = watchNotificationTapAccount();
  receiveNotificationTap(notificationEnvelopeFixture);
  const invalidations = jest.mocked(native.invalidateBinding).mock.calls.length;
  setNotificationAccount({ userId: notificationUser, authSessionId: notificationSession }, 'restored-token');
  expect(native.invalidateBinding).toHaveBeenCalledTimes(invalidations);
  await process(); expect(onOpen).toHaveBeenCalledTimes(1); stop();
});

test('long Unicode names remain valid and reach the authorized workout after a live read', async () => {
  const projection = { ...notificationProjectionFixture(), identity: `${'💪'.repeat(100)} · ${'🏆'.repeat(50)}` };
  expect(projection.identity.length).toBe(303);
  expect(isNotificationProjection({ ...projection, identity: '' })).toBe(false);
  native.decrypt = jest.fn(() => projection);
  receiveNotificationTap(notificationEnvelopeFixture);
  await process();
  expect(mockSessionRead).toHaveBeenCalledWith(projection.route.groupId, projection.route.memberId, projection.route.sessionId);
  expect(onOpen).toHaveBeenCalledWith(projection.route);
  expect(onUnavailable).not.toHaveBeenCalled();
});

test.each(['Started a workout at Main Gym', 'Finished a workout at Main Gym', 'Finished a workout at a secret location',
  'Started a workout', 'Finished a workout', `Finished a workout at ${'💪'.repeat(100)}`])('accepts bounded workout locations and legacy heading: %s', heading => {
  expect(isNotificationProjection({ ...notificationProjectionFixture(), heading })).toBe(true);
});
test.each(['Started a workout at ', `Finished a workout at ${'a'.repeat(101)}`, 'Finished a workout at Main\nGym'])('rejects malformed workout location: %s', heading => {
  expect(isNotificationProjection({ ...notificationProjectionFixture(), heading })).toBe(false);
});

test('notificationSessionIdentity decodes unpadded base64url JWTs across all mod-4 lengths', () => {
  for (const sessionId of ['s1', 's12', 's123', 's1234', 'uuid-with-_-and-dash']) {
    const json = JSON.stringify({ session_id: sessionId });
    const unpadded = Buffer.from(json).toString('base64url');
    const token = `header.${unpadded}.signature`;
    const identity = notificationSessionIdentity({
      access_token: token,
      user: { id: notificationUser },
    } as any);
    expect(identity).toEqual({ userId: notificationUser, authSessionId: sessionId });
  }
});

test('notificationSessionIdentity rejects malformed tokens and missing session_id', () => {
  expect(notificationSessionIdentity(null)).toBeNull();
  expect(notificationSessionIdentity({ access_token: '' } as any)).toBeNull();
  expect(notificationSessionIdentity({ access_token: 'no-dots' } as any)).toBeNull();
  const noSessionId = `header.${Buffer.from(JSON.stringify({ other: 'value' })).toString('base64url')}.sig`;
  expect(notificationSessionIdentity({ access_token: noSessionId, user: { id: notificationUser } } as any)).toBeNull();
  const invalidJson = `header.${Buffer.from('not-json').toString('base64url')}.sig`;
  expect(notificationSessionIdentity({ access_token: invalidJson, user: { id: notificationUser } } as any)).toBeNull();
});

test('binding rotation for the same user and session during live read still navigates to route', async () => {
  let finish!: () => void;
  mockSessionRead.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  receiveNotificationTap(notificationEnvelopeFixture);
  const pending = process();
  native.activateBinding({
    installationId: '77777777-7777-4777-8777-777777777777',
    userId: notificationUser,
    authSessionId: notificationSession,
    bindingId: '88888888-8888-4888-8888-888888888888',
    environment: 'preview',
    encryptionKey: 'rotated-key',
  });
  finish();
  await pending;
  expect(onOpen).toHaveBeenCalledWith(notificationProjectionFixture().route);
  expect(onUnavailable).not.toHaveBeenCalled();
});

test('binding invalidation during live read discards tap and does not navigate', async () => {
  let finish!: () => void;
  mockSessionRead.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  receiveNotificationTap(notificationEnvelopeFixture);
  const pending = process();
  native.invalidateBinding();
  finish();
  await pending;
  expect(onOpen).not.toHaveBeenCalled();
});

test('expiry occurring during live read marks notification unavailable', async () => {
  let finish!: () => void;
  mockSessionRead.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const expiring = { ...notificationProjectionFixture(), expiresAt: Date.now() + 15 };
  native.decrypt = jest.fn(() => expiring);
  receiveNotificationTap(notificationEnvelopeFixture);
  const pending = process();
  await new Promise(r => setTimeout(r, 25));
  finish();
  await pending;
  expect(onUnavailable).toHaveBeenCalledWith('unavailable');
  expect(onOpen).not.toHaveBeenCalled();
});

test('emits diagnostic logs on decode failure and successful tap open', async () => {
  clearRecentLogs();
  receiveNotificationTap(notificationEnvelopeFixture);
  await process();
  expect(getRecentLogs().some(log => log.event === 'notifications.tap_opened')).toBe(true);

  clearRecentLogs();
  native.decrypt = jest.fn(() => null);
  receiveNotificationTap(notificationEnvelopeFixture);
  await process();
  const decodeFailure = getRecentLogs().find(log => log.event === 'notifications.tap_decode_failed');
  expect(decodeFailure).toBeDefined();
  expect(decodeFailure?.context).toMatchObject({
    envelopeBindingId: notificationEnvelopeFixture.bindingId,
    hasDecryptedValue: false,
  });
});
