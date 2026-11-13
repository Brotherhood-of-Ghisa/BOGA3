import { useRouter } from 'expo-router';

import { ChoiceRow } from '@/components/ui/form-section';
import { INJURIES_ROUTE } from '@/src/navigation/routes';
import { useInjuries } from '@/src/injuries/use-injuries';

export function InjuriesSettingsRow({ divider = false }: { divider?: boolean }) {
  const router = useRouter();
  const { state } = useInjuries();

  const count = state.active.length;
  const statusLabel =
    state.status === 'loading'
      ? 'Loading...'
      : count === 0
      ? 'None active'
      : count === 1
      ? '1 active'
      : `${count} active`;

  return (
    <ChoiceRow
      accessibilityLabel={`Injuries, ${statusLabel}`}
      divider={divider}
      icon="warning"
      label="Injuries"
      onPress={() => router.push(INJURIES_ROUTE)}
      testID="settings-injuries-row"
      value={statusLabel}
    />
  );
}
