import { defaultThemeSeeds, type ThemeSeeds } from '@/components/ui/theme';

// The themes a user can choose (`docs/specs/ui/design-language.md` §2,
// "Presets"). A preset is four seeds, fixed here and gated in
// `app/__tests__/ui-theme.test.ts`: there is no free colour picker, so no seed
// ever needs correcting at runtime. Picked 2026-10-01 from a mock of six: one
// per hue family.
export type ThemePreset = {
  id: ThemePresetId;
  label: string;
  seeds: ThemeSeeds;
};

export type ThemePresetId = 'warm' | 'slate' | 'forest' | 'plum';

export const DEFAULT_THEME_PRESET_ID: ThemePresetId = 'warm';

// In the order the Appearance sheet lists them. `record` stays a brass in every
// preset: "your best ever" keeps one look whatever the accent.
export const themePresets: readonly ThemePreset[] = [
  { id: 'warm', label: 'Warm', seeds: defaultThemeSeeds },
  { id: 'slate', label: 'Slate', seeds: { ground: '#5B6470', accent: '#1F6FB2', record: '#8A6516', viz: '#5F7F96' } },
  { id: 'forest', label: 'Forest', seeds: { ground: '#5E6659', accent: '#2F7D4F', record: '#8C5A12', viz: '#6E8A62' } },
  { id: 'plum', label: 'Plum', seeds: { ground: '#665D66', accent: '#8E3B8A', record: '#7A6A12', viz: '#8A6F8A' } },
];

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
  | { kind: 'read-failed'; message: string };

export type ResolvedTheme = { preset: ThemePreset; problem: ThemeLaunchProblem | null };

// The preset a stored id names. No stored id is the default with no problem:
// the user has never chosen. An id no preset has (a preset since removed, or a
// corrupted value) is the default, reported.
export function resolveThemePreset(storedId: string | null): ResolvedTheme {
  const fallback = getThemePreset(DEFAULT_THEME_PRESET_ID);
  if (storedId === null) return { preset: fallback, problem: null };
  const preset = findThemePreset(storedId);
  return preset
    ? { preset, problem: null }
    : { preset: fallback, problem: { kind: 'unknown-preset', storedId } };
}
