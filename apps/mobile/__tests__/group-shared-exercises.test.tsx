/* eslint-disable import/first */

import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

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

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => callback(), [callback]);
  },
}));

jest.mock('@/src/groups/api', () => ({
  ...jest.requireActual('@/src/groups/api'),
  listGroupSharedExercises: jest.fn(),
  createGroupSharedExercise: jest.fn(),
  deleteGroupSharedExercise: jest.fn(),
}));

import * as groupsApi from '@/src/groups/api';
import type { LocalDatabase } from '@/src/data/bootstrap';
import { StreamSharedExerciseCard } from '@/components/groups/stream-shared-exercise-card';
import { GroupSharedExercisesList } from '@/components/groups/group-shared-exercises-list';
import { seedSystemExerciseCatalog } from '@/src/data/exercise-catalog-seeds';
import { __resetExerciseCatalogCacheForTests } from '@/src/exercise-catalog/cache';
import { linkExercise, listLinks } from '@/src/data/exercise-group-links';
import { saveExerciseCatalogExercise, listExerciseCatalogExercises } from '@/src/data/exercise-catalog';
import { setMuscleReportPreset, setMuscleTracked } from '@/src/data/muscle-report-settings';
import { invalidateExerciseCatalogCache } from '@/src/exercise-catalog/invalidation';
import type { CompetitionStreamSharedExerciseWire, GroupSharedExerciseItemWire } from '@/src/groups/competition-wire';

const SAMPLE_SHARED_ITEM: CompetitionStreamSharedExerciseWire = {
  kind: 'shared_exercise',
  key: 'shared_exercise:ev1',
  sort_at_ms: Date.now(),
  id: 'shared-ex-1',
  group_id: 'group-1',
  shared_by: { user_id: 'user-other', username: 'lifter_joe' },
  exercise: {
    group_exercise_id: 'ge-1',
    group_exercise_name: 'Bench Press (Competition)',
    name: 'Paused Bench Press',
    load_input_mode: 'total_load',
    bodyweight_contribution: 0,
    mappings: [{ muscle_group_id: 'chest', weight: 1, role: 'primary' }],
    created_at_ms: Date.now(),
  },
};

