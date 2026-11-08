import { useEffect, useState } from 'react';

import type { ThemeMode, UiRoles } from '@/components/ui/theme';
import type { CustomPart } from '@/components/ui/theme-custom';
import { hueName } from '@/components/ui/theme-hue';
import { launchOsScheme, launchTheme, readIntendedTheme, readStoredTheme, subscribeThemeSaved } from '@/components/ui/theme-launch';
import {
  appearanceMode,
  appearanceRoles as rolesInMode,
  getThemePreset,
  type AppearanceChoice,
  type AppearanceMode,
  type ThemePresetId,
} from '@/components/ui/theme-presets';
import { logEvent } from '@/src/logging';

// The stored choice. Falls back to the theme in use, logged, when the store
// cannot be read.
export function readStoredAppearance(): AppearanceChoice {
  try {
    return readStoredTheme().appearance;
  } catch (error) {
    void logEvent({
      level: 'error',
      event: 'theme.read_failed',
      message: 'Could not read the stored appearance; showing the theme in use.',
      context: { error: error instanceof Error ? error.message : String(error) },
    });
    return launchTheme.appearance;
  }
}

// The stored choice with the saves still on their way applied; the stored
// choice itself when none is. Falls back as `readStoredAppearance` does.
export function readIntendedAppearance(): AppearanceChoice {
  try {
    return readIntendedTheme();
  } catch {
    return readStoredAppearance();
  }
}

// The stored choice, kept current when any page saves one. The setter shows a
// choice before its save returns.
export function useStoredAppearance(): [AppearanceChoice, (appearance: AppearanceChoice) => void] {
  const [appearance, setAppearance] = useState<AppearanceChoice>(readStoredAppearance);
  useEffect(() => subscribeThemeSaved(() => setAppearance(readStoredAppearance())), []);
  return [appearance, setAppearance];
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// Which parts of a choice wait for the next launch: each differs from the
// theme in use. `custom` is per part, and counts only while Custom is chosen.
export type PendingAppearance = {
  theme: boolean;
  mode: boolean;
  custom: Record<CustomPart, boolean>;
  any: boolean;
};

export function pendingAppearance(appearance: AppearanceChoice): PendingAppearance {
  const launched = launchTheme.appearance;
  const theme = appearance.theme !== launched.theme;
  const mode = appearance.mode !== launched.mode;
  const customPart = (part: CustomPart) =>
    appearance.theme === 'custom' && !same(appearance.custom?.[part], launched.custom?.[part]);
  const custom = {
    background: customPart('background'),
    ink: customPart('ink'),
    text: customPart('text'),
    accent: customPart('accent'),
    record: customPart('record'),
    viz: customPart('viz'),
  };
  const drawnMode = appearance.theme !== 'custom' && mode;
  return { theme, mode, custom, any: theme || drawnMode || Object.values(custom).some(Boolean) };
}

export const MODE_LABELS: Record<AppearanceMode, string> = { light: 'Light', dark: 'Dark', system: 'System' };

// The custom parts as the Appearance page names them, in its order.
export const CUSTOM_PART_LABELS: Record<CustomPart, string> = {
  background: 'Background',
  ink: 'Primary text',
  text: 'Secondary text',
  accent: 'Accent',
  record: 'Best ever',
  viz: 'Charts',
};

// The ladder a choice would draw on if the app opened now: `system` takes the
// OS's mode as this launch found it, since the pin hides any change since.
export function previewMode(appearance: AppearanceChoice): ThemeMode {
  return appearanceMode(appearance, launchOsScheme);
}

export function themeLabel(appearance: AppearanceChoice): string {
  return appearance.theme === 'custom' ? 'Custom' : getThemePreset(appearance.theme as ThemePresetId).label;
}

// A custom part's value as a row shows it: its hue's name and strength, and
// for the background its lightness.
export function customPartLabel(appearance: AppearanceChoice, part: CustomPart): string {
  const colours = appearance.custom;
  if (!colours) return '';
  const { hue, strength } = colours[part];
  const words = [hueName(hue), `${strength}%`];
  return part === 'background' ? [...words, `light ${colours.background.lightness}`].join(', ') : words.join(', ');
}

// The whole choice for Settings home's row: the theme, and a preset's mode
// when it is not the default light.
export function appearanceLabel(appearance: AppearanceChoice): string {
  const label = themeLabel(appearance);
  if (appearance.theme === 'custom' || appearance.mode === 'light') return label;
  return `${label}, ${MODE_LABELS[appearance.mode]} mode`;
}

// The roles a choice draws, in the mode it would open in, for a preview or a
// swatch: the screens are drawn in the saved theme's roles, so another
// theme's colours are not roles of the live theme.
export function appearanceRoles(appearance: AppearanceChoice): UiRoles {
  return rolesInMode(appearance, previewMode(appearance));
}

// What fits at the end of Settings home's row: the theme, then a preset's mode
// when it is not light; with neither, `from next launch` while the choice
// waits. The row's accessibility label carries `appearanceLabel`.
export function appearanceSummary(appearance: AppearanceChoice): string {
  const label = themeLabel(appearance);
  if (appearance.theme !== 'custom' && appearance.mode !== 'light') {
    return `${label}, ${MODE_LABELS[appearance.mode].toLowerCase()}`;
  }
  return pendingAppearance(appearance).any ? `${label} from next launch` : label;
}
