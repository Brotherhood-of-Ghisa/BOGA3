/* eslint-disable import/first */

/**
 * The Sessions list over real data: the production route and its default data
 * client (session-list buckets, discard, delete) over the migrated in-memory
 * SQLite database, seeded through the Maestro harness with the `session-view`
 * fixture: one active session over the block-history fixture's completed ones
 * (helpers/local-data.ts). Writes are read back from the database. Only the
 * native database open and the router are replaced.
 *
 * Faked, and named in their tests: a failed list read (forced once on the real
 * client with `jest.spyOn`) and two races (a superseded load and a load landing
 * after unmount), driven through an injected client.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

const mockDismissTo = jest.fn();
const mockPush = jest.fn();
let mockIsFocused = true;

jest.mock('expo-router', () => {
  const mockReact = jest.requireActual('react');
  return {
    useRouter: () => ({
      dismissTo: mockDismissTo,
      push: mockPush,
    }),
    useIsFocused: () => mockIsFocused,
    useFocusEffect: (callback: () => void | (() => void)) => {
      mockReact.useEffect(() => callback(), [callback]);
    },
  };
});

import SessionsRoute, { SessionsScreen } from '../app/sessions';
import {
  DEFAULT_SESSION_LIST_DATA_CLIENT,
  type SessionListDataClient,
  type SessionListItem,
} from '@/components/session-list';
import { completeSessionDraft, loadSessionSnapshotById, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { setSessionDeletedState } from '@/src/data/session-list';
import { EXERCISE_BLOCK_HISTORY_FIXTURE } from '@/src/maestro/exercise-block-history-fixture';
import { SESSION_VIEW_FIXTURE } from '@/src/maestro/session-view-fixture';
import { planRepository } from '@/src/session-planner';
import { bootLocalApp, closeLocalData, loadMaestroFixture, resetLocalData } from './helpers/local-data';

const ACTIVE = SESSION_VIEW_FIXTURE.sessionId;
const NEWEST_COMPLETED = EXERCISE_BLOCK_HISTORY_FIXTURE.unmappedCompletionSessionId;
const OLDER_COMPLETED = EXERCISE_BLOCK_HISTORY_FIXTURE.noPrCompletionSessionId;

const openSessions = async (prepare?: () => Promise<unknown>) => {
  await loadMaestroFixture('session-view');
  await prepare?.();
  await bootLocalApp();
  const view = render(<SessionsRoute />);
  await screen.findByTestId(`completed-session-row-${NEWEST_COMPLETED}`);
  return view;
};

const loadSpy = () => jest.spyOn(DEFAULT_SESSION_LIST_DATA_CLIENT, 'loadSessions');

let alertSpy: jest.SpyInstance;
const alertButton = (text: string): AlertButton => {
  const buttons = alertSpy.mock.calls.at(-1)?.[2] as AlertButton[];
  const button = buttons.find((candidate) => candidate.text === text);
  if (!button) {
    throw new Error(`No alert button ${text}`);
  }
  return button;
};

beforeEach(() => {
  resetLocalData();
  mockDismissTo.mockClear();
  mockPush.mockClear();
  mockIsFocused = true;
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  closeLocalData();
});

describe('Sessions over real data', () => {
  it('lists the active session first, then the completed ones newest first', async () => {
    await openSessions();

    expect(screen.getByTestId(`active-session-row-${ACTIVE}`)).toBeTruthy();
    const completed = screen
      .getAllByTestId(/^completed-session-row-/)
      .map((node) => String(node.props.testID).replace('completed-session-row-', ''));
    // The block-history fixture's eleven, by completion time (hours to 26 days ago).
    expect(completed).toEqual([
      NEWEST_COMPLETED,
      OLDER_COMPLETED,
      EXERCISE_BLOCK_HISTORY_FIXTURE.onePrCompletionSessionId,
      'maestro_exercise_block_history_squat_1',
      'maestro_exercise_block_history_bench_1',
      'maestro_exercise_block_history_squat_2',
      'maestro_exercise_block_history_squat_3',
      'maestro_exercise_block_history_bench_2',
      'maestro_exercise_block_history_squat_4',
      'maestro_exercise_block_history_squat_5',
      'maestro_exercise_block_history_squat_6_outside_limit',
    ]);
    // A row's `sets` are its working sets: this session's warm-up is no set,
    // nor is the active session's bench warm-up.
    expect(screen.getByTestId('session-summary-maestro_exercise_block_history_squat_1-sets')).toHaveTextContent('3 sets');
    expect(screen.getByTestId(`session-summary-${ACTIVE}-sets`)).toHaveTextContent(
      `${SESSION_VIEW_FIXTURE.workingSetCount} sets`
    );
  });

  it('opens the session view when resuming the active session', async () => {
    await openSessions();

    fireEvent.press(screen.getByTestId('resume-active-session-button'));

    expect(mockPush).toHaveBeenCalledWith(`/session/${ACTIVE}`);
    expect(mockDismissTo).not.toHaveBeenCalled();
  });

  it('routes completion through the session cleanup flow instead of completing directly', async () => {
    await openSessions();

    fireEvent.press(screen.getByLabelText('Review and complete active session'));

    expect(mockPush).toHaveBeenCalledWith(`/session/${ACTIVE}`);
    expect(await loadSessionSnapshotById(ACTIVE)).toMatchObject({ status: 'active', completedAt: null });
  });

  it('opens a completed History row in Summary', async () => {
    await openSessions();

    fireEvent.press(screen.getByTestId(`completed-session-open-button-${NEWEST_COMPLETED}`));

    expect(mockPush).toHaveBeenCalledWith(`/completed-session/${NEWEST_COMPLETED}`);
  });

  it('loads once when focused, not again on a re-render, and again when focus returns', async () => {
    const load = loadSpy();
    const view = await openSessions();
    expect(load).toHaveBeenCalledTimes(1);

    view.rerender(<SessionsRoute />);
    expect(load).toHaveBeenCalledTimes(1);

    mockIsFocused = false;
    view.rerender(<SessionsRoute />);
    // A session finished elsewhere while the list was in the background.
    await completeSessionDraft(ACTIVE);
    expect(load).toHaveBeenCalledTimes(1);

    mockIsFocused = true;
    view.rerender(<SessionsRoute />);

    expect(await screen.findByTestId(`completed-session-row-${ACTIVE}`)).toBeTruthy();
    expect(screen.queryByTestId(`active-session-row-${ACTIVE}`)).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('hides deleted sessions until shown, then marks them, loading once per filter change', async () => {
    const load = loadSpy();
    await openSessions(() => setSessionDeletedState(OLDER_COMPLETED, true));

    const toggle = screen.getByTestId('toggle-deleted-sessions-button');
    expect(toggle).toHaveProp('accessibilityState', { disabled: false, checked: false });
    expect(screen.queryByTestId(`completed-session-row-${OLDER_COMPLETED}`)).toBeNull();

    fireEvent.press(toggle);

    expect(await screen.findByTestId(`completed-session-deleted-tag-${OLDER_COMPLETED}`)).toHaveTextContent('Deleted');
    expect(screen.getByTestId('toggle-deleted-sessions-button')).toHaveProp('accessibilityState', {
      disabled: false,
      checked: true,
    });
    expect(screen.getByTestId('toggle-deleted-sessions-button')).toHaveTextContent('Hide deleted');
    expect(load.mock.calls).toEqual([[{ showDeletedSessions: false }], [{ showDeletedSessions: true }]]);
  });

  it('confirms before discarding the active session: Cancel keeps it, Discard deletes it and refreshes once', async () => {
    const load = loadSpy();
    await openSessions();

    fireEvent.press(screen.getByTestId('active-session-menu-button'));
    fireEvent.press(screen.getByTestId('discard-active-session-button'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertButton('Discard').style).toBe('destructive');
    expect(alertButton('Cancel').style).toBe('cancel');

    act(() => {
      alertButton('Cancel').onPress?.();
    });
    expect((await loadSessionSnapshotById(ACTIVE))?.deletedAt).toBeNull();
    expect(screen.getByTestId(`active-session-row-${ACTIVE}`)).toBeTruthy();

    fireEvent.press(screen.getByTestId('active-session-menu-button'));
    fireEvent.press(screen.getByTestId('discard-active-session-button'));
    await act(async () => {
      alertButton('Discard').onPress?.();
    });

    expect((await loadSessionSnapshotById(ACTIVE))?.deletedAt).toBeInstanceOf(Date);
    await waitFor(() => expect(screen.queryByTestId(`active-session-row-${ACTIVE}`)).toBeNull());
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reloads from the load error through Retry (a failed read)', async () => {
    const load = loadSpy().mockRejectedValueOnce(new Error('Database unavailable'));
    await loadMaestroFixture('session-view');
    await bootLocalApp();
    render(<SessionsRoute />);

    const error = await screen.findByTestId('session-list-load-error');
    expect(error).toHaveTextContent(/Could not load sessions/);
    expect(error).toHaveTextContent(/Database unavailable/);

    fireEvent.press(screen.getByTestId('session-list-load-error-retry'));

    expect(await screen.findByTestId(`completed-session-row-${NEWEST_COMPLETED}`)).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('session-list-load-error')).toBeNull();
  });

  it('opens a completed row menu as a sheet the backdrop dismisses', async () => {
    await openSessions();

    fireEvent.press(screen.getByTestId(`completed-session-menu-button-${NEWEST_COMPLETED}`));
    expect(screen.getByTestId('completed-session-edit-menu-action-button')).toBeTruthy();
    expect(screen.getByTestId('completed-session-modal-action-button')).toHaveTextContent('Delete');

    fireEvent.press(screen.getByTestId('completed-session-menu-backdrop', { includeHiddenElements: true }));
    expect(screen.queryByTestId('completed-session-edit-menu-action-button')).toBeNull();
  });

  it('stamps a row and its menu with the local start time, not the stored UTC clock', async () => {
    // 23:45 local on 7/24: the stored ISO instant falls on another hour (and,
    // west of UTC, another day) in every zone but UTC.
    const lateId = 'sessions_local_time_late';
    const startedAt = new Date(2026, 6, 24, 23, 45);
    const completedAt = new Date(2026, 6, 25, 0, 45);
    await openSessions(async () => {
      await persistSessionDraftSnapshot(
        {
          sessionId: lateId,
          gymId: null,
          startedAt,
          exercises: [
            {
              id: `${lateId}_bench`,
              exerciseDefinitionId: 'seed_barbell_bench_press',
              name: 'Barbell Bench Press',
              sets: [{ id: `${lateId}_bench_1`, weightValue: '100', repsValue: '5', setType: 'rir_2', performanceStatus: null }],
            },
          ],
        },
        { now: completedAt }
      );
      await completeSessionDraft(lateId, { completedAt, now: completedAt });
    });

    expect(screen.getByTestId(`session-summary-${lateId}-start`)).toHaveTextContent('7/24 23:45');

    fireEvent.press(screen.getByTestId(`completed-session-menu-button-${lateId}`));
    expect(within(screen.getByTestId('completed-session-menu')).getByText('7/24 23:45')).toBeTruthy();
  });
});

// Races real data cannot stage: the loads are held open by an injected client.
describe('Sessions list load races', () => {
  const session = (id: string, completedAt: string): SessionListItem => ({
    id,
    startedAt: '2026-07-25T09:00:00.000Z',
    status: 'completed',
    completedAt,
    durationSec: 3_600,
    durationDisplay: '1h',
    gymName: null,
    exerciseCount: 1,
    setCount: 3,
    totalWeight: 0,
    deletedAt: null,
  });

  const createDeferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
      resolve = resolvePromise;
    });
    return { promise, resolve };
  };

  const heldClient = (...loads: Promise<SessionListItem[]>[]): jest.Mocked<SessionListDataClient> => {
    const loadSessions = jest.fn();
    for (const load of loads) loadSessions.mockImplementationOnce(() => load);
    return {
      loadSessions,
      startSession: jest.fn(),
      completeActiveSession: jest.fn(),
      discardActiveSession: jest.fn(),
      setCompletedSessionDeletedState: jest.fn(),
      appendCompletedSessionAsPlanned: jest.fn(),
    };
  };

  it('does not let a superseded request overwrite the newer filter result (a race)', async () => {
    const older = session('completed-session-1', '2026-07-25T10:00:00.000Z');
    const newer = session('completed-session-2', '2026-07-26T10:00:00.000Z');
    const firstLoad = createDeferred<SessionListItem[]>();
    const secondLoad = createDeferred<SessionListItem[]>();
    const dataClient = heldClient(firstLoad.promise, secondLoad.promise);
    render(<SessionsScreen dataClient={dataClient} isFocused />);

    await waitFor(() => expect(dataClient.loadSessions).toHaveBeenCalledTimes(1));
    fireEvent.press(screen.getByTestId('toggle-deleted-sessions-button'));
    await waitFor(() => expect(dataClient.loadSessions).toHaveBeenCalledTimes(2));

    await act(async () => {
      secondLoad.resolve([newer]);
      await secondLoad.promise;
    });
    expect(await screen.findByTestId(`completed-session-row-${newer.id}`)).toBeTruthy();

    await act(async () => {
      firstLoad.resolve([older]);
      await firstLoad.promise;
    });
    expect(screen.getByTestId(`completed-session-row-${newer.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`completed-session-row-${older.id}`)).toBeNull();
  });

  it('invalidates an in-flight request when the consumer unmounts (a race)', async () => {
    const lateLoad = createDeferred<SessionListItem[]>();
    const dataClient = heldClient(lateLoad.promise);
    const view = render(<SessionsScreen dataClient={dataClient} isFocused />);

    await waitFor(() => expect(dataClient.loadSessions).toHaveBeenCalledTimes(1));
    view.unmount();

    await act(async () => {
      lateLoad.resolve([session('completed-session-1', '2026-07-25T10:00:00.000Z')]);
      await lateLoad.promise;
    });
    expect(dataClient.loadSessions).toHaveBeenCalledTimes(1);
  });
});

describe('Sessions planning sections', () => {
  const planDraft = (
    overrides: Partial<Parameters<typeof planRepository.createPlan>[0]> = {}
  ): Parameters<typeof planRepository.createPlan>[0] => ({
    title: 'Heavy Day',
    gymId: null,
    scheduledFor: null,
    exercises: [
      {
        exerciseDefinitionId: null,
        name: 'Back Squat',
        machineName: '',
        sets: [{ targetWeightText: '100', targetRepsText: '5', targetSetType: null }],
      },
    ],
    ...overrides,
  });

  const seedPlans = async () => {
    // Upcoming, soonest last in creation order; the query sorts by schedule.
    await planRepository.createPlan(planDraft({ title: 'Later Week', scheduledFor: new Date(2026, 9, 12, 7) }), new Date(2026, 9, 1, 8));
    await planRepository.createPlan(planDraft({ title: 'Tomorrow', scheduledFor: new Date(2026, 9, 6, 7) }), new Date(2026, 9, 1, 9));
    // Unscheduled; the most recently updated leads.
    await planRepository.createPlan(planDraft({ title: 'Old Idea' }), new Date(2026, 9, 2, 8));
    await planRepository.createPlan(planDraft({ title: 'New Idea' }), new Date(2026, 9, 3, 8));
  };

  const planRowLabels = (testID: string) =>
    screen
      .getAllByTestId(new RegExp(`^${testID}-row-`))
      .map((node) => String(node.props.accessibilityLabel));

  beforeEach(() => {
    resetLocalData();
    mockPush.mockClear();
    mockDismissTo.mockClear();
    mockIsFocused = true;
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  it('separates Upcoming (by schedule) and Unscheduled (by recency) from Completed', async () => {
    await openSessions(seedPlans);

    // Soonest scheduled first; rows say when in words.
    expect(planRowLabels('sessions-plan-section-upcoming')).toEqual([
      'Tomorrow, 2026-10-06 07:00',
      'Later Week, 2026-10-12 07:00',
    ]);
    // Most recently updated first.
    expect(planRowLabels('sessions-plan-section-unscheduled')).toEqual([
      'New Idea, Unscheduled',
      'Old Idea, Unscheduled',
    ]);

    // The completed history keeps its own count and rows, untouched by plans.
    expect(screen.getAllByTestId(/^completed-session-row-/)).toHaveLength(11);

    // A plan row opens the plan detail; the quiet action opens the form.
    fireEvent.press(screen.getAllByTestId(/^sessions-plan-section-unscheduled-row-/)[0]);
    expect(mockPush).toHaveBeenCalledWith(
      `/session-plan/${String(screen.getAllByTestId(/^sessions-plan-section-unscheduled-row-/)[0].props.testID).replace('sessions-plan-section-unscheduled-row-', '')}`
    );
    fireEvent.press(screen.getByTestId('sessions-plan-session-action'));
    expect(mockPush).toHaveBeenCalledWith('/session-plan/new');
  });

  it('shows the quiet Plan session action and no plan sections when nothing is planned', async () => {
    await openSessions();

    expect(screen.queryByTestId('sessions-plan-section-upcoming')).toBeNull();
    expect(screen.queryByTestId('sessions-plan-section-unscheduled')).toBeNull();
    expect(screen.getByTestId('sessions-plan-session-action')).toBeTruthy();
    // The completed history and its count are unaffected.
    expect(screen.getAllByTestId(/^completed-session-row-/)).toHaveLength(11);
    fireEvent.press(screen.getByTestId('sessions-plan-session-action'));
    expect(mockPush).toHaveBeenCalledWith('/session-plan/new');
  });
});
