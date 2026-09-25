import { Pressable, StyleSheet } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import { uiGeometry, uiRoles, type UiIconSizeToken } from '@/components/ui/tokens';

// `default`: an `ink` glyph (back, ⋮ in a top bar). `muted`: an `ink-muted`
// glyph for a control inside a card. `danger`: a destructive control.
// `accent`: the screen's one primary as an icon (an `accent` square), used only
// where a text button does not fit.
export type IconButtonTone = 'default' | 'muted' | 'danger' | 'accent';

export type IconButtonProps = {
  name: IconName;
  // Required: the glyph is decoration, so the control must say what it does.
  accessibilityLabel: string;
  onPress: () => void;
  tone?: IconButtonTone;
  size?: UiIconSizeToken;
  disabled?: boolean;
  hitSlop?: number;
  accessibilityHint?: string;
  testID?: string;
};

const GLYPH_COLOR: Record<IconButtonTone, string> = {
  default: uiRoles.ink,
  muted: uiRoles.inkMuted,
  danger: uiRoles.danger,
  accent: uiRoles.surface,
};

// A 44pt icon-only control (`design-language.md` §4): every top bar's back and
// ⋮, a card's ⋮. The glyph sits centred in one tap target so controls share a
// vertical axis.
export function IconButton({
  name,
  accessibilityLabel,
  onPress,
  tone = 'default',
  size = 'md',
  disabled = false,
  hitSlop,
  accessibilityHint,
  testID,
}: IconButtonProps) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={disabled ? { disabled } : undefined}
      disabled={disabled}
      hitSlop={hitSlop}
      onPress={onPress}
      style={({ pressed }) => [
        styles.control,
        tone === 'accent' ? (disabled ? styles.accentDisabled : styles.accent) : null,
        pressed && !disabled ? (tone === 'accent' ? styles.accentPressed : styles.pressed) : null,
      ]}
      testID={testID}>
      <Icon
        color={disabled && tone !== 'accent' ? uiRoles.disabled : GLYPH_COLOR[tone]}
        name={name}
        size={size}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  control: {
    width: uiGeometry.tapTarget,
    height: uiGeometry.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: uiGeometry.radius.control,
  },
  accent: {
    backgroundColor: uiRoles.accent,
  },
  accentDisabled: {
    backgroundColor: uiRoles.disabled,
  },
  accentPressed: {
    opacity: 0.85,
  },
  // Depth is a ground change, never an elevation.
  pressed: {
    backgroundColor: uiRoles.surfaceSubtle,
  },
});
