/* eslint-disable import/first */

import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

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
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
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
}));

import * as groupsApi from '@/src/groups/api';
import { encodeExerciseSharePayload, type ExerciseSharePayload } from '@/src/exercise-share';
import * as exerciseCatalogData from '@/src/data/exercise-catalog';
import { seedSystemExerciseCatalog } from '@/src/data/exercise-catalog-seeds';
import { __resetExerciseCatalogCacheForTests } from '@/src/exercise-catalog/cache';
import type { LocalDatabase } from '@/src/data/bootstrap';
import ExerciseShareRoute from '../app/exercise-share';

const SAMPLE_PAYLOAD: ExerciseSharePayload = {
  v: 1,
  name: 'Bulgarian Split Squat',
  loadInputMode: 'per_side_load',
  bodyweightContribution: 0.5,
  mappings: [
    { muscleGroupId: 'quads', weight: 0.8, role: 'primary' },
    { muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
  ],
};

const VALID_GROUP_DETAIL = {
  group: {
    group_id: 'group-1',
    name: 'Garage Gym',
    description: 'Our garage gym',
    member_count: 5,
    my_role: 'member' as const,
    bodyweight_calculations_enabled: true,
  },
  members: [],
};

beforeEach(() => {
  fixture = createInMemoryDatabase();
  seedSystemExerciseCatalog(fixture.database as unknown as LocalDatabase);
  __resetExerciseCatalogCacheForTests();
  mockConnected = true;
  mockUseAuth.mockReturnValue({ isConfigured: true, user: { id: 'user-me' } });
  (groupsApi.getGroup as jest.Mock).mockResolvedValue(VALID_GROUP_DETAIL);
  mockParams = {
    groupId: 'group-1',
    payload: encodeExerciseSharePayload(SAMPLE_PAYLOAD),
  };
  jest.clearAllMocks();
});

afterEach(() => {
  fixture.close();
});

describe('ExerciseShareRoute', () => {
  it('renders sign-in gate when user is signed out or unconfigured', () => {
    mockUseAuth.mockReturnValue({ isConfigured: false, user: null });
    render(<ExerciseShareRoute />);
    expect(screen.getByTestId('groups-signed-out-state')).toBeTruthy();
  });

  it('renders invalid link view when params are missing', () => {
    mockParams = {};
    render(<ExerciseShareRoute />);
    expect(screen.getByTestId('exercise-share-invalid')).toBeTruthy();
  });

  it('renders corrupt data view when payload cannot be decoded', () => {
    mockParams = { groupId: 'group-1', payload: 'corrupt-payload' };
    render(<ExerciseShareRoute />);
    expect(screen.getByTestId('exercise-share-corrupt')).toBeTruthy();
  });

  it('renders membership required view when user is not a member of the group', async () => {
    (groupsApi.getGroup as jest.Mock).mockRejectedValue(
      new groupsApi.GroupApiError('NOT_FOUND', 'Group not found')
    );
    render(<ExerciseShareRoute />);

    expect(await screen.findByTestId('exercise-share-not-member')).toBeTruthy();
  });

  it('renders exercise preview when user is an active member', async () => {
    render(<ExerciseShareRoute />);

    expect(await screen.findByTestId('exercise-share-card')).toBeTruthy();
    expect(screen.getByTestId('exercise-share-title')).toHaveTextContent('Bulgarian Split Squat');
    expect(screen.getByTestId('exercise-share-group-eyebrow')).toHaveTextContent('Shared via Garage Gym');
    expect(screen.getByTestId('exercise-share-load-mode')).toHaveTextContent('Per side');
    expect(screen.getByTestId('exercise-share-bw')).toHaveTextContent('50% bodyweight');
    expect(screen.getByTestId('exercise-share-primary-muscles')).toHaveTextContent('Quads');
    expect(screen.getByTestId('exercise-share-secondary-muscles')).toHaveTextContent('Glute Max');
    expect(screen.getByTestId('exercise-share-save-btn')).toBeTruthy();
    expect(screen.getByTestId('exercise-share-customize-btn')).toBeTruthy();
  });

  it('saves the exercise directly when save button is pressed', async () => {
    const saveSpy = jest.spyOn(exerciseCatalogData, 'saveExerciseCatalogExercise');
    render(<ExerciseShareRoute />);

    expect(await screen.findByTestId('exercise-share-save-btn')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('exercise-share-save-btn'));
    });

    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Bulgarian Split Squat',
        loadInputMode: 'per_side_load',
        bodyweightContribution: 0.5,
      })
    );

    expect(await screen.findByTestId('exercise-share-feedback')).toHaveTextContent(
      '"Bulgarian Split Squat" was added to your exercises.'
    );
    expect(screen.getByTestId('exercise-share-view-catalog-btn')).toBeTruthy();

    fireEvent.press(screen.getByTestId('exercise-share-view-catalog-btn'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/exercise-catalog');
  });

  it('resets import state when link parameters change', async () => {
    const { rerender } = render(<ExerciseShareRoute />);

    expect(await screen.findByTestId('exercise-share-card')).toBeTruthy();
    expect(screen.getByTestId('exercise-share-title')).toHaveTextContent('Bulgarian Split Squat');

    await act(async () => {
      fireEvent.press(screen.getByTestId('exercise-share-save-btn'));
    });

    expect(await screen.findByTestId('exercise-share-feedback')).toBeTruthy();
    expect(screen.getByTestId('exercise-share-view-catalog-btn')).toBeTruthy();

    const secondPayload: ExerciseSharePayload = {
      v: 1,
      name: 'Romanian Deadlift',
      loadInputMode: 'total_load',
      bodyweightContribution: 0,
      mappings: [{ muscleGroupId: 'hamstrings', weight: 1.0, role: 'primary' }],
    };

    mockParams = {
      groupId: 'group-1',
      payload: encodeExerciseSharePayload(secondPayload),
    };

    rerender(<ExerciseShareRoute />);

    expect(await screen.findByTestId('exercise-share-title')).toHaveTextContent('Romanian Deadlift');
    expect(screen.queryByTestId('exercise-share-feedback')).toBeNull();
    expect(screen.queryByTestId('exercise-share-view-catalog-btn')).toBeNull();
    expect(screen.getByTestId('exercise-share-save-btn')).toBeTruthy();
  });

  it('renders offline state when offline without cached group data', async () => {
    mockConnected = false;
    (groupsApi.getGroup as jest.Mock).mockRejectedValue(
      new groupsApi.GroupApiError('NETWORK', 'Network request failed.')
    );
    render(<ExerciseShareRoute />);

    expect(await screen.findByTestId('exercise-share-offline-empty-state')).toBeTruthy();
    expect(screen.getByText("You're offline")).toBeTruthy();
    expect(screen.getByText("This loads when you're back online.")).toBeTruthy();
  });

  it('renders error state and allows retry on network/internal failure', async () => {
    (groupsApi.getGroup as jest.Mock).mockRejectedValueOnce(
      new groupsApi.GroupApiError('INTERNAL', 'Server error')
    );
    render(<ExerciseShareRoute />);

    expect(await screen.findByTestId('exercise-share-error-state')).toBeTruthy();
    expect(screen.getByText("Couldn't load this")).toBeTruthy();
    expect(screen.getByTestId('exercise-share-error-state-retry')).toBeTruthy();

    (groupsApi.getGroup as jest.Mock).mockResolvedValue(VALID_GROUP_DETAIL);

    await act(async () => {
      fireEvent.press(screen.getByTestId('exercise-share-error-state-retry'));
    });

    expect(await screen.findByTestId('exercise-share-card')).toBeTruthy();
  });

  it('renders update required state when client is incompatible', async () => {
    (groupsApi.getGroup as jest.Mock).mockRejectedValue(
      new groupsApi.GroupApiError('UPDATE_REQUIRED', 'Upgrade app')
    );
    render(<ExerciseShareRoute />);

    expect(await screen.findByTestId('exercise-share-error-state')).toBeTruthy();
    expect(screen.getByText('Group comparisons unavailable')).toBeTruthy();
  });

  it('displays duplicate notice without explanatory text and uses "Add another exercise" label', async () => {
    render(<ExerciseShareRoute />);

    expect(await screen.findByTestId('exercise-share-exists-notice')).toHaveTextContent(
      'You already have an active exercise named "Bulgarian Split Squat".'
    );
    expect(screen.queryByText(/Adding this will create another definition/)).toBeNull();
    expect(screen.getByTestId('exercise-share-save-btn')).toHaveTextContent('Add another exercise');
  });

  it('uses "Add to my exercises" label and omits duplicate notice when exercise is novel', async () => {
    const novelPayload: ExerciseSharePayload = {
      v: 1,
      name: 'Completely Novel Exercise 999',
      loadInputMode: 'total_load',
      bodyweightContribution: 0,
      mappings: [{ muscleGroupId: 'quads', weight: 1.0, role: 'primary' }],
    };
    mockParams = {
      groupId: 'group-1',
      payload: encodeExerciseSharePayload(novelPayload),
    };

    render(<ExerciseShareRoute />);

    expect(await screen.findByTestId('exercise-share-card')).toBeTruthy();
    expect(screen.queryByTestId('exercise-share-exists-notice')).toBeNull();
    expect(screen.getByTestId('exercise-share-save-btn')).toHaveTextContent('Add to my exercises');
  });

  it('opens customize modal when "Customize and add…" is pressed', async () => {
    render(<ExerciseShareRoute />);

    expect(await screen.findByTestId('exercise-share-customize-btn')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('exercise-share-customize-btn'));
    });

    expect(screen.getByTestId('exercise-editor-name-input')).toBeTruthy();
  });
});
