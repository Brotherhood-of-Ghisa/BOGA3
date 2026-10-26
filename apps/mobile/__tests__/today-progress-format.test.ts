/**
 * The Progress card's words and chart geometry (pure). The figures themselves
 * are proven in `progress-summary-*.test.ts`; the screen over real data in
 * `today-screen.test.tsx`. The suite runs in Europe/London (jest.config.js).
 */

import {
  CHART_RIGHT_GUTTER,
  formatBestSet,
  formatRecordCount,
  formatSessionSummaryFigures,
  formatPeriodDayLabel,
  formatPeriodRange,
  formatPersonalRecordLead,
  formatSignedCount,
  formatWeekRange,
  sessionSummaryRecordLine,
  sessionSummaryAccessibilityLabel,
  periodChartAccessibilityLabel,
  periodChartAccessibilityValue,
  periodChartGeometry,
  periodDayAtX,
  periodDayFigures,
  periodFiguresAccessibilityLabel,
  todaySessionAccessibilityLabel,
  toPolyline,
  weekShare,
} from '@/components/today/progress-format';
import type { LatestSessionSummary, ProgressCounts, SessionPersonalRecord, TodayProgressPeriod } from '@/src/progress-summary';
import { localPeriodWindow, localWeekWindow } from '@/src/utils/local-calendar';
import { formatDayMonth } from '@/src/utils/local-time';

const local = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute);
const counts = (workingSets: number, sessions = 0, prs = 0): ProgressCounts => ({ sessions, workingSets, prs });

// A period as the read shapes it; only the fields a test names matter. Today
// is the last day of `cumulative`.
const period = (overrides: {
  now: Date;
  weeks?: number;
  compareBack?: number;
  cumulative: number[];
  previousCumulative?: number[];
  projected?: number;
  toDate?: ProgressCounts;
  toSameDay?: ProgressCounts;
  total?: ProgressCounts;
}): TodayProgressPeriod => {
  const { now, weeks = 4, compareBack = 1 } = overrides;
  const last = (values: number[]) => values[values.length - 1] ?? 0;
  const previousCumulative = overrides.previousCumulative ?? [];
  return {
    window: localPeriodWindow(now, weeks),
    weeks,
    compareBack,
    dayOfPeriod: overrides.cumulative.length,
    daysInPeriod: weeks * 7,
    cumulativeWorkingSets: overrides.cumulative,
    toDate: overrides.toDate ?? counts(last(overrides.cumulative)),
    projectedWorkingSets: overrides.projected ?? 0,
    previous: {
      window: localPeriodWindow(now, weeks, -compareBack),
      cumulativeWorkingSets: previousCumulative,
      toSameDay: overrides.toSameDay ?? counts(0),
      total: overrides.total ?? counts(last(previousCumulative)),
    },
  };
};
const days = (count: number, value: (index: number) => number) => Array.from({ length: count }, (_, index) => value(index));

const BENCH_1RM: SessionPersonalRecord = { kind: 'oneRepMax', exerciseName: 'Bench Press', value: 102.53, reps: null };
const BENCH_WEIGHT: SessionPersonalRecord = { kind: 'weight', exerciseName: 'Bench Press', value: 90, reps: 5 };

const latest = (overrides: Partial<LatestSessionSummary> = {}): LatestSessionSummary => ({
  id: 'session-1',
  startedAt: local(2026, 10, 15, 7, 12),
  completedAt: local(2026, 10, 15, 8, 17),
  durationSec: 3_900,
  gymName: 'Canal Street Gym',
  workingSets: 12,
  exerciseCount: 4,
  records: [BENCH_1RM, BENCH_WEIGHT],
  exercises: [],
  ...overrides,
});

