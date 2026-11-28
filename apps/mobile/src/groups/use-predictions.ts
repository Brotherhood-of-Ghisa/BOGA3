import { useCallback } from 'react';
import { getPredictionBoard, getPredictionRanking, getPredictionSetting, getPredictionThread, listPredictionHistory } from './api';
import { groupCacheKeys } from './cache';
import type { PredictionHistoryWeekWire, PredictionHistoryWire } from './prediction-wire';
import { useGroupOnlinePages } from './use-group-online-pages';
import { useGroupResource } from './use-group-resource';

// Member reads of group predictions (`docs/specs/tech/group-predictions-contract.md`).
// The readers answer the same `NOT_FOUND` for a lost membership and for the setting being off, so none of
// them (but the setting read, which works whatever the setting) evicts the group: a `NOT_FOUND` surfaces
// as `lostAccess` ("not available") and the screen asks the setting.

/** The Predictions setting: any member reads it; cache-first. */
export function usePredictionSetting(groupId: string, userId: string) {
  const fetcher = useCallback(() => getPredictionSetting(groupId), [groupId]);
  return useGroupResource({ userId, cacheKey: groupCacheKeys.predictionSetting(groupId), fetcher, evictGroupIdOnNotFound: groupId });
}

/** Next week's open markets and this week's matched bets; cache-first, polled while `active`. */
export function usePredictionBoard(groupId: string, userId: string, active = true) {
  const fetcher = useCallback(() => getPredictionBoard(groupId), [groupId]);
  return useGroupResource({ userId, cacheKey: groupCacheKeys.predictionBoard(groupId), fetcher, active });
}

/** The AI ranking; cache-first, polled while `active`. */
export function usePredictionRanking(groupId: string, userId: string, active = true) {
  const fetcher = useCallback(() => getPredictionRanking(groupId), [groupId]);
  return useGroupResource({ userId, cacheKey: groupCacheKeys.predictionRanking(groupId), fetcher, active });
}

/** One market's thread; cache-first. */
export function usePredictionThread(groupId: string, marketId: string, userId: string) {
  const fetcher = useCallback(() => getPredictionThread(groupId, marketId), [groupId, marketId]);
  return useGroupResource({ userId, cacheKey: groupCacheKeys.predictionThread(groupId, marketId), fetcher });
}

/** Settled weeks, latest first; paged and never cached. */
export function usePredictionHistory(groupId: string, userId: string) {
  const fetchPage = useCallback((cursor: string | null) => listPredictionHistory(groupId, cursor), [groupId]);
  return useGroupOnlinePages({ userId, groupId, viewKey: 'prediction-history', fetchPage, notFoundIsMissing: true,
    selectItems: (page: PredictionHistoryWire) => page.weeks, selectCursor: page => page.next_cursor, selectHasMore: page => page.next_cursor !== null,
    itemKey: (week: PredictionHistoryWeekWire) => week.week_start });
}
