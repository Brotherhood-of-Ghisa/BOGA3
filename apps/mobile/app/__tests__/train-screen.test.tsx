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

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useIsFocused: () => true,
}));

import TrainRoute, { TrainScreen, type TrainPlanningState } from '../(tabs)/train';
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
  mockPush.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
  closeLocalData();
});

describe('Train over real data', () => {
  it('resumes the workout in progress, marked with the current-ring glyph, not a colour', async () => {
    await openTrain('session-view');

    expect(screen.getByTestId('train-active-session-glyph', { includeHiddenElements: true })).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByTestId('train-active-session-card').props.style).backgroundColor).toBe(
      uiRoles.surface,
    );
    fireEvent.press(screen.getByTestId('train-resume-session-button'));

    expect(mockPush).toHaveBeenCalledWith(`/session/${ACTIVE}`);
  });

  it('starts one empty draft on a double tap and opens its session view', async () => {
    await openTrain();

    const action = screen.getByTestId('train-start-empty-button');
    fireEvent.press(action);
    fireEvent.press(action);
    expect(screen.getByText('Starting…')).toBeTruthy();

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
    await waitFor(() => expect(screen.queryByTestId('train-session-loading')).toBeNull());

    expect(screen.queryByTestId('train-active-session-card')).toBeNull();
    fireEvent.press(screen.getByTestId('train-start-empty-button'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    const started = await activeSessionId();
    expect(started).not.toBe(ACTIVE);
    expect(mockPush).toHaveBeenCalledWith(`/session/${started}`);
  });

  it('replaces every new-session action with Resume when a draft exists', async () => {
    const plan = readyPlan({ title: 'Lower body', detail: '4 exercises' });
    await seed('session-view');
    await renderWithPlan(plan);

    fireEvent.press(screen.getByTestId('train-resume-session-button'));

    expect(screen.getByTestId('train-active-session-card')).toBeTruthy();
    expect(screen.queryByTestId('train-start-empty-button')).toBeNull();
    expect(screen.queryByTestId('train-start-planned-button')).toBeNull();
    expect(mockPush).toHaveBeenCalledWith(`/session/${ACTIVE}`);
    expect(await activeSessionId()).toBe(ACTIVE);
    expect(plan.status === 'ready' && plan.materialize).not.toHaveBeenCalled();
  });

  it('shows a failed empty start inline and keeps it retryable (a failed write)', async () => {
    jest.spyOn(sessionDrafts, 'persistSessionDraftSnapshot').mockRejectedValueOnce(new Error('write failed'));
    await openTrain();

    fireEvent.press(screen.getByTestId('train-start-empty-button'));

    expect(await screen.findByTestId('train-empty-launch-error')).toHaveTextContent(
      "Couldn't start a workout. Try again.",
    );
    expect(await activeSessionId()).toBeNull();

    fireEvent.press(screen.getByTestId('train-start-empty-button'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(await activeSessionId()).not.toBeNull();
  });

  it('starts an available plan through the shared coordinator and opens management', async () => {
    const plan = readyPlan();
    await seed();
    await renderWithPlan(plan);

    fireEvent.press(screen.getByTestId('train-start-planned-button'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/session/planned-session'));
    expect(await activeSessionId()).toBe('planned-session');

    fireEvent.press(screen.getByTestId('train-manage-planning-button'));
    expect(plan.status === 'ready' && plan.openManager).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed planned launch inline without disabling empty training (a failed plan write)', async () => {
    await seed();
    await renderWithPlan(readyPlan({ materialize: jest.fn().mockRejectedValue(new Error('stale plan')) }));

    fireEvent.press(screen.getByTestId('train-start-planned-button'));

    expect(await screen.findByTestId('train-planned-launch-error')).toHaveTextContent(
      "Couldn't start this planned workout. Try again.",
    );
    expect(screen.getByTestId('train-start-empty-button')).not.toBeDisabled();
    expect(await activeSessionId()).toBeNull();
  });

  it('states the missing planning dependency without blocking empty training', async () => {
    await openTrain();

    expect(screen.getByTestId('train-planning-unavailable')).toBeTruthy();
    expect(screen.getByText('Watch this space 👀')).toBeTruthy();
    expect(screen.getByTestId('train-start-empty-button')).not.toBeDisabled();
    expect(screen.queryByTestId('train-manage-planning-button')).toBeNull();
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

describe('Train launch states', () => {
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
    expect(screen.getByTestId('train-start-planned-button')).toHaveTextContent('Start planned workout');
    expect(screen.getByTestId('train-start-empty-button')).toHaveTextContent('Starting…');
  });

  it('draws exactly one accent primary: the plan when one is ready, else the empty start (T03-D1)', async () => {
    const accentButtons = () =>
      ['train-start-empty-button', 'train-start-planned-button', 'train-manage-planning-button']
        .map((testID) => screen.queryByTestId(testID))
        .filter((node) => node && StyleSheet.flatten(node.props.style).backgroundColor === uiRoles.accent)
        .map((node) => node?.props.testID);

    await seed();
    await renderWithPlan(readyPlan());
    expect(accentButtons()).toEqual(['train-start-planned-button']);
    screen.unmount();

    render(<TrainRoute />);
    await screen.findByTestId('train-start-empty-button');
    expect(accentButtons()).toEqual(['train-start-empty-button']);
  });
});
