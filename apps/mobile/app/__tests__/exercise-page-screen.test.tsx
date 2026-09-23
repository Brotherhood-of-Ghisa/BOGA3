/* eslint-disable import/first */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

const mockRouter = {
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
  push: jest.fn(),
  replace: jest.fn(),
};

jest.mock('expo-router', () => {
  const mockReact = jest.requireActual('react');
  return {
    useRouter: () => mockRouter,
    useNavigation: () => undefined,
    useLocalSearchParams: () => ({
      sessionId: 'session-1',
      sessionExerciseId: 'bench',
    }),
    useFocusEffect: (callback: () => void | (() => void)) => {
      mockReact.useEffect(() => callback(), [callback]);
    },
  };
});

jest.mock('@/src/exercise-catalog/cache', () => ({
  useExerciseCatalog: () => ({
    status: 'ready',
    exercises: [
      {
        id: 'def-bench',
        name: 'Barbell Bench Press',
        searchText: 'barbell bench press',
        deletedAt: null,
        mappings: [],
        loadInputMode: 'total_load',
      },
      {
        id: 'def-incline',
        name: 'Incline Bench Press',
        searchText: 'incline bench press',
        deletedAt: null,
        mappings: [],
        loadInputMode: 'total_load',
      },
    ],
    muscleGroups: [],
    lastError: null,
  }),
}));

jest.mock('@/src/exercise-catalog/stats-cache', () => ({
  useExerciseCatalogStats: () => ({
    status: 'ready',
    stats: {
      aggregatesById: new Map(),
      recencyScoresById: new Map(),
      everDoneIds: new Set(),
      lastCompletedAtById: new Map(),
    },
    rawHistory: null,
    lastError: null,
    reload: jest.fn(),
  }),
}));

import ExercisePageRoute from '@/app/session/[sessionId]/exercise/[sessionExerciseId]';
import { ExercisePageScreen } from '@/components/exercise-page/exercise-page-screen';
import {
  __resetNewScreensPreferenceForTests,
  setNewScreensEnabled,
} from '@/src/session-recorder/new-screens-preference';
import type { ExerciseHistorySessionEntry } from '@/src/data/exercise-history';
import type { SessionDraftSetSnapshot, SessionGraphSnapshot } from '@/src/data/session-drafts';
import type { SessionExerciseDraftClient } from '@/src/session-recorder/session-exercise-draft';
import type { LoadExerciseHistory } from '@/src/session-recorder/use-exercise-records';

const set = (
  id: string,
  values: Partial<SessionDraftSetSnapshot> & Pick<SessionDraftSetSnapshot, 'weightValue' | 'repsValue'>
): SessionDraftSetSnapshot => ({
  id,
  setType: null,
  performanceStatus: null,
  ...values,
});

const planned = (id: string, weight: string, reps: string, setType: SessionDraftSetSnapshot['setType']) =>
  set(id, {
    weightValue: '',
    repsValue: '',
    plannedWeightValue: weight,
    plannedRepsValue: reps,
    plannedSetType: setType,
    performanceStatus: 'planned',
  });

const makeSession = (): SessionGraphSnapshot => ({
  sessionId: 'session-1',
  gymId: null,
  status: 'active',
  startedAt: new Date('2026-09-23T09:00:00Z'),
  completedAt: null,
  durationSec: null,
  deletedAt: null,
  createdAt: new Date('2026-09-23T09:00:00Z'),
  updatedAt: new Date('2026-09-23T09:00:00Z'),
  exercises: [
    {
      id: 'bench',
      exerciseDefinitionId: 'def-bench',
      name: 'Barbell Bench Press',
      machineName: null,
      sets: [
        set('s1', { weightValue: '60', repsValue: '10', setType: 'warm_up' }),
        set('s2', { weightValue: '80', repsValue: '8', setType: 'rir_2' }),
        planned('s3', '82.5', '6', 'rir_1'),
        planned('s4', '82.5', '6', 'rir_1'),
        planned('s5', '85', '5', 'rir_0'),
      ],
    },
    {
      id: 'squat',
      exerciseDefinitionId: 'def-squat',
      name: 'Barbell Back Squat',
      machineName: null,
      sets: [set('q1', { weightValue: '100', repsValue: '5', setType: 'rir_2' })],
    },
  ],
});

