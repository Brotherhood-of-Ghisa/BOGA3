/**
 * The Progress card's words and chart geometry (pure). The figures themselves
 * are proven in `progress-summary-*.test.ts`; the screen over real data in
 * `today-screen.test.tsx`. The suite runs in Europe/London (jest.config.js).
 */

import {
  CHART_RIGHT_GUTTER,
  formatTonnes,
  periodPaceDelta,
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
import {
  TONNAGE_REFERENCES, REFERENCE_HEIGHT, REFERENCE_GAP, REFERENCE_STROKE,
  eligibleTonnageReferences, fitTonnageMaximum,
} from '@/components/today/tonnage-references';
import { uiSpace } from '@/components/ui/tokens';

const local = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute);
const counts = (workingSets: number, sessions = 0, prs = 0): ProgressCounts => ({ sessions, workingSets, prs, volumeKgReps: 0 });

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
    cumulativeVolumeKgReps: overrides.cumulative.map(() => 0),
    projectedVolumeKgReps: 0,
    toDate: overrides.toDate ?? counts(last(overrides.cumulative)),
    projectedWorkingSets: overrides.projected ?? 0,
    previous: {
      window: localPeriodWindow(now, weeks, -compareBack),
      cumulativeWorkingSets: previousCumulative,
      cumulativeVolumeKgReps: previousCumulative.map(() => 0),
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
      metric: 'workingSetCount',
      value: 102,
      previousValue: 98,
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
    expect(past).toMatchObject({ when: 'past', value: 10, previousValue: 12 });
    expect(formatPeriodDayLabel(past)).toBe('9 Oct 26');

    // 38 sets over 19 days: 2 a day, reaching the projection on the last day.
    const projected = periodDayFigures(october, 21);
    expect(projected).toMatchObject({ when: 'projected', value: 44, previousValue: 63 });
    // Shown as its date alone; spoken, it says it is projected.
    expect(formatPeriodDayLabel(projected)).toBe('26 Oct 26');
    expect(formatPeriodDayLabel(projected, { spoken: true })).toBe('26 Oct 26 (projected)');
    expect(periodDayFigures(october, 27).value).toBe(october.projectedWorkingSets);

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
    expect(geometry.projection?.to).toEqual({ x: expect.closeTo(plotWidth, 6), y: geometry.plot.top });
    expect(geometry.projection?.from).toEqual(geometry.today.current);
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

  it('fits the plot to a given height, keeping room for the week ticks under it', () => {
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
    expect(atToday.selected).toMatchObject({ current: atToday.today.current, previous: atToday.today.previous, projected: false });

    const later = periodChartGeometry(october, width, undefined, periodDayFigures(october, 27));
    expect(later.selected.projected).toBe(true);
    expect(later.selected.current).toEqual(later.projection?.to);
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
    expect(narrow.today.previous?.x).toBe(0);
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
      // The exercises are the rows' count, so the line and the table agree.
      'Session on 15 Oct 26 07:12; 2 exercises; 12 sets; 2 PRs; at Canal Street Gym; '
        + 'Bench Press, 4 sets, best 100.0 × 5, 1RM 116.6, a 1RM PR; Cable Fly, 0 sets',
    );
    expect(todaySessionAccessibilityLabel(latest({ gymName: ' ', records: [], exercises: [] }))).toBe(
      'Session on 15 Oct 26 07:12; 0 exercises; 12 sets; 0 PRs',
    );
  });
});


