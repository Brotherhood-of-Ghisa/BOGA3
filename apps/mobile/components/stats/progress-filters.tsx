import { useRef, useState, type ComponentRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Keyboard, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FilterChip } from '@/components/exercise-catalog/exercise-list-controls';
import { GymScopeChoices, offersGymChoice } from '@/components/gyms/gym-picker';
import { Icon } from '@/components/ui/icon';
import { Sheet } from '@/components/ui/sheet';
import { SwitchRow } from '@/components/ui/switch-row';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { gymScopeLabel, type GymScopeOption } from '@/src/utils/gym-scope-route';

type Toggle = { value: boolean; onChange: (value: boolean) => void };

export type ProgressFiltersProps = {
  /** Family grouping of the table in view; absent where no table shows. */
  grouping?: Toggle;
  /** Secondary work in muscle figures ([[muscle.secondary-filter]]); absent where none shows. */
  secondary?: Toggle;
  /** The view's gym ([[gym.view-filter]]), three-state; offered only as `showsGymPicker` says. */
  gym?: {
    value: string | null | undefined; options: readonly GymScopeOption[]; onChange: (gymId: string | null | undefined) => void;
    /** Sessions in the whole view, beside `All gyms`, when the options count theirs. */
    allSessionCount?: number;
  };
  /** The button's: the sheet is `<testID>-sheet`. */
  testID: string;
};

/** The offered choices off their opening value, as the button's label names them. */
export const changedFilters = ({ grouping, secondary, gym }: Omit<ProgressFiltersProps, 'testID'>): string[] => [
  ...(gym && gym.value !== undefined ? [gymScopeLabel(gym.value, gym.options)] : []),
  ...(grouping && !grouping.value ? ['not grouped'] : []),
  ...(secondary && !secondary.value ? ['secondary sets not counted'] : []),
];

/**
 * Progress's view choices behind one button — family grouping, secondary sets
 * and the gym — also a muscle history page's gym and secondary sets. The button fills while any choice is off its opening value;
 * the sheet stays open across choices, and holds only the ones the view
 * offers. With none, there is no button.
 */
export function ProgressFilters({ grouping, secondary, gym, testID }: ProgressFiltersProps) {
  const [open, setOpen] = useState(false);
  const origin = useRef<ComponentRef<typeof View> | null>(null);
  const offeredGym = gym && offersGymChoice(gym.value, gym.options) ? gym : undefined;
  if (!grouping && !secondary && !offeredGym) return null;
  const changed = changedFilters({ grouping, secondary, gym: offeredGym });
  // The button that opened the sheet takes the reader's focus back.
  const restoreFocus = () => {
    if (Platform.OS === 'web') return;
    const handle = origin.current ? findNodeHandle(origin.current) : null;
    if (typeof handle === 'number') AccessibilityInfo.setAccessibilityFocus(handle);
  };
  return (
    <>
      <View ref={origin} collapsable={false}>
        <FilterChip
          accessibilityLabel={changed.length === 0 ? 'Filters' : `Filters: ${changed.join(', ')}`}
          accessibilityRole="button"
          label="Filters"
          on={changed.length > 0}
          onPress={() => {
            Keyboard.dismiss();
            setOpen(true);
          }}
          size="compact"
          testID={testID}
          trailing={<Icon color={changed.length > 0 ? uiRoles.surface : uiRoles.inkMuted} name="chevron-down" size="xs" />}
        />
      </View>
      <Sheet dismissLabel="Dismiss filters" onDismiss={() => setOpen(false)} onDismissed={restoreFocus}
        testID={`${testID}-sheet`} title="Filters" visible={open}>
        <ScrollView contentContainerStyle={styles.content}>
          {grouping ? <SwitchRow label="Group by muscle family" onValueChange={grouping.onChange}
            testID="stats-group-toggle" value={grouping.value} /> : null}
          {secondary ? <SwitchRow label="Count secondary sets" onValueChange={secondary.onChange}
            testID="stats-secondary-toggle" value={secondary.value} /> : null}
          {offeredGym ? <>
            <Text accessibilityRole="header" allowFontScaling={false} style={styles.sectionLabel}>Gym</Text>
            <GymScopeChoices allSessionCount={offeredGym.allSessionCount} onChoose={offeredGym.onChange} options={offeredGym.options}
              testID="stats-gym" value={offeredGym.value} />
          </> : null}
        </ScrollView>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: uiSpace.lg },
  sectionLabel: {
    paddingHorizontal: uiSpace.lg,
    paddingTop: uiSpace.md,
    paddingBottom: uiSpace.xs,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
  },
});
