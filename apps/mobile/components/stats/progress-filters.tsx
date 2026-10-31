import { useRef, useState, type ComponentRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Keyboard, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FilterChip } from '@/components/exercise-catalog/exercise-list-controls';
import { GymScopeChoices, offersGymChoice } from '@/components/gyms/gym-picker';
import { Icon } from '@/components/ui/icon';
import { Sheet } from '@/components/ui/sheet';
import { SwitchRow } from '@/components/ui/switch-row';
import { uiText } from '@/components/ui/text-roles';
import { uiRoles, uiSpace } from '@/components/ui/tokens';
import { gymScopeLabel, type GymScopeOption } from '@/src/utils/gym-scope-route';

/** `opening` is the value the view opened on (Settings' default); on when absent. */
type Toggle = { value: boolean; onChange: (value: boolean) => void; opening?: boolean };

const changedToggle = (toggle: Toggle | undefined): toggle is Toggle =>
  toggle !== undefined && toggle.value !== (toggle.opening ?? true);

export type ProgressFiltersProps = {
  /** Family grouping of the table in view; absent where no table shows. */
  grouping?: Toggle;
  /** Secondary work in muscle figures ([[muscle.secondary-filter]]); absent where none shows. */
  secondary?: Toggle;
  secondaryVolume?: Toggle;
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
export const changedFilters = ({ grouping, secondary, secondaryVolume, gym }: Omit<ProgressFiltersProps, 'testID'>): string[] => [
  ...(gym && gym.value !== undefined ? [gymScopeLabel(gym.value, gym.options)] : []),
  ...(changedToggle(grouping) ? [grouping.value ? 'grouped' : 'not grouped'] : []),
  ...(changedToggle(secondary) ? [secondary.value ? 'secondary sets counted' : 'secondary sets not counted'] : []),
  ...(changedToggle(secondaryVolume) ? [secondaryVolume.value ? 'secondary volume counted' : 'secondary volume not counted'] : []),
];

/**
 * Progress's view choices behind one button — family grouping, secondary sets
 * and the gym. The button fills while any choice is off its opening value;
 * the sheet stays open across choices, and holds only the ones the view
 * offers. With none, there is no button.
 */
export function ProgressFilters({ grouping, secondary, secondaryVolume, gym, testID }: ProgressFiltersProps) {
  const [open, setOpen] = useState(false);
  const origin = useRef<ComponentRef<typeof View> | null>(null);
  const offeredGym = gym && offersGymChoice(gym.value, gym.options) ? gym : undefined;
  if (!grouping && !secondary && !secondaryVolume && !offeredGym) return null;
  const changed = changedFilters({ grouping, secondary, secondaryVolume, gym: offeredGym });
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
          {secondary ? <SwitchRow label="Sets: Primary only"
            onValueChange={primaryOnly => secondary.onChange(!primaryOnly)}
            testID="stats-secondary-toggle" value={!secondary.value} /> : null}
          {secondaryVolume ? <SwitchRow label="Volume: Primary only"
            onValueChange={primaryOnly => secondaryVolume.onChange(!primaryOnly)}
            testID="stats-volume-primary-only-toggle" value={!secondaryVolume.value} /> : null}
          {offeredGym ? <>
            <Text accessibilityRole="header" allowFontScaling={false} style={[uiText.label, styles.sectionLabel]}>Gym</Text>
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
  },
});