describe('tonnage pace', () => {
  it.each([[12450, '12.5'], [4536, '4.5'], [30782, '30.8'], [125, '0.1'], [102.5, '0.1'], [49, '0'], [50, '0.1'],
    [1000, '1'], [0, '0'], [null, '—'], [Infinity, '—'], [NaN, '—']])(
    'formats %s kg·reps as %s tonnes rounded to one decimal without trailing zeros', (value, expected) => {
      expect(formatTonnes(value as number | null)).toBe(expected);
    },
  );

  const volumePeriod = () => {
    const input = period({ now: local(2026, 10, 23), cumulative: days(19, () => 20) });
    input.toDate.volumeKgReps = 12450;
    input.cumulativeVolumeKgReps = days(19, index => index < 3 ? 125 : 12450);
    input.projectedVolumeKgReps = 12450 / 19 * 28;
    input.previous.cumulativeVolumeKgReps = days(28, () => 11100);
    input.previous.toSameDay.volumeKgReps = 11100;
    input.previous.total.volumeKgReps = 11100;
    return input;
  };

  it('selects past, today and projected volume with percentage deltas from unrounded values', () => {
    const input = volumePeriod();
    const today = periodDayFigures(input, null, 'totalVolume');
    expect(today).toMatchObject({ value: 12450, previousValue: 11100, metric: 'totalVolume' });
    expect(periodPaceDelta(today)).toEqual({ text: '+12%', tone: 'positive' });
    expect(periodDayFigures(input, 0, 'totalVolume').value).toBe(125);
    expect(periodDayFigures(input, 27, 'totalVolume').value).toBe(input.projectedVolumeKgReps);
    expect(periodChartAccessibilityLabel(input, 'totalVolume')).toContain('Cumulative tonnage: this period 12.5 tonnes');
    expect(periodChartAccessibilityValue(input, today)).toBe('Today: 12.5 tonnes, last period 11.1 tonnes');
    expect(periodFiguresAccessibilityLabel(input, today)).toContain('12.5 tonnes');
    expect(periodFiguresAccessibilityLabel(input, today)).toContain('+12%');
  });

  it('retains the kg scale for sub-tonne totals and omits unavailable cumulative segments and projection', () => {
    const input = volumePeriod();
    input.toDate.volumeKgReps = null;
    input.cumulativeVolumeKgReps = [125, ...Array(18).fill(null)];
    input.projectedVolumeKgReps = null;
    const figures = periodDayFigures(input, null, 'totalVolume');
    const geometry = periodChartGeometry(input, 326, undefined, figures);
    expect(geometry.current).toHaveLength(1);
    expect(geometry.today.current).toBeNull();
    expect(geometry.selected.current).toBeNull();
    expect(geometry.projection).toBeNull();
    expect(periodPaceDelta(figures)).toEqual({ text: '—', tone: 'neutral' });
    expect(periodChartAccessibilityValue(input, figures)).toContain('unavailable');
  });

  it.each([[0, 0, '—'], [1000, 0, 'new'], [0, 1000, '−100%'], [1000, 1000, '0%']])(
    'compares %s against %s as %s', (current, previous, expected) => {
      const input = volumePeriod();
      input.toDate.volumeKgReps = current as number;
      input.cumulativeVolumeKgReps[18] = current as number;
      input.previous.toSameDay.volumeKgReps = previous as number;
      expect(periodPaceDelta(periodDayFigures(input, null, 'totalVolume')).text).toBe(expected);
    },
  );
});