describe('week labels and bars', () => {
  it('names a week by its Monday and Sunday, and both months when it spans two', () => {
    expect(formatWeekRange(localWeekWindow(local(2026, 10, 16)), 'DD-MM-YYYY')).toBe('12-10-2026 – 18-10-2026');
    expect(formatWeekRange(localWeekWindow(local(2026, 10, 1)), 'DD-MM-YYYY')).toBe('28-09-2026 – 04-10-2026');
  });

  it('fills a bar by this week over last week in laps of last week, empty at zero', () => {
    // Up to last week's total: the first lap.
    expect(weekShare({ current: 0, previous: 3 })).toEqual({ lap: 0, fraction: 0 });
    expect(weekShare({ current: 2, previous: 4 })).toEqual({ lap: 0, fraction: 0.5 });
    expect(weekShare({ current: 3, previous: 3 })).toEqual({ lap: 0, fraction: 1 });
    // 4 to 6 over 3: the second lap.
    expect(weekShare({ current: 4, previous: 3 }).lap).toBe(1);
    expect(weekShare({ current: 4, previous: 3 }).fraction).toBeCloseTo(1 / 3);
    expect(weekShare({ current: 6, previous: 3 })).toEqual({ lap: 1, fraction: 1 });
    // The third lap, then the bar stops full.
    expect(weekShare({ current: 15, previous: 6 })).toEqual({ lap: 2, fraction: 0.5 });
    expect(weekShare({ current: 9, previous: 3 })).toEqual({ lap: 2, fraction: 1 });
    expect(weekShare({ current: 20, previous: 3 })).toEqual({ lap: 2, fraction: 1 });
    // No last week to measure against: any figure has passed it.
    expect(weekShare({ current: 1, previous: 0 })).toEqual({ lap: 1, fraction: 1 });
    expect(weekShare({ current: 0, previous: 0 })).toEqual({ lap: 0, fraction: 0 });
  });
});

