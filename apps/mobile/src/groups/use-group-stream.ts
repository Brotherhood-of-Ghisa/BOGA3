// The group stream feed (`docs/specs/tech/groups-contract.md` §4.2, §6.2, §7):
// the cache-first first page from `useGroupResource`, plus older pages loaded
// online on demand (infinite scroll, FR 6). Older pages are never cached.
//
// A refresh (focus, 30 s poll, pull-to-refresh) replaces the first page. Older
// pages already loaded are kept only for items that sort after the new first
// page's last item, so a refreshed first page never leaves a gap and edits or
// deletes inside it always show.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { GroupApiError, getCompetitionStream, toGroupApiError } from './api';
import { groupCacheKeys, getCompetitionCacheGeneration,observeGroupCompetitionPolicy } from './cache';
import type { CompetitionStreamWire as GroupStreamResult, CompetitionStreamItemWire as StreamItem } from './competition-wire';
import { bootstrapLocalDataLayer } from '@/src/data/bootstrap';
import { retireCompetitionAccount } from './competition-cache-retirement';
import { useGroupResource, type GroupResourceState } from './use-group-resource';

type StreamCursor = string;

// An item or a cursor; a server cursor may name a kind this build drops.
type StreamOrderKey = { sort_at_ms: number;kind: string;key: string;event?: string | { kind: string } };
const serverStreamKind = (item: StreamOrderKey) => item.kind === 'competition'
  ? typeof item.event === 'object' ? item.event.kind === 'unlink' ? 'link' : item.event.kind : item.kind : item.kind;

/** Contract order: `sort_at_ms desc, kind, key desc`. Negative = `a` first. */
export const compareStreamOrder = (a: StreamOrderKey, b: StreamOrderKey): number => {
  if (a.sort_at_ms !== b.sort_at_ms) return b.sort_at_ms - a.sort_at_ms;
  const aKind=serverStreamKind(a),bKind=serverStreamKind(b);
  if (aKind !== bKind) return aKind < bKind ? -1 : 1;
  if (a.key !== b.key) return a.key < b.key ? 1 : -1;
  return 0;
};

type OlderPages = { items: StreamItem[]; cursor: StreamCursor | null; hasMore: boolean };

type OlderPagesState = {
  identity: string;
  older: OlderPages | null;
  loadingMore: boolean;
  /** The last older-page failure; the footer offers Retry. */
  loadMoreError: GroupApiError | null;
};

const emptyOlderPages = (identity: string): OlderPagesState => ({
  identity,
  older: null,
  loadingMore: false,
  loadMoreError: null,
});

/** First page, then the older items that sort strictly after its boundary (deduplicated by key). */
export const mergeStreamPages = (firstPage: GroupStreamResult, older: OlderPages | null): StreamItem[] => {
  if (!older || !firstPage.has_more || firstPage.items.length === 0) {
    return firstPage.items;
  }
  const boundary = firstPage.items[firstPage.items.length - 1];
  const seen = new Set(firstPage.items.map((item) => `${item.kind}:${item.key}`));
  const tail = older.items.filter((item) => !seen.has(`${item.kind}:${item.key}`) && compareStreamOrder(item, boundary) > 0);
  return [...firstPage.items, ...tail];
};

export type GroupStreamState = GroupResourceState<GroupStreamResult> & {
  items: StreamItem[];
  hasMore: boolean;
  loadingMore: boolean;
  /** The last older-page failure; the footer offers Retry. */
  loadMoreError: GroupApiError | null;
  /** Loads the next older page online. Never rejects; a no-op while offline or at the end. */
  loadMore: () => Promise<void>;
};

