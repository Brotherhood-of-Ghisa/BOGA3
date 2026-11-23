import { contrastRatio, hexToLch } from '@/components/ui/lch';

export { contrastRatio };

/** CIE L* of a `#RRGGBB` colour. */
export function lightnessOf(hex: string): number {
  return hexToLch(hex).lightness;
}

/** Whether each colour is strictly lighter (in L*) than the one before it. */
export function isAscending(colours: string[]): boolean {
  const ladder = colours.map(lightnessOf);
  return ladder.every((lightness, index) => index === 0 || lightness > ladder[index - 1]);
}
