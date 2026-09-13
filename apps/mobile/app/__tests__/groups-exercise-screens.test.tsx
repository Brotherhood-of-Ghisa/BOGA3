/* eslint-disable import/first */

/**
 * M25-T08 group page (card AC1–AC8; groups contract §4.4, §6.3): the Stream ·
 * Exercises · Leaderboards segments, the Exercises page (link status from the
 * local T03 link rows, owner/admin actions), and the add / edit exercise
 * routes. The group RPCs are mocked; `group_cache`, `exercise_definitions`,
 * and `exercise_group_links` are the real tables on the in-memory SQLite
 * fixture. Every write's offline attempt is refused with no RPC.
 */

import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

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

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), dismissTo: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
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
  getGroup: jest.fn(),
  getGroupStream: jest.fn(),
  listGroupExercises: jest.fn(),
  createGroupExercise: jest.fn(),
  updateGroupExercise: jest.fn(),
  archiveGroupExercise: jest.fn(),
  unarchiveGroupExercise: jest.fn(),
}));

import { SYSTEM_EXERCISE_DEFINITION_SEEDS } from '@/src/data/exercise-catalog-seeds';
import { exerciseDefinitions, exerciseGroupLinks } from '@/src/data/schema';
import {
  GROUP_OFFLINE_ACTION_MESSAGE,
  GROUP_WRITE_UNREACHABLE_MESSAGE,
  GroupApiError,
  groupCacheKeys,
  readGroupCache,
  writeGroupCache,
  type GroupExercise,
  type GroupExerciseListResult,
  type GroupGetResult,
  type GroupRole,
} from '@/src/groups';
import * as groupsApi from '@/src/groups/api';

import EditGroupExerciseRoute from '../group/[groupId]/exercises/[exerciseId]/edit';
import NewGroupExerciseRoute from '../group/[groupId]/exercises/new';
import GroupScreenRoute from '../group/[groupId]/index';

const api = groupsApi as jest.Mocked<typeof groupsApi>;

const USER_ID = 'user-me';
const GROUP_ID = 'group-a';
/** 09:05 local, so "last updated 09:05" holds in any time zone. */
const T0 = new Date(2026, 8, 11, 9, 5).getTime();

const exercise = (id: string, name: string, overrides: Partial<GroupExercise> = {}): GroupExercise => ({
  group_exercise_id: id,
  name,
  load_input_mode: 'total_load',
  source_exercise_id: null,
  archived_at_ms: null,
  ...overrides,
});

const BENCH = exercise('ge-bench', 'Bench Press', { source_exercise_id: 'seed_barbell_bench_press' });
const ROW = exercise('ge-row', 'Cable Row', { load_input_mode: 'per_side_load' });
const OLD = exercise('ge-old', 'Old Squat', { archived_at_ms: T0 });
/** Server order (contract §4.4): active first, then by name. */
const LIST: GroupExerciseListResult = { exercises: [BENCH, ROW, OLD] };

const META: Record<GroupRole, string> = {
  owner: "3 members · You're the owner",
  admin: "3 members · You're an admin",
  member: "3 members · You're a member",
};

const detailFor = (role: GroupRole): GroupGetResult => ({
  group: { group_id: GROUP_ID, name: 'Garage Gym', description: null, member_count: 3, my_role: role },
  members: [{ user_id: USER_ID, username: 'me', role }],
});

const addMyExercise = (id: string, name: string) =>
  fixture.database.insert(exerciseDefinitions).values({ id, name, loadInputMode: 'total_load' }).run();

const addLink = (groupId: string, exerciseDefinitionId: string, groupExerciseId: string, deletedAt: Date | null = null) =>
  fixture.database
    .insert(exerciseGroupLinks)
    .values({ id: `${groupId}:${exerciseDefinitionId}`, exerciseDefinitionId, groupId, groupExerciseId, deletedAt })
    .run();

const seedCache = (cacheKey: string, payload: unknown) =>
  writeGroupCache(fixture.database, { cacheKey, userId: USER_ID, payload, fetchedAtMs: T0 });

