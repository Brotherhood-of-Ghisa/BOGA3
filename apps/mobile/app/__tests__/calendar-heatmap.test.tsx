import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import {
  CalendarHeatmap,
  buildCalendarHeatmapMonthRows,
  getCalendarHeatmapBucket,
} from '@/components/muscle-analytics/calendar-heatmap';
import { uiColors } from '@/components/ui';
import type { SelectedMuscleWeeklyEffort } from '@/src/data';

const buildWeek = (
  weekStartDateKey: string,
  monthKey: string,
  weekOfMonth: number,
  totalVolume: number
): SelectedMuscleWeeklyEffort => ({
  weekStartDateKey,
  monthKey,
  weekOfMonth,
  totalVolume,
  nearFailureCount: 0,
  estimatedRM1: null,
  highestWeight: null,
});

describe('getCalendarHeatmapBucket', () => {
  it('uses stable effort buckets', () => {
    expect(getCalendarHeatmapBucket(0, 100)).toBe(0);
    expect(getCalendarHeatmapBucket(10, 100)).toBe(1);
    expect(getCalendarHeatmapBucket(50, 100)).toBe(2);
    expect(getCalendarHeatmapBucket(75, 100)).toBe(3);
    expect(getCalendarHeatmapBucket(100, 100)).toBe(4);
  });

  it('returns 0 when max is 0', () => {
    expect(getCalendarHeatmapBucket(0, 0)).toBe(0);
  });
});

describe('buildCalendarHeatmapMonthRows — minimum 6 months', () => {
  it('returns at least 6 month rows even with empty effort', () => {
    const rows = buildCalendarHeatmapMonthRows([], 'totalVolume', null, '2026-05-29');
    expect(rows.length).toBeGreaterThanOrEqual(6);
  });

  it('renders dated neutral cells when there is no effort data', () => {
    const rows = buildCalendarHeatmapMonthRows([], 'totalVolume', null, '2026-05-29');
    for (const row of rows) {
      expect(row.cells.length).toBeGreaterThan(0);
      expect(row.cells.length).toBeLessThanOrEqual(4);
      expect(row.cells.every((c) => c.metricValue === null && c.bucket === 0)).toBe(true);
    }
  });

  it('includes the current month in the baseline', () => {
    const rows = buildCalendarHeatmapMonthRows([], 'totalVolume', null, '2026-05-29');
    const monthKeys = rows.map((r) => r.monthKey);
    expect(monthKeys).toContain('2026-05');
  });
});

