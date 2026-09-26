/* eslint-disable import/first */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert, StyleSheet, type AlertButton } from 'react-native';

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

// Signed out unless a test signs in: the ⋮ Link item is signed-in only.
let mockLinkingUserId: string | null = null;
jest.mock('@/src/groups/use-group-exercise-linking', () => ({
  ...jest.requireActual('@/src/groups/use-group-exercise-linking'),
  useGroupLinkingUserId: () => mockLinkingUserId,
}));

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
import { uiRoles } from '@/components/ui/tokens';
import type { ExerciseHistorySessionEntry } from '@/src/data/exercise-history';
import type {
  SessionDraftExerciseInput,
  SessionDraftSetSnapshot,
  SessionGraphSnapshot,
} from '@/src/data/session-drafts';
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
const createClient = (initial: SessionGraphSnapshot = makeSession()) => {
  let stored: SessionGraphSnapshot | null = initial;
  const store = (input: { exercises: SessionDraftExerciseInput[] }) => {
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
  };
  const client: SessionExerciseDraftClient = {
    loadSessionSnapshotById: jest.fn(async (id: string) =>
      stored && stored.sessionId === id ? stored : null
    ),
    persistSessionDraftSnapshot: jest.fn(async (input) => {
      store(input);
      return { sessionId: input.sessionId! };
    }),
    persistCompletedSessionSnapshot: jest.fn(async (input) => {
      store(input);
      stored = { ...stored!, startedAt: input.startedAt, completedAt: input.completedAt };
      return { sessionId: input.sessionId, completedAt: input.completedAt, durationSec: 0 };
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
    mockLinkingUserId = null;
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

  it('highlights only records: today\'s top set stays plain, a record weight and 1RM take `record`', async () => {
    const { client } = createClient();
    await renderPage(client);

    const styleOf = (element: ReturnType<typeof screen.getByTestId>) => StyleSheet.flatten(element.props.style);
    const figure = (row: number, column: '1rm' | 'vol', value: string) =>
      styleOf(within(screen.getByTestId(`exercise-set-${row}-${column}`)).getByText(value));

    // 80 × 8 is today's top weight, 1RM and volume, and ties the 1RM record: no emphasis.
    expect(styleOf(screen.getByTestId('exercise-set-2-values'))).toMatchObject({ fontWeight: '500' });
    expect(styleOf(screen.getByTestId('exercise-set-2-values')).color).not.toBe(uiRoles.record);
    expect(figure(2, '1rm', '102.1')).toMatchObject({ fontWeight: '500', color: uiRoles.ink });
    expect(figure(2, 'vol', '640')).toMatchObject({ fontWeight: '500', color: uiRoles.inkMuted });

    // 90 × 6 beats the 82.5 weight and 102.1 1RM records; its volume is never a record.
    fireEvent.changeText(screen.getByTestId('exercise-set-logger-weight'), '90');
    fireEvent.press(screen.getByTestId('exercise-set-logger-commit'));
    await waitFor(() => expect(screen.getByTestId('exercise-set-3-values')).toHaveTextContent('90.0 × 6'));

    expect(styleOf(screen.getByTestId('exercise-set-3-values'))).toMatchObject({
      fontWeight: '700',
      color: uiRoles.record,
    });
    expect(figure(3, '1rm', '108.3')).toMatchObject({ fontWeight: '700', color: uiRoles.record });
    expect(figure(3, 'vol', '540')).toMatchObject({ fontWeight: '500', color: uiRoles.inkMuted });
  });

  it('edits an exercise of a completed session, writing it back as completed with its times', async () => {
    const startedAt = new Date('2026-09-11T09:00:00Z');
    const completedAt = new Date('2026-09-11T10:00:00Z');
    // The session being edited is `h2` in the lifter's history; its own sets
    // must not be its records' baseline.
    const { client, stored } = createClient({
      ...makeSession(),
      sessionId: 'h2',
      status: 'completed',
      startedAt,
      completedAt,
      durationSec: 3600,
    });
    render(
      <ExercisePageScreen draftClient={client} loadHistory={loadHistory} sessionExerciseId="bench" sessionId="h2" />
    );
    await screen.findByTestId('exercise-page');
    // Without h2, the older h1 holds every record: 80 × 7 → 1RM 99.2, max 80.
    await waitFor(() => expect(screen.getByTestId('exercise-records-1rm')).toHaveTextContent('1RM99.2'));
    expect(screen.getByTestId('exercise-records-max')).toHaveTextContent('Max80.0');

    fireEvent.changeText(screen.getByTestId('exercise-set-logger-reps'), '5');
    fireEvent.press(screen.getByTestId('exercise-set-logger-commit'));

    await waitFor(() =>
      expect(benchSets(stored())[2]).toMatchObject({ weightValue: '82.5', repsValue: '5', performanceStatus: null })
    );
    expect(client.persistSessionDraftSnapshot).not.toHaveBeenCalled();
    expect(client.persistCompletedSessionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'h2', startedAt, completedAt })
    );
    expect(stored()?.status).toBe('completed');
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

  // Ported from the old recorder's persistence tests: typing waits for the
  // 3 s debounce, and leaving the page writes what is still pending.
  it('saves typed values after the debounce, and flushes pending typing when the page goes', async () => {
    const { client, stored } = createClient();
    await renderPage(client);
    jest.useFakeTimers();
    try {
      fireEvent.changeText(screen.getByTestId('exercise-set-logger-reps'), '4');
      await act(async () => {
        jest.advanceTimersByTime(2_900);
      });
      expect(client.persistSessionDraftSnapshot).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(200);
      });
      expect(benchSets(stored())[2]).toMatchObject({ repsValue: '4', performanceStatus: 'planned' });

      fireEvent.changeText(screen.getByTestId('exercise-set-logger-reps'), '3');
      screen.unmount();
      await act(async () => {
        await Promise.resolve();
      });
      expect(benchSets(stored())[2]).toMatchObject({ repsValue: '3', performanceStatus: 'planned' });
    } finally {
      jest.useRealTimers();
    }
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

    fireEvent(screen.getByTestId('exercise-set-logger-effort'), 'longPress');
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

  it('cycles effort in descending RIR order, including blank, and persists the selection', async () => {
    const { client, stored } = createClient();
    await renderPage(client);
    for (const label of ['RIR 0', 'W-Up', 'none', 'RIR 3', 'RIR 2', 'RIR 1']) {
      fireEvent.press(screen.getByTestId('exercise-set-logger-effort'));
      expect(screen.getByLabelText(`Change effort, currently ${label}`)).toBeTruthy();
    }
    fireEvent(screen.getByTestId('exercise-set-logger-effort'), 'longPress');
    fireEvent.press(await screen.findByTestId('exercise-effort-option-rir_3'));
    await waitFor(() => expect(benchSets(stored())[2].setType).toBe('rir_3'));
    fireEvent(screen.getByTestId('exercise-set-logger-effort'), 'longPress');
    fireEvent.press(await screen.findByTestId('exercise-effort-option-none'));
    expect(screen.getByLabelText('Change effort, currently none')).toBeTruthy();
    await waitFor(() => expect(benchSets(stored())[2].setType).toBeNull());
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

  it('offers Link to group exercise… in the ⋮ only when signed in, opening the Link screen', async () => {
    const { client } = createClient();
    await renderPage(client);

    fireEvent.press(screen.getByTestId('exercise-page-options'));
    const signedOut = await screen.findByTestId('exercise-options-sheet');
    expect(within(signedOut).queryByTestId('exercise-options-link-group')).toBeNull();
    fireEvent.press(screen.getByTestId('exercise-options-sheet-backdrop', { includeHiddenElements: true }));
    screen.unmount();

    mockLinkingUserId = 'user-1';
    await renderPage(client);
    fireEvent.press(screen.getByTestId('exercise-page-options'));
    const sheet = await screen.findByTestId('exercise-options-sheet');
    fireEvent.press(within(sheet).getByText('Link to group exercise…'));

    expect(mockRouter.push).toHaveBeenCalledWith('/exercise-link?exerciseDefinitionId=def-bench');
    expect(screen.queryByTestId('exercise-options-sheet')).toBeNull();
  });

  it('swaps the exercise and keeps its sets', async () => {
    const { client, stored } = createClient();
    await renderPage(client);

    fireEvent.press(screen.getByTestId('exercise-page-options'));
    fireEvent.press(await screen.findByTestId('exercise-options-swap'));
    const swap = await screen.findByTestId('exercise-swap-sheet');
    fireEvent.changeText(within(swap).getByLabelText('Search exercises'), 'Incline');
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
  it('opens the page for the route params', async () => {
    render(<ExercisePageRoute />);
    // The real repository is not wired in this suite, so the page shows its
    // loading or error state for `session-1` / `bench`.
    expect(await screen.findByTestId('exercise-page-state')).toBeTruthy();
  });
});
