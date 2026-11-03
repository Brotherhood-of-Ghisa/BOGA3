# M41-T01-Split_ground_seeds_and_appearance_record — Separate background and text seeds

- Status: `planned`
- Depends on: none
- Milestone: `docs/plans/milestones/M41-complete-appearance.md`
- Areas: frontend; UI impact: no (every existing theme renders the same)

## Objective

Make background and text independently choosable in the theme model, without
any UI yet. Replace the single `ground` seed with background and text seeds,
add on-colour label roles, and store the choice as a versioned appearance
record that existing `boga3.themePreset.v1` values migrate into.

## Scope

- In: `ThemeSeeds` / `generateRoles` (`components/ui/theme.ts`),
  `seedsFromHue` (`components/ui/theme-hue.ts`), presets
  (`components/ui/theme-presets.ts`), `components/ui/tokens.ts`, launch read
  and save (`components/ui/theme-launch.ts`,
  `components/appearance/chosen-theme.ts`), dependents of `ResolvedTheme`
  (`components/appearance/theme-app-icon.ts`,
  `src/appearance/launch-theme-report.ts`: new problem kinds for a bad v2
  record), the on-colour roles (D6) and all their call sites, and tests
  (`ui-theme`, `ui-design-tokens`, `ui-theme-launch`, `settings-appearance`,
  `theme-app-icon`, `theme-colour-screen`).
- Out: any picker UI (T02); dark ladder (T03).

## Decided

D3, D4, D5, D6. Presets and custom hues keep their current look: the default
background/text derive from the accent choice exactly as `ground` does today
(ΔE\*ab ≤ 1 against the current roles).

## Open — resolve with the user at session start

- Record shape and key (e.g. `boga3.appearance.v2` JSON `{accent, background,
  text, mode}`), and whether v1 is rewritten or only read as a fallback.
- Text choice: a separate hue, or "follow background" plus a short list of
  tinted inks? The max chroma for `ink` at L\*8 that still reads as text.
- Which neutrals follow text vs background (`inkMuted`…`inkGhost`, `rule`,
  `viz0`, `scrim`). This rewrites the invariant "the neutrals are one hue"
  (`design-language.md` §2, gated in `ui-design-tokens.test.ts`; also assumed
  at `ui-theme.test.ts:135`).
- Whether `appearance.theme` meets the product-fact bar.

## Deliverables and acceptance

1. Every preset and every `hue:<deg>` value renders identical roles (Jest).
2. A v1 value (preset id, `hue:<deg>`, unknown, unreadable) resolves to the
   same theme through the new record; failures are logged as today.
3. Floors in `ui-theme.test.ts` hold across the background × text × accent
   grid.
4. No component reads `uiRoles.surface` as a foreground (text, ring,
   stroke) on a filled role; a Jest guard keeps it so.

## Specs to update

- `docs/specs/ui/design-language.md` §2 — seeds, on-colour roles, the
  neutral-hue invariant, choosing.
- `docs/specs/03-technical-architecture.md` decision register — its "four
  seeds" entry names `ground`; update it, plus the storage record.

## Gates

`fast` + `frontend-ui` (macOS) / `frontend-android` (Linux) by default, since
component files change; may drop to `covered-by-jest` if the diff is purely
role renames — state it on the PR. Quality targets before the PR.
