import { fireEvent, screen } from '@testing-library/react-native';

import { PlannerWeekStrip } from '@/components/session-planner/planner-week-strip';
import type { PlanSummaryView } from '@/src/session-planner';
import { localWeekWindow } from '@/src/utils/local-calendar';
import { localDateKey } from '@/src/utils/calendar-weeks';
import { renderWithTheme } from './helpers/theme';

describe('PlannerWeekStrip', () => {
  const dummyPlan = (scheduledFor: Date): PlanSummaryView => ({
    id: 'p1',
    title: 'Bench',
    gymId: null,
    scheduledFor,
    programmeId: null,
    programmeOrderIndex: null,
    provenance: 'human',
    progress: 'planned',
    completedAt: null,
    blockCounts: { pending: 1, attached: 0, completed: 0, skipped: 0 },
  });

  it('renders all 7 days of the current week with day initials and date numbers', () => {
    const onSelectDate = jest.fn();
    renderWithTheme(
      <PlannerWeekStrip onSelectDate={onSelectDate} plans={[]} selectedDate={null} />,
    );

    expect(screen.getByTestId('planner-week-strip')).toBeTruthy();
    const days = screen.getAllByTestId(/^planner-week-strip-day-/);
    expect(days).toHaveLength(7);
    expect(screen.queryByTestId('planner-week-strip-clear')).toBeNull();
  });

  it('displays dots for days with scheduled workouts and supports selection and reset', () => {
    const now = new Date();
    const week = localWeekWindow(now);
    const day0 = new Date(week.start.getFullYear(), week.start.getMonth(), week.start.getDate());
    const day1 = new Date(week.start.getFullYear(), week.start.getMonth(), week.start.getDate() + 1);

    const day0Key = localDateKey(day0);
    const day1Key = localDateKey(day1);

    const onSelectDate = jest.fn();
    const { rerender } = renderWithTheme(
      <PlannerWeekStrip
        onSelectDate={onSelectDate}
        plans={[dummyPlan(day0)]}
        selectedDate={day0Key}
      />,
    );

    // Selected state on day0
    const day0Tile = screen.getByTestId(`planner-week-strip-day-${day0Key}`);
    expect(day0Tile.props.accessibilityState).toEqual({ selected: true });

    // Pressing already selected day0 toggles to null
    fireEvent.press(day0Tile);
    expect(onSelectDate).toHaveBeenLastCalledWith(null);

    // Pressing unselected day1 selects day1
    const day1Tile = screen.getByTestId(`planner-week-strip-day-${day1Key}`);
    expect(day1Tile.props.accessibilityState).toEqual({ selected: false });
    fireEvent.press(day1Tile);
    expect(onSelectDate).toHaveBeenLastCalledWith(day1Key);

    // All dates button clears filter
    expect(screen.getByTestId('planner-week-strip-clear')).toBeTruthy();
    fireEvent.press(screen.getByTestId('planner-week-strip-clear'));
    expect(onSelectDate).toHaveBeenLastCalledWith(null);

    // Rerender with selectedDate null hides clear button
    rerender(
      <PlannerWeekStrip
        onSelectDate={onSelectDate}
        plans={[dummyPlan(day0)]}
        selectedDate={null}
      />,
    );
    expect(screen.queryByTestId('planner-week-strip-clear')).toBeNull();
  });
});
