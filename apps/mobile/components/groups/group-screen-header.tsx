import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { Icon } from '@/components/ui/icon';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { GroupHomeMetric, GroupHomePeriod } from '@/src/groups/home-periods';
import { GROUP_HOME_METRIC_LABELS } from '@/src/groups/home-view-model';

import { GroupCycleButton } from './group-cycle-button';
import { GroupSwitchSheet, type GroupSwitchOption } from './group-switch-sheet';

/** The Groups screen's three views of one group. */
export type GroupsSection = 'glance' | 'stream' | 'leaderboards';

export const GROUP_SECTION_LABELS: Record<GroupsSection, string> = {
  glance: 'At a glance',
  stream: 'Stream',
  leaderboards: 'Leaderboards',
};

const SECTION_OPTIONS = [
  { value: 'glance' as const, label: GROUP_SECTION_LABELS.glance },
  { value: 'stream' as const, label: GROUP_SECTION_LABELS.stream },
  { value: 'leaderboards' as const, label: GROUP_SECTION_LABELS.leaderboards },
];

const METRIC_OPTIONS = [
  { value: 'sets' as const, label: GROUP_HOME_METRIC_LABELS.sets },
  { value: 'prs' as const, label: GROUP_HOME_METRIC_LABELS.prs },
];

const PERIOD_OPTIONS = [
  { value: 'week' as const, label: 'Week' },
  { value: 'month' as const, label: 'Month' },
];

export type GroupScreenHeaderProps = {
  /** My groups; one group leaves the title with no switch. */
  groups: GroupSwitchOption[];
  selectedGroupId: string | null;
  groupName: string;
  onSelectGroup: (groupId: string) => void;
  section: GroupsSection;
  onSectionChange: (next: GroupsSection) => void;
  metric: GroupHomeMetric;
  onMetricChange: (next: GroupHomeMetric) => void;
  period: GroupHomePeriod;
  onPeriodChange: (next: GroupHomePeriod) => void;
  onOpenMyGroups: () => void;
  /** A control at the end of the filter row: the stream's event-type menu. */
  filterTrailing?: ReactNode;
};

// The title is always one line: a longer name is drawn a step smaller, and a
// name past the last step is clipped. Nothing wraps.
const TITLE_STEPS = [
  { maxLength: 14, style: { fontSize: uiTypography.size.xxl, lineHeight: uiTypography.lineHeight.xxl } },
  { maxLength: 22, style: { fontSize: uiTypography.size.xl, lineHeight: uiTypography.lineHeight.xl } },
] as const;

const LONGEST_TITLE = { fontSize: uiTypography.size.lg, lineHeight: uiTypography.lineHeight.lg };

const titleStep = (name: string) =>
  TITLE_STEPS.find((step) => name.length <= step.maxLength)?.style ?? LONGEST_TITLE;

/**
 * The Groups screen's heading: the group's name as the title, which opens the
 * group switch; then the filter row — the section, pinned across all three,
 * and (at a glance) the metric and the period, each a pill that cycles
 * through its options. The section pill says which view this is, so the
 * title stands alone ([[copy.no-subtitles]]).
 */
export function GroupScreenHeader({
  groups,
  selectedGroupId,
  groupName,
  onSelectGroup,
  section,
  onSectionChange,
  metric,
  onMetricChange,
  period,
  onPeriodChange,
  onOpenMyGroups,
  filterTrailing,
}: GroupScreenHeaderProps) {
  const [switching, setSwitching] = useState(false);
  const canSwitch = groups.length > 1;
  // Before any group is known (loading, none joined) there is nothing to
  // filter and nowhere to be: the title stands alone.
  const hasGroups = groups.length > 0;
  return (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Pressable
          accessibilityHint={canSwitch ? 'Chooses which group to show' : undefined}
          accessibilityLabel={`${groupName}, group`}
          accessibilityRole={canSwitch ? 'button' : 'header'}
          disabled={!canSwitch}
          onPress={() => setSwitching(true)}
          style={({ pressed }) => [styles.title, pressed ? styles.pressed : null]}
          testID="groups-title">
          <Text
            allowFontScaling={false}
            ellipsizeMode="tail"
            numberOfLines={1}
            style={[styles.titleText, titleStep(groupName)]}
            testID="groups-title-name">
            {groupName}
          </Text>
          {canSwitch ? <Icon color={uiRoles.inkMuted} name="caret-down" size="sm" /> : null}
        </Pressable>
        <ActionButton label="My groups" onPress={onOpenMyGroups} testID="groups-my-groups-button" variant="text" />
      </View>
      {hasGroups ? (
      <View style={styles.filters} testID="groups-filters">
        <GroupCycleButton
          accessibilityLabel="Section"
          onChange={onSectionChange}
          options={SECTION_OPTIONS}
          testID="groups-filter-section"
          value={section}
        />
        {section === 'glance' ? (
          <>
            <GroupCycleButton
              accessibilityLabel="Metric"
              onChange={onMetricChange}
              options={METRIC_OPTIONS}
              testID="groups-filter-metric"
              value={metric}
            />
            <GroupCycleButton
              accessibilityLabel="Period"
              onChange={onPeriodChange}
              options={PERIOD_OPTIONS}
              testID="groups-filter-period"
              value={period}
            />
          </>
        ) : null}
        {filterTrailing}
      </View>
      ) : null}
      <GroupSwitchSheet
        groups={groups}
        onDismiss={() => setSwitching(false)}
        onSelect={onSelectGroup}
        selectedGroupId={selectedGroupId}
        testIDPrefix="groups-switch"
        title="Show this group"
        visible={switching}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: uiSpace.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  title: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  pressed: {
    opacity: 0.6,
  },
  titleText: {
    flexShrink: 1,
    fontFamily: uiFonts.display.family,
    fontWeight: '800',
    color: uiRoles.ink,
  },
  filters: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
});
