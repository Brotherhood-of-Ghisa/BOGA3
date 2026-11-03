import { useEffect, useState } from 'react';

import { generateRoles, type UiRoles } from '@/components/ui/theme';
import { hueName, parseHueThemeId } from '@/components/ui/theme-hue';
import { findBackgroundSwatch, findTextInk, type BackgroundChoice } from '@/components/ui/theme-neutrals';
import { launchTheme, readStoredTheme, subscribeThemeSaved } from '@/components/ui/theme-launch';
import { resolveAppearance, resolveThemePreset, type AppearanceChoice } from '@/components/ui/theme-presets';
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
export type PendingAppearance = { accent: boolean; background: boolean; text: boolean; any: boolean };

export function pendingAppearance(appearance: AppearanceChoice): PendingAppearance {
  const launched = launchTheme.appearance;
  const accent = appearance.accent !== launched.accent;
  const background = !same(appearance.background, launched.background);
  const text = appearance.text !== launched.text;
  return { accent, background, text, any: accent || background || text || appearance.mode !== launched.mode };
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
// and the text when they are not the theme's own.
export function appearanceLabel({ accent, background, text }: AppearanceChoice): string {
  return [
    themeLabel(accent),
    ...(background === 'match' ? [] : [`${backgroundLabel(background)} background`]),
    ...(text === 'match' ? [] : [`${findTextInk(text)!.label} text`]),
  ].join(', ');
}

// The roles a choice draws, for a preview or a swatch: the screens bake this
// launch's `uiRoles` in, so another theme's colours cannot be roles of this one.
export function appearanceRoles(appearance: AppearanceChoice): UiRoles {
  return generateRoles(resolveAppearance(appearance).seeds);
}
