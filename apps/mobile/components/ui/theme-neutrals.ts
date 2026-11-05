import { lchToHex } from '@/components/ui/lch';
import type { ThemeSeeds } from '@/components/ui/theme';

// The background and text choices of the record before custom themes
// (`theme-record.ts`, `parseLegacyAppearanceRecord`). Read only to convert such
// a record into the custom theme it drew; nothing offers them any more.

// The seeds' own L*: the mid neutral (`inkMuted`) every preset's neutral sits at.
const NEUTRAL_LIGHTNESS = 42.4;
const BACKGROUND_CHROMA_CAP = 12;
const TEXT_CHROMA_CAP = 14;

export type BackgroundSwatchId = 'white' | 'warm' | 'cool' | 'sage' | 'rose';
// A custom background's tint: three chroma steps up to the cap.
export type BackgroundTint = 1 | 2 | 3;
export const BACKGROUND_TINTS: readonly BackgroundTint[] = [1, 2, 3];
const TINT_CHROMA: Record<BackgroundTint, number> = { 1: 4, 2: 8, 3: BACKGROUND_CHROMA_CAP };
// `match` is the accent theme's own neutral.
export type BackgroundChoice = 'match' | BackgroundSwatchId | { hue: number; tint: BackgroundTint };

export type TextInkId = 'navy' | 'espresso' | 'forest' | 'plum';
// `match` takes the background's seed.
export type TextChoice = 'match' | TextInkId;

type NeutralChoice<Id extends string> = { id: Id; hue: number; chroma: number };

const backgroundSwatches: readonly NeutralChoice<BackgroundSwatchId>[] = [
  { id: 'white', hue: 0, chroma: 0 },
  { id: 'warm', hue: 81, chroma: 7.5 },
  { id: 'cool', hue: 265, chroma: 8 },
  { id: 'sage', hue: 132, chroma: 8.5 },
  { id: 'rose', hue: 10, chroma: 8 },
];

const textInks: readonly NeutralChoice<TextInkId>[] = [
  { id: 'navy', hue: 265, chroma: TEXT_CHROMA_CAP },
  { id: 'espresso', hue: 55, chroma: TEXT_CHROMA_CAP },
  { id: 'forest', hue: 150, chroma: TEXT_CHROMA_CAP },
  { id: 'plum', hue: 330, chroma: TEXT_CHROMA_CAP },
];

export function findBackgroundSwatch(id: string): NeutralChoice<BackgroundSwatchId> | undefined {
  return backgroundSwatches.find((swatch) => swatch.id === id);
}

export function findTextInk(id: string): NeutralChoice<TextInkId> | undefined {
  return textInks.find((ink) => ink.id === id);
}

const neutralSeed = (hue: number, chroma: number): string => lchToHex({ lightness: NEUTRAL_LIGHTNESS, chroma, hue });

function backgroundSeed(choice: BackgroundChoice, themeBackground: string): string {
  if (choice === 'match') return themeBackground;
  if (typeof choice === 'object') return neutralSeed(choice.hue, TINT_CHROMA[choice.tint]);
  const swatch = findBackgroundSwatch(choice)!;
  return neutralSeed(swatch.hue, swatch.chroma);
}

// A theme's seeds with the background and text such a record chose.
export function withNeutrals(seeds: ThemeSeeds, background: BackgroundChoice, text: TextChoice): ThemeSeeds {
  const backgroundHex = backgroundSeed(background, seeds.background);
  if (text === 'match') return { ...seeds, background: backgroundHex, text: backgroundHex };
  const ink = findTextInk(text)!;
  return { ...seeds, background: backgroundHex, text: neutralSeed(ink.hue, ink.chroma) };
}
