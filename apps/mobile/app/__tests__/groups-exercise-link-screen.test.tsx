/* eslint-disable import/first */

/**
 * M25-T07 Link screen (`/exercise-link`, product E0.3; card AC2, AC5, AC6).
 * Group reads are mocked; the local database is the shared in-memory SQLite
 * fixture, so link / unlink are the real repository writes, `group_cache` is
 * the real cache, and offline behaviour runs through the production hook.
 */

import * as mockReact from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { eq } from 'drizzle-orm';

import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

let fixture: InMemoryDatabaseFixture;
const mockCurrentDatabase = () => fixture.database;

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: () => Promise.resolve(mockCurrentDatabase()),
}));

jest.mock('@/src/sync/write-nudge', () => ({ notifyLocalWrite: jest.fn() }));

let mockConnected: boolean | null = true;
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: (state: { isConnected: boolean | null }) => void) => {
      listener({ isConnected: mockConnected });
      return () => undefined;
    },
  },
}));

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => callback(), [callback]);
  },
  Stack: { Screen: () => null },
}));

const mockUseAuth = jest.fn();
jest.mock('@/src/auth', () => ({ useAuth: () => mockUseAuth() }));

jest.mock('@/src/groups/api', () => ({
  ...jest.requireActual('@/src/groups/api'),
  listMyGroups: jest.fn(),
  listGroupExercises: jest.fn(),
}));

import { exerciseDefinitions, exerciseGroupLinks } from '@/src/data/schema';
import { linkExercise } from '@/src/data/exercise-group-links';
import * as linksRepo from '@/src/data/exercise-group-links';
import { __resetExerciseCatalogCacheForTests } from '@/src/exercise-catalog/cache';
import {
  GroupApiError,
  groupCacheKeys,
  readGroupCache,
  writeGroupCache,
  type GroupExercise,
  type GroupExerciseListResult,
  type GroupListMineResult,
  type GroupSummary,
} from '@/src/groups';
import * as groupsApi from '@/src/groups/api';

import ExerciseLinkRoute from '../exercise-link';

const api = groupsApi as jest.Mocked<typeof groupsApi>;

const USER_ID = 'user-me';

const IRON: GroupSummary = { group_id: 'g-iron', name: 'Iron Brotherhood', description: null, member_count: 3, my_role: 'member' };
const TUESDAY: GroupSummary = { group_id: 'g-tue', name: 'Tuesday Crew', description: null, member_count: 2, my_role: 'member' };

const groupExercise = (overrides: Partial<GroupExercise> & Pick<GroupExercise, 'group_exercise_id' | 'name'>): GroupExercise => ({
  load_input_mode: 'total_load',
  source_exercise_id: null,
  archived_at_ms: null,
  ...overrides,
});

const GX_BENCH = groupExercise({ group_exercise_id: 'gx-bench', name: 'Bench Press', source_exercise_id: 'seed_barbell_bench_press' });
const GX_DEADLIFT = groupExercise({ group_exercise_id: 'gx-deadlift', name: 'Deadlift' });
const GX_TUE_BENCH = groupExercise({ group_exercise_id: 'gx-tue-bench', name: 'Bench', load_input_mode: 'per_side_load' });

const MINE: GroupListMineResult = { groups: [IRON, TUESDAY] };
const IRON_EXERCISES: GroupExerciseListResult = { exercises: [GX_BENCH, GX_DEADLIFT] };
const TUESDAY_EXERCISES: GroupExerciseListResult = { exercises: [GX_TUE_BENCH] };

const liveLinks = () =>
  fixture.database
    .select()
    .from(exerciseGroupLinks)
    .all()
    .filter((row) => row.deletedAt === null);

const insertExercise = (id: string, name: string, deletedAt: Date | null = null) =>
  fixture.database.insert(exerciseDefinitions).values({ id, name, deletedAt }).run();

const warmCache = () => {
  const put = (cacheKey: string, payload: unknown) =>
    writeGroupCache(fixture.database, { cacheKey, userId: USER_ID, payload, fetchedAtMs: new Date(2026, 8, 13, 9, 5).getTime() });
  put(groupCacheKeys.mine, MINE);
  put(groupCacheKeys.groupExercises('g-iron'), IRON_EXERCISES);
  put(groupCacheKeys.groupExercises('g-tue'), TUESDAY_EXERCISES);
};

const renderScreen = async (exerciseDefinitionId: string | null = 'seed_barbell_bench_press') => {
  mockParams = exerciseDefinitionId ? { exerciseDefinitionId } : {};
  render(<ExerciseLinkRoute />);
  await act(async () => {});
};

