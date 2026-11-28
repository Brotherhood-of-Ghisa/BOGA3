export type NotificationEnvironment = 'preview' | 'production';
export type NotificationPermission = 'undetermined' | 'denied' | 'provisional' | 'granted';
export type NotificationCategories = { activity: boolean; bests: boolean; ranks: boolean };
export type NotificationPreferences = NotificationCategories & { muted: boolean; meets: boolean };
export type NotificationSnapshot = {
  supported: boolean;
  permission: NotificationPermission;
  enabled: boolean;
  registered: boolean;
  busy: boolean;
  preferences: NotificationPreferences | null;
  error: string | null;
};
export type NotificationBinding = {
  installationId: string; userId: string; bindingId: string;
  authSessionId: string; environment: NotificationEnvironment;
};
export type NotificationRegistrationMaterial = { installationId: string; capability: string; encryptionKey: string };
export type NotificationEnvelope = { v: 1; bindingId: string; nonce: string; ciphertext: string };
export type NotificationTarget = { groupId: string; memberId: string; sessionId: string };
export type NotificationMeetTarget = { groupId: string; meetId: string };
export type NotificationUnavailableSubject = 'session' | 'meet';
// A meet push keeps the closed workout shape: its route carries the recipient as
// `memberId` and the meet as `sessionId`, and `detail` holds the standings so far.
export type NotificationProjection = {
  v: 1; bindingId: string; recipientUserId: string; expiresAt: number; notificationId: string;
  kind: 'start' | 'completion' | 'meet_start' | 'meet_end'; identity: string; heading: string;
  bestCount: number; rankCount: number; route: NotificationTarget; detail?: string;
};
export type NotificationNativeAdapter = {
  supported: boolean;
  environment: NotificationEnvironment | null;
  projectId: string | null;
  bundleId: string | null;
  getPermission: () => Promise<NotificationPermission>;
  requestPermission: () => Promise<NotificationPermission>;
  getToken: () => Promise<string>;
  readBinding: () => NotificationBinding | null;
  getRegistrationMaterial: (userId: string, environment: NotificationEnvironment) => NotificationRegistrationMaterial;
  activateBinding: (binding: NotificationBinding & { encryptionKey: string }) => void;
  invalidateBinding: () => void;
  decrypt: (envelope: NotificationEnvelope) => NotificationProjection | null;
  clearNotifications: () => Promise<void>;
  openSettings: () => Promise<void>;
  listen: (receiveTap: (data: unknown) => void, tokenChanged: () => void) => () => void;
};
