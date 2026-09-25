import { uiFonts, uiGeometry, uiRoles, uiTypography } from '@/components/ui';
import * as tokens from '@/components/ui/tokens';

// The design-language token rules that stay true for good
// (`docs/specs/ui/design-language.md` §2–§4, `ux-rules.md` §9a): the type
// scale, the colour roles, the geometry, the embedded faces, and `record`'s
// distinctness from `accent` and its contrast floor. The redesign's temporary
// "additive only" snapshots of the legacy scales were retired with it (step 7).

describe('design-language tokens', () => {
  it('has eight type rungs, `xxs` 10 the smallest, each with a line-height', () => {
    expect(uiTypography.size).toEqual({ xxs: 10, xs: 11, sm: 12, md: 13, base: 14, lg: 16, xl: 18, xxl: 24 });
    expect(uiTypography.lineHeight).toEqual({ xxs: 14, xs: 15, sm: 16, md: 18, base: 20, lg: 22, xl: 24, xxl: 30 });

    const sizes = Object.values(uiTypography.size);
    expect(sizes).toHaveLength(8);
    expect(Math.min(...sizes)).toBe(uiTypography.size.xxs);
    // Every size has a line-height, keyed by the same name (ux-rules §9a.2).
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
        'disabled',
        'ink',
        'inkFaint',
        'inkMuted',
        'paper',
        'planned',
        'record',
        'recordRule',
        'recordWash',
        'rule',
        'ruleFaint',
        'ruleSoft',
        'ruleStrong',
        'scrim',
        'surface',
        'surfaceSubtle',
        'viz0',
        'viz1',
        'viz2',
        'viz3',
        'viz4',
      ].sort(),
    );
  });

  it('carries the design-language geometry of §4 as its own vocabulary', () => {
    // Kept beside `uiRadius` / `uiSpace` rather than in them: the legacy scales
    // still serve every screen not yet in the design language.
    expect(uiGeometry).toEqual({
      radius: { card: 6, sheet: 16, control: 4, pill: 999 },
      tapTarget: 44,
      metricValueWidth: 38,
      sheetHandle: { width: 38, height: 4 },
      fieldHeight: 50,
      microLabelTracking: 0.1,
    });
  });

  it('has no elevation scale: depth is a hairline and a ground change (§4)', () => {
    // `uiElevation` was retired 2026-09-24 with no user; shadows do not return.
    expect(Object.keys(tokens)).not.toContain('uiElevation');
    expect(Object.keys(tokens.uiTokens)).not.toContain('elevation');
  });

  it('dims a sheet backdrop with ink, not a neutral black', () => {
    expect(uiRoles.scrim).toBe('rgba(21, 24, 29, 0.42)');
    // `ink` (#15181D) is rgb(21, 24, 29).
    expect(uiRoles.ink).toBe('#15181D');
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
  const y = relativeLuminance(hex);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (y * 24389) / 27;
}

function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
