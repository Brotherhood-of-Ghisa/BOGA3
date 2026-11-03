import { lchToHex } from '@/components/ui/lch';
import type { ThemeSeeds } from '@/components/ui/theme';

// Background and text (`docs/specs/ui/design-language.md` §2, "Choosing
// one"): each is a neutral seed the user picks apart from the accent. A choice
// sets only hue and chroma; the ladder in `theme.ts` owns lightness, so the
// text floors hold for every choice by construction. Chroma is capped so both
// still read as neutrals — a tinted page and a tinted ink, not a colour.

// The seeds' own L*: the mid neutral (`inkMuted`) every preset's neutral sits at.
// Roles never read it, only the hue and chroma.
const NEUTRAL_LIGHTNESS = 42.4;

// The most chroma a background seed carries: `paper` takes 0.35 of it, `rule`
// 0.88, so the page stays a tint of white.
export const BACKGROUND_CHROMA_CAP = 12;
// The most chroma a text seed carries: `inkMuted` takes all of it, `ink` 0.53
// at L* 8, so a tinted ink still reads as near-black.
export const TEXT_CHROMA_CAP = 14;

export type BackgroundSwatchId = 'white' | 'warm' | 'cool' | 'sage' | 'rose';
// A custom background's tint: three chroma steps up to the cap.
export type BackgroundTint = 1 | 2 | 3;
export const BACKGROUND_TINTS: readonly BackgroundTint[] = [1, 2, 3];
const TINT_CHROMA: Record<BackgroundTint, number> = { 1: 4, 2: 8, 3: BACKGROUND_CHROMA_CAP };
export type CustomBackground = { hue: number; tint: BackgroundTint };
// `match` is the accent theme's own neutral: what every theme drew before
// background was a choice of its own.
export type BackgroundChoice = 'match' | BackgroundSwatchId | CustomBackground;

export type TextInkId = 'navy' | 'espresso' | 'forest' | 'plum';
// `match` takes the background's seed, so text and ground read as one family.
export type TextChoice = 'match' | TextInkId;

export type NeutralChoice<Id extends string> = { id: Id; label: string; hue: number; chroma: number };

// In the order a picker lists them. Warm, Cool and Sage are the Warm, Slate and
// Forest presets' neutrals, rounded.
export const backgroundSwatches: readonly NeutralChoice<BackgroundSwatchId>[] = [
  { id: 'white', label: 'White', hue: 0, chroma: 0 },
  { id: 'warm', label: 'Warm', hue: 81, chroma: 7.5 },
  { id: 'cool', label: 'Cool', hue: 265, chroma: 8 },
  { id: 'sage', label: 'Sage', hue: 132, chroma: 8.5 },
  { id: 'rose', label: 'Rose', hue: 10, chroma: 8 },
];

export const textInks: readonly NeutralChoice<TextInkId>[] = [
  { id: 'navy', label: 'Navy', hue: 265, chroma: TEXT_CHROMA_CAP },
  { id: 'espresso', label: 'Espresso', hue: 55, chroma: TEXT_CHROMA_CAP },
  { id: 'forest', label: 'Forest', hue: 150, chroma: TEXT_CHROMA_CAP },
  { id: 'plum', label: 'Plum', hue: 330, chroma: TEXT_CHROMA_CAP },
];

export function findBackgroundSwatch(id: string): NeutralChoice<BackgroundSwatchId> | undefined {
  return backgroundSwatches.find((swatch) => swatch.id === id);
}

export function findTextInk(id: string): NeutralChoice<TextInkId> | undefined {
  return textInks.find((ink) => ink.id === id);
}

const neutralSeed = (hue: number, chroma: number): string => lchToHex({ lightness: NEUTRAL_LIGHTNESS, chroma, hue });

// The background seed a choice names; `match` keeps the accent theme's own.
export function backgroundSeed(choice: BackgroundChoice, themeBackground: string): string {
  if (choice === 'match') return themeBackground;
  if (typeof choice === 'object') return neutralSeed(choice.hue, TINT_CHROMA[choice.tint]);
  const swatch = findBackgroundSwatch(choice)!;
  return neutralSeed(swatch.hue, swatch.chroma);
}

// A theme's seeds with the background and text the user chose. `match` for
// both leaves the seeds as they are.
export function withNeutrals(seeds: ThemeSeeds, background: BackgroundChoice, text: TextChoice): ThemeSeeds {
  const backgroundHex = backgroundSeed(background, seeds.background);
  if (text === 'match') return { ...seeds, background: backgroundHex, text: backgroundHex };
  const ink = findTextInk(text)!;
  return { ...seeds, background: backgroundHex, text: neutralSeed(ink.hue, ink.chroma) };
}
