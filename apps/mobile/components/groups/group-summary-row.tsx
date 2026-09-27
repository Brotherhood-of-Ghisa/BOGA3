import { StyleSheet, Text, View } from 'react-native';

import { Icon, ListRow, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import { formatMemberCount, formatMyRole, type GroupSummary } from '@/src/groups';

type GroupSummaryRowProps = {
  group: GroupSummary;
  onPress: (group: GroupSummary) => void;
  /** A hairline above the row: every row but the card's first. */
  divider: boolean;
};

/**
 * A My groups row, one `ListRow` in the list's `Card`: the name in Archivo, the
 * description in `ink-muted`, the member count and my role as a micro-label,
 * and a chevron. A tap opens the group.
 */
export function GroupSummaryRow({ group, onPress, divider }: GroupSummaryRowProps) {
  const meta = `${formatMemberCount(group.member_count)} · ${formatMyRole(group.my_role)}`;
  return (
    <ListRow
      accessibilityLabel={`${group.name}, ${meta}`}
      density="list"
      divider={divider}
      onPress={() => onPress(group)}
      testID={`group-summary-row-${group.group_id}`}
      trailing={<Icon color={uiRoles.inkMuted} name="chevron-right" />}>
      <View style={styles.content}>
        <Text allowFontScaling={false} numberOfLines={1} style={styles.name}>
          {group.name}
        </Text>
        {group.description ? (
          <Text allowFontScaling={false} numberOfLines={2} style={styles.description}>
            {group.description}
          </Text>
        ) : null}
        <Text allowFontScaling={false} style={styles.meta}>
          {meta}
        </Text>
      </View>
    </ListRow>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: uiSpace.xs,
    paddingVertical: uiSpace.sm,
  },
  name: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  description: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  meta: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
  },
});
