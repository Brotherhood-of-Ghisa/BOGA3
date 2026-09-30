import { eq } from 'drizzle-orm';

import { notifyLocalWrite } from '@/src/sync/write-nudge';

import { bootstrapLocalDataLayer } from './bootstrap';
import { nowMonotonic, type Transaction } from './clock';
import { userSettings } from './schema';

export const USER_SETTINGS_ID = 'settings';

export const readBodyweightCalculationsEnabled = async (): Promise<boolean> => {
  const db = await bootstrapLocalDataLayer();
  const row = db.select({ enabled: userSettings.bodyweightCalculationsEnabled })
    .from(userSettings)
    .where(eq(userSettings.id, USER_SETTINGS_ID))
    .get();
  return row?.enabled ?? false;
};

export const writeBodyweightCalculationsEnabled = async (enabled: boolean): Promise<void> => {
  const db = await bootstrapLocalDataLayer();
  const now = new Date();
  db.transaction(tx => {
    const existing = tx.select({ id: userSettings.id })
      .from(userSettings)
      .where(eq(userSettings.id, USER_SETTINGS_ID))
      .get();
    const common = {
      bodyweightCalculationsEnabled: enabled,
      deletedAt: null,
      updatedAt: now,
      localDirty: true,
      localUpdatedAtMs: nowMonotonic(tx as Transaction),
    };
    if (existing) {
      tx.update(userSettings).set(common).where(eq(userSettings.id, USER_SETTINGS_ID)).run();
    } else {
      tx.insert(userSettings).values({ id: USER_SETTINGS_ID, ...common, createdAt: now }).run();
    }
  });
  notifyLocalWrite();
};
