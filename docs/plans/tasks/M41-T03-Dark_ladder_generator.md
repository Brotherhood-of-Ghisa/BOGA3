# M41-T03-Dark_ladder_generator — Second lightness ladder

- Status: `planned`
- Depends on: `M41-T01-Split_ground_seeds_and_appearance_record`
- Milestone: `docs/plans/milestones/M41-complete-appearance.md`
- Areas: frontend; UI impact: no (not reachable by users)

## Objective

Generate a dark set of roles from the same seeds: a second L\* ladder plus
dark values for the fixed roles. Gate it with the same invariants as the light
ladder, without exposing it to users.

## Scope

- In: `generateRoles(seeds, mode)` (or equivalent) in
  `components/ui/theme.ts`; dark `surface` / `paper` / neutrals / washes /
  `viz` ramp; dark `danger`, `gain`, `loss`, `regimeOlder`/`regimeNewer`,
  `selection`, the on-colour roles (D6), `scrim`; how `accent` and `record`
  (used as given in light) adapt; Jest gates; an optional dev-only preview
  (`isDevMode()`).
- Out: user-facing mode choice and native surfaces (T04).

## Decided

D4 (dark `surface` above `paper`), D5, D6. Text floors at 4.5:1 and the
`viz` "more" ordering hold in dark too.

## Open — resolve with the user at session start

- `viz` direction in dark: does "more" go lighter or more saturated?
- Whether `accent`/`record` get a dark L\* (no longer "used as given") and how
  presets pin that.
- `selection` in dark: white with dark label, or something else.
- Whether a dev-only preview of the dark roles on a device is worth it before
  T04.

## Deliverables and acceptance

1. Every preset and custom hue × background × text produces dark roles that
   pass the floors (Jest).
2. The light roles do not change.
3. Design-language invariants are restated for both ladders.

## Specs to update

- `docs/specs/ui/design-language.md` §2 — the dark ladder and its invariants
  (replace "Light only").

## Gates

`fast`; quality targets before the PR.
