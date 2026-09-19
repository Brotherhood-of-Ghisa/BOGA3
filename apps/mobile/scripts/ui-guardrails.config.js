// Configuration for scripts/check-ui-guardrails.js.
//
// Two kinds of rule:
//
// 1. `rawColorLiteralRule` — already at zero. Any raw hex / rgb(a) in
//    `app/**` or `components/**` blocks on sight. `allowlistedFiles` is the
//    escape hatch and is meant to stay empty.
//
// 2. `ratchetRules` — type, spacing and radius. These started well above zero
//    (see docs/specs/ui/ux-rules.md §3), so each carries a `budget` equal to
//    the number of raw values that exist right now. The check fails when a
//    change puts the count OVER budget, and equally when it drops UNDER budget
//    without lowering the number — so the budget only ever travels downwards.
//
//    Raising a budget is never the fix for a failure. To lower one after
//    removing raw values, run from `apps/mobile/`:
//
//      npm run lint:ui-guardrails -- --update-budgets
//
//    `0` is not counted for spacing or radius: it is the absence of the value,
//    not a point on the scale.

module.exports = {
  rawColorLiteralRule: {
    allowlistedFiles: [],
  },

  ratchetRules: {
    rawFontSize: {
      budget: 196,
      allowlistedFiles: [],
    },
    rawSpacing: {
      budget: 416,
      allowlistedFiles: [],
    },
    rawRadius: {
      budget: 130,
      allowlistedFiles: [],
    },
  },
};
