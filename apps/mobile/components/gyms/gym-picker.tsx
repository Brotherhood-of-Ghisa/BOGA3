import { useRef, useState, type ComponentRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FilterChip } from '@/components/exercise-catalog/exercise-list-controls';
import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { Sheet } from '@/components/ui/sheet';
import { uiFonts, uiRoles, uiTypography } from '@/components/ui/tokens';
import {
  ALL_GYMS_LABEL,
  SELECTED_GYM_LABEL,
  gymOptionLabel,
  gymScopeLabel,
  showsGymPicker,
  type GymScopeOption,
} from '@/src/utils/gym-scope-route';

export type GymPickerProps = {
  /** Three-state (`src/utils/gym-scope-route.ts`): unset every gym, `null` no gym, an id that gym. */
  value: string | null | undefined;
  options: readonly GymScopeOption[];
  onChange: (gymId: string | null | undefined) => void;
  /** Sessions in the whole view, beside `All gyms`, when the options count theirs. */
  allSessionCount?: number;
  testID: string;
};

type Choice = { key: string; gymId: string | null | undefined; label: string; count?: number };

/**
 * A view's gym filter ([[gym.view-filter]]): one pill naming the scope in
 * force, which opens a sheet of radio rows: `All gyms`, then each option. The
 * pill fills while a gym is chosen, and is drawn only as `showsGymPicker`
 * says. A chosen gym the options no longer list stays offered, so the choice
 * in force is always one of the rows.
 */
export function GymPicker({ value, options, onChange, allSessionCount, testID }: GymPickerProps) {
  const [open, setOpen] = useState(false);
  const origin = useRef<ComponentRef<typeof View> | null>(null);
  const offered = value === undefined || options.some((option) => option.gymId === value)
    ? options
    : [...options, { gymId: value, name: value === null ? null : SELECTED_GYM_LABEL }];
  if (!showsGymPicker(value, offered)) return null;
  const label = gymScopeLabel(value, offered);
  const choices: Choice[] = [
    { key: 'all', gymId: undefined, label: ALL_GYMS_LABEL, count: allSessionCount },
    ...offered.map((option) => ({
      key: option.gymId ?? 'no-gym',
      gymId: option.gymId,
      label: gymOptionLabel(option),
      count: option.sessionCount,
    })),
  ];
  const choose = (gymId: string | null | undefined) => {
    setOpen(false);
    if (gymId !== value) onChange(gymId);
  };
  // The pill that opened the sheet takes the reader's focus back.
  const restoreFocus = () => {
    if (Platform.OS === 'web') return;
    const handle = origin.current ? findNodeHandle(origin.current) : null;
    if (typeof handle === 'number') AccessibilityInfo.setAccessibilityFocus(handle);
  };
  return (
    <>
      <View ref={origin} collapsable={false}>
        <FilterChip
          accessibilityHint="Chooses the gym this view counts"
          accessibilityLabel={`Gym: ${label}`}
          accessibilityRole="button"
          label={label}
          on={value !== undefined}
          onPress={() => setOpen(true)}
          testID={testID}
        />
      </View>
      <Sheet
        dismissLabel="Dismiss gyms"
        onDismiss={() => setOpen(false)}
        onDismissed={restoreFocus}
        testID={`${testID}-sheet`}
        title="Gym"
        visible={open}>
        <ScrollView>
          {choices.map((choice) => {
            const checked = choice.gymId === value;
            return (
              <ListRow
                accessibilityLabel={choice.count === undefined ? choice.label : `${choice.label}, ${choice.count} sessions`}
                checked={checked}
                key={choice.key}
                leading={<Icon name={checked ? 'radio-on' : 'radio-off'} />}
                meta={choice.count === undefined ? undefined : <Text allowFontScaling={false} style={styles.count}>{choice.count}</Text>}
                onPress={() => choose(choice.gymId)}
                testID={`${testID}-option-${choice.key}`}>
                <Text allowFontScaling={false} style={styles.label}>{choice.label}</Text>
              </ListRow>
            );
          })}
        </ScrollView>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: uiFonts.body.family,
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  count: {
    fontFamily: uiFonts.figure.family,
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
});
