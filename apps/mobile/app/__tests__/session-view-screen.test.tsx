/* eslint-disable import/first */

/**
 * The session view over real data: the production screen, session lifecycle,
 * draft repository, gym directory, exercise picker and catalog caches over the
 * migrated in-memory SQLite database, seeded through the Maestro harness with
 * the `session-view` fixture (helpers/local-data.ts): an active session at the
 * block-history gym (Bench 3/5 with a new 1RM record, Incline 3/3, Cable Flys
 * 0/3) over the block-history fixture's completed sessions. Every write is
 * read back from the database.
 *
 * Replaced: the native database open, the router and navigation, the console
 * logger, and the GPS read (the simulator cannot fake a location). Two states
 * real data cannot produce are forced with `jest.spyOn` on the real module and
 * named in their tests: a failed comparison-history read and a failed draft
 * read.
 */

import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { eq } from 'drizzle-orm';
import { Alert } from 'react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockDismissTo = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);
const mockNavigation = {
  addListener: jest.fn((_event: string, _listener: (event: unknown) => void) => () => undefined),
  dispatch: jest.fn(),
};
// Every mounted focus callback, so a test can play "the screen came back".
const mockFocusCallbacks = new Set<() => void | (() => void)>();

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => {
      mockFocusCallbacks.add(callback);
      const cleanup = callback();
      return () => {
        mockFocusCallbacks.delete(callback);
        if (typeof cleanup === 'function') cleanup();
      };
    }, [callback]);
  },
  useLocalSearchParams: () => ({}),
  useNavigation: () => mockNavigation,
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    dismissTo: mockDismissTo,
    back: mockBack,
    canGoBack: mockCanGoBack,
  }),
}));

// Console only: adding an exercise logs an info event.
jest.mock('@/src/logging', () => ({ logEvent: jest.fn().mockResolvedValue(undefined) }));

// The GPS read: quiet (denied) unless a test says otherwise.
jest.mock('@/src/location/foreground-location-lazy', () => ({
  getCurrentForegroundPositionLazy: jest.fn(),
}));

// Signed out: the picker's group rows are signed-in only.
jest.mock('@/src/groups/use-group-exercise-linking', () => ({
  ...jest.requireActual('@/src/groups/use-group-exercise-linking'),
  useGroupLinkingUserId: () => null,
}));

import { SessionViewScreen } from '../session/[sessionId]/index';
import { ExercisePageScreen } from '@/components/exercise-page/exercise-page-screen';
import { upsertLocalGym, setLocalGymArchived } from '@/src/data/local-gyms';
import { gyms, sessions } from '@/src/data/schema';
import * as sessionDrafts from '@/src/data/session-drafts';
import { setSessionDeletedState } from '@/src/data/session-list';
import { EXERCISE_BLOCK_HISTORY_FIXTURE } from '@/src/maestro/exercise-block-history-fixture';
import { SESSION_VIEW_FIXTURE } from '@/src/maestro/session-view-fixture';
import * as insightsRepository from '@/src/session-insights/repository';
import {
  bootLocalApp,
  closeLocalData,
  loadMaestroFixture,
  localDatabase,
  resetLocalData,
} from './helpers/local-data';

const location = jest.requireMock('@/src/location/foreground-location-lazy') as {
  getCurrentForegroundPositionLazy: jest.Mock;
};

const SESSION = SESSION_VIEW_FIXTURE.sessionId;
const BENCH = SESSION_VIEW_FIXTURE.benchExerciseId;
const FLY = SESSION_VIEW_FIXTURE.flyExerciseId;
const FIXTURE_GYM = EXERCISE_BLOCK_HISTORY_FIXTURE.gymId;
const BENCH_LABEL = 'Barbell Bench Press, 3 of 5 sets done, new 1RM record 204.3';
const FLY_LABEL = 'Cable Flys, 0 of 3 sets done';

const HARBOUR = { latitude: 51.5, longitude: -0.12 };

const positionAt = (coordinates: { latitude: number; longitude: number }, accuracyM = 20) => ({
  status: 'success',
  position: { ...coordinates, accuracyM, capturedAt: new Date() },
});

const located = (coordinates: { latitude: number; longitude: number }) => ({
  ...coordinates,
  accuracyM: 10,
  updatedAt: new Date('2026-09-01T10:00:00Z'),
});

const readSession = (sessionId: string) => sessionDrafts.loadSessionSnapshotById(sessionId);
const exerciseNames = async (sessionId: string) =>
  ((await readSession(sessionId))?.exercises ?? []).map((exercise) => exercise.name);
const setIds = async (sessionId: string, exerciseId: string) =>
  ((await readSession(sessionId))?.exercises.find((exercise) => exercise.id === exerciseId)?.sets ?? []).map(
    (row) => row.id
  );