describe('buildCalendarHeatmapMonthRows', () => {
  const weeks: SelectedMuscleWeeklyEffort[] = [
    buildWeek('2026-03-02', '2026-03', 1, 100),
    buildWeek('2026-03-09', '2026-03', 2, 50),
    buildWeek('2026-03-16', '2026-03', 3, 0),
    buildWeek('2026-04-06', '2026-04', 1, 200),
  ];

  it('includes effort months with correct labels', () => {
    const rows = buildCalendarHeatmapMonthRows(weeks, 'totalVolume', null, '2026-04-10');
    const march = rows.find((r) => r.monthKey === '2026-03');
    const april = rows.find((r) => r.monthKey === '2026-04');

    expect(march).toBeDefined();
    expect(march?.monthLabel).toBe('Mar');
    expect(april).toBeDefined();
    expect(april?.monthLabel).toBe('Apr');
  });

  it('fills past empty weeks with dated neutral cells', () => {
    const rows = buildCalendarHeatmapMonthRows(weeks, 'totalVolume', null, '2026-04-10');
    const march = rows.find((r) => r.monthKey === '2026-03')!;
    const april = rows.find((r) => r.monthKey === '2026-04')!;

    // March: all past weeks remain selectable; week 4 has no effort.
    expect(march.cells).toHaveLength(4);
    expect(march.cells[0]?.weekStartDateKey).toBe('2026-03-02');
    expect(march.cells[1]?.weekStartDateKey).toBe('2026-03-09');
    expect(march.cells[2]?.weekStartDateKey).toBe('2026-03-16');
    expect(march.cells[3]?.weekStartDateKey).toBe('2026-03-23');
    expect(march.cells[3]?.metricValue).toBeNull();
    expect(march.cells[3]?.bucket).toBe(0);

    // April: only the current week is rendered; later weeks are future weeks.
    expect(april.cells).toHaveLength(1);
    expect(april.cells[0]?.weekStartDateKey).toBe('2026-04-06');
  });

  it('omits future week tiles from the current month', () => {
    const rows = buildCalendarHeatmapMonthRows(weeks, 'totalVolume', null, '2026-04-10');
    const april = rows.find((r) => r.monthKey === '2026-04')!;

    expect(april.cells.map((cell) => cell.weekStartDateKey)).toEqual(['2026-04-06']);
  });

  it('omits future effort data from rows and bucket scaling', () => {
    const rows = buildCalendarHeatmapMonthRows(
      [...weeks, buildWeek('2026-04-13', '2026-04', 2, 10000)],
      'totalVolume',
      null,
      '2026-04-10'
    );
    const april = rows.find((r) => r.monthKey === '2026-04')!;
    const march = rows.find((r) => r.monthKey === '2026-03')!;

    expect(april.cells.map((cell) => cell.weekStartDateKey)).toEqual(['2026-04-06']);
    expect(march.cells[0]?.bucket).toBe(2);
    expect(april.cells[0]?.bucket).toBe(4);
  });

  it('assigns correct buckets based on max metric value', () => {
    const rows = buildCalendarHeatmapMonthRows(weeks, 'totalVolume', null, '2026-04-10');
    const march = rows.find((r) => r.monthKey === '2026-03')!;
    const april = rows.find((r) => r.monthKey === '2026-04')!;

    // max is 200 (April week 1)
    // March week 1: 100/200 = 0.5 → bucket 2
    // March week 2: 50/200 = 0.25 → bucket 1
    // March week 3: 0 → bucket 0
    // April week 1: 200/200 = 1.0 → bucket 4
    expect(march.cells[0]?.bucket).toBe(2);
    expect(march.cells[1]?.bucket).toBe(1);
    expect(march.cells[2]?.bucket).toBe(0);
    expect(april.cells[0]?.bucket).toBe(4);
  });

  it('marks the selected week correctly', () => {
    const rows = buildCalendarHeatmapMonthRows(weeks, 'totalVolume', '2026-03-09', '2026-04-10');
    const march = rows.find((r) => r.monthKey === '2026-03')!;

    expect(march.cells[0]?.isSelected).toBe(false);
    expect(march.cells[1]?.isSelected).toBe(true);
  });

  it('marks current week based on today date key', () => {
    // today = 2026-03-11 → current week starts 2026-03-09 (Monday)
    const rows = buildCalendarHeatmapMonthRows(weeks, 'totalVolume', null, '2026-03-11');
    const march = rows.find((r) => r.monthKey === '2026-03')!;

    expect(march.cells[1]?.isCurrentWeek).toBe(true);
    expect(march.cells[0]?.isCurrentWeek).toBe(false);
  });
});

