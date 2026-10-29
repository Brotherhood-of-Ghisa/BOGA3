import { FilterChip } from '@/components/exercise-catalog/exercise-list-controls';
import { Icon } from '@/components/ui/icon';
import { uiRoles } from '@/components/ui/tokens';

export type SecondarySetsChipProps = {
  /** Whether secondary sets count ([[muscle.secondary-filter]]). */
  value: boolean;
  onChange: (value: boolean) => void;
  testID: string;
};

/**
 * A muscle history page's secondary-set switch, one compact chip in its
 * selector row. Like the gym chip beside it, it fills while off its default:
 * counting secondary sets reads `+ Sec` under the half disc the week's cards
 * mark secondary work with; primary only fills and reads `Pri` under the
 * full disc. Both labels stay short so the metric chip never truncates.
 */
export function SecondarySetsChip({ value, onChange, testID }: SecondarySetsChipProps) {
  const primaryOnly = !value;
  return (
    <FilterChip
      accessibilityLabel="Count secondary sets"
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      label={primaryOnly ? 'Pri' : '+ Sec'}
      leading={<Icon color={primaryOnly ? uiRoles.surface : uiRoles.inkMuted}
        name={primaryOnly ? 'role-primary' : 'role-secondary'} size="xs" />}
      on={primaryOnly}
      onPress={() => onChange(!value)}
      size="compact"
      testID={testID}
    />
  );
}
