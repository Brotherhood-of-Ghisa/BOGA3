import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { Icon } from '@/components/ui/icon';
import { uiText } from '@/components/ui/text-roles';
import { uiRoles, uiSpace } from '@/components/ui/tokens';

import { GroupSwitchSheet, type GroupSwitchOption } from './group-switch-sheet';

/** The Groups screen's three views of one group, in page order. */
export type GroupsSection = 'stream' | 'glance' | 'leaderboards';

export const GROUP_SECTIONS: readonly GroupsSection[] = ['stream', 'glance', 'leaderboards'];

export const GROUP_SECTION_LABELS: Record<GroupsSection, string> = {
  glance: 'At a glance',
  stream: 'Stream',
  leaderboards: 'Leaderboards',
};

export type GroupScreenHeaderProps = {
  /** My groups; one group leaves the title with no switch. */
  groups: GroupSwitchOption[];
  selectedGroupId: string | null;
  /** The selected group's name, or `Groups` before one is known. */
  groupName: string;
  onSelectGroup: (groupId: string) => void;
  onOpenManage: () => void;
};

// Clear of the back arrow and `Manage` on a 375pt phone.
const TITLE_MAX_WIDTH = 200;

/**
 * The Groups screen's native header: the group's name as the title — with
 * two or more groups a button, a chevron after the name, that opens the group
 * switch — and `Manage` on the right, the way into joining, creating and each
 * group's page.
 */
export function GroupScreenHeader({ groups, selectedGroupId, groupName, onSelectGroup, onOpenManage }: GroupScreenHeaderProps) {
  const [switching, setSwitching] = useState(false);
  const canSwitch = groups.length > 1;
  return (
    <>
      <Stack.Screen
        options={{
          title: groupName,
          headerTitle: () => <GroupsTitle canSwitch={canSwitch} name={groupName} onPress={() => setSwitching(true)} />,
          headerRight: () => (
            <ActionButton label="Manage" onPress={onOpenManage} testID="groups-manage-button" variant="text" />
          ),
        }}
      />
      {canSwitch ? (
        <GroupSwitchSheet
          groups={groups}
          onDismiss={() => setSwitching(false)}
          onSelect={onSelectGroup}
          selectedGroupId={selectedGroupId}
          testIDPrefix="groups-switch"
          title="Show this group"
          visible={switching}
        />
      ) : null}
    </>
  );
}

function GroupsTitle({ name, canSwitch, onPress }: { name: string; canSwitch: boolean; onPress: () => void }) {
  // A long name shrinks before it truncates.
  const label = (
    <Text
      adjustsFontSizeToFit
      allowFontScaling={false}
      ellipsizeMode="tail"
      minimumFontScale={0.75}
      numberOfLines={1}
      style={[uiText.sheetTitle, styles.text]}
      testID="groups-title-name">
      {name}
    </Text>
  );
  if (!canSwitch) {
    return (
      <View accessibilityLabel={`${name}, group`} accessibilityRole="header" accessible style={styles.title} testID="groups-title">
        {label}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityHint="Chooses which group to show"
      accessibilityLabel={`${name}, group`}
      accessibilityRole="button"
      hitSlop={uiSpace.sm}
      onPress={onPress}
      style={({ pressed }) => [styles.title, pressed ? styles.pressed : null]}
      testID="groups-title">
      {label}
      <Icon color={uiRoles.inkMuted} name="chevron-down" size="sm" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
    maxWidth: TITLE_MAX_WIDTH,
  },
  pressed: {
    opacity: 0.6,
  },
  text: {
    flexShrink: 1,
  },
});
