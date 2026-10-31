import { FilterChip } from '@/components/exercise-catalog/exercise-list-controls';
import { Icon } from '@/components/ui/icon';
import { uiRoles } from '@/components/ui/tokens';

export type SecondarySetsChipProps = {
  /** Whether secondary sets count ([[muscle.secondary-filter]]). */
  value: boolean;
  onChange: (value: boolean) => void;
  testID: string;
  metric?: 'workingSetCount' | 'totalVolume';
};

/**
 * A muscle history page's secondary-set switch, one compact chip in its
 * selector row. It names and marks the state as the week's cards mark work:
 * `Sec` under a half disc while secondary sets count, `Pri` under a full disc
 * for primary only. The chip
 * never fills, so the row's ink stays on the view selector.
 */
export function SecondarySetsChip({ value, onChange, testID, metric = 'workingSetCount' }: SecondarySetsChipProps) {
  return (
    <FilterChip
      accessibilityLabel={metric === 'totalVolume' ? 'Volume: Primary only' : 'Sets: Primary only'}
      accessibilityRole="switch"
      accessibilityState={{ checked: !value }}
      label={value ? 'Sec' : 'Pri'}
      leading={<Icon color={uiRoles.inkMuted} name={value ? 'role-secondary' : 'role-primary'} size="xs" />}
      on={false}
      onPress={() => onChange(!value)}
      size="compact"
      testID={testID}
    />
  );
}