// A fake repository holding one session graph, so the tests read back exactly
// what the page persisted.
const createClient = () => {
  let stored: SessionGraphSnapshot | null = makeSession();
  const client: SessionExerciseDraftClient = {
    loadSessionSnapshotById: jest.fn(async (id: string) =>
      stored && stored.sessionId === id ? stored : null
    ),
    persistSessionDraftSnapshot: jest.fn(async (input) => {
      stored = {
        ...stored!,
        exercises: input.exercises.map((exercise) => ({
          id: exercise.id!,
          exerciseDefinitionId: exercise.exerciseDefinitionId,
          name: exercise.name,
          machineName: exercise.machineName ?? null,
          sets: exercise.sets.map((draftSet) => ({
            id: draftSet.id!,
            weightValue: draftSet.weightValue,
            repsValue: draftSet.repsValue,
            setType: draftSet.setType ?? null,
            plannedWeightValue: draftSet.plannedWeightValue,
            plannedRepsValue: draftSet.plannedRepsValue,
            plannedSetType: draftSet.plannedSetType,
            performanceStatus: draftSet.performanceStatus,
          })),
        })),
      };
      return { sessionId: input.sessionId! };
    }),
  };
  return { client, stored: () => stored };
};

const historyEntry = (
  sessionId: string,
  completedAt: string,
  sets: [string, string, ExerciseHistorySessionEntry['sets'][number]['setType']][]
): ExerciseHistorySessionEntry => ({
  sessionId,
  sessionExerciseId: `${sessionId}-bench`,
  completedAt: new Date(completedAt),
  gymName: null,
  tagIds: [],
  sets: sets.map(([weightValue, repsValue, setType], index) => ({
    setId: `${sessionId}-${index}`,
    orderIndex: index,
    weightValue,
    repsValue,
    setType,
    isWorking: setType !== 'warm_up',
  })),
  workingSetCount: 0,
  estimatedOneRepMax: null,
  totalVolume: 0,
  topWeightSet: null,
});

const loadHistory: LoadExerciseHistory = jest.fn(async () => ({
  exerciseDefinitionId: 'def-bench',
  exerciseName: 'Barbell Bench Press',
  exerciseDeletedAt: null,
  period: 'all' as const,
  appliedTagDefinitionId: null,
  tagOptions: [],
  allTimeBest: { estimatedOneRepMax: null, topWeight: null },
  sessions: [
    historyEntry('h2', '2026-09-11T10:00:00Z', [
      ['60', '10', 'warm_up'],
      ['80', '8', 'rir_2'],
      ['80', '8', 'rir_1'],
      ['82.5', '6', 'rir_0'],
    ]),
    historyEntry('h1', '2026-08-12T10:00:00Z', [
      ['60', '8', 'warm_up'],
      ['80', '6', 'rir_2'],
      ['80', '6', 'rir_2'],
      ['80', '7', 'rir_1'],
      ['80', '7', 'rir_1'],
    ]),
  ],
}));

const benchSets = (stored: SessionGraphSnapshot | null) =>
  stored?.exercises.find((e) => e.id === 'bench')?.sets ?? [];

const renderPage = async (client: SessionExerciseDraftClient) => {
  render(
    <ExercisePageScreen
      draftClient={client}
      loadHistory={loadHistory}
      sessionExerciseId="bench"
      sessionId="session-1"
    />
  );
  await screen.findByTestId('exercise-page');
  await waitFor(() => expect(screen.getByTestId('exercise-records-1rm')).toHaveTextContent('1RM102.1'));
};

