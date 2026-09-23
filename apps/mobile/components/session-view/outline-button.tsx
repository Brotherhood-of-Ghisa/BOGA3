import { Pressable, StyleSheet, Text } from 'react-native';

import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

type OutlineButtonProps = {
  label: string;
  onPress: () => void;
  testID?: string;
};

// A secondary action on a design-language screen (`+ Add exercise`): an ink
// outline, never the screen's one `accent` primary.
export function OutlineButton({ label, onPress, testID }: OutlineButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
      testID={testID}>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: uiGeometry.tapTarget,
    paddingHorizontal: uiSpace.md,
    borderWidth: uiBorder.width,
    borderColor: uiRoles.ink,
    borderRadius: uiGeometry.radius.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    backgroundColor: uiRoles.surfaceSubtle,
  },
  label: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    letterSpacing: uiTypography.size.sm * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.ink,
  },
});