const emitNetInfo = (isConnected: boolean) => {
  act(() => {
    for (const listener of mockNetInfoListeners) listener({ isConnected });
  });
};

const alertSpy = () => jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

const pressAlertButton = async (spy: jest.SpyInstance, text: string) => {
  const buttons = spy.mock.calls.at(-1)?.[2] as AlertButton[];
  await act(async () => {
    buttons.find((button) => button.text === text)?.onPress?.();
  });
};

const openGroupAs = async (role: GroupRole) => {
  api.getGroup.mockResolvedValue(detailFor(role));
  render(<GroupScreenRoute />);
  await screen.findByText(META[role]);
};

const openExercisesAs = async (role: GroupRole) => {
  await openGroupAs(role);
  fireEvent.press(screen.getByTestId('group-screen-segment-exercises'));
  await screen.findByTestId('group-exercises-list');
};

const rowIds = () => screen.getAllByTestId(/^group-exercise-row-/).map((node) => node.props.testID as string);

const sheetActions = () =>
  within(screen.getByTestId('group-exercise-actions-sheet'))
    .queryAllByTestId(/^group-exercise-action-/)
    .map((node) => (node.props.testID as string).replace('group-exercise-action-', ''));

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  fixture = createInMemoryDatabase();
  mockNetInfoListeners.clear();
  mockParams = { groupId: GROUP_ID };
  mockUseAuth.mockReturnValue({ isConfigured: true, user: { id: USER_ID } });
  api.getGroup.mockResolvedValue(detailFor('owner'));
  api.getGroupStream.mockResolvedValue({ items: [], next_cursor: null, has_more: false });
  api.listGroupExercises.mockResolvedValue(LIST);
});

afterEach(() => {
  fixture.close();
});

describe('Group page segments (D10, D14)', () => {
  it('shows Stream · Exercises · Leaderboards and no Members segment; Stream is the default', async () => {
    await openGroupAs('member');
    expect(screen.getByTestId('group-screen-segment-stream')).toBeTruthy();
    expect(screen.getByTestId('group-screen-segment-exercises')).toBeTruthy();
    expect(screen.getByTestId('group-screen-segment-leaderboards')).toBeTruthy();
    expect(screen.queryByTestId('group-screen-segment-members')).toBeNull();
    expect(await screen.findByTestId('group-screen-stream-empty')).toBeTruthy();
  });

  it('opens the Members screen from the header member count', async () => {
    await openGroupAs('member');
    fireEvent.press(screen.getByTestId('group-screen-members-link'));
    expect(mockRouter.push).toHaveBeenCalledWith(`/group/${GROUP_ID}/members`);
  });

  it('Leaderboards is an empty state and reads nothing (T09 fills it)', async () => {
    await openGroupAs('owner');
    fireEvent.press(screen.getByTestId('group-screen-segment-leaderboards'));
    expect(screen.getByTestId('group-screen-leaderboards-empty')).toHaveTextContent(/Leaderboards are coming soon/);
    expect(api.listGroupExercises).not.toHaveBeenCalled();
  });

  it('does not read the exercise list until the Exercises segment opens', async () => {
    await openGroupAs('owner');
    expect(api.listGroupExercises).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('group-screen-segment-exercises'));
    await screen.findByTestId('group-exercises-list');
    expect(api.listGroupExercises).toHaveBeenCalledWith(GROUP_ID);
  });
});

