import { useCallback } from 'react';
import { getMeetLeaderboard, getMeetResults, listMeetTrophies } from './api';
import { groupCacheKeys } from './cache';
import type { MeetResultsWire, MeetTrophyWire } from './meet-results-wire';
import { useGroupOnlinePages } from './use-group-online-pages';
import { useGroupResource } from './use-group-resource';

/** One meet's results: online-only, never cached (full standings are not cached). */
export function useMeetResults(groupId: string, meetId: string, userId: string) {
  const fetchPage = useCallback(() => getMeetResults(groupId, meetId), [groupId, meetId]);
  const pages = useGroupOnlinePages<MeetResultsWire, MeetResultsWire, never>({ userId, groupId, viewKey: `meet-results:${meetId}`, fetchPage,
    selectItems: page => [page], selectCursor: () => null, selectHasMore: () => false, itemKey: () => 'results' });
  return { ...pages, results: pages.firstPage };
}

/** The Meets leaderboard: one row per trophy holder, cache-first. */
export function useMeetLeaderboard(groupId: string, userId: string) {
  const fetcher = useCallback(() => getMeetLeaderboard(groupId), [groupId]);
  return useGroupResource({ userId, cacheKey: groupCacheKeys.meetLeaderboard(groupId), fetcher, evictGroupIdOnNotFound: groupId });
}

/** One member's trophies, newest meet first; paged and never cached. */
export function useMeetTrophies(groupId: string, memberUserId: string, userId: string) {
  const fetchPage = useCallback((cursor: string | null) => listMeetTrophies(groupId, memberUserId, cursor), [groupId, memberUserId]);
  return useGroupOnlinePages({ userId, groupId, viewKey: `meet-trophies:${memberUserId}`, fetchPage,
    selectItems: page => page.trophies, selectCursor: page => page.next_cursor, selectHasMore: page => page.next_cursor !== null,
    itemKey: (trophy: MeetTrophyWire) => trophy.challenge_id });
}
