// Data for the linking UI (M25-T07; design §7): my groups' exercise
// catalogues, cache-first, plus my live links from the local synced table.
//
//   - Links come from `exercise_group_links` (`listLinks()`), so linked-state
//     renders offline and right after a local write (`reloadLinks()`).
//   - Group and group-exercise names come from `group_cache`: `groups:mine`
//     and one `group-exercises:<groupId>` entry per group. They render from the
//     cache first and refresh on focus and on `refresh()` while online.
//   - A group whose list returns `NOT_FOUND` is evicted (`evictGroup`); links
//     are the member's synced data and are never touched.
//   - It never throws into render; a null `userId` (signed out or auth
//     unconfigured) disables everything, NetInfo included.
//
// Group code never runs inside the sync cycle (C3.10.5).

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { getAuthSnapshot, subscribeToAuthState } from '@/src/auth';
import { bootstrapLocalDataLayer } from '@/src/data/bootstrap';
import { listLinks, type ExerciseGroupLinkRecord } from '@/src/data/exercise-group-links';

import { listGroupExercises, listMyGroups, toGroupApiError, type GroupApiError } from './api';
import { evictGroup, groupCacheKeys, readGroupCache, writeGroupCache, type GroupCacheDatabase } from './cache';
import type { GroupExerciseCatalog } from './link-view-model';
import type { GroupExerciseListResult, GroupListMineResult } from './types';
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
  /** My groups with their cached exercise lists; null until `groups:mine` is known. */
  catalogs: GroupExerciseCatalog[] | null;
  /** My live links. */
  links: ExerciseGroupLinkRecord[];
  /** True once the cache and links read for the current user has settled. */
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
  catalogs: GroupExerciseCatalog[] | null;
  lastUpdatedAtMs: number | null;
  hydrated: boolean;
  refreshing: boolean;
  networkFailed: boolean;
  error: GroupApiError | null;
};

const initialState = (): InternalState => ({
  catalogs: null,
  lastUpdatedAtMs: null,
  hydrated: false,
  refreshing: false,
  networkFailed: false,
  error: null,
});

const readCachedExercises = (database: GroupCacheDatabase, groupId: string, userId: string) =>
  readGroupCache<GroupExerciseListResult>(database, groupCacheKeys.groupExercises(groupId), userId);

/** The cached catalogues, or null when `groups:mine` was never cached for this user. */
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
    return { groupId: group.group_id, groupName: group.name, exercises: entry?.payload.exercises ?? null };
  });
  return { catalogs, fetchedAtMs };
};

export function useGroupExerciseLinking({ userId }: { userId: string | null }): GroupExerciseLinkingState {
  const online = useNetworkOnline(userId !== null);
  const [state, setState] = useState<InternalState>(initialState);
  const [links, setLinks] = useState<ExerciseGroupLinkRecord[]>([]);

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
    try {
      const next = await listLinks();
      if (userRef.current === userId) {
        setLinks(next);
      }
    } catch (caught) {
      if (userRef.current === userId) {
        setState((previous) => ({ ...previous, error: toGroupApiError(caught) }));
      }
    }
  }, [userId]);

  // Hydrate from the cache and the local links whenever the user changes.
  useEffect(() => {
    userRef.current = userId;
    inFlightRef.current = null;
    setState(initialState());
    setLinks([]);

    if (!userId) {
      setState({ ...initialState(), hydrated: true });
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const database = await bootstrapLocalDataLayer();
        const cached = readCachedGroupExerciseCatalogs(database, userId);
        const nextLinks = await listLinks();
        if (cancelled) return;
        setLinks(nextLinks);
        setState((previous) => {
          // A refresh that already landed is fresher than the cache: keep it.
          const keepFresher =
            cached === null || (previous.lastUpdatedAtMs !== null && previous.lastUpdatedAtMs >= cached.fetchedAtMs);
          return keepFresher
            ? { ...previous, hydrated: true }
            : { ...previous, hydrated: true, catalogs: cached.catalogs, lastUpdatedAtMs: cached.fetchedAtMs };
        });
      } catch (caught) {
        if (cancelled) return;
        setState((previous) => ({ ...previous, hydrated: true, error: toGroupApiError(caught) }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

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

    const isCurrent = () => userRef.current === userId;

    const run = (async () => {
      setState((previous) => ({ ...previous, refreshing: true }));

      let mine: GroupListMineResult;
      try {
        mine = await listMyGroups();
      } catch (caught) {
        const error = toGroupApiError(caught);
        if (!isCurrent()) return;
        setState((previous) => ({ ...previous, refreshing: false, networkFailed: error.code === 'NETWORK', error }));
        return;
      }

      const results = await Promise.all(
        mine.groups.map(async (group) => {
          try {
            return { group, result: await listGroupExercises(group.group_id), error: null };
          } catch (caught) {
            return { group, result: null, error: toGroupApiError(caught) };
          }
        }),
      );
      if (!isCurrent()) return;

      const fetchedAtMs = Date.now();
      let error: GroupApiError | null = null;
      let networkFailed = false;
      let catalogs: GroupExerciseCatalog[] = [];
      try {
        const database = await bootstrapLocalDataLayer();
        writeGroupCache(database, { cacheKey: groupCacheKeys.mine, userId, payload: mine, fetchedAtMs });
        for (const { group, result, error: groupError } of results) {
          if (result) {
            writeGroupCache(database, {
              cacheKey: groupCacheKeys.groupExercises(group.group_id),
              userId,
              payload: result,
              fetchedAtMs,
            });
            catalogs.push({ groupId: group.group_id, groupName: group.name, exercises: result.exercises });
            continue;
          }
          if (groupError?.code === 'NOT_FOUND') {
            evictGroup(database, group.group_id);
            continue;
          }
          // Keep the last cached list for a group whose refresh failed.
          networkFailed = networkFailed || groupError?.code === 'NETWORK';
          error = error ?? groupError;
          catalogs.push({
            groupId: group.group_id,
            groupName: group.name,
            exercises: readCachedExercises(database, group.group_id, userId)?.payload.exercises ?? null,
          });
        }
      } catch (caught) {
        error = toGroupApiError(caught);
        catalogs = mine.groups.map((group) => ({ groupId: group.group_id, groupName: group.name, exercises: null }));
      }

      if (!isCurrent()) return;
      setState((previous) => ({
        ...previous,
        catalogs,
        lastUpdatedAtMs: fetchedAtMs,
        hydrated: true,
        refreshing: false,
        networkFailed,
        error,
      }));
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
      void refresh();
    }, [refresh, reloadLinks]),
  );

  return {
    catalogs: state.catalogs,
    links,
    hydrated: state.hydrated,
    refreshing: state.refreshing,
    offline: userId !== null && (online === false || state.networkFailed),
    lastUpdatedAtMs: state.lastUpdatedAtMs,
    error: state.error,
    refresh,
    reloadLinks,
  };
}
