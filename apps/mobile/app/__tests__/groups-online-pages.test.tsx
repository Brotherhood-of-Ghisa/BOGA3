/* eslint-disable import/first */

/**
 * `useGroupOnlinePages` (M25-T09 card AC5–AC7; groups contract §6.1, §7): the
 * online-only paging behind the full board and its history. First page on
 * mount and on a view change, cursors sent verbatim, no request offline or at
 * the end, Retry after a failed page, first-seen dedupe, stale responses
 * dropped, NOT_FOUND split into lost access (evicts) vs exercise missing (does
 * not), and nothing ever written to `group_cache`.
 */

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

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  const React = require('react') as typeof import('react');
  return {
    useFocusEffect: (callback: () => void | (() => void)) => {
      React.useEffect(() => callback(), [callback]);
    },
  };
});

import { groupCache } from '@/src/data/schema';
import {
  GroupApiError,
  appendUniqueByKey,
  groupCacheKeys,
  useGroupOnlinePages,
  writeGroupCache,
  type GroupOnlinePagesOptions,
} from '@/src/groups';

type Item = { id: string };
type Cursor = { after: string };
type Page = { items: Item[]; next_cursor: Cursor | null; has_more: boolean };

const USER = 'user-1';
const GROUP = 'group-a';

const page = (ids: string[], next: string | null): Page => ({
  items: ids.map((id) => ({ id })),
  next_cursor: next ? { after: next } : null,
  has_more: next !== null,
});

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
  });
};

const emitNetInfo = (isConnected: boolean) => {
  act(() => {
    for (const listener of mockNetInfoListeners) listener({ isConnected });
  });
};

type Props = { viewKey: string | null; fetchPage: jest.Mock<Promise<Page>, [Cursor | null]> };

const renderPages = (initial: Props) =>
  renderHook(
    ({ viewKey, fetchPage }: Props) =>
      useGroupOnlinePages<Page, Item, Cursor>({
        userId: USER,
        groupId: GROUP,
        viewKey,
        fetchPage,
        selectItems: (p) => p.items,
        selectCursor: (p) => p.next_cursor,
        selectHasMore: (p) => p.has_more,
        itemKey: (item) => item.id,
      } satisfies GroupOnlinePagesOptions<Page, Item, Cursor>),
    { initialProps: initial },
  );

const ids = (items: Item[]) => items.map((item) => item.id);

beforeEach(() => {
  fixture = createInMemoryDatabase();
  mockNetInfoListeners.clear();
});

afterEach(() => {
  fixture.close();
});

