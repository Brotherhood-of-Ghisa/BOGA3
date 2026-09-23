import { StyleSheet, View } from 'react-native';

import { Icon, UiText, uiColors, uiSpace, type UiTextVariant } from '@/components/ui';
import type { RecordCertificationStatus } from '@/src/groups';

/**
 * A record's certification state: a check when certified, a ring when not yet,
 * nothing when voided (the label says why). The glyph is decoration — the
 * label, or the row's own accessibility label, states the state in words.
 *
 * With a label the line is ONE accessibility element (label + `testID`), so a
 * flow matches its id and text at once and VoiceOver reads it as one line. It
 * also keeps XCUITest out of the SVG: inside a `Modal`, a decorative icon with
 * no accessible ancestor made iOS snapshot the app as empty (groups-e2e, the
 * record sheet). Without a label the caller's element already speaks for it.
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
    <View
      accessibilityLabel={label ?? undefined}
      accessible={label !== null}
      style={styles.row}
      testID={testID}>
      {status === 'voided' ? null : (
        <Icon
          color={status === 'certified' ? uiColors.textSuccess : uiColors.textSecondary}
          name={status === 'certified' ? 'check' : 'circle'}
          size="sm"
          testID={iconTestID}
        />
      )}
      {label ? <UiText variant={variant}>{label}</UiText> : null}
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
