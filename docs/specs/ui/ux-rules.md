# UX Rules (Cross-Screen UI Semantics)

> **Owns:** the UI semantics every screen shares: actions and emphasis, sheets,
> lists, states and feedback, how sets and figures read, styling guardrails,
> and the few screen rules no other source states. **Not here:** a screen's
> own behaviour, which its route entry, components and tests state.
> **Load when:** a task creates or changes UI.

This doc complements `docs/specs/08-ux-delivery-standard.md` (process, UX
contract, reusable UX patterns). It states a rule once, here or in the source
below that owns it, and never restates code: a component's header comment and
the names of its Jest tests are the specification of that component.

## Where screen behaviour lives

| If you are changing… | Load or read |
| --- | --- |
| A route's purpose, sections, states, entry and exit | `screen-map.md` |
| Route params, query values, transitions, header titles | `navigation-contract.md` |
| A primitive or shared component's API and variants | the component file; `components-catalog.md` says which component to reach for |
| Colour roles, type, surfaces, emphasis, figure formatting | `design-language.md` |
| A screen with an accepted design target | its record under `design-targets/` |
| What counts as a working set, a counted session or a record; figure formats | `docs/specs/tech/training-metrics-contract.md` |
| Optional bodyweight calculations, personal or group | `docs/specs/tech/bodyweight-load-contract.md` |
| Group screens, group writes, boards and certification | `docs/specs/tech/groups-contract.md`, `docs/specs/tech/group-competition-contract.md` |
| A reusable interaction pattern (stream card, offline marker, online-only write, row logger, link card) | `docs/specs/08-ux-delivery-standard.md` "UX patterns" |
| Device-local preferences (browser sort, look-back, effort columns) | `docs/specs/05-data-model.md` "Device-local preferences" |

## Actions and emphasis

1. **One primary per screen**, the screen's one `accent` action
   (`design-language.md` "Emphasis"): `Finish`, `Done`, `Edit`, `Save
   Exercise`, a start disc. Train with a ready plan shows the planned start as
   the primary and the empty start as an outline.
2. **Everything else is an outline or a text button.** Dismissal is never a
   button inside a sheet (see Sheets).
3. **Destructive actions are `danger`** and visually distinct from the
   primary: a `danger` row in a sheet, a `danger` outline, or the destructive
   style of a native `Alert`.
4. **Tabs are navigation, not actions.** `MainTabs` uses tab semantics, marks
   the active tab by weight and an `ink` underline, and never uses `accent`.
   There are exactly four tabs (Today, Train, Progress, More); Settings is a
   row under More, and More and Settings work while signed out.
5. **A workout in progress is never offered as a Resume button.** Train opens
   it directly, and every session start goes through the session-entry
   coordinator (`src/session-entry/coordinator.ts`), so no action can create a
   second concurrent session.

## Sheets

1. **A sheet is state within its route, not navigation.** There are two
   kinds. A **picker or menu** (row actions, management options, a choice of
   one value, a short form) opens a design-language `Sheet` over the current
   screen, sized to its content. A **sub-page** (a browser, an editor, a
   preview: Swap exercise, the exercise editor, Share session, Progress
   history) opens a `PageSheet`, the native iOS page sheet the exercise picker
   uses. Do not document opening either as a route transition.
2. **Dragging down closes every sheet, and dismissal writes nothing.** A
   `Sheet` follows a drag from its handle and title row, closes on a
   deliberate release and springs back otherwise; its body scrolls and taps
   without dragging. Its backdrop, Android Back and the VoiceOver escape close
   it too, and it has no Cancel or Close. A `PageSheet` swipes down from
   anywhere and carries an X, since it has no backdrop. A sheet may refuse
   dismissal only while its own write or capture is in flight; a refused drag
   springs back.
