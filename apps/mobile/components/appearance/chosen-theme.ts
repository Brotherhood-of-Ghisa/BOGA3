import { useEffect, useState } from 'react';
import type { ColorSchemeName } from 'react-native';

import type { ThemeMode, UiRoles } from '@/components/ui/theme';
import { useAppTheme } from '@/components/ui/theme-context';
import { followsPhone } from '@/components/ui/theme-native';
import type { CustomPart } from '@/components/ui/theme-custom';
import { hueName } from '@/components/ui/theme-hue';
import { readIntendedTheme, readStoredTheme, subscribeThemeSaved } from '@/components/ui/theme-launch';
import {
  appearanceMode,
  appearanceRoles as rolesInMode,
  getThemePreset,
  type AppearanceChoice,
  type AppearanceMode,
  type ThemePresetId,
} from '@/components/ui/theme-presets';
import { logEvent } from '@/src/logging';

// The stored choice. Falls back to `inUse`, logged, when the store cannot be
// read: the choice to show instead (the theme the app is drawn in, or the
// page's own).
export function readStoredAppearance(inUse: AppearanceChoice): AppearanceChoice {
  try {
    return readStoredTheme().appearance;
  } catch (error) {
    void logEvent({
      level: 'error',
      event: 'theme.read_failed',
      message: 'Could not read the stored appearance; showing the theme in use.',
      context: { error: error instanceof Error ? error.message : String(error) },
    });
    return inUse;
  }
}

// The stored choice with the saves still on their way applied; the stored
// choice itself when none is. Falls back as `readStoredAppearance` does.
export function readIntendedAppearance(inUse: AppearanceChoice): AppearanceChoice {
  try {
    return readIntendedTheme();
  } catch {
    return readStoredAppearance(inUse);
  }
}

// Whether the stored choice is one the app could not use (an unknown id, an
// invalid record), so saving even the same choice replaces it.
export function storedChoiceUnusable(): boolean {
  try {
    return readStoredTheme().problem !== null;
  } catch {
    return false;
  }
}

// The stored choice, kept current when any page saves one. The setter shows a
// choice before its save returns.
export function useStoredAppearance(): [AppearanceChoice, (appearance: AppearanceChoice) => void] {
  const inUse = useAppTheme().appearance;
  const [appearance, setAppearance] = useState<AppearanceChoice>(() => readStoredAppearance(inUse));
  useEffect(() => subscribeThemeSaved(() => setAppearance(readStoredAppearance(inUse))), [inUse]);
  return [appearance, setAppearance];
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

// The phone's mode as the OS reports it now (`theme-context.tsx`): what a
// preview of System draws in. While native UI is pinned the OS reports the
// pin, so System previews in the drawn mode, as choosing it first draws, until
// the OS reports the phone's own.
export function usePhoneScheme(): ColorSchemeName | null {
  const theme = useAppTheme();
  return followsPhone(theme.appearance) ? theme.phoneScheme : theme.mode;
}

// The ladder a choice draws on: `system` takes `phoneScheme`.
export function previewMode(appearance: AppearanceChoice, phoneScheme: ColorSchemeName | null): ThemeMode {
  return appearanceMode(appearance, phoneScheme);
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

// The roles a choice draws, in its mode, for a preview or a swatch: the
// screens are drawn in the saved theme's roles, so another theme's colours are
// not roles of the live theme.
export function appearanceRoles(appearance: AppearanceChoice, phoneScheme: ColorSchemeName | null): UiRoles {
  return rolesInMode(appearance, previewMode(appearance, phoneScheme));
}

// What fits at the end of Settings home's row: the theme, then a preset's mode
// when it is not light. The row's accessibility label carries
// `appearanceLabel`.
export function appearanceSummary(appearance: AppearanceChoice): string {
  const label = themeLabel(appearance);
  if (appearance.theme === 'custom' || appearance.mode === 'light') return label;
  return `${label}, ${MODE_LABELS[appearance.mode].toLowerCase()}`;
}
