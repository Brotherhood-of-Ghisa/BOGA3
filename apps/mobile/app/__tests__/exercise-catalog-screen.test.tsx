import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Keyboard, Platform, StyleSheet, type ViewStyle } from 'react-native';

import ExerciseCatalogScreen from '../(tabs)/exercise-catalog';

import {
  deleteExerciseCatalogExercise,
  listExerciseCatalogExercises,
  listExerciseCatalogMuscleGroups,
  saveExerciseCatalogExercise,
  undeleteExerciseCatalogExercise,
  type ExerciseCatalogExercise,
} from '@/src/data/exercise-catalog';
import { uiRoles } from '@/components/ui';
import { __resetExerciseCatalogCacheForTests } from '@/src/exercise-catalog/cache';
import { invalidateExerciseCatalogCache } from '@/src/exercise-catalog/invalidation';
import { __resetExerciseListPreferencesForTests } from '@/src/exercise-catalog/list-preferences';
import { loadExerciseCatalogStatsRawHistory } from '@/src/data/exercise-catalog-stats';
import { __resetExerciseCatalogStatsCacheForTests } from '@/src/exercise-catalog/stats-cache';

const mockReplace = jest.fn();
let mockSearchParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    replace: mockReplace,
  }),
  useFocusEffect: (_callback: () => void | (() => void)) => {
    // no-op in tests; the focus effect only reloads stats which we already mock
  },
}));

jest.mock('@/src/data/exercise-catalog-stats', () => ({
  loadExerciseCatalogStatsRawHistory: jest.fn(),
  aggregateExerciseCatalogStats: jest.requireActual(
    '@/src/data/exercise-catalog-stats'
  ).aggregateExerciseCatalogStats,
}));

const mockLoadRawHistory = jest.mocked(loadExerciseCatalogStatsRawHistory);

jest.mock('@/src/data/exercise-catalog', () => ({
  listExerciseCatalogMuscleGroups: jest.fn(),
  listExerciseCatalogExercises: jest.fn(),
  saveExerciseCatalogExercise: jest.fn(),
  deleteExerciseCatalogExercise: jest.fn(),
  undeleteExerciseCatalogExercise: jest.fn(),
}));

const mockListMuscleGroups = jest.mocked(listExerciseCatalogMuscleGroups);
const mockListExercises = jest.mocked(listExerciseCatalogExercises);
const mockSaveExercise = jest.mocked(saveExerciseCatalogExercise);
const mockDeleteExercise = jest.mocked(deleteExerciseCatalogExercise);
const mockUndeleteExercise = jest.mocked(undeleteExerciseCatalogExercise);

const setExerciseListAndInvalidate = (next: ExerciseCatalogExercise[]) => {
  mockListExercises.mockResolvedValue(next);
  invalidateExerciseCatalogCache();
};

type TestNode = typeof screen.UNSAFE_root;

// Host nodes drawn on the `accent` ground under `root`: its primaries.
const accentGrounds = (root: TestNode = screen.UNSAFE_root) =>
  root
    .findAll((node: TestNode) => typeof node.type === 'string')
    .filter((node: TestNode) => (StyleSheet.flatten(node.props.style) as ViewStyle | undefined)?.backgroundColor === uiRoles.accent);

const expandFamily = async (familyName: string, count: number) => {
  fireEvent.press(await screen.findByLabelText(`${familyName} exercises ${count}`));
};