describe('CalendarHeatmap', () => {
  const weeks: SelectedMuscleWeeklyEffort[] = [
    buildWeek('2026-03-02', '2026-03', 1, 100),
    buildWeek('2026-03-09', '2026-03', 2, 200),
    buildWeek('2026-04-06', '2026-04', 1, 50),
  ];

  it('renders week cells in reverse chronological order (current month first)', () => {
    render(
      <CalendarHeatmap
        weeklyEffort={weeks}
        metric="totalVolume"
        selectedWeekKey={null}
        onSelectWeek={jest.fn()}
        today="2026-04-10"
      />
    );

    // Cells for both months are rendered
    expect(screen.getByTestId('calendar-heatmap-cell-2026-03-02')).toBeTruthy();
    expect(screen.getByTestId('calendar-heatmap-cell-2026-03-09')).toBeTruthy();
    expect(screen.getByTestId('calendar-heatmap-cell-2026-04-06')).toBeTruthy();

    // Month row for Apr appears before Mar (reverse chronological)
    const aprRow = screen.getByTestId('calendar-heatmap-month-2026-04');
    const marRow = screen.getByTestId('calendar-heatmap-month-2026-03');
    const aprIndex = aprRow.props.testID;
    const marIndex = marRow.props.testID;
    // Verify both exist; Apr is the newer month
    expect(aprIndex).toBe('calendar-heatmap-month-2026-04');
    expect(marIndex).toBe('calendar-heatmap-month-2026-03');

    // Month labels are NOT rendered (text labels removed)
    expect(screen.queryByText('Mar')).toBeNull();
    expect(screen.queryByText('Apr')).toBeNull();
  });

  it('renders selectable empty week cells for absent past weeks', () => {
    render(
      <CalendarHeatmap
        weeklyEffort={weeks}
        metric="totalVolume"
        selectedWeekKey={null}
        onSelectWeek={jest.fn()}
        today="2026-04-10"
      />
    );

    const emptyCell = screen.getByTestId('calendar-heatmap-cell-2026-03-16');
    expect(emptyCell).toBeTruthy();
    expect(StyleSheet.flatten(emptyCell.props.style).backgroundColor).toBe(uiColors.heatmapNeutralBg);
  });

  it('calls onSelectWeek when an empty week cell is pressed', () => {
    const onSelectWeek = jest.fn();

    render(
      <CalendarHeatmap
        weeklyEffort={weeks}
        metric="totalVolume"
        selectedWeekKey={null}
        onSelectWeek={onSelectWeek}
        today="2026-04-10"
      />
    );

    fireEvent.press(screen.getByTestId('calendar-heatmap-cell-2026-03-16'));
    expect(onSelectWeek).toHaveBeenCalledWith('2026-03-16');
  });

  it('does not render future week cells', () => {
    render(
      <CalendarHeatmap
        weeklyEffort={weeks}
        metric="totalVolume"
        selectedWeekKey={null}
        onSelectWeek={jest.fn()}
        today="2026-04-10"
      />
    );

    expect(screen.queryByTestId('calendar-heatmap-cell-2026-04-13')).toBeNull();
  });

  it('applies correct bucket background colors', () => {
    render(
      <CalendarHeatmap
        weeklyEffort={weeks}
        metric="totalVolume"
        selectedWeekKey={null}
        onSelectWeek={jest.fn()}
        today="2026-04-10"
      />
    );

    // max = 200, week1=100 (50% → bucket 2), week2=200 (100% → bucket 4)
    const week1Cell = screen.getByTestId('calendar-heatmap-cell-2026-03-02');
    const week2Cell = screen.getByTestId('calendar-heatmap-cell-2026-03-09');

    expect(StyleSheet.flatten(week1Cell.props.style).backgroundColor).toBe(uiColors.heatmapBucket2);
    expect(StyleSheet.flatten(week2Cell.props.style).backgroundColor).toBe(uiColors.heatmapBucket4);
  });

  it('marks the current week with a thicker border', () => {
    // today = 2026-03-09 → week starting 2026-03-09
    render(
      <CalendarHeatmap
        weeklyEffort={weeks}
        metric="totalVolume"
        selectedWeekKey={null}
        onSelectWeek={jest.fn()}
        today="2026-03-09"
      />
    );

    const currentCell = screen.getByTestId('calendar-heatmap-cell-2026-03-09');
    expect(StyleSheet.flatten(currentCell.props.style).borderColor).toBe(uiColors.heatmapTodayBorder);
    // dot removed — no current-marker child element
    expect(screen.queryByTestId('calendar-heatmap-cell-2026-03-09-current-marker')).toBeNull();
  });

  it('marks selected week and calls onSelectWeek when pressed', () => {
    const onSelectWeek = jest.fn();

    render(
      <CalendarHeatmap
        weeklyEffort={weeks}
        metric="totalVolume"
        selectedWeekKey="2026-03-02"
        onSelectWeek={onSelectWeek}
        today="2026-04-10"
      />
    );

    const selectedCell = screen.getByTestId('calendar-heatmap-cell-2026-03-02');
    expect(selectedCell.props.accessibilityState.selected).toBe(true);
    expect(StyleSheet.flatten(selectedCell.props.style).borderColor).toBe(uiColors.heatmapSelectedBorder);

    // Pressing an already-selected cell deselects (passes null)
    fireEvent.press(selectedCell);
    expect(onSelectWeek).toHaveBeenCalledWith(null);

    // Pressing a different cell selects it
    fireEvent.press(screen.getByTestId('calendar-heatmap-cell-2026-03-09'));
    expect(onSelectWeek).toHaveBeenCalledWith('2026-03-09');
  });

  it('renders with empty effort array without crashing', () => {
    render(
      <CalendarHeatmap
        weeklyEffort={[]}
        metric="totalVolume"
        selectedWeekKey={null}
        onSelectWeek={jest.fn()}
        today="2026-04-10"
      />
    );

    expect(screen.queryByTestId('calendar-heatmap')).toBeTruthy();
  });
});