describe('Exercises page (E0.4)', () => {
  it('lists active exercises, then archived ones marked Archived, with weight entry and my local link status', async () => {
    addMyExercise('def-comp', 'Bench (comp grip)');
    addMyExercise('def-hotel', 'Bench (hotel gym)');
    addMyExercise('def-gone', 'Old Row');
    addMyExercise('def-other', 'Squat');
    addLink(GROUP_ID, 'def-comp', 'ge-bench');
    addLink(GROUP_ID, 'def-hotel', 'ge-bench');
    // An unlinked (tombstoned) link and a link in another group do not count.
    addLink(GROUP_ID, 'def-gone', 'ge-row', new Date(T0));
    addLink('group-b', 'def-other', 'ge-old');

    await openExercisesAs('member');
    expect(rowIds()).toEqual(['group-exercise-row-ge-bench', 'group-exercise-row-ge-row', 'group-exercise-row-ge-old']);
    expect(await screen.findByTestId('group-exercise-link-status-ge-bench')).toHaveTextContent(
      'Linked: Bench (comp grip), Bench (hotel gym)',
    );
    expect(screen.getByTestId('group-exercise-link-status-ge-row')).toHaveTextContent('Not linked');
    expect(screen.getByTestId('group-exercise-link-status-ge-old')).toHaveTextContent('Not linked');
    expect(screen.getByTestId('group-exercise-load-mode-ge-row')).toHaveTextContent('Per side');
    expect(screen.getByTestId('group-exercise-archived-ge-old')).toHaveTextContent('Archived');
    expect(screen.queryByTestId('group-exercise-archived-ge-bench')).toBeNull();
    await waitFor(() => expect(readGroupCache(fixture.database, groupCacheKeys.groupExercises(GROUP_ID), USER_ID)).not.toBeNull());
  });

  it('member: no Add exercise and no row actions', async () => {
    await openExercisesAs('member');
    expect(screen.queryByTestId('group-exercises-add-button')).toBeNull();
    fireEvent.press(screen.getByTestId('group-exercise-row-ge-row'));
    expect(screen.queryByTestId('group-exercise-actions-sheet')).toBeNull();
  });

  it.each<GroupRole>(['owner', 'admin'])('%s: Add exercise, Rename + Archive on active rows, Unarchive only on archived ones', async (role) => {
    await openExercisesAs(role);
    fireEvent.press(screen.getByTestId('group-exercises-add-button'));
    expect(mockRouter.push).toHaveBeenLastCalledWith(`/group/${GROUP_ID}/exercises/new`);

    fireEvent.press(screen.getByTestId('group-exercise-row-ge-row'));
    expect(sheetActions()).toEqual(['rename', 'archive']);
    fireEvent.press(screen.getByTestId('group-exercise-action-rename'));
    expect(mockRouter.push).toHaveBeenLastCalledWith(`/group/${GROUP_ID}/exercises/ge-row/edit`);
    expect(screen.queryByTestId('group-exercise-actions-sheet')).toBeNull();

    fireEvent.press(screen.getByTestId('group-exercise-row-ge-old'));
    expect(sheetActions()).toEqual(['unarchive']);
  });

  it('empty list: admins see Add exercise, members are told admins add them', async () => {
    api.listGroupExercises.mockResolvedValue({ exercises: [] });
    await openGroupAs('member');
    fireEvent.press(screen.getByTestId('group-screen-segment-exercises'));
    expect(await screen.findByTestId('group-exercises-empty')).toHaveTextContent(/Admins add exercises here/);
    expect(screen.queryByTestId('group-exercises-add-button')).toBeNull();
  });

  it('empty list as owner offers Add exercise in the empty state', async () => {
    api.listGroupExercises.mockResolvedValue({ exercises: [] });
    await openGroupAs('owner');
    fireEvent.press(screen.getByTestId('group-screen-segment-exercises'));
    const empty = await screen.findByTestId('group-exercises-empty');
    expect(within(empty).getByTestId('group-exercises-add-button')).toBeTruthy();
  });

  it('renders the cached list under the offline marker when offline, with no request', async () => {
    seedCache(groupCacheKeys.group(GROUP_ID), detailFor('owner'));
    seedCache(groupCacheKeys.groupExercises(GROUP_ID), LIST);
    render(<GroupScreenRoute />);
    await screen.findByText(META.owner);
    emitNetInfo(false);
    api.listGroupExercises.mockClear();
    fireEvent.press(screen.getByTestId('group-screen-segment-exercises'));
    await screen.findByTestId('group-exercises-list');
    expect(screen.getByText(/Offline · last updated 09:05/)).toBeTruthy();
    expect(api.listGroupExercises).not.toHaveBeenCalled();
  });

  it('shows the offline empty state when offline with nothing cached', async () => {
    await openGroupAs('owner');
    emitNetInfo(false);
    fireEvent.press(screen.getByTestId('group-screen-segment-exercises'));
    expect(await screen.findByTestId('group-screen-exercises-offline-empty-state')).toBeTruthy();
    expect(api.listGroupExercises).not.toHaveBeenCalled();
  });

  it("NOT_FOUND on the list shows \"You're no longer a member\" and evicts the cached list", async () => {
    seedCache(groupCacheKeys.groupExercises(GROUP_ID), LIST);
    api.listGroupExercises.mockRejectedValue(new GroupApiError('NOT_FOUND', 'group not found'));
    await openGroupAs('owner');
    fireEvent.press(screen.getByTestId('group-screen-segment-exercises'));
    expect(await screen.findByTestId('group-screen-lost-access')).toBeTruthy();
    await waitFor(() => expect(readGroupCache(fixture.database, groupCacheKeys.groupExercises(GROUP_ID), USER_ID)).toBeNull());
  });
});

