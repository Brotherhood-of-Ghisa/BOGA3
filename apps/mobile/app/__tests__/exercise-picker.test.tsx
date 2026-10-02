/* eslint-disable import/first */

/**
 * The shared exercise picker (`components/session-recorder/exercise-picker.tsx`)
 * rendered on its own over real data: the catalog cache and repository, the
 * catalog stats, the suggested-plan read, the group-linking hook and the link
 * writes run over the migrated in-memory SQLite database (helpers/local-data.ts).
 * Everything the host does with a pick is asserted on the callback props; every
 * write is read back from the database.
 *
 * Each suite starts from an empty catalogue (a sync-configured install before
 * its first pull) and creates its exercises through the catalogue's own write
 * path, so names and muscles are the ones the assertions use. History is
 * logged through the session draft → complete path.
 *
 * Replaced: the native database open, the router, the auth snapshot, NetInfo,
 * and the group server reads (`@/src/groups/api`), as in the groups suites.
 * Named states real data cannot produce: a suggestion still loading and a
 * failed link write.
 */

import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { and, eq, isNull } from 'drizzle-orm';
import { StyleSheet, type ViewStyle } from 'react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => callback(), [callback]);
  },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ addListener: jest.fn(() => () => undefined), dispatch: jest.fn() }),
  useRouter: () => ({ replace: jest.fn(), push: mockPush }),
}));

let mockUserId: string | null = 'user-1';
jest.mock('@/src/auth', () => ({
  getAuthSnapshot: () => ({ isConfigured: true, user: mockUserId ? { id: mockUserId } : null }),
  subscribeToAuthState: () => () => undefined,
}));

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

jest.mock('@/src/groups/api', () => ({
  ...jest.requireActual('@/src/groups/api'),
  listMyGroups: jest.fn(),
  listGroupExercises: jest.fn(),
}));

