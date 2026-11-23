import { Pressable } from 'react-native';
import { Touchable } from 'react-native-gesture-handler';

import { useUiGround } from '@/components/ui/ground';
import { Icon, type IconName } from '@/components/ui/icon';
import { makeStyles, useUiRoles } from '@/components/ui/theme-context';
import { uiGeometry, type UiIconSizeToken, type UiRoleToken } from '@/components/ui/tokens';

// `default`: an `ink` glyph (back, ⋮ in a top bar). `muted`: an `ink-muted`
// glyph for a control inside a card. On the page both take the page inks.
// `danger`: a destructive control. `accent`: the screen's one primary as an
// icon (an `accent` square): the session top bar's Finish tick.
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
const PAGE_GLYPH_ROLE: Record<IconButtonTone, UiRoleToken> = { ...GLYPH_ROLE, default: 'pageInk', muted: 'pageInkMuted' };

// The glyph's role on the ground the button sits on.
function glyphRole(tone: IconButtonTone, disabled: boolean, onPage: boolean): UiRoleToken {
  if (disabled && tone !== 'accent') return onPage ? 'pageInkFaint' : 'inkFaint';
  return (onPage ? PAGE_GLYPH_ROLE : GLYPH_ROLE)[tone];
}

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
  // A press sinks to the ground under the button: the page, or a card's inset.
  const onPage = useUiGround() === 'page';
  const glyph = <Icon colorRole={glyphRole(tone, disabled, onPage)} name={name} size={size} />;
  if (nativeHeader) return (
    <Touchable
      accessible accessibilityHint={accessibilityHint} accessibilityLabel={accessibilityLabel} accessibilityRole="button"
      accessibilityState={disabled ? { disabled } : undefined} disabled={disabled} hitSlop={hitSlop} onPress={onPress}
      activeOpacity={tone === 'accent' ? 0.85 : 0.7} activeUnderlayOpacity={tone === 'accent' ? 0 : 1}
      underlayColor={onPage ? roles.paper : roles.inset}
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
        pressed && !disabled ? (tone === 'accent' ? styles.accentPressed : onPage ? styles.pressed : styles.pressedOnCard) : null,
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
    backgroundColor: roles.inkFaint,
  },
  accentPressed: {
    opacity: 0.85,
  },
  // Pressed sinks to the ground under it.
  pressed: {
    backgroundColor: roles.paper,
    opacity: 0.7,
  },
  pressedOnCard: {
    backgroundColor: roles.inset,
    opacity: 0.7,
  },
}));
