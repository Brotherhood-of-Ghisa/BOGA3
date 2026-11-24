import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { uiHairline, uiLift } from '@/components/ui/edge';
import { OnCard } from '@/components/ui/ground';
import { makeStyles } from '@/components/ui/theme-context';

type CardBaseProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  embedded?: boolean;
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

// What places a pressable card among its siblings. The rest of a caller's style
// (padding, gap, direction) lays out the card's own content.
const PLACEMENT_KEYS = new Set([
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf', 'position', 'top', 'right', 'bottom', 'left', 'start', 'end',
  'zIndex', 'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'aspectRatio', 'opacity', 'transform', 'display',
]);

function splitPlacement(style: StyleProp<ViewStyle>): { placement: ViewStyle; content: ViewStyle } {
  const placement: Record<string, unknown> = {};
  const content: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(StyleSheet.flatten(style) ?? {})) {
    (PLACEMENT_KEYS.has(key) || key.startsWith('margin') ? placement : content)[key] = value;
  }
  return { placement, content };
}

// Design-language card (`design-language.md` §4): `surface` on `paper`, the
// edge (`rule` hairline and a lift). It clips its content so a band or divider meets the
// rounded corners, and carries no padding — the content owns its insets.
//
// A pressable card is an accessibility element that clips, so its lift sits on a
// plain view around it: on one view, iOS hides the children's testIDs from the
// accessibility tree.
export function Card({ children, style, testID, onPress, accessibilityLabel, accessibilityActions, onAccessibilityAction, embedded = false }: CardProps) {
  const styles = useStyles();
  const surface = embedded ? styles.embedded : styles.card;
  const lift = embedded ? null : styles.lift;
  if (!onPress) {
    return (
      <View accessibilityLabel={accessibilityLabel} style={[surface, lift, style]} testID={testID}>
        <OnCard>{children}</OnCard>
      </View>
    );
  }

  const { placement, content } = splitPlacement(style);
  return (
    <View style={[lift, placement]}>
      <Pressable
        accessibilityActions={accessibilityActions}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="link"
        onAccessibilityAction={onAccessibilityAction}
        onPress={onPress}
        style={({ pressed }) => [surface, styles.fill, pressed ? styles.pressed : null, content]}
        testID={testID}>
        <OnCard>{children}</OnCard>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((roles, mode) => ({
  card: {
    overflow: 'hidden',
    ...uiHairline(roles, { shape: 'card' }),
    backgroundColor: roles.surface,
  },
  lift: uiLift(roles, mode, { shape: 'card' }),
  fill: { flexGrow: 1 },
  embedded: { overflow: 'hidden' },
  // Pressed sinks to the inset: a step below the card, inside it.
  pressed: {
    backgroundColor: roles.inset,
  },
}));
