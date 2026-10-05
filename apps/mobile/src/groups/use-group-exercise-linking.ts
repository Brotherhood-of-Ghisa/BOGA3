// Data for the linking UI: my groups' exercise
// catalogues, cache-first, plus my live links from the local synced table.
//
//   - Links come from `exercise_group_links` (`listLinks()`), so linked-state
//     renders offline and right after a local write (`reloadLinks()`).
//   - Group and group-exercise names come from the versioned `group_cache`
//     mine entry and one exercise-list entry per group. They render from the
//     cache first and refresh on focus and on `refresh()` while online.
//   - A group whose list returns `NOT_FOUND` is evicted (`evictGroup`); links
//     are the member's synced data and are never touched.
//   - It never throws into render; a null `userId` (signed out or auth
//     unconfigured) disables everything, NetInfo included.
//
// Group code never runs inside the sync cycle (C3.10.5).

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect,useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

import { getAuthSnapshot, subscribeToAuthState } from '@/src/auth';
import { bootstrapLocalDataLayer } from '@/src/data/bootstrap';
import { listLinks, type ExerciseGroupLinkRecord } from '@/src/data/exercise-group-links';

import { listCompetitionExercises, listMyGroups, toGroupApiError, type GroupApiError } from './api';
import { getCompetitionCacheGeneration, subscribeCompetitionCache, groupCacheKeys, readGroupCache, writeGroupCache, type GroupCacheDatabase } from './cache';
import type { GroupExerciseCatalog } from './link-view-model';
import type { GroupListMineResult } from './types';
import type { CompetitionExerciseListWire } from './competition-wire';
import { competitionLinkExercise } from './competition-view-model';
import { retireCompetitionAccount } from './competition-cache-retirement';
import { useNetworkOnline } from './use-network-online';

/**
 * The signed-in user id for optional group UI on non-group screens (the
 * recorder, the catalogue). It reads the auth store directly rather than
 * `useAuth()`, so those screens need no `AuthProvider`. Null when signed out
 * or when auth is unconfigured.
 */
export const useGroupLinkingUserId = (): string | null =>
  // Select a primitive: a store getter must return a stable value between
  // changes, and the id (or null) is all this hook exposes.
  useSyncExternalStore(subscribeToAuthState, selectLinkingUserId, selectLinkingUserId);

const selectLinkingUserId = (): string | null => {
  const snapshot = getAuthSnapshot();
  return snapshot.isConfigured && snapshot.user ? snapshot.user.id : null;
};

export type GroupExerciseLinkingState = {
  /** My groups with their cached exercise lists; null until the mine list is known. */
  catalogs: GroupExerciseCatalog[] | null;
  /** Last known target names/archive state, for inactive-link confirmation only. */
  linkedCatalogs: GroupExerciseCatalog[];
  linksReady: boolean;
  linksError: string | null;
  /** My live links. */
  links: ExerciseGroupLinkRecord[];
  /** True once the group-cache read has settled; linksReady tracks local links separately. */
  hydrated: boolean;
  refreshing: boolean;
  /** Offline (NetInfo) or the last refresh failed with `NETWORK`. */
  offline: boolean;
  /** Epoch-ms of the oldest payload behind `catalogs`. */
  lastUpdatedAtMs: number | null;
  error: GroupApiError | null;
  /** Server refresh of my groups and their exercises. Never rejects. */
  refresh: () => Promise<void>;
  /** Re-reads my links after a local write. Never rejects. */
  reloadLinks: () => Promise<void>;
};

type InternalState = {
  identity: string | null;
  catalogs: GroupExerciseCatalog[] | null;
  linkedCatalogs: GroupExerciseCatalog[];
  lastUpdatedAtMs: number | null;
  hydrated: boolean;
  refreshing: boolean;
  networkFailed: boolean;
  error: GroupApiError | null;
};

const initialState = (identity: string | null = null): InternalState => ({
  identity,
  catalogs: null,
  linkedCatalogs: [],
  lastUpdatedAtMs: null,
  hydrated: false,
  refreshing: false,
  networkFailed: false,
  error: null,
});

