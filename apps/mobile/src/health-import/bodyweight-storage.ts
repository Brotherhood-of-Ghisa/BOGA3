import { Storage } from 'expo-sqlite/kv-store';
import { getAppFlavor } from '@/src/utils/app-flavor';

export type BodyWeightImportSettings = { enabled: boolean; since: string | null; anchor: string | null };
export type BodyWeightImportStore = {
  read(userId: string): BodyWeightImportSettings;
  write(userId: string, value: BodyWeightImportSettings): void;
};

const key = (userId: string) => `boga-health-weight:${getAppFlavor()}:${userId}`;
const empty = (): BodyWeightImportSettings => ({ enabled: false, since: null, anchor: null });

/** The cutoff survives disable/sign-out/reset; only the feed cursor is discarded. */
export const bodyWeightImportStore: BodyWeightImportStore = {
  read(userId) {
    const raw = Storage.getItemSync(key(userId));
    if (raw === null) return empty();
    try {
      const value = JSON.parse(raw) as Partial<BodyWeightImportSettings>;
      if (value.since !== null && (typeof value.since !== 'string' || !Number.isFinite(Date.parse(value.since)))) return empty();
      if (value.enabled === true && value.since === null) return empty();
      return { enabled: value.enabled === true, since: value.since ?? null,
        anchor: typeof value.anchor === 'string' ? value.anchor : null };
    } catch { return empty(); }
  },
  write(userId, value) { Storage.setItemSync(key(userId), JSON.stringify(value)); },
};
