import { Storage } from 'expo-sqlite/kv-store';

import type { HueThemeId } from '@/components/ui/theme-hue';
import {
  defaultTheme,
  resolveAppearance,
  resolveThemePreset,
  type AppearanceChoice,
  type ResolvedTheme,
  type ThemePresetId,
} from '@/components/ui/theme-presets';
import { parseAppearanceRecord, serialiseAppearanceRecord } from '@/components/ui/theme-record';

// The chosen appearance, per device: it is not synced to the account. Read
// synchronously, once, when `tokens.ts` first evaluates — about a hundred
// modules bake `uiRoles` into a module-scope `StyleSheet.create`, so a choice
// takes effect on the next launch (`docs/specs/ui/design-language.md` §2,
// "Choosing one").
//
// The record (`theme-record.ts`). Every save writes it.
export const APPEARANCE_STORAGE_KEY = 'boga3.appearance.v2';
// The accent id stored before background and text were choices. Read only
// while no record exists, never written, and left in place.
export const THEME_PRESET_STORAGE_KEY = 'boga3.themePreset.v1';

// The stored choice, resolved: the record, else the older accent id, else the
// default. An unusable value resolves to the default with its problem. Throws
// when the store cannot be read.
export function readStoredTheme(): ResolvedTheme {
  const record = Storage.getItemSync(APPEARANCE_STORAGE_KEY);
  if (record === null) return resolveThemePreset(Storage.getItemSync(THEME_PRESET_STORAGE_KEY));
  const parsed = parseAppearanceRecord(record);
  return parsed.appearance ? resolveAppearance(parsed.appearance) : defaultTheme(parsed.problem);
}

// What the stored choice resolves to, or the default and why.
export function readLaunchTheme(): ResolvedTheme {
  try {
    return readStoredTheme();
  } catch (error) {
    return defaultTheme({ kind: 'read-failed', message: error instanceof Error ? error.message : String(error) });
  }
}

// The theme this launch is drawn in. Never changes while the app runs.
export const launchTheme: ResolvedTheme = readLaunchTheme();

const savedListeners = new Set<() => void>();

// Called after every successful save, so a row showing the stored choice
// (Settings home, Appearance) re-reads it when another page saved.
export function subscribeThemeSaved(listener: () => void): () => void {
  savedListeners.add(listener);
  return () => {
    savedListeners.delete(listener);
  };
}

// Writes the whole choice as the record. Rejects when the write fails; the
// caller reports that nothing changed.
export async function saveAppearance(appearance: AppearanceChoice): Promise<void> {
  await Storage.setItem(APPEARANCE_STORAGE_KEY, serialiseAppearanceRecord(appearance));
  savedListeners.forEach((listener) => listener());
}

// Saves a new accent — a preset id or a custom hue's `hue:<deg>` — keeping the
// rest of the stored choice; an unusable stored choice is replaced by the
// default's. Rejects, saving nothing, when the store cannot be read or written.
export async function saveThemeAccent(accent: ThemePresetId | HueThemeId): Promise<void> {
  await saveAppearance({ ...readStoredTheme().appearance, accent });
}
