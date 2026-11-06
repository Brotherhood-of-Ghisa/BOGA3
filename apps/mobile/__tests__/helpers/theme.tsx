import { act, render, type RenderOptions } from '@testing-library/react-native';
import type { ComponentType, ReactElement, ReactNode } from 'react';

import type { UiRoles } from '@/components/ui/theme';
import { AppThemeProvider } from '@/components/ui/theme-context';
import { launchOsScheme, saveAppearance } from '@/components/ui/theme-launch';
import { appearanceMode, appearanceRoles, type AppearanceChoice } from '@/components/ui/theme-presets';

/**
 * Renders `ui` inside the app's theme provider, as the root layout does, so a
 * component that reads the theme (`useUiRoles`, `useUiMode`, `makeStyles`)
 * repaints when the test switches it. A `wrapper` option sits inside the
 * provider.
 */
export function renderWithTheme(ui: ReactElement, options: RenderOptions = {}) {
  const Inner: ComponentType<{ children: ReactNode }> | undefined = options.wrapper;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppThemeProvider>{Inner ? <Inner>{children}</Inner> : children}</AppThemeProvider>
  );
  return render(ui, { ...options, wrapper });
}

/** Saves `appearance` as Settings does, and lets every mounted provider repaint. */
export async function switchTheme(appearance: AppearanceChoice): Promise<void> {
  await act(async () => {
    await saveAppearance(appearance);
  });
}

/**
 * The roles a choice draws, as the provider resolves them. A colour assertion
 * takes its expected value from here, not from a module constant.
 */
export function rolesFor(appearance: AppearanceChoice): UiRoles {
  return appearanceRoles(appearance, appearanceMode(appearance, launchOsScheme));
}
