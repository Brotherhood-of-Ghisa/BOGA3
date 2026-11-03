import { useEffect, useState } from 'react';

import { generateRoles, type ThemeMode, type UiRoles } from '@/components/ui/theme';
import { hueName, parseHueThemeId } from '@/components/ui/theme-hue';
import { findBackgroundSwatch, findTextInk, type BackgroundChoice } from '@/components/ui/theme-neutrals';
import {
  launchOsScheme,
  launchTheme,
  readIntendedTheme,
  readStoredTheme,
  resolveMode,
  subscribeThemeSaved,
} from '@/components/ui/theme-launch';
import {
  resolveAppearance,
  resolveThemePreset,
  type AppearanceChoice,
  type AppearanceMode,
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
// theme in use.
export type PendingAppearance = { accent: boolean; background: boolean; text: boolean; mode: boolean; any: boolean };

export function pendingAppearance(appearance: AppearanceChoice): PendingAppearance {
  const launched = launchTheme.appearance;
  const accent = appearance.accent !== launched.accent;
  const background = !same(appearance.background, launched.background);
  const text = appearance.text !== launched.text;
  const mode = appearance.mode !== launched.mode;
  return { accent, background, text, mode, any: accent || background || text || mode };
}

export const MODE_LABELS: Record<AppearanceMode, string> = { light: 'Light', dark: 'Dark', system: 'System' };

// The ladder a mode would draw on if the app opened now: `system` takes the
// OS's mode as this launch found it, since the pin hides any change since.
export function previewMode(mode: AppearanceMode): ThemeMode {
  return resolveMode(mode, launchOsScheme);
}

export function themeLabel(id: string): string {
  const hue = parseHueThemeId(id);
  return hue === null ? resolveThemePreset(id).preset.label : `Custom (${hueName(hue)})`;
}

// The tint steps of a custom background, as a picker names them.
export const BACKGROUND_TINT_LABELS = { 1: 'Soft', 2: 'Medium', 3: 'Strong' } as const;

export function backgroundLabel(background: BackgroundChoice): string {
  if (background === 'match') return 'Match theme';
  if (typeof background === 'string') return findBackgroundSwatch(background)!.label;
  return `Custom (${hueName(background.hue)})`;
}

// The whole choice for Settings home's row: the accent, then the background
// and the text when they are not the theme's own, and the mode when it is not
// the default light.
export function appearanceLabel({ accent, background, text, mode }: AppearanceChoice): string {
  return [
    themeLabel(accent),
    ...(background === 'match' ? [] : [`${backgroundLabel(background)} background`]),
    ...(text === 'match' ? [] : [`${findTextInk(text)!.label} text`]),
    ...(mode === 'light' ? [] : [`${MODE_LABELS[mode]} mode`]),
  ].join(', ');
}

// The roles a choice draws, in the mode it would open in, for a preview or a
// swatch: the screens bake this launch's `uiRoles` in, so another theme's
// colours cannot be roles of this one.
export function appearanceRoles(appearance: AppearanceChoice): UiRoles {
  return generateRoles(resolveAppearance(appearance).seeds, previewMode(appearance.mode));
}

// What fits at the end of Settings home's row without squeezing its label: the
// accent, then `tinted` when a background or text was chosen and the mode when
// it is not light; with neither, `from next launch` while the choice waits.
// The row's accessibility label carries `appearanceLabel`.
export function appearanceSummary(appearance: AppearanceChoice): string {
  const label = themeLabel(appearance.accent);
  const tinted = appearance.background !== 'match' || appearance.text !== 'match';
  const parts = [label, ...(tinted ? ['tinted'] : []), ...(appearance.mode === 'light' ? [] : [MODE_LABELS[appearance.mode].toLowerCase()])];
  if (parts.length > 1) return parts.join(', ');
  return pendingAppearance(appearance).any ? `${label} from next launch` : label;
}
