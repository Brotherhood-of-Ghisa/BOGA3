import { uiFonts, uiGeometry, uiRoles, uiTypography } from '@/components/ui';
import * as tokens from '@/components/ui/tokens';

// The token rules that stay true for good (`docs/specs/ui/design-language.md`
// §2–§4): the type scale, the colour roles, the geometry,
// the embedded faces, `record`'s distinctness from `accent` and its contrast
// floor, and the one vocabulary (the retired scales never come back).

describe('design-language tokens', () => {
  it('has eight type rungs, `xxs` 10 the smallest, each with a line-height', () => {
    expect(uiTypography.size).toEqual({ xxs: 10, xs: 11, sm: 12, md: 13, base: 14, lg: 16, xl: 18, xxl: 24 });
    expect(uiTypography.lineHeight).toEqual({ xxs: 14, xs: 15, sm: 16, md: 18, base: 20, lg: 22, xl: 24, xxl: 30 });

    const sizes = Object.values(uiTypography.size);
    expect(sizes).toHaveLength(8);
    expect(Math.min(...sizes)).toBe(uiTypography.size.xxs);
    // Every size has a line-height, keyed by the same name.
    expect(Object.keys(uiTypography.lineHeight).sort()).toEqual(
      Object.keys(uiTypography.size).sort(),
    );
  });

  it('carries every colour role named in design-language.md §2', () => {
    expect(Object.keys(uiRoles).sort()).toEqual(
      [
        'accent',
        'accentWash',
        'danger',
        'ink',
        'inkFaint',
        'inkGhost',
        'inkMuted',
        'paper',
        'record',
        'recordRule',
        'recordWash',
        'rule',
        'ruleSoft',
        'scrim',
        'surface',
        'viz0',
        'viz1',
        'viz2',
        'viz3',
        'viz4',
      ].sort(),
    );
  });

  it('carries the geometry of §4', () => {
    expect(uiGeometry).toEqual({
      radius: { card: 6, sheet: 16, control: 4, pill: 999 },
      tapTarget: 44,
      compactControlHeight: 28,
      metricValueWidth: 38,
      sheetHandle: { width: 38, height: 4 },
      fieldHeight: 50,
      microLabelTracking: 0.1,
    });
  });

  it('exports one vocabulary: the retired scales stay gone', () => {
    // `uiColors` and `uiRadius` were retired 2026-09-26, `uiElevation`
    // 2026-09-24: depth is a hairline and a ground change, never a shadow (§4).
    // `scripts/check-ui-guardrails.js` (`legacyVocabulary`) blocks their use.
    const exported = Object.keys(tokens);
    for (const retired of ['uiColors', 'uiRadius', 'uiElevation', 'uiTokens']) {
      expect(exported).not.toContain(retired);
    }
    expect(exported.sort()).toEqual(
      ['uiBorder', 'uiFonts', 'uiGeometry', 'uiIconSize', 'uiRoles', 'uiSpace', 'uiTypography'].sort(),
    );
  });

  it('dims a sheet backdrop with ink, not a neutral black', () => {
    expect(uiRoles.scrim).toBe('rgba(27, 23, 18, 0.42)');
    // `ink` (#1B1712) is rgb(27, 23, 18).
    expect(uiRoles.ink).toBe('#1B1712');
  });

  describe('one value per role (design-language.md §2, rationalised 2026-09-27)', () => {
    it('gives no two roles the same value', () => {
      // Two roles that cannot be told apart are one role (design-language.md "Colour roles").
      const byValue = new Map<string, string[]>();
      for (const [role, value] of Object.entries(uiRoles)) {
        byValue.set(value, [...(byValue.get(value) ?? []), role]);
      }
      const shared = [...byValue.values()].filter((roles) => roles.length > 1);
      expect(shared).toEqual([]);
    });

    it('keeps every neutral on one warm hue', () => {
      // The neutrals are one ramp — the ground a later theme is derived from.
      // `surface` is pure white and has no hue.
      const neutrals = [
        uiRoles.ink,
        uiRoles.inkMuted,
        uiRoles.inkFaint,
        uiRoles.inkGhost,
        uiRoles.paper,
        uiRoles.rule,
        uiRoles.ruleSoft,
      ];
      for (const neutral of neutrals) {
        const { chroma, hue } = lch(neutral);
        expect(chroma).toBeLessThanOrEqual(10);
        expect(hue).toBeGreaterThanOrEqual(75);
        expect(hue).toBeLessThanOrEqual(95);
      }
    });

    it('tints `accent-wash` from `accent`, not from the ground', () => {
      expect(hueDistance(lch(uiRoles.accentWash).hue, lch(uiRoles.accent).hue)).toBeLessThanOrEqual(10);
      expect(lightness(uiRoles.accentWash)).toBeGreaterThanOrEqual(95);
    });
  });

  it('carries exactly the typefaces and weights named in design-language.md §3', () => {
    expect(uiFonts).toEqual({
      display: { family: 'Archivo', weights: ['600', '700', '800'] },
      body: { family: 'Source Sans 3', weights: ['400', '600'] },
      figure: { family: 'IBM Plex Mono', weights: ['500', '600', '700'] },
    });
  });

  it('keeps `record` a different colour from `accent`', () => {
    // The collision resolved 2026-09-22: "your best ever" and "the button that
    // commits" must not read as the same mark. Regressing this is silent — both
    // roles keep working, they just stop meaning different things.
    expect(uiRoles.record).not.toBe(uiRoles.accent);
    expect(uiRoles.recordWash).not.toBe(uiRoles.accentWash);
  });

  it('keeps `record` legible as text on both grounds', () => {
    // WCAG 2.1 normal-text minimum; `record` is applied to figures, not just
    // to a band. Guards against a later "warm it up a bit" losing the floor.
    expect(contrastRatio(uiRoles.record, uiRoles.paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(uiRoles.record, uiRoles.surface)).toBeGreaterThanOrEqual(4.5);
    // `record` figures sit inside the `record-wash` band, so that pairing is a
    // real reading surface too — and the wash is the value most likely to be
    // "warmed up" later.
    expect(contrastRatio(uiRoles.record, uiRoles.recordWash)).toBeGreaterThanOrEqual(4.5);
  });

  describe('data-visualisation ramp (design-language.md §2)', () => {
    const ramp = [uiRoles.viz0, uiRoles.viz1, uiRoles.viz2, uiRoles.viz3, uiRoles.viz4];

    it('darkens step by step, each step distinct from the next', () => {
      // "More" must always read darker, and two neighbouring buckets must not
      // collapse into one colour on a heatmap or a failure row.
      for (let step = 1; step < ramp.length; step += 1) {
        expect(lightness(ramp[step])).toBeLessThan(lightness(ramp[step - 1]));
        expect(lightness(ramp[step - 1]) - lightness(ramp[step])).toBeGreaterThanOrEqual(6);
      }
    });

    it('keeps `ink` legible on every step, and its marks visible on the lightest', () => {
      // Text on a `viz` ground is `ink` (WCAG AA, normal text) — the darkest
      // step is the binding case.
      expect(contrastRatio(uiRoles.ink, uiRoles.viz4)).toBeGreaterThanOrEqual(4.5);
      // The today ring and selected border are `ink` hairlines (non-text, 3:1).
      expect(contrastRatio(uiRoles.ink, uiRoles.viz1)).toBeGreaterThanOrEqual(3);
      // The first step must read as shaded against a card's `surface`.
      expect(lightness(uiRoles.surface) - lightness(uiRoles.viz1)).toBeGreaterThanOrEqual(10);
    });

    it('is never the primary action or a record', () => {
      for (const step of ramp) {
        expect(step).not.toBe(uiRoles.accent);
        expect(step).not.toBe(uiRoles.record);
      }
    });
  });
});

// CIE L* (0–100), the perceptual lightness the ramp is stepped in.
function lightness(hex: string): number {
  return lch(hex).lightness;
}

// CIE LCh (D65): lightness, chroma (colourfulness) and hue angle in degrees.
function lch(hex: string): { lightness: number; chroma: number; hue: number } {
  const [r, g, b] = linearChannels(hex);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const a = 500 * (f(x) - f(y));
  const bStar = 200 * (f(y) - f(z));
  const hue = (Math.atan2(bStar, a) * 180) / Math.PI;
  return { lightness: 116 * f(y) - 16, chroma: Math.hypot(a, bStar), hue: hue < 0 ? hue + 360 : hue };
}

function hueDistance(a: number, b: number): number {
  const distance = Math.abs(a - b) % 360;
  return distance > 180 ? 360 - distance : distance;
}

function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = linearChannels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function linearChannels(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return [r, g, b];
}
