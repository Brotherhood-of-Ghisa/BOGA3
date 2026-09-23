# Plan — exercise page and session view

Ephemeral working notes (`docs/plans/README.md`). Delete this file in the PR
that ships the last step. Screen-level detail is in
`exercise-session-build-spec.md`; the screen-agnostic language is
`docs/specs/ui/design-language.md`; the accepted target is pinned in
`docs/specs/ui/design-targets/exercise-session-v5.md`.

## Goal

Ship the exercise page and the session view in the accepted design language,
replacing the set-editing surface that lives in
`apps/mobile/app/(tabs)/session-recorder.tsx` (~5,200 lines). The exercise page
is a new route; the session view becomes read-only.

## Strategy: build beside, switch once

The new screens are built as **new routes alongside the existing recorder**, not
by converting it. Nothing user-visible changes until one small switch-over PR.
This keeps `main` shippable throughout — the recorder is the app's core surface
and a half-migrated one is expensive.

Three rules make it work:

1. **Additive only until switch-over.** New colour roles and type rungs are
   *added*; no existing token is repointed. Existing screens keep their current
   appearance, so their Maestro lanes stay green and untouched for the whole
   parallel period. Tokens are the one layer that cannot be built in parallel —
   changing an existing value restyles the old screens too.
2. **Share the domain, duplicate only the presentation.** The new screens reuse
   `src/session-recorder/` (draft autosave, lifecycle helpers, set semantics)
   and the existing data layer. Two recorders writing the same tables through
   two copies of the rules is how they silently diverge.
3. **Gate on a user setting**, not on `isDevMode()`. Every customer is a
   developer, so the new screens should be opt-in on the *real* build — that is
   where the real sessions are. Add a preference mirroring
   `src/exercise-catalog/list-preferences.ts` (SecureStore, versioned storage
   key, snapshot + subscribe + hook + a test reset), surfaced in the Settings
   Preferences card beside the date format. The Maestro lanes for the new
   screens set it before navigating. Shipped as step 3a:
   `useNewScreensEnabled()` from `src/session-recorder/new-screens-preference.ts`;
   flows open `boga3://maestro-harness?reset=data&newScreens=on&teleport=…`
   (spec `11` §9).

**Ready means:** the new screens pass their own Maestro lanes, and they have
been used for real sessions on device — not that they look finished. The
setting is what makes that possible: switch it on, train with it, switch back
if it gets in the way.

Note both recorders write the same session tables, so a session started in one
can be finished in the other. Useful for testing; worth knowing before it
surprises someone.

## Why these two screens first

They exercise every unresolved system decision — colour roles, the type scale,
the set row, the sheet pattern, the card pattern. Building them settles the
language against a real device (keyboard over the in-place logger, the tick's
legibility, set-list performance) in a way more mocks cannot.

Primitives are extracted **only** as these two screens need them. The rest of
the pending list in `components-catalog.md` waits for a third screen to ask.

## Steps

Each step is one PR. Gates per `docs/specs/02-quality-and-test-gates.md`; get
the requirement from `./boga test for`.

