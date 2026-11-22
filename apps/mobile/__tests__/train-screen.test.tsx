/* eslint-disable import/first */

/**
 * The Train tab over real data: the production route, its one-row
 * active-session check and the shared session-entry coordinator over the
 * migrated in-memory SQLite
 * database (helpers/local-data.ts), seeded with the `session-view` Maestro
 * fixture where a workout is in progress. Started sessions are read back from
 * the database. Only the native database open, the focus hook and the session
 * view (`session-view-screen.test.tsx` owns it) are replaced: the stand-in
 * names the workout Train shows and ends it when pressed.
 *
 * Planning uses real scheduled plans; isolated launch-state tests use the
 * `planningState` prop with a materializer that writes a real draft.
 * Named states real data cannot produce: a launch still pending,
 * a failed draft write, a failed plan write and a failed active-session read.
 */

import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react-native';
import { AppState, StyleSheet, type AppStateStatus } from 'react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

const mockDismissTo = jest.fn();
const mockPush = jest.fn();
const mockRouter = { dismissTo: mockDismissTo, push: mockPush };
let mockIsFocused = true;

jest.mock('expo-router', () => ({
  useIsFocused: () => mockIsFocused,
  useRouter: () => mockRouter,
}));

jest.mock('@/components/session-view/session-view-screen', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { Pressable, View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    SessionViewScreen: ({ onEnded, placement, sessionId }: { onEnded: (moment: string) => void; placement: string; sessionId: string }) =>
      createElement(View, { accessibilityLabel: `${placement} workout ${sessionId}`, testID: 'train-workout' },
        createElement(Pressable, { onPress: () => onEnded('now'), testID: 'train-workout-abandon' }),
        createElement(Pressable, { onPress: () => onEnded('on-return'), testID: 'train-workout-finish' })),
  };
});

import TrainRoute, { TrainScreen, type TrainPlanningState } from '../app/(tabs)/train';
import { planQueries, planRepository, startSessionPlan } from '@/src/session-planner';
import { updatePreferences } from '@/src/preferences/hooks';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import { useOpenActiveWorkout } from '@/components/navigation/use-open-main-tab';
import { uiFonts, uiTypography } from '@/components/ui/tokens';
import { DEFAULT_APPEARANCE } from '@/components/ui/theme-presets';
import { renderWithTheme, rolesFor } from './helpers/theme';

const roles = rolesFor(DEFAULT_APPEARANCE);
import * as sessionDrafts from '@/src/data/session-drafts';
import * as sessionList from '@/src/data/session-list';
import { listSessionListBuckets, setSessionDeletedState } from '@/src/data/session-list';
import { SESSION_VIEW_FIXTURE } from '@/src/maestro/session-view-fixture';
import { createDrizzleSessionPlanStore } from '@/src/data/session-plan-store';
import type { SessionEntryCoordinator } from '@/src/session-entry';
import {
  bootLocalApp,
  closeLocalData,
  loadMaestroFixture,
  localDataClient,
  resetLocalData,
} from './helpers/local-data';

const ACTIVE = SESSION_VIEW_FIXTURE.sessionId;

const seed = async (fixture?: 'session-view') => {
  if (fixture) await loadMaestroFixture(fixture);
  await bootLocalApp();
};

const isBusy = () => screen.getByTestId('train-start-empty-button').props.accessibilityState.busy;
const checked = () => waitFor(() => expect(isBusy()).toBe(false));

const openTrain = async (fixture?: 'session-view') => {
  await seed(fixture);
  renderWithTheme(<TrainRoute />);
  await checked();
  if (!fixture) {
    await waitFor(() => {
      expect(
        screen.queryByTestId('train-manage-planning-button') ||
          screen.queryByTestId('train-planning-section') ||
          screen.queryByTestId('train-planning-error'),
      ).toBeTruthy();
    });
  }
};

// The workout Train shows in place of its disc, as `<placement> workout <id>`.
const shownWorkout = () => screen.queryByTestId('train-workout')?.props.accessibilityLabel ?? null;

const activeSessionId = async () => (await listSessionListBuckets()).active?.id ?? null;
const activeSessionCount = () =>
  (
    localDataClient()
      .prepare("SELECT COUNT(*) AS n FROM sessions WHERE status = 'active' AND deleted_at IS NULL")
      .get() as { n: number }
  ).n;

