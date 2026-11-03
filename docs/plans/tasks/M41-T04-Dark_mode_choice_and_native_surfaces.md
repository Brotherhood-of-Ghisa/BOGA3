# M41-T04-Dark_mode_choice_and_native_surfaces — Light / Dark / Follow system

- Status: `planned`
- Depends on: `M41-T02-Appearance_page_background_and_text`, `M41-T03-Dark_ladder_generator`
- Milestone: `docs/plans/milestones/M41-complete-appearance.md`
- Areas: frontend + native config; UI impact: yes

## Objective

Let the user choose Light, Dark or Follow system in Appearance. The app
resolves the mode once at launch and draws every screen and native surface
in it.

## Scope

- In: a mode control on the Appearance page; resolving the mode at launch
  (system scheme read synchronously when `tokens.ts` evaluates);
  `userInterfaceStyle` in `app.config.ts`; `<StatusBar>` in `app/_layout.tsx`;
  the stack header; splash; `themeVariant="light"` in
  `components/session-planner/plan-schedule-sheet.tsx`; keyboard appearance;
  SVG charts (`rm-curve/chart.tsx`, `today/period-pace.tsx` fill with
  `surface`); muscle body card / 3D figure and image assets; the preview
  showing the mode.
- Out: live switching (D2); per-mode launcher icons.

## Decided

D2, D5. Mode choice joins the appearance record from T01.

## Open — resolve with the user at session start

- Default for new and existing users: Light (no change) or Follow system.
- Pinning native UI to the launch mode while the OS flips
  (`Appearance.setColorScheme`?), and whether to show "applies at next launch"
  when the system mode changes. Order matters: with `userInterfaceStyle:
  "light"` the OS always reads light, so set `"automatic"`, read the system
  scheme before any pin, resolve, then pin. Native `Alert.alert` follows the
  pin (decision register entry on alerts).
- Splash: keep it white in both modes, or a dark variant (native rebuild; see
  the `app.config.ts` note).
- Design target for the mode control.

## Deliverables and acceptance

1. Each mode, after relaunch, draws every screen, header, status bar, sheet,
   date picker and keyboard consistently.
2. Follow system picks the OS mode at launch; an OS flip mid-session does not
   mix modes.
3. No component hard-codes a light-only colour (grep plus Jest guard).

## UX contract (UI tasks only)

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Choose mode | Appearance → Mode → Dark | Preview in dark; "Saved · next launch" | Save fails → notice, unchanged |
| Follow system | Mode → System; change OS mode; relaunch | App matches OS | OS flips while open → stays in launch mode |

## Specs to update

- `docs/specs/ui/ux-rules.md` "Appearance": rewrite "Every theme is light"
  and the status bar, splash and header lines.
- `docs/specs/ui/design-language.md` §2; `docs/specs/03-technical-architecture.md`
  decision register (the light-only pin is lifted).

## Gates

Native config change: `./boga ios build-client --force`, then `fast` +
`frontend` (macOS); Android dev-client rebuild + `frontend-android` on Linux.
