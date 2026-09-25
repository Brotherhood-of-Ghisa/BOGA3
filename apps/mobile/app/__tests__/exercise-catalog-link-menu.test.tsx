/**
 * M25-T07 AC5 (catalogue half): the Exercise Catalog row ⋮ actions sheet
 * gains "Link to group exercise…", which pushes the Link screen for that
 * exercise. It is signed-in only, and disabled for a soft-deleted exercise
 * (card decision (b)). The data layer is mocked like
 * exercise-catalog-screen.test.tsx.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import ExerciseCatalogScreen from '../(tabs)/exercise-catalog';
import {
  listExerciseCatalogExercises,
  listExerciseCatalogMuscleGroups,
  type ExerciseCatalogExercise,
} from '@/src/data/exercise-catalog';
import { loadExerciseCatalogStatsRawHistory } from '@/src/data/exercise-catalog-stats';
import { __resetExerciseCatalogCacheForTests } from '@/src/exercise-catalog/cache';
import { __resetExerciseListPreferencesForTests } from '@/src/exercise-catalog/list-preferences';
import { __resetExerciseCatalogStatsCacheForTests } from '@/src/exercise-catalog/stats-cache';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useFocusEffect: () => undefined,
}));

let mockAuthSnapshot: { isConfigured: boolean; user: { id: string } | null } = {
  isConfigured: true,
  user: { id: 'user-1' },
};
jest.mock('@/src/auth', () => ({
  getAuthSnapshot: () => mockAuthSnapshot,
  subscribeToAuthState: () => () => undefined,
}));

jest.mock('@/src/data/exercise-catalog-stats', () => ({
  loadExerciseCatalogStatsRawHistory: jest.fn(),
  aggregateExerciseCatalogStats: jest.requireActual('@/src/data/exercise-catalog-stats').aggregateExerciseCatalogStats,
}));

jest.mock('@/src/data/exercise-catalog', () => ({
  listExerciseCatalogMuscleGroups: jest.fn(),
  listExerciseCatalogExercises: jest.fn(),
  saveExerciseCatalogExercise: jest.fn(),
  deleteExerciseCatalogExercise: jest.fn(),
  undeleteExerciseCatalogExercise: jest.fn(),
}));

const ACTIVE: ExerciseCatalogExercise = {
  id: 'seed_barbell_bench_press',
  name: 'Bench Press',
  deletedAt: null,
  mappings: [{ id: 'map-a', muscleGroupId: 'chest', weight: 1, role: 'primary' }],
};
const DELETED: ExerciseCatalogExercise = {
  id: 'exercise-deleted-1',
  name: 'Old Fly',
  deletedAt: new Date('2026-02-27T10:00:00.000Z'),
  mappings: [{ id: 'map-b', muscleGroupId: 'chest', weight: 1, role: 'primary' }],
};

beforeEach(() => {
  mockPush.mockReset();
  mockAuthSnapshot = { isConfigured: true, user: { id: 'user-1' } };
  __resetExerciseCatalogCacheForTests();
  __resetExerciseCatalogStatsCacheForTests();
  __resetExerciseListPreferencesForTests();
  jest.mocked(loadExerciseCatalogStatsRawHistory).mockResolvedValue({ sessions: [], sessionExercises: [], exerciseSets: [] });
  jest.mocked(listExerciseCatalogMuscleGroups).mockResolvedValue([
    { id: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 0 },
  ]);
  jest.mocked(listExerciseCatalogExercises).mockResolvedValue([ACTIVE, DELETED]);
});

const openActions = async (name: string) => {
  fireEvent.press(await screen.findByLabelText(`Exercise actions ${name}`));
  // The actions sheet is titled with the exercise's name (DLM-T07).
  await screen.findByTestId('exercise-catalog-actions-sheet');
};

describe('catalogue ⋮ Link to group exercise…', () => {
  it('pushes the Link screen for the exercise', async () => {
    render(<ExerciseCatalogScreen />);
    fireEvent.press(await screen.findByLabelText('Chest exercises 1'));
    await openActions('Bench Press');

    fireEvent.press(screen.getByLabelText('Link to group exercise from actions'));

    expect(mockPush).toHaveBeenCalledWith('/exercise-link?exerciseDefinitionId=seed_barbell_bench_press');
    expect(screen.queryByTestId('exercise-catalog-actions-sheet')).toBeNull();
  });

  it('is disabled for a soft-deleted exercise', async () => {
    render(<ExerciseCatalogScreen />);
    fireEvent.press(await screen.findByLabelText('Exercise catalog options'));
    await screen.findByText('Filters');
    fireEvent.press(screen.getByLabelText('Show deleted exercises'));
    // The Filters sheet's backdrop, hidden from VoiceOver while the sheet is modal.
    fireEvent.press(screen.getByLabelText('Close filters', { includeHiddenElements: true }));
    fireEvent.press(await screen.findByLabelText('Chest exercises 2'));
    await screen.findByText('Old Fly');
    await openActions('Old Fly');

    const item = screen.getByLabelText('Link to group exercise from actions');
    expect(item).toBeDisabled();
    fireEvent.press(item);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('is absent while signed out', async () => {
    mockAuthSnapshot = { isConfigured: true, user: null };
    render(<ExerciseCatalogScreen />);
    fireEvent.press(await screen.findByLabelText('Chest exercises 1'));
    await openActions('Bench Press');

    expect(screen.getByLabelText('Edit exercise from actions')).toBeTruthy();
    expect(screen.queryByLabelText('Link to group exercise from actions')).toBeNull();
  });
});