describe('the period against the previous period', () => {
  // Friday 23 October 2026: day 19 of the 4-week period 5 Oct – 1 Nov.
  const now = local(2026, 10, 23, 12);

  it('says the difference as a signed absolute count, never a percentage', () => {
    expect(formatSignedCount(4)).toBe('+4');
    expect(formatSignedCount(-3)).toBe('−3');
    expect(formatSignedCount(0)).toBe('0');
  });

  it('compares today with the previous period at the same day', () => {
    const october = period({ now, cumulative: days(19, (index) => index + 84), toSameDay: counts(98) });
    expect(periodDayFigures(october, null)).toEqual({
      dayIndex: 18,
      date: local(2026, 10, 23),
      previousDate: local(2026, 9, 25),
      when: 'today',
      workingSets: 102,
      previousWorkingSets: 98,
      difference: 4,
    });
    expect(formatPeriodDayLabel(periodDayFigures(october, null))).toBe('Today');
  });

  it('gives a selected past day its counts, and a later day the projection at the same rate', () => {
    const october = period({
      now,
      cumulative: days(19, (index) => (index + 1) * 2),
      previousCumulative: days(28, (index) => index * 3),
      projected: 56,
    });

    const past = periodDayFigures(october, 4);
    expect(past).toMatchObject({ when: 'past', workingSets: 10, previousWorkingSets: 12, difference: -2 });
    expect(formatPeriodDayLabel(past)).toBe('9 Oct 26');

    // 38 sets over 19 days: 2 a day, reaching the projection on the last day.
    const projected = periodDayFigures(october, 21);
    expect(projected).toMatchObject({ when: 'projected', workingSets: 44, previousWorkingSets: 63, difference: -19 });
    // Shown as its date alone; spoken, it says it is projected.
    expect(formatPeriodDayLabel(projected)).toBe('26 Oct 26');
    expect(formatPeriodDayLabel(projected, { spoken: true })).toBe('26 Oct 26 (projected)');
    expect(periodDayFigures(october, 27).workingSets).toBe(october.projectedWorkingSets);

    // A selection outside the period stays on its edge.
    expect(periodDayFigures(october, -3).dayIndex).toBe(0);
    expect(periodDayFigures(october, 40).dayIndex).toBe(27);
  });

  it("names both periods Monday to Sunday in Today's format, the year once at the end", () => {
    const october = period({ now, cumulative: days(19, () => 0) });
    expect(formatPeriodRange(october.window)).toBe('5 Oct – 1 Nov 26');
    expect(formatPeriodRange(october.previous.window)).toBe('7 Sep – 4 Oct 26');
    expect(formatPeriodRange(localWeekWindow(local(2026, 10, 16)))).toBe('12 – 18 Oct 26');
    expect(formatDayMonth(local(2026, 12, 28), 'MM-DD-YYYY')).toBe('Dec 28');
    expect(formatDayMonth(new Date(Number.NaN), 'DD-MM-YYYY')).toBe('—');
    expect(formatWeekRange(october.window, 'DD-MM-YYYY')).toBe('05-10-2026 – 01-11-2026');
  });

  it('speaks both periods with the selected day as one heading', () => {
    const october = period({ now, cumulative: days(19, () => 18), toSameDay: counts(6) });
    expect(periodFiguresAccessibilityLabel(october, periodDayFigures(october, null))).toBe(
      '4-week period, 5 Oct – 1 Nov 26: Today 18 sets, against the last period, 7 Sep – 4 Oct 26: 6 sets by 25 Sep 26, +12',
    );
    expect(periodChartAccessibilityValue(october, periodDayFigures(october, null))).toBe('Today: 18 sets, last period 6');
  });

  it('speaks an earlier compared period by how far back it is', () => {
    const october = period({ now, compareBack: 3, cumulative: days(19, () => 18), toSameDay: counts(6), total: counts(9) });
    expect(formatPeriodRange(october.previous.window)).toBe('13 Jul – 9 Aug 26');
    expect(periodFiguresAccessibilityLabel(october, periodDayFigures(october, null))).toBe(
      '4-week period, 5 Oct – 1 Nov 26: Today 18 sets, against the period 3 back, 13 Jul – 9 Aug 26: 6 sets by 31 Jul 26, +12',
    );
    expect(periodChartAccessibilityValue(october, periodDayFigures(october, null))).toBe('Today: 18 sets, period 3 back 6');
    expect(periodChartAccessibilityLabel(october)).toContain('against the period 3 back 6 by day 19; the period 3 back finished at 9.');
  });

  it('speaks the chart as one sentence', () => {
    const october = period({ now, cumulative: days(19, () => 102), projected: 150, toSameDay: counts(98), total: counts(193) });
    expect(periodChartAccessibilityLabel(october)).toBe(
      'Cumulative sets: this period 102 by day 19 of 28 against the last period 98 by day 19; the last period finished at 193. On course for 150.',
    );
  });
});

