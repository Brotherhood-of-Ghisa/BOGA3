import { Pressable, Text } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { makeStyles, useUiRoles } from '@/components/ui/theme-context';
import { uiBorder, uiGeometry, uiSpace, uiTypography } from '@/components/ui/tokens';

export type ActionButtonVariant = 'primary' | 'outline' | 'text' | 'link';
export type ActionButtonTone = 'default' | 'danger';
// `compact`: a 28-tall outline inside a list row (a group record's Certify),
// its tap target kept at 44 by hit slop.
export type ActionButtonSize = 'regular' | 'compact' | 'large';

export type ActionButtonProps = {
  label: string;
  onPress: () => void;
  // `primary`: the screen's one `accent` action (Finish, Edit, Save). `outline`:
  // a secondary action (`+ Add exercise`, Retry). `text`: a plain caps label
  // (Cancel, Archive, Show archived). `link`: a heading's way into a fuller
  // screen (a card's `Sessions`), drawn as its heading's micro-label, muted,
  // with a chevron, so it never outweighs the title beside it.
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
  const styles = useStyles();
  const roles = useUiRoles();
  const textRoles = useUiText();
  const textTones = useUiTextTone();
  const danger = tone === 'danger' && variant !== 'primary';
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={checked === undefined ? { disabled } : { disabled, checked }}
      disabled={disabled}
      hitSlop={size === 'compact' || variant === 'link' ? COMPACT_HIT_SLOP : undefined}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        size === 'compact' ? styles.compact : null,
        size === 'large' ? styles.large : null,
        variant === 'link' ? styles.link : null,
        variant === 'primary' ? styles.primary : null,
        variant === 'outline' ? [styles.outline, danger ? styles.outlineDanger : null] : null,
        disabled && variant === 'primary' ? styles.primaryDisabled : null,
        disabled && variant === 'outline' ? styles.outlineDisabled : null,
        pressed && !disabled ? (variant === 'primary' ? styles.primaryPressed : styles.pressed) : null,
      ]}
      testID={testID}>
      <Text
        allowFontScaling={false}
        style={variant === 'link' ? [textRoles.label, disabled ? styles.labelDisabled : null] : [
          textRoles.button,
          size === 'compact' ? [textRoles.label, textTones.ink] : null,
          size === 'large' ? styles.labelLarge : null,
          variant === 'primary' ? styles.labelPrimary : null,
          danger ? styles.labelDanger : null,
          disabled && variant !== 'primary' ? styles.labelDisabled : null,
        ]}>
        {label}
      </Text>
      {variant === 'link' ? <Icon color={disabled ? roles.inkGhost : roles.inkMuted} name="chevron-right" size="xs" /> : null}
    </Pressable>
  );
}

const COMPACT_HIT_SLOP = (uiGeometry.tapTarget - uiGeometry.compactControlHeight) / 2;

const useStyles = makeStyles((roles) => ({
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
  large: { minHeight: uiGeometry.tapTarget + uiSpace.xl },
  // Compact height, its tap target kept at 44 by hit slop; the chevron follows the label.
  link: {
    minHeight: uiGeometry.compactControlHeight,
    paddingHorizontal: uiSpace.sm,
    flexDirection: 'row',
    gap: uiSpace.xs,
  },
  primary: {
    backgroundColor: roles.accent,
  },
  primaryDisabled: {
    backgroundColor: roles.inkGhost,
  },
  primaryPressed: {
    opacity: 0.85,
  },
  // A hairline in `rule`, as a card's edge: the ink label carries the action,
  // so the outline never outweighs the text it frames.
  outline: {
    borderWidth: uiBorder.width,
    borderColor: roles.rule,
    backgroundColor: roles.surface,
  },
  outlineDanger: {
    borderColor: roles.danger,
  },
  // Fainter than an enabled outline, so a disabled one never reads stronger.
  outlineDisabled: {
    borderColor: roles.ruleSoft,
  },
  // Depth is a ground change, never an elevation.
  pressed: {
    backgroundColor: roles.paper,
    opacity: 0.7,
  },
  // The full-screen repeating timer's controls: display art, so off the roles
  // (`design-language.md` §3).
  labelLarge: { fontSize: uiTypography.size.xxl, lineHeight: uiTypography.lineHeight.xxl },
  labelPrimary: {
    color: roles.onAccent,
  },
  labelDanger: {
    color: roles.danger,
  },
  labelDisabled: {
    color: roles.inkGhost,
  },
}));
