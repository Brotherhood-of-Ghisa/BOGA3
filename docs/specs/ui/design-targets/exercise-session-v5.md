# Accepted target — exercise page and session view (v5/v6)

Target record per `../ai-design-policy.md`. Accepted 2026-09-21.

## Target

- Claude Design canvas: <https://claude.ai/artifact/BigMqBT3vsvWfPTP9W2uAf>
  (private to the owner; ask for access rather than assuming the link opens).
- Governing artboards:

  | Artboard | Screen / state |
  | --- | --- |
  | `V5-Quiet` | exercise page, records panel collapsed (default) |
  | `V5-Records` | exercise page, records panel expanded on `Records` |
  | `V5-Last` | exercise page, records panel expanded on `Last` |
  | `V5-Effort` | effort picker sheet |
  | `V5-Menu` | exercise options sheet (Edit / Swap / Remove) |
  | `V6-Session` | session view |

- `V2-Records` is on the canvas as the History page but is **not** accepted:
  it is older styling, kept only because the exercise page links to it.

The canvas governs the exercise page and the session view. Everything else in
the app is governed by `../ux-rules.md` until it gets its own target.

## Brief

- Two modes, one language; density and emphasis carry the split. See
  `../design-language.md`.
- One primary action per screen, in `accent`.
- The set row is the unit: `type · weight × reps · 1RM/VOL · control`, with every
  row ending in a 44px control column.
- Session view is read-only — cards are links, not controls.
- Numbers are monospaced and always shown: 1RM and volume on performed, current
  and planned sets alike.

## States

Device: 390×844, light. Captured states are the six artboards above; each is a
distinct UI state rather than a variant of one screen, so they are listed rather
than screenshotted here.

No target screenshots are committed. The canvas is live and reachable, and the
policy asks for committed stills only where they disambiguate — nothing here is
ambiguous without them. Runtime comparison captures stay in the gitignored
`apps/mobile/artifacts/maestro/` tree and are linked as PR evidence.

## Known conflicts to resolve in build

1. `accent` and `record` share `#C2410C`. Resolve before the tokens PR.
2. `react-native-svg` and the three typefaces are not installed. Both are
   native-affecting and force a dev-client rebuild.
3. The History page is stale relative to this target and is linked from the
   accepted exercise page.
