import { useEffect, useState } from 'react';

import { hueName, parseHueThemeId } from '@/components/ui/theme-hue';
import { launchTheme, readStoredThemePresetId, subscribeThemeSaved } from '@/components/ui/theme-launch';
import { resolveThemePreset, storedThemeId } from '@/components/ui/theme-presets';
import { logEvent } from '@/src/logging';

// The stored choice, as stored: a preset id or a custom `hue:<deg>`. Falls
// back to the theme in use, logged, when the store cannot be read.
export function readChosenId(): string {
  try {
    return storedThemeId(resolveThemePreset(readStoredThemePresetId()).preset);
  } catch (error) {
    void logEvent({
      level: 'error',
      event: 'theme.read_failed',
      message: 'Could not read the stored theme preset; showing the theme in use.',
      context: { error: error instanceof Error ? error.message : String(error) },
    });
    return storedThemeId(launchTheme.preset);
  }
}

// The chosen theme, kept current when any page saves a choice.
export function useChosenThemeId(): [string, (id: string) => void] {
  const [chosenId, setChosenId] = useState<string>(readChosenId);
  useEffect(() => subscribeThemeSaved(() => setChosenId(readChosenId())), []);
  return [chosenId, setChosenId];
}

// A choice that waits for the next launch: it differs from the theme in use.
export const isThemePending = (chosenId: string): boolean => chosenId !== storedThemeId(launchTheme.preset);

export function themeLabel(id: string): string {
  const hue = parseHueThemeId(id);
  return hue === null ? resolveThemePreset(id).preset.label : `Custom (${hueName(hue)})`;
}