// A plan's materializer: writes the planned draft through the app's own path.
const plannedDraft = () =>
  sessionDrafts.persistSessionDraftSnapshot({
    sessionId: 'planned-session',
    gymId: null,
    startedAt: new Date(),
    status: 'active',
    exercises: [
      {
        id: 'planned-session-bench',
        exerciseDefinitionId: 'seed_barbell_bench_press',
        name: 'Barbell Bench Press',
        sets: [
          {
            id: 'planned-session-bench-1',
            weightValue: '',
            repsValue: '',
            setType: null,
            plannedWeightValue: '100',
            plannedRepsValue: '5',
            plannedSetType: 'rir_2',
            performanceStatus: 'planned',
          },
        ],
      },
    ],
  });

const readyPlan = (overrides: Partial<Extract<TrainPlanningState, { status: 'ready' }>> = {}): TrainPlanningState => ({
  status: 'ready',
  title: 'Upper body',
  scheduledFor: new Date(2026, 9, 11, 8),
  detail: 'Bench press',
  materialize: jest.fn(plannedDraft),
  openManager: jest.fn(),
  ...overrides,
});

const renderWithPlan = async (planningState: TrainPlanningState, sessionEntry?: SessionEntryCoordinator) => {
  renderWithTheme(<TrainScreen planningState={planningState} {...(sessionEntry ? { sessionEntry } : {})} />);
  await checked();
};

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 9, 10, 12), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'performance', 'queueMicrotask', 'hrtime'] });
  resetLocalData();
  mockIsFocused = true;
  mockDismissTo.mockClear();
  mockPush.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
  closeLocalData();
  jest.useRealTimers();
});