describe('the period chart geometry', () => {
  const width = 326;
  const plotWidth = width - CHART_RIGHT_GUTTER;
  const now = local(2026, 10, 23, 12);

  it('spans the period across the plot, scales to the highest line and marks each week after the first', () => {
    const geometry = periodChartGeometry(
      period({
        now,
        cumulative: days(19, (index) => (index + 1) * 5),
        previousCumulative: days(28, (index) => (index + 1) * 4),
        projected: 147,
        toSameDay: counts(76),
      }),
      width,
    );

    expect(geometry.plot.width).toBe(plotWidth);
    // The compared period never changes the plot's width: its line carries no label.
    expect(periodChartGeometry(period({ now, compareBack: 2, cumulative: days(19, () => 0) }), width).plot.width).toBe(plotWidth);
    expect(geometry.current).toHaveLength(19);
    expect(geometry.current[0].x).toBe(0);
    expect(geometry.previous[27].x).toBeCloseTo(plotWidth);
    expect(geometry.weekStartsX.map((x) => x / plotWidth)).toEqual([7 / 27, 14 / 27, 21 / 27].map((share) => expect.closeTo(share, 6)));
    // The projection (147) is the highest figure: it reaches the plot's top at the period's end.
    expect(geometry.projection.to).toEqual({ x: expect.closeTo(plotWidth, 6), y: geometry.plot.top });
    expect(geometry.projection.from).toEqual(geometry.today.current);
    expect(geometry.today.current).toEqual(geometry.current[18]);
    expect(geometry.today.previous).toEqual(geometry.previous[18]);
    // Zero sits on the baseline.
    expect(periodChartGeometry(period({ now, cumulative: [0], previousCumulative: [0] }), width).current[0].y).toBe(
      geometry.plot.bottom,
    );
  });

  it('lets the previous period\'s total top the scale, and draws no week marks for a one-week period', () => {
    const geometry = periodChartGeometry(
      period({ now, weeks: 1, cumulative: days(5, () => 10), previousCumulative: days(7, () => 20), projected: 14, toSameDay: counts(20) }),
      width,
    );
    expect(geometry.previous[0].y).toBe(geometry.plot.top);
    expect(geometry.weekStartsX).toEqual([]);
    expect(geometry.previous[6].x).toBeCloseTo(plotWidth);
  });

  it('fits the plot to a given height, keeping room for the week ticks under it (the cards layout)', () => {
    const input = period({ now, cumulative: [0, 10], previousCumulative: days(28, (index) => index), projected: 20 });
    expect(periodChartGeometry(input, width).plot).toEqual({ width: plotWidth, top: 6, bottom: 120 });
    const tall = periodChartGeometry(input, width, 240);
    expect(tall.plot.bottom).toBe(234);
    expect(tall.current[0].y).toBe(234);
    // Never a plot upside down, however short the space.
    expect(periodChartGeometry(input, width, 10).plot.bottom).toBe(6);
  });

  it('marks the selected day, on the projection after today', () => {
    const october = period({ now, cumulative: days(19, (index) => (index + 1) * 2), previousCumulative: days(28, () => 10), projected: 56, toSameDay: counts(10) });
    const atToday = periodChartGeometry(october, width);
    expect(atToday.selected).toEqual({ current: atToday.today.current, previous: atToday.today.previous, projected: false });

    const later = periodChartGeometry(october, width, undefined, periodDayFigures(october, 27));
    expect(later.selected.projected).toBe(true);
    expect(later.selected.current).toEqual(later.projection.to);
    expect(later.selected.previous).toEqual(later.previous[27]);
  });

  it('picks the day nearest a touch across the plot, within the period', () => {
    expect(periodDayAtX(0, plotWidth, 28)).toBe(0);
    expect(periodDayAtX(plotWidth / 2, plotWidth, 28)).toBe(14);
    expect(periodDayAtX(plotWidth, plotWidth, 28)).toBe(27);
    expect(periodDayAtX(plotWidth + 30, plotWidth, 28)).toBe(27);
    expect(periodDayAtX(-5, plotWidth, 28)).toBe(0);
    expect(periodDayAtX(10, 0, 28)).toBe(0);
    expect(periodDayAtX(10, plotWidth, 1)).toBe(0);
  });


  it('draws nothing wider than the space it is given, and writes points to one decimal', () => {
    const narrow = periodChartGeometry(period({ now, cumulative: [1, 2] }), 6);
    expect(narrow.plot.width).toBe(0);
    expect(narrow.today.previous.x).toBe(0);
    expect(toPolyline([{ x: 0, y: 80.25 }, { x: 9.731, y: 6 }])).toBe('0.0,80.3 9.7,6.0');
  });
});