describe('Exercises page: archive and unarchive (owner, admin)', () => {
  it('Archive confirms first; confirming archives, reports it, and refreshes the list', async () => {
    const alert = alertSpy();
    api.archiveGroupExercise.mockResolvedValue({ exercise: { ...ROW, archived_at_ms: T0 } });
    await openExercisesAs('owner');

    fireEvent.press(screen.getByTestId('group-exercise-row-ge-row'));
    fireEvent.press(screen.getByTestId('group-exercise-action-archive'));
    expect(alert).toHaveBeenLastCalledWith('Archive Cable Row?', expect.stringMatching(/read-only/), expect.any(Array));
    await pressAlertButton(alert, 'Cancel');
    expect(api.archiveGroupExercise).not.toHaveBeenCalled();

    const reads = api.listGroupExercises.mock.calls.length;
    fireEvent.press(screen.getByTestId('group-exercise-row-ge-row'));
    fireEvent.press(screen.getByTestId('group-exercise-action-archive'));
    await pressAlertButton(alert, 'Archive');
    expect(api.archiveGroupExercise).toHaveBeenCalledWith(GROUP_ID, 'ge-row');
    expect(screen.getByTestId('group-exercises-action-feedback')).toHaveTextContent('Cable Row was archived.');
    await waitFor(() => expect(api.listGroupExercises.mock.calls.length).toBeGreaterThan(reads));
  });

  it('Unarchive runs without confirmation', async () => {
    const alert = alertSpy();
    api.unarchiveGroupExercise.mockResolvedValue({ exercise: { ...OLD, archived_at_ms: null } });
    await openExercisesAs('admin');
    fireEvent.press(screen.getByTestId('group-exercise-row-ge-old'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-exercise-action-unarchive'));
    });
    expect(alert).not.toHaveBeenCalled();
    expect(api.unarchiveGroupExercise).toHaveBeenCalledWith(GROUP_ID, 'ge-old');
    expect(screen.getByTestId('group-exercises-action-feedback')).toHaveTextContent('Old Squat is active again.');
  });

  it('refuses to archive offline with no RPC, and says nothing changed', async () => {
    const alert = alertSpy();
    await openExercisesAs('owner');
    emitNetInfo(false);
    fireEvent.press(screen.getByTestId('group-exercise-row-ge-row'));
    fireEvent.press(screen.getByTestId('group-exercise-action-archive'));
    await pressAlertButton(alert, 'Archive');
    expect(api.archiveGroupExercise).not.toHaveBeenCalled();
    expect(screen.getByTestId('group-exercises-action-feedback')).toHaveTextContent(GROUP_OFFLINE_ACTION_MESSAGE);
  });

  it('shows FORBIDDEN inline and refreshes the group and the list', async () => {
    api.unarchiveGroupExercise.mockRejectedValue(new GroupApiError('FORBIDDEN', 'forbidden'));
    await openExercisesAs('admin');
    const groupReads = api.getGroup.mock.calls.length;
    const listReads = api.listGroupExercises.mock.calls.length;
    fireEvent.press(screen.getByTestId('group-exercise-row-ge-old'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-exercise-action-unarchive'));
    });
    expect(screen.getByTestId('group-exercises-action-feedback')).toHaveTextContent(/not allowed to do that any more/);
    await waitFor(() => expect(api.getGroup.mock.calls.length).toBeGreaterThan(groupReads));
    await waitFor(() => expect(api.listGroupExercises.mock.calls.length).toBeGreaterThan(listReads));
  });
});

