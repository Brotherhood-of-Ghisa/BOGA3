import { useCallback, useEffect, useRef, useState } from 'react';
import { listMuscleReportRows } from '@/src/data/muscle-report-settings';
import type { MuscleReportRow } from '@/src/data/muscle-report-presets';
import { subscribeToExerciseCatalogInvalidation } from '@/src/exercise-catalog/invalidation';
import { getAccountLocalPreferenceAccountRevision } from '@/src/preferences/account-local';

/** Account-scoped reads ignore responses from an older request or account. */
export function useMuscleSetup(accountRevision: number) {
  const [rows, setRows] = useState<MuscleReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  const request = useRef(0);
  const writing = useRef(false);
  const failedWrite = useRef<(() => Promise<void>) | null>(null);
  const current = useCallback(() => live.current && accountRevision === getAccountLocalPreferenceAccountRevision(), [accountRevision]);
  const reload = useCallback(async () => {
    const token = ++request.current;
    try {
      const next = await listMuscleReportRows();
      if (current() && token === request.current) { failedWrite.current = null; setRows(next); setError(null); }
    } catch {
      if (current() && token === request.current) setError('Couldn’t load muscles. Try again.');
    }
  }, [current]);
  const change = useCallback(async (write: () => Promise<void>) => {
    if (writing.current || !current()) return;
    writing.current = true;
    setBusy(true);
    try {
      await write();
      if (!current()) return;
      failedWrite.current = null;
      await reload();
    } catch {
      if (current()) {
        failedWrite.current = write;
        setError('Couldn’t save the change. Try again.');
      }
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
  return { rows, error, busy, change, retry };
}
