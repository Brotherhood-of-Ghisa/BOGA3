# UX Rules (Cross-Screen UI Semantics)

> **Owns:** the UI semantics every screen shares: actions and emphasis, sheets,
> lists, states and feedback, how sets and figures read, styling guardrails,
> and the few screen rules no other source states. **Not here:** a screen's
> own behaviour, which its route entry, components and tests state.
> **Load when:** a task creates or changes UI.

This doc complements `docs/specs/08-ux-delivery-standard.md` (process, UX
contract, reusable UX patterns). It states each rule once, here or in its owning
source, and never restates code: a component's header comment and its Jest
test names specify it.

## Where screen behaviour lives

| If you are changing… | Load or read |
| --- | --- |
| A route's purpose, sections, states, entry and exit | `screen-map.md` |
| Route params, query values, transitions, header titles | `navigation-contract.md` |
| A primitive or shared component's API and variants | the component file; `components-catalog.md` says which component to reach for |
| Colour roles, type, surfaces, emphasis, figure formatting | `design-language.md` |
| A screen's own layout and behaviour | its component's header comment and Jest tests |
| What counts as a performed or working set, how set counts and set rows show | `docs/product/set.md` |
| A counted session, a record, figure formats, and how code implements the facts | `docs/specs/tech/training-metrics-contract.md` |
| Optional bodyweight calculations, personal or group | `docs/specs/tech/bodyweight-load-contract.md` |
| Group screens, group writes, boards and certification | `docs/specs/tech/groups-contract.md`, `docs/specs/tech/group-competition-contract.md` |
| A reusable interaction pattern (stream card, offline marker, online-only write, row logger, link card) | `docs/specs/08-ux-delivery-standard.md` "UX patterns" |
| Device-local preferences (browser sort, look-back, effort columns) | `docs/specs/05-data-model.md` "Device-local preferences" |

## Analytical periods

Every period selector and default follows [[comparison.allowed-periods]]. When
adding an analytical read or filter, load `docs/product/comparison.md`; reuse
the configured calendar bounds.

## Actions and emphasis

1. **One primary per screen**, the screen's one `accent` action
   (`design-language.md` "Emphasis"): `Finish`, `Done`, `Edit`, `Save`, a
   start disc. Train's disc (an empty start) stays primary even with a
   ready plan, whose `Start` is an outline.
2. **Everything else is an outline or a text button.** Dismissal is never a
   button inside a sheet (see Sheets).
3. **Destructive actions are `danger`** and visually distinct from the
   primary: a `danger` row in a sheet, a `danger` outline, or the destructive
   style of a native `Alert`.
4. **Tabs are navigation, not actions.** `MainTabs` uses tab semantics, marks
   the active tab in `ink` (the others muted) over an `ink` underline, and never uses `accent`.
   Four labelled tabs (Today, Train, Progress, Groups), then in-card ⋮ for More;
   Settings is a More row; both work signed out.
5. **A workout in progress is never a Resume button.** Train is that workout;
   every start goes through `src/session-entry/coordinator.ts`: never two.

## Sheets

1. **A sheet is state within its route, not navigation.** There are two
   kinds. A **picker or menu** (row actions, management options, a choice of
   one value, a short form) opens a design-language `Sheet` over the current
   screen, sized to its content. A **sub-page** (a browser or a preview:
   Swap exercise, Share session) opens a `PageSheet`, the native iOS page
   sheet the exercise picker uses. An **editor** is a page ("Pages"). Do not
   document either as a route transition. A sub-page whose subject
   belongs in a native title and whose chart wants the whole screen is a route
   instead (Progress history, `navigation-contract.md`).
2. **Dragging down closes every sheet, and dismissal writes nothing.** A
   `Sheet` follows a drag from its handle and title row, closes on a
   deliberate release and springs back otherwise; its body scrolls and taps
   without dragging. Its backdrop, Android Back and the VoiceOver escape close
   it too, and it has no Cancel or Close. A `PageSheet` swipes down from
   anywhere and carries an X, since it has no backdrop. A sheet may refuse
   dismissal only while its own write or capture is in flight; a refused drag
   springs back.
