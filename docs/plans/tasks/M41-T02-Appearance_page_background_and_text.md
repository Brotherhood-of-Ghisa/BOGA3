# M41-T02-Appearance_page_background_and_text — Background and text pickers

- Status: `planned`
- Depends on: `M41-T01-Split_ground_seeds_and_appearance_record`
- Milestone: `docs/plans/milestones/M41-complete-appearance.md`
- Areas: frontend; UI impact: yes

## Objective

Let the user choose the page background and the text colour from Settings →
Appearance, previewing the result live and applying it on the next launch.

## Scope

- In: Appearance page v2 (`components/appearance/appearance-settings.tsx`,
  `theme-colour-screen.tsx`, `theme-preview.tsx`), the Settings row label,
  "next launch" notice, save failures.
- Out: mode choice (T04); cards stay white (D4).

## Decided

D2, D3, D4. Accent presets and the hue ring stay as they are.

## Open — resolve with the user at session start

- Design target and pattern (`docs/specs/ui/ai-design-policy.md`): one page
  with Accent / Background / Text sections, or separate sub-pages.
- Background control: curated swatches (white, warm, cool, sage, rose…), a hue
  ring plus tint slider, or swatches plus "Custom".
- Text control: "Match background" plus tinted inks, or a ring.
- What the Settings home row shows for a combined choice.

## Deliverables and acceptance

1. Picking a background/text updates the preview immediately and saves on
   commit; the page says it applies at next launch.
2. After relaunch every screen uses the chosen tints; cards stay white.
3. A save failure says nothing changed and is logged.

## UX contract (UI tasks only)

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Pick background | Settings → Appearance → Background → choose | Preview updates; "Saved · next launch" | Save fails → danger notice, stored choice unchanged |
| Pick text | Appearance → Text → choose | Preview updates; saved | As above |
| Reset | Choose the default background/text | Matches the accent theme's own ground | — |

## Specs to update

- `docs/specs/ui/ux-rules.md` "Appearance"; `docs/specs/ui/design-language.md`
  §2 "Choosing one".

## Gates

`fast` + `frontend-ui` (macOS) / `frontend-android` (Linux); screenshot
gallery of every accepted state. Does not touch the generator (parallel with
T03).
