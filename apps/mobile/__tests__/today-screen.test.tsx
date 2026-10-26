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
  it('opens on You with no title, next-workout card or recents list', async () => {
    await renderToday();

    expect(screen.queryByText('Today')).toBeNull();
    expect(screen.getByText('You')).toBeTruthy();
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

    expect(text('today-progress-week-range')).toHaveTextContent('12 – 18 Oct 26');
    const figure = (key: string) => ({
      value: within(text(`today-progress-week-${key}`)).getByTestId(`today-progress-week-${key}-value`),
      previous: text(`today-progress-week-${key}-previous`),
      fill: text(`today-progress-week-${key}-bar-fill`),
    });

    const sessions = figure('sessions');
    expect(sessions.value).toHaveTextContent('1');
    expect(sessions.previous).toHaveTextContent('vs 2');
    expect(sessions.fill).toHaveStyle({ width: '50%', backgroundColor: uiRoles.viz2 });
    expect(text('today-progress-week-sessions')).toHaveProp('accessibilityLabel', 'Sessions 1, vs 2 last week');

    const workingSets = figure('working-sets');
    expect(workingSets.value).toHaveTextContent('6');
    expect(workingSets.previous).toHaveTextContent('vs 12');

    // Thu 15's bench beat Thu 8's: three PRs (one per record kind), matching last week's three — a full bar.
    const prs = figure('prs');
    expect(prs.value).toHaveTextContent('3');
    expect(prs.previous).toHaveTextContent('vs 3');
    expect(prs.fill).toHaveStyle({ width: '100%' });
  });

  it('compares this fixed period so far with the previous period at the same day', async () => {
    await bootLocalApp();
    await logHistory();
    await renderToday();

    // 4-week periods from Monday 29 Dec 2025: Friday 16 Oct is day 12 of 5 Oct – 1 Nov.
    expect(text('today-progress-period-range')).toHaveTextContent('5 Oct – 1 Nov 26');
    expect(text('today-progress-period-previous-range')).toHaveTextContent('7 Sep – 4 Oct 26');
    // This period: 3 sessions, 18 working sets. The previous one to its 12th day (18 Sep): none; all of it: 20 Sep's 6.
    expect(text('today-progress-period-working-sets')).toHaveTextContent('Today 18 sets');
    expect(text('today-progress-period-previous-sets')).toHaveTextContent('0 sets');
    expect(text('today-progress-period-difference')).toHaveTextContent('+18');
    // Ahead is an improvement, in the one colour every change figure uses for
    // one (`design-language.md` §6).
    expect(text('today-progress-period-difference')).toHaveStyle({ color: uiRoles.gain });
    expect(screen.queryByText(/pace/)).toBeNull();
    // The spoken label carries the projection the chart draws (18 over 12 days, across 28: 42).
    expect(text('today-progress-chart')).toHaveProp(
      'accessibilityLabel',
      'Cumulative sets: this period 18 by day 12 of 28 against the last period 0 by day 12; the last period finished at 6. On course for 42.',
    );
    expect(text('today-progress-chart')).toHaveProp('accessibilityRole', 'adjustable');
  });

  it('shows the day the chart selects: its counts, or after today the projection', async () => {
    await bootLocalApp();
    await logHistory();
    await renderToday();
    const chart = text('today-progress-chart');
    // The fallback 326pt chart's plot is 318pt across 28 days.
    const touchDay = (event: 'responderRelease' | 'responderMove', dayIndex: number) =>
      fireEvent(chart, event, { nativeEvent: { locationX: (dayIndex / 27) * 318 } });

    // Wed 7 Oct, day 3: 6 Oct's 6 sets against none by 9 Sep.
    touchDay('responderRelease', 2);
    expect(text('today-progress-period-working-sets')).toHaveTextContent('7 Oct 26 6 sets');
    expect(text('today-progress-period-previous-sets')).toHaveTextContent('0 sets');
    expect(text('today-progress-period-difference')).toHaveTextContent('+6');
    expect(text('today-progress-chart-selection')).toBeTruthy();
    expect(text('today-progress-chart-today')).toBeTruthy();

    // Sunday, day 14: 18 sets over 12 days projects 21; the previous period had 20 Sep's 6, so dragging there.
    // A projected day shows as its date alone; only the spoken value says it is projected.
    touchDay('responderMove', 13);
    expect(text('today-progress-period-working-sets')).toHaveTextContent('18 Oct 26 21 sets');
    expect(screen.queryByText(/projected/)).toBeNull();
    expect(text('today-progress-period-previous-sets')).toHaveTextContent('6 sets');
    expect(text('today-progress-period-difference')).toHaveTextContent('+15');

    // The adjustable chart steps a day at a time, and back to today.
    fireEvent(chart, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(text('today-progress-period-working-sets')).toHaveTextContent('17 Oct 26 20 sets');
    fireEvent(chart, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    fireEvent(chart, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(chart).toHaveProp('accessibilityValue', { text: '19 Oct 26 (projected): 23 sets, last period 6' });
    touchDay('responderRelease', 11);
    expect(text('today-progress-period-working-sets')).toHaveTextContent('Today 18 sets');
    expect(screen.queryByTestId('today-progress-chart-selection')).toBeNull();
    expect(screen.queryByTestId('today-progress-chart-today')).toBeNull();
  });

  it("takes the period from Settings' Progress period and reads again when it changes", async () => {
    await bootLocalApp();
    await logHistory();
    act(() => updatePreferences({ targetWindowWeeks: 3 }));
    const loadProgress = jest.fn(loadTodayProgress);
    await renderToday({ loadProgress });

    // 3 weeks: 28 Sep – 18 Oct against 7 – 27 Sep; 20 Sep falls before day 19.
    expect(text('today-progress-period-range')).toHaveTextContent('28 Sep – 18 Oct 26');
    expect(text('today-progress-period-working-sets')).toHaveTextContent('Today 18 sets');
    expect(text('today-progress-period-difference')).toHaveTextContent('+12');

    // A day picked in one period is not carried into another.
    fireEvent(text('today-progress-chart'), 'responderRelease', { nativeEvent: { locationX: 0 } });
    expect(text('today-progress-period-working-sets')).toHaveTextContent('28 Sep 26 0 sets');

    act(() => updatePreferences({ targetWindowWeeks: 1 }));
    // 1 week is the calendar week: 15 Oct's 6 sets against last week's 12 by Friday.
    await waitFor(() => expect(text('today-progress-period-range')).toHaveTextContent('12 – 18 Oct 26'));
    expect(text('today-progress-period-working-sets')).toHaveTextContent('Today 6 sets');
    expect(text('today-progress-period-previous-sets')).toHaveTextContent('12 sets');
    expect(text('today-progress-period-difference')).toHaveTextContent('−6');
    const options = { compareBack: 1, sessionOffset: 0 };
    expect(loadProgress.mock.calls).toEqual([[NOW, 3, options], [NOW, 1, options]]);
  });

  it('shows the latest completed session with its exercises and opens it, and its Sessions link opens the list', async () => {
    await bootLocalApp();
    await logHistory();
    await renderToday();

    const body = text('today-latest-session');
    expect(text('today-latest-session-start')).toHaveTextContent('15 Oct 26 07:12');
    expect(text('today-latest-session-figures')).toHaveTextContent('2 exercises · 6 sets · 3 PRs @ Iron House');
    // One row per exercise: working sets, best set, its 1RM; the bench's 1RM a PR.
    expect(text('today-latest-session-exercise-0')).toHaveTextContent('Barbell Bench Press3115.0 × 5134.1');
    expect(text('today-latest-session-exercise-0-1rm')).toHaveStyle({ color: uiRoles.record });
    expect(text('today-latest-session-exercise-1')).toHaveTextContent('Barbell Back Squat3100.0 × 5116.6');
    expect(text('today-latest-session-exercise-1-1rm')).not.toHaveStyle({ color: uiRoles.record });
    expect(body.props.accessibilityLabel).toBe(
      'Session on 15 Oct 26 07:12; 2 exercises; 6 sets; 3 PRs; at Iron House; '
        + 'Barbell Bench Press, 3 sets, best 115.0 × 5, 1RM 134.1, a 1RM PR; Barbell Back Squat, 3 sets, best 100.0 × 5, 1RM 116.6',
    );

    fireEvent.press(body);
    fireEvent.press(text('today-sessions-button'));
    expect(mockPush.mock.calls).toEqual([['/completed-session/oct-15'], ['/sessions']]);
    // The link is the session card's own; the section heading carries none.
    expect(within(text('today-session-card')).getByTestId('today-sessions-button')).toBeTruthy();
  });

  it('compares against an earlier period with the arrows around its range, never later than the previous one', async () => {
    await bootLocalApp();
    await logHistory();
    const loadProgress = jest.fn(loadTodayProgress);
    await renderToday({ loadProgress });

    expect(text('today-progress-period-compare-newer')).toBeDisabled();
    fireEvent.press(text('today-progress-period-compare-older'));
    // Two periods back, 10 Aug – 6 Sep: nothing by its 12th day, 3 Sep's 6 sets in all.
    await waitFor(() => expect(text('today-progress-period-previous-range')).toHaveTextContent('10 Aug – 6 Sep 26'));
    expect(text('today-progress-period-range')).toHaveTextContent('5 Oct – 1 Nov 26');
    expect(text('today-progress-period-previous-sets')).toHaveTextContent('0 sets');
    expect(text('today-progress-chart').props.accessibilityLabel).toContain('the period 2 back finished at 6.');
    expect(loadProgress).toHaveBeenLastCalledWith(NOW, 4, { compareBack: 2, sessionOffset: 0 });

    expect(text('today-progress-period-compare-newer')).toBeEnabled();
    // Spoken, the figures are one element: its arrows are its actions.
    expect(text('today-progress-period-figures').props.accessibilityActions).toEqual([
      { name: 'older', label: 'Previous period' },
      { name: 'newer', label: 'Next period' },
    ]);
    fireEvent(text('today-progress-period-figures'), 'accessibilityAction', { nativeEvent: { actionName: 'older' } });
    await waitFor(() => expect(loadProgress).toHaveBeenLastCalledWith(NOW, 4, { compareBack: 3, sessionOffset: 0 }));
    fireEvent(text('today-progress-period-figures'), 'accessibilityAction', { nativeEvent: { actionName: 'newer' } });
    await waitFor(() => expect(loadProgress).toHaveBeenLastCalledWith(NOW, 4, { compareBack: 2, sessionOffset: 0 }));
    fireEvent.press(text('today-progress-period-compare-newer'));
    await waitFor(() => expect(text('today-progress-period-previous-range')).toHaveTextContent('7 Sep – 4 Oct 26'));
    expect(text('today-progress-period-compare-newer')).toBeDisabled();
    expect(text('today-progress-period-figures').props.accessibilityActions).toEqual([{ name: 'older', label: 'Previous period' }]);
  });

  it("steps back through the completed sessions with the arrows around the session's start", async () => {
    await bootLocalApp();
    await logHistory();
    await renderToday();

    expect(text('today-latest-session-step-newer')).toBeDisabled();
    fireEvent.press(text('today-latest-session-step-older'));
    await waitFor(() => expect(text('today-latest-session-start')).toHaveTextContent('8 Oct 26 09:00'));
    expect(text('today-latest-session-figures')).toHaveTextContent('2 exercises · 6 sets · 3 PRs @ Iron House');
    expect(text('today-latest-session-exercise-0')).toHaveTextContent('Barbell Bench Press3110.0 × 5128.2');
    // The figures above it stay on this week and period.
    expect(text('today-progress-period-working-sets')).toHaveTextContent('Today 18 sets');

    fireEvent.press(text('today-latest-session'));
    expect(mockPush).toHaveBeenLastCalledWith('/completed-session/oct-08');

    // Back to the oldest: no older one.
    for (const start of ['6 Oct 26 09:00', '20 Sep 26 09:00', '3 Sep 26 09:00']) {
      fireEvent.press(text('today-latest-session-step-older'));
      await waitFor(() => expect(text('today-latest-session-start')).toHaveTextContent(start));
    }
    expect(text('today-latest-session-step-older')).toBeDisabled();

    fireEvent.press(text('today-latest-session-step-newer'));
    await waitFor(() => expect(text('today-latest-session-start')).toHaveTextContent('20 Sep 26 09:00'));
  });

  it("writes every Today date in Today's own format, whatever the Date format setting", async () => {
    await bootLocalApp();
    await logHistory();
    await renderToday();

    for (const dateFormat of ['MM-DD-YYYY', 'YYYY-MM-DD', 'DD-MM-YYYY'] as const) {
      await act(async () => {
        setExerciseListPreferences({ dateFormat });
      });
      expect(text('today-latest-session-start')).toHaveTextContent('15 Oct 26 07:12');
      expect(text('today-progress-week-range')).toHaveTextContent('12 – 18 Oct 26');
      expect(text('today-progress-period-range')).toHaveTextContent('5 Oct – 1 Nov 26');
    }
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
    expect(text('today-latest-session-start')).toHaveTextContent('16 Oct 26 08:00');

    await act(async () => {
      await setSessionDeletedState('oct-16', true);
    });
    screen.rerender(<TodayScreen isFocused={false} loadProgress={loadProgress} now={clock} groupState={signedOut} />);
    screen.rerender(<TodayScreen isFocused loadProgress={loadProgress} now={clock} groupState={signedOut} />);
    await waitFor(() => expect(text('today-latest-session-start')).toHaveTextContent('15 Oct 26 07:12'));
    expect(loadProgress).toHaveBeenCalledTimes(3);
    expect(loadProgress).toHaveBeenLastCalledWith(NOW, 4, { compareBack: 1, sessionOffset: 0 });
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
    expect(text('today-progress-week-range')).toHaveTextContent('12 – 18 Oct 26');

    // Opened again on Monday 19 October: a new week, day 15 of the period.
    current = local(2026, 10, 19, 8);
    act(() => onAppState?.('background'));
    expect(loadProgress).toHaveBeenCalledTimes(1);
    act(() => onAppState?.('active'));
    await waitFor(() => expect(text('today-progress-week-range')).toHaveTextContent('19 – 25 Oct 26'));
    expect(text('today-progress-chart').props.accessibilityLabel).toContain('by day 15 of 28');
    expect(loadProgress).toHaveBeenLastCalledWith(current, 4, { compareBack: 1, sessionOffset: 0 });

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
    expect(text('today-progress-week-sessions-previous')).toHaveTextContent('vs 4');
    // One bench climb this week: its 1RM, Weight and Volume.
    expect(text('today-progress-week-prs-value')).toHaveTextContent('3');
    // 7 sessions of 9 sets, and this morning's 9 more, by day 12 against 4 (8, 11, 14 and 17 Sep).
    expect(text('today-progress-period-difference')).toHaveTextContent('+36');
    expect(text('today-latest-session-start')).toHaveTextContent('16 Oct 26 07:00');
    expect(text('today-latest-session-figures')).toHaveTextContent('6 exercises · 18 sets · 3 PRs @ Canal Street Gym');
    // More exercises than the card shows without scrolling.
    expect(text('today-latest-session-exercise-5')).toHaveTextContent('Barbell Bent Over Row370.0 × 581.6');
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

  it('gives You and the group a full-height page each, the next one peeking', async () => {
    await bootLocalApp();
    await seedTodayProgressFixture({ now: NOW, periodWeeks: 4 });
    await renderCards();

    // 393 less both 16pt gutters and the 16pt peek; 700 less the track's 12 + 16.
    expect(text('today-progress-section')).toHaveStyle({ width: 345, height: 672 });
    expect(text('today-group-section')).toHaveStyle({ width: 345, height: 672 });
    // You draws its two cards; the signed-out panel takes the page's one card.
    expect(within(text('today-progress-section')).getByTestId('today-progress-card')).toBeTruthy();
    expect(within(text('today-progress-section')).getByTestId('today-session-card')).toBeTruthy();
    expect(within(text('today-group-section')).getByTestId('today-group-signed-out')).toBeTruthy();
    // The list layout's section headings give way to the tabs.
    expect(screen.getAllByText('You')).toHaveLength(1);
    expect(screen.getAllByText('Groups')).toHaveLength(1);
    expect(within(text('today-group-section-tab')).getByText('Groups')).toBeTruthy();
    expect(screen.getAllByRole('tab').map((tab) => tab.props.testID)).toEqual([
      'today-plan-section-tab',
      'today-progress-section-tab',
      'today-group-section-tab',
    ]);
    expect(selected('today-progress-section-tab')).toBe(true);
  });

  it("selects a day on a tap, never on a drag, which is the cards' swipe", async () => {
    await bootLocalApp();
    await seedTodayProgressFixture({ now: NOW, periodWeeks: 4 });
    await renderCards();
    const chart = text('today-progress-chart');

    fireEvent(chart, 'responderMove', { nativeEvent: { locationX: 0 } });
    expect(text('today-progress-period-day')).toHaveTextContent('Today');
    fireEvent(chart, 'responderRelease', { nativeEvent: { locationX: 0 } });
    expect(text('today-progress-period-day')).toHaveTextContent('5 Oct 26');
  });

  it('draws the period chart to the height the card leaves it', async () => {
    await bootLocalApp();
    await seedTodayProgressFixture({ now: NOW, periodWeeks: 4 });
    await renderCards();

    const chart = () => within(text('today-progress-chart')).UNSAFE_getByType(Svg);
    expect(chart().props).toMatchObject({ width: 326, height: 126 });
    // The drawing sits over its box, so its last height never props the box
    // up: the box takes only what the card leaves, down to its floor.
    expect(text('today-progress-chart')).toHaveStyle({ flexBasis: 0, flexGrow: 1, minHeight: 72 });
    expect(chart().parent?.parent?.props.style).toMatchObject({ position: 'absolute' });
    layout('today-progress-chart', { width: 313, height: 240 });
    expect(chart().props).toMatchObject({ width: 313, height: 240 });
  });

  it('moves between the pages by tab or by swipe; the session card carries the Sessions link', async () => {
    await bootLocalApp();
    await logHistory();
    await renderCards();

    fireEvent.press(text('today-group-section-tab'));
    expect(selected('today-group-section-tab')).toBe(true);
    expect(selected('today-progress-section-tab')).toBe(false);

    // A swipe back settles on the first card's offset, the Plan page.
    fireEvent(text('today-screen-pager'), 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: 0, y: 0 } } });
    expect(selected('today-plan-section-tab')).toBe(true);
    // One card's step (345 + the 8pt gap) on.
    fireEvent(text('today-screen-pager'), 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: 353, y: 0 } } });
    expect(selected('today-progress-section-tab')).toBe(true);
    fireEvent(text('today-screen-pager'), 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: 706, y: 0 } } });
    expect(selected('today-group-section-tab')).toBe(true);

    fireEvent.press(text('today-sessions-button'));
    expect(mockPush.mock.calls).toEqual([['/sessions']]);
    // No footer links: a panel's own action is its way on.
    expect(screen.queryByTestId('today-view-groups-button')).toBeNull();
  });

  it.each([
    ['a pending read', () => new Promise<TodayProgress>(() => {}), 'today-progress-loading'],
    ['a failed read', () => Promise.reject(new Error('database is locked')), 'today-progress-error'],
    ['no completed session', () => Promise.resolve({ status: 'empty' } as const), 'today-progress-empty'],
  ])("fills the You page's card with its panel for %s", async (_state, loadProgress, panel) => {
    await bootLocalApp();
    render(<TodayScreen groupState={signedOut} layout="cards" loadProgress={loadProgress} now={clock} />);

    await waitFor(() => expect(within(text('today-progress-section')).getByTestId(panel)).toBeTruthy());
    // Centred in the card's whole body rather than drawn in a card of its own.
    expect(text(panel)).toHaveStyle({ flex: 1, justifyContent: 'center' });
    expect(screen.queryByTestId('today-session-card')).toBeNull();
  });

  it('holds the session table at four rows tall, however many exercises, and scrolls the rest inside it', async () => {
    await bootLocalApp();
    await logHistory();
    await renderCards();

    // A fixed height, not a cap: fewer exercises leave blank rows, so the card keeps its height between sessions.
    expect(text('today-latest-session-rows')).toHaveStyle({ flexShrink: 1, height: 4 * 32 });
    expect(text('today-latest-session-rows').props.style).not.toMatchObject({ maxHeight: expect.anything() });
    // A page of cards scrolls as a whole on a phone too short for them, rather than clipping.
    expect(within(text('today-progress-section')).getByTestId('today-progress-section-scroll')).toBeTruthy();
  });
});
