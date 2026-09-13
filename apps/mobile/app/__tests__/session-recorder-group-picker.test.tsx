/* eslint-disable import/first */

/**
 * M25-T07 recorder integration (card AC4, and the recorder half of AC5):
 * picker search "From your groups" (E0.1), the Groups toggle (D13), the pick
 * sheet (E0.2) with "Link and add" and "Add as new", and the ••• "Link to
 * group exercise…" item. The linking hook and the link writes are mocked here;
 * their real behaviour is covered by groups-exercise-link-screen.test.tsx and
 * exercise-group-links-add-as-new.test.ts. Data mocks follow
 * session-recorder-screen.test.tsx.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

jest.mock('@/src/data', () => ({
  attachExerciseTagToSessionExercise: jest.fn().mockResolvedValue(undefined),
  createExerciseTagDefinition: jest.fn(),
  deleteExerciseTagDefinition: jest.fn().mockResolvedValue(undefined),
  formatSessionListCompactDuration: () => '0m',
  listExerciseTagDefinitions: jest.fn().mockResolvedValue([]),
  listSessionExerciseAssignedTags: jest.fn().mockResolvedValue([]),
  listLocalGyms: jest.fn().mockResolvedValue([]),
  loadRecentExerciseBlocks: jest.fn().mockImplementation(async ({ exerciseDefinitionId }: { exerciseDefinitionId: string }) => ({
    exerciseDefinitionId,
    limit: null,
    blocks: [],
  })),
  loadSuggestedExercisePlan: jest.fn().mockResolvedValue(null),
  loadLocalGymById: jest.fn().mockResolvedValue(null),
  loadLatestSessionDraftSnapshot: jest.fn().mockResolvedValue(null),
  loadSessionSnapshotById: jest.fn().mockResolvedValue(null),
  persistCompletedSessionSnapshot: jest.fn(),
  persistSessionDraftSnapshot: jest.fn().mockResolvedValue({ sessionId: 'test-session' }),
  removeExerciseTagFromSessionExercise: jest.fn().mockResolvedValue(undefined),
  renameExerciseTagDefinition: jest.fn().mockResolvedValue(undefined),
  setSessionDeletedState: jest.fn().mockResolvedValue(undefined),
  undeleteExerciseTagDefinition: jest.fn().mockResolvedValue(undefined),
  upsertLocalGym: jest.fn().mockResolvedValue(undefined),
  completeSessionDraft: jest.fn(),
}));

jest.mock('@/src/data/exercise-catalog', () => ({
  listExerciseCatalogExercises: jest.fn().mockResolvedValue([
    { id: 'seed_barbell_back_squat', name: 'Barbell Squat', loadInputMode: 'total_load', deletedAt: null, mappings: [] },
    { id: 'seed_barbell_bench_press', name: 'Bench Press', loadInputMode: 'total_load', deletedAt: null, mappings: [] },
    { id: 'ex-hotel', name: 'Hotel Bench', loadInputMode: 'per_side_load', deletedAt: null, mappings: [] },
  ]),
  listExerciseCatalogMuscleGroups: jest.fn().mockResolvedValue([
    { id: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 0 },
  ]),
}));

jest.mock('@/src/data/exercise-catalog-stats', () => ({
  loadExerciseCatalogStatsRawHistory: jest.fn().mockResolvedValue({ sessions: [], sessionExercises: [], exerciseSets: [] }),
  aggregateExerciseCatalogStats: jest.requireActual('@/src/data/exercise-catalog-stats').aggregateExerciseCatalogStats,
}));

jest.mock('@/src/location/foreground-location-lazy', () => ({
  getCurrentForegroundPositionLazy: jest.fn().mockResolvedValue({ status: 'unavailable' }),
}));

jest.mock('@/src/location/gym-location-matcher', () => ({
  DEFAULT_MAX_POSITION_ACCURACY_M: 100,
  matchNearestGymForPosition: jest.fn().mockReturnValue({ status: 'no_match', radiusM: 150 }),
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

import { createExerciseWithGroupLink, linkExercise } from '@/src/data/exercise-group-links';
import {
  __resetExerciseListPreferencesForTests,
  setExerciseListPreferences,
} from '@/src/exercise-catalog/list-preferences';
import type { GroupExercise, GroupExerciseCatalog, LinkRef } from '@/src/groups';

import SessionRecorderScreen from '../(tabs)/session-recorder';

const mockLinkExercise = jest.mocked(linkExercise);
const mockCreateExerciseWithGroupLink = jest.mocked(createExerciseWithGroupLink);

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

const openPicker = async () => {
  render(<SessionRecorderScreen />);
  await act(async () => {});
  const startButton = screen.queryByTestId('start-session-button');
  if (startButton) {
    fireEvent.press(startButton);
    await act(async () => {});
  }
  fireEvent.press(screen.getByLabelText('Log new exercise'));
  await screen.findByLabelText('Select exercise Bench Press');
};

const toggleGroups = () => fireEvent.press(screen.getByTestId('exercise-picker-groups-toggle'));

beforeEach(() => {
  __resetExerciseListPreferencesForTests();
  setExerciseListPreferences({ groupByMuscleFamily: false });
  mockPush.mockReset();
  mockLinkExercise.mockReset();
  mockCreateExerciseWithGroupLink.mockReset();
  mockLinkingUserId = 'user-1';
  mockLinkingState = linkingState();
});

describe('recorder picker: group exercises (E0.1)', () => {
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
    await openPicker();
    toggleGroups();

    fireEvent.press(screen.getByTestId('exercise-picker-group-row-gx-tue-squat'));

    expect(await screen.findByLabelText('Exercise options 1')).toBeTruthy();
    expect(screen.getByText('Barbell Squat')).toBeTruthy();
    expect(screen.queryByTestId('group-pick-sheet')).toBeNull();
    expect(mockLinkExercise).not.toHaveBeenCalled();
  });

  it('with several linked exercises, the sheet asks which to add', async () => {
    mockLinkingState = linkingState([
      { exerciseDefinitionId: 'seed_barbell_bench_press', groupId: 'g-iron', groupExerciseId: 'gx-bench' },
      { exerciseDefinitionId: 'ex-hotel', groupId: 'g-iron', groupExerciseId: 'gx-bench' },
    ]);
    await openPicker();
    toggleGroups();

    fireEvent.press(screen.getByTestId('exercise-picker-group-row-gx-bench'));
    fireEvent.press(await screen.findByTestId('group-pick-sheet-linked-ex-hotel'));

    expect(await screen.findByLabelText('Exercise options 1')).toBeTruthy();
    expect(screen.getByText('Hotel Bench')).toBeTruthy();
    expect(mockLinkExercise).not.toHaveBeenCalled();
  });
});

describe('pick sheet (E0.2)', () => {
  it('preselects my copy of the standard exercise; Link and add links, then adds it', async () => {
    mockLinkExercise.mockResolvedValue({} as never);
    await openPicker();
    toggleGroups();
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

    expect(mockLinkExercise).toHaveBeenCalledWith('seed_barbell_bench_press', 'g-iron', 'gx-bench');
    expect((mockLinkingState.reloadLinks as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    expect(screen.queryByTestId('group-pick-sheet')).toBeNull();
    expect(await screen.findByLabelText('Exercise options 1')).toBeTruthy();
  });

  it('offline: Link and add writes the link locally and adds the exercise', async () => {
    mockLinkExercise.mockResolvedValue({} as never);
    mockLinkingState = { ...linkingState(), offline: true };
    await openPicker();
    toggleGroups();
    fireEvent.press(screen.getByTestId('exercise-picker-group-row-gx-bench'));
    await screen.findByTestId('group-pick-sheet');
    const refreshCallsBefore = (mockLinkingState.refresh as jest.Mock).mock.calls.length;

    await act(async () => {
      fireEvent.press(screen.getByTestId('group-pick-sheet-confirm'));
    });

    expect(mockLinkExercise).toHaveBeenCalledWith('seed_barbell_bench_press', 'g-iron', 'gx-bench');
    expect(await screen.findByLabelText('Exercise options 1')).toBeTruthy();
    // The link is a local write: nothing asks the server.
    expect((mockLinkingState.refresh as jest.Mock).mock.calls.length).toBe(refreshCallsBefore);
  });

  it('a failed link shows inline and adds nothing', async () => {
    mockLinkExercise.mockRejectedValue(new Error('disk full'));
    await openPicker();
    toggleGroups();
    fireEvent.press(screen.getByTestId('exercise-picker-group-row-gx-bench'));

    await act(async () => {
      fireEvent.press(await screen.findByTestId('group-pick-sheet-confirm'));
    });

    expect(screen.getByTestId('group-pick-sheet-error')).toHaveTextContent('disk full');
    expect(screen.queryByLabelText('Exercise options 1')).toBeNull();
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
    await openPicker();
    toggleGroups();
    fireEvent.press(screen.getByTestId('exercise-picker-group-row-gx-row'));

    expect(await screen.findByTestId('group-pick-sheet-option-add-new')).toHaveProp('accessibilityState', { checked: true });
    expect(screen.queryByTestId('group-pick-sheet-option-suggested')).toBeNull();

    fireEvent.press(screen.getByTestId('group-pick-sheet-cancel'));
    expect(screen.queryByTestId('group-pick-sheet')).toBeNull();
    expect(screen.getByTestId('exercise-picker-groups-toggle')).toBeTruthy();
  });

  it('Add as new opens the prefilled editor and creates the exercise and its link together', async () => {
    mockCreateExerciseWithGroupLink.mockResolvedValue({
      exercise: { id: 'ex-new', name: 'Bench Press', loadInputMode: 'total_load', deletedAt: null, mappings: [] },
      link: {} as never,
    });
    await openPicker();
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
    expect(await screen.findByLabelText('Exercise options 1')).toBeTruthy();
  });
});

describe('recorder ••• menu', () => {
  it('Link to group exercise… opens the Link screen for that exercise', async () => {
    await openPicker();
    toggleGroups();
    fireEvent.press(screen.getByTestId('exercise-picker-group-row-gx-tue-squat'));
    fireEvent.press(await screen.findByLabelText('Exercise options 1'));

    fireEvent.press(screen.getByLabelText('Link to group exercise'));

    expect(mockPush).toHaveBeenCalledWith('/exercise-link?exerciseDefinitionId=seed_barbell_back_squat');
  });
});

describe('signed out', () => {
  it('no Groups toggle, no group section, no ••• link item', async () => {
    mockLinkingUserId = null;
    mockLinkingState = { ...linkingState([]), catalogs: null };
    await openPicker();

    expect(screen.queryByTestId('exercise-picker-groups-toggle')).toBeNull();
    fireEvent.changeText(screen.getByLabelText('Exercise filter input'), 'bench');
    expect(screen.queryByTestId('exercise-picker-group-section')).toBeNull();

    fireEvent.press(screen.getByLabelText('Select exercise Bench Press'));
    fireEvent.press(await screen.findByTestId('exercise-picker-add-empty-set-button'));
    fireEvent.press(await screen.findByLabelText('Exercise options 1'));
    expect(screen.getByLabelText('Change exercise')).toBeTruthy();
    expect(screen.queryByLabelText('Link to group exercise')).toBeNull();
  });
});
