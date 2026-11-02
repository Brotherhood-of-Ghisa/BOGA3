// Cache-first group read hook (`docs/specs/tech/groups-contract.md`).
//
//   - renders the cached payload for (user, cacheKey) first: on the first
//     render when this app run already read or wrote it, else once SQLite is
//     read; a refresh never hides it behind a loading state;
//   - refreshes on focus, every 30 s while focused, on `refresh()`, and
//     2 s and 6 s after a sync cycle pushes this device's rows (once the
//     evaluator has usually caught up), including a push just before focus;
//   - `offline` is true when the device is offline or the last refresh failed
//     with `NETWORK`; cached data and `lastUpdatedAtMs` stay;
//   - `NOT_FOUND` evicts the entry (plus the group's entries when
//     `evictGroupIdOnNotFound` is set) and surfaces `lostAccess`;
//   - it never throws into render: every failure is a typed `error` state.
//
// Group code never runs inside the sync cycle: this hook only reads
// NetInfo and the local cache and calls the group RPC it is given.

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect,useRef, useState, useSyncExternalStore } from 'react';

import { bootstrapLocalDataLayer } from '@/src/data/bootstrap';
import { getLastRowsPushedAtMs, subscribeToRowsPushed } from '@/src/sync/push-signal';

import { GroupApiError, toGroupApiError } from './api';
import { deleteGroupCacheEntry, getCompetitionCacheGeneration, peekGroupCache,
  readGroupCache, subscribeCompetitionCache, writeGroupCache } from './cache';
import { retireCompetitionAccount } from './competition-cache-retirement';
import { useNetworkOnline } from './use-network-online';

export const GROUP_RESOURCE_POLL_INTERVAL_MS = 30_000;
/** Delays after a push that reads refresh at: the evaluator usually lands within the first. */
export const GROUP_RESOURCE_AFTER_PUSH_REFRESH_MS = [2_000, 6_000] as const;

export type GroupResourceOptions<T> = {
  /** Signed-in user id (`useAuth().user?.id`). Null disables reads and fetches. */
  userId: string | null;
  /** `groupCacheKeys.*`. Null disables reads and fetches. */
  cacheKey: string | null;
  /** The group RPC to run on refresh (an `api.ts` read). */
  fetcher: () => Promise<T>;
  /** On `NOT_FOUND`, also evict this group's entries (`evictGroup`). */
  evictGroupIdOnNotFound?: string | null;
  pollIntervalMs?: number;
};

export type GroupResourceState<T> = {
  data: T | null;
  /** Epoch-ms of the payload in `data` (cache or last successful refresh). */
  lastUpdatedAtMs: number | null;
  /** True once the cache read for the current (user, key) has settled. */
  hydrated: boolean;
  refreshing: boolean;
  offline: boolean;
  /** The latest failure, cleared by the next successful refresh. */
  error: GroupApiError | null;
  /** The last refresh returned `NOT_FOUND`: the caller is no longer a member (or it never existed). */
  lostAccess: boolean;
  /** Pull-to-refresh. Never rejects. */
  refresh: () => Promise<void>;
};

type InternalState<T> = {
  identity: string | null;
  generation: number;
  data: T | null;
  lastUpdatedAtMs: number | null;
  hydrated: boolean;
  refreshing: boolean;
  networkFailed: boolean;
  error: GroupApiError | null;
  lostAccess: boolean;
};

const initialState = <T>(identity: string | null, generation: number): InternalState<T> => ({
  identity,
  generation,
  data: null,
  lastUpdatedAtMs: null,
  hydrated: false,
  refreshing: false,
  networkFailed: false,
  error: null,
  lostAccess: false,
});

/** The state a (user, key) starts in: its payload from this app run's cache memory, if any. */
const cachedInitialState = <T>(identity: string | null, generation: number,
  userId: string | null, cacheKey: string | null): InternalState<T> => {
  const entry = identity && userId && cacheKey ? peekGroupCache<T>(cacheKey, userId) : null;
  return entry
    ? { ...initialState<T>(identity, generation), data: entry.payload, lastUpdatedAtMs: entry.fetchedAtMs, hydrated: true }
    : initialState<T>(identity, generation);
};

