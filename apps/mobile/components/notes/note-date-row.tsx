import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { ChoiceRow } from '@/components/ui/form-section';
import { useUiMode } from '@/components/ui/theme-context';
import { parseLocalDateKey, toLocalDateKey } from '@/src/data/training-notes';
import { useDateFormat } from '@/src/preferences/hooks';
import { noteDateLabels } from './note-row';

type NoteDateRowProps = {
  // `YYYY-MM-DD`, the day the note applies from.
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

// Never later than today, whatever the picker reports.
const pickedKey = (picked: Date): string => {
  const key = toLocalDateKey(picked);
  const today = toLocalDateKey(new Date());
  return key > today ? today : key;
};

/**
 * The note's date: a row naming the day, today until changed. On iOS a press
 * shows the native date spinner under it; on Android it opens the system date
 * dialog. Neither offers a day after today.
 */
export function NoteDateRow({ value, onChange, disabled }: NoteDateRowProps) {
  const mode = useUiMode();
  const dateFormat = useDateFormat();
  // Today when the picker opened; null while it is closed.
  const [pickerMax, setPickerMax] = useState<Date | null>(null);
  const selected = parseLocalDateKey(value) ?? new Date();
  const label = noteDateLabels(value, dateFormat);

  const open = () => {
    const today = new Date();
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        mode: 'date',
        value: selected,
        maximumDate: today,
        onChange: (event, picked) => {
          if (event.type === 'set' && picked) onChange(pickedKey(picked));
        },
      });
      return;
    }
    setPickerMax((current) => (current ? null : today));
  };

  return (
    <View>
      <ChoiceRow
        accessibilityLabel={`Date: ${label.spoken}`}
        disabled={disabled}
        label="Date"
        onPress={open}
        testID="note-date-row"
        value={label.shown}
      />
      {pickerMax && Platform.OS !== 'android' ? (
        <View style={styles.picker}>
          <DateTimePicker
            display="spinner"
            locale={dateFormat === 'MM-DD-YYYY' ? 'en-US' : dateFormat === 'YYYY-MM-DD' ? 'sv-SE' : 'en-GB'}
            maximumDate={pickerMax}
            mode="date"
            onChange={(_event, picked) => {
              if (picked) onChange(pickedKey(picked));
            }}
            testID="note-date-picker"
            themeVariant={mode}
            value={selected}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  picker: {
    alignItems: 'center',
    overflow: 'hidden',
  },
});