3. **Pickers never stack.** A choice made inside a sheet swaps the sheet's
   body, with a `chevron-left` back to the previous body. A sub-page may open
   over a sub-page, which iOS stacks as cards. A
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

## Pages

Decided 2026-10-27.

1. **Two kinds of page.** Tabs have no back; Groups takes the header style
   below for its group switch, the others an in-content `PageHeader`. Every other page has one native stack header on the
   `paper` ground (no white band, no shadow): a minimal back chevron, an
   Archivo 700 title, and an optional `headerRight` action (⋮, `+`). No page
   draws a second back of its own; back returns to where you came from.
2. **Motion says where you went.** Tab presses never animate. A page slides
   in from the right, Back reverses it, a modal rises, and the summary after
   Finish fades.
3. **Edit in a page, choose in a tray.** An editor (the exercise editor,
   `/exercise-edit`) is a pushed page; what it opens (Link) pushes over it, so
   unsaved edits wait beneath. A `Sheet` is for row ⋮ menus and choosing one
   or a few values (a muscle). A single setting — a switch, a choice of two or
   three, a number — is edited in place on its page, never in a tray.

## Forms

Decided 2026-10-27. The primitives are `components/ui/form-section.tsx` and `form-rows.tsx`.

1. **Fields live in sections:** a `FormSection` micro-label over one card of
   rows. The heading names the group, never one field. Only a free-text name
   or title stands alone, at the top, as a `FormField`.
2. **Row kinds:** a `FormField` (free text), a `ChoiceRow` (label,
   value, chevron; opens a picker), a `SwitchRow density="list"` or an
   `InputRow` (a short figure), and an `ActionRow`. No hand-made field frame,
   no copied micro-label style.
