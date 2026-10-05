/* eslint-disable import/first */

/**
 * The Train tab over real data: the production route, its session-list client
 * and the shared session-entry coordinator over the migrated in-memory SQLite
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

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useIsFocused: () => true,
}));

import TrainRoute, { TrainScreen, type TrainPlanningState } from '../app/(tabs)/train';
import { DEFAULT_SESSION_LIST_DATA_CLIENT } from '@/components/session-list';
import { uiRoles } from '@/components/ui/tokens';
import * as sessionDrafts from '@/src/data/session-drafts';
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

const openTrain = async (fixture?: 'session-view') => {
  await seed(fixture);
  render(<TrainRoute />);
  await waitFor(() => expect(screen.queryByTestId('train-session-loading')).toBeNull());
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
  render(
    <TrainScreen
      dataClient={DEFAULT_SESSION_LIST_DATA_CLIENT}
      planningState={planningState}
      {...(sessionEntry ? { sessionEntry } : {})}
    />
  );
  await waitFor(() => expect(screen.queryByTestId('train-session-loading')).toBeNull());
};

beforeEach(() => {
  resetLocalData();
  mockReplace.mockReset();
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

  it('opens the workout in progress in place of Train, offering no button', async () => {
    await seed('session-view');
    render(<TrainRoute />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/session/${ACTIVE}`));
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('train-session-loading')).toBeDisabled();
    expect(screen.queryByTestId('train-start-empty-button')).toBeNull();
    expect(screen.queryByRole('button', { name: /resume/i })).toBeNull();
  });

  it('waits for focus before opening the workout in progress', async () => {
    await seed('session-view');
    render(<TrainScreen dataClient={DEFAULT_SESSION_LIST_DATA_CLIENT} isFocused={false} />);
    await act(async () => undefined);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('starts one empty draft on a double tap and opens its session view', async () => {
    await openTrain();

    const action = screen.getByTestId('train-start-empty-button');
    fireEvent.press(action);
    fireEvent.press(action);
    expect(screen.getByText('Starting…')).toBeTruthy();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    const started = await activeSessionId();
    expect(started).not.toBeNull();
    expect(mockReplace).toHaveBeenCalledWith(`/session/${started}`);
    expect(activeSessionCount()).toBe(1);
    expect(await sessionDrafts.loadSessionSnapshotById(started!)).toMatchObject({ status: 'active', exercises: [] });
  });

  it('starts a fresh workout once the one in progress was discarded', async () => {
    await seed('session-view');
    await setSessionDeletedState(ACTIVE, true);
    render(<TrainRoute />);
    await waitFor(() => expect(screen.queryByTestId('train-session-loading')).toBeNull());

    fireEvent.press(screen.getByTestId('train-start-empty-button'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    const started = await activeSessionId();
    expect(started).not.toBe(ACTIVE);
    expect(mockReplace).toHaveBeenCalledWith(`/session/${started}`);
  });

  it('opens the workout in progress rather than offering a plan', async () => {
    const plan = readyPlan({ title: 'Lower body', detail: '4 exercises' });
    await seed('session-view');
    render(<TrainScreen dataClient={DEFAULT_SESSION_LIST_DATA_CLIENT} planningState={plan} />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/session/${ACTIVE}`));
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
    expect(await activeSessionId()).toBeNull();

    fireEvent.press(screen.getByTestId('train-start-empty-button'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(await activeSessionId()).not.toBeNull();
  });

  it('keeps the disc for an empty workout and lists a ready plan beneath it, with management', async () => {
    const plan = readyPlan();
    await seed();
    await renderWithPlan(plan);

    expect(screen.getByTestId('train-start-empty-button')).toHaveTextContent('Start');
    expect(screen.getByTestId('train-planned-session-card')).toHaveTextContent('Upper bodyBench pressStart');
    fireEvent.press(screen.getByRole('button', { name: 'Start Upper body' }));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/session/planned-session'));
    expect(await activeSessionId()).toBe('planned-session');

    fireEvent.press(screen.getByTestId('train-manage-planning-button'));
    expect(plan.status === 'ready' && plan.openManager).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed planned launch inline without disabling empty training (a failed plan write)', async () => {
    await seed();
    await renderWithPlan(readyPlan({ materialize: jest.fn().mockRejectedValue(new Error('stale plan')) }));

    fireEvent.press(screen.getByTestId('train-start-planned-button'));

    expect(await screen.findByTestId('train-planned-launch-error')).toHaveTextContent(
      "Couldn't start this plan. Try again.",
    );
    expect(screen.getByTestId('train-start-empty-button')).not.toBeDisabled();
    expect(await activeSessionId()).toBeNull();
  });

  it('does not offer a new workout when the active-session read fails, and retries (a failed read)', async () => {
    const load = jest
      .spyOn(DEFAULT_SESSION_LIST_DATA_CLIENT, 'loadSessions')
      .mockRejectedValueOnce(new Error('Unable to read sessions'));
    await seed();
    render(<TrainRoute />);

    expect(await screen.findByTestId('train-session-error')).toBeTruthy();
    expect(screen.queryByTestId('train-start-empty-button')).toBeNull();
    fireEvent.press(screen.getByTestId('train-session-error-retry'));

    expect(await screen.findByTestId('train-start-empty-button')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('Train planning states', () => {
  it('shows nothing beneath the disc while planning loads', async () => {
    await seed();
    await renderWithPlan({ status: 'loading' });

    expect(screen.getByTestId('train-start-empty-button')).not.toBeDisabled();
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
    expect(screen.getByTestId('train-start-empty-button')).not.toBeDisabled();
  });
});

describe('Train launch states', () => {
  it('greys the disc out while it checks for a workout in progress', () => {
    render(<TrainScreen dataClient={{ ...DEFAULT_SESSION_LIST_DATA_CLIENT, loadSessions: () => new Promise(() => undefined) }} />);

    const checking = screen.getByTestId('train-session-loading');
    expect(checking).toBeDisabled();
    expect(StyleSheet.flatten(checking.props.style).backgroundColor).toBe(uiRoles.inkGhost);
    expect(screen.queryByTestId('train-start-empty-button')).toBeNull();
  });

  it('disables planned launch without relabeling it while an empty launch is pending (a pending launch)', async () => {
    const pending: SessionEntryCoordinator = {
      startEmptyOrResume: () => new Promise(() => undefined),
      startPlannedOrResume: () => new Promise(() => undefined),
    };
    await seed();
    await renderWithPlan(readyPlan(), pending);

    await act(async () => {
      fireEvent.press(screen.getByTestId('train-start-empty-button'));
    });

    expect(screen.getByTestId('train-start-planned-button')).toBeDisabled();
    expect(screen.getByTestId('train-start-planned-button')).toHaveTextContent('Start');
    expect(screen.getByTestId('train-start-empty-button')).toHaveTextContent('Starting…');
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
    await screen.findByTestId('train-start-empty-button');
    expect(accentButtons()).toEqual(['train-start-empty-button']);
    expect(discWidth()).toBeGreaterThan(compact);
  });
});
