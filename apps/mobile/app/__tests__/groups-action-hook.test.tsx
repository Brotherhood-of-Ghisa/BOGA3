/* eslint-disable import/first */

/**
 * `useGroupAction` (groups contract §6.1, §7; C3.10.3, AC12): offline refusal
 * with no RPC and no cache change, mapped errors, and no queueing.
 */

import { act, renderHook } from '@testing-library/react-native';

import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

const mockRpc = jest.fn();

jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: () => ({ schema: () => ({ rpc: mockRpc }) }),
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

import { groupCache } from '@/src/data/schema';
import {
  GROUP_OFFLINE_ACTION_MESSAGE,
  GroupApiError,
  groupCacheKeys,
  leaveGroup,
  useGroupAction,
  writeGroupCache,
} from '@/src/groups';

let fixture: InMemoryDatabaseFixture;

const emitNetInfo = (isConnected: boolean | null) => {
  act(() => {
    for (const listener of mockNetInfoListeners) {
      listener({ isConnected });
    }
  });
};

const cacheRows = () => fixture.database.select().from(groupCache).all();

describe('useGroupAction', () => {
  beforeEach(() => {
    fixture = createInMemoryDatabase();
    mockNetInfoListeners.clear();
    mockRpc.mockReset();
  });

  afterEach(() => {
    fixture.close();
  });

  it('refuses immediately when offline: no RPC call, no cache change, and nothing queued', async () => {
    writeGroupCache(fixture.database, {
      cacheKey: groupCacheKeys.group('g1'),
      userId: 'user-1',
      payload: { group: { group_id: 'g1' } },
      fetchedAtMs: 1_000,
    });
    const before = cacheRows();
    const { result } = renderHook(() => useGroupAction(leaveGroup));
    emitNetInfo(false);
    expect(result.current.offline).toBe(true);

    let outcome!: Awaited<ReturnType<typeof result.current.run>>;
    await act(async () => {
      outcome = await result.current.run('g1');
    });

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error.code).toBe('NETWORK');
    expect(!outcome.ok && outcome.error.message).toBe(GROUP_OFFLINE_ACTION_MESSAGE);
    expect(result.current.error?.message).toBe(GROUP_OFFLINE_ACTION_MESSAGE);
    expect(result.current.pending).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(cacheRows()).toEqual(before);

    // Coming back online replays nothing.
    emitNetInfo(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('runs the RPC when online and returns its value', async () => {
    const action = jest.fn(async (name: string) => ({ group_id: `id-${name}` }));
    const { result } = renderHook(() => useGroupAction(action));
    emitNetInfo(true);

    let outcome!: Awaited<ReturnType<typeof result.current.run>>;
    await act(async () => {
      outcome = await result.current.run('crew');
    });

    expect(action).toHaveBeenCalledWith('crew');
    expect(outcome).toEqual({ ok: true, value: { group_id: 'id-crew' } });
    expect(result.current).toMatchObject({ pending: false, error: null });
  });

  it('attempts the call while NetInfo has not reported yet (unknown is not offline)', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null, status: 200 });
    const { result } = renderHook(() => useGroupAction(leaveGroup));

    await act(async () => {
      await result.current.run('g1');
    });

    expect(mockRpc).toHaveBeenCalledWith('group_leave', { p_group_id: 'g1' });
  });

  it('exposes pending while the RPC is in flight', async () => {
    let resolveAction!: () => void;
    const action = jest.fn(() => new Promise<void>((resolve) => (resolveAction = resolve)));
    const { result } = renderHook(() => useGroupAction(action));
    emitNetInfo(true);

    let running!: Promise<unknown>;
    act(() => {
      running = result.current.run();
    });
    expect(result.current.pending).toBe(true);

    await act(async () => {
      resolveAction();
      await running;
    });
    expect(result.current.pending).toBe(false);
  });

  it('surfaces a mapped server error without throwing', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'OWNER_MUST_TRANSFER: transfer ownership first' },
      status: 400,
    });
    const { result } = renderHook(() => useGroupAction(leaveGroup));
    emitNetInfo(true);

    let outcome!: Awaited<ReturnType<typeof result.current.run>>;
    await act(async () => {
      outcome = await result.current.run('g1');
    });

    expect(!outcome.ok && outcome.error.code).toBe('OWNER_MUST_TRANSFER');
    expect(result.current.error?.code).toBe('OWNER_MUST_TRANSFER');
    expect(result.current.pending).toBe(false);
  });

  it('maps an unexpected throw to INTERNAL, and reset() clears the error', async () => {
    const action = jest.fn(async () => {
      throw new Error('boom');
    });
    const { result } = renderHook(() => useGroupAction(action));
    emitNetInfo(true);

    await act(async () => {
      await result.current.run();
    });
    expect(result.current.error).toBeInstanceOf(GroupApiError);
    expect(result.current.error?.code).toBe('INTERNAL');

    act(() => {
      result.current.reset();
    });
    expect(result.current.error).toBeNull();
  });
});
