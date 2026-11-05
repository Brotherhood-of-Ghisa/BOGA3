/* eslint-disable import/first */

/**
 * The Sessions list over real data: the production route and its default data
 * client (session-list buckets, records, discard) over the migrated in-memory
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
import { Alert, SectionList, type AlertButton } from 'react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

const mockDismissTo = jest.fn();
const mockPush = jest.fn();
let mockIsFocused = true;
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => {
  const mockReact = jest.requireActual('react');
  return {
    useRouter: () => ({
      dismissTo: mockDismissTo,
      push: mockPush,
    }),
    useIsFocused: () => mockIsFocused,
    useLocalSearchParams: () => mockParams,
    // The header's ⋮ and any title render in place, so a test can press and read them.
    Stack: {
      Screen: ({ options }: { options?: { title?: string; headerRight?: () => unknown } }) => {
        const { Text } = jest.requireActual('react-native');
        return mockReact.createElement(mockReact.Fragment, null,
          options?.title ? mockReact.createElement(Text, { testID: 'header-title' }, options.title) : null,
          options?.headerRight?.() ?? null);
      },
    },
    useFocusEffect: (callback: () => void | (() => void)) => {
      mockReact.useEffect(() => mockIsFocused ? callback() : undefined, [callback, mockIsFocused]);
    },
  };
});

import SessionsRoute, { SessionsScreen } from '../app/sessions';
import {
  DEFAULT_SESSION_LIST_DATA_CLIENT,
  parseHistoryJump,
  type SessionListDataClient,
  type SessionListItem,
} from '@/components/session-list';
import * as exerciseSessionFacts from '@/src/data/exercise-session-facts';
import * as logEventModule from '@/src/logging/logEvent';
import { completeSessionDraft, loadSessionSnapshotById, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { setSessionDeletedState } from '@/src/data/session-list';
import { setExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import { EXERCISE_BLOCK_HISTORY_FIXTURE } from '@/src/maestro/exercise-block-history-fixture';
import { SESSION_VIEW_FIXTURE } from '@/src/maestro/session-view-fixture';
import { Tag } from '@/components/ui/tag';
import { planQueries, planRepository, skipPlanBlock, startSessionPlan } from '@/src/session-planner';
import { createDrizzleSessionPlanStore } from '@/src/data/session-plan-store';
import { bootLocalApp, closeLocalData, loadMaestroFixture, localDataClient, resetLocalData } from './helpers/local-data';
import { waitForGone } from './helpers/wait-for-gone';

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

const showDeletedSessions = () => {
  fireEvent.press(screen.getByTestId('sessions-options-button'));
  fireEvent.press(screen.getByTestId('toggle-deleted-sessions'));
};

const showCompletedPlans = () => {
  fireEvent.press(screen.getByTestId('sessions-options-button'));
  fireEvent.press(screen.getByTestId('toggle-completed-plans'));
  fireEvent(screen.getByTestId('sessions-options-sheet'), 'accessibilityEscape');
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
  mockParams = {};
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
    expect(screen.getByTestId('completed-session-open-button-maestro_exercise_block_history_squat_1-figures')).toHaveTextContent(
      /^3 sets · /
    );
    expect(screen.getByTestId(`session-summary-${ACTIVE}-sets`)).toHaveTextContent(
      `${SESSION_VIEW_FIXTURE.workingSetCount} sets`
    );
  });

  it('resumes the active session on Train, where the workout lives', async () => {
    await openSessions();

    fireEvent.press(screen.getByTestId('resume-active-session-button'));

    expect(mockDismissTo).toHaveBeenCalledWith('/train');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('routes completion through the session cleanup flow instead of completing directly', async () => {
    await openSessions();

    fireEvent.press(screen.getByLabelText('Review and complete active session'));

    expect(mockDismissTo).toHaveBeenCalledWith('/train');
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

  it('hides deleted sessions until shown from the header menu, then marks them, loading once per filter change', async () => {
    const load = loadSpy();
    await openSessions(() => setSessionDeletedState(OLDER_COMPLETED, true));

    expect(screen.queryByTestId(`completed-session-row-${OLDER_COMPLETED}`)).toBeNull();
    fireEvent.press(screen.getByTestId('sessions-options-button'));
    const toggle = screen.getByTestId('toggle-deleted-sessions');
    expect(toggle).toHaveProp('accessibilityRole', 'switch');
    expect(toggle).toHaveProp('accessibilityState', { checked: false });
    expect(toggle).toHaveProp('accessibilityLabel', 'Show deleted sessions');

    fireEvent.press(toggle);

    expect(await screen.findByTestId(`completed-session-deleted-tag-${OLDER_COMPLETED}`)).toHaveTextContent('Deleted');
    expect(screen.getByTestId(`completed-session-open-button-${OLDER_COMPLETED}`)).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(/^Deleted\. Completed session on /)
    );
    expect(screen.getByTestId('toggle-deleted-sessions')).toHaveProp('accessibilityState', { checked: true });
    expect(screen.getByTestId('toggle-deleted-sessions-switch', { includeHiddenElements: true })).toHaveProp('value', true);
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
    await waitForGone(() => screen.queryByTestId(`active-session-row-${ACTIVE}`));
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

  it('shows each row\'s PRs, and gives a row no actions: the whole row opens the session', async () => {
    await openSessions();

    expect(
      screen.getByTestId(`completed-session-open-button-${EXERCISE_BLOCK_HISTORY_FIXTURE.onePrCompletionSessionId}-record`)
    ).toHaveTextContent(/^2 PRs$/);
    expect(screen.queryByTestId(`completed-session-open-button-${OLDER_COMPLETED}-record`)).toBeNull();
    expect(screen.queryByTestId(/^completed-session-menu-button-/)).toBeNull();
    expect(screen.getByTestId(`completed-session-open-button-${NEWEST_COMPLETED}`)).toHaveProp(
      'accessibilityHint',
      'Opens the completed session'
    );
  });

  it('lists the history without PR lines when the records read fails (optional enrichment)', async () => {
    const recordsRead = jest
      .spyOn(exerciseSessionFacts, 'loadFlaggedExerciseSessionFacts')
      .mockRejectedValueOnce(new Error('facts unavailable'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await openSessions();

    expect(recordsRead).toHaveBeenCalled();
    expect(screen.getAllByTestId(/^completed-session-row-/).length).toBeGreaterThan(0);
    expect(screen.queryByTestId(/-record$/)).toBeNull();
    expect(screen.queryByTestId('session-list-load-error')).toBeNull();
  });

  it('stamps a row with the local start time, not the stored UTC clock', async () => {
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

    expect(screen.getByTestId(`completed-session-open-button-${lateId}-start`)).toHaveTextContent('24-07-2026 23:45');
    expect(screen.getByTestId(`completed-session-tag-${lateId}`)).toHaveTextContent('Completed');
    expect(screen.getByTestId(`completed-session-date-${lateId}`)).toHaveTextContent('25-07-2026');
    expect(screen.getByTestId(`completed-session-open-button-${lateId}`).props.accessibilityLabel).toContain('Completed 25-07-2026');

    await act(async () => {
      setExerciseListPreferences({ dateFormat: 'MM-DD-YYYY' });
    });
    expect(screen.getByTestId(`completed-session-date-${lateId}`)).toHaveTextContent('07-25-2026');
    expect(screen.getByTestId(`completed-session-open-button-${lateId}-start`)).toHaveTextContent('07-24-2026 23:45');

    await act(async () => {
      setExerciseListPreferences({ dateFormat: 'YYYY-MM-DD' });
    });
    expect(screen.getByTestId(`completed-session-open-button-${lateId}-start`)).toHaveTextContent('2026-07-24 23:45');

    await act(async () => {
      setExerciseListPreferences({ dateFormat: 'DD-MM-YYYY' });
    });
    expect(screen.getByTestId(`completed-session-open-button-${lateId}-start`)).toHaveTextContent('24-07-2026 23:45');
  });
});

// Races real data cannot stage: the loads are held open by an injected client.
const localDateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const mondayKey = (date: Date): string =>
  localDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7)));

describe('Sessions opened at a week or day of a history grid', () => {
  let scrollToLocation: jest.SpyInstance;
  beforeEach(() => {
    scrollToLocation = jest.spyOn(SectionList.prototype, 'scrollToLocation').mockImplementation(() => {});
  });

  it('opens the whole list at the week from `?week=`, its hub and every row still there', async () => {
    const weekDay = new Date(Date.now() - 26 * 24 * 60 * 60 * 1000);
    mockParams = { week: localDateKey(weekDay) };
    await openSessions();

    expect(screen.getByTestId(`active-session-row-${ACTIVE}`)).toBeTruthy();
    expect(screen.getByTestId('sessions-plan-session-action')).toBeTruthy();
    expect(screen.getAllByTestId(/^completed-session-row-/).length).toBeGreaterThan(1);
    const weeks = screen.getAllByTestId(/^completed-history-week-/).map((node) => String(node.props.testID));
    const sectionIndex = weeks.indexOf(`completed-history-week-${mondayKey(weekDay)}`);
    expect(sectionIndex).toBeGreaterThan(0);
    expect(scrollToLocation).toHaveBeenCalledTimes(1);
    expect(scrollToLocation).toHaveBeenCalledWith({ sectionIndex, itemIndex: 0, viewPosition: 0, animated: false });
  });

  it('opens at the top when the param is malformed', async () => {
    mockParams = { week: '2026-02-30' };
    await openSessions();

    expect(scrollToLocation).not.toHaveBeenCalled();
  });

  const completedAt = (id: string, at: Date): SessionListItem => ({
    id,
    startedAt: new Date(at.getTime() - 3_600_000).toISOString(),
    status: 'completed',
    completedAt: at.toISOString(),
    durationSec: 3_600,
    durationDisplay: '1h',
    gymName: null,
    exerciseCount: 1,
    setCount: 3,
    totalWeight: 0,
    deletedAt: null,
    records: [],
  });

  const clientWith = (sessions: SessionListItem[]): SessionListDataClient => ({
    loadSessions: jest.fn(async () => sessions),
    startSession: jest.fn(),
    completeActiveSession: jest.fn(),
    discardActiveSession: jest.fn(),
  });

  const at = (day: Date, offsetDays: number, hour: number) =>
    new Date(day.getFullYear(), day.getMonth(), day.getDate() + offsetDays, hour);
  // The target week is three weeks back: its Wednesday holds two sessions, its Friday one.
  const today = new Date();
  const wednesday = at(today, -((today.getDay() + 6) % 7) - 21 + 2, 12);
  const sessions = [
    completedAt('today', at(today, 0, 0)),
    completedAt('friday', at(wednesday, 2, 18)),
    completedAt('wednesday-evening', at(wednesday, 0, 19)),
    completedAt('wednesday-morning', at(wednesday, 0, 7)),
  ];

  it('lands a day jump on its newest row, and a day without one on its week heading', async () => {
    const view = render(<SessionsScreen dataClient={clientWith(sessions)} isFocused jumpTo={parseHistoryJump({ day: localDateKey(wednesday) })} />);
    await screen.findByTestId('completed-session-row-friday');
    // Section 1 is the target week; row 1 is Friday, row 2 Wednesday's newest.
    expect(scrollToLocation).toHaveBeenLastCalledWith({ sectionIndex: 1, itemIndex: 2, viewPosition: 0, animated: false });
    view.unmount();

    render(<SessionsScreen dataClient={clientWith(sessions)} isFocused jumpTo={parseHistoryJump({ day: localDateKey(at(wednesday, 1, 12)) })} />);
    await screen.findByTestId('completed-session-row-friday');
    expect(scrollToLocation).toHaveBeenLastCalledWith({ sectionIndex: 1, itemIndex: 0, viewPosition: 0, animated: false });
  });

  it('jumps once: a focus reload keeps the reader where they scrolled', async () => {
    const client = clientWith(sessions);
    const jumpTo = parseHistoryJump({ week: localDateKey(wednesday) });
    const view = render(<SessionsScreen dataClient={client} isFocused jumpTo={jumpTo} />);
    await screen.findByTestId('completed-session-row-friday');

    view.rerender(<SessionsScreen dataClient={client} isFocused={false} jumpTo={jumpTo} />);
    view.rerender(<SessionsScreen dataClient={client} isFocused jumpTo={jumpTo} />);
    await waitFor(() => expect(client.loadSessions).toHaveBeenCalledTimes(2));

    expect(scrollToLocation).toHaveBeenCalledTimes(1);
  });

  it('drops a target the first load lacks, rather than jumping to it on a later load', async () => {
    // The target week's sessions are not there yet on the first read (deleted
    // since, then shown by a later reload).
    const loadSessions = jest.fn()
      .mockResolvedValueOnce(sessions.slice(0, 1))
      .mockResolvedValue(sessions);
    const client = { ...clientWith(sessions), loadSessions };
    const jumpTo = parseHistoryJump({ week: localDateKey(wednesday) });
    const view = render(<SessionsScreen dataClient={client} isFocused jumpTo={jumpTo} />);
    await screen.findByTestId('completed-session-row-today');

    view.rerender(<SessionsScreen dataClient={client} isFocused={false} jumpTo={jumpTo} />);
    view.rerender(<SessionsScreen dataClient={client} isFocused jumpTo={jumpTo} />);
    await screen.findByTestId('completed-session-row-friday');

    expect(scrollToLocation).not.toHaveBeenCalled();
  });

  it('jumps only once the plans above the history have loaded, so they cannot push the target down', async () => {
    let releasePlans!: () => void;
    const plansLoaded = new Promise<void>((resolve) => { releasePlans = resolve; });
    const upcoming = jest.spyOn(planQueries, 'listUpcomingPlans').mockImplementation(async () => {
      await plansLoaded;
      return [];
    });
    render(<SessionsScreen dataClient={clientWith(sessions)} isFocused jumpTo={parseHistoryJump({ week: localDateKey(wednesday) })} />);
    await screen.findByTestId('completed-session-row-friday');
    expect(upcoming).toHaveBeenCalled();
    expect(scrollToLocation).not.toHaveBeenCalled();

    await act(async () => releasePlans());

    await waitFor(() => expect(scrollToLocation).toHaveBeenCalledTimes(1));
    expect(scrollToLocation).toHaveBeenCalledWith({ sectionIndex: 1, itemIndex: 0, viewPosition: 0, animated: false });
  });

  it('renders every row down to the target up front, so its offset is measured, not estimated', async () => {
    render(<SessionsScreen dataClient={clientWith(sessions)} isFocused jumpTo={parseHistoryJump({ day: localDateKey(wednesday) })} />);
    await screen.findByTestId('completed-session-row-friday');

    // Week 0: heading, row, footer; then the target week's heading, Friday and Wednesday's newest.
    expect(screen.UNSAFE_getByType(SectionList).props.initialNumToRender).toBe(24 + 5);
  });

  it('aims again until the rows are measured, and logs a jump it cannot make', async () => {
    const warn = jest.spyOn(logEventModule, 'logEvent').mockResolvedValue();
    render(<SessionsScreen dataClient={clientWith(sessions)} isFocused jumpTo={parseHistoryJump({ week: localDateKey(wednesday) })} />);
    await screen.findByTestId('completed-session-row-friday');
    const list = screen.UNSAFE_getByType(SectionList);
    expect(scrollToLocation).toHaveBeenCalledTimes(1);
    jest.useFakeTimers();
    try {

      const fail = () => list.props.onScrollToIndexFailed({ index: 3, averageItemLength: 80, highestMeasuredFrameIndex: 1 });
      act(fail);
      expect(scrollToLocation).toHaveBeenCalledTimes(1);
      act(() => jest.advanceTimersByTime(50));
      expect(scrollToLocation).toHaveBeenCalledTimes(2);
      expect(warn).not.toHaveBeenCalled();

      // Forty attempts (two seconds), then it says so instead of trying forever.
      for (let attempt = 2; attempt <= 41; attempt += 1) {
        act(fail);
        act(() => jest.advanceTimersByTime(50));
      }
      expect(scrollToLocation).toHaveBeenCalledTimes(41);
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn', event: 'sessions.history_jump_failed' }));
    } finally {
      jest.useRealTimers();
    }
  });
});

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
    records: [],
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
    showDeletedSessions();
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

  it('keeps the rows on screen while a focus reload is in flight', async () => {
    const shown = session('completed-session-1', '2026-07-25T10:00:00.000Z');
    const reload = createDeferred<SessionListItem[]>();
    const dataClient = heldClient(Promise.resolve([shown]), reload.promise);
    const view = render(<SessionsScreen dataClient={dataClient} isFocused />);
    expect(await screen.findByTestId(`completed-session-row-${shown.id}`)).toBeTruthy();

    view.rerender(<SessionsScreen dataClient={dataClient} isFocused={false} />);
    view.rerender(<SessionsScreen dataClient={dataClient} isFocused />);
    await waitFor(() => expect(dataClient.loadSessions).toHaveBeenCalledTimes(2));

    expect(screen.getByTestId(`completed-session-row-${shown.id}`)).toBeTruthy();
    expect(screen.queryByTestId('session-list-loading-state')).toBeNull();
    await act(async () => {
      reload.resolve([]);
      await reload.promise;
    });
    expect(screen.queryByTestId(`completed-session-row-${shown.id}`)).toBeNull();
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

// The weeks are read against the clock, so these sessions are dated from it.
describe('Sessions history weeks', () => {
  const daysAgo = (days: number): string => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, now.getHours(), now.getMinutes()).toISOString();
  };

  const completed = (id: string, completedAt: string): SessionListItem => ({
    id,
    startedAt: completedAt,
    status: 'completed',
    completedAt,
    durationSec: 3_600,
    durationDisplay: '1h',
    gymName: null,
    exerciseCount: 2,
    setCount: 6,
    totalWeight: 0,
    deletedAt: null,
    records: [],
  });

  const clientWith = (sessions: SessionListItem[]): SessionListDataClient => ({
    loadSessions: jest.fn(async () => sessions),
    startSession: jest.fn(),
    completeActiveSession: jest.fn(),
    discardActiveSession: jest.fn(),
  });

  it('heads each week holding sessions, and folds the empty weeks between into one line', async () => {
    render(
      <SessionsScreen
        dataClient={clientWith([
          completed('this-week', daysAgo(0)),
          completed('last-week', daysAgo(7)),
          completed('five-weeks-ago', daysAgo(35)),
        ])}
        isFocused
      />
    );

    await screen.findByTestId('completed-session-row-five-weeks-ago');
    const headings = screen.getAllByTestId(/^completed-history-week-/);
    expect(headings).toHaveLength(3);
    expect(headings[0]).toHaveTextContent(/^This week.* · 1 session$/);
    expect(headings[1]).toHaveTextContent(/^Last week.* · 1 session$/);
    // Weeks 2, 3 and 4 back held nothing: one line, before the week that ends the gap.
    const gaps = screen.getAllByTestId(/^completed-history-gap-/);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toHaveTextContent('No sessions · 3 weeks');
    expect(headings[2]).toHaveTextContent(/No sessions · 3 weeks.*1 session$/);
  });

  it('renders a long history a screenful at a time, not every row up front', async () => {
    const history = Array.from({ length: 200 }, (_, index) => completed(`history-${index}`, daysAgo(index)));
    render(<SessionsScreen dataClient={clientWith(history)} isFocused />);

    await screen.findByTestId('completed-session-row-history-0');
    const rendered = screen.getAllByTestId(/^completed-session-row-/).length;
    expect(rendered).toBeGreaterThan(5);
    expect(rendered).toBeLessThan(history.length);
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
      'Tomorrow, 06-10-2026 07:00',
      'Later Week, 12-10-2026 07:00',
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

  it('surfaces training programmes in Unscheduled and supports creating programmes', async () => {
    await openSessions(async () => {
      await planRepository.createProgramme({
        name: 'Block Periodization',
        description: '4 weeks',
        plans: [
          planDraft({ title: 'Accumulation A' }),
          planDraft({ title: 'Accumulation B' }),
        ],
      });
    });

    const programmeRow = screen.getByTestId(/^sessions-plan-section-unscheduled-programme-/);
    expect(programmeRow).toBeTruthy();
    expect(programmeRow.props.accessibilityLabel).toContain('Block Periodization');
    expect(programmeRow.props.accessibilityLabel).toContain('2 sessions');

    fireEvent.press(programmeRow);
    const progId = String(programmeRow.props.testID).replace('sessions-plan-section-unscheduled-programme-', '');
    expect(mockPush).toHaveBeenCalledWith(`/programme/${progId}`);

    fireEvent.press(screen.getByTestId('sessions-new-programme-action'));
    expect(mockPush).toHaveBeenCalledWith('/programme/new');
  });

  it('keeps outcome labels, local days and routes in the completed section', async () => {
    const finished = new Date(2026, 9, 25, 0, 30);
    let programmeId = '';
    let completePlanId = '';
    let skippedPlanId = '';
    const resolvePlan = async (id: string, outcome: 'completed' | 'skipped', date: Date | null) => {
      const plan = (await planQueries.loadPlanDetail(id))!;
      for (const block of plan.blocks) {
        localDataClient().prepare('UPDATE session_plan_exercises SET progress_status = ?, resolved_at = ? WHERE id = ?')
          .run(outcome, date?.getTime() ?? null, block.id);
      }
    };
    await openSessions(async () => {
      await seedPlans();
      completePlanId = (await planQueries.listUpcomingPlans())[0].id;
      skippedPlanId = (await planQueries.listUnscheduledPlans())[0].id;
      await resolvePlan(completePlanId, 'completed', finished);
      await resolvePlan(skippedPlanId, 'skipped', null);
      const programme = await planRepository.createProgramme({
        name: 'Finished wave', description: '', plans: [planDraft(), planDraft()],
      });
      if (programme.status !== 'saved') throw new Error('seed failed');
      programmeId = programme.id;
      for (const plan of (await planQueries.loadProgrammeDetail(programmeId))!.plans) {
        await resolvePlan(plan.id, 'completed', finished);
      }
    });
    showCompletedPlans();
    const done = screen.getByTestId(`sessions-plan-section-completed-row-${completePlanId}`);
    expect(within(done).getByText('Completed')).toBeTruthy();
    expect(within(done).getByText('25-10-2026 · 1 block · 1 completed · 0 skipped')).toBeTruthy();
    expect(done.props.accessibilityLabel).toContain('Completed, 25-10-2026');
    expect(within(done).queryByText('06-10-2026 07:00')).toBeNull();
    expect(planRowLabels('sessions-plan-section-upcoming')[0]).toContain('Later Week');
    const skipped = screen.getByTestId(`sessions-plan-section-completed-row-${skippedPlanId}`);
    expect(within(skipped).getByText('Skipped')).toBeTruthy();
    expect(within(skipped).getByText('1 block · 0 completed · 1 skipped')).toBeTruthy();
    expect(within(skipped).queryByText(/Unscheduled/)).toBeNull();
    const programme = screen.getByTestId(`sessions-plan-section-completed-programme-${programmeId}`);
    expect(within(programme).getByText('Completed')).toBeTruthy();
    expect(within(programme).getByText('Programme · 2 sessions · 25-10-2026')).toBeTruthy();
    expect(programme.props.accessibilityLabel).toContain('Completed 25-10-2026');
    expect(screen.getAllByTestId(/^completed-session-row-/)).toHaveLength(11);
    fireEvent.press(done);
    expect(mockPush).toHaveBeenLastCalledWith(`/session-plan/${completePlanId}`);
    fireEvent.press(programme);
    expect(mockPush).toHaveBeenLastCalledWith(`/programme/${programmeId}`);

    await act(async () => setExerciseListPreferences({ dateFormat: 'YYYY-MM-DD' }));
    expect(within(screen.getByTestId(`sessions-plan-section-completed-row-${completePlanId}`)).getByText(/^2026-10-25 ·/)).toBeTruthy();
  });

  it('refreshes completion on focus and retains the last rows after a failed plan read', async () => {
    const view = await openSessions(seedPlans);
    showCompletedPlans();
    const id = (await planQueries.listUpcomingPlans())[0].id;
    const block = (await planQueries.loadPlanDetail(id))!.blocks[0];
    mockIsFocused = false;
    view.rerender(<SessionsRoute />);
    await skipPlanBlock(block.id, new Date(2026, 9, 25, 12));
    mockIsFocused = true;
    view.rerender(<SessionsRoute />);
    const row = () => within(screen.getByTestId(`sessions-plan-section-completed-row-${id}`));
    await waitFor(() => expect(row().getByText('Skipped')).toBeTruthy());
    jest.spyOn(planQueries, 'listUpcomingPlans').mockRejectedValueOnce(new Error('failed read'));
    mockIsFocused = false;
    view.rerender(<SessionsRoute />);
    mockIsFocused = true;
    view.rerender(<SessionsRoute />);
    await screen.findByTestId('sessions-plans-error');
    expect(row().getByText('Skipped')).toBeTruthy();
  });
});

describe('Sessions completed-plan visibility over real data', () => {
  const store = createDrizzleSessionPlanStore();
  const now = new Date(2026, 10, 4, 10);
  const planInput = (title: string, scheduledFor: Date | null = null) => ({
    title, scheduledFor, gymId: null,
    exercises: [{
      exerciseDefinitionId: 'seed_barbell_bench_press', name: 'Bench Press',
      sets: [{ targetWeightValue: '100', targetReps: 5, targetSetType: null }],
    }],
  });
  const resolvePlan = async (id: string, status: 'completed' | 'skipped' = 'completed') => {
    const detail = await planQueries.loadPlanDetail(id);
    for (const block of detail!.blocks) {
      await store.resolvePlanBlock({ planExerciseId: block.id, status, now });
    }
  };
  const planRow = (id: string, queue = 'unscheduled') => `sessions-plan-section-${queue}-row-${id}`;
  const programmeRow = (id: string, queue = 'unscheduled') => `sessions-plan-section-${queue}-programme-${id}`;
  const openOptions = () => fireEvent.press(screen.getByTestId('sessions-options-button'));
  const toggleCompleted = () => fireEvent.press(screen.getByTestId('toggle-completed-plans'));
  const dismissOptions = () => fireEvent(screen.getByTestId('sessions-options-sheet'), 'accessibilityEscape');
  const rowIds = (queue: string) => screen.getAllByTestId(new RegExp(`^sessions-plan-section-${queue}-(row|programme)-`))
    .map((node) => node.props.testID);

  it('keeps partial programmes and unfinished children in their queues while resolved children appear once in programme order', async () => {
    let partial!: Awaited<ReturnType<typeof store.saveProgrammeGraph>>;
    let full!: Awaited<ReturnType<typeof store.saveProgrammeGraph>>;
    let future!: string;
    await openSessions(async () => {
      future = await store.savePlanGraph(planInput('Completed in advance', new Date(2030, 0, 1)));
      partial = await store.saveProgrammeGraph({ name: 'Partial wave', description: null, plans: [
        planInput('Unscheduled completed child'), planInput('Later unfinished child', new Date(2026, 10, 8)),
        planInput('Scheduled skipped child', now), planInput('Sooner unfinished child', new Date(2026, 10, 7)),
      ] }, now);
      full = await store.saveProgrammeGraph({ name: 'Resolved wave', description: null, plans: [planInput('Resolved unscheduled child')] }, new Date(2026, 10, 3));
      await resolvePlan(future);
      await resolvePlan(partial.planIds[0]);
      await resolvePlan(partial.planIds[2], 'skipped');
      await resolvePlan(full.planIds[0]);
    });
    const parent = screen.getByTestId(programmeRow(partial.programmeId));
    expect(within(parent).getByText('1/4 completed')).toBeTruthy();
    expect(within(parent).getByText('Programme · 4 sessions · 1 skipped')).toBeTruthy();
    expect(parent.props.accessibilityLabel).toBe('Programme Partial wave, 4 sessions, 1 of 4 sessions completed, 1 skipped');
    const fractionTag = parent.findByType(Tag);
    expect(fractionTag.props).toEqual({ label: '1/4 completed' });
    expect(within(parent).getAllByText('1/4 completed')).toHaveLength(1);
    const upcomingIds = [planRow(partial.planIds[3], 'upcoming'), planRow(partial.planIds[1], 'upcoming')];
    expect(rowIds('upcoming')).toEqual(upcomingIds);
    expect(screen.queryByTestId('sessions-plan-section-completed')).toBeNull();

    openOptions(); toggleCompleted(); dismissOptions();
    expect(rowIds('upcoming')).toEqual(upcomingIds);
    expect(rowIds('unscheduled')).toEqual([programmeRow(partial.programmeId)]);
    expect(rowIds('completed')).toEqual([
      programmeRow(full.programmeId, 'completed'), planRow(partial.planIds[2], 'completed'),
      planRow(future, 'completed'), planRow(partial.planIds[0], 'completed'), planRow(full.planIds[0], 'completed'),
    ]);
    expect(screen.getAllByText('1/4 completed')).toHaveLength(1);
    expect(screen.getByTestId(programmeRow(full.programmeId, 'completed')).findByType(Tag).props).toEqual({ label: 'Completed' });
    expect(screen.queryByTestId(planRow(future, 'upcoming'))).toBeNull();
    expect(screen.queryByTestId(planRow(partial.planIds[0]))).toBeNull();
    fireEvent.press(screen.getByTestId(planRow(partial.planIds[0], 'completed')));
    expect(mockPush).toHaveBeenLastCalledWith(`/session-plan/${partial.planIds[0]}`);
    const headings = screen.getAllByRole('header').map((heading) => heading.props.children);
    expect(headings.indexOf('Unscheduled')).toBeLessThan(headings.indexOf('Completed plans'));
    expect(screen.getAllByTestId(/^completed-session-row-/)).toHaveLength(11);
  });

  it.each([false, true])('refreshes whole-session fractions and child placement on focus with completed visibility %s', async (showCompleted) => {
    let programme!: Awaited<ReturnType<typeof store.saveProgrammeGraph>>;
    const view = await openSessions(async () => {
      programme = await store.saveProgrammeGraph({ name: 'Refreshed wave', description: null, plans: [planInput('First'), planInput('Second')] });
    });
    await screen.findByText('0/2 completed');
    if (showCompleted) { openOptions(); toggleCompleted(); dismissOptions(); }
    mockIsFocused = false;
    view.rerender(<SessionsRoute />);
    await resolvePlan(programme.planIds[0]);
    mockIsFocused = true;
    view.rerender(<SessionsRoute />);
    await screen.findByText('1/2 completed');
    expect(screen.getByTestId(programmeRow(programme.programmeId)).props.accessibilityLabel).toContain('1 of 2 sessions completed');
    if (showCompleted) {
      expect(screen.getByTestId(planRow(programme.planIds[0], 'completed'))).toBeTruthy();
    } else {
      expect(screen.queryByTestId('sessions-plan-section-completed')).toBeNull();
    }
    expect(screen.queryByTestId(planRow(programme.planIds[1]))).toBeNull();
  });

  it('deduplicates completed entities when read sources overlap (synthetic duplicate summaries)', async () => {
    await bootLocalApp();
    const programme = await store.saveProgrammeGraph({ name: 'Resolved', description: null, plans: [planInput('Resolved child', now)] });
    await resolvePlan(programme.planIds[0]);
    const [upcoming, programmes] = await Promise.all([planQueries.listUpcomingPlans(), planQueries.listProgrammeSummaries()]);
    jest.spyOn(planQueries, 'listUpcomingPlans').mockResolvedValue([...upcoming, ...upcoming]);
    jest.spyOn(planQueries, 'listUnscheduledPlans').mockResolvedValue(upcoming);
    jest.spyOn(planQueries, 'listProgrammeSummaries').mockResolvedValue([...programmes, ...programmes]);
    render(<SessionsRoute />);
    await screen.findByTestId('session-list-empty-state');
    openOptions(); toggleCompleted(); dismissOptions();
    expect(rowIds('completed')).toEqual([programmeRow(programme.programmeId, 'completed'), planRow(programme.planIds[0], 'completed')]);
  });

  it('hides completed plans in both queues and scheduled programme children, and only fully resolved programmes', async () => {
    let scheduled!: string, unscheduled!: string;
    let full!: Awaited<ReturnType<typeof store.saveProgrammeGraph>>;
    let partial!: Awaited<ReturnType<typeof store.saveProgrammeGraph>>;
    await openSessions(async () => {
      scheduled = await store.savePlanGraph(planInput('Completed scheduled', now), now);
      unscheduled = await store.savePlanGraph(planInput('All skipped'));
      full = await store.saveProgrammeGraph({ name: 'Completed programme', description: null, plans: [planInput('Completed child', now)] });
      partial = await store.saveProgrammeGraph({ name: 'Partial programme', description: null, plans: [planInput('Resolved child', now), planInput('Pending child', now)] });
      await resolvePlan(scheduled);
      await resolvePlan(unscheduled, 'skipped');
      await resolvePlan(full.planIds[0]);
      await resolvePlan(partial.planIds[0]);
    });
    await screen.findByTestId(programmeRow(partial.programmeId));

    expect(rowIds('upcoming')).toEqual([planRow(partial.planIds[1], 'upcoming')]);
    expect(rowIds('unscheduled')).toEqual([programmeRow(partial.programmeId)]);
    expect(screen.queryByTestId(planRow(scheduled, 'upcoming'))).toBeNull();
    expect(screen.queryByTestId(planRow(unscheduled))).toBeNull();
    expect(screen.queryByTestId(planRow(full.planIds[0], 'upcoming'))).toBeNull();
    expect(screen.queryByTestId(programmeRow(full.programmeId))).toBeNull();
    expect(screen.getAllByTestId(/^completed-session-row-/)).toHaveLength(11);
    // Shared readers remain exhaustive for Today and block selection.
    expect((await planQueries.listUpcomingPlans()).map((plan) => plan.id)).toContain(scheduled);
    expect((await planQueries.listUnscheduledPlans()).map((plan) => plan.id)).toContain(unscheduled);
    expect((await planQueries.listProgrammeSummaries()).map((programme) => programme.id)).toContain(full.programmeId);
  });

  it('partitions resolved rows in source order and keeps routes, with no SQL or history reload on toggle', async () => {
    let completed!: string, pending!: string, older!: string, newer!: string;
    let programme!: Awaited<ReturnType<typeof store.saveProgrammeGraph>>;
    const historyLoad = loadSpy();
    await openSessions(async () => {
      completed = await store.savePlanGraph(planInput('Sooner completed', now));
      pending = await store.savePlanGraph(planInput('Later pending', new Date(2026, 10, 5)));
      older = await store.savePlanGraph(planInput('Older pending'), new Date(2026, 10, 1));
      newer = await store.savePlanGraph(planInput('Newer completed'), now);
      programme = await store.saveProgrammeGraph({ name: 'Resolved programme', description: null, plans: [planInput('Child')] });
      await resolvePlan(completed);
      await resolvePlan(newer);
      await resolvePlan(programme.planIds[0]);
    });
    await screen.findByTestId(planRow(pending, 'upcoming'));
    await screen.findByTestId(planRow(older));
    const statements = jest.spyOn(localDataClient(), 'prepare');
    const upcomingLoad = jest.spyOn(planQueries, 'listUpcomingPlans');
    const unscheduledLoad = jest.spyOn(planQueries, 'listUnscheduledPlans');
    const programmeLoad = jest.spyOn(planQueries, 'listProgrammeSummaries');
    openOptions();
    const toggle = screen.getByRole('switch', { name: 'Show completed plans' });
    expect(toggle).toHaveProp('accessibilityState', { checked: false });
    expect(screen.getAllByRole('switch').map((node) => node.props.accessibilityLabel)).toEqual([
      'Show completed plans', 'Show deleted sessions',
    ]);
    fireEvent.press(toggle);
    expect(screen.getByTestId('toggle-completed-plans')).toHaveProp('accessibilityState', { checked: true });
    expect(screen.getByTestId('toggle-completed-plans-switch', { includeHiddenElements: true })).toHaveProp('value', true);
    dismissOptions();

    expect(rowIds('upcoming')).toEqual([planRow(pending, 'upcoming')]);
    expect(rowIds('unscheduled')).toEqual([planRow(older)]);
    expect(rowIds('completed')).toEqual([programmeRow(programme.programmeId, 'completed'), planRow(completed, 'completed'), planRow(newer, 'completed'), planRow(programme.planIds[0], 'completed')]);
    fireEvent.press(screen.getByTestId(planRow(completed, 'completed')));
    expect(mockPush).toHaveBeenLastCalledWith(`/session-plan/${completed}`);
    fireEvent.press(screen.getByTestId(planRow(newer, 'completed')));
    expect(mockPush).toHaveBeenLastCalledWith(`/session-plan/${newer}`);
    fireEvent.press(screen.getByTestId(programmeRow(programme.programmeId, 'completed')));
    expect(mockPush).toHaveBeenLastCalledWith(`/programme/${programme.programmeId}`);

    openOptions();
    expect(screen.getByTestId('toggle-completed-plans')).toHaveProp('accessibilityState', { checked: true });
    toggleCompleted();
    dismissOptions();
    expect(rowIds('upcoming')).toEqual([planRow(pending, 'upcoming')]);
    expect(rowIds('unscheduled')).toEqual([planRow(older)]);
    expect(statements).not.toHaveBeenCalled();
    expect(upcomingLoad).not.toHaveBeenCalled();
    expect(unscheduledLoad).not.toHaveBeenCalled();
    expect(programmeLoad).not.toHaveBeenCalled();
    expect(historyLoad).toHaveBeenCalledTimes(1);
  });

  it.each(['week', 'day'])('keeps a %s history jump and its rows unchanged when completed plans are revealed', async (param) => {
    const jump = jest.spyOn(SectionList.prototype, 'scrollToLocation').mockImplementation(() => {});
    let completed!: string, pending!: string;
    await openSessions(async () => {
      const history = (await loadSessionSnapshotById(NEWEST_COMPLETED))!;
      mockParams = { [param]: localDateKey(history.completedAt!) };
      completed = await store.savePlanGraph(planInput('Completed above history', now));
      pending = await store.savePlanGraph(planInput('Pending above history', now));
      await resolvePlan(completed);
    });
    await screen.findByTestId(planRow(pending, 'upcoming'));
    await waitFor(() => expect(jump).toHaveBeenCalledTimes(1));
    expect(jump).toHaveBeenCalledWith({ sectionIndex: 0, itemIndex: param === 'week' ? 0 : 1, viewPosition: 0, animated: false });
    expect(screen.queryByTestId(planRow(completed, 'upcoming'))).toBeNull();
    const historyRows = screen.getAllByTestId(/^completed-session-row-/).map((row) => row.props.testID);
    openOptions(); toggleCompleted(); dismissOptions();
    expect(screen.getByTestId(planRow(completed, 'completed'))).toBeTruthy();
    expect(screen.getAllByTestId(/^completed-session-row-/).map((row) => row.props.testID)).toEqual(historyRows);
    expect(jump).toHaveBeenCalledTimes(1);
  });

  it('keeps empty, pending and attached plans/programmes visible even without a materializable next block', async () => {
    await bootLocalApp();
    const emptyPlan = await store.savePlanGraph({ ...planInput('Empty plan'), exercises: [] });
    const emptyProgramme = await store.saveProgrammeGraph({ name: 'Empty programme', description: null, plans: [] });
    const unmapped = await store.saveProgrammeGraph({ name: 'Unmapped programme', description: null, plans: [{ ...planInput('Unmapped child'), exercises: [{ ...planInput('').exercises[0], exerciseDefinitionId: null }] }] });
    const attached = await store.savePlanGraph(planInput('Attached plan', now));
    const started = await startSessionPlan(attached);
    expect(started.status).toBe('started');
    const partial = await store.savePlanGraph({ ...planInput('In progress'), exercises: [...planInput('').exercises, ...planInput('').exercises] });
    const partialDetail = await planQueries.loadPlanDetail(partial);
    await skipPlanBlock(partialDetail!.blocks[0].id);
    render(<SessionsRoute />);
    await screen.findByTestId(planRow(partial));

    expect(screen.getByTestId(planRow(emptyPlan))).toBeTruthy();
    expect(within(screen.getByTestId(programmeRow(emptyProgramme.programmeId))).getByText('0/0 completed')).toBeTruthy();
    expect(screen.getByTestId(programmeRow(unmapped.programmeId))).toBeTruthy();
    expect(screen.getByTestId(planRow(attached, 'upcoming'))).toBeTruthy();
    expect(await planQueries.findNextProgrammeBlock(unmapped.programmeId)).toBeNull();
    expect((await planQueries.loadPlanDetail(attached))?.blockCounts.attached).toBe(1);
    expect(screen.queryByTestId('session-list-empty-state')).toBeNull();
    openOptions(); toggleCompleted(); dismissOptions();
    expect(screen.queryByTestId('sessions-plan-section-completed')).toBeNull();
    expect(screen.getByTestId(planRow(partial))).toBeTruthy();
    expect(within(screen.getByTestId(programmeRow(emptyProgramme.programmeId))).getByText('0/0 completed')).toBeTruthy();
  });

  it.each([false, true])('applies show-completed=%s when focus reloads a plan completed elsewhere', async (showCompleted) => {
    await bootLocalApp();
    const id = await store.savePlanGraph(planInput('Complete elsewhere', now));
    const started = await startSessionPlan(id);
    if (started.status !== 'started') throw new Error('Expected started session');
    const view = render(<SessionsRoute />);
    await screen.findByTestId(planRow(id, 'upcoming'));
    if (showCompleted) { openOptions(); toggleCompleted(); dismissOptions(); }
    mockIsFocused = false;
    view.rerender(<SessionsRoute />);
    const snapshot = (await loadSessionSnapshotById(started.sessionId))!;
    await persistSessionDraftSnapshot({
      sessionId: snapshot.sessionId,
      gymId: snapshot.gymId,
      startedAt: snapshot.startedAt,
      exercises: snapshot.exercises.map((exercise) => ({
        ...exercise,
        sets: exercise.sets.map((set) => ({ ...set, repsValue: '5', weightValue: '100', performanceStatus: null })),
      })),
    });
    await completeSessionDraft(started.sessionId);
    expect(screen.getByTestId(planRow(id, 'upcoming'))).toBeTruthy();
    mockIsFocused = true;
    view.rerender(<SessionsRoute />);
    await screen.findByTestId(`completed-session-row-${started.sessionId}`);
    if (showCompleted) {
      await screen.findByTestId(planRow(id, 'completed'));
      openOptions(); toggleCompleted(); dismissOptions();
    }
    await waitForGone(() => screen.queryByTestId(planRow(id, 'upcoming')));
    expect(screen.queryByTestId('sessions-plan-section-upcoming')).toBeNull();
  });

  it('keeps deleted-history visibility independent and resets both switches on a new mount', async () => {
    let id!: string, deletedPlan!: string;
    const view = await openSessions(async () => {
      id = await store.savePlanGraph(planInput('Resolved'));
      await resolvePlan(id);
      deletedPlan = await store.savePlanGraph(planInput('Deleted'));
      await planRepository.deletePlan(deletedPlan);
      await setSessionDeletedState(OLDER_COMPLETED, true);
    });
    openOptions(); toggleCompleted(); dismissOptions();
    expect(screen.getByTestId(planRow(id, 'completed'))).toBeTruthy();
    expect(screen.queryByTestId(`completed-session-row-${OLDER_COMPLETED}`)).toBeNull();
    showDeletedSessions();
    await screen.findByTestId(`completed-session-deleted-tag-${OLDER_COMPLETED}`);
    toggleCompleted(); dismissOptions();
    expect(screen.queryByTestId(planRow(id, 'completed'))).toBeNull();
    expect(screen.getByTestId(`completed-session-row-${OLDER_COMPLETED}`)).toBeTruthy();
    openOptions(); toggleCompleted(); dismissOptions();
    expect(screen.getByTestId(planRow(id, 'completed'))).toBeTruthy();
    expect(screen.queryByTestId(planRow(deletedPlan))).toBeNull();
    view.unmount();

    render(<SessionsRoute />);
    await screen.findByTestId(`completed-session-row-${NEWEST_COMPLETED}`);
    expect(screen.queryByTestId(planRow(id, 'completed'))).toBeNull();
    expect(screen.queryByTestId(`completed-session-row-${OLDER_COMPLETED}`)).toBeNull();
    openOptions();
    expect(screen.getByTestId('toggle-completed-plans')).toHaveProp('accessibilityState', { checked: false });
    expect(screen.getByTestId('toggle-deleted-sessions')).toHaveProp('accessibilityState', { checked: false });
  });

  it('derives empty sections and the global empty state from visible rows, retaining authoring and options', async () => {
    await bootLocalApp();
    const scheduled = await store.savePlanGraph(planInput('Completed scheduled', now));
    const unscheduled = await store.savePlanGraph(planInput('Completed unscheduled'));
    const programme = await store.saveProgrammeGraph({ name: 'All skipped programme', description: null, plans: [planInput('Skipped')] });
    await resolvePlan(scheduled); await resolvePlan(unscheduled); await resolvePlan(programme.planIds[0], 'skipped');
    render(<SessionsRoute />);
    await screen.findByTestId('session-list-empty-state');
    expect(screen.queryByTestId('sessions-plan-section-upcoming')).toBeNull();
    expect(screen.queryByTestId('sessions-plan-section-unscheduled')).toBeNull();
    expect(screen.getByTestId('sessions-plan-session-action')).toBeTruthy();
    expect(screen.getByTestId('sessions-new-programme-action')).toBeTruthy();
    openOptions(); toggleCompleted(); dismissOptions();
    expect(screen.queryByTestId('session-list-empty-state')).toBeNull();
    expect(screen.getByTestId(planRow(scheduled, 'completed'))).toBeTruthy();
    expect(screen.getByTestId(planRow(unscheduled, 'completed'))).toBeTruthy();
    expect(within(screen.getByTestId(programmeRow(programme.programmeId, 'completed'))).getByText('Completed')).toBeTruthy();
    expect(within(screen.getByTestId(planRow(programme.planIds[0], 'completed'))).getByText('Skipped')).toBeTruthy();
    expect(screen.queryByTestId('sessions-plan-section-upcoming')).toBeNull();
    expect(screen.queryByTestId('sessions-plan-section-unscheduled')).toBeNull();
    openOptions(); toggleCompleted(); dismissOptions();
    expect(screen.queryByTestId('sessions-plan-section-completed')).toBeNull();
    expect(screen.getByTestId('session-list-empty-state')).toBeTruthy();
  });

  it('does not show the global empty state while a planning read is held open (loading)', async () => {
    await bootLocalApp();
    const realUpcoming = planQueries.listUpcomingPlans;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    jest.spyOn(planQueries, 'listUpcomingPlans').mockImplementation(async () => { await held; return realUpcoming(); });
    render(<SessionsRoute />);
    await waitForGone(() => screen.queryByTestId('session-list-loading-state'));
    expect(screen.queryByTestId('session-list-empty-state')).toBeNull();
    openOptions(); toggleCompleted(); dismissOptions();
    expect(screen.queryByTestId('session-list-empty-state')).toBeNull();
    await act(async () => release());
    await screen.findByTestId('session-list-empty-state');
  });

  it('retains the plan-read error and options instead of showing the global empty state (failed read)', async () => {
    await bootLocalApp();
    jest.spyOn(planQueries, 'listUpcomingPlans').mockRejectedValueOnce(new Error('Database unavailable'));
    render(<SessionsRoute />);
    await screen.findByTestId('sessions-plans-error');
    expect(screen.queryByTestId('session-list-empty-state')).toBeNull();
    openOptions(); toggleCompleted(); dismissOptions();
    expect(screen.getByTestId('sessions-plans-error')).toHaveTextContent("Couldn't load your plans.");
    expect(screen.queryByTestId('session-list-empty-state')).toBeNull();
  });
});
