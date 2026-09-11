import { StyleSheet, View } from 'react-native';

import { UiButton, UiSurface, uiColors, uiRadius, uiSpace, uiTypography } from '@/components/ui';

/**
 * The four top-level tabs, in their canonical left-to-right order.
 *
 * History / Log / Exercises came from the navigation redesign; Groups is the
 * M22 fourth tab (groups contract §6.3). The Settings cog stays as a utility
 * action on the right, not promoted to a tab.
 */
export type TopLevelTabKey = 'stats-history' | 'log' | 'exercises' | 'groups';

type TopLevelTabsProps = {
  activeTab: TopLevelTabKey;
  onPressStatsHistory: () => void;
  onPressLog: () => void;
  onPressExercises: () => void;
  onPressGroups: () => void;
  onPressSettings: () => void;
};

export function TopLevelTabs({
  activeTab,
  onPressStatsHistory,
  onPressLog,
  onPressExercises,
  onPressGroups,
  onPressSettings,
}: TopLevelTabsProps) {
  return (
    <UiSurface accessibilityRole="tablist" style={styles.shell} testID="top-level-bottom-tabs">
      <View style={styles.tabsRow}>
        <UiButton
          accessibilityLabel="Open History"
          accessibilityRole="tab"
          active={activeTab === 'stats-history'}
          label="History"
          onPress={onPressStatsHistory}
          testID="top-level-tab-stats-history"
          style={styles.tabButton}
          textStyle={styles.tabLabel}
          variant="tab"
        />
        <UiButton
          accessibilityLabel="Open Log"
          accessibilityRole="tab"
          active={activeTab === 'log'}
          label="Log"
          onPress={onPressLog}
          testID="top-level-tab-log"
          style={styles.tabButton}
          textStyle={styles.tabLabel}
          variant="tab"
        />
        <UiButton
          accessibilityLabel="Open Exercises"
          accessibilityRole="tab"
          active={activeTab === 'exercises'}
          label="Exercises"
          onPress={onPressExercises}
          testID="top-level-tab-exercises"
          style={styles.tabButton}
          textStyle={styles.tabLabel}
          variant="tab"
        />
        <UiButton
          accessibilityLabel="Open Groups"
          accessibilityRole="tab"
          active={activeTab === 'groups'}
          label="Groups"
          onPress={onPressGroups}
          testID="top-level-tab-groups"
          style={styles.tabButton}
          textStyle={styles.tabLabel}
          variant="tab"
        />
      </View>
      <UiButton
        accessibilityLabel="Open Settings"
        label="⚙"
        onPress={onPressSettings}
        style={styles.settingsButton}
        testID="top-level-settings-button"
        textStyle={styles.settingsButtonText}
        variant="secondary"
      />
    </UiSurface>
  );
}

const styles = StyleSheet.create({
  shell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    padding: uiSpace.sm,
    borderRadius: uiRadius.xl,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
  },
  tabsRow: {
    flex: 1,
    flexDirection: 'row',
    gap: uiSpace.xs,
  },
  tabButton: {
    paddingHorizontal: uiSpace.xxs,
  },
  // Four tabs must fit a 375 pt phone (iPhone SE). Shrink-to-fit does not
  // engage on-device, so the label size is fixed: at the default size
  // "Exercises" clipped (M22-T04 small-phone screenshot).
  tabLabel: {
    alignSelf: 'stretch',
    textAlign: 'center',
    fontSize: uiTypography.size.sm,
  },
  settingsButton: {
    minWidth: 46,
    paddingHorizontal: uiSpace.sm,
  },
  settingsButtonText: {
    fontSize: 18,
    lineHeight: 18,
  },
});
