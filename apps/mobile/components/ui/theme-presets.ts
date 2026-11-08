import type { ColorSchemeName } from 'react-native';

import { defaultThemeSeeds, generateRoles, type ThemeMode, type ThemeSeeds, type UiRoles } from '@/components/ui/theme';
import { customFromSeeds, customMode, generateCustomRoles, type CustomColours } from '@/components/ui/theme-custom';
import { parseHueThemeId, seedsFromHue } from '@/components/ui/theme-hue';

// The themes a user can choose (`docs/specs/ui/design-language.md` §2,
// "Presets"). A preset is its seeds, fixed here and gated in
// `__tests__/ui-theme.test.ts`, so no seed ever needs correcting at runtime.
// Picked 2026-10-01 from a mock of six: one per hue family. Anything else is a
// custom theme (`theme-custom.ts`), which is not gated.
export type ThemePreset = {
  id: ThemePresetId;
  label: string;
  seeds: ThemeSeeds;
};

export type ThemePresetId = 'warm' | 'slate' | 'forest' | 'plum';

export const DEFAULT_THEME_PRESET_ID: ThemePresetId = 'warm';

// In the order the Appearance page lists them. `record` stays a brass in every
// preset: "your best ever" keeps one look whatever the accent. A preset names
// one mid neutral, which its background and text both take.
export const themePresets: readonly ThemePreset[] = [
  { id: 'warm', label: 'Warm', seeds: defaultThemeSeeds },
  { id: 'slate', label: 'Slate', seeds: oneNeutral('#5B6470', { accent: '#1F6FB2', record: '#8A6516', viz: '#5F7F96' }) },
  { id: 'forest', label: 'Forest', seeds: oneNeutral('#5E6659', { accent: '#2F7D4F', record: '#8C5A12', viz: '#6E8A62' }) },
  { id: 'plum', label: 'Plum', seeds: oneNeutral('#665D66', { accent: '#8E3B8A', record: '#7A6A12', viz: '#8A6F8A' }) },
];

function oneNeutral(neutral: string, rest: Omit<ThemeSeeds, 'background' | 'text'>): ThemeSeeds {
  return { background: neutral, text: neutral, ...rest };
}

export function findThemePreset(id: string): ThemePreset | undefined {
  return themePresets.find((preset) => preset.id === id);
}

export function getThemePreset(id: ThemePresetId): ThemePreset {
  const preset = findThemePreset(id);
  if (!preset) throw new Error(`getThemePreset: no preset "${id}"`);
  return preset;
}

// Why the launch theme is not the stored choice. The app still opens, in the
// default theme, and the root layout logs the problem.
export type ThemeLaunchProblem =
  | { kind: 'unknown-preset'; storedId: string }
  // A stored appearance record that is not JSON, or whose `field` holds no
  // value this build knows (`theme-record.ts`). `stored` is the raw value.
  | { kind: 'invalid-record'; field: AppearanceRecordField; stored: string }
  | { kind: 'read-failed'; message: string };

// The record's fields, and the older record's (`accent`, `background`, `text`).
export type AppearanceRecordField = 'json' | 'theme' | 'mode' | 'custom' | 'accent' | 'background' | 'text';

// What the launcher icon is chosen by: every custom theme shares one icon.
export type CustomTheme = { id: 'custom'; label: string };
export const CUSTOM_THEME: CustomTheme = { id: 'custom', label: 'Custom' };

// Light, dark, or the phone's mode, followed while the app runs, for a preset. A custom theme's page
// lightness sets its mode.
export type AppearanceMode = 'light' | 'dark' | 'system';
export const APPEARANCE_MODES: readonly AppearanceMode[] = ['light', 'dark', 'system'];

// Everything the user chose about how the app looks, per device. `custom` is
// kept while a preset is chosen, so going back to Custom finds it as left; it
// is never null while `theme` is `custom`.
export type AppearanceChoice = {
  theme: ThemePresetId | 'custom';
  mode: AppearanceMode;
  custom: CustomColours | null;
};

export const DEFAULT_APPEARANCE: AppearanceChoice = {
  theme: DEFAULT_THEME_PRESET_ID,
  mode: 'light',
  custom: null,
};

// The theme a launch is drawn in. `preset` names the launcher icon.
export type ResolvedTheme = {
  preset: ThemePreset | CustomTheme;
  appearance: AppearanceChoice;
  problem: ThemeLaunchProblem | null;
};

export function resolveAppearance(appearance: AppearanceChoice): ResolvedTheme {
  const preset = appearance.theme === 'custom' ? CUSTOM_THEME : getThemePreset(appearance.theme);
  return { preset, appearance, problem: null };
}

// The default theme, and why it is drawn instead of the stored choice.
export function defaultTheme(problem: ThemeLaunchProblem | null): ResolvedTheme {
  return { ...resolveAppearance(DEFAULT_APPEARANCE), problem };
}

// The ladder a stored mode draws on: `system` takes the OS's mode, and light
// when the OS states none.
export function resolveMode(mode: AppearanceMode, osScheme: ColorSchemeName | null | undefined): ThemeMode {
  if (mode !== 'system') return mode;
  return osScheme === 'dark' ? 'dark' : 'light';
}

// The mode a choice draws in: a custom theme's from its page, a preset's from
// the stored mode.
export function appearanceMode(appearance: AppearanceChoice, osScheme: ColorSchemeName | null | undefined): ThemeMode {
  return appearance.theme === 'custom' && appearance.custom
    ? customMode(appearance.custom)
    : resolveMode(appearance.mode, osScheme);
}

// Every role a choice draws, in a mode (a custom theme ignores it: its page
// sets it).
export function appearanceRoles(appearance: AppearanceChoice, mode: ThemeMode): UiRoles {
  if (appearance.theme === 'custom' && appearance.custom) return generateCustomRoles(appearance.custom);
  return generateRoles(getThemePreset(appearance.theme as ThemePresetId).seeds, mode);
}

// Custom colours to start from: the ones already chosen, else the preset in
// use, drawn in its mode.
export function startingCustom(appearance: AppearanceChoice, mode: ThemeMode): CustomColours {
  if (appearance.custom) return appearance.custom;
  const preset = getThemePreset(appearance.theme as ThemePresetId);
  return customFromSeeds(preset.seeds, mode);
}

// The choice an older stored accent id names: a preset id, or a custom hue as
// `hue:<deg>` (0–359), which becomes a custom theme on a light page. Null when
// it names neither.
export function appearanceFromAccentId(storedId: string): AppearanceChoice | null {
  const hue = parseHueThemeId(storedId);
  if (hue !== null) return { theme: 'custom', mode: 'light', custom: customFromSeeds(seedsFromHue(hue), 'light') };
  const preset = findThemePreset(storedId);
  return preset ? { ...DEFAULT_APPEARANCE, theme: preset.id } : null;
}

// The theme the first stored value, an accent id alone, names. No stored id is
// the default with no problem: the user has never chosen. An id no preset has
// (a preset since removed, or a corrupted value) is the default, reported.
export function resolveThemePreset(storedId: string | null): ResolvedTheme {
  if (storedId === null) return defaultTheme(null);
  const appearance = appearanceFromAccentId(storedId);
  return appearance === null ? defaultTheme({ kind: 'unknown-preset', storedId }) : resolveAppearance(appearance);
}
