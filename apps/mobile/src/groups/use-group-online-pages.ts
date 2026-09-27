// Online-only paged group reads (`docs/specs/tech/groups-contract.md` §6.1, §7;
// M25 design §7): the full board and its history. Unlike `useGroupResource`
// nothing is cached, like the stream's older pages.
//
//   - the first page loads on mount, when the view identity changes (a toggle),
//     on focus, and on `refresh()`; there is no 30 s poll;
//   - a refresh replaces every loaded page with the new first page;
//   - `loadMore` sends the last `next_cursor` verbatim; it is never requested
//     offline or at the end, and a failure is kept for a Retry footer;
//   - items are deduplicated by `itemKey`, keeping the first seen, so a rank
//     shift between pages never shows a row twice;
//   - a response for a stale identity, or one overtaken by a refresh, is dropped;
//   - `NOT_FOUND: group exercise not found` sets `exerciseMissing`; any other
//     `NOT_FOUND` evicts the group's cache and sets `lostAccess`.
//
// Group code never runs inside the sync cycle (C3.10.5).

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { bootstrapLocalDataLayer } from '@/src/data/bootstrap';

import { GroupApiError, isGroupExerciseNotFound, toGroupApiError } from './api';
import { evictGroup } from './cache';
import { useNetworkOnline } from './use-network-online';

export type GroupOnlinePagesOptions<TPage, TItem, TCursor> = {
  /** Signed-in user id. Null disables every request. */
  userId: string | null;
  /** The group the pages belong to; evicted on a group `NOT_FOUND`. */
  groupId: string;
  /** Everything that identifies the view (exercise, toggles). A change resets the pages. Null disables. */
  viewKey: string | null;
  /** One page: `null` = the first page, else the previous page's cursor. */
  fetchPage: (cursor: TCursor | null) => Promise<TPage>;
  selectItems: (page: TPage) => TItem[];
  selectCursor: (page: TPage) => TCursor | null;
  selectHasMore: (page: TPage) => boolean;
  itemKey: (item: TItem) => string;
};

export type GroupOnlinePagesState<TPage, TItem> = {
  /** The latest first page (its non-item fields, e.g. the board's exercise). */
  firstPage: TPage | null;
  items: TItem[];
  /** Epoch-ms of the latest successful first page, for the offline marker. */
  loadedAtMs: number | null;
  refreshing: boolean;
  offline: boolean;
  /** The latest first-page failure, cleared by the next success. */
  error: GroupApiError | null;
  lostAccess: boolean;
  exerciseMissing: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: GroupApiError | null;
  /** Reloads the first page. Never rejects. */
  refresh: () => Promise<void>;
  /** Loads the next page. Never rejects; a no-op offline, at the end, or while loading. */
  loadMore: () => Promise<void>;
};

type InternalState<TPage, TItem, TCursor> = {
  // The view the state belongs to: another identity reads as `initialState`.
  identity: string | null;
  firstPage: TPage | null;
  items: TItem[];
  cursor: TCursor | null;
  hasMore: boolean;
  loadedAtMs: number | null;
  refreshing: boolean;
  networkFailed: boolean;
  error: GroupApiError | null;
  lostAccess: boolean;
  exerciseMissing: boolean;
  loadingMore: boolean;
  loadMoreError: GroupApiError | null;
};

const initialState = <TPage, TItem, TCursor>(identity: string | null): InternalState<TPage, TItem, TCursor> => ({
  identity,
  firstPage: null,
  items: [],
  cursor: null,
  hasMore: false,
  loadedAtMs: null,
  refreshing: false,
  networkFailed: false,
  error: null,
  lostAccess: false,
  exerciseMissing: false,
  loadingMore: false,
  loadMoreError: null,
});

/** `existing` then the new items whose key is not already present (first seen wins). */
export const appendUniqueByKey = <TItem>(existing: TItem[], next: TItem[], itemKey: (item: TItem) => string): TItem[] => {
  const seen = new Set(existing.map(itemKey));
  const merged = [...existing];
  for (const item of next) {
    const key = itemKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }
  return merged;
};

