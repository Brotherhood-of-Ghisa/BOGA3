import { StyleSheet, View } from 'react-native';

import { UiButton, UiSurface, uiColors, uiRadius, uiSpace, uiTypography } from '@/components/ui';
import {
  MAIN_TAB_DEFINITIONS,
  type MainTabKey,
} from '@/src/navigation/main-tabs';

type MainTabsProps = {
  activeTab: MainTabKey;
  onSelect: (tab: MainTabKey) => void;
};

/** Production four-tab presentation for the M26 ownership model. */
export function MainTabs({ activeTab, onSelect }: MainTabsProps) {
  return (
    <UiSurface accessibilityRole="tablist" style={styles.shell} testID="main-bottom-tabs">
      <View style={styles.tabsRow}>
        {MAIN_TAB_DEFINITIONS.map((tab) => (
          <UiButton
            accessibilityLabel={tab.accessibilityLabel}
            accessibilityRole="tab"
            active={activeTab === tab.key}
            key={tab.key}
            label={tab.label}
            onPress={() => onSelect(tab.key)}
            style={styles.tabButton}
            testID={tab.testID}
            textStyle={styles.tabLabel}
            variant="tab"
          />
        ))}
      </View>
    </UiSurface>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderColor: uiColors.borderMuted,
    borderRadius: uiRadius.xl,
    backgroundColor: uiColors.surfaceDefault,
    padding: uiSpace.sm,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: uiSpace.xs,
  },
  tabButton: {
    flex: 1,
    paddingHorizontal: uiSpace.xxs,
  },
  tabLabel: {
    alignSelf: 'stretch',
    textAlign: 'center',
    fontSize: uiTypography.size.sm,
  },
});
