/* eslint-disable import/first */

/**
 * The member prediction hooks (group predictions contract, "Member screens"): cache-first reads under their
 * versioned keys; a `NOT_FOUND` is "not available" and never evicts the group (it is also what a setting turned
 * off answers), except on the setting read, which works whatever the setting; history pages online only.
 */

import * as mockReact from 'react';
import { act, renderHook } from '@testing-library/react-native';

import { competitionGroupDetail } from './helpers/competition-fixtures';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';
import { boardFixture, historyFixture, rankingFixture, threadFixture } from './helpers/prediction-fixtures';

let mockFixture: InMemoryDatabaseFixture;
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: () => Promise.resolve(mockFixture.database) }));
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }));
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void | (() => void)) => { mockReact.useEffect(() => callback(), [callback]); } }));
jest.mock('@/src/groups/api', () => ({
  ...jest.requireActual('@/src/groups/api'),
  getPredictionSetting: jest.fn(), getPredictionBoard: jest.fn(), getPredictionRanking: jest.fn(), getPredictionThread: jest.fn(), listPredictionHistory: jest.fn(),
}));

import { GroupApiError, groupCacheKeys, readGroupCache, writeGroupCache } from '@/src/groups';
import * as groupsApi from '@/src/groups/api';
import { usePredictionBoard, usePredictionHistory, usePredictionRanking, usePredictionSetting, usePredictionThread } from '@/src/groups/use-predictions';

const api = groupsApi as jest.Mocked<typeof groupsApi>;
type Probe = () => { data: unknown; lostAccess: boolean };
const USER = 'u1';
const GROUP = 'g1';
const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });
const seedGroup = () => writeGroupCache(mockFixture.database, { cacheKey: groupCacheKeys.group(GROUP), userId: USER,
  payload: { ...competitionGroupDetail, group: { ...competitionGroupDetail.group, group_id: GROUP } }, fetchedAtMs: 1 });
const groupCached = () => readGroupCache(mockFixture.database, groupCacheKeys.group(GROUP), USER) !== null;

beforeEach(() => {
  mockFixture = createInMemoryDatabase();
  for (const fn of [api.getPredictionSetting, api.getPredictionBoard, api.getPredictionRanking, api.getPredictionThread, api.listPredictionHistory]) fn.mockReset();
});
afterEach(() => mockFixture.close());

describe('cache-first reads', () => {
  it.each([
    ['the setting', () => usePredictionSetting(GROUP, USER), api.getPredictionSetting, { group_id: GROUP, enabled: true }, groupCacheKeys.predictionSetting(GROUP)],
    ['the board', () => usePredictionBoard(GROUP, USER), api.getPredictionBoard, boardFixture(), groupCacheKeys.predictionBoard(GROUP)],
    ['the ranking', () => usePredictionRanking(GROUP, USER), api.getPredictionRanking, rankingFixture(), groupCacheKeys.predictionRanking(GROUP)],
    ['a thread', () => usePredictionThread(GROUP, 'mk-1', USER), api.getPredictionThread, threadFixture(), groupCacheKeys.predictionThread(GROUP, 'mk-1')],
  ] as const)('%s loads, caches under its versioned key and reads it back', async (_name, hook, read, payload, key) => {
    (read as jest.Mock).mockResolvedValue(payload);
    const { result } = renderHook(hook as Probe);
    await flush();
    expect(result.current.data).toEqual(payload);
    expect(readGroupCache(mockFixture.database, key, USER)?.payload).toEqual(payload);
  });
});

describe('NOT_FOUND', () => {
  it.each([
    ['the board', () => usePredictionBoard(GROUP, USER), api.getPredictionBoard, groupCacheKeys.predictionBoard(GROUP), boardFixture()],
    ['the ranking', () => usePredictionRanking(GROUP, USER), api.getPredictionRanking, groupCacheKeys.predictionRanking(GROUP), rankingFixture()],
    ['a thread', () => usePredictionThread(GROUP, 'mk-1', USER), api.getPredictionThread, groupCacheKeys.predictionThread(GROUP, 'mk-1'), threadFixture()],
  ] as const)('on %s drops only that entry: predictions turned off is not a lost group', async (_name, hook, read, key, payload) => {
    seedGroup();
    writeGroupCache(mockFixture.database, { cacheKey: key, userId: USER, payload, fetchedAtMs: 1 });
    (read as jest.Mock).mockRejectedValue(new GroupApiError('NOT_FOUND', 'group not found'));
    const { result } = renderHook(hook as Probe);
    await flush();
    expect(result.current.lostAccess).toBe(true);
    expect(result.current.data).toBeNull();
    expect(readGroupCache(mockFixture.database, key, USER)).toBeNull();
    expect(groupCached()).toBe(true);
  });
  it('a missing market drops its thread and keeps the group', async () => {
    seedGroup();
    api.getPredictionThread.mockRejectedValue(new GroupApiError('NOT_FOUND', 'market not found'));
    const { result } = renderHook(() => usePredictionThread(GROUP, 'mk-1', USER));
    await flush();
    expect(result.current.lostAccess).toBe(true);
    expect(groupCached()).toBe(true);
  });
  it('on the setting read is a lost group, and evicts it', async () => {
    seedGroup();
    api.getPredictionSetting.mockRejectedValue(new GroupApiError('NOT_FOUND', 'group not found'));
    const { result } = renderHook(() => usePredictionSetting(GROUP, USER));
    await flush();
    expect(result.current.lostAccess).toBe(true);
    expect(groupCached()).toBe(false);
  });
});

describe('history', () => {
  it('pages with the cursor verbatim and caches nothing', async () => {
    api.listPredictionHistory.mockResolvedValueOnce(historyFixture({ next_cursor: 'cur-1' }))
      .mockResolvedValueOnce(historyFixture({ weeks: [{ ...historyFixture().weeks[0], week_start: '2026-11-16' }] }));
    const { result } = renderHook(() => usePredictionHistory(GROUP, USER));
    await flush();
    expect(api.listPredictionHistory).toHaveBeenNthCalledWith(1, GROUP, null);
    expect(result.current.items.map(w => w.week_start)).toEqual(['2026-11-23']);
    expect(result.current.hasMore).toBe(true);
    await act(async () => { await result.current.loadMore(); });
    expect(api.listPredictionHistory).toHaveBeenNthCalledWith(2, GROUP, 'cur-1');
    expect(result.current.items.map(w => w.week_start)).toEqual(['2026-11-23', '2026-11-16']);
    expect(result.current.hasMore).toBe(false);
  });
  it('NOT_FOUND is a missing read: nothing is evicted', async () => {
    seedGroup();
    api.listPredictionHistory.mockRejectedValue(new GroupApiError('NOT_FOUND', 'group not found'));
    const { result } = renderHook(() => usePredictionHistory(GROUP, USER));
    await flush();
    expect(result.current.resourceMissing).toBe(true);
    expect(result.current.lostAccess).toBe(false);
    expect(groupCached()).toBe(true);
  });
});
