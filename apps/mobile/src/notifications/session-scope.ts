export type NotificationAccount = { userId: string; authSessionId: string };
let account: NotificationAccount | null = null;
let accessToken: string | undefined;
let revision = 0;
const listeners = new Set<() => void>();
export const getNotificationAccount = () => account;
export const getNotificationAccessToken = () => accessToken;
export const getNotificationAccountRevision = () => revision;
export const subscribeNotificationAccount = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const publishNotificationAccount = (next: NotificationAccount | null, token: string | undefined, changed: boolean): void => {
  account = next; accessToken = token;
  if (!changed) return;
  revision += 1;
  for (const listener of listeners) listener();
};
export const __resetNotificationAccountForTests = (): void => {
  account = null; accessToken = undefined; revision = 0; listeners.clear();
};
