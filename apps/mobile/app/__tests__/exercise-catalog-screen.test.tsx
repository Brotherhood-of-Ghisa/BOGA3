import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Keyboard, Platform } from 'react-native';

import ExerciseCatalogScreen from '../(tabs)/exercise-catalog';

import {
  deleteExerciseCatalogExercise,
  listExerciseCatalogExercises,
  listExerciseCatalogMuscleGroups,
  saveExerciseCatalogExercise,
  undeleteExerciseCatalogExercise,
  type ExerciseCatalogExercise,
} from '@/src/data/exercise-catalog';
import { __resetExerciseCatalogCacheForTests } from '@/src/exercise-catalog/cache';
import { invalidateExerciseCatalogCache } from '@/src/exercise-catalog/invalidation';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
  }),
}));

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

describe('ExerciseCatalogScreen', () => {
  beforeEach(() => {
    mockListMuscleGroups.mockReset();
    mockListExercises.mockReset();
    mockSaveExercise.mockReset();
    mockDeleteExercise.mockReset();
    mockUndeleteExercise.mockReset();
    __resetExerciseCatalogCacheForTests();

    mockListMuscleGroups.mockResolvedValue([
      { id: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 0 },
      { id: 'triceps', displayName: 'Triceps', familyName: 'Arms', sortOrder: 1 },
      { id: 'delts_front', displayName: 'Front Delts', familyName: 'Shoulders', sortOrder: 2 },
      { id: 'quads', displayName: 'Quads', familyName: 'Legs', sortOrder: 3 },
      { id: 'back', displayName: 'Back', familyName: 'Back', sortOrder: 4 },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a new exercise with primary and secondary muscles', async () => {
    mockListExercises.mockResolvedValue([]);
    const savedExercise: ExerciseCatalogExercise = {
      id: 'custom-ex-1',
      name: 'Incline Press',
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
        mappings: [
          { muscleGroupId: 'chest', weight: 1, role: 'primary' },
          { muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
        ],
      })
    );

    expect(screen.getByText('Exercise created.')).toBeTruthy();
    expect(screen.getByText('Incline Press')).toBeTruthy();
    expect(screen.getByText('Chest · Triceps (s)')).toBeTruthy();
  });

  it('edits an existing exercise by changing name and secondary muscles', async () => {
    mockListExercises.mockResolvedValue([
      {
        id: 'sys_barbell_bench_press',
        name: 'Barbell Bench Press',
        deletedAt: null,
        mappings: [
          { id: 'map-chest', muscleGroupId: 'chest', weight: 1, role: 'primary' },
          { id: 'map-triceps', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
        ],
      },
    ]);
    const updatedExercise: ExerciseCatalogExercise = {
      id: 'sys_barbell_bench_press',
      name: 'Bench Press',
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

    await screen.findByText('Barbell Bench Press');
    expect(screen.getByText('Chest · Triceps (s)')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Exercise actions Barbell Bench Press'));
    await screen.findByText('Exercise Actions');
    fireEvent.press(screen.getByLabelText('Edit exercise from actions'));
    await screen.findByText('Edit Exercise');
    expect(screen.queryByText('Cancel')).toBeNull();
    fireEvent.changeText(screen.getByLabelText('Exercise definition name'), 'Bench Press');
    fireEvent.press(screen.getByLabelText('Remove secondary muscle Triceps'));
    fireEvent.press(screen.getByLabelText('Open secondary muscle selector'));
    await screen.findByLabelText('Select secondary muscle Front Delts');
    fireEvent.press(screen.getByLabelText('Select secondary muscle Front Delts'));
    fireEvent.press(screen.getByLabelText('Save exercise definition'));

    await waitFor(() =>
      expect(mockSaveExercise).toHaveBeenCalledWith({
        id: 'sys_barbell_bench_press',
        name: 'Bench Press',
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

    await screen.findByText('Incline Press');
    fireEvent.press(screen.getByLabelText('Exercise actions Incline Press'));
    await screen.findByText('Exercise Actions');
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

    await screen.findByText('Bench Press');
    expect(mockListExercises).toHaveBeenCalledWith({ includeDeleted: true });
    expect(screen.queryByText('Old Fly')).toBeNull();

    fireEvent.press(screen.getByLabelText('Exercise catalog options'));
    await screen.findByText('Catalog Options');
    fireEvent.press(screen.getByLabelText('Show deleted exercises'));

    await waitFor(() => {
      expect(screen.getByText('Old Fly')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Exercise actions Old Fly'));
    await screen.findByText('Exercise Actions');
    fireEvent.press(screen.getByLabelText('Undelete exercise from actions'));

    await waitFor(() => {
      expect(mockUndeleteExercise).toHaveBeenCalledWith('exercise-deleted-1');
      expect(screen.getByText('Exercise restored.')).toBeTruthy();
    });
  });

});