3. **Group by what a setting affects, order by use.** Name, then
   relationships used most (an exercise's Groups), required fields, what
   changes the figures (Weight), behaviour (Options); destructive actions
   last, in `danger`.
4. **Rare settings hide behind a switch**; their detail appears only when on,
   and off saves the neutral value.
5. **Words:** sentence case, the unit in the label (`Rest timer (s)`), a
   blank field's placeholder is the default it falls back to. The primary is
   `Save` when editing and `Add <thing>` when creating; there is no Cancel.
6. **One error style:** under its field (`FormField`) or section
   (`FormSection error`).

### Settings pages

Decided 2026-10-30. A `footnote` states only when a change applies or its
status ([[copy.no-inline-explanation]]). Every destination is a pushed page of `FormSection`s
(optional muted `footnote`), built only from `SwitchRow`, `SegmentRow` (≤3
options), `SliderRow` (0–max), `RadioRow` (one of many), `CheckRow` (several), `InputRow` (blank =
default), `FormField`, `ValueRow` (read-only), `ChoiceRow` and `ActionRow`.
Four buttons: **rows** (chevron = a page; `accent` words = acts now; `danger`
words = destroys, confirmed by an `Alert`), **primary** (≤1 per page, only to
create or commit what is not saved instantly), **text** (only in a `Notice`:
Retry), **icon** (headers). No outline. Changes save instantly; an action's failure is
a `Notice` beside it, but preference-storage errors stay on Data & sync.
Checked by `apps/mobile/__tests__/settings-conformance.test.ts`.

## Lists and rows

1. **A row has one main target and, when it has secondary actions, one
   trailing ⋮** (`IconButton`, 44pt). The main target opens or edits the item;
   the ⋮ opens a sheet titled with the item's name.
2. **Deleted and archived items stay in their list behind a toggle** (`Show
   deleted`, `Show archived`), never a separate route: faded, marked with a
   `Deleted` / `Archived` `Tag` in words, and restored from their row's sheet,
   or on the destination when the row is a link.
3. **A summary card that opens a destination is one link** with no controls
   inside it and an accessibility label that states its summary (spec 08,
   "Read-only link card pattern"). Editing and removal live on the destination.
4. **A list's sort, filter and search are the list's state.** Changing them
   never navigates or rewrites the URL; which persist is a device-local
   preference (spec 05).

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

What a set *is* and which sets count are [[set.performed]] and
[[set.eligibility]]; counted sessions and records are
`docs/specs/tech/training-metrics-contract.md`; row lifecycle is
`src/session-recorder/session-model.ts` and spec 05's session invariants. The UI adds:

1. **Set counts** follow [[set.count-display]]; the session view card's row
   count is its plain-row exception.
2. **Set inputs show validity by visual cues only** (field frame, disabled
   commit control); a set row has no inline validation text.
3. **A planned row is matched or modified by its prescribed Weight and Reps
   only**; changing effort does not make it modified.
4. **Set rows** follow [[set.row-figures]]; fading is `design-language.md`
   "Presenting data". Record sets are in `record`, with the `record` band on
   their card or set list (`design-language.md` "Emphasis"; which sets,
   training-metrics "Records").
5. **One vocabulary and one format.** `Weight`, `Top weight`, `1RM`,
   `Volume`; the formats of training-metrics "Calculations", never `k`, never
   a thousands separator, `—` only for a missing value.

## Calendar dates

[[copy.calendar-dates]] is enforced by lint in
`apps/mobile/eslint.config.js` and required formatter arguments in
`apps/mobile/src/utils/local-time.ts`. Components subscribe through
`useDateFormat`; pure view models take that preference explicitly. Calendar keys and canonical form state remain internal values.

## Styling guardrails

`apps/mobile/scripts/check-ui-guardrails.js` runs in fast and CI.
Rules and budgets live in `apps/mobile/scripts/ui-guardrails.config.js`,
values in `apps/mobile/components/ui/tokens.ts`. Raw colour, `fontSize`,
spacing/radius literals and retired vocabulary are forbidden in app/components.

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

For adopted scope, expansion and executable examples, load
`components-catalog.md` ("Gallery and adoption scope").

Guardrail commands (from `apps/mobile/`): `npm run lint:ui-guardrails`
(`--verbose` per violation, `--include-allowlisted` for colour audit, `--update-budgets`
after a cleanup).

## Appearance

A launch draws every screen in one mode: Light (the default), Dark, or System,
the phone's mode at launch. Native UI (alerts, keyboard, date picker) is pinned
to it, so a phone change mid-session shows at the next launch (decision
register, `docs/specs/03-technical-architecture.md`). Presets, seeds and the
next-launch rule are `design-language.md` "Choosing one". The status bar, the
date picker and the navigators take `uiMode`, never a fixed mode or colour
(`apps/mobile/__tests__/ui-mode-literal-guard.test.ts`). The splash stays white
(`app.config.ts`). The stack header takes `paper` (no shadow line) and `ink`, so
header and page read as one surface ("Pages").

Settings → Appearance: a live `ThemePreview`, then Theme (four presets and
Custom as radio rows with swatches), then Mode (Light, Dark, System) for a
preset or one row per Custom part (Background, Text, Accent, Best ever,
Charts), each opening a picker: hue ring, strength `SliderRow`, and for the
background lightness and depth. A tap or release saves at once, writing nothing
when already stored; the chosen row reads `Next launch` until the app reopens.
A failed save shows a danger `Notice` saying nothing changed and is logged.
Settings home names the choice.

## Screen rules no other source states

### Exercise tags are read-only

Tag editing was dropped 2026-09-23: no attach, create, rename, delete or manage
UI exists. Synced tags and assignments stay; exercise history filters by them.

### Swipes on the exercise page

Decided 2026-10-01, revised 2026-10-14. Every row answers the dropping
swipe-left; only the open row, the logger, answers swipe-right, which the
other rows carry as their glyph. Right confirms the row exactly like the tick
and moves on; confirming the last set adds one, opened with the copied values.
Left drops the row: it is removed, planned or ad-hoc, confirmed or not. A side
is offered only when its move would change the row: swipe-left is always
offered, right only with a valid set; an unoffered side neither drags nor shows
its symbol. Both swipes dismiss the
keyboard, and neither navigates. The `Confirm set` / `Drop set` accessibility
actions are the non-gesture path, under the same conditions.

The row follows the finger to the trigger, then resists; the side turns solid
where a release starts firing. Code:
`components/exercise-page/swipe-set-row.tsx`,
`canDropSet` and `dropSet` in `src/session-recorder/exercise-page-model.ts`.

### Planned sessions on Sessions and the plan screens

Resolved rows use neutral `Tag`s and [[planner.progress-outcomes]] labels.
On Sessions, only Upcoming shows dates ([[copy.calendar-dates]]).
Unfinished queues precede optional Completed plans, including unscheduled
children. Unfinished programmes show `{completed} over {total}` in matching Tags,
with separate skips.
Plans never affect workout history; schedules never default to today. **Repeat
last** in the picker appends the newest workout as planned sets ([[gym.split]]),
separately from **From planner**, which offers authored one-off and programme blocks that are
pending, definition-bearing and target-bearing. A block attaches
to the active session's unsourced card of the same exercise: one match attaches,
several offer an accessible choice sheet that writes nothing until confirmed,
none creates a card. **Start all** with another active session offers one Resume
and creates nothing. Complete is explicit — the sourced card's `Complete block`,
refused inline until one of the block's planned sets is confirmed; attachment
alone never advances; skip uses non-performance wording. Code: `src/session-planner/`
(`plan-form-model`, `programme-form-model`, `plan-edit-sync`,
`available-blocks`), the plan and programme routes' screen files.

### Training programmes and multi-session plans

Decided with mobile training programmes.
- **Sequence without dates.** A programme is an ordered sequence of two or
  more child sessions (e.g. a 6-week wave, an A/B split). Children may each
  have an optional schedule and gym; order is independent of calendar dates.
- **Queue and authoring hub.** `/sessions` lists programmes beside standalone
  plans under Unscheduled, by recency, with persistent `Plan session` and
  `New programme` rows.
- **Child session editing.** A focused page-sheet editor
  (`ProgrammeSessionEditSheet`), not one long form.
- **Next unresolved block.** Programme detail (`/programme/[programmeId]`)
  surfaces the next unresolved block in programme order, then exercise order.
  **Add to session** attaches the block to an active session (with candidate card choice when ambiguous) or creates a
  new session; explicit **Skip** advances to the next unresolved block without
  recording performed work.
- **Playlist-style session reordering.** Child sessions reorder with accessible
  Move controls in the programme form and detail; order indexes update
  deterministically.
- **Detached deletion invariant.** Deleting a programme soft-deletes it and
  detaches its child plans (`programme_id` and `programme_order_index` set to
  null), keeping them as standalone plans. Performed rows, workouts and recorded
  sets are never deleted.

### Connected agent write permission

- **Named disclosure of every capability.** The Connected Agents card names the
  client and states every capability of **Allow this coach to make changes**
  next to the toggle: reading upcoming/unscheduled plans, creating plans and
  programmes, and adding, editing, deleting or restoring exercises, whose
  changes recalculate past figures ([[agents.write-access]]). Base OAuth consent is never labelled
  as write access.
- **Default off, revert on failure.** Write access is off until explicitly
  enabled, never by a loading fallback; it applies optimistically and reverts
  to the server value with a retryable error on failure.
- **Revocation stays primary.** Revoking a grant stays the security-critical
  action, with its destructive confirm; reconnecting starts disabled.

## Maintenance

When a change alters a rule above, update this doc in the same change; for
everything else follow `docs/specs/ui/README.md` "Maintenance rules". Do not
add per-screen behaviour here: state it in the component and its tests, and in
the route's `screen-map.md` entry when it changes entry, exit or states.