describe('StreamSharedExerciseCard', () => {
  beforeEach(async () => {
    fixture = createInMemoryDatabase();
    await seedSystemExerciseCatalog(fixture.database as unknown as LocalDatabase);
    __resetExerciseCatalogCacheForTests();
    jest.clearAllMocks();
  });

  afterEach(() => {
    fixture.close();
  });

  it('renders who shared the exercise, name, tags and handles direct add with linking', async () => {
    render(
      <StreamSharedExerciseCard
        item={SAMPLE_SHARED_ITEM}
        onAdded={jest.fn()}
        showGroupName={false}
        userId="user-me"
      />,
    );

    expect(screen.getByText('lifter_joe shared an exercise')).toBeTruthy();
    expect(screen.getByText('Paused Bench Press')).toBeTruthy();
    expect(screen.getByText('Leaderboard: Bench Press (Competition)')).toBeTruthy();

    const addBtn = screen.getByTestId('group-stream-shared-exercise-shared-ex-1-add-btn');
    await act(async () => {
      fireEvent.press(addBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('Added "Paused Bench Press" to your exercises.')).toBeTruthy();
    });

    // Verify it was created in SQLite and linked
    const exercises = await listExerciseCatalogExercises();
    const created = exercises.find((e) => e.name === 'Paused Bench Press');
    expect(created).toBeDefined();

    const links = await listLinks();
    const link = links.find((l) => l.groupId === 'group-1' && l.exerciseDefinitionId === created?.id);
    expect(link).toBeDefined();
    expect(link?.groupExerciseId).toBe('ge-1');
  });

  it('shows link option when an exercise with matching name already exists unlinked', async () => {
    // Save matching exercise in catalog
    const saved = await saveExerciseCatalogExercise({
      name: 'Paused Bench Press',
      loadInputMode: 'total_load',
      mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }],
    });

    render(
      <StreamSharedExerciseCard
        item={SAMPLE_SHARED_ITEM}
        onAdded={jest.fn()}
        showGroupName={false}
        userId="user-me"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('group-stream-shared-exercise-shared-ex-1-link-existing-btn')).toBeTruthy();
    });

    const linkBtn = screen.getByTestId('group-stream-shared-exercise-shared-ex-1-link-existing-btn');
    await act(async () => {
      fireEvent.press(linkBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('Linked "Paused Bench Press" to Bench Press (Competition).')).toBeTruthy();
    });

    const links = await listLinks();
    expect(links.some((l) => l.exerciseDefinitionId === saved.id && l.groupExerciseId === 'ge-1')).toBe(true);
  });

  it('does not offer linking and offers Add as new when matching exercise is already linked elsewhere in this group', async () => {
    // Save matching exercise in catalog and link it to a different comparison in this group
    const saved = await saveExerciseCatalogExercise({
      name: 'Paused Bench Press',
      loadInputMode: 'total_load',
      mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }],
    });
    await linkExercise(saved.id, 'group-1', 'ge-other');

    render(
      <StreamSharedExerciseCard
        item={SAMPLE_SHARED_ITEM}
        onAdded={jest.fn()}
        showGroupName={false}
        userId="user-me"
      />,
    );

    // Link existing button should NOT be rendered because it's already linked to ge-other
    await waitFor(() => {
      expect(screen.getByTestId('group-stream-shared-exercise-shared-ex-1-status-exists')).toBeTruthy();
    });
    expect(screen.queryByTestId('group-stream-shared-exercise-shared-ex-1-link-existing-btn')).toBeNull();

    // "Add as new" button should be offered
    const addNewBtn = screen.getByTestId('group-stream-shared-exercise-shared-ex-1-add-new-btn');
    expect(addNewBtn).toBeTruthy();

    await act(async () => {
      fireEvent.press(addNewBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('Added "Paused Bench Press" to your exercises.')).toBeTruthy();
    });

    // Verify existing exercise retained its link to ge-other and new exercise is linked to ge-1
    const links = await listLinks();
    expect(links.some((l) => l.exerciseDefinitionId === saved.id && l.groupExerciseId === 'ge-other')).toBe(true);
    const exercises = await listExerciseCatalogExercises();
    const created = exercises.find((e) => e.id !== saved.id && e.name === 'Paused Bench Press');
    expect(created).toBeDefined();
    expect(links.some((l) => l.exerciseDefinitionId === created?.id && l.groupExerciseId === 'ge-1')).toBe(true);
  });

  it('projects muscles through user muscle setup: merges broad entries and hides untracked muscles', async () => {
    // Set broad preset (merges 'chest' and 'serratus_anterior' into 'Chest') and untrack 'quads'
    await setMuscleReportPreset('broad');
    await setMuscleTracked(['quads'], false);
    await invalidateExerciseCatalogCache();

    const itemWithMultipleMuscles: CompetitionStreamSharedExerciseWire = {
      ...SAMPLE_SHARED_ITEM,
      id: 'shared-ex-muscles',
      exercise: {
        ...SAMPLE_SHARED_ITEM.exercise,
        mappings: [
          { muscle_group_id: 'chest', weight: 1, role: 'primary' },
          { muscle_group_id: 'serratus_anterior', weight: 0.5, role: 'secondary' },
          { muscle_group_id: 'quads', weight: 0.5, role: 'secondary' },
        ],
      },
    };

    render(
      <StreamSharedExerciseCard
        item={itemWithMultipleMuscles}
        onAdded={jest.fn()}
        showGroupName={false}
        userId="user-me"
      />,
    );

    await waitFor(() => {
      // 'Chest' should be shown once as the merged muscle pill
      expect(screen.getAllByText('Chest')).toHaveLength(1);
    });
    // Raw anatomy entry 'serratus_anterior' should not be shown
    expect(screen.queryByText('serratus_anterior')).toBeNull();
    expect(screen.queryByText('Serratus Anterior')).toBeNull();
    // Untracked 'quads' / 'Quads' should not be shown
    expect(screen.queryByText('Quads')).toBeNull();
    expect(screen.queryByText('quads')).toBeNull();
  });

  it('renders no actions and no redundant status tag when viewer is the author', async () => {
    // Save matching exercise in catalog as it naturally exists for the author
    await saveExerciseCatalogExercise({
      name: 'Paused Bench Press',
      loadInputMode: 'total_load',
      mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }],
    });

    render(
      <StreamSharedExerciseCard
        item={SAMPLE_SHARED_ITEM}
        onAdded={jest.fn()}
        showGroupName={false}
        userId="user-other" // Same as SAMPLE_SHARED_ITEM.shared_by.user_id
      />,
    );

    expect(screen.getByText('You shared an exercise')).toBeTruthy();
    expect(screen.getByText('Paused Bench Press')).toBeTruthy();

    // Author should see NO actions
    expect(screen.queryByTestId('group-stream-shared-exercise-shared-ex-1-add-btn')).toBeNull();
    expect(screen.queryByTestId('group-stream-shared-exercise-shared-ex-1-add-new-btn')).toBeNull();
    expect(screen.queryByTestId('group-stream-shared-exercise-shared-ex-1-link-existing-btn')).toBeNull();
    expect(screen.queryByTestId('group-stream-shared-exercise-shared-ex-1-customize-btn')).toBeNull();
    expect(screen.queryByTestId('group-stream-shared-exercise-shared-ex-1-status-exists')).toBeNull();
  });

  it('shows Already in your exercises and no Add button when matching exercise exists and there is no leaderboard', async () => {
    await saveExerciseCatalogExercise({
      name: 'Standalone Press',
      loadInputMode: 'total_load',
      mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }],
    });

    const itemWithoutLeaderboard: CompetitionStreamSharedExerciseWire = {
      ...SAMPLE_SHARED_ITEM,
      id: 'shared-standalone-1',
      exercise: {
        ...SAMPLE_SHARED_ITEM.exercise,
        name: 'Standalone Press',
        group_exercise_id: null,
        group_exercise_name: null,
      },
    };

    render(
      <StreamSharedExerciseCard
        item={itemWithoutLeaderboard}
        onAdded={jest.fn()}
        showGroupName={false}
        userId="user-me"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('group-stream-shared-exercise-shared-standalone-1-status-exists')).toBeTruthy();
    });

    // Should NOT offer "Add another" or "Add as new" or "Add to my exercises"
    expect(screen.queryByTestId('group-stream-shared-exercise-shared-standalone-1-add-btn')).toBeNull();
    expect(screen.queryByTestId('group-stream-shared-exercise-shared-standalone-1-add-new-btn')).toBeNull();
    expect(screen.queryByTestId('group-stream-shared-exercise-shared-standalone-1-add-another-btn')).toBeNull();
  });
});

