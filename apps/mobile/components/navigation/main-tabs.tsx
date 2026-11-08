import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { makeStyles } from '@/components/ui/theme-context';
import { uiBorder, uiGeometry, uiSpace } from '@/components/ui/tokens';
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
 * The main tabs in the design language: one card of micro-labels, with More as
 * a ⋮ at its right edge, inside the card. The others stay muted; the active
 * tab is `ink` over an `ink` underline — navigation, not an action, so never
 * `accent` (`ux-rules.md` "Actions and emphasis").
 */
export function MainTabs({ activeTab, onSelect }: MainTabsProps) {
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
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
    <View accessibilityRole="tablist" style={styles.shell} testID="main-bottom-tabs">
      {LABEL_TABS.map((tab) => {
        const { active, pressable, indicator } = tabProps(tab);
        return (
          <Pressable
            {...pressable}
            key={tab.key}
            style={({ pressed }) => [styles.tab, pressed && !active ? styles.pressed : null]}>
            <Text allowFontScaling={false} numberOfLines={1} style={[text.label, active ? tone.ink : null]}>
              {tab.label}
            </Text>
            {indicator}
          </Pressable>
        );
      })}
      {OVERFLOW_TABS.map((tab) => {
        const { active, pressable, indicator } = tabProps(tab);
        return (
          <Pressable
            {...pressable}
            key={tab.key}
            style={({ pressed }) => [styles.overflow, pressed && !active ? styles.pressed : null]}>
            <Icon colorRole={active ? 'ink' : 'inkMuted'} name="more-vertical" />
            {indicator}
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((roles) => ({
  shell: {
    flexDirection: 'row',
    overflow: 'hidden',
    borderWidth: uiBorder.width,
    borderColor: roles.rule,
    borderRadius: uiGeometry.radius.card,
    backgroundColor: roles.surface,
  },
  tab: {
    flex: 1,
    minHeight: uiGeometry.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    gap: uiSpace.xs,
    paddingTop: uiSpace.sm,
  },
  // Inside the card, at its right edge: a bare glyph in one tap target.
  overflow: {
    width: uiGeometry.tapTarget,
    minHeight: uiGeometry.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    gap: uiSpace.xs,
    paddingTop: uiSpace.sm,
  },
  // Depth is a ground change, never an elevation.
  pressed: {
    backgroundColor: roles.paper,
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
    backgroundColor: roles.ink,
  },
}));
