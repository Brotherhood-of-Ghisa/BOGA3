import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

import { PlanScheduleSheet } from '@/components/session-planner/plan-schedule-sheet';

describe('PlanScheduleSheet', () => {
  const originalPlatform = Platform.OS;

  afterEach(() => {
    Platform.OS = originalPlatform;
    jest.clearAllMocks();
  });

  it('renders nothing when visible is false', () => {
    render(
      <PlanScheduleSheet
        currentSchedule={null}
        onConfirm={jest.fn()}
        onDismiss={jest.fn()}
        visible={false}
      />,
    );
    expect(screen.queryByTestId('plan-form-schedule-sheet')).toBeNull();
  });

  describe('iOS platform', () => {
    beforeEach(() => {
      Platform.OS = 'ios';
    });

    it('renders the native datetime picker and confirms schedule update', () => {
      const onConfirm = jest.fn();
      const onDismiss = jest.fn();
      const initial = new Date(2026, 9, 10, 10, 0, 0);

      render(
        <PlanScheduleSheet
          currentSchedule={initial}
          onConfirm={onConfirm}
          onDismiss={onDismiss}
          visible
        />,
      );

      const picker = screen.getByTestId('plan-schedule-picker-native');
      expect(picker).toBeTruthy();
      expect(picker.props.themeVariant).toBe('light');
      expect(picker.props.mode).toBe('datetime');

      const nextDate = new Date(2026, 9, 11, 14, 30, 0);
      fireEvent(picker, 'onChange', { type: 'set' }, nextDate);

      fireEvent.press(screen.getByTestId('plan-schedule-confirm-button'));
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onConfirm).toHaveBeenCalledWith(nextDate);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('handles undefined date change event without throwing', () => {
      render(
        <PlanScheduleSheet
          currentSchedule={null}
          onConfirm={jest.fn()}
          onDismiss={jest.fn()}
          visible
        />,
      );

      const picker = screen.getByTestId('plan-schedule-picker-native');
      fireEvent(picker, 'onChange', { type: 'dismissed' }, undefined);
      expect(picker).toBeTruthy();
    });

    it('clears schedule when Clear schedule is pressed', () => {
      const onConfirm = jest.fn();
      const onDismiss = jest.fn();

      render(
        <PlanScheduleSheet
          currentSchedule={new Date(2026, 9, 10, 10, 0, 0)}
          onConfirm={onConfirm}
          onDismiss={onDismiss}
          visible
        />,
      );

      fireEvent.press(screen.getByTestId('plan-schedule-clear-button'));
      expect(onConfirm).toHaveBeenCalledWith(null);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe('Android platform', () => {
    beforeEach(() => {
      Platform.OS = 'android';
    });

    it('renders Date and Time rows and triggers native android pickers', () => {
      const onConfirm = jest.fn();
      const onDismiss = jest.fn();
      const initial = new Date(2026, 9, 10, 10, 0, 0);

      render(
        <PlanScheduleSheet
          currentSchedule={initial}
          onConfirm={onConfirm}
          onDismiss={onDismiss}
          visible
        />,
      );

      expect(screen.getByTestId('plan-schedule-android-date')).toBeTruthy();
      expect(screen.getByTestId('plan-schedule-android-time')).toBeTruthy();

      // Open and update date
      fireEvent.press(screen.getByTestId('plan-schedule-android-date'));
      const dateOptions = (DateTimePickerAndroid.open as jest.Mock).mock.calls[0][0];
      expect(dateOptions.mode).toBe('date');
      // Simulate selecting a new date
      act(() => {
        dateOptions.onChange({ type: 'set' }, new Date(2026, 9, 15, 0, 0, 0));
        // Simulate dismissing without selecting
        dateOptions.onChange({ type: 'dismissed' }, undefined);
      });

      // Open and update time
      fireEvent.press(screen.getByTestId('plan-schedule-android-time'));
      const timeOptions = (DateTimePickerAndroid.open as jest.Mock).mock.calls[1][0];
      expect(timeOptions.mode).toBe('time');
      const timeTarget = new Date(2026, 9, 15, 18, 45, 0);
      act(() => {
        timeOptions.onChange({ type: 'set' }, timeTarget);
      });

      fireEvent.press(screen.getByTestId('plan-schedule-confirm-button'));
      expect(onConfirm).toHaveBeenCalledWith(expect.any(Date));
      const confirmedDate = onConfirm.mock.calls[0][0] as Date;
      expect(confirmedDate.getDate()).toBe(15);
      expect(confirmedDate.getHours()).toBe(18);
      expect(confirmedDate.getMinutes()).toBe(45);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });
});
