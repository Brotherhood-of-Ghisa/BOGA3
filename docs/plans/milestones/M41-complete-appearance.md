# M41 — Complete appearance: background, text and dark mode

- Status: `planned`
- Created: 2026-11-02, planning baseline `d0fb80b6` on `origin/main`

## Objective

Let a user choose more than the accent. They also pick the page background
and text colour, and later a Light / Dark / Follow system mode, without
breaking the contrast floors that every theme meets by construction today.

## Scope

- In: separate background and text seeds; a versioned appearance record
  (migrated from `boga3.themePreset.v1`); on-colour label roles; Appearance
  page v2; a second (dark) lightness ladder; mode choice and the native
  surfaces it touches (status bar, `userInterfaceStyle`, splash, date picker,
  keyboard, stack header); device acceptance.
- Out: live theme switching (still next launch, D2); free hex entry; syncing
  the choice to the account (stays per device); new launcher icons per
  background, text or mode (icons keep following the accent choice).

## Agreed design direction

### D1. Tints on the light ladder first, dark mode second

Background/text tints ship as a light-only release (T01–T02) before any dark
work is exposed (T03–T04).

### D2. Next launch, not live

A choice still applies on the next launch; the Appearance page's live
`ThemePreview` shows the result. No move off module-scope `StyleSheet.create`.

### D3. Pick hue and tint, never lightness

Background and text follow today's custom-hue rule: the user chooses hue and
tint (chroma); the ladder owns L\*. The floors in `ui-theme.test.ts` are swept
over the whole choice grid, so they hold by construction, not by a runtime
check.

### D4. Cards stay white in light mode

`surface` stays `#FFFFFF` on the light ladder; only `paper` (and the neutrals
derived from it) carries the background tint. On the dark ladder `surface` is
a lighter step than `paper` (elevation by ground change, never a shadow).

### D5. One set of seeds, two ladders

A theme's seeds are the same in both modes; the mode picks the ladder. A user
never configures a separate dark theme.

### D6. Label-on-colour is a role, not `surface`

Text and rings drawn on a filled role get their own roles instead of
borrowing `surface`: on `accent`, `selection`, `danger`, and on `ink` used as
a fill. The dark ladder (and a text tint) can then move `surface` and `ink`
without breaking labels. About ten call sites at planning time, e.g.
`action-button.tsx:140`, `chip-group.tsx:107/118`,
`segmented-control.tsx:162/171`, `exercise-list-controls.tsx:321/330`,
`cows/schedule.tsx:89/109`, `exercise-volume-card.tsx:242`,
`swipe-set-row.tsx:130`, `set-logger.tsx:114`, `start-disc.tsx:61/96`,
`muscle-body-card.tsx:446`; T01 re-greps.

## Task breakdown

| Task | Summary | Depends on | Status |
| --- | --- | --- | --- |
| `M41-T01-Split_ground_seeds_and_appearance_record` | Background/text seeds, on-colour roles, appearance record v2 + migration; no visible change | none | planned |
| `M41-T02-Appearance_page_background_and_text` | Appearance page v2 with background and text pickers (light) | T01 | planned |
| `M41-T03-Dark_ladder_generator` | Second ladder + dark fixed roles, gated in Jest; not exposed | T01 | planned |
| `M41-T04-Dark_mode_choice_and_native_surfaces` | Light / Dark / Follow system, native surfaces, mode-aware assets | T02, T03 | planned |
| `M41-T05-Device_acceptance_and_closeout` | Human acceptance on device, full frontend + sweep, delete the plan | T04 | planned |

T02 and T03 can run in parallel: T02 stays out of the generator
(`theme.ts`, `ui-theme.test.ts`); T03 stays out of the Appearance page.

## Product changes to highlight

- Candidate fact `appearance.theme` (per device, applies at next launch, what
  the user chooses, how Follow system resolves). T01 decides it against the
  bar in `docs/procedures/product-facts-authoring.md`; specs own the details
  (`docs/specs/ui/design-language.md` §2, `docs/specs/ui/ux-rules.md`
  "Appearance").

## Risks / dependencies

- **Follow system while running.** If the OS flips mode mid-session, native
  controls would switch live while our roles stay at the launch mode. T04 must
  pin the native scheme to the launch-resolved mode (e.g.
  `Appearance.setColorScheme`) until the next launch. While
  `userInterfaceStyle` is `"light"` the OS mode always reads light, so the
  order is: `"automatic"` → read the system scheme → resolve → pin.
- **Splash.** `app.config.ts` notes a dark splash breaks expo-splash-screen;
  T04 needs a native rebuild and an explicit decision.
- **Images and the 3D body figure** may assume a light ground; T04 audits them.
- **M40 patterns.** The Appearance page v2 should use the coded UI patterns,
  if they have merged by then.