import { ExerciseSwapSheet } from '@/components/exercise-page/exercise-swap-sheet';
import { ExercisePicker } from '@/components/session-recorder/exercise-picker';
import { uiRoles } from '@/components/ui/tokens';
import * as blockHistory from '@/src/data/exercise-block-history';
import { saveExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import * as linksRepository from '@/src/data/exercise-group-links';
import { exerciseDefinitions, exerciseGroupLinks, exerciseMuscleMappings } from '@/src/data/schema';
import { completeSessionDraft, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { __resetExerciseListPreferencesForTests } from '@/src/exercise-catalog/list-preferences';
import {
  groupCacheKeys,
  writeGroupCache,
  type GroupExercise,
  type GroupExerciseListResult,
  type GroupListMineResult,
  type GroupSummary,
} from '@/src/groups';
import * as groupsApi from '@/src/groups/api';
import {
  bootLocalApp,
  closeLocalData,
  localDatabase,
  resetLocalData,
} from './helpers/local-data';

const api = groupsApi as jest.Mocked<typeof groupsApi>;

type SeedExercise = {
  id: string;
  name: string;
  loadInputMode?: 'total_load' | 'per_side_load';
  mappings: { muscleGroupId: string; weight: number; role: 'primary' | 'secondary' }[];
};

const primary = (muscleGroupId: string) => ({ muscleGroupId, weight: 1, role: 'primary' as const });

// ---- Catalogue: the group picker's (once session-recorder-group-picker).

const GROUP_FIXTURE_EXERCISES: SeedExercise[] = [
  { id: 'seed_barbell_back_squat', name: 'Barbell Squat', mappings: [primary('quads')] },
  { id: 'seed_barbell_bench_press', name: 'Bench Press', mappings: [primary('chest')] },
  { id: 'ex-hotel', name: 'Hotel Bench', loadInputMode: 'per_side_load', mappings: [primary('chest')] },
];

// ---- Catalogue: the recorder interactions' (once session-recorder-interactions).

const INTERACTION_FIXTURE_EXERCISES: SeedExercise[] = [
  { id: 'seed_barbell_back_squat', name: 'Barbell Squat', mappings: [primary('quads')] },
  {
    id: 'seed_barbell_bench_press',
    name: 'Bench Press',
    mappings: [primary('chest'), { muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' }],
  },
  { id: 'seed_dumbbell_bench_press', name: 'Dumbbell Bench Press', loadInputMode: 'per_side_load', mappings: [primary('chest')] },
  { id: 'seed_romanian_deadlift', name: 'Deadlift', mappings: [primary('hamstrings')] },
  { id: 'seed_overhead_press', name: 'Overhead Press', mappings: [primary('delts_front')] },
];

// ---- Groups: what the server reads return.

const IRON: GroupSummary = { group_id: 'g-iron', name: 'Iron Brotherhood', description: null, member_count: 3, my_role: 'member', bodyweight_calculations_enabled: false };
const TUESDAY: GroupSummary = { group_id: 'g-tue', name: 'Tuesday Crew', description: null, member_count: 2, my_role: 'member', bodyweight_calculations_enabled: false };

const groupExercise = (overrides: Partial<GroupExercise> & Pick<GroupExercise, 'group_exercise_id' | 'name'>): GroupExercise => ({
  load_input_mode: 'total_load',
  source_exercise_id: null,
  archived_at_ms: null,
  ...overrides,
});

const GX_BENCH = groupExercise({ group_exercise_id: 'gx-bench', name: 'Bench Press', source_exercise_id: 'seed_barbell_bench_press' });
const GX_ROW = groupExercise({ group_exercise_id: 'gx-row', name: 'Pendlay Row' });
const GX_TUE_SQUAT = groupExercise({ group_exercise_id: 'gx-tue-squat', name: 'Back Squat' });
const GX_TUE_BENCH = groupExercise({ group_exercise_id: 'gx-tue-bench', name: 'Bench', load_input_mode: 'per_side_load' });

const MINE: GroupListMineResult = { groups: [IRON, TUESDAY] };
const GROUP_EXERCISES: Record<string, GroupExerciseListResult> = {
  'g-iron': { exercises: [GX_BENCH, GX_ROW] },
  'g-tue': { exercises: [GX_TUE_SQUAT, GX_TUE_BENCH] },
};

// ---- Seeding

const seedCatalog = async (exercises: SeedExercise[]) => {
  // Boot (seeding the starter catalogue), then empty it.
  localDatabase().delete(exerciseMuscleMappings).run();
  localDatabase().delete(exerciseDefinitions).run();
  for (const exercise of exercises) {
    await saveExerciseCatalogExercise({ bodyweightContribution: 0, loadInputMode: 'total_load', ...exercise });
  }
};

const seedGroupCatalogue = async (links: [exerciseDefinitionId: string, groupId: string, groupExerciseId: string][] = [
  ['seed_barbell_back_squat', 'g-tue', 'gx-tue-squat'],
]) => {
  await seedCatalog(GROUP_FIXTURE_EXERCISES);
  for (const link of links) {
    await linksRepository.linkExercise(...link);
  }
};

// The group reads, as the linking hook caches them after a refresh.
const warmGroupCache = () => {
  const put = (cacheKey: string, payload: unknown) =>
    writeGroupCache(localDatabase(), { cacheKey, userId: 'user-1', payload, fetchedAtMs: Date.now() });
  put(groupCacheKeys.mine, MINE);
  put(groupCacheKeys.groupExercises('g-iron'), GROUP_EXERCISES['g-iron']);
  put(groupCacheKeys.groupExercises('g-tue'), GROUP_EXERCISES['g-tue']);
};

// A completed session with two Barbell Squat blocks, through the draft → complete path.
const SQUAT_HISTORY_AT = new Date(2026, 5, 10, 18, 42);
const logSquatHistory = async () => {
  const sessionId = 'history-session-1';
  await persistSessionDraftSnapshot(
    {
      sessionId,
      gymId: null,
      startedAt: new Date(SQUAT_HISTORY_AT.getTime() - 45 * 60 * 1000),
      exercises: [
        {
          id: 'history-exercise-1',
          exerciseDefinitionId: 'seed_barbell_back_squat',
          name: 'Barbell Squat',
          sets: [{ id: 'history-set-1', weightValue: '0', repsValue: '10', setType: 'warm_up', performanceStatus: null }],
        },
        {
          id: 'history-exercise-2',
          exerciseDefinitionId: 'seed_barbell_back_squat',
          name: 'Barbell Squat',
          sets: [{ id: 'history-set-2', weightValue: '120', repsValue: '5', setType: 'rir_1', performanceStatus: null }],
        },
      ],
    },
    { now: SQUAT_HISTORY_AT }
  );
  await completeSessionDraft(sessionId, { completedAt: SQUAT_HISTORY_AT, now: SQUAT_HISTORY_AT });
};

const liveLinks = () =>
  localDatabase()
    .select({
      exerciseDefinitionId: exerciseGroupLinks.exerciseDefinitionId,
      groupId: exerciseGroupLinks.groupId,
      groupExerciseId: exerciseGroupLinks.groupExerciseId,
    })
    .from(exerciseGroupLinks)
    .where(isNull(exerciseGroupLinks.deletedAt))
    .all()
    .sort((a, b) => a.groupId.localeCompare(b.groupId) || String(a.exerciseDefinitionId).localeCompare(String(b.exerciseDefinitionId)));

const liveExercisesNamed = (name: string) =>
  localDatabase()
    .select()
    .from(exerciseDefinitions)
    .where(and(eq(exerciseDefinitions.name, name), isNull(exerciseDefinitions.deletedAt)))
    .all();

// ---- Harness

type PickerCallbacks = {
  onDismiss: jest.Mock;
  onSelectExercise: jest.Mock;
  onAppendPlan: jest.Mock;
  onOpenManage: jest.Mock;
};

let callbacks: PickerCallbacks;
let unmountPicker: (() => void) | null = null;

const renderPicker = async (seed: () => Promise<void>, expandFamilies = true) => {
  await seed();
  await bootLocalApp();
  callbacks = {
    onDismiss: jest.fn(),
    onSelectExercise: jest.fn(),
    onAppendPlan: jest.fn(),
    onOpenManage: jest.fn(),
  };
  const result = render(<ExercisePicker visible openRequestId={1} {...callbacks} />);
  unmountPicker = result.unmount;
  await act(async () => {});
  if (expandFamilies) {
    await screen.findByLabelText(/Chest exercises/);
    for (const family of screen.getAllByTestId(/^exercise-family-group-/)) {
      if (!family.props.accessibilityState.disabled) fireEvent.press(family);
    }
  }
  return callbacks;
};

// The group catalogue, signed in and online, the group reads landed.
const openGroupPicker = async (seed: () => Promise<void> = () => seedGroupCatalogue()) => {
  const result = await renderPicker(seed);
  await screen.findByLabelText('Select exercise Bench Press');
  await waitFor(() => expect(screen.getByTestId('exercise-picker-groups-toggle')).toBeTruthy());
  return result;
};

const openGroupRows = async (seed?: () => Promise<void>) => {
  const result = await openGroupPicker(seed);
  toggleGroups();
  await screen.findByTestId('exercise-picker-group-row-gx-bench');
  return result;
};

const toggleGroups = () => fireEvent.press(screen.getByTestId('exercise-picker-groups-toggle'));

beforeEach(() => {
  resetLocalData();
  __resetExerciseListPreferencesForTests();
  mockPush.mockReset();
  mockUserId = 'user-1';
  mockConnected = true;
  api.listMyGroups.mockReset().mockResolvedValue(MINE);
  api.listGroupExercises.mockReset().mockImplementation(async (groupId: string) => GROUP_EXERCISES[groupId]);
});

afterEach(() => {
  unmountPicker?.();
  unmountPicker = null;
  jest.restoreAllMocks();
  jest.useRealTimers();
  closeLocalData();
});

describe('picker: group exercises (E0.1)', () => {
  it('the default list has no group rows; a search lists them after my own matches', async () => {
    await openGroupPicker();

    expect(screen.queryByTestId('exercise-picker-group-section')).toBeNull();
    expect(screen.queryByTestId('exercise-picker-group-row-gx-bench')).toBeNull();

    fireEvent.changeText(screen.getByLabelText('Exercise filter input'), 'bench');

    const section = await screen.findByTestId('exercise-picker-group-section');
    expect(within(section).getByLabelText('Group exercise Bench Press in Iron Brotherhood, not linked')).toBeTruthy();
    expect(within(section).getByLabelText('Group exercise Bench in Tuesday Crew, not linked')).toBeTruthy();
    // Archived/unmatched rows are left out; my own match still lists, first.
    expect(within(section).queryByTestId('exercise-picker-group-row-gx-row')).toBeNull();
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf('Select exercise Bench Press')).toBeGreaterThan(-1);
    expect(tree.indexOf('Select exercise Bench Press')).toBeLessThan(tree.indexOf('exercise-picker-group-section'));
  });

  it('the Groups toggle shows group exercises only, with their link status', async () => {
    await openGroupRows();

    expect(screen.getByTestId('exercise-picker-groups-toggle')).toHaveProp('accessibilityState', { checked: true });
    expect(StyleSheet.flatten(screen.getByTestId('exercise-picker-groups-toggle').props.style)).toMatchObject({
      backgroundColor: uiRoles.ink,
    });
    expect(screen.queryByLabelText('Select exercise Barbell Squat')).toBeNull();
    expect(screen.getByLabelText('Group exercise Back Squat in Tuesday Crew, linked: Barbell Squat')).toBeTruthy();
    expect(screen.getByTestId('exercise-picker-group-row-gx-row')).toBeTruthy();
  });

  it('picking a linked group exercise adds my exercise and writes nothing', async () => {
    const { onSelectExercise } = await openGroupRows();
    const linksBefore = liveLinks();

    fireEvent.press(screen.getByTestId('exercise-picker-group-row-gx-tue-squat'));

    expect(onSelectExercise).toHaveBeenCalledTimes(1);
    expect(onSelectExercise).toHaveBeenCalledWith('seed_barbell_back_squat', 'Barbell Squat');
    expect(screen.queryByTestId('group-pick-sheet')).toBeNull();
    expect(liveLinks()).toEqual(linksBefore);
  });

  it('with several linked exercises, the sheet asks which to add', async () => {
    const { onSelectExercise } = await openGroupRows(() =>
      seedGroupCatalogue([
        ['seed_barbell_bench_press', 'g-iron', 'gx-bench'],
        ['ex-hotel', 'g-iron', 'gx-bench'],
      ])
    );
    const linksBefore = liveLinks();

    fireEvent.press(screen.getByTestId('exercise-picker-group-row-gx-bench'));
    fireEvent.press(await screen.findByTestId('group-pick-sheet-linked-ex-hotel'));

    expect(onSelectExercise).toHaveBeenCalledTimes(1);
    expect(onSelectExercise).toHaveBeenCalledWith('ex-hotel', 'Hotel Bench');
    expect(screen.queryByTestId('group-pick-sheet')).toBeNull();
    expect(liveLinks()).toEqual(linksBefore);
  });
});

describe('pick sheet (E0.2)', () => {
  it('preselects my copy of the standard exercise; Link and add links, then adds it', async () => {
    const { onSelectExercise } = await openGroupRows();
    fireEvent.press(screen.getByTestId('exercise-picker-group-row-gx-bench'));

    const sheet = await screen.findByTestId('group-pick-sheet');
    expect(within(sheet).getByText('Bench Press · Iron Brotherhood')).toBeTruthy();
    expect(screen.getByTestId('group-pick-sheet-option-suggested')).toHaveProp('accessibilityState', { checked: true });
    expect(screen.getByTestId('group-pick-sheet-retroactivity')).toHaveTextContent(
      'Your past Bench Press sets shared with Iron Brotherhood will count.',
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('group-pick-sheet-confirm'));
    });

    expect(liveLinks()).toContainEqual({
      exerciseDefinitionId: 'seed_barbell_bench_press',
      groupId: 'g-iron',
      groupExerciseId: 'gx-bench',
    });
    expect(screen.queryByTestId('group-pick-sheet')).toBeNull();
    expect(onSelectExercise).toHaveBeenCalledWith('seed_barbell_bench_press', 'Bench Press');
    // The links reload: the row now reads as linked.
    expect(await screen.findByLabelText('Group exercise Bench Press in Iron Brotherhood, linked: Bench Press')).toBeTruthy();
  });

  it('offline: Link and add writes the link locally and adds the exercise', async () => {
    mockConnected = false;
    const { onSelectExercise } = await openGroupRows(async () => {
      await seedGroupCatalogue();
      warmGroupCache();
    });
    fireEvent.press(screen.getByTestId('exercise-picker-group-row-gx-bench'));
    await screen.findByTestId('group-pick-sheet');
    const serverReadsBefore = api.listMyGroups.mock.calls.length;

    await act(async () => {
      fireEvent.press(screen.getByTestId('group-pick-sheet-confirm'));
    });

    expect(liveLinks()).toContainEqual({
      exerciseDefinitionId: 'seed_barbell_bench_press',
      groupId: 'g-iron',
      groupExerciseId: 'gx-bench',
    });
    expect(onSelectExercise).toHaveBeenCalledWith('seed_barbell_bench_press', 'Bench Press');
    // The link is a local write: nothing asks the server.
    expect(api.listMyGroups.mock.calls.length).toBe(serverReadsBefore);
  });

  it('a failed link write shows inline and adds nothing (a failed write)', async () => {
    const { onSelectExercise } = await openGroupRows();
    jest.spyOn(linksRepository, 'linkExercise').mockRejectedValueOnce(new Error('disk full'));
    fireEvent.press(screen.getByTestId('exercise-picker-group-row-gx-bench'));

    await act(async () => {
      fireEvent.press(await screen.findByTestId('group-pick-sheet-confirm'));
    });

    expect(screen.getByTestId('group-pick-sheet-error')).toHaveTextContent('disk full');
    expect(onSelectExercise).not.toHaveBeenCalled();
  });

  it('Choose another: exercises linked in the group are unavailable, and a mode mismatch is noted', async () => {
    await openGroupRows();
    fireEvent.press(screen.getByTestId('exercise-picker-group-row-gx-tue-bench'));
    fireEvent.press(await screen.findByTestId('group-pick-sheet-option-other'));

    const squat = screen.getByTestId('group-pick-sheet-choice-seed_barbell_back_squat');
    expect(squat).toBeDisabled();
    expect(within(squat).getByText('already linked in Tuesday Crew')).toBeTruthy();

    fireEvent.press(screen.getByTestId('group-pick-sheet-choice-seed_barbell_bench_press'));
    expect(screen.getByTestId('group-pick-sheet-load-mode-note')).toHaveTextContent(
      'Weight stays as logged. 1RM is compared in per-side terms.',
    );
    fireEvent.press(screen.getByTestId('group-pick-sheet-choice-ex-hotel'));
    expect(screen.queryByTestId('group-pick-sheet-load-mode-note')).toBeNull();
  });

  it('with no suggestion, Add as new is preselected; dismissing returns to the picker', async () => {
    const { onSelectExercise, onDismiss } = await openGroupRows();
    fireEvent.press(screen.getByTestId('exercise-picker-group-row-gx-row'));

    expect(await screen.findByTestId('group-pick-sheet-option-add-new')).toHaveProp('accessibilityState', { checked: true });
    expect(screen.queryByTestId('group-pick-sheet-option-suggested')).toBeNull();
    // The picker hides while its sheet is open.
    expect(screen.queryByTestId('exercise-picker-groups-toggle')).toBeNull();

    // No Cancel (G5): the backdrop dismisses the sheet.
    fireEvent.press(screen.getByTestId('group-pick-sheet-backdrop', { includeHiddenElements: true }));
    expect(screen.queryByTestId('group-pick-sheet')).toBeNull();
    expect(screen.getByTestId('exercise-picker-groups-toggle')).toBeTruthy();
    expect(onSelectExercise).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('Add as new opens the prefilled editor and creates the exercise and its link together', async () => {
    const { onSelectExercise } = await openGroupRows();
    fireEvent.press(screen.getByTestId('exercise-picker-group-row-gx-bench'));
    fireEvent.press(await screen.findByTestId('group-pick-sheet-option-add-new'));
    fireEvent.press(screen.getByTestId('group-pick-sheet-confirm'));

    expect(await screen.findByTestId('exercise-editor-name-input')).toHaveProp('value', 'Bench Press');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Save exercise definition'));
    });

    // A second Bench Press, linked; mine stays unlinked.
    const created = liveExercisesNamed('Bench Press').find((row) => row.id !== 'seed_barbell_bench_press');
    expect(created).toMatchObject({ loadInputMode: 'total_load' });
    expect(liveLinks()).toEqual([
      { exerciseDefinitionId: created!.id, groupId: 'g-iron', groupExerciseId: 'gx-bench' },
      { exerciseDefinitionId: 'seed_barbell_back_squat', groupId: 'g-tue', groupExerciseId: 'gx-tue-squat' },
    ]);
    await waitFor(() => {
      expect(onSelectExercise).toHaveBeenCalledWith(created!.id, 'Bench Press');
    });
  });
});

describe('signed out', () => {
  it('no Groups toggle, no group section, and no group read', async () => {
    mockUserId = null;
    const { onSelectExercise } = await renderPicker(() => seedGroupCatalogue([]));
    await screen.findByLabelText('Select exercise Bench Press');

    expect(screen.queryByTestId('exercise-picker-groups-toggle')).toBeNull();
    fireEvent.changeText(screen.getByLabelText('Exercise filter input'), 'bench');
    expect(screen.queryByTestId('exercise-picker-group-section')).toBeNull();
    expect(api.listMyGroups).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('Select exercise Bench Press'));
    fireEvent.press(await screen.findByTestId('exercise-picker-add-empty-set-button'));
    expect(onSelectExercise).toHaveBeenCalledWith('seed_barbell_bench_press', 'Bench Press');
  });
});

