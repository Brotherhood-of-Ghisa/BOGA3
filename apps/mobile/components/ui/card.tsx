import type { ReactNode } from 'react';
import {
  Pressable,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { uiEdge } from '@/components/ui/edge';
import { makeStyles } from '@/components/ui/theme-context';
import { uiGeometry } from '@/components/ui/tokens';

type CardBaseProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

// A pressable card is one target that navigates (the session view's exercise
// cards are links), so it must say where it goes. It reads as one element, so
// a control drawn inside it is offered to VoiceOver as one of its actions.
type CardProps = CardBaseProps &
  (
    | { onPress?: undefined; accessibilityLabel?: string; accessibilityActions?: undefined; onAccessibilityAction?: undefined }
    | {
        onPress: () => void;
        accessibilityLabel: string;
        accessibilityActions?: readonly AccessibilityActionInfo[];
        onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
      }
  );

// Design-language card (`design-language.md` §4): `surface` on `paper`, the
// edge (`rule` hairline and a lift). It clips its content so a band or divider meets the
// rounded corners, and carries no padding — the content owns its insets.
export function Card({ children, style, testID, onPress, accessibilityLabel, accessibilityActions, onAccessibilityAction }: CardProps) {
  const styles = useStyles();
  if (!onPress) {
    return (
      <View accessibilityLabel={accessibilityLabel} style={[styles.card, style]} testID={testID}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityActions={accessibilityActions}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="link"
      onAccessibilityAction={onAccessibilityAction}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null, style]}
      testID={testID}>
      {children}
    </Pressable>
  );
}

const useStyles = makeStyles((roles, mode) => ({
  card: {
    overflow: 'hidden',
    ...uiEdge(roles, mode),
    borderRadius: uiGeometry.radius.card,
    backgroundColor: roles.surface,
  },
  // Pressed sinks to the page's ground.
  pressed: {
    backgroundColor: roles.paper,
  },
}));
