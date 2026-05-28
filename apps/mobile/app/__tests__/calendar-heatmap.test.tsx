import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import {
  CalendarHeatmap,
  buildCalendarHeatmapWeeks,
  getCalendarHeatmapBucket,
  type CalendarHeatmapCell,
} from '@/components/muscle-analytics/calendar-heatmap';
import { uiColors } from '@/components/ui';
import type { SelectedMuscleDailyEffort } from '@/src/data';

const buildEffort = (
  dateKey: string,
  totalWeight: number
): SelectedMuscleDailyEffort => ({
  dateKey,
  muscleGroupId: 'chest_sternal',
  sessionCount: totalWeight > 0 ? 1 : 0,
  setCount: totalWeight > 0 ? 2 : 0,
  totalWeight,
  contributions: [],
});

describe('calendar heatmap layout helpers', () => {
  it('builds deterministic Monday-start weeks across year and Sunday boundaries', () => {
    const weeks = buildCalendarHeatmapWeeks([], {
      latestDateKey: '2026-01-04',
      minimumWeekCount: 2,
      selectedDateKey: null,
      todayDateKey: '2026-01-04',
    });

    expect(weeks).toHaveLength(2);
    expect(weeks[0].cells.map((cell) => cell.dateKey)).toEqual([
      '2025-12-29',
      '2025-12-30',
      '2025-12-31',
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
    ]);
    expect(weeks[1].cells.map((cell) => cell.dateKey)).toEqual([
      '2025-12-22',
      '2025-12-23',
      '2025-12-24',
      '2025-12-25',
      '2025-12-26',
      '2025-12-27',
      '2025-12-28',
    ]);
  });

  it('uses stable effort buckets across the loaded window', () => {
    expect(getCalendarHeatmapBucket(0, 100)).toBe(0);
    expect(getCalendarHeatmapBucket(10, 100)).toBe(1);
    expect(getCalendarHeatmapBucket(50, 100)).toBe(2);
    expect(getCalendarHeatmapBucket(75, 100)).toBe(3);
    expect(getCalendarHeatmapBucket(100, 100)).toBe(4);
  });
});

describe('CalendarHeatmap', () => {
  it('renders weekday labels and 8 visible Monday-start week rows', () => {
    render(<CalendarHeatmap dailyEffort={[]} todayDateKey="2026-03-30" />);

    expect(screen.getByText('Mon')).toBeTruthy();
    expect(screen.getByText('Tue')).toBeTruthy();
    expect(screen.getByText('Wed')).toBeTruthy();
    expect(screen.getByText('Thu')).toBeTruthy();
    expect(screen.getByText('Fri')).toBeTruthy();
    expect(screen.getByText('Sat')).toBeTruthy();
    expect(screen.getByText('Sun')).toBeTruthy();
    expect(screen.getAllByTestId(/^calendar-heatmap-week-row-/)).toHaveLength(8);
  });

  it('renders neutral zero cells, green effort buckets, and accessible effort labels', () => {
    render(
      <CalendarHeatmap
        dailyEffort={[
          buildEffort('2026-03-30', 10),
          buildEffort('2026-03-31', 50),
          buildEffort('2026-04-01', 100),
        ]}
        todayDateKey="2026-04-05"
      />
    );

    const zeroCell = screen.getByTestId('calendar-heatmap-cell-2026-04-02');
    const lowCell = screen.getByTestId('calendar-heatmap-cell-2026-03-30');
    const midCell = screen.getByTestId('calendar-heatmap-cell-2026-03-31');
    const highCell = screen.getByTestId('calendar-heatmap-cell-2026-04-01');

    expect(StyleSheet.flatten(zeroCell.props.style).backgroundColor).toBe(
      uiColors.heatmapNeutralBg
    );
    expect(StyleSheet.flatten(lowCell.props.style).backgroundColor).toBe(
      uiColors.heatmapBucket1
    );
    expect(StyleSheet.flatten(midCell.props.style).backgroundColor).toBe(
      uiColors.heatmapBucket2
    );
    expect(StyleSheet.flatten(highCell.props.style).backgroundColor).toBe(
      uiColors.heatmapBucket4
    );
    expect(
      screen.getByLabelText('Monday, March 30, 2026. Effort 10. Bucket 1 of 4.')
    ).toBeTruthy();
    expect(screen.getByLabelText('Thursday, April 2, 2026. No effort.')).toBeTruthy();
  });

  it('keeps today highlighted independently of effort intensity', () => {
    const { rerender } = render(
      <CalendarHeatmap
        dailyEffort={[buildEffort('2026-04-01', 100)]}
        todayDateKey="2026-04-01"
      />
    );

    const todayCell = screen.getByTestId('calendar-heatmap-cell-2026-04-01');

    expect(StyleSheet.flatten(todayCell.props.style).backgroundColor).toBe(
      uiColors.heatmapBucket4
    );
    expect(StyleSheet.flatten(todayCell.props.style).borderColor).toBe(
      uiColors.heatmapTodayBorder
    );
    expect(screen.getByTestId('calendar-heatmap-cell-2026-04-01-today-marker')).toBeTruthy();
    expect(
      screen.getByLabelText('Wednesday, April 1, 2026. Effort 100. Bucket 4 of 4. Today.')
    ).toBeTruthy();

    rerender(<CalendarHeatmap dailyEffort={[]} todayDateKey="2026-04-01" />);

    expect(
      StyleSheet.flatten(screen.getByTestId('calendar-heatmap-cell-2026-04-01').props.style)
        .backgroundColor
    ).toBe(uiColors.heatmapTodayBg);
  });

  it('marks selected cells and calls the selection handler with the selected date cell', () => {
    const onSelectDate = jest.fn<void, [CalendarHeatmapCell]>();

    render(
      <CalendarHeatmap
        dailyEffort={[buildEffort('2026-04-01', 100)]}
        onSelectDate={onSelectDate}
        selectedDateKey="2026-04-01"
        todayDateKey="2026-04-05"
      />
    );

    const selectedCell = screen.getByTestId('calendar-heatmap-cell-2026-04-01');

    expect(selectedCell.props.accessibilityState.selected).toBe(true);
    expect(StyleSheet.flatten(selectedCell.props.style).borderColor).toBe(
      uiColors.heatmapSelectedBorder
    );

    fireEvent.press(screen.getByTestId('calendar-heatmap-cell-2026-04-02'));

    expect(onSelectDate).toHaveBeenCalledWith(
      expect.objectContaining({
        dateKey: '2026-04-02',
        bucket: 0,
        totalWeight: 0,
      })
    );
  });
});