/** One group's stream. A null `userId` or `groupId` reads nothing. */
export function useGroupStream({ userId, groupId }: { userId: string | null; groupId: string | null }): GroupStreamState {
  const fetcher = useCallback(() => getCompetitionStream(groupId ?? ''), [groupId]);
  const resource = useGroupResource<GroupStreamResult>({
    userId,
    cacheKey: groupId ? groupCacheKeys.stream(groupId) : null,
    fetcher,
    evictGroupIdOnNotFound: groupId,
  });

  const baseIdentity=`${userId ?? ''} ${groupId ?? ''}`;
  const [lostIdentity,setLostIdentity]=useState<{ identity: string;page: GroupStreamResult | null } | null>(null);
  if(lostIdentity && resource.data && resource.data!==lostIdentity.page && !resource.lostAccess && !resource.error) setLostIdentity(null);
  const generation = getCompetitionCacheGeneration(userId);
  const identity = `${userId ?? ''} ${groupId ?? ''} ${generation}`;
  // Older pages belong to one user + group: another identity reads as empty.
  const [olderState, setOlderState] = useState<OlderPagesState>(() => emptyOlderPages(identity));
  // A return to an earlier group starts empty too, as a first visit does.
  if (olderState.identity !== identity) {
    setOlderState(emptyOlderPages(identity));
  }
  const { older, loadingMore, loadMoreError } =
    olderState.identity === identity ? olderState : emptyOlderPages(identity);
  const updateOlderState = useCallback(
    (requestIdentity: string, patch: (previous: OlderPagesState) => Partial<OlderPagesState>) =>
      setOlderState((previous) => {
        const base = previous.identity === requestIdentity ? previous : emptyOlderPages(requestIdentity);
        return { ...base, ...patch(base) };
      }),
    [],
  );
  const identityRef = useRef(identity);
  const loadingRef = useRef(false);

  useEffect(() => {
    identityRef.current = identity;
    loadingRef.current = false;
  }, [identity]);

  const firstPage = resource.data;
  const items = useMemo(() => (firstPage ? mergeStreamPages(firstPage, older) : []), [firstPage, older]);
  const useOlder = older !== null && firstPage?.has_more === true;
  const cursor = useOlder ? older.cursor : (firstPage?.next_cursor ?? null);
  const hasMore = firstPage !== null && (useOlder ? older.hasMore : firstPage.has_more) && cursor !== null;
  const offline = resource.offline;

  const loadMore = useCallback(async (): Promise<void> => {
    if (!hasMore || loadingRef.current || offline || cursor === null || groupId === null) {
      return;
    }
    const requestIdentity = identityRef.current;
    const isCurrent = () => identityRef.current === requestIdentity && getCompetitionCacheGeneration(userId) === generation;
    loadingRef.current = true;
    updateOlderState(requestIdentity, () => ({ loadingMore: true, loadMoreError: null }));
    try {
      const page = await getCompetitionStream(groupId,cursor);
      if (!isCurrent()) return;
      const database=await bootstrapLocalDataLayer();
      if (!isCurrent() || !userId) return;
      const publishedGeneration=observeGroupCompetitionPolicy(database,groupId,userId,page);
      if (publishedGeneration !== generation) { void resource.refresh(); return; }
      updateOlderState(requestIdentity, ({ older: previous }) => ({
        older: {
          items: [...(useOlder && previous ? previous.items : []), ...page.items],
          cursor: page.next_cursor,
          hasMore: page.has_more,
        },
      }));
    } catch (caught) {
      if (!isCurrent()) return;
      const error = toGroupApiError(caught);
      if (error.code === 'NOT_FOUND') {
        const cleanup=userId?retireCompetitionAccount(userId,groupId):Promise.resolve();
        setLostIdentity({ identity: baseIdentity,page: resource.data });
        await cleanup;
        return;
      }
      if (userId && (error.invalidPayload || error.code === 'UPDATE_REQUIRED')) {
        await retireCompetitionAccount(userId);
        return;
      }
      updateOlderState(requestIdentity, () => ({ loadMoreError: error }));
    } finally {
      if (isCurrent()) {
        loadingRef.current = false;
        updateOlderState(requestIdentity, () => ({ loadingMore: false }));
      }
    }
  }, [cursor, groupId, hasMore, offline, updateOlderState, useOlder,userId,generation,baseIdentity,resource]);

  return { ...resource,lostAccess: resource.lostAccess || lostIdentity?.identity === baseIdentity,
    items: lostIdentity?.identity === baseIdentity ? [] : items,hasMore: lostIdentity?.identity !== baseIdentity && hasMore,loadingMore,loadMoreError,loadMore };
}