const sessionRow = (sessionId: string) =>
  localDatabase().select().from(sessions).where(eq(sessions.id, sessionId)).get();

// Answers each Alert with the button labelled `answer`, recording the titles.
const answerAlerts = (answer: (title: string) => string) => {
  const titles: string[] = [];
  jest.spyOn(Alert, 'alert').mockImplementation((title, _message, buttons) => {
    titles.push(title);
    const choice = answer(title);
    buttons?.find((button) => button.text === choice)?.onPress?.();
  });
  return titles;
};

const replayFocus = () =>
  act(async () => {
    mockFocusCallbacks.forEach((callback) => callback());
  });

const seed = async (prepare?: () => Promise<void> | void) => {
  await loadMaestroFixture('session-view');
  await prepare?.();
  await bootLocalApp();
};

const openGymSheet = async () => {
  await act(async () => {
    fireEvent.press(screen.getByTestId('session-view-summary-gym-button'));
  });
};

// The real picker: find the exercise, open its preselection, add one empty set.
const addExerciseThroughPicker = async (name: string) => {
  fireEvent.press(screen.getByTestId('session-view-add-exercise'));
  fireEvent.changeText(await screen.findByLabelText('Exercise filter input'), name);
  fireEvent.press(await screen.findByLabelText(`Select exercise ${name}`));
  const addEmptySet = await screen.findByLabelText(`Add empty set for ${name}`);
  await act(async () => {
    fireEvent.press(addEmptySet);
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  resetLocalData();
  mockFocusCallbacks.clear();
  mockCanGoBack.mockReturnValue(true);
  location.getCurrentForegroundPositionLazy.mockResolvedValue({ status: 'permission_denied', canAskAgain: true });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  closeLocalData();
});

describe('Session view', () => {
  const renderReady = async () => {
    render(<SessionViewScreen sessionId={SESSION} />);
    await screen.findByLabelText(BENCH_LABEL);
  };

  const openSession = async (prepare?: () => Promise<void> | void) => {
    await seed(prepare);
    await renderReady();
  };

  it('shows the summary and one read-only card per exercise, with its record band', async () => {
    await openSession();

    expect(screen.getByTestId('session-view-summary-gym-button')).toHaveProp(
      'accessibilityLabel',
      `Gym ${SESSION_VIEW_FIXTURE.gymName}`
    );
    expect(screen.getByLabelText(`Sets ${SESSION_VIEW_FIXTURE.performedSetCount}`)).toBeTruthy();
    expect(screen.getByLabelText('Volume 4200')).toBeTruthy();
    expect(screen.getByTestId(`session-view-exercise-${BENCH}-record`)).toBeTruthy();
    // Incline has no history, so no record; Cable Flys has nothing done.
    expect(screen.getByLabelText('Incline Dumbbell Press, 3 of 3 sets done')).toBeTruthy();
    expect(screen.getByLabelText(FLY_LABEL)).toBeTruthy();
    expect(screen.queryByTestId(`session-view-exercise-${FLY}-record`)).toBeNull();
    // Mini legends label every metric column.
    expect(screen.getAllByText('1RM').length).toBeGreaterThan(0);
  });

  it('compares the session with its exercise and muscle history', async () => {
    await openSession();

    await screen.findByText(/above median/);
    expect(screen.getByLabelText(/Barbell Bench Press, 3 sets · 2 working.*Historical median/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('session-insight-mode-muscle'));
    expect(screen.getByLabelText(/Chest, .* sets · .* working.*Historical median/)).toBeTruthy();
  });

  it('keeps logging usable when the comparison-history read fails (a failed read)', async () => {
    jest
      .spyOn(insightsRepository, 'loadSessionInsightHistory')
      .mockRejectedValueOnce(new Error('History read failed'));
    await openSession();

    await screen.findByText('Comparisons unavailable. Return to this session to retry.');
    fireEvent.press(screen.getByLabelText(FLY_LABEL));
    expect(mockPush).toHaveBeenCalledWith(`/session/${SESSION}/exercise/${FLY}`);
    expect(screen.queryByText('No comparison history yet')).toBeNull();
  });

  it('links each card to its exercise page', async () => {
    await openSession();

    fireEvent.press(screen.getByLabelText(FLY_LABEL));

    expect(mockPush).toHaveBeenCalledWith(`/session/${SESSION}/exercise/${FLY}`);
  });

  it('finishes through the cleanup prompts, completing the session with its done sets only', async () => {
    const titles = answerAlerts((title) =>
      title.startsWith('Remove exercises') ? 'Remove empty exercises and submit' : 'unexpected'
    );
    await openSession();
    const before = await readSession(SESSION);

    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-finish-button'));
    });

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(`/completed-session/${SESSION}?presentation=completion`)
    );
    expect(titles).toEqual(['Remove exercises with no sets and submit?']);
    const after = await readSession(SESSION);
    expect(after).toMatchObject({ status: 'completed', gymId: FIXTURE_GYM, startedAt: before!.startedAt });
    expect(after!.completedAt).toBeInstanceOf(Date);
    // Done sets only, planned rows and the all-planned exercise dropped.
    expect(after!.exercises.map((exercise) => exercise.name)).toEqual([
      'Barbell Bench Press',
      'Incline Dumbbell Press',
    ]);
    expect(after!.exercises[0].sets.map((row) => row.id)).toEqual([
      'maestro_session_view_bench_1',
      'maestro_session_view_bench_2',
      'maestro_session_view_bench_3',
    ]);
    expect(after!.exercises[0].sets.every((row) => row.performanceStatus === null)).toBe(true);
  });

  it('writes nothing when a finish prompt is declined', async () => {
    answerAlerts(() => 'Go back to edit session');
    await openSession();
    const before = await readSession(SESSION);

    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-finish-button'));
    });

    expect(await readSession(SESSION)).toEqual(before);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('abandons only after the destructive confirmation, then returns to Train', async () => {
    let answer = 'Keep session';
    const titles = answerAlerts(() => answer);
    await openSession();

    fireEvent.press(screen.getByTestId('session-view-options-button'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-abandon'));
    });
    expect(titles).toEqual(['Abandon session?']);
    expect(sessionRow(SESSION)?.deletedAt).toBeNull();

    answer = 'Abandon';
    fireEvent.press(screen.getByTestId('session-view-options-button'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-abandon'));
    });
    expect(sessionRow(SESSION)?.deletedAt).toBeInstanceOf(Date);
    expect(await sessionDrafts.loadLatestSessionDraftSnapshot()).toBeNull();
    expect(mockDismissTo).toHaveBeenCalledWith('/train');
  });

  it('adds an exercise from the picker with one empty set, leaving the rest as they were', async () => {
    await openSession();
    const benchBefore = await setIds(SESSION, BENCH);

    await addExerciseThroughPicker(EXERCISE_BLOCK_HISTORY_FIXTURE.noHistoryExerciseName);

    expect(await exerciseNames(SESSION)).toEqual([
      'Barbell Bench Press',
      'Incline Dumbbell Press',
      'Cable Flys',
      'Lat Pulldown',
    ]);
    const added = (await readSession(SESSION))!.exercises[3];
    expect(added.exerciseDefinitionId).toBe(EXERCISE_BLOCK_HISTORY_FIXTURE.noHistoryExerciseId);
    expect(added.sets).toHaveLength(1);
    expect(added.sets[0]).toMatchObject({ repsValue: '', weightValue: '', performanceStatus: 'unperformed' });
    expect(await setIds(SESSION, BENCH)).toEqual(benchBefore);
    expect(await screen.findByLabelText('Lat Pulldown, 0 of 1 sets done')).toBeTruthy();
  });

  it("opens the catalogue from the picker's Manage and shows the picker again on return", async () => {
    await openSession();

    fireEvent.press(screen.getByTestId('session-view-add-exercise'));
    fireEvent.press(await screen.findByTestId('exercise-picker-manage-button'));

    expect(mockPush).toHaveBeenCalledWith('/exercise-catalog?source=session&intent=manage');
    expect(screen.queryByTestId('exercise-picker-search')).toBeNull();

    await replayFocus();
    expect(await screen.findByTestId('exercise-picker-search')).toBeTruthy();
  });

  it('picks the gym from the gym sheet by tapping the Gym stat', async () => {
    await openSession(() => upsertLocalGym({ id: 'gym-harbour', name: 'Harbour Barbell' }));
    const benchBefore = await setIds(SESSION, BENCH);

    await openGymSheet();
    // No gym, the seeded gyms, then the local ones; the current one marked.
    expect(screen.getByTestId('session-view-gym-option-none')).toBeTruthy();
    expect(screen.getByTestId('session-view-gym-option-downtown-iron-temple')).toBeTruthy();
    expect(screen.getByTestId(`session-view-gym-option-${FIXTURE_GYM}`)).toBeSelected();

    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-gym-option-gym-harbour'));
    });

    expect(await readSession(SESSION)).toMatchObject({ gymId: 'gym-harbour', status: 'active' });
    expect(await setIds(SESSION, BENCH)).toEqual(benchBefore);
    expect(screen.getByTestId('session-view-summary-gym-button')).toHaveProp('accessibilityLabel', 'Gym Harbour Barbell');
  });

  it('writes a seeded gym on first pick', async () => {
    await openSession();

    await openGymSheet();
    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-gym-option-westside-barbell-club'));
    });

    expect(localDatabase().select().from(gyms).where(eq(gyms.id, 'westside-barbell-club')).get()).toMatchObject({
      name: 'Westside Barbell Club',
    });
    expect(sessionRow(SESSION)?.gymId).toBe('westside-barbell-club');
  });

  it('clears the gym with No gym', async () => {
    await openSession();

    await openGymSheet();
    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-gym-option-none'));
    });

    expect(sessionRow(SESSION)?.gymId).toBeNull();
  });

  it('suggests the one nearby gym as the first row, and selects it only when tapped', async () => {
    location.getCurrentForegroundPositionLazy.mockResolvedValue(positionAt(HARBOUR));
    await openSession(() =>
      upsertLocalGym({ id: 'gym-harbour', name: 'Harbour Barbell', coordinates: located(HARBOUR) })
    );

    await openGymSheet();

    const suggestion = await screen.findByTestId('session-view-gym-suggestion');
    expect(screen.getByText('Nearby · Harbour Barbell')).toBeTruthy();
    // Suggest only: nothing is written until the lifter taps it.
    expect(sessionRow(SESSION)?.gymId).toBe(FIXTURE_GYM);
    expect(screen.getByTestId(`session-view-gym-option-${FIXTURE_GYM}`)).toBeSelected();

    await act(async () => {
      fireEvent.press(suggestion);
    });

    expect(sessionRow(SESSION)?.gymId).toBe('gym-harbour');
    expect(screen.queryByTestId('session-view-gym-sheet')).toBeNull();
  });

  it.each([
    ['permission denial', () => ({ status: 'permission_denied', canAskAgain: false })],
    ['services off', () => ({ status: 'unavailable', reason: 'services_disabled' })],
    ['a read failure', () => ({ status: 'read_failure', error: new Error('gps') })],
    ['low accuracy', () => positionAt(HARBOUR, 140)],
    ['no gym in range', () => positionAt({ latitude: 48.85, longitude: 2.35 })],
  ])('shows no suggestion row on %s', async (_case, result) => {
    location.getCurrentForegroundPositionLazy.mockResolvedValue(result());
    await openSession(() =>
      upsertLocalGym({ id: 'gym-harbour', name: 'Harbour Barbell', coordinates: located(HARBOUR) })
    );

    await openGymSheet();
    await act(async () => {});

    expect(location.getCurrentForegroundPositionLazy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('session-view-gym-option-gym-harbour')).toBeTruthy();
    expect(screen.queryByTestId('session-view-gym-suggestion')).toBeNull();
  });

  it('shows no suggestion row when two gyms tie, or when no gym has a location', async () => {
    location.getCurrentForegroundPositionLazy.mockResolvedValue(positionAt(HARBOUR));
    await openSession(async () => {
      await upsertLocalGym({ id: 'gym-harbour', name: 'Harbour Barbell', coordinates: located(HARBOUR) });
      await upsertLocalGym({
        id: 'gym-iron',
        name: 'Iron Works',
        coordinates: located({ latitude: 51.5001, longitude: -0.12 }),
      });
    });

    await openGymSheet();
    await act(async () => {});
    expect(screen.getByTestId('session-view-gym-option-gym-iron')).toBeTruthy();
    expect(screen.queryByTestId('session-view-gym-suggestion')).toBeNull();

    fireEvent.press(screen.getByTestId('session-view-gym-sheet-backdrop', { includeHiddenElements: true }));
    await upsertLocalGym({ id: 'gym-harbour', name: 'Harbour Barbell', coordinates: null });
    await upsertLocalGym({ id: 'gym-iron', name: 'Iron Works', coordinates: null });
    await openGymSheet();
    await act(async () => {});
    expect(screen.getByTestId('session-view-gym-option-gym-harbour')).toBeTruthy();
    expect(screen.queryByTestId('session-view-gym-suggestion')).toBeNull();
  });

  it('gives up on the suggestion after 1.5 s without a fix, leaving the list usable', async () => {
    let resolveFix: (value: unknown) => void = () => undefined;
    location.getCurrentForegroundPositionLazy.mockReturnValue(new Promise((resolve) => (resolveFix = resolve)));
    await openSession(() =>
      upsertLocalGym({ id: 'gym-harbour', name: 'Harbour Barbell', coordinates: located(HARBOUR) })
    );
    jest.useFakeTimers();

    await openGymSheet();
    expect(await screen.findByTestId('session-view-gym-option-gym-harbour')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    // A fix arriving after the budget is dropped.
    await act(async () => {
      resolveFix(positionAt(HARBOUR));
    });

    expect(screen.queryByTestId('session-view-gym-suggestion')).toBeNull();
  });

  it('does not suggest the gym the session already has', async () => {
    location.getCurrentForegroundPositionLazy.mockResolvedValue(positionAt(HARBOUR));
    await openSession(() => upsertLocalGym({ id: FIXTURE_GYM, name: SESSION_VIEW_FIXTURE.gymName, coordinates: located(HARBOUR) }));

    await openGymSheet();
    await act(async () => {});

    expect(screen.getByTestId(`session-view-gym-option-${FIXTURE_GYM}`)).toBeSelected();
    expect(screen.queryByTestId('session-view-gym-suggestion')).toBeNull();
  });

  it('leaves archived gyms out of the sheet, seeded ones included', async () => {
    location.getCurrentForegroundPositionLazy.mockResolvedValue(positionAt(HARBOUR));
    await openSession(async () => {
      await upsertLocalGym({ id: 'downtown-iron-temple', name: 'Downtown Iron Temple' });
      await setLocalGymArchived({ id: 'downtown-iron-temple', archived: true });
      await upsertLocalGym({ id: 'gym-garage', name: 'Old Garage', coordinates: located(HARBOUR) });
      await setLocalGymArchived({ id: 'gym-garage', archived: true });
    });

    await openGymSheet();
    await act(async () => {});

    expect(screen.getByTestId('session-view-gym-option-westside-barbell-club')).toBeTruthy();
    expect(screen.queryByTestId('session-view-gym-option-downtown-iron-temple')).toBeNull();
    expect(screen.queryByTestId('session-view-gym-option-gym-garage')).toBeNull();
    // An archived gym is never suggested either.
    expect(screen.queryByTestId('session-view-gym-suggestion')).toBeNull();
  });

  it('opens the Gyms screen from Manage gyms and reopens the sheet, reloaded, on return', async () => {
    await openSession();

    await openGymSheet();
    fireEvent.press(screen.getByTestId('session-view-gym-manage'));

    expect(mockPush).toHaveBeenCalledWith('/gyms');
    expect(screen.queryByTestId('session-view-gym-sheet')).toBeNull();

    // Added on the Gyms screen.
    await upsertLocalGym({ id: 'gym-canal', name: 'Canal Street Gym' });
    await replayFocus();

    expect(screen.getByTestId('session-view-gym-sheet')).toBeTruthy();
    expect(await screen.findByTestId('session-view-gym-option-gym-canal')).toBeTruthy();

    // A later return with the sheet closed leaves it closed.
    fireEvent.press(screen.getByTestId('session-view-gym-sheet-backdrop', { includeHiddenElements: true }));
    await replayFocus();
    expect(screen.queryByTestId('session-view-gym-sheet')).toBeNull();
  });

  it('says so when its session is no longer the active draft', async () => {
    await seed(() => setSessionDeletedState(SESSION, true));
    render(<SessionViewScreen sessionId={SESSION} />);

    expect(await screen.findByText('This session is no longer active.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('session-view-back'));
    expect(mockDismissTo).toHaveBeenCalledWith('/train');
  });

  it('shows a retryable error when the draft read fails (a failed read)', async () => {
    await seed();
    jest.spyOn(sessionDrafts, 'loadLatestSessionDraftSnapshot').mockRejectedValueOnce(new Error('disk'));
    render(<SessionViewScreen sessionId={SESSION} />);

    fireEvent.press(await screen.findByTestId('session-view-retry'));
    expect(await screen.findByLabelText(BENCH_LABEL)).toBeTruthy();
  });
});

// A completed session opened to edit it (History, completed-session `Edit`).
describe('Session view: editing a completed session', () => {
  const DONE = 'completed_edit_session';
  // Stored to the second, so Done can prove it keeps untouched instants.
  const STARTED_AT = new Date(2026, 1, 25, 10, 0, 30);
  const COMPLETED_AT = new Date(2026, 1, 25, 10, 45, 10);
  const BENCH_DEF = EXERCISE_BLOCK_HISTORY_FIXTURE.secondaryExerciseId;

  type StoredSet = {
    id: string;
    weightValue: string;
    repsValue: string;
    setType: string | null;
    performanceStatus?: 'planned' | 'unperformed' | 'skipped' | null;
    plannedWeightValue?: string | null;
    plannedRepsValue?: string | null;
    plannedSetType?: string | null;
  };
  type StoredExercise = { id: string; exerciseDefinitionId: string; name: string; sets: StoredSet[] };

  const performed = (id: string, weightValue: string, repsValue: string, setType: string | null): StoredSet => ({
    id,
    weightValue,
    repsValue,
    setType,
    performanceStatus: null,
  });

  const benchWith = (sets: StoredSet[]): StoredExercise => ({
    id: 'done_bench',
    exerciseDefinitionId: BENCH_DEF,
    name: 'Barbell Bench Press',
    sets,
  });

  const DEFAULT_EXERCISES = [
    benchWith([
      performed('c1', '160', '8', 'rir_1'),
      { ...performed('c2', '150', '8', 'rir_2'), performanceStatus: 'unperformed' },
    ]),
  ];

  // Written through the app's draft → complete path, on top of the
  // session-view fixture (its active session is another session; its history
  // is the rest).
  const openCompleted = async (
    exercises: StoredExercise[] = DEFAULT_EXERCISES,
    afterSeed?: () => Promise<unknown> | void
  ) => {
    await seed(async () => {
      await upsertLocalGym({ id: 'gym-iron', name: 'Iron Works' });
      await upsertLocalGym({ id: 'gym-harbour', name: 'Harbour Barbell' });
      await sessionDrafts.persistSessionDraftSnapshot(
        { sessionId: DONE, gymId: 'gym-iron', startedAt: STARTED_AT, exercises: exercises as never },
        { now: COMPLETED_AT }
      );
      await sessionDrafts.completeSessionDraft(DONE, { completedAt: COMPLETED_AT, now: COMPLETED_AT });
      await afterSeed?.();
    });
    render(<SessionViewScreen sessionId={DONE} />);
  };

  const renderCompleted = async (exercises?: StoredExercise[]) => {
    await openCompleted(exercises);
    await screen.findByTestId('session-view-done-button');
  };

  const pressDone = async () => {
    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-done-button'));
    });
  };

  const expectActiveFixtureUntouched = async () => {
    expect(await sessionDrafts.loadLatestSessionDraftSnapshot()).toMatchObject({ sessionId: SESSION });
    expect(sessionRow(SESSION)?.status).toBe('active');
  };

  it('opens with Start/End in place of Time, Done in place of Finish and Abandon, and no comparisons', async () => {
    await renderCompleted();

    expect(screen.getByText('Edit session')).toBeTruthy();
    expect(screen.queryByTestId('session-view-finish-button')).toBeNull();
    expect(screen.queryByTestId('session-view-options-button')).toBeNull();
    expect(screen.queryByTestId('session-view-summary-time')).toBeNull();
    expect(screen.getByTestId('session-view-start-time')).toHaveProp('value', '2026-02-25 10:00');
    expect(screen.getByTestId('session-view-end-time')).toHaveProp('value', '2026-02-25 10:45');
    expect(screen.getByTestId('session-view-summary-gym-button')).toHaveProp('accessibilityLabel', 'Gym Iron Works');
    expect(screen.getByLabelText(/^Barbell Bench Press, 1 of 2 sets done/)).toBeTruthy();
    expect(screen.queryByTestId('session-view-times-notice')).toBeNull();
    // Editing history: no live comparisons, editing still available.
    expect(screen.queryByTestId('session-insight-presentation')).toBeNull();
    expect(screen.getByTestId('session-view-add-exercise')).toBeTruthy();
  });

  it('validates Start/End, and Done writes nothing until they are valid', async () => {
    await renderCompleted();
    const start = screen.getByTestId('session-view-start-time');
    const end = screen.getByTestId('session-view-end-time');

    fireEvent.changeText(start, '2026-02-30 10:00');
    fireEvent.changeText(end, '2026-02-30 10:50');
    await act(async () => {
      fireEvent(start, 'blur');
      fireEvent(end, 'blur');
    });
    expect(screen.getByTestId('session-view-start-time-error')).toHaveTextContent(
      'Enter a valid Start time in YYYY-MM-DD HH:mm format.'
    );
    expect(screen.getByTestId('session-view-end-time-error')).toHaveTextContent(
      'Enter a valid End time in YYYY-MM-DD HH:mm format.'
    );
    expect(screen.getByTestId('session-view-times-notice')).toHaveTextContent(
      'Autosave paused until Start/End times are valid.'
    );
    await pressDone();
    expect(sessionRow(DONE)?.completedAt).toEqual(COMPLETED_AT);

    fireEvent.changeText(start, '2026-02-25 10:00');
    fireEvent.changeText(end, '2026-02-25 09:55');
    expect(screen.queryByTestId('session-view-start-time-error')).toBeNull();
    expect(screen.getByTestId('session-view-end-time-error')).toHaveTextContent(
      'End time must be later than or equal to Start time.'
    );
    await pressDone();
    expect(sessionRow(DONE)?.completedAt).toEqual(COMPLETED_AT);

    fireEvent.changeText(end, '2026-02-25 10:50');
    expect(screen.queryByTestId('session-view-times-notice')).toBeNull();
    answerAlerts((title) => (title.startsWith('Discard unconfirmed') ? 'Discard unconfirmed sets and save changes' : 'x'));
    await pressDone();

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    // Start still shows its stored minute, so it keeps the stored instant.
    expect(await readSession(DONE)).toMatchObject({
      status: 'completed',
      gymId: 'gym-iron',
      startedAt: STARTED_AT,
      completedAt: new Date(2026, 1, 25, 10, 50, 0, 0),
    });
    await expectActiveFixtureUntouched();
  });

  it('pauses autosave while the times are invalid and resumes, keeping every row, when they are valid', async () => {
    await renderCompleted();
    jest.useFakeTimers();

    fireEvent.changeText(screen.getByTestId('session-view-end-time'), '2026-02-25 09:50');
    await act(async () => {
      jest.advanceTimersByTime(3_000);
    });
    expect(sessionRow(DONE)?.completedAt).toEqual(COMPLETED_AT);
    expect(screen.getByTestId('session-view-times-notice')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('session-view-end-time'), '2026-02-25 10:50');
    await act(async () => {
      jest.advanceTimersByTime(3_000);
    });

    const written = await readSession(DONE);
    expect(written).toMatchObject({ startedAt: STARTED_AT, completedAt: new Date(2026, 1, 25, 10, 50) });
    // Autosave is lossless: the unconfirmed row stays until Done.
    expect(written!.exercises[0].sets.map((row) => [row.id, row.performanceStatus])).toEqual([
      ['c1', null],
      ['c2', 'unperformed'],
    ]);
    expect(screen.queryByTestId('session-view-times-notice')).toBeNull();
  });

  it('saves confirmed rows only on Done: planned and skipped rows drop out, zero-weight sets stay', async () => {
    const titles = answerAlerts(() => 'unexpected');
    await renderCompleted([
      benchWith([
        {
          ...performed('s-skipped', '', '', null),
          plannedWeightValue: '225',
          plannedRepsValue: '5',
          plannedSetType: 'rir_2',
          performanceStatus: 'skipped',
        },
        {
          ...performed('s-planned', '', '', null),
          plannedWeightValue: '245',
          plannedRepsValue: '3',
          plannedSetType: 'rir_1',
          performanceStatus: 'planned',
        },
        {
          ...performed('s-performed', '185', '8', 'rir_1'),
          plannedWeightValue: '185',
          plannedRepsValue: '8',
          plannedSetType: 'rir_2',
        },
        performed('s-zero', '0', '5', null),
      ]),
    ]);

    await pressDone();

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(titles).toEqual([]);
    const written = await readSession(DONE);
    expect(written!.exercises).toHaveLength(1);
    expect(written!.exercises[0].sets).toEqual([
      expect.objectContaining({
        id: 's-performed',
        weightValue: '185',
        repsValue: '8',
        setType: 'rir_1',
        plannedWeightValue: null,
        plannedRepsValue: null,
        plannedSetType: null,
        performanceStatus: null,
      }),
      expect.objectContaining({ id: 's-zero', weightValue: '0', repsValue: '5' }),
    ]);
    await expectActiveFixtureUntouched();
  });

  it('asks before discarding with the completed-edit copy, and writes nothing when declined', async () => {
    let answer = 'Go back to edit session';
    const titles = answerAlerts(() => answer);
    await renderCompleted([
      benchWith([
        performed('c1', '225', '5', null),
        { ...performed('c2', '205', '', null), performanceStatus: 'unperformed' },
      ]),
      { id: 'done_fly', exerciseDefinitionId: 'seed_cable_flys', name: 'Cable Flys', sets: [] },
    ]);
    const before = await readSession(DONE);

    await pressDone();
    expect(titles).toEqual(['Remove incomplete sets and empty exercises?']);
    expect(await readSession(DONE)).toEqual(before);
    expect(mockBack).not.toHaveBeenCalled();

    answer = 'Remove and save changes';
    await pressDone();
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    const written = await readSession(DONE);
    expect(written!.exercises.map((exercise) => exercise.id)).toEqual(['done_bench']);
    expect(written!.exercises[0].sets.map((row) => row.id)).toEqual(['c1']);
  });

  it('labels each cleanup prompt for saving changes', async () => {
    const buttons: string[] = [];
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, alertButtons) => {
      const confirm = alertButtons?.find((button) => button.style !== 'cancel');
      buttons.push(confirm?.text ?? '');
      confirm?.onPress?.();
    });
    await renderCompleted();

    await pressDone();
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(buttons).toEqual(['Discard unconfirmed sets and save changes']);
  });

  // The stack keeps the session view mounted under the exercise page, so both
  // screens are rendered side by side: the page's logger edits a set after the
  // view has loaded the session, and Done must save that edit, not its own copy.
  it('saves on Done a set changed on the exercise page after the view opened, keeping the session completed', async () => {
    const titles = answerAlerts(() => 'unexpected');
    await seed(async () => {
      await sessionDrafts.persistSessionDraftSnapshot(
        {
          sessionId: DONE,
          gymId: null,
          startedAt: STARTED_AT,
          exercises: [benchWith([performed('c1', '160', '8', 'rir_1')])] as never,
        },
        { now: COMPLETED_AT }
      );
      await sessionDrafts.completeSessionDraft(DONE, { completedAt: COMPLETED_AT, now: COMPLETED_AT });
    });
    render(
      <>
        <SessionViewScreen sessionId={DONE} />
        <ExercisePageScreen sessionExerciseId="done_bench" sessionId={DONE} />
      </>
    );
    await screen.findByTestId('session-view-done-button');
    await screen.findByTestId('exercise-page');

    fireEvent.press(screen.getByTestId('exercise-set-1-open'));
    fireEvent.changeText(await screen.findByTestId('exercise-set-logger-reps'), '9');
    await act(async () => {
      fireEvent.press(screen.getByTestId('exercise-set-logger-commit'));
    });
    await waitFor(async () =>
      expect((await readSession(DONE))!.exercises[0].sets[0]).toMatchObject({ id: 'c1', repsValue: '9' })
    );
    // The logger writes the completed session in place.
    expect(sessionRow(DONE)).toMatchObject({ status: 'completed', completedAt: COMPLETED_AT });

    await pressDone();

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(titles).toEqual([]);
    expect(await readSession(DONE)).toMatchObject({
      status: 'completed',
      startedAt: STARTED_AT,
      completedAt: COMPLETED_AT,
      exercises: [
        expect.objectContaining({
          id: 'done_bench',
          sets: [expect.objectContaining({ id: 'c1', weightValue: '160', repsValue: '9', setType: 'rir_1' })],
        }),
      ],
    });
    await expectActiveFixtureUntouched();
  });

  it('goes to the completed session when there is nothing to go back to', async () => {
    mockCanGoBack.mockReturnValue(false);
    answerAlerts(() => 'Discard unconfirmed sets and save changes');
    await renderCompleted();

    await pressDone();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/completed-session/${DONE}`));
  });

  it('writes pending valid times before the screen is removed', async () => {
    await renderCompleted();
    const listener = mockNavigation.addListener.mock.calls.find(([event]) => event === 'beforeRemove')?.[1];
    expect(listener).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('session-view-end-time'), '2026-02-25 10:50');
    const preventDefault = jest.fn();
    const action = { type: 'GO_BACK' };
    await act(async () => {
      listener?.({ preventDefault, data: { action } });
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockNavigation.dispatch).toHaveBeenCalledWith(action));
    expect(sessionRow(DONE)?.completedAt).toEqual(new Date(2026, 1, 25, 10, 50));
  });

  it('changes the gym in place, keeping the session completed and its times', async () => {
    await renderCompleted();

    await openGymSheet();
    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-gym-option-gym-harbour'));
    });

    const written = await readSession(DONE);
    expect(written).toMatchObject({
      status: 'completed',
      gymId: 'gym-harbour',
      startedAt: STARTED_AT,
      completedAt: COMPLETED_AT,
    });
    expect(written!.exercises[0].sets.map((row) => row.id)).toEqual(['c1', 'c2']);
    await expectActiveFixtureUntouched();
  });

  it('adds an exercise to the completed session, keeping it completed', async () => {
    await renderCompleted();

    await addExerciseThroughPicker(EXERCISE_BLOCK_HISTORY_FIXTURE.noHistoryExerciseName);

    const written = await readSession(DONE);
    expect(written!.exercises.map((exercise) => exercise.name)).toEqual(['Barbell Bench Press', 'Lat Pulldown']);
    expect(written).toMatchObject({ status: 'completed', completedAt: COMPLETED_AT });
    await expectActiveFixtureUntouched();
  });

  it('measures its records against the rest of history, not against itself', async () => {
    await openCompleted();

    // Its 160 × 8 (1RM 204.3) beats the fixture history's best Bench 1RM (≈ 197.9); measured
    // against itself it would only tie.
    expect(await screen.findByLabelText('Barbell Bench Press, 1 of 2 sets done, new 1RM record 204.3')).toBeTruthy();
  });

  it('says so when the completed session was deleted', async () => {
    await openCompleted(undefined, () => setSessionDeletedState(DONE, true));

    expect(await screen.findByTestId('session-view-missing')).toBeTruthy();
  });
});
