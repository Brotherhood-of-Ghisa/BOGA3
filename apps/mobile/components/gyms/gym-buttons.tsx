import { Pressable, StyleSheet, Text } from 'react-native';

import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

type GymButtonProps = {
  label: string;
  onPress: () => void;
  // `primary`: the one `accent` action (Save / Add). `outline`: a secondary
  // action. `text`: a plain caps label (Cancel, Archive, Show archived).
  variant: 'primary' | 'outline' | 'text';
  tone?: 'default' | 'danger';
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
};

// The Gyms screen's buttons, in the design language: one `accent` primary,
// outlines and caps text for everything else (`design-language.md` §5).
export function GymButton({
  label,
  onPress,
  variant,
  tone = 'default',
  disabled = false,
  accessibilityLabel,
  testID,
}: GymButtonProps) {
  const danger = tone === 'danger';
  return (
    <Pressable
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
  outline: {
    borderWidth: uiBorder.width,
    borderColor: uiRoles.ruleStrong,
    backgroundColor: uiRoles.surface,
  },
  outlineDanger: {
    borderColor: uiRoles.danger,
  },
  pressed: {
    backgroundColor: uiRoles.surfaceSubtle,
  },
  label: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs,
    letterSpacing: uiTypography.size.xs * uiGeometry.microLabelTracking,
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
