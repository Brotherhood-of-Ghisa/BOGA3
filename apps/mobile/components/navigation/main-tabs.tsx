import { Pressable, StyleSheet, Text, View } from 'react-native';

import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import {
  MAIN_TAB_DEFINITIONS,
  type MainTabKey,
} from '@/src/navigation/main-tabs';

type MainTabsProps = {
  activeTab: MainTabKey;
  onSelect: (tab: MainTabKey) => void;
};

/**
 * The four main tabs (M26 ownership model) in the design language: one card
 * of plain labels. The active tab is `ink` at a heavier weight over an `ink`
 * underline — navigation, not an action, so never `accent` (`ux-rules` §1.4).
 */
export function MainTabs({ activeTab, onSelect }: MainTabsProps) {
  return (
    <View accessibilityRole="tablist" style={styles.shell} testID="main-bottom-tabs">
      {MAIN_TAB_DEFINITIONS.map((tab) => {
        const active = activeTab === tab.key;
        return (
          <Pressable
            accessibilityLabel={tab.accessibilityLabel}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            key={tab.key}
            onPress={() => onSelect(tab.key)}
            style={({ pressed }) => [styles.tab, pressed && !active ? styles.pressed : null]}
            testID={tab.testID}>
            <Text allowFontScaling={false} numberOfLines={1} style={[styles.label, active ? styles.labelActive : null]}>
              {tab.label}
            </Text>
            <View
              style={[styles.indicator, active ? styles.indicatorActive : null]}
              testID={`${tab.testID}-indicator`}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flexDirection: 'row',
    overflow: 'hidden',
    borderWidth: uiBorder.width,
    borderColor: uiRoles.rule,
    borderRadius: uiGeometry.radius.card,
    backgroundColor: uiRoles.surface,
  },
  tab: {
    flex: 1,
    minHeight: uiGeometry.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    gap: uiSpace.xs,
    paddingTop: uiSpace.sm,
  },
  // Depth is a ground change, never an elevation.
  pressed: {
    backgroundColor: uiRoles.surfaceSubtle,
  },
  label: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.inkMuted,
  },
  labelActive: {
    fontWeight: '700',
    color: uiRoles.ink,
  },
  // Always laid out, so the labels do not shift when the active tab changes.
  indicator: {
    alignSelf: 'stretch',
    marginHorizontal: uiSpace.lg,
    height: uiBorder.width * 2,
    backgroundColor: 'transparent',
  },
  indicatorActive: {
    backgroundColor: uiRoles.ink,
  },
});
