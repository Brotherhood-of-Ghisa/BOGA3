import { Pressable, StyleSheet } from 'react-native';

import { UiSurface, UiText, uiSpace } from '@/components/ui';
import { formatMemberCount, formatMyRole, type GroupSummary } from '@/src/groups';

/** A My groups row: name, description, member count and my role. A tap opens the group. */
export function GroupSummaryRow({ group, onPress }: { group: GroupSummary; onPress: (group: GroupSummary) => void }) {
  const meta = `${formatMemberCount(group.member_count)} · ${formatMyRole(group.my_role)}`;
  return (
    <Pressable
      accessibilityLabel={`${group.name}, ${meta}`}
      accessibilityRole="button"
      onPress={() => onPress(group)}
      testID={`group-summary-row-${group.group_id}`}>
      <UiSurface style={styles.card}>
        <UiText numberOfLines={1} variant="title">
          {group.name}
        </UiText>
        {group.description ? (
          <UiText numberOfLines={2} variant="bodyMuted">
            {group.description}
          </UiText>
        ) : null}
        <UiText variant="subtitle">{meta}</UiText>
      </UiSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: uiSpace.md,
    gap: uiSpace.xs,
  },
});
