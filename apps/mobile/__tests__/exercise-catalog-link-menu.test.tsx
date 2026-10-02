/* eslint-disable import/first */

/**
 * M25-T07 AC5 (catalogue half): the Exercise Catalog row ⋮ actions sheet
 * gains "Link to group exercise…", which pushes the Link screen for that
 * exercise. It is signed-in only, and disabled for a soft-deleted exercise
 * (card decision (b)).
 *
 * Over real data like exercise-catalog-screen.test.tsx: the starter catalogue
 * on the migrated in-memory SQLite database (helpers/local-data.ts), the
 * deleted exercise deleted through the catalogue's own write. Only the native
 * database open, the router and the auth snapshot are replaced.
 */

import * as mockReact from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => callback(), [callback]);
  },
}));

let mockAuthSnapshot: { isConfigured: boolean; user: { id: string } | null } = {
  isConfigured: true,
  user: { id: 'user-1' },
};
jest.mock('@/src/auth', () => ({
  getAuthSnapshot: () => mockAuthSnapshot,
  subscribeToAuthState: () => () => undefined,
}));

import ExerciseCatalogScreen from '../app/(tabs)/exercise-catalog';
import { deleteExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { __resetExerciseListPreferencesForTests } from '@/src/exercise-catalog/list-preferences';
import { bootLocalApp, closeLocalData, localDatabase, resetLocalData } from './helpers/local-data';

const openCatalog = async (prepare?: () => Promise<void>) => {
  localDatabase();
  await prepare?.();
  await bootLocalApp();
  render(<ExerciseCatalogScreen />);
  await screen.findByLabelText('Create new exercise');
  // Past the search debounce the screen arms at mount (150 ms), inside act.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 160));
  });
};

const expandChest = async () => {
  fireEvent.press(await screen.findByLabelText(/^Chest exercises \d+$/));
};

const openActions = async (name: string) => {
  fireEvent.press(await screen.findByLabelText(`Exercise actions ${name}`));
  // The actions sheet is titled with the exercise's name (DLM-T07).
  await screen.findByTestId('exercise-catalog-actions-sheet');
};

beforeEach(() => {
  resetLocalData();
  mockPush.mockReset();
  mockAuthSnapshot = { isConfigured: true, user: { id: 'user-1' } };
  __resetExerciseListPreferencesForTests();
});

afterEach(() => {
  closeLocalData();
});

describe('catalogue ⋮ Link to group exercise…', () => {
  it('pushes the Link screen for the exercise', async () => {
    await openCatalog();
    await expandChest();
    await openActions('Barbell Bench Press');

    fireEvent.press(screen.getByLabelText('Link to group exercise from actions'));

    expect(mockPush).toHaveBeenCalledWith('/exercise-link?exerciseDefinitionId=seed_barbell_bench_press');
    expect(screen.queryByTestId('exercise-catalog-actions-sheet')).toBeNull();
  });

  it('is disabled for a soft-deleted exercise', async () => {
    await openCatalog(() => deleteExerciseCatalogExercise('seed_barbell_bench_press'));
    fireEvent.press(await screen.findByLabelText('Exercise catalog options'));
    await screen.findByText('Manage exercises');
    fireEvent.press(screen.getByLabelText('Show deleted exercises'));
    // The Filters sheet's backdrop, hidden from VoiceOver while the sheet is modal.
    fireEvent.press(screen.getByLabelText('Close exercise management', { includeHiddenElements: true }));
    await expandChest();
    await openActions('Barbell Bench Press');

    const item = screen.getByLabelText('Link to group exercise from actions');
    expect(item).toBeDisabled();
    fireEvent.press(item);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('is absent while signed out', async () => {
    mockAuthSnapshot = { isConfigured: true, user: null };
    await openCatalog();
    await expandChest();
    await openActions('Barbell Bench Press');

    expect(screen.getByLabelText('Edit exercise from actions')).toBeTruthy();
    expect(screen.queryByLabelText('Link to group exercise from actions')).toBeNull();
  });
});
