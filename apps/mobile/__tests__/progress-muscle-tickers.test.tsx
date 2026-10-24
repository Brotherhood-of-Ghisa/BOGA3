import { render, screen, within } from '@testing-library/react-native';
import { aggregateProgressMuscleTickers, muscleTickerBounds, type MuscleTickerSeries } from '@/src/data/progress-muscle-tickers';
import { aggregateStats } from '@/src/data/stats';
import { shiftCalendarWeeks } from '@/src/utils/calendar-weeks';
import { ProgressTables } from '@/components/stats/progress-tables';
import { ProgressMuscleView } from '@/components/stats/progress-muscle-view';
import { act, fireEvent } from '@testing-library/react-native';
import type { MuscleAnalyticsInput } from '@/src/data/muscle-analytics';
import { muscleTickerGeometry } from '@/components/stats/muscle-ticker-geometry';
import { MuscleTicker, muscleTickerDescription } from '@/components/stats/muscle-ticker';

const date = (day: number, hour = 12) => new Date(2026, 2, day, hour);
const source = (dates: Date[], weights = dates.map(() => '40')): MuscleAnalyticsInput => ({
  sessions: dates.map((completedAt, i) => ({ id: `s${i}`, completedAt })),
  sessionExercises: dates.map((_, i) => ({ id: `b${i}`, sessionId: `s${i}`, exerciseDefinitionId: 'lift' })),
  exerciseSets: dates.map((_, i) => ({ id: `set${i}`, sessionExerciseId: `b${i}`, setType: null, weightValue: weights[i], repsValue: '5' })),
  exerciseDefinitions: [{ id: 'lift', loadInputMode: 'total_load', bodyweightContribution: 0 }],
  muscleMappings: [{ exerciseDefinitionId: 'lift', muscleGroupId: 'back', role: 'secondary' },
    { exerciseDefinitionId: 'lift', muscleGroupId: 'back', role: 'secondary' }],
  muscleGroups: [{ id: 'back', displayName: 'Back', familyName: 'Back', sortOrder: 0 }],
});
const options = { historyWeeks: 5, rollingWeeks: 1, weeklyTarget: 8, now: date(31) };

it('rolls N local weeks to each final training instant, includes the exact lower boundary, and keeps the configured full target', () => {
  const input = source([date(1), date(8, 11), date(8, 13), date(15, 13)]);
  const result = aggregateProgressMuscleTickers(input, options, { back: { workingSetCount: date(1), totalVolume: date(1) } });
  expect(result.rollingWeeks).toBe(1);
  expect(result.muscles.back.workingSetCount).toEqual({ reference: 8, observations: [
    { at: date(1), value: null }, { at: date(8, 13), value: 1 }, { at: date(15, 13), value: 1 },
  ] });
  expect(result.muscles.back.totalVolume.observations.map(row => row.value)).toEqual([null, 100, 100]);
  expect(result.muscles.back.totalVolume.reference).toBeNull();
});

it('keeps DST wall time, reads warm-up history and does not invent a today or rest-day sample', () => {
  const at = date(30);
  const input = source([date(23, 11), date(23), at]);
  const result = aggregateProgressMuscleTickers(input, options, { back: { workingSetCount: date(1), totalVolume: date(1) } });
  expect(at.getTime() - date(23).getTime()).toBe(7 * 86400000 - 3600000);
  expect(result.muscles.back.workingSetCount.observations.at(-1)).toEqual({ at, value: 1 });
  expect(result.muscles.back.workingSetCount.observations).toHaveLength(2);
  expect(muscleTickerBounds(options).readStart.getDay()).toBe(1);
  expect(muscleTickerBounds(options).readStart.getHours()).toBe(0);
});

it('uses six overlapping complete N-week values for Volume median, retaining genuine zero', () => {
  const input = source([8, 9, 10, 11, 12, 13].map(day => date(day)), ['0', '0', '40', '40', '40', '40']);
  const result = aggregateProgressMuscleTickers(input, options, { back: { workingSetCount: date(1), totalVolume: date(1) } });
  expect(result.muscles.back.totalVolume.observations.map(row => row.value)).toEqual([0, 0, 50, 100, 150, 200]);
  expect(result.muscles.back.totalVolume.reference).toBe(75);
  input.exerciseSets.forEach(set => { set.weightValue = '0'; });
  expect(aggregateProgressMuscleTickers(input, options, { back: { workingSetCount: date(1), totalVolume: date(1) } }).muscles.back.totalVolume.reference).toBe(0);
});

