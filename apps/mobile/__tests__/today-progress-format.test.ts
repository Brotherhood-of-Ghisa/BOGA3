/**
 * The Progress card's words and chart geometry (pure). The figures themselves
 * are proven in `progress-summary-*.test.ts`; the screen over real data in
 * `today-screen.test.tsx`. The suite runs in Europe/London (jest.config.js).
 */

import {
  CHART_RIGHT_GUTTER,
  formatSessionSummaryFigures,
  formatPacePhrase,
  formatPersonalRecordLead,
  formatSignedCount,
  formatWeekRange,
  sessionSummaryRecordLine,
  sessionSummaryAccessibilityLabel,
  monthChartAccessibilityLabel,
  monthChartGeometry,
  paceDifference,
  toPolyline,
  weekShare,
} from '@/components/today/progress-format';
import type { LatestSessionSummary, ProgressCounts, SessionPersonalRecord, TodayProgressMonth } from '@/src/progress-summary';
import { localMonthWindow, localWeekWindow } from '@/src/utils/local-calendar';

const local = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute);
const counts = (workingSets: number, sessions = 0, prs = 0): ProgressCounts => ({ sessions, workingSets, prs });

// A month as T02's read shapes it; only the fields a test names matter.
const month = (overrides: {
  now: Date;
  cumulative: number[];
  previousCumulative: number[];
  projected?: number;
  toDate?: ProgressCounts;
  toSameDay?: ProgressCounts;
  total?: ProgressCounts;
}): TodayProgressMonth => {
  const { now } = overrides;
  const daysIn = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const previousStart = localMonthWindow(now, -1).start;
  const last = (values: number[]) => values[values.length - 1] ?? 0;
  return {
    window: localMonthWindow(now),
    dayOfMonth: now.getDate(),
    daysInMonth: daysIn(now),
    cumulativeWorkingSets: overrides.cumulative,
    toDate: overrides.toDate ?? counts(last(overrides.cumulative)),
    projectedWorkingSets: overrides.projected ?? 0,
    previous: {
      window: localMonthWindow(now, -1),
      daysInMonth: daysIn(previousStart),
      cumulativeWorkingSets: overrides.previousCumulative,
      toSameDay: overrides.toSameDay ?? counts(0),
      total: overrides.total ?? counts(last(overrides.previousCumulative)),
    },
  };
};

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
  ...overrides,
});