describe('tonnage weight references', () => {
  const now = local(2026, 10, 23);
  const input = (actual: number | null, projected: number | null = actual, previous = 0) => {
    const result = period({ now, cumulative: days(19, () => 20) });
    result.toDate.volumeKgReps = actual;
    result.cumulativeVolumeKgReps = [0, ...Array(18).fill(actual)];
    result.projectedVolumeKgReps = projected;
    result.previous.total.volumeKgReps = previous;
    result.previous.cumulativeVolumeKgReps = days(28, () => previous);
    return result;
  };
  const chart = (data: TodayProgressPeriod, width = 326, height = 126, day: number | null = null) =>
    periodChartGeometry(data, width, height, periodDayFigures(data, day, 'totalVolume'));
  const thresholds = (data: TodayProgressPeriod) => chart(data).references.map(reference => reference.value);

  it('starts with the elephant at 6 t and removes the car milestone', () => {
    expect(thresholds(input(2000))).toEqual([]);
    expect(thresholds(input(5999.9))).toEqual([]);
    expect(thresholds(input(6000))).toEqual([6000]);
    expect(TONNAGE_REFERENCES.map(reference => reference.id)).not.toContain('saloon');
  });

  it('adds distinct humpback, fin whale and ferry lines at 40, 60 and 80 t', () => {
    const references = chart(input(80000)).references;
    expect(references.map(({ id, value, label }) => ({ id, value, label }))).toEqual([
      { id: 'elephant', value: 6000, label: '≈6 t' },
      { id: 'wagon', value: 20000, label: '≈20 t' },
      { id: 'humpback', value: 40000, label: '≈40 t' },
      { id: 'fin-whale', value: 60000, label: '≈60 t' },
      { id: 'ferry', value: 80000, label: '≈80 t' },
    ]);
    expect(new Set(references.map(reference => reference.y)).size).toBe(5);
    expect(new Set(references.map(reference => reference.path)).size).toBe(5);
  });

  it.each(TONNAGE_REFERENCES.map(reference => [reference.value]))('compares raw values at the %s boundary', threshold => {
    const lower = TONNAGE_REFERENCES.filter(reference => reference.value < threshold).map(reference => reference.value);
    // Display rounding reaches the threshold before the actual value does.
    expect(formatTonnes(threshold - 0.1)).toBe(String(threshold / 1000));
    expect(thresholds(input(threshold - 0.1))).toEqual(lower);
    expect(thresholds(input(threshold))).toEqual([...lower, threshold]);
    expect(thresholds(input(threshold + 0.1))).toEqual([...lower, threshold]);
    expect(thresholds(input(0, threshold))).toEqual([...lower, threshold]);
  });

  it('uses every known current value, regardless of a lower/missing projection or larger comparison', () => {
    expect(thresholds(input(1200, 4200))).toEqual([]);
    expect(thresholds(input(1200, 8400))).toEqual([6000]);
    expect(thresholds(input(6000, 100))).toEqual([6000]);
    expect(thresholds(input(6000, null))).toEqual([6000]);
    expect(thresholds(input(2500, null))).toEqual([]);
    expect(thresholds(input(19999, null))).toEqual([6000]);
    expect(thresholds(input(900, 900, 30000))).toEqual([]);
    expect(thresholds(input(null, null, 30000))).toEqual([]);
    expect(thresholds(input(0))).toEqual([]);
    expect(thresholds(input(null, 6000))).toEqual([6000]);
    const incomplete = input(null, Number.POSITIVE_INFINITY, 30000);
    incomplete.cumulativeVolumeKgReps = [Number.NaN, 6000, null, Number.NEGATIVE_INFINITY];
    incomplete.previous.cumulativeVolumeKgReps[0] = Number.NaN;
    const geometry = chart(incomplete);
    expect(geometry.references.map(reference => reference.value)).toEqual([6000]);
    expect(geometry.current).toHaveLength(1);
    expect(geometry.today.current).toBeNull();
    expect(geometry.projection).toBeNull();
    expect(geometry.previous.every(point => Number.isFinite(point.y))).toBe(true);
    expect(eligibleTonnageReferences({ cumulative: [NaN, Infinity, null], toDate: null, projected: null })).toEqual([]);
  });

  it('adds exactly the missing top clearance, idempotently, without unlocking the next reference', () => {
    const plot = { top: 6, bottom: 66 };
    const references = TONNAGE_REFERENCES.slice(0, 1);
    const fitted = fitTonnageMaximum(6000, references, plot);
    const room = REFERENCE_HEIGHT + REFERENCE_GAP + REFERENCE_STROKE / 2 + uiSpace.xs;
    expect(fitted).toBeCloseTo(6000 / (1 - room / 60));
    expect(fitted).toBeGreaterThan(6000);
    expect(fitTonnageMaximum(fitted, references, plot)).toBe(fitted);
    const geometry = chart(input(6000), 326, 72);
    expect(geometry.references.map(reference => reference.value)).toEqual([6000]);
    expect(geometry.references[0].top).toBeCloseTo(plot.top + uiSpace.xs);
    expect(geometry.current[18].y).toBeCloseTo(geometry.references[0].y);
    expect(geometry.projection?.to.y).toBeCloseTo(geometry.references[0].y);
    expect(geometry.current[0].y).toBe(plot.bottom);
    // Even a shorter-than-native plot's padding past 20 t cannot unlock the wagon.
    expect(fitTonnageMaximum(6000, references, { top: 6, bottom: 34 })).toBeGreaterThan(20000);
    expect(chart(input(6000), 326, 40).references.map(reference => reference.value)).toEqual([6000]);
    const alreadyFits = chart(input(6000, 18000));
    expect(alreadyFits.projection?.to.y).toBe(alreadyFits.plot.top);
    expect(fitTonnageMaximum(18000, references, plot)).toBe(18000);
    expect(fitTonnageMaximum(18000, [], plot)).toBe(18000);
    expect(fitTonnageMaximum(6000, references, { top: 6, bottom: 6 })).toBe(6000);
  });

  it.each([72, 126, 240])('fits every annotation on short and tall charts (%spt) through 1,000 tonnes', height => {
    for (const width of [240, 287, 326, 390]) {
      for (const reach of [1000, 2000, 6000, 20000, 40000, 60000, 80000, 136000, 1000000]) {
        const geometry = chart(input(reach), width, height);
        expect(geometry.references).toHaveLength(TONNAGE_REFERENCES.filter(reference => reference.value <= reach).length);
        for (const [index, reference] of geometry.references.entries()) {
          expect(reference.x).toBeGreaterThanOrEqual(0);
          expect(reference.x + reference.width).toBeLessThanOrEqual(geometry.plot.width - uiSpace.xs);
          expect(reference.top).toBeGreaterThanOrEqual(0);
          expect(reference.top + REFERENCE_HEIGHT).toBeLessThanOrEqual(height);
          expect(Number.isFinite(reference.y)).toBe(true);
          expect(reference.y).toBeGreaterThanOrEqual(geometry.plot.top);
          expect(reference.y).toBeLessThanOrEqual(geometry.plot.bottom);
          // Every reference is on the same linear mapping as the actual value.
          const yAtReach = geometry.current[18].y;
          expect(reference.y).toBeCloseTo(geometry.plot.bottom - reference.value / reach * (geometry.plot.bottom - yAtReach));
          for (const other of geometry.references.slice(index + 1)) {
            const separate = reference.x + reference.width <= other.x || other.x + other.width <= reference.x
              || reference.top + REFERENCE_HEIGHT <= other.top || other.top + REFERENCE_HEIGHT <= reference.top;
            expect({ width, height, reach, reference, other, separate }).toMatchObject({ separate: true });
          }
        }
      }
    }
  });

  it.each([[20000, 240], [80000, 120], [136000, 126], [1000000, 120]])('keeps %s-volume annotations on the right when one column fits (%spt)', (reach, height) => {
    const geometry = chart(input(reach), 326, height);
    for (const reference of geometry.references) {
      expect(reference.x + reference.width).toBeCloseTo(geometry.plot.width - uiSpace.xs);
    }
  });

  it('keeps scale and membership through scrubbing and changes only scale when stepping comparison', () => {
    const data = input(1200, 8400);
    const today = chart(data);
    for (const day of [0, 18, 27]) {
      const selected = chart(data, 326, 126, day);
      expect(selected.references).toEqual(today.references);
      expect(selected.current).toEqual(today.current);
      expect(selected.previous).toEqual(today.previous);
      expect(selected.projection).toEqual(today.projection);
    }
    const compared = chart(input(1200, 8400, 30000));
    expect(compared.references.map(reference => reference.value)).toEqual([6000]);
    expect(compared.references[0].y).toBeGreaterThan(today.references[0].y);
    expect(periodChartGeometry(data, 326).references).toEqual([]);
    expect(periodChartGeometry(data, 326).current[18].y).toBe(6);
  });
});