describe('picker: list, preselection, create, Manage and dismiss', () => {
  // As in the old recorder's interaction tests: group linking is off.
  beforeEach(() => {
    mockUserId = null;
  });

  const openInteractions = (expandFamilies = true, history?: () => Promise<void>) =>
    renderPicker(async () => {
      await seedCatalog(INTERACTION_FIXTURE_EXERCISES);
      await history?.();
    }, expandFamilies);

  it('opens preselection for add-row picks, keeps Append plan disabled without valid history, and clears on search', async () => {
    const { onSelectExercise, onAppendPlan } = await openInteractions();
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));

    expect(await screen.findByTestId('exercise-picker-preselection-panel')).toBeTruthy();
    expect(screen.getByText('Add empty set')).toBeTruthy();
    const appendButton = screen.getByTestId('exercise-picker-append-plan-button');
    await waitFor(() => expect(screen.queryByTestId('exercise-picker-plan-source')).toBeNull());
    expect(appendButton.props.accessibilityState?.disabled).toBe(true);
    expect(screen.queryByText(/Unable/i)).toBeNull();
    // Choosing a row only preselects; nothing reaches the host yet.
    expect(onSelectExercise).not.toHaveBeenCalled();

    fireEvent.press(appendButton);
    expect(onAppendPlan).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByLabelText('Exercise filter input'), 'bench');
    await waitFor(() => {
      expect(screen.queryByTestId('exercise-picker-preselection-panel')).toBeNull();
      expect(screen.getByLabelText('Select exercise Bench Press')).toBeTruthy();
    });
    expect(onSelectExercise).not.toHaveBeenCalled();
  });

  it('shows Append plan disabled while the historical suggestion is loading (a pending read)', async () => {
    jest.spyOn(blockHistory, 'loadSuggestedExercisePlan').mockImplementationOnce(() => new Promise(() => undefined));

    await openInteractions(true, logSquatHistory);
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));

    const appendButton = await screen.findByTestId('exercise-picker-append-plan-button');
    expect(appendButton.props.accessibilityState?.disabled).toBe(true);
    expect(screen.queryByTestId('exercise-picker-plan-source')).toBeNull();
  });

  it('previews the last session as a plan and hands it to the host to append', async () => {
    const { onSelectExercise, onAppendPlan } = await openInteractions(true, logSquatHistory);
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));

    expect(await screen.findByTestId('exercise-picker-plan-source')).toHaveTextContent('From 2026-06-10 18:42');
    // The set row (T06-D2): type · weight × reps · 1RM · VOL, faded as planned.
    expect(screen.getByTestId('exercise-picker-plan-set-row-1')).toHaveTextContent(/W-Up/);
    expect(screen.getByTestId('exercise-picker-plan-set-row-1-values')).toHaveTextContent('0.0 × 10');
    expect(screen.getByTestId('exercise-picker-plan-set-row-2')).toHaveTextContent(/RIR 1/);
    expect(screen.getByTestId('exercise-picker-plan-set-row-2-values')).toHaveTextContent('120.0 × 5');
    expect(screen.getByTestId('exercise-picker-plan-set-row-2-vol')).toHaveTextContent(/600/);
    expect(StyleSheet.flatten(screen.getByTestId('exercise-picker-plan-set-row-2-values').props.style).color).toBe(
      uiRoles.inkFaint,
    );

    const appendButton = screen.getByTestId('exercise-picker-append-plan-button');
    expect(appendButton.props.accessibilityState?.disabled).toBe(false);
    // Append plan is the sheet's one accent (G6); Add empty set is an outline.
    type Node = typeof screen.UNSAFE_root;
    const accentNodes = screen.UNSAFE_root.findAll(
      (node: Node) =>
        typeof node.type === 'string' &&
        (StyleSheet.flatten(node.props.style as ViewStyle) ?? {}).backgroundColor === uiRoles.accent,
    );
    expect(accentNodes.map((node: Node) => node.props.testID)).toEqual(['exercise-picker-append-plan-button']);
    fireEvent.press(appendButton);

    expect(onAppendPlan).toHaveBeenCalledTimes(1);
    expect(onAppendPlan).toHaveBeenCalledWith(
      { id: 'seed_barbell_back_squat', name: 'Barbell Squat' },
      expect.objectContaining({
        sessionId: 'history-session-1',
        sessionExerciseIds: ['history-exercise-1', 'history-exercise-2'],
        sets: [
          expect.objectContaining({ setId: 'history-set-1', weightValue: '0', repsValue: '10', setType: 'warm_up' }),
          expect.objectContaining({ setId: 'history-set-2', weightValue: '120', repsValue: '5', setType: 'rir_1' }),
        ],
      })
    );
    expect(onSelectExercise).not.toHaveBeenCalled();
    // The preselection and search reset once the plan is handed off.
    expect(screen.queryByTestId('exercise-picker-preselection-panel')).toBeNull();
    expect(screen.getByLabelText('Exercise filter input')).toHaveProp('value', '');
  });

  // The filter input keeps focus while a result is tapped: with the default
  // `never`, iOS spends that first tap dismissing the keyboard and the row never
  // fires (fireEvent cannot see the keyboard, so pin the prop).
  it('lets a result tap through while the search keyboard is up', async () => {
    await openInteractions();

    expect(await screen.findByTestId('exercise-picker-list')).toHaveProp('keyboardShouldPersistTaps', 'handled');
  });

  it('filters exercise picker by all query words across names and primary muscles only', async () => {
    await openInteractions();

    expect(await screen.findByLabelText('Select exercise Barbell Squat')).toBeTruthy();
    expect(screen.getByLabelText('Select exercise Bench Press')).toBeTruthy();
    expect(screen.getByLabelText('Select exercise Deadlift')).toBeTruthy();
    expect(screen.getByLabelText('Select exercise Overhead Press')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Exercise filter input'), '   squAT   press  ');
    await waitFor(() => {
      expect(screen.queryByLabelText('Select exercise Barbell Squat')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Bench Press')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Deadlift')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Overhead Press')).toBeNull();
    });

    fireEvent.changeText(screen.getByLabelText('Exercise filter input'), '  CHEST bench ');
    await waitFor(() => {
      expect(screen.getByLabelText('Select exercise Bench Press')).toBeTruthy();
      expect(screen.queryByLabelText('Select exercise Barbell Squat')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Deadlift')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Overhead Press')).toBeNull();
    });

    fireEvent.changeText(screen.getByLabelText('Exercise filter input'), '  front press ');
    await waitFor(() => {
      expect(screen.queryByLabelText('Select exercise Bench Press')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Barbell Squat')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Deadlift')).toBeNull();
      expect(screen.getByLabelText('Select exercise Overhead Press')).toBeTruthy();
    });

    fireEvent.changeText(screen.getByLabelText('Exercise filter input'), '  triceps ');
    await waitFor(() => {
      expect(screen.queryByLabelText('Select exercise Bench Press')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Barbell Squat')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Deadlift')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Overhead Press')).toBeNull();
      expect(screen.getByText('No exercises match that filter.')).toBeTruthy();
    });

    fireEvent.changeText(screen.getByLabelText('Exercise filter input'), '  delts_front ');
    await waitFor(() => {
      expect(screen.queryByLabelText('Select exercise Bench Press')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Barbell Squat')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Deadlift')).toBeNull();
      expect(screen.queryByLabelText('Select exercise Overhead Press')).toBeNull();
    });
  }, 30000);

  it('starts with family rows collapsed and shared history', async () => {
    await openInteractions(false);
    expect(await screen.findByLabelText('Chest exercises 2')).toBeTruthy();
    expect(screen.getByLabelText('Core exercises 0')).toBeTruthy();
    expect(screen.queryByLabelText('Select exercise Bench Press')).toBeNull();

    fireEvent.press(screen.getByLabelText('Chest exercises 2'));

    expect(await screen.findByLabelText('Select exercise Bench Press')).toBeTruthy();
    expect(screen.getAllByText('Never done')).toHaveLength(2);
  });

  it('creates a new exercise inline from the picker and hands it to the host', async () => {
    const { onSelectExercise } = await openInteractions();
    await screen.findByLabelText('Select exercise Barbell Squat');

    fireEvent.press(screen.getByLabelText('Open inline exercise create'));
    expect(mockPush).not.toHaveBeenCalled();
    expect(await screen.findByText('Create Exercise')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Exercise definition name'), 'Custom Press');
    fireEvent.press(screen.getByLabelText('Open primary muscle selector'));
    fireEvent.press(await screen.findByLabelText('Select primary muscle Chest'));
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Save exercise definition'));
    });

    const [created] = liveExercisesNamed('Custom Press');
    expect(created).toMatchObject({ loadInputMode: 'total_load' });
    expect(
      localDatabase()
        .select({ muscleGroupId: exerciseMuscleMappings.muscleGroupId, role: exerciseMuscleMappings.role })
        .from(exerciseMuscleMappings)
        .where(eq(exerciseMuscleMappings.exerciseDefinitionId, created.id))
        .all()
    ).toEqual([{ muscleGroupId: 'chest', role: 'primary' }]);
    await waitFor(() => {
      expect(onSelectExercise).toHaveBeenCalledWith(created.id, 'Custom Press');
    });
    expect(onSelectExercise).toHaveBeenCalledTimes(1);
  });

  it('keeps shared sort and visibility controls visible below search', async () => {
    await openInteractions();
    const header = within(screen.getByTestId('exercise-picker-header'));
    expect(header.getByRole('header', { name: 'Select Exercise' })).toBeTruthy();
    for (const label of ['Open exercise catalog manage flow', 'Open inline exercise create']) {
      expect(header.getByRole('button', { name: label })).toBeTruthy();
    }
    expect(screen.getByLabelText('Favourite')).toHaveProp('accessibilityState', { selected: true });
    fireEvent.press(screen.getByLabelText('Name A–Z'));
    expect(screen.getByLabelText('Name A–Z')).toHaveProp('accessibilityState', { selected: true });
    fireEvent.press(screen.getByLabelText('Show never-done'));
    expect(screen.getByText('No exercises match that filter.')).toBeTruthy();
  });

  it('routes Manage to exercise catalog', async () => {
    const { onOpenManage, onSelectExercise, onDismiss } = await openInteractions();
    expect(await screen.findByLabelText('Select exercise Barbell Squat')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Open exercise catalog manage flow'));

    // The host hides the picker and navigates; the picker itself never routes.
    expect(onOpenManage).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
    expect(onSelectExercise).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses from the overlay without picking anything', async () => {
    const { onDismiss, onSelectExercise } = await openInteractions();
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));
    expect(await screen.findByTestId('exercise-picker-preselection-panel')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Dismiss exercise modal overlay', { includeHiddenElements: true }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSelectExercise).not.toHaveBeenCalled();
    // Dismiss clears the preselection, so a re-show starts on the list.
    expect(screen.queryByTestId('exercise-picker-preselection-panel')).toBeNull();
  });
});