describe('GroupSharedExercisesList', () => {
  const itemWire: GroupSharedExerciseItemWire = {
    id: SAMPLE_SHARED_ITEM.id,
    group_id: SAMPLE_SHARED_ITEM.group_id,
    shared_by: SAMPLE_SHARED_ITEM.shared_by,
    exercise: SAMPLE_SHARED_ITEM.exercise,
  };

  beforeEach(async () => {
    fixture = createInMemoryDatabase();
    await seedSystemExerciseCatalog(fixture.database as unknown as LocalDatabase);
    __resetExerciseCatalogCacheForTests();
    jest.clearAllMocks();

    (groupsApi.listGroupSharedExercises as jest.Mock).mockResolvedValue({
      contract_version: 4,
      group_id: 'group-1',
      shared_exercises: [itemWire],
    });
  });

  afterEach(() => {
    fixture.close();
  });

  it('renders shared exercises and handles share button to open picker', async () => {
    render(
      <GroupSharedExercisesList
        groupId="group-1"
        groupName="Powerlifting Club"
        myRole="member"
        offline={false}
        userId="user-me"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Paused Bench Press')).toBeTruthy();
    });

    // Open share picker
    const shareBtn = screen.getByTestId('group-shared-exercises-share-btn');
    fireEvent.press(shareBtn);

    expect(screen.getByTestId('group-share-exercise-sheet')).toBeTruthy();
  });

  it('allows owner or author to delete a shared exercise', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    (groupsApi.deleteGroupSharedExercise as jest.Mock).mockResolvedValue({
      contract_version: 4,
      group_id: 'group-1',
      shared_exercise_id: 'shared-ex-1',
      deleted: true,
    });

    render(
      <GroupSharedExercisesList
        groupId="group-1"
        groupName="Powerlifting Club"
        myRole="admin"
        offline={false}
        userId="user-me"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('group-shared-exercise-shared-ex-1-delete-btn')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('group-shared-exercise-shared-ex-1-delete-btn'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Remove shared exercise',
      expect.stringContaining('Paused Bench Press'),
      expect.any(Array),
    );

    const buttons = alertSpy.mock.calls[0][2];
    const confirmBtn = buttons?.find((b) => b.text === 'Remove');
    await act(async () => {
      confirmBtn?.onPress?.();
    });

    expect(groupsApi.deleteGroupSharedExercise).toHaveBeenCalledWith('group-1', 'shared-ex-1');
  });

  it('does not offer linking and offers Add as new when matching exercise is already linked to another comparison', async () => {
    const saved = await saveExerciseCatalogExercise({
      name: 'Paused Bench Press',
      loadInputMode: 'total_load',
      mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }],
    });
    await linkExercise(saved.id, 'group-1', 'ge-other');

    render(
      <GroupSharedExercisesList
        groupId="group-1"
        groupName="Powerlifting Club"
        myRole="member"
        offline={false}
        userId="user-me"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('group-shared-exercise-shared-ex-1-status-exists')).toBeTruthy();
    });
    expect(screen.queryByTestId('group-shared-exercise-shared-ex-1-link-btn')).toBeNull();

    const addNewBtn = screen.getByTestId('group-shared-exercise-shared-ex-1-add-new-btn');
    expect(addNewBtn).toBeTruthy();

    await act(async () => {
      fireEvent.press(addNewBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('Added "Paused Bench Press" to your exercises.')).toBeTruthy();
    });

    const links = await listLinks();
    expect(links.some((l) => l.exerciseDefinitionId === saved.id && l.groupExerciseId === 'ge-other')).toBe(true);
    const exercises = await listExerciseCatalogExercises();
    const created = exercises.find((e) => e.id !== saved.id && e.name === 'Paused Bench Press');
    expect(created).toBeDefined();
    expect(links.some((l) => l.exerciseDefinitionId === created?.id && l.groupExerciseId === 'ge-1')).toBe(true);
  });

  it('renders no actions and allows delete when viewer is the author', async () => {
    // Save matching exercise in catalog as it naturally exists for the author
    await saveExerciseCatalogExercise({
      name: 'Paused Bench Press',
      loadInputMode: 'total_load',
      mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }],
    });

    render(
      <GroupSharedExercisesList
        groupId="group-1"
        groupName="Powerlifting Club"
        myRole="member"
        offline={false}
        userId="user-other" // Same as itemWire.shared_by.user_id
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Paused Bench Press')).toBeTruthy();
    });

    // Header should say "You · ..."
    expect(screen.getByText(/You ·/)).toBeTruthy();

    // Author should see delete button (author can delete their own share)
    expect(screen.getByTestId('group-shared-exercise-shared-ex-1-delete-btn')).toBeTruthy();

    // Author should NOT see any import/add/link action buttons
    expect(screen.queryByTestId('group-shared-exercise-shared-ex-1-add-btn')).toBeNull();
    expect(screen.queryByTestId('group-shared-exercise-shared-ex-1-add-new-btn')).toBeNull();
    expect(screen.queryByTestId('group-shared-exercise-shared-ex-1-link-btn')).toBeNull();
    expect(screen.queryByTestId('group-shared-exercise-shared-ex-1-customize-btn')).toBeNull();
    expect(screen.queryByTestId('group-shared-exercise-shared-ex-1-status-exists')).toBeNull();
  });

  it('shows Already in your exercises and no Add button when matching exercise exists and there is no leaderboard', async () => {
    await saveExerciseCatalogExercise({
      name: 'Standalone Press',
      loadInputMode: 'total_load',
      mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }],
    });

    const standaloneWire: GroupSharedExerciseItemWire = {
      ...itemWire,
      id: 'shared-standalone-1',
      exercise: {
        ...itemWire.exercise,
        name: 'Standalone Press',
        group_exercise_id: null,
        group_exercise_name: null,
      },
    };

    (groupsApi.listGroupSharedExercises as jest.Mock).mockResolvedValue({
      contract_version: 4,
      group_id: 'group-1',
      shared_exercises: [standaloneWire],
    });

    render(
      <GroupSharedExercisesList
        groupId="group-1"
        groupName="Powerlifting Club"
        myRole="member"
        offline={false}
        userId="user-me"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('group-shared-exercise-shared-standalone-1-status-exists')).toBeTruthy();
    });

    // Should NOT offer "Add another" or "Add as new" or "Add to my exercises"
    expect(screen.queryByTestId('group-shared-exercise-shared-standalone-1-add-btn')).toBeNull();
    expect(screen.queryByTestId('group-shared-exercise-shared-standalone-1-add-new-btn')).toBeNull();
    expect(screen.queryByTestId('group-shared-exercise-shared-standalone-1-add-another-btn')).toBeNull();
  });
});
