import { Pressable } from 'react-native';
import { Touchable } from 'react-native-gesture-handler';

import { Icon, type IconName } from '@/components/ui/icon';
import { makeStyles, useUiRoles } from '@/components/ui/theme-context';
import { uiGeometry, type UiIconSizeToken, type UiRoleToken } from '@/components/ui/tokens';

// `default`: an `ink` glyph (back, ⋮ in a top bar). `muted`: an `ink-muted`
// glyph for a control inside a card. `danger`: a destructive control.
// `accent`: the screen's one primary as an icon (an `accent` square): the
// session top bar's Finish tick.
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
  /** Use a native control inside UIKit headers, which otherwise also scroll on tap. */
  nativeHeader?: boolean;
};

const GLYPH_ROLE: Record<IconButtonTone, UiRoleToken> = {
  default: 'ink',
  muted: 'inkMuted',
  danger: 'danger',
  accent: 'onAccent',
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
  nativeHeader = false,
}: IconButtonProps) {
  const styles = useStyles();
  const roles = useUiRoles();
  const glyph = <Icon colorRole={disabled && tone !== 'accent' ? 'inkGhost' : GLYPH_ROLE[tone]} name={name} size={size} />;
  if (nativeHeader) return (
    <Touchable
      accessible accessibilityHint={accessibilityHint} accessibilityLabel={accessibilityLabel} accessibilityRole="button"
      accessibilityState={disabled ? { disabled } : undefined} disabled={disabled} hitSlop={hitSlop} onPress={onPress}
      activeOpacity={tone === 'accent' ? 0.85 : 0.7} activeUnderlayOpacity={tone === 'accent' ? 0 : 1}
      underlayColor={roles.paper}
      style={[styles.control, tone === 'accent' ? (disabled ? styles.accentDisabled : styles.accent) : null]}
      testID={testID}>
      {glyph}
    </Touchable>
  );
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
      {glyph}
    </Pressable>
  );
}

const useStyles = makeStyles((roles) => ({
  control: {
    width: uiGeometry.tapTarget,
    height: uiGeometry.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: uiGeometry.radius.control,
  },
  accent: {
    backgroundColor: roles.accent,
  },
  accentDisabled: {
    backgroundColor: roles.inkGhost,
  },
  accentPressed: {
    opacity: 0.85,
  },
  // Depth is a ground change, never an elevation.
  pressed: {
    backgroundColor: roles.paper,
    opacity: 0.7,
  },
}));
