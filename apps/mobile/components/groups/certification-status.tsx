import { StyleSheet, Text, View } from 'react-native';

import { Icon, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import type { RecordCertificationStatus } from '@/src/groups';

/** `body`: a card's or sheet's status line. `meta`: the small mark beside a board row's date. */
export type GroupCertificationStatusSize = 'body' | 'meta';

/**
 * A record's certification state: a check in `ink` when certified, a ring in
 * `ink-muted` when not yet, nothing when voided (the label says why). No
 * success hue (G3): the glyph is decoration and the label, or the row's own
 * accessibility label, states the state in words.
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
  size = 'body',
}: {
  status: RecordCertificationStatus;
  label: string | null;
  testID?: string;
  iconTestID?: string;
  size?: GroupCertificationStatusSize;
}) {
  const certified = status === 'certified';
  return (
    <View
      accessibilityLabel={label ?? undefined}
      accessible={label !== null}
      style={styles.row}
      testID={testID}>
      {status === 'voided' ? null : (
        <Icon
          color={certified ? uiRoles.ink : uiRoles.inkMuted}
          name={certified ? 'check' : 'circle'}
          size={size === 'meta' ? 'xs' : 'sm'}
          testID={iconTestID}
        />
      )}
      {label ? (
        <Text allowFontScaling={false} style={[labelStyles[size], certified ? styles.labelCertified : null]}>
          {label}
        </Text>
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
  labelCertified: {
    color: uiRoles.ink,
  },
});

const labelStyles = StyleSheet.create({
  body: {
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  meta: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
});
