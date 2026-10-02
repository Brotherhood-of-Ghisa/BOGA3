/* eslint-disable import/first */

/**
 * The exercise page over real data: the production screen, draft repository,
 * exercise history and catalog caches over the migrated in-memory SQLite
 * database, seeded through the Maestro harness with the `exercise-page`
 * fixture (helpers/local-data.ts). An active session whose Barbell Bench Press
 * has two performed sets and three planned ones, plus two completed bench
 * sessions 12 and 42 days ago for the records panel. Persistence is asserted
 * by reading the session back from the database.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { eq } from 'drizzle-orm';
import { Alert, StyleSheet, type AlertButton } from 'react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

const mockRouter = {
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
  push: jest.fn(),
  replace: jest.fn(),
};
let mockRouteParams: Record<string, string> = {};

jest.mock('expo-router', () => {
  const mockReact = jest.requireActual('react');
  return {
    useRouter: () => mockRouter,
    useNavigation: () => undefined,
    useLocalSearchParams: () => mockRouteParams,
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

import ExercisePageRoute from '@/app/session/[sessionId]/exercise/[sessionExerciseId]';
import { ExercisePageScreen } from '@/components/exercise-page/exercise-page-screen';
import { uiRoles } from '@/components/ui/tokens';
import { upsertLocalGym } from '@/src/data/local-gyms';
import { sessions } from '@/src/data/schema';
import { loadSessionSnapshotById } from '@/src/data/session-drafts';
import { setSessionDeletedState } from '@/src/data/session-list';
import {
  __resetExerciseListPreferencesForTests,
  setExerciseListPreferences,
} from '@/src/exercise-catalog/list-preferences';
import { EXERCISE_PAGE_FIXTURE } from '@/src/maestro/exercise-page-fixture';
import {
  bootLocalApp,
  closeLocalData,
  loadMaestroFixture,
  localDatabase,
  resetLocalData,
} from './helpers/local-data';

const SESSION = EXERCISE_PAGE_FIXTURE.activeSessionId;
const BENCH = EXERCISE_PAGE_FIXTURE.benchSessionExerciseId;
const SQUAT = EXERCISE_PAGE_FIXTURE.squatSessionExerciseId;
const BENCH_DEF = EXERCISE_PAGE_FIXTURE.benchExerciseId;
const NEWER_HISTORY = 'maestro_exercise_page_history_2';
const OLDER_HISTORY = 'maestro_exercise_page_history_1';
const DATE = String.raw`\d{2}-\d{2}-\d{4}`;

const readSession = (sessionId: string = SESSION) => loadSessionSnapshotById(sessionId);
const benchSets = async (sessionId: string = SESSION, exerciseId: string = BENCH) =>
  (await readSession(sessionId))?.exercises.find((exercise) => exercise.id === exerciseId)?.sets ?? [];
const setStates = async () =>
  (await benchSets()).map(({ weightValue, repsValue, setType, performanceStatus }) => ({
    weightValue,
    repsValue,
    setType,
    performanceStatus,
  }));

const seedPage = async (prepare?: () => Promise<void> | void) => {
  await loadMaestroFixture('exercise-page');
  await prepare?.();
  await bootLocalApp();
};

const renderPage = async ({
  sessionId = SESSION,
  sessionExerciseId = BENCH,
  record = '1RM102.1',
}: { sessionId?: string; sessionExerciseId?: string; record?: string } = {}) => {
  render(<ExercisePageScreen sessionExerciseId={sessionExerciseId} sessionId={sessionId} />);
  await screen.findByTestId('exercise-page');
  await waitFor(() => expect(screen.getByTestId('exercise-records-1rm')).toHaveTextContent(record));
};

const openPage = async (options?: Parameters<typeof renderPage>[0]) => {
  await seedPage();
  await renderPage(options);
};

const atGym = async (gymId: string, name: string, sessionIds: string[]) => {
  await upsertLocalGym({ id: gymId, name });
  for (const sessionId of sessionIds) {
    localDatabase().update(sessions).set({ gymId }).where(eq(sessions.id, sessionId)).run();
  }
};

const pressAlertButton = (label: string) => {
  const call = jest.mocked(Alert.alert).mock.calls.at(-1);
  const button = (call?.[2] as AlertButton[] | undefined)?.find((candidate) => candidate.text === label);
  act(() => button?.onPress?.());
};

describe('ExercisePageScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetLocalData();
    __resetExerciseListPreferencesForTests();
    mockLinkingUserId = null;
    mockRouteParams = {};
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    closeLocalData();
  });

  it('renders the V5-Quiet state: records collapsed, set list, logger on the current set', async () => {
    await openPage();

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
    // Only the logger carries the unit label; the other set rows stay quiet.
    expect(screen.getAllByText('Weight · kg')).toHaveLength(1);
  });

  it('highlights only records: today\'s top set stays plain, a record weight and 1RM take `record`', async () => {
    await openPage();

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
    await seedPage();
    const before = await readSession(NEWER_HISTORY);
    // The newer completed session is being edited; its own sets are not its
    // records' baseline, so the older one holds every record: 80 × 7 → 1RM 99.2.
    await renderPage({ sessionId: NEWER_HISTORY, sessionExerciseId: `${NEWER_HISTORY}_bench`, record: '1RM99.2' });
    expect(screen.getByTestId('exercise-records-max')).toHaveTextContent('Max80.0');

    fireEvent.press(screen.getByTestId('exercise-add-set'));

    await waitFor(async () => expect(await benchSets(NEWER_HISTORY, `${NEWER_HISTORY}_bench`)).toHaveLength(5));
    const after = await readSession(NEWER_HISTORY);
    expect(after).toMatchObject({
      status: 'completed',
      startedAt: before!.startedAt,
      completedAt: before!.completedAt,
    });
  });

  it('logs the current set with the tick and moves the logger to the next one, saving only its own exercise', async () => {
    await openPage();
    const squatBefore = (await readSession())!.exercises.find((exercise) => exercise.id === SQUAT);

    fireEvent.changeText(screen.getByTestId('exercise-set-logger-reps'), '5');
    fireEvent.press(screen.getByTestId('exercise-set-logger-commit'));

    await waitFor(async () =>
      expect((await benchSets())[2]).toMatchObject({
        weightValue: '82.5',
        repsValue: '5',
        setType: 'rir_1',
        performanceStatus: null,
        // The plan it was logged against stays with the row.
        plannedRepsValue: '6',
      })
    );
    const after = (await readSession())!;
    expect(after.exercises.map((exercise) => exercise.id)).toEqual([BENCH, SQUAT]);
    expect(after.exercises.find((exercise) => exercise.id === SQUAT)).toEqual(squatBefore);
    expect(screen.getByTestId('exercise-set-3-values')).toHaveTextContent('82.5 × 5');
    expect(within(screen.getByTestId('exercise-set-logger')).getByText('Set 4')).toBeTruthy();
  });

  // Typing waits for the 3 s debounce, and leaving the page writes what is still pending.
  it('saves typed values after the debounce, and flushes pending typing when the page goes', async () => {
    await openPage();
    jest.useFakeTimers();
    try {
      fireEvent.changeText(screen.getByTestId('exercise-set-logger-reps'), '4');
      await act(async () => {
        jest.advanceTimersByTime(2_900);
      });
      expect((await benchSets())[2]).toMatchObject({ repsValue: '', performanceStatus: 'planned' });
      await act(async () => {
        jest.advanceTimersByTime(200);
      });
      await waitFor(async () =>
        expect((await benchSets())[2]).toMatchObject({ repsValue: '4', performanceStatus: 'planned' })
      );

      fireEvent.changeText(screen.getByTestId('exercise-set-logger-reps'), '3');
      screen.unmount();
      await act(async () => {
        await Promise.resolve();
      });
      await waitFor(async () =>
        expect((await benchSets())[2]).toMatchObject({ repsValue: '3', performanceStatus: 'planned' })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps the tick disabled until the values are a valid set', async () => {
    await openPage();
    const before = await setStates();

    fireEvent.changeText(screen.getByTestId('exercise-set-logger-reps'), '');
    const commit = screen.getByTestId('exercise-set-logger-commit');
    expect(commit).toHaveProp('accessibilityState', { disabled: true });
    fireEvent.press(commit);
    expect(await setStates()).toEqual(before);
  });

  it('picks an effort from the sheet', async () => {
    await openPage();

    fireEvent(screen.getByTestId('exercise-set-logger-effort'), 'longPress');
    const sheet = await screen.findByTestId('exercise-effort-sheet');
    expect(within(sheet).getByTestId('exercise-effort-option-rir_1')).toHaveProp('accessibilityState', {
      selected: true,
      disabled: false,
    });
    fireEvent.press(within(sheet).getByTestId('exercise-effort-option-rir_0'));

    await waitFor(async () =>
      expect((await benchSets())[2]).toMatchObject({ setType: 'rir_0', performanceStatus: 'planned' })
    );
    expect(screen.getByTestId('exercise-set-logger-effort')).toHaveTextContent('EffortRIR 0');
  });

  it('cycles effort in descending RIR order, including blank, and persists the selection', async () => {
    await openPage();
    for (const label of ['RIR 0', 'W-Up', 'none', 'RIR 3', 'RIR 2', 'RIR 1']) {
      fireEvent.press(screen.getByTestId('exercise-set-logger-effort'));
      expect(screen.getByLabelText(`Change effort, currently ${label}`)).toBeTruthy();
    }
    fireEvent(screen.getByTestId('exercise-set-logger-effort'), 'longPress');
    fireEvent.press(await screen.findByTestId('exercise-effort-option-rir_3'));
    await waitFor(async () => expect((await benchSets())[2].setType).toBe('rir_3'));
    fireEvent(screen.getByTestId('exercise-set-logger-effort'), 'longPress');
    fireEvent.press(await screen.findByTestId('exercise-effort-option-none'));
    expect(screen.getByLabelText('Change effort, currently none')).toBeTruthy();
    await waitFor(async () => expect((await benchSets())[2].setType).toBeNull());
  });

  it('shows Records and Last from completed history, the active session excluded', async () => {
    await openPage();

    fireEvent.press(screen.getByTestId('exercise-records-toggle'));
    // The newer session holds the 1RM (80 × 8) and heaviest weight; the older one the volume.
    expect(screen.getByTestId('exercise-record-1rm')).toHaveTextContent(new RegExp(`^1RM102\\.1${DATE} · 80\\.0 × 8$`));
    expect(screen.getByTestId('exercise-record-max')).toHaveTextContent(new RegExp(`^Max82\\.5${DATE} · 6 reps$`));
    expect(screen.getByTestId('exercise-record-vol')).toHaveTextContent(new RegExp(`^Vol2560${DATE} · 5 sets$`));

    fireEvent.press(screen.getByTestId('exercise-records-view-last'));
    const last = screen.getByTestId('exercise-records-last');
    expect(within(last).getByText('1RM 102.1 · VOL 2375')).toBeTruthy();
    expect(screen.getByTestId('exercise-records-last-set-3')).toHaveTextContent(/^RIR 082\.5 × 6/);

    fireEvent.press(screen.getByTestId('exercise-records-history'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/exercise-history',
      params: { exerciseDefinitionId: BENCH_DEF },
    });
  });

  it('forwards currentGymId to exercise-history when the active session has a gym', async () => {
    await seedPage(() => atGym('gym-downtown', 'Downtown', [SESSION]));
    await renderPage();

    fireEvent.press(screen.getByTestId('exercise-records-history'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/exercise-history',
      params: { exerciseDefinitionId: BENCH_DEF, currentGymId: 'gym-downtown' },
    });
  });

  it('leaves the records panel collapsed or expanded when switching Records and Last', async () => {
    await openPage();

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
    await openPage();

    fireEvent.press(screen.getByTestId('exercise-set-5-toggle'));
    await waitFor(async () =>
      expect((await benchSets())[4]).toMatchObject({ weightValue: '85', performanceStatus: null })
    );
    fireEvent.press(screen.getByTestId('exercise-set-5-toggle'));
    await waitFor(async () => expect((await benchSets())[4]?.performanceStatus).toBe('planned'));
  });

  it('adds a set copying the last one', async () => {
    await openPage();

    fireEvent.press(screen.getByTestId('exercise-add-set'));
    await waitFor(async () => expect(await benchSets()).toHaveLength(6));
    expect((await benchSets())[5]).toMatchObject({
      weightValue: '85',
      repsValue: '5',
      performanceStatus: 'unperformed',
    });
    expect(within(screen.getByTestId('exercise-set-logger')).getByText('Set 6')).toBeTruthy();
  });

  it('warns before Complete discards planned sets, keeps them as not performed, then goes back', async () => {
    await openPage();
    const before = await setStates();

    fireEvent.press(screen.getByTestId('exercise-complete'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Complete exercise?',
      '3 planned sets will be discarded.',
      expect.any(Array)
    );

    pressAlertButton('Cancel');
    expect(await setStates()).toEqual(before);

    fireEvent.press(screen.getByTestId('exercise-complete'));
    pressAlertButton('Complete');
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    await waitFor(async () =>
      expect(
        (await benchSets()).map((row) => [row.performanceStatus ?? null, row.plannedRepsValue ?? null])
      ).toEqual([
        [null, null],
        [null, null],
        ['unperformed', '6'],
        ['unperformed', '6'],
        ['unperformed', '5'],
      ])
    );
  });

  it('goes back without touching set states', async () => {
    await openPage();
    const before = await setStates();

    fireEvent.press(screen.getByTestId('exercise-page-back'));
    expect(mockRouter.back).toHaveBeenCalled();
    expect(await setStates()).toEqual(before);
  });

  it('removes the exercise from the session after confirmation', async () => {
    await openPage();

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
    await waitFor(async () =>
      expect((await readSession())?.exercises.map((exercise) => exercise.id)).toEqual([SQUAT])
    );
  });

  it('offers Link to group exercise… in the ⋮ only when signed in, opening the Link screen', async () => {
    await openPage();

    fireEvent.press(screen.getByTestId('exercise-page-options'));
    const signedOut = await screen.findByTestId('exercise-options-sheet');
    expect(within(signedOut).queryByTestId('exercise-options-link-group')).toBeNull();
    fireEvent.press(screen.getByTestId('exercise-options-sheet-backdrop', { includeHiddenElements: true }));
    screen.unmount();

    mockLinkingUserId = 'user-1';
    await renderPage();
    fireEvent.press(screen.getByTestId('exercise-page-options'));
    const sheet = await screen.findByTestId('exercise-options-sheet');
    fireEvent.press(within(sheet).getByText('Link to group exercise…'));

    expect(mockRouter.push).toHaveBeenCalledWith(`/exercise-link?exerciseDefinitionId=${BENCH_DEF}`);
    expect(screen.queryByTestId('exercise-options-sheet')).toBeNull();
  });

  it('swaps the exercise and keeps its sets', async () => {
    await openPage();

    fireEvent.press(screen.getByTestId('exercise-page-options'));
    fireEvent.press(await screen.findByTestId('exercise-options-swap'));
    const swap = await screen.findByTestId('exercise-swap-sheet');
    // The search keeps focus while a result is tapped: with the default
    // `never`, iOS spends that first tap dismissing the keyboard and the row
    // never fires (fireEvent cannot see the keyboard, so pin the prop).
    expect(within(swap).getByTestId('exercise-swap-list')).toHaveProp('keyboardShouldPersistTaps', 'handled');
    fireEvent.changeText(within(swap).getByLabelText('Search exercises'), 'Incline Barbell');
    fireEvent.press(await within(swap).findByText('Incline Barbell Bench Press'));

    await waitFor(async () =>
      expect((await readSession())?.exercises[0]).toMatchObject({
        exerciseDefinitionId: 'seed_incline_barbell_bench_presses',
        name: 'Incline Barbell Bench Press',
      })
    );
    expect(await benchSets()).toHaveLength(5);
    expect(screen.getByTestId('exercise-page-title')).toHaveTextContent('Incline Barbell Bench Press');
  });

  it('says so when the exercise or the session is gone, or the session was deleted', async () => {
    await seedPage(() => setSessionDeletedState(NEWER_HISTORY, true));

    render(<ExercisePageScreen sessionExerciseId="gone" sessionId={SESSION} />);
    expect(await screen.findByText('This exercise is no longer in the session.')).toBeTruthy();
    screen.unmount();
    render(<ExercisePageScreen sessionExerciseId={BENCH} sessionId="gone" />);
    expect(await screen.findByText('This session no longer exists.')).toBeTruthy();
    screen.unmount();
    render(<ExercisePageScreen sessionExerciseId={`${NEWER_HISTORY}_bench`} sessionId={NEWER_HISTORY} />);
    expect(
      await screen.findByText('This session was deleted, so its sets cannot be edited here.')
    ).toBeTruthy();
  });

  it('filters past records to the current gym and names it', async () => {
    setExerciseListPreferences({ pastRecordsGymScope: 'current-gym' });
    await seedPage(async () => {
      await atGym('gym-metroflex', 'Metroflex', [SESSION, NEWER_HISTORY]);
      await atGym('gym-golds', "Gold's Gym", [OLDER_HISTORY]);
    });
    await renderPage();

    // Only the newer session counts: its 2375 volume, not the older one's 2560.
    expect(screen.getByTestId('exercise-records-vol')).toHaveTextContent('Vol2375');
    fireEvent.press(screen.getByTestId('exercise-records-toggle'));
    expect(screen.getByTestId('exercise-record-1rm')).toHaveTextContent(
      new RegExp(`^1RM102\\.1${DATE} · Metroflex · 80\\.0 × 8$`)
    );
    expect(screen.getByTestId('exercise-record-max')).toHaveTextContent(
      new RegExp(`^Max82\\.5${DATE} · Metroflex · 6 reps$`)
    );
    fireEvent.press(screen.getByTestId('exercise-records-view-last'));
    expect(within(screen.getByTestId('exercise-records-last')).getByText(/Metroflex/)).toBeTruthy();
  });

  it('says so when the current gym has no completed sessions for this exercise', async () => {
    setExerciseListPreferences({ pastRecordsGymScope: 'current-gym' });
    await seedPage(async () => {
      await atGym('gym-golds', "Gold's Gym", [OLDER_HISTORY, NEWER_HISTORY]);
      await atGym('gym-new', 'New Gym', [SESSION]);
    });
    render(<ExercisePageScreen sessionExerciseId={BENCH} sessionId={SESSION} />);
    await screen.findByTestId('exercise-page');

    fireEvent.press(screen.getByTestId('exercise-records-toggle'));
    expect(await screen.findByTestId('exercise-records-empty')).toHaveTextContent(
      'No completed sessions for this gym yet.'
    );
  });
});

describe('exercise page route', () => {
  beforeEach(() => resetLocalData());
  afterEach(() => closeLocalData());

  it('opens the page for the route params', async () => {
    await seedPage();
    mockRouteParams = { sessionId: SESSION, sessionExerciseId: BENCH };
    render(<ExercisePageRoute />);
    expect(await screen.findByTestId('exercise-page-title')).toHaveTextContent('Barbell Bench Press');
  });
});
