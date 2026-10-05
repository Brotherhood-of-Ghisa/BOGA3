import { Storage } from 'expo-sqlite/kv-store';

import type { HueThemeId } from '@/components/ui/theme-hue';
import { resolveThemePreset, type ResolvedTheme, type ThemePresetId } from '@/components/ui/theme-presets';

// The chosen theme, per device: it is not synced to the account. Read
// synchronously, once, when `tokens.ts` first evaluates — about a hundred
// modules bake `uiRoles` into a module-scope `StyleSheet.create`, so a choice
// takes effect on the next launch (`docs/specs/ui/design-language.md` §2,
// "Presets").
export const THEME_PRESET_STORAGE_KEY = 'boga3.themePreset.v1';

// What the stored choice resolves to, or the default and why.
export function readLaunchTheme(): ResolvedTheme {
  let storedId: string | null;
  try {
    storedId = Storage.getItemSync(THEME_PRESET_STORAGE_KEY);
  } catch (error) {
    const resolved = resolveThemePreset(null);
    return {
      ...resolved,
      problem: { kind: 'read-failed', message: error instanceof Error ? error.message : String(error) },
    };
  }
  return resolveThemePreset(storedId);
}

// The theme this launch is drawn in. Never changes while the app runs.
export const launchTheme: ResolvedTheme = readLaunchTheme();

// The choice as stored now: differs from `launchTheme` once the user picks
// another preset, until the next launch.
export function readStoredThemePresetId(): string | null {
  return Storage.getItemSync(THEME_PRESET_STORAGE_KEY);
}

// Rejects when the write fails; the caller reports that nothing changed. `id`
// is a preset id or a custom hue's `hue:<deg>`.
export async function saveThemePresetId(id: ThemePresetId | HueThemeId): Promise<void> {
  await Storage.setItem(THEME_PRESET_STORAGE_KEY, id);
}
