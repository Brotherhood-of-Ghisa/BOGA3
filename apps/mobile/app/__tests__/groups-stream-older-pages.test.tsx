/* eslint-disable import/first */

/**
 * `useGroupStream`'s older pages (groups contract §6.2, §7): they belong to one
 * user + group. Leaving a group drops them, and a return to it starts empty
 * with no load-more spinner, even when a next page was in flight on leaving.
 */

import { act, renderHook } from '@testing-library/react-native';

const mockGetGroupMetricStream = jest.fn();

jest.mock('@/src/groups/api', () => ({
  ...jest.requireActual('@/src/groups/api'),
  getGroupMetricStream: (...args: unknown[]) => mockGetGroupMetricStream(...args),
}));

const mockFirstPage = {
  items: [{ kind: 'session', key: 'first', sort_at_ms: 2_000 }],
  next_cursor: { kind: 'session', key: 'first', sort_at_ms: 2_000 },
  has_more: true,
};

jest.mock('@/src/groups/use-group-resource', () => ({
  useGroupResource: () => ({
    data: mockFirstPage,
    lastUpdatedAtMs: 1,
    refreshing: false,
    offline: false,
    error: null,
    lostAccess: false,
    refresh: () => Promise.resolve(),
  }),
}));

import { useGroupStream } from '@/src/groups/use-group-stream';

const olderPage = {
  items: [{ kind: 'session', key: 'older', sort_at_ms: 1_000 }],
  next_cursor: null,
  has_more: false,
};

const renderStream = () =>
  renderHook(({ groupId }: { groupId: string }) => useGroupStream({ userId: 'user-1', groupId }), {
    initialProps: { groupId: 'group-a' },
  });

beforeEach(() => {
  mockGetGroupMetricStream.mockReset();
});

describe('useGroupStream older pages', () => {
  it('a return to a group left mid-load starts empty, without a load-more spinner', async () => {
    let resolveOlder: (page: typeof olderPage) => void = () => undefined;
    mockGetGroupMetricStream.mockReturnValueOnce(new Promise((resolve) => (resolveOlder = resolve)));
    const { result, rerender } = renderStream();

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.loadMore();
    });
    expect(result.current.loadingMore).toBe(true);

    rerender({ groupId: 'group-b' });
    await act(async () => {
      resolveOlder(olderPage);
      await pending;
    });
    rerender({ groupId: 'group-a' });

    expect(result.current.loadingMore).toBe(false);
    expect(result.current.loadMoreError).toBeNull();
    expect(result.current.items.map((item) => item.key)).toEqual(['first']);
  });

  it('a return to a group drops the older pages loaded before leaving', async () => {
    mockGetGroupMetricStream.mockResolvedValueOnce(olderPage);
    const { result, rerender } = renderStream();

    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.items.map((item) => item.key)).toEqual(['first', 'older']);

    rerender({ groupId: 'group-b' });
    rerender({ groupId: 'group-a' });

    expect(result.current.items.map((item) => item.key)).toEqual(['first']);
    expect(result.current.hasMore).toBe(true);
  });
});
