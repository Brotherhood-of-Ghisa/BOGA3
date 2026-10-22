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

type GymScopeChoiceProps = {
  /** Three-state (`src/utils/gym-scope-route.ts`): unset every gym, `null` no gym, an id that gym. */
  value: string | null | undefined;
  options: readonly GymScopeOption[];
};

export type GymPickerButtonProps = GymScopeChoiceProps & {
  onPress: () => void;
  /**
   * `pill` is a filter-row chip, one tap target tall. `compact` is a
   * segment's height and label face, for a row that already exists (a page
   * header), with hit slop keeping the tap target: no view adds a row for it.
   */
  size?: 'pill' | 'compact';
  testID: string;
};

export type GymPickerSheetProps = GymScopeChoiceProps & {
  visible: boolean;
  onClose: () => void;
  onChange: (gymId: string | null | undefined) => void;
  /** Sessions in the whole view, beside `All gyms`, when the options count theirs. */
  allSessionCount?: number;
  onDismissed?: () => void;
  /** The button's: the sheet is `<testID>-sheet`, its rows `<testID>-option-<gym>`. */
  testID: string;
};

export type GymPickerProps = Omit<GymPickerSheetProps, 'visible' | 'onClose' | 'onDismissed'> &
  Pick<GymPickerButtonProps, 'size'>;

type Choice = { key: string; gymId: string | null | undefined; label: string; count?: number };

// A chosen gym the options no longer list stays offered, so the choice in
// force is always one of the rows.
const offeredOptions = (value: string | null | undefined, options: readonly GymScopeOption[]) =>
  value === undefined || options.some((option) => option.gymId === value)
    ? options
    : [...options, { gymId: value, name: value === null ? null : SELECTED_GYM_LABEL }];

/**
 * A view's gym filter ([[gym.view-filter]]): one button naming the scope in
 * force, which opens a sheet of radio rows: `All gyms`, then each option. It
 * fills while a gym is chosen, and is drawn only as `showsGymPicker` says.
 * `GymPicker` is both in place; a page whose button lives in its header draws
 * `GymPickerButton` there and `GymPickerSheet` in its body.
 */
export function GymPicker({ value, options, onChange, allSessionCount, size = 'pill', testID }: GymPickerProps) {
  const [open, setOpen] = useState(false);
  const origin = useRef<ComponentRef<typeof View> | null>(null);
  // The button that opened the sheet takes the reader's focus back.
  const restoreFocus = () => {
    if (Platform.OS === 'web') return;
    const handle = origin.current ? findNodeHandle(origin.current) : null;
    if (typeof handle === 'number') AccessibilityInfo.setAccessibilityFocus(handle);
  };
  if (!showsGymPicker(value, offeredOptions(value, options))) return null;
  return (
    <>
      <View ref={origin} collapsable={false}>
        <GymPickerButton onPress={() => setOpen(true)} options={options} size={size} testID={testID} value={value} />
      </View>
      <GymPickerSheet allSessionCount={allSessionCount} onChange={onChange} onClose={() => setOpen(false)}
        onDismissed={restoreFocus} options={options} testID={testID} value={value} visible={open} />
    </>
  );
}

export function GymPickerButton({ value, options, onPress, size = 'pill', testID }: GymPickerButtonProps) {
  const offered = offeredOptions(value, options);
  if (!showsGymPicker(value, offered)) return null;
  const label = gymScopeLabel(value, offered);
  return (
    <FilterChip
      accessibilityHint={HINT}
      accessibilityLabel={`Gym: ${label}`}
      accessibilityRole="button"
      label={label}
      size={size}
      trailing={size === 'compact' ? <Icon color={value !== undefined ? uiRoles.surface : uiRoles.inkMuted} name="chevron-down" size="xs" /> : undefined}
      on={value !== undefined}
      onPress={onPress}
      testID={testID}
    />
  );
}

export function GymPickerSheet({
  visible, onClose, onChange, onDismissed, value, options, allSessionCount, testID,
}: GymPickerSheetProps) {
  const choices: Choice[] = [
    { key: 'all', gymId: undefined, label: ALL_GYMS_LABEL, count: allSessionCount },
    ...offeredOptions(value, options).map((option) => ({
      key: option.gymId ?? 'no-gym',
      gymId: option.gymId,
      label: gymOptionLabel(option),
      count: option.sessionCount,
    })),
  ];
  const choose = (gymId: string | null | undefined) => {
    onClose();
    if (gymId !== value) onChange(gymId);
  };
  return (
    <Sheet
      dismissLabel="Dismiss gyms"
      onDismiss={onClose}
      onDismissed={onDismissed}
      testID={`${testID}-sheet`}
      title="Gym"
      visible={visible}>
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
  );
}

const HINT = 'Chooses the gym this view counts';

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
