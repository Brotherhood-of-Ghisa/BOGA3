import { uiText } from '@/components/ui/text-roles';
import { uiSpace } from '@/components/ui/tokens';

// Original BoGa side profiles, drawn for this chart on a 32 × 16 grid.
// Unbranded vector geometry; no third-party artwork or font dependency.
export const TONNAGE_REFERENCES = [
  { id: 'saloon', value: 2000, label: '≈2 t', spoken: 'saloon car, approximately 2 tonnes',
    path: 'M5 12H1V9L6 7Q12 0 21 5L25 7L31 9V12H28 M9 12H24 M8 7Q14 2 20 5L23 7Z M9 12a2 2 0 1 1-4 0a2 2 0 1 1 4 0 M28 12a2 2 0 1 1-4 0a2 2 0 1 1 4 0' },
  { id: 'elephant', value: 6000, label: '≈6 t', spoken: 'African elephant, approximately 6 tonnes',
    path: 'M5 10V6C5 2 9 1 14 2C18 1 21 2 23 4C26 2 29 4 29 7V11Q29 13 31 11V12Q31 15 28 14Q26 14 26 11V9L24 8L23 14H20L19 10H12L11 14H8V10Z M5 6Q2 6 2 10 M23 4C19 1 17 5 20 9Q24 11 24 5 M27 5.5h.1' },
  { id: 'wagon', value: 20000, label: '≈20 t', spoken: 'empty freight wagon, approximately 20 tonnes',
    path: 'M2 3H30V10H2Z M9 3V10 M16 3V10 M23 3V10 M1 11H31 M4 11V12 M28 11V12 M8 13a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0 M13 13a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0 M22 13a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0 M27 13a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0' },
] as const;

type Reference = typeof TONNAGE_REFERENCES[number];
type CurrentSeries = { cumulative: (number | null)[]; toDate: number | null; projected: number | null };
export const REFERENCE_STROKE = 0.75;
export const REFERENCE_ICON_WIDTH = uiSpace.xxl;
export const REFERENCE_HEIGHT = uiText.figureSmall.lineHeight;
export const REFERENCE_GAP = uiSpace.xs;

export const finiteMaximum = (values: (number | null)[]): number =>
  values.reduce<number>((maximum, value) => value !== null && Number.isFinite(value) ? Math.max(maximum, value) : maximum, 0);

/** Eligibility before fitting: [[comparison.tonnage-references]]. */
export const eligibleTonnageReferences = (series: CurrentSeries): readonly Reference[] => {
  const reach = finiteMaximum([...series.cumulative, series.toDate, series.projected]);
  return TONNAGE_REFERENCES.filter(reference => reference.value <= reach);
};

/** Fit just the missing points above the annotation: [[comparison.tonnage-references]]. */
export const fitTonnageMaximum = (
  baseMaximum: number, references: readonly Reference[], plot: { top: number; bottom: number },
): number => {
  const highest = references[references.length - 1];
  if (!highest) return baseMaximum;
  const height = plot.bottom - plot.top;
  const room = REFERENCE_HEIGHT + REFERENCE_GAP + REFERENCE_STROKE / 2 + uiSpace.xs;
  if (height <= room) return baseMaximum;
  return Math.max(baseMaximum, highest.value / (1 - room / height));
};

export type TonnageAnnotation = Reference & { x: number; top: number; y: number; width: number };

const overlaps = (a: TonnageAnnotation, b: TonnageAnnotation): boolean =>
  a.x < b.x + b.width + uiSpace.xs && b.x < a.x + a.width + uiSpace.xs
  && a.top < b.top + REFERENCE_HEIGHT + uiSpace.xs && b.top < a.top + REFERENCE_HEIGHT + uiSpace.xs;

/** Stagger crowded labels, then lift a row with a leader; numeric lines never move. */
export const layoutTonnageReferences = (
  references: readonly Reference[], plot: { width: number; top: number; bottom: number }, maximum: number,
): TonnageAnnotation[] => {
  const placed: TonnageAnnotation[] = [];
  for (const reference of references) {
    const y = plot.top + (1 - reference.value / maximum) * (plot.bottom - plot.top);
    // Plex Mono's glyph advance is 600/1000 em, including ≈ and spaces.
    const width = REFERENCE_ICON_WIDTH + REFERENCE_GAP + reference.label.length * uiText.figureSmall.fontSize * 0.6;
    const naturalTop = Math.max(uiSpace.xs, y - REFERENCE_GAP - REFERENCE_STROKE / 2 - REFERENCE_HEIGHT);
    const candidates = Array.from({ length: references.length }, (_, row) =>
      [uiSpace.xs, ...placed.map(other => other.x + other.width + uiSpace.xs)].map(x => ({
        ...reference, x, y, width,
        top: Math.max(uiSpace.xs, naturalTop - row * (REFERENCE_HEIGHT + uiSpace.sm)),
      }))
    ).flat();
    const position = candidates.find(candidate => candidate.x + width <= plot.width - uiSpace.xs
      && placed.every(other => !overlaps(candidate, other)));
    // Native chart bounds (minimum 72pt high) leave at least two label rows.
    placed.push(position ?? candidates[0]);
  }
  return placed;
};
