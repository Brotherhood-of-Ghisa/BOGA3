import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GroupSwitchSheet } from '@/components/groups/group-switch-sheet';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

export type TodayGroupHeaderProps = {
  /** The primary group's name; the section is named after it. */
  groupName: string;
  /** Opens the group on the Groups screen, At a glance. */
  onOpenHome: () => void;
  /** My groups, for the switch sheet; one group hides the switch. */
  groups: { groupId: string; name: string }[];
  selectedGroupId: string;
  onSelectGroup: (groupId: string) => void;
};

/**
 * Today's group section heading: the primary group's name, which opens that
 * group At a glance, and the switch beside it that changes which group is
 * primary. One group needs no switch.
 */
export function TodayGroupHeader({ groupName, onOpenHome, groups, selectedGroupId, onSelectGroup }: TodayGroupHeaderProps) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityHint="Opens the group at a glance"
        accessibilityLabel={`${groupName}, group`}
        accessibilityRole="button"
        onPress={onOpenHome}
        style={({ pressed }) => [styles.title, pressed ? styles.pressed : null]}
        testID="today-group-title">
        <Text allowFontScaling={false} accessibilityRole="header" ellipsizeMode="tail" numberOfLines={1} style={styles.titleText}>
          {groupName}
        </Text>
        <Icon color={uiRoles.inkMuted} name="chevron-right" size="sm" />
      </Pressable>
      <TodayGroupSwitch groups={groups} onSelectGroup={onSelectGroup} selectedGroupId={selectedGroupId} />
    </View>
  );
}

export type TodayGroupSwitchProps = Pick<TodayGroupHeaderProps, 'groups' | 'selectedGroupId' | 'onSelectGroup'>;

/** The switch that changes which group Today shows, and its sheet. One group needs none. */
export function TodayGroupSwitch({ groups, selectedGroupId, onSelectGroup }: TodayGroupSwitchProps) {
  const [switching, setSwitching] = useState(false);
  if (groups.length <= 1) return null;
  return (
    <>
      <IconButton
        accessibilityHint="Chooses which group Today shows"
        accessibilityLabel="Switch group"
        name="swap"
        onPress={() => setSwitching(true)}
        size="sm"
        testID="today-group-switch"
        tone="muted"
      />
      <GroupSwitchSheet
        groups={groups}
        onDismiss={() => setSwitching(false)}
        onSelect={onSelectGroup}
        selectedGroupId={selectedGroupId}
        testIDPrefix="today-group-switch"
        title="Show on Today"
        visible={switching}
      />
    </>
  );
}

export type TodayGroupActionsProps = TodayGroupSwitchProps & {
  /** Opens the shown group on the Groups screen, At a glance. */
  onOpenGroup: () => void;
};

/**
 * The cards layout's controls beside the tabs while a group's page shows: the
 * way to the group itself, then the switch (when there is more than one group).
 */
export function TodayGroupActions({ onOpenGroup, ...switchProps }: TodayGroupActionsProps) {
  return (
    <View style={styles.actions}>
      <IconButton
        accessibilityHint="Opens the group at a glance"
        accessibilityLabel="Open group"
        name="users"
        onPress={onOpenGroup}
        size="sm"
        testID="today-group-open"
        tone="muted"
      />
      <TodayGroupSwitch {...switchProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  title: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
    paddingVertical: uiSpace.xs,
  },
  pressed: {
    opacity: 0.6,
  },
  titleText: {
    flexShrink: 1,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
});