3. **Pickers never stack.** A choice made inside a sheet (an editor's muscle
   list) swaps the sheet's body, with a `chevron-left` back to the previous
   body. A sub-page may open over a sub-page, which iOS stacks as cards. A
   confirmation that follows a sheet opens once the sheet has gone
   (`onDismissed`).
4. **The keyboard closes before a sheet opens**, so a sheet never opens under
   it, and a sheet holding fields lifts above the keyboard.
5. **Confirm what cannot be undone, not what can.** A soft delete (exercise,
   completed session, gym archive) does not confirm: the same sheet offers
   `Undelete` / `Unarchive`. Discarding an active session, removing an
   exercise from a session, and destructive group writes confirm first in a
   native `Alert` with a destructive button.
6. **The exercise picker is the one sub-page with a route**
   (`/session/<id>/add-exercise`, presented as a page sheet), because Manage
   pushes the catalogue over it. Swiping it down leaves without adding.

## Lists and rows

1. **A row has one main target and, when it has secondary actions, one
   trailing ⋮** (`IconButton`, 44pt). The main target opens or edits the item;
   the ⋮ opens a sheet titled with the item's name.
2. **Deleted and archived items stay in their list behind a toggle** (`Show
   deleted`, `Show archived`), never a separate route: faded, marked with a
   `Deleted` / `Archived` `Tag` in words, and restored from their row's sheet.
3. **A summary card that opens a destination is one link** with no controls
   inside it and an accessibility label that states its summary (spec 08,
   "Read-only link card pattern"). Editing and removal live on the destination.
4. **A list's sort, filter and search are the list's state.** Changing them
   never navigates and never rewrites the URL; which of them persist is a
   device-local preference (spec 05), not a screen decision.

## States and feedback

1. **Three levels, kept distinct.** A whole-screen state (`StatePanel` filling
   the screen) when the route has nothing meaningful to show yet; an in-section
   state (`StatePanel` in a `Card`) when one area cannot render; an inline
   `Notice` or field message for the outcome of an action. A screen keeps a
   safe exit (back, a tab, or one named exit) in every state.
2. **Feedback sits next to its cause.** A field's validation shows under the
   field; a failed action shows beside the action, and the
   screen's data and form input stay as they were.
3. **Success is a glyph and words, never a hue.** An outcome `Notice` uses the
   `success` glyph in a neutral tone; a failure is `danger`. Warnings and
   offline state also use a glyph and words, not a warning hue
   (`design-language.md` "Colour roles").
4. **A failure never fabricates data.** A failed or loading read shows no zero,
   no `Never done`, no "no history" and no record; empty states appear only
   after a successful empty read. Optional enrichment (history, comparisons,
   records) that fails leaves the stored content and the exits usable.
5. **Retry repeats the same read**, with the same entity and window, through
   the same load the screen uses on focus.
6. **The newest request wins.** A screen refreshes on focus (and on explicit
   pull or Retry); a superseded or unmounted request never replaces the newest
   visible result, and a changed account, window or policy hides older figures
   instead of showing them as current.

## Sets and figures

What a set *is* (valid values, confirmed performed, working set,
volume-included set, counted session, record) is
`docs/specs/tech/training-metrics-contract.md`; how the session recorder
keeps, defaults and cleans up rows is `src/session-recorder/session-model.ts`
and spec 05's session invariants. The UI adds:

1. **An unqualified `Sets` is working sets**, on every screen and in the share
   image. Only plain row counts count every row: the session view card's
   `n of m sets done` and the remove-exercise alert's `its N sets`.
2. **Set inputs show validity by visual cues only** (field frame, a disabled
   commit control); there is no inline validation text inside a set row.
3. **A planned row is matched or modified by its prescribed Weight and Reps
   only**; changing effort does not make it modified.