it('preserves independent effort eligibility, fractional mappings and unavailable overflow', () => {
  const input = source([date(8), date(9)], ['1' + '0'.repeat(305), '1' + '0'.repeat(305)]);
  input.effortPolicy = { workingSetEfforts: [], volumeEfforts: ['unspecified'] };
  const result = aggregateProgressMuscleTickers(input, options, { back: { workingSetCount: date(1), totalVolume: date(1) } });
  expect(result.muscles.back.workingSetCount.observations).toEqual([]);
  // Each per-side weighted value is finite; the rolling sum remains finite here.
  expect(result.muscles.back.totalVolume.observations[1].value! / 2.5e305).toBeCloseTo(1);
  input.exerciseSets.forEach(set => { set.weightValue = '1' + '0'.repeat(308); });
  expect(aggregateProgressMuscleTickers(input, options, { back: { workingSetCount: date(1), totalVolume: date(1) } }).muscles.back.totalVolume.observations[0].value).toBe(0);
});

const series = (values: (number | null)[], reference: number | null = 10): MuscleTickerSeries => ({
  reference, observations: values.map((value, i) => ({ at: date(9 + i * 3), value })),
});

it('connects Monday and Thursday real observations, splits exactly at the reference and breaks unavailable training', () => {
  const result = muscleTickerGeometry(series([0, 20, null, 5]), date(1), date(31), 100)!;
  expect(result.segments).toHaveLength(2);
  expect(result.segments.map(segment => segment.tone)).toEqual(['negative', 'positive']);
  expect(result.segments[0].to).toEqual(result.segments[1].from);
  expect(result.segments[0].to.y).toBe(result.referenceY);
  expect(result.endpoint.tone).toBe('negative');
  expect(result.lastX).toBeLessThan(97);
});

it('keeps the full time scale, one latest dot, neutral below the sample minimum, and no empty plot', () => {
  const single = muscleTickerGeometry(series([5], null), date(1), date(31), 100)!;
  expect(single.segments).toEqual([]);
  expect(single.endpoint.tone).toBe('neutral');
  expect(single.firstX).toBe(single.lastX);
  expect(single.lastX).toBeGreaterThan(3);
  expect(muscleTickerGeometry(series([null]), date(1), date(31), 100)).toBeNull();
  render(<MuscleTicker series={series([0, 20, 5])} start={date(1)} end={date(31)} width={100} testID="ticker" />);
  expect(screen.getAllByTestId('ticker-endpoint')).toHaveLength(1);
  expect(screen.getByTestId('ticker').props.width).toBe(100);
});

it('describes metric, rolling period, latest date/value and reference with the selected date format', () => {
  expect(muscleTickerDescription(series([0]), 4, 'totalVolume', 'DD-MM-YYYY')).toBe(
    'Volume, rolling 4 weeks. Latest 0 on 09-03-2026. Historical median 10.');
  expect(muscleTickerDescription(undefined, 4, 'workingSetCount', 'YYYY-MM-DD')).toContain('No training observations. Reference unavailable.');
});


it('recovers a finite range after overflowing history and retains tiny values when a huge old value leaves', () => {
  const dates = Array.from({ length: 19 }, (_, index) => date(8 + index));
  const input = source(dates, dates.map((_, index) => index < 10 ? '1' + '0'.repeat(305) : '4'));
  input.exerciseSets.forEach(set => { set.repsValue = '999'; });
  input.muscleMappings.forEach(mapping => { mapping.role = 'primary'; });
  const result = aggregateProgressMuscleTickers(input, options, { back: { workingSetCount: date(1), totalVolume: date(1) } });
  expect(result.muscles.back.totalVolume.observations.some(row => row.value === null)).toBe(true);
  expect(Number.isFinite(result.muscles.back.totalVolume.observations.at(-1)?.value)).toBe(true);
  // An older huge term must not swallow a later small range through prefix subtraction.
  const small = source([date(8), date(9), date(16)], ['1' + '0'.repeat(305), '4', '4']);
  small.exerciseSets.forEach(set => { set.repsValue = '999'; });
  small.muscleMappings.forEach(mapping => { mapping.role = 'primary'; });
  expect(aggregateProgressMuscleTickers(small, options, { back: { workingSetCount: date(1), totalVolume: date(1) } }).muscles.back.totalVolume.observations.at(-1)?.value).toBe(3996);
});

