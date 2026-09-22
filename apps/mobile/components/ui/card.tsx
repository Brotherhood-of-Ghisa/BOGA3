import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { uiBorder, uiGeometry, uiRoles } from '@/components/ui/tokens';

type CardBaseProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

// A pressable card is one target that navigates (the session view's exercise
// cards are links), so it must say where it goes.
type CardProps = CardBaseProps &
  (
    | { onPress?: undefined; accessibilityLabel?: string }
    | { onPress: () => void; accessibilityLabel: string }
  );

// Design-language card (`design-language.md` §4): `surface` on `paper`, 1px
// `rule`, no shadow. It clips its content so a band or divider meets the
// rounded corners, and carries no padding — the content owns its insets.
export function Card({ children, style, testID, onPress, accessibilityLabel }: CardProps) {
  if (!onPress) {
    return (
      <View accessibilityLabel={accessibilityLabel} style={[styles.card, style]} testID={testID}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null, style]}
      testID={testID}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    borderWidth: uiBorder.width,
    borderColor: uiRoles.rule,
    borderRadius: uiGeometry.radius.card,
    backgroundColor: uiRoles.surface,
  },
  // Depth is a ground change, never an elevation.
  pressed: {
    backgroundColor: uiRoles.surfaceSubtle,
  },
});
