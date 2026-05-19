import { StyleSheet, View } from 'react-native';

import { UiButton, UiSurface, uiColors, uiRadius, uiSpace } from '@/components/ui';

export type TopLevelTabKey = 'sessions' | 'exercises' | 'stats';

type TopLevelTabsProps = {
  activeTab: TopLevelTabKey;
  onPressSessions: () => void;
  onPressExercises: () => void;
  onPressStats: () => void;
  onPressSettings: () => void;
};

export function TopLevelTabs({
  activeTab,
  onPressSessions,
  onPressExercises,
  onPressStats,
  onPressSettings,
}: TopLevelTabsProps) {
  return (
    <UiSurface accessibilityRole="tablist" style={styles.shell} testID="top-level-bottom-tabs">
      <View style={styles.tabsRow}>
        <UiButton
          accessibilityLabel="Open Sessions"
          accessibilityRole="tab"
          active={activeTab === 'sessions'}
          label="Sessions"
          onPress={onPressSessions}
          variant="tab"
        />
        <UiButton
          accessibilityLabel="Open Exercises"
          accessibilityRole="tab"
          active={activeTab === 'exercises'}
          label="Exercises"
          onPress={onPressExercises}
          variant="tab"
        />
        <UiButton
          accessibilityLabel="Open Stats"
          accessibilityRole="tab"
          active={activeTab === 'stats'}
          label="Stats"
          onPress={onPressStats}
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