export function useGroupOnlinePages<TPage, TItem, TCursor>({
  userId,
  groupId,
  viewKey,
  fetchPage,
  selectItems,
  selectCursor,
  selectHasMore,
  itemKey,
}: GroupOnlinePagesOptions<TPage, TItem, TCursor>): GroupOnlinePagesState<TPage, TItem> {
  const online = useNetworkOnline();
  const identity = userId && viewKey ? `${userId}\u0000${groupId}\u0000${viewKey}` : null;
  const [stored, setStored] = useState<InternalState<TPage, TItem, TCursor>>(() => initialState(identity));
  // A new view forgets everything; its first page loads on the identity effect.
  const state = stored.identity === identity ? stored : initialState<TPage, TItem, TCursor>(identity);
  // Writes for `identity`, starting from empty if the stored state is another view's.
  const setState = useCallback(
    (
      next:
        | InternalState<TPage, TItem, TCursor>
        | ((previous: InternalState<TPage, TItem, TCursor>) => InternalState<TPage, TItem, TCursor>),
    ) =>
      setStored((previous) => {
        const base = previous.identity === identity ? previous : initialState<TPage, TItem, TCursor>(identity);
        return typeof next === 'function' ? next(base) : next;
      }),
    [identity],
  );

  // Bumped on every identity change and every first-page request: a response
  // from an older generation is dropped.
  const generationRef = useRef(0);
  const identityRef = useRef<string | null>(identity);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const loadingMoreRef = useRef(false);
  const onlineRef = useRef(online);
  const stateRef = useRef(state);
  const callbacksRef = useRef({ fetchPage, selectItems, selectCursor, selectHasMore, itemKey });

  // Before any effect or handler reads them.
  useLayoutEffect(() => {
    onlineRef.current = online;
    stateRef.current = state;
    callbacksRef.current = { fetchPage, selectItems, selectCursor, selectHasMore, itemKey };
  });

  const handleNotFound = useCallback(
    async (error: GroupApiError, isCurrent: () => boolean) => {
      if (isGroupExerciseNotFound(error)) {
        setState({ ...initialState<TPage, TItem, TCursor>(identity), exerciseMissing: true });
        return;
      }
      let evictionError: GroupApiError | null = null;
      try {
        evictGroup(await bootstrapLocalDataLayer(), groupId);
      } catch (caught) {
        evictionError = toGroupApiError(caught);
      }
      if (!isCurrent()) return;
      setState({ ...initialState<TPage, TItem, TCursor>(identity), lostAccess: true, error: evictionError ?? error });
    },
    [groupId, identity, setState],
  );

  const refresh = useCallback((): Promise<void> => {
    if (identity === null) {
      return Promise.resolve();
    }
    if (inFlightRef.current) {
      return inFlightRef.current;
    }
    if (onlineRef.current === false) {
      return Promise.resolve();
    }

    generationRef.current += 1;
    const generation = generationRef.current;
    const isCurrent = () => generationRef.current === generation && identityRef.current === identity;
    loadingMoreRef.current = false;

    const run = (async () => {
      // An older page in flight is overtaken: its response is dropped, so clear its spinner here.
      setState((previous) => ({ ...previous, refreshing: true, loadingMore: false, loadMoreError: null }));
      const callbacks = callbacksRef.current;
      let page: TPage;
      try {
        page = await callbacks.fetchPage(null);
      } catch (caught) {
        const error = toGroupApiError(caught);
        if (!isCurrent()) return;
        if (error.code === 'NOT_FOUND') {
          await handleNotFound(error, isCurrent);
          return;
        }
        setState((previous) => ({ ...previous, refreshing: false, networkFailed: error.code === 'NETWORK', error }));
        return;
      }
      if (!isCurrent()) return;
      setState({
        ...initialState<TPage, TItem, TCursor>(identity),
        firstPage: page,
        items: appendUniqueByKey([], callbacks.selectItems(page), callbacks.itemKey),
        cursor: callbacks.selectCursor(page),
        hasMore: callbacks.selectHasMore(page),
        loadedAtMs: Date.now(),
      });
    })().finally(() => {
      if (inFlightRef.current === run) {
        inFlightRef.current = null;
      }
    });

    inFlightRef.current = run;
    return run;
  }, [identity, handleNotFound, setState]);

  // A new view: drop the old view's requests, then load its first page (the
  // state already reads empty for it).
  useEffect(() => {
    identityRef.current = identity;
    generationRef.current += 1;
    inFlightRef.current = null;
    loadingMoreRef.current = false;
  }, [identity]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const loadMore = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    if (
      identity === null ||
      onlineRef.current === false ||
      loadingMoreRef.current ||
      inFlightRef.current !== null ||
      !current.hasMore ||
      current.cursor === null
    ) {
      return;
    }
    const generation = generationRef.current;
    const isCurrent = () => generationRef.current === generation && identityRef.current === identity;
    const cursor = current.cursor;
    loadingMoreRef.current = true;
    setState((previous) => ({ ...previous, loadingMore: true, loadMoreError: null }));
    const callbacks = callbacksRef.current;
    try {
      const page = await callbacks.fetchPage(cursor);
      if (!isCurrent()) return;
      setState((previous) => ({
        ...previous,
        items: appendUniqueByKey(previous.items, callbacks.selectItems(page), callbacks.itemKey),
        cursor: callbacks.selectCursor(page),
        hasMore: callbacks.selectHasMore(page),
        loadingMore: false,
      }));
    } catch (caught) {
      const error = toGroupApiError(caught);
      if (!isCurrent()) return;
      if (error.code === 'NOT_FOUND') {
        await handleNotFound(error, isCurrent);
        return;
      }
      setState((previous) => ({ ...previous, loadingMore: false, loadMoreError: error }));
    } finally {
      if (isCurrent()) {
        loadingMoreRef.current = false;
      }
    }
  }, [identity, handleNotFound, setState]);

  return {
    firstPage: state.firstPage,
    items: state.items,
    loadedAtMs: state.loadedAtMs,
    refreshing: state.refreshing,
    offline: online === false || state.networkFailed,
    error: state.error,
    lostAccess: state.lostAccess,
    exerciseMissing: state.exerciseMissing,
    hasMore: state.hasMore && state.cursor !== null,
    loadingMore: state.loadingMore,
    loadMoreError: state.loadMoreError,
    refresh,
    loadMore,
  };
}
