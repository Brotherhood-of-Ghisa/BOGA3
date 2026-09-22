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
   screens set it before navigating.

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

| # | Step | Notes |
| --- | --- | --- |
| 1 | Tokens | Add the colour roles **additively**; **revise the type scale** and **resolve the `accent`/`record` collision** (both in the build spec); record the decisions in `design-language.md`. No existing token repointed. |
| 2 | Fonts + SVG | Add `expo-font` + Archivo / Source Sans 3 / IBM Plex Mono, and `react-native-svg`. Native-affecting: `./boga ios build-client --force` **then** `boga test frontend`. Land early — every later step is blocked behind the rebuild. |
| 3 | Primitives | `ListRow`, `Stat`, `Sheet`, `Card` only — anatomy in the build spec. New components; nothing existing adopts them yet. Update `components-catalog.md`. |
| 4 | Exercise page | New route behind the setting (added in this step, defaulting off). Reuses `src/session-recorder/**`. Its own Maestro lane, which enables the setting first. |
| 5 | Session view | New route behind the same setting. Its own Maestro lane. |
| 6 | Switch over | Flip the setting's default on, then in a follow-up delete the old recorder route, its lanes and the setting itself. Two small reverts rather than one big one. Update `screen-map.md` + `navigation-contract.md`. |
| 7 | Close out | Delete this plan and the build spec; confirm every durable decision has graduated to `docs/specs/**`. |

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

- **`accent` vs `record`** — same hex today. Blocks step 1.
- **Type scale** — the target uses 12 sizes against the scale's 7, and
  `rawFontSize` is enforced at budget 0. Blocks step 1; options in the build
  spec.
- **Complete with pending planned sets** — do they become `unperformed`, stay
  `planned`, or block? The model supports all three
  (`src/session-recorder/set-semantics.ts`). Needed by step 4.
- **Session ⋮ has one item** (Abandon session). Menu, or a plain destructive row?
- **History page** is stale relative to the target and is linked from the
  exercise page. Accept the mismatch for a few PRs, or fold a pass into step 4.
- **Icon set** — step 2 brings `react-native-svg` but not a library. The 25
  improvised Unicode glyphs still need retiring; decide whether that rides along
  or is its own change.

## Risks

- `session-recorder.tsx` is the largest file in the app and owns behaviour these
  screens inherit (draft autosave, lifecycle, submit). Steps 4–5 must not
  silently drop it — read `src/session-recorder/` before cutting.
- Step 2 forces a dev-client rebuild for every worktree; land it early so later
  steps aren't blocked behind it.
