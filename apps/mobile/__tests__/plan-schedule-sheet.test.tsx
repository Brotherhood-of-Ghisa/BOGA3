import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

import { PlanScheduleSheet } from '@/components/session-planner/plan-schedule-sheet';
import { ensurePreferencesLoaded, updatePreferences } from '@/src/preferences/hooks';
import { formatClockTime, formatShortDate } from '@/src/utils/local-time';

import { renderWithTheme } from './helpers/theme';

// These tests prove JS props and app-owned labels, not the OS dialog's rendered order or language.
const dateFormats = [
  { dateFormat: 'DD-MM-YYYY', locale: 'en-GB' },
  { dateFormat: 'MM-DD-YYYY', locale: 'en-US' },
  { dateFormat: 'YYYY-MM-DD', locale: 'sv-SE' },
] as const;

describe('PlanScheduleSheet', () => {
  const originalPlatform = Platform.OS;

  beforeEach(async () => {
    await ensurePreferencesLoaded();
  });

  afterEach(() => {
    Platform.OS = originalPlatform;
    jest.clearAllMocks();
  });

  it('renders nothing when visible is false', () => {
    renderWithTheme(
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

    it('updates the native locale for every Date format while preserving the edited instant', () => {
      const onConfirm = jest.fn();
      const onDismiss = jest.fn();
      const initial = new Date(2026, 0, 5, 8, 10);
      const selected = new Date(2026, 8, 17, 18, 45);
      renderWithTheme(
        <PlanScheduleSheet currentSchedule={initial} onConfirm={onConfirm} onDismiss={onDismiss} visible />,
      );
      fireEvent(screen.getByTestId('plan-schedule-picker-native'), 'onChange', { type: 'set' }, selected);

      for (const { dateFormat, locale } of dateFormats) {
        act(() => updatePreferences({ dateFormat }));
        const picker = screen.getByTestId('plan-schedule-picker-native');
        expect(picker.props.locale).toBe(locale);
        expect(picker.props.value.getTime()).toBe(selected.getTime());
      }

      expect(onConfirm).not.toHaveBeenCalled();
      expect(onDismiss).not.toHaveBeenCalled();
      fireEvent.press(screen.getByTestId('plan-schedule-confirm-button'));
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onConfirm.mock.calls[0][0].getTime()).toBe(selected.getTime());
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('renders the native datetime picker and confirms schedule update', () => {
      const onConfirm = jest.fn();
      const onDismiss = jest.fn();
      const initial = new Date(2026, 9, 10, 10, 0, 0);

      renderWithTheme(
        <PlanScheduleSheet
          currentSchedule={initial}
          onConfirm={onConfirm}
          onDismiss={onDismiss}
          visible
        />,
      );

      const picker = screen.getByTestId('plan-schedule-picker-native');
      expect(picker).toBeTruthy();
      // This launch's mode (light in tests); `plan-schedule-sheet-dark.test.tsx` draws a dark launch.
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
      renderWithTheme(
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

      renderWithTheme(
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

    it('updates visible and spoken dates for every Date format without changing the instant or 24-hour clock', () => {
      const onConfirm = jest.fn();
      const onDismiss = jest.fn();
      const initial = new Date(2026, 0, 5, 8, 10);
      const selected = new Date(2026, 8, 17, 18, 45);
      const openPicker = jest.mocked(DateTimePickerAndroid.open);
      const event = { type: 'set', nativeEvent: { timestamp: selected.getTime(), utcOffset: 0 } } as const;
      renderWithTheme(
        <PlanScheduleSheet currentSchedule={initial} onConfirm={onConfirm} onDismiss={onDismiss} visible />,
      );
      fireEvent.press(screen.getByTestId('plan-schedule-android-date'));
      act(() => openPicker.mock.calls[0][0].onChange!(event, selected));
      fireEvent.press(screen.getByTestId('plan-schedule-android-time'));
      act(() => openPicker.mock.calls[1][0].onChange!(event, selected));

      for (const { dateFormat } of dateFormats) {
        act(() => updatePreferences({ dateFormat }));
        const dateRow = screen.getByTestId('plan-schedule-android-date');
        const timeRow = screen.getByTestId('plan-schedule-android-time');
        const dateLabel = formatShortDate(selected, dateFormat);
        const timeLabel = formatClockTime(selected.getTime());
        expect(within(dateRow).getByText(dateLabel)).toBeVisible();
        expect(dateRow.props.accessibilityLabel).toBe(`Select date, currently ${dateLabel}`);
        expect(within(timeRow).getByText(timeLabel)).toBeVisible();
        expect(timeRow.props.accessibilityLabel).toBe(`Select time, currently ${timeLabel}`);

        for (const [row, mode] of [[dateRow, 'date'], [timeRow, 'time']] as const) {
          fireEvent.press(row);
          const options = openPicker.mock.lastCall![0];
          expect(options.mode).toBe(mode);
          expect(options.is24Hour).toBe(true);
          expect(options.value.getTime()).toBe(selected.getTime());
        }
      }

      expect(onConfirm).not.toHaveBeenCalled();
      expect(onDismiss).not.toHaveBeenCalled();
      fireEvent.press(screen.getByTestId('plan-schedule-confirm-button'));
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onConfirm.mock.calls[0][0].getTime()).toBe(selected.getTime());
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('renders Date and Time rows and triggers native android pickers', () => {
      const onConfirm = jest.fn();
      const onDismiss = jest.fn();
      const initial = new Date(2026, 9, 10, 10, 0, 0);

      renderWithTheme(
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
