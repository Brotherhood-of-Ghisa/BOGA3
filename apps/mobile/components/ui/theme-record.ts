import type { ColorSchemeName } from 'react-native';

import { customFromSeeds, parseCustomColours } from '@/components/ui/theme-custom';
import { seedsFromHue, parseHueThemeId } from '@/components/ui/theme-hue';
import {
  BACKGROUND_TINTS,
  findBackgroundSwatch,
  findTextInk,
  withNeutrals,
  type BackgroundChoice,
  type BackgroundTint,
  type TextChoice,
} from '@/components/ui/theme-neutrals';
import {
  APPEARANCE_MODES,
  appearanceFromAccentId,
  findThemePreset,
  getThemePreset,
  resolveMode,
  type AppearanceChoice,
  type AppearanceMode,
  type AppearanceRecordField,
  type ThemeLaunchProblem,
  type ThemePresetId,
} from '@/components/ui/theme-presets';

// The appearance record (`docs/specs/ui/design-language.md` §2, "Choosing
// one"): one JSON object per device, every field required.
//
//   {"theme":"warm","mode":"light","custom":null}
//
// - `theme`: a preset id, or `custom`.
// - `mode`: `light`, `dark` or `system`; a custom theme ignores it.
// - `custom`: null, or `{background, borders, ink, text, accent, record,
//   viz}`, each a `{hue, strength}`; the background also `{mode, lightness,
//   depth}`, the borders `{match, contrast}`, `ink` `{lightness}`, `text`
//   `{contrast}` and `viz` `{gamut}` (`theme-custom.ts`). Never null while
//   `theme` is `custom`. Every part and field added since the first custom
//   themes may be absent: its default draws what the theme drew before it
//   (`parseCustomColours`).
//
// Fields this build does not know are ignored, so a later build may add one
// without an older build falling back on read. A save writes only the three
// fields above. A known field with a value this build does not know makes the
// whole record unusable: the app opens in the default theme and logs it, as
// for an unknown preset id.

export type AppearanceRecordResult =
  | { appearance: AppearanceChoice; problem: null }
  | { appearance: null; problem: ThemeLaunchProblem };

export function parseAppearanceRecord(stored: string): AppearanceRecordResult {
  const value = parseJsonObject(stored);
  if (value === null) return invalid('json', stored);
  if (typeof value.theme !== 'string') return invalid('theme', stored);
  const theme = value.theme === 'custom' ? 'custom' : (findThemePreset(value.theme)?.id ?? null);
  if (theme === null) return { appearance: null, problem: { kind: 'unknown-preset', storedId: value.theme } };
  const mode = parseMode(value.mode);
  if (mode === null) return invalid('mode', stored);
  const custom = value.custom === null ? null : parseCustomColours(value.custom);
  if ((value.custom !== null && custom === null) || (theme === 'custom' && custom === null)) return invalid('custom', stored);
  return { appearance: { theme, mode, custom }, problem: null };
}

// The record for a choice: the three fields in a fixed order.
export function serialiseAppearanceRecord({ theme, mode, custom }: AppearanceChoice): string {
  return JSON.stringify({ theme, mode, custom });
}

// The record before custom themes: `{accent, background, text, mode}`, where
// `accent` is a preset id or `hue:<deg>`, `background` is `match`, a swatch id
// or `{hue, tint}`, and `text` is `match` or an ink id (`theme-neutrals.ts`).
// Read only while no record exists, and converted: a preset with both left to
// match is that preset; anything else is a custom theme of the colours it drew,
// on the page of its mode (`system` the OS's as read now).
export function parseLegacyAppearanceRecord(
  stored: string,
  osScheme: ColorSchemeName | null | undefined = null,
): AppearanceRecordResult {
  const value = parseJsonObject(stored);
  if (value === null) return invalid('json', stored);
  if (typeof value.accent !== 'string') return invalid('accent', stored);
  const accent = appearanceFromAccentId(value.accent);
  if (accent === null) return { appearance: null, problem: { kind: 'unknown-preset', storedId: value.accent } };
  const background = parseBackground(value.background);
  if (background === null) return invalid('background', stored);
  const text = parseText(value.text);
  if (text === null) return invalid('text', stored);
  const mode = parseMode(value.mode);
  if (mode === null) return invalid('mode', stored);
  if (accent.theme !== 'custom' && background === 'match' && text === 'match') {
    return { appearance: { ...accent, mode }, problem: null };
  }
  const hue = parseHueThemeId(value.accent);
  const accentSeeds = hue === null ? getThemePreset(accent.theme as ThemePresetId).seeds : seedsFromHue(hue);
  const seeds = withNeutrals(accentSeeds, background, text);
  return { appearance: { theme: 'custom', mode, custom: customFromSeeds(seeds, resolveMode(mode, osScheme)) }, problem: null };
}

const invalid = (field: AppearanceRecordField, stored: string): AppearanceRecordResult => ({
  appearance: null,
  problem: { kind: 'invalid-record', field, stored },
});

function parseJsonObject(stored: string): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return null;
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseBackground(value: unknown): BackgroundChoice | null {
  if (value === 'match') return 'match';
  if (typeof value === 'string') return findBackgroundSwatch(value)?.id ?? null;
  if (typeof value !== 'object' || value === null) return null;
  const { hue, tint } = value as Record<string, unknown>;
  const validHue = typeof hue === 'number' && Number.isInteger(hue) && hue >= 0 && hue < 360;
  const validTint = BACKGROUND_TINTS.includes(tint as BackgroundTint);
  return validHue && validTint ? { hue, tint: tint as BackgroundTint } : null;
}

function parseText(value: unknown): TextChoice | null {
  if (value === 'match') return 'match';
  return typeof value === 'string' ? (findTextInk(value)?.id ?? null) : null;
}

function parseMode(value: unknown): AppearanceMode | null {
  return APPEARANCE_MODES.find((mode) => mode === value) ?? null;
}