describe('the latest session row', () => {
  it('says its figures and its whole summary', () => {
    expect(formatSessionSummaryFigures(latest())).toBe('12 sets · 4 exercises');
    expect(formatSessionSummaryFigures(latest({ exerciseCount: 1 }))).toBe('12 sets · 1 exercise');
    expect(sessionSummaryAccessibilityLabel(latest(), 'DD-MM-YYYY')).toBe(
      'Completed session on 15-10-2026 07:12, 1h 5m, 12 sets, 4 exercises, at Canal Street Gym, 2 PRs',
    );
    expect(sessionSummaryAccessibilityLabel(latest(), 'DD-MM-YYYY')).toBe(
      'Completed session on 15-10-2026 07:12, 1h 5m, 12 sets, 4 exercises, at Canal Street Gym, 2 PRs',
    );
    expect(sessionSummaryAccessibilityLabel(latest(), 'YYYY-MM-DD')).toBe(
      'Completed session on 2026-10-15 07:12, 1h 5m, 12 sets, 4 exercises, at Canal Street Gym, 2 PRs',
    );
  });

  it('leaves out a missing gym and a session without PRs', () => {
    expect(sessionSummaryAccessibilityLabel(latest({ gymName: '  ', records: [], workingSets: 1, exerciseCount: 1 }), 'DD-MM-YYYY')).toBe(
      'Completed session on 15-10-2026 07:12, 1h 5m, 1 set, 1 exercise',
    );
    expect(sessionSummaryAccessibilityLabel(latest({ gymName: null, records: [BENCH_1RM] }), 'DD-MM-YYYY'))
      .toContain('4 exercises, Bench Press 1RM 102.5 · PR');
  });
});

describe("the latest session's PRs", () => {
  it('names each record kind with its figure, without a unit', () => {
    expect(formatPersonalRecordLead(BENCH_1RM)).toBe('Bench Press 1RM 102.5');
    expect(formatPersonalRecordLead(BENCH_WEIGHT)).toBe('Bench Press Weight 90.0 × 5');
    expect(formatPersonalRecordLead({ ...BENCH_WEIGHT, value: 92.5, reps: null })).toBe('Bench Press Weight 92.5');
    expect(formatPersonalRecordLead({ kind: 'volume', exerciseName: ' Deadlift ', value: 4199.6, reps: null }))
      .toBe('Deadlift Volume 4200');
  });

  it('names one PR and only counts several, one per record kind', () => {
    expect(sessionSummaryRecordLine(latest({ records: [] }))).toBeNull();
    expect(sessionSummaryRecordLine(latest({ records: [BENCH_WEIGHT] })))
      .toEqual({ kind: 'one', lead: 'Bench Press Weight 90.0 × 5', note: 'PR' });
    // One exercise taking 1RM and Weight is two PRs.
    expect(sessionSummaryRecordLine(latest())).toEqual({ kind: 'many', count: '2 PRs' });
  });
});

describe('the session card', () => {
  const lines = [
    { name: 'Bench Press', workingSets: 4, bestSet: { weightKg: 100, reps: 5, oneRepMaxKg: 116.64 }, oneRepMaxRecord: true },
    { name: 'Cable Fly', workingSets: 0, bestSet: null, oneRepMaxRecord: false },
  ];

  it('writes a best set as entered Weight by reps, and counts PRs', () => {
    expect(formatBestSet({ weightKg: 100, reps: 5 })).toBe('100.0 × 5');
    expect(formatBestSet({ weightKg: 22.5, reps: 12 })).toBe('22.5 × 12');
    expect(formatRecordCount(0)).toBe('0 PRs');
    expect(formatRecordCount(1)).toBe('1 PR');
    expect(formatRecordCount(3)).toBe('3 PRs');
  });

  it('speaks when, what, where and its PRs, then each exercise', () => {
    expect(todaySessionAccessibilityLabel(latest({ exercises: lines }))).toBe(
      'Session on 15 Oct 26 07:12; 4 exercises; 12 sets; 2 PRs; at Canal Street Gym; '
        + 'Bench Press, 4 sets, best 100 by 5, 1RM 116.6, a 1RM PR; Cable Fly, 0 sets',
    );
    expect(todaySessionAccessibilityLabel(latest({ gymName: ' ', records: [], exercises: [] }))).toBe(
      'Session on 15 Oct 26 07:12; 4 exercises; 12 sets; 0 PRs',
    );
  });
});
