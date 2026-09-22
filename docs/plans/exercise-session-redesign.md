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

## Why this shape

These two screens exercise every unresolved system decision — four colour roles,
the set row, the sheet pattern, the card pattern, the type scale. Building them
settles the language against a real device (keyboard over the in-place logger,
the tick's legibility, set-list performance) in a way more mocks cannot. A third
mocked screen would add no new system information.

Primitives are extracted **only** as these two screens need them. The rest of
the pending list in `components-catalog.md` waits for a third screen to ask.

## Steps

Each step is one PR. Gates per `docs/specs/02-quality-and-test-gates.md`; get
the requirement from `./boga test for`.

| # | Step | Notes |
| --- | --- | --- |
| 1 | Tokens + language | Add the colour roles and type scale to `components/ui/tokens.ts`; **resolve the `accent`/`record` collision** and record the decision. Graduate §2–§4 of the language doc to `Current behavior`. Docs-only parts update `ux-rules.md`. |
| 2 | Fonts + SVG | Add `expo-font` + Archivo / Source Sans 3 / IBM Plex Mono, and `react-native-svg`. Native-affecting: `./boga ios build-client --force` **then** `boga test frontend`. Retire the `Courier` / `Menlo` literals in `app/dev-logs.tsx` and `app/group/[groupId]/invite.tsx`. |
| 3 | Primitives | `ListRow`, `Stat`, `Sheet`, `Card` only — anatomy in the build spec. Update `components-catalog.md` in the same PR. |
| 4 | Exercise page | New route + the set list, records panel, effort sheet, options sheet. Update `screen-map.md` and `navigation-contract.md`. Add a Maestro lane (every flow has one — #309). |
| 5 | Session view | Read-only cards, summary card, Finish in the top bar. Cut the editing surface out of `session-recorder.tsx`. |
| 6 | Close out | Delete this plan and the build spec; confirm every durable decision has graduated to `docs/specs/**`. |

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
