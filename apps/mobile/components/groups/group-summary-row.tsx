import { StyleSheet, Text, View } from 'react-native';

import { Icon, ListRow, uiRoles, uiSpace, uiText, uiTextTone } from '@/components/ui';
import { formatMemberCount, formatMyRole, type GroupSummary } from '@/src/groups';

type GroupSummaryRowProps = {
  group: GroupSummary;
  onPress: (group: GroupSummary) => void;
  /** A hairline above the row: every row but the card's first. */
  divider: boolean;
};

/**
 * A My groups row, one `ListRow` in the list's `Card`: the name, the
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
        <Text allowFontScaling={false} numberOfLines={1} style={uiText.bodyStrong}>
          {group.name}
        </Text>
        {group.description ? (
          <Text allowFontScaling={false} numberOfLines={2} style={[uiText.body, uiTextTone.muted]}>
            {group.description}
          </Text>
        ) : null}
        <Text allowFontScaling={false} style={uiText.label}>
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
});