beforeEach(() => {
  fixture = createInMemoryDatabase({ foreignKeys: true });
  __resetExerciseCatalogCacheForTests();
  mockConnected = true;
  mockUseAuth.mockReturnValue({ isConfigured: true, user: { id: USER_ID } });
  api.listMyGroups.mockResolvedValue(MINE);
  api.listGroupExercises.mockImplementation(async (groupId: string) =>
    groupId === 'g-iron' ? IRON_EXERCISES : TUESDAY_EXERCISES,
  );
  insertExercise('seed_barbell_bench_press', 'Barbell Bench Press');
  insertExercise('ex-squat', 'Squat');
});

afterEach(() => {
  fixture.close();
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe('Link screen', () => {
  it('signed out: the sign-in-required state, no group RPC', async () => {
    mockUseAuth.mockReturnValue({ isConfigured: true, user: null });
    await renderScreen();

    expect(screen.getByTestId('groups-signed-out-state')).toBeTruthy();
    expect(api.listMyGroups).not.toHaveBeenCalled();
  });

  it('a missing or unknown exercise id shows the error state', async () => {
    await renderScreen(null);
    expect(screen.getByTestId('exercise-link-missing-state')).toBeTruthy();
    screen.unmount();

    await renderScreen('ex-nope');
    await waitFor(() => expect(screen.getByTestId('exercise-link-missing-state')).toBeTruthy());
  });

  it('online: suggests the same standard exercise, lists the rest by group, and Link writes a local link', async () => {
    await renderScreen();

    const suggested = await screen.findByTestId('exercise-link-row-gx-bench');
    expect(within(suggested).getByText(/Bench Press/)).toBeTruthy();
    // Tuesday's "Bench" is a name match → Suggested too, with the load-mode note.
    expect(screen.getByText("Your total-load weights will show halved on this group's boards.")).toBeTruthy();
    expect(screen.getByTestId('exercise-link-row-gx-deadlift')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('exercise-link-link-gx-bench'));
    });

    expect(liveLinks()).toEqual([
      expect.objectContaining({
        id: 'g-iron:seed_barbell_bench_press',
        groupExerciseId: 'gx-bench',
        localDirty: true,
      }),
    ]);
    expect(screen.getByTestId('exercise-link-notice')).toHaveTextContent(
      'Your past Barbell Bench Press sets shared with Iron Brotherhood will count.',
    );
    expect(await screen.findByTestId('exercise-link-linked-row-gx-bench')).toBeTruthy();
    // One link per group: Iron's Deadlift is now unavailable.
    expect(within(screen.getByTestId('exercise-link-row-gx-deadlift')).getByText('already linked in Iron Brotherhood')).toBeTruthy();
    expect(screen.queryByTestId('exercise-link-link-gx-deadlift')).toBeNull();
    // The refresh cached both groups' lists.
    expect(readGroupCache(fixture.database, groupCacheKeys.groupExercises('g-iron'), USER_ID)?.payload).toEqual(IRON_EXERCISES);
  });

  it('Unlink asks first, then tombstones the link', async () => {
    await linkExercise('seed_barbell_bench_press', 'g-iron', 'gx-bench');
    const alertSpy = jest.spyOn(Alert, 'alert');
    await renderScreen();

    await screen.findByTestId('exercise-link-linked-row-gx-bench');
    fireEvent.press(screen.getByTestId('exercise-link-unlink-gx-bench'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Unlink “Barbell Bench Press”?',
      'Its sets will stop counting towards “Bench Press” in “Iron Brotherhood” on both All and Certified leaderboards. Past activity and existing certifications will be kept. Leaderboards update after syncing.',
      expect.any(Array),
      expect.objectContaining({ cancelable: true }),
    );
    expect(liveLinks()).toHaveLength(1);

    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((button) => button.text === 'Unlink')?.onPress?.();
    });

    expect(liveLinks()).toEqual([]);
    const tombstone = fixture.database
      .select()
      .from(exerciseGroupLinks)
      .where(eq(exerciseGroupLinks.id, 'g-iron:seed_barbell_bench_press'))
      .get();
    expect(tombstone?.deletedAt).not.toBeNull();
    await waitFor(() => expect(screen.queryByTestId('exercise-link-linked-row-gx-bench')).toBeNull());
  });

  // Offline = NetInfo reports offline AND a request would fail as a transport
  // error (NetInfo's first report can land after the first focus refresh).
  const goOffline = () => {
    mockConnected = false;
    api.listMyGroups.mockRejectedValue(new GroupApiError('NETWORK', 'Network request failed.'));
    api.listGroupExercises.mockRejectedValue(new GroupApiError('NETWORK', 'Network request failed.'));
  };

  it('offline with a warm cache: renders from the cache, and Link writes locally with no group RPC', async () => {
    goOffline();
    warmCache();
    await renderScreen();

    expect(await screen.findByTestId('groups-offline-banner')).toHaveTextContent('Offline · last updated 09:05');
    const linkButton = await screen.findByTestId('exercise-link-link-gx-bench');
    api.listMyGroups.mockClear();
    api.listGroupExercises.mockClear();

    await act(async () => {
      fireEvent.press(linkButton);
    });

    expect(liveLinks()).toHaveLength(1);
    expect(await screen.findByTestId('exercise-link-linked-row-gx-bench')).toBeTruthy();
    expect(api.listMyGroups).not.toHaveBeenCalled();
    expect(api.listGroupExercises).not.toHaveBeenCalled();
    // The offline marker covers NETWORK; no second error next to it.
    expect(screen.queryByTestId('exercise-link-inline-error')).toBeNull();
  });

  it('offline: Unlink tombstones locally with no group RPC', async () => {
    goOffline();
    warmCache();
    await linkExercise('seed_barbell_bench_press', 'g-iron', 'gx-bench');
    const alertSpy = jest.spyOn(Alert, 'alert');
    await renderScreen();

    const unlinkButton = await screen.findByTestId('exercise-link-unlink-gx-bench');
    api.listMyGroups.mockClear();
    api.listGroupExercises.mockClear();
    fireEvent.press(unlinkButton);
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((button) => button.text === 'Unlink')?.onPress?.();
    });

    expect(liveLinks()).toEqual([]);
    await waitFor(() => expect(screen.queryByTestId('exercise-link-linked-row-gx-bench')).toBeNull());
    expect(screen.getByTestId('exercise-link-link-gx-bench')).toBeTruthy();
    expect(api.listMyGroups).not.toHaveBeenCalled();
    expect(api.listGroupExercises).not.toHaveBeenCalled();
  });

  it('offline with my groups cached but no exercise lists yet: the "Connect once" state, not an empty list', async () => {
    goOffline();
    writeGroupCache(fixture.database, { cacheKey: groupCacheKeys.mine, userId: USER_ID, payload: MINE, fetchedAtMs: 1 });
    await renderScreen();

    expect(await screen.findByTestId('exercise-link-offline-empty-state')).toBeTruthy();
    expect(screen.queryByTestId('exercise-link-empty')).toBeNull();
    expect(screen.queryByTestId('exercise-link-inline-error')).toBeNull();
  });

  it('offline with nothing cached: my links still render from the local table, with placeholder names', async () => {
    goOffline();
    await linkExercise('seed_barbell_bench_press', 'g-iron', 'gx-bench');
    await renderScreen();

    const row = await screen.findByTestId('exercise-link-linked-row-gx-bench');
    expect(within(row).getByText(/Group exercise/)).toBeTruthy();
    expect(within(row).getByText(/A group/)).toBeTruthy();
    expect(screen.getByTestId('exercise-link-offline-empty-state')).toBeTruthy();
    expect(screen.queryByTestId('exercise-link-search')).toBeNull();
  });

  it('a soft-deleted exercise offers nothing new but can still unlink (b)', async () => {
    insertExercise('ex-old', 'Old Bench', new Date(1));
    await linkExercise('ex-old', 'g-tue', 'gx-tue-bench');
    await renderScreen('ex-old');

    expect(await screen.findByTestId('exercise-link-deleted-state')).toBeTruthy();
    expect(screen.getByTestId('exercise-link-unlink-gx-tue-bench')).toBeTruthy();
    expect(screen.queryByTestId('exercise-link-search')).toBeNull();
    expect(screen.queryByTestId('exercise-link-link-gx-bench')).toBeNull();
  });

  it('losing access to a group evicts its cached exercises but never my links (AC6)', async () => {
    warmCache();
    await linkExercise('seed_barbell_bench_press', 'g-tue', 'gx-tue-bench');
    api.listGroupExercises.mockImplementation(async (groupId: string) => {
      if (groupId === 'g-tue') {
        throw new GroupApiError('NOT_FOUND', 'group not found');
      }
      return IRON_EXERCISES;
    });
    await renderScreen();

    await waitFor(() =>
      expect(readGroupCache(fixture.database, groupCacheKeys.groupExercises('g-tue'), USER_ID)).toBeNull(),
    );
    expect(liveLinks().map((row) => row.id)).toEqual(['g-tue:seed_barbell_bench_press']);
    // Dropped from the cached groups too, so the link stays inactive after a restart.
    expect(
      readGroupCache<GroupListMineResult>(fixture.database, groupCacheKeys.mine, USER_ID)?.payload.groups.map(
        (group) => group.group_id,
      ),
    ).toEqual(['g-iron']);
    // The group left my list, so the link reads as inactive.
    const row = await screen.findByTestId('exercise-link-linked-row-gx-tue-bench');
    await waitFor(() => expect(within(row).getByText('inactive — not a member')).toBeTruthy());
  });

  it('cancelling unlink writes nothing; a stale confirmation preserves the new target', async () => {
    await linkExercise('seed_barbell_bench_press', 'g-iron', 'gx-bench');
    const spy = jest.spyOn(Alert, 'alert');
    await renderScreen();
    const button = await screen.findByTestId('exercise-link-unlink-gx-bench');
    fireEvent.press(button);
    await act(async () => spy.mock.calls.at(-1)?.[2]?.find((action) => action.text === 'Cancel')?.onPress?.());
    expect(liveLinks()).toHaveLength(1);
    fireEvent.press(button);
    await linkExercise('seed_barbell_bench_press', 'g-iron', 'gx-deadlift');
    await act(async () => spy.mock.calls.at(-1)?.[2]?.find((action) => action.text === 'Unlink')?.onPress?.());
    expect(liveLinks()[0].groupExerciseId).toBe('gx-deadlift');
    expect(screen.getByTestId('exercise-link-notice')).toHaveTextContent(/link changed.*Nothing was unlinked/);
    expect(screen.getByTestId('exercise-link-linked-row-gx-deadlift')).toBeTruthy();
  });

  it('a failed local read hides unlink and retries independently of server reads', async () => {
    await linkExercise('seed_barbell_bench_press', 'g-iron', 'gx-bench');
    jest.spyOn(linksRepo, 'listLinks').mockRejectedValueOnce(new Error('Read failed'));
    await renderScreen();
    expect(await screen.findByTestId('exercise-link-links-error')).toBeTruthy();
    expect(screen.queryByTestId('exercise-link-unlink-gx-bench')).toBeNull();
    fireEvent.press(screen.getByTestId('exercise-link-links-retry'));
    expect(await screen.findByTestId('exercise-link-unlink-gx-bench')).toBeTruthy();
  });

  it('a committed unlink still reports success when reloading its links fails', async () => {
    await linkExercise('seed_barbell_bench_press', 'g-iron', 'gx-bench');
    const spy = jest.spyOn(Alert, 'alert');
    await renderScreen();
    fireEvent.press(await screen.findByTestId('exercise-link-unlink-gx-bench'));
    jest.spyOn(linksRepo, 'listLinks').mockRejectedValueOnce(new Error('Read failed'));
    await act(async () => spy.mock.calls.at(-1)?.[2]?.find((action) => action.text === 'Unlink')?.onPress?.());
    expect(liveLinks()).toEqual([]);
    expect(screen.getByTestId('exercise-link-notice')).toHaveTextContent('Unlinked “Barbell Bench Press” from “Bench Press”.');
    expect(screen.getByTestId('exercise-link-links-error')).toBeTruthy();
    expect(screen.queryByTestId('exercise-link-unlink-gx-bench')).toBeNull();
  });

  it('archived plus inactive targets explain both freezes and remain removable', async () => {
    const old = { exercises: [{ ...GX_BENCH, archived_at_ms: 1 }] };
    warmCache();
    writeGroupCache(fixture.database, { cacheKey: groupCacheKeys.groupExercises('g-iron'), userId: USER_ID, payload: old, fetchedAtMs: 1 });
    await linkExercise('seed_barbell_bench_press', 'g-iron', 'gx-bench');
    api.listGroupExercises.mockImplementation(async (id) => {
      if (id === 'g-iron') throw new GroupApiError('NOT_FOUND', 'group not found');
      return TUESDAY_EXERCISES;
    });
    const spy = jest.spyOn(Alert, 'alert');
    await renderScreen();
    await screen.findByText('inactive — not a member · archived');
    fireEvent.press(screen.getByTestId('exercise-link-unlink-gx-bench'));
    expect(spy.mock.calls[0][1]).toContain('Archived leaderboards stay unchanged');
    expect(spy.mock.calls[0][1]).toContain('Leaderboards stay unchanged while you are not a member');
    expect(spy.mock.calls[0][1]).toContain('Past activity and existing certifications will be kept.');
    await act(async () => spy.mock.calls.at(-1)?.[2]?.find((action) => action.text === 'Unlink')?.onPress?.());
    expect(liveLinks()).toEqual([]);
    expect(screen.queryByTestId('exercise-link-link-gx-bench')).toBeNull();
  });

});
