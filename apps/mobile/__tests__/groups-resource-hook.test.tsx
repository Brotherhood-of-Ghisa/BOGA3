/* eslint-disable import/first */

/**
 * `useGroupResource` (groups contract) with fake timers, a
 * controllable NetInfo, a controllable focus, and the shared in-memory SQLite
 * fixture behind `bootstrapLocalDataLayer`: cache-first render, focus / 30 s
 * poll / manual refresh, the offline marker, NOT_FOUND eviction, and no throw
 * into render.
 */

import { competitionGroup, competitionCacheFixture } from './helpers/competition-fixtures';
import { act, renderHook } from '@testing-library/react-native';

import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

let fixture: InMemoryDatabaseFixture;
const mockCurrentDatabase = () => fixture.database;

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: () => Promise.resolve(mockCurrentDatabase()),
}));

type MockNetInfoListener = (state: { isConnected: boolean | null }) => void;
const mockNetInfoListeners = new Set<MockNetInfoListener>();

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: MockNetInfoListener) => {
      mockNetInfoListeners.add(listener);
      return () => {
        mockNetInfoListeners.delete(listener);
      };
    },
  },
}));

type MockFocusCallback = () => void | (() => void);
const mockFocus: { focused: boolean; callback: MockFocusCallback | null; cleanup: (() => void) | null } = {
  focused: true,
  callback: null,
  cleanup: null,
};

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  const React = require('react') as typeof import('react');
  return {
    useFocusEffect: (callback: MockFocusCallback) => {
      React.useEffect(() => {
        mockFocus.callback = callback;
        if (mockFocus.focused) {
          const cleanup = callback();
          mockFocus.cleanup = typeof cleanup === 'function' ? cleanup : null;
        }
        return () => {
          mockFocus.cleanup?.();
          mockFocus.cleanup = null;
          mockFocus.callback = null;
        };
      }, [callback]);
    },
  };
});

import { groupCache } from '@/src/data/schema';
import {
  GROUP_RESOURCE_POLL_INTERVAL_MS,
  GroupApiError,
  groupCacheKeys,
  readGroupCache,
  useGroupResource,
  writeGroupCache,
  type GroupResourceOptions,
} from '@/src/groups';

type Payload = { groups: (typeof competitionGroup)[] };
const payload = (name: string): Payload => ({ groups: [{ ...competitionGroup,name }] });

const NOW_MS = 1_757_500_000_000;
const CACHED_AT_MS = NOW_MS - 5 * 60 * 1000;
const USER = 'user-1';

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
  });
};

const emitNetInfo = (isConnected: boolean | null) => {
  act(() => {
    for (const listener of mockNetInfoListeners) {
      listener({ isConnected });
    }
  });
};

const blurScreen = () => {
  act(() => {
    mockFocus.focused = false;
    mockFocus.cleanup?.();
    mockFocus.cleanup = null;
  });
};

const focusScreen = () => {
  act(() => {
    mockFocus.focused = true;
    const cleanup = mockFocus.callback?.();
    mockFocus.cleanup = typeof cleanup === 'function' ? cleanup : null;
  });
};

const advance = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await flush();
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const seedCache = (cacheKey: string, payload: Payload, userId = USER, fetchedAtMs = CACHED_AT_MS) =>
  fixture.database.insert(groupCache).values({ cacheKey,userId,
    payloadJson: JSON.stringify(cacheKey === groupCacheKeys.mine ? payload : competitionCacheFixture(cacheKey)),fetchedAtMs }).run();

const cachedKeys = () =>
  fixture.database
    .select({ key: groupCache.cacheKey })
    .from(groupCache)
    .all()
    .filter(row => !row.key.startsWith('group-policy:'))
    .map((row) => row.key)
    .sort();

const renderResource = (options: Partial<GroupResourceOptions<Payload>> & Pick<GroupResourceOptions<Payload>, 'fetcher'>) =>
  renderHook((props: GroupResourceOptions<Payload>) => useGroupResource(props), {
    initialProps: { userId: USER, cacheKey: groupCacheKeys.mine, ...options },
  });

let setIntervalSpy: jest.SpyInstance;
let clearIntervalSpy: jest.SpyInstance;

/**
 * Every 30 s poll interval the hook armed has been handed to clearInterval.
 * (`jest.getTimerCount()` is not usable here: React and the testing library
 * keep their own timers.)
 */
