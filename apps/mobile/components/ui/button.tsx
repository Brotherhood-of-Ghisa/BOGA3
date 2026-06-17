import type { ComponentProps } from 'react';
import type { AccessibilityRole } from 'react-native';
import { Pressable, StyleSheet } from 'react-native';

import { UiText, type UiTextVariant } from '@/components/ui/text';
import { uiBorder, uiColors, uiRadius, uiSpace } from '@/components/ui/tokens';

export type UiButtonVariant = 'primary' | 'secondary' | 'danger' | 'tab';

type UiButtonProps = Omit<ComponentProps<typeof Pressable>, 'style' | 'children'> & {
  label: string;
  variant?: UiButtonVariant;
  active?: boolean;
  style?: ComponentProps<typeof Pressable>['style'];
  textStyle?: ComponentProps<typeof UiText>['style'];
  textSelectable?: boolean;
  accessibilityRole?: AccessibilityRole;
};

// Semantic action primitive used by shared UI components before full-screen migration.
export function UiButton({
  label,
  variant = 'primary',
  active = false,
  disabled = false,
  style,
  textStyle,
  textSelectable = false,
  accessibilityRole = 'button',
  accessibilityState,
  ...props
}: UiButtonProps) {
  const textVariant = getTextVariant(variant, active);

  return (
    <Pressable
      {...props}
      accessibilityRole={accessibilityRole}
      accessibilityState={{
        ...accessibilityState,
        ...(accessibilityRole === 'tab' ? { selected: active } : {}),
        ...(disabled ? { disabled: true } : {}),
      }}
      disabled={disabled}
      style={(state) => {
        const { pressed } = state;

        return [
          styles.base,
          variantStyles[variant],
          variant === 'tab' && active ? styles.tabActive : null,
          disabled ? styles.disabled : null,
          pressed && !disabled ? styles.pressed : null,
          typeof style === 'function' ? style(state) : style,
        ];
      }}>
      <UiText
        adjustsFontSizeToFit
        ellipsizeMode="clip"
        minimumFontScale={0.75}
        numberOfLines={1}
        selectable={textSelectable}
        variant={textVariant}
        style={textStyle}>
        {label}
      </UiText>
    </Pressable>
  );
}

function getTextVariant(variant: UiButtonVariant, active: boolean): UiTextVariant {
  if (variant === 'tab') {
    return active ? 'tabActive' : 'tab';
  }

  if (variant === 'secondary') {
    return 'buttonSecondary';
  }

  if (variant === 'danger') {
    return 'buttonDanger';
  }

  return 'buttonPrimary';
}

const styles = StyleSheet.create({
  base: {
    borderRadius: uiRadius.sm,
    minHeight: 42,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm + 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.92,
  },
  disabled: {
    opacity: 0.6,
  },
  tabActive: {},
});

const variantStyles = StyleSheet.create({
  primary: {
    backgroundColor: uiColors.actionPrimary,
  },
  secondary: {
    borderWidth: uiBorder.width,
    borderColor: uiColors.actionNeutralSubtleBorder,
    backgroundColor: uiColors.surfaceDefault,
  },
  danger: {
    borderWidth: uiBorder.width,
    borderColor: uiColors.actionDangerSubtleBorder,
    backgroundColor: uiColors.actionDangerSubtleBg,
  },
  tab: {
    flex: 1,
    borderWidth: uiBorder.width,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfacePage,
  },
});
