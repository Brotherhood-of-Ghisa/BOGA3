import type { ComponentProps } from 'react';
import { StyleSheet, Text } from 'react-native';

import { uiColors, uiTypography } from '@/components/ui/tokens';

export type UiTextVariant =
  | 'body'
  | 'bodyMuted'
  | 'label'
  | 'labelStrong'
  | 'title'
  | 'subtitle'
  | 'button'
  | 'buttonPrimary'
  | 'buttonSecondary'
  | 'buttonDanger'
  | 'tab'
  | 'tabActive';

type UiTextProps = ComponentProps<typeof Text> & {
  variant?: UiTextVariant;
};

export function UiText({ variant = 'body', style, ...props }: UiTextProps) {
  return <Text {...props} style={[styles.base, variantStyles[variant], style]} />;
}

const styles = StyleSheet.create({
  base: {
    color: uiColors.textPrimary,
  },
});

const variantStyles = StyleSheet.create({
  body: {
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiColors.textPrimary,
  },
  bodyMuted: {
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiColors.textMuted,
  },
  label: {
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    fontWeight: uiTypography.weight.semibold,
    color: uiColors.textPrimary,
  },
  labelStrong: {
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    fontWeight: uiTypography.weight.bold,
    color: uiColors.textPrimary,
  },
  title: {
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    fontWeight: uiTypography.weight.bold,
    color: uiColors.textPrimary,
  },
  subtitle: {
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    fontWeight: uiTypography.weight.semibold,
    color: uiColors.textSecondary,
  },
  button: {
    fontSize: uiTypography.size.base,
    fontWeight: uiTypography.weight.bold,
    color: uiColors.textPrimary,
  },
  buttonPrimary: {
    fontSize: uiTypography.size.md,
    fontWeight: uiTypography.weight.bold,
    color: uiColors.surfaceDefault,
  },
  buttonSecondary: {
    fontSize: uiTypography.size.md,
    fontWeight: uiTypography.weight.semibold,
    color: uiColors.actionNeutralSubtleText,
  },
  buttonDanger: {
    fontSize: uiTypography.size.md,
    fontWeight: uiTypography.weight.bold,
    color: uiColors.actionDangerText,
  },
  tab: {
    fontSize: uiTypography.size.md,
    fontWeight: uiTypography.weight.semibold,
    color: uiColors.actionNeutralSubtleText,
  },
  tabActive: {
    fontSize: uiTypography.size.md,
    fontWeight: uiTypography.weight.bold,
    color: uiColors.actionPrimary,
  },
});
