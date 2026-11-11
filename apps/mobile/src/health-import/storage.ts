import { Storage } from 'expo-sqlite/kv-store';

import { getAppFlavor } from '@/src/utils/app-flavor';

// Device-local and per account. The switch is the account's choice on this
// phone; the anchor is the store's change-feed position and the backfill start,
// and belongs to one account only: a different account, or the same one after
// signing out, starts over with a fresh backfill.

export type HealthImportAnchor = { userId: string; anchor: string; since: string };

export type HealthImportStore = {
  readEnabled(userId: string): boolean;
  writeEnabled(userId: string, enabled: boolean): void;
  /** The saved position, only when it belongs to `userId`. */
  readAnchor(userId: string): { anchor: string; since: Date } | null;
  writeAnchor(userId: string, anchor: string, since: Date): void;
  clearAnchor(): void;
};

const enabledKey = (userId: string) => `boga-health-import-enabled:${getAppFlavor()}:${userId}`;
const anchorKey = () => `boga-health-import-anchor:${getAppFlavor()}`;

const parseAnchor = (raw: string | null): HealthImportAnchor | null => {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<HealthImportAnchor>;
    return typeof value.userId === 'string' && typeof value.anchor === 'string' && typeof value.since === 'string'
      && Number.isFinite(Date.parse(value.since))
      ? { userId: value.userId, anchor: value.anchor, since: value.since }
      : null;
  } catch {
    return null;
  }
};

export const healthImportStore: HealthImportStore = {
  readEnabled: (userId) => Storage.getItemSync(enabledKey(userId)) === 'true',
  writeEnabled: (userId, enabled) => {
    if (enabled) Storage.setItemSync(enabledKey(userId), 'true');
    else Storage.removeItemSync(enabledKey(userId));
  },
  readAnchor: (userId) => {
    const saved = parseAnchor(Storage.getItemSync(anchorKey()));
    return saved && saved.userId === userId ? { anchor: saved.anchor, since: new Date(saved.since) } : null;
  },
  writeAnchor: (userId, anchor, since) => {
    Storage.setItemSync(anchorKey(), JSON.stringify({ userId, anchor, since: since.toISOString() }));
  },
  clearAnchor: () => {
    Storage.removeItemSync(anchorKey());
  },
};
