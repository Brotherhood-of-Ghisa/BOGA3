import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { uiText, uiTextTone } from '@/components/ui/text-roles';
import { uiBorder, uiGeometry, uiRoles, uiSpace } from '@/components/ui/tokens';
import {
  MAIN_TAB_DEFINITIONS,
  type MainTabDefinition,
  type MainTabKey,
} from '@/src/navigation/main-tabs';

type MainTabsProps = {
  activeTab: MainTabKey;
  onSelect: (tab: MainTabKey) => void;
};

const LABEL_TABS = MAIN_TAB_DEFINITIONS.filter((tab) => tab.presentation === 'label');
const OVERFLOW_TABS = MAIN_TAB_DEFINITIONS.filter((tab) => tab.presentation === 'overflow');

/**
 * The main tabs in the design language: one card of micro-labels, and More as
 * a ⋮ to its right. The others stay muted; the active tab is `ink` over an
 * `ink` underline — navigation, not an action, so never `accent`
 * (`ux-rules.md` "Actions and emphasis").
 */
export function MainTabs({ activeTab, onSelect }: MainTabsProps) {
  const tabProps = (tab: MainTabDefinition) => {
    const active = activeTab === tab.key;
    return {
      active,
      pressable: {
        accessibilityLabel: tab.accessibilityLabel,
        accessibilityRole: 'tab' as const,
        accessibilityState: { selected: active },
        onPress: () => onSelect(tab.key),
        testID: tab.testID,
      },
      indicator: (
        <View
          style={[
            styles.indicator,
            tab.presentation === 'overflow' ? styles.indicatorOverflow : null,
            active ? styles.indicatorActive : null,
          ]}
          testID={`${tab.testID}-indicator`}
        />
      ),
    };
  };

  return (
    <View accessibilityRole="tablist" style={styles.row} testID="main-bottom-tabs">
      <View style={styles.shell}>
        {LABEL_TABS.map((tab) => {
          const { active, pressable, indicator } = tabProps(tab);
          return (
            <Pressable
              {...pressable}
              key={tab.key}
              style={({ pressed }) => [styles.tab, pressed && !active ? styles.pressed : null]}>
              <Text allowFontScaling={false} numberOfLines={1} style={[uiText.label, active ? uiTextTone.ink : null]}>
                {tab.label}
              </Text>
              {indicator}
            </Pressable>
          );
        })}
      </View>
      {OVERFLOW_TABS.map((tab) => {
        const { active, pressable, indicator } = tabProps(tab);
        return (
          <Pressable
            {...pressable}
            key={tab.key}
            style={({ pressed }) => [styles.overflow, pressed && !active ? styles.overflowPressed : null]}>
            <Icon color={active ? uiRoles.ink : uiRoles.inkMuted} name="more-vertical" />
            {indicator}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: uiSpace.xs,
  },
  shell: {
    flex: 1,
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
  // Off the card, on the bar's `paper`: a bare glyph in one tap target.
  overflow: {
    width: uiGeometry.tapTarget,
    minHeight: uiGeometry.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    gap: uiSpace.xs,
    paddingTop: uiSpace.sm,
    borderRadius: uiGeometry.radius.card,
  },
  // Depth is a ground change, never an elevation.
  pressed: {
    backgroundColor: uiRoles.paper,
  },
  overflowPressed: {
    backgroundColor: uiRoles.surface,
  },
  // Always laid out, so the labels do not shift when the active tab changes.
  indicator: {
    alignSelf: 'stretch',
    marginHorizontal: uiSpace.lg,
    height: uiBorder.width * 2,
    backgroundColor: 'transparent',
  },
  // The ⋮ is one tap target wide: a narrower inset keeps its underline legible.
  indicatorOverflow: {
    marginHorizontal: uiSpace.sm,
  },
  indicatorActive: {
    backgroundColor: uiRoles.ink,
  },
});
