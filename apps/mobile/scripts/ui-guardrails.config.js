// Configuration for scripts/check-ui-guardrails.js.
//
// Three kinds of rule:
//
// 1. `rawColorLiteralRule` — already at zero. Any raw hex / rgb(a) in
//    `app/**` or `components/**` blocks on sight. `allowlistedFiles` is the
//    escape hatch and is meant to stay empty.
//
// 2. `legacyVocabularyRule` — the styling vocabulary retired by the design-
//    language migration (2026-09-26). Any of `identifiers` (as a whole word),
//    or `uiTokens.colors|radius|elevation`, in `app/**`, `components/**` or
//    `src/**` (`.ts` and `.tsx`, tests excluded) blocks on sight. There is no
//    budget and no allowlist; the list only ever grows. The replacements are
//    `uiRoles`, `uiGeometry.radius` and the `@/components/ui` primitives
//    (`docs/specs/ui/components-catalog.md`).
//
// 3. `ratchetRules` — type, spacing and radius. These started at 196 / 416 /
//    130 and have reached 0, so in practice all four rules are now
//    zero-tolerance. The mechanism stays: the check fails when a change puts
//    the count OVER budget, and equally when it drops UNDER budget without
//    lowering the number — so a budget only ever travels downwards.
//
//    Raising a budget is never the fix for a failure. If a screen genuinely
//    needs a value the scale lacks, change the scale in components/ui/tokens.ts
//    (and design-language.md) rather than reintroducing a literal. To lower a
//    budget after removing raw values, run from `apps/mobile/`:
//
//      npm run lint:ui-guardrails -- --update-budgets
//
//    `0` is not counted for spacing or radius: it is the absence of the value,
//    not a point on the scale.

module.exports = {
  rawColorLiteralRule: {
    allowlistedFiles: [],
  },

  legacyVocabularyRule: {
    identifiers: [
      'uiColors',
      'uiRadius',
      'uiElevation',
      'UiText',
      'UiSurface',
      'UiButton',
      'SegmentedChips',
      'UiColorToken',
      'UiRadiusToken',
      'UiElevationToken',
      'UiTextVariant',
      'UiSurfaceVariant',
      'UiButtonVariant',
    ],
  },

  ratchetRules: {
    rawFontSize: {
      budget: 0,
      allowlistedFiles: [],
    },
    rawSpacing: {
      budget: 0,
      allowlistedFiles: [],
    },
    rawRadius: {
      budget: 0,
      allowlistedFiles: [],
    },
  },
};
