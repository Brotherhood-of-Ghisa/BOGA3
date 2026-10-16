import { useEffect, useState } from 'react';
import { useBodyWeightContextRevision } from '@/src/bodyweight/use-context-revision';
import { subscribeToExerciseCatalogInvalidation } from '@/src/exercise-catalog/invalidation';
import { subscribeToLocalWrites } from '@/src/sync/write-nudge';
import type { RmCurveModel } from './model';
import { loadRmCurve, type RmCurveQuery } from './repository';

type ReadState = { key: string; requestKey: string; status: 'loading' | 'ready' | 'error'; data: RmCurveModel | null; error: string | null };
type Options = RmCurveQuery & { accountRevision: number; refreshRevision?: number };

/** Supply the account preference revision; foreign-account/filter results are never exposed. */
export function useRmCurve(options: Options, load: typeof loadRmCurve = loadRmCurve) {
  const key = JSON.stringify([options.accountRevision, options.exerciseDefinitionId, options.start.getTime(), options.end.getTime(),
    options.historyLookbackWeeks, options.gymId === undefined ? 'default' : options.gymId, options.rir ?? null]);
  const bodyRevision = useBodyWeightContextRevision();
  const [sourceRevision, setSourceRevision] = useState(0);
  const [retryRevision, setRetryRevision] = useState(0);
  const requestKey = JSON.stringify([key, bodyRevision, sourceRevision, retryRevision, options.refreshRevision ?? 0]);
  const [state, setState] = useState<ReadState>({ key, requestKey, status: 'loading', data: null, error: null });
  useEffect(() => {
    const changed = () => setSourceRevision(value => value + 1);
    const stopWrites = subscribeToLocalWrites(changed);
    const stopCatalog = subscribeToExerciseCatalogInvalidation(changed);
    return () => { stopWrites(); stopCatalog(); };
  }, []);
  useEffect(() => {
    let active = true;
    const read = () => {
      setState(previous => ({ key, requestKey, status: 'loading', data: previous.key === key ? previous.data : null, error: null }));
      void load(options).then(data => {
        if (active) setState({ key, requestKey, status: 'ready', data, error: null });
      }).catch(cause => {
        if (active) setState(previous => ({ ...previous, status: 'error', error: cause instanceof Error ? cause.message : 'Could not load RM history' }));
      });
    };
    // Match History: paint the loading state before synchronous SQLite work.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => { timer = setTimeout(read, 0); });
    return () => { active = false; cancelAnimationFrame(frame); if (timer !== undefined) clearTimeout(timer); };
  // Same-query refreshes retain data; revisions only invalidate the in-flight read.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, load]);
  return { key, data: state.key === key ? state.data : null,
    status: state.requestKey === requestKey ? state.status : 'loading' as const,
    error: state.requestKey === requestKey ? state.error : null,
    retry: () => setRetryRevision(value => value + 1) };
}