| # | Step | Status | Notes |
| --- | --- | --- | --- |
| 1 | Tokens | ✅ shipped | Added `uiRoles` **additively** (`uiColors` untouched); added one type rung `xxs` 10; resolved the `accent`/`record` collision by moving `record` to brass `#8A6516`. Decisions in `design-language.md` §2–§3, scale in `ux-rules.md` §9a. No existing token repointed — held by `app/__tests__/ui-tokens-additive.test.ts`. |
| 2 | Fonts + SVG | ✅ shipped | Added `react-native-svg` and the eight faces, **embedded** by the `expo-font` config plugin (no runtime load). `uiFonts` in `tokens.ts` names them as `{ fontFamily, fontWeight }`, uniform on iOS and Android, so no PostScript map was needed; guarded by `app/__tests__/ui-fonts-embedded.test.ts`. Web falls back to system fonts (`design-language.md` §3). Nothing adopts them yet. |
| 3 | Primitives | ✅ shipped | `ListRow`, `Stat`, `Sheet`, `Card` in `components/ui/`, catalogued; nothing existing adopts them. Off-scale geometry went into a new additive `uiGeometry` (radii 6/16, 44 tap target, 38 metric column, handle, tracking) plus a `scrim` role. Tuned on device: running figures and option labels one weight lighter than drawn; planned values `inkFaint`. The 38pt column holds (`design-language.md` §3). |
| 3a | New-screens setting | ✅ shipped | Carved out of step 4 so 4 and 5 can run in parallel. `src/session-recorder/new-screens-preference.ts` (key `boga3.newExerciseSessionScreens.v1`, default off, not dev-gated); `New exercise & session screens` Off/On in the Settings Preferences card; harness `newScreens=on\|off`, and `reset=data` restores it to off. Gates nothing yet. |
| 4 | Exercise page | ✅ shipped | `app/session/[sessionId]/exercise/[sessionExerciseId].tsx` behind `useNewScreensEnabled()`; composition in `components/exercise-page/`. Shares the domain: loads and saves one exercise through the recorder's repository (a save re-reads the session and replaces only its exercise), with the recorder's autosave controller and lifecycle helpers; page rules in `src/session-recorder/exercise-page-model.ts`. Complete marks pending planned sets `unperformed`, removes ad-hoc sets never ticked. Swap included. Geometry: one additive `uiGeometry.radius.control` (4) + `fieldHeight` (50); gutter `uiSpace.md`. Records keep History's rules (warm-ups count), decided 2026-09-23. Lane `ios-exercise-page` (harness fixture + teleport `exercise-page`). Contract graduated to `screen-map.md`, `navigation-contract.md`, `ux-rules.md` §14a, `components-catalog.md`. |
| 5 | Session view | ✅ shipped | `app/session/[sessionId]/index.tsx` behind the setting; every active-session entry (Today, Train, Sessions, completed-session append) goes there when it is on (`activeSessionHref`). The recorder's pure session model, submit cleanup, completion write and exercise picker moved to `src/session-recorder/session-model.ts`, `session-lifecycle.ts` and `components/session-recorder/exercise-picker.tsx`, so both recorders write through one copy. Card rows keep the mini legends, and every figure takes its row's colour and weight — no per-column `best` bold, only a record 1RM in `record` (design-language §5's `best` is not used on this card); the tab bar stays (it is the way out). Finish prompts are native alerts with the recorder's copy; Abandon confirms. Lane `ios-session-view`. Adds a placeholder `session/[sessionId]/exercise/[sessionExerciseId].tsx` for step 4 to replace. Contract graduated to `screen-map.md` / `navigation-contract.md` / `ux-rules.md` §14b. |
| 6 | Switch over | ⬜ blocked by 4, 5 | Flip the setting's default on, then in a follow-up delete the old recorder route, its lanes and the setting itself. Two small reverts rather than one big one. Update `screen-map.md` + `navigation-contract.md`. |
| 7 | Close out | ⬜ blocked by 6 | Delete this plan and the build spec; confirm every durable decision has graduated to `docs/specs/**`. Includes deleting `ui-tokens-additive.test.ts`, which exists only for the parallel period. |

## Decisions already made

- One page per exercise; session view is read-only and navigational.
- Logger sits **in the list**, not docked — the open row is the set.
- Effort is a picker sheet defaulting to the planned `setType`, not a chip row.
- `Finish` in the session top bar; `Remove from session` in the exercise ⋮.
- Back and Complete are two distinct exits: Back leaves set states untouched,
  Complete prompts on incomplete sets.
- Planned vs ad-hoc is not a mode.
- Warm-ups render like working sets and show a 1RM, while remaining excluded
  from records.

## Open questions

Resolved in step 1 (2026-09-22), kept here only until this plan is deleted:
`accent` vs `record` — `record` moved to brass `#8A6516`. Type scale — one rung
added (`xxs` 10), nothing else moved. Both recorded in `design-language.md`.

Resolved 2026-09-22, recorded with step 2:

- ~~**Complete with pending planned sets**~~ — warn that the planned sets will
  be discarded; the user cancels or goes ahead. Discarded means marked
  `unperformed`, not deleted. Recorded in the build spec under the exercise
  page's Complete exit.
- ~~**Session ⋮ has one item**~~ — a menu, consistent with the exercise ⋮, even
  while it holds only Abandon session.
- ~~**History page**~~ — staleness accepted. History stays as it is; the
  mismatch with the exercise page that links to it is carried knowingly, not
  folded into step 4.
- ~~**Icon set**~~ — its own change after step 2, not bundled with it. The 25
  improvised Unicode glyphs are retired there.
- ~~**Font loading**~~ — embedded in the binary by the config plugin; there is
  no runtime loading strategy. `design-language.md` §3.

None open.

## Risks

- `session-recorder.tsx` is the largest file in the app and owns behaviour these
  screens inherit (draft autosave, lifecycle, submit). Steps 4–5 must not
  silently drop it — read `src/session-recorder/` before cutting.
- ~~Step 2 forces a dev-client rebuild for every worktree~~ — landed. A
  worktree whose shared dev client predates it needs
  `./boga ios build-client --force` once.