const readCachedExercises = (database: GroupCacheDatabase, groupId: string, userId: string) =>
  readGroupCache<CompetitionExerciseListWire>(database, groupCacheKeys.groupExercises(groupId), userId);

/** The cached catalogues, or null when the mine list was never cached for this user. */
export const readCachedGroupExerciseCatalogs = (
  database: GroupCacheDatabase,
  userId: string,
): { catalogs: GroupExerciseCatalog[]; fetchedAtMs: number } | null => {
  const mine = readGroupCache<GroupListMineResult>(database, groupCacheKeys.mine, userId);
  if (!mine) {
    return null;
  }
  let fetchedAtMs = mine.fetchedAtMs;
  const catalogs = mine.payload.groups.map((group) => {
    const entry = readCachedExercises(database, group.group_id, userId);
    if (entry) {
      fetchedAtMs = Math.min(fetchedAtMs, entry.fetchedAtMs);
    }
    return { groupId: group.group_id, groupName: group.name, exercises: entry?.payload.exercises.map(competitionLinkExercise) ?? null };
  });
  return { catalogs, fetchedAtMs };
};

export function useGroupExerciseLinking({ userId }: { userId: string | null }): GroupExerciseLinkingState {
  const online = useNetworkOnline(userId !== null);
  const generation = useSyncExternalStore(subscribeCompetitionCache,
    () => getCompetitionCacheGeneration(userId),() => getCompetitionCacheGeneration(userId));
  const identity = `${userId ?? ''}:${generation}`;
  const [state, setState] = useState<InternalState>(() => initialState(identity));
  const visible = state.identity === identity ? state : initialState(identity);
  const visibleRef=useRef(visible);
  useLayoutEffect(() => { visibleRef.current=visible; });
  const focusedEpoch=useRef(generation);
  const [links, setLinks] = useState<ExerciseGroupLinkRecord[]>([]);
  const [linksReady, setLinksReady] = useState(false);
  const [linksError, setLinksError] = useState<string | null>(null);
  const linksSequence = useRef(0);

  const userRef = useRef<string | null>(userId);
  const onlineRef = useRef(online);
  const inFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    onlineRef.current = online;
  }, [online]);

  const reloadLinks = useCallback(async (): Promise<void> => {
    if (!userId) {
      return;
    }
    const sequence = ++linksSequence.current;
    setLinksReady(false);
    setLinksError(null);
    try {
      const next = await listLinks();
      if (userRef.current === userId && sequence === linksSequence.current) {
        setLinks(next);
        setLinksReady(true);
      }
    } catch {
      if (userRef.current === userId && sequence === linksSequence.current) {
        setLinks([]);
        setLinksError("Couldn't read your links on this device. Retry to see their current status.");
      }
    }
  }, [userId]);

  // Hydrate from the cache and the local links whenever the user changes.
  useEffect(() => {
    userRef.current = userId;
    inFlightRef.current = null;
    setState(previous => previous.identity === identity ? previous : { ...initialState(identity),
      linkedCatalogs: previous.identity?.split(':')[0]===userId?previous.linkedCatalogs:[] });
    setLinks([]);
    setLinksReady(false);
    setLinksError(null);
    linksSequence.current++;
    const linkRequests=linksSequence;

    if (!userId) {
      setState({ ...initialState(identity), hydrated: true });
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const database = await bootstrapLocalDataLayer();
        const cached = readCachedGroupExerciseCatalogs(database, userId);
        if (cancelled) return;
        setState((previous) => {
          if (cancelled || userRef.current !== userId || getCompetitionCacheGeneration(userId) !== generation ||
            previous.identity !== identity) return previous;
          return hydratedLinkingState(previous,cached);
        });
      } catch (caught) {
        if (cancelled) return;
        setState(previous=>{
          if(cancelled || userRef.current!==userId || getCompetitionCacheGeneration(userId)!==generation || previous.identity!==identity) return previous;
          return linkingHydrationFailure(previous,caught);
        });
      }
    })();

    return () => {
      cancelled = true;
      linkRequests.current++;
    };
  }, [userId,identity,generation]);

  const refresh = useCallback((): Promise<void> => {
    if (!userId) {
      return Promise.resolve();
    }
    if (inFlightRef.current) {
      return inFlightRef.current;
    }
    if (onlineRef.current === false) {
      return Promise.resolve();
    }

    const requestGeneration = getCompetitionCacheGeneration(userId);
    const isCurrent = () => userRef.current === userId && getCompetitionCacheGeneration(userId) === requestGeneration;
    const hideUnsafe = async (error: GroupApiError) => {
      const cleanup=retireCompetitionAccount(userId);
      if (userRef.current === userId) setState({ ...initialState(`${userId}:${getCompetitionCacheGeneration(userId)}`),hydrated: true,error });
      await cleanup;
    };

    const run = (async () => {
      setState((previous) => ({ ...previous, refreshing: true }));

      let mine: GroupListMineResult;
      try {
        mine = await listMyGroups();
      } catch (caught) {
        const error = toGroupApiError(caught);
        if (!isCurrent()) return;
        if (error.invalidPayload || error.code === 'UPDATE_REQUIRED') { await hideUnsafe(error); return; }
        setState((previous) => ({ ...previous, refreshing: false, networkFailed: error.code === 'NETWORK', error }));
        return;
      }

      const retainedCatalogs=await readRetainedLinkLabels(userId,mine);
      if (!isCurrent()) return;
      const results = await Promise.all(
        mine.groups.map(async (group) => {
          try {
            return { group, result: await listCompetitionExercises(group.group_id), error: null };
          } catch (caught) {
            return { group, result: null, error: toGroupApiError(caught) };
          }
        }),
      );
      if (!isCurrent()) return;

      const unsafe = results.find(result => result.error?.invalidPayload || result.error?.code === 'UPDATE_REQUIRED')?.error;
      if (unsafe) { await hideUnsafe(unsafe); return; }
      const fetchedAtMs = Date.now();
      let error: GroupApiError | null = null;
      let networkFailed = false;
      let catalogs: GroupExerciseCatalog[] = [];
      // A group whose list says NOT_FOUND is gone for me: keep it out of the
      // cached mine list too, so its links stay inactive after a restart.
      const lostGroupIds = new Set(
        results.filter(({ error: groupError }) => groupError?.code === 'NOT_FOUND').map(({ group }) => group.group_id),
      );
      const cleanup=Promise.all([...lostGroupIds].map(groupId=>retireCompetitionAccount(userId,groupId)));
      let publishedGeneration=getCompetitionCacheGeneration(userId);
      await cleanup;
      const stillMine: GroupListMineResult = {
        ...mine,
        groups: mine.groups.filter((group) => !lostGroupIds.has(group.group_id)),
      };
      try {
        const database = await bootstrapLocalDataLayer();
        if (userRef.current!==userId || getCompetitionCacheGeneration(userId)!==publishedGeneration) return;
        for (const { group, result, error: groupError } of results) {
          if (result) {
            writeGroupCache(database, {
              cacheKey: groupCacheKeys.groupExercises(group.group_id),
              userId,
              payload: result,
              fetchedAtMs,
            });
            catalogs.push({ groupId: group.group_id, groupName: group.name, exercises: result.exercises.map(competitionLinkExercise) });
            continue;
          }
          if (groupError?.code === 'NOT_FOUND') continue;
          // Keep the last cached list for a group whose refresh failed.
          networkFailed = networkFailed || groupError?.code === 'NETWORK';
          error = error ?? groupError;
          catalogs.push({
            groupId: group.group_id,
            groupName: group.name,
            exercises: readCachedExercises(database, group.group_id, userId)?.payload.exercises.map(competitionLinkExercise) ?? null,
          });
        }
        // Catalogue policy eviction may advance our own epoch; restore My groups last.
        writeGroupCache(database,{ cacheKey: groupCacheKeys.mine,userId,payload: stillMine,fetchedAtMs });
        publishedGeneration = getCompetitionCacheGeneration(userId);
      } catch (caught) {
        error = toGroupApiError(caught);
        catalogs = stillMine.groups.map((group) => ({ groupId: group.group_id, groupName: group.name, exercises: null }));
      }

      if (userRef.current !== userId || getCompetitionCacheGeneration(userId) !== publishedGeneration) return;
      setState(previous=>refreshedLinkingState(previous,{ userId,generation: publishedGeneration,catalogs,retainedCatalogs,fetchedAtMs,networkFailed,error }));
    })().finally(() => {
      if (inFlightRef.current === run) {
        inFlightRef.current = null;
      }
    });

    inFlightRef.current = run;
    return run;
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void reloadLinks();
      const changed=focusedEpoch.current !== generation;
      focusedEpoch.current=generation;
      const current=visibleRef.current;
      if (current.error?.invalidPayload || current.error?.code === 'UPDATE_REQUIRED') return;
      if (!changed || current.catalogs === null) void refresh();
    }, [refresh, reloadLinks,generation]),
  );

  return {
    catalogs: visible.catalogs,
    linkedCatalogs: visible.linkedCatalogs,
    linksReady: userRef.current === userId && linksReady,
    linksError: userRef.current === userId ? linksError : null,
    links: userRef.current === userId ? links : [],
    hydrated: visible.hydrated,
    refreshing: visible.refreshing,
    offline: userId !== null && (online === false || visible.networkFailed),
    lastUpdatedAtMs: visible.lastUpdatedAtMs,
    error: visible.error,refresh,reloadLinks,
  };
}

