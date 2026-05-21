import { StyleSheet, View } from 'react-native';

import { UiButton, UiSurface, uiColors, uiRadius, uiSpace } from '@/components/ui';

/**
 * The three top-level tabs, in their canonical left-to-right order.
 *
 * Mapped from the legacy `Sessions / Exercises / Stats` triad as part of the
 * navigation redesign (see `docs/plans/navigation-redesign/plan.md`). The
 * Settings cog stays as a utility action on the right, not promoted to a tab.
 */
export type TopLevelTabKey = 'stats-history' | 'log' | 'exercises';

type TopLevelTabsProps = {
  activeTab: TopLevelTabKey;
  onPressStatsHistory: () => void;
  onPressLog: () => void;
  onPressExercises: () => void;
  onPressSettings: () => void;
};

export function TopLevelTabs({
  activeTab,
  onPressStatsHistory,
  onPressLog,
  onPressExercises,
  onPressSettings,
}: TopLevelTabsProps) {
  return (
    <UiSurface accessibilityRole="tablist" style={styles.shell} testID="top-level-bottom-tabs">
      <View style={styles.tabsRow}>
        <UiButton
          accessibilityLabel="Open Stats and History"
          accessibilityRole="tab"
          active={activeTab === 'stats-history'}
          label="Stats/History"
          onPress={onPressStatsHistory}
          testID="top-level-tab-stats-history"
          variant="tab"
        />
        <UiButton
          accessibilityLabel="Open Log"
          accessibilityRole="tab"
          active={activeTab === 'log'}
          label="Log"
          onPress={onPressLog}
          testID="top-level-tab-log"
          variant="tab"
        />
        <UiButton
          accessibilityLabel="Open Exercises"
          accessibilityRole="tab"
          active={activeTab === 'exercises'}
          label="Exercises"
          onPress={onPressExercises}
          testID="top-level-tab-exercises"
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
    gap: uiSpace.sm,
  },
  settingsButton: {
    minWidth: 46,
    paddingHorizontal: uiSpace.lg,
  },
  settingsButtonText: {
    fontSize: 18,
    lineHeight: 18,
  },
});
