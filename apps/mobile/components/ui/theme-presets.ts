import { defaultThemeSeeds, type ThemeSeeds } from '@/components/ui/theme';
import { hueThemeId, parseHueThemeId, seedsFromHue, type HueThemeId } from '@/components/ui/theme-hue';
import { withNeutrals, type BackgroundChoice, type TextChoice } from '@/components/ui/theme-neutrals';

// The themes a user can choose (`docs/specs/ui/design-language.md` §2,
// "Presets"). A preset is its seeds, fixed here and gated in
// `__tests__/ui-theme.test.ts`, so no seed ever needs correcting at runtime;
// the custom colour (`theme-hue.ts`) fixes everything but the hue for the same
// reason. Picked 2026-10-01 from a mock of six: one per hue family.
export type ThemePreset = {
  id: ThemePresetId;
  label: string;
  seeds: ThemeSeeds;
};

export type ThemePresetId = 'warm' | 'slate' | 'forest' | 'plum';

export const DEFAULT_THEME_PRESET_ID: ThemePresetId = 'warm';

// In the order the Appearance page lists them. `record` stays a brass in every
// preset: "your best ever" keeps one look whatever the accent.
// A preset names one mid neutral; its background and text both take it until
// the user picks either apart (`theme-neutrals.ts`).
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

export type AppearanceRecordField = 'json' | 'accent' | 'background' | 'text' | 'mode';

// A theme from one hue the user picked (`theme-hue.ts`), stored as `hue:<deg>`.
export type CustomTheme = { id: 'custom'; label: string; hue: number; seeds: ThemeSeeds };

// Light, dark, or the OS's mode at launch (`theme-launch.ts` resolves it).
export type AppearanceMode = 'light' | 'dark' | 'system';
export const APPEARANCE_MODES: readonly AppearanceMode[] = ['light', 'dark', 'system'];

// Everything the user chose about how the app looks, per device.
export type AppearanceChoice = {
  // A preset id or a custom hue's `hue:<deg>`.
  accent: ThemePresetId | HueThemeId;
  background: BackgroundChoice;
  text: TextChoice;
  mode: AppearanceMode;
};

export const DEFAULT_APPEARANCE: AppearanceChoice = {
  accent: DEFAULT_THEME_PRESET_ID,
  background: 'match',
  text: 'match',
  mode: 'light',
};

// The theme a launch is drawn in. `preset` is the accent theme (it names the
// launcher icon); `seeds` are its seeds with the chosen background and text.
export type ResolvedTheme = {
  preset: ThemePreset | CustomTheme;
  appearance: AppearanceChoice;
  seeds: ThemeSeeds;
  problem: ThemeLaunchProblem | null;
};

export function customTheme(hue: number): CustomTheme {
  return { id: 'custom', label: 'Custom', hue, seeds: seedsFromHue(hue) };
}

// The value a theme is stored under: a preset id, or `hue:<deg>`.
export function storedThemeId(theme: ThemePreset | CustomTheme): ThemePresetId | HueThemeId {
  return theme.id === 'custom' ? hueThemeId(theme.hue) : theme.id;
}

// The accent a stored id names, normalised, or null when it names none.
export function parseAccentId(storedId: string): ThemePresetId | HueThemeId | null {
  const hue = parseHueThemeId(storedId);
  if (hue !== null) return hueThemeId(hue);
  return findThemePreset(storedId)?.id ?? null;
}

// The theme a choice draws.
export function resolveAppearance(appearance: AppearanceChoice): ResolvedTheme {
  const hue = parseHueThemeId(appearance.accent);
  const preset = hue === null ? getThemePreset(appearance.accent as ThemePresetId) : customTheme(hue);
  return {
    preset,
    appearance,
    seeds: withNeutrals(preset.seeds, appearance.background, appearance.text),
    problem: null,
  };
}

// The default theme, and why it is drawn instead of the stored choice.
export function defaultTheme(problem: ThemeLaunchProblem | null): ResolvedTheme {
  return { ...resolveAppearance(DEFAULT_APPEARANCE), problem };
}

// The theme a stored accent id names (the whole choice before background and
// text were choices): a preset, or a custom hue. No stored id is the default
// with no problem: the user has never chosen. An id no preset has (a preset
// since removed, or a corrupted value) is the default, reported.
export function resolveThemePreset(storedId: string | null): ResolvedTheme {
  if (storedId === null) return defaultTheme(null);
  const accent = parseAccentId(storedId);
  return accent === null
    ? defaultTheme({ kind: 'unknown-preset', storedId })
    : resolveAppearance({ ...DEFAULT_APPEARANCE, accent });
}
