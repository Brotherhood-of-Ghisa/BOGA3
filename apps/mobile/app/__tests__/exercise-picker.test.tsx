/* eslint-disable import/first */

/**
 * The shared exercise picker (`components/session-recorder/exercise-picker.tsx`)
 * rendered on its own. The session view's tests mock the picker, so this file
 * owns its behaviour: the catalogue list and filter, the add preselection (Add
 * empty set / Append plan), inline create, Manage and dismiss, and the M25-T07
 * group exercises (E0.1) with their pick sheet (E0.2). Everything the host does
 * with a pick is asserted on the callback props.
 *
 * Ported from the retired recorder route's tests
 * (session-recorder-group-picker / session-recorder-interactions). The linking
 * hook and the link writes are mocked; their real behaviour is covered by
 * groups-exercise-link-screen.test.tsx and exercise-group-links-add-as-new.test.ts.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

jest.mock('@/src/data', () => ({
  loadSuggestedExercisePlan: jest.fn().mockResolvedValue(null),
}));

type MockCatalogExercise = {
  id: string;
  name: string;
  loadInputMode?: string;
  deletedAt: null;
  mappings: { id: string; muscleGroupId: string; weight: number; role: string }[];
};
type MockMuscleGroup = { id: string; displayName: string; familyName: string; sortOrder: number };

// Each describe seeds the catalogue its source file used.
let mockCatalogExercises: MockCatalogExercise[] = [];
let mockMuscleGroups: MockMuscleGroup[] = [];
jest.mock('@/src/data/exercise-catalog', () => ({
  listExerciseCatalogExercises: jest.fn().mockImplementation(async () => mockCatalogExercises),
  listExerciseCatalogMuscleGroups: jest.fn().mockImplementation(async () => mockMuscleGroups),
  saveExerciseCatalogExercise: jest.fn().mockImplementation(async (input: any) => ({
    id: input.id ?? 'custom-exercise-1',
    name: input.name.trim(),
    loadInputMode: input.loadInputMode,
    deletedAt: null,
    mappings: input.mappings.map((mapping: any, index: number) => ({
      id: `map-${index + 1}`,
      muscleGroupId: mapping.muscleGroupId,
      weight: mapping.weight,
      role: mapping.role,
    })),
  })),
}));

jest.mock('@/src/data/exercise-catalog-stats', () => ({
  loadExerciseCatalogStatsRawHistory: jest.fn().mockResolvedValue({ sessions: [], sessionExercises: [], exerciseSets: [] }),
  aggregateExerciseCatalogStats: jest.requireActual('@/src/data/exercise-catalog-stats').aggregateExerciseCatalogStats,
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = jest.requireActual('react');
    React.useEffect(() => callback(), [callback]);
  },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ addListener: jest.fn(() => () => undefined), dispatch: jest.fn() }),
  useRouter: () => ({ replace: jest.fn(), push: mockPush }),
}));

jest.mock('@/src/auth', () => ({
  getAuthSnapshot: () => ({ user: { id: 'user-1' } }),
  subscribeToAuthState: () => () => undefined,
}));

let mockLinkingUserId: string | null = 'user-1';
let mockLinkingState: Record<string, unknown> = {};
jest.mock('@/src/groups/use-group-exercise-linking', () => ({
  useGroupLinkingUserId: () => mockLinkingUserId,
  useGroupExerciseLinking: () => mockLinkingState,
  readCachedGroupExerciseCatalogs: jest.fn(),
}));

jest.mock('@/src/data/exercise-group-links', () => ({
  linkExercise: jest.fn(),
  unlinkExercise: jest.fn(),
  listLinks: jest.fn().mockResolvedValue([]),
  createExerciseWithGroupLink: jest.fn(),
}));

import { ExercisePicker } from '@/components/session-recorder/exercise-picker';
import { loadSuggestedExercisePlan } from '@/src/data';
import { saveExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { createExerciseWithGroupLink, linkExercise } from '@/src/data/exercise-group-links';
import { __resetExerciseCatalogCacheForTests } from '@/src/exercise-catalog/cache';
import {
  __resetExerciseListPreferencesForTests,
  setExerciseListPreferences,
} from '@/src/exercise-catalog/list-preferences';
import type { GroupExercise, GroupExerciseCatalog, LinkRef } from '@/src/groups';

const mockLoadSuggestedExercisePlan = jest.mocked(loadSuggestedExercisePlan);
const mockSaveExerciseCatalogExercise = jest.mocked(saveExerciseCatalogExercise);
const mockLinkExercise = jest.mocked(linkExercise);
const mockCreateExerciseWithGroupLink = jest.mocked(createExerciseWithGroupLink);

// ---- Fixtures: the group picker's catalogue (session-recorder-group-picker).

const GROUP_FIXTURE_EXERCISES: MockCatalogExercise[] = [
  { id: 'seed_barbell_back_squat', name: 'Barbell Squat', loadInputMode: 'total_load', deletedAt: null, mappings: [] },
  { id: 'seed_barbell_bench_press', name: 'Bench Press', loadInputMode: 'total_load', deletedAt: null, mappings: [] },
  { id: 'ex-hotel', name: 'Hotel Bench', loadInputMode: 'per_side_load', deletedAt: null, mappings: [] },
];
const GROUP_FIXTURE_MUSCLE_GROUPS: MockMuscleGroup[] = [
  { id: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 0 },
];

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

const CATALOGS: GroupExerciseCatalog[] = [
  { groupId: 'g-iron', groupName: 'Iron Brotherhood', exercises: [GX_BENCH, GX_ROW] },
  { groupId: 'g-tue', groupName: 'Tuesday Crew', exercises: [GX_TUE_SQUAT, GX_TUE_BENCH] },
];

const SQUAT_LINK: LinkRef = { exerciseDefinitionId: 'seed_barbell_back_squat', groupId: 'g-tue', groupExerciseId: 'gx-tue-squat' };

const linkingState = (links: LinkRef[] = [SQUAT_LINK]) => ({
  catalogs: CATALOGS,
  links,
  hydrated: true,
  refreshing: false,
  offline: false,
  lastUpdatedAtMs: 1,
  error: null,
  refresh: jest.fn().mockResolvedValue(undefined),
  reloadLinks: jest.fn().mockResolvedValue(undefined),
});

// ---- Fixtures: the recorder interactions' catalogue (session-recorder-interactions).

const INTERACTION_FIXTURE_EXERCISES: MockCatalogExercise[] = [
  {
    id: 'seed_barbell_back_squat',
    name: 'Barbell Squat',
    loadInputMode: 'total_load',
    deletedAt: null,
    mappings: [{ id: 'map-squat-quads', muscleGroupId: 'quads', weight: 1, role: 'primary' }],
  },
  {
    id: 'seed_barbell_bench_press',
    name: 'Bench Press',
    loadInputMode: 'total_load',
    deletedAt: null,
    mappings: [
      { id: 'map-bench-chest', muscleGroupId: 'chest', weight: 1, role: 'primary' },
      { id: 'map-bench-triceps', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
    ],
  },
  {
    id: 'seed_dumbbell_bench_press',
    name: 'Dumbbell Bench Press',
    loadInputMode: 'per_side_load',
    deletedAt: null,
    mappings: [{ id: 'map-db-bench-chest', muscleGroupId: 'chest', weight: 1, role: 'primary' }],
  },
  {
    id: 'seed_romanian_deadlift',
    name: 'Deadlift',
    deletedAt: null,
    mappings: [{ id: 'map-deadlift-hamstrings', muscleGroupId: 'hamstrings', weight: 1, role: 'primary' }],
  },
  {
    id: 'seed_overhead_press',
    name: 'Overhead Press',
    deletedAt: null,
    mappings: [{ id: 'map-overhead-press-delts', muscleGroupId: 'delts_front', weight: 1, role: 'primary' }],
  },
];
const INTERACTION_FIXTURE_MUSCLE_GROUPS: MockMuscleGroup[] = [
  { id: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 0 },
  { id: 'triceps', displayName: 'Triceps', familyName: 'Arms', sortOrder: 1 },
  { id: 'delts_front', displayName: 'Front Delts', familyName: 'Shoulders', sortOrder: 2 },
  { id: 'quads', displayName: 'Quads', familyName: 'Legs', sortOrder: 3 },
  { id: 'hamstrings', displayName: 'Hamstrings', familyName: 'Legs', sortOrder: 4 },
];

// ---- Harness

type PickerCallbacks = {
  onDismiss: jest.Mock;
  onSelectExercise: jest.Mock;
  onAppendPlan: jest.Mock;
  onOpenManage: jest.Mock;
};

let callbacks: PickerCallbacks;
let unmountPicker: (() => void) | null = null;

const renderPicker = async () => {
  callbacks = {
    onDismiss: jest.fn(),
    onSelectExercise: jest.fn(),
    onAppendPlan: jest.fn(),
    onOpenManage: jest.fn(),
  };
  const result = render(<ExercisePicker visible openRequestId={1} {...callbacks} />);
  unmountPicker = result.unmount;
  await act(async () => {});
  return callbacks;
};

const openPicker = async () => {
  await renderPicker();
  await screen.findByLabelText('Select exercise Bench Press');
};

const toggleGroups = () => fireEvent.press(screen.getByTestId('exercise-picker-groups-toggle'));

beforeEach(() => {
  __resetExerciseCatalogCacheForTests();
  __resetExerciseListPreferencesForTests();
  setExerciseListPreferences({ groupByMuscleFamily: false });
  mockPush.mockReset();
  mockLoadSuggestedExercisePlan.mockReset();
  mockLoadSuggestedExercisePlan.mockResolvedValue(null);
  mockSaveExerciseCatalogExercise.mockClear();
  mockLinkExercise.mockReset();
  mockCreateExerciseWithGroupLink.mockReset();
  mockCatalogExercises = GROUP_FIXTURE_EXERCISES;
  mockMuscleGroups = GROUP_FIXTURE_MUSCLE_GROUPS;
  mockLinkingUserId = 'user-1';
  mockLinkingState = linkingState();
});

afterEach(() => {
  unmountPicker?.();
  unmountPicker = null;
  jest.useRealTimers();
});

describe('picker: group exercises (E0.1)', () => {
  it('the default list has no group rows; a search lists them after my own matches', async () => {
    await openPicker();

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
    await openPicker();
    toggleGroups();

    expect(screen.getByTestId('exercise-picker-groups-toggle')).toHaveProp('accessibilityState', { checked: true });
    expect(screen.queryByLabelText('Select exercise Barbell Squat')).toBeNull();
    expect(screen.getByLabelText('Group exercise Back Squat in Tuesday Crew, linked: Barbell Squat')).toBeTruthy();
    expect(screen.getByTestId('exercise-picker-group-row-gx-row')).toBeTruthy();
  });

  it('picking a linked group exercise adds my exercise and writes nothing', async () => {
    const { onSelectExercise } = await renderPicker();
    await screen.findByLabelText('Select exercise Bench Press');
    toggleGroups();

    fireEvent.press(screen.getByTestId('exercise-picker-group-row-gx-tue-squat'));

    expect(onSelectExercise).toHaveBeenCalledTimes(1);
    expect(onSelectExercise).toHaveBeenCalledWith('seed_barbell_back_squat', 'Barbell Squat');
    expect(screen.queryByTestId('group-pick-sheet')).toBeNull();
    expect(mockLinkExercise).not.toHaveBeenCalled();
  });

  it('with several linked exercises, the sheet asks which to add', async () => {
    mockLinkingState = linkingState([
      { exerciseDefinitionId: 'seed_barbell_bench_press', groupId: 'g-iron', groupExerciseId: 'gx-bench' },
      { exerciseDefinitionId: 'ex-hotel', groupId: 'g-iron', groupExerciseId: 'gx-bench' },
    ]);
    const { onSelectExercise } = await renderPicker();
    await screen.findByLabelText('Select exercise Bench Press');
    toggleGroups();

    fireEvent.press(screen.getByTestId('exercise-picker-group-row-gx-bench'));
    fireEvent.press(await screen.findByTestId('group-pick-sheet-linked-ex-hotel'));

    expect(onSelectExercise).toHaveBeenCalledTimes(1);
    expect(onSelectExercise).toHaveBeenCalledWith('ex-hotel', 'Hotel Bench');
    expect(screen.queryByTestId('group-pick-sheet')).toBeNull();
    expect(mockLinkExercise).not.toHaveBeenCalled();
  });
});

describe('pick sheet (E0.2)', () => {
  it('preselects my copy of the standard exercise; Link and add links, then adds it', async () => {
    mockLinkExercise.mockResolvedValue({} as never);
    const { onSelectExercise } = await renderPicker();
    await screen.findByLabelText('Select exercise Bench Press');
    toggleGroups();
    fireEvent.press(screen.getByTestId('exercise-picker-group-row-gx-bench'));

    const sheet = await screen.findByTestId('group-pick-sheet');
    expect(within(sheet).getByText('Bench Press · Iron Brotherhood')).toBeTruthy();
    expect(screen.getByTestId('group-pick-sheet-option-suggested')).toHaveProp('accessibilityState', { checked: true });
    expect(screen.getByTestId('group-pick-sheet-retroactivity')).toHaveTextContent(
      'Your past Bench Press sets shared with Iron Brotherhood will count.',
    );
    const reloadCallsBefore = (mockLinkingState.reloadLinks as jest.Mock).mock.calls.length;

    await act(async () => {
      fireEvent.press(screen.getByTestId('group-pick-sheet-confirm'));
    });

    expect(mockLinkExercise).toHaveBeenCalledWith('seed_barbell_bench_press', 'g-iron', 'gx-bench');
    expect((mockLinkingState.reloadLinks as jest.Mock).mock.calls.length).toBeGreaterThan(reloadCallsBefore);
    expect(screen.queryByTestId('group-pick-sheet')).toBeNull();
    expect(onSelectExercise).toHaveBeenCalledWith('seed_barbell_bench_press', 'Bench Press');
  });

  it('offline: Link and add writes the link locally and adds the exercise', async () => {
    mockLinkExercise.mockResolvedValue({} as never);
    mockLinkingState = { ...linkingState(), offline: true };
    const { onSelectExercise } = await renderPicker();
    await screen.findByLabelText('Select exercise Bench Press');
    toggleGroups();
    fireEvent.press(screen.getByTestId('exercise-picker-group-row-gx-bench'));
    await screen.findByTestId('group-pick-sheet');
    const refreshCallsBefore = (mockLinkingState.refresh as jest.Mock).mock.calls.length;

    await act(async () => {
      fireEvent.press(screen.getByTestId('group-pick-sheet-confirm'));
    });

    expect(mockLinkExercise).toHaveBeenCalledWith('seed_barbell_bench_press', 'g-iron', 'gx-bench');
    expect(onSelectExercise).toHaveBeenCalledWith('seed_barbell_bench_press', 'Bench Press');
    // The link is a local write: nothing asks the server.
    expect((mockLinkingState.refresh as jest.Mock).mock.calls.length).toBe(refreshCallsBefore);
  });

  it('a failed link shows inline and adds nothing', async () => {
    mockLinkExercise.mockRejectedValue(new Error('disk full'));
    const { onSelectExercise } = await renderPicker();
    await screen.findByLabelText('Select exercise Bench Press');
    toggleGroups();
    fireEvent.press(screen.getByTestId('exercise-picker-group-row-gx-bench'));

    await act(async () => {
      fireEvent.press(await screen.findByTestId('group-pick-sheet-confirm'));
    });

    expect(screen.getByTestId('group-pick-sheet-error')).toHaveTextContent('disk full');
    expect(onSelectExercise).not.toHaveBeenCalled();
  });

  it('Choose another: exercises linked in the group are unavailable, and a mode mismatch is noted', async () => {
    await openPicker();
    toggleGroups();
    fireEvent.press(screen.getByTestId('exercise-picker-group-row-gx-tue-bench'));
    fireEvent.press(await screen.findByTestId('group-pick-sheet-option-other'));

    const squat = screen.getByTestId('group-pick-sheet-choice-seed_barbell_back_squat');
    expect(squat).toBeDisabled();
    expect(within(squat).getByText('already linked in Tuesday Crew')).toBeTruthy();

    fireEvent.press(screen.getByTestId('group-pick-sheet-choice-seed_barbell_bench_press'));
    expect(screen.getByTestId('group-pick-sheet-load-mode-note')).toHaveTextContent(
      "Your total-load weights will show halved on this group's boards.",
    );
    fireEvent.press(screen.getByTestId('group-pick-sheet-choice-ex-hotel'));
    expect(screen.queryByTestId('group-pick-sheet-load-mode-note')).toBeNull();
  });

  it('with no suggestion, Add as new is preselected; cancel returns to the picker', async () => {
    const { onSelectExercise, onDismiss } = await renderPicker();
    await screen.findByLabelText('Select exercise Bench Press');
    toggleGroups();
    fireEvent.press(screen.getByTestId('exercise-picker-group-row-gx-row'));

    expect(await screen.findByTestId('group-pick-sheet-option-add-new')).toHaveProp('accessibilityState', { checked: true });
    expect(screen.queryByTestId('group-pick-sheet-option-suggested')).toBeNull();
    // The picker hides while its sheet is open.
    expect(screen.queryByTestId('exercise-picker-groups-toggle')).toBeNull();

    fireEvent.press(screen.getByTestId('group-pick-sheet-cancel'));
    expect(screen.queryByTestId('group-pick-sheet')).toBeNull();
    expect(screen.getByTestId('exercise-picker-groups-toggle')).toBeTruthy();
    expect(onSelectExercise).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('Add as new opens the prefilled editor and creates the exercise and its link together', async () => {
    mockCreateExerciseWithGroupLink.mockResolvedValue({
      exercise: { id: 'ex-new', name: 'Bench Press', loadInputMode: 'total_load', deletedAt: null, mappings: [] },
      link: {} as never,
    });
    const { onSelectExercise } = await renderPicker();
    await screen.findByLabelText('Select exercise Bench Press');
    toggleGroups();
    fireEvent.press(screen.getByTestId('exercise-picker-group-row-gx-bench'));
    fireEvent.press(await screen.findByTestId('group-pick-sheet-option-add-new'));
    fireEvent.press(screen.getByTestId('group-pick-sheet-confirm'));

    expect(await screen.findByTestId('exercise-editor-name-input')).toHaveProp('value', 'Bench Press');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Save exercise definition'));
    });

    expect(mockCreateExerciseWithGroupLink).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Bench Press',
        loadInputMode: 'total_load',
        mappings: expect.arrayContaining([expect.objectContaining({ role: 'primary' })]),
      }),
      { groupId: 'g-iron', groupExerciseId: 'gx-bench' },
    );
    expect(mockLinkExercise).not.toHaveBeenCalled();
    expect(mockSaveExerciseCatalogExercise).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(onSelectExercise).toHaveBeenCalledWith('ex-new', 'Bench Press');
    });
  });
});

describe('signed out', () => {
  it('no Groups toggle, no group section', async () => {
    mockLinkingUserId = null;
    mockLinkingState = { ...linkingState([]), catalogs: null };
    const { onSelectExercise } = await renderPicker();
    await screen.findByLabelText('Select exercise Bench Press');

    expect(screen.queryByTestId('exercise-picker-groups-toggle')).toBeNull();
    fireEvent.changeText(screen.getByLabelText('Exercise filter input'), 'bench');
    expect(screen.queryByTestId('exercise-picker-group-section')).toBeNull();

    fireEvent.press(screen.getByLabelText('Select exercise Bench Press'));
    fireEvent.press(await screen.findByTestId('exercise-picker-add-empty-set-button'));
    expect(onSelectExercise).toHaveBeenCalledWith('seed_barbell_bench_press', 'Bench Press');
  });
});

describe('picker: list, preselection, create, Manage and dismiss', () => {
  beforeEach(() => {
    mockCatalogExercises = INTERACTION_FIXTURE_EXERCISES;
    mockMuscleGroups = INTERACTION_FIXTURE_MUSCLE_GROUPS;
    // As in the recorder's interaction tests: group linking is off.
    mockLinkingUserId = null;
    mockLinkingState = { ...linkingState([]), catalogs: null };
  });

  it('opens preselection for add-row picks, keeps Append plan disabled without valid history, and clears on search', async () => {
    const { onSelectExercise, onAppendPlan } = await renderPicker();
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));

    expect(await screen.findByTestId('exercise-picker-preselection-panel')).toBeTruthy();
    expect(mockLoadSuggestedExercisePlan).toHaveBeenLastCalledWith({ exerciseDefinitionId: 'seed_barbell_back_squat' });
    expect(screen.getByText('Add empty set')).toBeTruthy();
    const appendButton = screen.getByTestId('exercise-picker-append-plan-button');
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

  it('shows Append plan disabled while the historical suggestion is loading', async () => {
    mockLoadSuggestedExercisePlan.mockImplementationOnce(() => new Promise(() => undefined));

    await renderPicker();
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));

    const appendButton = await screen.findByTestId('exercise-picker-append-plan-button');
    expect(appendButton.props.accessibilityState?.disabled).toBe(true);
    expect(screen.queryByTestId('exercise-picker-plan-source')).toBeNull();
  });

  it('previews a valid historical plan and hands it to the host to append', async () => {
    const suggestion = {
      sessionId: 'history-session-1',
      completedAt: new Date(2026, 5, 10, 18, 42),
      sessionExerciseIds: ['history-exercise-1', 'history-exercise-2'],
      sets: [
        {
          setId: 'history-set-1',
          sessionExerciseId: 'history-exercise-1',
          weightValue: '0',
          repsValue: '10',
          setType: 'warm_up',
        },
        {
          setId: 'history-set-2',
          sessionExerciseId: 'history-exercise-2',
          weightValue: '120',
          repsValue: '5',
          setType: 'rir_1',
        },
      ],
    };
    mockLoadSuggestedExercisePlan.mockResolvedValueOnce(suggestion as never);

    const { onSelectExercise, onAppendPlan } = await renderPicker();
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));

    expect(mockLoadSuggestedExercisePlan).toHaveBeenLastCalledWith({
      exerciseDefinitionId: 'seed_barbell_back_squat',
    });
    expect(await screen.findByTestId('exercise-picker-plan-source')).toHaveTextContent('From 2026-06-10 18:42');
    expect(screen.getByTestId('exercise-picker-plan-set-row-1')).toHaveTextContent(/0kg/);
    expect(screen.getByTestId('exercise-picker-plan-set-row-1')).toHaveTextContent(/10 reps/);
    expect(screen.getByTestId('exercise-picker-plan-set-row-1')).toHaveTextContent(/W-Up/);
    expect(screen.getByTestId('exercise-picker-plan-set-row-2')).toHaveTextContent(/120kg/);
    expect(screen.getByTestId('exercise-picker-plan-set-row-2')).toHaveTextContent(/5 reps/);
    expect(screen.getByTestId('exercise-picker-plan-set-row-2')).toHaveTextContent(/RIR 1/);

    const appendButton = screen.getByTestId('exercise-picker-append-plan-button');
    expect(appendButton.props.accessibilityState?.disabled).toBe(false);
    fireEvent.press(appendButton);

    expect(onAppendPlan).toHaveBeenCalledTimes(1);
    expect(onAppendPlan).toHaveBeenCalledWith({ id: 'seed_barbell_back_squat', name: 'Barbell Squat' }, suggestion);
    expect(onSelectExercise).not.toHaveBeenCalled();
    // The preselection and search reset once the plan is handed off.
    expect(screen.queryByTestId('exercise-picker-preselection-panel')).toBeNull();
    expect(screen.getByLabelText('Exercise filter input')).toHaveProp('value', '');
  });

  it('filters exercise picker by all query words across names and primary muscles only', async () => {
    await renderPicker();

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

  it('uses grouped picker rows with shared stats when grouping is enabled', async () => {
    __resetExerciseListPreferencesForTests();

    await renderPicker();
    expect(await screen.findByLabelText('Chest exercises 2')).toBeTruthy();
    expect(screen.getByLabelText('Core exercises 0')).toBeTruthy();
    expect(screen.queryByLabelText('Select exercise Bench Press')).toBeNull();

    fireEvent.press(screen.getByLabelText('Chest exercises 2'));

    expect(await screen.findByLabelText('Select exercise Bench Press')).toBeTruthy();
    expect(screen.getAllByText('Never done')).toHaveLength(2);
  });

  it('creates a new exercise inline from the picker and hands it to the host', async () => {
    const { onSelectExercise } = await renderPicker();
    await screen.findByLabelText('Select exercise Barbell Squat');

    fireEvent.press(screen.getByLabelText('Open inline exercise create'));
    expect(mockPush).not.toHaveBeenCalled();
    expect(await screen.findByText('Create Exercise')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Exercise definition name'), 'Custom Press');
    fireEvent.press(screen.getByLabelText('Open primary muscle selector'));
    fireEvent.press(await screen.findByLabelText('Select primary muscle Chest'));
    fireEvent.press(screen.getByLabelText('Save exercise definition'));

    await waitFor(() => {
      expect(mockSaveExerciseCatalogExercise).toHaveBeenCalledWith({
        id: undefined,
        name: 'Custom Press',
        loadInputMode: 'total_load',
        mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }],
      });
    });
    await waitFor(() => {
      expect(onSelectExercise).toHaveBeenCalledWith('custom-exercise-1', 'Custom Press');
    });
    expect(onSelectExercise).toHaveBeenCalledTimes(1);
  });

  it('routes Manage to exercise catalog', async () => {
    const { onOpenManage, onSelectExercise, onDismiss } = await renderPicker();
    expect(await screen.findByLabelText('Select exercise Barbell Squat')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Open exercise catalog manage flow'));

    // The host hides the picker and navigates; the picker itself never routes.
    expect(onOpenManage).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
    expect(onSelectExercise).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses from the overlay without picking anything', async () => {
    const { onDismiss, onSelectExercise } = await renderPicker();
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));
    expect(await screen.findByTestId('exercise-picker-preselection-panel')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Dismiss exercise modal overlay'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSelectExercise).not.toHaveBeenCalled();
    // Dismiss clears the preselection, so a re-show starts on the list.
    expect(screen.queryByTestId('exercise-picker-preselection-panel')).toBeNull();
  });
});