describe('Add exercise route', () => {
  const renderNew = async () => {
    render(<NewGroupExerciseRoute />);
    await screen.findByTestId('group-exercise-source-row');
  };

  const submit = async () => {
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    });
  };

  it('copies a standard exercise: its seed id, name, and weight entry', async () => {
    const seed = SYSTEM_EXERCISE_DEFINITION_SEEDS.find((candidate) => candidate.id === 'seed_barbell_bench_press')!;
    api.createGroupExercise.mockResolvedValue({ exercise: BENCH });
    await renderNew();
    expect(screen.getByTestId('group-exercise-pick-hint')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('group-standard-exercise-search'), 'barbell bench');
    fireEvent.press(screen.getByTestId(`group-standard-exercise-${seed.id}`));
    expect(screen.getByTestId('group-exercise-form-name-input').props.value).toBe(seed.name);
    expect(screen.getByTestId('group-exercise-form-note')).toHaveTextContent(seed.name, { exact: false });

    await submit();
    expect(api.createGroupExercise).toHaveBeenCalledWith(GROUP_ID, {
      name: seed.name,
      loadInputMode: seed.loadInputMode,
      sourceExerciseId: seed.id,
    });
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('keeps the seed id when the copied name is changed', async () => {
    api.createGroupExercise.mockResolvedValue({ exercise: BENCH });
    await renderNew();
    fireEvent.changeText(screen.getByTestId('group-standard-exercise-search'), 'barbell bench');
    fireEvent.press(screen.getByTestId('group-standard-exercise-seed_barbell_bench_press'));
    fireEvent.changeText(screen.getByTestId('group-exercise-form-name-input'), 'Comp Bench');
    await submit();
    expect(api.createGroupExercise).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ name: 'Comp Bench', sourceExerciseId: 'seed_barbell_bench_press' }),
    );
  });

  it('says so when no standard exercise matches', async () => {
    await renderNew();
    fireEvent.changeText(screen.getByTestId('group-standard-exercise-search'), 'zzz-no-such-lift');
    expect(screen.getByTestId('group-standard-exercise-no-match')).toBeTruthy();
  });

  it('creates a custom exercise with a trimmed name, the chosen weight entry, and no source', async () => {
    api.createGroupExercise.mockResolvedValue({ exercise: ROW });
    await renderNew();
    fireEvent.press(screen.getByTestId('group-exercise-source-custom'));
    fireEvent.changeText(screen.getByTestId('group-exercise-form-name-input'), '  Sled Push ');
    fireEvent.press(screen.getByTestId('group-exercise-form-load-mode-per_side_load'));
    await submit();
    expect(api.createGroupExercise).toHaveBeenCalledWith(GROUP_ID, {
      name: 'Sled Push',
      loadInputMode: 'per_side_load',
      sourceExerciseId: null,
    });
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('validates the name with the shared ExerciseCore rules before any request', async () => {
    await renderNew();
    fireEvent.press(screen.getByTestId('group-exercise-source-custom'));
    fireEvent.changeText(screen.getByTestId('group-exercise-form-name-input'), ' \t ');
    await submit();
    expect(screen.getByTestId('group-exercise-form-name-error')).toHaveTextContent('Exercise name is required');
    expect(api.createGroupExercise).not.toHaveBeenCalled();
  });

  it('refuses offline with no RPC and keeps the draft', async () => {
    await renderNew();
    emitNetInfo(false);
    fireEvent.press(screen.getByTestId('group-exercise-source-custom'));
    fireEvent.changeText(screen.getByTestId('group-exercise-form-name-input'), 'Sled Push');
    await submit();
    expect(api.createGroupExercise).not.toHaveBeenCalled();
    expect(screen.getByTestId('group-exercise-form-error')).toHaveTextContent(GROUP_OFFLINE_ACTION_MESSAGE);
    expect(screen.getByTestId('group-exercise-form-name-input').props.value).toBe('Sled Push');
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('shows a transport failure as "nothing changed" and stays', async () => {
    api.createGroupExercise.mockRejectedValue(new GroupApiError('NETWORK', 'Network request failed.'));
    await renderNew();
    fireEvent.press(screen.getByTestId('group-exercise-source-custom'));
    fireEvent.changeText(screen.getByTestId('group-exercise-form-name-input'), 'Sled Push');
    await submit();
    expect(screen.getByTestId('group-exercise-form-error')).toHaveTextContent(GROUP_WRITE_UNREACHABLE_MESSAGE);
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('does not offer the form to a member', async () => {
    api.getGroup.mockResolvedValue(detailFor('member'));
    render(<NewGroupExerciseRoute />);
    expect(await screen.findByTestId('group-exercise-new-forbidden')).toBeTruthy();
    expect(screen.queryByTestId('group-exercise-form')).toBeNull();
  });
});

describe('Edit exercise route', () => {
  beforeEach(() => {
    seedCache(groupCacheKeys.group(GROUP_ID), detailFor('owner'));
    seedCache(groupCacheKeys.groupExercises(GROUP_ID), LIST);
  });

  const renderEdit = (exerciseId: string) => {
    mockParams = { groupId: GROUP_ID, exerciseId };
    render(<EditGroupExerciseRoute />);
  };

  it('prefills the shared form from the list and saves the new name and weight entry', async () => {
    api.updateGroupExercise.mockResolvedValue({ exercise: { ...ROW, name: 'Seated Cable Row' } });
    renderEdit('ge-row');
    const nameInput = await screen.findByTestId('group-exercise-form-name-input');
    expect(nameInput.props.value).toBe('Cable Row');
    expect(screen.getByTestId('group-exercise-form-load-mode-per_side_load').props.accessibilityState).toMatchObject({ selected: true });

    fireEvent.changeText(nameInput, 'Seated Cable Row');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    });
    expect(api.updateGroupExercise).toHaveBeenCalledWith(GROUP_ID, 'ge-row', {
      name: 'Seated Cable Row',
      loadInputMode: 'per_side_load',
    });
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('shows a server VALIDATION refusal next to the form and stays', async () => {
    api.updateGroupExercise.mockRejectedValue(
      new GroupApiError('VALIDATION', 'an archived group exercise is read-only; unarchive it first'),
    );
    renderEdit('ge-bench');
    await screen.findByTestId('group-exercise-form');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    });
    expect(screen.getByTestId('group-exercise-form-error')).toHaveTextContent(
      'An archived group exercise is read-only; unarchive it first. Nothing was changed.',
    );
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('does not edit an archived exercise', async () => {
    renderEdit('ge-old');
    expect(await screen.findByTestId('group-exercise-edit-archived')).toBeTruthy();
    expect(screen.queryByTestId('group-exercise-form')).toBeNull();
  });

  it('says the exercise is gone when it is not in the list', async () => {
    renderEdit('ge-missing');
    expect(await screen.findByTestId('group-exercise-edit-missing')).toBeTruthy();
  });

  it('does not offer the form to a member', async () => {
    seedCache(groupCacheKeys.group(GROUP_ID), detailFor('member'));
    api.getGroup.mockResolvedValue(detailFor('member'));
    renderEdit('ge-row');
    expect(await screen.findByTestId('group-exercise-edit-forbidden')).toBeTruthy();
  });
});
