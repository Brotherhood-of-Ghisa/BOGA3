import { uiFonts, uiGeometry, uiRoles, uiTypography } from '@/components/ui';
import { defaultThemeSeeds, generateRoles, type ThemeMode } from '@/components/ui/theme';
import { withNeutrals } from '@/components/ui/theme-neutrals';
import * as tokens from '@/components/ui/tokens';

const MODES: readonly ThemeMode[] = ['light', 'dark'];

// The token rules that stay true for good (`docs/specs/ui/design-language.md`
// §2–§4): the type scale, the colour roles, the geometry,
// the embedded faces, `record`'s distinctness from `accent` and its contrast
// floor, and the one vocabulary (the retired scales never come back).

describe('design-language tokens', () => {
  it('has eight ordinary type rungs and a fullscreen timer figure, each with a line-height', () => {
    expect(uiTypography.size).toEqual({ xxs: 10, xs: 11, sm: 12, md: 13, base: 14, lg: 16, xl: 18, xxl: 24, timer: 104 });
    expect(uiTypography.lineHeight).toEqual({ xxs: 14, xs: 15, sm: 16, md: 18, base: 20, lg: 22, xl: 24, xxl: 30, timer: 124 });

    const sizes = Object.values(uiTypography.size);
    expect(sizes).toHaveLength(9);
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
        'gain',
        'ink',
        'inkFaint',
        'inkGhost',
        'inkMuted',
        'loss',
        'onAccent',
        'onDanger',
        'onInk',
        'onSelection',
        'paper',
        'record',
        'recordRule',
        'recordWash',
        'regimeOlder',
        'regimeNewer',
        'rule',
        'ruleSoft',
        'scrim',
        'selection',
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

  it('carries exactly the typefaces and weights named in design-language.md §3', () => {
    expect(uiFonts).toEqual({
      display: { family: 'Archivo', weights: ['600', '700', '800'] },
      body: { family: 'Source Sans 3', weights: ['400', '600'] },
      figure: { family: 'IBM Plex Mono', weights: ['500', '600', '700'] },
    });
  });

  it('dims a sheet backdrop with ink in light mode, and with black in dark', () => {
    expect(uiRoles.scrim).toBe('rgba(27, 23, 18, 0.42)');
    // `ink` (#1B1712) is rgb(27, 23, 18).
    expect(uiRoles.ink).toBe('#1B1712');
    // Dark mode's `ink` is pale: a backdrop of it would lighten the page.
    expect(generateRoles(defaultThemeSeeds, 'dark').scrim).toBe('rgba(0, 0, 0, 0.6)');
  });

  it('ships the light roles: `uiRoles` is the default seeds on the light ladder', () => {
    expect(uiRoles).toEqual(generateRoles(defaultThemeSeeds, 'light'));
  });

  // Every invariant below holds on both ladders (design-language.md §2). Light
  // mode is what ships; dark is the same seeds on the dark ladder.
  describe.each(MODES)('in %s mode', (mode) => {
    const roles = generateRoles(defaultThemeSeeds, mode);
    // Lightness away from the page: up in light mode is darker.
    const away = (hex: string) => (mode === 'light' ? -lightness(hex) : lightness(hex));

    describe('one value per role (design-language.md §2, rationalised 2026-09-27)', () => {
      it('gives no two roles the same value', () => {
        // Two roles that cannot be told apart are one role (design-language.md "Colour roles").
        // An on-colour role is named by the fill it sits on, so it may repeat
        // another role's value.
        const byValue = new Map<string, string[]>();
        for (const [role, value] of Object.entries(roles).filter(([name]) => !/^on[A-Z]/.test(name))) {
          byValue.set(value, [...(byValue.get(value) ?? []), role]);
        }
        const shared = [...byValue.values()].filter((names) => names.length > 1);
        expect(shared).toEqual([]);
      });

      describe.each([
        ['the shipped default', defaultThemeSeeds],
        ['a cool page under a navy ink', withNeutrals(defaultThemeSeeds, 'cool', 'navy')],
        ['a custom page under a plum ink', withNeutrals(defaultThemeSeeds, { hue: 200, tint: 3 }, 'plum')],
      ])('for %s', (_name, seeds) => {
        const seeded = generateRoles(seeds, mode);

        it('keeps each neutral family on one hue: the inks on `text`\'s, the ground on `background`\'s', () => {
          // Background and text are picked apart, so the neutrals are two ramps,
          // each one hue. Light `surface` is pure white and has no hue; dark
          // `surface` is a step of the ground.
          const families = [
            { seed: seeds.text, roles: [seeded.ink, seeded.inkMuted, seeded.inkFaint, seeded.inkGhost] },
            {
              seed: seeds.background,
              roles: [seeded.paper, seeded.rule, seeded.ruleSoft, seeded.viz0, ...(mode === 'dark' ? [seeded.surface] : [])],
            },
          ];
          for (const family of families) {
            const seed = lch(family.seed);
            for (const neutral of family.roles) {
              const { chroma, hue } = lch(neutral);
              expect(chroma).toBeLessThanOrEqual(Math.max(seed.chroma, 1));
              // Hue is only meaningful where there is chroma to carry it.
              if (chroma >= 2) expect(hueDistance(hue, seed.hue)).toBeLessThanOrEqual(10);
            }
          }
        });
      });

      it('keeps the shipped neutrals warm and low in chroma', () => {
        for (const neutral of [roles.ink, roles.inkMuted, roles.inkFaint, roles.inkGhost, roles.paper, roles.rule, roles.ruleSoft]) {
          const { chroma, hue } = lch(neutral);
          expect(chroma).toBeLessThanOrEqual(10);
          expect(hue).toBeGreaterThanOrEqual(75);
          expect(hue).toBeLessThanOrEqual(95);
        }
      });

      it('tints `accent-wash` from `accent`, not from the ground, close to the page', () => {
        expect(hueDistance(lch(roles.accentWash).hue, lch(roles.accent).hue)).toBeLessThanOrEqual(10);
        if (mode === 'light') expect(lightness(roles.accentWash)).toBeGreaterThanOrEqual(95);
        else expect(Math.abs(lightness(roles.accentWash) - lightness(roles.paper))).toBeLessThanOrEqual(10);
      });
    });

    it('keeps `record` a different colour from `accent`', () => {
      // The collision resolved 2026-09-22: "your best ever" and "the button that
      // commits" must not read as the same mark. Regressing this is silent — both
      // roles keep working, they just stop meaning different things.
      expect(roles.record).not.toBe(roles.accent);
      expect(roles.recordWash).not.toBe(roles.accentWash);
    });

    it('keeps `accent` and `record` a visible step from every fixed meaning', () => {
      // A commit must not look like a delete, a change or a regime: ΔE*ab ≥ 5.
      for (const seeded of [roles.accent, roles.record]) {
        for (const fixed of [roles.danger, roles.gain, roles.loss, roles.regimeOlder, roles.regimeNewer]) {
          expect(deltaE(seeded, fixed)).toBeGreaterThanOrEqual(5);
        }
      }
    });

    it('keeps `record` legible as text on both grounds', () => {
      // WCAG 2.1 normal-text minimum; `record` is applied to figures, not just
      // to a band. Guards against a later "warm it up a bit" losing the floor.
      expect(contrastRatio(roles.record, roles.paper)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(roles.record, roles.surface)).toBeGreaterThanOrEqual(4.5);
      // `record` figures sit inside the `record-wash` band, so that pairing is a
      // real reading surface too — and the wash is the value most likely to be
      // "warmed up" later.
      expect(contrastRatio(roles.record, roles.recordWash)).toBeGreaterThanOrEqual(4.5);
    });

    describe('a change\'s two directions (design-language.md §6)', () => {
      // Every change figure takes one of these, and nothing else does, so an
      // improvement and a decrease can never read as each other — or as the
      // delete red, which `loss` must stay distinct from.
      it('keeps both legible as figures on either ground', () => {
        for (const direction of [roles.gain, roles.loss]) {
          expect(contrastRatio(direction, roles.paper)).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(direction, roles.surface)).toBeGreaterThanOrEqual(4.5);
        }
      });

      it('tells the two apart by hue at one weight, and neither from `danger`', () => {
        // One L* for both: the pair reads as equals that differ only in
        // direction, rather than one shouting.
        expect(Math.abs(lightness(roles.gain) - lightness(roles.loss))).toBeLessThanOrEqual(2);
        expect(hueDistance(lch(roles.gain).hue, lch(roles.loss).hue)).toBeGreaterThanOrEqual(90);
        expect(roles.loss).not.toBe(roles.danger);
        expect(hueDistance(lch(roles.loss).hue, lch(roles.danger).hue)).toBeGreaterThanOrEqual(10);
      });

      it('is fixed in every theme, whatever the seeds', () => {
        // `danger` and the two directions are not seeded: a decrease stays red
        // and an improvement green however the accent is picked.
        const rose = generateRoles({ background: '#6A5F62', text: '#6A5F62', accent: '#B4235A', record: '#7A6A12', viz: '#9A7480' }, mode);
        expect(rose.danger).toBe(roles.danger);
        expect(rose.gain).toBe(roles.gain);
        expect(rose.loss).toBe(roles.loss);
      });
    });

    describe('data-visualisation ramp (design-language.md §2)', () => {
      const ramp = [roles.viz0, roles.viz1, roles.viz2, roles.viz3, roles.viz4];

      it('moves away from the page step by step, each step distinct from the next', () => {
        // "More" must always read stronger — darker on the light page, lighter
        // on the dark one — and two neighbouring buckets must not collapse into
        // one colour on a heatmap or a failure row.
        for (let step = 1; step < ramp.length; step += 1) {
          expect(away(ramp[step]) - away(ramp[step - 1])).toBeGreaterThanOrEqual(6);
        }
      });

      it('keeps `ink` legible on every step, and its marks visible on the weakest', () => {
        // Text on a `viz` ground is `ink` (WCAG AA, normal text) — the strongest
        // step is the binding case.
        expect(contrastRatio(roles.ink, roles.viz4)).toBeGreaterThanOrEqual(4.5);
        // The today ring and selected border are `ink` hairlines (non-text, 3:1).
        expect(contrastRatio(roles.ink, roles.viz1)).toBeGreaterThanOrEqual(3);
        // The first step must read as shaded against a card's `surface`.
        expect(away(roles.viz1) - away(roles.surface)).toBeGreaterThanOrEqual(10);
      });

      it('is never the primary action or a record', () => {
        for (const step of ramp) {
          expect(step).not.toBe(roles.accent);
          expect(step).not.toBe(roles.record);
        }
      });
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

// CIE76 ΔE*ab: Euclidean distance in L*a*b*. ~2.3 is a just-noticeable
// difference side by side.
function deltaE(first: string, second: string): number {
  const toLab = (hex: string) => {
    const { lightness: l, chroma, hue } = lch(hex);
    const radians = (hue * Math.PI) / 180;
    return [l, chroma * Math.cos(radians), chroma * Math.sin(radians)];
  };
  const [a, b] = [toLab(first), toLab(second)];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
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