describe('ExerciseCatalogScreen', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockSearchParams = {};
    mockListMuscleGroups.mockReset();
    mockListExercises.mockReset();
    mockSaveExercise.mockReset();
    mockDeleteExercise.mockReset();
    mockUndeleteExercise.mockReset();
    mockLoadRawHistory.mockReset();
    mockLoadRawHistory.mockResolvedValue({
      sessions: [],
      sessionExercises: [],
      exerciseSets: [],
    });
    __resetExerciseCatalogCacheForTests();
    __resetExerciseCatalogStatsCacheForTests();
    __resetExerciseListPreferencesForTests();

    mockListMuscleGroups.mockResolvedValue([
      { id: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 0 },
      { id: 'triceps', displayName: 'Triceps', familyName: 'Arms', sortOrder: 1 },
      { id: 'delts_front', displayName: 'Front Delts', familyName: 'Shoulders', sortOrder: 2 },
      { id: 'quads', displayName: 'Quads', familyName: 'Legs', sortOrder: 3 },
      { id: 'back', displayName: 'Back', familyName: 'Back', sortOrder: 4 },
    ]);
  });

  it('returns explicitly to More when the catalog was launched from the hub', async () => {
    mockSearchParams = { source: 'more' };
    mockListExercises.mockResolvedValue([]);
    render(<ExerciseCatalogScreen />);

    fireEvent.press(await screen.findByTestId('back-to-more-button'));

    expect(mockReplace).toHaveBeenCalledWith('/more');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a new exercise with primary and secondary muscles', async () => {
    mockListExercises.mockResolvedValue([]);
    const savedExercise: ExerciseCatalogExercise = {
      id: 'custom-ex-1',
      name: 'Incline Press',
      loadInputMode: 'per_side_load',
      deletedAt: null,
      mappings: [
        { id: 'map-1', muscleGroupId: 'chest', weight: 1, role: 'primary' },
        { id: 'map-2', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
      ],
    };
    mockSaveExercise.mockImplementation(async () => {
      setExerciseListAndInvalidate([savedExercise]);
      return savedExercise;
    });

    render(<ExerciseCatalogScreen />);

    await screen.findByLabelText('Create new exercise');

    fireEvent.press(screen.getByLabelText('Create new exercise'));
    await screen.findByText('Create Exercise');
    fireEvent.changeText(screen.getByLabelText('Exercise definition name'), 'Incline Press');
    fireEvent.press(screen.getByLabelText('Per side weight entry'));
    fireEvent.press(screen.getByLabelText('Open primary muscle selector'));
    await screen.findByLabelText('Select primary muscle Chest');
    fireEvent.press(screen.getByLabelText('Select primary muscle Chest'));
    fireEvent.press(screen.getByLabelText('Open secondary muscle selector'));
    await screen.findByLabelText('Select secondary muscle Triceps');
    fireEvent.press(screen.getByLabelText('Select secondary muscle Triceps'));
    fireEvent.press(screen.getByLabelText('Save exercise definition'));

    await waitFor(() =>
      expect(mockSaveExercise).toHaveBeenCalledWith({
        id: undefined,
        name: 'Incline Press',
        loadInputMode: 'per_side_load',
        mappings: [
          { muscleGroupId: 'chest', weight: 1, role: 'primary' },
          { muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
        ],
      })
    );

    expect(screen.getByText('Exercise created.')).toBeTruthy();
    await expandFamily('Chest', 1);
    expect(screen.getByText('Incline Press')).toBeTruthy();
    expect(screen.getByText('Chest · Triceps (s)')).toBeTruthy();
  });

  it('edits an existing exercise by changing name and secondary muscles', async () => {
    mockListExercises.mockResolvedValue([
      {
        id: 'seed_barbell_bench_press',
        name: 'Barbell Bench Press',
        loadInputMode: 'total_load',
        deletedAt: null,
        mappings: [
          { id: 'map-chest', muscleGroupId: 'chest', weight: 1, role: 'primary' },
          { id: 'map-triceps', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
        ],
      },
    ]);
    const updatedExercise: ExerciseCatalogExercise = {
      id: 'seed_barbell_bench_press',
      name: 'Bench Press',
      loadInputMode: 'per_side_load',
      deletedAt: null,
      mappings: [
        { id: 'map-chest', muscleGroupId: 'chest', weight: 1, role: 'primary' },
        { id: 'map-delts', muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
      ],
    };
    mockSaveExercise.mockImplementation(async () => {
      setExerciseListAndInvalidate([updatedExercise]);
      return updatedExercise;
    });

    render(<ExerciseCatalogScreen />);

    await expandFamily('Chest', 1);
    await screen.findByText('Barbell Bench Press');
    expect(screen.getByText('Chest · Triceps (s)')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Exercise actions Barbell Bench Press'));
    await screen.findByTestId('exercise-catalog-actions-sheet');
    fireEvent.press(screen.getByLabelText('Edit exercise from actions'));
    await screen.findByText('Edit Exercise');
    expect(screen.getByLabelText('Total load weight entry').props.accessibilityState.selected).toBe(true);
    expect(screen.queryByText('Cancel')).toBeNull();
    fireEvent.changeText(screen.getByLabelText('Exercise definition name'), 'Bench Press');
    fireEvent.press(screen.getByLabelText('Per side weight entry'));
    fireEvent.press(screen.getByLabelText('Remove secondary muscle Triceps'));
    fireEvent.press(screen.getByLabelText('Open secondary muscle selector'));
    await screen.findByLabelText('Select secondary muscle Front Delts');
    fireEvent.press(screen.getByLabelText('Select secondary muscle Front Delts'));
    fireEvent.press(screen.getByLabelText('Save exercise definition'));

    await waitFor(() =>
      expect(mockSaveExercise).toHaveBeenCalledWith({
        id: 'seed_barbell_bench_press',
        name: 'Bench Press',
        loadInputMode: 'per_side_load',
        mappings: [
          { muscleGroupId: 'chest', weight: 1, role: 'primary' },
          { muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
        ],
      })
    );

    expect(screen.getByText('Exercise updated.')).toBeTruthy();
    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.getByText('Chest · Front Delts (s)')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Edit exercise definition Bench Press'));
    await screen.findByText('Edit Exercise');
    expect(screen.getByDisplayValue('Bench Press')).toBeTruthy();
    expect(screen.queryByLabelText('Remove secondary muscle Triceps')).toBeNull();
    expect(screen.getByLabelText('Remove secondary muscle Front Delts')).toBeTruthy();
  });

  it('blocks save when no primary muscle is selected', async () => {
    mockListExercises.mockResolvedValue([]);

    render(<ExerciseCatalogScreen />);

    await screen.findByLabelText('Create new exercise');

    fireEvent.press(screen.getByLabelText('Create new exercise'));
    await screen.findByText('Create Exercise');
    fireEvent.changeText(screen.getByLabelText('Exercise definition name'), 'Cable Fly');
    fireEvent.press(screen.getByLabelText('Save exercise definition'));

    expect(screen.getByText('Select a primary muscle before saving.')).toBeTruthy();
    expect(mockSaveExercise).not.toHaveBeenCalled();
  });

  it('renders the shared ExerciseCore fields and blocks a blank name with the shared validator message', async () => {
    mockListExercises.mockResolvedValue([]);

    render(<ExerciseCatalogScreen />);

    await screen.findByLabelText('Create new exercise');

    fireEvent.press(screen.getByLabelText('Create new exercise'));
    await screen.findByText('Create Exercise');
    // M25-T08: the fields come from ExerciseCoreFields and keep the editor's testIDs.
    expect(screen.getByTestId('exercise-editor-name-input')).toBeTruthy();
    expect(screen.getByTestId('exercise-editor-load-mode-total_load').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('exercise-editor-load-mode-per_side_load').props.accessibilityState).toMatchObject({ selected: false });
    fireEvent.changeText(screen.getByTestId('exercise-editor-name-input'), ' \t ');
    fireEvent.press(screen.getByLabelText('Save exercise definition'));

    expect(screen.getByTestId('exercise-editor-name-error')).toHaveTextContent('Exercise name is required');
    expect(mockSaveExercise).not.toHaveBeenCalled();
  });

  it('dismisses the keyboard and uses keyboard-aware scrolling for the muscle selector', async () => {
    const dismissKeyboard = jest.spyOn(Keyboard, 'dismiss').mockImplementation(jest.fn());
    mockListExercises.mockResolvedValue([]);

    render(<ExerciseCatalogScreen />);

    await screen.findByLabelText('Create new exercise');

    fireEvent.press(screen.getByLabelText('Create new exercise'));
    await screen.findByText('Create Exercise');
    fireEvent.changeText(screen.getByLabelText('Exercise definition name'), 'Cable Row');
    fireEvent.press(screen.getByLabelText('Open primary muscle selector'));

    expect(dismissKeyboard).toHaveBeenCalledTimes(1);

    const selectorList = await screen.findByTestId('exercise-editor-muscle-selector-list');
    expect(selectorList.props.automaticallyAdjustKeyboardInsets).toBe(Platform.OS === 'ios');
    expect(selectorList.props.contentInsetAdjustmentBehavior).toBe('automatic');
    expect(selectorList.props.keyboardDismissMode).toBe('on-drag');
    expect(selectorList.props.keyboardShouldPersistTaps).toBe('handled');
  });

  it('prevents duplicate secondary links and excludes the selected primary from secondary options', async () => {
    mockListExercises.mockResolvedValue([]);

    render(<ExerciseCatalogScreen />);

    await screen.findByLabelText('Create new exercise');

    fireEvent.press(screen.getByLabelText('Create new exercise'));
    await screen.findByText('Create Exercise');
    fireEvent.changeText(screen.getByLabelText('Exercise definition name'), 'Press Variation');
    fireEvent.press(screen.getByLabelText('Open primary muscle selector'));
    fireEvent.press(screen.getByLabelText('Select primary muscle Chest'));

    fireEvent.press(screen.getByLabelText('Open secondary muscle selector'));
    expect(screen.queryByLabelText('Select secondary muscle Chest')).toBeNull();
    fireEvent.press(screen.getByLabelText('Select secondary muscle Triceps'));

    fireEvent.press(screen.getByLabelText('Open secondary muscle selector'));
    expect(screen.queryByLabelText('Select secondary muscle Triceps')).toBeNull();
    expect(screen.getByLabelText('Select secondary muscle Front Delts')).toBeTruthy();
  });

  it('deletes an exercise from the kebab action flow', async () => {
    mockListExercises.mockResolvedValue([
      {
        id: 'custom-ex-1',
        name: 'Incline Press',
        deletedAt: null,
        mappings: [{ id: 'map-1', muscleGroupId: 'chest', weight: 1, role: 'primary' }],
      },
    ]);
    mockDeleteExercise.mockImplementation(async () => {
      setExerciseListAndInvalidate([]);
    });

    render(<ExerciseCatalogScreen />);

    await expandFamily('Chest', 1);
    await screen.findByText('Incline Press');
    fireEvent.press(screen.getByLabelText('Exercise actions Incline Press'));
    // Titled with the exercise's name (DLM-T07).
    expect(await screen.findByRole('header', { name: 'Incline Press' })).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Delete exercise from actions'));

    await waitFor(() => expect(mockDeleteExercise).toHaveBeenCalledWith('custom-ex-1'));
    expect(screen.getByText('Exercise deleted.')).toBeTruthy();
  });

  it('shows deleted exercises and supports undelete', async () => {
    const activeExercise: ExerciseCatalogExercise = {
      id: 'exercise-active-1',
      name: 'Bench Press',
      deletedAt: null,
      mappings: [{ id: 'map-a', muscleGroupId: 'chest', weight: 1, role: 'primary' }],
    };
    const deletedExercise: ExerciseCatalogExercise = {
      id: 'exercise-deleted-1',
      name: 'Old Fly',
      deletedAt: new Date('2026-02-27T10:00:00.000Z'),
      mappings: [{ id: 'map-b', muscleGroupId: 'chest', weight: 1, role: 'primary' }],
    };
    mockListExercises.mockResolvedValue([activeExercise, deletedExercise]);
    mockUndeleteExercise.mockImplementation(async () => {
      setExerciseListAndInvalidate([activeExercise, { ...deletedExercise, deletedAt: null }]);
    });

    render(<ExerciseCatalogScreen />);

    await expandFamily('Chest', 1);
    await screen.findByText('Bench Press');
    expect(mockListExercises).toHaveBeenCalledWith({ includeDeleted: true });
    expect(screen.queryByText('Old Fly')).toBeNull();

    fireEvent.press(screen.getByLabelText('Exercise catalog options'));
    await screen.findByText('Filters');
    fireEvent.press(screen.getByLabelText('Show deleted exercises'));
    // The Filters sheet's backdrop, hidden from VoiceOver while the sheet is modal.
    fireEvent.press(screen.getByLabelText('Close filters', { includeHiddenElements: true }));

    await screen.findByText('Old Fly');

    fireEvent.press(screen.getByLabelText('Exercise actions Old Fly'));
    await screen.findByTestId('exercise-catalog-actions-sheet');
    fireEvent.press(screen.getByLabelText('Undelete exercise from actions'));

    await waitFor(() => {
      expect(mockUndeleteExercise).toHaveBeenCalledWith('exercise-deleted-1');
      expect(screen.getByText('Exercise restored.')).toBeTruthy();
    });
  });

  describe('design language (DLM-T07)', () => {
    const BENCH: ExerciseCatalogExercise = {
      id: 'seed_barbell_bench_press',
      name: 'Barbell Bench Press',
      loadInputMode: 'total_load',
      deletedAt: null,
      mappings: [{ id: 'map-chest', muscleGroupId: 'chest', weight: 1, role: 'primary' }],
    };

    it('titles the screen Exercises, with + as its one accent and the active filters as tags', async () => {
      mockListExercises.mockResolvedValue([BENCH]);
      render(<ExerciseCatalogScreen />);

      expect(await screen.findByRole('header', { name: 'Exercises' })).toBeTruthy();
      expect(screen.getByTestId('exercise-catalog-title')).toBeTruthy();
      const accents = accentGrounds();
      expect(accents).toHaveLength(1);
      expect(accents[0].props.testID).toBe('create-new-exercise-button');

      // Each tag names an active filter and opens the Filters sheet.
      expect(screen.getByText('Range: 90d')).toBeTruthy();
      fireEvent.press(screen.getByLabelText('Open filters (Grouped)'));
      expect(await screen.findByTestId('exercise-catalog-filters-sheet')).toBeTruthy();
      expect(screen.getByRole('header', { name: 'Filters' })).toBeTruthy();
      expect(screen.queryByText('Done')).toBeNull();
    });

    it('filters by muscle group in the Filters sheet, and Clear resets it', async () => {
      mockListExercises.mockResolvedValue([
        BENCH,
        {
          id: 'seed_squat',
          name: 'Back Squat',
          loadInputMode: 'total_load',
          deletedAt: null,
          mappings: [{ id: 'map-quads', muscleGroupId: 'quads', weight: 1, role: 'primary' }],
        },
      ]);
      render(<ExerciseCatalogScreen />);

      fireEvent.press(await screen.findByLabelText('Exercise catalog options'));
      fireEvent.press(await screen.findByLabelText('Toggle muscle group Quads'));
      expect(screen.getByLabelText('Toggle muscle group Quads').props.accessibilityState).toMatchObject({ checked: true });
      expect(screen.getByText('Muscles: 1')).toBeTruthy();
      expect(await screen.findByLabelText('Chest exercises 0')).toBeTruthy();

      fireEvent.press(screen.getByLabelText('Clear muscle group selection'));
      expect(screen.getByLabelText('Toggle muscle group Quads').props.accessibilityState).toMatchObject({ checked: false });
      expect(screen.queryByLabelText('Clear muscle group selection')).toBeNull();
    });

    it('titles the actions sheet with the name; Delete is the danger row and a deleted exercise cannot be edited', async () => {
      const deleted: ExerciseCatalogExercise = { ...BENCH, id: 'old-fly', name: 'Old Fly', deletedAt: new Date('2026-02-27T10:00:00.000Z') };
      mockListExercises.mockResolvedValue([BENCH, deleted]);
      render(<ExerciseCatalogScreen />);

      await expandFamily('Chest', 1);
      fireEvent.press(await screen.findByLabelText('Exercise actions Barbell Bench Press'));
      const sheet = await screen.findByTestId('exercise-catalog-actions-sheet');
      expect(screen.getByRole('header', { name: 'Barbell Bench Press' })).toBeTruthy();
      expect(sheet).toBeTruthy();
      expect(screen.getByTestId('exercise-action-delete')).toBeTruthy();
      expect(screen.getByText('Delete')).toHaveStyle({ color: uiRoles.danger });
      fireEvent.press(screen.getByLabelText('Dismiss exercise action menu overlay', { includeHiddenElements: true }));
      expect(screen.queryByTestId('exercise-catalog-actions-sheet')).toBeNull();

      fireEvent.press(screen.getByLabelText('Exercise catalog options'));
      fireEvent.press(await screen.findByLabelText('Show deleted exercises'));
      fireEvent.press(screen.getByLabelText('Close filters', { includeHiddenElements: true }));
      fireEvent.press(await screen.findByLabelText('Exercise actions Old Fly'));
      await screen.findByTestId('exercise-catalog-actions-sheet');
      expect(screen.getByLabelText('Edit exercise from actions')).toBeDisabled();
      expect(screen.getByTestId('exercise-action-undelete')).toBeTruthy();
      expect(screen.queryByTestId('exercise-action-delete')).toBeNull();
    });

    it('dismisses the filter keyboard before opening a sheet over it', async () => {
      const dismissKeyboard = jest.spyOn(Keyboard, 'dismiss').mockImplementation(jest.fn());
      mockListExercises.mockResolvedValue([BENCH]);
      render(<ExerciseCatalogScreen />);

      await expandFamily('Chest', 1);
      fireEvent.press(await screen.findByLabelText('Exercise actions Barbell Bench Press'));
      expect(dismissKeyboard).toHaveBeenCalledTimes(1);
      fireEvent.press(screen.getByLabelText('Exercise catalog options'));
      expect(dismissKeyboard).toHaveBeenCalledTimes(2);
    });

    it('says why the list is empty, once, grouped or flat', async () => {
      mockListExercises.mockResolvedValue([]);
      render(<ExerciseCatalogScreen />);

      expect(await screen.findAllByText('No active exercises yet. Create one with the button above.')).toHaveLength(1);
      fireEvent.press(screen.getByLabelText('Exercise catalog options'));
      fireEvent.press(await screen.findByLabelText('Turn grouping off'));
      fireEvent.press(screen.getByLabelText('Close filters', { includeHiddenElements: true }));
      expect(await screen.findAllByText('No active exercises yet. Create one with the button above.')).toHaveLength(1);
    });

    it('opens the editor as a sheet with Save as its one accent, dismissed by the backdrop', async () => {
      mockListExercises.mockResolvedValue([]);
      render(<ExerciseCatalogScreen />);

      fireEvent.press(await screen.findByLabelText('Create new exercise'));
      expect(await screen.findByTestId('exercise-editor')).toBeTruthy();
      expect(screen.getByRole('header', { name: 'Create Exercise' })).toBeTruthy();
      expect(screen.getByTestId('exercise-editor-load-mode-row').props.accessibilityRole).toBe('tablist');
      const editorAccents = accentGrounds(screen.getByTestId('exercise-editor'));
      expect(editorAccents).toHaveLength(1);
      expect(editorAccents[0].props.accessibilityLabel).toBe('Save exercise definition');

      fireEvent.press(screen.getByLabelText('Dismiss exercise editor overlay', { includeHiddenElements: true }));
      expect(screen.queryByTestId('exercise-editor')).toBeNull();
    });

    it('swaps the editor for the muscle list in the same sheet, and Back to exercise returns without choosing', async () => {
      mockListExercises.mockResolvedValue([]);
      render(<ExerciseCatalogScreen />);

      fireEvent.press(await screen.findByLabelText('Create new exercise'));
      await screen.findByTestId('exercise-editor');
      fireEvent.changeText(screen.getByLabelText('Exercise definition name'), 'Cable Fly');
      fireEvent.press(screen.getByLabelText('Open primary muscle selector'));

      expect(screen.getByRole('header', { name: 'Select primary muscle' })).toBeTruthy();
      expect(screen.getByTestId('exercise-editor-muscle-selector-list')).toBeTruthy();
      // The form is hidden, not a second sheet over it.
      expect(screen.queryByLabelText('Save exercise definition')).toBeNull();
      expect(screen.getAllByTestId('exercise-editor')).toHaveLength(1);

      fireEvent.press(screen.getByLabelText('Back to exercise'));
      expect(screen.getByRole('header', { name: 'Create Exercise' })).toBeTruthy();
      expect(screen.getByDisplayValue('Cable Fly')).toBeTruthy();
      expect(screen.getByText('Select primary muscle')).toBeTruthy();

      // The chosen primary is marked in the list when it opens again.
      fireEvent.press(screen.getByLabelText('Open primary muscle selector'));
      fireEvent.press(screen.getByLabelText('Select primary muscle Chest'));
      fireEvent.press(screen.getByLabelText('Open primary muscle selector'));
      expect(screen.getByTestId('exercise-editor-muscle-option-chest').props.accessibilityState).toMatchObject({ selected: true });
    });

    it('shows a save failure as a danger notice under Save', async () => {
      mockListExercises.mockResolvedValue([]);
      mockSaveExercise.mockRejectedValue(new Error('Disk full.'));
      render(<ExerciseCatalogScreen />);

      fireEvent.press(await screen.findByLabelText('Create new exercise'));
      await screen.findByTestId('exercise-editor');
      fireEvent.changeText(screen.getByLabelText('Exercise definition name'), 'Cable Fly');
      fireEvent.press(screen.getByLabelText('Open primary muscle selector'));
      fireEvent.press(screen.getByLabelText('Select primary muscle Chest'));
      fireEvent.press(screen.getByLabelText('Save exercise definition'));

      const notice = await screen.findByTestId('exercise-editor-save-error');
      expect(notice.props.accessibilityRole).toBe('alert');
      expect(notice).toHaveTextContent('Disk full.');
      expect(screen.getByTestId('exercise-editor')).toBeTruthy();
    });
  });
});
