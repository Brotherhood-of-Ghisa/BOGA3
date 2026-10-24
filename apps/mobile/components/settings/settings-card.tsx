import type { ReactNode } from 'react';

import { Card, Icon, ListRow, uiRoles, type IconName } from '@/components/ui';

type SettingsCardProps = {
  icon: IconName;
  label: string;
  // What is set now, under the label (the Account card's email).
  status?: string;
  // Opens the card's sub page. Without it the card is read, not pressed
  // (About), unless `control` makes it a switch (Developer mode).
  onPress?: () => void;
  // An inline control in place of the chevron.
  control?: ReactNode;
  accessibilityHint?: string;
  testID: string;
};

// One Settings destination as a card of its own: icon, label, status.
export function SettingsCard({ icon, label, status, onPress, control, accessibilityHint, testID }: SettingsCardProps) {
  return (
    <Card>
      <ListRow
        accessibilityHint={accessibilityHint}
        accessibilityLabel={status ? `${label}, ${status}` : label}
        accessible={onPress || control ? undefined : true}
        density="list"
        description={status}
        divider={false}
        label={label}
        leading={<Icon color={uiRoles.inkMuted} name={icon} />}
        meta={control}
        onPress={onPress}
        testID={testID}
        trailing={onPress ? <Icon color={uiRoles.inkFaint} name="chevron-right" size="sm" /> : undefined}
      />
    </Card>
  );
}