describe('week labels and bars', () => {
  it('names a week by its Monday and Sunday, and both months when it spans two', () => {
    expect(formatWeekRange(localWeekWindow(local(2026, 10, 16)))).toBe('Mon 12 – Sun 18');
    expect(formatWeekRange(localWeekWindow(local(2026, 10, 1)))).toBe('Mon 28 Sep – Sun 4 Oct');
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

describe('the month against the previous month', () => {
  const now = local(2026, 10, 16, 12);

  it('says the difference as a signed absolute count, never a percentage', () => {
    expect(formatSignedCount(4)).toBe('+4');
    expect(formatSignedCount(-3)).toBe('−3');
    expect(formatSignedCount(0)).toBe('±0');
  });

  it('compares to the previous month at the same day', () => {
    const ahead = month({ now, cumulative: [102], previousCumulative: [193], toSameDay: counts(98) });
    const behind = month({ now, cumulative: [90], previousCumulative: [193], toSameDay: counts(98) });
    const level = month({ now, cumulative: [98], previousCumulative: [193], toSameDay: counts(98) });

    expect(paceDifference(ahead)).toBe(4);
    expect(formatPacePhrase(ahead)).toBe("ahead of Sep's pace");
    expect(formatPacePhrase(behind)).toBe("behind Sep's pace");
    expect(formatPacePhrase(level)).toBe("level with Sep's pace");
  });

  it('speaks the chart as one sentence, its ordinals and a shorter previous month included', () => {
    const october = month({
      now,
      cumulative: [102],
      previousCumulative: [193],
      projected: 198,
      toSameDay: counts(98),
    });
    expect(monthChartAccessibilityLabel(october)).toBe(
      'Cumulative sets: October 102 by the 16th against September 98 by the 16th; September finished at 193. On course for 198.',
    );

    // 31 March against February: the comparison stops at February's last day.
    const march = month({ now: local(2026, 3, 31), cumulative: [40], previousCumulative: [30], toSameDay: counts(30) });
    expect(monthChartAccessibilityLabel(march)).toContain('March 40 by the 31st against February 30 by the 28th');

    const day = (n: number) => monthChartAccessibilityLabel(month({ now: local(2026, 10, n), cumulative: [1], previousCumulative: [] }));
    expect(day(1)).toContain('by the 1st against');
    expect(day(2)).toContain('by the 2nd against');
    expect(day(3)).toContain('by the 3rd against');
    expect(day(11)).toContain('by the 11th against');
    expect(day(12)).toContain('by the 12th against');
    expect(day(13)).toContain('by the 13th against');
    expect(day(22)).toContain('by the 22nd against');
  });
});

describe('the month chart geometry', () => {
  const width = 326;
  const plotWidth = width - CHART_RIGHT_GUTTER;

  it('spans the longer month across the plot and scales to the highest line', () => {
    // 16 Oct: October's 31 days span the plot; September's 30 stop a day short.
    const geometry = monthChartGeometry(
      month({
        now: local(2026, 10, 16),
        cumulative: Array.from({ length: 16 }, (_, index) => (index + 1) * 5),
        previousCumulative: Array.from({ length: 30 }, (_, index) => (index + 1) * 4),
        projected: 155,
        toSameDay: counts(64),
      }),
      width,
    );

    expect(geometry.plot.width).toBe(plotWidth);
    expect(geometry.current).toHaveLength(16);
    expect(geometry.current[0].x).toBe(0);
    expect(geometry.monthEndX).toBeCloseTo(plotWidth);
    expect(geometry.previous[29].x).toBeCloseTo((29 / 30) * plotWidth);
    // The projection (155) is the highest figure: it reaches the plot's top at the month's end.
    expect(geometry.projection.to).toEqual({ x: geometry.monthEndX, y: geometry.plot.top });
    expect(geometry.projection.from).toEqual(geometry.today.current);
    expect(geometry.today.current).toEqual(geometry.current[15]);
    expect(geometry.today.previous).toEqual(geometry.previous[15]);
    // Zero sits on the baseline.
    expect(monthChartGeometry(month({ now: local(2026, 10, 1), cumulative: [0], previousCumulative: [0] }), width).current[0].y).toBe(
      geometry.plot.bottom,
    );
  });

  it('lets a longer previous month set the span, and places its same-day dot at its last day', () => {
    // 30 March: February has 28 days, so the same-day dot is its 28th.
    const geometry = monthChartGeometry(
      month({
        now: local(2026, 3, 30),
        cumulative: Array.from({ length: 30 }, () => 10),
        previousCumulative: Array.from({ length: 28 }, () => 20),
        projected: 10,
        toSameDay: counts(20),
      }),
      width,
    );
    expect(geometry.monthEndX).toBeCloseTo(plotWidth);
    expect(geometry.today.previous).toEqual(geometry.previous[27]);
    // The previous month's total (20) tops the scale.
    expect(geometry.previous[0].y).toBe(geometry.plot.top);

    // February against January: January's 31 days span the plot; February ends short of it.
    const february = monthChartGeometry(
      month({ now: local(2026, 2, 10), cumulative: [1], previousCumulative: Array.from({ length: 31 }, () => 1) }),
      width,
    );
    expect(february.previous[30].x).toBeCloseTo(plotWidth);
    expect(february.monthEndX).toBeCloseTo((27 / 30) * plotWidth);
  });

  it('draws nothing wider than the space it is given, and writes points to one decimal', () => {
    const narrow = monthChartGeometry(month({ now: local(2026, 10, 2), cumulative: [1, 2], previousCumulative: [] }), 10);
    expect(narrow.plot.width).toBe(0);
    expect(narrow.today.previous.x).toBe(0);
    expect(toPolyline([{ x: 0, y: 80.25 }, { x: 9.731, y: 6 }])).toBe('0.0,80.3 9.7,6.0');
  });
});

describe('the latest session row', () => {
  it('says its figures and its whole summary', () => {
    expect(formatSessionSummaryFigures(latest())).toBe('12 sets · 4 exercises');
    expect(formatSessionSummaryFigures(latest({ exerciseCount: 1 }))).toBe('12 sets · 1 exercise');
    expect(sessionSummaryAccessibilityLabel(latest())).toBe(
      'Completed session on 10/15 07:12, 1h 5m, 12 sets, 4 exercises, at Canal Street Gym, 2 PRs',
    );
  });

  it('leaves out a missing gym and a session without PRs', () => {
    expect(sessionSummaryAccessibilityLabel(latest({ gymName: '  ', records: [], workingSets: 1, exerciseCount: 1 }))).toBe(
      'Completed session on 10/15 07:12, 1h 5m, 1 set, 1 exercise',
    );
    expect(sessionSummaryAccessibilityLabel(latest({ gymName: null, records: [BENCH_1RM] })))
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
