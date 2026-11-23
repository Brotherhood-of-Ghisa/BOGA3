import { Pressable, Text } from 'react-native';

import { uiEdge } from '@/components/ui/edge';
import { useUiGround } from '@/components/ui/ground';
import { Icon } from '@/components/ui/icon';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import type { UiRoles } from '@/components/ui/theme';
import { makeStyles, useUiRoles } from '@/components/ui/theme-context';
import { uiGeometry, uiSpace, uiTypography } from '@/components/ui/tokens';

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
  // A text or link button has no ground of its own: on the page it takes the
  // page inks, and a press keeps the page's ground.
  const ground = useUiGround();
  const inks = groundInks((variant === 'text' || variant === 'link') && ground === 'page', { roles, styles, textTones });
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
        pressed && !disabled ? (variant === 'primary' ? styles.primaryPressed : inks.pressed) : null,
      ]}
      testID={testID}>
      <Text
        allowFontScaling={false}
        style={variant === 'link' ? [textRoles.label, inks.link, disabled ? inks.disabled : null] : [
          textRoles.button,
          size === 'compact' ? [textRoles.label, textTones.ink] : null,
          inks.button,
          size === 'large' ? styles.labelLarge : null,
          variant === 'primary' ? styles.labelPrimary : null,
          danger ? styles.labelDanger : null,
          disabled && variant !== 'primary' ? inks.disabled : null,
        ]}>
        {label}
      </Text>
      {variant === 'link' ? <Icon color={disabled ? inks.chevronDisabled : inks.chevron} name="chevron-right" size="xs" /> : null}
    </Pressable>
  );
}

const COMPACT_HIT_SLOP = (uiGeometry.tapTarget - uiGeometry.compactControlHeight) / 2;

type GroundInputs = {
  roles: UiRoles;
  styles: ReturnType<typeof useStyles>;
  textTones: ReturnType<typeof useUiTextTone>;
};

// What a label, chevron and press draw in: the page inks and the page's ground
// for a text or link button on the page, else the card's.
function groundInks(onPage: boolean, { roles, styles, textTones }: GroundInputs) {
  return onPage
    ? {
        button: textTones.page,
        link: textTones.pageMuted,
        disabled: styles.labelDisabledOnPage,
        chevron: roles.pageInkMuted,
        chevronDisabled: roles.pageInkFaint,
        pressed: styles.pressedOnPage,
      }
    : { button: null, link: null, disabled: styles.labelDisabled, chevron: roles.inkMuted, chevronDisabled: roles.inkFaint, pressed: styles.pressed };
}

const useStyles = makeStyles((roles, mode) => ({
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
    backgroundColor: roles.inkFaint,
  },
  primaryPressed: {
    opacity: 0.85,
  },
  // A card's edge: the ink label carries the action, so the outline never
  // outweighs the text it frames.
  outline: {
    ...uiEdge(roles, mode),
    backgroundColor: roles.surface,
  },
  outlineDanger: {
    borderColor: roles.danger,
  },
  // Fainter than an enabled outline, so a disabled one never reads stronger.
  outlineDisabled: {
    borderColor: roles.ruleSoft,
  },
  // Pressed sinks to the well: the button's own inks still read on it.
  pressed: {
    backgroundColor: roles.well,
    opacity: 0.7,
  },
  pressedOnPage: {
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
    color: roles.inkFaint,
  },
  labelDisabledOnPage: {
    color: roles.pageInkFaint,
  },
}));
