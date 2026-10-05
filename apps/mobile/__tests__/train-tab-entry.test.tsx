/* eslint-disable import/first */

/**
 * Where the Train tab leads: the workout in progress, read as one row from the
 * migrated in-memory SQLite database (helpers/local-data.ts), else Train. The
 * press handler resolves one press at a time.
 */

import { act, renderHook } from '@testing-library/react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

import { useOpenMainTab } from '@/components/navigation/use-open-main-tab';
import { findActiveSessionId, listSessionListBuckets, setSessionDeletedState } from '@/src/data/session-list';
import { persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { SESSION_VIEW_FIXTURE } from '@/src/maestro/session-view-fixture';
import { mainTabDestination } from '@/src/navigation/active-session-entry';
import { MAIN_TAB_KEYS } from '@/src/navigation/main-tabs';
import { bootLocalApp, closeLocalData, loadMaestroFixture, resetLocalData } from './helpers/local-data';

const ACTIVE = SESSION_VIEW_FIXTURE.sessionId;

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

beforeEach(() => {
  resetLocalData();
});

afterEach(() => {
  closeLocalData();
});

describe('findActiveSessionId', () => {
  it('reads no workout in progress on an empty database', async () => {
    await bootLocalApp();
    expect(await findActiveSessionId()).toBeNull();
  });

  it('reads the same workout the session list calls active', async () => {
    await loadMaestroFixture('session-view');
    await bootLocalApp();

    expect(await findActiveSessionId()).toBe(ACTIVE);
    expect(await findActiveSessionId()).toBe((await listSessionListBuckets()).active?.id);
  });

  it('agrees with the session list on the most recently updated of two drafts', async () => {
    await loadMaestroFixture('session-view');
    await bootLocalApp();
    await persistSessionDraftSnapshot({
      sessionId: 'later-draft',
      gymId: null,
      startedAt: new Date(),
      status: 'active',
      exercises: [],
    });

    expect(await findActiveSessionId()).toBe((await listSessionListBuckets()).active?.id);
  });

  it('ignores a discarded workout', async () => {
    await loadMaestroFixture('session-view');
    await bootLocalApp();
    await setSessionDeletedState(ACTIVE, true);

    expect(await findActiveSessionId()).toBeNull();
  });
});

describe('mainTabDestination', () => {
  it('opens every tab but Train as itself, without looking anything up', async () => {
    const loadActive = jest.fn().mockResolvedValue('session-1');
    for (const tab of MAIN_TAB_KEYS.filter((key) => key !== 'train')) {
      expect(await mainTabDestination(tab, loadActive)).toBe(`/${tab}`);
    }
    expect(loadActive).not.toHaveBeenCalled();
  });

  it('opens the workout in progress from Train', async () => {
    expect(await mainTabDestination('train', async () => 'session 1')).toBe('/session/session%201');
  });

  it('opens Train when no workout is in progress', async () => {
    expect(await mainTabDestination('train', async () => null)).toBe('/train');
  });

  it('opens Train, which shows its own read error, when the lookup fails', async () => {
    expect(
      await mainTabDestination('train', () => Promise.reject(new Error('database closed'))),
    ).toBe('/train');
  });

  it('reads the local database by default', async () => {
    await loadMaestroFixture('session-view');
    await bootLocalApp();

    expect(await mainTabDestination('train')).toBe(`/session/${ACTIVE}`);
  });
});

describe('useOpenMainTab', () => {
  it('opens where the tab leads, ignoring presses while one is resolving', async () => {
    const open = jest.fn();
    const lookup = deferred<string | null>();
    const loadActive = jest.fn(() => lookup.promise);
    const { result } = renderHook(() => useOpenMainTab(open, loadActive));

    act(() => {
      result.current('train');
      result.current('train');
      result.current('today');
    });
    await act(async () => {
      lookup.resolve('session-1');
    });

    expect(loadActive).toHaveBeenCalledTimes(1);
    expect(open.mock.calls).toEqual([['/session/session-1']]);

    await act(async () => {
      result.current('today');
    });
    expect(open).toHaveBeenLastCalledWith('/today');
  });
});