4. **Every row shows every figure it can compute**, planned and warm-up rows
   included, faded when not performed (`design-language.md` "Presenting
   data"). The only highlight is the exercise's one record set in `record`,
   with the `record` band on its card or set list (`design-language.md`
   "Emphasis"; which set, training-metrics "Records").
5. **One vocabulary and one format.** `Weight`, `Top weight`, `1RM`,
   `Volume`; the formats of training-metrics "Calculations", never `k`, never
   a thousands separator, `—` only for a missing value.

## Styling guardrails

`apps/mobile/scripts/check-ui-guardrails.js` runs as the `ui-guardrails` lane
of `boga test fast` and in CI; its rules, budgets and remedies are stated in
the header of `apps/mobile/scripts/ui-guardrails.config.js`, and the token
values in `apps/mobile/components/ui/tokens.ts`. In short: no raw colour
literals, no retired styling vocabulary, and no raw `fontSize`, spacing or
radius literal in `app/` or `components/` (every budget is 0).

1. **Raising a budget is never the fix.** A value the scale lacks is a case
   for changing the scale in `tokens.ts` and `design-language.md`, agreed as a
   design decision.
2. **Uppercase has two roles only:** micro-labels (`xxs`, 10) and control
   labels (Archivo 700 at `xs` or `sm`: `ActionButton`, the exercise page's
   selector). Body and figure text are never uppercase.
3. **Font sizes are fixed** (decided 2026-09-25). App-owned text and inputs do
   not follow the device's text-size setting: every `Text` and `TextInput`
   sets `allowFontScaling={false}` after any spread props, and `FormField` and
   `SearchField` enforce it for their callers. Native system dialogs stay
   OS-controlled. `__tests__/ui-font-scaling.test.tsx` holds coverage and prop
   precedence.
4. **Icons come from `Icon`**, never from a Unicode character in `Text`;
   characters that belong to the data stay text (`×`, `−`, `·`).
   `__tests__/ui-icon.test.tsx` fails on a retired glyph. An icon-only control
   is a labelled `IconButton`, and an icon never carries state alone: the
   words or the row's accessibility label say it.

Guardrail commands (from `apps/mobile/`): `npm run lint:ui-guardrails`, with
`--verbose` for each ratchet violation, `--include-allowlisted` for the colour
audit, and `--update-budgets` after a cleanup.

## Appearance

Every theme is light; the presets, their seeds and why the choice applies at
next launch are `design-language.md` "Presets" and the decision register in
`docs/specs/03-technical-architecture.md`. Outside the roles: `app/_layout.tsx`
keeps `<StatusBar style="dark" />`; the splash is a fixed white
(`app.config.ts`); neither reads a role. The stack header takes `surface`
and `ink`, read once at launch like every role, so it matches the screen
beneath it.

## Screen rules no other source states

### Exercise tags are read-only

Tag editing was dropped 2026-09-23: there is no attach, create, rename, delete
or manage UI. The synced tag tables and existing assignments stay, and
exercise history filters by them.

### Swipes on the exercise page

Decided 2026-10-01, revised 2026-10-04. Only the open row, the logger,
answers swipes. Right confirms it exactly like the tick and moves on;
confirming the last set adds one, opened with the copied values. Left drops
it: an ad-hoc row is removed; a touched planned row loses its typed values and
effort and reads as its plan again, still open (a swipe never deletes a plan).
A side is offered only when its move would change the row: no left swipe on an
untouched planned row, no right swipe without a valid set; a side not offered
neither drags nor shows its symbol. Both swipes dismiss the keyboard, and
neither navigates. The `Confirm set` / `Drop set` accessibility actions are
the non-gesture path, under the same conditions. Code:
`components/exercise-page/swipe-set-row.tsx`, `canDropSet` and `dropSet` in
`src/session-recorder/exercise-page-model.ts`.

## Maintenance

When a change alters a rule above, update this doc in the same change; for
everything else follow `docs/specs/ui/README.md` "Maintenance rules". Do not
add per-screen behaviour here: state it in the component and its tests, and in
the route's `screen-map.md` entry when it changes entry, exit or states.