function refreshedLinkingState(previous: InternalState,next: { userId: string;generation: number;catalogs: GroupExerciseCatalog[];
  retainedCatalogs: GroupExerciseCatalog[];fetchedAtMs: number;networkFailed: boolean;error: GroupApiError | null }): InternalState {
  return { ...previous,identity: `${next.userId}:${next.generation}`,catalogs: next.catalogs,
    // Names and archive labels remain useful for removing inactive local links.
    linkedCatalogs: [...new Map([...previous.linkedCatalogs,...next.retainedCatalogs,...next.catalogs].map(catalog=>[catalog.groupId,catalog])).values()],
    lastUpdatedAtMs: next.fetchedAtMs,hydrated: true,refreshing: false,networkFailed: next.networkFailed,error: next.error };
}

/** Keep only closed public names/rules/archive labels for removing inactive links.
 * Capture before a denied catalogue retires disposable group projections. */
async function readRetainedLinkLabels(userId: string,mine: GroupListMineResult): Promise<GroupExerciseCatalog[]> {
  try {
    const database=await bootstrapLocalDataLayer();
    return mine.groups.flatMap(group=>{
      const entry=readCachedExercises(database,group.group_id,userId);
      return entry?[{ groupId: group.group_id,groupName: group.name,exercises: entry.payload.exercises.map(competitionLinkExercise) }]:[];
    });
  } catch { return []; }
}

function linkingHydrationFailure(previous: InternalState,caught: unknown): InternalState {
  const unsafe=previous.error?.invalidPayload || previous.error?.code==='UPDATE_REQUIRED';
  return { ...previous,hydrated: true,error: unsafe?previous.error:toGroupApiError(caught) };
}

function hydratedLinkingState(previous: InternalState,cached: ReturnType<typeof readCachedGroupExerciseCatalogs>): InternalState {
  // A refresh that already landed is fresher than the cache: keep it.
  if (!cached || (previous.lastUpdatedAtMs !== null && previous.lastUpdatedAtMs >= cached.fetchedAtMs)) {
    return { ...previous,hydrated: true };
  }
  return { ...previous,hydrated: true,catalogs: cached.catalogs,linkedCatalogs: cached.catalogs,lastUpdatedAtMs: cached.fetchedAtMs };
}