/** Arms one refresh per after-push delay still ahead of `pushedAtMs`; returns their handles. */
const armAfterPushRefreshes = (pushedAtMs: number, refresh: () => void): ReturnType<typeof setTimeout>[] =>
  GROUP_RESOURCE_AFTER_PUSH_REFRESH_MS
    .map(delay => pushedAtMs + delay - Date.now())
    .filter(wait => wait > 0)
    .map(wait => setTimeout(refresh, wait));

export function useGroupResource<T>({
  userId,
  cacheKey,
  fetcher,
  evictGroupIdOnNotFound = null,
  pollIntervalMs = GROUP_RESOURCE_POLL_INTERVAL_MS,
}: GroupResourceOptions<T>): GroupResourceState<T> {
  const online = useNetworkOnline();
  const identity = userId && cacheKey ? `${userId}\u0000${cacheKey}` : null;
  const generation = useSyncExternalStore(subscribeCompetitionCache,
    () => getCompetitionCacheGeneration(userId), () => getCompetitionCacheGeneration(userId));
  const [state, setState] = useState<InternalState<T>>(() => cachedInitialState(identity,generation,userId,cacheKey));
  // Account, group and disclosure changes hide prior data in this render.
  const visible = state.identity === identity && state.generation === generation
    ? state : cachedInitialState<T>(identity,generation,userId,cacheKey);
  const visibleRef=useRef(visible);
  useLayoutEffect(() => { visibleRef.current=visible; });
  const focusedEpoch=useRef(generation);
  const identityRef = useRef<string | null>(identity);
  const fetcherRef = useRef(fetcher);
  const onlineRef = useRef(online);
  const inFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  useEffect(() => {
    onlineRef.current = online;
  }, [online]);

  // Hydrate from the cache whenever the (user, key) identity changes.
  useEffect(() => {
    identityRef.current = identity;
    inFlightRef.current = null;
    setState(previous => previous.identity === identity && previous.generation === generation
      ? previous : cachedInitialState<T>(identity,generation,userId,cacheKey));

    if (!userId || !cacheKey || identity === null) {
      setState({ ...initialState<T>(identity,generation), hydrated: true });
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const database = await bootstrapLocalDataLayer();
        const entry = readGroupCache<T>(database, cacheKey, userId);
        if (cancelled) return;
        setState((previous) => {
          if (cancelled || identityRef.current !== identity || getCompetitionCacheGeneration(userId) !== generation ||
            previous.identity !== identity || previous.generation !== generation) return previous;
          // A refresh that already landed is fresher than the cache: keep it.
          const keepFresher =
            entry === null ||
            (previous.lastUpdatedAtMs !== null && previous.lastUpdatedAtMs >= entry.fetchedAtMs);
          return keepFresher
            ? { ...previous, hydrated: true }
            : { ...previous, hydrated: true, data: entry.payload, lastUpdatedAtMs: entry.fetchedAtMs };
        });
      } catch (error) {
        if (cancelled) return;
        setState(previous=>{
          if(cancelled || identityRef.current!==identity || getCompetitionCacheGeneration(userId)!==generation ||
            previous.identity!==identity || previous.generation!==generation) return previous;
          const protocolFailure=previous.lostAccess || previous.error?.invalidPayload || previous.error?.code==='UPDATE_REQUIRED';
          return { ...previous,hydrated: true,error: protocolFailure?previous.error:toGroupApiError(error) };
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [identity, userId, cacheKey, generation]);

  const refresh = useCallback((): Promise<void> => {
    if (!userId || !cacheKey || identity === null) {
      return Promise.resolve();
    }
    if (inFlightRef.current) {
      return inFlightRef.current;
    }
    // Known offline: no request; `offline` is already derived from NetInfo.
    if (onlineRef.current === false) {
      return Promise.resolve();
    }

    const requestGeneration = getCompetitionCacheGeneration(userId);
    const isCurrent = () => identityRef.current === identity && getCompetitionCacheGeneration(userId) === requestGeneration;

    const run = (async () => {
      setState((previous) => ({ ...previous, refreshing: true }));

      let payload: T;
      try {
        payload = await fetcherRef.current();
      } catch (caught) {
        const error = toGroupApiError(caught);
        if (!isCurrent()) return;

        if (error.code === 'UPDATE_REQUIRED' || error.invalidPayload) {
          const cleanup=retireCompetitionAccount(userId);
          if (identityRef.current !== identity) return;
          setState({ ...initialState<T>(identity,getCompetitionCacheGeneration(userId)),
            hydrated: true, error });
          await cleanup;
          return;
        }

        if (error.code === 'NOT_FOUND') {
          const cleanup=evictGroupIdOnNotFound?retireCompetitionAccount(userId,evictGroupIdOnNotFound):
            bootstrapLocalDataLayer().then(database=>deleteGroupCacheEntry(database,cacheKey)).catch(()=>undefined);
          if (identityRef.current !== identity) return;
          const publishedGeneration=getCompetitionCacheGeneration(userId);
          setState(previous=>identityRef.current===identity && getCompetitionCacheGeneration(userId)===publishedGeneration
            ?{ ...initialState<T>(identity,publishedGeneration),hydrated: true,lostAccess: true,error }:previous);
          await cleanup;
          return;
        }

        setState((previous) => ({
          ...previous,
          refreshing: false,
          networkFailed: error.code === 'NETWORK',
          error,
        }));
        return;
      }

      if (!isCurrent()) return;
      const fetchedAtMs = Date.now();
      try {
        const database = await bootstrapLocalDataLayer();
        if (!isCurrent()) return;
        writeGroupCache(database,{ cacheKey,userId,payload,fetchedAtMs });
        const publishedGeneration=getCompetitionCacheGeneration(userId);
        setState(previous => {
          if (identityRef.current !== identity || getCompetitionCacheGeneration(userId) !== publishedGeneration) return previous;
          return { ...initialState<T>(identity,publishedGeneration),data: payload,lastUpdatedAtMs: fetchedAtMs,hydrated: true };
        });
      } catch (writeCaught) {
        if (!isCurrent()) return;
        setState(previous => ({ ...previous,refreshing: false,error: toGroupApiError(writeCaught) }));
      }
    })().finally(() => {
      if (inFlightRef.current === run) {
        inFlightRef.current = null;
      }
    });

    inFlightRef.current = run;
    return run;
  }, [identity, userId, cacheKey, evictGroupIdOnNotFound]);

  useFocusEffect(
    useCallback(() => {
      const changed=focusedEpoch.current !== generation;
      focusedEpoch.current=generation;
      const current=visibleRef.current;
      if (current.error?.invalidPayload || current.error?.code === 'UPDATE_REQUIRED') return;
      if (!changed || current.data === null) void refresh();
      const handle = setInterval(() => {
        void refresh();
      }, pollIntervalMs);
      // A push shortly before focus still has its later refreshes to come.
      const refreshNow = () => void refresh();
      const lastPushedAtMs = getLastRowsPushedAtMs();
      let afterPush = lastPushedAtMs === null ? [] : armAfterPushRefreshes(lastPushedAtMs, refreshNow);
      const unsubscribe = subscribeToRowsPushed(() => {
        afterPush.forEach(clearTimeout);
        afterPush = armAfterPushRefreshes(Date.now(), refreshNow);
      });
      return () => {
        clearInterval(handle);
        afterPush.forEach(clearTimeout);
        unsubscribe();
      };
    }, [refresh, pollIntervalMs,generation]),
  );

  return {
    data: visible.data,
    lastUpdatedAtMs: visible.lastUpdatedAtMs,
    hydrated: visible.hydrated,
    refreshing: visible.refreshing,
    offline: online === false || visible.networkFailed,
    error: visible.error,
    lostAccess: visible.lostAccess,
    refresh,
  };
}