describe('Train over real data', () => {
  it('opens on the disc alone: no title, no copy, no planning placeholder', async () => {
    await openTrain();

    expect(screen.queryByRole('header')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start workout' })).toBe(screen.getByTestId('train-start-empty-button'));
    expect(screen.getByTestId('train-start-empty-button')).toHaveTextContent('Start');
    expect(screen.queryByTestId('train-planning-section')).toBeNull();
    expect(screen.getByTestId('train-manage-planning-button')).toHaveTextContent('Plan a workout');

    fireEvent.press(screen.getByTestId('train-manage-planning-button'));
    expect(mockPush).toHaveBeenCalledWith('/planner');
  });

  it('checks for a workout with one row, never the whole session history', async () => {
    const history = jest.spyOn(sessionList, 'listSessionListBuckets');
    const oneRow = jest.spyOn(sessionList, 'findActiveSessionId');
    await openTrain();

    expect(oneRow).toHaveBeenCalledTimes(1);
    expect(history).not.toHaveBeenCalled();
  });

  it('is the workout in progress: the session view in place of the disc, offering no button for it', async () => {
    await seed('session-view');
    renderWithTheme(<TrainRoute />);

    await waitFor(() => expect(shownWorkout()).toBe(`tab workout ${ACTIVE}`));
    expect(screen.queryByTestId('train-start-empty-button')).toBeNull();
    expect(screen.queryByRole('button', { name: /resume/i })).toBeNull();
  });

  it('waits for focus before reading for a workout in progress', async () => {
    await seed('session-view');
    renderWithTheme(<TrainScreen isFocused={false} />);
    await act(async () => undefined);

    expect(shownWorkout()).toBeNull();
    expect(isBusy()).toBe(true);
  });

  it('keeps the workout shown while a focus re-reads it, and shows the disc once it was abandoned', async () => {
    await seed('session-view');
    const view = renderWithTheme(<TrainScreen isFocused />);
    await waitFor(() => expect(shownWorkout()).toBe(`tab workout ${ACTIVE}`));

    view.rerender(<TrainScreen isFocused={false} />);
    await setSessionDeletedState(ACTIVE, true);
    view.rerender(<TrainScreen isFocused />);
    // Returning to Train never blanks the workout while the read is in flight.
    expect(shownWorkout()).toBe(`tab workout ${ACTIVE}`);
    await checked();

    expect(shownWorkout()).toBeNull();
  });

  it('keeps the workout shown when a focus re-read fails', async () => {
    await seed('session-view');
    const view = renderWithTheme(<TrainScreen isFocused />);
    await waitFor(() => expect(shownWorkout()).toBe(`tab workout ${ACTIVE}`));
    jest.spyOn(sessionList, 'findActiveSessionId').mockRejectedValueOnce(new Error('Unable to read sessions'));

    view.rerender(<TrainScreen isFocused={false} />);
    view.rerender(<TrainScreen isFocused />);
    await act(async () => undefined);

    expect(shownWorkout()).toBe(`tab workout ${ACTIVE}`);
  });

  it('shows a workout opened from a page over the tabs at once, before re-reading', async () => {
    // The opener lives on another page; `screen` follows the Train render below.
    const { result } = renderHook(() => useOpenActiveWorkout());
    await openTrain();

    act(() => result.current('opened-elsewhere'));

    expect(shownWorkout()).toBe('tab workout opened-elsewhere');
  });

  it('opens the chosen older workout when Train has not mounted yet', async () => {
    await seed('session-view');
    localDataClient().prepare("insert into sessions(id,status,started_at,created_at,updated_at) values('newest-active','active',1,1,9999999999999)").run();
    const { result } = renderHook(() => useOpenActiveWorkout());
    act(() => result.current(ACTIVE));
    renderWithTheme(<TrainScreen isFocused />);
    await waitFor(() => expect(shownWorkout()).toBe(`tab workout ${ACTIVE}`));
    // Flush the initial default lookup too; it must not replace the queued choice.
    await act(async () => undefined);
    expect(shownWorkout()).toBe(`tab workout ${ACTIVE}`);
    expect(activeSessionCount()).toBe(2);
  });

  it('keeps the explicitly selected active workout through focus when another active workout is newer', async () => {
    const { result } = renderHook(() => useOpenActiveWorkout());
    await seed('session-view');
    const db = localDataClient();
    db.prepare("insert into sessions(id,status,started_at,created_at,updated_at) values('second-active','active',1,1,9999999999999)").run();
    const view = renderWithTheme(<TrainScreen isFocused />);
    await waitFor(() => expect(shownWorkout()).toBe('tab workout second-active'));
    view.rerender(<TrainScreen isFocused={false} />);
    act(() => result.current(ACTIVE));
    view.rerender(<TrainScreen isFocused />);
    await waitFor(() => expect(shownWorkout()).toBe(`tab workout ${ACTIVE}`));
    expect(await sessionList.findActiveSessionId(ACTIVE)).toBe(ACTIVE);
    expect(activeSessionCount()).toBe(2);
  });

  it('keeps a resumed workout visible when focus returns after its earlier Finish', async () => {
    const { result } = renderHook(() => useOpenActiveWorkout());
    await seed('session-view');
    const view = renderWithTheme(<TrainScreen isFocused />);
    await waitFor(() => expect(shownWorkout()).toBe(`tab workout ${ACTIVE}`));
    fireEvent.press(screen.getByTestId('train-workout-finish'));
    view.rerender(<TrainScreen isFocused={false} />);
    act(() => result.current(ACTIVE));
    view.rerender(<TrainScreen isFocused loadActiveSessionId={() => new Promise(() => undefined)} />);
    expect(shownWorkout()).toBe(`tab workout ${ACTIVE}`);
    expect(screen.queryByTestId('train-start-empty-button')).toBeNull();
  });

  it('returns to the disc at once, ready to start, when the workout is abandoned', async () => {
    await seed('session-view');
    renderWithTheme(<TrainRoute />);
    await waitFor(() => expect(shownWorkout()).toBe(`tab workout ${ACTIVE}`));

    fireEvent.press(screen.getByTestId('train-workout-abandon'));

    expect(shownWorkout()).toBeNull();
    expect(isBusy()).toBe(false);
  });

  it("keeps a finished workout under Finish's summary, and shows the disc once Train is back", async () => {
    await seed('session-view');
    const view = renderWithTheme(<TrainScreen isFocused />);
    await waitFor(() => expect(shownWorkout()).toBe(`tab workout ${ACTIVE}`));

    // The summary fades in over Train: nothing beneath may change.
    fireEvent.press(screen.getByTestId('train-workout-finish'));
    expect(shownWorkout()).toBe(`tab workout ${ACTIVE}`);
    view.rerender(<TrainScreen isFocused={false} />);
    expect(shownWorkout()).toBe(`tab workout ${ACTIVE}`);
    await setSessionDeletedState(ACTIVE, true);

    view.rerender(<TrainScreen isFocused />);
    expect(shownWorkout()).toBeNull();
    await checked();
    expect(shownWorkout()).toBeNull();
  });

  it('starts one empty draft on a double tap, the disc unchanged, and shows its session view', async () => {
    await openTrain();
    const before = screen.getByTestId('train-start-empty-button').props.style;

    const action = screen.getByTestId('train-start-empty-button');
    fireEvent.press(action);
    fireEvent.press(action);
    expect(screen.getByTestId('train-start-empty-button')).toHaveTextContent('Start');
    expect(StyleSheet.flatten(screen.getByTestId('train-start-empty-button').props.style)).toEqual(StyleSheet.flatten(before));

    await waitFor(() => expect(shownWorkout()).not.toBeNull());
    const started = await activeSessionId();
    expect(started).not.toBeNull();
    expect(shownWorkout()).toBe(`tab workout ${started}`);
    expect(activeSessionCount()).toBe(1);
    expect(await sessionDrafts.loadSessionSnapshotById(started!)).toMatchObject({ status: 'active', exercises: [] });
  });

  it('starts a fresh workout once the one in progress was discarded', async () => {
    await seed('session-view');
    await setSessionDeletedState(ACTIVE, true);
    renderWithTheme(<TrainRoute />);
    await checked();

    fireEvent.press(screen.getByTestId('train-start-empty-button'));

    await waitFor(() => expect(shownWorkout()).not.toBeNull());
    const started = await activeSessionId();
    expect(started).not.toBe(ACTIVE);
    expect(shownWorkout()).toBe(`tab workout ${started}`);
  });

  it('shows the workout in progress rather than offering a plan', async () => {
    const plan = readyPlan({ title: 'Lower body', detail: '4 exercises' });
    await seed('session-view');
    renderWithTheme(<TrainScreen planningState={plan} />);

    await waitFor(() => expect(shownWorkout()).toBe(`tab workout ${ACTIVE}`));
    expect(screen.queryByTestId('train-start-planned-button')).toBeNull();
    expect(screen.queryByTestId('train-manage-planning-button')).toBeNull();
    expect(await activeSessionId()).toBe(ACTIVE);
    expect(plan.status === 'ready' && plan.materialize).not.toHaveBeenCalled();
  });

  it('shows a failed empty start inline and keeps it retryable (a failed write)', async () => {
    jest.spyOn(sessionDrafts, 'persistSessionDraftSnapshot').mockRejectedValueOnce(new Error('write failed'));
    await openTrain();

    fireEvent.press(screen.getByTestId('train-start-empty-button'));

    expect(await screen.findByTestId('train-empty-launch-error')).toHaveTextContent("Couldn't start. Try again.");
    expect(StyleSheet.flatten(screen.getByTestId('train-empty-launch-error').props.style)).toMatchObject({
      fontFamily: uiFonts.body.family, fontWeight: '600', fontSize: uiTypography.size.base, color: roles.danger, textAlign: 'center',
    });
    expect(await activeSessionId()).toBeNull();

    fireEvent.press(screen.getByTestId('train-start-empty-button'));
    await waitFor(() => expect(shownWorkout()).not.toBeNull());
    expect(await activeSessionId()).not.toBeNull();
  });

  it('keeps the disc for an empty workout and lists a ready plan beneath it, with management', async () => {
    const plan = readyPlan();
    await seed();
    await renderWithPlan(plan);

    expect(screen.getByTestId('train-start-empty-button')).toHaveTextContent('Start');
    expect(screen.getByTestId('train-planned-session-card')).toHaveTextContent('Upper body11 Oct 26 · Bench pressStart');
    // The plan reads as a list row: a micro-label above, its title in
    // bodyStrong and its detail in meta.
    expect(StyleSheet.flatten(screen.getByText('Planned').props.style)).toMatchObject({
      fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs, textTransform: 'uppercase',
    });
    expect(StyleSheet.flatten(screen.getByText('Upper body').props.style)).toMatchObject({
      fontFamily: uiFonts.body.family, fontWeight: '600', fontSize: uiTypography.size.base,
    });
    expect(StyleSheet.flatten(screen.getByLabelText('11-10-2026 · Bench press').props.style)).toMatchObject({
      fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm, color: roles.inkMuted,
    });
    fireEvent.press(screen.getByRole('button', { name: 'Start Upper body' }));

    fireEvent.press(screen.getByTestId('train-manage-planning-button'));
    expect(plan.status === 'ready' && plan.openManager).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(shownWorkout()).toBe('tab workout planned-session'));
    expect(await activeSessionId()).toBe('planned-session');
  });

  it('loads upcoming plan from database on TrainRoute, displaying 1-tap start and linking manage planning to /planner', async () => {
    await seed();
    const store = createDrizzleSessionPlanStore();
    await store.savePlanGraph(
      {
        title: 'Heavy Deadlift Day',
        gymId: null,
        scheduledFor: new Date(2026, 9, 11, 10),
        exercises: [
          {
            exerciseDefinitionId: 'seed_barbell_bench_press',
            name: 'Bench Press',
            sets: [{ targetWeightValue: '100', targetReps: 5, targetSetType: null }],
          },
        ],
      },
      new Date(2026, 10, 4, 10),
    );

    renderWithTheme(<TrainRoute />);
    await checked();
    await waitFor(() => {
      expect(screen.queryByTestId('train-planned-session-card')).toBeTruthy();
    });

    expect(screen.getByTestId('train-planned-session-card')).toHaveTextContent('Heavy Deadlift Day11 Oct 26 · 1 exerciseStart');
    expect(screen.getByTestId('train-start-planned-button')).toBeTruthy();

    fireEvent.press(screen.getByTestId('train-manage-planning-button'));
    expect(mockPush).toHaveBeenCalledWith('/planner');

    fireEvent.press(screen.getByTestId('train-start-planned-button'));
    await waitFor(() => expect(shownWorkout()).not.toBeNull());
  });

  it('keeps a failed planned launch inline, leaving empty training usable (a failed plan write)', async () => {
    await seed();
    await renderWithPlan(readyPlan({ materialize: jest.fn().mockRejectedValue(new Error('stale plan')) }));

    fireEvent.press(screen.getByTestId('train-start-planned-button'));

    expect(await screen.findByTestId('train-planned-launch-error')).toHaveTextContent(
      "Couldn't start this plan. Try again.",
    );
    expect(StyleSheet.flatten(screen.getByTestId('train-planned-launch-error').props.style)).toMatchObject({
      fontFamily: uiFonts.body.family, fontWeight: '600', fontSize: uiTypography.size.base, color: roles.danger, textAlign: 'center',
    });
    expect(isBusy()).toBe(false);
    expect(await activeSessionId()).toBeNull();
  });

  it('does not offer a new workout when the active-session read fails, and retries (a failed read)', async () => {
    const load = jest
      .spyOn(sessionList, 'findActiveSessionId')
      .mockRejectedValueOnce(new Error('Unable to read sessions'));
    await seed();
    renderWithTheme(<TrainRoute />);

    expect(await screen.findByTestId('train-session-error')).toHaveTextContent(/Unable to read sessions/);
    expect(screen.queryByTestId('train-start-empty-button')).toBeNull();
    fireEvent.press(screen.getByTestId('train-session-error-retry'));

    await checked();
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('Train planning states', () => {
  const schedulePlan = (title: string, scheduledFor: Date) => createDrizzleSessionPlanStore().savePlanGraph({
    title, gymId: null, scheduledFor,
    exercises: [{ exerciseDefinitionId: 'seed_barbell_bench_press', name: 'Bench Press',
      sets: [{ targetWeightValue: '100', targetReps: 5, targetSetType: null }] }],
  }, new Date());

  it.each<[string, Date, Date, boolean]>([
    ['yesterday just before midnight', new Date(2026, 9, 10, 12), new Date(2026, 9, 9, 23, 59, 59, 999), false],
    ['today at midnight, before the current time', new Date(2026, 9, 10, 12), new Date(2026, 9, 10), true],
    ['the third day at its last millisecond', new Date(2026, 9, 10, 12), new Date(2026, 9, 13, 23, 59, 59, 999), true],
    ['the fourth day at midnight', new Date(2026, 9, 10, 12), new Date(2026, 9, 14), false],
    ['the third day across spring DST', new Date(2026, 2, 27, 12), new Date(2026, 2, 30, 23, 59), true],
    ['the fourth day across spring DST', new Date(2026, 2, 27, 12), new Date(2026, 2, 31), false],
    ['the third day across autumn DST', new Date(2026, 9, 23, 12), new Date(2026, 9, 26, 23, 59), true],
    ['the fourth day across year end', new Date(2026, 11, 29, 12), new Date(2027, 0, 2), false],
  ])('limits the Train suggestion to today and the next three local days: %s', async (_label, now, scheduledFor, visible) => {
    jest.setSystemTime(now);
    await seed();
    await schedulePlan('Scheduled workout', scheduledFor);

    renderWithTheme(<TrainRoute />);
    await checked();
    if (visible) {
      expect(await screen.findByText('Scheduled workout')).toBeTruthy();
    } else {
      expect(await screen.findByRole('button', { name: 'Plan a workout' })).toBeTruthy();
      expect(screen.queryByTestId('train-planned-session-card')).toBeNull();
    }
    // Train's suggestion window never removes schedules from the planner.
    expect(await planQueries.listUpcomingPlans()).toEqual([expect.objectContaining({ title: 'Scheduled workout', scheduledFor })]);
  });

  it('skips an overdue plan and offers the next eligible plan in the window', async () => {
    await seed();
    await schedulePlan('Overdue workout', new Date(2026, 9, 9, 23, 59));
    await schedulePlan('Next workout', new Date(2026, 9, 11, 8));

    renderWithTheme(<TrainRoute />);

    expect(await screen.findByText('Next workout')).toBeTruthy();
    expect(screen.queryByText('Overdue workout')).toBeNull();
  });

  it('shows a plan that enters the three-day window when Train is refocused the next day', async () => {
    await seed();
    await schedulePlan('Later workout', new Date(2026, 9, 14));
    const view = renderWithTheme(<TrainRoute />);
    expect(await screen.findByRole('button', { name: 'Plan a workout' })).toBeTruthy();

    mockIsFocused = false;
    view.rerender(<TrainRoute />);
    jest.setSystemTime(new Date(2026, 9, 11));
    mockIsFocused = true;
    view.rerender(<TrainRoute />);

    expect(await screen.findByText('Later workout')).toBeTruthy();
  });

  it('replaces an overdue suggestion at local midnight without a tab switch', async () => {
    await seed();
    await schedulePlan('Today workout', new Date(2026, 9, 10, 8));
    await schedulePlan('Later workout', new Date(2026, 9, 14, 8));
    jest.useFakeTimers({ now: new Date(2026, 9, 10, 23, 59), doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    renderWithTheme(<TrainRoute />);
    expect(await screen.findByText('Today workout')).toBeTruthy();

    await act(async () => { jest.advanceTimersByTime(60_000); });

    expect(await screen.findByText('Later workout')).toBeTruthy();
    expect(screen.queryByText('Today workout')).toBeNull();
  });

  it('refreshes the suggestion after the app was suspended into the next day', async () => {
    const listeners: ((state: AppStateStatus) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      listeners.push(listener);
      return { remove: jest.fn() };
    });
    await seed();
    await schedulePlan('Today workout', new Date(2026, 9, 10, 8));
    await schedulePlan('Later workout', new Date(2026, 9, 14, 8));
    renderWithTheme(<TrainRoute />);
    expect(await screen.findByText('Today workout')).toBeTruthy();

    act(() => listeners.forEach(listener => listener('background')));
    jest.setSystemTime(new Date(2026, 9, 11, 8));
    act(() => listeners.forEach(listener => listener('active')));

    expect(await screen.findByText('Later workout')).toBeTruthy();
    expect(screen.queryByText('Today workout')).toBeNull();
  });

  it('retries a failed planning read and shows the scheduled suggestion', async () => {
    await seed();
    await schedulePlan('Today workout', new Date(2026, 9, 10, 8));
    jest.spyOn(planQueries, 'listUpcomingPlans').mockRejectedValueOnce(new Error('Read failed'));
    renderWithTheme(<TrainRoute />);
    expect(await screen.findByTestId('train-planning-error')).toHaveTextContent(/Couldn't load your plans\./);

    fireEvent.press(screen.getByTestId('train-planning-error-retry'));

    expect(await screen.findByText('Today workout')).toBeTruthy();
  });

  it('keeps the scheduled date visible and spoken in the current date preference without remounting', async () => {
    await seed();
    await renderWithPlan(readyPlan());
    const formats: [ExerciseDateFormat, string, string][] = [
      ['DD-MM-YYYY', '11 Oct 26', '11-10-2026'],
      ['MM-DD-YYYY', 'Oct 11 26', '10-11-2026'],
      ['YYYY-MM-DD', '2026 Oct 11', '2026-10-11'],
    ];
    for (const [dateFormat, visible, spoken] of formats) {
      await act(async () => { updatePreferences({ dateFormat }); });
      expect(screen.getByTestId('train-planned-session-card')).toHaveTextContent(`Upper body${visible} · Bench pressStart`);
      expect(screen.getByLabelText(`${spoken} · Bench press`)).toBeTruthy();
    }
    await act(async () => { updatePreferences({ dateFormat: 'DD-MM-YYYY' }); });
  });

  it('shows nothing beneath the disc while planning loads', async () => {
    await seed();
    await renderWithPlan({ status: 'loading' });

    expect(screen.queryByTestId('train-planning-section')).toBeNull();
    expect(screen.queryByTestId('train-manage-planning-button')).toBeNull();
  });

  it('offers one Plan a workout link when nothing is planned', async () => {
    const openManager = jest.fn();
    await seed();
    await renderWithPlan({ status: 'empty', openManager });

    fireEvent.press(screen.getByRole('button', { name: 'Plan a workout' }));

    expect(openManager).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('train-start-planned-button')).toBeNull();
  });

  it('states a planning read error with Retry, leaving empty training usable', async () => {
    const retry = jest.fn();
    await seed();
    await renderWithPlan({ status: 'error', message: 'Plans are unreachable.', retry });

    expect(screen.getByTestId('train-planning-error')).toHaveTextContent(/Plans are unreachable\./);
    fireEvent.press(screen.getByTestId('train-planning-error-retry'));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(isBusy()).toBe(false);
  });
});

describe('Train launch states', () => {
  it('shows the same disc, ignoring presses, while it checks for a workout in progress', () => {
    const start = jest.fn();
    renderWithTheme(
      <TrainScreen
        loadActiveSessionId={() => new Promise(() => undefined)}
        sessionEntry={{ startFromExercise: jest.fn(), startEmptyOrResume: start, startPlannedOrResume: jest.fn(), resumeCompletedSession: jest.fn() }}
      />,
    );

    const disc = screen.getByTestId('train-start-empty-button');
    expect(isBusy()).toBe(true);
    expect(StyleSheet.flatten(disc.props.style).backgroundColor).toBe(roles.accent);
    fireEvent.press(disc);
    expect(start).not.toHaveBeenCalled();
  });

  it('ignores a planned start while an empty start is pending, relabelling nothing (a pending launch)', async () => {
    const pending: SessionEntryCoordinator = {
      startFromExercise: jest.fn(),
      resumeCompletedSession: jest.fn(),
      startEmptyOrResume: jest.fn(() => new Promise<never>(() => undefined)),
      startPlannedOrResume: jest.fn(() => new Promise<never>(() => undefined)),
    };
    await seed();
    await renderWithPlan(readyPlan(), pending);

    await act(async () => {
      fireEvent.press(screen.getByTestId('train-start-empty-button'));
    });
    fireEvent.press(screen.getByTestId('train-start-planned-button'));

    expect(pending.startPlannedOrResume).not.toHaveBeenCalled();
    expect(screen.getByTestId('train-start-planned-button')).toHaveTextContent('Start');
    expect(screen.getByTestId('train-start-empty-button')).toHaveTextContent('Start');
  });

  it('draws exactly one accent: the disc, a step smaller when a plan sits beneath it', async () => {
    const accentButtons = () =>
      ['train-start-empty-button', 'train-start-planned-button', 'train-manage-planning-button']
        .map((testID) => screen.queryByTestId(testID))
        .filter((node) => node && StyleSheet.flatten(node.props.style).backgroundColor === roles.accent)
        .map((node) => node?.props.testID);
    const discWidth = () => StyleSheet.flatten(screen.getByTestId('train-start-empty-button').props.style).width;

    await seed();
    await renderWithPlan(readyPlan());
    expect(accentButtons()).toEqual(['train-start-empty-button']);
    const compact = discWidth();
    screen.unmount();

    renderWithTheme(<TrainRoute />);
    await checked();
    await waitFor(() => {
      expect(screen.queryByTestId('train-manage-planning-button')).toBeTruthy();
    });
    expect(accentButtons()).toEqual(['train-start-empty-button']);
    expect(discWidth()).toBeGreaterThan(compact);
  });

  it('selects the first scheduled plan eligible to start, skipping earlier plans with only unmapped blocks', async () => {
    await seed();
    await planRepository.createPlan(
      {
        title: 'Unmapped Earlier Plan',
        gymId: null,
        scheduledFor: new Date(2026, 9, 10, 8),
        exercises: [
          {
            exerciseDefinitionId: null,
            name: 'Mystery Exercise',
            sets: [{ targetWeightText: '50', targetRepsText: '10', targetSetType: null }],
          },
        ],
      },
      new Date(2026, 9, 1, 8),
    );
    await planRepository.createPlan(
      {
        title: 'Valid Later Plan',
        gymId: null,
        scheduledFor: new Date(2026, 9, 11, 8),
        exercises: [
          {
            exerciseDefinitionId: 'seed_barbell_bench_press',
            name: 'Barbell Bench Press',
            sets: [{ targetWeightText: '100', targetRepsText: '5', targetSetType: null }],
          },
        ],
      },
      new Date(2026, 9, 1, 9),
    );

    renderWithTheme(<TrainRoute />);
    await checked();

    await waitFor(() => {
      expect(screen.getByText('Valid Later Plan')).toBeTruthy();
    });
    expect(screen.queryByText('Unmapped Earlier Plan')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId('train-start-planned-button'));
    });

    await waitFor(() => {
      expect(shownWorkout()).toContain('tab workout');
    });
  });

  it('shows the planner link when only unmapped plans are scheduled', async () => {
    await seed();
    await planRepository.createPlan(
      {
        title: 'Only Unmapped Plan',
        gymId: null,
        scheduledFor: new Date(2026, 9, 10, 8),
        exercises: [
          {
            exerciseDefinitionId: null,
            name: 'Mystery Exercise',
            sets: [{ targetWeightText: '50', targetRepsText: '10', targetSetType: null }],
          },
        ],
      },
      new Date(2026, 9, 1, 8),
    );

    renderWithTheme(<TrainRoute />);
    await checked();

    await waitFor(() => {
      expect(screen.getByTestId('train-manage-planning-button')).toHaveTextContent('Plan a workout');
    });
    expect(screen.queryByTestId('train-start-planned-button')).toBeNull();
  });

  it('refreshes planning state when an active workout ends in place without changing focus', async () => {
    await seed();
    const plan1 = await planRepository.createPlan(
      {
        title: 'First Plan',
        gymId: null,
        scheduledFor: new Date(2026, 9, 10, 8),
        exercises: [
          {
            exerciseDefinitionId: 'seed_barbell_bench_press',
            name: 'Barbell Bench Press',
            sets: [{ targetWeightText: '100', targetRepsText: '5', targetSetType: null }],
          },
        ],
      },
      new Date(2026, 9, 1, 8),
    );
    await planRepository.createPlan(
      {
        title: 'Second Plan',
        gymId: null,
        scheduledFor: new Date(2026, 9, 11, 8),
        exercises: [
          {
            exerciseDefinitionId: 'seed_barbell_bench_press',
            name: 'Barbell Bench Press',
            sets: [{ targetWeightText: '80', targetRepsText: '8', targetSetType: null }],
          },
        ],
      },
      new Date(2026, 9, 1, 9),
    );

    if (plan1.status !== 'saved') throw new Error('Expected saved');
    const plan1Id = plan1.id;

    const startResult = await startSessionPlan(plan1Id);
    expect(startResult.status).toBe('started');
    if (startResult.status !== 'started') throw new Error('Expected started');
    const sessionId = startResult.sessionId;

    renderWithTheme(<TrainRoute />);
    await waitFor(() => {
      expect(shownWorkout()).toBe(`tab workout ${sessionId}`);
    });

    // Complete first plan session and block in SQLite
    localDataClient()
      .prepare("UPDATE sessions SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(sessionId);
    localDataClient()
      .prepare("UPDATE session_plan_exercises SET progress_status = 'completed', resolved_at = CURRENT_TIMESTAMP WHERE session_plan_id = ?")
      .run(plan1Id);

    // End shown workout in place via onEnded('now') without changing focus
    await act(async () => {
      fireEvent.press(screen.getByTestId('train-workout-abandon'));
    });

    // The disc returns and planning refreshes to Second Plan
    await waitFor(() => {
      expect(screen.getByTestId('train-start-empty-button')).toBeTruthy();
      expect(screen.getByText('Second Plan')).toBeTruthy();
    });
    expect(screen.queryByText('First Plan')).toBeNull();
  });
});


it('opens an exercise only after Train receives focus, keeping the workout beneath it', async () => {
  await seed('session-view');
  const opener = renderHook(() => useOpenActiveWorkout());
  const { rerender } = renderWithTheme(<TrainScreen isFocused={false} />);
  act(() => opener.result.current(ACTIVE, { sessionExerciseId: 'bench/card', setId: 'new set' }));
  expect(mockPush).not.toHaveBeenCalled();
  rerender(<TrainScreen isFocused />);
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/session/${ACTIVE}/exercise/bench%2Fcard?setId=new%20set`));
  expect(shownWorkout()).toBe(`tab workout ${ACTIVE}`);
  expect(mockPush).toHaveBeenCalledTimes(1);
});