const expectEveryPollIntervalCleared = () => {
  const pollHandles = setIntervalSpy.mock.calls
    .map((call, index) => ({ delay: call[1] as number, handle: setIntervalSpy.mock.results[index]?.value }))
    .filter((entry) => entry.delay === GROUP_RESOURCE_POLL_INTERVAL_MS)
    .map((entry) => entry.handle);
  const clearedHandles = clearIntervalSpy.mock.calls.map((call) => call[0]);

  expect(pollHandles.length).toBeGreaterThan(0);
  for (const handle of pollHandles) {
    expect(clearedHandles).toContain(handle);
  }
};

describe('useGroupResource', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW_MS);
    setIntervalSpy = jest.spyOn(global, 'setInterval');
    clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    fixture = createInMemoryDatabase();
    mockNetInfoListeners.clear();
    mockFocus.focused = true;
    mockFocus.callback = null;
    mockFocus.cleanup = null;
  });

  afterEach(() => {
    fixture.close();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    jest.useRealTimers();
  });

  it('renders the cached payload first, then the refreshed one, and re-caches it', async () => {
    seedCache(groupCacheKeys.mine, payload('cached'));
    const pending = deferred<Payload>();
    const fetcher = jest.fn(() => pending.promise);

    const { result } = renderResource({ fetcher });
    await flush();

    expect(result.current).toMatchObject({
      data: payload('cached'),
      lastUpdatedAtMs: CACHED_AT_MS,
      hydrated: true,
      refreshing: true,
      offline: false,
      error: null,
    });

    await act(async () => {
      pending.resolve(payload('fresh'));
    });
    await flush();

    expect(result.current).toMatchObject({ data: payload('fresh'), lastUpdatedAtMs: NOW_MS, refreshing: false });
    expect(readGroupCache(fixture.database, groupCacheKeys.mine, USER)).toEqual({
      payload: payload('fresh'),
      fetchedAtMs: NOW_MS,
    });
  });

  it("never renders another user's cached payload", async () => {
    seedCache(groupCacheKeys.mine, payload('someone else'), 'user-2');
    const fetcher = jest.fn(() => new Promise<Payload>(() => undefined));

    const { result } = renderResource({ fetcher });
    await flush();

    expect(result.current.hydrated).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.lastUpdatedAtMs).toBeNull();
  });

  it('refreshes on focus and every 30 s while focused, and stops polling when blurred', async () => {
    const fetcher = jest.fn(() => Promise.resolve(payload('x')));

    renderResource({ fetcher });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

    await advance(GROUP_RESOURCE_POLL_INTERVAL_MS - 1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await advance(GROUP_RESOURCE_POLL_INTERVAL_MS);
    expect(fetcher).toHaveBeenCalledTimes(3);

    blurScreen();
    await advance(GROUP_RESOURCE_POLL_INTERVAL_MS * 3);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expectEveryPollIntervalCleared();

    focusScreen();
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('refresh() fetches on demand and collapses concurrent calls into one request', async () => {
    const fetcher = jest.fn(() => Promise.resolve(payload('x')));
    const { result } = renderResource({ fetcher });
    await flush();
    fetcher.mockClear();

    const pending = deferred<Payload>();
    fetcher.mockImplementationOnce(() => pending.promise);

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.refresh();
      second = result.current.refresh();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(true);

    await act(async () => {
      pending.resolve(payload('manual'));
      await Promise.all([first, second]);
    });

    expect(result.current.data).toEqual(payload('manual'));
    expect(result.current.refreshing).toBe(false);
  });

  it('marks offline from NetInfo, keeps the cache, and skips requests until back online', async () => {
    seedCache(groupCacheKeys.mine, payload('cached'));
    const fetcher = jest.fn(() => new Promise<Payload>(() => undefined));

    blurScreen();
    const { result } = renderResource({ fetcher });
    emitNetInfo(false);
    await flush();

    expect(result.current).toMatchObject({ offline: true, data: payload('cached'), lastUpdatedAtMs: CACHED_AT_MS });

    focusScreen();
    await act(async () => {
      await result.current.refresh();
    });
    await advance(GROUP_RESOURCE_POLL_INTERVAL_MS);
    expect(fetcher).not.toHaveBeenCalled();

    emitNetInfo(true);
    expect(result.current.offline).toBe(false);
    await advance(GROUP_RESOURCE_POLL_INTERVAL_MS);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('marks offline when the last refresh failed with NETWORK and keeps lastUpdatedAtMs; a success clears it', async () => {
    seedCache(groupCacheKeys.mine, payload('cached'));
    const fetcher = jest.fn(
      (): Promise<Payload> => Promise.reject(new GroupApiError('NETWORK', 'Network request failed')),
    );

    const { result } = renderResource({ fetcher });
    emitNetInfo(true);
    await flush();

    expect(result.current).toMatchObject({
      offline: true,
      data: payload('cached'),
      lastUpdatedAtMs: CACHED_AT_MS,
      refreshing: false,
    });
    expect(result.current.error?.code).toBe('NETWORK');

    fetcher.mockImplementationOnce(() => Promise.resolve(payload('fresh')));
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current).toMatchObject({ offline: false, error: null, data: payload('fresh'), lastUpdatedAtMs: NOW_MS });
  });

  it('on group NOT_FOUND retires the account projections and surfaces lostAccess', async () => {
    seedCache(groupCacheKeys.mine, payload('mine'));
    seedCache(groupCacheKeys.stream('g2'), payload('other group'));
    seedCache(groupCacheKeys.group('g1'), payload('group'));
    seedCache(groupCacheKeys.stream('g1'), payload('stream'));
    seedCache(groupCacheKeys.session('g1','u2', 's1'), payload('session'));
    const fetcher = jest.fn(() => Promise.reject(new GroupApiError('NOT_FOUND', 'group not visible')));

    const { result } = renderResource({
      fetcher,
      cacheKey: groupCacheKeys.stream('g1'),
      evictGroupIdOnNotFound: 'g1',
    });
    await flush();

    expect(result.current).toMatchObject({ lostAccess: true, data: null, lastUpdatedAtMs: null, offline: false });
    expect(result.current.error?.code).toBe('NOT_FOUND');
    expect(cachedKeys()).toEqual([]);
  });

  it('on NOT_FOUND without a group id evicts only its own entry', async () => {
    seedCache(groupCacheKeys.session('g1','u2', 's1'), payload('session'));
    seedCache(groupCacheKeys.session('g2','u3', 's2'), payload('other session'));
    const fetcher = jest.fn(() => Promise.reject(new GroupApiError('NOT_FOUND', 'session not visible')));

    const { result } = renderResource({ fetcher, cacheKey: groupCacheKeys.session('g1','u2', 's1') });
    await flush();

    expect(result.current.lostAccess).toBe(true);
    expect(cachedKeys()).toEqual(['session:v5:g2:u3:s2']);
  });

  it('never throws into render: unexpected failures and a corrupt cache become INTERNAL error states', async () => {
    fixture.database
      .insert(groupCache)
      .values({ cacheKey: groupCacheKeys.mine, userId: USER, payloadJson: '{corrupt', fetchedAtMs: 1 })
      .run();
    const fetcher = jest.fn(() => {
      throw new Error('boom');
    });

    const { result } = renderResource({ fetcher });
    await flush();

    expect(result.current.hydrated).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error?.code).toBe('INTERNAL');
    expect(result.current.offline).toBe(false);
  });

  it('does nothing while signed out', async () => {
    const fetcher = jest.fn(() => Promise.resolve(payload('x')));

    const { result } = renderResource({ fetcher, userId: null });
    await flush();
    await act(async () => {
      await result.current.refresh();
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ hydrated: true, data: null, error: null });
  });

  it('re-hydrates and refetches when the cache key changes, ignoring a stale in-flight response', async () => {
    seedCache(groupCacheKeys.stream('g2'), payload('g2 cached'));
    const stale = deferred<Payload>();
    const fetcher = jest.fn(() => stale.promise);

    const { result, rerender } = renderResource({ fetcher, cacheKey: groupCacheKeys.stream('g1') });
    await flush();

    const nextFetcher = jest.fn(() => new Promise<Payload>(() => undefined));
    rerender({ userId: USER, cacheKey: groupCacheKeys.stream('g2'), fetcher: nextFetcher });
    await flush();
    expect(nextFetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      stale.resolve(payload('g1 stale'));
    });
    await flush();

    expect(result.current.data).toEqual(competitionCacheFixture(groupCacheKeys.stream('g2')));
    expect(readGroupCache(fixture.database, groupCacheKeys.stream('g1'), USER)).toBeNull();
  });

  it('clears its poll timer and NetInfo listener on unmount', async () => {
    const fetcher = jest.fn(() => Promise.resolve(payload('x')));
    const { unmount } = renderResource({ fetcher });
    await flush();
    expect(mockNetInfoListeners.size).toBe(1);

    unmount();

    expectEveryPollIntervalCleared();
    expect(mockNetInfoListeners.size).toBe(0);
    await advance(GROUP_RESOURCE_POLL_INTERVAL_MS * 2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