it('distinguishes successful empty, incomplete, pending and failed history in accessibility', () => {
  const description = (value: MuscleTickerSeries | undefined, status: 'loaded' | 'error' | 'pending') =>
    muscleTickerDescription(value, 4, 'workingSetCount', 'YYYY-MM-DD', status);
  expect(description(undefined, 'loaded')).toContain('No training observations.');
  expect(description(series([null]), 'loaded')).toContain('No complete 4-week observations.');
  expect(description(undefined, 'pending')).toContain('History loading.');
  expect(description(undefined, 'error')).toContain('History unavailable.');
  expect(description(series([0]), 'loaded')).toContain('Latest 0');
});


it('matches the shared stats aggregation oracle over exact rolling windows', () => {
  const input = source([1, 7, 8, 9, 13, 18, 24, 29].map(day => date(day)), ['0', '12', '40', '0', '60', '100', '5', '30']);
  const result = aggregateProgressMuscleTickers(input, options, { back: { workingSetCount: date(1), totalVolume: date(1) } });
  for (const metric of ['workingSetCount', 'totalVolume'] as const) {
    for (const observation of result.muscles.back[metric].observations) {
      if (observation.value === null) continue;
      const start = shiftCalendarWeeks(observation.at, -options.rollingWeeks);
      const scoped = { ...input, sessions: input.sessions.filter(row => row.completedAt >= start && row.completedAt <= observation.at) };
      expect(observation.value).toBe(aggregateStats(scoped).muscleFamilies[0].muscles[0][metric]);
    }
  }
});

const muscleRow = {
  muscleGroupId: 'back', displayName: 'Back', familyName: 'Back', sortOrder: 0,
  current: { workingSetCount: 1, totalVolume: 50, volumeSetCount: 1 },
  previous: { workingSetCount: 1, totalVolume: 50, volumeSetCount: 1 }, workingSetChange: 0,
  volumeChange: { kind: 'percent' as const, percent: 0 },
  exercises: [{ exerciseDefinitionId: 'lift', displayName: 'Lift', role: 'primary' as const,
    current: { workingSetCount: 1, totalVolume: 50, volumeSetCount: 1 },
    previous: { workingSetCount: 1, totalVolume: 50, volumeSetCount: 1 }, workingSetChange: 0,
    volumeChange: { kind: 'percent' as const, percent: 0 } }],
};
const tickerData = { start: date(1), end: date(31), rollingWeeks: 4,
  muscles: { back: { workingSetCount: series([0, 20, 5]), totalVolume: series([0, 40, 20], null) } } };
const rowProps = { muscles: [muscleRow], metric: 'workingSetCount' as const, selectedId: 'back',
  onSelect: jest.fn(), onMuscleHistory: jest.fn(), onExerciseHistory: jest.fn(), tickers: tickerData, tickerWeeks: 4 };
const layout = (id: string, width: number) => act(() => { fireEvent(screen.getByTestId(id), 'layout', { nativeEvent: { layout: { width, height: 100, x: 0, y: 0 } } }); });

