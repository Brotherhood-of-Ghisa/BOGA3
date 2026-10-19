/* eslint-disable import/first */

import * as mockReact from 'react';
import { Alert, Share } from 'react-native';
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

jest.mock('@/src/groups/api', () => ({
  ...jest.requireActual('@/src/groups/api'),
  listMyGroups: jest.fn(),
}));

import * as groupsApi from '@/src/groups/api';
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
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 160));
  });
};

const expandChest = async () => {
  fireEvent.press(await screen.findByLabelText(/^Chest exercises \d+$/));
};

const openActions = async (name: string) => {
  fireEvent.press(await screen.findByLabelText(`Exercise actions ${name}`));
  await screen.findByTestId('exercise-catalog-actions-sheet');
};

const GROUP_A = {
  group_id: 'grp-a',
  name: 'Garage Gym',
  my_role: 'member' as const,
  member_count: 3,
};

const GROUP_B = {
  group_id: 'grp-b',
  name: 'Iron Club',
  my_role: 'admin' as const,
  member_count: 8,
};

beforeEach(() => {
  resetLocalData();
  mockPush.mockReset();
  mockAuthSnapshot = { isConfigured: true, user: { id: 'user-1' } };
  __resetExerciseListPreferencesForTests();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
  (groupsApi.listMyGroups as jest.Mock).mockResolvedValue({ groups: [GROUP_A] });
});

afterEach(() => {
  closeLocalData();
  jest.restoreAllMocks();
});

describe('catalogue ⋮ Share with group member…', () => {
  it('is disabled for a soft-deleted exercise', async () => {
    await openCatalog(() => deleteExerciseCatalogExercise('seed_barbell_bench_press'));
    fireEvent.press(await screen.findByLabelText('Exercise catalog options'));
    await screen.findByText('Manage exercises');
    fireEvent.press(screen.getByLabelText('Show deleted exercises'));
    fireEvent.press(screen.getByLabelText('Close exercise management', { includeHiddenElements: true }));
    await expandChest();
    await openActions('Barbell Bench Press');

    const item = screen.getByLabelText('Share exercise with group member from actions');
    expect(item.props.accessibilityState?.disabled).toBe(true);
  });

  it('alerts when user is not in any group', async () => {
    (groupsApi.listMyGroups as jest.Mock).mockResolvedValue({ groups: [] });
    await openCatalog();
    await expandChest();
    await openActions('Barbell Bench Press');

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Share exercise with group member from actions'));
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'No groups found',
      'You must be a member of a group to share an exercise with a member.'
    );
    expect(Share.share).not.toHaveBeenCalled();
  });

  it('shares directly when user belongs to exactly one group', async () => {
    (groupsApi.listMyGroups as jest.Mock).mockResolvedValue({ groups: [GROUP_A] });
    await openCatalog();
    await expandChest();
    await openActions('Barbell Bench Press');

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Share exercise with group member from actions'));
    });

    expect(Share.share).toHaveBeenCalledWith({
      message: expect.stringContaining('Check out the exercise "Barbell Bench Press" shared with "Garage Gym" on BOGA.\nboga3://exercise-share?groupId=grp-a&payload='),
    });
  });

  it('prompts group picker when user belongs to multiple groups, then shares', async () => {
    (groupsApi.listMyGroups as jest.Mock).mockResolvedValue({ groups: [GROUP_A, GROUP_B] });
    await openCatalog();
    await expandChest();
    await openActions('Barbell Bench Press');

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Share exercise with group member from actions'));
    });

    expect(await screen.findByTestId('exercise-share-group-sheet')).toBeTruthy();
    expect(screen.getByText('Share with group')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Share exercise with Iron Club'));
    });

    expect(Share.share).toHaveBeenCalledWith({
      message: expect.stringContaining('Check out the exercise "Barbell Bench Press" shared with "Iron Club" on BOGA.\nboga3://exercise-share?groupId=grp-b&payload='),
    });
  });
});
