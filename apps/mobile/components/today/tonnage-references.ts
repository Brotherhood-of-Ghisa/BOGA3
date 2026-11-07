import { uiSpace, uiTypography } from '@/components/ui/tokens';

// Original BoGa outlines, drawn for this chart on a 32 × 16 grid.
// Unbranded vector geometry; no third-party artwork or font dependency.
export const TONNAGE_REFERENCES = [
  { id: 'elephant', value: 6000, label: '≈6 t', spoken: 'African elephant, approximately 6 tonnes',
    path: 'M5 10V6C5 2 9 1 14 2C18 1 21 2 23 4C26 2 29 4 29 7V11Q29 13 31 11V12Q31 15 28 14Q26 14 26 11V9L24 8L23 14H20L19 10H12L11 14H8V10Z M5 6Q2 6 2 10 M23 4C19 1 17 5 20 9Q24 11 24 5 M27 5.5h.1' },
  { id: 'wagon', value: 20000, label: '≈20 t', spoken: 'empty freight wagon, approximately 20 tonnes',
    path: 'M2 3H30V10H2Z M9 3V10 M16 3V10 M23 3V10 M1 11H31 M4 11V12 M28 11V12 M8 13a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0 M13 13a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0 M22 13a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0 M27 13a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0' },
  { id: 'humpback', value: 40000, label: '≈40 t', spoken: 'humpback whale, approximately 40 tonnes',
    path: 'M7 7L2 3L3 7L1 10L7 9C11 12 16 12 20 11Q29 13 31 8Q29 5 24 5C20 3 17 3 14 4L12 3L11 5Z M21 9Q17 14 13 15Q14 11 17 9 M25 8Q28 9 31 8 M28 6.5h.1' },
  { id: 'fin-whale', value: 60000, label: '≈60 t', spoken: 'fin whale, approximately 60 tonnes',
    path: 'M7 8L2 3L3 8L1 12L7 10Q18 13 31 8Q24 5 18 6L16 2Q13 3 13 6Z M21 9L18 13L24 10 M27 8h.1' },
  { id: 'ferry', value: 80000, label: '≈80 t', spoken: 'small passenger ferry, approximately 80 tonnes',
    path: 'M1 10H31L27 14H5Z M5 10V6H27V10 M8 6V3H23L26 6 M10 4.5H13 M15 4.5H18 M20 4.5H23 M8 8H11 M13 8H16 M18 8H21 M23 8H25 M16 3V1 M2 15Q5 13 8 15Q11 13 14 15Q17 13 20 15Q23 13 26 15Q29 13 31 15' },
  // Endeavour's maximum landing weight is 100,000 kg (orbiter only):
  // https://www.esa.int/articles/shuttle-technical-facts
  { id: 'shuttle', value: 100000, label: '≈100 t', spoken: 'Space Shuttle orbiter at maximum landing weight, approximately 100 tonnes',
    path: 'M30.5 8Q28.5 5.8 24 5.8H19L6 1H3L6 5.8H2V10.2H6L3 15H6L19 10.2H24Q28.5 10.2 30.5 8Z M6 8H19 M25 6.2L24 8L25 9.8 M2 6.8H.8 M2 9.2H.8' },
  // The R 9150 backhoe configuration weighs 128 t, rounded to this reference:
  // https://www.liebherr.com/shared/media/mining/brochures/job-reports/r-9150-alrosa/eb_r9150-alrosa_enus.pdf
  { id: 'excavator', value: 125000, label: '≈125 t', spoken: 'large mining excavator, approximately 125 tonnes',
    path: 'M2 11V8H9V5H14L16 8V11Z M10.5 6.5H13L14.5 8.5H10.5Z M4 11.5H16C18.5 11.5 18.5 15 16 15H4C1.5 15 1.5 11.5 4 11.5Z M5 13.25H15 M15.5 8L20 1.5H22L28.5 8L27 9.5L21.5 4.5L18 10 M27 9.5L30.5 10V13.5H27L25 11.5Z' },
  // Modelled sphere: 5 m diameter × 2.3 t/m³ bulk density gives about 150.5 t.
  // Density assumption: https://ntrs.nasa.gov/api/citations/20110016582/downloads/20110016582.pdf
  { id: 'asteroid', value: 150000, label: '≈150 t', spoken: 'small stony asteroid about 5 metres across, approximately 150 tonnes',
    path: 'M11 1.5L17 1L23 3.5L26 7L24 11.5L18.5 15L12 14L6.5 10L7.5 5Z M11 5.4C11 3.3 15.5 3.3 15.5 5.4C15.5 7.5 11 7.5 11 5.4Z M19 10.3C19 8.7 22 8.7 22 10.3C22 11.9 19 11.9 19 10.3Z M11 10L12.5 11.4 M20 4.5L21 5.5' },
] as const;

type Reference = typeof TONNAGE_REFERENCES[number];
export const REFERENCE_STROKE = 0.75;
export const REFERENCE_ICON_WIDTH = uiSpace.xxl;
export const REFERENCE_HEIGHT = uiTypography.lineHeight.sm; // `figureSmall`'s line
export const REFERENCE_GAP = uiSpace.xs;

export const finiteMaximum = (values: readonly (number | null)[]): number =>
  values.reduce<number>((maximum, value) => value !== null && Number.isFinite(value) ? Math.max(maximum, value) : maximum, 0);

/** Only the selected values determine eligibility, before any layout fitting. */
export const eligibleTonnageReferences = (values: readonly (number | null)[]): readonly Reference[] => {
  const reach = finiteMaximum(values);
  return TONNAGE_REFERENCES.filter(reference => reference.value <= reach).slice(-6);
};

/** Add only the clearance needed above the highest annotation. */
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

/** Anchor labels on the right, staggering left/up only to avoid collisions. */
export const layoutTonnageReferences = (
  references: readonly Reference[], plot: { width: number; top: number; bottom: number }, maximum: number,
): TonnageAnnotation[] => {
  const placed: TonnageAnnotation[] = [];
  for (const reference of references) {
    const y = plot.top + (1 - reference.value / maximum) * (plot.bottom - plot.top);
    // Plex Mono's glyph advance is 600/1000 em, including ≈ and spaces.
    const width = REFERENCE_ICON_WIDTH + REFERENCE_GAP + reference.label.length * uiTypography.size.sm * 0.6;
    const naturalTop = Math.max(uiSpace.xs, y - REFERENCE_GAP - REFERENCE_STROKE / 2 - REFERENCE_HEIGHT);
    const tops = [naturalTop, ...placed.map(other => other.top - REFERENCE_HEIGHT - uiSpace.xs)]
      .filter(top => top >= uiSpace.xs && top <= naturalTop);
    const candidates = [plot.width - width - uiSpace.xs, ...placed.map(other => other.x - width - uiSpace.xs)].flatMap(x =>
      tops.map(top => ({ ...reference, x, y, width, top }))
    );
    const position = candidates.find(candidate => candidate.x >= uiSpace.xs
      && placed.every(other => !overlaps(candidate, other)));
    // The native chart grows with the number of eligible references.
    placed.push(position ?? candidates[0]);
  }
  return placed;
};