describe('useGroupOnlinePages', () => {
  it('appendUniqueByKey keeps the first seen item', () => {
    expect(ids(appendUniqueByKey([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }], (item) => item.id))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('loads the first page, then the next with the cursor verbatim, deduplicating a row that shifted pages', async () => {
    const fetchPage = jest
      .fn<Promise<Page>, [Cursor | null]>()
      .mockResolvedValueOnce(page(['a', 'b'], 'b'))
      .mockResolvedValueOnce(page(['b', 'c'], null));
    const { result } = renderPages({ viewKey: 'v1', fetchPage });
    await flush();

    expect(fetchPage).toHaveBeenNthCalledWith(1, null);
    expect(ids(result.current.items)).toEqual(['a', 'b']);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.loadedAtMs).not.toBeNull();

    await act(async () => {
      await result.current.loadMore();
    });
    expect(fetchPage).toHaveBeenNthCalledWith(2, { after: 'b' });
    expect(ids(result.current.items)).toEqual(['a', 'b', 'c']);
    expect(result.current.hasMore).toBe(false);

    await act(async () => {
      await result.current.loadMore();
    });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('never requests while offline; loaded rows stay visible with offline set', async () => {
    const fetchPage = jest.fn<Promise<Page>, [Cursor | null]>().mockResolvedValue(page(['a'], 'a'));
    const { result } = renderPages({ viewKey: 'v1', fetchPage });
    await flush();
    emitNetInfo(false);

    await act(async () => {
      await result.current.loadMore();
      await result.current.refresh();
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.current.offline).toBe(true);
    expect(ids(result.current.items)).toEqual(['a']);
  });

  it('a view change resets the pages and loads the new first page; offline it shows nothing', async () => {
    const fetchPage = jest.fn<Promise<Page>, [Cursor | null]>().mockResolvedValue(page(['a'], null));
    const { result, rerender } = renderPages({ viewKey: 'v1', fetchPage });
    await flush();
    expect(ids(result.current.items)).toEqual(['a']);

    const nextFetch = jest.fn<Promise<Page>, [Cursor | null]>().mockResolvedValue(page(['z'], null));
    rerender({ viewKey: 'v2', fetchPage: nextFetch });
    await flush();
    expect(nextFetch).toHaveBeenCalledWith(null);
    expect(ids(result.current.items)).toEqual(['z']);

    emitNetInfo(false);
    const offlineFetch = jest.fn<Promise<Page>, [Cursor | null]>();
    rerender({ viewKey: 'v3', fetchPage: offlineFetch });
    await flush();
    expect(offlineFetch).not.toHaveBeenCalled();
    expect(result.current.firstPage).toBeNull();
    expect(result.current.items).toEqual([]);
    expect(result.current.offline).toBe(true);
  });

  it('drops a first page that resolves after the view changed', async () => {
    let resolveOld: (value: Page) => void = () => undefined;
    const oldFetch = jest.fn<Promise<Page>, [Cursor | null]>(
      () => new Promise<Page>((resolve) => (resolveOld = resolve)),
    );
    const { result, rerender } = renderPages({ viewKey: 'v1', fetchPage: oldFetch });
    await flush();

    const newFetch = jest.fn<Promise<Page>, [Cursor | null]>().mockResolvedValue(page(['new'], null));
    rerender({ viewKey: 'v2', fetchPage: newFetch });
    await flush();
    await act(async () => {
      resolveOld(page(['old'], null));
    });
    await flush();

    expect(ids(result.current.items)).toEqual(['new']);
  });

  it('a refresh replaces loaded pages and drops an in-flight older page', async () => {
    let resolveMore: (value: Page) => void = () => undefined;
    const fetchPage = jest
      .fn<Promise<Page>, [Cursor | null]>()
      .mockResolvedValueOnce(page(['a'], 'a'))
      .mockImplementationOnce(() => new Promise<Page>((resolve) => (resolveMore = resolve)))
      .mockResolvedValueOnce(page(['a2'], null));
    const { result } = renderPages({ viewKey: 'v1', fetchPage });
    await flush();

    let more: Promise<void> = Promise.resolve();
    act(() => {
      more = result.current.loadMore();
    });
    await act(async () => {
      await result.current.refresh();
    });
    await act(async () => {
      resolveMore(page(['b'], null));
      await more;
    });

    expect(ids(result.current.items)).toEqual(['a2']);
    expect(result.current.hasMore).toBe(false);
  });

  it('a failed refresh that overtook an older page clears its spinner', async () => {
    let resolveMore: (value: Page) => void = () => undefined;
    const fetchPage = jest
      .fn<Promise<Page>, [Cursor | null]>()
      .mockResolvedValueOnce(page(['a'], 'a'))
      .mockImplementationOnce(() => new Promise<Page>((resolve) => (resolveMore = resolve)))
      .mockRejectedValueOnce(new GroupApiError('NETWORK', 'down'));
    const { result } = renderPages({ viewKey: 'v1', fetchPage });
    await flush();

    let more: Promise<void> = Promise.resolve();
    act(() => {
      more = result.current.loadMore();
    });
    expect(result.current.loadingMore).toBe(true);
    await act(async () => {
      await result.current.refresh();
    });
    await act(async () => {
      resolveMore(page(['b'], null));
      await more;
    });

    expect(result.current.loadingMore).toBe(false);
    expect(result.current.offline).toBe(true);
    expect(ids(result.current.items)).toEqual(['a']);
  });

  it('a failed next page keeps the rows and retries the same cursor', async () => {
    const fetchPage = jest
      .fn<Promise<Page>, [Cursor | null]>()
      .mockResolvedValueOnce(page(['a'], 'a'))
      .mockRejectedValueOnce(new GroupApiError('INTERNAL', 'boom'))
      .mockResolvedValueOnce(page(['b'], null));
    const { result } = renderPages({ viewKey: 'v1', fetchPage });
    await flush();

    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.loadMoreError?.message).toBe('boom');
    expect(ids(result.current.items)).toEqual(['a']);

    await act(async () => {
      await result.current.loadMore();
    });
    expect(fetchPage).toHaveBeenNthCalledWith(3, { after: 'a' });
    expect(result.current.loadMoreError).toBeNull();
    expect(ids(result.current.items)).toEqual(['a', 'b']);
  });

  it('a first-page NETWORK failure reads offline; INTERNAL is an error', async () => {
    const fetchPage = jest
      .fn<Promise<Page>, [Cursor | null]>()
      .mockRejectedValueOnce(new GroupApiError('NETWORK', 'down'))
      .mockRejectedValueOnce(new GroupApiError('INTERNAL', 'bad'));
    const { result } = renderPages({ viewKey: 'v1', fetchPage });
    await flush();
    expect(result.current.offline).toBe(true);

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.offline).toBe(false);
    expect(result.current.error?.code).toBe('INTERNAL');
    expect(result.current.firstPage).toBeNull();
  });

  it('group NOT_FOUND evicts the group and reports lost access', async () => {
    writeGroupCache(fixture.database, { cacheKey: groupCacheKeys.boards(GROUP), userId: USER, payload: {}, fetchedAtMs: 1 });
    writeGroupCache(fixture.database, { cacheKey: groupCacheKeys.group(GROUP), userId: USER, payload: {}, fetchedAtMs: 1 });
    const fetchPage = jest
      .fn<Promise<Page>, [Cursor | null]>()
      .mockRejectedValue(new GroupApiError('NOT_FOUND', 'group not found'));
    const { result } = renderPages({ viewKey: 'v1', fetchPage });
    await flush();

    expect(result.current.lostAccess).toBe(true);
    expect(result.current.exerciseMissing).toBe(false);
    expect(fixture.database.select().from(groupCache).all()).toEqual([]);
  });

  it('exercise NOT_FOUND reports exerciseMissing and evicts nothing', async () => {
    writeGroupCache(fixture.database, { cacheKey: groupCacheKeys.boards(GROUP), userId: USER, payload: {}, fetchedAtMs: 1 });
    const fetchPage = jest
      .fn<Promise<Page>, [Cursor | null]>()
      .mockRejectedValue(new GroupApiError('NOT_FOUND', 'group exercise not found'));
    const { result } = renderPages({ viewKey: 'v1', fetchPage });
    await flush();

    expect(result.current.exerciseMissing).toBe(true);
    expect(result.current.lostAccess).toBe(false);
    expect(fixture.database.select().from(groupCache).all()).toHaveLength(1);
  });

  it('never writes group_cache', async () => {
    const fetchPage = jest
      .fn<Promise<Page>, [Cursor | null]>()
      .mockResolvedValueOnce(page(['a'], 'a'))
      .mockResolvedValueOnce(page(['b'], null));
    const { result } = renderPages({ viewKey: 'v1', fetchPage });
    await flush();
    await act(async () => {
      await result.current.loadMore();
    });
    expect(fixture.database.select().from(groupCache).all()).toEqual([]);
  });
});
