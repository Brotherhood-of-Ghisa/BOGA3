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
 * Planning has no data source yet (the route offers none), so planned launches
 * are driven through the `planningState` prop with a materializer that writes
 * a real draft. Named states real data cannot produce: a launch still pending,
 * a failed draft write, a failed plan write and a failed active-session read.
 */

import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  useRouter: () => ({ dismissTo: jest.fn() }),
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
import { useOpenActiveWorkout } from '@/components/navigation/use-open-main-tab';
import { uiFonts, uiTypography } from '@/components/ui/tokens';
import { DEFAULT_APPEARANCE } from '@/components/ui/theme-presets';
import { renderWithTheme, rolesFor } from './helpers/theme';

const roles = rolesFor(DEFAULT_APPEARANCE);
import * as sessionDrafts from '@/src/data/session-drafts';
import * as sessionList from '@/src/data/session-list';
import { listSessionListBuckets, setSessionDeletedState } from '@/src/data/session-list';
import { SESSION_VIEW_FIXTURE } from '@/src/maestro/session-view-fixture';
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
  resetLocalData();
});

afterEach(() => {
  jest.restoreAllMocks();
  closeLocalData();
});

describe('Train over real data', () => {
  it('opens on the disc alone: no title, no copy, no planning placeholder', async () => {
    await openTrain();

    expect(screen.queryByRole('header')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start workout' })).toBe(screen.getByTestId('train-start-empty-button'));
    expect(screen.getByTestId('train-start-empty-button')).toHaveTextContent('Start');
    expect(screen.queryByTestId('train-planning-section')).toBeNull();
    expect(screen.queryByTestId('train-manage-planning-button')).toBeNull();
    expect(screen.queryByText('Watch this space 👀')).toBeNull();
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
    expect(screen.getByTestId('train-planned-session-card')).toHaveTextContent('Upper bodyBench pressStart');
    // The plan reads as a list row: a micro-label above, its title in
    // bodyStrong and its detail in meta.
    expect(StyleSheet.flatten(screen.getByText('Planned').props.style)).toMatchObject({
      fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs, textTransform: 'uppercase',
    });
    expect(StyleSheet.flatten(screen.getByText('Upper body').props.style)).toMatchObject({
      fontFamily: uiFonts.body.family, fontWeight: '600', fontSize: uiTypography.size.base,
    });
    expect(StyleSheet.flatten(screen.getByText('Bench press').props.style)).toMatchObject({
      fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm, color: roles.inkMuted,
    });
    fireEvent.press(screen.getByRole('button', { name: 'Start Upper body' }));

    fireEvent.press(screen.getByTestId('train-manage-planning-button'));
    expect(plan.status === 'ready' && plan.openManager).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(shownWorkout()).toBe('tab workout planned-session'));
    expect(await activeSessionId()).toBe('planned-session');
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
        sessionEntry={{ startEmptyOrResume: start, startPlannedOrResume: jest.fn(), resumeCompletedSession: jest.fn() }}
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
    expect(accentButtons()).toEqual(['train-start-empty-button']);
    expect(discWidth()).toBeGreaterThan(compact);
  });
});
