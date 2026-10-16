import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

import { ActionButton, Card, ListRow, Sheet, uiSpace } from '@/components/ui';
import { formatClockTime, formatShortDate } from '@/src/utils/local-time';

export type PlanScheduleSheetProps = {
  visible: boolean;
  /** Currently selected schedule date or null if unscheduled. */
  currentSchedule: Date | null;
  onDismiss: () => void;
  onConfirm: (date: Date | null) => void;
};

const defaultScheduleDate = (): Date => {
  const date = new Date();
  date.setSeconds(0, 0);
  return date;
};

function PlanScheduleSheetBody({
  currentSchedule,
  onDismiss,
  onConfirm,
}: {
  currentSchedule: Date | null;
  onDismiss: () => void;
  onConfirm: (date: Date | null) => void;
}) {
  const [selectedDate, setSelectedDate] = useState<Date>(() => currentSchedule ?? defaultScheduleDate());

  const openAndroidPicker = (mode: 'date' | 'time') => {
    DateTimePickerAndroid.open({
      mode,
      value: selectedDate,
      is24Hour: true,
      onChange: (_event, date) => {
        if (!date) return;
        setSelectedDate((prev) => {
          const next = new Date(prev);
          if (mode === 'date') {
            next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
          } else {
            next.setHours(date.getHours(), date.getMinutes(), 0, 0);
          }
          return next;
        });
      },
    });
  };

  return (
    <View style={styles.container}>
      {Platform.OS === 'ios' ? (
        <View style={styles.iosPickerContainer}>
          <DateTimePicker
            display="spinner"
            mode="datetime"
            onChange={(_event, date) => {
              if (date) setSelectedDate(date);
            }}
            testID="plan-schedule-picker-native"
            themeVariant="light"
            value={selectedDate}
          />
        </View>
      ) : (
        <Card>
          <ListRow
            accessibilityLabel={`Select date, currently ${formatShortDate(selectedDate, 'YYYY-MM-DD')}`}
            density="list"
            divider
            description={formatShortDate(selectedDate, 'YYYY-MM-DD')}
            label="Date"
            onPress={() => openAndroidPicker('date')}
            testID="plan-schedule-android-date"
          />
          <ListRow
            accessibilityLabel={`Select time, currently ${formatClockTime(selectedDate.getTime())}`}
            density="list"
            divider={false}
            description={formatClockTime(selectedDate.getTime())}
            label="Time"
            onPress={() => openAndroidPicker('time')}
            testID="plan-schedule-android-time"
          />
        </Card>
      )}

      <View style={styles.actions}>
        <ActionButton
          accessibilityLabel="Set plan schedule"
          label="Set schedule"
          onPress={() => {
            onConfirm(selectedDate);
            onDismiss();
          }}
          testID="plan-schedule-confirm-button"
          variant="primary"
        />
        <ActionButton
          accessibilityLabel="Clear plan schedule"
          label="Clear schedule"
          onPress={() => {
            onConfirm(null);
            onDismiss();
          }}
          testID="plan-schedule-clear-button"
          tone="danger"
          variant="outline"
        />
      </View>
    </View>
  );
}

/**
 * A bottom sheet for authoring or clearing a session plan's schedule.
 * On iOS, renders the native datetime spinner with light theme chrome.
 * On Android, presents Date and Time rows backed by native dialog pickers.
 * Dismissing the sheet without confirming writes nothing.
 */
export function PlanScheduleSheet({
  visible,
  currentSchedule,
  onDismiss,
  onConfirm,
}: PlanScheduleSheetProps) {
  return (
    <Sheet
      dismissLabel="Dismiss schedule picker"
      onDismiss={onDismiss}
      testID="plan-form-schedule-sheet"
      title="Plan schedule"
      visible={visible}>
      {visible ? (
        <PlanScheduleSheetBody
          currentSchedule={currentSchedule}
          onConfirm={onConfirm}
          onDismiss={onDismiss}
        />
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: uiSpace.lg,
  },
  iosPickerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  actions: {
    gap: uiSpace.sm,
  },
});
