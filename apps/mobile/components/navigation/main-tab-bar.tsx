import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MainTabs } from '@/components/navigation/main-tabs';
import { uiRoles, uiSpace } from '@/components/ui/tokens';
import type { MainTabKey } from '@/src/navigation/main-tabs';

type MainTabBarProps = {
  activeTab: MainTabKey;
  onSelect: (tab: MainTabKey) => void;
};

/**
 * The one bottom bar: `MainTabs` on the `paper` ground with the page gutter,
 * above the home indicator. Every screen that shows the main tabs (the tab
 * screens, the session view, exercise history) draws this, so moving between
 * them never changes the bar.
 */
export function MainTabBar({ activeTab, onSelect }: MainTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(uiSpace.sm, insets.bottom) }]} testID="main-tab-bar">
      <MainTabs activeTab={activeTab} onSelect={onSelect} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: uiSpace.lg,
    paddingTop: uiSpace.sm,
    backgroundColor: uiRoles.paper,
  },
});