it('keeps history beside two-line names, caps the plot and preserves independent controls and paired contributions', () => {
  render(<ProgressTables {...rowProps} />);
  layout('stats-muscle-table-container', 300);
  layout('stats-muscle-history-back', 400);
  expect(screen.getByTestId('stats-muscle-ticker-back').props.width).toBe(100);
  layout('stats-muscle-history-back', 72);
  expect(screen.getByTestId('stats-muscle-ticker-back').props.width).toBe(10);
  expect(screen.getByTestId('stats-muscle-history-back')).toHaveStyle({ flexDirection: 'row', minHeight: 44 });
  expect(within(screen.getByTestId('stats-muscle-history-back')).getByText('Back')).toHaveProp('numberOfLines', 2);
  expect(within(screen.getByTestId('stats-muscle-row-back-periods')).getByTestId('stats-muscle-row-back-previous')).toHaveTextContent('1');
  expect(screen.getByTestId('stats-contribution-lift-periods')).toBeTruthy();
  expect(screen.queryByTestId('stats-muscle-sort-previous')).toBeNull();
  expect(screen.getAllByRole('header', { name: 'Previous, working sets' })).toHaveLength(2);
  expect(screen.queryByTestId('stats-muscle-ticker-lift')).toBeNull();
  fireEvent.press(screen.getByTestId('stats-muscle-select-back'));
  expect(rowProps.onSelect).toHaveBeenCalledWith('back');
  fireEvent.press(screen.getByTestId('stats-muscle-history-back'));
  expect(rowProps.onMuscleHistory).toHaveBeenCalled();
});

it.each(['pending', 'error', 'loaded'] as const)('keeps comparisons and both actions reachable when ticker data is %s', tickerStatus => {
  render(<ProgressTables {...rowProps} tickers={null} tickerStatus={tickerStatus} />);
  expect(screen.queryByTestId('stats-muscle-ticker-back')).toBeNull();
  expect(screen.getByTestId('stats-muscle-row-back-now')).toHaveTextContent('1');
  expect(screen.getByTestId('stats-muscle-row-back-previous')).toHaveTextContent('1');
  fireEvent.press(screen.getByRole('link', { name: 'Open Back history' }));
  expect(rowProps.onMuscleHistory).toHaveBeenLastCalledWith(muscleRow, expect.anything());
  fireEvent.press(screen.getByRole('button', { name: 'Hide Back contributions' }));
  expect(rowProps.onSelect).toHaveBeenLastCalledWith('back');
});

it('draws no chart for incomplete observations and keeps full accessible names', () => {
  const displayName = 'An exceptionally long muscle name';
  render(<ProgressTables {...rowProps} muscles={[{ ...muscleRow, displayName }]}
    tickers={{ ...tickerData, muscles: { back: { workingSetCount: series([null]), totalVolume: series([null]) } } }} />);
  layout('stats-muscle-table-container', 300);
  layout('stats-muscle-history-back', 160);
  expect(screen.queryByTestId('stats-muscle-ticker-back')).toBeNull();
  expect(screen.getByRole('link', { name: `Open ${displayName} history` })).toBeTruthy();
  expect(screen.getByRole('button', { name: `Hide ${displayName} contributions` })).toHaveStyle({ minHeight: 44, width: 44 });
});

it('keeps 3D contributors free of tickers even when ticker data is supplied', () => {
  render(<ProgressMuscleView {...rowProps} muscleLayout="3d" />);
  expect(screen.queryByTestId('stats-muscle-table-container')).toBeNull();
  expect(screen.queryByTestId('stats-muscle-ticker-back')).toBeNull();
  expect(screen.queryByTestId('stats-contribution-lift-periods')).toBeNull();
});



it('uses metric-specific training days and first eligible dates, retaining Volume zero without fabricating a Sets point', () => {
  const input = source([date(8), date(9), date(10)], ['40', '40', '0']);
  input.exerciseSets[0].setType = 'rir_2';
  input.exerciseSets[1].setType = 'technique';
  input.exerciseSets[2].setType = 'technique';
  input.effortPolicy = { workingSetEfforts: ['rir_2'], volumeEfforts: ['technique'] };
  const result = aggregateProgressMuscleTickers(input, options,
    { back: { workingSetCount: date(1), totalVolume: date(2) } });
  expect(result.muscles.back.workingSetCount.observations).toEqual([{ at: date(8), value: 0.5 }]);
  expect(result.muscles.back.totalVolume.observations).toEqual([{ at: date(9), value: 50 }, { at: date(10), value: 50 }]);
  input.exerciseSets[1].weightValue = '0';
  expect(aggregateProgressMuscleTickers(input, options, { back: { totalVolume: date(2) } })
    .muscles.back.totalVolume.observations[0].value).toBe(0);
});
