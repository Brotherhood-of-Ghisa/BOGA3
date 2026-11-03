import {
  BACKGROUND_TINTS,
  findBackgroundSwatch,
  findTextInk,
  type BackgroundChoice,
  type BackgroundTint,
  type TextChoice,
} from '@/components/ui/theme-neutrals';
import {
  APPEARANCE_MODES,
  parseAccentId,
  type AppearanceChoice,
  type AppearanceMode,
  type AppearanceRecordField,
  type ThemeLaunchProblem,
} from '@/components/ui/theme-presets';

// The appearance record (`docs/specs/ui/design-language.md` §2, "Choosing
// one"): one JSON object per device, every field required.
//
//   {"accent":"warm","background":"match","text":"match","mode":"light"}
//
// - `accent`: a preset id, or a custom hue as `hue:<deg>` (0–359).
// - `background`: `match` (the accent theme's own neutral), a swatch id, or a
//   custom `{"hue":<0–359>,"tint":<1–3>}`.
// - `text`: `match` (the background) or an ink id.
// - `mode`: `light`, `dark` or `system`.
//
// Fields this build does not know are ignored, so a later build may add one
// without an older build falling back on read. A save writes only the four
// fields above, so it drops any field a later build added. A known field with
// a value this build does not know makes the whole record unusable: the app
// opens in the default theme and logs it, as for an unknown preset id.

export type AppearanceRecordResult =
  | { appearance: AppearanceChoice; problem: null }
  | { appearance: null; problem: ThemeLaunchProblem };

export function parseAppearanceRecord(stored: string): AppearanceRecordResult {
  const value = parseJsonObject(stored);
  if (value === null) return invalid('json', stored);
  if (typeof value.accent !== 'string') return invalid('accent', stored);
  const accent = parseAccentId(value.accent);
  if (accent === null) return { appearance: null, problem: { kind: 'unknown-preset', storedId: value.accent } };
  const background = parseBackground(value.background);
  if (background === null) return invalid('background', stored);
  const text = parseText(value.text);
  if (text === null) return invalid('text', stored);
  const mode = parseMode(value.mode);
  if (mode === null) return invalid('mode', stored);
  return { appearance: { accent, background, text, mode }, problem: null };
}

// The record for a choice: the four fields in a fixed order.
export function serialiseAppearanceRecord({ accent, background, text, mode }: AppearanceChoice): string {
  return JSON.stringify({ accent, background, text, mode });
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
