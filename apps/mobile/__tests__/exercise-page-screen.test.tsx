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
import { Alert, Keyboard, StyleSheet, type AlertButton } from 'react-native';

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

jest.mock('@/src/session-planner', () => {
  const actual = jest.requireActual('@/src/session-planner');
  return {
    ...actual,
    reorderSessionExerciseSets: jest.fn((...args: unknown[]) =>
      (actual.reorderSessionExerciseSets as any)(...args)
    ),
  };
});

import ExercisePageRoute from '@/app/session/[sessionId]/exercise/[sessionExerciseId]';
import { ExercisePageScreen } from '@/components/exercise-page/exercise-page-screen';
import * as sessionPlanner from '@/src/session-planner';
import { Icon } from '@/components/ui/icon';
import { uiIconSize, uiRoles } from '@/components/ui/tokens';
import { defaultSessionExerciseDraftClient, type SessionExerciseDraftClient } from '@/src/session-recorder/session-exercise-draft';
import { upsertLocalGym } from '@/src/data/local-gyms';
import { sessions } from '@/src/data/schema';
import { loadSessionSnapshotById } from '@/src/data/session-drafts';
import { setSessionDeletedState } from '@/src/data/session-list';
import {
  __resetExerciseListPreferencesForTests,
  setExerciseListPreferences,
} from '@/src/exercise-catalog/list-preferences';
import { EXERCISE_PAGE_FIXTURE } from '@/src/maestro/exercise-page-fixture';
import { updatePreferences } from '@/src/preferences/hooks';
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

  it('renders the default state: records collapsed, set list, logger on the current set', async () => {
    await openPage();

    expect(screen.getByTestId('exercise-page-title')).toHaveTextContent('Barbell Bench Press');
    expect(screen.getByTestId('exercise-records-max')).toHaveTextContent('Max82.5');
    expect(screen.getByTestId('exercise-records-vol')).toHaveTextContent('Vol2080');

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

  it('scrolls Complete exercise with the page, after the set list, instead of pinning it', async () => {
    await openPage();

    // Host testIDs inside the scroll, in render (document) order.
    const scroll = screen.getByTestId('exercise-page-scroll');
    const order = scroll
      .findAll((node) => typeof node.type === 'string' && typeof node.props.testID === 'string')
      .map((node) => node.props.testID as string);
    expect(order).toContain('exercise-set-list');
    expect(order.indexOf('exercise-complete')).toBeGreaterThan(order.indexOf('exercise-set-list'));
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

    // The set list's band reads the session card's words: one set, both records.
    expect(screen.getByTestId('exercise-record-band-1')).toHaveTextContent('New 1RM · 108.3 + top weight90.0 × 6');
  });

  it('keeps both swipe symbols inside the exposed edge of the opaque logger', async () => {
    await openPage();
    // A typed entry makes the drop available, so both sides are offered.
    fireEvent.changeText(screen.getByTestId('exercise-set-logger-weight'), '90');

    const row = screen.getByTestId('exercise-set-swipe-3');
    const [confirm, discard] = within(row).UNSAFE_getAllByType(Icon);
    for (const [icon, edge] of [[confirm, 'left'], [discard, 'right']] as const) {
      const style = StyleSheet.flatten(icon.parent?.props.style);
      expect(style).toMatchObject({ [edge]: 0, alignItems: 'center' });
      expect(style[edge === 'left' ? 'right' : 'left']).toBeUndefined();
      // The whole glyph must clear the foreground by the 56pt trigger,
      // independent of row width (the drag is capped at 88pt).
      const glyphSize = uiIconSize[(icon.props.size ?? 'md') as keyof typeof uiIconSize];
      expect((style.width - glyphSize) / 2).toBeGreaterThanOrEqual(0);
      expect((style.width + glyphSize) / 2).toBeLessThanOrEqual(56);
    }
    expect(confirm.props.name).toBe('check');
    expect(discard.props.name).toBe('x');
  });

  it('offers each swipe side, and its accessibility action, only when it would change the row', async () => {
    await openPage();
    // The underlay symbols are the shell's non-interactive icons, not the logger's.
    const swipeSymbols = () =>
      within(screen.getByTestId('exercise-set-swipe-3'))
        .UNSAFE_queryAllByType(Icon)
        .filter((icon) => icon.parent?.props.pointerEvents === 'none')
        .map((icon) => icon.props.name);
    const actions = () =>
      (screen.getByTestId('exercise-set-logger-header').props.accessibilityActions as { name: string }[])
        .map((action) => action.name);

    // Untouched planned set: its plan confirms, but there is nothing to drop;
    // the row's reorder moves ride along (it is neither first nor last).
    expect(swipeSymbols()).toEqual(['check']);
    expect(actions()).toEqual(['move-earlier', 'move-later', 'confirm']);

    // Invalid reps: droppable, not confirmable.
    fireEvent.changeText(screen.getByTestId('exercise-set-logger-reps'), '0');
    await waitFor(() => expect(swipeSymbols()).toEqual(['x']));
    expect(actions()).toEqual(['move-earlier', 'move-later', 'discard']);
  });

  it('confirms the in-progress set from the swipe action, advancing like the tick', async () => {
    await openPage();

    // The logger is the open cursor row; its accessibility actions are the
    // non-gesture path of the swipes (`ux-rules.md` "Swipes on the exercise page"), exposed on its
    // accessible header.
    const header = screen.getByTestId('exercise-set-logger-header');
    expect(header).toHaveProp('accessible', true);
    fireEvent(header, 'accessibilityAction', {
      nativeEvent: { actionName: 'confirm' },
    });

    await waitFor(async () =>
      expect((await benchSets())[2]).toMatchObject({ weightValue: '82.5', repsValue: '6', performanceStatus: null })
    );
    // The cursor moved on: the swipe shell now sits on set 4, not 3.
    await waitFor(() => expect(screen.queryByTestId('exercise-set-swipe-3')).toBeNull());
    expect(screen.getByTestId('exercise-set-swipe-4')).toBeTruthy();
  });

  it('confirming the last set from the swipe action adds the next one, ready in the logger', async () => {
    await openPage();

    // Confirm sets 3 and 4 through the logger's action; the logger follows the
    // cursor, leaving set 5 the in-progress one.
    fireEvent(screen.getByTestId('exercise-set-logger-header'), 'accessibilityAction', {
      nativeEvent: { actionName: 'confirm' },
    });
    await waitFor(async () => expect((await benchSets())[2]?.performanceStatus).toBeNull());
    fireEvent(screen.getByTestId('exercise-set-logger-header'), 'accessibilityAction', {
      nativeEvent: { actionName: 'confirm' },
    });
    await waitFor(async () => expect((await benchSets())[3]?.performanceStatus).toBeNull());

    fireEvent(screen.getByTestId('exercise-set-logger-header'), 'accessibilityAction', {
      nativeEvent: { actionName: 'confirm' },
    });

    // The deterministic continuation of confirming the last set is Add set:
    // a fresh unperformed row with the copied values, open in the logger.
    await waitFor(async () => expect(await benchSets()).toHaveLength(6));
    expect((await benchSets())[5]).toMatchObject({
      weightValue: '85',
      repsValue: '5',
      performanceStatus: 'unperformed',
    });
    expect(screen.getByTestId('exercise-set-swipe-6')).toBeTruthy();
  });

  it('drops a planned set back to its plan, dismissing the keyboard and navigating nowhere', async () => {
    await openPage();
    const dismiss = jest.spyOn(Keyboard, 'dismiss');

    fireEvent.changeText(screen.getByTestId('exercise-set-logger-weight'), '90');
    fireEvent(screen.getByTestId('exercise-set-logger-header'), 'accessibilityAction', {
      nativeEvent: { actionName: 'discard' },
    });

    // The typed entry is gone from the draft; the logger reads the set's plan
    // again, the shell stays on the same set, and nothing navigated — dropping
    // never goes to the previous set or screen.
    expect(dismiss).toHaveBeenCalled();
    await waitFor(async () => expect((await benchSets())[2]?.weightValue).toBe(''));
    await waitFor(() =>
      expect(screen.getByTestId('exercise-set-logger-weight').props.value).toBe('82.5')
    );
    expect(await benchSets()).toHaveLength(5);
    expect(screen.getByTestId('exercise-set-swipe-3')).toBeTruthy();
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('drops an ad-hoc set by removing it, the logger falling back to the cursor', async () => {
    await openPage();

    // Add set opens Set 6, ad hoc, with the copied values.
    fireEvent.press(screen.getByTestId('exercise-add-set'));
    await waitFor(async () => expect(await benchSets()).toHaveLength(6));
    expect(within(screen.getByTestId('exercise-set-logger-header')).getByText('Set 6')).toBeTruthy();

    fireEvent(screen.getByTestId('exercise-set-logger-header'), 'accessibilityAction', {
      nativeEvent: { actionName: 'discard' },
    });

    await waitFor(async () => expect(await benchSets()).toHaveLength(5));
    expect(screen.queryByTestId('exercise-set-6')).toBeNull();
    expect(within(screen.getByTestId('exercise-set-logger-header')).getByText('Set 3')).toBeTruthy();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('carries the swipes on the open row only, not on the cursor row as well', async () => {
    await openPage();

    // Set 3 is the cursor; tapping Set 4's body opens it in the logger.
    fireEvent.press(screen.getByTestId('exercise-set-4-open'));
    await waitFor(() =>
      expect(within(screen.getByTestId('exercise-set-logger-header')).getByText('Set 4')).toBeTruthy()
    );
    expect(screen.getByTestId('exercise-set-swipe-4')).toBeTruthy();
    expect(screen.queryByTestId('exercise-set-swipe-3')).toBeNull();
    // The collapsed cursor row offers no swipe equivalents; the reorder moves
    // stay on it, as on every closed row.
    expect(screen.getByTestId('exercise-set-3-open').props.accessibilityActions).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'move-earlier' })]),
    );

    // Confirming the open row commits Set 4, leaving Set 3 as it was.
    fireEvent(screen.getByTestId('exercise-set-logger-header'), 'accessibilityAction', {
      nativeEvent: { actionName: 'confirm' },
    });
    await waitFor(async () => expect((await benchSets())[3]?.performanceStatus).toBeNull());
    expect((await benchSets())[2]?.performanceStatus).toBe('planned');
    expect(await benchSets()).toHaveLength(5);
  });

  it('measures a completed session being edited against the sessions before it only', async () => {
    await seedPage();
    // The older history session is edited; the newer one came after it, so
    // nothing counts yet, as on the session view's record band.
    render(<ExercisePageScreen sessionExerciseId={`${OLDER_HISTORY}_bench`} sessionId={OLDER_HISTORY} />);
    await screen.findByTestId('exercise-page');

    fireEvent.press(screen.getByTestId('exercise-records-toggle'));
    expect(await screen.findByTestId('exercise-records-empty')).toHaveTextContent(
      'No completed sessions with this exercise yet.'
    );
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

  it('preserves hidden prescribed effort while updating the mounted picker and cycle', async () => {
    await openPage();
    const saved = await benchSets();
    expect(saved[2].plannedSetType).toBe('rir_1');
    act(() => updatePreferences({ displayEfforts: ['warm_up', 'unspecified', 'rir_4', 'rir_0'] }));
    expect(screen.getByTestId('exercise-set-logger-effort')).toHaveTextContent('EffortRIR 1');
    expect((await benchSets())[2]).toMatchObject(saved[2]);
    fireEvent(screen.getByTestId('exercise-set-logger-effort'), 'longPress');
    expect(screen.queryByTestId('exercise-effort-option-rir_1')).toBeNull();
    expect(screen.getByTestId('exercise-effort-option-rir_4')).toBeTruthy();
    fireEvent.press(screen.getByTestId('exercise-effort-sheet-backdrop', { includeHiddenElements: true }));
    fireEvent.press(screen.getByTestId('exercise-set-logger-effort'));
    expect(screen.getByLabelText('Change effort, currently W-Up')).toBeTruthy();
    fireEvent.press(screen.getByTestId('exercise-set-logger-effort'));
    fireEvent.press(screen.getByTestId('exercise-set-logger-effort'));
    expect(screen.getByLabelText('Change effort, currently RIR 4')).toBeTruthy();
    // Historical records remain based on every confirmed non-warm-up set.
    fireEvent.press(screen.getByTestId('exercise-records-toggle'));
    expect(screen.getByTestId('exercise-record-vol')).toHaveTextContent(/Vol2080.*4 sets/);
    expect(screen.getByTestId('exercise-record-1rm')).toHaveTextContent(/^1RM102\.1/);
    await waitFor(async () => expect((await benchSets())[2].setType).toBe('rir_4'));
  });

  it.each([
    ['technique', 'Technique', 'Tech'],
    ['cooldown', 'Cooldown', 'CD'],
  ])('shows a compact %s label in the logger and keeps its full accessible and picker names', async (setType, fullLabel, compactLabel) => {
    await openPage();
    fireEvent(screen.getByTestId('exercise-set-logger-effort'), 'longPress');
    const option = await screen.findByTestId(`exercise-effort-option-${setType}`);
    expect(option).toHaveTextContent(fullLabel);
    fireEvent.press(option);

    expect(screen.getByTestId('exercise-set-logger-effort')).toHaveTextContent(`Effort${compactLabel}`);
    expect(screen.getByLabelText(`Change effort, currently ${fullLabel}`)).toBeTruthy();
    await waitFor(async () => expect((await benchSets())[2].setType).toBe(setType));
  });

  it('cycles effort in descending RIR order, including blank, and persists the selection', async () => {
    await openPage();
    for (const label of ['RIR 0', 'Technique', 'Cooldown', 'W-Up', 'none', 'RIR 4', 'RIR 3', 'RIR 2', 'RIR 1']) {
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
    // The newer session holds the 1RM (80 × 8) and heaviest weight; the older one the
    // volume, working sets only (its 60 × 8 warm-up is left out).
    expect(screen.getByTestId('exercise-record-1rm')).toHaveTextContent(new RegExp(`^1RM102\\.1${DATE} · 80\\.0 × 8$`));
    expect(screen.getByTestId('exercise-record-max')).toHaveTextContent(new RegExp(`^Max82\\.5${DATE} · 6 reps$`));
    expect(screen.getByTestId('exercise-record-vol')).toHaveTextContent(new RegExp(`^Vol2080${DATE} · 4 sets$`));

    fireEvent.press(screen.getByTestId('exercise-records-view-last'));
    const last = screen.getByTestId('exercise-records-last');
    expect(within(last).getByText('1RM 102.1 · VOL 1775')).toBeTruthy();
    // Working sets only in the figures; the warm-up keeps its line (and its 1RM).
    expect(screen.getByTestId('exercise-records-last-set-0')).toHaveTextContent(/^W-Up60\.0 × 10/);
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
    expect(screen.getByTestId('exercise-records-vol')).toHaveTextContent('Vol2080');
    fireEvent.press(screen.getByTestId('exercise-records-view-last'));
    expect(screen.getByTestId('exercise-records-collapsed')).toBeTruthy();
    expect(screen.getByTestId('exercise-records-1rm')).toHaveTextContent('1RM102.1');
    expect(screen.getByTestId('exercise-records-max')).toHaveTextContent('Max82.5');
    expect(screen.getByTestId('exercise-records-vol')).toHaveTextContent('Vol1775');
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

  it.each(['add', 'swipe'] as const)('uses visible default effort for a new set through %s', async (action) => {
    await openPage();
    fireEvent.press(screen.getByTestId('exercise-add-set'));
    await waitFor(async () => expect(await benchSets()).toHaveLength(6));
    fireEvent(screen.getByTestId('exercise-set-logger-effort'), 'longPress');
    fireEvent.press(await screen.findByTestId('exercise-effort-option-rir_3'));
    await waitFor(async () => expect((await benchSets())[5].setType).toBe('rir_3'));
    act(() => updatePreferences({ displayEfforts: ['warm_up', 'unspecified', 'rir_4', 'rir_2', 'rir_0'] }));
    if (action === 'add') fireEvent.press(screen.getByTestId('exercise-add-set'));
    else fireEvent(screen.getByTestId('exercise-set-logger-header'), 'accessibilityAction', {
      nativeEvent: { actionName: 'confirm' },
    });
    await waitFor(async () => expect(await benchSets()).toHaveLength(7));
    const saved = await benchSets();
    expect(saved[5].setType).toBe('rir_3');
    expect(saved[6]).toMatchObject({ setType: 'rir_2', performanceStatus: 'unperformed' });
    expect(screen.getByLabelText('Change effort, currently RIR 2')).toBeTruthy();
  });

  it('uses the first visible choice when inherited effort has no harder visible RIR', async () => {
    await openPage();
    act(() => updatePreferences({ displayEfforts: ['rir_4', 'rir_2'] }));
    fireEvent.press(screen.getByTestId('exercise-add-set'));
    await waitFor(async () => expect(await benchSets()).toHaveLength(6));
    expect((await benchSets())[5].setType).toBe('rir_4');
    expect(screen.getByLabelText('Change effort, currently RIR 4')).toBeTruthy();
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

    // The Link screen opens after the page's pending edits are written,
    // so the push resolves through the flush.
    await waitFor(() =>
      expect(mockRouter.push).toHaveBeenCalledWith(`/exercise-link?exerciseDefinitionId=${BENCH_DEF}`)
    );
    expect(screen.queryByTestId('exercise-options-sheet')).toBeNull();
  });

  it('writes pending edits before opening the Link screen, leaving the session as it reads', async () => {
    mockLinkingUserId = 'user-1';
    await openPage();

    // Typed values ride the autosave debounce; linking must not leave them
    // behind (the Link screen leaves the session untouched).
    fireEvent.changeText(screen.getByTestId('exercise-set-logger-weight'), '90');
    fireEvent.press(screen.getByTestId('exercise-page-options'));
    fireEvent.press(await screen.findByTestId('exercise-options-link-group'));

    await waitFor(() =>
      expect(mockRouter.push).toHaveBeenCalledWith(`/exercise-link?exerciseDefinitionId=${BENCH_DEF}`)
    );
    expect((await benchSets())[2]).toMatchObject({ weightValue: '90' });
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

  it('opens swap as a page sheet whose X leaves the exercise unchanged', async () => {
    await openPage();

    fireEvent.press(screen.getByTestId('exercise-page-options'));
    fireEvent.press(await screen.findByTestId('exercise-options-swap'));
    await screen.findByTestId('exercise-swap-sheet');
    expect(screen.getByTestId('exercise-swap-sheet-modal')).toHaveProp('presentationStyle', 'pageSheet');
    fireEvent.press(screen.getByLabelText('Close swap exercise'));

    await waitFor(() => expect(screen.queryByTestId('exercise-swap-sheet')).toBeNull());
    expect(screen.getByTestId('exercise-page-title')).toHaveTextContent('Barbell Bench Press');
    expect((await readSession())?.exercises[0]).toMatchObject({ exerciseDefinitionId: BENCH_DEF });
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

    // Only the newer session counts: its 1775 volume, not the older one's 2080.
    expect(screen.getByTestId('exercise-records-vol')).toHaveTextContent('Vol1775');
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

describe('exercise page set reordering', () => {
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

  const liveSetIds = async () => (await benchSets()).map((set) => set.id);

  const rowActionNames = (setNumber: number) => {
    const actions = screen.getByTestId(`exercise-set-${setNumber}-open`).props.accessibilityActions ?? [];
    return actions.map((action: { name: string }) => action.name);
  };

  // A save that always fails: the flush failure path, with every read real.
  const failingSaveClient = (): SessionExerciseDraftClient => ({
    ...defaultSessionExerciseDraftClient,
    persistSessionDraftSnapshot: async () => {
      throw new Error('disk full');
    },
  });

  it('every closed row carries a quiet grab handle and the Move actions; the open row and a one-set card carry none', async () => {
    await openPage();

    for (const setNumber of [1, 2, 4, 5]) {
      expect(screen.getByTestId(`exercise-set-${setNumber}-reorder-handle`)).toBeTruthy();
      expect(screen.getByLabelText(`Reorder set ${setNumber}`)).toBeTruthy();
    }
    // The open row is mid-edit: its reorder is the logger's actions.
    expect(screen.queryByTestId('exercise-set-3-reorder-handle')).toBeNull();
    // Boundary rows: the first cannot move earlier, the last cannot move later.
    expect(rowActionNames(1)).toEqual(['move-later']);
    expect(rowActionNames(2)).toEqual(['move-earlier', 'move-later']);
    expect(rowActionNames(5)).toEqual(['move-earlier']);
    // The open row moves through the logger's actions, not a drag.
    expect(screen.getByTestId('exercise-set-logger-header').props.accessibilityActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'move-earlier' }),
        expect.objectContaining({ name: 'move-later' }),
      ]),
    );

    // One set: nothing to reorder, so no handle chrome.
    render(<ExercisePageScreen sessionExerciseId={SQUAT} sessionId={SESSION} />);
    await screen.findByTestId('exercise-page');
    expect(screen.queryByLabelText(/Reorder set/)).toBeNull();
  });

  it('Move earlier writes the permutation through the reorder operation and reads it back', async () => {
    await openPage();
    const before = await liveSetIds();
    expect(before).toHaveLength(5);

    const row = screen.getByTestId('exercise-set-2-open');
    act(() => {
      fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'move-earlier' } });
    });

    await waitFor(async () => {
      expect(await liveSetIds()).toEqual([before[1], before[0], before[2], before[3], before[4]]);
    });
    expect(screen.getByTestId('exercise-set-reorder-announcement')).toHaveTextContent('Set moved to position 1 of 5');
    // Provenance and values ride along untouched: same rows, new order only.
    const beforeById = new Map((await benchSets()).map((set) => [set.id, set]));
    const after = await benchSets();
    expect(after.map((set) => set.weightValue)).toEqual(
      [before[1], before[0], before[2], before[3], before[4]].map((id) => beforeById.get(id)?.weightValue),
    );
  });

  it('a failed flush leaves the persisted order untouched and says so', async () => {
    await seedPage();
    render(
      <ExercisePageScreen
        draftClient={failingSaveClient()}
        sessionExerciseId={BENCH}
        sessionId={SESSION}
      />
    );
    await screen.findByTestId('exercise-page');
    await waitFor(() => expect(screen.getByTestId('exercise-records-1rm')).toHaveTextContent('1RM102.1'));
    const before = await liveSetIds();

    // A pending typed edit makes the flush a real write, which fails.
    fireEvent.press(screen.getByTestId('exercise-set-1-open'));
    await screen.findByTestId('exercise-set-logger');
    fireEvent.changeText(screen.getByTestId('exercise-set-logger-weight'), '55');

    const row = screen.getByTestId('exercise-set-2-open');
    act(() => {
      fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'move-earlier' } });
    });

    await waitFor(() => {
      expect(screen.getByTestId('exercise-set-reorder-announcement')).toHaveTextContent(
        'Not saved. The previous order stays.'
      );
    });
    expect(await liveSetIds()).toEqual(before);
  });

  it('clears the drag overlay and announces failure when reorder write throws', async () => {
    await openPage();
    const before = await liveSetIds();
    (sessionPlanner.reorderSessionExerciseSets as jest.Mock).mockRejectedValueOnce(new Error('SQLITE_FULL'));

    const row = screen.getByTestId('exercise-set-2-open');
    act(() => {
      fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'move-earlier' } });
    });

    await waitFor(() => {
      expect(screen.getByTestId('exercise-set-reorder-announcement')).toHaveTextContent(
        "Couldn't save the new order. The previous order stays."
      );
    });
    expect(await liveSetIds()).toEqual(before);
  });

  it('serializes set reordering with draft edits so draft reload does not undo reorder', async () => {
    await openPage();
    const before = await liveSetIds();

    let resolveReorder: (val: any) => void;
    const reorderPromise = new Promise((resolve) => {
      resolveReorder = resolve;
    });

    (sessionPlanner.reorderSessionExerciseSets as jest.Mock).mockImplementationOnce(
      () => reorderPromise as any
    );

    // Trigger reorder [before[1], before[0], ...]
    const row = screen.getByTestId('exercise-set-2-open');
    act(() => {
      fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'move-earlier' } });
    });

    // While reorder is in flight, edit set 1 weight
    fireEvent.press(screen.getByTestId('exercise-set-1-open'));
    await screen.findByTestId('exercise-set-logger');
    fireEvent.changeText(screen.getByTestId('exercise-set-logger-weight'), '55');

    // Resolve reorder write in database
    await act(async () => {
      const realResult = await jest.requireActual('@/src/session-planner').reorderSessionExerciseSets(
        BENCH,
        [before[1], before[0], before[2], before[3], before[4]]
      );
      resolveReorder!(realResult);
    });

    await waitFor(async () => {
      expect(await liveSetIds()).toEqual([before[1], before[0], before[2], before[3], before[4]]);
    });

    // Wait for the queued draft edit to flush
    await waitFor(async () => {
      const sets = await benchSets();
      const set1 = sets.find((s) => s.id === before[0]);
      expect(set1?.weightValue).toBe('55');
      expect(sets.map((s) => s.id)).toEqual([before[1], before[0], before[2], before[3], before[4]]);
    });
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
