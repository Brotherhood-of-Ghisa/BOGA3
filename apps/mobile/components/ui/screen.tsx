import type { ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { uiRoles, uiSpace } from '@/components/ui/tokens';

type ScreenProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

// A screen's ground: `paper`, filling the route (`design-language.md` §2, §4).
export function Screen({ children, style, testID }: ScreenProps) {
  return (
    <View style={[styles.screen, style]} testID={testID}>
      {children}
    </View>
  );
}

// `lg` (16) is the page gutter. `md` (12) is for a screen that wants its page
// and its cards' content on one rhythm (the exercise page).
export type ScreenGutter = 'md' | 'lg';

type ScreenScrollProps = Omit<ScrollViewProps, 'style' | 'contentContainerStyle'> & {
  children: ReactNode;
  gutter?: ScreenGutter;
  // Extra content-container style, e.g. room at the bottom for a footer.
  contentContainerStyle?: StyleProp<ViewStyle>;
};

// The scrolling body of a screen, on the `paper` ground (so it can also be the
// route's root): the page gutter around its content, and the `md` gap between
// cards. Other `ScrollView` props (refresh, keyboard insets) pass through.
export function ScreenScroll({ children, gutter = 'lg', contentContainerStyle, ...scrollProps }: ScreenScrollProps) {
  return (
    <ScrollView
      {...scrollProps}
      contentContainerStyle={[styles.content, { padding: uiSpace[gutter] }, contentContainerStyle]}
      style={styles.scroll}>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: uiRoles.paper,
  },
  scroll: {
    flex: 1,
    backgroundColor: uiRoles.paper,
  },
  content: {
    gap: uiSpace.md,
  },
});
