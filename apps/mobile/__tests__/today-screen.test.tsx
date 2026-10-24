/* eslint-disable import/first */

/**
 * The Today tab. Its Progress card runs over real data: the progress read
 * over the migrated in-memory SQLite database (helpers/local-data.ts), with
 * sessions written through the app's draft → complete path, and a fixed
 * clock. Only the native database open and the router are replaced. The suite
 * runs in Europe/London (jest.config.js).
 *
 * The group card is injected signed out (`groupState`); its own suite is
 * today-group-card.test.tsx. Named states real data cannot produce: a pending
 * progress read and a failed one.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import Svg from 'react-native-svg';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { ShareBar } from '@/components/today';
import { uiRoles } from '@/components/ui/tokens';
import { upsertLocalGym } from '@/src/data/local-gyms';
import { completeSessionDraft, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { setSessionDeletedState } from '@/src/data/session-list';
import { setExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import { seedTodayProgressFixture } from '@/src/maestro/today-progress-fixture';
import { updatePreferences } from '@/src/preferences/hooks';
import { loadTodayProgress, type TodayProgress } from '@/src/progress-summary';

import { bootLocalApp, closeLocalData, resetLocalData } from './helpers/local-data';
import { waitForGone } from './helpers/wait-for-gone';

import { TodayScreen, type TodayScreenProps } from '../app/(tabs)/today';

const local = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute);

// Friday 16 Oct 2026, noon: this week is Mon 12 – Sun 18, last week Mon 5 – Sun 11.
const NOW = local(2026, 10, 16, 12);
const clock = () => NOW;

const signedOut = { status: 'signed-out' } as const;

// A completed 1-hour session at Iron House from `startedAt`: bench at
// `benchKg` then squat at 100, three working sets each. A heavier bench than
// every earlier session is that session's one PR (estimated 1RM).
const logSession = async (id: string, startedAt: Date, benchKg: number) => {
  const completedAt = new Date(startedAt.getTime() + 60 * 60 * 1000);
  const sets = (exercise: string, weightValue: string) =>
    Array.from({ length: 3 }, (_, index) => ({
      id: `${id}_${exercise}_${index + 1}`,
      weightValue,
      repsValue: '5',
      setType: 'rir_2' as const,
      performanceStatus: null,
    }));
  await upsertLocalGym({ id: 'iron-house', name: 'Iron House' });
  await persistSessionDraftSnapshot(
    {
      sessionId: id,
      gymId: 'iron-house',
      startedAt,
      exercises: [
        { id: `${id}_bench`, exerciseDefinitionId: 'seed_barbell_bench_press', name: 'Barbell Bench Press', sets: sets('bench', String(benchKg)) },
        { id: `${id}_squat`, exerciseDefinitionId: 'seed_barbell_back_squat', name: 'Barbell Back Squat', sets: sets('squat', '100') },
      ],
    },
    { now: completedAt }
  );
  await completeSessionDraft(id, { completedAt, now: completedAt });
};

// September: one session before the 16th, one after (a bench climb). October:
// Tue 6 and Thu 8 last week (Thu a climb), Thu 15 this week (a climb, the
// latest). Each climb beats bench's 1RM, Weight and Volume: three PRs.
const logHistory = async () => {
  await logSession('sep-03', local(2026, 9, 3, 9), 100);
  await logSession('sep-20', local(2026, 9, 20, 9), 105);
  await logSession('oct-06', local(2026, 10, 6, 9), 100);
  await logSession('oct-08', local(2026, 10, 8, 9), 110);
  await logSession('oct-15', local(2026, 10, 15, 7, 12), 115);
};

const renderToday = async (props: Partial<TodayScreenProps> = {}) => {
  await bootLocalApp();
  const view = render(<TodayScreen now={clock} groupState={signedOut} {...props} />);
  await waitForGone(() => screen.queryByTestId('today-progress-loading'));
  return view;
};

const text = (testID: string) => screen.getByTestId(testID);

beforeEach(() => {
  resetLocalData();
  mockPush.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
  closeLocalData();
});

describe('Today: the Progress card over real data', () => {
  it('opens on Progress with no title, next-workout card or recents list', async () => {
    await renderToday();

    expect(screen.queryByText('Today')).toBeNull();
    expect(screen.getByText('Progress')).toBeTruthy();
    for (const removed of ['today-training-section', 'today-recents-section', 'today-plan-unavailable', 'today-active-session-card']) {
      expect(screen.queryByTestId(removed)).toBeNull();
    }
  });

  it('shows the first-run panel with no completed session, and Open Train goes to Train', async () => {
    await bootLocalApp();
    // An active draft is not a completed session.
    await persistSessionDraftSnapshot({ sessionId: 'draft', gymId: null, startedAt: local(2026, 10, 16, 9), status: 'active', exercises: [] });
    await renderToday();

    expect(text('today-progress-empty')).toBeTruthy();
    expect(screen.getByText('Your week starts here')).toBeTruthy();
    expect(screen.getByText('Log a workout and your sessions, working sets and PRs show up here, against your last period.')).toBeTruthy();
    expect(screen.queryByTestId('today-progress-card')).toBeNull();

    fireEvent.press(text('today-empty-open-train'));
    expect(mockPush).toHaveBeenCalledWith('/train');
  });

  it('counts this week against the whole of last week', async () => {
    await bootLocalApp();
    await logHistory();
    await renderToday();

    expect(text('today-progress-week-range')).toHaveTextContent('12-10-2026 – 18-10-2026');
    const figure = (key: string) => ({
      value: within(text(`today-progress-week-${key}`)).getByTestId(`today-progress-week-${key}-value`),
      previous: text(`today-progress-week-${key}-previous`),
      fill: text(`today-progress-week-${key}-bar-fill`),
    });

    const sessions = figure('sessions');
    expect(sessions.value).toHaveTextContent('1');
    expect(sessions.previous).toHaveTextContent('vs 2 last wk');
    expect(sessions.fill).toHaveStyle({ width: '50%', backgroundColor: uiRoles.viz2 });
    expect(text('today-progress-week-sessions')).toHaveProp('accessibilityLabel', 'Sessions 1, vs 2 last week');

    const workingSets = figure('working-sets');
    expect(workingSets.value).toHaveTextContent('6');
    expect(workingSets.previous).toHaveTextContent('vs 12 last wk');

    // Thu 15's bench beat Thu 8's: three PRs (one per record kind), matching last week's three — a full bar.
    const prs = figure('prs');
    expect(prs.value).toHaveTextContent('3');
    expect(prs.previous).toHaveTextContent('vs 3 last wk');
    expect(prs.fill).toHaveStyle({ width: '100%' });
  });

  it('compares this fixed period so far with the previous period at the same day', async () => {
    await bootLocalApp();
    await logHistory();
    await renderToday();

    // 4-week periods from Monday 29 Dec 2025: Friday 16 Oct is day 12 of 5 Oct – 1 Nov.
    expect(text('today-progress-period-range')).toHaveTextContent('05-10-2026 – 01-11-2026');
    expect(text('today-progress-period-previous-range')).toHaveTextContent('vs 07-09-2026 – 04-10-2026');
    // This period: 3 sessions, 18 working sets. The previous one to its 12th day (18 Sep): none; all of it: 20 Sep's 6.
    expect(text('today-progress-period-working-sets')).toHaveTextContent('18 sets');
    expect(text('today-progress-period-difference')).toHaveTextContent('+18');
    // Ahead of the pace is an improvement, in the one colour every change
    // figure uses for one (`design-language.md` §6).
    expect(text('today-progress-period-difference')).toHaveStyle({ color: uiRoles.gain });
    expect(text('today-progress-period-pace')).toHaveTextContent("ahead of last period's pace");
    expect(text('today-progress-period-previous-total')).toHaveTextContent('6 sets');
    // The spoken label carries the projection the chart draws (18 over 12 days, across 28: 42).
    expect(text('today-progress-chart')).toHaveProp(
      'accessibilityLabel',
      'Cumulative sets: this period 18 by day 12 of 28 against the last period 0 by day 12; the last period finished at 6. On course for 42.',
    );
    expect(text('today-progress-chart')).toHaveProp('accessibilityRole', 'image');
  });

  it("takes the period from Settings' Progress period and reads again when it changes", async () => {
    await bootLocalApp();
    await logHistory();
    act(() => updatePreferences({ targetWindowWeeks: 3 }));
    const loadProgress = jest.fn(loadTodayProgress);
    await renderToday({ loadProgress });

    // 3 weeks: 28 Sep – 18 Oct against 7 – 27 Sep; 20 Sep falls before day 19.
    expect(text('today-progress-period-range')).toHaveTextContent('28-09-2026 – 18-10-2026');
    expect(text('today-progress-period-working-sets')).toHaveTextContent('18 sets');
    expect(text('today-progress-period-difference')).toHaveTextContent('+12');

    act(() => updatePreferences({ targetWindowWeeks: 1 }));
    // 1 week is the calendar week: 15 Oct's 6 sets against last week's 12 by Friday.
    await waitFor(() => expect(text('today-progress-period-range')).toHaveTextContent('12-10-2026 – 18-10-2026'));
    expect(text('today-progress-period-difference')).toHaveTextContent('−6');
    expect(text('today-progress-period-pace')).toHaveTextContent("behind last period's pace");
    expect(loadProgress.mock.calls).toEqual([[NOW, 3], [NOW, 1]]);
  });

  it('shows the latest completed session and opens it, all sessions and the Progress tab', async () => {
    await bootLocalApp();
    await logHistory();
    await renderToday();

    const row = text('today-latest-session');
    expect(row).toHaveProp(
      'accessibilityLabel',
      'Completed session on 15-10-2026 07:12, 1h, 6 sets, 2 exercises, at Iron House, 3 PRs',
    );
    expect(text('today-latest-session-start')).toHaveTextContent('15-10-2026 07:12');
    expect(text('today-latest-session-figures')).toHaveTextContent('6 sets · 2 exercises');
    // A count, not the names: the row matches the group stream session card.
    expect(screen.queryByTestId('today-latest-session-exercises')).toBeNull();
    expect(screen.queryByText(/Barbell Bench Press/)).toBeNull();
    // Several PRs are only counted; no member header on your own session.
    expect(text('today-latest-session-record')).toHaveTextContent('3 PRs');
    expect(screen.queryByTestId('today-latest-session-member')).toBeNull();

    fireEvent.press(row);
    fireEvent.press(text('today-all-sessions-button'));
    fireEvent.press(text('today-view-progress-button'));
    expect(mockPush.mock.calls).toEqual([['/completed-session/oct-15'], ['/sessions'], ['/progress']]);
  });

  it('formats the latest session start stamp according to user date format preferences', async () => {
    await bootLocalApp();
    await logHistory();
    await renderToday();

    expect(text('today-latest-session-start')).toHaveTextContent('15-10-2026 07:12');

    await act(async () => {
      setExerciseListPreferences({ dateFormat: 'MM-DD-YYYY' });
    });
    expect(text('today-latest-session-start')).toHaveTextContent('10-15-2026 07:12');

    await act(async () => {
      setExerciseListPreferences({ dateFormat: 'YYYY-MM-DD' });
    });
    expect(text('today-latest-session-start')).toHaveTextContent('2026-10-15 07:12');

    await act(async () => {
      setExerciseListPreferences({ dateFormat: 'DD-MM-YYYY' });
    });
    expect(text('today-latest-session-start')).toHaveTextContent('15-10-2026 07:12');
  });

  it('reads again on focus, keeping the figures on screen, so a finished or deleted session shows', async () => {
    await bootLocalApp();
    await logHistory();
    const loadProgress = jest.fn(loadTodayProgress);
    await renderToday({ loadProgress });

    await logSession('oct-16', local(2026, 10, 16, 8), 120);
    screen.rerender(<TodayScreen isFocused={false} loadProgress={loadProgress} now={clock} groupState={signedOut} />);
    screen.rerender(<TodayScreen isFocused loadProgress={loadProgress} now={clock} groupState={signedOut} />);
    expect(screen.queryByTestId('today-progress-loading')).toBeNull();
    await waitFor(() => expect(text('today-progress-week-sessions-value')).toHaveTextContent('2'));
    expect(text('today-latest-session-start')).toHaveTextContent('16-10-2026 08:00');

    await act(async () => {
      await setSessionDeletedState('oct-16', true);
    });
    screen.rerender(<TodayScreen isFocused={false} loadProgress={loadProgress} now={clock} groupState={signedOut} />);
    screen.rerender(<TodayScreen isFocused loadProgress={loadProgress} now={clock} groupState={signedOut} />);
    await waitFor(() => expect(text('today-latest-session-start')).toHaveTextContent('15-10-2026 07:12'));
    expect(loadProgress).toHaveBeenCalledTimes(3);
    expect(loadProgress).toHaveBeenLastCalledWith(NOW, 4);
  });

  it('reads again when the app returns to the foreground, so a new day moves the windows', async () => {
    let onAppState: ((state: AppStateStatus) => void) | undefined;
    const remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      onAppState = listener as (state: AppStateStatus) => void;
      return { remove };
    });
    await bootLocalApp();
    await logHistory();
    let current = NOW;
    const loadProgress = jest.fn(loadTodayProgress);
    const view = await renderToday({ loadProgress, now: () => current });
    expect(text('today-progress-week-range')).toHaveTextContent('12-10-2026 – 18-10-2026');

    // Opened again on Monday 19 October: a new week, day 15 of the period.
    current = local(2026, 10, 19, 8);
    act(() => onAppState?.('background'));
    expect(loadProgress).toHaveBeenCalledTimes(1);
    act(() => onAppState?.('active'));
    await waitFor(() => expect(text('today-progress-week-range')).toHaveTextContent('19-10-2026 – 25-10-2026'));
    expect(text('today-progress-chart').props.accessibilityLabel).toContain('by day 15 of 28');
    expect(loadProgress).toHaveBeenLastCalledWith(current, 4);

    view.unmount();
    expect(remove).toHaveBeenCalled();
  });
});

describe('Today: the day changing while it is open', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('reads again at each local midnight while focused, and stops when unfocused', () => {
    jest.useFakeTimers({ now: NOW });
    const loadProgress = jest.fn<Promise<TodayProgress>, [Date, number]>().mockResolvedValue({ status: 'empty' });
    const view = render(<TodayScreen loadProgress={loadProgress} now={() => new Date()} groupState={signedOut} />);
    expect(loadProgress).toHaveBeenCalledTimes(1);

    // Noon to a minute before midnight: no read; midnight: one, dated the new day.
    act(() => jest.advanceTimersByTime(12 * 60 * 60 * 1000 - 60_000));
    expect(loadProgress).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(60_000));
    expect(loadProgress).toHaveBeenCalledTimes(2);
    expect(loadProgress.mock.calls[1][0]).toEqual(local(2026, 10, 17));
    // And again the next midnight.
    act(() => jest.advanceTimersByTime(24 * 60 * 60 * 1000));
    expect(loadProgress).toHaveBeenCalledTimes(3);

    view.rerender(<TodayScreen isFocused={false} loadProgress={loadProgress} now={() => new Date()} groupState={signedOut} />);
    act(() => jest.advanceTimersByTime(48 * 60 * 60 * 1000));
    expect(loadProgress).toHaveBeenCalledTimes(3);
  });

  it('aims the midnight read again when the app returns to the foreground', () => {
    let onAppState: ((state: AppStateStatus) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      onAppState = listener as (state: AppStateStatus) => void;
      return { remove: jest.fn() };
    });
    jest.useFakeTimers({ now: NOW });
    const loadProgress = jest.fn<Promise<TodayProgress>, [Date, number]>().mockResolvedValue({ status: 'empty' });
    render(<TodayScreen loadProgress={loadProgress} now={() => new Date()} groupState={signedOut} />);

    // Suspended at noon, back at 22:00 the same day with the clock moved but the timer not counted.
    jest.setSystemTime(local(2026, 10, 16, 22));
    act(() => onAppState?.('active'));
    expect(loadProgress).toHaveBeenCalledTimes(2);
    // Two hours on is midnight: one read, not the stale 12-hour one.
    act(() => jest.advanceTimersByTime(2 * 60 * 60 * 1000));
    expect(loadProgress).toHaveBeenCalledTimes(3);
    expect(loadProgress.mock.calls[2][0]).toEqual(local(2026, 10, 17));
    act(() => jest.advanceTimersByTime(10 * 60 * 60 * 1000));
    expect(loadProgress).toHaveBeenCalledTimes(3);
  });
});


describe('Today: the today-progress harness fixture', () => {
  it('draws every part of the card, ahead of the previous period', async () => {
    await bootLocalApp();
    // 7 Sep – 4 Oct: every third day from its 2nd (9). 5 Oct on: every other day to the 15th (6), and this morning.
    await expect(seedTodayProgressFixture({ now: NOW, periodWeeks: 4 })).resolves.toMatchObject({ sessionCount: 16 });
    await renderToday();

    expect(text('today-progress-week-sessions-value')).toHaveTextContent('3');
    expect(text('today-progress-week-sessions-previous')).toHaveTextContent('vs 4 last wk');
    // One bench climb this week: its 1RM, Weight and Volume.
    expect(text('today-progress-week-prs-value')).toHaveTextContent('3');
    // 7 sessions of 9 sets by day 12 against 4 (8, 11, 14 and 17 Sep).
    expect(text('today-progress-period-difference')).toHaveTextContent('+27');
    expect(text('today-latest-session-start')).toHaveTextContent('16-10-2026 07:00');
    expect(text('today-latest-session-figures')).toHaveTextContent('9 sets · 3 exercises');
  });
});

describe('Today: progress read states', () => {
  it('shows loading while the first read is pending (a pending read)', async () => {
    await bootLocalApp();
    render(<TodayScreen loadProgress={() => new Promise<TodayProgress>(() => {})} now={clock} groupState={signedOut} />);

    expect(text('today-progress-loading')).toBeTruthy();
    expect(screen.getByText('Loading your progress…')).toBeTruthy();
  });

  it('reports a failed read inline and retries it (a failed read)', async () => {
    const loadProgress = jest
      .fn<Promise<TodayProgress>, [Date]>()
      .mockRejectedValueOnce(new Error('database is locked'))
      .mockResolvedValueOnce({ status: 'empty' });
    await renderToday({ loadProgress });

    expect(text('today-progress-error')).toBeTruthy();
    expect(screen.getByText('database is locked')).toBeTruthy();

    fireEvent.press(text('today-progress-error-retry'));
    await waitFor(() => expect(text('today-progress-empty')).toBeTruthy());
    expect(loadProgress).toHaveBeenCalledTimes(2);
  });

  it('does not read while unfocused', async () => {
    const loadProgress = jest.fn<Promise<TodayProgress>, [Date, number]>().mockResolvedValue({ status: 'empty' });
    await bootLocalApp();
    render(<TodayScreen isFocused={false} loadProgress={loadProgress} now={clock} groupState={signedOut} />);

    expect(loadProgress).not.toHaveBeenCalled();
    expect(text('today-progress-loading')).toBeTruthy();
  });
});

describe('Today: the share bar', () => {
  const bar = (current: number, previous: number) => {
    render(<ShareBar current={current} previous={previous} testID="bar" />);
    return { track: screen.getByTestId('bar'), fill: screen.getByTestId('bar-fill') };
  };

  it('fills the first lap over the empty track up to last week', () => {
    const { track, fill } = bar(2, 3);

    expect(track).toHaveStyle({ backgroundColor: uiRoles.viz0 });
    expect(fill).toHaveStyle({ width: '67%', backgroundColor: uiRoles.viz2 });
  });

  it('fills the next step over a full first lap once past last week', () => {
    const { track, fill } = bar(4, 3);

    expect(track).toHaveStyle({ backgroundColor: uiRoles.viz2 });
    expect(fill).toHaveStyle({ width: '33%', backgroundColor: uiRoles.viz3 });
  });

  it('stops full in the darkest step past three times last week', () => {
    const { track, fill } = bar(12, 3);

    expect(track).toHaveStyle({ backgroundColor: uiRoles.viz3 });
    expect(fill).toHaveStyle({ width: '100%', backgroundColor: uiRoles.viz4 });
  });
});

describe("Today: the cards layout (Settings' Today layout: Cards)", () => {
  const layout = (testID: string, size: { width: number; height: number }) =>
    fireEvent(text(testID), 'layout', { nativeEvent: { layout: { x: 0, y: 0, ...size } } });

  const renderCards = async (props: Partial<TodayScreenProps> = {}) => {
    const view = await renderToday({ layout: 'cards', ...props });
    // A 393pt-wide phone; the pager between the tabs and the tab bar is 700pt tall.
    layout('today-screen', { width: 393, height: 760 });
    layout('today-screen-pager', { width: 393, height: 700 });
    return view;
  };

  const selected = (testID: string) => text(testID).props.accessibilityState?.selected;

  it('gives Progress and the group a full-height card each, the next one peeking', async () => {
    await bootLocalApp();
    await seedTodayProgressFixture({ now: NOW, periodWeeks: 4 });
    await renderCards();

    // 393 less both 16pt gutters and the 16pt peek; 700 less the track's 12 + 16.
    expect(text('today-progress-section')).toHaveStyle({ width: 345, height: 672 });
    expect(text('today-group-section')).toHaveStyle({ width: 345, height: 672 });
    expect(within(text('today-progress-section')).getByTestId('today-progress-card')).toBeTruthy();
    expect(within(text('today-group-section')).getByTestId('today-group-signed-out')).toBeTruthy();
    // The list layout's section headings and their actions give way to the tabs.
    expect(screen.getAllByText('Progress')).toHaveLength(1);
    expect(screen.getAllByText('Group activity')).toHaveLength(1);
    expect(within(text('today-group-section-tab')).getByText('Group activity')).toBeTruthy();
    expect(screen.getAllByRole('tab').map((tab) => tab.props.testID)).toEqual([
      'today-progress-section-tab',
      'today-group-section-tab',
    ]);
    expect(selected('today-progress-section-tab')).toBe(true);
  });

  it('draws the period chart to the height the card leaves it', async () => {
    await bootLocalApp();
    await seedTodayProgressFixture({ now: NOW, periodWeeks: 4 });
    await renderCards();

    const chart = () => within(text('today-progress-chart')).UNSAFE_getByType(Svg);
    expect(chart().props).toMatchObject({ width: 326, height: 104 });
    layout('today-progress-chart', { width: 313, height: 240 });
    expect(chart().props).toMatchObject({ width: 313, height: 240 });
  });

  it('moves between the cards by tab or by swipe, and each card closes on its link', async () => {
    await bootLocalApp();
    await logHistory();
    await renderCards();

    fireEvent.press(text('today-group-section-tab'));
    expect(selected('today-group-section-tab')).toBe(true);
    expect(selected('today-progress-section-tab')).toBe(false);

    // A swipe back settles on the first card's offset.
    fireEvent(text('today-screen-pager'), 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: 0, y: 0 } } });
    expect(selected('today-progress-section-tab')).toBe(true);
    // One card's step (345 + the 8pt gap) on.
    fireEvent(text('today-screen-pager'), 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: 353, y: 0 } } });
    expect(selected('today-group-section-tab')).toBe(true);

    fireEvent.press(text('today-view-progress-button'));
    fireEvent.press(text('today-view-groups-button'));
    fireEvent.press(text('today-all-sessions-button'));
    expect(mockPush.mock.calls).toEqual([['/progress'], ['/groups'], ['/sessions']]);
  });

  it.each([
    ['a pending read', () => new Promise<TodayProgress>(() => {}), 'today-progress-loading'],
    ['a failed read', () => Promise.reject(new Error('database is locked')), 'today-progress-error'],
    ['no completed session', () => Promise.resolve({ status: 'empty' } as const), 'today-progress-empty'],
  ])('fills the Progress card with its panel for %s', async (_state, loadProgress, panel) => {
    await bootLocalApp();
    render(<TodayScreen groupState={signedOut} layout="cards" loadProgress={loadProgress} now={clock} />);

    await waitFor(() => expect(within(text('today-progress-section')).getByTestId(panel)).toBeTruthy());
    // Centred in the card's whole body rather than drawn in a card of its own.
    expect(text(panel)).toHaveStyle({ flex: 1, justifyContent: 'center' });
    expect(within(text('today-progress-section')).getByTestId('today-view-progress-button')).toBeTruthy();
  });
});