it('shares sort/never-done edits across Add and Swap while retaining independent search', async () => {
  mockUserId = null;
  await renderPicker(() => seedCatalog(GROUP_FIXTURE_EXERCISES));
  const picker = within(screen.getByTestId('exercise-picker'));
  fireEvent.changeText(picker.getByLabelText('Exercise filter input'), 'bench');
  fireEvent.press(picker.getByLabelText('Name A–Z'));
  fireEvent.press(picker.getByLabelText('Show never-done'));
  const swap = render(<ExerciseSwapSheet visible currentExerciseDefinitionId="seed_barbell_bench_press" onSelect={jest.fn()} onDismiss={jest.fn()} />);
  const swapUI = within(swap.getByTestId('exercise-swap-sheet'));
  await waitFor(() => expect(swapUI.getByText('No exercises match the current filters.')).toBeTruthy());
  expect(swapUI.getByLabelText('Name A–Z')).toHaveProp('accessibilityState', { selected: true });
  expect(swapUI.getByLabelText('Show never-done')).toHaveProp('accessibilityState', { checked: false });
  expect(swapUI.getByLabelText('Search exercises')).toHaveProp('value', '');
  fireEvent.press(swapUI.getByLabelText('Show never-done'));
  expect(picker.getByLabelText('Show never-done')).toHaveProp('accessibilityState', { checked: true });
  expect(picker.getByLabelText('Exercise filter input')).toHaveProp('value', 'bench');
  fireEvent.changeText(swapUI.getByLabelText('Search exercises'), 'bench');
  expect(swapUI.queryByLabelText('Select exercise Bench Press')).toBeNull();
  swap.unmount();
});
