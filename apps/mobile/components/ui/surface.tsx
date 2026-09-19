import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { uiBorder, uiColors, uiElevation, uiRadius, type UiElevationToken } from '@/components/ui/tokens';

export type UiSurfaceVariant = 'card' | 'panelMuted';

type UiSurfaceProps = ComponentProps<typeof View> & {
  variant?: UiSurfaceVariant;
  // Opt-in layering. `flat` is the default and renders exactly as before;
  // `raised` is for cards that should sit above the page, `overlay` for
  // sheets and modals that sit above everything.
  elevation?: UiElevationToken;
};

// Base bordered surface primitive for cards/panels that recur across screens.
export function UiSurface({
  variant = 'card',
  elevation = 'flat',
  style,
  ...props
}: UiSurfaceProps) {
  return (
    <View {...props} style={[styles.base, variantStyles[variant], uiElevation[elevation], style]} />
  );
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
