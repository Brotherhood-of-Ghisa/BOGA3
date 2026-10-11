import { Pressable, StyleSheet, Text } from 'react-native';

import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

export type ActionButtonVariant = 'primary' | 'outline' | 'text';
export type ActionButtonTone = 'default' | 'danger';
// `compact`: a 28-tall outline inside a list row (a group record's Certify),
// its tap target kept at 44 by hit slop.
export type ActionButtonSize = 'regular' | 'compact';

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
  size?: ActionButtonSize;
  // A text button that toggles a view on and off (Sessions' `Show deleted`):
  // announced as checked, so the state never rides the label alone.
  checked?: boolean;
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
  size = 'regular',
  checked,
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
      accessibilityState={checked === undefined ? { disabled } : { disabled, checked }}
      disabled={disabled}
      hitSlop={size === 'compact' ? COMPACT_HIT_SLOP : undefined}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        size === 'compact' ? styles.compact : null,
        variant === 'primary' ? styles.primary : null,
        variant === 'outline' ? [styles.outline, danger ? styles.outlineDanger : null] : null,
        disabled && variant === 'primary' ? styles.primaryDisabled : null,
        disabled && variant === 'outline' ? styles.outlineDisabled : null,
        pressed && !disabled ? (variant === 'primary' ? styles.primaryPressed : styles.pressed) : null,
      ]}
      testID={testID}>
      <Text
        allowFontScaling={false}
        style={[
          styles.label,
          size === 'compact' ? styles.labelCompact : null,
          variant === 'primary' ? styles.labelPrimary : null,
          danger ? styles.labelDanger : null,
          disabled && variant !== 'primary' ? styles.labelDisabled : null,
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

const COMPACT_HIT_SLOP = (uiGeometry.tapTarget - uiGeometry.compactControlHeight) / 2;

const styles = StyleSheet.create({
  base: {
    minHeight: uiGeometry.tapTarget,
    paddingHorizontal: uiSpace.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: uiGeometry.radius.control,
  },
  compact: {
    minHeight: uiGeometry.compactControlHeight,
    paddingHorizontal: uiSpace.sm,
  },
  primary: {
    backgroundColor: uiRoles.accent,
  },
  primaryDisabled: {
    backgroundColor: uiRoles.inkGhost,
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
    borderColor: uiRoles.inkGhost,
  },
  // Depth is a ground change, never an elevation.
  pressed: {
    backgroundColor: uiRoles.paper,
    opacity: 0.7,
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
  labelCompact: {
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
  },
  labelPrimary: {
    color: uiRoles.surface,
  },
  labelDanger: {
    color: uiRoles.danger,
  },
  labelDisabled: {
    color: uiRoles.inkGhost,
  },
});
