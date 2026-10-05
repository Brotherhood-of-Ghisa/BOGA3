/* eslint-disable import/first */

/**
 * The Train tab over real data: the production route, its one-row
 * active-session check and the shared session-entry coordinator over the
 * migrated in-memory SQLite
 * database (helpers/local-data.ts), seeded with the `session-view` Maestro
 * fixture where a workout is in progress. Started sessions are read back from
 * the database. Only the native database open and the router are replaced.
 *
 * Planning has no data source yet (the route offers none), so planned launches
 * are driven through the `planningState` prop with a materializer that writes
 * a real draft. Named states real data cannot produce: a launch still pending,
 * a failed draft write, a failed plan write and a failed active-session read.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useIsFocused: () => true,
}));

import TrainRoute, { TrainScreen, type TrainPlanningState } from '../app/(tabs)/train';
import { uiRoles } from '@/components/ui/tokens';
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
  render(<TrainRoute />);
  await checked();
};

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
  render(<TrainScreen planningState={planningState} {...(sessionEntry ? { sessionEntry } : {})} />);
  await checked();
};

beforeEach(() => {
  resetLocalData();
  mockPush.mockReset();
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

  it('opens the workout in progress, offering no button for it', async () => {
    await seed('session-view');
    render(<TrainRoute />);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/session/${ACTIVE}`));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(isBusy()).toBe(true);
    expect(screen.queryByRole('button', { name: /resume/i })).toBeNull();
  });

  it('waits for focus before opening the workout in progress', async () => {
    await seed('session-view');
    render(<TrainScreen isFocused={false} />);
    await act(async () => undefined);

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('checks again on every focus, so an abandoned workout is never opened', async () => {
    await seed('session-view');
    const view = render(<TrainScreen isFocused />);
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));

    view.rerender(<TrainScreen isFocused={false} />);
    await setSessionDeletedState(ACTIVE, true);
    view.rerender(<TrainScreen isFocused />);
    expect(isBusy()).toBe(true);
    await checked();

    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('starts one empty draft on a double tap, the disc unchanged, and opens its session view', async () => {
    await openTrain();
    const before = screen.getByTestId('train-start-empty-button').props.style;

    const action = screen.getByTestId('train-start-empty-button');
    fireEvent.press(action);
    fireEvent.press(action);
    expect(screen.getByTestId('train-start-empty-button')).toHaveTextContent('Start');
    expect(StyleSheet.flatten(screen.getByTestId('train-start-empty-button').props.style)).toEqual(StyleSheet.flatten(before));

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    const started = await activeSessionId();
    expect(started).not.toBeNull();
    expect(mockPush).toHaveBeenCalledWith(`/session/${started}`);
    expect(activeSessionCount()).toBe(1);
    expect(await sessionDrafts.loadSessionSnapshotById(started!)).toMatchObject({ status: 'active', exercises: [] });
  });

  it('starts a fresh workout once the one in progress was discarded', async () => {
    await seed('session-view');
    await setSessionDeletedState(ACTIVE, true);
    render(<TrainRoute />);
    await checked();

    fireEvent.press(screen.getByTestId('train-start-empty-button'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    const started = await activeSessionId();
    expect(started).not.toBe(ACTIVE);
    expect(mockPush).toHaveBeenCalledWith(`/session/${started}`);
  });

  it('opens the workout in progress rather than offering a plan', async () => {
    const plan = readyPlan({ title: 'Lower body', detail: '4 exercises' });
    await seed('session-view');
    render(<TrainScreen planningState={plan} />);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/session/${ACTIVE}`));
    expect(screen.queryByTestId('train-start-planned-button')).toBeNull();
    expect(screen.queryByTestId('train-manage-planning-button')).toBeNull();
    fireEvent.press(screen.getByTestId('train-start-empty-button'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(await activeSessionId()).toBe(ACTIVE);
    expect(plan.status === 'ready' && plan.materialize).not.toHaveBeenCalled();
  });

  it('shows a failed empty start inline and keeps it retryable (a failed write)', async () => {
    jest.spyOn(sessionDrafts, 'persistSessionDraftSnapshot').mockRejectedValueOnce(new Error('write failed'));
    await openTrain();

    fireEvent.press(screen.getByTestId('train-start-empty-button'));

    expect(await screen.findByTestId('train-empty-launch-error')).toHaveTextContent("Couldn't start. Try again.");
    expect(await activeSessionId()).toBeNull();

    fireEvent.press(screen.getByTestId('train-start-empty-button'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(await activeSessionId()).not.toBeNull();
  });

  it('keeps the disc for an empty workout and lists a ready plan beneath it, with management', async () => {
    const plan = readyPlan();
    await seed();
    await renderWithPlan(plan);

    expect(screen.getByTestId('train-start-empty-button')).toHaveTextContent('Start');
    expect(screen.getByTestId('train-planned-session-card')).toHaveTextContent('Upper bodyBench pressStart');
    fireEvent.press(screen.getByRole('button', { name: 'Start Upper body' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/session/planned-session'));
    expect(await activeSessionId()).toBe('planned-session');

    fireEvent.press(screen.getByTestId('train-manage-planning-button'));
    expect(plan.status === 'ready' && plan.openManager).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed planned launch inline, leaving empty training usable (a failed plan write)', async () => {
    await seed();
    await renderWithPlan(readyPlan({ materialize: jest.fn().mockRejectedValue(new Error('stale plan')) }));

    fireEvent.press(screen.getByTestId('train-start-planned-button'));

    expect(await screen.findByTestId('train-planned-launch-error')).toHaveTextContent(
      "Couldn't start this plan. Try again.",
    );
    expect(isBusy()).toBe(false);
    expect(await activeSessionId()).toBeNull();
  });

  it('does not offer a new workout when the active-session read fails, and retries (a failed read)', async () => {
    const load = jest
      .spyOn(sessionList, 'findActiveSessionId')
      .mockRejectedValueOnce(new Error('Unable to read sessions'));
    await seed();
    render(<TrainRoute />);

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
    render(
      <TrainScreen
        loadActiveSessionId={() => new Promise(() => undefined)}
        sessionEntry={{ startEmptyOrResume: start, startPlannedOrResume: jest.fn() }}
      />,
    );

    const disc = screen.getByTestId('train-start-empty-button');
    expect(isBusy()).toBe(true);
    expect(StyleSheet.flatten(disc.props.style).backgroundColor).toBe(uiRoles.accent);
    fireEvent.press(disc);
    expect(start).not.toHaveBeenCalled();
  });

  it('ignores a planned start while an empty start is pending, relabelling nothing (a pending launch)', async () => {
    const pending: SessionEntryCoordinator = {
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
        .filter((node) => node && StyleSheet.flatten(node.props.style).backgroundColor === uiRoles.accent)
        .map((node) => node?.props.testID);
    const discWidth = () => StyleSheet.flatten(screen.getByTestId('train-start-empty-button').props.style).width;

    await seed();
    await renderWithPlan(readyPlan());
    expect(accentButtons()).toEqual(['train-start-empty-button']);
    const compact = discWidth();
    screen.unmount();

    render(<TrainRoute />);
    await checked();
    expect(accentButtons()).toEqual(['train-start-empty-button']);
    expect(discWidth()).toBeGreaterThan(compact);
  });
});
