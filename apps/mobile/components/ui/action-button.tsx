import { Pressable, StyleSheet, Text } from 'react-native';

import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

export type ActionButtonVariant = 'primary' | 'outline' | 'text';
export type ActionButtonTone = 'default' | 'danger';

export type ActionButtonProps = {
  label: string;
  onPress: () => void;
  // `primary`: the screen's one `accent` action (Finish, Edit, Save). `outline`:
  // a secondary action (`+ Add exercise`, Retry). `text`: a plain caps label
  // (Cancel, Archive, Show archived).
  variant: ActionButtonVariant;
  // `danger` recolours an outline or text button; a primary is never danger.
  tone?: ActionButtonTone;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
};

// A design-language button (`design-language.md` §5): one `accent` primary per
// screen, outlines and caps text for everything else. Control radius, 44pt
// tall, Archivo caps label.
export function ActionButton({
  label,
  onPress,
  variant,
  tone = 'default',
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ActionButtonProps) {
  const danger = tone === 'danger' && variant !== 'primary';
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' ? styles.primary : null,
        variant === 'outline' ? [styles.outline, danger ? styles.outlineDanger : null] : null,
        disabled && variant === 'primary' ? styles.primaryDisabled : null,
        disabled && variant === 'outline' ? styles.outlineDisabled : null,
        pressed && !disabled ? (variant === 'primary' ? styles.primaryPressed : styles.pressed) : null,
      ]}
      testID={testID}>
      <Text
        style={[
          styles.label,
          variant === 'primary' ? styles.labelPrimary : null,
          danger ? styles.labelDanger : null,
          disabled && variant !== 'primary' ? styles.labelDisabled : null,
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: uiGeometry.tapTarget,
    paddingHorizontal: uiSpace.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: uiGeometry.radius.control,
  },
  primary: {
    backgroundColor: uiRoles.accent,
  },
  primaryDisabled: {
    backgroundColor: uiRoles.disabled,
  },
  primaryPressed: {
    opacity: 0.85,
  },
  // The accepted session view draws `+ Add exercise` in an ink outline.
  outline: {
    borderWidth: uiBorder.width,
    borderColor: uiRoles.ink,
    backgroundColor: uiRoles.surface,
  },
  outlineDanger: {
    borderColor: uiRoles.danger,
  },
  outlineDisabled: {
    borderColor: uiRoles.disabled,
  },
  // Depth is a ground change, never an elevation.
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
  labelPrimary: {
    color: uiRoles.surface,
  },
  labelDanger: {
    color: uiRoles.danger,
  },
  labelDisabled: {
    color: uiRoles.disabled,
  },
});
