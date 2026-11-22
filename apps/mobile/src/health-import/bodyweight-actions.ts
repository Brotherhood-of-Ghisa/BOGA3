import { getAuthSnapshot } from '@/src/auth/service';
import { bootstrapLocalDataLayer } from '@/src/data/bootstrap';
import { readLocalDataOwner } from '@/src/data/local-wipe';
import { setBodyWeightReadingIgnored } from '@/src/data/bodyweight';
import { withLocalDataLock } from '@/src/sync/account-wipe';

/** A sheet belongs to the account that loaded it, even after an async account switch. */
export const setImportedBodyWeightIgnored = (id: string, ignored: boolean, owner: string | null): Promise<void> =>
  withLocalDataLock(async () => {
    const db = await bootstrapLocalDataLayer();
    if ((getAuthSnapshot().user?.id ?? null) !== owner || readLocalDataOwner(db) !== owner) {
      throw new Error('Your account changed. Reopen weight history.');
    }
    await setBodyWeightReadingIgnored(id, ignored);
  });
