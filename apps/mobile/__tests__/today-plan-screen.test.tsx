/* eslint-disable import/first */

/**
 * Today's Plan page over real data: sessions written through the app's draft →
 * complete path and plans through the planner repository, on the migrated
 * in-memory SQLite database (helpers/local-data.ts), with a fixed clock. Only
 * the native database open and the router are replaced. Named states real
 * data cannot produce: a pending read and a failed one. Europe/London
 * (jest.config.js).
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { uiRoles, uiSpace } from '@/components/ui/tokens';
import * as exerciseCatalogData from '@/src/data/exercise-catalog';
import { setMuscleTracked } from '@/src/data/muscle-report-settings';
import { completeSessionDraft, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { updatePreferences } from '@/src/preferences/hooks';
import { planRepository, type PlanDraft } from '@/src/session-planner';
import type { TodayPlan } from '@/src/today-plan';

import { bootLocalApp, closeLocalData, resetLocalData } from './helpers/local-data';
import { waitForGone } from './helpers/wait-for-gone';

import { TodayScreen, type TodayScreenProps } from '../app/(tabs)/today';

const local = (year: number, month: number, day: number, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute);

// Saturday 31 Oct 2026, 15:00: this week is Mon 26 Oct – Sun 1 Nov; the recovery days Wed 28 – Fri 30.
const NOW = local(2026, 10, 31, 15);
const clock = () => NOW;
const signedOut = { status: 'signed-out' } as const;

const BENCH = { id: 'seed_barbell_bench_press', name: 'Barbell Bench Press' };
const SQUAT = { id: 'seed_barbell_back_squat', name: 'Barbell Back Squat' };

// A completed session from `startedAt`, `count` working sets of each exercise.
const logSession = async (id: string, startedAt: Date, exercises: { id: string; name: string; count: number }[]) => {
  const completedAt = new Date(startedAt.getTime() + 60 * 60 * 1000);
  await persistSessionDraftSnapshot(
    {
      sessionId: id,
      gymId: null,
      startedAt,
      exercises: exercises.map((exercise) => ({
        id: `${id}_${exercise.id}`,
        exerciseDefinitionId: exercise.id,
        name: exercise.name,
        sets: Array.from({ length: exercise.count }, (_, index) => ({
          id: `${id}_${exercise.id}_${index}`, weightValue: '100', repsValue: '5', setType: 'rir_2' as const, performanceStatus: null,
        })),
      })),
    },
    { now: completedAt },
  );
  await completeSessionDraft(id, { completedAt, now: completedAt });
};

const planDraft = (title: string, scheduledFor: Date | null, exercises = [BENCH]): PlanDraft => ({
  title,
  gymId: null,
  scheduledFor,
  exercises: exercises.map((exercise) => ({
    exerciseDefinitionId: exercise.id,
    name: exercise.name,
    sets: Array.from({ length: 3 }, () => ({ targetWeightText: '80', targetRepsText: '8', targetSetType: null })),
  })),
});

const createPlan = async (title: string, scheduledFor: Date | null, exercises = [BENCH]): Promise<string> => {
  const result = await planRepository.createPlan(planDraft(title, scheduledFor, exercises), local(2026, 10, 20));
  if (result.status !== 'saved') throw new Error(`plan not created: ${result.status}`);
  return result.id;
};

const renderToday = async (props: Partial<TodayScreenProps> = {}) => {
  await bootLocalApp();
  const view = render(<TodayScreen groupState={signedOut} now={clock} {...props} />);
  await waitForGone(() => screen.queryByTestId('today-plan-loading'));
  await waitForGone(() => screen.queryByTestId('today-progress-loading'));
  return view;
};

const text = (testID: string) => screen.getByTestId(testID);
// The planned rows, not their parts or the empty line.
const plannedRows = () =>
  screen.getAllByTestId(/^today-plan-next-/).map((row) => row.props.testID as string)
    .filter((id) => !/-(day|figures|muscles)$/.test(id) && id !== 'today-plan-next-empty');
const muscleRows = () => screen.getAllByTestId(/^today-plan-muscle-[a-z_]+$/).map((row) => row.props.testID.replace('today-plan-muscle-', ''));

beforeEach(() => {
  resetLocalData();
  mockPush.mockReset();
});

afterEach(() => {
  closeLocalData();
});

describe('Today: the Plan page over real data', () => {
  it('is a recovery card and a plan card', async () => {
    await renderToday();

    expect(within(text('today-plan-recovery-card')).getByText('Recovery')).toBeTruthy();
    expect(within(text('today-plan-week-card')).getByText('Plan')).toBeTruthy();
  });

  it("shows each muscle's sets on the last three days, today and this week against the target, least trained first", async () => {
    await bootLocalApp();
    // Monday is this week but no recovery day; Thursday and Friday are; Saturday is today.
    await logSession('mon', local(2026, 10, 26, 9), [{ ...BENCH, count: 4 }]);
    await logSession('thu', local(2026, 10, 29, 9), [{ ...SQUAT, count: 3 }]);
    await logSession('fri', local(2026, 10, 30, 9), [{ ...BENCH, count: 2 }]);
    await logSession('sat', local(2026, 10, 31, 9), [{ ...SQUAT, count: 5 }]);
    await renderToday();

    // The columns: the three recovery days, then today.
    expect(within(text('today-plan-recovery-card')).getByText('Wed')).toBeTruthy();
    expect(text('today-plan-recovery-today')).toHaveTextContent('Sat');
    expect(text('today-plan-muscle-quads-today')).toHaveTextContent('5');
    expect(text('today-plan-muscle-chest-today')).toHaveTextContent('');
    expect(text('today-plan-muscle-quads-week')).toHaveTextContent('8/8');

    const chest = within(text('today-plan-muscle-chest'));
    expect(chest.getByTestId('today-plan-muscle-chest-day-0')).toHaveTextContent('');
    expect(chest.getByTestId('today-plan-muscle-chest-day-1')).toHaveTextContent('');
    expect(chest.getByTestId('today-plan-muscle-chest-day-2')).toHaveTextContent('2');
    expect(text('today-plan-muscle-chest-week')).toHaveTextContent('6/8');
    // Bench's secondary triceps: half a set each.
    expect(text('today-plan-muscle-triceps-day-2')).toHaveTextContent('1');
    expect(text('today-plan-muscle-quads-day-1')).toHaveTextContent('3');

    const order = muscleRows();
    // Untrained muscles first; triceps (1), chest (2), then squat's primary quads and glutes (3).
    expect(order.slice(-3)).toEqual(['chest', 'quads', 'glutes_max']);
    expect(order.indexOf('triceps')).toBeLessThan(order.indexOf('chest'));
    expect(order.indexOf('biceps')).toBeLessThan(order.indexOf('triceps'));
    expect(text('today-plan-muscle-chest').props.accessibilityLabel).toBe(
      'Pectoralis, Wednesday 28 Oct 26: rest, Thursday 29 Oct 26: rest, Friday 30 Oct 26: 2 sets, today: none yet, this week 6 of 8 sets',
    );
    expect(text('today-plan-muscle-quads').props.accessibilityLabel).toContain('Friday 30 Oct 26: rest, today: 5 sets, this week 8 of 8 sets');
  });

  it.each([
    ['Monday', local(2026, 10, 26), true],
    ['Tuesday', local(2026, 10, 27), true],
    ['Wednesday', local(2026, 10, 28), true],
    ['Thursday', local(2026, 10, 29), false],
    ['Friday', local(2026, 10, 30), false],
    ['Saturday', local(2026, 10, 31), false],
    ['Sunday', local(2026, 11, 1), false],
  ] as const)('separates previous-week days from Monday only when needed on %s', async (_day, now, hasBoundary) => {
    await renderToday({ now: () => now });

    const card = within(text('today-plan-recovery-card'));
    expect(card.getByText('Target')).toBeTruthy();
    expect(card.queryByText('Week')).toBeNull();
    const boundary = screen.queryByTestId('today-plan-recovery-week-boundary');
    if (hasBoundary) {
      expect(boundary).toBeTruthy();
      // The first current-week column is Monday, even when it is today.
      expect(boundary!.parent!.parent).toHaveTextContent('Mon');
      expect(boundary!.parent!.parent).toHaveStyle({ marginLeft: uiSpace.sm });
    } else {
      expect(boundary).toBeNull();
    }
    expect(text('today-plan-muscle-quads-today')).not.toHaveStyle({ borderColor: uiRoles.accent });
  });

  it.each([
    ['below', 15, uiRoles.ink],
    ['at', 16, uiRoles.gain],
    ['above', 17, uiRoles.gain],
  ])('colours the weekly total %s target while retaining fractional secondary sets', async (_state, count, color) => {
    await bootLocalApp();
    await logSession('fri', local(2026, 10, 30, 9), [{ ...BENCH, count }]);
    await renderToday();

    const week = within(text('today-plan-muscle-triceps-week'));
    expect(week.getByText(String(count / 2))).toHaveStyle({ color });
    expect(week.getByText('/8')).toHaveStyle({ color: uiRoles.inkMuted });
  });

  it("takes the target from Settings and counts secondary sets as Settings' Progress default says", async () => {
    await bootLocalApp();
    await logSession('fri', local(2026, 10, 30, 9), [{ ...BENCH, count: 2 }]);
    act(() => updatePreferences({ weeklyWorkingSetTarget: 12, progressCountSecondary: false }));
    await renderToday();

    expect(text('today-plan-muscle-chest-week')).toHaveTextContent('2/12');
    expect(text('today-plan-muscle-triceps-day-2')).toHaveTextContent('');

    fireEvent.press(text('today-plan-muscle-chest'));
    expect(mockPush).toHaveBeenCalledWith('/progress-history?muscleGroupId=chest&metric=sets&secondary=hidden');
  });

  it("lists only the muscles the user tracks ([[muscle.untracked]])", async () => {
    await bootLocalApp();
    await setMuscleTracked(['calves'], false);
    await renderToday();

    const rows = muscleRows();
    expect(rows).toContain('quads');
    expect(rows).not.toContain('calves');
  });

  it("measures each muscle against its own target in Per muscle mode ([[muscle.weekly-targets]])", async () => {
    await bootLocalApp();
    await logSession('fri', local(2026, 10, 30, 9), [{ ...BENCH, count: 2 }]);
    act(() => updatePreferences({ weeklyWorkingSetTarget: 10, muscleTargetMode: 'per-muscle', muscleTargetOverrides: { detailed: { chest: 2 } } }));
    await renderToday();

    expect(text('today-plan-muscle-chest-week')).toHaveTextContent('2/2');
    // Other muscles inherit the default.
    expect(text('today-plan-muscle-triceps-week')).toHaveTextContent('1/10');

    // A target changed while Today shows reads again.
    act(() => updatePreferences({ muscleTargetOverrides: { detailed: { chest: 4, triceps: 3 } } }));
    await waitFor(() => expect(text('today-plan-muscle-chest-week')).toHaveTextContent('2/4'));
    expect(text('today-plan-muscle-triceps-week')).toHaveTextContent('1/3');
  });

  it('reports a failed catalogue in Per muscle mode, and Retry loads it again (a failed catalogue read)', async () => {
    act(() => updatePreferences({ muscleTargetMode: 'per-muscle', muscleTargetOverrides: { detailed: { chest: 2 } } }));
    const groups = jest.spyOn(exerciseCatalogData, 'listExerciseCatalogMuscleGroups').mockRejectedValueOnce(new Error('database is locked'));
    render(<TodayScreen groupState={signedOut} now={clock} />);

    await waitFor(() => expect(text('today-plan-error')).toBeTruthy());
    fireEvent.press(text('today-plan-error-retry'));
    await waitFor(() => expect(text('today-plan-muscle-chest-week')).toHaveTextContent('0/2'));
    expect(groups.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("opens a muscle's progress history from its row, and Progress from the card", async () => {
    await renderToday();

    fireEvent.press(text('today-plan-muscle-quads'));
    fireEvent.press(text('today-plan-progress-button'));
    expect(mockPush.mock.calls).toEqual([['/progress-history?muscleGroupId=quads&metric=sets'], ['/progress']]);
  });

  it('opens Sessions, where sessions are planned, from the plan card', async () => {
    await renderToday();

    fireEvent.press(within(text('today-plan-week-card')).getByText('Sessions'));
    expect(mockPush).toHaveBeenCalledWith('/sessions');
  });

  it('marks the trained and planned days and lists the next planned sessions, each opening its plan', async () => {
    await bootLocalApp();
    await logSession('thu', local(2026, 10, 29, 9), [{ ...SQUAT, count: 3 }]);
    const today = await createPlan('Push A', local(2026, 10, 31, 18));
    const sunday = await createPlan('Legs B', local(2026, 11, 1, 10), [SQUAT, BENCH]);
    await createPlan('Missed', local(2026, 10, 28, 18));
    await createPlan('Next week', local(2026, 11, 2, 10));
    await createPlan('Someday', null);
    await renderToday();

    // getDay: Thursday 4, Saturday 6, Sunday 0, Wednesday 3.
    expect(text('today-plan-week-day-4-trained')).toBeTruthy();
    expect(text('today-plan-week-day-6-planned')).toBeTruthy();
    expect(text('today-plan-week-day-0-planned')).toBeTruthy();
    expect(text('today-plan-week-day-3-nothing')).toBeTruthy();
    expect(text('today-plan-week-day-6').props.accessibilityLabel).toBe('Saturday 31 Oct 26, today: planned');

    expect(plannedRows()).toEqual([`today-plan-next-${today}`, `today-plan-next-${sunday}`]);
    expect(text(`today-plan-next-${today}-day`)).toHaveTextContent('Today');
    expect(text(`today-plan-next-${today}-figures`)).toHaveTextContent('1 ex · 3 target sets');
    expect(text(`today-plan-next-${today}-muscles`)).toHaveTextContent('Pectoralis');
    expect(text(`today-plan-next-${sunday}-day`)).toHaveTextContent('Sun');
    expect(text(`today-plan-next-${sunday}-figures`)).toHaveTextContent('2 ex · 6 target sets');
    expect(text(`today-plan-next-${sunday}-muscles`)).toHaveTextContent('Glute Max · Quads · Pectoralis');

    fireEvent.press(text(`today-plan-next-${sunday}`));
    expect(mockPush).toHaveBeenCalledWith(`/session-plan/${sunday}`);
  });

  it('lists at most three planned sessions', async () => {
    await bootLocalApp();
    for (const hour of [16, 17, 18, 19]) await createPlan(`At ${hour}`, local(2026, 10, 31, hour));
    await renderToday();

    expect(plannedRows()).toHaveLength(3);
  });

  it('says when nothing is planned this week', async () => {
    await renderToday();
    expect(text('today-plan-next-empty')).toHaveTextContent('Nothing planned this week.');
  });

  it('shows loading while the first read is pending (a pending read)', async () => {
    await bootLocalApp();
    render(<TodayScreen groupState={signedOut} loadPlan={() => new Promise<TodayPlan>(() => {})} now={clock} />);
    expect(text('today-plan-loading')).toBeTruthy();
  });

  it('reports a failed read inline and retries it (a failed read)', async () => {
    await bootLocalApp();
    const loadPlan = jest.fn().mockRejectedValueOnce(new Error('database is locked'));
    loadPlan.mockResolvedValue({ recoveryDays: [], today: NOW, muscles: [], week: [], next: [] } satisfies TodayPlan);
    render(<TodayScreen groupState={signedOut} loadPlan={loadPlan} now={clock} />);

    await waitFor(() => expect(text('today-plan-error')).toBeTruthy());
    expect(screen.getByText("Couldn't load your plan")).toBeTruthy();
    fireEvent.press(text('today-plan-error-retry'));
    await waitFor(() => expect(text('today-plan-recovery-card')).toBeTruthy());
    expect(loadPlan).toHaveBeenCalledTimes(2);
  });
});

describe('Today: the Plan page among the cards', () => {
  const selected = (testID: string) => text(testID).props.accessibilityState?.selected;

  it('puts Plan first among the tabs and opens on You', async () => {
    await renderToday();

    expect(screen.getAllByRole('tab').map((tab) => tab.props.testID)).toEqual([
      'today-plan-section-tab',
      'today-progress-section-tab',
      'today-group-section-tab',
    ]);
    expect(selected('today-progress-section-tab')).toBe(true);
    // The pager starts one card's step on: 345 + the 8pt gap on a 393pt phone.
    fireEvent(text('today-screen'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 393, height: 760 } } });
    expect(text('today-screen-pager').props.contentOffset).toEqual({ x: 353, y: 0 });

    fireEvent.press(text('today-plan-section-tab'));
    expect(selected('today-plan-section-tab')).toBe(true);
    // The page draws its own two cards; ten recovery rows show, the rest scroll inside their card,
    // so the plan card below stays on the page.
    expect(within(text('today-plan-section')).getByTestId('today-plan-recovery-rows')).toHaveStyle({ flexShrink: 1, maxHeight: 10 * 32 });
    expect(within(text('today-plan-section')).getByTestId('today-plan-week-card')).toBeTruthy();
  });

  it("fills the Plan page's card with its panel for a failed read", async () => {
    await bootLocalApp();
    render(<TodayScreen groupState={signedOut} loadPlan={() => Promise.reject(new Error('locked'))} now={clock} />);

    await waitFor(() => expect(within(text('today-plan-section')).getByTestId('today-plan-error')).toBeTruthy());
    expect(text('today-plan-error')).toHaveStyle({ flex: 1, justifyContent: 'center' });
  });
});
