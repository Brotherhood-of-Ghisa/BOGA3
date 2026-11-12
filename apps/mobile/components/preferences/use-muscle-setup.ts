import { useCallback, useEffect, useRef, useState } from 'react';
import { CombinedMuscleError, readMuscleSetup, type MuscleSetupChange } from '@/src/data/muscle-report-settings';
import { subscribeToExerciseCatalogInvalidation } from '@/src/exercise-catalog/invalidation';
import { getAccountLocalPreferenceAccountRevision, refreshAccountLocalSyncedPreferences } from '@/src/preferences/account-local';

/** Account-scoped reads of the resolved setup; responses from an older request or account are ignored. */
export function useMuscleSetup(accountRevision: number) {
  const [setup, setSetup] = useState<MuscleSetupChange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  const request = useRef(0);
  const writing = useRef(false);
  const failedWrite = useRef<(() => Promise<unknown>) | null>(null);
  const current = useCallback(() => live.current && accountRevision === getAccountLocalPreferenceAccountRevision(), [accountRevision]);
  const reload = useCallback(async () => {
    const token = ++request.current;
    try {
      const next = await readMuscleSetup();
      if (current() && token === request.current) { failedWrite.current = null; setSetup(next); setError(null); }
    } catch {
      if (current() && token === request.current) setError('Couldn’t load muscles. Try again.');
    }
  }, [current]);
  /**
   * Runs one write and re-reads; true when it was saved. A rule the write
   * breaks shows its own words. `retry: false` leaves a failure to the page's
   * own button (an editor's Save), so Retry only re-reads.
   */
  const change = useCallback(async (write: () => Promise<unknown>, { retry = true }: { retry?: boolean } = {}): Promise<boolean> => {
    if (writing.current || !current()) return false;
    writing.current = true;
    setBusy(true);
    try {
      await write();
      if (!current()) return false;
      failedWrite.current = null;
      // The first setup write can migrate legacy weekly targets into the synced map.
      await refreshAccountLocalSyncedPreferences();
      await reload();
      return true;
    } catch (error) {
      if (current()) {
        failedWrite.current = retry ? write : null;
        setError(error instanceof CombinedMuscleError ? error.message : 'Couldn’t save the change. Try again.');
      }
      return false;
    } finally {
      writing.current = false;
      if (current()) setBusy(false);
    }
  }, [current, reload]);
  useEffect(() => {
    live.current = true;
    void Promise.resolve().then(() => { if (current()) return reload(); });
    const stop = subscribeToExerciseCatalogInvalidation(() => { void reload(); });
    return () => { live.current = false; request.current += 1; stop(); };
  }, [current, reload]);
  const retry = () => { void (failedWrite.current ? change(failedWrite.current) : reload()); };
  return { rows: setup?.rows ?? null, definitions: setup?.definitions ?? null, error, busy, change, retry };
}
