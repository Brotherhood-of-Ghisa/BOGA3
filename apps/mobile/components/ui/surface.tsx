import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { uiBorder, uiColors, uiRadius } from '@/components/ui/tokens';

export type UiSurfaceVariant = 'card' | 'panelMuted';

type UiSurfaceProps = ComponentProps<typeof View> & {
  variant?: UiSurfaceVariant;
};

// Base bordered surface primitive for cards/panels that recur across screens.
export function UiSurface({ variant = 'card', style, ...props }: UiSurfaceProps) {
  return <View {...props} style={[styles.base, variantStyles[variant], style]} />;
}

const styles = StyleSheet.create({
  base: {
    borderWidth: uiBorder.width,
  },
});

const variantStyles = StyleSheet.create({
  card: {
    borderColor: uiColors.borderDefault,
    borderRadius: uiRadius.md,
    backgroundColor: uiColors.surfaceDefault,
  },
  panelMuted: {
    borderColor: uiColors.borderDefault,
    borderRadius: uiRadius.md,
    backgroundColor: uiColors.surfaceMuted,
  },
});