const pressAlertButton = (label: string) => {
  const call = jest.mocked(Alert.alert).mock.calls.at(-1);
  const button = (call?.[2] as AlertButton[] | undefined)?.find((candidate) => candidate.text === label);
  act(() => button?.onPress?.());
};

describe('ExercisePageScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  it('renders the V5-Quiet state: records collapsed, set list, logger on the current set', async () => {
    const { client } = createClient();
    await renderPage(client);

    expect(screen.getByTestId('exercise-page-title')).toHaveTextContent('Barbell Bench Press');
    expect(screen.getByTestId('exercise-records-max')).toHaveTextContent('Max82.5');
    expect(screen.getByTestId('exercise-records-vol')).toHaveTextContent('Vol2560');

    expect(screen.getByTestId('exercise-set-1-values')).toHaveTextContent('60.0 × 10');
    expect(screen.getByTestId('exercise-set-1-1rm')).toHaveTextContent('1RM80.8');
    expect(screen.getByTestId('exercise-set-2-toggle')).toHaveProp('accessibilityState', { checked: true });

    const logger = screen.getByTestId('exercise-set-logger');
    expect(within(logger).getByText('Set 3')).toBeTruthy();
    expect(screen.getByTestId('exercise-set-logger-weight')).toHaveProp('value', '82.5');
    expect(screen.getByTestId('exercise-set-logger-reps')).toHaveProp('value', '6');
    expect(screen.getByTestId('exercise-set-logger-effort')).toHaveTextContent('EffortRIR 1');
    expect(screen.getByTestId('exercise-set-logger-preview')).toHaveTextContent('1RM 99.3 · VOL 495');
    expect(screen.getByTestId('exercise-set-4-values')).toHaveTextContent('82.5 × 6');
  });

  it('logs the current set with the tick and moves the logger to the next one', async () => {
    const { client, stored } = createClient();
    await renderPage(client);

    fireEvent.changeText(screen.getByTestId('exercise-set-logger-reps'), '5');
    fireEvent.press(screen.getByTestId('exercise-set-logger-commit'));

    await waitFor(() =>
      expect(benchSets(stored())[2]).toMatchObject({
        weightValue: '82.5',
        repsValue: '5',
        setType: 'rir_1',
        performanceStatus: null,
      })
    );
    expect(stored()?.exercises.map((exercise) => exercise.id)).toEqual(['bench', 'squat']);
    expect(screen.getByTestId('exercise-set-3-values')).toHaveTextContent('82.5 × 5');
    expect(within(screen.getByTestId('exercise-set-logger')).getByText('Set 4')).toBeTruthy();
  });

  it('keeps the tick disabled until the values are a valid set', async () => {
    const { client } = createClient();
    await renderPage(client);

    fireEvent.changeText(screen.getByTestId('exercise-set-logger-reps'), '');
    const commit = screen.getByTestId('exercise-set-logger-commit');
    expect(commit).toHaveProp('accessibilityState', { disabled: true });
    fireEvent.press(commit);
    expect(client.persistSessionDraftSnapshot).not.toHaveBeenCalled();
  });

  it('picks an effort from the sheet', async () => {
    const { client, stored } = createClient();
    await renderPage(client);

    fireEvent.press(screen.getByTestId('exercise-set-logger-effort'));
    const sheet = await screen.findByTestId('exercise-effort-sheet');
    expect(within(sheet).getByTestId('exercise-effort-option-rir_1')).toHaveProp('accessibilityState', {
      selected: true,
      disabled: false,
    });
    fireEvent.press(within(sheet).getByTestId('exercise-effort-option-rir_0'));

    await waitFor(() =>
      expect(benchSets(stored())[2]).toMatchObject({
        setType: 'rir_0',
        performanceStatus: 'planned',
      })
    );
    expect(screen.getByTestId('exercise-set-logger-effort')).toHaveTextContent('EffortRIR 0');
  });

  it('shows Records and Last in the expanded records panel', async () => {
    const { client } = createClient();
    await renderPage(client);

    fireEvent.press(screen.getByTestId('exercise-records-toggle'));
    expect(screen.getByTestId('exercise-record-1rm')).toHaveTextContent('1RM102.111-09-2026 · 80.0 × 8');
    expect(screen.getByTestId('exercise-record-max')).toHaveTextContent('Max82.511-09-2026 · 6 reps');
    expect(screen.getByTestId('exercise-record-vol')).toHaveTextContent('Vol256012-08-2026 · 5 sets');

    fireEvent.press(screen.getByTestId('exercise-records-view-last'));
    const last = screen.getByTestId('exercise-records-last');
    expect(within(last).getByText('1RM 102.1 · VOL 2375')).toBeTruthy();
    expect(screen.getByTestId('exercise-records-last-set-3')).toHaveTextContent(/^RIR 082\.5 × 6/);

    fireEvent.press(screen.getByTestId('exercise-records-history'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/exercise-history',
      params: { exerciseDefinitionId: 'def-bench' },
    });
  });

  it('leaves the records panel collapsed or expanded when switching Records and Last', async () => {
    const { client } = createClient();
    await renderPage(client);

    // Collapsed: the row sums up Records, then Last, and stays collapsed.
    expect(screen.getByTestId('exercise-records-1rm')).toHaveTextContent('1RM102.1');
    expect(screen.getByTestId('exercise-records-max')).toHaveTextContent('Max82.5');
    expect(screen.getByTestId('exercise-records-vol')).toHaveTextContent('Vol2560');
    fireEvent.press(screen.getByTestId('exercise-records-view-last'));
    expect(screen.getByTestId('exercise-records-collapsed')).toBeTruthy();
    expect(screen.getByTestId('exercise-records-1rm')).toHaveTextContent('1RM102.1');
    expect(screen.getByTestId('exercise-records-max')).toHaveTextContent('Max82.5');
    expect(screen.getByTestId('exercise-records-vol')).toHaveTextContent('Vol2375');
    expect(screen.queryByTestId('exercise-records-last')).toBeNull();
    expect(screen.getByTestId('exercise-records-view-last')).toBeSelected();

    // Expanded: switching views keeps it expanded.
    fireEvent.press(screen.getByTestId('exercise-records-toggle'));
    expect(screen.getByTestId('exercise-records-last')).toBeTruthy();
    fireEvent.press(screen.getByTestId('exercise-records-view-records'));
    expect(screen.getByTestId('exercise-records-list')).toBeTruthy();
    fireEvent.press(screen.getByTestId('exercise-records-view-last'));
    expect(screen.getByTestId('exercise-records-last')).toBeTruthy();
    expect(screen.queryByTestId('exercise-records-collapsed')).toBeNull();
  });

  it('performs a planned set from its glyph and un-performs it again', async () => {
    const { client, stored } = createClient();
    await renderPage(client);

    fireEvent.press(screen.getByTestId('exercise-set-5-toggle'));
    await waitFor(() =>
      expect(benchSets(stored())[4]).toMatchObject({
        weightValue: '85',
        performanceStatus: null,
      })
    );
    fireEvent.press(screen.getByTestId('exercise-set-5-toggle'));
    await waitFor(() => expect(benchSets(stored())[4]?.performanceStatus).toBe('planned'));
  });

  it('adds a set copying the last one', async () => {
    const { client, stored } = createClient();
    await renderPage(client);

    fireEvent.press(screen.getByTestId('exercise-add-set'));
    await waitFor(() => expect(benchSets(stored())).toHaveLength(6));
    expect(benchSets(stored())[5]).toMatchObject({
      weightValue: '85',
      repsValue: '5',
      performanceStatus: 'unperformed',
    });
    expect(within(screen.getByTestId('exercise-set-logger')).getByText('Set 6')).toBeTruthy();
  });

  it('warns before Complete discards planned sets, marks them unperformed, then goes back', async () => {
    const { client, stored } = createClient();
    await renderPage(client);

    fireEvent.press(screen.getByTestId('exercise-complete'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Complete exercise?',
      '3 planned sets will be discarded.',
      expect.any(Array)
    );

    pressAlertButton('Cancel');
    expect(client.persistSessionDraftSnapshot).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('exercise-complete'));
    pressAlertButton('Complete');
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(benchSets(stored()).map((row) => row.performanceStatus ?? null)).toEqual([
      null,
      null,
      'unperformed',
      'unperformed',
      'unperformed',
    ]);
    expect(benchSets(stored())).toHaveLength(5);
  });

  it('goes back without touching set states', async () => {
    const { client } = createClient();
    await renderPage(client);

    fireEvent.press(screen.getByTestId('exercise-page-back'));
    expect(mockRouter.back).toHaveBeenCalled();
    expect(client.persistSessionDraftSnapshot).not.toHaveBeenCalled();
  });

  it('removes the exercise from the session after confirmation', async () => {
    const { client, stored } = createClient();
    await renderPage(client);

    fireEvent.press(screen.getByTestId('exercise-page-options'));
    const sheet = await screen.findByTestId('exercise-options-sheet');
    expect(within(sheet).getByText('Edit exercise')).toBeTruthy();
    expect(within(sheet).getByText('Swap exercise')).toBeTruthy();
    fireEvent.press(within(sheet).getByTestId('exercise-options-remove'));

    expect(Alert.alert).toHaveBeenCalledWith(
      'Remove from session?',
      'Barbell Bench Press and its 5 sets will be removed from this session.',
      expect.any(Array)
    );
    pressAlertButton('Remove');
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(stored()?.exercises.map((exercise) => exercise.id)).toEqual(['squat']);
  });

  it('swaps the exercise and keeps its sets', async () => {
    const { client, stored } = createClient();
    await renderPage(client);

    fireEvent.press(screen.getByTestId('exercise-page-options'));
    fireEvent.press(await screen.findByTestId('exercise-options-swap'));
    const swap = await screen.findByTestId('exercise-swap-sheet');
    fireEvent.press(within(swap).getByText('Incline Bench Press'));

    await waitFor(() =>
      expect(stored()?.exercises[0]).toMatchObject({
        exerciseDefinitionId: 'def-incline',
        name: 'Incline Bench Press',
      })
    );
    expect(benchSets(stored())).toHaveLength(5);
    expect(screen.getByTestId('exercise-page-title')).toHaveTextContent('Incline Bench Press');
  });

  it('says so when the exercise is no longer in the session', async () => {
    const { client } = createClient();
    render(
      <ExercisePageScreen
        draftClient={client}
        loadHistory={loadHistory}
        sessionExerciseId="gone"
        sessionId="session-1"
      />
    );
    expect(await screen.findByText('This exercise is no longer in the session.')).toBeTruthy();
  });
});

describe('exercise page route', () => {
  beforeEach(() => __resetNewScreensPreferenceForTests());

  it('stays behind the new-screens setting', async () => {
    render(<ExercisePageRoute />);
    expect(await screen.findByTestId('exercise-page-disabled')).toBeTruthy();
    fireEvent.press(screen.getByTestId('exercise-page-open-settings'));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings');
  });

  it('opens the page for the route params once the setting is on', async () => {
    await act(() => setNewScreensEnabled(true));
    render(<ExercisePageRoute />);
    expect(screen.queryByTestId('exercise-page-disabled')).toBeNull();
    // The real repository is not wired in this suite, so the page shows its
    // loading or error state for `session-1` / `bench` — not the notice.
    expect(await screen.findByTestId('exercise-page-state')).toBeTruthy();
  });
});
