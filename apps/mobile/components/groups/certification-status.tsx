import { StyleSheet, View } from 'react-native';

import { Icon, UiText, uiColors, uiSpace, type UiTextVariant } from '@/components/ui';
import type { RecordCertificationStatus } from '@/src/groups';

/**
 * A record's certification state: a check when certified, a ring when not yet,
 * nothing when voided (the label says why). The glyph is decoration — the
 * label, or the row's own accessibility label, states the state in words.
 * `testID` stays on the label text, so a flow can match its id and text at once.
 */
export function GroupCertificationStatus({
  status,
  label,
  testID,
  iconTestID,
  variant = 'label',
}: {
  status: RecordCertificationStatus;
  label: string | null;
  testID?: string;
  iconTestID?: string;
  variant?: UiTextVariant;
}) {
  return (
    <View style={styles.row}>
      {status === 'voided' ? null : (
        <Icon
          color={status === 'certified' ? uiColors.textSuccess : uiColors.textSecondary}
          name={status === 'certified' ? 'check' : 'circle'}
          size="sm"
          testID={iconTestID}
        />
      )}
      {label ? (
        <UiText testID={testID} variant={variant}>
          {label}
        </UiText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
});
