import type { NotificationBinding, NotificationNativeAdapter, NotificationProjection } from '@/src/notifications/types';

export const notificationUser = '11111111-1111-4111-8111-111111111111';
export const notificationSession = '22222222-2222-4222-8222-222222222222';
export const notificationBinding = '33333333-3333-4333-8333-333333333333';
export const notificationGroup = '44444444-4444-4444-8444-444444444444';
export const notificationMember = '55555555-5555-4555-8555-555555555555';
export const notificationEnvelopeFixture = { v: 1 as const, bindingId: notificationBinding, nonce: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAA==' };
export const notificationProjectionFixture = (): NotificationProjection => ({ v: 1, bindingId: notificationBinding, recipientUserId: notificationUser,
  notificationId: '12', expiresAt: Date.now() + 60_000, kind: 'completion', identity: 'Alex · Friends', heading: 'Finished a workout at Main Gym',
  bestCount: 1, rankCount: 1, route: { groupId: notificationGroup, memberId: notificationMember, sessionId: 'workout-1' } });

export const fakeNotificationNative = () => {
  let binding: NotificationBinding | null = null;
  const native: NotificationNativeAdapter = {
    supported: true, environment: 'preview', projectId: '66666666-6666-4666-8666-666666666666', bundleId: 'com.phano.boga3.dev',
    getPermission: jest.fn(async () => 'granted' as const), requestPermission: jest.fn(async () => 'granted' as const),
    getToken: jest.fn(async () => 'ExpoPushToken[test]'),
    readBinding: jest.fn(() => binding),
    getRegistrationMaterial: jest.fn(() => ({ installationId: '77777777-7777-4777-8777-777777777777',
      capability: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', encryptionKey: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=' })),
    activateBinding: jest.fn(value => { binding = value; }),
    invalidateBinding: jest.fn(() => { binding = null; }), decrypt: jest.fn(() => notificationProjectionFixture()),
    clearNotifications: jest.fn(async () => undefined), openSettings: jest.fn(async () => undefined),
    listen: jest.fn(() => () => undefined),
  };
  return native;
};
